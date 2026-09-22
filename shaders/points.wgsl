// Point clouds as sphere "impostors": each point is drawn as a small square,
// and the fragment shader ray-traces a perfect sphere inside it, writing the
// true depth. Round at any zoom, and only 2 triangles per point.

#include "common/frame.wgsl"
#include "common/scene.wgsl"
#include STYLE

// Must match `ItemUniforms` in renderer.cpp.
struct PointObject {
  color: vec4f,      // linear rgb
  material: vec4f,   // x = metallic, y = roughness
  radius: f32,       // used when a point's own radius is negative
  _unused: f32,
  object_id: u32,
  _pad: u32,
};

@group(1) @binding(0) var<uniform> pobj: PointObject;
@group(1) @binding(1) var<storage, read> points: array<vec4f>;  // xyz + radius

struct VsOut {
  @builtin(position) clip: vec4f,
  @location(0) quad_pos: vec3f,                   // view space
  @location(1) @interpolate(flat) center: vec3f,  // view space
  @location(2) @interpolate(flat) radius: f32,
  @location(3) @interpolate(flat) index: u32,
};

@vertex
fn vs_main(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> VsOut {
  let pt = points[iid];
  let r = select(pobj.radius, pt.w, pt.w > 0.0);
  let c = (frame.view * vec4f(pt.xyz, 1.0)).xyz;
  var corners = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
                                vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
  // 1.3x covers the perspective bulge of the silhouette.
  let q = vec3f(c.xy + corners[vid] * r * 1.3, c.z + r);
  var out: VsOut;
  out.clip = frame.proj * vec4f(q, 1.0);
  out.quad_pos = q;
  out.center = c;
  out.radius = r;
  out.index = iid;
  return out;
}

struct Hit {
  pos: vec3f,     // view space
  normal: vec3f,  // view space
  depth: f32,
};

fn trace(in: VsOut) -> Hit {
  var o = vec3f(0.0);
  var d = normalize(in.quad_pos);
  if (is_ortho()) {
    o = vec3f(in.quad_pos.xy, in.quad_pos.z + 1.0);
    d = vec3f(0.0, 0.0, -1.0);
  }
  let oc = o - in.center;
  let b = dot(oc, d);
  let h = b * b - (dot(oc, oc) - in.radius * in.radius);
  if (h < 0.0) {
    discard;
  }
  var hit: Hit;
  hit.pos = o + d * (-b - sqrt(h));
  hit.normal = (hit.pos - in.center) / in.radius;
  let clip = frame.proj * vec4f(hit.pos, 1.0);
  hit.depth = clip.z / clip.w;
  return hit;
}

struct ColorOut {
  @location(0) color: vec4f,
  @builtin(frag_depth) depth: f32,
};

@fragment
fn fs_main(in: VsOut) -> ColorOut {
  let hit = trace(in);
  var s: Surface;
  s.p = (frame.inv_view * vec4f(hit.pos, 1.0)).xyz;
  s.n = normalize((frame.inv_view * vec4f(hit.normal, 0.0)).xyz);
  s.v = view_dir(s.p);
  s.albedo = pobj.color.rgb;
  s.ao = sample_ao(in.clip.xy);
  s.shadow = sample_shadow(s.p, s.n);
  s.metallic = pobj.material.x;
  s.roughness = pobj.material.y;
  var out: ColorOut;
  out.color = vec4f(shade(s) * frame.style.y, 1.0);
  out.depth = hit.depth;
  return out;
}

struct PrepassOut {
  @location(0) normal: vec4f,
  @location(1) ids: vec4u,
  @builtin(frag_depth) depth: f32,
};

@fragment
fn fs_prepass(in: VsOut) -> PrepassOut {
  let hit = trace(in);
  var out: PrepassOut;
  out.normal = vec4f(hit.normal, 1.0);
  out.ids = vec4u(pobj.object_id, in.index, 0u, 0u);
  out.depth = hit.depth;
  return out;
}
