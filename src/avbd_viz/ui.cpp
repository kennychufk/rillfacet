#include "avbd_viz/ui.h"

#include <imgui.h>

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdio>
#include <limits>
#include <set>

namespace avbd_viz::ui {

static ImVec4 rgb(int hex, float a = 1.0f) {
  return ImVec4(((hex >> 16) & 255) / 255.0f, ((hex >> 8) & 255) / 255.0f, (hex & 255) / 255.0f, a);
}

void apply_theme(Theme theme) {
  ImGuiStyle& st = ImGui::GetStyle();
  if (theme == Theme::Dark)
    ImGui::StyleColorsDark();
  else
    ImGui::StyleColorsLight();
  st.WindowRounding = 6.0f;
  st.ChildRounding = 4.0f;
  st.FrameRounding = 4.0f;
  st.PopupRounding = 4.0f;
  st.GrabRounding = 4.0f;
  st.TabRounding = 4.0f;
  st.ScrollbarRounding = 6.0f;
  st.WindowPadding = ImVec2(10, 10);
  st.FramePadding = ImVec2(8, 4);
  st.ItemSpacing = ImVec2(8, 6);
  st.ItemInnerSpacing = ImVec2(6, 4);
  st.WindowBorderSize = 1.0f;
  st.FrameBorderSize = 0.0f;
  st.ScrollbarSize = 12.0f;
  st.GrabMinSize = 10.0f;
  st.SeparatorTextBorderSize = 1.0f;

  ImVec4* c = st.Colors;
  const ImVec4 accent = rgb(0x4772b3);
  if (theme == Theme::Dark) {
    c[ImGuiCol_Text] = rgb(0xe6e6e6);
    c[ImGuiCol_TextDisabled] = rgb(0x8c8c8c);
    c[ImGuiCol_WindowBg] = rgb(0x2b2b2b, 0.96f);
    c[ImGuiCol_PopupBg] = rgb(0x232323, 0.98f);
    c[ImGuiCol_Border] = rgb(0x3d3d3d);
    c[ImGuiCol_FrameBg] = rgb(0x1d1d1d);
    c[ImGuiCol_FrameBgHovered] = rgb(0x252525);
    c[ImGuiCol_FrameBgActive] = rgb(0x2e2e2e);
    c[ImGuiCol_TitleBg] = rgb(0x232323);
    c[ImGuiCol_TitleBgActive] = rgb(0x262626);
    c[ImGuiCol_TitleBgCollapsed] = rgb(0x232323);
    c[ImGuiCol_Button] = rgb(0x4a4a4a);
    c[ImGuiCol_ButtonHovered] = rgb(0x5a5a5a);
    c[ImGuiCol_ButtonActive] = accent;
    c[ImGuiCol_Header] = rgb(0x3a3a3a);
    c[ImGuiCol_HeaderHovered] = rgb(0x474747);
    c[ImGuiCol_HeaderActive] = accent;
    c[ImGuiCol_CheckMark] = rgb(0xffffff);
    c[ImGuiCol_SliderGrab] = accent;
    c[ImGuiCol_SliderGrabActive] = rgb(0x5a86c9);
    c[ImGuiCol_Separator] = rgb(0x3d3d3d);
    c[ImGuiCol_Tab] = rgb(0x2b2b2b);
    c[ImGuiCol_TabHovered] = rgb(0x474747);
    c[ImGuiCol_TabSelected] = rgb(0x3a3a3a);
    c[ImGuiCol_DockingPreview] = ImVec4(accent.x, accent.y, accent.z, 0.6f);
    c[ImGuiCol_TableRowBgAlt] = rgb(0xffffff, 0.03f);
  } else {
    c[ImGuiCol_Text] = rgb(0x1e1e1e);
    c[ImGuiCol_WindowBg] = rgb(0xf3f3f5, 0.97f);
    c[ImGuiCol_PopupBg] = rgb(0xfafafa, 0.98f);
    c[ImGuiCol_Border] = rgb(0xc9ccd1);
    c[ImGuiCol_FrameBg] = rgb(0xe2e4e8);
    c[ImGuiCol_FrameBgHovered] = rgb(0xd6d9de);
    c[ImGuiCol_FrameBgActive] = rgb(0xcbd0d6);
    c[ImGuiCol_TitleBg] = rgb(0xe6e7ea);
    c[ImGuiCol_TitleBgActive] = rgb(0xdcdee2);
    c[ImGuiCol_Button] = rgb(0xd6d9de);
    c[ImGuiCol_ButtonHovered] = rgb(0xc8ccd3);
    c[ImGuiCol_ButtonActive] = accent;
    c[ImGuiCol_Header] = rgb(0xd9dce1);
    c[ImGuiCol_HeaderHovered] = rgb(0xcdd1d7);
    c[ImGuiCol_HeaderActive] = accent;
    c[ImGuiCol_CheckMark] = accent;
    c[ImGuiCol_SliderGrab] = accent;
    c[ImGuiCol_SliderGrabActive] = rgb(0x3a5f99);
    c[ImGuiCol_TableRowBgAlt] = rgb(0x000000, 0.03f);
  }
}

// ---- Formatting ---------------------------------------------------------------

double nice_step(double x) {
  if (!(x > 0)) return 1.0;
  double p = std::pow(10.0, std::floor(std::log10(x)));
  for (double m : {1.0, 2.0, 5.0, 10.0})
    if (m * p >= x) return m * p;
  return 10 * p;
}

std::string format_length(double v, double step) {
  char buf[64];
  double a = std::abs(step);
  if (std::abs(v) < 1e-12) return "0";
  if (a >= 0.1) {
    int dec = a >= 1.0 ? 0 : 1;  // "1.5 m", "20 m"
    std::snprintf(buf, sizeof buf, "%.*f", dec, v);
    std::string t = buf;
    if (t.find('.') != std::string::npos) {
      t.erase(t.find_last_not_of('0') + 1);
      if (t.back() == '.') t.pop_back();
    }
    return t + " m";
  } else if (a >= 0.01) {
    std::snprintf(buf, sizeof buf, "%.0f cm", v * 100.0);
  } else if (a >= 0.001) {
    std::snprintf(buf, sizeof buf, "%.0f mm", v * 1000.0);
  } else {
    std::snprintf(buf, sizeof buf, "%.0f \xc2\xb5m", v * 1e6);
  }
  return buf;
}

static std::string fmt(const char* f, double v) {
  char buf[64];
  std::snprintf(buf, sizeof buf, f, v);
  return buf;
}

static std::string fmt3(const glm::vec3& v) {
  char buf[96];
  std::snprintf(buf, sizeof buf, "%.4g, %.4g, %.4g", v.x, v.y, v.z);
  return buf;
}

// ---- Display panel ------------------------------------------------------------

// Row of mutually exclusive buttons; returns the chosen index.
static int button_row(const char* const* labels, int n, int current, float width) {
  int chosen = current;
  for (int i = 0; i < n; ++i) {
    if (i) ImGui::SameLine(0, 4);
    bool on = i == current;
    if (on) ImGui::PushStyleColor(ImGuiCol_Button, ImGui::GetStyleColorVec4(ImGuiCol_ButtonActive));
    if (ImGui::Button(labels[i], ImVec2(width, 0))) chosen = i;
    if (on) ImGui::PopStyleColor();
  }
  return chosen;
}

// Collapsible list of a mesh's segments ("bodies") with visibility
// checkboxes; clicking a name selects the body.
static void body_list(SurfaceMesh& m, Selection& sel) {
  if (!ImGui::TreeNode("Bodies")) return;
  static char filter[64] = "";
  ImGui::SetNextItemWidth(-1);
  ImGui::InputTextWithHint("##filter", "filter by name", filter, sizeof filter);
  size_t hidden = 0;
  std::vector<uint32_t> rows;
  for (uint32_t k = 0; k < m.num_segments(); ++k) {
    hidden += m.segment_hidden_by_user(k);
    if (!filter[0] || m.segment_name(k).find(filter) != std::string::npos) rows.push_back(k);
  }
  if (hidden) {
    ImGui::Text("%zu hidden", hidden);
    ImGui::SameLine();
    if (ImGui::SmallButton("Show all (Alt+H)")) m.unhide_all_by_user();
  }
  float row_h = ImGui::GetFrameHeightWithSpacing();
  ImGui::BeginChild("##bodies", ImVec2(0, std::min(rows.size(), size_t(9)) * row_h + 4), ImGuiChildFlags_Borders);
  ImGuiListClipper clipper;
  clipper.Begin(int(rows.size()));
  while (clipper.Step())
    for (int i = clipper.DisplayStart; i < clipper.DisplayEnd; ++i) {
      uint32_t k = rows[i];
      ImGui::PushID(int(k));
      bool by_app = m.segment_hidden_by_app(k), shown = !m.segment_hidden_by_user(k);
      ImGui::BeginDisabled(by_app);
      if (ImGui::Checkbox("##shown", &shown)) m.set_segment_hidden_by_user(k, !shown);
      ImGui::EndDisabled();
      ImGui::SameLine();
      ElementRef ref{m.id(), k};
      bool selected = sel.mode() == PickMode::Segment && sel.contains(ref);
      std::string label = m.segment_name(k) + (by_app ? "  (hidden by app)" : "");
      if (ImGui::Selectable(label.c_str(), selected)) {
        sel.set_mode(PickMode::Segment);
        if (ImGui::GetIO().KeyShift)
          sel.toggle(ref);
        else
          sel.set(ref);
      }
      ImGui::PopID();
    }
  ImGui::EndChild();
  ImGui::TreePop();
}

// Slice plane controls: axis, position within the scene bounds, side.
static void slice_section(const Scene& scene, RenderSettings& s) {
  ImGui::SeparatorText("Slice plane");
  ImGui::Checkbox("Cut the scene", &s.slice.enabled);
  if (!s.slice.enabled) return;
  ImGui::SameLine();
  ImGui::RadioButton("X", &s.slice.axis, 0);
  ImGui::SameLine();
  ImGui::RadioButton("Y", &s.slice.axis, 1);
  ImGui::SameLine();
  ImGui::RadioButton("Z", &s.slice.axis, 2);
  glm::vec3 lo(-1.0f), hi(1.0f);
  scene.bounds(lo, hi);
  float a = lo[s.slice.axis], b = hi[s.slice.axis];
  if (b - a < 1e-6f) a -= 0.5f, b += 0.5f;
  ImGui::SliderFloat("Position", &s.slice.offset, a, b, "%.4g m");
  ImGui::Checkbox("Flip side", &s.slice.flip);
  ImGui::SameLine();
  ImGui::Checkbox("Outline", &s.slice.show);
}

// Coloring, quantities and per-kind options of one structure.
static void appearance(QuantityStructure& q, RenderSettings& s, Selection& selection) {
  bool changed = false;
  auto* mesh = dynamic_cast<SurfaceMesh*>(&q);
  int src = mesh ? int(q.color_source) : (q.color_source == ColorSource::Quantity ? 1 : 0);
  if (ImGui::Combo("Color by", &src, mesh ? "Uniform\0Per body\0Quantity\0" : "Uniform\0Quantity\0")) {
    q.color_source = mesh ? ColorSource(src) : (src ? ColorSource::Quantity : ColorSource::Uniform);
    if (q.color_source == ColorSource::Quantity && q.color_quantity.empty() && !q.quantities().empty())
      q.color_quantity = q.quantities()[0].name;
    changed = true;
  }
  if (q.color_source == ColorSource::Uniform) changed |= ImGui::ColorEdit3("Color", &q.color.x);
  if (q.color_source == ColorSource::Quantity) {
    if (ImGui::BeginCombo("Quantity", q.color_quantity.empty() ? "(none)" : q.color_quantity.c_str())) {
      for (const Quantity& qu : q.quantities()) {
        const char* type = qu.type == QuantityType::Color ? ", color" : qu.type == QuantityType::Vector ? ", |v|" : "";
        std::string label = qu.name + "  (" + element_name(qu.on) + type + ")";
        if (ImGui::Selectable(label.c_str(), qu.name == q.color_quantity)) {
          q.color_quantity = qu.name;
          changed = true;
        }
      }
      ImGui::EndCombo();
    }
    const Quantity* cq = q.coloring_quantity();
    if (cq && cq->type != QuantityType::Color) {
      if (ImGui::BeginCombo("Colormap", colormap_name(q.colormap))) {
        for (int i = 0; i < colormap_count(); ++i)
          if (ImGui::Selectable(colormap_name(i), i == q.colormap)) q.colormap = i;
        ImGui::EndCombo();
      }
      changed |= ImGui::Checkbox("Auto range", &q.auto_range);
      if (!q.auto_range) changed |= ImGui::DragFloat2("Range", &q.range.x, 0.01f);
      bool iso_ok = cq->on == ElementKind::Vertex &&
                    (q.kind() == StructureKind::SurfaceMesh || q.kind() == StructureKind::VolumeMesh);
      if (iso_ok) {
        changed |= ImGui::Checkbox("Isolines", &q.isolines);
        if (q.isolines) changed |= ImGui::DragFloat("Spacing", &q.isoline_spacing, 0.001f, 1e-6f, 1e6f, "%.4g");
      }
    }
  }
  if (auto* p = dynamic_cast<PointCloud*>(&q))
    ImGui::SliderFloat("Radius", &p->radius, 0.001f, 1.0f, "%.3f", ImGuiSliderFlags_Logarithmic);
  if (auto* c = dynamic_cast<CurveNetwork*>(&q))
    ImGui::SliderFloat("Radius", &c->radius, 0.0005f, 0.5f, "%.4f", ImGuiSliderFlags_Logarithmic);
  if (mesh) ImGui::Checkbox("Smooth shading", &mesh->smooth_shading);
  if (mesh || q.kind() == StructureKind::VolumeMesh) ImGui::SliderFloat("Opacity", &q.opacity, 0.05f, 1.0f);
  if (s.slice.enabled) ImGui::Checkbox("Cut by the slice plane", &q.sliced);
  if (s.style == Style::EnvironmentPBR) {
    changed |= ImGui::SliderFloat("Metallic", &q.metallic, 0.0f, 1.0f);
    changed |= ImGui::SliderFloat("Roughness", &q.roughness, 0.02f, 1.0f);
  }
  // Vector quantities as arrows.
  for (Quantity& qu : q.quantities()) {
    if (qu.type != QuantityType::Vector) continue;
    ImGui::PushID(qu.name.c_str());
    ImGui::Checkbox(("Arrows: " + qu.name).c_str(), &qu.show_arrows);
    if (qu.show_arrows) {
      ImGui::SliderFloat("Scale", &qu.arrow_scale, 1e-4f, 1e4f, "%.4g", ImGuiSliderFlags_Logarithmic);
      ImGui::ColorEdit3("Arrow color", &qu.arrow_color.x);
    }
    ImGui::PopID();
  }
  std::string counts;
  for (ElementKind e : {ElementKind::Vertex, ElementKind::Edge, ElementKind::Face, ElementKind::Cell})
    if (size_t n = (e == ElementKind::Edge && mesh) ? 0 : q.count(e))
      counts += (counts.empty() ? "" : ", ") + std::to_string(n) + " " + element_name(e) + (n == 1 ? "" : "s");
  if (mesh) counts += ", " + std::to_string(mesh->num_segments()) + " bodies";
  ImGui::TextDisabled("%s", counts.c_str());
  if (changed) q.touch_attributes();
  if (mesh && mesh->num_segments() > 1) body_list(*mesh, selection);
}

void display_panel(Scene& scene, RenderSettings& s, Selection& selection) {
  const ImGuiViewport* vp = ImGui::GetMainViewport();
  ImGui::SetNextWindowPos(ImVec2(vp->WorkPos.x + vp->WorkSize.x - 350, vp->WorkPos.y + 150),
                          ImGuiCond_FirstUseEver);
  ImGui::SetNextWindowSize(ImVec2(340, 470), ImGuiCond_FirstUseEver);
  if (!ImGui::Begin("Display")) {
    ImGui::End();
    return;
  }
  const char* shading_labels[] = {"Solid", "Wireframe"};
  float half = (ImGui::GetContentRegionAvail().x - 4) * 0.5f;
  s.shading = Shading(button_row(shading_labels, 2, int(s.shading), half));
  ImGui::PushItemWidth(-110);
  if (s.shading == Shading::Solid) {
    int style = int(s.style);
    if (ImGui::Combo("Style", &style, "Studio\0MatCap\0Environment PBR\0Technical\0"))
      s.apply_style_defaults(Style(style));
    switch (s.style) {
      case Style::Studio:
        ImGui::SliderFloat("Specular", &s.studio_specular, 0.0f, 1.0f);
        ImGui::SliderFloat("Softness", &s.studio_wrap, 0.0f, 1.0f);
        ImGui::SliderFloat("Ambient", &s.studio_ambient, 0.0f, 1.0f);
        break;
      case Style::MatCap: {
        int m = int(s.matcap);
        if (ImGui::Combo("Matcap", &m, "Clay\0Porcelain\0Chrome\0Toon\0")) {
          s.matcap = MatcapPreset(m);
          s.matcap_tint = matcap_default_tint(s.matcap);
        }
        ImGui::SliderFloat("Object color", &s.matcap_tint, 0.0f, 1.0f);
        break;
      }
      case Style::EnvironmentPBR: {
        int e = int(s.environment);
        if (ImGui::Combo("Environment", &e, "Studio softboxes\0Clear sky\0Soft white room\0")) {
          s.environment = EnvironmentPreset(e);
          s.environment_file.clear();
        }
        static char path[512] = "";
        ImGui::InputTextWithHint("##hdr", ".hdr file (optional)", path, sizeof path);
        ImGui::SameLine();
        if (ImGui::Button("Load")) s.environment_file = path;
        ImGui::SliderFloat("Intensity", &s.env_intensity, 0.0f, 3.0f);
        ImGui::SliderFloat("Rotation", &s.env_rotation, -180.0f, 180.0f, "%.0f deg");
        break;
      }
      case Style::Technical:
        ImGui::SliderFloat("Cool/warm", &s.gooch_shift, 0.0f, 2.0f);
        ImGui::SliderFloat("Contrast", &s.gooch_contrast, 0.0f, 1.0f);
        break;
      default: break;
    }
  } else {
    int colors = s.wire_object_colors ? 1 : 0;
    ImGui::TextUnformatted("Wire color");
    ImGui::SameLine(ImGui::GetContentRegionAvail().x - 150);
    ImGui::RadioButton("Theme", &colors, 0);
    ImGui::SameLine();
    ImGui::RadioButton("Object", &colors, 1);
    s.wire_object_colors = colors == 1;
    ImGui::SliderFloat("Face opacity", &s.face_opacity, 0.0f, 1.0f);
    ImGui::SliderFloat("Wire width", &s.wire_width, 0.5f, 3.0f, "%.1f px");
    ImGui::SliderFloat("Hide flat edges", &s.flat_edge_angle, 0.0f, 30.0f, s.flat_edge_angle > 0 ? "< %.1f deg" : "off");
  }
  int theme = int(s.theme);
  ImGui::TextUnformatted("Theme");
  ImGui::SameLine(ImGui::GetContentRegionAvail().x - 150);
  ImGui::RadioButton("Dark", &theme, 0);
  ImGui::SameLine();
  ImGui::RadioButton("Light", &theme, 1);
  s.theme = Theme(theme);

  if (s.shading == Shading::Solid) {
    ImGui::SeparatorText("Shading");
    ImGui::Checkbox("Wireframe overlay (Z)", &s.wireframe);
    if (s.wireframe) {
      ImGui::SliderFloat("Wire width", &s.wire_width, 0.5f, 3.0f, "%.1f px");
      ImGui::SliderFloat("Hide flat edges", &s.flat_edge_angle, 0.0f, 30.0f, s.flat_edge_angle > 0 ? "< %.1f deg" : "off");
    }
    ImGui::Checkbox("Shadows", &s.shadows);
    if (s.shadows) {
      ImGui::SameLine();
      ImGui::SetNextItemWidth(-1);
      ImGui::SliderFloat("##shadow", &s.shadow_strength, 0.0f, 1.0f);
    }
    ImGui::Checkbox("Ambient occlusion", &s.ssao);
    if (s.ssao) {
      ImGui::SliderFloat("AO strength", &s.ao_strength, 0.0f, 1.0f);
      ImGui::SliderFloat("AO radius", &s.ao_radius, 0.02f, 2.0f, "%.2f m", ImGuiSliderFlags_Logarithmic);
    }
    int outline = int(s.outline);
    if (ImGui::Combo("Outlines", &outline, "Off\0Silhouettes\0Silhouettes + creases\0"))
      s.outline = OutlineMode(outline);
    if (s.outline != OutlineMode::Off) ImGui::SliderFloat("Outline width", &s.outline_width, 1.0f, 4.0f, "%.0f px");
    ImGui::SliderFloat("Exposure", &s.exposure, 0.2f, 3.0f);
  }

  ImGui::SeparatorText("Ground");
  ImGui::Checkbox("Grid", &s.grid);
  ImGui::SameLine();
  ImGui::Checkbox("Shadow catcher", &s.ground_shadow);
  ImGui::DragFloat("Height", &s.ground_height, 0.01f);

  slice_section(scene, s);

  ImGui::SeparatorText("Structures");
  for (const auto& sp : scene.structures()) {
    ImGui::PushID(int(sp->id()));
    ImGui::Checkbox("##vis", &sp->visible);
    ImGui::SameLine();
    bool open = ImGui::TreeNode(sp->name().c_str());
    if (ImGui::IsItemHovered()) ImGui::SetTooltip("%s", structure_kind_name(sp->kind()));
    if (open) {
      if (auto* q = dynamic_cast<QuantityStructure*>(sp.get())) {
        appearance(*q, s, selection);
      } else if (auto* v = dynamic_cast<VectorSet*>(sp.get())) {
        ImGui::ColorEdit3("Color", &v->color.x);
        ImGui::SliderFloat("Radius", &v->radius, 0.001f, 0.2f, "%.3f", ImGuiSliderFlags_Logarithmic);
        ImGui::SliderFloat("Length", &v->length_scale, 0.01f, 10.0f, "%.2f", ImGuiSliderFlags_Logarithmic);
        ImGui::TextDisabled("%zu vectors", v->size());
      }
      ImGui::TreePop();
    }
    ImGui::PopID();
  }
  ImGui::PopItemWidth();
  ImGui::End();
}

// ---- Inspector ----------------------------------------------------------------

namespace {

struct Table {
  ImFont* mono;
  std::string clipboard;
  void row(const std::string& name, const std::string& value) {
    ImGui::TableNextRow();
    ImGui::TableNextColumn();
    ImGui::TextDisabled("%s", name.c_str());
    ImGui::TableNextColumn();
    if (mono) ImGui::PushFont(mono, 0.0f);
    ImGui::TextUnformatted(value.c_str());
    if (mono) ImGui::PopFont();
    clipboard += name + "\t" + value + "\n";
  }
  void section(const std::string& title) {
    ImGui::TableNextRow();
    ImGui::TableNextColumn();
    ImGui::TextUnformatted(title.c_str());
    clipboard += "[" + title + "]\n";
  }
};

void quantity_rows(Table& t, const QuantityStructure& s, ElementKind on, uint32_t index) {
  for (const Quantity& q : s.quantities()) {
    if (q.on != on || size_t(index + 1) * q.dims > q.data.size()) continue;
    if (q.dims == 1) {
      t.row(q.name, fmt("%.6g", q.data[index]));
    } else {
      glm::vec3 v(q.data[3 * index], q.data[3 * index + 1], q.data[3 * index + 2]);
      t.row(q.name, q.type == QuantityType::Color ? "rgb " + fmt3(v) : fmt3(v) + "  |" + fmt("%.4g", glm::length(v)) + "|");
    }
  }
}

double measurement_value(const Scene& scene, const Measurement& m, glm::vec3* delta = nullptr) {
  if (m.anchors.size() < 2) return 0;
  glm::vec3 a = resolve_anchor(scene, m.anchors[0]), b = resolve_anchor(scene, m.anchors[1]);
  if (!m.angle) {
    if (delta) *delta = b - a;
    return glm::length(b - a);
  }
  if (m.anchors.size() < 3) return 0;
  glm::vec3 c = resolve_anchor(scene, m.anchors[2]);
  glm::vec3 u = glm::normalize(a - b), w = glm::normalize(c - b);
  return glm::degrees(std::acos(std::clamp(glm::dot(u, w), -1.0f, 1.0f)));
}

// Rows for one selected element of a mesh (with its owning body).
void mesh_rows(Table& table, const SurfaceMesh& m, PickMode mode, uint32_t index) {
  uint32_t seg = 0;
  switch (mode) {
    case PickMode::Vertex:
      table.row("Vertex", std::to_string(index));
      table.row("Position", fmt3(m.vertex(index)));
      quantity_rows(table, m, ElementKind::Vertex, index);
      seg = m.segment_of_vertex(index);
      break;
    case PickMode::Edge: {
      uint32_t a = m.edges()[2 * index], b = m.edges()[2 * index + 1];
      glm::vec3 d = m.vertex(b) - m.vertex(a);
      table.row("Edge", std::to_string(index));
      table.row("Vertices", std::to_string(a) + ", " + std::to_string(b));
      table.row("Length", fmt("%.6g", glm::length(d)));
      table.row("Direction", fmt3(glm::normalize(d)));
      table.row("Midpoint", fmt3(0.5f * (m.vertex(a) + m.vertex(b))));
      quantity_rows(table, m, ElementKind::Edge, index);
      seg = m.segment_of_vertex(a);
      break;
    }
    case PickMode::Face: {
      glm::uvec3 f = m.face(index);
      glm::vec3 p0 = m.vertex(f.x), p1 = m.vertex(f.y), p2 = m.vertex(f.z);
      glm::vec3 n = glm::cross(p1 - p0, p2 - p0);
      table.row("Face", std::to_string(index));
      table.row("Vertices", std::to_string(f.x) + ", " + std::to_string(f.y) + ", " + std::to_string(f.z));
      table.row("Area", fmt("%.6g", 0.5 * glm::length(n)));
      table.row("Normal", fmt3(glm::normalize(n)));
      table.row("Centroid", fmt3((p0 + p1 + p2) / 3.0f));
      quantity_rows(table, m, ElementKind::Face, index);
      seg = m.segment_of_face(index);
      break;
    }
    case PickMode::Segment: seg = index; break;
  }
  // The owning segment ("body").
  table.section(m.segment_name(seg));
  const auto& off = m.segment_offsets();
  glm::vec3 lo(std::numeric_limits<float>::max()), hi = -lo;
  std::set<uint32_t> verts;
  for (uint32_t f = off[seg]; f < off[seg + 1]; ++f)
    for (int k = 0; k < 3; ++k) {
      uint32_t v = m.triangles()[3 * f + k];
      verts.insert(v);
      lo = glm::min(lo, m.vertex(v));
      hi = glm::max(hi, m.vertex(v));
    }
  if (mode == PickMode::Segment) {
    table.row("Faces", std::to_string(off[seg + 1] - off[seg]));
    table.row("Vertices", std::to_string(verts.size()));
    table.row("Size", fmt3(hi - lo));
  }
  table.row("Bounds center", fmt3(0.5f * (lo + hi)));
  quantity_rows(table, m, ElementKind::Segment, seg);
}

// Rows for one selected element (or the whole) of a point cloud, curve
// network or volume mesh.
void element_rows(Table& table, const QuantityStructure& q, ElementKind k, uint32_t index) {
  if (k == ElementKind::Segment) {
    for (ElementKind e : {ElementKind::Vertex, ElementKind::Edge, ElementKind::Face, ElementKind::Cell})
      if (q.count(e)) table.row(std::string(element_name(e)) + "s", std::to_string(q.count(e)));
    glm::vec3 lo, hi;
    if (q.bounds(lo, hi)) {
      table.row("Size", fmt3(hi - lo));
      table.row("Bounds center", fmt3(0.5f * (lo + hi)));
    }
    return;
  }
  if (index >= q.count(k)) return;
  std::string label = q.kind() == StructureKind::CurveNetwork && k == ElementKind::Vertex ? "Node"
                      : q.kind() == StructureKind::PointCloud ? "Point" : element_name(k);
  label[0] = char(std::toupper(label[0]));
  table.row(label, std::to_string(index));
  table.row("Position", fmt3(q.element_position(k, index)));
  if (auto* c = dynamic_cast<const CurveNetwork*>(&q); c && k == ElementKind::Edge) {
    glm::uvec2 e = c->edge(index);
    table.row("Nodes", std::to_string(e.x) + ", " + std::to_string(e.y));
    table.row("Length", fmt("%.6g", glm::length(c->node(e.y) - c->node(e.x))));
  }
  if (auto* v = dynamic_cast<const VolumeMesh*>(&q); v && k == ElementKind::Cell) {
    glm::uvec4 t = v->cell(index);
    table.row("Vertices", std::to_string(t.x) + ", " + std::to_string(t.y) + ", " + std::to_string(t.z) + ", " +
                              std::to_string(t.w));
    table.row("Volume", fmt("%.6g", v->cell_volume(index)));
  }
  if (auto* p = dynamic_cast<const PointCloud*>(&q)) table.row("Radius", fmt("%.4g", p->point_radius(index)));
  quantity_rows(table, q, k, index);
}

}  // namespace

void inspector_panel(Scene& scene, Selection& sel, std::vector<Measurement>& measurements, MeasureTool& tool,
                     bool& xray, ImFont* mono) {
  const ImGuiViewport* vp = ImGui::GetMainViewport();
  ImGui::SetNextWindowPos(ImVec2(vp->WorkPos.x + vp->WorkSize.x - 350, vp->WorkPos.y + 630),
                          ImGuiCond_FirstUseEver);
  ImGui::SetNextWindowSize(ImVec2(340, 320), ImGuiCond_FirstUseEver);
  if (!ImGui::Begin("Inspect")) {
    ImGui::End();
    return;
  }
  for (int m = 0; m < 4; ++m) {
    if (m) ImGui::SameLine();
    bool active = int(sel.mode()) == m;
    if (active) ImGui::PushStyleColor(ImGuiCol_Button, ImGui::GetStyleColorVec4(ImGuiCol_ButtonActive));
    std::string label = std::string(pick_mode_name(PickMode(m))) + "##mode";
    if (ImGui::Button(label.c_str(), ImVec2(58, 0))) sel.set_mode(PickMode(m));
    if (active) ImGui::PopStyleColor();
  }
  ImGui::Checkbox("X-ray select (Alt+Z)", &xray);
  size_t hidden = count_user_hidden_segments(scene);
  if (sel.mode() == PickMode::Segment || hidden) {
    ImGui::BeginDisabled(sel.mode() != PickMode::Segment || sel.empty());
    if (ImGui::Button("Hide selected (H)")) hide_selected_segments(scene, sel);
    ImGui::EndDisabled();
    ImGui::SameLine();
    ImGui::BeginDisabled(hidden == 0);
    std::string unhide = "Unhide all (Alt+H)" + (hidden ? "  [" + std::to_string(hidden) + "]" : std::string());
    if (ImGui::Button(unhide.c_str())) unhide_all_segments(scene);
    ImGui::EndDisabled();
  }
  int t = int(tool);
  ImGui::TextUnformatted("Measure (M)");
  ImGui::SameLine();
  ImGui::RadioButton("Off", &t, 0);
  ImGui::SameLine();
  ImGui::RadioButton("Distance", &t, 1);
  ImGui::SameLine();
  ImGui::RadioButton("Angle", &t, 2);
  tool = MeasureTool(t);
  ImGui::Separator();

  Table table{mono, {}};
  const auto& items = sel.items();
  if (items.empty()) {
    ImGui::TextDisabled("Click to select, Shift+click to add,\ndrag to box-select. Keys 1-4 switch mode.");
  } else if (ImGui::BeginTable("props", 2, ImGuiTableFlags_RowBg | ImGuiTableFlags_SizingStretchProp)) {
    ImGui::TableSetupColumn("name", ImGuiTableColumnFlags_WidthFixed, 110);
    ImGui::TableSetupColumn("value", ImGuiTableColumnFlags_WidthStretch);
    if (items.size() == 1) {
      const ElementRef& e = items[0];
      const Structure* s = scene.find(e.object);
      table.row("Object", s ? s->name() : "?");
      if (auto* m = dynamic_cast<const SurfaceMesh*>(s)) {
        mesh_rows(table, *m, sel.mode(), e.index);
      } else if (auto* q = dynamic_cast<const QuantityStructure*>(s)) {
        element_rows(table, *q, picked_kind(*s, sel.mode()), e.index);
      } else if (auto* v = dynamic_cast<const VectorSet*>(s); v && e.index < v->size()) {
        glm::vec3 d(v->vectors()[3 * e.index], v->vectors()[3 * e.index + 1], v->vectors()[3 * e.index + 2]);
        table.row("Vector", std::to_string(e.index));
        table.row("Origin", fmt3(v->origin(e.index)));
        table.row("Value", fmt3(d));
        table.row("Length", fmt("%.6g", glm::length(d)));
      }
    } else {
      table.row("Selected", std::to_string(items.size()) + " " + pick_mode_name(sel.mode()));
      glm::vec3 lo(std::numeric_limits<float>::max()), hi = -lo, sum(0);
      for (const ElementRef& e : items) {
        glm::vec3 p = element_position(scene, sel.mode(), e);
        lo = glm::min(lo, p);
        hi = glm::max(hi, p);
        sum += p;
      }
      table.row("Centroid", fmt3(sum / float(items.size())));
      table.row("Extent", fmt3(hi - lo));
      // Statistics of every quantity on the selected element kind.
      if (auto* q = scene.get<QuantityStructure>(items[0].object)) {
        ElementKind kind = picked_kind(*q, sel.mode());
        for (const Quantity& qu : q->quantities()) {
          if (qu.on != kind || qu.type == QuantityType::Color) continue;
          double mn = 1e300, mx = -1e300, acc = 0;
          size_t n = 0;
          for (const ElementRef& e : items) {
            if (e.object != q->id() || size_t(e.index + 1) * qu.dims > qu.data.size()) continue;
            double v = qu.value(e.index);
            mn = std::min(mn, v);
            mx = std::max(mx, v);
            acc += v;
            ++n;
          }
          if (n) table.row(qu.name, fmt("min %.4g", mn) + fmt("  max %.4g", mx) + fmt("  mean %.4g", acc / n));
        }
      }
    }
    ImGui::EndTable();
    if (ImGui::SmallButton("Copy")) ImGui::SetClipboardText(table.clipboard.c_str());
    ImGui::SameLine();
    if (ImGui::SmallButton("Clear selection")) sel.clear();
  }

  if (!measurements.empty()) {
    ImGui::SeparatorText("Measurements");
    int remove = -1;
    for (size_t i = 0; i < measurements.size(); ++i) {
      const Measurement& m = measurements[i];
      glm::vec3 d(0);
      double v = measurement_value(scene, m, &d);
      ImGui::PushID(int(i));
      if (ImGui::SmallButton("x")) remove = int(i);
      ImGui::SameLine();
      if (mono) ImGui::PushFont(mono, 0.0f);
      if (m.angle)
        ImGui::Text("%zu  %.3f deg", i + 1, v);
      else
        ImGui::Text("%zu  %.5g m   d=(%.3g, %.3g, %.3g)", i + 1, v, d.x, d.y, d.z);
      if (mono) ImGui::PopFont();
      ImGui::PopID();
    }
    if (remove >= 0) measurements.erase(measurements.begin() + remove);
    if (ImGui::SmallButton("Clear all")) measurements.clear();
  }
  ImGui::End();
}

// ---- Navigation gizmo -----------------------------------------------------------

void nav_gizmo(Camera& cam, RenderSettings& settings, const glm::vec2& viewport) {
  const float R = 46.0f, pad = 10.0f;
  ImVec2 size(2 * (R + pad) + 20, 2 * (R + pad) + 26);
  ImGui::SetNextWindowPos(ImVec2(viewport.x - size.x - 8, 8));
  ImGui::SetNextWindowSize(size);
  ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0, 0));
  ImGui::Begin("##navgizmo", nullptr,
               ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoBackground | ImGuiWindowFlags_NoSavedSettings |
                   ImGuiWindowFlags_NoFocusOnAppearing | ImGuiWindowFlags_NoNav | ImGuiWindowFlags_NoMove |
                   ImGuiWindowFlags_NoBringToFrontOnFocus | ImGuiWindowFlags_NoDocking);
  ImVec2 origin = ImGui::GetCursorScreenPos();
  ImVec2 c(origin.x + R + pad + 10, origin.y + R + pad);
  ImGui::SetCursorScreenPos(ImVec2(origin.x + 10, origin.y));
  ImGui::InvisibleButton("gizmo", ImVec2(2 * (R + pad), 2 * (R + pad)));
  bool hovered = ImGui::IsItemHovered(), active = ImGui::IsItemActive();
  ImDrawList* dl = ImGui::GetWindowDrawList();
  if (hovered || active) dl->AddCircleFilled(c, R + pad * 0.6f, IM_COL32(255, 255, 255, 28), 48);

  struct Ball {
    glm::vec3 axis;
    ImU32 color;
    const char* label;
    ViewPreset preset;
    ImVec2 pos;
    float depth;
  };
  Ball balls[6] = {{{1, 0, 0}, IM_COL32(237, 74, 92, 255), "X", ViewPreset::Right, {}, 0},
                   {{0, 1, 0}, IM_COL32(138, 210, 52, 255), "Y", ViewPreset::Back, {}, 0},
                   {{0, 0, 1}, IM_COL32(69, 140, 243, 255), "Z", ViewPreset::Top, {}, 0},
                   {{-1, 0, 0}, IM_COL32(237, 74, 92, 255), nullptr, ViewPreset::Left, {}, 0},
                   {{0, -1, 0}, IM_COL32(138, 210, 52, 255), nullptr, ViewPreset::Front, {}, 0},
                   {{0, 0, -1}, IM_COL32(69, 140, 243, 255), nullptr, ViewPreset::Bottom, {}, 0}};
  glm::vec3 r = cam.right(), u = cam.up(), f = cam.forward();
  for (Ball& b : balls) {
    b.pos = ImVec2(c.x + glm::dot(b.axis, r) * R * 0.78f, c.y - glm::dot(b.axis, u) * R * 0.78f);
    b.depth = -glm::dot(b.axis, f);
  }
  std::sort(std::begin(balls), std::end(balls), [](const Ball& a, const Ball& b) { return a.depth < b.depth; });
  ImVec2 mouse = ImGui::GetIO().MousePos;
  int hot = -1;
  float best = 11.0f;
  for (int i = 0; i < 6; ++i) {
    float d = std::hypot(mouse.x - balls[i].pos.x, mouse.y - balls[i].pos.y);
    if (hovered && d < best) {
      best = d;
      hot = i;
    }
  }
  for (int i = 0; i < 6; ++i) {
    const Ball& b = balls[i];
    if (b.label) {
      dl->AddLine(c, b.pos, b.color, 2.0f);
      dl->AddCircleFilled(b.pos, 9.0f, b.color, 24);
      ImVec2 ts = ImGui::CalcTextSize(b.label);
      dl->AddText(ImVec2(b.pos.x - ts.x * 0.5f, b.pos.y - ts.y * 0.5f), IM_COL32(20, 20, 20, 255), b.label);
    } else {
      ImU32 fill = (b.color & 0x00ffffff) | (70u << 24);
      dl->AddCircleFilled(b.pos, 7.5f, fill, 24);
      dl->AddCircle(b.pos, 7.5f, b.color, 24, 1.5f);
    }
    if (i == hot) dl->AddCircle(b.pos, 10.5f, IM_COL32(255, 255, 255, 230), 24, 1.5f);
  }
  // Drag the gizmo to orbit; click a ball to align the view with that axis.
  static bool dragged = false;
  if (ImGui::IsItemActivated()) dragged = false;
  if (active && ImGui::IsMouseDragging(ImGuiMouseButton_Left, 2.0f)) {
    ImVec2 d = ImGui::GetIO().MouseDelta;
    cam.orbit(d.x, d.y);
    dragged = true;
  } else if (hot >= 0 && ImGui::IsItemDeactivated() && !dragged) {
    cam.set_view(balls[hot].preset);
  }
  ImGui::SetCursorScreenPos(ImVec2(c.x - 44, c.y + R + pad + 2));
  if (ImGui::SmallButton(cam.ortho ? "Ortho" : "Persp")) cam.ortho = !cam.ortho;
  ImGui::SameLine(0, 4);
  bool wire = settings.shading == Shading::Wireframe;
  if (ImGui::SmallButton(wire ? "Wire" : "Solid"))
    settings.shading = wire ? Shading::Solid : Shading::Wireframe;
  if (ImGui::IsItemHovered()) ImGui::SetTooltip("Shading: Solid / Wireframe (Shift+Z)");
  ImGui::End();
  ImGui::PopStyleVar();
}

