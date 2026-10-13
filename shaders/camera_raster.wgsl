// Batched camera rasterizer (src/rillfacet/camera_raster.h): every env of a
// chunk in one pass. Entry points:
//   vs_shadow                     depth tile per env from the first directional light
//   vs_main + fs_rgb/fs_geo/fs_all  the env's pinhole proxy (radiance, z-depth, label)
//   cs_remap                      proxy -> distorted output + background + sensor
// Instances are body * n + env (n = envs in the chunk); env e's tile is row
// e % T of layer e / T. SEG_FORMAT / SEG_NONE are substituted at load
// (r16uint / 0xffffu, or r32uint / 0xffffffffu).
enable clip_distances;

const PI: f32 = 3.14159265358979;
const NONE: u32 = SEG_NONE;    // label of "nothing"

struct Frame {
  ambient: vec4f,         // uniform sky radiance (rgb); w = envmap intensity (0 = none)
  misc: vec4f,            // envmap mip count, directional light count, shadows (0/1), bias (m)
  shadow_c: vec4f,        // shadow box center, half extent r (across the light)
  lx: vec4f,              // shadow frame axes; lx.w > 0: the box is centered lx.w
  ly: vec4f,              //   ahead of each env's camera instead of at shadow_c
  lz: vec4f,              // lz = direction the light travels; lz.w = depth range
                          //   toward the light (casters up to there cast)
  dir: array<vec4f, 4>,   // toward each directional light (light 0 casts the shadows)
  col: array<vec4f, 4>,   // its irradiance (rgb)
  sh: array<vec4f, 9>,    // envmap irradiance, SH coefficients (rgb), times intensity
};

struct View {
  proj: vec4f,            // proxy clip: x = proj.x X + proj.y Z, y = proj.z Y + proj.w Z
  zp: vec4f,              // z_clip = zp.x Z + zp.y; near, far
  out: vec4u,             // W, H, output tiles per layer, supersample
  proxy: vec4f,           // proxy W, H, f, 0
  tiles: vec4u,           // proxy tiles per layer T, shadow tiles per layer Ts, shadow res, outputs
  chunk: vec4u,           // e0, n, bodies, material slots
  rng: vec4u,             // seed
  pc: vec4f,              // proxy principal point (cx, cy)
};

@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<uniform> view: View;
// Per env (row): per body (pos, visible), quat xyzw; the camera last.
@group(0) @binding(2) var poses: texture_2d<f32>;

struct Mat { c: vec4f, p: vec4f };    // linear base color, roughness; metallic, texture layer
@group(0) @binding(3) var<storage, read> mats: array<Mat>;
@group(0) @binding(4) var shadow_tex: texture_depth_2d_array;
@group(0) @binding(5) var shadow_cmp: sampler_comparison;
@group(0) @binding(6) var base_tex: texture_2d_array<f32>;
@group(0) @binding(7) var repeat_lin: sampler;
@group(0) @binding(8) var env_tex: texture_2d<f32>;
@group(0) @binding(9) var clamp_lin: sampler;
// Directional albedo of the BRDF by (n_dot_v, roughness): GGX scale and
// bias (F0 * x + y) and Burley diffuse (rillfacet.render.raster.brdf_lut).
@group(0) @binding(19) var brdf_lut: texture_2d<f32>;

fn qrot(q: vec4f, v: vec3f) -> vec3f {
  let t = 2.0 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}

fn srgb(c: vec3f) -> vec3f {
  let x = clamp(c, vec3f(0.0), vec3f(1.0));
  return select(1.055 * pow(x, vec3f(1.0 / 2.4)) - 0.055, 12.92 * x, x <= vec3f(0.0031308));
}

// Equirectangular lookup of a z-up world direction (Mitsuba's envmap
// mapping with the renderers' z-up rotation).
fn env_uv(d: vec3f) -> vec2f {
  return vec2f(atan2(d.x, d.y) / (2.0 * PI), acos(clamp(d.z, -1.0, 1.0)) / PI);
}

fn background(d: vec3f) -> vec3f {
  var c = frame.ambient.rgb;
  if (frame.ambient.w > 0.0) {
    c += textureSampleLevel(env_tex, clamp_lin, env_uv(d), 0.0).rgb * frame.ambient.w;
  }
  return c;
}

// ---- vertex stage -----------------------------------------------------------

