// Screen-space ambient occlusion from the prepass depth + normals.
// Estimator: McGuire et al., "Scalable Ambient Obscurance" (HPG 2012).
// A cheap way to darken creases and contact points without any lights.

#include "common/frame.wgsl"

@group(0) @binding(1) var depth_tex: texture_depth_2d;
@group(0) @binding(2) var normal_tex: texture_2d<f32>;
@group(0) @binding(3) var ao_raw: texture_2d<f32>;  // blur pass input

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

fn view_pos(px: vec2i) -> vec3f {
  let d = textureLoad(depth_tex, px, 0);
  let uv = (vec2f(px) + 0.5) * frame.viewport.zw;
  let v = frame.inv_proj * vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, max(d, 1e-7), 1.0);
  return v.xyz / v.w;
}

const SAMPLES: i32 = 16;
const TURNS: f32 = 7.0;

@fragment
fn fs_ssao(in: VsOut) -> @location(0) vec4f {
  let px = vec2i(in.clip.xy);
  let size = vec2i(textureDimensions(depth_tex));
  if (textureLoad(depth_tex, px, 0) <= 0.0) {
    return vec4f(1.0);  // sky
  }
  let p = view_pos(px);
  let n = textureLoad(normal_tex, px, 0).xyz;

  let radius = frame.ao.x;
  // Radius in pixels: projected size of `radius` at this depth.
  let scale = frame.viewport.y * frame.proj[1][1] * 0.5;
  let radius_px = select(radius * scale / max(-p.z, 1e-4), radius * scale, is_ortho());
  if (radius_px < 1.0) {
    return vec4f(1.0);
  }
  // Each pixel of a 4x4 tile rotates the sample spiral differently; the 4x4
  // blur below then averages all 16 rotations, removing the noise.
  let tile = (px.x & 3) + 4 * (px.y & 3);
  let spin = f32((tile * 7) % 16) / 16.0 * 2.0 * PI;
  let r2 = radius * radius;
  var sum = 0.0;
  for (var i = 0; i < SAMPLES; i++) {
    let alpha = (f32(i) + 0.5) / f32(SAMPLES);
    let angle = alpha * TURNS * 2.0 * PI + spin;
    let offset = vec2f(cos(angle), sin(angle)) * alpha * min(radius_px, 120.0);
    let q_px = clamp(px + vec2i(offset), vec2i(0), size - 1);
    if (textureLoad(depth_tex, q_px, 0) <= 0.0) {
      continue;
    }
    let v = view_pos(q_px) - p;
    let vv = dot(v, v);
    let vn = dot(v, n);
    let f = max(r2 - vv, 0.0);
    sum += f * f * f * max((vn - frame.ao.y * radius) / (0.01 * r2 + vv), 0.0);
  }
  let ao = max(0.0, 1.0 - sum * frame.ao.z * 5.0 / (r2 * r2 * r2 * f32(SAMPLES)));
  return vec4f(ao, ao, ao, 1.0);
}

// 4x4 blur (one full rotation tile) that does not bleed across depth edges.
@fragment
fn fs_blur(in: VsOut) -> @location(0) vec4f {
  let px = vec2i(in.clip.xy);
  let size = vec2i(textureDimensions(ao_raw));
  let z0 = view_pos(px).z;
  var sum = 0.0;
  var weight = 0.0;
  for (var y = -2; y <= 1; y++) {
    for (var x = -2; x <= 1; x++) {
      let q = clamp(px + vec2i(x, y), vec2i(0), size - 1);
      let z = view_pos(q).z;
      let w = 1.0 / (1e-4 + abs(z - z0) / max(abs(z0), 1e-3) * 50.0 + 1.0);
      sum += textureLoad(ao_raw, q, 0).r * w;
      weight += w;
    }
  }
  let ao = sum / weight;
  return vec4f(ao, ao, ao, 1.0);
}
