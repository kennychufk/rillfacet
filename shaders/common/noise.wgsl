// Procedural noise: a line-by-line port of python/rillfacet/solid_texture.py
// (pcg3d, perlin, fbm, worley), which is the spec and the torch reference.
// Keep the two in sync: the tests compare the raster renderer against it.
//
// PCG3D: Jarzynski & Olano 2020, "Hash Functions for GPU Rendering" (uint32
// only). Gradient noise: improved Perlin noise (quintic fade, 16 edge
// gradients). Cellular: Worley F1 / F2 over 27 cells.

const NOISE_TURB_MEAN: f32 = 0.2198;   // mean |perlin|, a faded turbulence octave

fn nz_lerp(a: f32, b: f32, t: f32) -> f32 { return a + (b - a) * t; }

fn nz_smooth(e0: f32, e1: f32, x: f32) -> f32 {
  let t = clamp((x - e0) * (1.0 / (e1 - e0)), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

// Weight of a feature whose period is 1 / f footprints: 1 down to 4, 0 from 2.
fn nz_fade(f: f32) -> f32 { return clamp(2.0 - 4.0 * f, 0.0, 1.0); }

fn pcg3d(a: vec3u) -> vec3u {
  var v = a * 1664525u + 1013904223u;
  v.x += v.y * v.z;
  v.y += v.z * v.x;
  v.z += v.x * v.y;
  v ^= v >> vec3u(16u);
  v.x += v.y * v.z;
  v.y += v.z * v.x;
  v.z += v.x * v.y;
  return v;
}

fn nz_unit(h: u32) -> f32 { return f32(h >> 8u) * (1.0 / 16777216.0); }

fn nz_cell(p: vec3f) -> vec3u { return bitcast<vec3u>(vec3i(floor(p))); }

fn nz_grad(hash: u32, x: f32, y: f32, z: f32) -> f32 {
  let h = hash & 15u;
  let u = select(y, x, h < 8u);
  let v = select(select(z, x, h == 12u || h == 14u), y, h < 4u);
  return select(-u, u, (h & 1u) == 0u) + select(-v, v, (h & 2u) == 0u);
}

// Gradient noise, about -1..1.
fn perlin(p: vec3f) -> f32 {
  let f = p - floor(p);
  let i = nz_cell(p);
  let w = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  var vals: array<f32, 8>;
  for (var k = 0u; k < 8u; k++) {
    let d = vec3u(k & 1u, (k >> 1u) & 1u, k >> 2u);
    let h = pcg3d(i + d).x;
    let df = vec3f(d);
    vals[k] = nz_grad(h, f.x - df.x, f.y - df.y, f.z - df.z);
  }
  let x00 = nz_lerp(vals[0], vals[1], w.x);
  let x10 = nz_lerp(vals[2], vals[3], w.x);
  let x01 = nz_lerp(vals[4], vals[5], w.x);
  let x11 = nz_lerp(vals[6], vals[7], w.x);
  return nz_lerp(nz_lerp(x00, x10, w.y), nz_lerp(x01, x11, w.y), w.z);
}

// Normalized fractal sum (gain 0.5, lacunarity 2): about -1..1 (turbulence:
// 0..1). fw: footprint in units of p (0 = unfiltered).
fn fbm(p: vec3f, octaves: u32, turbulence: bool, fw: f32) -> f32 {
  var tot = 0.0;
  var amp = 1.0;
  var norm = 0.0;
  var s = 1.0;
  for (var o = 0u; o < octaves; o++) {
    var n = perlin(p * s);
    if (turbulence) { n = abs(n); }
    if (fw > 0.0) { n = nz_lerp(select(0.0, NOISE_TURB_MEAN, turbulence), n, nz_fade(fw * s)); }
    tot += n * amp;
    norm += amp;
    amp *= 0.5;
    s *= 2.0;
  }
  return tot * (1.0 / norm);
}

struct Worley { f1: f32, f2: f32, cell: u32 };

// F1, F2 and the hash of the nearest cell.
fn worley(p: vec3f) -> Worley {
  let f = p - floor(p);
  let i = nz_cell(p);
  var F1 = 8.0;
  var F2 = 8.0;
  var cid = 0u;
  for (var dz = -1; dz <= 1; dz++) {
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        let d = vec3i(dx, dy, dz);
        let h = pcg3d(i + bitcast<vec3u>(d));
        let dd = vec3f(d) + vec3f(nz_unit(h.x), nz_unit(h.y), nz_unit(h.z)) - f;
        let r = dd.x * dd.x + dd.y * dd.y + dd.z * dd.z;
        let closer = r < F1;
        F2 = select(min(F2, r), F1, closer);
        cid = select(cid, h.z, closer);
        F1 = select(F1, r, closer);
      }
    }
  }
  return Worley(sqrt(F1), sqrt(F2), cid);
}
