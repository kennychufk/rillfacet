// Final image: background gradient + tone mapping + outlines + selection
// outline, then sRGB encoding. Outlines come from the prepass buffers:
//  - silhouettes where the object/segment id changes,
//  - creases where normals or depth jump (outline mode 2 only).

#include "common/frame.wgsl"

@group(0) @binding(1) var color_tex: texture_2d<f32>;  // main pass, premultiplied alpha
@group(0) @binding(2) var id_tex: texture_2d<u32>;
@group(0) @binding(3) var depth_tex: texture_depth_2d;
@group(0) @binding(4) var normal_tex: texture_2d<f32>;

struct VsOut {
  @builtin(position) clip: vec4f,
};

@vertex
fn vs_fullscreen(@builtin(vertex_index) vid: u32) -> VsOut {
  let uv = vec2f(f32((vid << 1u) & 2u), f32(vid & 2u));
  var out: VsOut;
  out.clip = vec4f(uv * 2.0 - 1.0, 0.0, 1.0);
  return out;
}

// Khronos PBR Neutral tone mapper: keeps base colors faithful, rolls off highlights.
fn tonemap_neutral(c_in: vec3f) -> vec3f {
  let start = 0.8 - 0.04;
  let desat = 0.15;
  let x = min(c_in.r, min(c_in.g, c_in.b));
  let offset = select(0.04, x - 6.25 * x * x, x < 0.08);
  var c = c_in - offset;
  let peak = max(c.r, max(c.g, c.b));
  if (peak < start) {
    return c;
  }
  let d = 1.0 - start;
  let new_peak = 1.0 - d * d / (peak + d - start);
  c *= new_peak / peak;
  let g = 1.0 - 1.0 / (desat * (peak - new_peak) + 1.0);
  return mix(c, vec3f(new_peak), g);
}

const GROUND_ID: u32 = 0xffffffffu;

fn is_object(id: u32) -> bool {
  return id != 0u && id != GROUND_ID;
}

fn linear_depth(px: vec2i) -> f32 {
  return view_depth(textureLoad(depth_tex, px, 0));
}

@fragment
fn fs_composite(in: VsOut) -> @location(0) vec4f {
  let px = vec2i(in.clip.xy);
  let size = vec2i(textureDimensions(id_tex));
  let uv = in.clip.xy * frame.viewport.zw;

  var bg = mix(frame.bg_top.rgb, frame.bg_bottom.rgb, uv.y);
  let c = textureLoad(color_tex, px, 0);
  var color = c.rgb / max(c.a, 1e-4);
  if (frame.post.x > 0.5) {
    color = tonemap_neutral(color);
  }
  var rgb = color * c.a + bg * (1.0 - c.a);

  // Outlines: compare this pixel against 8 neighbours `w` pixels away.
  let ids = textureLoad(id_tex, px, 0);
  let w = i32(max(frame.post.y, 1.0));
  let n0 = textureLoad(normal_tex, px, 0).xyz;
  let z0 = linear_depth(px);
  var edge = 0.0;
  var select_edge = 0.0;
  let mode = frame.style.w;  // 0 off, 1 silhouettes, 2 silhouettes + creases
  var dirs = array<vec2i, 8>(vec2i(1, 0), vec2i(-1, 0), vec2i(0, 1), vec2i(0, -1),
                             vec2i(1, 1), vec2i(-1, -1), vec2i(1, -1), vec2i(-1, 1));
  for (var k = 0; k < 8; k++) {
    let q = clamp(px + dirs[k] * w, vec2i(0), size - 1);
    let other = textureLoad(id_tex, q, 0);
    let objects = is_object(ids.x) || is_object(other.x);
    if (mode > 0.5 && objects && (other.x != ids.x || other.z != ids.z)) {
      edge += 1.0;
    } else if (mode > 1.5 && is_object(ids.x) && is_object(other.x)) {
      let n1 = textureLoad(normal_tex, q, 0).xyz;
      let z1 = linear_depth(q);
      if (dot(n0, n1) < 0.8 || abs(z1 - z0) > 0.03 * z0) {
        edge += 0.6;
      }
    }
    if ((other.w & 1u) != (ids.w & 1u)) {
      select_edge += 1.0;
    }
  }
  rgb = mix(rgb, frame.outline_color.rgb, min(edge / 3.0, 1.0) * frame.outline_color.a);
  // Selected segments get a bright outline (drawn on both sides of the edge).
  // Wireframe shading colors the selected wires instead.
  var select_width = 0.0;
  if ((ids.w & 1u) == 0u && select_edge > 0.0) {
    select_width = 1.0;
  } else if (select_edge > 0.0) {
    select_width = 0.6;
  }
  if (frame.wire_mode.x > 0.5) {
    select_width = 0.0;
  }
  rgb = mix(rgb, frame.select_color.rgb, select_width);

  // Tiny noise hides banding in the background gradient.
  let noise = fract(sin(dot(in.clip.xy, vec2f(12.9898, 78.233))) * 43758.5453) - 0.5;
  return vec4f(linear_to_srgb(rgb) + noise / 255.0, 1.0);
}
