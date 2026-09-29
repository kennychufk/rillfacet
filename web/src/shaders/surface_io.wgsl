// Vertex outputs of the web client's meshes and the shared corner setup
// (the native mesh.wgsl vs_main for flat-shaded, uniformly colored faces).

struct VsOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) @interpolate(flat) normal: vec3f,
  @location(2) bary: vec3f,
  @location(3) @interpolate(flat) color: vec3f,
  @location(4) @interpolate(flat) ids: vec4u,  // object id, face, segment, face flags
  @location(5) @interpolate(flat) seg_flags: u32,
};

struct ShadowOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
};

// Pushes a vertex outside the clip volume so its triangle is dropped.
const CULLED = vec4f(0.0, 0.0, -2.0, 1.0);

// Corner `corner` of the world triangle p0 p1 p2; `seg` = (packed color, flags).
fn surface_vertex(p0: vec3f, p1: vec3f, p2: vec3f, corner: u32, face: u32, segment: u32,
                  seg: vec2u, face_flags: u32) -> VsOut {
  let p = select(select(p2, p1, corner == 1u), p0, corner == 0u);
  var out: VsOut;
  out.world = p;
  out.clip = select(frame.view_proj * vec4f(p, 1.0), CULLED, (seg.y & 1u) != 0u);
  let c = cross(p1 - p0, p2 - p0);
  out.normal = select(vec3f(0.0, 0.0, 1.0), normalize(c), dot(c, c) > 1e-30);
  out.bary = vec3f(f32(corner == 0u), f32(corner == 1u), f32(corner == 2u));
  out.color = unpack_srgb(seg.x);
  out.ids = vec4u(params.object_id, face, segment, face_flags);
  out.seg_flags = seg.y;
  return out;
}
