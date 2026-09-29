// A replay held in the browser: the `replay` message's tracks plus the pose
// chunks as they arrive (see python/avbd_viz/web/replay.py). sample(t)
// rebuilds the scene state at tick t — each track's latest sample at or
// before t, poses interpolated (lerp + slerp) between samples — in the same
// {object: {field: Arr}} shape as a live frame, so the renderer and panel
// take it as is.
import { type Arr, type TypedArray } from "./protocol";
import { type SceneObject } from "./renderer";
import { type Vec3 } from "./math";

interface PoseInfo {
  samples: number; envs: number; bodies: number;
  static_mask: Arr; static_poses: Arr; pos_lo: Arr; pos_span: Arr;
  chunk: number; chunks: number;
}

interface TrackMsg { object: string; field: string; t: Arr; values?: Arr; pose?: PoseInfo }

export interface EnvSummary { env: number; end_step: number; [k: string]: unknown }

export interface ReplayMsg {
  id: number;
  source: "eval" | "ring";
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  meta: Record<string, any>;
  summary: { envs: EnvSummary[]; batch: Record<string, number> };
  tick_seconds: number;
  duration: number;
  scene: { objects: SceneObject[]; camera: [Vec3, Vec3] | null };
  tracks: TrackMsg[];
}

export interface ChunkMsg { id: number; track: number; start: number; count: number; shape: number[]; data: Arr }

class PoseTrack {
  readonly n: number;
  readonly B: number;
  readonly dyn: number[] = []; // moving body indices
  private q: Int16Array; // absolute quantized samples [K, n, Bd, 7]
  loaded = 0; // samples available (a prefix)
  private out: Float32Array;
  private a = new Float32Array(7);
  private b = new Float32Array(7);

  constructor(readonly info: PoseInfo) {
    this.n = info.envs;
    this.B = info.bodies;
    for (let b = 0; b < this.B; b++) if (!info.static_mask.data[b]) this.dyn.push(b);
    this.q = new Int16Array(info.samples * this.n * this.dyn.length * 7);
    this.out = new Float32Array(this.n * this.B * 7);
    // Static bodies once, [n, Bs, 7] in body order.
    const sp = info.static_poses.data;
    for (let e = 0; e < this.n; e++) {
      let s = 0;
      for (let b = 0; b < this.B; b++) {
        if (!info.static_mask.data[b]) continue;
        const Bs = info.static_poses.shape[1];
        for (let k = 0; k < 7; k++) this.out[(e * this.B + b) * 7 + k] = sp[(e * Bs + s) * 7 + k];
        s++;
      }
    }
    if (info.chunks === 0) this.loaded = info.samples; // nothing moves
  }

  async addChunk(c: ChunkMsg) {
    const bytes = c.data.data as Uint8Array;
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate"));
    const d = new Int16Array(await new Response(stream).arrayBuffer());
    const row = this.n * this.dyn.length * 7;
    const dst = this.q.subarray(c.start * row, (c.start + c.count) * row);
    // Undo the delta coding along time (int16 wraps, like the encoder's).
    dst.set(d.subarray(0, row));
    for (let k = 1; k < c.count; k++)
      for (let i = 0; i < row; i++) dst[k * row + i] = dst[(k - 1) * row + i] + d[k * row + i];
    this.loaded = Math.max(this.loaded, c.start + c.count);
  }

  private dequant(sample: number, e: number, j: number, o: Float32Array) {
    const Bd = this.dyn.length;
    const base = ((sample * this.n + e) * Bd + j) * 7;
    const lo = this.info.pos_lo.data, span = this.info.pos_span.data;
    for (let k = 0; k < 3; k++) o[k] = ((this.q[base + k] + 32768) / 65535) * span[k] + lo[k];
    for (let k = 3; k < 7; k++) o[k] = this.q[base + k] / 32767;
  }

