#pragma once
// Thin helpers over the WebGPU C++ API (Dawn). Everything here is plain
// WebGPU, so the same code compiles for the browser via Emscripten.

#include <webgpu/webgpu_cpp.h>

#include <cstdint>
#include <initializer_list>
#include <string>
#include <vector>

namespace rillfacet {

class Gpu {
 public:
  // Creates instance, adapter and device. No window is needed (headless OK).
  bool init();

  // Blocks until `future` resolves. Native-only: the web port awaits instead.
  void wait(wgpu::Future future) const;

  wgpu::Buffer create_buffer(uint64_t size, wgpu::BufferUsage usage, const char* label) const;
  wgpu::Texture create_texture(uint32_t w, uint32_t h, wgpu::TextureFormat format,
                               wgpu::TextureUsage usage, const char* label,
                               uint32_t samples = 1, uint32_t mips = 1) const;

  // Error scopes turn validation errors (bad WGSL, layout mismatch) into a
  // string instead of a crash, which is what shader hot-reload needs.
  void push_error_scope() const;
  std::string pop_error_scope() const;  // empty when no error

  wgpu::Instance instance;
  wgpu::Adapter adapter;
  wgpu::Device device;
  wgpu::Queue queue;
  std::string adapter_name;
};

// A GPU buffer that grows on demand. upload() returns true when the buffer
// object was re-created, meaning bind groups that reference it are stale.
struct DynamicBuffer {
  wgpu::Buffer buffer;
  uint64_t capacity = 0;

  bool upload(const Gpu& gpu, const void* data, uint64_t size, wgpu::BufferUsage usage,
              const char* label);
};

// ---- Bind group layout / bind group shorthands ----------------------------

enum class BindingKind {
  Uniform,
  Storage,            // read-only storage buffer
  Sampler,            // filtering sampler
  ComparisonSampler,  // for shadow maps
  Texture,            // texture_2d<f32>, filterable
  UnfilterableTexture,
  UintTexture,        // texture_2d<u32>
  DepthTexture,       // texture_depth_2d
  StorageTextureWrite,
};

struct LayoutEntry {
  uint32_t binding;
  BindingKind kind;
  wgpu::ShaderStage visibility = wgpu::ShaderStage::Vertex | wgpu::ShaderStage::Fragment;
  wgpu::TextureFormat storage_format = wgpu::TextureFormat::Undefined;
};

wgpu::BindGroupLayout make_layout(const Gpu& gpu, const char* label,
                                  std::initializer_list<LayoutEntry> entries);

struct Bind {
  Bind(uint32_t b, const wgpu::Buffer& buf, uint64_t size = WGPU_WHOLE_SIZE)
      : binding(b), buffer(buf), size(size) {}
  Bind(uint32_t b, const wgpu::TextureView& v) : binding(b), view(v) {}
  Bind(uint32_t b, const wgpu::Sampler& s) : binding(b), sampler(s) {}
  uint32_t binding;
  wgpu::Buffer buffer;
  uint64_t size = WGPU_WHOLE_SIZE;
  wgpu::TextureView view;
  wgpu::Sampler sampler;
};

wgpu::BindGroup make_group(const Gpu& gpu, const wgpu::BindGroupLayout& layout,
                           std::initializer_list<Bind> binds, const char* label = nullptr);

}  // namespace rillfacet
