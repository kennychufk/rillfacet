#pragma once
// Frame graph (per frame):
//   shadow  -> sun depth map (meshes)
//   prepass -> depth, view normals, pick ids (1x)        [picking, SSAO, outlines]
//   ssao    -> ambient occlusion + depth-aware blur
//   main    -> lit color, 4x MSAA (meshes, points, vectors, ground grid)
//   composite -> background, tone map, outlines, selection outline -> final RGBA8
//   overlay -> lines, dots, text labels; then the UI draws on top
//   blit    -> window (the final texture doubles as the screenshot source)

#include "avbd_viz/camera.h"
#include "avbd_viz/environment.h"
#include "avbd_viz/gpu.h"
#include "avbd_viz/overlay.h"
#include "avbd_viz/scene.h"
#include "avbd_viz/selection.h"
#include "avbd_viz/shader_library.h"
#include "avbd_viz/text.h"

#include <functional>
#include <memory>
#include <string>
#include <unordered_map>
#include <vector>

namespace avbd_viz {

enum class Style : int { Studio, MatCap, EnvironmentPBR, Technical, Count };
const char* style_name(Style s);

enum class Theme : int { Dark, Light };

enum class OutlineMode : int { Off, Silhouettes, SilhouettesAndCreases };

// Blender's viewport shading modes: lit surfaces (in the chosen Style), or
// see-through wireframes (X-ray).
enum class Shading : int { Solid, Wireframe };

struct RenderSettings {
  Shading shading = Shading::Solid;
  Style style = Style::Studio;  // Solid shading look
  Theme theme = Theme::Dark;

  bool wireframe = false;          // edge overlay on solid shading
  float wire_width = 1.0f;
  float flat_edge_angle = 0.0f;    // hide edges between faces closer than this (deg); 0 = all edges
  bool wire_object_colors = false; // wireframe shading: wires take the object's colors
  float face_opacity = 0.0f;       // wireframe shading: faint face fill (Blender's X-ray alpha)
  bool shadows = true;
  float shadow_strength = 0.6f;
  glm::vec3 sun_dir{0.25f, -0.35f, 1.0f};  // toward the sun (PBR uses the environment's)
  bool ssao = true;
  float ao_strength = 0.8f;
  float ao_radius = 0.35f;  // world units
  OutlineMode outline = OutlineMode::Silhouettes;
  float outline_width = 1.0f;
  float exposure = 1.0f;

  bool grid = true;
  bool ground_shadow = true;
  float ground_height = 0.0f;

  // Style knobs (see shaders/styles/*.wgsl).
  float studio_specular = 0.35f, studio_wrap = 0.35f, studio_ambient = 0.38f;
  MatcapPreset matcap = MatcapPreset::Clay;
  float matcap_tint = 1.0f;
  EnvironmentPreset environment = EnvironmentPreset::Studio;
  std::string environment_file;  // optional .hdr overriding the preset
  float env_intensity = 1.0f, env_rotation = 0.0f;
  float gooch_shift = 1.0f, gooch_contrast = 0.8f;

  // Resets the toggles each style looks best with.
  void apply_style_defaults(Style s);
};

// Where the grid is drawn: normally the ground (z = ground height). In an
// axis-aligned orthographic side view, the view plane through the origin,
// behind everything (Blender behavior): YZ when looking along X, XZ along Y.
struct GridPlane {
  int normal = 2;          // axis normal to the plane (0 x, 1 y, 2 z)
  int u = 0, v = 1;        // in-plane axes
  float offset = 0.0f;     // plane coordinate along `normal`
  bool background = false;
};
GridPlane grid_plane(const Camera& camera, const RenderSettings& settings);

// Mirrors `Frame` in shaders/common/frame.wgsl.
struct FrameUniforms {
  glm::mat4 view, proj, view_proj, inv_view_proj, inv_proj, inv_view, light_view_proj;
  glm::vec4 camera_pos, viewport, sun_dir, bg_top, bg_bottom;
  glm::vec4 grid_minor, grid_major, grid_params, grid_plane, axis_u, axis_v;
  glm::vec4 wire, wire_mode, select_color, active_color, outline_color;
  glm::vec4 style, style2, env, ao, post;
  glm::vec4 sh[9];
};

class Renderer {
 public:
  Renderer(Gpu& gpu, ShaderLibrary& shaders);
  ~Renderer();
  bool init(std::string* error);
  void resize(uint32_t width, uint32_t height);
  uint32_t width() const { return width_; }
  uint32_t height() const { return height_; }

