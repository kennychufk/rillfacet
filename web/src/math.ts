// Column-major 4x4 matrices (WGSL mat4x4f layout) and the orbit camera.
// World is z-up, like every rillfacet scene. Depth is reversed-Z, infinite far.

export type Vec3 = [number, number, number];
export type Mat4 = Float32Array;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 =>
  [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

export function lookAt(eye: Vec3, target: Vec3, up: Vec3 = [0, 0, 1]): Mat4 {
  const f = norm(sub(target, eye));
  let s = cross(f, up);
  if (Math.hypot(...s) < 1e-6) s = cross(f, [0, 1, 0]);
  s = norm(s);
  const u = cross(s, f);
  // prettier-ignore
  return new Float32Array([
    s[0], u[0], -f[0], 0,
    s[1], u[1], -f[1], 0,
    s[2], u[2], -f[2], 0,
    -dot(s, eye), -dot(u, eye), dot(f, eye), 1,
  ]);
}

// Reversed-Z infinite perspective: view z = -near -> depth 1, infinity -> 0.
export function perspective(fovy: number, aspect: number, near: number): Mat4 {
  const f = 1 / Math.tan(fovy / 2);
  // prettier-ignore
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, 0, -1,
    0, 0, near, 0,
  ]);
}

export function mul(a: Mat4, b: Mat4): Mat4 {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
  return o;
}

export function invert(m: Mat4): Mat4 {
  const inv = new Float32Array(16);
  const a = m;
  inv[0] = a[5] * a[10] * a[15] - a[5] * a[11] * a[14] - a[9] * a[6] * a[15] + a[9] * a[7] * a[14] + a[13] * a[6] * a[11] - a[13] * a[7] * a[10];
  inv[4] = -a[4] * a[10] * a[15] + a[4] * a[11] * a[14] + a[8] * a[6] * a[15] - a[8] * a[7] * a[14] - a[12] * a[6] * a[11] + a[12] * a[7] * a[10];
  inv[8] = a[4] * a[9] * a[15] - a[4] * a[11] * a[13] - a[8] * a[5] * a[15] + a[8] * a[7] * a[13] + a[12] * a[5] * a[11] - a[12] * a[7] * a[9];
  inv[12] = -a[4] * a[9] * a[14] + a[4] * a[10] * a[13] + a[8] * a[5] * a[14] - a[8] * a[6] * a[13] - a[12] * a[5] * a[10] + a[12] * a[6] * a[9];
  inv[1] = -a[1] * a[10] * a[15] + a[1] * a[11] * a[14] + a[9] * a[2] * a[15] - a[9] * a[3] * a[14] - a[13] * a[2] * a[11] + a[13] * a[3] * a[10];
  inv[5] = a[0] * a[10] * a[15] - a[0] * a[11] * a[14] - a[8] * a[2] * a[15] + a[8] * a[3] * a[14] + a[12] * a[2] * a[11] - a[12] * a[3] * a[10];
  inv[9] = -a[0] * a[9] * a[15] + a[0] * a[11] * a[13] + a[8] * a[1] * a[15] - a[8] * a[3] * a[13] - a[12] * a[1] * a[11] + a[12] * a[3] * a[9];
  inv[13] = a[0] * a[9] * a[14] - a[0] * a[10] * a[13] - a[8] * a[1] * a[14] + a[8] * a[2] * a[13] + a[12] * a[1] * a[10] - a[12] * a[2] * a[9];
  inv[2] = a[1] * a[6] * a[15] - a[1] * a[7] * a[14] - a[5] * a[2] * a[15] + a[5] * a[3] * a[14] + a[13] * a[2] * a[7] - a[13] * a[3] * a[6];
  inv[6] = -a[0] * a[6] * a[15] + a[0] * a[7] * a[14] + a[4] * a[2] * a[15] - a[4] * a[3] * a[14] - a[12] * a[2] * a[7] + a[12] * a[3] * a[6];
  inv[10] = a[0] * a[5] * a[15] - a[0] * a[7] * a[13] - a[4] * a[1] * a[15] + a[4] * a[3] * a[13] + a[12] * a[1] * a[7] - a[12] * a[3] * a[5];
  inv[14] = -a[0] * a[5] * a[14] + a[0] * a[6] * a[13] + a[4] * a[1] * a[14] - a[4] * a[2] * a[13] - a[12] * a[1] * a[6] + a[12] * a[2] * a[5];
  inv[3] = -a[1] * a[6] * a[11] + a[1] * a[7] * a[10] + a[5] * a[2] * a[11] - a[5] * a[3] * a[10] - a[9] * a[2] * a[7] + a[9] * a[3] * a[6];
  inv[7] = a[0] * a[6] * a[11] - a[0] * a[7] * a[10] - a[4] * a[2] * a[11] + a[4] * a[3] * a[10] + a[8] * a[2] * a[7] - a[8] * a[3] * a[6];
  inv[11] = -a[0] * a[5] * a[11] + a[0] * a[7] * a[9] + a[4] * a[1] * a[11] - a[4] * a[3] * a[9] - a[8] * a[1] * a[7] + a[8] * a[3] * a[5];
  inv[15] = a[0] * a[5] * a[10] - a[0] * a[6] * a[9] - a[4] * a[1] * a[10] + a[4] * a[2] * a[9] + a[8] * a[1] * a[6] - a[8] * a[2] * a[5];
  const det = a[0] * inv[0] + a[1] * inv[4] + a[2] * inv[8] + a[3] * inv[12];
  const d = det === 0 ? 0 : 1 / det;
  for (let i = 0; i < 16; i++) inv[i] *= d;
  return inv;
}

