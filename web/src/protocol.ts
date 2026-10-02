// Wire format of the rillfacet web viewer: see python/rillfacet/web/protocol.py.
// A message is "AVZ1" | u32 header length | JSON header | pad | buffers; the
// header's {"$b": i} entries are replaced by typed-array views (no copies).

export type TypedArray =
  | Float32Array | Int32Array | Uint32Array | Int16Array | Uint16Array | Uint8Array;

export interface Arr {
  data: TypedArray;
  shape: number[];
}

const CTOR: Record<string, { new (b: ArrayBuffer, o: number, n: number): TypedArray; BYTES_PER_ELEMENT: number }> = {
  float32: Float32Array, int32: Int32Array, uint32: Uint32Array,
  int16: Int16Array, uint16: Uint16Array, uint8: Uint8Array,
};

export function isArr(x: unknown): x is Arr {
  return typeof x === "object" && x !== null && "data" in x && "shape" in x;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function decode(buf: ArrayBuffer): any {
  const head = new Uint8Array(buf, 0, 4);
  if (String.fromCharCode(...head) !== "AVZ1") throw new Error("bad message magic");
  const n = new DataView(buf).getUint32(4, true);
  const body = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, n)));
  const metas: { dtype: string; shape: number[]; offset: number; nbytes: number }[] =
    body.$buffers ?? [];
  delete body.$buffers;
  const arrays: Arr[] = metas.map((m) => {
    const C = CTOR[m.dtype];
    return { data: new C(buf, m.offset, m.nbytes / C.BYTES_PER_ELEMENT), shape: m.shape };
  });
  const walk = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === "object") {
      const o = x as Record<string, unknown>;
      const keys = Object.keys(o);
      if (keys.length === 1 && keys[0] === "$b") return arrays[o.$b as number];
      for (const k of keys) o[k] = walk(o[k]);
    }
    return x;
  };
  return walk(body);
}
