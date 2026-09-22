// Text labels anchored to 3D points, from a signed-distance-field font atlas
// (crisp at any size, with an optional halo for contrast on any background).
// Labels keep a constant pixel size and dim when their anchor is hidden.

#include "common/frame.wgsl"

@group(0) @binding(1) var depth_tex: texture_depth_2d;
@group(0) @binding(2) var font_atlas: texture_2d<f32>;
@group(0) @binding(3) var font_sampler: sampler;

// Must match `GlyphInstance` in text.h.
struct Glyph {
  anchor: vec4f,  // world xyz, w = opacity when the anchor is hidden
  rect: vec4f,    // quad relative to the anchor in pixels: x, y (top-left, y down), w, h
  uv: vec4f,      // atlas rect: u0, v0, u1, v1
  color: vec4f,   // sRGB + alpha
  halo: vec4f,    // sRGB + alpha
  params: vec4f,  // x = halo thickness in SDF units, y = 1 to ignore depth
};

@group(1) @binding(0) var<storage, read> glyphs: array<Glyph>;

struct VsOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) index: u32,
  @location(2) @interpolate(flat) vis: f32,
};

@vertex
fn vs_main(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> VsOut {
  let g = glyphs[iid];
  var out: VsOut;
  let c = frame.view_proj * vec4f(g.anchor.xyz, 1.0);
  if (c.w <= 0.0 || c.z > c.w) {
    out.clip = vec4f(0.0, 0.0, -2.0, 1.0);
    return out;
  }
  let ndc = c.xyz / c.w;
  // Snap the anchor to whole pixels so text stays crisp.
  let anchor_px = floor(vec2f((ndc.x * 0.5 + 0.5) * frame.viewport.x,
                              (0.5 - ndc.y * 0.5) * frame.viewport.y) + 0.5);
  var corners = array<vec2f, 6>(vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0),
                                vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0));
  let k = corners[vid];
  let px = anchor_px + g.rect.xy + g.rect.zw * k;
  out.clip = vec4f(px.x * frame.viewport.z * 2.0 - 1.0, 1.0 - px.y * frame.viewport.w * 2.0, 0.5, 1.0);
  out.uv = mix(g.uv.xy, g.uv.zw, k);
  out.index = iid;

  let size = vec2i(textureDimensions(depth_tex));
  let scene = textureLoad(depth_tex, clamp(vec2i(anchor_px), vec2i(0), size - 1), 0);
  let hidden = occluded(scene, ndc.z) && g.params.y < 0.5 && frame.wire_mode.x < 0.5;
  out.vis = select(1.0, g.anchor.w, hidden);
  return out;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4f {
  let g = glyphs[in.index];
  let sdf = textureSampleLevel(font_atlas, font_sampler, in.uv, 0.0).r;
  let w = max(fwidth(sdf) * 0.7, 1e-3);
  let fill = smoothstep(0.5 - w, 0.5 + w, sdf);
  let edge = 0.5 - g.params.x;
  let halo = smoothstep(edge - w, edge + w, sdf) * g.halo.a;
  let a_fill = fill * g.color.a;
  let a = (a_fill + halo * (1.0 - a_fill)) * in.vis;
  let rgb = mix(g.halo.rgb, g.color.rgb, a_fill / max(a_fill + halo * (1.0 - a_fill), 1e-4));
  return vec4f(rgb * a, a);
}
