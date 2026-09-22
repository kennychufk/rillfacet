// STUDIO — Blender "Workbench" (Solid mode) style.
//
// Three lights are attached to the camera, so any view is well lit and no
// scene ever needs lights of its own. A soft sky/ground ambient adds the sense
// of "up". Ambient occlusion darkens creases; the sun shadow only darkens.
//
// Knobs: frame.style2.x = specular strength
//        frame.style2.y = light wrap (0 = hard terminator, 1 = very soft)
//        frame.style2.z = ambient level

fn wrap_diffuse(n: vec3f, l: vec3f, wrap: f32) -> f32 {
  return max((dot(n, l) + wrap) / (1.0 + wrap), 0.0);
}

fn shade(s: Surface) -> vec3f {
  let n = to_view(s.n);  // lights below are in view space, i.e. they follow the camera
  let key = normalize(vec3f(-0.45, 0.60, 0.66));   // upper left, in front
  let fill = normalize(vec3f(0.80, 0.05, 0.60));   // right
  let rim = normalize(vec3f(0.10, 0.45, -0.89));   // behind, above

  let wrap = frame.style2.y;
  let diffuse = 0.80 * wrap_diffuse(n, key, wrap)
              + 0.30 * wrap_diffuse(n, fill, wrap)
              + 0.25 * max(dot(n, rim), 0.0);
  let sky = s.n.z * 0.5 + 0.5;  // world up is +z
  let ambient = frame.style2.z * mix(0.55, 1.0, sky);

  let h = normalize(key + vec3f(0.0, 0.0, 1.0));
  let spec = pow(max(dot(n, h), 0.0), 60.0) * frame.style2.x;

  let occlusion = s.ao * mix(0.55, 1.0, s.shadow);
  return s.albedo * (ambient + diffuse) * occlusion + vec3f(spec) * occlusion;
}
