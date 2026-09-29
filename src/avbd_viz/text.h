#pragma once
// Signed-distance-field font: one atlas rendered from a TTF at startup
// (stb_truetype), drawn at any size by shaders/overlay_text.wgsl.

#include <glm/glm.hpp>

#include <cstdint>
#include <string>
#include <unordered_map>
#include <vector>

namespace avbd_viz {

// One glyph quad. Must match `Glyph` in shaders/overlay_text.wgsl.
struct GlyphInstance {
  glm::vec4 anchor;  // world xyz, w = opacity when hidden
  glm::vec4 rect;    // pixels relative to the anchor: x, y, w, h
  glm::vec4 uv;      // u0, v0, u1, v1
  glm::vec4 color;   // sRGB + alpha
  glm::vec4 halo;    // sRGB + alpha
  glm::vec4 params;  // x = halo thickness (SDF units), y = ignore depth
};

class Font {
 public:
  bool load(const std::string& ttf_path, float base_px = 48.0f, int padding = 8);

  // Size of `text` in pixels when drawn at `size_px`.
  glm::vec2 measure(const std::string& text, float size_px) const;

  // Appends glyph quads. `align` = (0,0) puts the anchor at the text's
  // top-left, (0.5,0.5) centers it, (0,1) bottom-left, etc.
  void layout(const std::string& text, const glm::vec3& anchor, float size_px,
              const glm::vec2& align, const glm::vec2& offset_px, const glm::vec4& color,
              const glm::vec4& halo, float halo_px, float hidden_alpha, bool ignore_depth,
              std::vector<GlyphInstance>& out) const;

  int atlas_width() const { return atlas_w_; }
  int atlas_height() const { return atlas_h_; }
  const std::vector<uint8_t>& atlas() const { return atlas_; }

  // Metrics, for clients that lay out text themselves (the web viewer).
  float base_px() const { return base_px_; }
  float ascent() const { return ascent_; }
  float line_height() const { return line_height_; }
  float sdf_per_px() const { return sdf_per_px_; }

  struct Glyph {
    glm::vec4 uv;        // atlas rect
    glm::vec2 offset;    // top-left relative to the pen (base px, y down)
    glm::vec2 size;      // base px
    float advance = 0;   // base px
  };
  const std::unordered_map<uint32_t, Glyph>& glyphs() const { return glyphs_; }

 private:
  const Glyph* find(uint32_t codepoint) const;

  std::unordered_map<uint32_t, Glyph> glyphs_;
  float base_px_ = 48, ascent_ = 0, line_height_ = 0, sdf_per_px_ = 0;
  std::vector<uint8_t> atlas_;
  int atlas_w_ = 0, atlas_h_ = 0;
};

}  // namespace avbd_viz