export const ORBIT_SPEED = 0.008;

export interface Ray { origin: Vec3; dir: Vec3 }

export type ViewPreset = "front" | "back" | "right" | "left" | "top" | "bottom";

// Z-up turntable camera with Blender-style navigation, a port of the native
// Camera (src/rillfacet/camera.cpp): perspective or orthographic, reversed-Z,
// axis view presets with "auto perspective", smooth view transitions.
// Pixel arguments are device pixels (origin top-left).
export class Camera {
  target: Vec3 = [0, 0, 0];
  distance = 10;
  yaw = -Math.PI / 2; // radians around +z; -pi/2 looks along +y (Blender "Front")
  pitch = 0.35; // radians above the ground plane
  fovy = (40 * Math.PI) / 180;
  ortho = false;
  // Axis views go ortho, orbiting returns to perspective.
  autoPerspective = true;
  private orthoFromPreset = false;
  private anim: { t: number; len: number; from: number[]; to: number[] } | null = null;

  lookAt(eye: Vec3, target: Vec3) {
    const d = sub(eye, target);
    this.target = [...target];
    this.distance = Math.max(Math.hypot(...d), 1e-4);
    this.yaw = Math.atan2(d[1], d[0]);
    this.pitch = Math.asin(Math.max(-1, Math.min(1, d[2] / this.distance)));
    this.anim = null;
  }

  forward(): Vec3 {
    const c = Math.cos(this.pitch);
    return [-c * Math.cos(this.yaw), -c * Math.sin(this.yaw), -Math.sin(this.pitch)];
  }

  eye(): Vec3 {
    const f = this.forward();
    return [this.target[0] - f[0] * this.distance, this.target[1] - f[1] * this.distance,
      this.target[2] - f[2] * this.distance];
  }

  // Turntable: "right" never tilts, so the horizon stays level and views
  // straight down (Top) are still well defined.
  right(): Vec3 {
    return [-Math.sin(this.yaw), Math.cos(this.yaw), 0];
  }

  up(): Vec3 {
    return cross(this.right(), this.forward());
  }

