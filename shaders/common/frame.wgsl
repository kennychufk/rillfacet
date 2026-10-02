// Per-frame constants shared by every pass.
// Must match `FrameUniforms` in src/rillfacet/renderer.h field for field.
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

// True when the scene surface at `scene_depth` is in front of a point at
// `depth` (both depth-buffer values), with a small relative tolerance.
fn occluded(scene_depth: f32, depth: f32) -> bool {
  let z = view_depth(depth);
  return view_depth(scene_depth) < z * 0.997 - 1e-4;
}

// World -> view-space direction (view space: +x right, +y up, +z toward the viewer).
fn to_view(n: vec3f) -> vec3f {
  return normalize((frame.view * vec4f(n, 0.0)).xyz);
}
