// Web client: rigid bodies drawn from BODY-LOCAL vertices and one pose per
// (instance, body), so a frame only uploads the poses. One instanced draw per
// rigid mesh (instance = env). Shading is the native viewer's (shared
// frame/scene helpers and the selected style's shade()).
#include "common/frame.wgsl"
#include "common/scene.wgsl"
#include STYLE

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

#include "surface.wgsl"
