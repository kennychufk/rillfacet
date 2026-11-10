// Procedural UV (2D) textures evaluated at the metric UVs: a line-by-line
// port of the families of python/rillfacet/uv_texture.py (the spec, its
// docstring the parameter layout; colors here are linear). A UV row shares
// the solid rows' buffer and struct (SolidRow); its family is stored plus
// UT_FAMILY_OFFSET. Needs common/noise.wgsl and common/solid_texture.wgsl.

const UT_FAMILY_OFFSET: f32 = 64.0;
const UT_OFFSET: u32 = 2u;
const UT_ROT: u32 = 4u;
const UT_SEED: u32 = 6u;
const UT_B: u32 = 7u;
const UT_PI: f32 = 3.14159265358979;
const UT_SQRT3: f32 = 1.7320508075688772;
const UT_WEAVE_H_MEAN: f32 = 0.5;

// Glyph segments: center (x, y) in multiples of the glyph box (W, H), half
// extents (x, y) in multiples of (W, H), plus half a stroke each.
const UT_SEGMENTS = array<vec4f, 9>(
  vec4f(0.5, 0.0, 0.5, 0.0), vec4f(0.5, 0.5, 0.5, 0.0), vec4f(0.5, 1.0, 0.5, 0.0),
  vec4f(0.0, 0.25, 0.0, 0.25), vec4f(0.0, 0.75, 0.0, 0.25),
  vec4f(0.5, 0.25, 0.0, 0.25), vec4f(0.5, 0.75, 0.0, 0.25),
  vec4f(1.0, 0.25, 0.0, 0.25), vec4f(1.0, 0.75, 0.0, 0.25));

fn ut_fract(x: f32) -> f32 { return x - floor(x); }
fn ut_u32f(x: f32) -> u32 { return bitcast<u32>(i32(floor(x))); }
fn ut_seed(r: SolidRow) -> u32 { return ut_u32f(sp(r, UT_SEED)); }
fn ut_hash(x: f32, y: f32, seed: u32) -> vec3u { return pcg3d(vec3u(ut_u32f(x), ut_u32f(y), seed)); }

fn ut_rand2(h: u32) -> vec2f {
  return vec2f(nz_unit(h * 0x27D4EB2Du), nz_unit((h ^ (h >> 15u)) * 0x165667B1u));
}

// Coverage of d >= 0 (a signed distance, pattern units), smoothed over fw.
fn ut_cover(d: f32, fw: f32) -> f32 {
  if (fw > 0.0) { return clamp(d / max(fw, 1e-6) + 0.5, 0.0, 1.0); }
  return select(0.0, 1.0, d >= 0.0);
}

fn ut_F(y: f32, width: f32) -> f32 {
  let fl = floor(y);
  return fl * width + min(y - fl, width);
}

// Coverage of fract(x - lo) < width, box filtered over fw.
fn ut_pulse(x: f32, lo: f32, width: f32, fw: f32) -> f32 {
  if (fw > 0.0) {
    let w = max(fw, 1e-2);
    let xr = ut_fract(x) - lo;
    return clamp((ut_F(xr + 0.5 * w, width) - ut_F(xr - 0.5 * w, width)) / w, 0.0, 1.0);
  }
  return select(0.0, 1.0, ut_fract(x - lo) < width);
}

fn ut_round_box(px: f32, py: f32, hx: f32, hy: f32, r: f32) -> f32 {
  let qx = abs(px) - hx + r;
  let qy = abs(py) - hy + r;
  let mx = max(qx, 0.0);
  let my = max(qy, 0.0);
  return sqrt(mx * mx + my * my) + min(max(qx, qy), 0.0) - r;
}

fn ut_a(r: SolidRow) -> vec4f {
  return vec4f(sp(r, ST_A), sp(r, ST_A + 1u), sp(r, ST_A + 2u), sp(r, ST_A + 3u));
}

// Each family: vec4(h, linear rgb) at pattern point q, footprint fw.

fn ut_stripes(r: SolidRow, q: vec2f, fw: f32) -> vec4f {
  let a = ut_a(r);
  let b0 = sp(r, UT_B);
  let x = q.x + a.y * sin(q.y * a.z);
  let s1 = ut_pulse(x, 0.0, a.x, fw);
  let s2 = ut_pulse(x, a.x + 0.5 * (1.0 - a.x) - 0.5 * b0, b0, fw);
  let col = st_lerp3(st_lerp3(sp3(r, ST_C0), sp3(r, ST_C1), s1), sp3(r, ST_C2), s2);
  return vec4f(clamp(s1 + 0.5 * s2, 0.0, 1.0), col);
}

