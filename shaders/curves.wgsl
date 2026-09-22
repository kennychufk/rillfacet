// Curve networks as tubes: every edge is a capsule (a cylinder with round
// caps) ray-traced inside a box drawn around it. Neighbouring capsules share
// their end spheres, so joints come out smooth; round at any zoom.

#include "common/frame.wgsl"
#include "common/scene.wgsl"
#include STYLE

// Must match `CurveUniforms` in renderer.cpp.
struct CurveObject {
  color: vec4f,         // linear rgb
  material: vec4f,      // x = metallic, y = roughness
  radius: f32,
  color_mode: u32,      // 0 uniform, 2 node scalar, 3 edge scalar, 5 node color, 6 edge color
  object_id: u32,
  flags: u32,           // bit 1 cut by the slice plane, bit 3 whole network selected
  scalar_range: vec2f,
  cmap_row: u32,
  _pad: u32,
};

@group(1) @binding(0) var<uniform> cobj: CurveObject;
@group(1) @binding(1) var<storage, read> nodes: array<f32>;       // xyz per node
@group(1) @binding(2) var<storage, read> edges: array<u32>;       // 2 nodes per edge
@group(1) @binding(3) var<storage, read> node_attr: array<f32>;   // scalar or packed color
@group(1) @binding(4) var<storage, read> edge_attr: array<f32>;

struct VsOut {
  @builtin(position) clip: vec4f,
  @location(0) world_pos: vec3f,  // on the proxy box
  @location(1) @interpolate(flat) index: u32,
};

fn node(i: u32) -> vec3f {
  return vec3f(nodes[3u * i], nodes[3u * i + 1u], nodes[3u * i + 2u]);
}

// 12 triangles of a box, as corners (x, y, z in {0, 1}) packed in 3 bits.
const BOX = array<u32, 36>(0u, 1u, 3u, 0u, 3u, 2u,  4u, 6u, 7u, 4u, 7u, 5u,
                           0u, 4u, 5u, 0u, 5u, 1u,  2u, 3u, 7u, 2u, 7u, 6u,
                           0u, 2u, 6u, 0u, 6u, 4u,  1u, 5u, 7u, 1u, 7u, 3u);

@vertex
fn vs_main(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> VsOut {
  let a = node(edges[2u * iid]);
  let b = node(edges[2u * iid + 1u]);
  let r = cobj.radius;
  let axis = b - a;
  let len = length(axis);
  let dir = select(vec3f(0.0, 0.0, 1.0), axis / max(len, 1e-20), len > 1e-12);
  let helper = select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0), abs(dir.x) > 0.9);
  let t = normalize(cross(dir, helper));
  let bn = cross(dir, t);
  var box = BOX;
  let k = box[vid];
  let fx = f32(k & 1u) * 2.0 - 1.0;
  let fy = f32((k >> 1u) & 1u) * 2.0 - 1.0;
  let fz = f32((k >> 2u) & 1u);
  var out: VsOut;
  out.world_pos = a + dir * (fz * (len + 2.0 * r) - r) + (t * fx + bn * fy) * r * 1.01;
  out.clip = frame.view_proj * vec4f(out.world_pos, 1.0);
  out.index = iid;
  return out;
}

// Ray vs capsule (Inigo Quilez), returns the ray distance or -1.
fn capsule_hit(ro: vec3f, rd: vec3f, pa: vec3f, pb: vec3f, r: f32) -> f32 {
  let ba = pb - pa;
  let oa = ro - pa;
  let baba = dot(ba, ba);
  let bard = dot(ba, rd);
  let baoa = dot(ba, oa);
  let rdoa = dot(rd, oa);
  let oaoa = dot(oa, oa);
  let a = baba - bard * bard;
  let b = baba * rdoa - baoa * bard;
  let c = baba * oaoa - baoa * baoa - r * r * baba;
  let h = b * b - a * c;
  if (h >= 0.0 && abs(a) > 1e-12) {
    let t = (-b - sqrt(h)) / a;
    let y = baoa + t * bard;
    if (y > 0.0 && y < baba) {
      return t;
    }
  }
  // End caps.
  var best = -1.0;
  for (var e = 0; e < 2; e++) {
    let oc = select(ro - pb, oa, e == 0);
    let b2 = dot(rd, oc);
    let h2 = b2 * b2 - (dot(oc, oc) - r * r);
    if (h2 > 0.0) {
      let t2 = -b2 - sqrt(h2);
      if (t2 > 0.0 && (best < 0.0 || t2 < best)) {
        best = t2;
      }
    }
  }
  return best;
}

