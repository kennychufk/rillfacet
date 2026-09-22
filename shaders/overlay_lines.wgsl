// Screen-space lines and dots (measurements, selected vertices/edges).
// Each item is a capsule of constant pixel width between two 3D points;
// a dot is a capsule whose ends coincide. Drawn over the final image, dimmed
// (not hidden) where scene geometry is in front, like Blender's overlays.

#include "common/frame.wgsl"

@group(0) @binding(1) var depth_tex: texture_depth_2d;  // prepass depth

// Must match `OverlayLine` in overlay.h.
struct Item {
  a: vec4f,       // xyz, w = width in pixels
  b: vec4f,       // xyz, w = opacity where hidden behind geometry
  color: vec4f,   // sRGB + alpha
  border: vec4f,  // sRGB, a = border width in pixels
};

@group(1) @binding(0) var<storage, read> items: array<Item>;

struct VsOut {
  @builtin(position) clip: vec4f,
  @location(0) px: vec2f,
  @location(1) @interpolate(flat) a_px: vec2f,
  @location(2) @interpolate(flat) b_px: vec2f,
  @location(3) depth: f32,
  @location(4) @interpolate(flat) index: u32,
};

fn to_pixels(c: vec4f) -> vec2f {
  let ndc = c.xy / c.w;
  return vec2f((ndc.x * 0.5 + 0.5) * frame.viewport.x, (0.5 - ndc.y * 0.5) * frame.viewport.y);
}

@vertex
fn vs_main(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> VsOut {
  let it = items[iid];
  var ca = frame.view_proj * vec4f(it.a.xyz, 1.0);
  var cb = frame.view_proj * vec4f(it.b.xyz, 1.0);
  // Clip against the near plane (reversed-Z: visible where w >= z).
  let da = ca.w - ca.z;
  let db = cb.w - cb.z;
  var out: VsOut;
  if (da < 0.0 && db < 0.0) {
    out.clip = vec4f(0.0, 0.0, -2.0, 1.0);
    return out;
  }
  if (da < 0.0) {
    ca = mix(ca, cb, da / (da - db) + 1e-4);
  } else if (db < 0.0) {
    cb = mix(cb, ca, db / (db - da) + 1e-4);
  }
  let pa = to_pixels(ca);
  let pb = to_pixels(cb);
  let r = it.a.w * 0.5 + it.border.a + 1.0;
  var dir = pb - pa;
  let len = length(dir);
  dir = select(vec2f(1.0, 0.0), dir / max(len, 1e-6), len > 1e-3);
  let nrm = vec2f(-dir.y, dir.x);
  var corners = array<vec2f, 6>(vec2f(0.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
                                vec2f(0.0, -1.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0));
  let k = corners[vid];
  let base = mix(pa - dir * r, pb + dir * r, k.x);
  let px = base + nrm * r * k.y;
  out.px = px;
  out.a_px = pa;
  out.b_px = pb;
  out.depth = mix(ca.z / ca.w, cb.z / cb.w, k.x);
  out.clip = vec4f(px.x * frame.viewport.z * 2.0 - 1.0, 1.0 - px.y * frame.viewport.w * 2.0, 0.5, 1.0);
  out.index = iid;
  return out;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4f {
  let it = items[in.index];
  let ba = in.b_px - in.a_px;
  let h = clamp(dot(in.px - in.a_px, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  let d = length(in.px - in.a_px - ba * h);
  let r = it.a.w * 0.5;
  let fill = 1.0 - smoothstep(r - 0.5, r + 0.5, d);
  let outer = 1.0 - smoothstep(r + it.border.a - 0.5, r + it.border.a + 0.5, d);

  // Dots test the depth at their center, lines at every pixel.
  let is_dot = dot(ba, ba) < 1.0;
  let probe = select(in.px, in.a_px, is_dot);
  let size = vec2i(textureDimensions(depth_tex));
  let scene = textureLoad(depth_tex, clamp(vec2i(probe), vec2i(0), size - 1), 0);
  // Wireframe shading is see-through (x-ray).
  let hidden = occluded(scene, in.depth) && frame.wire_mode.x < 0.5;
  let vis = select(1.0, it.b.w, hidden);

  let rgb = mix(it.border.rgb, it.color.rgb, select(fill / max(outer, 1e-4), 1.0, it.border.a <= 0.0));
  let a = select(outer, fill, it.border.a <= 0.0) * it.color.a * vis;
  return vec4f(rgb * a, a);
}