  // Poses [n, B, 7] between samples i and i + 1 (alpha in [0, 1]).
  sample(i: number, alpha: number): Float32Array {
    const i1 = Math.min(i + 1, this.loaded - 1);
    if (i1 <= i) alpha = 0;
    const o = this.out, a = this.a, b = this.b;
    for (let e = 0; e < this.n; e++) {
      for (let j = 0; j < this.dyn.length; j++) {
        this.dequant(i, e, j, a);
        const at = (e * this.B + this.dyn[j]) * 7;
        if (alpha > 0) {
          this.dequant(i1, e, j, b);
          for (let k = 0; k < 3; k++) o[at + k] = a[k] + (b[k] - a[k]) * alpha;
          slerp(a, b, alpha, o, at + 3);
        } else {
          for (let k = 0; k < 3; k++) o[at + k] = a[k];
          normalizeInto(a, o, at + 3);
        }
      }
    }
    return o;
  }
}

function normalizeInto(q: Float32Array, o: Float32Array, at: number) {
  const l = Math.hypot(q[3], q[4], q[5], q[6]) || 1;
  for (let k = 0; k < 4; k++) o[at + k] = q[3 + k] / l;
}

// Quaternions at a[3..7], b[3..7] (xyzw) -> o[at..at+4].
function slerp(a: Float32Array, b: Float32Array, t: number, o: Float32Array, at: number) {
  let dot = a[3] * b[3] + a[4] * b[4] + a[5] * b[5] + a[6] * b[6];
  const sign = dot < 0 ? -1 : 1;
  dot *= sign;
  let wa: number, wb: number;
  if (dot > 0.9995) {
    wa = 1 - t; wb = t;
  } else {
    const th = Math.acos(Math.min(1, dot));
    const s = Math.sin(th);
    wa = Math.sin((1 - t) * th) / s;
    wb = Math.sin(t * th) / s;
  }
  let l = 0;
  for (let k = 0; k < 4; k++) {
    const v = wa * a[3 + k] + wb * sign * b[3 + k];
    o[at + k] = v;
    l += v * v;
  }
  l = Math.sqrt(l) || 1;
  for (let k = 0; k < 4; k++) o[at + k] /= l;
}