struct Hit {
  pos: vec3f,
  normal: vec3f,
  along: f32,  // 0 at the first node, 1 at the second
  depth: f32,
};

fn trace(in: VsOut) -> Hit {
  let pa = node(edges[2u * in.index]);
  let pb = node(edges[2u * in.index + 1u]);
  let r = cobj.radius;
  var rd = normalize(in.world_pos - frame.camera_pos.xyz);
  var ro = frame.camera_pos.xyz;
  if (is_ortho()) {
    rd = -normalize(vec3f(frame.view[0].z, frame.view[1].z, frame.view[2].z));
    ro = in.world_pos - rd * (2.0 * (length(pb - pa) + 4.0 * r));
  }
  let t = capsule_hit(ro, rd, pa, pb, r);
  if (t < 0.0) {
    discard;
  }
  var hit: Hit;
  hit.pos = ro + rd * t;
  let ba = pb - pa;
  hit.along = clamp(dot(hit.pos - pa, ba) / max(dot(ba, ba), 1e-20), 0.0, 1.0);
  hit.normal = normalize(hit.pos - (pa + ba * hit.along));
  let clip = frame.view_proj * vec4f(hit.pos, 1.0);
  hit.depth = clip.z / clip.w;
  if ((cobj.flags & 2u) != 0u && dot(frame.slice.xyz, hit.pos) > frame.slice.w) {
    discard;
  }
  return hit;
}

fn attr_color(v: f32) -> vec3f {
  return colormap(cobj.cmap_row, (v - cobj.scalar_range.x) / max(cobj.scalar_range.y - cobj.scalar_range.x, 1e-20));
}

fn curve_albedo(edge: u32, along: f32) -> vec3f {
  let i0 = edges[2u * edge];
  let i1 = edges[2u * edge + 1u];
  let nn = arrayLength(&node_attr) - 1u;
  switch cobj.color_mode {
    case 2u: { return attr_color(mix(node_attr[min(i0, nn)], node_attr[min(i1, nn)], along)); }
    case 3u: { return attr_color(edge_attr[min(edge, arrayLength(&edge_attr) - 1u)]); }
    case 5u: {
      return mix(unpack_srgb(bitcast<u32>(node_attr[min(i0, nn)])), unpack_srgb(bitcast<u32>(node_attr[min(i1, nn)])), along);
    }
    case 6u: { return unpack_srgb(bitcast<u32>(edge_attr[min(edge, arrayLength(&edge_attr) - 1u)])); }
    default: { return cobj.color.rgb; }
  }
}

struct ColorOut {
  @location(0) color: vec4f,
  @builtin(frag_depth) depth: f32,
};

@fragment
fn fs_main(in: VsOut) -> ColorOut {
  let hit = trace(in);
  var s: Surface;
  s.p = hit.pos;
  s.n = hit.normal;
  s.v = view_dir(hit.pos);
  s.albedo = curve_albedo(in.index, hit.along);
  s.ao = sample_ao(in.clip.xy);
  s.shadow = sample_shadow(s.p, s.n);
  s.metallic = cobj.material.x;
  s.roughness = cobj.material.y;
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
  out.normal = vec4f(to_view(hit.normal), 1.0);
  out.ids = vec4u(cobj.object_id, in.index, 0u, (cobj.flags >> 3u) & 1u);
  out.depth = hit.depth;
  return out;
}