  view(): Mat4 {
    const f = this.forward(), r = this.right(), u = this.up(), e = this.eye();
    // prettier-ignore
    return new Float32Array([
      r[0], u[0], -f[0], 0,
      r[1], u[1], -f[1], 0,
      r[2], u[2], -f[2], 0,
      -dot(r, e), -dot(u, e), dot(f, e), 1,
    ]);
  }

  nearPlane() {
    return Math.max(1e-4, this.distance * 1e-3);
  }

  // World height of the view at the target distance (ortho zoom level).
  viewHeight() {
    return 2 * this.distance * Math.tan(0.5 * this.fovy);
  }

  proj(aspect: number): Mat4 {
    if (!this.ortho) return perspective(this.fovy, aspect, this.nearPlane());
    // Reversed-Z orthographic: depth 1 at the near plane, 0 at `far`.
    const h = 0.5 * this.viewHeight(), w = h * aspect;
    const n = -this.distance * 50, f = this.distance * 50;
    const m = new Float32Array(16);
    m[0] = 1 / w;
    m[5] = 1 / h;
    m[10] = 1 / (f - n);
    m[14] = f / (f - n);
    m[15] = 1;
    return m;
  }

  ray(px: number, py: number, width: number, height: number): Ray {
    const nx = (px / width) * 2 - 1, ny = 1 - (py / height) * 2;
    const aspect = width / height, h = 0.5 * this.viewHeight();
    const f = this.forward(), r = this.right(), u = this.up();
    if (this.ortho) {
      const o = [0, 1, 2].map((k) => this.target[k] + r[k] * nx * h * aspect + u[k] * ny * h -
        f[k] * this.distance * 50) as Vec3;
      return { origin: o, dir: f };
    }
    const t = Math.tan(0.5 * this.fovy);
    const d = norm([0, 1, 2].map((k) => f[k] + r[k] * nx * t * aspect + u[k] * ny * t) as Vec3);
    return { origin: this.eye(), dir: d };
  }

  // World point -> pixels, z = view depth (negative in front of the camera).
  project(p: Vec3, width: number, height: number): Vec3 {
    return projectWith(this.view(), this.proj(width / height), this.ortho, p, width, height);
  }

  // A projector for many points with this camera (matrices computed once).
  projector(width: number, height: number): (p: Vec3) => Vec3 {
    const v = this.view(), pr = this.proj(width / height), o = this.ortho;
    return (p) => projectWith(v, pr, o, p, width, height);
  }

  // World size of one pixel at `p`.
  pixelSizeAt(p: Vec3, height: number) {
    if (this.ortho) return this.viewHeight() / height;
    const depth = Math.max(dot(sub(p, this.eye()), this.forward()), this.nearPlane());
    return (2 * depth * Math.tan(0.5 * this.fovy)) / height;
  }

  // Navigation (deltas in pixels).
  orbit(dx: number, dy: number) {
    this.anim = null;
    this.yaw -= dx * ORBIT_SPEED;
    this.pitch = Math.max(-0.5 * Math.PI, Math.min(0.5 * Math.PI, this.pitch + dy * ORBIT_SPEED));
    if (this.autoPerspective && this.orthoFromPreset) {
      this.ortho = false;
      this.orthoFromPreset = false;
    }
  }

  pan(dx: number, dy: number, viewportHeight: number) {
    this.anim = null;
    const s = this.viewHeight() / viewportHeight;
    const r = this.right(), u = this.up();
    for (let k = 0; k < 3; k++) this.target[k] += (-dx * r[k] + dy * u[k]) * s;
  }

  // Wheel steps; positive zooms in.
  dolly(steps: number) {
    this.anim = null;
    this.distance = Math.max(1e-3, Math.min(1e5, this.distance * Math.pow(1.15, -steps)));
  }

  toggleOrtho() {
    this.ortho = !this.ortho;
    this.orthoFromPreset = false;
  }