struct VIn {
  @location(0) p: vec3f,
  @location(1) n: vec3f,
  @location(2) uv: vec2f,
  @location(3) slot: u32,
};

struct Body { p: vec4f, q: vec4f };   // p.w = visible

fn body(b: u32, e: u32) -> Body {
  return Body(textureLoad(poses, vec2u(2u * b, e), 0), textureLoad(poses, vec2u(2u * b + 1u, e), 0));
}

// Shadow-map coordinates of world point p in env e's box: x, y in [-1, 1]
// across the light, z in [0, 1] from lz.w toward the light to r beyond the
// box center.
fn shadow_xyz(p: vec3f, e: u32) -> vec3f {
  var c = frame.shadow_c.xyz;
  if (frame.lx.w > 0.0) {
    let cb = body(view.chunk.z, e);
    c = cb.p.xyz + qrot(cb.q, vec3f(0.0, 0.0, frame.lx.w));
  }
  let d = p - c;
  let r = frame.shadow_c.w;
  return vec3f(dot(d, frame.lx.xyz) / r, dot(d, frame.ly.xyz) / r,
               (dot(d, frame.lz.xyz) + frame.lz.w) / (frame.lz.w + r));
}

struct SOut { @builtin(position) pos: vec4f, @builtin(clip_distances) cd: array<f32, 2> };

@vertex fn vs_shadow(v: VIn, @builtin(instance_index) inst: u32) -> SOut {
  let n = view.chunk.y;
  let e = inst % n;
  let bp = body(inst / n, e);
  let s = shadow_xyz(bp.p.xyz + qrot(bp.q, v.p), e);
  let x = s.x;
  let y = s.y;
  let z = s.z;
  let Ts = f32(view.tiles.y);
  let t = f32(e % view.tiles.y);
  var o: SOut;
  o.pos = vec4f(x, 1.0 - ((1.0 - y) + 2.0 * t) / Ts, z, 1.0);
  o.cd = array<f32, 2>(1.0 + y, 1.0 - y);
  if (bp.p.w == 0.0) {
    o.pos = vec4f(0.0, 0.0, -1.0, 1.0);
    o.cd = array<f32, 2>(-1.0, -1.0);
  }
  return o;
}

struct VOut {
  @builtin(position) pos: vec4f,
  @builtin(clip_distances) cd: array<f32, 2>,
  @location(0) wp: vec3f,
  @location(1) n: vec3f,
  @location(2) uv: vec2f,
  @location(3) z: f32,
  @location(4) @interpolate(flat) ids: vec4u,   // slot, env (in chunk), body
  @location(5) @interpolate(flat) cam: vec3f,
};

@vertex fn vs_main(v: VIn, @builtin(instance_index) inst: u32) -> VOut {
  let n = view.chunk.y;
  let e = inst % n;
  let b = inst / n;
  let bp = body(b, e);
  let cb = body(view.chunk.z, e);
  let wp = bp.p.xyz + qrot(bp.q, v.p);
  let c = qrot(vec4f(-cb.q.xyz, cb.q.w), wp - cb.p.xyz);   // camera frame (OpenCV)
  let xc = view.proj.x * c.x + view.proj.y * c.z;
  let yc = view.proj.z * c.y + view.proj.w * c.z;
  let w = c.z;
  let T = f32(view.tiles.x);
  let t = f32(e % view.tiles.x);
  var o: VOut;
  o.pos = vec4f(xc, w * (1.0 - (1.0 + 2.0 * t) / T) + yc / T, view.zp.x * c.z + view.zp.y, w);
  o.cd = array<f32, 2>(w + yc, w - yc);
  if (bp.p.w == 0.0) {
    o.pos = vec4f(0.0, 0.0, -1.0, 1.0);
    o.cd = array<f32, 2>(-1.0, -1.0);
  }
  o.wp = wp;
  o.n = qrot(bp.q, v.n);
  o.uv = v.uv;
  o.z = c.z;
  o.ids = vec4u(v.slot, e, b, 0u);
  o.cam = cb.p.xyz;
  return o;
}

// ---- fragment stage ---------------------------------------------------------

struct FIn {
  @location(0) wp: vec3f,
  @location(1) n: vec3f,
  @location(2) uv: vec2f,
  @location(3) z: f32,
  @location(4) @interpolate(flat) ids: vec4u,
  @location(5) @interpolate(flat) cam: vec3f,
};