  // Renders the frame into the final texture; `ui` then draws on top of it.
  void render(const Scene& scene, const Camera& camera, const RenderSettings& settings,
              const Selection& selection, const Overlay& overlay,
              const std::function<void(wgpu::RenderPassEncoder&)>& ui);
  // Copies the final texture into a window surface texture.
  void blit(const wgpu::TextureView& target, wgpu::TextureFormat format);

  // Id buffer readback (last rendered frame), row-major, clipped to the view.
  std::vector<IdPixel> read_ids(int x0, int y0, int w, int h);
  // Final image (RGBA8, with UI) for screenshots.
  bool read_final(std::vector<uint8_t>& rgba);

  static constexpr wgpu::TextureFormat kFinalFormat = wgpu::TextureFormat::RGBA8Unorm;
  const Font& font() const { return font_; }
  const std::string& shader_error() const { return shader_error_; }
  glm::vec3 environment_sun() const { return env_.sun_dir; }
  float adapter_ms() const { return frame_ms_; }

 private:
  struct MeshGpu;
  struct PointsGpu;
  struct VectorsGpu;

  bool build_pipelines(std::string* error);
  void create_targets();
  void rebuild_scene_group();
  void update_environment(const RenderSettings& s);
  void sync(const Scene& scene, const RenderSettings& s, const Selection& sel);
  void fill_frame(const Camera& camera, const RenderSettings& s, const Scene& scene);

  Gpu& gpu_;
  ShaderLibrary& shaders_;
  uint32_t width_ = 0, height_ = 0;
  std::string shader_error_;
  Style built_style_ = Style::Count;

  // Layouts
  wgpu::BindGroupLayout frame_layout_, scene_layout_, mesh_layout_, item_layout_, ssao_layout_,
      blur_layout_, composite_layout_, lines_layout_, text_layout_, storage_layout_, blit_layout_;

  // Pipelines
  wgpu::RenderPipeline mesh_main_, mesh_wire_, mesh_prepass_, mesh_shadow_, points_main_, points_prepass_,
      arrows_main_, arrows_prepass_, grid_main_, grid_prepass_, ssao_, blur_, composite_, lines_,
      text_;
  std::unordered_map<int, wgpu::RenderPipeline> blit_pipelines_;

  // Targets
  wgpu::Texture msaa_color_, msaa_depth_, resolved_, pre_depth_, pre_normal_, pre_ids_, ao_raw_,
      ao_, final_, shadow_map_;
  wgpu::TextureView msaa_color_view_, msaa_depth_view_, resolved_view_, pre_depth_view_,
      pre_normal_view_, pre_ids_view_, ao_raw_view_, ao_view_, final_view_, shadow_view_;

  // Static resources
  wgpu::Buffer frame_ubo_;
  wgpu::Sampler clamp_sampler_, repeat_sampler_, shadow_sampler_;
  wgpu::Texture colormap_tex_, matcap_tex_, font_tex_;
  wgpu::Buffer arrow_template_;
  uint32_t arrow_vertex_count_ = 0;
  EnvironmentMap env_;
  int env_key_ = -1;
  std::string env_file_;
  MatcapPreset matcap_built_ = MatcapPreset::Count;
  Font font_;

  wgpu::BindGroup frame_group_, scene_group_, ssao_group_, blur_group_, composite_group_,
      lines_group_, text_group_, blit_group_;
  DynamicBuffer lines_buffer_, text_buffer_;
  wgpu::BindGroup lines_storage_group_, text_storage_group_;

  std::unordered_map<const Structure*, std::unique_ptr<MeshGpu>> meshes_;
  std::unordered_map<const Structure*, std::unique_ptr<PointsGpu>> points_;
  std::unordered_map<const Structure*, std::unique_ptr<VectorsGpu>> vectors_;

  FrameUniforms frame_{};
  float frame_ms_ = 0;
};

}  // namespace avbd_viz
