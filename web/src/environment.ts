// Lighting inputs of the MatCap and Environment PBR styles, ported from
// src/avbd_viz/environment.cpp: the procedural matcaps and environment maps
// (same formulas), and the GPU environment (spherical-harmonic irradiance on
// the CPU, a box-filtered mip chain, then the native env_prefilter.wgsl GGX
// prefilter, unchanged).
import prefilterSrc from "./shaders/native_env_prefilter.wgsl";
import { type Vec3 } from "./math";

export const MATCAPS = ["Clay", "Porcelain", "Chrome", "Toon"] as const;
export const ENVIRONMENTS = ["Studio softboxes", "Clear sky", "Soft white room"] as const;

const PI = Math.PI;
type V = [number, number, number];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V): V => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const rad = (d: number) => (d * PI) / 180;

// Default "tint by object color" of a matcap preset (0 for full-color pictures).
export const matcapDefaultTint = (preset: number) => (preset === 2 ? 0 : 1);

function toSrgb8(x: number) {
  x = clamp(x, 0, 1);
  const s = x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  return Math.round(s * 255);
}

// RGBA8: rgb = sRGB shading, a = linear specular highlight (make_matcap).
export function makeMatcap(preset: number, size = 256): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  const key = norm([-0.5, 0.6, 0.62]);
  const fill = norm([0.75, -0.05, 0.65]);
  const view: V = [0, 0, 1];
  const h = norm([key[0] + view[0], key[1] + view[1], key[2] + view[2]]);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let x = ((i + 0.5) / size) * 2 - 1, y = 1 - ((j + 0.5) / size) * 2;
      let r2 = x * x + y * y;
      if (r2 > 1) {
        const r = Math.sqrt(r2);
        x /= r; y /= r; r2 = 1;
      }
      const n: V = [x, y, Math.sqrt(Math.max(0, 1 - r2))];
      const k = Math.max(0, dot(n, key)), f = Math.max(0, dot(n, fill));
      const wrap = Math.max(0, (dot(n, key) + 0.4) / 1.4);
      const ndh = Math.max(0, dot(n, h));
      const rim = Math.pow(1 - n[2], 3);
      let rgb: V = [0, 0, 0];
      let spec = 0;
      if (preset === 0) {
        const s = 0.1 + 0.5 * wrap + 0.14 * f + 0.1 * n[1];
        rgb = [1.0 * s, 0.97 * s, 0.93 * s];
        spec = 0.06 * Math.pow(ndh, 10);
      } else if (preset === 1) {
        const s = 0.12 + 0.52 * k + 0.16 * f + 0.1 * (n[1] * 0.5 + 0.5);
        rgb = [s, s, s];
        spec = 0.9 * Math.pow(ndh, 140) + 0.25 * Math.pow(ndh, 18) + 0.12 * rim;
      } else if (preset === 2) {
        // reflect(-view, n) = -view + 2 dot(view, n) n
        const dn = 2 * n[2];
        const refl: V = [dn * n[0], dn * n[1], -1 + dn * n[2]];
        const sky = smoothstep(-0.05, 0.25, refl[1]);
        const lo: V = [0.06, 0.06, 0.07], hi: V = [0.85, 0.88, 0.95];
        const band = 0.5 * Math.exp(-Math.pow((refl[1] - 0.05) * 14, 2));
        const hl = 2 * Math.pow(Math.max(0, dot(refl, key)), 200);
        rgb = [0, 1, 2].map((c) => (lo[c] + (hi[c] - lo[c]) * sky + band + hl) * 0.9) as V;
      } else {
        const band = k > 0.55 ? 0.62 : k > 0.15 ? 0.42 : 0.24;
        rgb = [band, band, band];
        spec = ndh > 0.985 ? 0.6 : 0;
      }
      const p = (j * size + i) * 4;
      out[p] = toSrgb8(rgb[0]);
      out[p + 1] = toSrgb8(rgb[1]);
      out[p + 2] = toSrgb8(rgb[2]);
      out[p + 3] = Math.round(clamp(spec, 0, 1) * 255);
    }
  }
  return out;
}

function dirFromUv(u: number, v: number): V {
  const phi = (u - 0.5) * 2 * PI, theta = v * PI;
  return [Math.sin(theta) * Math.cos(phi), Math.sin(theta) * Math.sin(phi), Math.cos(theta)];
}

