// ENVIRONMENT PBR — physically based metal/roughness materials lit only by an
// environment image (image-based lighting), like EEVEE or three.js with an
// HDRI. Change the mood by swapping or rotating the environment, never by
// placing lights. The sun shadow darkens the environment light it blocks.
//
// Material: s.metallic, s.roughness (per structure, see SurfaceMesh).
// Knobs: frame.env.y = environment intensity, frame.env.x = rotation.

// Analytic fit of the split-sum BRDF integral (Karis, "Mobile PBR", 2014).
fn env_brdf(f0: vec3f, roughness: f32, n_dot_v: f32) -> vec3f {
  let c0 = vec4f(-1.0, -0.0275, -0.572, 0.022);
  let c1 = vec4f(1.0, 0.0425, 1.04, -0.04);
  let r = roughness * c0 + c1;
  let a004 = min(r.x * r.x, exp2(-9.28 * n_dot_v)) * r.x + r.y;
  let ab = vec2f(-1.04, 1.04) * a004 + r.zw;
  return f0 * ab.x + ab.y;
}

fn shade(s: Surface) -> vec3f {
  let n_dot_v = max(dot(s.n, s.v), 1e-4);
  let f0 = mix(vec3f(0.04), s.albedo, s.metallic);

  let diffuse = s.albedo * (1.0 - s.metallic) * env_irradiance(s.n);

  let r = reflect(-s.v, s.n);
  let lod = sqrt(s.roughness) * frame.env.z;
  let reflected = textureSampleLevel(env_tex, repeat_sampler, env_uv(r), lod).rgb;
  let specular = reflected * env_brdf(f0, s.roughness, n_dot_v);

  let occlusion = s.ao * mix(0.35, 1.0, s.shadow);
  return (diffuse + specular) * occlusion * frame.env.y;
}
