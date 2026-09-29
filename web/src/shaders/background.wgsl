// Web client: the native viewer's background gradient (frame.bg_top at the
// top of the view, frame.bg_bottom at the bottom), one full-screen triangle.
#include "common/frame.wgsl"

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