  // Animated transition (Blender "smooth view"), the short way around.
  animateTo(target: Vec3, distance: number, yaw: number, pitch: number, seconds = 0.2) {
    const dy = remainder(yaw - this.yaw, 2 * Math.PI);
    this.anim = {
      t: 0, len: seconds,
      from: [...this.target, this.distance, this.yaw, this.pitch],
      to: [...target, distance, this.yaw + dy, pitch],
    };
    if (seconds <= 0) this.update(0);
  }

  // Advances the animation; true while it runs.
  update(dt: number): boolean {
    const a = this.anim;
    if (!a) return false;
    a.t = Math.min(a.t + dt, a.len);
    let s = a.len > 0 ? a.t / a.len : 1;
    s = s * s * (3 - 2 * s);
    const v = a.from.map((x, i) => x + (a.to[i] - x) * s);
    this.target = [v[0], v[1], v[2]];
    [this.distance, this.yaw, this.pitch] = [v[3], v[4], v[5]];
    if (a.t >= a.len) this.anim = null;
    return true;
  }

  get animating() {
    return this.anim !== null;
  }

  // Axis-aligned view; switches to ortho (auto perspective).
  setView(preset: ViewPreset) {
    const h = 0.5 * Math.PI;
    let y = this.yaw, p = 0;
    switch (preset) {
      case "front": y = -h; break;
      case "back": y = h; break;
      case "right": y = 0; break;
      case "left": y = Math.PI; break;
      case "top": y = -h; p = h; break;
      case "bottom": y = -h; p = -h; break;
    }
    if (this.autoPerspective && !this.ortho) {
      this.ortho = true;
      this.orthoFromPreset = true;
    }
    this.animateTo(this.target, this.distance, y, p);
  }

  // World axis the view looks along when exactly axis-aligned (0 x, 1 y, 2 z), else -1.
  alignedAxis(): number {
    const eps = 1e-3;
    if (Math.abs(Math.abs(this.pitch) - 0.5 * Math.PI) < eps) return 2;
    if (Math.abs(this.pitch) > eps) return -1;
    const y = Math.abs(remainder(this.yaw, 2 * Math.PI));
    if (y < eps || Math.abs(y - Math.PI) < eps) return 0;
    if (Math.abs(y - 0.5 * Math.PI) < eps) return 1;
    return -1;
  }

  frameBounds(lo: Vec3, hi: Vec3, animate = true) {
    const c: Vec3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
    const r = Math.max(0.5 * Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]), 1e-3);
    const d = (r / Math.sin(0.5 * this.fovy)) * 1.1;
    if (animate) this.animateTo(c, d, this.yaw, this.pitch);
    else {
      this.target = c;
      this.distance = d;
    }
  }
}

// IEEE remainder (std::remainder): x - n * y with n = round-half-even(x / y).
export function remainder(x: number, y: number): number {
  const q = x / y;
  let n = Math.round(q);
  if (Math.abs(q - Math.trunc(q)) === 0.5) n = 2 * Math.round(q / 2);
  return x - n * y;
}

function projectWith(v: Mat4, p: Mat4, ortho: boolean, x: Vec3, W: number, H: number): Vec3 {
  const e = [0, 0, 0, 0], c = [0, 0, 0, 0];
  for (let r = 0; r < 4; r++) e[r] = v[r] * x[0] + v[4 + r] * x[1] + v[8 + r] * x[2] + v[12 + r];
  for (let r = 0; r < 4; r++) c[r] = p[r] * e[0] + p[4 + r] * e[1] + p[8 + r] * e[2] + p[12 + r] * e[3];
  const w = ortho ? 1 : c[3];
  if (!ortho && w <= 1e-8) return [-1e9, -1e9, e[2]];
  return [(c[0] / w * 0.5 + 0.5) * W, (0.5 - c[1] / w * 0.5) * H, e[2]];
}

export { sub, cross, dot, norm };