function dirFromAngles(az: number, el: number): V {
  const a = rad(az), e = rad(el);
  return [Math.cos(e) * Math.cos(a), Math.cos(e) * Math.sin(a), Math.sin(e)];
}

function softDisc(d: V, center: V, radiusDeg: number, soft: number) {
  const ang = Math.acos(clamp(dot(d, center), -1, 1));
  const r = rad(radiusDeg);
  return 1 - smoothstep(r * (1 - soft), r, ang);
}

function softbox(d: V, center: V, hwDeg: number, hhDeg: number) {
  const right = norm(cross(center, [0, 0, 1]));
  const up = cross(right, center);
  const fwd = dot(d, center);
  if (fwd <= 0) return 0;
  const x = Math.atan2(dot(d, right), fwd), y = Math.atan2(dot(d, up), fwd);
  const hw = rad(hwDeg), hh = rad(hhDeg);
  return (1 - smoothstep(hw * 0.75, hw, Math.abs(x))) * (1 - smoothstep(hh * 0.75, hh, Math.abs(y)));
}

export interface EnvironmentImage { width: number; height: number; rgb: Float32Array; sunDir: Vec3 }

// Linear radiance, equirectangular, z-up, top row = +z (make_environment).
export function makeEnvironment(preset: number, width = 1024): EnvironmentImage {
  const height = width / 2;
  const rgb = new Float32Array(width * height * 3);
  const key = dirFromAngles(-130, 55), fill = dirFromAngles(-40, 25), rim = dirFromAngles(100, 30);
  const sun = dirFromAngles(-120, 50);
  const sunDir: Vec3 = preset === 1 ? sun : preset === 0 ? key : [0, 0, 1];
  const mix3 = (a: V, b: V, t: number): V => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = dirFromUv((x + 0.5) / width, (y + 0.5) / height);
      const horizon = smoothstep(-0.08, 0.08, d[2]);
      let c: V;
      if (preset === 0) {
        const wall = mix3([0.1, 0.1, 0.1], [0.3, 0.3, 0.32], d[2] * 0.5 + 0.5);
        c = mix3([0.07, 0.07, 0.07], wall, horizon);
        const k = 9 * softbox(d, key, 22, 14), f = 2.5 * softbox(d, fill, 30, 10);
        const r = 5 * softbox(d, rim, 8, 22), t = 1.5 * softDisc(d, [0, 0, 1], 25, 0.5);
        c = [c[0] + k * 1.0 + f * 0.92 + r + t, c[1] + k * 0.97 + f * 0.96 + r + t, c[2] + k * 0.92 + f * 1.0 + r + t];
      } else if (preset === 1) {
        const zen: V = [0.18, 0.36, 0.8], haze: V = [0.75, 0.84, 0.95];
        const s = mix3(haze, zen, Math.pow(Math.max(d[2], 0), 0.45)).map((v) => v * 1.3) as V;
        c = mix3([0.16, 0.15, 0.13], s, horizon);
        const a = 400 * softDisc(d, sun, 1.2, 0.3), b = 2 * softDisc(d, sun, 18, 1);
        c = [c[0] + a * 1.0 + b * 1.0, c[1] + a * 0.95 + b * 0.9, c[2] + a * 0.85 + b * 0.7];
      } else {
        const g = 0.3 + 0.7 * (d[2] * 0.5 + 0.5);
        c = [g, g, g];
      }
      rgb.set(c, (y * width + x) * 3);
    }
  }
  return { width, height, rgb, sunDir };
}

export interface GpuEnvironment { view: GPUTextureView; texture: GPUTexture; mips: number; sh: Float32Array; sunDir: Vec3 }

// float -> IEEE half bits (round toward zero, like environment.cpp's to_half).
function toHalf(f: number): number {
  const b = new Float32Array([f]), u = new Uint32Array(b.buffer)[0];
  const sign = (u >>> 16) & 0x8000, exp = (u >>> 23) & 0xff;
  let mant = u & 0x7fffff;
  if (exp === 0xff) return sign | 0x7c00 | (mant ? 0x200 : 0);
  const e = exp - 127 + 15;
  if (e >= 31) return sign | 0x7c00;
  if (e <= 0) {
    if (e < -10) return sign;
    mant |= 0x800000;
    return sign | (mant >>> (14 - e));
  }
  return sign | (e << 10) | (mant >>> 13);
}

