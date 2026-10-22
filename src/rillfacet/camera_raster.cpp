#include "rillfacet/camera_raster.h"

#include <algorithm>
#include <cstdio>
#include <cstring>

#include "rillfacet/resources.h"
#include "rillfacet/shader_library.h"

namespace rillfacet {

namespace {

uint32_t div_up(uint32_t a, uint32_t b) { return (a + b - 1) / b; }

uint32_t bytes_per_texel(wgpu::TextureFormat f) {
  switch (f) {
    case wgpu::TextureFormat::RGBA8Unorm: return 4;
    case wgpu::TextureFormat::RGBA16Float: return 8;
    case wgpu::TextureFormat::RGBA32Float: return 16;
    case wgpu::TextureFormat::R32Float: return 4;
    case wgpu::TextureFormat::R16Uint: return 2;
    case wgpu::TextureFormat::R32Uint: return 4;
    default: return 0;
  }
}

std::vector<wgpu::TextureView> layer_views(const wgpu::Texture& t, uint32_t layers) {
  std::vector<wgpu::TextureView> out;
  for (uint32_t l = 0; l < layers; ++l) {
    wgpu::TextureViewDescriptor d{};
    d.dimension = wgpu::TextureViewDimension::e2D;
    d.baseArrayLayer = l;
    d.arrayLayerCount = 1;
    out.push_back(t.CreateView(&d));
  }
  return out;
}

wgpu::TextureView array_view(const wgpu::Texture& t) {
  wgpu::TextureViewDescriptor d{};
  d.dimension = wgpu::TextureViewDimension::e2DArray;
  return t.CreateView(&d);
}

wgpu::Texture make_texture(const wgpu::Device& dev, wgpu::TextureFormat f, uint32_t w, uint32_t h,
                           uint32_t layers, wgpu::TextureUsage usage, const char* label,
                           uint32_t mips = 1) {
  wgpu::TextureDescriptor d{};
  d.label = label;
  d.size = {std::max(w, 1u), std::max(h, 1u), std::max(layers, 1u)};
  d.format = f;
  d.usage = usage;
  d.mipLevelCount = mips;
  return dev.CreateTexture(&d);
}

struct Entry {
  uint32_t binding;
  wgpu::ShaderStage vis;
  enum Kind { Uniform, Storage, Tex, UnfTex, UintTex, Depth, Cmp, Filt, StoreTex } kind;
  wgpu::TextureViewDimension dim = wgpu::TextureViewDimension::e2D;
  wgpu::TextureFormat format = wgpu::TextureFormat::Undefined;
};

wgpu::BindGroupLayout make_layout(const wgpu::Device& dev, const char* label,
                                  const std::vector<Entry>& entries) {
  std::vector<wgpu::BindGroupLayoutEntry> es;
  for (const auto& e : entries) {
    wgpu::BindGroupLayoutEntry b{};
    b.binding = e.binding;
    b.visibility = e.vis;
    switch (e.kind) {
      case Entry::Uniform: b.buffer.type = wgpu::BufferBindingType::Uniform; break;
      case Entry::Storage: b.buffer.type = wgpu::BufferBindingType::ReadOnlyStorage; break;
      case Entry::Tex:
        b.texture.sampleType = wgpu::TextureSampleType::Float;
        b.texture.viewDimension = e.dim;
        break;
      case Entry::UnfTex:
        b.texture.sampleType = wgpu::TextureSampleType::UnfilterableFloat;
        b.texture.viewDimension = e.dim;
        break;
      case Entry::UintTex:
        b.texture.sampleType = wgpu::TextureSampleType::Uint;
        b.texture.viewDimension = e.dim;
        break;
      case Entry::Depth:
        b.texture.sampleType = wgpu::TextureSampleType::Depth;
        b.texture.viewDimension = e.dim;
        break;
      case Entry::Cmp: b.sampler.type = wgpu::SamplerBindingType::Comparison; break;
      case Entry::Filt: b.sampler.type = wgpu::SamplerBindingType::Filtering; break;
      case Entry::StoreTex:
        b.storageTexture.access = wgpu::StorageTextureAccess::WriteOnly;
        b.storageTexture.format = e.format;
        b.storageTexture.viewDimension = e.dim;
        break;
    }
    es.push_back(b);
  }
  wgpu::BindGroupLayoutDescriptor d{};
  d.label = label;
  d.entryCount = es.size();
  d.entries = es.data();
  return dev.CreateBindGroupLayout(&d);
}

wgpu::BindGroupEntry buf(uint32_t b, const wgpu::Buffer& x) {
  wgpu::BindGroupEntry e{};
  e.binding = b;
  e.buffer = x;
  e.size = WGPU_WHOLE_SIZE;
  return e;
}
wgpu::BindGroupEntry tex(uint32_t b, const wgpu::TextureView& v) {
  wgpu::BindGroupEntry e{};
  e.binding = b;
  e.textureView = v;
  return e;
}
wgpu::BindGroupEntry smp(uint32_t b, const wgpu::Sampler& s) {
  wgpu::BindGroupEntry e{};
  e.binding = b;
  e.sampler = s;
  return e;
}

constexpr wgpu::TextureFormat kOutFormats[3] = {wgpu::TextureFormat::RGBA8Unorm,
                                                wgpu::TextureFormat::RGBA16Float,
                                                wgpu::TextureFormat::R32Float};

}  // namespace

CameraRaster::CameraRaster(bool zero_copy) {
  GpuOptions o;
  o.max_texture_limits = true;
  o.features = {wgpu::FeatureName::ClipDistances};
  o.optional_features = {wgpu::FeatureName::TextureFormatsTier1};
  if (zero_copy) {
    // Exactly one shared-fence type: with SharedFenceSyncFD as well Dawn
    // exports sync FDs, which CUDA cannot import.
    o.optional_features.push_back(wgpu::FeatureName::SharedTextureMemoryOpaqueFD);
    o.optional_features.push_back(wgpu::FeatureName::SharedFenceVkSemaphoreOpaqueFD);
  }
  if (!gpu_.init(o)) return;
  auto& dev = gpu_.device;
  seg16_ = dev.HasFeature(wgpu::FeatureName::TextureFormatsTier1);
  seg_format_ = seg16_ ? wgpu::TextureFormat::R16Uint : wgpu::TextureFormat::R32Uint;
  if (zero_copy) share_ = std::make_unique<CudaShare>(gpu_.adapter, dev);

  wgpu::SamplerDescriptor sd{};
  sd.compare = wgpu::CompareFunction::LessEqual;
  sd.magFilter = sd.minFilter = wgpu::FilterMode::Linear;
  cmp_ = dev.CreateSampler(&sd);
  sd = {};
  sd.magFilter = sd.minFilter = wgpu::FilterMode::Linear;
  sd.mipmapFilter = wgpu::MipmapFilterMode::Linear;
  sd.addressModeU = sd.addressModeV = wgpu::AddressMode::Repeat;
  sd.maxAnisotropy = 8;
  repeat_ = dev.CreateSampler(&sd);
  sd.addressModeU = wgpu::AddressMode::Repeat;   // equirect longitude wraps
  sd.addressModeV = wgpu::AddressMode::ClampToEdge;
  sd.maxAnisotropy = 1;
  clamp_ = dev.CreateSampler(&sd);

  const auto TB = wgpu::TextureUsage::TextureBinding | wgpu::TextureUsage::CopyDst;
  base_tex_ = make_texture(dev, wgpu::TextureFormat::RGBA8UnormSrgb, 1, 1, 1, TB, "raster base tex");
  const uint8_t white[4] = {255, 255, 255, 255};
  wgpu::TexelCopyTextureInfo dst{};
  dst.texture = base_tex_;
  wgpu::TexelCopyBufferLayout lay{};
  lay.bytesPerRow = 4;
  wgpu::Extent3D one{1, 1, 1};
  gpu_.queue.WriteTexture(&dst, white, 4, &lay, &one);
  env_tex_ = make_texture(dev, wgpu::TextureFormat::RGBA16Float, 1, 1, 1, TB, "raster env");
  brdf_lut_ = make_texture(dev, wgpu::TextureFormat::RGBA16Float, 1, 1, 1, TB, "raster brdf lut");
  dummy_rad_ = make_texture(dev, wgpu::TextureFormat::RGBA16Float, 1, 1, 1, TB, "dummy");
  dummy_depth_ = make_texture(dev, wgpu::TextureFormat::R32Float, 1, 1, 1, TB, "dummy");
  dummy_seg_ = make_texture(dev, seg_format_, 1, 1, 1, TB, "dummy");
  dummy_shadow_ = make_texture(dev, wgpu::TextureFormat::Depth32Float, 1, 1, 1,
                               wgpu::TextureUsage::TextureBinding, "dummy");
  for (int k = 0; k < 4; ++k)
    dummy_out_[k] = make_texture(dev, k < 3 ? kOutFormats[k] : seg_format_, 1, 1, 1,
                                 wgpu::TextureUsage::StorageBinding, "dummy");
  frame_ = gpu_.create_buffer(kFrameFloats * 4, wgpu::BufferUsage::Uniform | wgpu::BufferUsage::CopyDst,
                              "raster frame");
  std::vector<float> zero(kFrameFloats, 0.0f);
  gpu_.queue.WriteBuffer(frame_, 0, zero.data(), kFrameFloats * 4);
  mats_ = gpu_.create_buffer(32, wgpu::BufferUsage::Storage | wgpu::BufferUsage::CopyDst, "raster mats");
  lens_ = gpu_.create_buffer(32, wgpu::BufferUsage::Storage | wgpu::BufferUsage::CopyDst, "raster lens");
  solid_ = gpu_.create_buffer(128, wgpu::BufferUsage::Storage | wgpu::BufferUsage::CopyDst,
                              "raster solid textures");
  ok_ = make_pipelines();
}

CameraRaster::~CameraRaster() {
  if (!gpu_.device) return;
  wait_idle();
  if (share_) share_->synchronize();
  views_.clear();
}

std::string CameraRaster::info() const {
  std::string s = gpu_.adapter_name;
  if (!share_) return s + ", zero-copy off";
  return s + (share_->available() ? ", zero-copy (CUDA)" : ", zero-copy unavailable: " + share_->error());
}

bool CameraRaster::make_pipelines() {
  auto& dev = gpu_.device;
  std::string code, error;
  if (!ShaderLibrary(shader_dir()).source("camera_raster.wgsl", {}, code, &error)) {
    std::fprintf(stderr, "[rillfacet] %s\n", error.c_str());
    return false;
  }
  auto subst = [&code](const std::string& key, const std::string& value) {
    for (size_t p = code.find(key); p != std::string::npos; p = code.find(key, p + value.size()))
      code.replace(p, key.size(), value);
  };
  subst("SEG_FORMAT", seg16_ ? "r16uint" : "r32uint");
  subst("SEG_NONE", seg16_ ? "0xffffu" : "0xffffffffu");

  gpu_.push_error_scope();
  wgpu::ShaderSourceWGSL src{};
  src.code = code.c_str();
  wgpu::ShaderModuleDescriptor smd{};
  smd.nextInChain = &src;
  smd.label = "camera_raster.wgsl";
  auto sm = dev.CreateShaderModule(&smd);

  using V = wgpu::ShaderStage;
  const auto VF = V::Vertex | V::Fragment;
  const auto A = wgpu::TextureViewDimension::e2DArray;
  render_layout_ = make_layout(dev, "raster render", {
      {0, VF, Entry::Uniform}, {1, VF, Entry::Uniform}, {2, VF, Entry::UnfTex},
      {3, V::Fragment, Entry::Storage}, {4, V::Fragment, Entry::Depth, A},
      {5, V::Fragment, Entry::Cmp}, {6, V::Fragment, Entry::Tex, A},
      {7, V::Fragment, Entry::Filt}, {8, V::Fragment, Entry::Tex}, {9, V::Fragment, Entry::Filt},
      {19, V::Fragment, Entry::Tex}, {20, V::Fragment, Entry::Storage}});
  // The shadow pass writes the shadow maps: its group must not bind them.
  shadow_layout_ = make_layout(dev, "raster shadow", {
      {0, VF, Entry::Uniform}, {1, VF, Entry::Uniform}, {2, VF, Entry::UnfTex}});
  compute_layout_ = make_layout(dev, "raster remap", {
      {0, V::Compute, Entry::Uniform}, {1, V::Compute, Entry::Uniform},
      {2, V::Compute, Entry::UnfTex}, {8, V::Compute, Entry::Tex}, {9, V::Compute, Entry::Filt},
      {10, V::Compute, Entry::Storage}, {11, V::Compute, Entry::Storage},
      {12, V::Compute, Entry::Tex, A}, {13, V::Compute, Entry::UnfTex, A},
      {14, V::Compute, Entry::UintTex, A},
      {15, V::Compute, Entry::StoreTex, A, kOutFormats[0]},
      {16, V::Compute, Entry::StoreTex, A, kOutFormats[1]},
      {17, V::Compute, Entry::StoreTex, A, kOutFormats[2]},
      {18, V::Compute, Entry::StoreTex, A, seg_format_}});

  wgpu::PipelineLayoutDescriptor pld{};
  pld.bindGroupLayoutCount = 1;
  pld.bindGroupLayouts = &render_layout_;
  auto render_pl = dev.CreatePipelineLayout(&pld);
  pld.bindGroupLayouts = &shadow_layout_;
  auto shadow_pl = dev.CreatePipelineLayout(&pld);
  pld.bindGroupLayouts = &compute_layout_;
  auto compute_pl = dev.CreatePipelineLayout(&pld);

  wgpu::VertexAttribute va[4] = {};
  va[0] = {nullptr, wgpu::VertexFormat::Float32x3, 0, 0};
  va[1] = {nullptr, wgpu::VertexFormat::Float32x3, 12, 1};
  va[2] = {nullptr, wgpu::VertexFormat::Float32x2, 24, 2};
  va[3] = {nullptr, wgpu::VertexFormat::Uint32, 32, 3};
  wgpu::VertexBufferLayout vl{};
  vl.arrayStride = 36;
  vl.attributeCount = 4;
  vl.attributes = va;
  wgpu::DepthStencilState ds{};
  ds.format = wgpu::TextureFormat::Depth32Float;
  ds.depthWriteEnabled = true;
  ds.depthCompare = wgpu::CompareFunction::Less;

  wgpu::RenderPipelineDescriptor sp{};
  sp.label = "raster shadow";
  sp.layout = shadow_pl;
  sp.vertex.module = sm;
  sp.vertex.entryPoint = "vs_shadow";
  sp.vertex.bufferCount = 1;
  sp.vertex.buffers = &vl;
  wgpu::DepthStencilState sds = ds;
  sds.depthBiasSlopeScale = 1.5f;
  sp.depthStencil = &sds;
  shadow_pipe_ = dev.CreateRenderPipeline(&sp);

  const char* fs_names[3] = {"fs_rgb", "fs_geo", "fs_all"};
  for (int k = 0; k < 3; ++k) {
    std::vector<wgpu::ColorTargetState> ct;
    if (k != 1) ct.push_back({nullptr, wgpu::TextureFormat::RGBA16Float});
    if (k != 0) {
      ct.push_back({nullptr, wgpu::TextureFormat::R32Float});
      ct.push_back({nullptr, seg_format_});
    }
    wgpu::FragmentState fs{};
    fs.module = sm;
    fs.entryPoint = fs_names[k];
    fs.targetCount = ct.size();
    fs.targets = ct.data();
    wgpu::RenderPipelineDescriptor pd = sp;
    pd.label = "raster main";
    pd.layout = render_pl;
    pd.vertex.entryPoint = "vs_main";
    pd.depthStencil = &ds;
    pd.fragment = &fs;
    main_pipe_[k] = dev.CreateRenderPipeline(&pd);
  }
  wgpu::ComputePipelineDescriptor cd{};
  cd.label = "raster remap";
  cd.layout = compute_pl;
  cd.compute.module = sm;
  cd.compute.entryPoint = "cs_remap";
  remap_pipe_ = dev.CreateComputePipeline(&cd);
  std::string err = gpu_.pop_error_scope();
  if (!err.empty()) {
    std::fprintf(stderr, "[rillfacet] camera raster pipelines: %s\n", err.c_str());
    return false;
  }
  return true;
}

bool CameraRaster::set_geometry(const float* verts, uint32_t nv, const uint32_t* idx, uint32_t ni,
                                const uint32_t* ranges, uint32_t bodies) {
  auto& q = gpu_.queue;
  vbuf_ = gpu_.create_buffer(uint64_t(nv) * 36, wgpu::BufferUsage::Vertex | wgpu::BufferUsage::CopyDst,
                             "raster vertices");
  if (nv) q.WriteBuffer(vbuf_, 0, verts, uint64_t(nv) * 36);
  ibuf_ = gpu_.create_buffer(uint64_t(ni) * 4, wgpu::BufferUsage::Index | wgpu::BufferUsage::CopyDst,
                             "raster indices");
  if (ni) q.WriteBuffer(ibuf_, 0, idx, uint64_t(ni) * 4);
  bodies_ = bodies;
  first_index_.resize(bodies);
  index_count_.resize(bodies);
  for (uint32_t b = 0; b < bodies; ++b) {
    first_index_[b] = ranges[2 * b];
    index_count_[b] = ranges[2 * b + 1];
  }
  return true;
}

bool CameraRaster::set_textures(uint32_t size, uint32_t layers, const std::vector<const uint8_t*>& mips) {
  if (!size || !layers || mips.empty()) return false;
  base_tex_ = make_texture(gpu_.device, wgpu::TextureFormat::RGBA8UnormSrgb, size, size, layers,
                           wgpu::TextureUsage::TextureBinding | wgpu::TextureUsage::CopyDst,
                           "raster base tex", uint32_t(mips.size()));
  for (uint32_t k = 0; k < mips.size(); ++k) {
    uint32_t s = std::max(size >> k, 1u);
    wgpu::TexelCopyTextureInfo dst{};
    dst.texture = base_tex_;
    dst.mipLevel = k;
    wgpu::TexelCopyBufferLayout lay{};
    lay.bytesPerRow = s * 4;
    lay.rowsPerImage = s;
    wgpu::Extent3D ex{s, s, layers};
    gpu_.queue.WriteTexture(&dst, mips[k], uint64_t(s) * s * 4 * layers, &lay, &ex);
  }
  groups_dirty_ = true;
  return true;
}

bool CameraRaster::set_envmap(uint32_t w, uint32_t h, const std::vector<const uint16_t*>& mips) {
  if (!w || !h || mips.empty()) return false;
  env_tex_ = make_texture(gpu_.device, wgpu::TextureFormat::RGBA16Float, w, h, 1,
                          wgpu::TextureUsage::TextureBinding | wgpu::TextureUsage::CopyDst,
                          "raster env", uint32_t(mips.size()));
  for (uint32_t k = 0; k < mips.size(); ++k) {
    uint32_t mw = std::max(w >> k, 1u), mh = std::max(h >> k, 1u);
    wgpu::TexelCopyTextureInfo dst{};
    dst.texture = env_tex_;
    dst.mipLevel = k;
    wgpu::TexelCopyBufferLayout lay{};
    lay.bytesPerRow = mw * 8;
    lay.rowsPerImage = mh;
    wgpu::Extent3D ex{mw, mh, 1};
    gpu_.queue.WriteTexture(&dst, mips[k], uint64_t(mw) * mh * 8, &lay, &ex);
  }
  groups_dirty_ = true;
  return true;
}

bool CameraRaster::set_brdf_lut(uint32_t n, const uint16_t* data) {
  if (!n) return false;
  brdf_lut_ = make_texture(gpu_.device, wgpu::TextureFormat::RGBA16Float, n, n, 1,
                           wgpu::TextureUsage::TextureBinding | wgpu::TextureUsage::CopyDst,
                           "raster brdf lut");
  wgpu::TexelCopyTextureInfo dst{};
  dst.texture = brdf_lut_;
  wgpu::TexelCopyBufferLayout lay{};
  lay.bytesPerRow = n * 8;
  lay.rowsPerImage = n;
  wgpu::Extent3D ex{n, n, 1};
  gpu_.queue.WriteTexture(&dst, data, uint64_t(n) * n * 8, &lay, &ex);
  groups_dirty_ = true;
  return true;
}

bool CameraRaster::set_materials(const float* m, uint32_t envs, uint32_t slots) {
  uint64_t size = uint64_t(envs) * slots * 32;
  if (size > mats_size_) {
    mats_ = gpu_.create_buffer(size, wgpu::BufferUsage::Storage | wgpu::BufferUsage::CopyDst, "raster mats");
    mats_size_ = size;
    groups_dirty_ = true;
  }
  slots_ = slots;
  envs_ = envs;
  if (size) gpu_.queue.WriteBuffer(mats_, 0, m, size);
  return true;
}

bool CameraRaster::set_solid_textures(const float* rows, uint32_t n) {
  uint64_t size = uint64_t(n) * 128;
  if (size > solid_size_) {
    solid_ = gpu_.create_buffer(size, wgpu::BufferUsage::Storage | wgpu::BufferUsage::CopyDst,
                                "raster solid textures");
    solid_size_ = size;
    groups_dirty_ = true;
  }
  if (size) gpu_.queue.WriteBuffer(solid_, 0, rows, size);
  return true;
}

bool CameraRaster::set_lens(const float* l, uint32_t envs) {
  uint64_t size = uint64_t(envs) * 32;
  if (size > lens_size_) {
    lens_ = gpu_.create_buffer(size, wgpu::BufferUsage::Storage | wgpu::BufferUsage::CopyDst, "raster lens");
    lens_size_ = size;
    groups_dirty_ = true;
  }
  if (size) gpu_.queue.WriteBuffer(lens_, 0, l, size);
  return true;
}

bool CameraRaster::set_frame(const float* f) {
  gpu_.queue.WriteBuffer(frame_, 0, f, kFrameFloats * 4);
  shadows_ = f[6] > 0.0f && f[5] >= 1.0f;
  return true;
}

bool CameraRaster::make_image(Image& im, wgpu::TextureFormat f, uint32_t w, uint32_t h,
                              uint32_t layers, wgpu::TextureUsage usage, const char* label) {
  im.format = f;
  im.bpp = bytes_per_texel(f);
  if (zero_copy()) {
    im.shared = share_->create(f, w, h, layers, usage);
    if (!im.shared) return false;
    im.tex = im.shared->texture();
  } else {
    im.tex = make_texture(gpu_.device, f, w, h, layers,
                          usage | wgpu::TextureUsage::CopySrc | wgpu::TextureUsage::CopyDst, label);
  }
  return bool(im.tex);
}

int CameraRaster::add_view(const RasterViewConfig& c, const float* remap) {
  if (!ok_ || !c.width || !c.height || !c.proxy_width || !c.proxy_height || !c.chunk) return -1;
  wgpu::Limits lim{};
  gpu_.device.GetLimits(&lim);
  const uint32_t maxd = lim.maxTextureDimension2D, maxl = lim.maxTextureArrayLayers;
  if (c.proxy_height > maxd || c.proxy_width > maxd || c.height > maxd || c.width > maxd) return -1;
  View v;
  v.c = c;
  v.c.sets = std::clamp(c.sets, 1u, 2u);
  v.c.supersample = std::max(c.supersample, 1u);
  v.bodies = bodies_;
  v.T = std::min(c.chunk, maxd / c.proxy_height);
  v.L = div_up(c.chunk, v.T);
  const uint32_t S = std::max(c.shadow_res, 1u);
  v.Ts = std::min(c.chunk, std::max(maxd / S, 1u));
  v.Ls = div_up(c.chunk, v.Ts);
  v.To = std::min(c.chunk, maxd / c.height);
  v.Lo = div_up(c.chunk, v.To);
  if (v.L > maxl || v.Ls > maxl || v.Lo > maxl) return -1;

  auto& dev = gpu_.device;
  // Allocation failures (out of memory) surface as validation / OOM errors.
  dev.PushErrorScope(wgpu::ErrorFilter::OutOfMemory);
  gpu_.push_error_scope();
  auto failed = [this]() {
    std::string err = gpu_.pop_error_scope();
    std::string oom;
    gpu_.wait(gpu_.device.PopErrorScope(
        wgpu::CallbackMode::WaitAnyOnly,
        [&oom](wgpu::PopErrorScopeStatus, wgpu::ErrorType type, wgpu::StringView msg) {
          if (type != wgpu::ErrorType::NoError) oom = std::string(msg.data, msg.length == WGPU_STRLEN ? std::strlen(msg.data) : msg.length);
        }));
    if (err.empty()) err = oom;
    if (!err.empty()) std::fprintf(stderr, "[rillfacet] camera raster view: %s\n", err.c_str());
    return !err.empty();
  };
  const auto RA = wgpu::TextureUsage::RenderAttachment | wgpu::TextureUsage::TextureBinding;
  const uint32_t PH = v.T * c.proxy_height;
  if (c.outputs & (kRasterRgb | kRasterLinear)) {
    v.rad = make_texture(dev, wgpu::TextureFormat::RGBA16Float, c.proxy_width, PH, v.L, RA, "proxy radiance");
    v.rad_v = layer_views(v.rad, v.L);
  }
  if (c.outputs & (kRasterDepth | kRasterSeg)) {
    v.depth = make_texture(dev, wgpu::TextureFormat::R32Float, c.proxy_width, PH, v.L, RA, "proxy depth");
    v.seg = make_texture(dev, seg_format_, c.proxy_width, PH, v.L, RA, "proxy label");
    v.depth_v = layer_views(v.depth, v.L);
    v.seg_v = layer_views(v.seg, v.L);
  }
  v.zbuf = make_texture(dev, wgpu::TextureFormat::Depth32Float, c.proxy_width, PH, v.L,
                        wgpu::TextureUsage::RenderAttachment, "proxy z-buffer");
  v.zbuf_v = layer_views(v.zbuf, v.L);
  if (c.shadow_res) {
    v.shadow = make_texture(dev, wgpu::TextureFormat::Depth32Float, S, v.Ts * S, v.Ls, RA, "shadow maps");
    v.shadow_v = layer_views(v.shadow, v.Ls);
  }
  v.remap = gpu_.create_buffer(uint64_t(c.width) * c.height * 32,
                               wgpu::BufferUsage::Storage | wgpu::BufferUsage::CopyDst, "raster remap");
  gpu_.queue.WriteBuffer(v.remap, 0, remap, uint64_t(c.width) * c.height * 32);

  v.sets.resize(v.c.sets);
  bool made = true;
  for (auto& s : v.sets) {
    made = made && make_image(s.pose, wgpu::TextureFormat::RGBA32Float, 2 * (v.bodies + 1),
                              c.chunk, 1, wgpu::TextureUsage::TextureBinding, "raster poses");
    for (int k = 0; k < 4; ++k) {
      if (!(c.outputs & (1u << k))) continue;
      auto f = k < 3 ? kOutFormats[k] : seg_format_;
      made = made && make_image(s.out[k], f, c.width, v.To * c.height, v.Lo,
                                wgpu::TextureUsage::StorageBinding | wgpu::TextureUsage::TextureBinding,
                                "raster output");
    }
    s.uniform = gpu_.create_buffer(128, wgpu::BufferUsage::Uniform | wgpu::BufferUsage::CopyDst,
                                   "raster view");
  }
  if (failed() || !made) return -1;
  int id = next_view_++;
  views_.emplace(id, std::move(v));
  make_groups(views_.at(id));
  return id;
}

void CameraRaster::remove_view(int view) {
  auto it = views_.find(view);
  if (it == views_.end()) return;
  wait_idle();
  if (share_) share_->synchronize();
  views_.erase(it);
}

void CameraRaster::make_groups(View& v) {
  auto& dev = gpu_.device;
  for (auto& s : v.sets) {
    auto pose_view = s.pose.tex.CreateView();
    std::vector<wgpu::BindGroupEntry> r = {
        buf(0, frame_), buf(1, s.uniform), tex(2, pose_view), buf(3, mats_),
        tex(4, array_view(v.shadow ? v.shadow : dummy_shadow_)), smp(5, cmp_),
        tex(6, array_view(base_tex_)), smp(7, repeat_), tex(8, env_tex_.CreateView()), smp(9, clamp_),
        tex(19, brdf_lut_.CreateView()), buf(20, solid_)};
    wgpu::BindGroupDescriptor d{};
    d.layout = render_layout_;
    d.entryCount = r.size();
    d.entries = r.data();
    s.render_group = dev.CreateBindGroup(&d);
    d.layout = shadow_layout_;
    d.entryCount = 3;
    s.shadow_group = dev.CreateBindGroup(&d);
    std::vector<wgpu::BindGroupEntry> cpt = {
        buf(0, frame_), buf(1, s.uniform), tex(2, pose_view), tex(8, env_tex_.CreateView()),
        smp(9, clamp_), buf(10, lens_), buf(11, v.remap),
        tex(12, array_view(v.rad ? v.rad : dummy_rad_)),
        tex(13, array_view(v.depth ? v.depth : dummy_depth_)),
        tex(14, array_view(v.seg ? v.seg : dummy_seg_))};
    for (int k = 0; k < 4; ++k)
      cpt.push_back(tex(15 + k, array_view(s.out[k].tex ? s.out[k].tex : dummy_out_[k])));
    d.layout = compute_layout_;
    d.entryCount = cpt.size();
    d.entries = cpt.data();
    s.compute_group = dev.CreateBindGroup(&d);
  }
}

bool CameraRaster::launch(int view, int set, uint32_t e0, uint32_t n, uint64_t poses_dev,
                          uint64_t pitch, const float* poses_host, uint64_t stream, uint32_t seed,
                          uint32_t outputs) {
  auto it = views_.find(view);
  if (it == views_.end()) return false;
  View& v = it->second;
  if (set < 0 || set >= int(v.sets.size()) || n == 0 || n > v.c.chunk || v.bodies != bodies_)
    return false;
  if (groups_dirty_) {
    for (auto& [id, w] : views_) make_groups(w);
    groups_dirty_ = false;
  }
  Set& s = v.sets[set];
  const auto& c = v.c;
  void* st = reinterpret_cast<void*>(stream);
  outputs &= c.outputs;
  if (!outputs) return false;

  uint32_t U[32] = {};
  float* F = reinterpret_cast<float*>(U);
  const float PW = float(c.proxy_width), PH = float(c.proxy_height);
  F[0] = 2.0f * c.f / PW;
  F[1] = 2.0f * (c.cx + 0.5f) / PW - 1.0f;
  F[2] = -2.0f * c.f / PH;
  F[3] = 1.0f - 2.0f * (c.cy + 0.5f) / PH;
  F[4] = c.far / (c.far - c.near);
  F[5] = -c.far * c.near / (c.far - c.near);
  F[6] = c.near;
  F[7] = c.far;
  U[8] = c.width; U[9] = c.height; U[10] = v.To; U[11] = c.supersample;
  F[12] = PW; F[13] = PH; F[14] = c.f;
  U[16] = v.T; U[17] = v.Ts; U[18] = c.shadow_res; U[19] = outputs;
  U[20] = e0; U[21] = n; U[22] = v.bodies; U[23] = slots_;
  U[24] = seed;
  F[28] = c.cx; F[29] = c.cy;
  gpu_.queue.WriteBuffer(s.uniform, 0, U, sizeof(U));

  const uint32_t row_bytes = 2 * (v.bodies + 1) * 16;
  if (s.pose.shared) {   // CUDA writes the poses once Dawn is done with the last ones
    if (!poses_dev || !s.pose.shared->wait_dawn(st) ||
        !s.pose.shared->copy_from(reinterpret_cast<const void*>(poses_dev), pitch, n, st) ||
        !s.pose.shared->signal_dawn(st) || !s.pose.shared->begin(true))
      return false;
  } else {
    if (!poses_host) return false;
    wgpu::TexelCopyTextureInfo dst{};
    dst.texture = s.pose.tex;
    wgpu::TexelCopyBufferLayout lay{};
    lay.bytesPerRow = row_bytes;
    lay.rowsPerImage = n;
    wgpu::Extent3D ex{2 * (v.bodies + 1), n, 1};
    gpu_.queue.WriteTexture(&dst, poses_host, uint64_t(row_bytes) * n, &lay, &ex);
  }
  for (auto& o : s.out)
    if (o.shared && !o.shared->begin(false)) return false;

  auto enc = gpu_.device.CreateCommandEncoder();
  auto draw_bodies = [&](wgpu::RenderPassEncoder& p, uint32_t first_env, uint32_t count,
                         const wgpu::BindGroup& group) {
    p.SetVertexBuffer(0, vbuf_);
    p.SetIndexBuffer(ibuf_, wgpu::IndexFormat::Uint32);
    p.SetBindGroup(0, group);
    for (uint32_t b = 0; b < v.bodies; ++b)
      if (index_count_[b]) p.DrawIndexed(index_count_[b], count, first_index_[b], 0, b * n + first_env);
  };
  if (shadows_ && v.shadow) {
    for (uint32_t l = 0; l * v.Ts < n; ++l) {
      wgpu::RenderPassDepthStencilAttachment da{};
      da.view = v.shadow_v[l];
      da.depthLoadOp = wgpu::LoadOp::Clear;
      da.depthStoreOp = wgpu::StoreOp::Store;
      da.depthClearValue = 1.0f;
      wgpu::RenderPassDescriptor rp{};
      rp.label = "raster shadow";
      rp.depthStencilAttachment = &da;
      auto p = enc.BeginRenderPass(&rp);
      p.SetPipeline(shadow_pipe_);
      draw_bodies(p, l * v.Ts, std::min(v.Ts, n - l * v.Ts), s.shadow_group);
      p.End();
    }
  }
  const bool rad = outputs & (kRasterRgb | kRasterLinear);
  const bool geo = outputs & (kRasterDepth | kRasterSeg);
  const double none = seg16_ ? 65535.0 : 4294967295.0;
  for (uint32_t l = 0; l * v.T < n; ++l) {
    std::vector<wgpu::RenderPassColorAttachment> ca;
    auto attach = [&ca](const wgpu::TextureView& view, wgpu::Color clear) {
      wgpu::RenderPassColorAttachment a{};
      a.view = view;
      a.loadOp = wgpu::LoadOp::Clear;
      a.storeOp = wgpu::StoreOp::Store;
      a.clearValue = clear;
      ca.push_back(a);
    };
    if (rad) attach(v.rad_v[l], {0, 0, 0, 0});
    if (geo) {
      attach(v.depth_v[l], {0, 0, 0, 0});
      attach(v.seg_v[l], {none, 0, 0, 0});
    }
    wgpu::RenderPassDepthStencilAttachment da{};
    da.view = v.zbuf_v[l];
    da.depthLoadOp = wgpu::LoadOp::Clear;
    da.depthStoreOp = wgpu::StoreOp::Discard;
    da.depthClearValue = 1.0f;
    wgpu::RenderPassDescriptor rp{};
    rp.label = "raster main";
    rp.colorAttachmentCount = ca.size();
    rp.colorAttachments = ca.data();
    rp.depthStencilAttachment = &da;
    auto p = enc.BeginRenderPass(&rp);
    p.SetPipeline(main_pipe_[rad && geo ? 2 : geo ? 1 : 0]);
    draw_bodies(p, l * v.T, std::min(v.T, n - l * v.T), s.render_group);
    p.End();
  }
  {
    wgpu::ComputePassDescriptor cp{};
    cp.label = "raster remap";
    auto p = enc.BeginComputePass(&cp);
    p.SetPipeline(remap_pipe_);
    p.SetBindGroup(0, s.compute_group);
    p.DispatchWorkgroups(div_up(c.width, 8), div_up(c.height, 8), n);
    p.End();
  }
  auto cmd = enc.Finish();
  gpu_.queue.Submit(1, &cmd);
  bool ok = true;
  if (s.pose.shared) ok = s.pose.shared->end() && ok;
  for (auto& o : s.out)
    if (o.shared) ok = o.shared->end() && ok;
  return ok;
}

bool CameraRaster::collect(int view, int set, uint32_t n, const uint64_t dst[4], uint64_t stream) {
  auto it = views_.find(view);
  if (it == views_.end()) return false;
  View& v = it->second;
  if (set < 0 || set >= int(v.sets.size())) return false;
  void* st = reinterpret_cast<void*>(stream);
  for (int k = 0; k < 4; ++k) {
    auto& o = v.sets[set].out[k];
    if (!o.shared) continue;
    if (!o.shared->wait_dawn(st)) return false;
    if (dst[k] && !o.shared->copy_to(reinterpret_cast<void*>(dst[k]), uint64_t(n) * v.c.height, st))
      return false;
    if (!o.shared->signal_dawn(st)) return false;
  }
  return true;
}

bool CameraRaster::readback(Image& im, uint32_t rows, void* dst) {
  const uint32_t W = im.tex.GetWidth(), Hl = im.tex.GetHeight();
  const uint32_t row = W * im.bpp, pitch = (row + 255) & ~255u;
  auto b = gpu_.create_buffer(uint64_t(pitch) * rows, wgpu::BufferUsage::MapRead | wgpu::BufferUsage::CopyDst,
                              "raster readback");
  auto enc = gpu_.device.CreateCommandEncoder();
  for (uint32_t l = 0, r0 = 0; r0 < rows; ++l, r0 += Hl) {
    wgpu::TexelCopyTextureInfo src{};
    src.texture = im.tex;
    src.origin = {0, 0, l};
    wgpu::TexelCopyBufferInfo d{};
    d.buffer = b;
    d.layout.offset = uint64_t(r0) * pitch;
    d.layout.bytesPerRow = pitch;
    d.layout.rowsPerImage = Hl;
    wgpu::Extent3D ex{W, std::min(Hl, rows - r0), 1};
    enc.CopyTextureToBuffer(&src, &d, &ex);
  }
  auto cmd = enc.Finish();
  gpu_.queue.Submit(1, &cmd);
  bool ok = false;
  gpu_.wait(b.MapAsync(wgpu::MapMode::Read, 0, uint64_t(pitch) * rows, wgpu::CallbackMode::WaitAnyOnly,
                       [&ok](wgpu::MapAsyncStatus st, wgpu::StringView) {
                         ok = st == wgpu::MapAsyncStatus::Success;
                       }));
  if (!ok) return false;
  const auto* srcp = static_cast<const uint8_t*>(b.GetConstMappedRange());
  auto* out = static_cast<uint8_t*>(dst);
  for (uint32_t r = 0; r < rows; ++r) std::memcpy(out + uint64_t(r) * row, srcp + uint64_t(r) * pitch, row);
  b.Unmap();
  return true;
}

bool CameraRaster::collect_host(int view, int set, uint32_t n, void* const dst[4]) {
  auto it = views_.find(view);
  if (it == views_.end()) return false;
  View& v = it->second;
  if (set < 0 || set >= int(v.sets.size())) return false;
  for (int k = 0; k < 4; ++k) {
    auto& o = v.sets[set].out[k];
    if (o.tex && dst[k] && !readback(o, n * v.c.height, dst[k])) return false;
  }
  return true;
}

void CameraRaster::wait_idle() {
  gpu_.wait(gpu_.queue.OnSubmittedWorkDone(wgpu::CallbackMode::WaitAnyOnly,
                                           [](wgpu::QueueWorkDoneStatus, wgpu::StringView) {}));
}

}  // namespace rillfacet
