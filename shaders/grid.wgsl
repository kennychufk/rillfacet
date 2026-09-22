// Infinite grid, drawn as one full-screen triangle: each pixel intersects its
// view ray with the grid plane.
//
// The plane is normally the ground (z = ground height), which also catches
// the sun shadow and ambient occlusion. In an axis-aligned orthographic side
// view it is the view plane through the origin (YZ for the X axis, XZ for Y),
// drawn behind everything, as in Blender.
//
// Line spacing adapts per pixel in powers of ten, so the grid is always a
// readable length scale: minor lines fade in/out as you zoom, every tenth
// line is major, and the two in-plane axes are highlighted in axis colors.

#include "common/frame.wgsl"
#include "common/scene.wgsl"

struct VsOut {
  @builtin(position) clip: vec4f,
  @location(0) ndc: vec2f,
};

@vertex
fn vs_fullscreen(@builtin(vertex_index) vid: u32) -> VsOut {
  let uv = vec2f(f32((vid << 1u) & 2u), f32(vid & 2u));
  var out: VsOut;
  out.ndc = uv * 2.0 - 1.0;
  out.clip = vec4f(out.ndc, 0.0, 1.0);
  return out;
}

fn unproject(ndc: vec2f, z: f32) -> vec3f {
  let p = frame.inv_view_proj * vec4f(ndc, z, 1.0);
  return p.xyz / p.w;
}

fn is_background() -> bool {
  return frame.grid_plane.y > 0.5;
}

struct PlaneHit {
  pos: vec3f,
  uv: vec2f,    // coordinates along the plane's two axes
  t: f32,       // ray distance; <= 0 means the ray misses the plane
  depth: f32,
  facing: f32,  // |cos| between view ray and plane normal (0 at the horizon)
};

fn plane_hit(ndc: vec2f) -> PlaneHit {
  // Build the view ray from well-separated points: two unprojected points
  // only a near-plane distance apart would give a noisy direction.
  var o = frame.camera_pos.xyz;
  var d = normalize(unproject(ndc, 0.001) - o);  // reversed-Z: 0.001 = 1000x the near distance
  if (is_ortho()) {
    o = unproject(ndc, 1.0);
    d = -normalize(vec3f(frame.view[0].z, frame.view[1].z, frame.view[2].z));
  }
  let n = u32(frame.grid_plane.x);
  var h: PlaneHit;
  h.facing = abs(d[n]);
  h.t = (frame.grid_params.x - o[n]) / select(d[n], 1e-20, abs(d[n]) < 1e-20);
  h.pos = o + d * h.t;
  h.uv = vec2f(h.pos[u32(frame.grid_plane.z)], h.pos[u32(frame.grid_plane.w)]);
  let clip = frame.view_proj * vec4f(h.pos, 1.0);
  // Background grids sit just in front of the far plane (reversed-Z: 0), so
  // any geometry covers them.
  h.depth = select(clamp(clip.z / clip.w, 0.0, 1.0), 1e-7, is_background());
  return h;
}

// Coverage (0..1) of lines every `spacing` world units, `width_px` wide.
// Each direction fades out once its lines get closer than a few pixels on
// screen, which is what happens to one direction first at grazing angles.
fn lines(p: vec2f, spacing: f32, width_px: f32) -> f32 {
  let coord = p / spacing;
  let w = max(fwidth(coord), vec2f(1e-8));
  let dist = abs(fract(coord - 0.5) - 0.5) / w;
  let keep = smoothstep(vec2f(2.5), vec2f(7.0), 1.0 / w);  // pixels between lines
  let cov = (1.0 - smoothstep(vec2f(width_px * 0.5 - 0.5), vec2f(width_px * 0.5 + 0.5), dist)) * keep;
  return max(cov.x, cov.y);
}

fn axis_line(v: f32, width_px: f32) -> f32 {
  let d = abs(v) / max(fwidth(v), 1e-8);
  return 1.0 - smoothstep(width_px * 0.5 - 0.5, width_px * 0.5 + 0.5, d);
}

struct ColorOut {
  @location(0) color: vec4f,   // premultiplied alpha
  @builtin(frag_depth) depth: f32,
};

@fragment
fn fs_main(in: VsOut) -> ColorOut {
  let g = plane_hit(in.ndc);

  // Pick the decade whose cells are ~12 px wide here. Four decades are drawn
  // and their weights cross-fade, so nothing pops while zooming: as `fade`
  // goes 0 -> 1, every level's weight moves to the next finer level's.
  let footprint = max(length(fwidth(g.uv)), 1e-8);
  let level = log2(footprint * 12.0) / log2(10.0);
  let base = pow(10.0, floor(level));
  let fade = fract(level);
  let wa = frame.grid_minor.a * 0.5;
  let wb = frame.grid_minor.a;
  let wc = frame.grid_major.a;
  let a0 = lines(g.uv, base, 1.0) * wa * (1.0 - fade);
  let a1 = lines(g.uv, base * 10.0, 1.0) * mix(wb, wa, fade);
  let a2 = lines(g.uv, base * 100.0, 1.25) * mix(wc, wb, fade);
  let a3 = lines(g.uv, base * 1000.0, 1.25) * wc * fade;
  let au = axis_line(g.uv.y, 2.0);  // the u axis is the line v = 0
  let av = axis_line(g.uv.x, 2.0);

  // Fade toward the horizon and with distance to avoid shimmering (ground only).
  var vis = frame.grid_params.z;
  if (!is_background()) {
    let horizon = smoothstep(0.03, 0.3, g.facing);
    let far = 1.0 - smoothstep(0.5, 1.0, length(g.pos - frame.camera_pos.xyz) / frame.grid_params.y);
    vis *= horizon * far;
  }

  let minor = max(a0, a1);
  let major = max(a2, a3);
  var rgb = select(frame.grid_minor.rgb, frame.grid_major.rgb, major >= minor);
  var a = max(minor, major) * vis;
  if (au * frame.axis_u.a * vis > a) {
    rgb = frame.axis_u.rgb;
    a = au * frame.axis_u.a * vis;
  }
  if (av * frame.axis_v.a * vis > a) {
    rgb = frame.axis_v.rgb;
    a = av * frame.axis_v.a * vis;
  }

  // Shadow + ambient occlusion catcher: black with alpha = darkness.
  var shade_a = 0.0;
  if (frame.grid_params.w > 0.5 && !is_background()) {
    let lit = sample_shadow(g.pos, vec3f(0.0, 0.0, 1.0)) * sample_ao(in.clip.xy);
    shade_a = (1.0 - lit) * 0.75 * smoothstep(0.0, 0.1, g.facing);
  }

  var out: ColorOut;
  out.color = vec4f(rgb * a, a + shade_a * (1.0 - a));
  out.depth = g.depth;
  if (g.t <= 0.0 && !is_background()) {
    discard;
  }
  return out;
}

struct PrepassOut {
  @location(0) normal: vec4f,
  @location(1) ids: vec4u,
  @builtin(frag_depth) depth: f32,
};

const GROUND_ID: u32 = 0xffffffffu;

// Only the ground takes part in picking and ambient occlusion.
@fragment
fn fs_prepass(in: VsOut) -> PrepassOut {
  let g = plane_hit(in.ndc);
  if (g.t <= 0.0 || is_background()) {
    discard;
  }
  var out: PrepassOut;
  out.normal = vec4f(to_view(vec3f(0.0, 0.0, 1.0)), 1.0);
  out.ids = vec4u(GROUND_ID, 0u, 0u, 0u);
  out.depth = g.depth;
  return out;
}
