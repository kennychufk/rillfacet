#pragma once
// The viewer: window + input + built-in panels around a Renderer.
//
// Usage mirrors polyscope: fill `scene()`, register a per-frame callback
// (which may draw its own ImGui windows), then `run()`; or drive the loop
// yourself with `frame()`. Headless mode renders offscreen for screenshots.
//
// Navigation (Blender style):
//   MMB drag orbit | Shift+MMB pan | Ctrl+MMB / wheel zoom | Alt+LMB orbit
//   Numpad 1/3/7 front/right/top (Ctrl = opposite), 5 persp/ortho,
//   2/4/6/8 orbit steps, . or F frame selection, Home frame all.
// Selection:
//   LMB click select, Shift+click add/remove, LMB drag box select (Shift extends),
//   1/2/3/4 vertex/edge/face/body mode, Alt+Z x-ray select, Alt+A / Esc clear,
//   H hide selected bodies, Alt+H unhide the bodies the user hid.
// Shading: Shift+Z Solid <-> Wireframe (see-through), Z wire overlay on Solid.
// Tools: M measure (distance -> angle -> off), F12 screenshot, F10 start/stop video.
// Drag: with set_drag_enabled(true), Ctrl+LMB grabs the element under the
// cursor of a `draggable` structure and drag() reports it every frame (see
// Drag); otherwise Ctrl+LMB is left to the application.

#include "rillfacet/camera.h"
#include "rillfacet/overlay.h"
#include "rillfacet/renderer.h"
#include "rillfacet/scene.h"
#include "rillfacet/selection.h"

#include <cstdio>
#include <functional>
#include <memory>
#include <string>

struct GLFWwindow;
struct ImFont;

namespace rillfacet {

struct ViewerOptions {
  std::string title = "rillfacet";
  int width = 1600;
  int height = 960;
  bool headless = false;
  // false: present without waiting for the display (mailbox, else immediate).
  // A FIFO present blocks while the display is off or locked (1 s per frame
  // on X11), so loops that pump frames from other work turn vsync off.
  bool vsync = true;
  float max_fps = 0.0f;  // > 0: frame() sleeps to stay under this rate (0 = no cap)
};

class Viewer {
 public:
  explicit Viewer(const ViewerOptions& options = {});
  ~Viewer();
  bool ok() const { return ok_; }

  Scene& scene() { return scene_; }
  Camera& camera() { return camera_; }
  RenderSettings& settings() { return settings_; }
  Selection& selection() { return selection_; }
  Overlay& overlay() { return overlay_; }  // cleared every frame before the callback
  std::vector<Measurement>& measurements() { return measurements_; }

  // Called every frame inside the ImGui frame (create windows, step a sim, ...).
  void set_callback(std::function<void()> fn) { callback_ = std::move(fn); }

  bool frame();  // renders one frame; false once the window is closed
  void run();    // frame() until closed
  // Closes the window after the current frame (e.g. from the callback):
  // the next frame() returns false, headless too.
  void request_close() { close_requested_ = true; }
  // PNG of the last frame, including the UI.
  bool screenshot(const std::string& png_path);
  // PNG taken at the end of the next frame, with or without the UI.
  void request_screenshot(const std::string& png_path, bool with_ui);
  // Video of every following frame: an .mp4 through ffmpeg when available,
  // otherwise numbered PNGs next to `path`. Stops on window resize.
  bool start_recording(const std::string& path, int fps = 30, bool with_ui = false);
  void stop_recording();
  bool recording() const { return video_ != nullptr || video_png_; }
  void set_ui_visible(bool v) { ui_visible_ = v; }
  void set_vsync(bool on);
  bool vsync() const { return options_.vsync; }
  void set_max_fps(float fps) { options_.max_fps = fps; }
  float max_fps() const { return options_.max_fps; }
  // ImGui texture id (ImTextureID) of a scene image, for ImGui::Image.
  // Uploads the image if it changed; 0 when the scene has no such image.
  uint64_t image_texture(const std::string& name);

  void frame_all(bool animate = true);
  void frame_selection();
  // Ray under the mouse cursor (pixels, origin top-left).
  Ray mouse_ray() const;
  glm::vec2 mouse() const;
  glm::vec2 viewport() const { return {float(renderer_->width()), float(renderer_->height())}; }
  // Exact 3D hit under a pixel (reads the last frame's id buffer).
  Hit pick(float x, float y);
  float frame_seconds() const { return dt_; }
  // Desktop UI scale (2 at 200%): multiply hard-coded ImGui sizes and positions by it.
  float ui_scale() const;

  // Ctrl+LMB drag (off by default). The begin/to/end calls script a drag
  // without the mouse, e.g. for tests or recorded interactions.
  void set_drag_enabled(bool on);
  bool drag_enabled() const { return drag_enabled_; }
  const Drag& drag() const { return drag_; }
  bool begin_drag(float x, float y);  // grab what is under pixel (x, y); false if nothing draggable
  void drag_to(float x, float y);     // target := cursor ray at pixel (x, y) on the drag plane
  void end_drag();                    // Released, then Idle
  void cancel_drag();                 // Idle at once, no Released (e.g. the scene was rebuilt)
  ImFont* mono_font() const { return mono_font_; }

 private:
  void handle_input();
  void handle_click(const glm::vec2& p, bool extend);
  void handle_box(const glm::vec2& a, const glm::vec2& b, bool extend);
  void handle_measure_click(const glm::vec2& p);
  void build_overlays();
  void update_drag();
  void set_drag_phase(Drag::Phase phase);
  void draw_ui();
  void capture_panel();
  void capture_frame();
  void apply_theme();
  void update_scale();

  ViewerOptions options_;
  bool ok_ = false;
  bool ui_visible_ = true;
  GLFWwindow* window_ = nullptr;
  std::unique_ptr<Gpu> gpu_;
  std::unique_ptr<ShaderLibrary> shaders_;
  std::unique_ptr<Renderer> renderer_;
  wgpu::Surface surface_;
  wgpu::TextureFormat surface_format_ = wgpu::TextureFormat::Undefined;
  uint32_t surface_w_ = 0, surface_h_ = 0;

  Scene scene_;
  Camera camera_;
  RenderSettings settings_;
  Selection selection_;
  Overlay overlay_;
  std::vector<Measurement> measurements_;
  Measurement pending_measure_;
  MeasureTool measure_tool_ = MeasureTool::Off;
  bool xray_select_ = false;
  std::function<void()> callback_;
  Drag drag_;
  bool drag_enabled_ = false, drag_by_mouse_ = false, in_frame_ = false, close_requested_ = false;
  uint64_t frame_index_ = 0, drag_phase_frame_ = 0;

  // Mouse gesture state.
  bool lmb_down_ = false, box_active_ = false, nav_drag_ = false;
  glm::vec2 press_pos_{0}, last_mouse_{0};
  double last_time_ = 0, frame_start_ = 0;
  float dt_ = 1.0f / 60.0f;
  int applied_theme_ = -1;
  float content_scale_ = 0.0f, fb_ratio_ = 0.0f;  // as last applied by update_scale()
  ImFont* ui_font_ = nullptr;
  ImFont* mono_font_ = nullptr;
  int screenshot_counter_ = 0;
  std::string shot_path_;
  bool shot_with_ui_ = true;
  FILE* video_ = nullptr;
  bool video_png_ = false, video_with_ui_ = false;
  std::string video_path_;
  int video_fps_ = 30, video_frames_ = 0;
  uint32_t video_w_ = 0, video_h_ = 0;
  std::string status_;
  double status_until_ = 0;
};

}  // namespace rillfacet
