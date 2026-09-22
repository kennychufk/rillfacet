// Copies the finished frame to the window (formats may differ, e.g. BGRA).

@group(0) @binding(0) var src: texture_2d<f32>;

@vertex
fn vs_fullscreen(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4f {
  let uv = vec2f(f32((vid << 1u) & 2u), f32(vid & 2u));
  return vec4f(uv * 2.0 - 1.0, 0.0, 1.0);
}

@fragment
fn fs_blit(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  return textureLoad(src, vec2i(pos.xy), 0);
}
