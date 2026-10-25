#pragma once
// Batched camera rasterizer for vision RL (Python: rillfacet.render.raster).
//
// Renders the same camera in many envs at once. All envs share one world
// frame; each env is drawn into its own tile of a layered atlas by instanced
// draws (instance = body * n + env), posed in the vertex shader from a pose
// texture (per env: every body's pose, then the camera's), and kept in its
// tile by clip distances. Per chunk of envs:
//
//   1. shadow passes: a depth tile per env from the first directional light;
//   2. main passes: a centered PINHOLE proxy per env (forward PBR: linear
//      radiance, camera z-depth, body label);
//   3. a compute pass resamples each proxy through the OpenCV distortion
//      (precomputed remap), adds the background, applies the camera sensor
//      (gain, vignetting, shot / read noise) and writes the outputs: sRGB
//      RGBA8, linear RGBA16F, z-depth R32F, label R16Uint (R32Uint without
//      TextureFormatsTier1).
//
// With zero-copy (Linux + Vulkan + NVIDIA, CudaShare) the pose texture and
// the outputs are shared with CUDA: launch() copies poses from a device
// pointer and collect() copies the outputs into device pointers, all on a
// CUDA stream and ordered against Dawn by GPU semaphores (no CPU waits).
// Otherwise poses come from host memory and collect_host() reads back.

#include <webgpu/webgpu_cpp.h>

#include <cstdint>
#include <map>
#include <memory>
#include <string>
#include <vector>

#include "rillfacet/cuda_share.h"
#include "rillfacet/gpu.h"

namespace rillfacet {

enum RasterOutput : uint32_t {
  kRasterRgb = 1,      // sRGB RGBA8 (alpha 255)
  kRasterLinear = 2,   // linear RGBA16F (alpha 1)
  kRasterDepth = 4,    // camera z-depth R32F, 0 = nothing
  kRasterSeg = 8,      // label R16Uint / R32Uint, all ones = nothing
};

struct RasterViewConfig {
  uint32_t width = 0, height = 0;            // output image
  uint32_t proxy_width = 0, proxy_height = 0;
  float f = 0, cx = 0, cy = 0;               // proxy pinhole (pixel centers at integers)
  float near = 0.01f, far = 10.0f;
  uint32_t chunk = 256;                      // envs per launch
  uint32_t sets = 2;                         // launch / collect double buffering
  uint32_t shadow_res = 512;
  uint32_t outputs = kRasterRgb;
  uint32_t supersample = 2;                  // S x S radiance taps per output pixel
  uint32_t remaps = 1;                       // remap tables: 1 shared, or one per env
};

class CameraRaster {
 public:
  explicit CameraRaster(bool zero_copy);
  ~CameraRaster();
  bool ok() const { return ok_; }
  bool zero_copy() const { return share_ && share_->available(); }
  std::string info() const;
  bool seg16() const { return seg16_; }

  // verts [nv, 9]: body-local position, normal (0 = flat), uv, material
  // slot (u32 bits). ranges [bodies, 2]: first index, index count of each
  // body's triangles (bodies in pose-texture order).
  bool set_geometry(const float* verts, uint32_t nv, const uint32_t* idx, uint32_t ni,
                    const uint32_t* ranges, uint32_t bodies);
  // Base color textures (sRGB RGBA8), all size x size, `layers` of them;
  // mips[k] holds level k of every layer (layer-major).
  bool set_textures(uint32_t size, uint32_t layers, const std::vector<const uint8_t*>& mips);
  // Equirectangular environment, linear RGBA16F (raw half bits), w x h at
  // level 0, halved per level.
  bool set_envmap(uint32_t w, uint32_t h, const std::vector<const uint16_t*>& mips);
  // Directional albedo of the BRDF, n x n (n_dot_v along x, roughness along
  // y), RGBA16F half bits: GGX scale and bias (F0 * x + y), Burley diffuse.
  bool set_brdf_lut(uint32_t n, const uint16_t* data);
  // [envs, slots, 8]: linear base color, roughness, metallic, texture layer
  // (-1 = none), solid texture row (-1 = none), its bump (0 / 1).
  bool set_materials(const float* m, uint32_t envs, uint32_t slots);
  // [n, 32]: solid (3D) texture parameter rows (rillfacet.solid_texture's
  // layout, linear colors; the last float 1 = filter by the footprint).
  bool set_solid_textures(const float* rows, uint32_t n);
  // [envs, 8]: gain rgb, vignetting, shot noise, read noise, 0, 0.
  bool set_lens(const float* l, uint32_t envs);
  // The frame uniform (lights, shadow box, environment), kFrameFloats floats.
  static constexpr size_t kFrameFloats = 92;
  bool set_frame(const float* f);

