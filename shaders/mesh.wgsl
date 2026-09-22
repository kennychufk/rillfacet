// Surface meshes. The vertex shader "pulls" positions straight from storage
// buffers (no vertex buffers): vertex k of the draw is corner k%3 of triangle
// k/3. Every corner can then see its whole triangle, which gives us flat
// normals and barycentric coordinates (for the wireframe) for free.
//
// Entry points: vs_main + fs_main        -> lit color (solid shading)
//               vs_main + fs_transparent -> see-through surfaces (weighted blended OIT)
//               vs_main + fs_wire        -> edges only, see-through (wireframe shading)
//               vs_main + fs_prepass     -> normals + pick ids (prepass)
//               vs_shadow + fs_shadow    -> sun shadow map depth

#include "common/frame.wgsl"
#include "common/scene.wgsl"
#include STYLE

// Must match `MeshUniforms` in renderer.cpp.
struct MeshObject {
  model: mat4x4f,
  base_color: vec4f,     // linear rgb, a = opacity
  color_mode: u32,       // see base_color()
  cmap_row: u32,
  flags: u32,            // bit 0 isolines, bit 1 cut by the slice plane, bit 2 smooth normals
  object_id: u32,
  scalar_range: vec2f,
  iso_spacing: f32,
  edge_band: f32,        // width (px) of the bands showing edge quantities
  material: vec4f,       // x = metallic, y = roughness
};

struct SegmentInfo {
  color: u32,            // packed sRGB
  flags: u32,            // bit 0 hidden, bit 1 selected, bit 2 active
  scalar: f32,
  _pad: u32,
};

@group(1) @binding(0) var<uniform> obj: MeshObject;
@group(1) @binding(1) var<storage, read> positions: array<f32>;     // xyz per vertex
@group(1) @binding(2) var<storage, read> triangles: array<u32>;     // 3 per face
@group(1) @binding(3) var<storage, read> face_segment: array<u32>;  // segment per face
@group(1) @binding(4) var<storage, read> segments: array<SegmentInfo>;
// Per-vertex values of the coloring quantity: scalars, or packed sRGB colors
// (bitcast); for edge quantities 3 values per face instead (edge k = corners k, k+1).
@group(1) @binding(5) var<storage, read> vertex_attr: array<f32>;
// face_info.x = face scalar bits or packed color; face_info.y flags: bit 0
// selected, bit 1 active, bits 2..4 = edge k (corners k, k+1) is flat and hidden in wireframes.
@group(1) @binding(6) var<storage, read> face_info: array<vec2u>;
// Faces around each vertex (CSR: V+1 offsets into this array, then face ids).
@group(1) @binding(7) var<storage, read> vertex_faces: array<u32>;

struct VsOut {
  @builtin(position) clip: vec4f,
  @location(0) world_pos: vec3f,
  @location(1) normal: vec3f,
  @location(2) bary: vec3f,
  @location(3) scalar: f32,
  @location(4) @interpolate(flat) face: u32,
  @location(5) color: vec3f,
};

fn load_position(i: u32) -> vec3f {
  let p = vec3f(positions[3u * i], positions[3u * i + 1u], positions[3u * i + 2u]);
  return (obj.model * vec4f(p, 1.0)).xyz;
}

fn face_cross(f: u32) -> vec3f {
  let p0 = load_position(triangles[3u * f]);
  let p1 = load_position(triangles[3u * f + 1u]);
  let p2 = load_position(triangles[3u * f + 2u]);
  return cross(p1 - p0, p2 - p0);
}

// Area-weighted average of the face normals around vertex v.
fn vertex_normal(v: u32) -> vec3f {
  var n = vec3f(0.0);
  for (var k = vertex_faces[v]; k < vertex_faces[v + 1u]; k++) {
    n += face_cross(vertex_faces[k]);
  }
  return n;
}

fn is_hidden(face: u32) -> bool {
  return (segments[face_segment[face]].flags & 1u) != 0u;
}

// Fragments on the far side of the slice plane are cut away.
fn clipped(p: vec3f) -> bool {
  return (obj.flags & 2u) != 0u && dot(frame.slice.xyz, p) > frame.slice.w;
}