// EnvironmentMap::build: mip k holds the reflection for roughness
// (k / (mips-1))^2; sh = 9 irradiance coefficients (pre-divided by pi).
export function buildEnvironment(device: GPUDevice, img: EnvironmentImage): GpuEnvironment {
  const { width: w, height: h } = img;
  const sh = new Float32Array(36); // 9 x vec4 (rgb, 0)
  for (let y = 0; y < h; y++) {
    const theta = ((y + 0.5) / h) * PI;
    const dOmega = ((2 * PI) / w) * (PI / h) * Math.sin(theta);
    for (let x = 0; x < w; x++) {
      const d = dirFromUv((x + 0.5) / w, (y + 0.5) / h);
      const i = (y * w + x) * 3;
      const basis = [0.282095, 0.488603 * d[1], 0.488603 * d[2], 0.488603 * d[0], 1.092548 * d[0] * d[1],
        1.092548 * d[1] * d[2], 0.315392 * (3 * d[2] * d[2] - 1), 1.092548 * d[0] * d[2],
        0.546274 * (d[0] * d[0] - d[1] * d[1])];
      for (let c = 0; c < 3; c++) {
        const v = Math.min(img.rgb[i + c], 50) * dOmega;
        for (let k = 0; k < 9; k++) sh[4 * k + c] += v * basis[k];
      }
    }
  }
  for (let k = 0; k < 36; k++) sh[k] /= PI;

  let mips = 1;
  while (w >> mips >= 32 && h >> mips >= 16) mips++;
  const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST;
  const src = device.createTexture({ size: [w, h], format: "rgba16float", usage, mipLevelCount: mips });
  let level = img.rgb, lw = w, lh = h;
  for (let m = 0; m < mips; m++) {
    const half = new Uint16Array(lw * lh * 4);
    for (let i = 0; i < lw * lh; i++) {
      for (let c = 0; c < 3; c++) half[4 * i + c] = toHalf(Math.min(level[3 * i + c], 60000));
      half[4 * i + 3] = 0x3c00;
    }
    device.queue.writeTexture({ texture: src, mipLevel: m }, half, { bytesPerRow: lw * 8, rowsPerImage: lh }, [lw, lh]);
    if (m + 1 === mips) break;
    const nw = lw >> 1, nh = lh >> 1;
    const next = new Float32Array(nw * nh * 3);
    for (let y = 0; y < nh; y++)
      for (let x = 0; x < nw; x++)
        for (let c = 0; c < 3; c++)
          next[(y * nw + x) * 3 + c] = 0.25 * (level[((2 * y) * lw + 2 * x) * 3 + c] + level[((2 * y) * lw + 2 * x + 1) * 3 + c] +
            level[((2 * y + 1) * lw + 2 * x) * 3 + c] + level[((2 * y + 1) * lw + 2 * x + 1) * 3 + c]);
    level = next; lw = nw; lh = nh;
  }

  const dst = device.createTexture({
    size: [w, h], format: "rgba16float", mipLevelCount: mips,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
  });
  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "float" } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, sampler: { type: "filtering" } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: "write-only", format: "rgba16float" } },
    ],
  });
  const pipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: { module: device.createShaderModule({ code: prefilterSrc }), entryPoint: "main" },
  });
  const sampler = device.createSampler({
    addressModeU: "repeat", addressModeV: "clamp-to-edge", magFilter: "linear", minFilter: "linear", mipmapFilter: "linear",
  });
  const srcView = src.createView();
  const enc = device.createCommandEncoder();
  const temp: GPUBuffer[] = [];
  for (let m = 0; m < mips; m++) {
    const t = mips > 1 ? m / (mips - 1) : 0;
    const ubo = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(ubo, 0, new Float32Array([t * t, mips, w, 0]));
    temp.push(ubo);
    const group = device.createBindGroup({
      layout, entries: [{ binding: 0, resource: { buffer: ubo } }, { binding: 1, resource: srcView },
        { binding: 2, resource: sampler }, { binding: 3, resource: dst.createView({ baseMipLevel: m, mipLevelCount: 1 }) }],
    });
    const pass = enc.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.dispatchWorkgroups(Math.ceil((w >> m) / 8), Math.ceil((h >> m) / 8));
    pass.end();
  }
  device.queue.submit([enc.finish()]);
  device.queue.onSubmittedWorkDone().then(() => {
    src.destroy();
    for (const b of temp) b.destroy();
  });
  return { view: dst.createView(), texture: dst, mips, sh, sunDir: img.sunDir };
}
