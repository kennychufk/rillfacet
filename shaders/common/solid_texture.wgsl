// Procedural SOLID (3D) textures evaluated at the body-local position: a
// line-by-line port of the families of python/rillfacet/solid_texture.py
// (the spec, its docstring the parameter layout; colors here are linear).
// Needs common/noise.wgsl.

struct SolidRow { v: array<vec4f, 8> };   // the K = 32 parameters

fn sp(r: SolidRow, k: u32) -> f32 { return r.v[k / 4u][k % 4u]; }
fn sp3(r: SolidRow, k: u32) -> vec3f { return vec3f(sp(r, k), sp(r, k + 1u), sp(r, k + 2u)); }

const ST_FAMILY: u32 = 0u;
const ST_SCALE: u32 = 1u;
const ST_OFFSET: u32 = 2u;
const ST_R: u32 = 5u;
const ST_C0: u32 = 14u;
const ST_C1: u32 = 17u;
const ST_C2: u32 = 20u;
const ST_A: u32 = 23u;
const ST_ROUGH0: u32 = 27u;
const ST_ROUGH1: u32 = 28u;
const ST_BUMP: u32 = 29u;
const ST_EPS: u32 = 30u;
const ST_FILTER: u32 = 31u;    // the renderer's: 1 = filter by the footprint

const ST_RING_MEAN: f32 = 13.0 / 35.0;
const ST_EDGE_MEAN: f32 = 0.785;
const ST_SPOT_MEAN: f32 = 0.0891;

fn st_lerp3(a: vec3f, b: vec3f, t: f32) -> vec3f { return a + (b - a) * t; }

// q = R @ (scale * p), p body-local.
fn st_pattern_point(r: SolidRow, p: vec3f) -> vec3f {
  let ps = p * sp(r, ST_SCALE);
  var q: vec3f;
  for (var i = 0u; i < 3u; i++) {
    q[i] = sp(r, ST_R + 3u * i) * ps.x + sp(r, ST_R + 3u * i + 1u) * ps.y
         + sp(r, ST_R + 3u * i + 2u) * ps.z;
  }
  return q;
}

// Noise lookup point (the offset shifts noise only).
fn st_off(r: SolidRow, q: vec3f, k: f32) -> vec3f { return q * k + sp3(r, ST_OFFSET); }

// Each family: vec4(h, linear rgb) at pattern point q, footprint fw.

fn st_wood(r: SolidRow, q: vec3f, fw: f32) -> vec4f {
  let a = vec4f(sp(r, ST_A), sp(r, ST_A + 1u), sp(r, ST_A + 2u), sp(r, ST_A + 3u));
  let x = q.x + a.z;
  let rr = sqrt(x * x + q.y * q.y);
  let qo = st_off(r, q, 1.0);
  let warp = fbm(vec3f(qo.x * 0.8, qo.y * 0.8, qo.z * 0.12), 3u, false, fw * 0.8);
  let tt = (rr + a.y * warp) * a.x;
  let t = tt - floor(tt);
  var ring = nz_smooth(0.0, 0.85, t) * (1.0 - nz_smooth(0.85, 1.0, t));
  ring = ring * ring;
  if (fw > 0.0) { ring = nz_lerp(ST_RING_MEAN, ring, nz_fade(fw * a.x)); }
  let fib = fbm(vec3f(qo.x * 14.0, qo.y * 14.0, qo.z * 0.7), 2u, false, fw * 14.0);
  let h = clamp(ring * (1.0 - a.w) + (fib * 0.5 + 0.5) * a.w, 0.0, 1.0);
  return vec4f(h, st_lerp3(sp3(r, ST_C0), sp3(r, ST_C1), h));
}

fn st_marble(r: SolidRow, q: vec3f, fw: f32) -> vec4f {
  let a0 = sp(r, ST_A);
  let a1 = sp(r, ST_A + 1u);
  let a2 = sp(r, ST_A + 2u);
  let qo = st_off(r, q, 1.0);
  let turb = fbm(qo, 4u, true, fw);
  let s = 0.5 + 0.5 * sin(q.x * a0 + a1 * turb * 6.0);
  let v = clamp(1.0 - s, 0.0, 1.0);
  let v2 = v * v;
  var vein = v2 * v2 * v2 * a2 + v2 * (1.0 - a2);
  if (fw > 0.0) {
    vein = nz_lerp(0.2256 * a2 + 0.375 * (1.0 - a2), vein, nz_fade(fw * a0 * (0.5 / 3.14159265358979)));
  }
  let tint = fbm(vec3f(qo.x * 0.5 + 7.0, qo.y * 0.5, qo.z * 0.5), 2u, false, fw * 0.5) * 0.5 + 0.5;
  let base = st_lerp3(sp3(r, ST_C0), sp3(r, ST_C2), tint * 0.35);
  return vec4f(vein, st_lerp3(base, sp3(r, ST_C1), vein));
}

