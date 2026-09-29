// Shared fragment stage of the web client's meshes: flat faces (normals from
// screen-space derivatives, so no per-face vertex copies), turned toward the
// viewer, shaded by the style, exposure, then sRGB for the canvas.
@fragment
fn fs_main(in: VsOut) -> @location(0) vec4f {
  let face = normalize(cross(dpdx(in.world), dpdy(in.world)));
  let v = view_dir(in.world);
  var s: Surface;
  s.albedo = in.color;
  s.n = select(-face, face, dot(face, v) >= 0.0);
  s.v = v;
  s.p = in.world;
  s.ao = 1.0;
  s.shadow = 1.0;
  s.metallic = 0.0;
  s.roughness = 0.45;
  return vec4f(linear_to_srgb(shade(s) * frame.style.y), 1.0);
}
