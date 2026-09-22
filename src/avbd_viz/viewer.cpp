#include "avbd_viz/viewer.h"

#include "avbd_viz/ui.h"

#define GLFW_INCLUDE_NONE
#include <GLFW/glfw3.h>
#define GLFW_EXPOSE_NATIVE_X11
#include <GLFW/glfw3native.h>
#include <imgui.h>
#include <imgui_impl_glfw.h>
#include <imgui_impl_wgpu.h>
#include <implot.h>
#include <stb_image_write.h>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <limits>

namespace avbd_viz {

static double now_seconds() {
  return std::chrono::duration<double>(std::chrono::steady_clock::now().time_since_epoch()).count();
}

static glm::vec4 srgba(float r, float g, float b, float a = 1.0f) { return {r, g, b, a}; }

Viewer::Viewer(const ViewerOptions& options) : options_(options) {
  gpu_ = std::make_unique<Gpu>();
  if (!gpu_->init()) return;
  shaders_ = std::make_unique<ShaderLibrary>(AVBD_VIZ_SHADER_DIR);
  renderer_ = std::make_unique<Renderer>(*gpu_, *shaders_);

  uint32_t w = uint32_t(options.width), h = uint32_t(options.height);
  float content_scale = 1.0f;
  if (!options.headless) {
    if (!glfwInit()) {
      std::fprintf(stderr, "[avbd_viz] glfwInit failed (no display?)\n");
      return;
    }
    glfwWindowHint(GLFW_CLIENT_API, GLFW_NO_API);
    window_ = glfwCreateWindow(options.width, options.height, options.title.c_str(), nullptr, nullptr);
    if (!window_) return;
    wgpu::SurfaceSourceXlibWindow x11{};
    x11.display = glfwGetX11Display();
    x11.window = glfwGetX11Window(window_);
    wgpu::SurfaceDescriptor sd{};
    sd.nextInChain = &x11;
    surface_ = gpu_->instance.CreateSurface(&sd);
    wgpu::SurfaceCapabilities caps{};
    surface_.GetCapabilities(gpu_->adapter, &caps);
    surface_format_ = caps.formatCount ? caps.formats[0] : wgpu::TextureFormat::BGRA8Unorm;
    for (size_t i = 0; i < caps.formatCount; ++i)
      if (caps.formats[i] == wgpu::TextureFormat::BGRA8Unorm || caps.formats[i] == wgpu::TextureFormat::RGBA8Unorm)
        surface_format_ = caps.formats[i];
    int fw, fh;
    glfwGetFramebufferSize(window_, &fw, &fh);
    w = uint32_t(fw);
    h = uint32_t(fh);
    float sx, sy;
    glfwGetWindowContentScale(window_, &sx, &sy);
    content_scale = sx;
  }
  renderer_->resize(w, h);
  std::string error;
  if (!renderer_->init(&error)) {
    std::fprintf(stderr, "[avbd_viz] renderer init failed: %s\n", error.c_str());
    return;
  }

  IMGUI_CHECKVERSION();
  ImGui::CreateContext();
  ImPlot::CreateContext();
  ImGuiIO& io = ImGui::GetIO();
  io.ConfigFlags |= ImGuiConfigFlags_DockingEnable;
  io.IniFilename = nullptr;
  std::string fonts = std::string(AVBD_VIZ_ASSET_DIR) + "/fonts/";
  ui_font_ = io.Fonts->AddFontFromFileTTF((fonts + "Inter-Medium.ttf").c_str(), 15.0f * content_scale);
  mono_font_ = io.Fonts->AddFontFromFileTTF((fonts + "JetBrainsMono-Regular.ttf").c_str(), 14.0f * content_scale);
  if (window_) ImGui_ImplGlfw_InitForOther(window_, true);
  ImGui_ImplWGPU_InitInfo info;
  info.Device = gpu_->device.Get();
  info.RenderTargetFormat = WGPUTextureFormat(Renderer::kFinalFormat);
  ImGui_ImplWGPU_Init(&info);

  camera_.target = {0, 0, 1};
  camera_.distance = 14.0f;
  last_time_ = now_seconds();
  ok_ = true;
}

Viewer::~Viewer() {
  if (ImGui::GetCurrentContext()) {
    ImGui_ImplWGPU_Shutdown();
    if (window_) ImGui_ImplGlfw_Shutdown();
    ImPlot::DestroyContext();
    ImGui::DestroyContext();
  }
  renderer_.reset();
  surface_ = nullptr;
  if (window_) {
    glfwDestroyWindow(window_);
    glfwTerminate();
  }
}

void Viewer::apply_theme() {
  ui::apply_theme(settings_.theme);
  applied_theme_ = int(settings_.theme);
}

// ---- Frame loop ---------------------------------------------------------------

bool Viewer::frame() {
  if (!ok_) return false;
  if (window_) {
    glfwPollEvents();
    if (glfwWindowShouldClose(window_)) return false;
    int fw, fh;
    glfwGetFramebufferSize(window_, &fw, &fh);
    if (fw <= 0 || fh <= 0) {
      glfwWaitEventsTimeout(0.05);
      return true;
    }
    if (uint32_t(fw) != surface_w_ || uint32_t(fh) != surface_h_) {
      wgpu::SurfaceConfiguration cfg{};
      cfg.device = gpu_->device;
      cfg.format = surface_format_;
      cfg.width = surface_w_ = uint32_t(fw);
      cfg.height = surface_h_ = uint32_t(fh);
      cfg.presentMode = wgpu::PresentMode::Fifo;
      surface_.Configure(&cfg);
      renderer_->resize(surface_w_, surface_h_);
    }
  }
  double t = now_seconds();
  dt_ = float(std::clamp(t - last_time_, 1e-4, 0.25));
  last_time_ = t;
  if (int(settings_.theme) != applied_theme_) apply_theme();

  ImGuiIO& io = ImGui::GetIO();
  ImGui_ImplWGPU_NewFrame();
  if (window_) {
    ImGui_ImplGlfw_NewFrame();
  } else {
    io.DisplaySize = ImVec2(float(renderer_->width()), float(renderer_->height()));
    io.DeltaTime = dt_;
  }
  ImGui::NewFrame();
  overlay_.clear();
  handle_input();
  if (callback_) callback_();
  if (ui_visible_) draw_ui();
  build_overlays();
  camera_.update(dt_);
  ImGui::Render();

  renderer_->render(scene_, camera_, settings_, selection_, overlay_, [](wgpu::RenderPassEncoder& pass) {
    ImGui_ImplWGPU_RenderDrawData(ImGui::GetDrawData(), pass.Get());
  });
  if (window_) {
    wgpu::SurfaceTexture st{};
    surface_.GetCurrentTexture(&st);
    if (st.status == wgpu::SurfaceGetCurrentTextureStatus::SuccessOptimal ||
        st.status == wgpu::SurfaceGetCurrentTextureStatus::SuccessSuboptimal) {
      renderer_->blit(st.texture.CreateView(), surface_format_);
      surface_.Present();
    } else {
      surface_w_ = surface_h_ = 0;  // reconfigure next frame
    }
  }
  gpu_->instance.ProcessEvents();
  return true;
}

void Viewer::run() {
  while (frame()) {
  }
}

bool Viewer::screenshot(const std::string& path) {
  std::vector<uint8_t> rgba;
  if (!renderer_->read_final(rgba)) return false;
  int w = int(renderer_->width()), h = int(renderer_->height());
  return stbi_write_png(path.c_str(), w, h, 4, rgba.data(), w * 4) != 0;
}

// ---- Camera helpers ---------------------------------------------------------------

glm::vec2 Viewer::mouse() const {
  const ImGuiIO& io = ImGui::GetIO();
  return {io.MousePos.x * io.DisplayFramebufferScale.x, io.MousePos.y * io.DisplayFramebufferScale.y};
}

Ray Viewer::mouse_ray() const {
  glm::vec2 m = mouse(), vp = viewport();
  return camera_.ray(m.x, m.y, vp.x, vp.y);
}

void Viewer::frame_all(bool animate) {
  glm::vec3 lo, hi;
  if (scene_.bounds(lo, hi)) camera_.frame_bounds(lo, hi, animate);
}

void Viewer::frame_selection() {
  if (selection_.empty()) {
    frame_all();
    return;
  }
  glm::vec3 lo(std::numeric_limits<float>::max()), hi = -lo;
  for (const ElementRef& e : selection_.items()) {
    glm::vec3 p = element_position(scene_, selection_.mode(), e);
    lo = glm::min(lo, p);
    hi = glm::max(hi, p);
    if (selection_.mode() == PickMode::Segment)
      if (auto* m = scene_.get<SurfaceMesh>(e.object)) {
        const auto& off = m->segment_offsets();
        for (uint32_t f = off[e.index]; f < off[e.index + 1]; ++f)
          for (int k = 0; k < 3; ++k) {
            glm::vec3 v = m->vertex(m->triangles()[3 * f + k]);
            lo = glm::min(lo, v);
            hi = glm::max(hi, v);
          }
      }
  }
  glm::vec3 pad(std::max(0.05f, 0.1f * glm::length(hi - lo)));
  camera_.frame_bounds(lo - pad, hi + pad);
}

// Reads a (2r+1)^2 id window centered on `p`, padded with background
// outside the view so the center is always the middle element.
static std::vector<IdPixel> id_window(Renderer& r, const glm::vec2& p, int radius) {
  int n = 2 * radius + 1, x0 = int(p.x) - radius, y0 = int(p.y) - radius;
  std::vector<IdPixel> out(size_t(n) * n);
  int cx0 = std::max(x0, 0), cy0 = std::max(y0, 0);
  int cx1 = std::min(x0 + n, int(r.width())), cy1 = std::min(y0 + n, int(r.height()));
  if (cx1 <= cx0 || cy1 <= cy0) return out;
  std::vector<IdPixel> raw = r.read_ids(cx0, cy0, cx1 - cx0, cy1 - cy0);
  for (int y = cy0; y < cy1; ++y)
    for (int x = cx0; x < cx1; ++x)
      out[size_t(y - y0) * n + (x - x0)] = raw[size_t(y - cy0) * (cx1 - cx0) + (x - cx0)];
  return out;
}

Hit Viewer::pick(float x, float y) {
  std::vector<IdPixel> px = id_window(*renderer_, {x, y}, 0);
  glm::vec2 vp = viewport();
  return refine_hit(scene_, px[0], camera_.ray(x, y, vp.x, vp.y), settings_.ground_height);
}

// ---- Input --------------------------------------------------------------------------

void Viewer::handle_input() {
  ImGuiIO& io = ImGui::GetIO();
  const bool over_ui = io.WantCaptureMouse;
  const bool shift = io.KeyShift, ctrl = io.KeyCtrl, alt = io.KeyAlt;
  const glm::vec2 m(io.MousePos.x, io.MousePos.y);
  const glm::vec2 d(io.MouseDelta.x, io.MouseDelta.y);

  // Navigation: middle mouse (or Alt+left) drag, wheel.
  if (!over_ui && (ImGui::IsMouseClicked(ImGuiMouseButton_Middle) ||
                   (alt && ImGui::IsMouseClicked(ImGuiMouseButton_Left))))
    nav_drag_ = true;
  bool nav_button = ImGui::IsMouseDown(ImGuiMouseButton_Middle) || (alt && ImGui::IsMouseDown(ImGuiMouseButton_Left));
  if (nav_drag_ && nav_button && (d.x != 0 || d.y != 0)) {
    if (shift)
      camera_.pan(d.x, d.y, io.DisplaySize.y);
    else if (ctrl)
      camera_.dolly(-d.y * 0.05f);
    else
      camera_.orbit(d.x, d.y);
  }
  if (!nav_button) nav_drag_ = false;
  if (!over_ui && io.MouseWheel != 0.0f) camera_.dolly(io.MouseWheel);

  // Selection / measuring with the left button (Ctrl+LMB belongs to the app).
  if (!over_ui && !nav_drag_ && ImGui::IsMouseClicked(ImGuiMouseButton_Left) && !ctrl && !alt) {
    lmb_down_ = true;
    box_active_ = false;
    press_pos_ = m;
  }
  if (lmb_down_) {
    if (ImGui::IsMouseDown(ImGuiMouseButton_Left)) {
      if (!box_active_ && measure_tool_ == MeasureTool::Off && glm::length(m - press_pos_) > 5.0f) box_active_ = true;
      if (box_active_) {
        ImDrawList* dl = ImGui::GetForegroundDrawList();
        ImVec2 a(std::min(press_pos_.x, m.x), std::min(press_pos_.y, m.y));
        ImVec2 b(std::max(press_pos_.x, m.x), std::max(press_pos_.y, m.y));
        dl->AddRectFilled(a, b, IM_COL32(255, 255, 255, 18));
        dl->AddRect(a, b, IM_COL32(255, 255, 255, 200), 0.0f, 0, 1.0f);
      }
    } else {
      glm::vec2 scale(io.DisplayFramebufferScale.x, io.DisplayFramebufferScale.y);
      if (box_active_)
        handle_box(press_pos_ * scale, m * scale, shift);
      else if (measure_tool_ != MeasureTool::Off)
        handle_measure_click(m * scale);
      else
        handle_click(m * scale, shift);
      lmb_down_ = box_active_ = false;
    }
  }

  if (io.WantCaptureKeyboard) return;
  auto pressed = [](ImGuiKey k) { return ImGui::IsKeyPressed(k, false); };
  const float step = glm::radians(15.0f);
  if (pressed(ImGuiKey_Keypad1)) camera_.set_view(ctrl ? ViewPreset::Back : ViewPreset::Front);
  if (pressed(ImGuiKey_Keypad3)) camera_.set_view(ctrl ? ViewPreset::Left : ViewPreset::Right);
  if (pressed(ImGuiKey_Keypad7)) camera_.set_view(ctrl ? ViewPreset::Bottom : ViewPreset::Top);
  if (pressed(ImGuiKey_Keypad5)) camera_.ortho = !camera_.ortho;
  if (pressed(ImGuiKey_Keypad4)) camera_.animate_to(camera_.target, camera_.distance, camera_.yaw + step, camera_.pitch);
  if (pressed(ImGuiKey_Keypad6)) camera_.animate_to(camera_.target, camera_.distance, camera_.yaw - step, camera_.pitch);
  if (pressed(ImGuiKey_Keypad8))
    camera_.animate_to(camera_.target, camera_.distance, camera_.yaw, std::min(camera_.pitch + step, 1.5707963f));
  if (pressed(ImGuiKey_Keypad2))
    camera_.animate_to(camera_.target, camera_.distance, camera_.yaw, std::max(camera_.pitch - step, -1.5707963f));
  if (pressed(ImGuiKey_KeypadDecimal) || pressed(ImGuiKey_F)) frame_selection();
  if (pressed(ImGuiKey_Home)) frame_all();
  if (pressed(ImGuiKey_1)) selection_.set_mode(PickMode::Vertex);
  if (pressed(ImGuiKey_2)) selection_.set_mode(PickMode::Edge);
  if (pressed(ImGuiKey_3)) selection_.set_mode(PickMode::Face);
  if (pressed(ImGuiKey_4)) selection_.set_mode(PickMode::Segment);
  if (pressed(ImGuiKey_Z)) {
    if (alt)
      xray_select_ = !xray_select_;
    else if (shift)
      settings_.shading = settings_.shading == Shading::Wireframe ? Shading::Solid : Shading::Wireframe;
    else
      settings_.wireframe = !settings_.wireframe;
  }
  if (pressed(ImGuiKey_M)) {
    measure_tool_ = MeasureTool((int(measure_tool_) + 1) % 3);
    pending_measure_ = {};
  }
  if (pressed(ImGuiKey_A) && alt) selection_.clear();
  if (pressed(ImGuiKey_Escape)) {
    if (!pending_measure_.anchors.empty())
      pending_measure_ = {};
    else if (measure_tool_ != MeasureTool::Off)
      measure_tool_ = MeasureTool::Off;
    else
      selection_.clear();
  }
  if (pressed(ImGuiKey_H)) {
    char msg[96];
    if (alt) {
      size_t n = unhide_all_segments(scene_);
      std::snprintf(msg, sizeof msg, n ? "Unhid %zu bodies" : "No hidden bodies", n);
    } else if (selection_.mode() != PickMode::Segment) {
      std::snprintf(msg, sizeof msg, "H hides bodies: switch to Body mode (4) first");
    } else {
      size_t n = hide_selected_segments(scene_, selection_);
      std::snprintf(msg, sizeof msg, n ? "Hid %zu bodies (Alt+H or the body list brings them back)" : "Select bodies to hide", n);
    }
    status_ = msg;
    status_until_ = now_seconds() + 3.0;
  }
  if (pressed(ImGuiKey_F12)) {
    char name[64];
    std::snprintf(name, sizeof name, "avbd_viz_%03d.png", screenshot_counter_++);
    status_ = screenshot(name) ? std::string("Saved ") + name : "Screenshot failed";
    status_until_ = now_seconds() + 2.5;
  }
}

void Viewer::handle_click(const glm::vec2& p, bool extend) {
  std::vector<IdPixel> window = id_window(*renderer_, p, 6);
  ElementRef e;
  if (pick_element(scene_, camera_, selection_.mode(), window, p, viewport(), e)) {
    if (extend)
      selection_.toggle(e);
    else
      selection_.set(e);
  } else if (!extend) {
    selection_.clear();
  }
}

void Viewer::handle_box(const glm::vec2& a, const glm::vec2& b, bool extend) {
  glm::vec2 lo = glm::max(glm::min(a, b), glm::vec2(0.0f));
  glm::vec2 hi = glm::min(glm::max(a, b), viewport() - 1.0f);
  if (hi.x <= lo.x || hi.y <= lo.y) return;
  std::vector<IdPixel> region;
  // Wireframe shading is see-through, so it always selects through (as Blender's X-ray).
  bool xray = xray_select_ || settings_.shading == Shading::Wireframe;
  if (!xray) region = renderer_->read_ids(int(lo.x), int(lo.y), int(hi.x - lo.x) + 1, int(hi.y - lo.y) + 1);
  selection_.add(box_select(scene_, camera_, selection_.mode(), region, lo, hi, viewport(), xray), extend);
}

void Viewer::handle_measure_click(const glm::vec2& p) {
  Hit h = pick(p.x, p.y);
  if (!h.valid) return;
  Anchor a = h.surface;
  // Snap to the nearest mesh vertex within 12 px, even if the cursor is on
  // the ground or a neighbouring face.
  ElementRef v;
  if (pick_element(scene_, camera_, PickMode::Vertex, id_window(*renderer_, p, 8), p, viewport(), v))
    if (auto* m = scene_.get<SurfaceMesh>(v.object)) {
      glm::vec3 s = camera_.project(m->vertex(v.index), viewport().x, viewport().y);
      if (glm::length(glm::vec2(s.x, s.y) - p) <= 12.0f) a = {Anchor::Vertex, v.object, v.index, {}, {}};
    }
  pending_measure_.angle = measure_tool_ == MeasureTool::Angle;
  pending_measure_.anchors.push_back(a);
  if (pending_measure_.anchors.size() >= (pending_measure_.angle ? 3u : 2u)) {
    measurements_.push_back(pending_measure_);
    pending_measure_ = {};
  }
}

// ---- Overlays ------------------------------------------------------------------------

static std::string format_measure(double d) {
  char buf[48];
  if (d >= 1.0)
    std::snprintf(buf, sizeof buf, "%.4g m", d);
  else if (d >= 0.01)
    std::snprintf(buf, sizeof buf, "%.4g cm", d * 100.0);
  else
    std::snprintf(buf, sizeof buf, "%.4g mm", d * 1000.0);
  return buf;
}

void Viewer::build_overlays() {
  const bool dark = settings_.theme == Theme::Dark;
  const glm::vec2 vp = viewport();
  const glm::vec4 halo = dark ? srgba(0.05f, 0.05f, 0.06f, 0.75f) : srgba(1, 1, 1, 0.85f);

  // Grid rulers: labelled ticks along the grid plane's two axes (or along
  // grid lines through the view target when an axis is off screen).
  if (settings_.grid) {
    const GridPlane gp = grid_plane(camera_, settings_);
    auto at = [&](double a, double b) {
      glm::vec3 p(0.0f);
      p[gp.normal] = gp.offset;
      p[gp.u] = float(a);
      p[gp.v] = float(b);
      return p;
    };
    const double tu = camera_.target[gp.u], tv = camera_.target[gp.v];
    double px = camera_.pixel_size_at(at(tu, tv), vp.y);
    double step = ui::nice_step(px * 90.0);
    auto on_screen = [&](const glm::vec3& p, glm::vec2& s) {
      glm::vec3 q = camera_.project(p, vp.x, vp.y);
      s = {q.x, q.y};
      return (camera_.ortho || q.z < 0) && s.x > 8 && s.y > 8 && s.x < vp.x - 8 && s.y < vp.y - 8;
    };
    const glm::vec4 axis_colors[3] = {dark ? srgba(0.98f, 0.66f, 0.70f) : srgba(0.70f, 0.14f, 0.20f),
                                      dark ? srgba(0.74f, 0.90f, 0.56f) : srgba(0.28f, 0.50f, 0.08f),
                                      dark ? srgba(0.62f, 0.78f, 1.00f) : srgba(0.12f, 0.33f, 0.75f)};
    for (int axis = 0; axis < 2; ++axis) {  // 0: along the u axis, 1: along the v axis
      glm::vec2 s;
      bool axis_visible = on_screen(axis == 0 ? at(tu, 0) : at(0, tv), s);
      double line = axis_visible ? 0.0 : std::round((axis == 0 ? tv : tu) / step) * step;
      double center = axis == 0 ? tu : tv;
      glm::vec4 color = axis_colors[axis == 0 ? gp.u : gp.v];
      // A vertical axis in a side view gets its labels to the right.
      bool beside = gp.background && axis == 1;
      // Walk outward from the target in both directions; stop once labels
      // would crowd (perspective compresses the far end of the axis).
      glm::vec2 first(-1e9f);
      for (int dir : {1, -1}) {
        glm::vec2 last = first;
        for (int k = dir > 0 ? 0 : -1; std::abs(k) <= 12; k += dir) {
          double v = (std::round(center / step) + k) * step;
          glm::vec3 p = axis == 0 ? at(v, line) : at(line, v);
          if (!on_screen(p, s)) continue;
          if (glm::length(s - last) < 44.0f) break;
          last = s;
          if (k == 0) first = s;
          if (std::abs(v) < 1e-9 * step && axis == 1) continue;  // origin labelled once
          TextLabel l;
          l.text = ui::format_length(v, step);
          l.anchor = p;
          l.size_px = 12.0f;
          l.align = beside ? glm::vec2(0.0f, 0.5f) : glm::vec2(0.5f, 0.0f);
          l.offset = beside ? glm::vec2(8.0f, 0.0f) : glm::vec2(0.0f, 6.0f);
          l.color = color;
          l.halo = halo;
          l.hidden_alpha = 0.0f;
          overlay_.text(l);
        }
      }
    }
  }

  // Selection highlights (faces and bodies are tinted by the shaders).
  const glm::vec4 sel_color = dark ? srgba(1.0f, 0.63f, 0.2f) : srgba(1.0f, 0.55f, 0.1f);
  const glm::vec4 active_color = dark ? srgba(1.0f, 0.93f, 0.75f) : srgba(0.85f, 0.30f, 0.0f);
  const glm::vec4 border = dark ? srgba(0.05f, 0.05f, 0.05f, 1.5f) : srgba(0.1f, 0.1f, 0.1f, 1.5f);
  const ElementRef* active = selection_.active();
  for (const ElementRef& e : selection_.items()) {
    bool is_active = active && e == *active;
    const SurfaceMesh* m = scene_.get<SurfaceMesh>(e.object);
    if (!m) {
      overlay_.dot(element_position(scene_, selection_.mode(), e), is_active ? active_color : sel_color, 10.0f, 0.4f,
                   border);
      continue;
    }
    if (selection_.mode() == PickMode::Vertex) {
      overlay_.dot(m->vertex(e.index), is_active ? active_color : sel_color, is_active ? 10.0f : 8.0f, 0.35f, border);
    } else if (selection_.mode() == PickMode::Edge) {
      const auto& ed = m->edges();
      overlay_.line(m->vertex(ed[2 * e.index]), m->vertex(ed[2 * e.index + 1]), is_active ? active_color : sel_color,
                    3.0f, 0.35f);
    } else if (selection_.mode() == PickMode::Face && settings_.shading == Shading::Wireframe &&
               e.index < m->num_faces()) {
      glm::uvec3 f = m->face(e.index);
      glm::vec3 p[3] = {m->vertex(f.x), m->vertex(f.y), m->vertex(f.z)};
      for (int k = 0; k < 3; ++k)
        overlay_.line(p[k], p[(k + 1) % 3], is_active ? active_color : sel_color, settings_.wire_width + 1.0f, 1.0f);
    }
  }
  if (active) {
    static const char* prefix[] = {"v", "e", "f", ""};
    std::string text = selection_.mode() == PickMode::Segment
                           ? (scene_.get<SurfaceMesh>(active->object)
                                  ? scene_.get<SurfaceMesh>(active->object)->segment_name(active->index)
                                  : "#" + std::to_string(active->index))
                           : prefix[int(selection_.mode())] + std::to_string(active->index);
    TextLabel l;
    l.text = text;
    l.anchor = element_position(scene_, selection_.mode(), *active);
    if (selection_.mode() == PickMode::Segment)
      if (auto* m = scene_.get<SurfaceMesh>(active->object)) {
        const auto& off = m->segment_offsets();
        for (uint32_t f = off[active->index]; f < off[active->index + 1]; ++f)
          for (int k = 0; k < 3; ++k) l.anchor.z = std::max(l.anchor.z, m->vertex(m->triangles()[3 * f + k]).z);
      }
    l.size_px = 13.0f;
    l.offset = {10.0f, -22.0f};
    l.color = active_color;
    l.halo = halo;
    l.hidden_alpha = 0.6f;
    overlay_.text(l);
  }

  // Measurements.
  const glm::vec4 mcolor = srgba(1.0f, 0.86f, 0.35f);
  auto draw_measure = [&](const Measurement& ms, bool done) {
    std::vector<glm::vec3> p;
    for (const Anchor& a : ms.anchors) p.push_back(resolve_anchor(scene_, a));
    for (const glm::vec3& q : p) overlay_.dot(q, srgba(1, 1, 1), 8.0f, 0.5f, border);
    if (!done) return;
    TextLabel l;
    l.size_px = 14.0f;
    l.align = {0.5f, 1.0f};
    l.offset = {0.0f, -8.0f};
    l.color = srgba(1.0f, 0.95f, 0.8f);
    l.halo = srgba(0.05f, 0.05f, 0.06f, 0.85f);
    l.hidden_alpha = 0.7f;
    if (!ms.angle) {
      overlay_.line(p[0], p[1], mcolor, 2.0f, 0.4f);
      l.anchor = 0.5f * (p[0] + p[1]);
      l.text = format_measure(glm::length(p[1] - p[0]));
    } else {
      overlay_.line(p[1], p[0], mcolor, 2.0f, 0.4f);
      overlay_.line(p[1], p[2], mcolor, 2.0f, 0.4f);
      glm::vec3 u = glm::normalize(p[0] - p[1]), w = glm::normalize(p[2] - p[1]);
      char buf[32];
      std::snprintf(buf, sizeof buf, "%.2f\xc2\xb0", glm::degrees(std::acos(std::clamp(glm::dot(u, w), -1.0f, 1.0f))));
      l.anchor = p[1];
      l.text = buf;
    }
    overlay_.text(l);
  };
  for (const Measurement& ms : measurements_) draw_measure(ms, true);
  draw_measure(pending_measure_, false);
}

void Viewer::draw_ui() {
  const ImGuiIO& io = ImGui::GetIO();
  glm::vec2 vp(io.DisplaySize.x, io.DisplaySize.y);
  MeasureTool before = measure_tool_;
  ui::display_panel(scene_, settings_, selection_);
  ui::inspector_panel(scene_, selection_, measurements_, measure_tool_, xray_select_, mono_font_);
  if (measure_tool_ != before) pending_measure_ = {};
  ui::nav_gizmo(camera_, settings_, vp);
  if (now_seconds() > status_until_) status_.clear();
  ui::hud(camera_, settings_, vp, dt_, status_, measure_tool_);
  ui::colorbar(scene_, vp);
  ui::shader_error_toast(renderer_->shader_error(), vp);
}

}  // namespace avbd_viz