// ---- HUD --------------------------------------------------------------------------

static std::string view_name(const Camera& cam) {
  const float eps = 1e-3f, pi = 3.14159265f;
  std::string name;
  if (std::abs(cam.pitch - 0.5f * pi) < eps)
    name = "Top";
  else if (std::abs(cam.pitch + 0.5f * pi) < eps)
    name = "Bottom";
  else if (std::abs(cam.pitch) < eps) {
    float y = std::remainder(cam.yaw, 2 * pi);
    if (std::abs(y + 0.5f * pi) < eps) name = "Front";
    else if (std::abs(y - 0.5f * pi) < eps) name = "Back";
    else if (std::abs(y) < eps) name = "Right";
    else if (std::abs(std::abs(y) - pi) < eps) name = "Left";
  }
  if (name.empty()) name = "User";
  return name + (cam.ortho ? " Orthographic" : " Perspective");
}

void hud(const Camera& cam, const RenderSettings& s, const glm::vec2& vp, float dt, const std::string& status,
         MeasureTool tool) {
  ImDrawList* dl = ImGui::GetBackgroundDrawList();
  bool dark = s.theme == Theme::Dark;
  ImU32 text = dark ? IM_COL32(230, 230, 230, 235) : IM_COL32(30, 30, 34, 235);
  ImU32 shadow = dark ? IM_COL32(0, 0, 0, 160) : IM_COL32(255, 255, 255, 170);
  auto label = [&](ImVec2 p, const std::string& t, ImU32 col) {
    dl->AddText(ImVec2(p.x + 1, p.y + 1), shadow, t.c_str());
    dl->AddText(p, col, t.c_str());
  };

  // Finest grid spacing drawn at the view target: shaders/grid.wgsl fades a
  // line family out once its lines are closer than ~7 px.
  glm::vec3 g(cam.target.x, cam.target.y, s.ground_height);
  float px = cam.pixel_size_at(g, vp.y);
  double spacing = std::pow(10.0, std::ceil(std::log10(double(px) * 7.0)));
  static float fps = 60.0f;
  fps = fps * 0.95f + 0.05f / std::max(dt, 1e-4f);
  label(ImVec2(14, 10), view_name(cam) + (s.shading == Shading::Wireframe ? "  \xc2\xb7  Wireframe" : ""), text);
  char line[128];
  std::snprintf(line, sizeof line, "Grid %s   %.0f fps", format_length(spacing, spacing).c_str(), fps);
  label(ImVec2(14, 30), line, dark ? IM_COL32(180, 180, 180, 220) : IM_COL32(80, 80, 86, 220));
  if (tool != MeasureTool::Off) {
    const char* hint = tool == MeasureTool::Distance ? "Measure distance: click two points (snaps to vertices)"
                                                     : "Measure angle: click three points, the middle is the apex";
    label(ImVec2(14, 50), hint, IM_COL32(255, 196, 64, 255));
  }
  if (!status.empty()) {
    ImVec2 ts = ImGui::CalcTextSize(status.c_str());
    label(ImVec2(vp.x * 0.5f - ts.x * 0.5f, vp.y - 60), status, text);
  }

  // Scale bar at the target depth.
  double len = nice_step(double(px) * 110.0);
  float bar = float(len / px);
  ImVec2 a(20, vp.y - 26), b(20 + bar, vp.y - 26);
  dl->AddLine(ImVec2(a.x + 1, a.y + 1), ImVec2(b.x + 1, b.y + 1), shadow, 2.0f);
  dl->AddLine(a, b, text, 2.0f);
  for (ImVec2 e : {a, b}) dl->AddLine(ImVec2(e.x, e.y - 5), ImVec2(e.x, e.y + 5), text, 2.0f);
  std::string t = format_length(len, len);
  ImVec2 ts = ImGui::CalcTextSize(t.c_str());
  label(ImVec2(0.5f * (a.x + b.x) - ts.x * 0.5f, a.y - ts.y - 6), t, text);
}

