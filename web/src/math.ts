// Column-major 4x4 matrices (WGSL mat4x4f layout) and the orbit camera.
// World is z-up, like every avbd scene. Depth is reversed-Z, infinite far.

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

// Turntable camera around a target, z-up: left drag orbits, right drag (or
// shift + left) pans, the wheel zooms.
export class OrbitCamera {
  target: Vec3 = [0, 0, 0];
  distance = 5;
  yaw = -Math.PI / 2; // azimuth of the eye around +z, from +x
  pitch = 0.4; // elevation
  fovy = (45 * Math.PI) / 180;

  lookAt(eye: Vec3, target: Vec3) {
    const d = sub(eye, target);
    this.target = [...target];
    this.distance = Math.max(Math.hypot(...d), 1e-3);
    this.yaw = Math.atan2(d[1], d[0]);
    this.pitch = Math.asin(Math.max(-1, Math.min(1, d[2] / this.distance)));
  }

  eye(): Vec3 {
    const c = Math.cos(this.pitch);
    return [
      this.target[0] + this.distance * c * Math.cos(this.yaw),
      this.target[1] + this.distance * c * Math.sin(this.yaw),
      this.target[2] + this.distance * Math.sin(this.pitch),
    ];
  }

  view(): Mat4 {
    return lookAt(this.eye(), this.target);
  }

  proj(aspect: number): Mat4 {
    return perspective(this.fovy, aspect, Math.max(this.distance * 1e-3, 1e-3));
  }

  orbit(dx: number, dy: number) {
    this.yaw -= dx * 0.008;
    this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch + dy * 0.008));
  }

  pan(dx: number, dy: number, viewportHeight: number) {
    const v = this.view();
    const right: Vec3 = [v[0], v[4], v[8]];
    const up: Vec3 = [v[1], v[5], v[9]];
    const k = (2 * this.distance * Math.tan(this.fovy / 2)) / viewportHeight;
    for (let i = 0; i < 3; i++) this.target[i] += (-dx * right[i] + dy * up[i]) * k;
  }

  zoom(delta: number) {
    this.distance = Math.max(1e-3, this.distance * Math.exp(delta * 0.001));
  }

  attach(el: HTMLElement, onChange: () => void) {
    let last: [number, number] | null = null;
    let mode: "orbit" | "pan" = "orbit";
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    el.addEventListener("pointerdown", (e) => {
      last = [e.clientX, e.clientY];
      mode = e.button === 2 || e.button === 1 || e.shiftKey ? "pan" : "orbit";
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener("pointermove", (e) => {
      if (!last) return;
      const dx = e.clientX - last[0];
      const dy = e.clientY - last[1];
      last = [e.clientX, e.clientY];
      if (mode === "orbit") this.orbit(dx, dy);
      else this.pan(dx, dy, el.clientHeight);
      onChange();
    });
    el.addEventListener("pointerup", () => (last = null));
    el.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.zoom(e.deltaY);
      onChange();
    }, { passive: false });
  }
}
