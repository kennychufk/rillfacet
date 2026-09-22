#include "avbd_viz/environment.h"

#include "avbd_viz/shader_library.h"

#include <stb_image.h>

#include <algorithm>
#include <cmath>
#include <cstring>

namespace avbd_viz {

static constexpr float kPi = 3.14159265358979f;

static glm::vec3 dir_from_uv(float u, float v) {
  float phi = (u - 0.5f) * 2.0f * kPi, theta = v * kPi;
  return {std::sin(theta) * std::cos(phi), std::sin(theta) * std::sin(phi), std::cos(theta)};
}

static glm::vec3 dir_from_angles(float azimuth_deg, float elevation_deg) {
  float a = glm::radians(azimuth_deg), e = glm::radians(elevation_deg);
  return {std::cos(e) * std::cos(a), std::cos(e) * std::sin(a), std::sin(e)};
}

// Soft-edged round light of angular radius `radius_deg` around `center`.
static float soft_disc(const glm::vec3& d, const glm::vec3& center, float radius_deg, float soft) {
  float ang = std::acos(std::clamp(glm::dot(d, center), -1.0f, 1.0f));
  float r = glm::radians(radius_deg);
  return 1.0f - glm::smoothstep(r * (1.0f - soft), r, ang);
}

// Soft-edged rectangular light (a "softbox"), sized in degrees.
static float softbox(const glm::vec3& d, const glm::vec3& center, float half_w_deg,
                     float half_h_deg) {
  glm::vec3 up(0, 0, 1);
  glm::vec3 right = glm::normalize(glm::cross(center, up));
  glm::vec3 local_up = glm::cross(right, center);
  float fwd = glm::dot(d, center);
  if (fwd <= 0.0f) return 0.0f;
  float x = std::atan2(glm::dot(d, right), fwd), y = std::atan2(glm::dot(d, local_up), fwd);
  float hw = glm::radians(half_w_deg), hh = glm::radians(half_h_deg);
  float ex = 1.0f - glm::smoothstep(hw * 0.75f, hw, std::abs(x));
  float ey = 1.0f - glm::smoothstep(hh * 0.75f, hh, std::abs(y));
  return ex * ey;
}

const char* environment_name(EnvironmentPreset p) {
  switch (p) {
    case EnvironmentPreset::Studio: return "Studio softboxes";
    case EnvironmentPreset::Sky: return "Clear sky";
    case EnvironmentPreset::Soft: return "Soft white room";
    default: return "?";
  }
}

EnvironmentImage make_environment(EnvironmentPreset preset, int width) {
  EnvironmentImage img;
  img.width = width;
  img.height = width / 2;
  img.rgb.resize(size_t(img.width) * img.height * 3);

  // The default camera looks along +Y, so "front-left" is azimuth -135 deg.
  glm::vec3 key = dir_from_angles(-130.0f, 55.0f);
  glm::vec3 fill = dir_from_angles(-40.0f, 25.0f);
  glm::vec3 rim = dir_from_angles(100.0f, 30.0f);
  glm::vec3 sun = dir_from_angles(-120.0f, 50.0f);
  img.sun_dir = preset == EnvironmentPreset::Sky ? sun
              : preset == EnvironmentPreset::Studio ? key : glm::vec3(0, 0, 1);

  for (int y = 0; y < img.height; ++y) {
    for (int x = 0; x < img.width; ++x) {
      glm::vec3 d = dir_from_uv((x + 0.5f) / img.width, (y + 0.5f) / img.height);
      glm::vec3 c(0.0f);
      float horizon = glm::smoothstep(-0.08f, 0.08f, d.z);
      switch (preset) {
        case EnvironmentPreset::Studio: {
          glm::vec3 wall = glm::mix(glm::vec3(0.10f), glm::vec3(0.30f, 0.30f, 0.32f), d.z * 0.5f + 0.5f);
          c = glm::mix(glm::vec3(0.07f), wall, horizon);
          c += glm::vec3(1.0f, 0.97f, 0.92f) * 9.0f * softbox(d, key, 22.0f, 14.0f);
          c += glm::vec3(0.92f, 0.96f, 1.0f) * 2.5f * softbox(d, fill, 30.0f, 10.0f);
          c += glm::vec3(1.0f) * 5.0f * softbox(d, rim, 8.0f, 22.0f);
          c += glm::vec3(1.0f) * 1.5f * soft_disc(d, {0, 0, 1}, 25.0f, 0.5f);
          break;
        }
        case EnvironmentPreset::Sky: {
          glm::vec3 zenith(0.18f, 0.36f, 0.80f), haze(0.75f, 0.84f, 0.95f);
          glm::vec3 sky = glm::mix(haze, zenith, std::pow(std::max(d.z, 0.0f), 0.45f)) * 1.3f;
          glm::vec3 ground(0.16f, 0.15f, 0.13f);
          c = glm::mix(ground, sky, horizon);
          c += glm::vec3(1.0f, 0.95f, 0.85f) * 400.0f * soft_disc(d, sun, 1.2f, 0.3f);
          c += glm::vec3(1.0f, 0.9f, 0.7f) * 2.0f * soft_disc(d, sun, 18.0f, 1.0f);
          break;
        }
        default: {
          c = glm::mix(glm::vec3(0.30f), glm::vec3(1.0f), d.z * 0.5f + 0.5f);
          break;
        }
      }
      std::memcpy(&img.rgb[(size_t(y) * img.width + x) * 3], &c, sizeof(float) * 3);
    }
  }
  return img;
}

bool load_hdr(const std::string& path, EnvironmentImage& out) {
  int w, h, n;
  float* data = stbi_loadf(path.c_str(), &w, &h, &n, 3);
  if (!data) return false;
  out.width = w;
  out.height = h;
  out.rgb.assign(data, data + size_t(w) * h * 3);
  stbi_image_free(data);
  // Brightest texel ~ the sun.
  size_t best = 0;
  float best_l = -1;
  for (size_t i = 0; i < size_t(w) * h; ++i) {
    float l = out.rgb[3 * i] + out.rgb[3 * i + 1] + out.rgb[3 * i + 2];
    if (l > best_l) {
      best_l = l;
      best = i;
    }
  }
  // Poly Haven style HDRIs are y-up with the horizon in the middle row, which
  // maps onto our z-up equirect unchanged.
  out.sun_dir = dir_from_uv((best % w + 0.5f) / w, (best / w + 0.5f) / h);
  return true;
}

// ---- Matcaps ----------------------------------------------------------------

const char* matcap_name(MatcapPreset p) {
  switch (p) {
    case MatcapPreset::Clay: return "Clay";
    case MatcapPreset::Porcelain: return "Porcelain";
    case MatcapPreset::Chrome: return "Chrome";
    case MatcapPreset::Toon: return "Toon";
    default: return "?";
  }
}

float matcap_default_tint(MatcapPreset p) { return p == MatcapPreset::Chrome ? 0.0f : 1.0f; }

static uint8_t to_srgb8(float x) {
  x = std::clamp(x, 0.0f, 1.0f);
  float s = x <= 0.0031308f ? x * 12.92f : 1.055f * std::pow(x, 1.0f / 2.4f) - 0.055f;
  return uint8_t(std::lround(s * 255.0f));
}

std::vector<uint8_t> make_matcap(MatcapPreset preset, int size) {
  std::vector<uint8_t> out(size_t(size) * size * 4);
  const glm::vec3 key = glm::normalize(glm::vec3(-0.5f, 0.6f, 0.62f));
  const glm::vec3 fill = glm::normalize(glm::vec3(0.75f, -0.05f, 0.65f));
  const glm::vec3 view(0, 0, 1);
  for (int j = 0; j < size; ++j) {
    for (int i = 0; i < size; ++i) {
      float x = (i + 0.5f) / size * 2 - 1, y = 1 - (j + 0.5f) / size * 2;
      float r2 = x * x + y * y;
      if (r2 > 1.0f) {  // clamp to the rim
        float r = std::sqrt(r2);
        x /= r;
        y /= r;
        r2 = 1.0f;
      }
      glm::vec3 n(x, y, std::sqrt(std::max(0.0f, 1.0f - r2)));
      float k = std::max(0.0f, glm::dot(n, key)), f = std::max(0.0f, glm::dot(n, fill));
      float wrap = std::max(0.0f, (glm::dot(n, key) + 0.4f) / 1.4f);
      glm::vec3 h = glm::normalize(key + view);
      float ndh = std::max(0.0f, glm::dot(n, h));
      float rim = std::pow(1.0f - n.z, 3.0f);
      glm::vec3 rgb(0);
      float spec = 0;
      switch (preset) {
        case MatcapPreset::Clay:
          rgb = glm::vec3(1.0f, 0.97f, 0.93f) * (0.10f + 0.50f * wrap + 0.14f * f + 0.10f * n.y);
          spec = 0.06f * std::pow(ndh, 10.0f);
          break;
        case MatcapPreset::Porcelain:
          rgb = glm::vec3(0.12f + 0.52f * k + 0.16f * f + 0.10f * (n.y * 0.5f + 0.5f));
          spec = 0.9f * std::pow(ndh, 140.0f) + 0.25f * std::pow(ndh, 18.0f) + 0.12f * rim;
          break;
        case MatcapPreset::Chrome: {
          glm::vec3 refl = glm::reflect(-view, n);
          float sky = glm::smoothstep(-0.05f, 0.25f, refl.y);
          rgb = glm::mix(glm::vec3(0.06f, 0.06f, 0.07f), glm::vec3(0.85f, 0.88f, 0.95f), sky);
          rgb += glm::vec3(0.5f) * std::exp(-std::pow((refl.y - 0.05f) * 14.0f, 2.0f));
          rgb += glm::vec3(2.0f) * std::pow(std::max(0.0f, glm::dot(refl, key)), 200.0f);
          rgb *= 0.9f;
          break;
        }
        case MatcapPreset::Toon: {
          float band = k > 0.55f ? 0.62f : (k > 0.15f ? 0.42f : 0.24f);
          rgb = glm::vec3(band);
          spec = ndh > 0.985f ? 0.6f : 0.0f;
          break;
        }
        default: break;
      }
      uint8_t* px = &out[(size_t(j) * size + i) * 4];
      px[0] = to_srgb8(rgb.r);
      px[1] = to_srgb8(rgb.g);
      px[2] = to_srgb8(rgb.b);
      px[3] = uint8_t(std::lround(std::clamp(spec, 0.0f, 1.0f) * 255.0f));
    }
  }
  return out;
}

// ---- GPU environment --------------------------------------------------------

static uint16_t to_half(float f) {
  uint32_t x;
  std::memcpy(&x, &f, 4);
  uint32_t sign = (x >> 16) & 0x8000, exp = (x >> 23) & 0xff, mant = x & 0x7fffff;
  if (exp == 0xff) return uint16_t(sign | 0x7c00 | (mant ? 0x200 : 0));
  int e = int(exp) - 127 + 15;
  if (e >= 31) return uint16_t(sign | 0x7c00);
  if (e <= 0) {
    if (e < -10) return uint16_t(sign);
    mant |= 0x800000;
    return uint16_t(sign | (mant >> (14 - e)));
  }
  return uint16_t(sign | (e << 10) | (mant >> 13));
}

bool EnvironmentMap::build(const Gpu& gpu, ShaderLibrary& shaders, const EnvironmentImage& img,
                           std::string* error) {
  sun_dir = img.sun_dir;

  // Diffuse: project onto 9 spherical harmonics (weights = texel solid angle).
  sh.fill(glm::vec3(0));
  for (int y = 0; y < img.height; ++y) {
    float theta = (y + 0.5f) / img.height * kPi;
    float d_omega = (2 * kPi / img.width) * (kPi / img.height) * std::sin(theta);
    for (int x = 0; x < img.width; ++x) {
      glm::vec3 d = dir_from_uv((x + 0.5f) / img.width, (y + 0.5f) / img.height);
      const float* p = &img.rgb[(size_t(y) * img.width + x) * 3];
      glm::vec3 c = glm::min(glm::vec3(p[0], p[1], p[2]), glm::vec3(50.0f)) * d_omega;
      float basis[9] = {0.282095f,
                        0.488603f * d.y,
                        0.488603f * d.z,
                        0.488603f * d.x,
                        1.092548f * d.x * d.y,
                        1.092548f * d.y * d.z,
                        0.315392f * (3 * d.z * d.z - 1),
                        1.092548f * d.x * d.z,
                        0.546274f * (d.x * d.x - d.y * d.y)};
      for (int k = 0; k < 9; ++k) sh[k] += c * basis[k];
    }
  }
  for (auto& c : sh) c /= kPi;

  // Specular: upload a box-filtered mip chain, then GGX-prefilter each level.
  uint32_t w = uint32_t(img.width), h = uint32_t(img.height);
  mip_count = 1;
  while ((w >> mip_count) >= 32 && (h >> mip_count) >= 16) ++mip_count;
  wgpu::Texture src = gpu.create_texture(w, h, wgpu::TextureFormat::RGBA16Float,
                                         wgpu::TextureUsage::TextureBinding | wgpu::TextureUsage::CopyDst,
                                         "env source", 1, mip_count);
  std::vector<float> level(img.rgb);
  uint32_t lw = w, lh = h;
  for (uint32_t m = 0; m < mip_count; ++m) {
    std::vector<uint16_t> half(size_t(lw) * lh * 4);
    for (size_t i = 0; i < size_t(lw) * lh; ++i) {
      for (int c = 0; c < 3; ++c) half[4 * i + c] = to_half(std::min(level[3 * i + c], 60000.0f));
      half[4 * i + 3] = to_half(1.0f);
    }
    wgpu::TexelCopyTextureInfo dst{};
    dst.texture = src;
    dst.mipLevel = m;
    wgpu::TexelCopyBufferLayout layout{};
    layout.bytesPerRow = lw * 8;
    layout.rowsPerImage = lh;
    wgpu::Extent3D extent{lw, lh, 1};
    gpu.queue.WriteTexture(&dst, half.data(), half.size() * 2, &layout, &extent);
    if (m + 1 == mip_count) break;
    uint32_t nw = lw / 2, nh = lh / 2;
    std::vector<float> next(size_t(nw) * nh * 3);
    for (uint32_t y = 0; y < nh; ++y)
      for (uint32_t x = 0; x < nw; ++x)
        for (int c = 0; c < 3; ++c)
          next[(size_t(y) * nw + x) * 3 + c] =
              0.25f * (level[((2 * y) * lw + 2 * x) * 3 + c] + level[((2 * y) * lw + 2 * x + 1) * 3 + c] +
                       level[((2 * y + 1) * lw + 2 * x) * 3 + c] + level[((2 * y + 1) * lw + 2 * x + 1) * 3 + c]);
    level.swap(next);
    lw = nw;
    lh = nh;
  }

  wgpu::Texture dst = gpu.create_texture(
      w, h, wgpu::TextureFormat::RGBA16Float,
      wgpu::TextureUsage::TextureBinding | wgpu::TextureUsage::StorageBinding, "env prefiltered", 1,
      mip_count);

  wgpu::ShaderModule module = shaders.compile(gpu, "env_prefilter.wgsl", {}, error);
  if (!module) return false;
  wgpu::BindGroupLayout layout = make_layout(
      gpu, "env prefilter",
      {{0, BindingKind::Uniform, wgpu::ShaderStage::Compute},
       {1, BindingKind::Texture, wgpu::ShaderStage::Compute},
       {2, BindingKind::Sampler, wgpu::ShaderStage::Compute},
       {3, BindingKind::StorageTextureWrite, wgpu::ShaderStage::Compute,
        wgpu::TextureFormat::RGBA16Float}});
  wgpu::PipelineLayoutDescriptor pl_desc{};
  pl_desc.bindGroupLayoutCount = 1;
  pl_desc.bindGroupLayouts = &layout;
  wgpu::ComputePipelineDescriptor cp{};
  cp.layout = gpu.device.CreatePipelineLayout(&pl_desc);
  cp.compute.module = module;
  cp.compute.entryPoint = "main";
  wgpu::ComputePipeline pipeline = gpu.device.CreateComputePipeline(&cp);

  wgpu::SamplerDescriptor sd{};
  sd.addressModeU = wgpu::AddressMode::Repeat;
  sd.addressModeV = wgpu::AddressMode::ClampToEdge;
  sd.magFilter = sd.minFilter = wgpu::FilterMode::Linear;
  sd.mipmapFilter = wgpu::MipmapFilterMode::Linear;
  wgpu::Sampler sampler = gpu.device.CreateSampler(&sd);
  wgpu::TextureView src_view = src.CreateView();

  wgpu::CommandEncoder enc = gpu.device.CreateCommandEncoder();
  std::vector<wgpu::Buffer> keep;
  for (uint32_t m = 0; m < mip_count; ++m) {
    float t = mip_count > 1 ? float(m) / float(mip_count - 1) : 0.0f;
    float params[4] = {t * t, float(mip_count), float(w), 0};
    wgpu::Buffer ubo = gpu.create_buffer(16, wgpu::BufferUsage::Uniform | wgpu::BufferUsage::CopyDst,
                                         "prefilter params");
    gpu.queue.WriteBuffer(ubo, 0, params, 16);
    keep.push_back(ubo);
    wgpu::TextureViewDescriptor vd{};
    vd.baseMipLevel = m;
    vd.mipLevelCount = 1;
    wgpu::BindGroup group = make_group(gpu, layout,
                                       {{0, ubo}, {1, src_view}, {2, sampler}, {3, dst.CreateView(&vd)}});
    wgpu::ComputePassEncoder pass = enc.BeginComputePass();
    pass.SetPipeline(pipeline);
    pass.SetBindGroup(0, group);
    pass.DispatchWorkgroups(((w >> m) + 7) / 8, ((h >> m) + 7) / 8);
    pass.End();
  }
  wgpu::CommandBuffer cmd = enc.Finish();
  gpu.queue.Submit(1, &cmd);
  view = dst.CreateView();
  return true;
}

}  // namespace avbd_viz