// Index of the last t[i] <= x (0 if none).
function lastAtOrBefore(t: TypedArray, x: number, n = t.length): number {
  let lo = 0, hi = n - 1;
  if (n === 0 || x < t[0]) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (t[mid] <= x) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// Outcome categories, in precedence order, with their colors (CSS vars).
export const OUTCOMES: [string, string][] = [
  ["success", "var(--ok)"], ["forbidden", "var(--bad)"], ["overload", "var(--warn)"],
  ["unstable", "var(--purple)"], ["timeout", "var(--muted)"],
];

export function envOutcome(s: EnvSummary | undefined): string {
  if (!s) return "";
  for (const [k] of OUTCOMES) if (s[k] === true) return k;
  if (s.complete === false || s.unfinished) return "running";
  return "ended";
}

export class Replay {
  readonly msg: ReplayMsg;
  readonly numEnvs: number;
  readonly endStep: number[];
  private poses = new Map<number, PoseTrack>();
  private cache = new Map<number, number>(); // track -> last sample index sent
  private chain: Promise<void> = Promise.resolve();
  chunksDone = 0;
  readonly chunksTotal: number;
  onChunk: () => void = () => {};

  constructor(msg: ReplayMsg) {
    this.msg = msg;
    const rigid = msg.scene.objects.find((o) => o.kind === "rigid_mesh");
    this.numEnvs = rigid ? rigid.attrs.instances : 0;
    this.endStep = Array.from({ length: this.numEnvs }, (_, e) =>
      msg.summary.envs?.[e]?.end_step ?? msg.duration);
    let total = 0;
    msg.tracks.forEach((tr, i) => {
      if (tr.pose) {
        this.poses.set(i, new PoseTrack(tr.pose));
        total += tr.pose.chunks;
      }
    });
    this.chunksTotal = total;
  }

  get id() { return this.msg.id; }
  get duration() { return this.msg.duration; }

  // Seconds of one physics / control step, in ticks.
  get physTicks() {
    const dt = this.msg.meta.dt, ts = this.msg.tick_seconds;
    return dt && ts ? dt / ts : 1;
  }
  get ctrlTicks() { return this.physTicks * (this.msg.meta.decimation ?? 1); }

  // Ticks with poses available (the loaded prefix).
  get loadedUntil(): number {
    let t = this.duration;
    for (const [i, p] of this.poses) {
      const tt = this.msg.tracks[i].t.data;
      t = Math.min(t, p.loaded ? tt[p.loaded - 1] : 0);
    }
    return t;
  }

  addChunk(c: ChunkMsg): Promise<void> {
    // Serialized: chunks complete in arrival order.
    this.chain = this.chain.then(async () => {
      await this.poses.get(c.track)?.addChunk(c);
      this.chunksDone++;
      this.onChunk();
    });
    return this.chain;
  }

  // Per-env channel [K, n] -> its values over time for plotting.
  channel(name: string): Arr | null {
    const tr = this.msg.tracks.find((t) => t.object === "channels" && t.field === name);
    return tr?.values ?? null;
  }

  channelTimes(name: string): TypedArray | null {
    const tr = this.msg.tracks.find((t) => t.object === "channels" && t.field === name);
    return tr ? tr.t.data : null;
  }

  // Names of per-env scalar channels (plottable).
  perEnvChannels(): string[] {
    return this.msg.tracks
      .filter((t) => t.object === "channels" && t.values && t.values.shape.length === 2 && t.values.shape[1] === this.numEnvs)
      .map((t) => t.field);
  }

  // The state at tick t: objects (only fields whose sample changed since the
  // last call, unless `all`) and every channel (per-env arrays held at each
  // env's end_step).
  sample(t: number, all = false): { objects: Record<string, Record<string, Arr>>; channels: Record<string, number | Arr> } {
    const objects: Record<string, Record<string, Arr>> = {};
    const channels: Record<string, number | Arr> = {};
    const n = this.numEnvs;
    this.msg.tracks.forEach((tr, i) => {
      const tt = tr.t.data;
      const pose = this.poses.get(i);
      if (pose) {
        if (!pose.loaded) return;
        const k = lastAtOrBefore(tt, t, pose.loaded);
        const span = k + 1 < pose.loaded ? tt[k + 1] - tt[k] : 0;
        const alpha = span > 0 ? Math.max(0, Math.min(1, (t - tt[k]) / span)) : 0;
        (objects[tr.object] ??= {})[tr.field] = {
          data: pose.sample(k, alpha), shape: [pose.n, pose.B, 7],
        };
        return;
      }
      const v = tr.values!;
      const inner = v.shape.slice(1);
      const size = inner.reduce((a, b) => a * b, 1);
      if (tr.object === "channels") {
        if (inner.length === 0) {
          channels[tr.field] = v.data[lastAtOrBefore(tt, t)];
        } else if (inner.length === 1 && inner[0] === n) {
          const out = new Float32Array(n);
          for (let e = 0; e < n; e++) {
            const k = lastAtOrBefore(tt, Math.min(t, this.endStep[e]));
            out[e] = v.data[k * n + e];
          }
          channels[tr.field] = { data: out, shape: [n] };
        } else {
          const k = lastAtOrBefore(tt, t);
          channels[tr.field] = { data: v.data.subarray(k * size, (k + 1) * size), shape: inner };
        }
        return;
      }
      const k = lastAtOrBefore(tt, t);
      if (!all && this.cache.get(i) === k) return;
      this.cache.set(i, k);
      (objects[tr.object] ??= {})[tr.field] = { data: v.data.subarray(k * size, (k + 1) * size), shape: inner };
    });
    return { objects, channels };
  }

  resetCache() { this.cache.clear(); }
}