fn ut_tiles(r: SolidRow, q: vec2f, fw: f32) -> vec4f {
  let a = ut_a(r);
  let ar = sp(r, UT_B);
  let y = q.y / ar;
  let j = floor(y);
  let x = q.x + a.y * j;
  let cx = ut_pulse(x, a.x, 1.0 - 2.0 * a.x, fw);
  let cy = ut_pulse(y, a.x / ar, 1.0 - 2.0 * a.x / ar, fw / ar);
  let t = cx * cy;
  let hx = ut_hash(x, y, ut_seed(r)).x;
  let c0 = sp3(r, ST_C0);
  let c2 = sp3(r, ST_C2);
  var tile = st_lerp3(c0, c2, a.z * nz_unit(hx));
  if (fw > 0.0) {
    tile = st_lerp3(st_lerp3(c0, c2, 0.5 * a.z), tile, nz_fade(fw * (1.0 / min(ar, 1.0))));
  }
  return vec4f(t, st_lerp3(sp3(r, ST_C1), tile, t));
}

struct UtDisc { cov: f32, h: u32 };

fn ut_disc(r: SolidRow, q: vec2f, rad: f32, jitter: f32, rvar: f32, stagger: f32, fw: f32) -> UtDisc {
  let y = q.y;
  let x = q.x + stagger * floor(y);
  let hh = ut_hash(x, y, ut_seed(r));
  let rr = rad * (1.0 - rvar * nz_unit(hh.z));
  let room = 0.5 - rr;
  let cx = 0.5 + jitter * room * (2.0 * nz_unit(hh.x) - 1.0);
  let cy = 0.5 + jitter * room * (2.0 * nz_unit(hh.y) - 1.0);
  let dx = ut_fract(x) - cx;
  let dy = ut_fract(y) - cy;
  return UtDisc(ut_cover(rr - sqrt(dx * dx + dy * dy), fw), hh.z);
}

fn ut_dots(r: SolidRow, q: vec2f, fw: f32) -> vec4f {
  let a = ut_a(r);
  let d = ut_disc(r, q, a.x, a.y, a.z, sp(r, UT_B), fw);
  let c1 = sp3(r, ST_C1);
  let c2 = sp3(r, ST_C2);
  var dot = select(c1, c2, nz_unit(d.h * 0x27D4EB2Du) < a.w);
  var cov = d.cov;
  if (fw > 0.0) {
    let mr = a.x * (1.0 - 0.5 * a.z);
    let k = nz_fade(fw);
    cov = nz_lerp(UT_PI * mr * mr, cov, k);
    dot = st_lerp3(st_lerp3(c1, c2, a.w), dot, k);
  }
  return vec4f(cov, st_lerp3(sp3(r, ST_C0), dot, cov));
}

fn ut_perforated(r: SolidRow, q: vec2f, fw: f32) -> vec4f {
  let a0 = sp(r, ST_A);
  var cov = ut_disc(r, q, a0, 0.0, 0.0, sp(r, UT_B), fw).cov;
  if (fw > 0.0) { cov = nz_lerp(UT_PI * a0 * a0, cov, nz_fade(fw)); }
  return vec4f(1.0 - cov, st_lerp3(sp3(r, ST_C0), sp3(r, ST_C1), cov));
}

