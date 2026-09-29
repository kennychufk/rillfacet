// Web client: small geometry rebuilt on the CPU when it changes (meter boxes,
// markers): world-space vertices with a packed sRGB color each.
#include "common/frame.wgsl"
#include "common/scene.wgsl"
#include STYLE

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

#include "surface.wgsl"
