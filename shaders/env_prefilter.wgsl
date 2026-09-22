// Pre-blurs the environment map for rough reflections (run once per
// environment, not per frame). Mip k of the output holds the reflection for
// roughness (k / (mips - 1))^2, integrated with GGX importance sampling.

const PI: f32 = 3.14159265358979;

struct Params {
  roughness: f32,
  src_mips: f32,
  src_width: f32,
  _pad: f32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var src_sampler: sampler;
@group(0) @binding(3) var dst: texture_storage_2d<rgba16float, write>;

fn dir_from_uv(uv: vec2f) -> vec3f {
  let phi = (uv.x - 0.5) * 2.0 * PI;
  let theta = uv.y * PI;
  return vec3f(sin(theta) * cos(phi), sin(theta) * sin(phi), cos(theta));
}

fn uv_from_dir(d: vec3f) -> vec2f {
  return vec2f(atan2(d.y, d.x) / (2.0 * PI) + 0.5, acos(clamp(d.z, -1.0, 1.0)) / PI);
}

fn hammersley(i: u32, n: u32) -> vec2f {
  var bits = i;
  bits = (bits << 16u) | (bits >> 16u);
  bits = ((bits & 0x55555555u) << 1u) | ((bits & 0xAAAAAAAAu) >> 1u);
  bits = ((bits & 0x33333333u) << 2u) | ((bits & 0xCCCCCCCCu) >> 2u);
  bits = ((bits & 0x0F0F0F0Fu) << 4u) | ((bits & 0xF0F0F0F0u) >> 4u);
  bits = ((bits & 0x00FF00FFu) << 8u) | ((bits & 0xFF00FF00u) >> 8u);
  return vec2f(f32(i) / f32(n), f32(bits) * 2.3283064365386963e-10);
}

const SAMPLES: u32 = 256u;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) {
    return;
  }
  let uv = (vec2f(id.xy) + 0.5) / vec2f(size);
  let n = dir_from_uv(uv);
  let a = params.roughness * params.roughness;
  if (a < 1e-4) {
    textureStore(dst, id.xy, textureSampleLevel(src, src_sampler, uv, 0.0));
    return;
  }
  let helper = select(vec3f(0.0, 0.0, 1.0), vec3f(1.0, 0.0, 0.0), abs(n.z) > 0.999);
  let t = normalize(cross(helper, n));
  let b = cross(n, t);
  // Solid angle of one source texel (equator), for mip selection.
  let texel_sa = 4.0 * PI / (params.src_width * params.src_width * 0.5);

  var sum = vec3f(0.0);
  var weight = 0.0;
  for (var i = 0u; i < SAMPLES; i++) {
    let xi = hammersley(i, SAMPLES);
    // GGX half vector around n (view = normal assumption).
    let phi = 2.0 * PI * xi.x;
    let cos_t = sqrt((1.0 - xi.y) / (1.0 + (a * a - 1.0) * xi.y));
    let sin_t = sqrt(1.0 - cos_t * cos_t);
    let h = normalize(t * (sin_t * cos(phi)) + b * (sin_t * sin(phi)) + n * cos_t);
    let l = 2.0 * dot(n, h) * h - n;
    let n_dot_l = dot(n, l);
    if (n_dot_l <= 0.0) {
      continue;
    }
    // Sample a blurrier source mip for low-probability directions.
    let d = (a * a - 1.0) * cos_t * cos_t + 1.0;
    let pdf = (a * a) / (PI * d * d) * 0.25;
    let sample_sa = 1.0 / (f32(SAMPLES) * pdf + 1e-6);
    let mip = clamp(0.5 * log2(sample_sa / texel_sa) + 1.0, 0.0, params.src_mips - 1.0);
    sum += textureSampleLevel(src, src_sampler, uv_from_dir(l), mip).rgb * n_dot_l;
    weight += n_dot_l;
  }
  textureStore(dst, id.xy, vec4f(sum / max(weight, 1e-6), 1.0));
}
