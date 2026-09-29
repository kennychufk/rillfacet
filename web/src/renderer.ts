// WebGPU renderer of the web client: rigid meshes (body-local vertices, one
// pose per instance and body), small CPU-built meshes (boxes, point markers)
// and the background gradient, shaded with the native viewer's WGSL (Studio).
import backgroundSrc from "./shaders/background.wgsl";
import dynamicSrc from "./shaders/dynamic.wgsl";
import rigidSrc from "./shaders/rigid.wgsl";
import { type Arr } from "./protocol";
import { invert, mul, OrbitCamera } from "./math";

// Float offsets into the Frame uniform (shaders/common/frame.wgsl).
const F = {
  view: 0, proj: 16, viewProj: 32, invViewProj: 48, invProj: 64, invView: 80,
  cameraPos: 112, viewport: 116, sunDir: 120, bgTop: 124, bgBottom: 128,
  style: 176, style2: 180, size: 236,
};
const SAMPLES = 4;

const srgbToLinear = (c: number) =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

export function packColor(r: number, g: number, b: number, a = 1): number {
  const q = (x: number) => Math.max(0, Math.min(255, Math.round(x * 255)));
  return (q(r) | (q(g) << 8) | (q(b) << 16) | (q(a) << 24)) >>> 0;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SceneObject = { kind: string; name: string; attrs: any; arrays: Record<string, Arr> };

interface RigidGpu {
  kind: "rigid";
  instances: number;
  bodies: number;
  indexCount: number;
  pos: GPUBuffer;
  body: GPUBuffer;
  index: GPUBuffer;
  poses: GPUBuffer;
  colors: GPUBuffer;
  offsets: Float32Array;
  bind: GPUBindGroup;
  poseScratch: Float32Array;
}

interface DynGpu {
  kind: "dyn";
  obj: SceneObject;
  pos?: GPUBuffer;
  color?: GPUBuffer;
  index?: GPUBuffer;
  indexCount: number;
  capacity: [number, number];
}

const BOX_CORNERS = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1];
const BOX_TRIS = [0, 3, 2, 0, 2, 1, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5,
  2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];

export class Renderer {
  camera = new OrbitCamera();
  private frame = new Float32Array(F.size);
  private frameBuf: GPUBuffer;
  private rigidPipe: GPURenderPipeline;
  private dynPipe: GPURenderPipeline;
  private bgPipe: GPURenderPipeline;
  private frameBind: Map<GPURenderPipeline, GPUBindGroup> = new Map();
  private objects: Map<string, RigidGpu | DynGpu> = new Map();
  private color?: GPUTexture;
  private depth?: GPUTexture;
  private size: [number, number] = [0, 0];
  dark = true;

