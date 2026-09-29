// Shared fragment stages of the web client's meshes, as the native mesh.wgsl
// does them for flat-shaded, two-sided, uniformly colored faces: lit color
// with selection tints and the wire overlay, see-through (OIT), wireframe
// shading, prepass ids and shadow depth. Expects `params` (flags, material)
// and VsOut / ShadowOut (surface_io.wgsl).

// Fragments on the far side of the slice plane are cut away.
fn clipped(p: vec3f) -> bool {
  return (params.flags & 2u) != 0u && dot(frame.slice.xyz, p) > frame.slice.w;
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
fn surface_color(in: VsOut, front: bool, bary_width: vec3f) -> vec3f {
  var s: Surface;
  s.n = select(-in.normal, in.normal, front);  // two-sided lighting
  s.p = in.world;
  s.v = view_dir(in.world);
  s.albedo = in.color;
  s.ao = sample_ao(in.clip.xy);
  s.shadow = sample_shadow(in.world, s.n);
  s.metallic = params.material.x;
  s.roughness = params.material.y;
  var color = shade(s) * frame.style.y;
  if ((in.ids.w & 1u) != 0u) {
    color = mix(color, frame.select_color.rgb, 0.45);
  }
  if ((in.seg_flags & 2u) != 0u) {
    color = mix(color, frame.select_color.rgb, 0.15);
  }
  if (frame.wire.a > 0.0) {
    let cov = edge_coverage(in.bary, bary_width, in.ids.w, frame.wire.a);
    color = mix(color, wire_color(in.seg_flags & 6u, frame.wire.rgb), cov);
  }
  return color;
}

// Lit color into the HDR target (composite.wgsl tone maps and encodes).
@fragment
fn fs_main(in: VsOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  // Screen-space derivatives first: they must run in uniform control flow.
  let bary_width = fwidth(in.bary);
  if (clipped(in.world)) {
    discard;
  }
  return vec4f(surface_color(in, front, bary_width), 1.0);
}

// Weighted blended order-independent transparency (McGuire & Bavoil 2013),
// as mesh.wgsl's fs_transparent; composite.wgsl resolves it.
struct OitOut {
  @location(0) accum: vec4f,
  @location(1) reveal: vec4f,
};

@fragment
fn fs_transparent(in: VsOut, @builtin(front_facing) front: bool) -> OitOut {
  let bary_width = fwidth(in.bary);
  if (clipped(in.world)) {
    discard;
  }
  let color = surface_color(in, front, bary_width);
  let a = params.material.z;
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
  let flags = in.ids.w;
  let albedo = in.color;
  let cov = edge_coverage(in.bary, bary_width, flags, frame.wire.a);
  let wire = wire_color(in.seg_flags, albedo);

  var fill = albedo;
  var fill_a = frame.wire_mode.y;
  if ((flags & 1u) != 0u) {
    fill = select(frame.select_color.rgb, frame.active_color.rgb, (flags & 2u) != 0u);
    fill_a = max(fill_a, 0.3);
  }
  // Premultiplied "wire over fill".
  let a = cov + fill_a * (1.0 - cov);
  if (a <= 0.001 || clipped(in.world)) {
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
  if (clipped(in.world)) {
    discard;
  }
  var out: PrepassOut;
  out.normal = vec4f(to_view(select(-in.normal, in.normal, front)), 1.0);
  out.ids = vec4u(in.ids.x, in.ids.y, in.ids.z, (in.seg_flags >> 1u) & 1u);
  return out;
}

@fragment
fn fs_shadow(in: ShadowOut) {
  if (clipped(in.world)) {
    discard;
  }
}
