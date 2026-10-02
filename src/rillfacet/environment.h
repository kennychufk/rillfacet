#pragma once
// Lighting inputs that need no per-scene setup:
//  - environment maps (equirectangular, z-up) for the Environment PBR style,
//    generated procedurally or loaded from a .hdr file;
//  - matcaps (pictures of a lit sphere) for the MatCap style.

#include "rillfacet/gpu.h"

#include <glm/glm.hpp>

#include <array>
#include <string>
#include <vector>

namespace rillfacet {

class ShaderLibrary;

struct EnvironmentImage {
  int width = 0, height = 0;
  std::vector<float> rgb;          // linear radiance, row-major, top row = +z
  glm::vec3 sun_dir{0, 0, 1};      // dominant light direction (for the shadow)
};

enum class EnvironmentPreset : int { Studio, Sky, Soft, Count };
const char* environment_name(EnvironmentPreset p);
EnvironmentImage make_environment(EnvironmentPreset preset, int width = 1024);
bool load_hdr(const std::string& path, EnvironmentImage& out);

enum class MatcapPreset : int { Clay, Porcelain, Chrome, Toon, Count };
const char* matcap_name(MatcapPreset p);
// RGBA8: rgb = sRGB shading, a = linear specular highlight.
std::vector<uint8_t> make_matcap(MatcapPreset preset, int size = 256);
// Default "tint by object color" amount for a preset (0 for full-color pictures).
float matcap_default_tint(MatcapPreset preset);

// GPU copy of an environment: mip k holds the reflection for roughness
// (k / (mips-1))^2, plus 9 spherical-harmonic coefficients for diffuse light.
class EnvironmentMap {
 public:
  bool build(const Gpu& gpu, ShaderLibrary& shaders, const EnvironmentImage& image,
             std::string* error);
  wgpu::TextureView view;
  uint32_t mip_count = 1;
  std::array<glm::vec3, 9> sh{};  // pre-divided by pi: shader gets diffuse radiance
  glm::vec3 sun_dir{0, 0, 1};
};

}  // namespace rillfacet
