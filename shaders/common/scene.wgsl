// Resources and helpers for passes that shade 3D geometry.

@group(0) @binding(1) var clamp_sampler: sampler;
@group(0) @binding(2) var colormaps: texture_2d<f32>;    // 256 x N, one colormap per row
@group(0) @binding(3) var matcap_tex: texture_2d<f32>;   // MatCap style
@group(0) @binding(4) var env_tex: texture_2d<f32>;      // equirect; mip k = blurrier (rougher)
@group(0) @binding(5) var shadow_map: texture_depth_2d;
@group(0) @binding(6) var shadow_sampler: sampler_comparison;
@group(0) @binding(7) var ao_tex: texture_2d<f32>;       // screen-space ambient occlusion
@group(0) @binding(8) var repeat_sampler: sampler;

// Everything a style needs to shade one pixel. See shaders/styles/.
struct Surface {
  albedo: vec3f,     // base color, linear rgb
  n: vec3f,          // world normal, facing the viewer
  v: vec3f,          // world direction toward the viewer
  p: vec3f,          // world position
  ao: f32,           // ambient occlusion, 1 = open
  shadow: f32,       // sun visibility, 1 = lit
  metallic: f32,
  roughness: f32,
};

fn colormap(row: u32, t: f32) -> vec3f {
  let rows = f32(textureDimensions(colormaps).y);
  let uv = vec2f((clamp(t, 0.0, 1.0) * 255.0 + 0.5) / 256.0, (f32(row) + 0.5) / rows);
  return textureSampleLevel(colormaps, clamp_sampler, uv, 0.0).rgb;
}

fn sample_ao(frag_xy: vec2f) -> f32 {
  let ao = textureLoad(ao_tex, vec2i(frag_xy), 0).r;
  return mix(1.0, ao, frame.style.x);
}

// Sun shadow, 3x3 percentage-closer filtering. Returns 1 when lit.
fn sample_shadow(p: vec3f, n: vec3f) -> f32 {
  if (frame.style.z < 0.5) {
    return 1.0;
  }
  let lp = frame.light_view_proj * vec4f(p + n * 0.01, 1.0);
  let uv = vec2f(lp.x * 0.5 + 0.5, 0.5 - lp.y * 0.5);
  let texel = 1.0 / vec2f(textureDimensions(shadow_map));
  var lit = 0.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      lit += textureSampleCompareLevel(shadow_map, shadow_sampler,
                                       uv + vec2f(f32(x), f32(y)) * texel, lp.z - 0.0015);
    }
  }
  lit /= 9.0;
  let outside = any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)) || lp.z > 1.0;
  return select(mix(1.0, lit, frame.sun_dir.w), 1.0, outside);
}

// Equirectangular lookup in a z-up world, rotated by frame.env.x.
fn env_uv(d: vec3f) -> vec2f {
  let phi = atan2(d.y, d.x) + frame.env.x;
  let theta = acos(clamp(d.z, -1.0, 1.0));
  return vec2f(phi / (2.0 * PI) + 0.5, theta / PI);
}

// Diffuse light arriving from the whole environment around normal n.
fn env_irradiance(n: vec3f) -> vec3f {
  // Rotate the normal into the environment's frame first.
  let c = cos(frame.env.x);
  let s = sin(frame.env.x);
  let d = vec3f(c * n.x - s * n.y, s * n.x + c * n.y, n.z);
  let sh = frame.sh;
  var r = sh[0].rgb * 0.886227;
  r += sh[1].rgb * (1.023328 * d.y) + sh[2].rgb * (1.023328 * d.z) + sh[3].rgb * (1.023328 * d.x);
  r += sh[4].rgb * (0.858086 * d.x * d.y) + sh[5].rgb * (0.858086 * d.y * d.z);
  r += sh[6].rgb * (0.247708 * (3.0 * d.z * d.z - 1.0));
  r += sh[7].rgb * (0.858086 * d.x * d.z) + sh[8].rgb * (0.429043 * (d.x * d.x - d.y * d.y));
  return max(r, vec3f(0.0));
}
