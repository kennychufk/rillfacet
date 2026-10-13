#pragma once
// Zero-copy image sharing between Dawn (Vulkan) and CUDA, Linux + NVIDIA.
//
// Dawn cannot export memory, so the images are allocated here on our own
// VkDevice (same physical GPU as Dawn's adapter) as exportable OPAQUE_FD
// memory, imported into Dawn (SharedTextureMemory) and into CUDA (external
// memory -> CUarray). Two binary semaphores order each hand-over on the GPU:
// Dawn's EndAccess fence (Dawn done -> CUDA may read / write) and our own
// exported semaphore (CUDA done -> Dawn's next BeginAccess may proceed).
// Only textures can be shared with CUDA this way, so there is one
// device-to-device copy between the image and a linear (torch) buffer.
//
// Both libvulkan.so.1 and libcuda.so.1 are loaded at runtime: nothing links
// against them, and available() is false where either is missing.

#include <webgpu/webgpu_cpp.h>

#include <cstdint>
#include <memory>
#include <string>

namespace rillfacet {

struct SharedImageImpl;

// One image (2D, optionally layered) visible to Dawn and CUDA.
class SharedImage {
 public:
  ~SharedImage();
  wgpu::Texture texture() const;
  // Dawn side. begin() waits (on the GPU) for CUDA's last access; end()
  // hands the image to CUDA (its next wait_dawn() waits for Dawn's work).
  bool begin(bool contents_from_cuda);
  bool end();
  // CUDA side, on `stream` (a CUstream / cudaStream_t, e.g. torch's).
  bool wait_dawn(void* stream);
  bool signal_dawn(void* stream);
  // Copies rows [0, rows) of the layer-major image (layer l's rows follow
  // layer l-1's) into / from a linear buffer of `row_bytes`-wide rows.
  bool copy_to(void* dst, uint64_t rows, void* stream);
  bool copy_from(const void* src, uint64_t src_pitch, uint64_t rows, void* stream);
  uint32_t width() const;
  uint32_t height() const;
  uint32_t layers() const;

 private:
  friend class CudaShare;
  explicit SharedImage(std::unique_ptr<SharedImageImpl> impl);
  std::unique_ptr<SharedImageImpl> impl_;
};

struct CudaShareImpl;

class CudaShare {
 public:
  // `device` must have been created with SharedTextureMemoryOpaqueFD and
  // SharedFenceVkSemaphoreOpaqueFD (and NOT SharedFenceSyncFD, which makes
  // Dawn export sync FDs that CUDA cannot import).
  CudaShare(const wgpu::Adapter& adapter, const wgpu::Device& device);
  ~CudaShare();
  bool available() const;
  const std::string& error() const;
  // Waits for all CUDA work of the context (before freeing shared images).
  void synchronize();
  // format: RGBA8Unorm, RGBA16Float, RGBA32Float, R32Float, R16Uint, R32Uint.
  std::unique_ptr<SharedImage> create(wgpu::TextureFormat format, uint32_t width,
                                      uint32_t height, uint32_t layers,
                                      wgpu::TextureUsage usage);

 private:
  std::unique_ptr<CudaShareImpl> impl_;
};

}  // namespace rillfacet
