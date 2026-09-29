// Shared fragment stages of the web client's meshes, as the native mesh.wgsl
// does them for flat-shaded, two-sided, uniformly colored faces: face normals
// from screen-space derivatives (no per-face vertex copies), turned toward
// the viewer. Expects `params` (flags, material) and VsOut / ShadowOut.

fn face_normal(in: VsOut) -> vec3f {
  let face = cross(dpdx(in.world), dpdy(in.world));
  let n = select(vec3f(0.0, 0.0, 1.0), normalize(face), dot(face, face) > 1e-30);
  return select(-n, n, dot(n, view_dir(in.world)) >= 0.0);
}

// Fragments on the far side of the slice plane are cut away.
fn clipped(p: vec3f) -> bool {
  return (params.flags & 2u) != 0u && dot(frame.slice.xyz, p) > frame.slice.w;
}

fn surface_color(in: VsOut, n: vec3f) -> vec3f {
  var s: Surface;
  s.albedo = in.color;
  s.n = n;
  s.v = view_dir(in.world);
  s.p = in.world;
  s.ao = sample_ao(in.clip.xy);
  s.shadow = sample_shadow(in.world, n);
  s.metallic = params.material.x;
  s.roughness = params.material.y;
  return shade(s) * frame.style.y;
}

// Lit color into the HDR target (composite.wgsl tone maps and encodes).
@fragment
fn fs_main(in: VsOut) -> @location(0) vec4f {
  let n = face_normal(in);  // derivatives before any discard
  if (clipped(in.world)) {
    discard;
  }
  return vec4f(surface_color(in, n), 1.0);
}

// Weighted blended order-independent transparency (McGuire & Bavoil 2013),
// as mesh.wgsl's fs_transparent; composite.wgsl resolves it.
struct OitOut {
  @location(0) accum: vec4f,
  @location(1) reveal: vec4f,
};

@fragment
fn fs_transparent(in: VsOut) -> OitOut {
  let n = face_normal(in);
  if (clipped(in.world)) {
    discard;
  }
  let color = surface_color(in, n);
  let a = params.material.z;
  let z = view_depth(in.clip.z) / 50.0;
  let w = a * clamp(0.03 / (1e-5 + pow(z, 4.0)), 1e-2, 3e3);
  var out: OitOut;
  out.accum = vec4f(color * a * w, a * w);
  out.reveal = vec4f(a);
  return out;
}

struct PrepassOut {
  @location(0) normal: vec4f,  // view-space normal
  @location(1) ids: vec4u,     // object id, face (unused), segment, flags (bit 0 selected)
};

@fragment
fn fs_prepass(in: VsOut) -> PrepassOut {
  let n = face_normal(in);
  if (clipped(in.world)) {
    discard;
  }
  var out: PrepassOut;
  out.normal = vec4f(to_view(n), 1.0);
  out.ids = vec4u(in.ids.x, 0u, in.ids.y, in.ids.z);
  return out;
}

@fragment
fn fs_shadow(in: ShadowOut) {
  if (clipped(in.world)) {
    discard;
  }
}
