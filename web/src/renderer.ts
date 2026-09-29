// WebGPU renderer of the web client, a port of the native viewer's
// src/avbd_viz/renderer.cpp for the scenes the web streams (rigid meshes,
// boxes, labels), dark theme, solid shading in any of its four styles or
// wireframe shading (see-through wires, X-ray):
//
//   1. sun shadow map                      5. see-through meshes: weighted
//   2. prepass: depth, normals, ids (+ ground)  blended OIT against the opaque depth
//   3. SSAO + blur                         6. composite: background, tone map,
//   4. main color pass (4x MSAA, HDR):        outlines, sRGB -> canvas
//      opaque meshes, then the grid        7. overlay lines (slice outline), text
//
// The bind-group layouts mirror renderer.cpp's (frame, scene, ssao, blur,
// composite, lines, text), so the native ssao / grid / composite /
// overlay_lines / overlay_text / env_prefilter shaders and the style files
// run unchanged; only the geometry shaders are web-specific
// (shaders/rigid.wgsl: body-local vertices + per-segment poses; dynamic.wgsl:
// CPU-built boxes; both pull triangles like the native mesh.wgsl and share
// its fragment stages in surface.wgsl). Display options (DisplaySettings,
// per-object ObjectDisplay) mirror RenderSettings and the structures'
// opacity / sliced / metallic / roughness. Selection flags (selected /
// active faces and bodies, hidden bodies) and the extra overlay lines and
// labels come from the viewer (interaction.ts); element numbering is the
// native viewer's (geometry.ts).
import rigidStudio from "./shaders/rigid.wgsl?style=studio";
import rigidMatcap from "./shaders/rigid.wgsl?style=matcap";
import rigidPbr from "./shaders/rigid.wgsl?style=pbr";
import rigidTechnical from "./shaders/rigid.wgsl?style=technical";
import dynStudio from "./shaders/dynamic.wgsl?style=studio";
import dynMatcap from "./shaders/dynamic.wgsl?style=matcap";
import dynPbr from "./shaders/dynamic.wgsl?style=pbr";
import dynTechnical from "./shaders/dynamic.wgsl?style=technical";
import ssaoSrc from "./shaders/native_ssao.wgsl";
import gridSrc from "./shaders/native_grid.wgsl";
import compositeSrc from "./shaders/native_composite.wgsl";
import linesSrc from "./shaders/native_lines.wgsl";
import textSrc from "./shaders/native_text.wgsl";
import { type Arr } from "./protocol";
import { Camera, invert, lookAt, mul, type Vec3 } from "./math";
import { BoxGeo, type Geo, PointsGeoImpl, RigidGeo } from "./geometry";
import { type ElementRef, GROUND_ID, type IdPixel, PickMode } from "./selection";
import { formatLength, GLYPH_FLOATS, type FontInfo, type Label, loadFont, niceStep, pyFormat, TextLayout } from "./text";
import { buildEnvironment, type GpuEnvironment, makeEnvironment, makeMatcap } from "./environment";

// Float offsets into the Frame uniform (shaders/common/frame.wgsl).
const F = {
  view: 0, proj: 16, viewProj: 32, invViewProj: 48, invProj: 64, invView: 80, lightViewProj: 96,
  cameraPos: 112, viewport: 116, sunDir: 120, bgTop: 124, bgBottom: 128, gridMinor: 132,
  gridMajor: 136, gridParams: 140, gridPlane: 144, axisU: 148, axisV: 152, wire: 156,
  wireMode: 160, select: 164, active: 168, outline: 172, style: 176, style2: 180, env: 184,
  ao: 188, post: 192, slice: 196, sh: 200, size: 236,
};
const SAMPLES = 4;
const SHADOW_SIZE = 2048;
const HDR: GPUTextureFormat = "rgba16float";
const DEPTH: GPUTextureFormat = "depth32float";

export type StyleName = "studio" | "matcap" | "pbr" | "technical";
export const STYLES: [StyleName, string][] = [
  ["studio", "Studio"], ["matcap", "MatCap"], ["pbr", "Environment PBR"], ["technical", "Technical"],
];
const SOURCES: Record<StyleName, [string, string]> = {
  studio: [rigidStudio, dynStudio], matcap: [rigidMatcap, dynMatcap],
  pbr: [rigidPbr, dynPbr], technical: [rigidTechnical, dynTechnical],
};

// RenderSettings (renderer.h), the parts the web viewer uses.
export interface DisplaySettings {
  shading: "solid" | "wireframe";
  style: StyleName; // solid shading look
  wireframe: boolean; // edge overlay on solid shading
  wireWidth: number; // px
  flatEdgeAngle: number; // hide edges between faces closer than this (deg); 0 = all edges
  wireObjectColors: boolean; // wireframe shading: wires take the object's colors
  faceOpacity: number; // wireframe shading: faint face fill (Blender's X-ray alpha)
  shadows: boolean; shadowStrength: number;
  ssao: boolean; aoStrength: number; aoRadius: number;
  outline: number; outlineWidth: number; // 0 off, 1 silhouettes, 2 + creases
  exposure: number;
  grid: boolean; groundShadow: boolean;
  studioSpecular: number; studioWrap: number; studioAmbient: number;
  matcap: number; matcapTint: number;
  environment: number; envIntensity: number; envRotation: number; // degrees
  goochShift: number; goochContrast: number;
  slice: { enabled: boolean; axis: number; offset: number; flip: boolean; show: boolean };
}

export function defaultSettings(): DisplaySettings {
  return {
    shading: "solid", style: "studio", wireframe: false, wireWidth: 1, flatEdgeAngle: 0,
    wireObjectColors: false, faceOpacity: 0, shadows: true, shadowStrength: 0.6, ssao: true, aoStrength: 0.8, aoRadius: 0.35,
    outline: 1, outlineWidth: 1, exposure: 1, grid: true, groundShadow: true,
    studioSpecular: 0.35, studioWrap: 0.35, studioAmbient: 0.38, matcap: 0, matcapTint: 1,
    environment: 0, envIntensity: 1, envRotation: 0, goochShift: 1, goochContrast: 0.8,
    slice: { enabled: false, axis: 0, offset: 0, flip: false, show: true },
  };
}

// RenderSettings::apply_style_defaults: the toggles each style looks best with.
export function applyStyleDefaults(s: DisplaySettings, style: StyleName) {
  s.style = style;
  const d = { studio: [0.8, 1], matcap: [0.6, 0], pbr: [0.7, 0], technical: [0.45, 2] }[style];
  s.ssao = true;
  s.aoStrength = d[0];
  s.shadows = true;
  s.outline = d[1];
}

// Per-object display (Structure::opacity / sliced, QuantityStructure::metallic / roughness).
export interface ObjectDisplay { opacity: number; sliced: boolean; metallic: number; roughness: number }
const defaultDisplay = (): ObjectDisplay => ({ opacity: 1, sliced: true, metallic: 0, roughness: 0.45 });

const SUN_DIR: Vec3 = [0.25, -0.35, 1.0];
export const GROUND = 0;

const srgbToLinear = (c: number) =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
const lin = (r: number, g: number, b: number, a = 1) => [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b), a];

