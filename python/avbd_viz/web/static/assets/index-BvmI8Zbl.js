(function(){let e=document.createElement(`link`).relList;if(e&&e.supports&&e.supports(`modulepreload`))return;for(let e of document.querySelectorAll(`link[rel="modulepreload"]`))n(e);new MutationObserver(e=>{for(let t of e)if(t.type===`childList`)for(let e of t.addedNodes)e.tagName===`LINK`&&e.rel===`modulepreload`&&n(e)}).observe(document,{childList:!0,subtree:!0});function t(e){let t={};return e.integrity&&(t.integrity=e.integrity),e.referrerPolicy&&(t.referrerPolicy=e.referrerPolicy),t.credentials=e.crossOrigin===`use-credentials`?`include`:e.crossOrigin===`anonymous`?`omit`:`same-origin`,t}function n(e){if(e.ep)return;e.ep=!0;let n=t(e);fetch(e.href,n)}})();var e={float32:Float32Array,int32:Int32Array,uint32:Uint32Array,int16:Int16Array,uint16:Uint16Array,uint8:Uint8Array};function t(e){return typeof e==`object`&&!!e&&`data`in e&&`shape`in e}function n(t){let n=new Uint8Array(t,0,4);if(String.fromCharCode(...n)!==`AVZ1`)throw Error(`bad message magic`);let r=new DataView(t).getUint32(4,!0),i=JSON.parse(new TextDecoder().decode(new Uint8Array(t,8,r))),a=i.$buffers??[];delete i.$buffers;let o=a.map(n=>{let r=e[n.dtype];return{data:new r(t,n.offset,n.nbytes/r.BYTES_PER_ELEMENT),shape:n.shape}}),s=e=>{if(Array.isArray(e))return e.map(s);if(e&&typeof e==`object`){let t=e,n=Object.keys(t);if(n.length===1&&n[0]===`$b`)return o[t.$b];for(let e of n)t[e]=s(t[e])}return e};return s(i)}var r=e=>{if(!Number.isFinite(e))return String(e);let t=Math.abs(e);return t!==0&&(t<.001||t>=1e5)?e.toExponential(2):e.toFixed(t>=100?1:3)},i=class{statusEl;clockEl;scalarsEl;tableEl;focus=-1;onFocus=()=>{};constructor(e){e.innerHTML=`
      <div class="head"><span class="dot"></span><span class="status"></span></div>
      <div class="clock"></div>
      <h3>Batch</h3><div class="scalars"></div>
      <h3>Envs</h3><div class="table"></div>`,this.statusEl=e.querySelector(`.head`),this.clockEl=e.querySelector(`.clock`),this.scalarsEl=e.querySelector(`.scalars`),this.tableEl=e.querySelector(`.table`),this.tableEl.addEventListener(`click`,e=>{let t=e.target.closest(`tr[data-env]`);if(!t)return;let n=Number(t.dataset.env);this.focus=this.focus===n?-1:n,this.onFocus(this.focus)})}setStatus(e){let t=e.status===`live`;this.statusEl.className=`head ${t?`ok`:e.status===`connecting`?`wait`:`bad`}`,this.statusEl.querySelector(`.status`).textContent=`${e.name||`avbd-viz`} — ${e.status}`;let n=e.lastFrameAt?(performance.now()-e.lastFrameAt)/1e3:NaN;this.clockEl.textContent=`step ${e.time??`–`} · ${e.frames} frames (${e.dropped} dropped) · ${e.fps.toFixed(1)} fps · last ${Number.isFinite(n)?n.toFixed(1)+` s`:`–`} ago`}setChannels(e,n){let i=[],a=[];for(let[r,o]of Object.entries(e))typeof o==`number`?i.push([r,o]):t(o)&&o.shape.length===1&&o.shape[0]===n&&a.push([r,o]);if(this.scalarsEl.innerHTML=i.length?`<table>${i.map(([e,t])=>`<tr><td>${e}</td><td class="num">${r(t)}</td></tr>`).join(``)}</table>`:`<div class="empty">none</div>`,!a.length){this.tableEl.innerHTML=`<div class="empty">none</div>`;return}let o=`<tr><th>env</th>${a.map(([e])=>`<th>${e}</th>`).join(``)}</tr>`,s=[];for(let e=0;e<n;e++){let t=e===this.focus?` class="focus"`:``;s.push(`<tr data-env="${e}"${t}><td>${e}</td>${a.map(([,t])=>`<td class="num">${r(t.data[e])}</td>`).join(``)}</tr>`)}this.tableEl.innerHTML=`<table>${o}${s.join(``)}</table>`}},a=`// Web client: the native viewer's background gradient (frame.bg_top at the
// top of the view, frame.bg_bottom at the bottom), one full-screen triangle.
// Per-frame constants shared by every pass.
// Must match \`FrameUniforms\` in src/avbd_viz/renderer.h field for field.
struct Frame {
  view: mat4x4f,
  proj: mat4x4f,
  view_proj: mat4x4f,
  inv_view_proj: mat4x4f,
  inv_proj: mat4x4f,
  inv_view: mat4x4f,
  light_view_proj: mat4x4f,  // sun shadow map projection
  camera_pos: vec4f,         // xyz = eye, w = 1 when orthographic
  viewport: vec4f,           // width, height, 1/width, 1/height (pixels)
  sun_dir: vec4f,            // world direction toward the sun, w = shadow strength
  bg_top: vec4f,             // background gradient, linear rgb
  bg_bottom: vec4f,
  grid_minor: vec4f,         // grid line colors (linear rgb, a = opacity)
  grid_major: vec4f,
  grid_params: vec4f,        // x = plane offset, y = fade distance, z = grid on, w = ground shadow on
  grid_plane: vec4f,         // x = normal axis (0 x, 1 y, 2 z), y = 1 behind everything, z/w = in-plane u/v axes
  axis_u: vec4f,             // color of the u axis line (v = 0) on the grid plane
  axis_v: vec4f,             // color of the v axis line (u = 0)
  wire: vec4f,               // rgb = wire color, a = line width in pixels (0 = off)
  wire_mode: vec4f,          // x = 1 in wireframe shading, y = face opacity, z = 1 wires take object colors
  select_color: vec4f,
  active_color: vec4f,       // the most recently selected element
  outline_color: vec4f,
  style: vec4f,              // x = ao strength, y = exposure, z = shadows on, w = outline mode
  style2: vec4f,             // per-style knobs, see shaders/styles/*.wgsl
  env: vec4f,                // x = env rotation (rad), y = env intensity, z = max mip level
  ao: vec4f,                 // x = radius (world), y = bias, z = intensity
  post: vec4f,               // x = tonemap (0 clamp, 1 PBR neutral), y = outline width px
  slice: vec4f,              // slice plane: xyz = unit normal toward the cut-away side, w = offset
  sh: array<vec4f, 9>,       // environment irradiance (spherical harmonics, order 2)
};

@group(0) @binding(0) var<uniform> frame: Frame;

const PI: f32 = 3.14159265358979;

fn srgb_to_linear(c: vec3f) -> vec3f {
  return select(pow((c + 0.055) / 1.055, vec3f(2.4)), c / 12.92, c <= vec3f(0.04045));
}

fn linear_to_srgb(c: vec3f) -> vec3f {
  let x = clamp(c, vec3f(0.0), vec3f(1.0));
  return select(1.055 * pow(x, vec3f(1.0 / 2.4)) - 0.055, x * 12.92, x <= vec3f(0.0031308));
}

// Colors stored as packed sRGB bytes (r | g << 8 | b << 16 | a << 24).
fn unpack_srgb(c: u32) -> vec3f {
  return srgb_to_linear(unpack4x8unorm(c).rgb);
}

fn is_ortho() -> bool {
  return frame.camera_pos.w > 0.5;
}

// Unit vector from a world point toward the viewer.
fn view_dir(p: vec3f) -> vec3f {
  if (is_ortho()) {
    return normalize(vec3f(frame.view[0].z, frame.view[1].z, frame.view[2].z));
  }
  return normalize(frame.camera_pos.xyz - p);
}

// Distance in front of the camera for a (reversed-Z) depth buffer value.
// Works for both projections; depth 0 (nothing drawn) maps to very far.
fn view_depth(depth: f32) -> f32 {
  let v = frame.inv_proj * vec4f(0.0, 0.0, max(depth, 1e-7), 1.0);
  return -v.z / v.w;
}

// True when the scene surface at \`scene_depth\` is in front of a point at
// \`depth\` (both depth-buffer values), with a small relative tolerance.
fn occluded(scene_depth: f32, depth: f32) -> bool {
  let z = view_depth(depth);
  return view_depth(scene_depth) < z * 0.997 - 1e-4;
}

// World -> view-space direction (view space: +x right, +y up, +z toward the viewer).
fn to_view(n: vec3f) -> vec3f {
  return normalize((frame.view * vec4f(n, 0.0)).xyz);
}


struct VsOut {
  @builtin(position) clip: vec4f,
  @location(0) t: f32,
};

@vertex
fn vs_main(@builtin(vertex_index) i: u32) -> VsOut {
  let xy = vec2f(f32((i << 1u) & 2u), f32(i & 2u)) * 2.0 - 1.0;
  var out: VsOut;
  out.clip = vec4f(xy, 0.0, 1.0);
  out.t = xy.y * 0.5 + 0.5;
  return out;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4f {
  return vec4f(linear_to_srgb(mix(frame.bg_bottom.rgb, frame.bg_top.rgb, in.t)), 1.0);
}
`,o=`// Web client: small geometry rebuilt on the CPU when it changes (meter boxes,
// markers): world-space vertices with a packed sRGB color each.
// Per-frame constants shared by every pass.
// Must match \`FrameUniforms\` in src/avbd_viz/renderer.h field for field.
struct Frame {
  view: mat4x4f,
  proj: mat4x4f,
  view_proj: mat4x4f,
  inv_view_proj: mat4x4f,
  inv_proj: mat4x4f,
  inv_view: mat4x4f,
  light_view_proj: mat4x4f,  // sun shadow map projection
  camera_pos: vec4f,         // xyz = eye, w = 1 when orthographic
  viewport: vec4f,           // width, height, 1/width, 1/height (pixels)
  sun_dir: vec4f,            // world direction toward the sun, w = shadow strength
  bg_top: vec4f,             // background gradient, linear rgb
  bg_bottom: vec4f,
  grid_minor: vec4f,         // grid line colors (linear rgb, a = opacity)
  grid_major: vec4f,
  grid_params: vec4f,        // x = plane offset, y = fade distance, z = grid on, w = ground shadow on
  grid_plane: vec4f,         // x = normal axis (0 x, 1 y, 2 z), y = 1 behind everything, z/w = in-plane u/v axes
  axis_u: vec4f,             // color of the u axis line (v = 0) on the grid plane
  axis_v: vec4f,             // color of the v axis line (u = 0)
  wire: vec4f,               // rgb = wire color, a = line width in pixels (0 = off)
  wire_mode: vec4f,          // x = 1 in wireframe shading, y = face opacity, z = 1 wires take object colors
  select_color: vec4f,
  active_color: vec4f,       // the most recently selected element
  outline_color: vec4f,
  style: vec4f,              // x = ao strength, y = exposure, z = shadows on, w = outline mode
  style2: vec4f,             // per-style knobs, see shaders/styles/*.wgsl
  env: vec4f,                // x = env rotation (rad), y = env intensity, z = max mip level
  ao: vec4f,                 // x = radius (world), y = bias, z = intensity
  post: vec4f,               // x = tonemap (0 clamp, 1 PBR neutral), y = outline width px
  slice: vec4f,              // slice plane: xyz = unit normal toward the cut-away side, w = offset
  sh: array<vec4f, 9>,       // environment irradiance (spherical harmonics, order 2)
};

@group(0) @binding(0) var<uniform> frame: Frame;

const PI: f32 = 3.14159265358979;

fn srgb_to_linear(c: vec3f) -> vec3f {
  return select(pow((c + 0.055) / 1.055, vec3f(2.4)), c / 12.92, c <= vec3f(0.04045));
}

fn linear_to_srgb(c: vec3f) -> vec3f {
  let x = clamp(c, vec3f(0.0), vec3f(1.0));
  return select(1.055 * pow(x, vec3f(1.0 / 2.4)) - 0.055, x * 12.92, x <= vec3f(0.0031308));
}

// Colors stored as packed sRGB bytes (r | g << 8 | b << 16 | a << 24).
fn unpack_srgb(c: u32) -> vec3f {
  return srgb_to_linear(unpack4x8unorm(c).rgb);
}

fn is_ortho() -> bool {
  return frame.camera_pos.w > 0.5;
}

// Unit vector from a world point toward the viewer.
fn view_dir(p: vec3f) -> vec3f {
  if (is_ortho()) {
    return normalize(vec3f(frame.view[0].z, frame.view[1].z, frame.view[2].z));
  }
  return normalize(frame.camera_pos.xyz - p);
}

// Distance in front of the camera for a (reversed-Z) depth buffer value.
// Works for both projections; depth 0 (nothing drawn) maps to very far.
fn view_depth(depth: f32) -> f32 {
  let v = frame.inv_proj * vec4f(0.0, 0.0, max(depth, 1e-7), 1.0);
  return -v.z / v.w;
}

// True when the scene surface at \`scene_depth\` is in front of a point at
// \`depth\` (both depth-buffer values), with a small relative tolerance.
fn occluded(scene_depth: f32, depth: f32) -> bool {
  let z = view_depth(depth);
  return view_depth(scene_depth) < z * 0.997 - 1e-4;
}

// World -> view-space direction (view space: +x right, +y up, +z toward the viewer).
fn to_view(n: vec3f) -> vec3f {
  return normalize((frame.view * vec4f(n, 0.0)).xyz);
}

// Resources and helpers for passes that shade 3D geometry.

@group(0) @binding(1) var clamp_sampler: sampler;
@group(0) @binding(2) var colormaps: texture_2d<f32>;    // 256 x N, one colormap per row
@group(0) @binding(3) var matcap_tex: texture_2d<f32>;   // MatCap style
@group(0) @binding(4) var env_tex: texture_2d<f32>;      // equirect; mip k = blurrier (rougher)
@group(0) @binding(5) var shadow_map: texture_depth_2d;
@group(0) @binding(6) var shadow_sampler: sampler_comparison;
@group(0) @binding(7) var ao_tex: texture_2d<f32>;       // screen-space ambient occlusion
@group(0) @binding(8) var repeat_sampler: sampler;

// Everything a style needs to shade one pixel. See shaders/styles/.
struct Surface {
  albedo: vec3f,     // base color, linear rgb
  n: vec3f,          // world normal, facing the viewer
  v: vec3f,          // world direction toward the viewer
  p: vec3f,          // world position
  ao: f32,           // ambient occlusion, 1 = open
  shadow: f32,       // sun visibility, 1 = lit
  metallic: f32,
  roughness: f32,
};

fn colormap(row: u32, t: f32) -> vec3f {
  let rows = f32(textureDimensions(colormaps).y);
  let uv = vec2f((clamp(t, 0.0, 1.0) * 255.0 + 0.5) / 256.0, (f32(row) + 0.5) / rows);
  return textureSampleLevel(colormaps, clamp_sampler, uv, 0.0).rgb;
}

fn sample_ao(frag_xy: vec2f) -> f32 {
  let ao = textureLoad(ao_tex, vec2i(frag_xy), 0).r;
  return mix(1.0, ao, frame.style.x);
}

// Sun shadow, 3x3 percentage-closer filtering. Returns 1 when lit.
fn sample_shadow(p: vec3f, n: vec3f) -> f32 {
  if (frame.style.z < 0.5) {
    return 1.0;
  }
  let lp = frame.light_view_proj * vec4f(p + n * 0.01, 1.0);
  let uv = vec2f(lp.x * 0.5 + 0.5, 0.5 - lp.y * 0.5);
  let texel = 1.0 / vec2f(textureDimensions(shadow_map));
  var lit = 0.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      lit += textureSampleCompareLevel(shadow_map, shadow_sampler,
                                       uv + vec2f(f32(x), f32(y)) * texel, lp.z - 0.0015);
    }
  }
  lit /= 9.0;
  let outside = any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)) || lp.z > 1.0;
  return select(mix(1.0, lit, frame.sun_dir.w), 1.0, outside);
}

// Equirectangular lookup in a z-up world, rotated by frame.env.x.
fn env_uv(d: vec3f) -> vec2f {
  let phi = atan2(d.y, d.x) + frame.env.x;
  let theta = acos(clamp(d.z, -1.0, 1.0));
  return vec2f(phi / (2.0 * PI) + 0.5, theta / PI);
}

// Diffuse light arriving from the whole environment around normal n.
fn env_irradiance(n: vec3f) -> vec3f {
  // Rotate the normal into the environment's frame first.
  let c = cos(frame.env.x);
  let s = sin(frame.env.x);
  let d = vec3f(c * n.x - s * n.y, s * n.x + c * n.y, n.z);
  let sh = frame.sh;
  var r = sh[0].rgb * 0.886227;
  r += sh[1].rgb * (1.023328 * d.y) + sh[2].rgb * (1.023328 * d.z) + sh[3].rgb * (1.023328 * d.x);
  r += sh[4].rgb * (0.858086 * d.x * d.y) + sh[5].rgb * (0.858086 * d.y * d.z);
  r += sh[6].rgb * (0.247708 * (3.0 * d.z * d.z - 1.0));
  r += sh[7].rgb * (0.858086 * d.x * d.z) + sh[8].rgb * (0.429043 * (d.x * d.x - d.y * d.y));
  return max(r, vec3f(0.0));
}

// STUDIO — Blender "Workbench" (Solid mode) style.
//
// Three lights are attached to the camera, so any view is well lit and no
// scene ever needs lights of its own. A soft sky/ground ambient adds the sense
// of "up". Ambient occlusion darkens creases; the sun shadow only darkens.
//
// Knobs: frame.style2.x = specular strength
//        frame.style2.y = light wrap (0 = hard terminator, 1 = very soft)
//        frame.style2.z = ambient level

fn wrap_diffuse(n: vec3f, l: vec3f, wrap: f32) -> f32 {
  return max((dot(n, l) + wrap) / (1.0 + wrap), 0.0);
}

fn shade(s: Surface) -> vec3f {
  let n = to_view(s.n);  // lights below are in view space, i.e. they follow the camera
  let key = normalize(vec3f(-0.45, 0.60, 0.66));   // upper left, in front
  let fill = normalize(vec3f(0.80, 0.05, 0.60));   // right
  let rim = normalize(vec3f(0.10, 0.45, -0.89));   // behind, above

  let wrap = frame.style2.y;
  let diffuse = 0.80 * wrap_diffuse(n, key, wrap)
              + 0.30 * wrap_diffuse(n, fill, wrap)
              + 0.25 * max(dot(n, rim), 0.0);
  let sky = s.n.z * 0.5 + 0.5;  // world up is +z
  let ambient = frame.style2.z * mix(0.55, 1.0, sky);

  let h = normalize(key + vec3f(0.0, 0.0, 1.0));
  let spec = pow(max(dot(n, h), 0.0), 60.0) * frame.style2.x;

  let occlusion = s.ao * mix(0.55, 1.0, s.shadow);
  return s.albedo * (ambient + diffuse) * occlusion + vec3f(spec) * occlusion;
}


struct VsOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) @interpolate(flat) color: vec3f,
};

@vertex
fn vs_main(@location(0) pos: vec3f, @location(1) color: u32) -> VsOut {
  var out: VsOut;
  out.world = pos;
  out.clip = frame.view_proj * vec4f(pos, 1.0);
  out.color = unpack_srgb(color);
  return out;
}

// Shared fragment stage of the web client's meshes: flat faces (normals from
// screen-space derivatives, so no per-face vertex copies), turned toward the
// viewer, shaded by the style, exposure, then sRGB for the canvas.
@fragment
fn fs_main(in: VsOut) -> @location(0) vec4f {
  let face = normalize(cross(dpdx(in.world), dpdy(in.world)));
  let v = view_dir(in.world);
  var s: Surface;
  s.albedo = in.color;
  s.n = select(-face, face, dot(face, v) >= 0.0);
  s.v = v;
  s.p = in.world;
  s.ao = 1.0;
  s.shadow = 1.0;
  s.metallic = 0.0;
  s.roughness = 0.45;
  return vec4f(linear_to_srgb(shade(s) * frame.style.y), 1.0);
}

`,s=`// Web client: rigid bodies drawn from BODY-LOCAL vertices and one pose per
// (instance, body), so a frame only uploads the poses. One instanced draw per
// rigid mesh (instance = env). Shading is the native viewer's (shared
// frame/scene helpers and the selected style's shade()).
// Per-frame constants shared by every pass.
// Must match \`FrameUniforms\` in src/avbd_viz/renderer.h field for field.
struct Frame {
  view: mat4x4f,
  proj: mat4x4f,
  view_proj: mat4x4f,
  inv_view_proj: mat4x4f,
  inv_proj: mat4x4f,
  inv_view: mat4x4f,
  light_view_proj: mat4x4f,  // sun shadow map projection
  camera_pos: vec4f,         // xyz = eye, w = 1 when orthographic
  viewport: vec4f,           // width, height, 1/width, 1/height (pixels)
  sun_dir: vec4f,            // world direction toward the sun, w = shadow strength
  bg_top: vec4f,             // background gradient, linear rgb
  bg_bottom: vec4f,
  grid_minor: vec4f,         // grid line colors (linear rgb, a = opacity)
  grid_major: vec4f,
  grid_params: vec4f,        // x = plane offset, y = fade distance, z = grid on, w = ground shadow on
  grid_plane: vec4f,         // x = normal axis (0 x, 1 y, 2 z), y = 1 behind everything, z/w = in-plane u/v axes
  axis_u: vec4f,             // color of the u axis line (v = 0) on the grid plane
  axis_v: vec4f,             // color of the v axis line (u = 0)
  wire: vec4f,               // rgb = wire color, a = line width in pixels (0 = off)
  wire_mode: vec4f,          // x = 1 in wireframe shading, y = face opacity, z = 1 wires take object colors
  select_color: vec4f,
  active_color: vec4f,       // the most recently selected element
  outline_color: vec4f,
  style: vec4f,              // x = ao strength, y = exposure, z = shadows on, w = outline mode
  style2: vec4f,             // per-style knobs, see shaders/styles/*.wgsl
  env: vec4f,                // x = env rotation (rad), y = env intensity, z = max mip level
  ao: vec4f,                 // x = radius (world), y = bias, z = intensity
  post: vec4f,               // x = tonemap (0 clamp, 1 PBR neutral), y = outline width px
  slice: vec4f,              // slice plane: xyz = unit normal toward the cut-away side, w = offset
  sh: array<vec4f, 9>,       // environment irradiance (spherical harmonics, order 2)
};

@group(0) @binding(0) var<uniform> frame: Frame;

const PI: f32 = 3.14159265358979;

fn srgb_to_linear(c: vec3f) -> vec3f {
  return select(pow((c + 0.055) / 1.055, vec3f(2.4)), c / 12.92, c <= vec3f(0.04045));
}

fn linear_to_srgb(c: vec3f) -> vec3f {
  let x = clamp(c, vec3f(0.0), vec3f(1.0));
  return select(1.055 * pow(x, vec3f(1.0 / 2.4)) - 0.055, x * 12.92, x <= vec3f(0.0031308));
}

// Colors stored as packed sRGB bytes (r | g << 8 | b << 16 | a << 24).
fn unpack_srgb(c: u32) -> vec3f {
  return srgb_to_linear(unpack4x8unorm(c).rgb);
}

fn is_ortho() -> bool {
  return frame.camera_pos.w > 0.5;
}

// Unit vector from a world point toward the viewer.
fn view_dir(p: vec3f) -> vec3f {
  if (is_ortho()) {
    return normalize(vec3f(frame.view[0].z, frame.view[1].z, frame.view[2].z));
  }
  return normalize(frame.camera_pos.xyz - p);
}

// Distance in front of the camera for a (reversed-Z) depth buffer value.
// Works for both projections; depth 0 (nothing drawn) maps to very far.
fn view_depth(depth: f32) -> f32 {
  let v = frame.inv_proj * vec4f(0.0, 0.0, max(depth, 1e-7), 1.0);
  return -v.z / v.w;
}

// True when the scene surface at \`scene_depth\` is in front of a point at
// \`depth\` (both depth-buffer values), with a small relative tolerance.
fn occluded(scene_depth: f32, depth: f32) -> bool {
  let z = view_depth(depth);
  return view_depth(scene_depth) < z * 0.997 - 1e-4;
}

// World -> view-space direction (view space: +x right, +y up, +z toward the viewer).
fn to_view(n: vec3f) -> vec3f {
  return normalize((frame.view * vec4f(n, 0.0)).xyz);
}

// Resources and helpers for passes that shade 3D geometry.

@group(0) @binding(1) var clamp_sampler: sampler;
@group(0) @binding(2) var colormaps: texture_2d<f32>;    // 256 x N, one colormap per row
@group(0) @binding(3) var matcap_tex: texture_2d<f32>;   // MatCap style
@group(0) @binding(4) var env_tex: texture_2d<f32>;      // equirect; mip k = blurrier (rougher)
@group(0) @binding(5) var shadow_map: texture_depth_2d;
@group(0) @binding(6) var shadow_sampler: sampler_comparison;
@group(0) @binding(7) var ao_tex: texture_2d<f32>;       // screen-space ambient occlusion
@group(0) @binding(8) var repeat_sampler: sampler;

// Everything a style needs to shade one pixel. See shaders/styles/.
struct Surface {
  albedo: vec3f,     // base color, linear rgb
  n: vec3f,          // world normal, facing the viewer
  v: vec3f,          // world direction toward the viewer
  p: vec3f,          // world position
  ao: f32,           // ambient occlusion, 1 = open
  shadow: f32,       // sun visibility, 1 = lit
  metallic: f32,
  roughness: f32,
};

fn colormap(row: u32, t: f32) -> vec3f {
  let rows = f32(textureDimensions(colormaps).y);
  let uv = vec2f((clamp(t, 0.0, 1.0) * 255.0 + 0.5) / 256.0, (f32(row) + 0.5) / rows);
  return textureSampleLevel(colormaps, clamp_sampler, uv, 0.0).rgb;
}

fn sample_ao(frag_xy: vec2f) -> f32 {
  let ao = textureLoad(ao_tex, vec2i(frag_xy), 0).r;
  return mix(1.0, ao, frame.style.x);
}

// Sun shadow, 3x3 percentage-closer filtering. Returns 1 when lit.
fn sample_shadow(p: vec3f, n: vec3f) -> f32 {
  if (frame.style.z < 0.5) {
    return 1.0;
  }
  let lp = frame.light_view_proj * vec4f(p + n * 0.01, 1.0);
  let uv = vec2f(lp.x * 0.5 + 0.5, 0.5 - lp.y * 0.5);
  let texel = 1.0 / vec2f(textureDimensions(shadow_map));
  var lit = 0.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      lit += textureSampleCompareLevel(shadow_map, shadow_sampler,
                                       uv + vec2f(f32(x), f32(y)) * texel, lp.z - 0.0015);
    }
  }
  lit /= 9.0;
  let outside = any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)) || lp.z > 1.0;
  return select(mix(1.0, lit, frame.sun_dir.w), 1.0, outside);
}

// Equirectangular lookup in a z-up world, rotated by frame.env.x.
fn env_uv(d: vec3f) -> vec2f {
  let phi = atan2(d.y, d.x) + frame.env.x;
  let theta = acos(clamp(d.z, -1.0, 1.0));
  return vec2f(phi / (2.0 * PI) + 0.5, theta / PI);
}

// Diffuse light arriving from the whole environment around normal n.
fn env_irradiance(n: vec3f) -> vec3f {
  // Rotate the normal into the environment's frame first.
  let c = cos(frame.env.x);
  let s = sin(frame.env.x);
  let d = vec3f(c * n.x - s * n.y, s * n.x + c * n.y, n.z);
  let sh = frame.sh;
  var r = sh[0].rgb * 0.886227;
  r += sh[1].rgb * (1.023328 * d.y) + sh[2].rgb * (1.023328 * d.z) + sh[3].rgb * (1.023328 * d.x);
  r += sh[4].rgb * (0.858086 * d.x * d.y) + sh[5].rgb * (0.858086 * d.y * d.z);
  r += sh[6].rgb * (0.247708 * (3.0 * d.z * d.z - 1.0));
  r += sh[7].rgb * (0.858086 * d.x * d.z) + sh[8].rgb * (0.429043 * (d.x * d.x - d.y * d.y));
  return max(r, vec3f(0.0));
}

// STUDIO — Blender "Workbench" (Solid mode) style.
//
// Three lights are attached to the camera, so any view is well lit and no
// scene ever needs lights of its own. A soft sky/ground ambient adds the sense
// of "up". Ambient occlusion darkens creases; the sun shadow only darkens.
//
// Knobs: frame.style2.x = specular strength
//        frame.style2.y = light wrap (0 = hard terminator, 1 = very soft)
//        frame.style2.z = ambient level

fn wrap_diffuse(n: vec3f, l: vec3f, wrap: f32) -> f32 {
  return max((dot(n, l) + wrap) / (1.0 + wrap), 0.0);
}

fn shade(s: Surface) -> vec3f {
  let n = to_view(s.n);  // lights below are in view space, i.e. they follow the camera
  let key = normalize(vec3f(-0.45, 0.60, 0.66));   // upper left, in front
  let fill = normalize(vec3f(0.80, 0.05, 0.60));   // right
  let rim = normalize(vec3f(0.10, 0.45, -0.89));   // behind, above

  let wrap = frame.style2.y;
  let diffuse = 0.80 * wrap_diffuse(n, key, wrap)
              + 0.30 * wrap_diffuse(n, fill, wrap)
              + 0.25 * max(dot(n, rim), 0.0);
  let sky = s.n.z * 0.5 + 0.5;  // world up is +z
  let ambient = frame.style2.z * mix(0.55, 1.0, sky);

  let h = normalize(key + vec3f(0.0, 0.0, 1.0));
  let spec = pow(max(dot(n, h), 0.0), 60.0) * frame.style2.x;

  let occlusion = s.ao * mix(0.55, 1.0, s.shadow);
  return s.albedo * (ambient + diffuse) * occlusion + vec3f(spec) * occlusion;
}


struct Params {
  num_bodies: u32,
  _pad0: u32,
  _pad1: u32,
  _pad2: u32,
};

@group(1) @binding(0) var<uniform> params: Params;
@group(1) @binding(1) var<storage, read> poses: array<vec4f>;   // 2 per segment: t, q (xyzw)
@group(1) @binding(2) var<storage, read> seg_color: array<u32>; // packed sRGB, a = 0 hidden
@group(1) @binding(3) var<storage, read> offsets: array<vec4f>; // per instance (display grid)

struct VsOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) @interpolate(flat) color: vec3f,
};

fn quat_rotate(q: vec4f, v: vec3f) -> vec3f {
  let u = 2.0 * cross(q.xyz, v);
  return v + q.w * u + cross(q.xyz, u);
}

@vertex
fn vs_main(@location(0) pos: vec3f, @location(1) body: u32,
           @builtin(instance_index) inst: u32) -> VsOut {
  let s = inst * params.num_bodies + body;
  let w = poses[2u * s].xyz + quat_rotate(poses[2u * s + 1u], pos) + offsets[inst].xyz;
  let c = seg_color[s];
  var out: VsOut;
  out.world = w;
  out.clip = frame.view_proj * vec4f(w, 1.0);
  if ((c >> 24u) == 0u) {
    out.clip = vec4f(0.0, 0.0, -2.0, 1.0);  // hidden segment: clipped away
  }
  out.color = unpack_srgb(c);
  return out;
}

// Shared fragment stage of the web client's meshes: flat faces (normals from
// screen-space derivatives, so no per-face vertex copies), turned toward the
// viewer, shaded by the style, exposure, then sRGB for the canvas.
@fragment
fn fs_main(in: VsOut) -> @location(0) vec4f {
  let face = normalize(cross(dpdx(in.world), dpdy(in.world)));
  let v = view_dir(in.world);
  var s: Surface;
  s.albedo = in.color;
  s.n = select(-face, face, dot(face, v) >= 0.0);
  s.v = v;
  s.p = in.world;
  s.ao = 1.0;
  s.shadow = 1.0;
  s.metallic = 0.0;
  s.roughness = 0.45;
  return vec4f(linear_to_srgb(shade(s) * frame.style.y), 1.0);
}

`,c=(e,t)=>[e[0]-t[0],e[1]-t[1],e[2]-t[2]],l=(e,t)=>[e[1]*t[2]-e[2]*t[1],e[2]*t[0]-e[0]*t[2],e[0]*t[1]-e[1]*t[0]],u=(e,t)=>e[0]*t[0]+e[1]*t[1]+e[2]*t[2],d=e=>{let t=Math.hypot(e[0],e[1],e[2])||1;return[e[0]/t,e[1]/t,e[2]/t]};function f(e,t,n=[0,0,1]){let r=d(c(t,e)),i=l(r,n);Math.hypot(...i)<1e-6&&(i=l(r,[0,1,0])),i=d(i);let a=l(i,r);return new Float32Array([i[0],a[0],-r[0],0,i[1],a[1],-r[1],0,i[2],a[2],-r[2],0,-u(i,e),-u(a,e),u(r,e),1])}function p(e,t,n){let r=1/Math.tan(e/2);return new Float32Array([r/t,0,0,0,0,r,0,0,0,0,0,-1,0,0,n,0])}function m(e,t){let n=new Float32Array(16);for(let r=0;r<4;r++)for(let i=0;i<4;i++){let a=0;for(let n=0;n<4;n++)a+=e[n*4+i]*t[r*4+n];n[r*4+i]=a}return n}function h(e){let t=new Float32Array(16),n=e;t[0]=n[5]*n[10]*n[15]-n[5]*n[11]*n[14]-n[9]*n[6]*n[15]+n[9]*n[7]*n[14]+n[13]*n[6]*n[11]-n[13]*n[7]*n[10],t[4]=-n[4]*n[10]*n[15]+n[4]*n[11]*n[14]+n[8]*n[6]*n[15]-n[8]*n[7]*n[14]-n[12]*n[6]*n[11]+n[12]*n[7]*n[10],t[8]=n[4]*n[9]*n[15]-n[4]*n[11]*n[13]-n[8]*n[5]*n[15]+n[8]*n[7]*n[13]+n[12]*n[5]*n[11]-n[12]*n[7]*n[9],t[12]=-n[4]*n[9]*n[14]+n[4]*n[10]*n[13]+n[8]*n[5]*n[14]-n[8]*n[6]*n[13]-n[12]*n[5]*n[10]+n[12]*n[6]*n[9],t[1]=-n[1]*n[10]*n[15]+n[1]*n[11]*n[14]+n[9]*n[2]*n[15]-n[9]*n[3]*n[14]-n[13]*n[2]*n[11]+n[13]*n[3]*n[10],t[5]=n[0]*n[10]*n[15]-n[0]*n[11]*n[14]-n[8]*n[2]*n[15]+n[8]*n[3]*n[14]+n[12]*n[2]*n[11]-n[12]*n[3]*n[10],t[9]=-n[0]*n[9]*n[15]+n[0]*n[11]*n[13]+n[8]*n[1]*n[15]-n[8]*n[3]*n[13]-n[12]*n[1]*n[11]+n[12]*n[3]*n[9],t[13]=n[0]*n[9]*n[14]-n[0]*n[10]*n[13]-n[8]*n[1]*n[14]+n[8]*n[2]*n[13]+n[12]*n[1]*n[10]-n[12]*n[2]*n[9],t[2]=n[1]*n[6]*n[15]-n[1]*n[7]*n[14]-n[5]*n[2]*n[15]+n[5]*n[3]*n[14]+n[13]*n[2]*n[7]-n[13]*n[3]*n[6],t[6]=-n[0]*n[6]*n[15]+n[0]*n[7]*n[14]+n[4]*n[2]*n[15]-n[4]*n[3]*n[14]-n[12]*n[2]*n[7]+n[12]*n[3]*n[6],t[10]=n[0]*n[5]*n[15]-n[0]*n[7]*n[13]-n[4]*n[1]*n[15]+n[4]*n[3]*n[13]+n[12]*n[1]*n[7]-n[12]*n[3]*n[5],t[14]=-n[0]*n[5]*n[14]+n[0]*n[6]*n[13]+n[4]*n[1]*n[14]-n[4]*n[2]*n[13]-n[12]*n[1]*n[6]+n[12]*n[2]*n[5],t[3]=-n[1]*n[6]*n[11]+n[1]*n[7]*n[10]+n[5]*n[2]*n[11]-n[5]*n[3]*n[10]-n[9]*n[2]*n[7]+n[9]*n[3]*n[6],t[7]=n[0]*n[6]*n[11]-n[0]*n[7]*n[10]-n[4]*n[2]*n[11]+n[4]*n[3]*n[10]+n[8]*n[2]*n[7]-n[8]*n[3]*n[6],t[11]=-n[0]*n[5]*n[11]+n[0]*n[7]*n[9]+n[4]*n[1]*n[11]-n[4]*n[3]*n[9]-n[8]*n[1]*n[7]+n[8]*n[3]*n[5],t[15]=n[0]*n[5]*n[10]-n[0]*n[6]*n[9]-n[4]*n[1]*n[10]+n[4]*n[2]*n[9]+n[8]*n[1]*n[6]-n[8]*n[2]*n[5];let r=n[0]*t[0]+n[1]*t[4]+n[2]*t[8]+n[3]*t[12],i=r===0?0:1/r;for(let e=0;e<16;e++)t[e]*=i;return t}var g=class{target=[0,0,0];distance=5;yaw=-Math.PI/2;pitch=.4;fovy=45*Math.PI/180;lookAt(e,t){let n=c(e,t);this.target=[...t],this.distance=Math.max(Math.hypot(...n),.001),this.yaw=Math.atan2(n[1],n[0]),this.pitch=Math.asin(Math.max(-1,Math.min(1,n[2]/this.distance)))}eye(){let e=Math.cos(this.pitch);return[this.target[0]+this.distance*e*Math.cos(this.yaw),this.target[1]+this.distance*e*Math.sin(this.yaw),this.target[2]+this.distance*Math.sin(this.pitch)]}view(){return f(this.eye(),this.target)}proj(e){return p(this.fovy,e,Math.max(this.distance*.001,.001))}orbit(e,t){this.yaw-=e*.008,this.pitch=Math.max(-1.55,Math.min(1.55,this.pitch+t*.008))}pan(e,t,n){let r=this.view(),i=[r[0],r[4],r[8]],a=[r[1],r[5],r[9]],o=2*this.distance*Math.tan(this.fovy/2)/n;for(let n=0;n<3;n++)this.target[n]+=(-e*i[n]+t*a[n])*o}zoom(e){this.distance=Math.max(.001,this.distance*Math.exp(e*.001))}attach(e,t){let n=null,r=`orbit`;e.addEventListener(`contextmenu`,e=>e.preventDefault()),e.addEventListener(`pointerdown`,t=>{n=[t.clientX,t.clientY],r=t.button===2||t.button===1||t.shiftKey?`pan`:`orbit`,e.setPointerCapture(t.pointerId)}),e.addEventListener(`pointermove`,i=>{if(!n)return;let a=i.clientX-n[0],o=i.clientY-n[1];n=[i.clientX,i.clientY],r===`orbit`?this.orbit(a,o):this.pan(a,o,e.clientHeight),t()}),e.addEventListener(`pointerup`,()=>n=null),e.addEventListener(`wheel`,e=>{e.preventDefault(),this.zoom(e.deltaY),t()},{passive:!1})}},_={view:0,proj:16,viewProj:32,invViewProj:48,invProj:64,invView:80,cameraPos:112,viewport:116,sunDir:120,bgTop:124,bgBottom:128,style:176,style2:180,size:236},v=4,y=e=>e<=.04045?e/12.92:((e+.055)/1.055)**2.4;function b(e,t,n,r=1){let i=e=>Math.max(0,Math.min(255,Math.round(e*255)));return(i(e)|i(t)<<8|i(n)<<16|i(r)<<24)>>>0}var x=[0,0,0,1,0,0,1,1,0,0,1,0,0,0,1,1,0,1,1,1,1,0,1,1],S=[0,3,2,0,2,1,4,5,6,4,6,7,0,1,5,0,5,4,1,2,6,1,6,5,2,3,7,2,7,6,3,0,4,3,4,7],C=class e{device;context;format;canvas;camera=new g;frame=new Float32Array(_.size);frameBuf;rigidPipe;dynPipe;bgPipe;frameBind=new Map;objects=new Map;color;depth;size=[0,0];dark=!0;constructor(e,t,n,r){this.device=e,this.context=t,this.format=n,this.canvas=r,this.frameBuf=e.createBuffer({size:_.size*4,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});let i={format:`depth32float`,depthWriteEnabled:!0,depthCompare:`greater`},c=[{format:n}],l={count:v},u=t=>e.createShaderModule({code:t}),d=u(s);this.rigidPipe=e.createRenderPipeline({layout:`auto`,vertex:{module:d,entryPoint:`vs_main`,buffers:[{arrayStride:12,attributes:[{shaderLocation:0,offset:0,format:`float32x3`}]},{arrayStride:4,attributes:[{shaderLocation:1,offset:0,format:`uint32`}]}]},fragment:{module:d,entryPoint:`fs_main`,targets:c},primitive:{topology:`triangle-list`,cullMode:`none`},depthStencil:i,multisample:l});let f=u(o);this.dynPipe=e.createRenderPipeline({layout:`auto`,vertex:{module:f,entryPoint:`vs_main`,buffers:[{arrayStride:12,attributes:[{shaderLocation:0,offset:0,format:`float32x3`}]},{arrayStride:4,attributes:[{shaderLocation:1,offset:0,format:`uint32`}]}]},fragment:{module:f,entryPoint:`fs_main`,targets:c},primitive:{topology:`triangle-list`,cullMode:`none`},depthStencil:i,multisample:l});let p=u(a);this.bgPipe=e.createRenderPipeline({layout:`auto`,vertex:{module:p,entryPoint:`vs_main`},fragment:{module:p,entryPoint:`fs_main`,targets:c},depthStencil:{format:`depth32float`,depthWriteEnabled:!1,depthCompare:`always`},multisample:l});for(let t of[this.rigidPipe,this.dynPipe,this.bgPipe])this.frameBind.set(t,e.createBindGroup({layout:t.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.frameBuf}}]}))}static async create(t){if(!navigator.gpu)throw Error(`WebGPU is not available in this browser`);let n=await navigator.gpu.requestAdapter({powerPreference:`high-performance`});if(!n)throw Error(`no WebGPU adapter (is hardware acceleration on?)`);let r=await n.requestDevice();r.lost.then(e=>console.error(`WebGPU device lost:`,e.message));let i=t.getContext(`webgpu`);if(!i)throw Error(`could not get a WebGPU canvas context`);let a=navigator.gpu.getPreferredCanvasFormat();return i.configure({device:r,format:a,alphaMode:`opaque`}),new e(r,i,a,t)}clear(){for(let e of this.objects.values())T(e);this.objects.clear()}setScene(e){this.clear();for(let t of e)if(t.kind===`rigid_mesh`)this.objects.set(t.name,this.makeRigid(t));else if(t.kind===`boxes`||t.kind===`points`){let e={kind:`dyn`,obj:t,indexCount:0,capacity:[0,0]};this.objects.set(t.name,e),this.rebuildDyn(e)}}makeRigid(e){let t=this.device,n=e.arrays,r=e.attrs.instances,i=n.body_triangle_offsets.data.length-1,a=(e,n)=>{let r=t.createBuffer({size:Math.max(16,w(e.byteLength)),usage:n|GPUBufferUsage.COPY_DST});return t.queue.writeBuffer(r,0,e.buffer,e.byteOffset,e.byteLength),r},o=a(n.local_vertices.data,GPUBufferUsage.VERTEX),s=a(new Uint32Array(n.vertex_body.data),GPUBufferUsage.VERTEX),c=a(n.triangles.data,GPUBufferUsage.INDEX),l=r*i,u=t.createBuffer({size:l*32,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),d=new Float32Array(l*8);for(let e=0;e<l;e++)d[e*8+7]=1;t.queue.writeBuffer(u,0,d);let f=t.createBuffer({size:Math.max(16,l*4),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),p=new Float32Array(r*4);for(let e=0;e<r;e++)for(let t=0;t<3;t++)p[e*4+t]=n.offsets.data[e*3+t];let m=a(p,GPUBufferUsage.STORAGE),h=a(new Uint32Array([i,0,0,0]),GPUBufferUsage.UNIFORM),g=t.createBindGroup({layout:this.rigidPipe.getBindGroupLayout(1),entries:[{binding:0,resource:{buffer:h}},{binding:1,resource:{buffer:u}},{binding:2,resource:{buffer:f}},{binding:3,resource:{buffer:m}}]}),_={kind:`rigid`,instances:r,bodies:i,indexCount:n.triangles.data.length,pos:o,body:s,index:c,poses:u,colors:f,offsets:p,bind:g,poseScratch:d};return this.setSegmentColors(_,n.segment_colors,n.segment_visible),_}setSegmentColors(e,t,n){let r=e.instances*e.bodies,i=new Uint32Array(r);for(let e=0;e<r;e++){let r=!n||n.data[e]!==0;i[e]=b(t.data[3*e],t.data[3*e+1],t.data[3*e+2],+!!r)}this.device.queue.writeBuffer(e.colors,0,i)}applyFrame(e){for(let[t,n]of Object.entries(e)){let e=this.objects.get(t);if(e){if(e.kind===`rigid`){let t=n.poses;if(!t)continue;let r=e.instances*e.bodies,i=e.poseScratch;for(let e=0;e<r;e++){for(let n=0;n<3;n++)i[8*e+n]=t.data[7*e+n];for(let n=0;n<4;n++)i[8*e+4+n]=t.data[7*e+3+n]}this.device.queue.writeBuffer(e.poses,0,i)}else Object.assign(e.obj.arrays,n),this.rebuildDyn(e)}}}rebuildDyn(e){let t=e.obj,n,r,i;if(t.kind===`boxes`)n=t.arrays.lo.data,r=t.arrays.hi.data,i=n.length/3;else{let e=t.arrays.points.data,a=t.arrays.radii?.data;i=e.length/3;let o=new Float32Array(e.length),s=new Float32Array(e.length);for(let n=0;n<i;n++)for(let r=0;r<3;r++){let i=a?a[n]:t.attrs.radius;o[3*n+r]=e[3*n+r]-i,s[3*n+r]=e[3*n+r]+i}n=o,r=s}let a=new Float32Array(i*24),o=new Uint32Array(i*8),s=new Uint32Array(i*36),c=t.arrays.colors?.data,l=t.attrs.color;for(let e=0;e<i;e++){let t=c?b(c[3*e],c[3*e+1],c[3*e+2]):b(l[0],l[1],l[2]);for(let i=0;i<8;i++){for(let t=0;t<3;t++)a[e*24+i*3+t]=n[3*e+t]+x[i*3+t]*(r[3*e+t]-n[3*e+t]);o[e*8+i]=t}for(let t=0;t<36;t++)s[e*36+t]=S[t]+8*e}let u=this.device;if(e.capacity[0]<a.byteLength||!e.pos){T(e);let t=Math.max(64,a.byteLength);e.pos=u.createBuffer({size:t,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST}),e.color=u.createBuffer({size:Math.max(64,o.byteLength),usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST}),e.index=u.createBuffer({size:Math.max(64,s.byteLength),usage:GPUBufferUsage.INDEX|GPUBufferUsage.COPY_DST}),e.capacity=[t,0]}u.queue.writeBuffer(e.pos,0,a),u.queue.writeBuffer(e.color,0,o),u.queue.writeBuffer(e.index,0,s),e.indexCount=s.length}ensureTargets(){let e=window.devicePixelRatio||1,t=Math.max(1,Math.floor(this.canvas.clientWidth*e)),n=Math.max(1,Math.floor(this.canvas.clientHeight*e));t===this.size[0]&&n===this.size[1]&&this.color||(this.canvas.width=t,this.canvas.height=n,this.size=[t,n],this.color?.destroy(),this.depth?.destroy(),this.color=this.device.createTexture({size:[t,n],format:this.format,sampleCount:v,usage:GPUTextureUsage.RENDER_ATTACHMENT}),this.depth=this.device.createTexture({size:[t,n],format:`depth32float`,sampleCount:v,usage:GPUTextureUsage.RENDER_ATTACHMENT}))}writeFrame(){let[e,t]=this.size,n=this.frame,r=this.camera.view(),i=this.camera.proj(e/t),a=m(i,r);n.set(r,_.view),n.set(i,_.proj),n.set(a,_.viewProj),n.set(h(a),_.invViewProj),n.set(h(i),_.invProj),n.set(h(r),_.invView);let o=this.camera.eye();n.set([o[0],o[1],o[2],0],_.cameraPos),n.set([e,t,1/e,1/t],_.viewport),n.set([.25,-.35,1,0],_.sunDir);let s=(e,t,n)=>[y(e),y(t),y(n),1];n.set(this.dark?s(.235,.243,.259):s(.965,.969,.976),_.bgTop),n.set(this.dark?s(.114,.118,.129):s(.82,.835,.859),_.bgBottom),n.set([0,1,0,0],_.style),n.set([.35,.35,.38,0],_.style2),this.device.queue.writeBuffer(this.frameBuf,0,n)}render(){this.ensureTargets(),this.writeFrame();let e=this.device.createCommandEncoder(),t=e.beginRenderPass({colorAttachments:[{view:this.color.createView(),resolveTarget:this.context.getCurrentTexture().createView(),clearValue:{r:0,g:0,b:0,a:1},loadOp:`clear`,storeOp:`discard`}],depthStencilAttachment:{view:this.depth.createView(),depthClearValue:0,depthLoadOp:`clear`,depthStoreOp:`discard`}});t.setPipeline(this.bgPipe),t.setBindGroup(0,this.frameBind.get(this.bgPipe)),t.draw(3);for(let e of this.objects.values())e.kind===`rigid`?(t.setPipeline(this.rigidPipe),t.setBindGroup(0,this.frameBind.get(this.rigidPipe)),t.setBindGroup(1,e.bind),t.setVertexBuffer(0,e.pos),t.setVertexBuffer(1,e.body),t.setIndexBuffer(e.index,`uint32`),t.drawIndexed(e.indexCount,e.instances)):e.indexCount>0&&(t.setPipeline(this.dynPipe),t.setBindGroup(0,this.frameBind.get(this.dynPipe)),t.setVertexBuffer(0,e.pos),t.setVertexBuffer(1,e.color),t.setIndexBuffer(e.index,`uint32`),t.drawIndexed(e.indexCount));t.end(),this.device.queue.submit([e.finish()])}};function w(e){return e+3&-4}function T(e){if(e.kind===`rigid`)for(let t of[e.pos,e.body,e.index,e.poses,e.colors])t.destroy();else e.pos?.destroy(),e.color?.destroy(),e.index?.destroy(),e.pos=e.color=e.index=void 0}var E=`live`,D=20,O=document.getElementById(`view`),k=new i(document.getElementById(`panel`)),A=document.getElementById(`error`),j={status:`connecting`,name:``,time:null,frames:0,dropped:0,fps:0,lastFrameAt:0};window.__avbd=j;var M=null,N=!0,P=null,F=0,I=0,L=null,R=null,z=null;function B(e){A.textContent=e,A.style.display=`block`}function V(e){M.setScene(e.objects);let t=e.objects.find(e=>e.kind===`rigid_mesh`);I=t?t.attrs.instances:0,L=t?t.arrays.offsets.data:null,e.camera&&!R&&M.camera.lookAt(e.camera[0],e.camera[1]),R=e.camera,N=!0}function H(e){F&&e.seq>F+1&&(j.dropped+=e.seq-F-1),F=e.seq;let t=performance.now();j.lastFrameAt&&(j.fps=.8*j.fps+.2*(1e3/Math.max(1,t-j.lastFrameAt))),j.lastFrameAt=t,j.frames++,j.time=e.time,M.applyFrame(e.objects),k.setChannels(e.channels,I),P=e.seq,N=!0}function U(){let e=`${location.protocol===`https:`?`wss`:`ws`}://${location.host}/ws`;j.status=`connecting`,z=new WebSocket(e),z.binaryType=`arraybuffer`,z.onmessage=e=>{if(!(e.data instanceof ArrayBuffer))return;let t=n(e.data);if(t.type===`hello`){j.name=t.name,document.title=`${t.name||`avbd-viz`} — avbd-viz`;let e=t.streams.find(e=>e.name===E)??t.streams[0];e?z.send(JSON.stringify({type:`subscribe`,stream:e.name,rate:D})):j.status=`no stream`}else t.type===`scene`?(j.status=`live`,V(t)):t.type===`frame`&&H(t)},z.onclose=()=>{j.status=`disconnected — retrying`,F=0,setTimeout(U,1500)}}k.onFocus=e=>{if(M){if(e<0||!L)R&&M.camera.lookAt(R[0],R[1]);else{let t=M.camera,n=R?R[1]:[0,0,1];t.target=[L[3*e]+n[0],L[3*e+1]+n[1],L[3*e+2]+n[2]],t.distance=Math.min(t.distance,2.5)}N=!0}};function W(){M&&N&&(M.render(),N=!1,P!==null&&z?.readyState===WebSocket.OPEN&&(z.send(JSON.stringify({type:`ack`,stream:E,seq:P})),P=null)),k.setStatus(j),requestAnimationFrame(W)}C.create(O).then(e=>{M=e,e.camera.attach(O,()=>N=!0),new ResizeObserver(()=>N=!0).observe(O),U(),requestAnimationFrame(W)}).catch(e=>B(`Cannot start the viewer: ${e.message}`));