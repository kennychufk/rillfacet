// Web client: small geometry rebuilt on the CPU when it changes (meter boxes,
// markers): world-space vertices with a packed sRGB color each, pulled per
// triangle corner as in rigid.wgsl. Fragment stages in surface.wgsl.
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
@group(1) @binding(1) var<storage, read> positions: array<f32>;  // xyz per vertex
@group(1) @binding(2) var<storage, read> colors: array<u32>;     // packed sRGB per vertex
@group(1) @binding(3) var<storage, read> triangles: array<u32>;  // 3 per face
// Per face: as rigid.wgsl, plus bit 5 hidden (a box of an env not shown).
@group(1) @binding(4) var<storage, read> face_info: array<u32>;
// The object's one segment: color (unused), flags (bit 1 selected, bit 2 active).
@group(1) @binding(5) var<storage, read> segments: array<vec2u>;

#include "surface_io.wgsl"

fn load_position(i: u32) -> vec3f {
  return vec3f(positions[3u * i], positions[3u * i + 1u], positions[3u * i + 2u]);
}

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VsOut {
  let face = vid / 3u;
  let corner = vid % 3u;
  let p0 = load_position(triangles[3u * face]);
  let p1 = load_position(triangles[3u * face + 1u]);
  let p2 = load_position(triangles[3u * face + 2u]);
  var seg = segments[0];
  seg.x = colors[triangles[vid]];
  seg.y |= select(0u, 1u, (face_info[face] & 32u) != 0u);
  return surface_vertex(p0, p1, p2, corner, face, 0u, seg, face_info[face]);
}

@vertex
fn vs_shadow(@builtin(vertex_index) vid: u32) -> ShadowOut {
  let w = load_position(triangles[vid]);
  var out: ShadowOut;
  out.world = w;
  out.clip = select(frame.light_view_proj * vec4f(w, 1.0), CULLED, (face_info[vid / 3u] & 32u) != 0u);
  return out;
}

#include "surface.wgsl"
