// Vector glyphs: one instanced arrow mesh (shaft + cone head) per vector.
// The template mesh only stores (angle, ring); the vertex shader shapes it
// so the head keeps a sensible size whatever the arrow length.

#include "common/frame.wgsl"
#include "common/scene.wgsl"
#include STYLE

// Must match `ItemUniforms` in renderer.cpp.
struct ArrowObject {
  color: vec4f,
  material: vec4f,
  radius: f32,        // shaft radius (world units)
  length_scale: f32,
  object_id: u32,
  flags: u32,         // bit 1: cut by the slice plane (arrows whose origin is beyond it vanish)
};

struct Arrow {
  origin: vec4f,
  vector: vec4f,
};

@group(1) @binding(0) var<uniform> aobj: ArrowObject;
@group(1) @binding(1) var<storage, read> arrows: array<Arrow>;

struct VsOut {
  @builtin(position) clip: vec4f,
  @location(0) world_pos: vec3f,
  @location(1) normal: vec3f,
  @location(2) @interpolate(flat) index: u32,
};

// ring: 0/1 shaft bottom/top, 2/3 cone base/tip, 4/5 cone back center/rim,
//       6/7 shaft cap center/rim.
@vertex
fn vs_main(@location(0) tmpl: vec2f, @builtin(instance_index) iid: u32) -> VsOut {
  let a = arrows[iid];
  let vec = a.vector.xyz * aobj.length_scale;
  let len = length(vec);
  let dir = select(vec3f(0.0, 0.0, 1.0), vec / max(len, 1e-20), len > 1e-12);
  let helper = select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0), abs(dir.x) > 0.9);
  let t = normalize(cross(dir, helper));
  let b = cross(dir, t);

  let r = aobj.radius;
  let head_len = min(len * 0.4, r * 7.0);
  let head_r = r * 2.6;
  let body = len - head_len;
  let ring = u32(tmpl.y + 0.5);
  let radial = cos(tmpl.x) * t + sin(tmpl.x) * b;

  var p = vec3f(0.0);
  var n = radial;
  switch ring {
    case 0u: { p = radial * r; }
    case 1u: { p = radial * r + dir * body; }
    case 2u, 3u: {
      p = select(radial * head_r + dir * body, dir * len, ring == 3u);
      n = normalize(radial + dir * (head_r / max(head_len, 1e-6)));
    }
    case 4u: { p = dir * body; n = -dir; }
    case 5u: { p = radial * head_r + dir * body; n = -dir; }
    case 6u: { p = vec3f(0.0); n = -dir; }
    default: { p = radial * r; n = -dir; }
  }
  var out: VsOut;
  out.world_pos = a.origin.xyz + p;
  out.normal = n;
  out.clip = frame.view_proj * vec4f(out.world_pos, 1.0);
  let cut = (aobj.flags & 2u) != 0u && dot(frame.slice.xyz, a.origin.xyz) > frame.slice.w;
  if (len <= 1e-12 || cut) {
    out.clip = vec4f(0.0, 0.0, -2.0, 1.0);
  }
  out.index = iid;
  return out;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4f {
  var s: Surface;
  s.n = normalize(in.normal);
  s.p = in.world_pos;
  s.v = view_dir(in.world_pos);
  s.albedo = aobj.color.rgb;
  s.ao = sample_ao(in.clip.xy);
  s.shadow = sample_shadow(in.world_pos, s.n);
  s.metallic = aobj.material.x;
  s.roughness = aobj.material.y;
  return vec4f(shade(s) * frame.style.y, 1.0);
}

struct PrepassOut {
  @location(0) normal: vec4f,
  @location(1) ids: vec4u,
};

@fragment
fn fs_prepass(in: VsOut) -> PrepassOut {
  var out: PrepassOut;
  out.normal = vec4f(to_view(normalize(in.normal)), 1.0);
  out.ids = vec4u(aobj.object_id, in.index, 0u, 0u);
  return out;
}
