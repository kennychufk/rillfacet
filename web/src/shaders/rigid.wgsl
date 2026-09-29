// Web client: rigid bodies drawn from BODY-LOCAL vertices and one pose per
// (instance, body), so a frame only uploads the poses. One instanced draw per
// rigid mesh (instance = env). Shading, prepass and shadow follow the native
// mesh.wgsl (shared frame/scene helpers and the style's shade()); see
// surface.wgsl for the fragment stages.
#include "common/frame.wgsl"
#include "common/scene.wgsl"
#include STYLE

struct Params {
  num_bodies: u32,
  object_id: u32,
  flags: u32,          // bit 1: cut by the slice plane (as MeshObject.flags)
  _pad0: u32,
  material: vec4f,     // x = metallic, y = roughness, z = opacity
};

@group(1) @binding(0) var<uniform> params: Params;
@group(1) @binding(1) var<storage, read> poses: array<vec4f>;   // 2 per segment: t, q (xyzw)
@group(1) @binding(2) var<storage, read> seg_color: array<u32>; // packed sRGB; a = 0 hidden, 254 selected
@group(1) @binding(3) var<storage, read> offsets: array<vec4f>; // per instance (display grid)

struct VsOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) @interpolate(flat) color: vec3f,
  @location(2) @interpolate(flat) ids: vec3u,  // object id, segment, flags (bit 0 selected)
};

fn quat_rotate(q: vec4f, v: vec3f) -> vec3f {
  let u = 2.0 * cross(q.xyz, v);
  return v + q.w * u + cross(q.xyz, u);
}

struct ShadowOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
};

// Pushes a vertex outside the clip volume so its triangle is dropped.
const CULLED = vec4f(0.0, 0.0, -2.0, 1.0);

fn world_of(pos: vec3f, body: u32, inst: u32) -> vec3f {
  let s = inst * params.num_bodies + body;
  return poses[2u * s].xyz + quat_rotate(poses[2u * s + 1u], pos) + offsets[inst].xyz;
}

fn hidden(body: u32, inst: u32) -> bool {
  return (seg_color[inst * params.num_bodies + body] >> 24u) == 0u;
}

@vertex
fn vs_main(@location(0) pos: vec3f, @location(1) body: u32,
           @builtin(instance_index) inst: u32) -> VsOut {
  let s = inst * params.num_bodies + body;
  let w = world_of(pos, body, inst);
  var out: VsOut;
  out.world = w;
  out.clip = select(frame.view_proj * vec4f(w, 1.0), CULLED, hidden(body, inst));
  out.color = unpack_srgb(seg_color[s]);
  out.ids = vec3u(params.object_id, s, u32((seg_color[s] >> 24u) == 254u));
  return out;
}

@vertex
fn vs_shadow(@location(0) pos: vec3f, @location(1) body: u32,
             @builtin(instance_index) inst: u32) -> ShadowOut {
  let w = world_of(pos, body, inst);
  var out: ShadowOut;
  out.world = w;
  out.clip = select(frame.light_view_proj * vec4f(w, 1.0), CULLED, hidden(body, inst));
  return out;
}

#include "surface.wgsl"