export function packColor(r: number, g: number, b: number, a = 1): number {
  const q = (x: number) => Math.max(0, Math.min(255, Math.round(x * 255)));
  return (q(r) | (q(g) << 8) | (q(b) << 16) | (q(a) << 24)) >>> 0;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SceneObject = { kind: string; name: string; attrs: any; arrays: Record<string, Arr> };

// Where the grid is drawn (renderer.cpp grid_plane): normally the ground; in
// an axis-aligned orthographic side view, the view plane through the origin,
// behind everything (Blender behavior): YZ looking along X, XZ along Y.
export interface GridPlane { normal: number; u: number; v: number; offset: number; background: boolean }

export function gridPlane(cam: Camera): GridPlane {
  const axis = cam.alignedAxis();
  if (cam.ortho && (axis === 0 || axis === 1)) return { normal: axis, u: axis === 0 ? 1 : 0, v: 2, offset: 0, background: true };
  return { normal: 2, u: 0, v: 1, offset: GROUND, background: false };
}

// Selection flags of one object (Renderer::sync's MeshSelection).
interface ObjectSelection { faces: number[]; segments: number[]; activeFace: number; activeSegment: number }

interface RigidGpu {
  kind: "rigid";
  id: number;
  geo: RigidGeo;
  buffers: GPUBuffer[];
  params: GPUBuffer;
  poses: GPUBuffer;
  segments: GPUBuffer;
  faceInfo: GPUBuffer;
  bind: GPUBindGroup;
  poseScratch: Float32Array;
  poseVersion: number;
  baseColors: Uint32Array; // packed, as sent
  flagsKey: string;
}

interface DynGpu {
  kind: "dyn";
  id: number;
  obj: SceneObject;
  geo: BoxGeo; // what is drawn (boxes, or a box per point)
  points: PointsGeoImpl | null; // what is picked for a point cloud
  params: GPUBuffer;
  segments: GPUBuffer;
  bind: GPUBindGroup | null;
  pos?: GPUBuffer;
  color?: GPUBuffer;
  tris?: GPUBuffer;
  faceInfo?: GPUBuffer;
  faces: number;
  capacity: number; // boxes
  flagsKey: string;
  version: number;
}

interface LabelSet {
  kind: "labels";
  obj: SceneObject;
  values: Float32Array | null;
}

type Gpu = RigidGpu | DynGpu | LabelSet;
type Geometry = RigidGpu | DynGpu;

const VF = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
const PARAMS_SIZE = 32; // Params in rigid.wgsl / dynamic.wgsl

// Extra overlay items drawn this frame (Overlay in overlay.h): line items
// (OverlayLine, 16 floats each) and labels.
export interface Overlay { lines: number[]; labels: Label[] }

export class Renderer {
  camera = new Camera();
  settings = defaultSettings();
  // Per scene object, by name (kept across scenes, like a viewer's settings).
  display = new Map<string, ObjectDisplay>();
  overlay: Overlay = { lines: [], labels: [] };
  private frame = new Float32Array(F.size);
  private frameBuf: GPUBuffer;
  private objects: Map<string, Gpu> = new Map();
  private nextId = 1;
  private size: [number, number] = [0, 0];
  private layouts: Record<string, GPUBindGroupLayout> = {};
  private pipes: Record<string, GPURenderPipeline> = {};
  private builtStyle: StyleName | null = null;
  private samplers: Record<string, GPUSampler> = {};
  private t: Record<string, GPUTexture> = {};
  private groups: Record<string, GPUBindGroup> = {};
  private dummy: GPUTextureView;
  private shadowView: GPUTextureView;
  private fontView: GPUTextureView;
  private matcapTex: GPUTexture;
  private matcapBuilt = -1;
  private env: GpuEnvironment | null = null;
  private envBuilt = -1;
  private text: TextLayout;
  private glyphBuf!: GPUBuffer;
  private glyphCap = 0;
  private glyphGroup!: GPUBindGroup;
  private lineBuf!: GPUBuffer;
  private lineCap = 0;
  private lineGroup!: GPUBindGroup;
  private isolated = -1;
  private selection = new Map<number, ObjectSelection>();
  private selectionVersion = 0;
  private hiddenVersion = 0;

  private constructor(
    private device: GPUDevice,
    private context: GPUCanvasContext,
    format: GPUTextureFormat,
    private canvas: HTMLCanvasElement,
    font: { info: FontInfo; image: ImageBitmap },
  ) {
    const dev = device;
    this.frameBuf = dev.createBuffer({ size: F.size * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    // -- bind-group layouts (renderer.cpp's make_layout calls) --
    const L = (entries: GPUBindGroupLayoutEntry[]) => dev.createBindGroupLayout({ entries });
    const ubo = (b: number): GPUBindGroupLayoutEntry => ({ binding: b, visibility: VF, buffer: { type: "uniform" } });
    const ro = (b: number, visibility = VF): GPUBindGroupLayoutEntry => ({ binding: b, visibility, buffer: { type: "read-only-storage" } });
    const vro = (b: number) => ro(b, GPUShaderStage.VERTEX);
    const tex = (b: number, sampleType: GPUTextureSampleType = "float"): GPUBindGroupLayoutEntry =>
      ({ binding: b, visibility: VF, texture: { sampleType } });
    const smp = (b: number, type: GPUSamplerBindingType = "filtering"): GPUBindGroupLayoutEntry =>
      ({ binding: b, visibility: VF, sampler: { type } });
    this.layouts = {
      frame: L([ubo(0)]),
      scene: L([ubo(0), smp(1), tex(2), tex(3), tex(4), tex(5, "depth"), smp(6, "comparison"), tex(7), smp(8)]),
      rigid: L([ubo(0), vro(1), vro(2), vro(3), vro(4), vro(5), vro(6), vro(7)]),
      dyn: L([ubo(0), vro(1), vro(2), vro(3), vro(4), vro(5)]),
      ssao: L([ubo(0), tex(1, "depth"), tex(2, "unfilterable-float")]),
      blur: L([ubo(0), tex(1, "depth"), tex(3, "unfilterable-float")]),
      composite: L([ubo(0), tex(1, "unfilterable-float"), tex(2, "uint"), tex(3, "depth"),
        tex(4, "unfilterable-float"), tex(5, "unfilterable-float"), tex(6, "unfilterable-float")]),
      lines: L([ubo(0), tex(1, "depth")]),
      text: L([ubo(0), tex(1, "depth"), tex(2), smp(3)]),
      storage: L([ro(0)]),
    };

    // -- samplers, fixed textures --
    this.samplers.clamp = dev.createSampler({ magFilter: "linear", minFilter: "linear", mipmapFilter: "linear" });
    this.samplers.repeat = dev.createSampler({ magFilter: "linear", minFilter: "linear", mipmapFilter: "linear", addressModeU: "repeat" });
    this.samplers.shadow = dev.createSampler({ magFilter: "linear", minFilter: "linear", compare: "less-equal" });
    const white = dev.createTexture({ size: [1, 1], format: "rgba8unorm", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    dev.queue.writeTexture({ texture: white }, new Uint8Array([255, 255, 255, 255]), { bytesPerRow: 4 }, [1, 1]);
    this.dummy = white.createView(); // colormaps (no quantities on the web), environment until built
    this.matcapTex = dev.createTexture({
      size: [256, 256], format: "rgba8unorm-srgb", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    const shadow = dev.createTexture({
      size: [SHADOW_SIZE, SHADOW_SIZE], format: DEPTH,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.t.shadow = shadow;
    this.shadowView = shadow.createView();
    const fontTex = dev.createTexture({
      size: [font.info.width, font.info.height], format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    dev.queue.copyExternalImageToTexture({ source: font.image }, { texture: fontTex }, [font.info.width, font.info.height]);
    this.fontView = fontTex.createView();
    this.text = new TextLayout(font.info);
    this.glyphBuf = this.storageBuffer("glyph", 256);
    this.lineBuf = this.storageBuffer("line", 16);

    // -- style-independent pipelines --
    const mod = (code: string) => dev.createShaderModule({ code });
    const grid = mod(gridSrc), ssao = mod(ssaoSrc), comp = mod(compositeSrc), lines = mod(linesSrc), text = mod(textSrc);
    const premult = this.premult;
    const full = (m: GPUShaderModule, entry: string, l: GPUBindGroupLayout[], targets: GPUColorTargetState[],
      extra: Partial<GPURenderPipelineDescriptor> = {}) => dev.createRenderPipeline({
      layout: this.pipelineLayout(...l), primitive: { topology: "triangle-list" },
      vertex: { module: m, entryPoint: "vs_fullscreen" },
      fragment: { module: m, entryPoint: entry, targets }, ...extra,
    });
    const overlay = (m: GPUShaderModule, l: GPUBindGroupLayout) => dev.createRenderPipeline({
      layout: this.pipelineLayout(l, this.layouts.storage), primitive: { topology: "triangle-list" },
      vertex: { module: m, entryPoint: "vs_main" },
      fragment: { module: m, entryPoint: "fs_main", targets: [{ format, blend: premult }] },
    });
    Object.assign(this.pipes, {
      gridMain: full(grid, "fs_main", [this.layouts.scene], [{ format: HDR, blend: premult }],
        { depthStencil: this.depthGreater(false), multisample: { count: SAMPLES } }),
      gridPre: full(grid, "fs_prepass", [this.layouts.scene], this.prepassTargets, { depthStencil: this.depthGreater() }),
      ssao: full(ssao, "fs_ssao", [this.layouts.ssao], [{ format: "r8unorm" }]),
      blur: full(ssao, "fs_blur", [this.layouts.blur], [{ format: "r8unorm" }]),
      composite: full(comp, "fs_composite", [this.layouts.composite], [{ format }]),
      lines: overlay(lines, this.layouts.lines),
      text: overlay(text, this.layouts.text),
    });
    this.buildStylePipelines("studio");
    this.groups.frame = dev.createBindGroup({
      layout: this.layouts.frame, entries: [{ binding: 0, resource: { buffer: this.frameBuf } }],
    });
  }

  private premult: GPUBlendState = {
    color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
    alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
  };
  private prepassTargets: GPUColorTargetState[] = [{ format: HDR }, { format: "rgba32uint" }];
  private depthGreater = (write = true): GPUDepthStencilState => ({ format: DEPTH, depthWriteEnabled: write, depthCompare: "greater" });
  private pipelineLayout = (...ls: GPUBindGroupLayout[]) => this.device.createPipelineLayout({ bindGroupLayouts: ls });

  // The geometry pipelines of one style (the style file is compiled in).
  private buildStylePipelines(style: StyleName) {
    const dev = this.device;
    const [rigidSrc, dynSrc] = SOURCES[style];
    const tri: GPUPrimitiveState = { topology: "triangle-list", cullMode: "none" };
    const oit: GPUColorTargetState[] = [
      { format: HDR, blend: { color: { srcFactor: "one", dstFactor: "one" }, alpha: { srcFactor: "one", dstFactor: "one" } } },
      { format: "r16float", blend: { color: { srcFactor: "zero", dstFactor: "one-minus-src" }, alpha: { srcFactor: "zero", dstFactor: "one-minus-src" } } },
    ];
    for (const [name, src, objLayout] of [["rigid", rigidSrc, this.layouts.rigid], ["dyn", dynSrc, this.layouts.dyn]] as const) {
      const m = dev.createShaderModule({ code: src });
      const vertex = { module: m, entryPoint: "vs_main" };
      const layout = this.pipelineLayout(this.layouts.scene, objLayout);
      this.pipes[`${name}Main`] = dev.createRenderPipeline({
        layout, primitive: tri, vertex, fragment: { module: m, entryPoint: "fs_main", targets: [{ format: HDR }] },
        depthStencil: this.depthGreater(), multisample: { count: SAMPLES },
      });
      this.pipes[`${name}Transparent`] = dev.createRenderPipeline({
        layout, primitive: tri, vertex, fragment: { module: m, entryPoint: "fs_transparent", targets: oit },
        depthStencil: this.depthGreater(false), multisample: { count: SAMPLES },
      });
      // Wireframe shading: premultiplied wires over everything, no depth test.
      this.pipes[`${name}Wire`] = dev.createRenderPipeline({
        layout, primitive: tri, vertex,
        fragment: { module: m, entryPoint: "fs_wire", targets: [{ format: HDR, blend: this.premult }] },
        depthStencil: { format: DEPTH, depthWriteEnabled: false, depthCompare: "always" }, multisample: { count: SAMPLES },
      });
      this.pipes[`${name}Pre`] = dev.createRenderPipeline({
        layout, primitive: tri, vertex, fragment: { module: m, entryPoint: "fs_prepass", targets: this.prepassTargets },
        depthStencil: this.depthGreater(),
      });
      this.pipes[`${name}Shadow`] = dev.createRenderPipeline({
        layout: this.pipelineLayout(this.layouts.frame, objLayout), primitive: tri,
        vertex: { module: m, entryPoint: "vs_shadow" },
        fragment: { module: m, entryPoint: "fs_shadow", targets: [] },
        depthStencil: { format: DEPTH, depthWriteEnabled: true, depthCompare: "less" },
      });
    }
    this.builtStyle = style;
  }

  static async create(canvas: HTMLCanvasElement): Promise<Renderer> {
    if (!navigator.gpu) throw new Error("WebGPU is not available in this browser");
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) throw new Error("no WebGPU adapter (is hardware acceleration on?)");
    const device = await adapter.requestDevice();
    device.lost.then((i) => console.error("WebGPU device lost:", i.message));
    device.addEventListener("uncapturederror", (e) => console.error("WebGPU:", (e as GPUUncapturedErrorEvent).error.message));
    const context = canvas.getContext("webgpu");
    if (!context) throw new Error("could not get a WebGPU canvas context");
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: "opaque" });
    const font = await loadFont(new URL(".", location.href).href);
    return new Renderer(device, context, format, canvas, font);
  }

  private storageBuffer(which: "glyph" | "line", count: number) {
    const floats = which === "glyph" ? GLYPH_FLOATS : 16;
    const b = this.device.createBuffer({ size: count * floats * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const group = this.device.createBindGroup({ layout: this.layouts.storage, entries: [{ binding: 0, resource: { buffer: b } }] });
    if (which === "glyph") {
      this.glyphBuf?.destroy();
      this.glyphCap = count;
      this.glyphGroup = group;
    } else {
      this.lineBuf?.destroy();
      this.lineCap = count;
      this.lineGroup = group;
    }
    return b;
  }

  private buffer(data: ArrayBufferView, usage = GPUBufferUsage.STORAGE) {
    const b = this.device.createBuffer({ size: Math.max(16, align4(data.byteLength)), usage: usage | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(b, 0, data.buffer, data.byteOffset, data.byteLength);
    return b;
  }

  // -- scene --------------------------------------------------------------

  clear() {
    for (const o of this.objects.values()) destroy(o);
    this.objects.clear();
    this.nextId = 1;
  }

  // Names of the drawn (display-able) objects, in scene order.
  objectNames(): { name: string; kind: string }[] {
    return [...this.objects].filter(([, o]) => o.kind !== "labels").map(([name, o]) => ({ name, kind: o.kind }));
  }

  // Pickable geometry, in scene order (ids as in the prepass).
  geometries(): Geo[] {
    const out: Geo[] = [];
    for (const o of this.objects.values())
      if (o.kind === "rigid") out.push(o.geo);
      else if (o.kind === "dyn") out.push(o.points ?? o.geo);
    return out;
  }

  displayOf(name: string): ObjectDisplay {
    let d = this.display.get(name);
    if (!d) this.display.set(name, (d = defaultDisplay()));
    return d;
  }

  setScene(objects: SceneObject[]) {
    this.clear();
    this.isolated = -1;
    this.selection.clear();
    for (const o of objects) {
      if (o.kind === "rigid_mesh") this.objects.set(o.name, this.makeRigid(o));
      else if (o.kind === "boxes" || o.kind === "points") {
        const id = this.nextId++;
        const params = this.device.createBuffer({ size: PARAMS_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        const d: DynGpu = {
          kind: "dyn", id, obj: o, params, geo: new BoxGeo(o.name, id),
          points: o.kind === "points" ? new PointsGeoImpl(o.name, id) : null,
          segments: this.device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
          bind: null, faces: 0, capacity: 0, flagsKey: "", version: 0,
        };
        this.objects.set(o.name, d);
        this.rebuildDyn(d);
      } else if (o.kind === "labels") {
        const v = o.arrays.values?.data;
        this.objects.set(o.name, { kind: "labels", obj: o, values: v ? Float32Array.from(v) : null });
      }
    }
  }

  // The rigid mesh's segment layout: instances (envs) and bodies each.
  rigidInfo(): { name: string; id: number; instances: number; bodies: number; offsets: Float32Array; geo: RigidGeo } | null {
    for (const [name, o] of this.objects)
      if (o.kind === "rigid")
        return { name, id: o.id, instances: o.geo.instances, bodies: o.geo.B, offsets: o.geo.offsets, geo: o.geo };
    return null;
  }

  private makeRigid(o: SceneObject): RigidGpu {
    const dev = this.device;
    const id = this.nextId++;
    const geo = new RigidGeo(o.name, id, o);
    const segs = geo.numSegments;
    const poses = dev.createBuffer({ size: Math.max(32, segs * 32), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const scratch = new Float32Array(segs * 8);
    for (let s = 0; s < segs; s++) scratch[s * 8 + 7] = 1; // identity rotations
    dev.queue.writeBuffer(poses, 0, scratch);
    const segments = dev.createBuffer({ size: Math.max(16, segs * 8), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const faceInfo = dev.createBuffer({ size: Math.max(16, geo.numFaces * 4), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const offBuf = this.buffer(geo.offsets);
    const local = this.buffer(geo.local);
    const vb = this.buffer(geo.vertexBody);
    const tris = this.buffer(geo.tris);
    const params = dev.createBuffer({ size: PARAMS_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const bind = dev.createBindGroup({
      layout: this.layouts.rigid,
      entries: [params, poses, segments, offBuf, local, vb, tris, faceInfo]
        .map((buffer, binding) => ({ binding, resource: { buffer } })),
    });
    const baseColors = new Uint32Array(segs);
    const c = o.arrays.segment_colors.data;
    for (let s = 0; s < segs; s++) baseColors[s] = packColor(c[3 * s], c[3 * s + 1], c[3 * s + 2]);
    const g: RigidGpu = {
      kind: "rigid", id, geo, buffers: [params, poses, segments, faceInfo, offBuf, local, vb, tris], params,
      poses, segments, faceInfo, bind, poseScratch: scratch, poseVersion: 0, baseColors, flagsKey: "",
    };
    if (o.arrays.poses) this.setPoses(g, o.arrays.poses);
    return g;
  }

  // Env shown alone (-1: all).
  setIsolated(env: number) {
    if (env === this.isolated) return;
    this.isolated = env;
    for (const o of this.objects.values()) {
      if (o.kind === "rigid") o.geo.isolated = env;
      else if (o.kind === "dyn") this.rebuildDyn(o);
    }
  }

  get isolatedEnv() {
    return this.isolated;
  }

  // Selected / active faces and bodies per object for the shaders (vertices
  // and edges are drawn as overlays).
  setSelection(mode: PickMode, items: readonly ElementRef[], active: ElementRef | null) {
    this.selection.clear();
    const of = (id: number) => {
      let s = this.selection.get(id);
      if (!s) this.selection.set(id, (s = { faces: [], segments: [], activeFace: -1, activeSegment: -1 }));
      return s;
    };
    for (const e of items) {
      if (mode === PickMode.Face) of(e.object).faces.push(e.index);
      if (mode === PickMode.Body) of(e.object).segments.push(e.index);
    }
    if (active && mode === PickMode.Face) of(active.object).activeFace = active.index;
    if (active && mode === PickMode.Body) of(active.object).activeSegment = active.index;
    this.selectionVersion++;
  }

  // Bodies hidden by the user (H) changed.
  hiddenChanged() {
    this.hiddenVersion++;
  }

  // Segment flags and per-face info of a rigid mesh (Renderer::sync).
  private writeRigidFlags(g: RigidGpu) {
    const geo = g.geo, angle = Math.max(this.settings.flatEdgeAngle, 0);
    const key = `${this.selectionVersion}/${this.hiddenVersion}/${this.isolated}/${angle}`;
    if (key === g.flagsKey) return;
    g.flagsKey = key;
    const sel = this.selection.get(g.id);
    const S = geo.numSegments;
    const segs = new Uint32Array(2 * S);
    for (let s = 0; s < S; s++) {
      segs[2 * s] = g.baseColors[s];
      segs[2 * s + 1] = geo.segmentVisible(s) ? 0 : 1;
    }
    for (const s of sel?.segments ?? []) if (s < S) segs[2 * s + 1] |= 2;
    if (sel && sel.activeSegment >= 0 && sel.activeSegment < S) segs[2 * sel.activeSegment + 1] |= 4;
    this.device.queue.writeBuffer(g.segments, 0, segs);
    const flat = geo.flatMask(angle), T = geo.T;
    const info = new Uint32Array(geo.numFaces);
    for (let k = 0; k < geo.instances; k++)
      for (let t = 0; t < T; t++) info[k * T + t] = flat[t] << 2;
    for (const f of sel?.faces ?? []) if (f < info.length) info[f] |= 1;
    if (sel && sel.activeFace >= 0 && sel.activeFace < info.length) info[sel.activeFace] |= 2;
    this.device.queue.writeBuffer(g.faceInfo, 0, info);
  }

  private setPoses(g: RigidGpu, p: Arr) {
    const n = g.geo.numSegments;
    const s = g.poseScratch;
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 3; k++) s[8 * i + k] = p.data[7 * i + k];
      for (let k = 0; k < 4; k++) s[8 * i + 4 + k] = p.data[7 * i + 3 + k];
    }
    this.device.queue.writeBuffer(g.poses, 0, s);
    g.geo.poses = Float32Array.from(p.data as ArrayLike<number>);
    g.poseVersion++;
  }

  // Dynamic state of one frame: {object: {field: array}}.
  applyFrame(objects: Record<string, Record<string, Arr>>) {
    for (const [name, fields] of Object.entries(objects)) {
      const g = this.objects.get(name);
      if (!g) continue;
      if (g.kind === "rigid") {
        if (fields.poses) this.setPoses(g, fields.poses);
        if (fields.segment_colors) {
          const c = fields.segment_colors.data;
          for (let s = 0; s < g.baseColors.length; s++) g.baseColors[s] = packColor(c[3 * s], c[3 * s + 1], c[3 * s + 2]);
          g.flagsKey = "";
        }
      } else if (g.kind === "labels") {
        if (fields.values) g.values = Float32Array.from(fields.values.data as ArrayLike<number>);
      } else {
        Object.assign(g.obj.arrays, fields);
        this.rebuildDyn(g);
      }
    }
  }

  // Env (display grid cell) a world point belongs to: the nearest instance offset.
  envOf(x: number, y: number): number {
    const r = this.rigidInfo();
    if (!r) return -1;
    let best = -1, bd = Infinity;
    for (let k = 0; k < r.instances; k++) {
      const d = (x - r.offsets[4 * k]) ** 2 + (y - r.offsets[4 * k + 1]) ** 2;
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  }

  // Boxes (or a box per point) of a dynamic object; boxes of envs not shown
  // stay (numbering as native) but are flagged hidden.
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
      const pts = d.points!;
      pts.points = Float32Array.from(p as ArrayLike<number>);
      pts.radii = r ? Float32Array.from(r as ArrayLike<number>) : null;
      pts.defaultRadius = o.attrs.radius;
    }
    const hidden = new Uint8Array(n);
    if (this.isolated >= 0)
      for (let b = 0; b < n; b++) {
        const cx = 0.5 * (lo[3 * b] + hi[3 * b]), cy = 0.5 * (lo[3 * b + 1] + hi[3 * b + 1]);
        hidden[b] = this.envOf(cx, cy) !== this.isolated ? 1 : 0;
      }
    d.geo.set(lo, hi, hidden);
    if (d.points) d.points.hidden = hidden;
    const col = new Uint32Array(n * 8);
    const cols = o.arrays.colors?.data;
    const base = o.attrs.color as number[];
    for (let b = 0; b < n; b++)
      col.fill(cols ? packColor(cols[3 * b], cols[3 * b + 1], cols[3 * b + 2]) : packColor(base[0], base[1], base[2]),
        8 * b, 8 * b + 8);
    const dev = this.device;
    if (d.capacity < n || !d.pos) {
      d.pos?.destroy(); d.color?.destroy(); d.tris?.destroy(); d.faceInfo?.destroy();
      const cap = Math.max(4, n);
      const mk = (bytes: number) => dev.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      d.pos = mk(cap * 96);
      d.color = mk(cap * 32);
      d.tris = mk(cap * 144);
      d.faceInfo = mk(cap * 48);
      d.capacity = cap;
      d.bind = dev.createBindGroup({
        layout: this.layouts.dyn,
        entries: [d.params, d.pos, d.color, d.tris, d.faceInfo, d.segments]
          .map((buffer, binding) => ({ binding, resource: { buffer } })),
      });
    }
    if (n) {
      dev.queue.writeBuffer(d.pos!, 0, d.geo.pos);
      dev.queue.writeBuffer(d.color!, 0, col);
      dev.queue.writeBuffer(d.tris!, 0, d.geo.tris);
    }
    d.faces = 12 * n;
    d.version++;
  }

  // Face info (flat edges, selection, hidden boxes) and the segment flags of
  // a dynamic object.
  private writeDynFlags(d: DynGpu) {
    const angle = Math.max(this.settings.flatEdgeAngle, 0);
    const key = `${this.selectionVersion}/${this.hiddenVersion}/${d.version}/${angle}`;
    if (key === d.flagsKey || !d.faceInfo) return;
    d.flagsKey = key;
    const sel = this.selection.get(d.id);
    const nf = d.faces;
    const info = new Uint32Array(Math.max(nf, 1));
    const flat = d.points ? null : d.geo.flatMask(angle);
    for (let f = 0; f < nf; f++) info[f] = (flat ? flat[f] << 2 : 0) | (d.geo.hidden[Math.floor(f / 12)] ? 32 : 0);
    if (!d.points) {
      for (const f of sel?.faces ?? []) if (f < nf) info[f] |= 1;
      if (sel && sel.activeFace >= 0 && sel.activeFace < nf) info[sel.activeFace] |= 2;
    }
    this.device.queue.writeBuffer(d.faceInfo, 0, info);
    const segFlags = (d.geo.userHidden ? 1 : 0) | (sel?.segments.includes(0) ? 2 : 0) | (sel?.activeSegment === 0 ? 4 : 0);
    this.device.queue.writeBuffer(d.segments, 0, new Uint32Array([0, segFlags, 0, 0]));
  }

  // -- targets and style resources ------------------------------------------

  private ensureTargets() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (w === this.size[0] && h === this.size[1] && this.t.resolved) return;
    this.canvas.width = w;
    this.canvas.height = h;
    this.size = [w, h];
    for (const k of Object.keys(this.t)) if (k !== "shadow") this.t[k].destroy();
    const RA = GPUTextureUsage.RENDER_ATTACHMENT, TB = GPUTextureUsage.TEXTURE_BINDING;
    const make = (name: string, format: GPUTextureFormat, usage: number, sampleCount = 1) =>
      (this.t[name] = this.device.createTexture({ size: [w, h], format, usage, sampleCount }));
    make("msaaColor", HDR, RA, SAMPLES);
    make("msaaDepth", DEPTH, RA, SAMPLES);
    make("resolved", HDR, RA | TB);
    make("oitAccumMsaa", HDR, RA, SAMPLES);
    make("oitRevealMsaa", "r16float", RA, SAMPLES);
    make("accum", HDR, RA | TB);
    make("reveal", "r16float", RA | TB);
    make("preDepth", DEPTH, RA | TB);
    make("preNormal", HDR, RA | TB);
    make("preIds", "rgba32uint", RA | TB | GPUTextureUsage.COPY_SRC);
    make("aoRaw", "r8unorm", RA | TB);
    make("ao", "r8unorm", RA | TB);
    const v = (n: string) => this.t[n].createView();
    const fb = { buffer: this.frameBuf };
    this.groups.ssao = this.group("ssao", [[0, fb], [1, v("preDepth")], [2, v("preNormal")]]);
    this.groups.blur = this.group("blur", [[0, fb], [1, v("preDepth")], [3, v("aoRaw")]]);
    this.groups.composite = this.group("composite", [[0, fb], [1, v("resolved")], [2, v("preIds")], [3, v("preDepth")],
      [4, v("preNormal")], [5, v("accum")], [6, v("reveal")]]);
    this.groups.lines = this.group("lines", [[0, fb], [1, v("preDepth")]]);
    this.groups.text = this.group("text", [[0, fb], [1, v("preDepth")], [2, this.fontView], [3, this.samplers.clamp]]);
    this.rebuildSceneGroup();
  }

  private group(layout: string, entries: [number, GPUBindingResource][]) {
    return this.device.createBindGroup({
      layout: this.layouts[layout], entries: entries.map(([binding, resource]) => ({ binding, resource })),
    });
  }

  private rebuildSceneGroup() {
    if (!this.t.ao) return;
    this.groups.scene = this.group("scene", [[0, { buffer: this.frameBuf }], [1, this.samplers.clamp], [2, this.dummy],
      [3, this.matcapTex.createView()], [4, this.env?.view ?? this.dummy], [5, this.shadowView],
      [6, this.samplers.shadow], [7, this.t.ao.createView()], [8, this.samplers.repeat]]);
  }

  // Style pipelines, matcap picture and environment for the current settings.
  private ensureStyle() {
    const s = this.settings;
    let rebind = false;
    if (this.builtStyle !== s.style) this.buildStylePipelines(s.style);
    if (s.style === "matcap" && this.matcapBuilt !== s.matcap) {
      this.device.queue.writeTexture({ texture: this.matcapTex }, makeMatcap(s.matcap, 256), { bytesPerRow: 1024 }, [256, 256]);
      this.matcapBuilt = s.matcap;
    }
    if (s.style === "pbr" && this.envBuilt !== s.environment) {
      this.env?.texture.destroy();
      this.env = buildEnvironment(this.device, makeEnvironment(s.environment));
      this.envBuilt = s.environment;
      rebind = true;
    }
    if (rebind) this.rebuildSceneGroup();
  }

  // -- frame uniforms -----------------------------------------------------

  // Exact world bounds of a rigid mesh's shown bodies (its vertices, posed),
  // cached until its poses or the shown bodies change.
  private rigidBounds = new WeakMap<RigidGpu, { key: string; lo: Vec3; hi: Vec3 }>();

  private boundsOf(o: RigidGpu): { lo: Vec3; hi: Vec3 } | null {
    const geo = o.geo;
    if (!geo.poses) return null;
    const key = `${o.poseVersion}/${this.isolated}/${this.hiddenVersion}`;
    const c = this.rigidBounds.get(o);
    if (c?.key === key) return c;
    const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < geo.numVertices; i++) {
      if (!geo.segmentVisible(geo.segmentOfVertex(i))) continue;
      const w = geo.vertex(i);
      for (let k = 0; k < 3; k++) {
        if (w[k] < lo[k]) lo[k] = w[k];
        if (w[k] > hi[k]) hi[k] = w[k];
      }
    }
    const out = { key, lo, hi };
    this.rigidBounds.set(o, out);
    return out;
  }

  // World bounds of everything drawn (Scene::bounds).
  bounds(): [Vec3, Vec3] | null {
    const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
    const add = (p: ArrayLike<number>, i = 0) => {
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], p[i + k]);
        hi[k] = Math.max(hi[k], p[i + k]);
      }
    };
    for (const o of this.objects.values()) {
      if (o.kind === "rigid") {
        const b = this.boundsOf(o);
        if (b && Number.isFinite(b.lo[0])) {
          add(b.lo);
          add(b.hi);
        }
      } else if (o.kind === "dyn") {
        const g = o.geo;
        if (!g.userHidden) for (let v = 0; v < g.numVertices; v++) if (!g.hidden[Math.floor(v / 8)]) add(g.pos, 3 * v);
      }
    }
    return Number.isFinite(lo[0]) ? [lo, hi] : null;
  }

  // SlicePlane::equation: (n, d), points with dot(n, x) > d are cut away.
  private sliceEquation(): number[] {
    const sl = this.settings.slice;
    const n = [0, 0, 0];
    n[sl.axis] = sl.flip ? -1 : 1;
    return [...n, sl.flip ? -sl.offset : sl.offset];
  }

  private get wireMode() {
    return this.settings.shading === "wireframe";
  }

  private writeFrame() {
    const [w, h] = this.size;
    const S = this.settings;
    const f = this.frame;
    const cam = this.camera;
    const view = cam.view();
    const proj = cam.proj(w / h);
    const vp = mul(proj, view);
    f.set(view, F.view);
    f.set(proj, F.proj);
    f.set(vp, F.viewProj);
    f.set(invert(vp), F.invViewProj);
    f.set(invert(proj), F.invProj);
    f.set(invert(view), F.invView);
    const eye = cam.eye();
    f.set([eye[0], eye[1], eye[2], cam.ortho ? 1 : 0], F.cameraPos);
    f.set([w, h, 1 / w, 1 / h], F.viewport);

    // Sun shadow: orthographic box around everything visible and the ground below.
    const pbr = S.style === "pbr" && this.env;
    const sd = pbr ? this.env!.sunDir : SUN_DIR;
    const l = Math.hypot(...sd);
    const sun: Vec3 = [sd[0] / l, sd[1] / l, sd[2] / l];
    const b = this.bounds() ?? [[...cam.target] as Vec3, [...cam.target] as Vec3];
    const lo = b[0], hi = b[1];
    lo[2] = Math.min(lo[2], GROUND);
    const c: Vec3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
    const r = 0.5 * Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) * 1.05 + 0.05;
    const up: Vec3 = Math.abs(sun[2]) > 0.99 ? [0, 1, 0] : [0, 0, 1];
    const lv = lookAt([c[0] + sun[0] * 2 * r, c[1] + sun[1] * 2 * r, c[2] + sun[2] * 2 * r], c, up);
    f.set(mul(orthoZO(-r, r, -r, r, 0, 4 * r), lv), F.lightViewProj);
    f.set([sun[0], sun[1], sun[2], S.shadowStrength], F.sunDir);

    // Dark theme (Renderer::fill_frame).
    const wire = this.wireMode;
    const gp = gridPlane(cam);
    f.set(lin(0.235, 0.243, 0.259), F.bgTop);
    f.set(lin(0.114, 0.118, 0.129), F.bgBottom);
    f.set(lin(0.62, 0.64, 0.68, 0.2), F.gridMinor);
    f.set(lin(0.74, 0.76, 0.8, 0.42), F.gridMajor);
    f.set([gp.offset, Math.max(cam.distance * 12, 8), S.grid ? 1 : 0, S.groundShadow && !wire ? 1 : 0], F.gridParams);
    f.set([gp.normal, gp.background ? 1 : 0, gp.u, gp.v], F.gridPlane);
    const axisColors = [lin(0.92, 0.26, 0.34, 0.85), lin(0.52, 0.8, 0.2, 0.85), lin(0.24, 0.52, 0.96, 0.85)];
    f.set(axisColors[gp.u], F.axisU);
    f.set(axisColors[gp.v], F.axisV);
    // Wires: dark over shaded surfaces; in wireframe shading they contrast with
    // the background instead.
    if (wire) f.set([...lin(0.7, 0.72, 0.76).slice(0, 3), Math.max(S.wireWidth, 1)], F.wire);
    else f.set([...lin(0.05, 0.05, 0.06).slice(0, 3), S.wireframe ? S.wireWidth : 0], F.wire);
    f.set([wire ? 1 : 0, S.faceOpacity, S.wireObjectColors ? 1 : 0, 0], F.wireMode);
    f.set(lin(1, 0.63, 0.2), F.select);
    f.set(lin(1, 0.88, 0.62), F.active);
    f.set(lin(0.02, 0.02, 0.025, 0.85), F.outline);
    // Wireframe shading has no surfaces to shadow, occlude or outline.
    f.set([S.ssao && !wire ? S.aoStrength : 0, S.exposure, S.shadows && !wire ? 1 : 0, wire ? 0 : S.outline], F.style);
    const style2 = { studio: [S.studioSpecular, S.studioWrap, S.studioAmbient, 0], matcap: [S.matcapTint, 0, 0, 0],
      pbr: [0, 0, 0, 0], technical: [S.goochShift, S.goochContrast, 0, 0] }[S.style];
    f.set(style2, F.style2);
    f.set([(S.envRotation * Math.PI) / 180, S.envIntensity, (this.env?.mips ?? 1) - 1, 0], F.env);
    f.set([S.aoRadius, 0.02, 1, 0], F.ao);
    f.set([S.style === "pbr" ? 1 : 0, S.outlineWidth, 0, 0], F.post);
    f.set(this.sliceEquation(), F.slice);
    f.set(this.env ? this.env.sh : new Float32Array(36), F.sh);
    this.device.queue.writeBuffer(this.frameBuf, 0, f);
  }

  // Per-object uniforms (flags: cut by the slice plane; material) and the
  // selection / hidden flags.
  private writeObjectParams() {
    const cut = this.settings.slice.enabled;
    for (const [name, o] of this.objects) {
      if (o.kind === "labels") continue;
      const d = this.displayOf(name);
      const flags = cut && d.sliced ? 2 : 0;
      const data = new ArrayBuffer(PARAMS_SIZE);
      const u = new Uint32Array(data), fl = new Float32Array(data);
      if (o.kind === "rigid") {
        u.set([o.geo.B, o.id, flags, o.geo.T]);
        this.writeRigidFlags(o);
      } else {
        u.set([o.id, flags, 0, 0]);
        this.writeDynFlags(o);
      }
      fl.set([d.metallic, d.roughness, Math.min(Math.max(d.opacity, 0), 1), 0], 4);
      this.device.queue.writeBuffer(o.params, 0, data);
    }
  }

  private transparent(name: string) {
    return this.displayOf(name).opacity < 0.999;
  }

  // -- overlays -----------------------------------------------------------

  // Canvas size in device pixels (the last frame's).
  get viewport(): [number, number] {
    return [this.size[0] || 1, this.size[1] || 1];
  }

  private view() {
    const cam = this.camera;
    return {
      eye: cam.eye(), forward: cam.forward(), near: cam.nearPlane(), fovy: cam.fovy, height: this.size[1],
      ortho: cam.ortho, viewHeight: cam.viewHeight(),
    };
  }

  // Slice plane outline across the scene bounds, and its "x = ..." label
  // (Viewer::build_overlays): line items (OverlayLine) and a label.
  private sliceOverlay(): { lines: number[]; label: Label | null } {
    const sl = this.settings.slice;
    const b = sl.enabled && sl.show ? this.bounds() : null;
    if (!b) return { lines: [], label: null };
    const [lo, hi] = b;
    const a = sl.axis, u = (a + 1) % 3, v = (a + 2) % 3;
    for (let k = 0; k < 3; k++) {
      const pad = 0.05 * (hi[k] - lo[k]) + 0.01;
      lo[k] -= pad;
      hi[k] += pad;
    }
    const p: Vec3[] = [0, 1, 2, 3].map((k) => {
      const q: Vec3 = [0, 0, 0];
      q[a] = sl.offset;
      q[u] = k === 1 || k === 2 ? hi[u] : lo[u];
      q[v] = k >= 2 ? hi[v] : lo[v];
      return q;
    });
    const color = [0.4, 0.82, 1.0, 0.9];
    const lines: number[] = [];
    for (let k = 0; k < 4; k++) {
      const q = p[(k + 1) % 4];
      lines.push(...p[k], 1.5, ...q, 0.3, ...color, 0, 0, 0, 0);
    }
    const label: Label = {
      text: `${"xyz"[a]} = ${formatLength(sl.offset, 0.001)}`, anchor: p[2], color, align: [0, 0],
      offset: [6, -16], worldHeight: 0, sizePx: 12, halo: [0.05, 0.05, 0.06, 0.75], hiddenAlpha: 0.5,
    };
    return { lines, label };
  }

  private glyphs(extra: Label[]): number[] {
    const labels: Label[] = [];
    for (const o of this.objects.values()) {
      if (o.kind !== "labels") continue;
      const a = o.obj.attrs;
      const anchors = o.obj.arrays.anchors.data;
      const n = anchors.length / 3;
      for (let i = 0; i < n; i++) {
        const text = a.texts ? String(a.texts[i]) : o.values ? pyFormat(a.fmt, o.values[i]) : "";
        if (!text) continue;
        const anchor: Vec3 = [anchors[3 * i], anchors[3 * i + 1], anchors[3 * i + 2]];
        if (this.isolated >= 0 && this.envOf(anchor[0], anchor[1]) !== this.isolated) continue;
        labels.push({ text, anchor, color: a.color, align: a.align, worldHeight: a.world_height, sizePx: a.size_px });
      }
    }
    if (this.settings.grid) labels.push(...this.rulers());
    labels.push(...extra);
    const out: number[] = [];
    this.text.layout(labels, this.view(), out);
    return out;
  }

  // Grid rulers: labelled ticks along the grid plane's two axes, or along
  // grid lines through the view target when an axis is off screen
  // (Viewer::build_overlays, dark theme).
  private rulers(): Label[] {
    const [W, H] = this.size;
    const cam = this.camera;
    const gp = gridPlane(cam);
    const at = (a: number, b: number): Vec3 => {
      const p: Vec3 = [0, 0, 0];
      p[gp.normal] = gp.offset;
      p[gp.u] = a;
      p[gp.v] = b;
      return p;
    };
    const project = cam.projector(W, H);
    const onScreen = (p: Vec3): [number, number] | null => {
      const q = project(p);
      return (cam.ortho || q[2] < 0) && q[0] > 8 && q[1] > 8 && q[0] < W - 8 && q[1] < H - 8 ? [q[0], q[1]] : null;
    };
    const tu = cam.target[gp.u], tv = cam.target[gp.v];
    const step = niceStep(cam.pixelSizeAt(at(tu, tv), H) * 90);
    const halo = [0.05, 0.05, 0.06, 0.75];
    const colors = [[0.98, 0.66, 0.7, 1], [0.74, 0.9, 0.56, 1], [0.62, 0.78, 1, 1]];
    const out: Label[] = [];
    for (let axis = 0; axis < 2; axis++) { // 0: along the u axis, 1: along the v axis
      const visible = onScreen(axis === 0 ? at(tu, 0) : at(0, tv)) !== null;
      const line = visible ? 0 : Math.round((axis === 0 ? tv : tu) / step) * step;
      const center = axis === 0 ? tu : tv;
      const color = colors[axis === 0 ? gp.u : gp.v];
      // A vertical axis in a side view gets its labels to the right.
      const beside = gp.background && axis === 1;
      let first: [number, number] = [-1e9, -1e9];
      for (const dir of [1, -1]) {
        let last = first;
        for (let k = dir > 0 ? 0 : -1; Math.abs(k) <= 12; k += dir) {
          const v = (Math.round(center / step) + k) * step;
          const p = axis === 0 ? at(v, line) : at(line, v);
          const s = onScreen(p);
          if (!s) continue;
          if (Math.hypot(s[0] - last[0], s[1] - last[1]) < 44) break;
          last = s;
          if (k === 0) first = s;
          if (Math.abs(v) < 1e-9 * step && axis === 1) continue; // origin labelled once
          out.push({
            text: formatLength(v, step), anchor: p, color, align: beside ? [0, 0.5] : [0.5, 0],
            offset: beside ? [8, 0] : [0, 6], worldHeight: 0, sizePx: 12, halo, hiddenAlpha: 0,
          });
        }
      }
    }
    return out;
  }

  // -- drawing ------------------------------------------------------------

  private drawGeometry(pass: GPURenderPassEncoder, which: "Main" | "Pre" | "Shadow" | "Transparent" | "Wire") {
    // In wireframe shading every mesh is drawn (and pickable) as wires.
    const all = which === "Wire" || (which === "Pre" && this.wireMode);
    const wantSeeThrough = which === "Transparent";
    for (const [name, g] of this.objects) {
      if (g.kind === "labels") continue;
      if (!all && this.transparent(name) !== wantSeeThrough) continue;
      this.drawOne(pass, g, which);
    }
  }

  private drawOne(pass: GPURenderPassEncoder, g: Geometry, which: string) {
    if (g.kind === "rigid") {
      pass.setPipeline(this.pipes[`rigid${which}`]);
      pass.setBindGroup(1, g.bind);
      pass.draw(3 * g.geo.T, g.geo.instances);
    } else if (g.faces > 0 && g.bind) {
      pass.setPipeline(this.pipes[`dyn${which}`]);
      pass.setBindGroup(1, g.bind);
      pass.draw(3 * g.faces);
    }
  }

  render() {
    this.ensureTargets();
    this.ensureStyle();
    this.writeFrame();
    this.writeObjectParams();
    const S = this.settings;
    const wire = this.wireMode;
    const slice = this.sliceOverlay();
    const glyphs = this.glyphs([...(slice.label ? [slice.label] : []), ...this.overlay.labels]);
    const nGlyphs = glyphs.length / GLYPH_FLOATS;
    if (nGlyphs > this.glyphCap) this.glyphBuf = this.storageBuffer("glyph", Math.max(nGlyphs, 2 * this.glyphCap));
    if (nGlyphs) this.device.queue.writeBuffer(this.glyphBuf, 0, new Float32Array(glyphs));
    const lineItems = [...slice.lines, ...this.overlay.lines];
    const nLines = lineItems.length / 16;
    if (nLines > this.lineCap) this.lineBuf = this.storageBuffer("line", Math.max(nLines, 2 * this.lineCap));
    if (nLines) this.device.queue.writeBuffer(this.lineBuf, 0, new Float32Array(lineItems));
    const seeThrough = !wire && [...this.objects].some(([n, o]) => o.kind !== "labels" && this.transparent(n));
    const ground = S.grid || S.groundShadow;

    const dev = this.device;
    const enc = dev.createCommandEncoder();
    const view = (n: string) => this.t[n].createView();
    const color = (v: GPUTextureView, clear: number[], resolveTarget?: GPUTextureView): GPURenderPassColorAttachment => ({
      view: v, resolveTarget, loadOp: "clear", storeOp: resolveTarget ? "discard" : "store",
      clearValue: { r: clear[0], g: clear[1], b: clear[2], a: clear[3] },
    });
    const clearOnly = (target: string, value: number) =>
      enc.beginRenderPass({ colorAttachments: [color(view(target), [value, value, value, 1])] }).end();
    // 1. Sun shadow map (opaque meshes).
    let pass = enc.beginRenderPass({
      colorAttachments: [],
      depthStencilAttachment: { view: this.shadowView, depthLoadOp: "clear", depthStoreOp: "store", depthClearValue: 1 },
    });
    if (S.shadows && !wire) {
      pass.setBindGroup(0, this.groups.frame);
      this.drawGeometry(pass, "Shadow");
    }
    pass.end();
    // 2. Prepass: depth, normals, ids (+ the ground); see-through meshes take
    //    no part (in wireframe shading, every mesh does).
    pass = enc.beginRenderPass({
      colorAttachments: [color(view("preNormal"), [0, 0, 0, 0]), color(view("preIds"), [0, 0, 0, 0])],
      depthStencilAttachment: { view: view("preDepth"), depthLoadOp: "clear", depthStoreOp: "store", depthClearValue: 0 },
    });
    pass.setBindGroup(0, this.groups.scene);
    this.drawGeometry(pass, "Pre");
    if (ground) {
      pass.setPipeline(this.pipes.gridPre);
      pass.draw(3);
    }
    pass.end();
    // 3. Ambient occlusion.
    if (S.ssao && S.aoStrength > 0 && !wire) {
      for (const [target, pipe] of [["aoRaw", "ssao"], ["ao", "blur"]]) {
        pass = enc.beginRenderPass({ colorAttachments: [color(view(target), [1, 1, 1, 1])] });
        pass.setPipeline(this.pipes[pipe]);
        pass.setBindGroup(0, this.groups[pipe]);
        pass.draw(3);
        pass.end();
      }
    } else clearOnly("ao", 1);
    // 4. Main color pass (4x MSAA): opaque meshes, then the grid over the
    //    ground; in wireframe shading (X-ray) the grid first, then wires over
    //    everything.
    pass = enc.beginRenderPass({
      colorAttachments: [color(view("msaaColor"), [0, 0, 0, 0], view("resolved"))],
      depthStencilAttachment: {
        view: view("msaaDepth"), depthLoadOp: "clear", depthStoreOp: seeThrough ? "store" : "discard", depthClearValue: 0,
      },
    });
    pass.setBindGroup(0, this.groups.scene);
    if (wire) {
      if (ground) {
        pass.setPipeline(this.pipes.gridMain);
        pass.draw(3);
      }
      this.drawGeometry(pass, "Wire");
    } else {
      this.drawGeometry(pass, "Main");
      if (ground) {
        pass.setPipeline(this.pipes.gridMain);
        pass.draw(3);
      }
    }
    pass.end();
    // 5. See-through meshes: weighted blended OIT against the opaque depth.
    if (seeThrough) {
      pass = enc.beginRenderPass({
        colorAttachments: [color(view("oitAccumMsaa"), [0, 0, 0, 0], view("accum")),
          color(view("oitRevealMsaa"), [1, 1, 1, 1], view("reveal"))],
        depthStencilAttachment: { view: view("msaaDepth"), depthLoadOp: "load", depthStoreOp: "discard" },
      });
      pass.setBindGroup(0, this.groups.scene);
      this.drawGeometry(pass, "Transparent");
      pass.end();
    } else clearOnly("reveal", 1);
    // 6. Composite, then overlay lines and text labels.
    pass = enc.beginRenderPass({
      colorAttachments: [color(this.context.getCurrentTexture().createView(), [0, 0, 0, 1])],
    });
    pass.setPipeline(this.pipes.composite);
    pass.setBindGroup(0, this.groups.composite);
    pass.draw(3);
    if (nLines) {
      pass.setPipeline(this.pipes.lines);
      pass.setBindGroup(0, this.groups.lines);
      pass.setBindGroup(1, this.lineGroup);
      pass.draw(6, nLines);
    }
    if (nGlyphs) {
      pass.setPipeline(this.pipes.text);
      pass.setBindGroup(0, this.groups.text);
      pass.setBindGroup(1, this.glyphGroup);
      pass.draw(6, nGlyphs);
    }
    pass.end();
    dev.queue.submit([enc.finish()]);
  }

  // Prepass id pixels of the last frame in a rectangle (device pixels,
  // clipped to the canvas), row-major; pixels outside are empty.
  async readIds(x0: number, y0: number, w: number, h: number): Promise<IdPixel[]> {
    const out: IdPixel[] = Array.from({ length: w * h }, () => ({ object: 0, element: 0, segment: 0, flags: 0 }));
    const [W, H] = this.size;
    const cx0 = Math.max(x0, 0), cy0 = Math.max(y0, 0);
    const cx1 = Math.min(x0 + w, W), cy1 = Math.min(y0 + h, H);
    if (cx1 <= cx0 || cy1 <= cy0 || !this.t.preIds) return out;
    const cw = cx1 - cx0, ch = cy1 - cy0;
    const bytesPerRow = Math.ceil((cw * 16) / 256) * 256;
    const buf = this.device.createBuffer({ size: bytesPerRow * ch, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = this.device.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: this.t.preIds, origin: [cx0, cy0] }, { buffer: buf, bytesPerRow }, [cw, ch]);
    this.device.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const ids = new Uint32Array(buf.getMappedRange());
    for (let y = 0; y < ch; y++)
      for (let x = 0; x < cw; x++) {
        const i = (y * bytesPerRow) / 4 + 4 * x;
        out[(y + cy0 - y0) * w + (x + cx0 - x0)] = { object: ids[i], element: ids[i + 1], segment: ids[i + 2], flags: ids[i + 3] };
      }
    buf.unmap();
    buf.destroy();
    return out;
  }

  // Geometry by prepass object id (GROUND_ID: none).
  geoById(id: number): Geo | undefined {
    if (id === 0 || id === GROUND_ID) return undefined;
    for (const o of this.objects.values())
      if (o.kind !== "labels" && o.id === id) return o.kind === "rigid" ? o.geo : (o.points ?? o.geo);
    return undefined;
  }
}

// glm::orthoRH_ZO (column-major).
function orthoZO(l: number, r: number, b: number, t: number, n: number, f: number): Float32Array {
  const m = new Float32Array(16);
  m[0] = 2 / (r - l);
  m[5] = 2 / (t - b);
  m[10] = -1 / (f - n);
  m[12] = -(r + l) / (r - l);
  m[13] = -(t + b) / (t - b);
  m[14] = -n / (f - n);
  m[15] = 1;
  return m;
}

function align4(n: number) {
  return (n + 3) & ~3;
}

function destroy(o: Gpu) {
  if (o.kind === "rigid") for (const b of o.buffers) b.destroy();
  else if (o.kind === "dyn") {
    o.pos?.destroy(); o.color?.destroy(); o.tris?.destroy(); o.faceInfo?.destroy(); o.params.destroy(); o.segments.destroy();
  }
}