fn ut_hexagons(r: SolidRow, q: vec2f, fw: f32) -> vec4f {
  let a = ut_a(r);
  let hy = 0.5 * UT_SQRT3;
  let ax = q.x - floor(q.x) - 0.5;
  let ay = q.y - UT_SQRT3 * floor(q.y * (1.0 / UT_SQRT3)) - hy;
  let bxs = q.x - 0.5;
  let bys = q.y - hy;
  let bx = bxs - floor(bxs) - 0.5;
  let by = bys - UT_SQRT3 * floor(bys * (1.0 / UT_SQRT3)) - hy;
  let near_a = ax * ax + ay * ay < bx * bx + by * by;
  let gx = select(bx, ax, near_a);
  let gy = select(by, ay, near_a);
  let cx = q.x - gx;
  let cy = q.y - gy;
  let h0 = ut_hash(cx * 2.0 + 0.5, cy * (1.0 / hy) + 0.5, ut_seed(r)).x;
  let d = max(abs(gx), abs(gx) * 0.5 + abs(gy) * hy);
  var t = ut_cover(0.5 - d - a.x, fw);
  let c0 = sp3(r, ST_C0);
  let c2 = sp3(r, ST_C2);
  var cell = st_lerp3(c0, c2, a.y * nz_unit(h0));
  if (fw > 0.0) {
    let k = nz_fade(fw);
    cell = st_lerp3(st_lerp3(c0, c2, 0.5 * a.y), cell, k);
    let f = 1.0 - 2.0 * a.x;
    t = nz_lerp(f * f, t, k);
  }
  return vec4f(t, st_lerp3(sp3(r, ST_C1), cell, t));
}

fn ut_weave(r: SolidRow, q: vec2f, fw: f32) -> vec4f {
  let a = ut_a(r);
  let i = floor(q.x);
  let j = floor(q.y);
  let fx = q.x - i;
  let fy = q.y - j;
  let s = i + j;
  let warp = (s - 2.0 * floor(s * 0.5)) < 0.5;
  let across = select(abs(fy - 0.5), abs(fx - 0.5), warp) * 2.0;
  let along = select(fx, fy, warp);
  let width = 1.0 - a.x;
  let on = ut_cover((width - across) * 0.5, fw);
  let t = clamp(across / width, 0.0, 1.0);
  let prof = 1.0 - t * t;
  let bulge = 0.75 + 0.25 * sin(along * UT_PI);
  let z = sp(r, UT_SEED) * (1.0 / 65536.0);
  let oa = select(q.y, q.x, warp);
  let ob = select(q.x, q.y, warp);
  var fib = perlin(vec3f(oa * 9.0, ob * 0.7, z)) * a.y;
  if (fw > 0.0) { fib = nz_lerp(0.0, fib, nz_fade(fw * 9.0)); }
  var h = clamp((prof * bulge + fib) * on + 0.15 * (1.0 - on), 0.0, 1.0);
  let c0 = sp3(r, ST_C0);
  let c1 = sp3(r, ST_C1);
  var col = st_lerp3(select(c0, c1, warp), select(c1, c0, warp), on);
  if (fw > 0.0) {
    let w = nz_fade(fw);
    h = nz_lerp(UT_WEAVE_H_MEAN, h, w);
    col = st_lerp3(st_lerp3(c0, c1, 0.5), col, w);
  }
  let shade = (1.0 - a.z) + a.z * h;
  return vec4f(h, col * shade);
}

fn ut_brushed(r: SolidRow, q: vec2f, fw: f32) -> vec4f {
  let a = ut_a(r);
  let z = sp(r, UT_SEED) * (1.0 / 65536.0);
  let n = fbm(vec3f(q.x * a.y, q.y * a.z, z), 4u, false, fw * a.z);
  let h = clamp(0.5 + n, 0.0, 1.0);
  return vec4f(h, st_lerp3(sp3(r, ST_C0), sp3(r, ST_C1), a.x * h));
}

fn ut_twill(r: SolidRow, q: vec2f, fw: f32) -> vec4f {
  let a = ut_a(r);
  let i = floor(q.x);
  let j = floor(q.y);
  let fx = q.x - i;
  let fy = q.y - j;
  let s = i - j;
  let m = s - 4.0 * floor(s * 0.25);
  let warp = m < 1.5;
  let across = select(fy, fx, warp);
  var fiber = 0.5 + 0.5 * sin(across * (2.0 * UT_PI) * a.x);
  var edge = nz_smooth(0.0, a.z, across) * nz_smooth(0.0, a.z, 1.0 - across);
  var tow = select(1.0 - a.y, 1.0, warp);
  if (fw > 0.0) {
    fiber = nz_lerp(0.5, fiber, nz_fade(fw * a.x));
    edge = nz_lerp(1.0 - a.z, edge, nz_fade(fw * (0.5 / a.z)));
    tow = nz_lerp(1.0 - 0.5 * a.y, tow, nz_fade(fw));
  }
  let tone = tow * (0.85 + 0.15 * fiber) * (0.55 + 0.45 * edge);
  return vec4f(clamp(tone, 0.0, 1.0), st_lerp3(sp3(r, ST_C1), sp3(r, ST_C0), tone));
}

