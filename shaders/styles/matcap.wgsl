// MATCAP — "material capture": all lighting is baked into a picture of a lit
// sphere. The surface normal, seen from the camera, picks the pixel of that
// sphere to use. Swap the picture to restyle everything; there are no lights.
//
// Matcap texture: rgb = shading (neutral gray for tintable presets),
//                 a   = white highlight added on top.
// Knobs: frame.style2.x = tint (0 = picture colors as-is, 1 = times object color)

fn shade(s: Surface) -> vec3f {
  let n = to_view(s.n);
  let uv = vec2f(n.x, -n.y) * 0.485 + 0.5;
  let m = textureSampleLevel(matcap_tex, clamp_sampler, uv, 0.0);
  let tint = mix(vec3f(1.0), s.albedo * 1.6, frame.style2.x);
  let occlusion = s.ao * mix(0.6, 1.0, s.shadow);
  return (m.rgb * tint + vec3f(m.a)) * occlusion;
}