// Pushes a vertex outside the clip volume so its triangle is dropped.
const CULLED = vec4f(0.0, 0.0, -2.0, 1.0);

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VsOut {
  let face = vid / 3u;
  let corner = vid % 3u;
  let p0 = load_position(triangles[3u * face]);
  let p1 = load_position(triangles[3u * face + 1u]);
  let p2 = load_position(triangles[3u * face + 2u]);
  let p = select(select(p2, p1, corner == 1u), p0, corner == 0u);
  let vi = triangles[3u * face + corner];

  var out: VsOut;
  out.world_pos = p;
  out.clip = select(frame.view_proj * vec4f(p, 1.0), CULLED, is_hidden(face));
  let c = cross(p1 - p0, p2 - p0);
  var n = select(vec3f(0.0, 0.0, 1.0), normalize(c), dot(c, c) > 1e-30);
  if ((obj.flags & 4u) != 0u) {
    let vn = vertex_normal(vi);
    if (dot(vn, vn) > 1e-30) {
      n = normalize(vn);
    }
  }
  out.normal = n;
  out.bary = vec3f(f32(corner == 0u), f32(corner == 1u), f32(corner == 2u));
  let a = vertex_attr[min(vi, arrayLength(&vertex_attr) - 1u)];
  out.scalar = a;
  out.color = unpack_srgb(bitcast<u32>(a));
  out.face = face;
  return out;
}

fn scalar_color(value: f32, value_width: f32, iso: bool) -> vec3f {
  let t = (value - obj.scalar_range.x) / max(obj.scalar_range.y - obj.scalar_range.x, 1e-20);
  var c = colormap(obj.cmap_row, t);
  if (iso && (obj.flags & 1u) != 0u && obj.iso_spacing > 0.0) {
    // Contour lines: distance to the nearest multiple of iso_spacing, in pixels.
    let d = abs(fract(value / obj.iso_spacing + 0.5) - 0.5) * obj.iso_spacing / max(value_width, 1e-20);
    c *= mix(0.35, 1.0, smoothstep(0.5, 1.5, d));
  }
  return c;
}

// Base color from the active color source. Modes:
// 0 uniform, 1 segment colors, 2 vertex scalar, 3 face scalar, 4 segment scalar,
// 5 vertex color, 6 face color, 7 edge scalar, 8 edge color.
fn base_color(in: VsOut, value_width: f32, bary_width: vec3f) -> vec3f {
  let seg = segments[face_segment[in.face]];
  switch obj.color_mode {
    case 1u: { return unpack_srgb(seg.color); }
    case 2u: { return scalar_color(in.scalar, value_width, true); }
    case 3u: { return scalar_color(bitcast<f32>(face_info[in.face].x), 0.0, false); }
    case 4u: { return scalar_color(seg.scalar, 0.0, false); }
    case 5u: { return in.color; }
    case 6u: { return unpack_srgb(face_info[in.face].x); }
    case 7u, 8u: {
      // Bands along the edges, each in its edge's color; the rest stays uniform.
      let d = in.bary / max(bary_width, vec3f(1e-6));
      var corner = 0u;
      if (d.y < d.x && d.y <= d.z) { corner = 1u; }
      if (d.z < d.x && d.z < d.y) { corner = 2u; }
      let dist = min(d.x, min(d.y, d.z));
      let edge = (corner + 1u) % 3u;  // edge k lies opposite corner (k + 2) % 3
      let v = vertex_attr[min(3u * in.face + edge, arrayLength(&vertex_attr) - 1u)];
      let band = select(scalar_color(v, 0.0, false), unpack_srgb(bitcast<u32>(v)), obj.color_mode == 8u);
      return mix(band, obj.base_color.rgb, smoothstep(obj.edge_band - 0.5, obj.edge_band + 0.5, dist));
    }
    default: { return obj.base_color.rgb; }
  }
}

// Coverage (0..1) of this triangle's edges at the pixel, `width_px` wide.
// Each triangle draws the inner half of its edges, so a shared edge comes out
// full width. Edges flagged flat in `flags` are skipped.
fn edge_coverage(bary: vec3f, bary_width: vec3f, flags: u32, width_px: f32) -> f32 {
  var d = bary / max(bary_width, vec3f(1e-6));  // pixels to the edge opposite each corner
  // Edge k joins corners k and k+1, so it lies opposite corner (k + 2) % 3.
  if ((flags & 4u) != 0u) { d.z = 1e6; }
  if ((flags & 8u) != 0u) { d.x = 1e6; }
  if ((flags & 16u) != 0u) { d.y = 1e6; }
  let edge = min(d.x, min(d.y, d.z));
  let w = width_px * 0.5;
  return 1.0 - smoothstep(w - 0.5, w + 0.5, edge);
}

// Wire color: theme or object color, orange when its body is selected.
fn wire_color(seg_flags: u32, albedo: vec3f) -> vec3f {
  if ((seg_flags & 2u) != 0u) {
    return select(frame.select_color.rgb, frame.active_color.rgb, (seg_flags & 4u) != 0u);
  }
  return select(frame.wire.rgb, albedo, frame.wire_mode.z > 0.5);
}

