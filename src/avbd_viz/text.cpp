#include "avbd_viz/text.h"

#include <stb_truetype.h>

#include <cmath>
#include <fstream>
#include <iterator>

namespace avbd_viz {

static std::vector<uint32_t> decode_utf8(const std::string& s) {
  std::vector<uint32_t> out;
  for (size_t i = 0; i < s.size();) {
    uint8_t c = uint8_t(s[i]);
    uint32_t cp = c;
    int extra = c >= 0xF0 ? 3 : c >= 0xE0 ? 2 : c >= 0xC0 ? 1 : 0;
    if (extra) cp = c & (0x3F >> extra);
    for (int k = 1; k <= extra && i + k < s.size(); ++k) cp = (cp << 6) | (uint8_t(s[i + k]) & 0x3F);
    out.push_back(cp);
    i += 1 + extra;
  }
  return out;
}

bool Font::load(const std::string& path, float base_px, int padding) {
  std::ifstream in(path, std::ios::binary);
  if (!in) return false;
  std::vector<unsigned char> ttf((std::istreambuf_iterator<char>(in)), {});
  stbtt_fontinfo info;
  if (!stbtt_InitFont(&info, ttf.data(), stbtt_GetFontOffsetForIndex(ttf.data(), 0))) return false;

  base_px_ = base_px;
  float scale = stbtt_ScaleForPixelHeight(&info, base_px);
  int ascent, descent, gap;
  stbtt_GetFontVMetrics(&info, &ascent, &descent, &gap);
  ascent_ = ascent * scale;
  line_height_ = (ascent - descent + gap) * scale;
  const unsigned char on_edge = 128;
  const float dist_scale = 128.0f / padding;  // SDF value change per base pixel
  sdf_per_px_ = dist_scale / 255.0f;

  std::vector<uint32_t> codepoints;
  for (uint32_t c = 32; c < 127; ++c) codepoints.push_back(c);
  for (uint32_t c : {0xB0u, 0xB1u, 0xB5u, 0xB7u, 0xD7u, 0x394u, 0x3B8u, 0x3C9u, 0x2013u, 0x2192u})
    codepoints.push_back(c);  // ° ± µ · × Δ θ ω – →

  // Shelf-pack all glyph bitmaps into one atlas.
  atlas_w_ = 1024;
  atlas_h_ = 512;
  atlas_.assign(size_t(atlas_w_) * atlas_h_, 0);
  int pen_x = 1, pen_y = 1, shelf_h = 0;
  for (uint32_t cp : codepoints) {
    int w = 0, h = 0, xoff = 0, yoff = 0;
    unsigned char* bmp =
        stbtt_GetCodepointSDF(&info, scale, int(cp), padding, on_edge, dist_scale, &w, &h, &xoff, &yoff);
    int adv, lsb;
    stbtt_GetCodepointHMetrics(&info, int(cp), &adv, &lsb);
    Glyph g;
    g.advance = adv * scale;
    if (bmp) {
      if (pen_x + w + 1 >= atlas_w_) {
        pen_x = 1;
        pen_y += shelf_h + 1;
        shelf_h = 0;
      }
      if (pen_y + h + 1 >= atlas_h_) {
        stbtt_FreeSDF(bmp, nullptr);
        break;
      }
      for (int y = 0; y < h; ++y)
        for (int x = 0; x < w; ++x) atlas_[size_t(pen_y + y) * atlas_w_ + pen_x + x] = bmp[y * w + x];
      g.uv = {float(pen_x) / atlas_w_, float(pen_y) / atlas_h_, float(pen_x + w) / atlas_w_,
              float(pen_y + h) / atlas_h_};
      g.offset = {float(xoff), float(yoff) + ascent_};
      g.size = {float(w), float(h)};
      pen_x += w + 1;
      shelf_h = std::max(shelf_h, h);
      stbtt_FreeSDF(bmp, nullptr);
    }
    glyphs_[cp] = g;
  }
  return true;
}

const Font::Glyph* Font::find(uint32_t cp) const {
  auto it = glyphs_.find(cp);
  if (it != glyphs_.end()) return &it->second;
  it = glyphs_.find('?');
  return it != glyphs_.end() ? &it->second : nullptr;
}

glm::vec2 Font::measure(const std::string& text, float size_px) const {
  float s = size_px / base_px_, w = 0;
  for (uint32_t cp : decode_utf8(text))
    if (const Glyph* g = find(cp)) w += g->advance;
  return {w * s, line_height_ * s};
}

void Font::layout(const std::string& text, const glm::vec3& anchor, float size_px,
                  const glm::vec2& align, const glm::vec2& offset_px, const glm::vec4& color,
                  const glm::vec4& halo, float halo_px, float hidden_alpha, bool ignore_depth,
                  std::vector<GlyphInstance>& out) const {
  float s = size_px / base_px_;
  glm::vec2 size = measure(text, size_px);
  // Tighter vertical box: cap height rather than the full line height.
  glm::vec2 origin = glm::round(offset_px - align * glm::vec2(size.x, ascent_ * s * 0.78f));
  float halo_sdf = std::min(halo_px / s * sdf_per_px_, 0.45f);
  float pen = 0;
  for (uint32_t cp : decode_utf8(text)) {
    const Glyph* g = find(cp);
    if (!g) continue;
    if (g->size.x > 0) {
      GlyphInstance gi;
      gi.anchor = glm::vec4(anchor, hidden_alpha);
      gi.rect = glm::vec4(origin.x + (pen + g->offset.x) * s,
                          origin.y + (g->offset.y - ascent_ * 0.22f) * s, g->size.x * s, g->size.y * s);
      gi.uv = g->uv;
      gi.color = color;
      gi.halo = halo;
      gi.params = glm::vec4(halo_sdf, ignore_depth ? 1.0f : 0.0f, 0, 0);
      out.push_back(gi);
    }
    pen += g->advance;
  }
}

}  // namespace avbd_viz