fn st_granite(r: SolidRow, q: vec3f, fw: f32) -> vec4f {
  let a0 = sp(r, ST_A);
  let a1 = sp(r, ST_A + 1u);
  let a2 = sp(r, ST_A + 2u);
  let w = worley(st_off(r, q, a0));
  let u = nz_unit(w.cell);
  let c0 = sp3(r, ST_C0);
  let c1 = sp3(r, ST_C1);
  let c2 = sp3(r, ST_C2);
  var col = select(c0, c1, u < a1);
  col = select(col, c2, u > 1.0 - a2);
  let edge = nz_smooth(0.0, 0.12, w.f2 - w.f1);
  var h = 1.0 - edge;
  col = col * (0.75 + 0.25 * edge);
  if (fw > 0.0) {
    let k = nz_fade(fw * a0);
    let mean = (c0 * (1.0 - a1 - a2) + c1 * a1 + c2 * a2) * (0.75 + 0.25 * ST_EDGE_MEAN);
    h = nz_lerp(1.0 - ST_EDGE_MEAN, h, k);
    col = st_lerp3(mean, col, k);
  }
  return vec4f(h, col);
}

fn st_stone(r: SolidRow, q0: vec3f, fw: f32) -> vec4f {
  let a0 = sp(r, ST_A);
  let a1 = sp(r, ST_A + 1u);
  let q = st_off(r, q0, 1.0);
  let w = vec3f(fbm(vec3f(q.x + 1.7, q.y + 9.2, q.z), 3u, false, fw),
                fbm(vec3f(q.x + 8.3, q.y + 2.8, q.z + 4.1), 3u, false, fw),
                fbm(vec3f(q.x + 4.4, q.y + 6.6, q.z + 1.3), 3u, false, fw));
  let n = fbm(q + a0 * w, 4u, false, fw);
  let h = clamp(0.5 + a1 * n, 0.0, 1.0);
  let col = st_lerp3(sp3(r, ST_C0), sp3(r, ST_C1), h);
  var spot = nz_smooth(0.55, 0.75, fbm(q * 3.0, 2u, false, fw * 3.0) * 0.5 + 0.5);
  if (fw > 0.0) { spot = nz_lerp(ST_SPOT_MEAN, spot, nz_fade(fw * 3.0)); }
  return vec4f(h, st_lerp3(col, sp3(r, ST_C2), spot * 0.6));
}

// +-1 square wave of period 2 (+1 on even cells), box filtered over w.
fn st_square_box(x: f32, w: f32) -> f32 {
  let g0 = 2.0 * fract((x + 0.5 * w) * 0.5);
  let g1 = 2.0 * fract((x - 0.5 * w) * 0.5);
  return (min(g0, 2.0 - g0) - min(g1, 2.0 - g1)) / w;
}

fn st_checker(r: SolidRow, q: vec3f, fw: f32) -> vec4f {
  let c0 = sp3(r, ST_C0);
  let c1 = sp3(r, ST_C1);
  if (fw > 0.0) {
    let w = max(fw, 1e-3);
    let prod = st_square_box(q.x, w) * st_square_box(q.y, w) * st_square_box(q.z, w);
    let h = 0.5 - 0.5 * prod;
    return vec4f(h, st_lerp3(c0, c1, h));
  }
  let s = floor(q.x) + floor(q.y) + floor(q.z);
  let odd = (s - 2.0 * floor(s * 0.5)) > 0.5;
  return vec4f(select(0.0, 1.0, odd), select(c0, c1, odd));
}

// vec4(h, linear rgb) of the row's family at body-local p; footprint fl (m)
// (used when the row's ST_FILTER is set).
fn solid_texture(r: SolidRow, p: vec3f, fl: f32) -> vec4f {
  let q = st_pattern_point(r, p);
  let fw = fl * sp(r, ST_SCALE) * sp(r, ST_FILTER);
  switch (min(u32(sp(r, ST_FAMILY)), 5u)) {
    case 1u: { return st_wood(r, q, fw); }
    case 2u: { return st_marble(r, q, fw); }
    case 3u: { return st_granite(r, q, fw); }
    case 4u: { return st_stone(r, q, fw); }
    case 5u: { return st_checker(r, q, fw); }
    default: { return vec4f(0.0, sp3(r, ST_C0)); }
  }
}
