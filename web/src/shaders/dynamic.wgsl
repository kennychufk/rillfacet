// Web client: small geometry rebuilt on the CPU when it changes (meter boxes,
// markers): world-space vertices with a packed sRGB color each. Fragment
// stages in surface.wgsl.
#include "common/frame.wgsl"
#include "common/scene.wgsl"
#include STYLE

struct Params {
  object_id: u32,
  flags: u32,          // bit 1: cut by the slice plane (as MeshObject.flags)
  _pad0: u32,
  _pad1: u32,
  material: vec4f,     // x = metallic, y = roughness, z = opacity
};

@group(1) @binding(0) var<uniform> params: Params;

struct VsOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) @interpolate(flat) color: vec3f,
  @location(2) @interpolate(flat) ids: vec3u,  // object id, segment (one per object), flags
};

@vertex
fn vs_main(@location(0) pos: vec3f, @location(1) color: u32) -> VsOut {
  var out: VsOut;
  out.world = pos;
  out.clip = frame.view_proj * vec4f(pos, 1.0);
  out.color = unpack_srgb(color);
  out.ids = vec3u(params.object_id, 0u, 0u);
  return out;
}

struct ShadowOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
};

@vertex
fn vs_shadow(@location(0) pos: vec3f, @location(1) color: u32) -> ShadowOut {
  var out: ShadowOut;
  out.world = pos;
  out.clip = frame.light_view_proj * vec4f(pos, 1.0);
  return out;
}

#include "surface.wgsl"