// Fraction of light 0 reaching p (3x3 PCF in the env's shadow tile).
fn lit(p: vec3f, n: vec3f, e: u32) -> f32 {
  let r = frame.shadow_c.w;
  let res = f32(view.tiles.z);
  let sc = shadow_xyz(p + n * (2.0 * r / res), e);            // one texel of normal offset
  let x = sc.x;
  let y = sc.y;
  let z = sc.z;
  let bias = frame.misc.w / (frame.lz.w + r);
  let Ts = view.tiles.y;
  let t = f32(e % Ts);
  let layer = e / Ts;
  let base = vec2f(0.5 * (x + 1.0), 0.5 * (1.0 - y));
  let texel = 1.0 / res;
  var s = 0.0;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let uvt = clamp(base + vec2f(f32(i), f32(j)) * texel, vec2f(0.5 * texel), vec2f(1.0 - 0.5 * texel));
      let uv = vec2f(uvt.x, (uvt.y + t) / f32(Ts));
      s += textureSampleCompareLevel(shadow_tex, shadow_cmp, uv, layer, z - bias);
    }
  }
  return select(s / 9.0, 1.0, abs(x) > 1.0 || abs(y) > 1.0 || z > 1.0);
}

fn albedo(n_dot_v: f32, roughness: f32) -> vec3f {
  let n = f32(textureDimensions(brdf_lut).x);
  let uv = (vec2f(n_dot_v, roughness) * (n - 1.0) + 0.5) / n;
  return textureSampleLevel(brdf_lut, clamp_lin, uv, 0.0).xyz;
}

fn sh_irradiance(n: vec3f) -> vec3f {
  let s = frame.sh;
  var e = s[0].rgb * 0.282095;
  e += (s[1].rgb * n.y + s[2].rgb * n.z + s[3].rgb * n.x) * 0.488603;
  e += (s[4].rgb * (n.x * n.y) + s[5].rgb * (n.y * n.z) + s[7].rgb * (n.x * n.z)) * 1.092548;
  e += s[6].rgb * (0.315392 * (3.0 * n.z * n.z - 1.0));
  e += s[8].rgb * (0.546274 * (n.x * n.x - n.y * n.y));
  return max(e, vec3f(0.0));
}

fn smith_g1(n_dot: f32, a2: f32) -> f32 {
  return 2.0 * n_dot / (n_dot + sqrt(a2 + (1.0 - a2) * n_dot * n_dot));
}

fn schlick_weight(c: f32) -> f32 {
  let m = clamp(1.0 - c, 0.0, 1.0);
  return m * m * m * m * m;
}

// Linear radiance toward the camera under the directional lights (light 0
// shadowed), the uniform sky and the environment. The BRDF is Mitsuba's
// principled one without sheen / clearcoat / transmission: Burley diffuse
// with retro-reflection, GGX (alpha = roughness^2) with separable Smith
// masking and Schlick's Fresnel toward the base color for metals.
fn shade(i: FIn) -> vec3f {
  let m = mats[(view.chunk.x + i.ids.y) * view.chunk.w + i.ids.x];
  let layer = i32(m.p.y);
  let tex = textureSample(base_tex, repeat_lin, i.uv, max(layer, 0));
  let base = select(m.c.rgb, m.c.rgb * tex.rgb, layer >= 0);
  let rough = clamp(m.c.a, 0.03, 1.0);
  let metal = m.p.x;
  let V = normalize(i.cam - i.wp);
  let face = cross(dpdx(i.wp), dpdy(i.wp));                 // flat shading without normals
  var N = select(normalize(face), normalize(i.n), dot(i.n, i.n) > 1e-12);
  N = select(N, -N, dot(N, V) < 0.0);                        // two-sided
  let NdV = max(dot(N, V), 1e-4);
  let F0 = mix(vec3f(0.04), base, metal);
  let a2 = rough * rough * rough * rough;
  let Fo = schlick_weight(NdV);
  let gv = smith_g1(NdV, a2);
  var c = vec3f(0.0);
  let nd = u32(frame.misc.y);
  for (var l = 0u; l < nd; l++) {
    let L = frame.dir[l].xyz;
    let NdL = dot(N, L);
    if (NdL <= 0.0) { continue; }
    let H = normalize(L + V);
    let NdH = max(dot(N, H), 0.0);
    let LdH = max(dot(L, H), 0.0);
    let dd = NdH * NdH * (a2 - 1.0) + 1.0;
    let D = a2 / (PI * dd * dd);
    let G = gv * smith_g1(NdL, a2);
    let F = F0 + (1.0 - F0) * schlick_weight(LdH);
    let spec = D * G * F / (4.0 * NdV * NdL);
    let Fi = schlick_weight(NdL);
    let rr = 2.0 * rough * LdH * LdH;
    let burley = (1.0 - 0.5 * Fi) * (1.0 - 0.5 * Fo) + rr * (Fo + Fi + Fo * Fi * (rr - 1.0));
    let diff = (1.0 - metal) * base / PI * burley;
    var vis = 1.0;
    if (l == 0u && frame.misc.z > 0.0) { vis = lit(i.wp, N, i.ids.y); }
    c += (diff + spec) * NdL * frame.col[l].rgb * vis;
  }
  // Uniform sky: exactly the BRDF's directional albedo (no occlusion).
  let alb = albedo(NdV, rough);
  let fe = F0 * alb.x + alb.y;
  let diffuse_albedo = base * (1.0 - metal) * alb.z;
  c += frame.ambient.rgb * (diffuse_albedo + fe);
  if (frame.ambient.w > 0.0) {
    c += diffuse_albedo / PI * sh_irradiance(N);
    let R = reflect(-V, N);
    let lod = sqrt(rough) * (frame.misc.x - 1.0);
    c += textureSampleLevel(env_tex, clamp_lin, env_uv(R), lod).rgb * frame.ambient.w * fe;
  }
  return c;
}