// Lit surface color, selection tint and wireframe overlay.
fn surface_color(in: VsOut, front: bool, value_width: f32, bary_width: vec3f) -> vec3f {
  var s: Surface;
  s.n = select(-in.normal, in.normal, front);  // two-sided lighting
  if (dot(s.n, s.n) < 1e-12) {
    s.n = vec3f(0.0, 0.0, 1.0);
  }
  s.n = normalize(s.n);
  s.p = in.world_pos;
  s.v = view_dir(in.world_pos);
  s.albedo = base_color(in, value_width, bary_width);
  s.ao = sample_ao(in.clip.xy);
  s.shadow = sample_shadow(in.world_pos, s.n);
  s.metallic = obj.material.x;
  s.roughness = obj.material.y;
  var color = shade(s) * frame.style.y;

  let seg_flags = segments[face_segment[in.face]].flags;
  if ((face_info[in.face].y & 1u) != 0u) {
    color = mix(color, frame.select_color.rgb, 0.45);
  }
  if ((seg_flags & 2u) != 0u) {
    color = mix(color, frame.select_color.rgb, 0.15);
  }
  if (frame.wire.a > 0.0) {
    let cov = edge_coverage(in.bary, bary_width, face_info[in.face].y, frame.wire.a);
    color = mix(color, wire_color(seg_flags & 6u, frame.wire.rgb), cov);
  }
  return color;
}

@fragment
fn fs_main(in: VsOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  // Screen-space derivatives first: they must run in uniform control flow.
  let bary_width = fwidth(in.bary);
  let value_width = fwidth(in.scalar);
  if (clipped(in.world_pos)) {
    discard;
  }
  return vec4f(surface_color(in, front, value_width, bary_width), 1.0);
}

// Weighted blended order-independent transparency (McGuire & Bavoil 2013):
// every see-through fragment adds to a weighted color sum and multiplies the
// "revealage"; composite.wgsl resolves both, so draw order does not matter.
struct OitOut {
  @location(0) accum: vec4f,
  @location(1) reveal: vec4f,
};

@fragment
fn fs_transparent(in: VsOut, @builtin(front_facing) front: bool) -> OitOut {
  let bary_width = fwidth(in.bary);
  let value_width = fwidth(in.scalar);
  if (clipped(in.world_pos)) {
    discard;
  }
  let color = surface_color(in, front, value_width, bary_width);
  let a = obj.base_color.a;
  let z = view_depth(in.clip.z) / 50.0;
  let w = a * clamp(0.03 / (1e-5 + pow(z, 4.0)), 1e-2, 3e3);
  var out: OitOut;
  out.accum = vec4f(color * a * w, a * w);
  out.reveal = vec4f(a);
  return out;
}

// Wireframe shading (Blender's "Wireframe" mode with X-ray): only edges, no
// depth test, so hidden edges show through. An optional faint face fill
// (frame.wire_mode.y) keeps shapes readable; selected faces get a tint.
@fragment
fn fs_wire(in: VsOut) -> @location(0) vec4f {
  let bary_width = fwidth(in.bary);
  let value_width = fwidth(in.scalar);
  let flags = face_info[in.face].y;
  let albedo = base_color(in, value_width, bary_width);
  let cov = edge_coverage(in.bary, bary_width, flags, frame.wire.a);
  let wire = wire_color(segments[face_segment[in.face]].flags, albedo);

  var fill = albedo;
  var fill_a = frame.wire_mode.y;
  if ((flags & 1u) != 0u) {
    fill = select(frame.select_color.rgb, frame.active_color.rgb, (flags & 2u) != 0u);
    fill_a = max(fill_a, 0.3);
  }
  // Premultiplied "wire over fill".
  let a = cov + fill_a * (1.0 - cov);
  if (a <= 0.001 || clipped(in.world_pos)) {
    discard;
  }
  return vec4f(wire * cov + fill * fill_a * (1.0 - cov), a);
}

struct PrepassOut {
  @location(0) normal: vec4f,  // view-space normal
  @location(1) ids: vec4u,     // object id, face, segment, flags (bit 0 segment selected)
};

@fragment
fn fs_prepass(in: VsOut, @builtin(front_facing) front: bool) -> PrepassOut {
  if (clipped(in.world_pos)) {
    discard;
  }
  var out: PrepassOut;
  out.normal = vec4f(to_view(select(-in.normal, in.normal, front)), 1.0);
  let seg = face_segment[in.face];
  out.ids = vec4u(obj.object_id, in.face, seg, (segments[seg].flags >> 1u) & 1u);
  return out;
}

struct ShadowOut {
  @builtin(position) clip: vec4f,
  @location(0) world_pos: vec3f,
};

@vertex
fn vs_shadow(@builtin(vertex_index) vid: u32) -> ShadowOut {
  let face = vid / 3u;
  var out: ShadowOut;
  out.world_pos = load_position(triangles[vid]);
  out.clip = select(frame.light_view_proj * vec4f(out.world_pos, 1.0), CULLED, is_hidden(face));
  return out;
}

@fragment
fn fs_shadow(in: ShadowOut) {
  if (clipped(in.world_pos)) {
    discard;
  }
}
