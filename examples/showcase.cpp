// avbd-viz showcase: no simulator needed. An animated cloth-like sheet with
// per-vertex quantities, a few rigid shapes (segments of one mesh), points
// and vectors.
//
//   ./showcase                                  interactive window
//   ./showcase --headless --out shot.png        offscreen screenshot
//   ./showcase --headless --style 2 --theme light --out pbr.png

#include "avbd_viz/viewer.h"

#include <imgui.h>

#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

using namespace avbd_viz;

namespace {

struct MeshData {
  std::vector<float> v;
  std::vector<uint32_t> f;
  void append(const MeshData& o) {
    uint32_t base = uint32_t(v.size() / 3);
    v.insert(v.end(), o.v.begin(), o.v.end());
    for (uint32_t i : o.f) f.push_back(i + base);
  }
  void translate(float x, float y, float z) {
    for (size_t i = 0; i < v.size(); i += 3) v[i] += x, v[i + 1] += y, v[i + 2] += z;
  }
};

MeshData box(float sx, float sy, float sz) {
  float x = sx / 2, y = sy / 2, z = sz / 2;
  return {{-x, -y, -z, x, -y, -z, x, y, -z, -x, y, -z, -x, -y, z, x, -y, z, x, y, z, -x, y, z},
          {0, 3, 2, 0, 2, 1, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 1, 2, 6, 1, 6, 5, 3, 0, 4, 3, 4, 7}};
}

MeshData cylinder(float r, float h, int n) {
  MeshData m;
  m.v = {0, 0, h / 2, 0, 0, -h / 2};
  for (int s = 0; s < 2; ++s)
    for (int i = 0; i < n; ++i) {
      float a = 2 * 3.14159265f * i / n;
      m.v.insert(m.v.end(), {r * std::cos(a), r * std::sin(a), s == 0 ? h / 2 : -h / 2});
    }
  for (uint32_t i = 0; i < uint32_t(n); ++i) {
    uint32_t j = (i + 1) % n, t = 2, b = 2 + n;
    m.f.insert(m.f.end(), {0, t + i, t + j, 1, b + j, b + i, t + i, b + i, b + j, t + i, b + j, t + j});
  }
  return m;
}

MeshData icosphere(float r, int subdiv) {
  const float p = (1 + std::sqrt(5.0f)) / 2;
  MeshData m;
  m.v = {-1, p, 0, 1, p, 0, -1, -p, 0, 1, -p, 0, 0, -1, p, 0, 1, p,
         0, -1, -p, 0, 1, -p, p, 0, -1, p, 0, 1, -p, 0, -1, -p, 0, 1};
  m.f = {0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
         3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1};
  for (int s = 0; s < subdiv; ++s) {
    std::vector<uint32_t> nf;
    std::vector<std::pair<uint64_t, uint32_t>> cache;
    auto mid = [&](uint32_t a, uint32_t b) {
      uint64_t k = (uint64_t(std::min(a, b)) << 32) | std::max(a, b);
      for (auto& [key, idx] : cache)
        if (key == k) return idx;
      uint32_t idx = uint32_t(m.v.size() / 3);
      for (int c = 0; c < 3; ++c) m.v.push_back(0.5f * (m.v[3 * a + c] + m.v[3 * b + c]));
      cache.push_back({k, idx});
      return idx;
    };
    for (size_t i = 0; i < m.f.size(); i += 3) {
      uint32_t a = m.f[i], b = m.f[i + 1], c = m.f[i + 2];
      uint32_t ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      nf.insert(nf.end(), {a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca});
    }
    m.f = nf;
  }
  for (size_t i = 0; i < m.v.size(); i += 3) {
    float l = std::sqrt(m.v[i] * m.v[i] + m.v[i + 1] * m.v[i + 1] + m.v[i + 2] * m.v[i + 2]);
    for (int c = 0; c < 3; ++c) m.v[i + c] *= r / l;
  }
  return m;
}

// A draped sheet: n x n grid, animated by a travelling wave.
struct Cloth {
  int n = 60;
  float size = 4.0f;
  std::vector<float> pos, prev;
  std::vector<uint32_t> tris;
  Cloth() {
    for (int j = 0; j < n; ++j)
      for (int i = 0; i < n; ++i) {
        uint32_t a = j * n + i;
        if (i + 1 < n && j + 1 < n) tris.insert(tris.end(), {a, a + 1, a + n + 1, a, a + n + 1, a + n});
      }
    update(0.0f);
    prev = pos;
  }
  void update(float t) {
    prev = pos;
    pos.resize(3 * n * n);
    for (int j = 0; j < n; ++j)
      for (int i = 0; i < n; ++i) {
        float u = float(i) / (n - 1) - 0.5f, v = float(j) / (n - 1) - 0.5f;
        float r = std::sqrt(u * u + v * v);
        float z = 1.3f + 0.35f * std::cos(9.0f * r - 2.0f * t) * std::exp(-2.0f * r) - 0.6f * (u * u + v * v);
        float* p = &pos[3 * (j * n + i)];
        p[0] = u * size - 3.2f;
        p[1] = v * size;
        p[2] = z;
      }
  }
};

}  // namespace