struct FRgb { @location(0) c: vec4f };
struct FGeo { @location(0) z: f32, @location(1) s: u32 };
struct FAll { @location(0) c: vec4f, @location(1) z: f32, @location(2) s: u32 };

@fragment fn fs_rgb(i: FIn) -> FRgb {
  return FRgb(vec4f(shade(i), 1.0));
}

@fragment fn fs_geo(i: FIn) -> FGeo {
  return FGeo(i.z, i.ids.z);
}

@fragment fn fs_all(i: FIn) -> FAll {
  return FAll(vec4f(shade(i), 1.0), i.z, i.ids.z);
}

// ---- remap (compute) --------------------------------------------------------

struct Lens { g: vec4f, n: vec4f };   // gain rgb, vignetting; shot, read
@group(0) @binding(10) var<storage, read> lens: array<Lens>;
// Per output pixel: proxy position of the center ray (x, y), d/du (x, y);
// d/dv (x, y), r^2, 0.
@group(0) @binding(11) var<storage, read> remap: array<vec4f>;
@group(0) @binding(12) var proxy_rad: texture_2d_array<f32>;
@group(0) @binding(13) var proxy_depth: texture_2d_array<f32>;
@group(0) @binding(14) var proxy_seg: texture_2d_array<u32>;
@group(0) @binding(15) var out_rgb: texture_storage_2d_array<rgba8unorm, write>;
@group(0) @binding(16) var out_lin: texture_storage_2d_array<rgba16float, write>;
@group(0) @binding(17) var out_depth: texture_storage_2d_array<r32float, write>;
@group(0) @binding(18) var out_seg: texture_storage_2d_array<SEG_FORMAT, write>;

fn pcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}

fn u01(h: u32) -> f32 {
  return (f32(h >> 8u) + 0.5) / 16777216.0;
}

// Three independent standard normals per (seed, env, pixel) (Box-Muller).
fn gauss3(env: u32, pix: u32) -> vec3f {
  let h0 = pcg(view.rng.x ^ pcg(env ^ pcg(pix)));
  let h1 = pcg(h0);
  let h2 = pcg(h1);
  let h3 = pcg(h2);
  let r0 = sqrt(-2.0 * log(u01(h0)));
  let r1 = sqrt(-2.0 * log(u01(h2)));
  let t0 = 2.0 * PI * u01(h1);
  let t1 = 2.0 * PI * u01(h3);
  return vec3f(r0 * cos(t0), r0 * sin(t0), r1 * cos(t1));
}