fn ut_decals(r: SolidRow, q: vec2f, fw: f32) -> vec4f {
  let a = ut_a(r);
  let fx = ut_fract(q.x);
  let fy = ut_fract(q.y);
  let hh = ut_hash(q.x, q.y, ut_seed(r));
  let r34 = ut_rand2(hh.x);
  let w = nz_lerp(a.y, a.z, nz_unit(hh.x));
  let h = nz_lerp(a.y, a.z, nz_unit(hh.y));
  let cx = 0.5 + (0.5 - w) * (2.0 * r34.x - 1.0);
  let cy = 0.5 + (0.5 - h) * (2.0 * r34.y - 1.0);
  let present = nz_unit(hh.z) < a.x;
  let sd = ut_round_box(fx - cx, fy - cy, w, h, min(a.w, min(w, h)));
  var cov = select(0.0, ut_cover(-sd, fw), present);
  let c1 = sp3(r, ST_C1);
  let c2 = sp3(r, ST_C2);
  var ink = select(c2, c1, (hh.z & 1u) == 0u);
  if (fw > 0.0) {
    let mm = 0.5 * (a.y + a.z);
    let k = nz_fade(fw);
    cov = nz_lerp(a.x * 4.0 * mm * mm, cov, k);
    ink = st_lerp3(st_lerp3(c1, c2, 0.5), ink, k);
  }
  return vec4f(cov, st_lerp3(sp3(r, ST_C0), ink, cov));
}

fn ut_stickers(r: SolidRow, q: vec2f, fw: f32) -> vec4f {
  let a = ut_a(r);
  let b1 = sp(r, UT_B + 1u);
  let fx = ut_fract(q.x);
  let fy = ut_fract(q.y);
  let hh = ut_hash(q.x, q.y, ut_seed(r));
  let r34 = ut_rand2(hh.x);
  let s = nz_lerp(a.y, a.z, nz_unit(hh.x));
  let cx = 0.5 + (0.5 - s) * (2.0 * r34.x - 1.0);
  let cy = 0.5 + (0.5 - s) * (2.0 * r34.y - 1.0);
  let present = nz_unit(hh.z) < a.x;
  let sd = ut_round_box(fx - cx, fy - cy, s, s, b1 * s);
  var shape = select(0.0, ut_cover(-sd, fw), present);
  var fill = ut_cover(-sd - a.w * s, fw);
  if (fw > 0.0) {
    let mm = 0.5 * (a.y + a.z);
    let k = nz_fade(fw);
    shape = nz_lerp(a.x * 4.0 * mm * mm * (1.0 - (4.0 - UT_PI) / 4.0 * b1 * b1), shape, k);
    let kk = 1.0 - a.w;
    fill = nz_lerp(kk * kk, fill, k);
  }
  let inner = st_lerp3(sp3(r, ST_C2), sp3(r, ST_C1), fill);
  return vec4f(shape, st_lerp3(sp3(r, ST_C0), inner, shape));
}

fn ut_glyphs(r: SolidRow, q: vec2f, fw: f32) -> vec4f {
  let a = ut_a(r);
  let b0 = sp(r, UT_B);
  let b1 = sp(r, UT_B + 1u);
  let seed = ut_seed(r);
  let j = floor(q.y);
  let fy = q.y - j;
  let gx = q.x / b0;
  let gi = floor(gx);
  let col = floor(gi / b1);
  let pos = gi - col * b1;
  let hl = pcg3d(vec3u(ut_u32f(col), ut_u32f(j), seed ^ 0x2C1B3C6Du));
  let len = b1 * (0.35 + 0.65 * nz_unit(hl.y)) - 2.0;
  let hg = pcg3d(vec3u(ut_u32f(gi), ut_u32f(j), seed ^ 0x5BD1E995u));
  let show = nz_unit(hl.x) >= a.x && pos < len && nz_unit(hg.z) >= a.y;
  let W = 0.7 * b0;
  let H = 0.6;
  let px = (gx - gi) * b0 - 0.15 * b0;
  let py = fy - 0.2;
  var ink = 0.0;
  for (var k = 0u; k < 9u; k++) {
    let sg = UT_SEGMENTS[k];
    let sd = ut_round_box(px - sg.x * W, py - sg.y * H, sg.z * W + 0.5 * a.z,
                          sg.w * H + 0.5 * a.z, 0.0);
    if (((hg.x >> k) & 1u) == 1u) { ink = max(ink, ut_cover(-sd, fw)); }
  }
  ink = select(0.0, ink, show);
  if (fw > 0.0) {
    let shown = (1.0 - a.x) * (1.0 - a.y) * (0.675 - 2.0 / b1);
    let per = (1.5 * W * a.z + 2.0 * H * a.z) / b0;
    ink = nz_lerp(shown * per, ink, nz_fade(fw * (0.25 / a.z)));
  }
  return vec4f(ink, st_lerp3(sp3(r, ST_C0), sp3(r, ST_C1), ink));
}

