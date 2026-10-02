#pragma once
// Immediate-mode 3D annotations, rebuilt every frame: lines, dots and text
// labels anchored in world space (measurements, selection, grid rulers, user
// labels). Colors are sRGB with alpha.

#include <glm/glm.hpp>

#include <string>
#include <vector>

namespace rillfacet {

// Must match `Item` in shaders/overlay_lines.wgsl.
struct OverlayLine {
  glm::vec4 a;       // xyz, w = width px
  glm::vec4 b;       // xyz, w = opacity when hidden
  glm::vec4 color;
  glm::vec4 border;  // rgb, a = border width px
};

struct TextLabel {
  std::string text;
  glm::vec3 anchor{0.0f};
  float size_px = 14.0f;
  glm::vec2 align{0.0f, 0.0f};   // 0,0 = anchor at top-left; 0.5,0.5 = centered
  glm::vec2 offset{0.0f, 0.0f};  // pixels
  glm::vec4 color{1.0f};
  glm::vec4 halo{0.0f, 0.0f, 0.0f, 0.75f};
  float halo_px = 2.0f;
  float hidden_alpha = 0.3f;     // opacity when the anchor is behind geometry
  bool ignore_depth = false;
  // When > 0, the text is this tall in world units at the anchor (it shrinks
  // with distance like a sign in the scene) and size_px is ignored; labels
  // that would come out smaller than min_px are skipped.
  float world_height = 0.0f;
  float min_px = 4.0f;
};

class Overlay {
 public:
  void line(const glm::vec3& a, const glm::vec3& b, const glm::vec4& color, float width_px = 2.0f,
            float hidden_alpha = 0.35f, const glm::vec4& border = glm::vec4(0.0f)) {
    lines.push_back({glm::vec4(a, width_px), glm::vec4(b, hidden_alpha), color, border});
  }
  void dot(const glm::vec3& p, const glm::vec4& color, float diameter_px = 8.0f,
           float hidden_alpha = 0.35f, const glm::vec4& border = {0.0f, 0.0f, 0.0f, 1.5f}) {
    lines.push_back({glm::vec4(p, diameter_px), glm::vec4(p, hidden_alpha), color, border});
  }
  void text(TextLabel label) { labels.push_back(std::move(label)); }
  void clear() {
    lines.clear();
    labels.clear();
  }

  std::vector<OverlayLine> lines;
  std::vector<TextLabel> labels;
};

}  // namespace rillfacet