@compute @workgroup_size(8, 8, 1)
fn cs_remap(@builtin(global_invocation_id) g: vec3u) {
  let W = view.out.x;
  let H = view.out.y;
  let e = g.z;
  if (g.x >= W || g.y >= H || e >= view.chunk.y) { return; }
  let pix = g.y * W + g.x;
  let m0 = remap[2u * pix];
  let m1 = remap[2u * pix + 1u];
  let PW = view.proxy.x;
  let PH = view.proxy.y;
  let T = view.tiles.x;
  let t = e % T;
  let layer = e / T;
  let row0 = f32(t) * PH;
  let atlas_h = f32(T) * PH;
  let To = view.out.z;
  let oxy = vec2u(g.x, (e % To) * H + g.y);
  let olayer = e / To;
  let outputs = view.tiles.w;

  if ((outputs & 3u) != 0u) {
    let S = view.out.w;
    var acc = vec4f(0.0);
    for (var j = 0u; j < S; j++) {
      for (var i = 0u; i < S; i++) {
        let o = (vec2f(f32(i), f32(j)) + 0.5) / f32(S) - 0.5;
        let p = m0.xy + o.x * m0.zw + o.y * m1.xy;            // proxy pixel coordinates
        let q = clamp(p + 0.5, vec2f(0.5), vec2f(PW, PH) - 0.5);
        acc += textureSampleLevel(proxy_rad, clamp_lin, vec2f(q.x / PW, (q.y + row0) / atlas_h),
                                  layer, 0.0);
      }
    }
    acc /= f32(S * S);
    let env = view.chunk.x + e;
    let cq = textureLoad(poses, vec2u(2u * view.chunk.z + 1u, e), 0);
    let ray = vec3f((m0.xy - view.pc.xy) / view.proxy.z, 1.0);
    let L = acc.rgb + (1.0 - acc.a) * background(qrot(cq, normalize(ray)));
    let ln = lens[env];
    var x = ln.g.rgb * (1.0 - ln.g.w * m1.z) * L;
    if (ln.n.x > 0.0 || ln.n.y > 0.0) {
      let v = ln.n.x * max(x, vec3f(0.0)) + ln.n.y * ln.n.y;
      x += sqrt(v) * gauss3(env, pix);
    }
    x = max(x, vec3f(0.0));
    if ((outputs & 1u) != 0u) { textureStore(out_rgb, oxy, olayer, vec4f(srgb(x), 1.0)); }
    if ((outputs & 2u) != 0u) { textureStore(out_lin, oxy, olayer, vec4f(x, 1.0)); }
  }

  if ((outputs & 12u) != 0u) {
    // The center ray's 4 proxy neighbors: the nearest one's label; z-depth
    // interpolated in 1/z (exact on planes) where all 4 are hits of that
    // label at similar depths, else the nearest's.
    let p = m0.xy;
    let p0 = floor(p);
    let f = p - p0;
    var z: array<f32, 4>;
    var s: array<u32, 4>;
    var w: array<f32, 4>;
    var best = 0u;
    for (var k = 0u; k < 4u; k++) {
      let dx = f32(k & 1u);
      let dy = f32(k >> 1u);
      let xi = u32(clamp(p0.x + dx, 0.0, PW - 1.0));
      let yi = u32(clamp(p0.y + dy, 0.0, PH - 1.0)) + t * u32(PH);
      z[k] = textureLoad(proxy_depth, vec2u(xi, yi), layer, 0).r;
      s[k] = textureLoad(proxy_seg, vec2u(xi, yi), layer, 0).r;
      w[k] = select(1.0 - f.x, f.x, dx > 0.0) * select(1.0 - f.y, f.y, dy > 0.0);
      if (w[k] > w[best]) { best = k; }
    }
    let label = s[best];
    let hit = label != NONE;
    var depth = 0.0;
    if (hit) {
      depth = z[best];
      var same = true;
      var zmin = z[0];
      var zmax = z[0];
      var inv = 0.0;
      for (var k = 0u; k < 4u; k++) {
        same = same && s[k] == label;
        zmin = min(zmin, z[k]);
        zmax = max(zmax, z[k]);
        inv += w[k] / max(z[k], 1e-9);
      }
      if (same && zmax - zmin < 0.05 * depth) { depth = 1.0 / inv; }
    }
    if ((outputs & 4u) != 0u) { textureStore(out_depth, oxy, olayer, vec4f(depth, 0.0, 0.0, 0.0)); }
    if ((outputs & 8u) != 0u) { textureStore(out_seg, oxy, olayer, vec4u(label, 0u, 0u, 0u)); }
  }
}