  private constructor(
    private device: GPUDevice,
    private context: GPUCanvasContext,
    private format: GPUTextureFormat,
    private canvas: HTMLCanvasElement,
  ) {
    this.frameBuf = device.createBuffer({
      size: F.size * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const depthStencil: GPUDepthStencilState = {
      format: "depth32float", depthWriteEnabled: true, depthCompare: "greater",
    };
    const target = [{ format }];
    const ms = { count: SAMPLES };
    const mod = (code: string) => device.createShaderModule({ code });
    const rigid = mod(rigidSrc);
    this.rigidPipe = device.createRenderPipeline({
      layout: "auto",
      vertex: {
        module: rigid, entryPoint: "vs_main",
        buffers: [
          { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] },
          { arrayStride: 4, attributes: [{ shaderLocation: 1, offset: 0, format: "uint32" }] },
        ],
      },
      fragment: { module: rigid, entryPoint: "fs_main", targets: target },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil, multisample: ms,
    });
    const dyn = mod(dynamicSrc);
    this.dynPipe = device.createRenderPipeline({
      layout: "auto",
      vertex: {
        module: dyn, entryPoint: "vs_main",
        buffers: [
          { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] },
          { arrayStride: 4, attributes: [{ shaderLocation: 1, offset: 0, format: "uint32" }] },
        ],
      },
      fragment: { module: dyn, entryPoint: "fs_main", targets: target },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil, multisample: ms,
    });
    const bg = mod(backgroundSrc);
    this.bgPipe = device.createRenderPipeline({
      layout: "auto",
      vertex: { module: bg, entryPoint: "vs_main" },
      fragment: { module: bg, entryPoint: "fs_main", targets: target },
      depthStencil: { format: "depth32float", depthWriteEnabled: false, depthCompare: "always" },
      multisample: ms,
    });
    for (const p of [this.rigidPipe, this.dynPipe, this.bgPipe]) {
      this.frameBind.set(p, device.createBindGroup({
        layout: p.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: this.frameBuf } }],
      }));
    }
  }

  static async create(canvas: HTMLCanvasElement): Promise<Renderer> {
    if (!navigator.gpu) throw new Error("WebGPU is not available in this browser");
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) throw new Error("no WebGPU adapter (is hardware acceleration on?)");
    const device = await adapter.requestDevice();
    device.lost.then((i) => console.error("WebGPU device lost:", i.message));
    const context = canvas.getContext("webgpu");
    if (!context) throw new Error("could not get a WebGPU canvas context");
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: "opaque" });
    return new Renderer(device, context, format, canvas);
  }

  // -- scene --------------------------------------------------------------

  clear() {
    for (const o of this.objects.values()) destroy(o);
    this.objects.clear();
  }

  setScene(objects: SceneObject[]) {
    this.clear();
    for (const o of objects) {
      if (o.kind === "rigid_mesh") this.objects.set(o.name, this.makeRigid(o));
      else if (o.kind === "boxes" || o.kind === "points") {
        const d: DynGpu = { kind: "dyn", obj: o, indexCount: 0, capacity: [0, 0] };
        this.objects.set(o.name, d);
        this.rebuildDyn(d);
      }
    }
  }

  private makeRigid(o: SceneObject): RigidGpu {
    const dev = this.device;
    const a = o.arrays;
    const instances: number = o.attrs.instances;
    const bodies = a.body_triangle_offsets.data.length - 1;
    const buf = (data: ArrayBufferView, usage: number) => {
      // Every array here is 4-byte elements, so byteLength is a multiple of 4.
      const b = dev.createBuffer({ size: Math.max(16, align4(data.byteLength)), usage: usage | GPUBufferUsage.COPY_DST });
      dev.queue.writeBuffer(b, 0, data.buffer, data.byteOffset, data.byteLength);
      return b;
    };
    const pos = buf(a.local_vertices.data, GPUBufferUsage.VERTEX);
    const body = buf(new Uint32Array(a.vertex_body.data), GPUBufferUsage.VERTEX);
    const index = buf(a.triangles.data, GPUBufferUsage.INDEX);
    const segs = instances * bodies;
    const poses = dev.createBuffer({ size: segs * 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const scratch = new Float32Array(segs * 8);
    for (let s = 0; s < segs; s++) scratch[s * 8 + 7] = 1; // identity rotations
    dev.queue.writeBuffer(poses, 0, scratch);
    const colors = dev.createBuffer({ size: Math.max(16, segs * 4), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const offsets = new Float32Array(instances * 4);
    for (let k = 0; k < instances; k++)
      for (let i = 0; i < 3; i++) offsets[k * 4 + i] = a.offsets.data[k * 3 + i];
    const offBuf = buf(offsets, GPUBufferUsage.STORAGE);
    const params = buf(new Uint32Array([bodies, 0, 0, 0]), GPUBufferUsage.UNIFORM);
    const bind = dev.createBindGroup({
      layout: this.rigidPipe.getBindGroupLayout(1),
      entries: [
        { binding: 0, resource: { buffer: params } },
        { binding: 1, resource: { buffer: poses } },
        { binding: 2, resource: { buffer: colors } },
        { binding: 3, resource: { buffer: offBuf } },
      ],
    });
    const g: RigidGpu = {
      kind: "rigid", instances, bodies, indexCount: a.triangles.data.length,
      pos, body, index, poses, colors, offsets, bind, poseScratch: scratch,
    };
    this.setSegmentColors(g, a.segment_colors, a.segment_visible);
    return g;
  }

  private setSegmentColors(g: RigidGpu, colors: Arr, visible?: Arr) {
    const segs = g.instances * g.bodies;
    const packed = new Uint32Array(segs);
    for (let s = 0; s < segs; s++) {
      const vis = visible ? visible.data[s] !== 0 : true;
      packed[s] = packColor(colors.data[3 * s], colors.data[3 * s + 1], colors.data[3 * s + 2], vis ? 1 : 0);
    }
    this.device.queue.writeBuffer(g.colors, 0, packed);
  }

  // Dynamic state of one frame: {object: {field: array}}.
  applyFrame(objects: Record<string, Record<string, Arr>>) {
    for (const [name, fields] of Object.entries(objects)) {
      const g = this.objects.get(name);
      if (!g) continue;
      if (g.kind === "rigid") {
        const p = fields.poses;
        if (!p) continue;
        const n = g.instances * g.bodies;
        const s = g.poseScratch;
        for (let i = 0; i < n; i++) {
          for (let k = 0; k < 3; k++) s[8 * i + k] = p.data[7 * i + k];
          for (let k = 0; k < 4; k++) s[8 * i + 4 + k] = p.data[7 * i + 3 + k];
        }
        this.device.queue.writeBuffer(g.poses, 0, s);
      } else {
        Object.assign(g.obj.arrays, fields);
        this.rebuildDyn(g);
      }
    }
  }

  private rebuildDyn(d: DynGpu) {
    const o = d.obj;
    let lo: ArrayLike<number>, hi: ArrayLike<number>, n: number;
    if (o.kind === "boxes") {
      lo = o.arrays.lo.data; hi = o.arrays.hi.data; n = lo.length / 3;
    } else {
      const p = o.arrays.points.data;
      const r = o.arrays.radii?.data;
      n = p.length / 3;
      const l = new Float32Array(p.length), h = new Float32Array(p.length);
      for (let i = 0; i < n; i++)
        for (let k = 0; k < 3; k++) {
          const rad = r ? r[i] : o.attrs.radius;
          l[3 * i + k] = p[3 * i + k] - rad; h[3 * i + k] = p[3 * i + k] + rad;
        }
      lo = l; hi = h;
    }
    const pos = new Float32Array(n * 24);
    const col = new Uint32Array(n * 8);
    const idx = new Uint32Array(n * 36);
    const cols = o.arrays.colors?.data;
    const base = o.attrs.color as number[];
    for (let b = 0; b < n; b++) {
      const c = cols ? packColor(cols[3 * b], cols[3 * b + 1], cols[3 * b + 2])
        : packColor(base[0], base[1], base[2]);
      for (let v = 0; v < 8; v++) {
        for (let k = 0; k < 3; k++)
          pos[b * 24 + v * 3 + k] = lo[3 * b + k] + BOX_CORNERS[v * 3 + k] * (hi[3 * b + k] - lo[3 * b + k]);
        col[b * 8 + v] = c;
      }
      for (let t = 0; t < 36; t++) idx[b * 36 + t] = BOX_TRIS[t] + 8 * b;
    }
    const dev = this.device;
    if (d.capacity[0] < pos.byteLength || !d.pos) {
      destroy(d);
      const size = Math.max(64, pos.byteLength);
      d.pos = dev.createBuffer({ size, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      d.color = dev.createBuffer({ size: Math.max(64, col.byteLength), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      d.index = dev.createBuffer({ size: Math.max(64, idx.byteLength), usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
      d.capacity = [size, 0];
    }
    dev.queue.writeBuffer(d.pos!, 0, pos);
    dev.queue.writeBuffer(d.color!, 0, col);
    dev.queue.writeBuffer(d.index!, 0, idx);
    d.indexCount = idx.length;
  }

  // -- drawing ------------------------------------------------------------

  private ensureTargets() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (w === this.size[0] && h === this.size[1] && this.color) return;
    this.canvas.width = w;
    this.canvas.height = h;
    this.size = [w, h];
    this.color?.destroy();
    this.depth?.destroy();
    this.color = this.device.createTexture({
      size: [w, h], format: this.format, sampleCount: SAMPLES,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.depth = this.device.createTexture({
      size: [w, h], format: "depth32float", sampleCount: SAMPLES,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  private writeFrame() {
    const [w, h] = this.size;
    const f = this.frame;
    const view = this.camera.view();
    const proj = this.camera.proj(w / h);
    const vp = mul(proj, view);
    f.set(view, F.view);
    f.set(proj, F.proj);
    f.set(vp, F.viewProj);
    f.set(invert(vp), F.invViewProj);
    f.set(invert(proj), F.invProj);
    f.set(invert(view), F.invView);
    const eye = this.camera.eye();
    f.set([eye[0], eye[1], eye[2], 0], F.cameraPos);
    f.set([w, h, 1 / w, 1 / h], F.viewport);
    f.set([0.25, -0.35, 1.0, 0.0], F.sunDir);
    const lin = (r: number, g: number, b: number) => [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b), 1];
    f.set(this.dark ? lin(0.235, 0.243, 0.259) : lin(0.965, 0.969, 0.976), F.bgTop);
    f.set(this.dark ? lin(0.114, 0.118, 0.129) : lin(0.82, 0.835, 0.859), F.bgBottom);
    f.set([0.0, 1.0, 0.0, 0.0], F.style); // no AO, exposure 1, no shadows
    f.set([0.35, 0.35, 0.38, 0.0], F.style2); // Studio: specular, wrap, ambient
    this.device.queue.writeBuffer(this.frameBuf, 0, f);
  }

  render() {
    this.ensureTargets();
    this.writeFrame();
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{
        view: this.color!.createView(),
        resolveTarget: this.context.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "discard",
      }],
      depthStencilAttachment: {
        view: this.depth!.createView(), depthClearValue: 0, depthLoadOp: "clear",
        depthStoreOp: "discard",
      },
    });
    pass.setPipeline(this.bgPipe);
    pass.setBindGroup(0, this.frameBind.get(this.bgPipe)!);
    pass.draw(3);
    for (const g of this.objects.values()) {
      if (g.kind === "rigid") {
        pass.setPipeline(this.rigidPipe);
        pass.setBindGroup(0, this.frameBind.get(this.rigidPipe)!);
        pass.setBindGroup(1, g.bind);
        pass.setVertexBuffer(0, g.pos);
        pass.setVertexBuffer(1, g.body);
        pass.setIndexBuffer(g.index, "uint32");
        pass.drawIndexed(g.indexCount, g.instances);
      } else if (g.indexCount > 0) {
        pass.setPipeline(this.dynPipe);
        pass.setBindGroup(0, this.frameBind.get(this.dynPipe)!);
        pass.setVertexBuffer(0, g.pos!);
        pass.setVertexBuffer(1, g.color!);
        pass.setIndexBuffer(g.index!, "uint32");
        pass.drawIndexed(g.indexCount);
      }
    }
    pass.end();
    this.device.queue.submit([enc.finish()]);
  }
}

function align4(n: number) {
  return (n + 3) & ~3;
}

function destroy(o: RigidGpu | DynGpu) {
  if (o.kind === "rigid") {
    for (const b of [o.pos, o.body, o.index, o.poses, o.colors]) b.destroy();
  } else {
    o.pos?.destroy(); o.color?.destroy(); o.index?.destroy();
    o.pos = o.color = o.index = undefined;
  }
}