int main(int argc, char** argv) {
  ViewerOptions opt;
  opt.title = "avbd-viz showcase";
  std::string out;
  int style = -1, frames = 3;
  bool light = false, wire = false, measure = false;
  std::string view;
  bool wire_shading = false;
  bool selftest = false, no_ui = false, no_grid = false, no_ground_shadow = false, no_ssao = false, no_shadows = false;
  for (int i = 1; i < argc; ++i) {
    std::string a = argv[i];
    if (a == "--headless") opt.headless = true;
    else if (a == "--out" && i + 1 < argc) out = argv[++i];
    else if (a == "--style" && i + 1 < argc) style = std::atoi(argv[++i]);
    else if (a == "--frames" && i + 1 < argc) frames = std::atoi(argv[++i]);
    else if (a == "--theme" && i + 1 < argc) light = std::strcmp(argv[++i], "light") == 0;
    else if (a == "--wireframe") wire = true;
    else if (a == "--measure") measure = true;
    else if (a == "--no-grid") no_grid = true;
    else if (a == "--selftest") selftest = opt.headless = true;
    else if (a == "--no-ui") no_ui = true;
    else if (a == "--wire") wire_shading = true;
    else if (a == "--view" && i + 1 < argc) view = argv[++i];
    else if (a == "--no-ground-shadow") no_ground_shadow = true;
    else if (a == "--no-ssao") no_ssao = true;
    else if (a == "--no-shadows") no_shadows = true;
    else if (a == "--size" && i + 2 < argc) opt.width = std::atoi(argv[++i]), opt.height = std::atoi(argv[++i]);
  }

  Viewer viewer(opt);
  if (!viewer.ok()) return 1;
  if (style >= 0) viewer.settings().apply_style_defaults(Style(style));
  if (light) viewer.settings().theme = Theme::Light;
  viewer.settings().wireframe = wire;
  if (wire_shading) viewer.settings().shading = Shading::Wireframe;
  if (no_grid) viewer.settings().grid = false;
  viewer.set_ui_visible(!no_ui);
  if (no_ground_shadow) viewer.settings().ground_shadow = false;
  if (no_ssao) viewer.settings().ssao = false;
  if (no_shadows) viewer.settings().shadows = false;

  // Rigid shapes as segments ("bodies") of one mesh.
  MeshData shapes;
  std::vector<uint32_t> offsets = {0};
  std::vector<std::string> names;
  auto add = [&](MeshData m, float x, float y, float z, const char* name) {
    m.translate(x, y, z);
    shapes.append(m);
    offsets.push_back(uint32_t(shapes.f.size() / 3));
    names.push_back(name);
  };
  add(box(1.0f, 1.0f, 1.0f), 1.2f, -0.6f, 0.5f, "box");
  add(cylinder(0.5f, 1.2f, 24), 2.6f, 0.4f, 0.6f, "cylinder");
  add(icosphere(0.55f, 2), 1.6f, 1.2f, 0.55f, "sphere");
  add(box(0.6f, 0.6f, 0.6f), 1.4f, -0.5f, 1.3f, "small box");
  add(icosphere(0.4f, 0), 3.1f, -1.0f, 0.4f, "icosahedron");
  SurfaceMesh& bodies = viewer.scene().add_mesh("bodies");
  bodies.set_geometry(shapes.v.data(), shapes.v.size() / 3, shapes.f.data(), shapes.f.size() / 3);
  bodies.set_segments(offsets, names);
  bodies.color_source = ColorSource::SegmentPalette;
  bodies.add_scalar("mass", ElementKind::Segment, {1.0f, 0.94f, 0.7f, 0.216f, 0.27f});

  Cloth cloth;
  SurfaceMesh& sheet = viewer.scene().add_mesh("cloth");
  sheet.set_geometry(cloth.pos.data(), cloth.pos.size() / 3, cloth.tris.data(), cloth.tris.size() / 3);
  sheet.color_source = ColorSource::Quantity;
  sheet.color_quantity = "height";
  sheet.isolines = true;
  sheet.isoline_spacing = 0.05f;

  PointCloud& pins = viewer.scene().add_points("pins");
  VectorSet& arrows = viewer.scene().add_vectors("velocity arrows");
  arrows.color = {0.2f, 0.45f, 0.95f};
  arrows.radius = 0.012f;
  arrows.length_scale = 1.0f;

  float t = 0.0f;
  bool animate = true;
  auto update = [&]() {
    cloth.update(t);
    sheet.set_positions(cloth.pos.data());
    size_t nv = cloth.pos.size() / 3;
    std::vector<float> height(nv), speed(nv), vel(3 * nv);
    for (size_t i = 0; i < nv; ++i) {
      height[i] = cloth.pos[3 * i + 2];
      for (int c = 0; c < 3; ++c) vel[3 * i + c] = (cloth.pos[3 * i + c] - cloth.prev[3 * i + c]) * 60.0f;
      speed[i] = std::sqrt(vel[3 * i] * vel[3 * i] + vel[3 * i + 1] * vel[3 * i + 1] + vel[3 * i + 2] * vel[3 * i + 2]);
    }
    sheet.add_scalar("height", ElementKind::Vertex, height);
    sheet.add_scalar("speed", ElementKind::Vertex, speed);
    sheet.add_vector("velocity", ElementKind::Vertex, vel);
    // Pins at the four corners, arrows on a coarse subset of the sheet.
    int n = cloth.n;
    std::vector<float> corners;
    for (int k : {0, n - 1, n * (n - 1), n * n - 1})
      corners.insert(corners.end(), cloth.pos.begin() + 3 * k, cloth.pos.begin() + 3 * k + 3);
    pins.set_points(corners.data(), 4);
    pins.radius = 0.06f;
    std::vector<float> o, v;
    for (int j = 5; j < n; j += 11)
      for (int i = 5; i < n; i += 11) {
        size_t k = size_t(j) * n + i;
        o.insert(o.end(), cloth.pos.begin() + 3 * k, cloth.pos.begin() + 3 * k + 3);
        v.insert(v.end(), vel.begin() + 3 * k, vel.begin() + 3 * k + 3);
      }
    arrows.set_vectors(o.data(), v.data(), o.size() / 3);
  };
  t = 0.7f - 1.0f / 60.0f;
  cloth.update(t);
  t = 0.7f;
  update();

  viewer.camera().target = {0.0f, 0.2f, 0.8f};
  viewer.camera().distance = 11.0f;
  viewer.camera().yaw = -1.25f;
  viewer.camera().pitch = 0.42f;
  const char* views[] = {"front", "back", "right", "left", "top", "bottom"};
  for (int k = 0; k < 6; ++k)
    if (view == views[k]) {
      viewer.camera().set_view(ViewPreset(k));
      viewer.camera().update(1.0f);  // finish the transition
    }

  if (measure) {
    Measurement m;
    m.anchors = {{Anchor::Vertex, bodies.id(), 0, {}, {}}, {Anchor::Vertex, bodies.id(), 6, {}, {}}};
    viewer.measurements().push_back(m);
    viewer.selection().set_mode(PickMode::Segment);
    viewer.selection().set({bodies.id(), 2});
  }

  viewer.set_callback([&]() {
    if (!no_ui) {
      ImGui::SetNextWindowPos(ImVec2(12, 80), ImGuiCond_FirstUseEver);
      ImGui::Begin("Showcase");
      ImGui::Checkbox("Animate", &animate);
      ImGui::TextDisabled("t = %.2f s", t);
      ImGui::End();
    }
    if (animate && !opt.headless) {
      t += viewer.frame_seconds();
      update();
    }
    TextLabel label;
    label.text = "cloth: " + std::to_string(cloth.n * cloth.n) + " vertices";
    label.anchor = {-3.2f, -2.1f, 1.3f};
    label.size_px = 14.0f;
    label.align = {0.5f, 1.0f};
    viewer.overlay().text(label);
  });

  if (selftest) {
    // Drive picking, box select and measuring through injected input events.
    viewer.set_ui_visible(false);
    ImGuiIO& io = ImGui::GetIO();
    glm::vec2 vp = viewer.viewport();
    auto px = [&](glm::vec3 p) { glm::vec3 s = viewer.camera().project(p, vp.x, vp.y); return glm::vec2(s.x, s.y); };
    auto click = [&](glm::vec2 p, bool shift = false) {
      io.AddKeyEvent(ImGuiMod_Shift, shift);
      io.AddMousePosEvent(p.x, p.y);
      viewer.frame();
      io.AddMouseButtonEvent(0, true);
      viewer.frame();
      io.AddMouseButtonEvent(0, false);
      viewer.frame();
      io.AddKeyEvent(ImGuiMod_Shift, false);
    };
    auto key = [&](ImGuiKey k) {
      io.AddKeyEvent(k, true);
      viewer.frame();
      io.AddKeyEvent(k, false);
      viewer.frame();
    };
    for (int i = 0; i < 3; ++i) viewer.frame();
    glm::vec2 box_px = px({1.2f, -1.1f, 0.5f});  // front face of the big box
    Hit h = viewer.pick(box_px.x, box_px.y);
    std::printf("pick: valid=%d object=%u face=%u point=(%.3f %.3f %.3f)\n", h.valid, h.surface.object,
                h.surface.index, h.point.x, h.point.y, h.point.z);
    key(ImGuiKey_4);
    click(box_px);
    auto& items = viewer.selection().items();
    std::printf("body click: %zu selected, first=%u (expect body 0)\n", items.size(), items.empty() ? 99u : items[0].index);
    click(px({2.6f, 0.4f, 1.2f}), true);
    std::printf("shift-click cylinder: %zu selected\n", items.size());
    key(ImGuiKey_1);
    glm::vec2 a = px({0.5f, -1.2f, 1.2f}), b = px({1.9f, -1.2f, -0.1f});
    io.AddMousePosEvent(a.x, a.y);
    viewer.frame();
    io.AddMouseButtonEvent(0, true);
    viewer.frame();
    io.AddMousePosEvent(b.x, b.y);
    viewer.frame();
    io.AddMouseButtonEvent(0, false);
    viewer.frame();
    std::printf("box select vertices: %zu selected (visible front corners)\n", items.size());
    key(ImGuiKey_M);
    click(px({0.7f, -1.1f, 0.0f}));
    click(px({1.7f, -1.1f, 0.0f}));
    if (!viewer.measurements().empty()) {
      const Measurement& m = viewer.measurements().back();
      glm::vec3 p0 = resolve_anchor(viewer.scene(), m.anchors[0]), p1 = resolve_anchor(viewer.scene(), m.anchors[1]);
      std::printf("measurement: kinds=%d,%d length=%.4f (expect 1.0 with vertex snap)\n", m.anchors[0].kind,
                  m.anchors[1].kind, glm::length(p1 - p0));
    } else {
      std::printf("measurement: none recorded\n");
    }
    // Hide / unhide: the app hides the icosahedron (body 4); the user hides the
    // big box with H; Alt+H must bring back only the box.
    key(ImGuiKey_Escape);
    bodies.set_segment_visible(4, false);
    key(ImGuiKey_4);
    click(box_px);
    key(ImGuiKey_H);
    std::printf("H: box hidden by user=%d, selection cleared=%d\n", bodies.segment_hidden_by_user(0),
                viewer.selection().empty());
    click(box_px);
    std::printf("click where the hidden box was: picked body %s\n",
                items.empty() ? "none" : std::to_string(items[0].index).c_str());
    io.AddKeyEvent(ImGuiMod_Alt, true);
    key(ImGuiKey_H);
    io.AddKeyEvent(ImGuiMod_Alt, false);
    std::printf("Alt+H: box visible=%d, icosahedron still hidden by app=%d\n", bodies.segment_visible(0),
                bodies.segment_hidden_by_app(4));
    bodies.set_segment_visible(4, true);

    // Wireframe shading selects through: a box over the big box also catches
    // the small box stacked on it and anything behind.
    viewer.settings().shading = Shading::Wireframe;
    viewer.selection().clear();
    glm::vec2 c = px({1.4f, -0.5f, 0.9f});
    io.AddMousePosEvent(c.x - 60, c.y - 60);
    viewer.frame();
    io.AddMouseButtonEvent(0, true);
    viewer.frame();
    io.AddMousePosEvent(c.x + 60, c.y + 60);
    viewer.frame();
    io.AddMouseButtonEvent(0, false);
    viewer.frame();
    std::printf("wireframe box select (bodies):");
    for (const ElementRef& e : items) std::printf(" %s", bodies.segment_name(e.index).c_str());
    std::printf("\n");

    viewer.set_ui_visible(true);
    viewer.frame();
    if (!out.empty()) viewer.screenshot(out);
    return 0;
  }
  if (opt.headless) {
    for (int i = 0; i < frames; ++i) viewer.frame();
    if (!out.empty() && !viewer.screenshot(out)) return 1;
    return 0;
  }
  viewer.run();
  return 0;
}