// q = Rot @ (scale * uv) + offset, uv metric (m).
fn ut_pattern_point(r: SolidRow, uv: vec2f) -> vec2f {
  let s = sp(r, ST_SCALE);
  let c = sp(r, UT_ROT);
  let sn = sp(r, UT_ROT + 1u);
  let x = uv.x * s;
  let y = uv.y * s;
  return vec2f(c * x - sn * y + sp(r, UT_OFFSET), sn * x + c * y + sp(r, UT_OFFSET + 1u));
}

fn ut_is_uv(r: SolidRow) -> bool { return sp(r, ST_FAMILY) >= UT_FAMILY_OFFSET - 0.5; }

// vec4(h, linear rgb) of a UV row's family at metric uv; footprint fu (m)
// (used when the row's ST_FILTER is set).
fn uv_texture(r: SolidRow, uv: vec2f, fu: f32) -> vec4f {
  let q = ut_pattern_point(r, uv);
  let fw = fu * sp(r, ST_SCALE) * sp(r, ST_FILTER);
  switch (min(u32(round(sp(r, ST_FAMILY) - UT_FAMILY_OFFSET)), 11u)) {
    case 1u: { return ut_stripes(r, q, fw); }
    case 2u: { return ut_tiles(r, q, fw); }
    case 3u: { return ut_dots(r, q, fw); }
    case 4u: { return ut_hexagons(r, q, fw); }
    case 5u: { return ut_weave(r, q, fw); }
    case 6u: { return ut_brushed(r, q, fw); }
    case 7u: { return ut_perforated(r, q, fw); }
    case 8u: { return ut_twill(r, q, fw); }
    case 9u: { return ut_decals(r, q, fw); }
    case 10u: { return ut_glyphs(r, q, fw); }
    case 11u: { return ut_stickers(r, q, fw); }
    default: { return vec4f(0.0, sp3(r, ST_C0)); }
  }
}

// A UV row's bumped normal: finite differences of h along u and v times the
// surface gradients of u and v, which come from the pixel derivatives of the
// body-local position (dpx, dpy) and the uv (dux, duy), body-local through
// the body's rotation q (as Mitsuba's backend: N - grad h * bump).
fn uv_bump(r: SolidRow, uv: vec2f, fu: f32, h0: f32, N: vec3f, q: vec4f,
           dpx: vec3f, dpy: vec3f, dux: vec2f, duy: vec2f) -> vec3f {
  let g11 = dot(dpx, dpx);
  let g12 = dot(dpx, dpy);
  let g22 = dot(dpy, dpy);
  let det = g11 * g22 - g12 * g12;
  if (!(det > 1e-6 * g11 * g22)) { return N; }
  let inv = 1.0 / det;
  let gu = ((g22 * dux.x - g12 * duy.x) * dpx + (g11 * duy.x - g12 * dux.x) * dpy) * inv;
  let gv = ((g22 * dux.y - g12 * duy.y) * dpx + (g11 * duy.y - g12 * dux.y) * dpy) * inv;
  let eps = sp(r, ST_EPS) / sp(r, ST_SCALE);
  let h1 = uv_texture(r, uv + vec2f(eps, 0.0), fu).x;
  let h2 = uv_texture(r, uv + vec2f(0.0, eps), fu).x;
  let g = qrot(q, gu * (h1 - h0) + gv * (h2 - h0)) * (sp(r, ST_BUMP) / eps);
  return normalize(N - g);
}