void colorbar(const Scene& scene, const glm::vec2& vp) {
  for (const auto& sp : scene.structures()) {
    auto* m = dynamic_cast<const QuantityStructure*>(sp.get());
    const Quantity* q = m && m->visible ? m->coloring_quantity() : nullptr;
    if (!q || q->type == QuantityType::Color) continue;
    glm::vec2 r = m->color_range();
    const float w = 240, h = 12;
    ImGui::SetNextWindowPos(ImVec2(vp.x * 0.5f, vp.y - 12), ImGuiCond_Always, ImVec2(0.5f, 1.0f));
    ImGui::SetNextWindowBgAlpha(0.75f);
    ImGui::Begin("##colorbar", nullptr,
                 ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_AlwaysAutoResize | ImGuiWindowFlags_NoSavedSettings |
                     ImGuiWindowFlags_NoFocusOnAppearing | ImGuiWindowFlags_NoNav | ImGuiWindowFlags_NoInputs |
                     ImGuiWindowFlags_NoDocking);
    std::string title = m->name() + ": " + m->color_quantity + (q->dims == 3 ? " (magnitude)" : "");
    ImGui::TextUnformatted(title.c_str());
    ImVec2 p = ImGui::GetCursorScreenPos();
    ImDrawList* dl = ImGui::GetWindowDrawList();
    const int n = 48;
    for (int i = 0; i < n; ++i) {
      glm::vec3 c0 = colormap_color(m->colormap, float(i) / n), c1 = colormap_color(m->colormap, float(i + 1) / n);
      ImU32 a = ImGui::ColorConvertFloat4ToU32(ImVec4(c0.r, c0.g, c0.b, 1));
      ImU32 b = ImGui::ColorConvertFloat4ToU32(ImVec4(c1.r, c1.g, c1.b, 1));
      dl->AddRectFilledMultiColor(ImVec2(p.x + w * i / n, p.y), ImVec2(p.x + w * (i + 1) / n + 0.5f, p.y + h), a,
                                  b, b, a);
    }
    ImGui::Dummy(ImVec2(w, h));
    char lo[32], mid[32], hi[32];
    std::snprintf(lo, sizeof lo, "%.4g", r.x);
    std::snprintf(mid, sizeof mid, "%.4g", 0.5 * (r.x + r.y));
    std::snprintf(hi, sizeof hi, "%.4g", r.y);
    float x0 = ImGui::GetCursorPosX();
    ImGui::TextUnformatted(lo);
    ImGui::SameLine(x0 + w * 0.5f - ImGui::CalcTextSize(mid).x * 0.5f);
    ImGui::TextUnformatted(mid);
    ImGui::SameLine(x0 + w - ImGui::CalcTextSize(hi).x);
    ImGui::TextUnformatted(hi);
    ImGui::End();
    return;
  }
}

void shader_error_toast(const std::string& error, const glm::vec2& vp) {
  if (error.empty()) return;
  ImGui::SetNextWindowPos(ImVec2(vp.x * 0.5f, 12), ImGuiCond_Always, ImVec2(0.5f, 0));
  ImGui::SetNextWindowSizeConstraints(ImVec2(300, 0), ImVec2(vp.x * 0.6f, vp.y * 0.5f));
  ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0.35f, 0.08f, 0.08f, 0.95f));
  ImGui::Begin("##shadererror", nullptr,
               ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_AlwaysAutoResize | ImGuiWindowFlags_NoSavedSettings |
                   ImGuiWindowFlags_NoDocking);
  ImGui::TextColored(ImVec4(1, 0.8f, 0.8f, 1), "Shader error (fix the file and save to reload)");
  ImGui::PushTextWrapPos(vp.x * 0.58f);
  ImGui::TextUnformatted(error.c_str());
  ImGui::PopTextWrapPos();
  ImGui::End();
  ImGui::PopStyleColor();
}

}  // namespace avbd_viz::ui
