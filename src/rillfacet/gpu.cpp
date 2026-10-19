#include "rillfacet/gpu.h"

#include <algorithm>
#include <cstdio>

namespace rillfacet {

static std::string to_string(wgpu::StringView s) {
  if (!s.data) return {};
  return s.length == WGPU_STRLEN ? std::string(s.data) : std::string(s.data, s.length);
}

bool Gpu::init(const GpuOptions& options) {
  wgpu::InstanceFeatureName features[] = {wgpu::InstanceFeatureName::TimedWaitAny};
  wgpu::InstanceDescriptor instance_desc{};
  instance_desc.requiredFeatureCount = 1;
  instance_desc.requiredFeatures = features;
  instance = wgpu::CreateInstance(&instance_desc);
  if (!instance) {
    std::fprintf(stderr, "[rillfacet] failed to create WebGPU instance\n");
    return false;
  }

  wgpu::RequestAdapterOptions adapter_opts{};
  adapter_opts.powerPreference = wgpu::PowerPreference::HighPerformance;
#if defined(__APPLE__)
  adapter_opts.backendType = wgpu::BackendType::Metal;
#elif defined(_WIN32)
  adapter_opts.backendType = wgpu::BackendType::D3D12;
#else
  adapter_opts.backendType = wgpu::BackendType::Vulkan;
#endif
  wait(instance.RequestAdapter(
      &adapter_opts, wgpu::CallbackMode::WaitAnyOnly,
      [this](wgpu::RequestAdapterStatus status, wgpu::Adapter a, wgpu::StringView msg) {
        if (status == wgpu::RequestAdapterStatus::Success)
          adapter = std::move(a);
        else
          std::fprintf(stderr, "[rillfacet] adapter request failed: %s\n", to_string(msg).c_str());
      }));
  if (!adapter) return false;

  wgpu::AdapterInfo info{};
  adapter.GetInfo(&info);
  adapter_name = to_string(info.device);

  // Ask for the adapter's limits so large scenes (multi-env grids) fit.
  wgpu::Limits limits{};
  adapter.GetLimits(&limits);
  wgpu::Limits required{};
  required.maxStorageBufferBindingSize = limits.maxStorageBufferBindingSize;
  required.maxBufferSize = limits.maxBufferSize;
  if (options.max_texture_limits) {
    required.maxTextureDimension2D = limits.maxTextureDimension2D;
    required.maxTextureArrayLayers = limits.maxTextureArrayLayers;
  }

  wgpu::DeviceDescriptor device_desc{};
  device_desc.label = "rillfacet";
  device_desc.requiredLimits = &required;
  std::vector<wgpu::FeatureName> device_features = options.features;
  for (auto f : options.optional_features)
    if (adapter.HasFeature(f)) device_features.push_back(f);
  device_desc.requiredFeatureCount = device_features.size();
  device_desc.requiredFeatures = device_features.data();
  device_desc.SetDeviceLostCallback(
      wgpu::CallbackMode::AllowSpontaneous,
      [](const wgpu::Device&, wgpu::DeviceLostReason reason, wgpu::StringView msg) {
        if (reason != wgpu::DeviceLostReason::Destroyed &&
            reason != wgpu::DeviceLostReason::CallbackCancelled)
          std::fprintf(stderr, "[rillfacet] device lost: %s\n", to_string(msg).c_str());
      });
  device_desc.SetUncapturedErrorCallback(
      [](const wgpu::Device&, wgpu::ErrorType, wgpu::StringView msg) {
        std::fprintf(stderr, "[rillfacet] WebGPU error: %s\n", to_string(msg).c_str());
      });
  wait(adapter.RequestDevice(
      &device_desc, wgpu::CallbackMode::WaitAnyOnly,
      [this](wgpu::RequestDeviceStatus status, wgpu::Device d, wgpu::StringView msg) {
        if (status == wgpu::RequestDeviceStatus::Success)
          device = std::move(d);
        else
          std::fprintf(stderr, "[rillfacet] device request failed: %s\n", to_string(msg).c_str());
      }));
  if (!device) return false;
  queue = device.GetQueue();
  return true;
}

void Gpu::wait(wgpu::Future future) const {
  instance.WaitAny(future, UINT64_MAX);
}

wgpu::Buffer Gpu::create_buffer(uint64_t size, wgpu::BufferUsage usage, const char* label) const {
  wgpu::BufferDescriptor desc{};
  desc.label = label;
  desc.size = (std::max<uint64_t>(size, 16) + 3) & ~uint64_t(3);
  desc.usage = usage;
  return device.CreateBuffer(&desc);
}

wgpu::Texture Gpu::create_texture(uint32_t w, uint32_t h, wgpu::TextureFormat format,
                                  wgpu::TextureUsage usage, const char* label,
                                  uint32_t samples, uint32_t mips) const {
  wgpu::TextureDescriptor desc{};
  desc.label = label;
  desc.size = {std::max(w, 1u), std::max(h, 1u), 1};
  desc.format = format;
  desc.usage = usage;
  desc.sampleCount = samples;
  desc.mipLevelCount = mips;
  return device.CreateTexture(&desc);
}

void Gpu::push_error_scope() const { device.PushErrorScope(wgpu::ErrorFilter::Validation); }

std::string Gpu::pop_error_scope() const {
  std::string error;
  wait(device.PopErrorScope(
      wgpu::CallbackMode::WaitAnyOnly,
      [&error](wgpu::PopErrorScopeStatus, wgpu::ErrorType type, wgpu::StringView msg) {
        if (type != wgpu::ErrorType::NoError) error = to_string(msg);
      }));
  return error;
}

bool DynamicBuffer::upload(const Gpu& gpu, const void* data, uint64_t size,
                           wgpu::BufferUsage usage, const char* label) {
  bool recreated = false;
  uint64_t padded = (std::max<uint64_t>(size, 16) + 3) & ~uint64_t(3);
  if (!buffer || padded > capacity) {
    capacity = std::max(padded, capacity + capacity / 2);
    buffer = gpu.create_buffer(capacity, usage | wgpu::BufferUsage::CopyDst, label);
    recreated = true;
  }
  if (data && size > 0) {
    if (size % 4 == 0) {
      gpu.queue.WriteBuffer(buffer, 0, data, size);
    } else {
      std::vector<uint8_t> tmp((size + 3) & ~uint64_t(3), 0);
      std::copy_n(static_cast<const uint8_t*>(data), size, tmp.data());
      gpu.queue.WriteBuffer(buffer, 0, tmp.data(), tmp.size());
    }
  }
  return recreated;
}

wgpu::BindGroupLayout make_layout(const Gpu& gpu, const char* label,
                                  std::initializer_list<LayoutEntry> entries) {
  std::vector<wgpu::BindGroupLayoutEntry> out;
  for (const LayoutEntry& e : entries) {
    wgpu::BindGroupLayoutEntry b{};
    b.binding = e.binding;
    b.visibility = e.visibility;
    switch (e.kind) {
      case BindingKind::Uniform: b.buffer.type = wgpu::BufferBindingType::Uniform; break;
      case BindingKind::Storage: b.buffer.type = wgpu::BufferBindingType::ReadOnlyStorage; break;
      case BindingKind::Sampler: b.sampler.type = wgpu::SamplerBindingType::Filtering; break;
      case BindingKind::ComparisonSampler:
        b.sampler.type = wgpu::SamplerBindingType::Comparison;
        break;
      case BindingKind::Texture: b.texture.sampleType = wgpu::TextureSampleType::Float; break;
      case BindingKind::UnfilterableTexture:
        b.texture.sampleType = wgpu::TextureSampleType::UnfilterableFloat;
        break;
      case BindingKind::UintTexture: b.texture.sampleType = wgpu::TextureSampleType::Uint; break;
      case BindingKind::DepthTexture: b.texture.sampleType = wgpu::TextureSampleType::Depth; break;
      case BindingKind::StorageTextureWrite:
        b.storageTexture.access = wgpu::StorageTextureAccess::WriteOnly;
        b.storageTexture.format = e.storage_format;
        b.storageTexture.viewDimension = wgpu::TextureViewDimension::e2D;
        break;
    }
    if (e.kind == BindingKind::Texture || e.kind == BindingKind::UnfilterableTexture ||
        e.kind == BindingKind::UintTexture || e.kind == BindingKind::DepthTexture)
      b.texture.viewDimension = wgpu::TextureViewDimension::e2D;
    out.push_back(b);
  }
  wgpu::BindGroupLayoutDescriptor desc{};
  desc.label = label;
  desc.entryCount = out.size();
  desc.entries = out.data();
  return gpu.device.CreateBindGroupLayout(&desc);
}

wgpu::BindGroup make_group(const Gpu& gpu, const wgpu::BindGroupLayout& layout,
                           std::initializer_list<Bind> binds, const char* label) {
  std::vector<wgpu::BindGroupEntry> out;
  for (const Bind& b : binds) {
    wgpu::BindGroupEntry e{};
    e.binding = b.binding;
    e.buffer = b.buffer;
    e.size = b.size;
    e.textureView = b.view;
    e.sampler = b.sampler;
    out.push_back(e);
  }
  wgpu::BindGroupDescriptor desc{};
  desc.label = label;
  desc.layout = layout;
  desc.entryCount = out.size();
  desc.entries = out.data();
  return gpu.device.CreateBindGroup(&desc);
}

}  // namespace rillfacet
