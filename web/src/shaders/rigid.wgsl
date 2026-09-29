// Web client: rigid bodies drawn from BODY-LOCAL vertices and one pose per
// (instance, body), so a frame only uploads the poses. One instanced draw per
// rigid mesh (instance = env). As the native mesh.wgsl, the vertex shader
// "pulls" positions from storage buffers (vertex k of an instance is corner
// k%3 of its triangle k/3), which gives flat normals and barycentric
// coordinates (for wires) for free. Faces and segments are numbered as the
// native viewer's merged mesh of all instances: face = instance * T + t,
// segment = instance * B + body. Fragment stages in surface.wgsl.
#include "common/frame.wgsl"
#include "common/scene.wgsl"
#include STYLE

struct Params {
  num_bodies: u32,
  object_id: u32,
  flags: u32,          // bit 1: cut by the slice plane (as MeshObject.flags)
  num_faces: u32,      // triangles per instance
  material: vec4f,     // x = metallic, y = roughness, z = opacity
};

@group(1) @binding(0) var<uniform> params: Params;
@group(1) @binding(1) var<storage, read> poses: array<vec4f>;     // 2 per segment: t, q (xyzw)
// Per segment: x = packed sRGB color, y = flags (bit 0 hidden, bit 1 selected, bit 2 active).
@group(1) @binding(2) var<storage, read> segments: array<vec2u>;
@group(1) @binding(3) var<storage, read> offsets: array<vec4f>;   // per instance (display grid)
@group(1) @binding(4) var<storage, read> local: array<f32>;       // xyz per template vertex
@group(1) @binding(5) var<storage, read> vertex_body: array<u32>;
@group(1) @binding(6) var<storage, read> triangles: array<u32>;   // 3 per template face
// Per face of all instances: bit 0 selected, bit 1 active, bits 2..4 = edge k
// (corners k, k+1) is flat and hidden in wireframes (mesh.wgsl face_info.y).
@group(1) @binding(7) var<storage, read> face_info: array<u32>;

#include "surface_io.wgsl"

fn quat_rotate(q: vec4f, v: vec3f) -> vec3f {
  let u = 2.0 * cross(q.xyz, v);
  return v + q.w * u + cross(q.xyz, u);
}

fn world_of(v: u32, inst: u32) -> vec3f {
  let s = inst * params.num_bodies + vertex_body[v];
  let p = vec3f(local[3u * v], local[3u * v + 1u], local[3u * v + 2u]);
  return poses[2u * s].xyz + quat_rotate(poses[2u * s + 1u], p) + offsets[inst].xyz;
}

fn segment_of(t: u32, inst: u32) -> u32 {
  return inst * params.num_bodies + vertex_body[triangles[3u * t]];
}

@vertex
fn vs_main(@builtin(vertex_index) vid: u32, @builtin(instance_index) inst: u32) -> VsOut {
  let t = vid / 3u;
  let corner = vid % 3u;
  let p0 = world_of(triangles[3u * t], inst);
  let p1 = world_of(triangles[3u * t + 1u], inst);
  let p2 = world_of(triangles[3u * t + 2u], inst);
  let s = segment_of(t, inst);
  let face = inst * params.num_faces + t;
  return surface_vertex(p0, p1, p2, corner, face, s, segments[s], face_info[face]);
}

@vertex
fn vs_shadow(@builtin(vertex_index) vid: u32, @builtin(instance_index) inst: u32) -> ShadowOut {
  let t = vid / 3u;
  let w = world_of(triangles[vid], inst);
  var out: ShadowOut;
  out.world = w;
  let hidden = (segments[segment_of(t, inst)].y & 1u) != 0u;
  out.clip = select(frame.light_view_proj * vec4f(w, 1.0), CULLED, hidden);
  return out;
}

#include "surface.wgsl"