  // A camera configuration with its own buffers. remap [remaps, height *
  // width, 8]: proxy pixel position of each output pixel's center ray (x,
  // y), its derivatives along output u (x, y) and v (x, y), r^2
  // (vignetting), 0. One table shared by every env (remaps = 1) or one per
  // env (per-env intrinsics; launches then need e0 + n <= remaps).
  int add_view(const RasterViewConfig& c, const float* remap);
  void remove_view(int view);
  // Envs [e0, e0 + n) (n <= chunk) into buffer set `set`. Poses: rows of
  // 2 * (bodies + 1) float4 per env ((pos, visible), quat xyzw; the camera
  // last), from CUDA device memory (`poses_dev`, row pitch `pitch` bytes, on
  // `stream`) or from host memory. `outputs`: the RasterOutput bits to
  // render this time (a subset of the view's).
  bool launch(int view, int set, uint32_t e0, uint32_t n, uint64_t poses_dev, uint64_t pitch,
              const float* poses_host, uint64_t stream, uint32_t seed, uint32_t outputs);
  // The outputs of the set's last launch into device pointers (0 = skip),
  // [n, H, W, (4)] each, in kRasterRgb, kRasterLinear, kRasterDepth,
  // kRasterSeg order, on `stream`.
  bool collect(int view, int set, uint32_t n, const uint64_t dst[4], uint64_t stream);
  // Fallback: waits and copies into host memory.
  bool collect_host(int view, int set, uint32_t n, void* const dst[4]);
  void wait_idle();

 private:
  struct Image {   // a shared image or, without zero-copy, a plain texture
    std::unique_ptr<SharedImage> shared;
    wgpu::Texture tex;
    wgpu::TextureFormat format = wgpu::TextureFormat::Undefined;
    uint32_t bpp = 0;
  };
  struct Set {
    Image pose;
    Image out[4];
    wgpu::Buffer uniform;
    wgpu::BindGroup render_group, shadow_group, compute_group;
  };
  struct View {
    RasterViewConfig c;
    uint32_t T = 1, L = 1;     // proxy tiles per layer, layers
    uint32_t Ts = 1, Ls = 1;   // shadow tiles per layer, layers
    uint32_t To = 1, Lo = 1;   // output tiles per layer, layers
    uint32_t bodies = 0;       // pose texture: 2 * (bodies + 1) columns
    wgpu::Texture rad, depth, seg, zbuf, shadow;
    std::vector<wgpu::TextureView> rad_v, depth_v, seg_v, zbuf_v, shadow_v;
    wgpu::Buffer remap;
    std::vector<Set> sets;
  };

  bool make_image(Image& im, wgpu::TextureFormat f, uint32_t w, uint32_t h, uint32_t layers,
                  wgpu::TextureUsage usage, const char* label);
  bool make_pipelines();
  void make_groups(View& v);
  bool readback(Image& im, uint32_t rows, void* dst);

  Gpu gpu_;
  std::unique_ptr<CudaShare> share_;
  bool ok_ = false, seg16_ = false;
  wgpu::TextureFormat seg_format_ = wgpu::TextureFormat::R32Uint;
  wgpu::BindGroupLayout render_layout_, shadow_layout_, compute_layout_;
  wgpu::RenderPipeline shadow_pipe_, main_pipe_[3];   // rgb, geometry, both
  wgpu::ComputePipeline remap_pipe_;
  wgpu::Buffer frame_, vbuf_, ibuf_, mats_, lens_, solid_;
  uint64_t mats_size_ = 0, lens_size_ = 0, solid_size_ = 128;
  std::vector<uint32_t> first_index_, index_count_;
  uint32_t bodies_ = 0;
  wgpu::Texture base_tex_, env_tex_, brdf_lut_;
  wgpu::Sampler cmp_, repeat_, clamp_;
  wgpu::Texture dummy_out_[4], dummy_rad_, dummy_depth_, dummy_seg_, dummy_shadow_;
  bool groups_dirty_ = true, shadows_ = false;
  uint32_t slots_ = 0, envs_ = 0;
  std::map<int, View> views_;
  int next_view_ = 0;
};

}  // namespace rillfacet
