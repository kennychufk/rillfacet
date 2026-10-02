#pragma once
// Frame graph (per frame):
//   shadow  -> sun depth map (opaque meshes)
//   prepass -> depth, view normals, pick ids (1x)        [picking, SSAO, outlines]
//   ssao    -> ambient occlusion + depth-aware blur
//   main    -> lit color, 4x MSAA (meshes, points, curves, vectors, ground grid)
//   transparent -> see-through meshes, weighted blended OIT (4x MSAA)
//   composite -> background, tone map, outlines, transparency, selection outline -> final RGBA8
//   overlay -> lines, dots, text labels; then the UI draws on top
//   blit    -> window (the final texture doubles as the screenshot source)

#include "rillfacet/camera.h"
#include "rillfacet/environment.h"
#include "rillfacet/gpu.h"
#include "rillfacet/overlay.h"
#include "rillfacet/scene.h"
#include "rillfacet/selection.h"
#include "rillfacet/shader_library.h"
#include "rillfacet/text.h"

#include <functional>
#include <map>
#include <memory>
#include <string>
#include <unordered_map>
#include <vector>

namespace rillfacet {

enum class Style : int { Studio, MatCap, EnvironmentPBR, Technical, Count };
const char* style_name(Style s);

// Colormaps for scalar quantities (QuantityStructure::colormap indexes these).
int colormap_count();
const char* colormap_name(int i);
glm::vec3 colormap_color(int map, float t);  // sRGB

enum class Theme : int { Dark, Light };

enum class OutlineMode : int { Off, Silhouettes, SilhouettesAndCreases };

// Blender's viewport shading modes: lit surfaces (in the chosen Style), or
// see-through wireframes (X-ray).
enum class Shading : int { Solid, Wireframe };

// One axis-aligned plane cutting away everything on its far side (for
// structures with `sliced` set). Volume meshes show their interior at the cut.
struct SlicePlane {
  bool enabled = false;
  int axis = 0;         // 0 x, 1 y, 2 z
  float offset = 0.0f;  // plane position along the axis
  bool flip = false;    // cut away the other side
  bool show = true;     // outline the plane
  // (n, d): points with dot(n, x) > d are cut away.
  glm::vec4 equation() const;
};

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
  SlicePlane slice;

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
  glm::vec4 style, style2, env, ao, post, slice;
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
  // Final image (RGBA8) for screenshots and video: with the UI, or the scene
  // alone (needs keep_scene_image(true) before the frame is rendered).
  bool read_image(std::vector<uint8_t>& rgba, bool with_ui);
  void keep_scene_image(bool keep) { keep_scene_ = keep; }

  static constexpr wgpu::TextureFormat kFinalFormat = wgpu::TextureFormat::RGBA8Unorm;
  const Font& font() const { return font_; }
  // GPU copy of a scene image (uploaded on first use and whenever it
  // changed); a 1x1 white texture when the scene has no such image.
  wgpu::TextureView image_view(const Scene& scene, const std::string& name);
  const std::string& shader_error() const { return shader_error_; }
  glm::vec3 environment_sun() const { return env_.sun_dir; }

 private:
  struct MeshGpu;
  struct PointsGpu;
  struct CurvesGpu;
  struct VectorsGpu;
  struct VolumeGpu;
  struct MeshSelection;
  struct ImageGpu {
    wgpu::Texture texture;
    wgpu::TextureView view;
    uint32_t width = 0, height = 0;
    uint64_t version = 0;
  };

  bool build_pipelines(std::string* error);
  void create_targets();
  void rebuild_scene_group();
  void update_environment(const RenderSettings& s);
  void sync(const Scene& scene, const RenderSettings& s, const Selection& sel);
  void sync_mesh(MeshGpu& g, const SurfaceMesh& m, uint32_t object_id, const MeshSelection& sel,
                 bool clip, float edge_angle, float edge_band);
  void sync_volume(VolumeGpu& g, const VolumeMesh& v, const RenderSettings& s, const Selection& sel);
  void sync_arrows(const QuantityStructure& s, bool clip);
  void fill_frame(const Camera& camera, const RenderSettings& s, const Scene& scene);

  Gpu& gpu_;
  ShaderLibrary& shaders_;
  uint32_t width_ = 0, height_ = 0;
  std::string shader_error_;
  Style built_style_ = Style::Count;
  bool keep_scene_ = false;

  // Layouts
  wgpu::BindGroupLayout frame_layout_, scene_layout_, mesh_layout_, item_layout_, points_layout_,
      curves_layout_, ssao_layout_, blur_layout_, composite_layout_, lines_layout_, text_layout_,
      storage_layout_, blit_layout_;

  // Pipelines
  wgpu::RenderPipeline mesh_main_, mesh_transparent_, mesh_wire_, mesh_prepass_, mesh_shadow_,
      points_main_, points_prepass_, curves_main_, curves_prepass_, arrows_main_, arrows_prepass_,
      grid_main_, grid_prepass_, ssao_, blur_, composite_, lines_, text_;
  std::unordered_map<int, wgpu::RenderPipeline> blit_pipelines_;

  // Targets
  wgpu::Texture msaa_color_, msaa_depth_, resolved_, oit_accum_msaa_, oit_reveal_msaa_, oit_accum_,
      oit_reveal_, pre_depth_, pre_normal_, pre_ids_, ao_raw_, ao_, final_, scene_image_, shadow_map_;
  wgpu::TextureView msaa_color_view_, msaa_depth_view_, resolved_view_, oit_accum_msaa_view_,
      oit_reveal_msaa_view_, oit_accum_view_, oit_reveal_view_, pre_depth_view_, pre_normal_view_,
      pre_ids_view_, ao_raw_view_, ao_view_, final_view_, shadow_view_;

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
  wgpu::TextureView white_view_;
  std::unordered_map<std::string, ImageGpu> images_;
  // Replaced image textures, kept until the frame that may still draw them
  // (an ImGui image taken before the replacement) has been submitted.
  std::vector<wgpu::Texture> retired_images_;
  const Scene* sync_scene_ = nullptr;  // during sync()

  wgpu::BindGroup frame_group_, scene_group_, ssao_group_, blur_group_, composite_group_,
      lines_group_, text_group_, blit_group_;
  DynamicBuffer lines_buffer_, text_buffer_;
  wgpu::BindGroup lines_storage_group_, text_storage_group_;

  // GPU copies of scene structures, keyed by structure id.
  std::unordered_map<uint32_t, std::unique_ptr<MeshGpu>> meshes_;
  std::unordered_map<uint32_t, std::unique_ptr<PointsGpu>> points_;
  std::unordered_map<uint32_t, std::unique_ptr<CurvesGpu>> curves_;
  std::unordered_map<uint32_t, std::unique_ptr<VectorsGpu>> vectors_;
  std::unordered_map<uint32_t, std::unique_ptr<VolumeGpu>> volumes_;
  std::map<std::pair<uint32_t, std::string>, std::unique_ptr<VectorsGpu>> quantity_arrows_;

  // Per-frame draw lists (valid between sync and the end of render).
  std::vector<MeshGpu*> opaque_meshes_, transparent_meshes_;
  std::vector<PointsGpu*> draw_points_;
  std::vector<CurvesGpu*> draw_curves_;
  std::vector<VectorsGpu*> draw_arrows_;

  FrameUniforms frame_{};
};

}  // namespace rillfacet
