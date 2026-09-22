// TECHNICAL — Gooch "cool-to-warm" shading, as in technical illustration.
// Surfaces turning away from the (camera-attached) light shift toward a cool
// tone instead of going dark, so shape stays readable while colors, including
// colormaps, stay faithful. Outlines are drawn later in composite.wgsl.
//
// Knobs: frame.style2.x = cool/warm hue shift
//        frame.style2.y = shading contrast (0 = flat)

fn shade(s: Surface) -> vec3f {
  let n = to_view(s.n);
  let l = normalize(vec3f(-0.40, 0.60, 0.70));
  let t = dot(n, l) * 0.5 + 0.5;  // 0 = facing away, 1 = facing the light

  // The tints multiply the base color, so dark colors (e.g. the low end of a
  // colormap) keep their hue instead of being washed toward the tint.
  let k = frame.style2.x;
  let contrast = frame.style2.y;
  let cool = s.albedo * (1.0 - 0.45 * contrast) * pow(vec3f(0.90, 0.96, 1.10), vec3f(k));
  let warm = s.albedo * (1.0 + 0.10 * contrast) * pow(vec3f(1.06, 1.02, 0.92), vec3f(k));

  let occlusion = mix(0.7, 1.0, s.ao) * mix(0.75, 1.0, s.shadow);
  return mix(cool, warm, t) * occlusion;
}
