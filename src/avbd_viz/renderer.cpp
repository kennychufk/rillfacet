#include "avbd_viz/renderer.h"

#include <glm/gtc/matrix_transform.hpp>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstring>
#include <map>
#include <unordered_set>

namespace avbd_viz {

#include "avbd_viz/colormap_data.inc"

int colormap_count() { return kColormapCount; }
const char* colormap_name(int i) { return kColormapNames[std::clamp(i, 0, kColormapCount - 1)]; }
glm::vec3 colormap_color(int map, float t) {
  const auto& row = kColormapTable[std::clamp(map, 0, kColormapCount - 1)];
  int i = std::clamp(int(t * 255.0f + 0.5f), 0, 255);
  return glm::vec3(row[i][0], row[i][1], row[i][2]) / 255.0f;
}

using TF = wgpu::TextureFormat;
using TU = wgpu::TextureUsage;
using BU = wgpu::BufferUsage;

// ---- Small helpers ------------------------------------------------------------

static glm::vec3 srgb_to_linear(const glm::vec3& c) {
  auto f = [](float x) { return x <= 0.04045f ? x / 12.92f : std::pow((x + 0.055f) / 1.055f, 2.4f); };
  return {f(c.r), f(c.g), f(c.b)};
}

static glm::vec4 lin(float r, float g, float b, float a = 1.0f) {
  return glm::vec4(srgb_to_linear({r, g, b}), a);
}

static uint32_t pack_srgb(const glm::vec3& c) {
  auto b = [](float x) { return uint32_t(std::lround(std::clamp(x, 0.0f, 1.0f) * 255.0f)); };
  return b(c.r) | (b(c.g) << 8) | (b(c.b) << 16) | (255u << 24);
}

const char* style_name(Style s) {
  switch (s) {
    case Style::Studio: return "Studio";
    case Style::MatCap: return "MatCap";
    case Style::EnvironmentPBR: return "Environment PBR";
    case Style::Technical: return "Technical";
    default: return "?";
  }
}

void RenderSettings::apply_style_defaults(Style s) {
  style = s;
  switch (s) {
    case Style::Studio:
      ssao = true, ao_strength = 0.8f, shadows = true, outline = OutlineMode::Silhouettes;
      break;
    case Style::MatCap:
      ssao = true, ao_strength = 0.6f, shadows = true, outline = OutlineMode::Off;
      break;
    case Style::EnvironmentPBR:
      ssao = true, ao_strength = 0.7f, shadows = true, outline = OutlineMode::Off;
      break;
    case Style::Technical:
      ssao = true, ao_strength = 0.45f, shadows = true, outline = OutlineMode::SilhouettesAndCreases;
      break;
    default: break;
  }
}

GridPlane grid_plane(const Camera& camera, const RenderSettings& settings) {
  GridPlane g;
  int axis = camera.aligned_axis();
  if (camera.ortho && (axis == 0 || axis == 1)) {
    g.normal = axis;
    g.u = axis == 0 ? 1 : 0;
    g.v = 2;
    g.background = true;
  } else {
    g.offset = settings.ground_height;
  }
  return g;
}

// ---- GPU mirrors of scene structures ----------------------------------------

// Mirrors `MeshObject` in shaders/mesh.wgsl.
struct MeshUniforms {
  glm::mat4 model{1.0f};
  glm::vec4 base_color{1.0f};
  uint32_t color_mode = 0, cmap_row = 0, flags = 0, object_id = 0;
  glm::vec2 scalar_range{0, 1};
  float iso_spacing = 0, pad = 0;
  glm::vec4 material{0};
};
static_assert(sizeof(MeshUniforms) == 128);

struct SegmentInfo {
  uint32_t color, flags;
  float scalar;
  uint32_t pad;
};

// Mirrors `PointObject` / `ArrowObject`.
struct ItemUniforms {
  glm::vec4 color;
  glm::vec4 material;
  float radius;
  float length_scale;  // vectors only
  uint32_t object_id;
  uint32_t pad;
};

struct Renderer::MeshGpu {
  uint64_t pos_ver = 0, topo_ver = 0, attr_ver = 0, sel_ver = 0, mask_ver = 0;
  float edge_angle = 0.0f;
  std::string color_key;
  wgpu::Buffer ubo;
  DynamicBuffer positions, triangles, face_segment, segments, vertex_scalar, face_info;
  wgpu::BindGroup group;
  MeshUniforms u;
  uint32_t faces = 0;
};

struct Renderer::PointsGpu {
  uint64_t ver = 0;
  wgpu::Buffer ubo;
  DynamicBuffer points;
  wgpu::BindGroup group;
  uint32_t count = 0;
};

struct Renderer::VectorsGpu {
  uint64_t ver = 0;
  wgpu::Buffer ubo;
  DynamicBuffer arrows;
  wgpu::BindGroup group;
  uint32_t count = 0;
};

// ---- Pipeline construction ----------------------------------------------------

namespace {

enum class Blend { Opaque, Premultiplied };

struct PipelineSpec {
  wgpu::ShaderModule module;
  const char* vs = "vs_main";
  const char* fs = "fs_main";  // nullptr = depth only
  std::vector<wgpu::BindGroupLayout> layouts;
  std::vector<TF> colors;
  Blend blend = Blend::Opaque;
  TF depth = TF::Undefined;
  bool depth_write = true;
  wgpu::CompareFunction depth_compare = wgpu::CompareFunction::Greater;  // reversed-Z
  uint32_t samples = 1;
  const wgpu::VertexBufferLayout* vertex_layout = nullptr;
};

wgpu::RenderPipeline make_pipeline(const Gpu& gpu, const PipelineSpec& p, const char* label) {
  wgpu::PipelineLayoutDescriptor pl{};
  pl.bindGroupLayoutCount = p.layouts.size();
  pl.bindGroupLayouts = p.layouts.data();

  wgpu::BlendState premult{};
  premult.color = {wgpu::BlendOperation::Add, wgpu::BlendFactor::One, wgpu::BlendFactor::OneMinusSrcAlpha};
  premult.alpha = premult.color;
  std::vector<wgpu::ColorTargetState> targets(p.colors.size());
  for (size_t i = 0; i < p.colors.size(); ++i) {
    targets[i].format = p.colors[i];
    if (p.blend == Blend::Premultiplied && i == 0) targets[i].blend = &premult;
  }
  wgpu::FragmentState fs{};
  fs.module = p.module;
  fs.entryPoint = p.fs;
  fs.targetCount = targets.size();
  fs.targets = targets.data();

  wgpu::DepthStencilState ds{};
  ds.format = p.depth;
  ds.depthWriteEnabled = p.depth_write;
  ds.depthCompare = p.depth_compare;

  wgpu::RenderPipelineDescriptor d{};
  d.label = label;
  d.layout = gpu.device.CreatePipelineLayout(&pl);
  d.vertex.module = p.module;
  d.vertex.entryPoint = p.vs;
  if (p.vertex_layout) {
    d.vertex.bufferCount = 1;
    d.vertex.buffers = p.vertex_layout;
  }
  d.primitive.topology = wgpu::PrimitiveTopology::TriangleList;
  d.primitive.cullMode = wgpu::CullMode::None;
  d.multisample.count = p.samples;
  d.fragment = p.fs ? &fs : nullptr;
  d.depthStencil = p.depth != TF::Undefined ? &ds : nullptr;
  return gpu.device.CreateRenderPipeline(&d);
}

const char* style_file(Style s) {
  switch (s) {
    case Style::MatCap: return "styles/matcap.wgsl";
    case Style::EnvironmentPBR: return "styles/pbr.wgsl";
    case Style::Technical: return "styles/technical.wgsl";
    default: return "styles/studio.wgsl";
  }
}

}  // namespace

// ---- Setup ----------------------------------------------------------------------

Renderer::Renderer(Gpu& gpu, ShaderLibrary& shaders) : gpu_(gpu), shaders_(shaders) {}
Renderer::~Renderer() = default;

bool Renderer::init(std::string* error) {
  using BK = BindingKind;
  const auto VF = wgpu::ShaderStage::Vertex | wgpu::ShaderStage::Fragment;
  frame_layout_ = make_layout(gpu_, "frame", {{0, BK::Uniform}});
  scene_layout_ = make_layout(gpu_, "scene",
                              {{0, BK::Uniform}, {1, BK::Sampler}, {2, BK::Texture}, {3, BK::Texture},
                               {4, BK::Texture}, {5, BK::DepthTexture}, {6, BK::ComparisonSampler},
                               {7, BK::Texture}, {8, BK::Sampler}});
  mesh_layout_ = make_layout(gpu_, "mesh",
                             {{0, BK::Uniform}, {1, BK::Storage}, {2, BK::Storage}, {3, BK::Storage},
                              {4, BK::Storage}, {5, BK::Storage}, {6, BK::Storage}});
  item_layout_ = make_layout(gpu_, "item", {{0, BK::Uniform}, {1, BK::Storage}});
  ssao_layout_ = make_layout(gpu_, "ssao", {{0, BK::Uniform}, {1, BK::DepthTexture}, {2, BK::Texture}});
  blur_layout_ = make_layout(gpu_, "blur", {{0, BK::Uniform}, {1, BK::DepthTexture}, {3, BK::Texture}});
  composite_layout_ = make_layout(gpu_, "composite",
                                  {{0, BK::Uniform}, {1, BK::Texture}, {2, BK::UintTexture},
                                   {3, BK::DepthTexture}, {4, BK::Texture}});
  lines_layout_ = make_layout(gpu_, "lines", {{0, BK::Uniform}, {1, BK::DepthTexture, VF}});
  text_layout_ = make_layout(gpu_, "text",
                             {{0, BK::Uniform}, {1, BK::DepthTexture}, {2, BK::Texture}, {3, BK::Sampler}});
  storage_layout_ = make_layout(gpu_, "storage", {{0, BK::Storage}});
  blit_layout_ = make_layout(gpu_, "blit", {{0, BK::Texture, wgpu::ShaderStage::Fragment}});

  frame_ubo_ = gpu_.create_buffer(sizeof(FrameUniforms), BU::Uniform | BU::CopyDst, "frame");
  frame_group_ = make_group(gpu_, frame_layout_, {{0, frame_ubo_}});

  wgpu::SamplerDescriptor sd{};
  sd.magFilter = sd.minFilter = wgpu::FilterMode::Linear;
  sd.mipmapFilter = wgpu::MipmapFilterMode::Linear;
  clamp_sampler_ = gpu_.device.CreateSampler(&sd);
  sd.addressModeU = wgpu::AddressMode::Repeat;
  repeat_sampler_ = gpu_.device.CreateSampler(&sd);
  wgpu::SamplerDescriptor cmp{};
  cmp.magFilter = cmp.minFilter = wgpu::FilterMode::Linear;
  cmp.compare = wgpu::CompareFunction::LessEqual;
  shadow_sampler_ = gpu_.device.CreateSampler(&cmp);

  // Colormaps: one 256-texel row per map.
  colormap_tex_ = gpu_.create_texture(256, kColormapCount, TF::RGBA8UnormSrgb,
                                      TU::TextureBinding | TU::CopyDst, "colormaps");
  std::vector<uint8_t> cm(256 * kColormapCount * 4);
  for (int m = 0; m < kColormapCount; ++m)
    for (int i = 0; i < 256; ++i) {
      uint8_t* px = &cm[(m * 256 + i) * 4];
      px[0] = kColormapTable[m][i][0];
      px[1] = kColormapTable[m][i][1];
      px[2] = kColormapTable[m][i][2];
      px[3] = 255;
    }
  {
    wgpu::TexelCopyTextureInfo dst{};
    dst.texture = colormap_tex_;
    wgpu::TexelCopyBufferLayout l{};
    l.bytesPerRow = 256 * 4;
    l.rowsPerImage = kColormapCount;
    wgpu::Extent3D e{256, uint32_t(kColormapCount), 1};
    gpu_.queue.WriteTexture(&dst, cm.data(), cm.size(), &l, &e);
  }
  matcap_tex_ = gpu_.create_texture(256, 256, TF::RGBA8UnormSrgb, TU::TextureBinding | TU::CopyDst, "matcap");

  shadow_map_ = gpu_.create_texture(2048, 2048, TF::Depth32Float,
                                    TU::RenderAttachment | TU::TextureBinding, "shadow map");
  shadow_view_ = shadow_map_.CreateView();

  // Font atlas for 3D labels.
  std::string font_path = std::string(AVBD_VIZ_ASSET_DIR) + "/fonts/Inter-SemiBold.ttf";
  if (!font_.load(font_path)) {
    if (error) *error = "cannot load font " + font_path;
    return false;
  }
  font_tex_ = gpu_.create_texture(font_.atlas_width(), font_.atlas_height(), TF::R8Unorm,
                                  TU::TextureBinding | TU::CopyDst, "font atlas");
  {
    wgpu::TexelCopyTextureInfo dst{};
    dst.texture = font_tex_;
    wgpu::TexelCopyBufferLayout l{};
    l.bytesPerRow = font_.atlas_width();
    l.rowsPerImage = font_.atlas_height();
    wgpu::Extent3D e{uint32_t(font_.atlas_width()), uint32_t(font_.atlas_height()), 1};
    gpu_.queue.WriteTexture(&dst, font_.atlas().data(), font_.atlas().size(), &l, &e);
  }

  // Arrow template: (angle, ring) pairs, see shaders/arrows.wgsl.
  {
    const int n = 14;
    std::vector<glm::vec2> v;
    auto ang = [&](float i) { return 2.0f * 3.14159265f * i / n; };
    for (int i = 0; i < n; ++i) {
      float a0 = ang(i), a1 = ang(i + 1), am = ang(i + 0.5f);
      glm::vec2 quad[6] = {{a0, 0}, {a1, 0}, {a1, 1}, {a0, 0}, {a1, 1}, {a0, 1}};
      v.insert(v.end(), quad, quad + 6);                        // shaft
      v.insert(v.end(), {{a0, 2}, {a1, 2}, {am, 3}});           // cone
      v.insert(v.end(), {{a0, 4}, {a1, 5}, {a0, 5}});           // cone back
      v.insert(v.end(), {{a0, 6}, {a1, 7}, {a0, 7}});           // shaft cap
    }
    arrow_vertex_count_ = uint32_t(v.size());
    arrow_template_ = gpu_.create_buffer(v.size() * sizeof(glm::vec2), BU::Vertex | BU::CopyDst, "arrow");
    gpu_.queue.WriteBuffer(arrow_template_, 0, v.data(), v.size() * sizeof(glm::vec2));
  }

  RenderSettings defaults;
  update_environment(defaults);
  if (!env_.view) {
    if (error) *error = "environment prefilter failed: " + shader_error_;
    return false;
  }
  width_ = std::max(width_, 1u);
  height_ = std::max(height_, 1u);
  create_targets();
  built_style_ = defaults.style;
  return build_pipelines(error);
}

bool Renderer::build_pipelines(std::string* error) {
  std::string err;
  std::map<std::string, std::string> style = {{"STYLE", style_file(built_style_)}};
  wgpu::ShaderModule mesh = shaders_.compile(gpu_, "mesh.wgsl", style, &err);
  wgpu::ShaderModule points = mesh ? shaders_.compile(gpu_, "points.wgsl", style, &err) : nullptr;
  wgpu::ShaderModule arrows = points ? shaders_.compile(gpu_, "arrows.wgsl", style, &err) : nullptr;
  wgpu::ShaderModule grid = arrows ? shaders_.compile(gpu_, "grid.wgsl", {}, &err) : nullptr;
  wgpu::ShaderModule ssao = grid ? shaders_.compile(gpu_, "ssao.wgsl", {}, &err) : nullptr;
  wgpu::ShaderModule comp = ssao ? shaders_.compile(gpu_, "composite.wgsl", {}, &err) : nullptr;
  wgpu::ShaderModule lines = comp ? shaders_.compile(gpu_, "overlay_lines.wgsl", {}, &err) : nullptr;
  wgpu::ShaderModule text = lines ? shaders_.compile(gpu_, "overlay_text.wgsl", {}, &err) : nullptr;
  if (!text) {
    shader_error_ = err;
    if (error) *error = err;
    return false;
  }

  const TF hdr = TF::RGBA16Float, depth = TF::Depth32Float;
  const std::vector<TF> prepass_targets = {TF::RGBA16Float, TF::RGBA32Uint};
  wgpu::VertexAttribute attr{};
  attr.format = wgpu::VertexFormat::Float32x2;
  wgpu::VertexBufferLayout arrow_vbl{};
  arrow_vbl.arrayStride = sizeof(glm::vec2);
  arrow_vbl.attributeCount = 1;
  arrow_vbl.attributes = &attr;

  gpu_.push_error_scope();
  auto mk = [&](PipelineSpec p, const char* label) { return make_pipeline(gpu_, p, label); };
  auto mesh_main = mk({mesh, "vs_main", "fs_main", {scene_layout_, mesh_layout_}, {hdr}, Blend::Opaque, depth, true,
                       wgpu::CompareFunction::Greater, 4}, "mesh main");
  auto mesh_wire = mk({mesh, "vs_main", "fs_wire", {scene_layout_, mesh_layout_}, {hdr}, Blend::Premultiplied,
                       depth, false, wgpu::CompareFunction::Always, 4}, "mesh wire");
  auto mesh_pre = mk({mesh, "vs_main", "fs_prepass", {scene_layout_, mesh_layout_}, prepass_targets,
                      Blend::Opaque, depth}, "mesh prepass");
  auto mesh_shadow = mk({mesh, "vs_shadow", nullptr, {frame_layout_, mesh_layout_}, {}, Blend::Opaque, depth,
                         true, wgpu::CompareFunction::Less}, "mesh shadow");
  auto points_main = mk({points, "vs_main", "fs_main", {scene_layout_, item_layout_}, {hdr}, Blend::Opaque, depth,
                         true, wgpu::CompareFunction::Greater, 4}, "points main");
  auto points_pre = mk({points, "vs_main", "fs_prepass", {scene_layout_, item_layout_}, prepass_targets,
                        Blend::Opaque, depth}, "points prepass");
  auto arrows_main = mk({arrows, "vs_main", "fs_main", {scene_layout_, item_layout_}, {hdr}, Blend::Opaque, depth,
                         true, wgpu::CompareFunction::Greater, 4, &arrow_vbl}, "arrows main");
  auto arrows_pre = mk({arrows, "vs_main", "fs_prepass", {scene_layout_, item_layout_}, prepass_targets,
                        Blend::Opaque, depth, true, wgpu::CompareFunction::Greater, 1, &arrow_vbl},
                       "arrows prepass");
  auto grid_main = mk({grid, "vs_fullscreen", "fs_main", {scene_layout_}, {hdr}, Blend::Premultiplied, depth,
                       false, wgpu::CompareFunction::Greater, 4}, "grid main");
  auto grid_pre = mk({grid, "vs_fullscreen", "fs_prepass", {scene_layout_}, prepass_targets, Blend::Opaque,
                      depth}, "grid prepass");
  auto ssao_p = mk({ssao, "vs_fullscreen", "fs_ssao", {ssao_layout_}, {TF::R8Unorm}}, "ssao");
  auto blur_p = mk({ssao, "vs_fullscreen", "fs_blur", {blur_layout_}, {TF::R8Unorm}}, "ssao blur");
  auto comp_p = mk({comp, "vs_fullscreen", "fs_composite", {composite_layout_}, {kFinalFormat}}, "composite");
  auto lines_p = mk({lines, "vs_main", "fs_main", {lines_layout_, storage_layout_}, {kFinalFormat},
                     Blend::Premultiplied}, "overlay lines");
  auto text_p = mk({text, "vs_main", "fs_main", {text_layout_, storage_layout_}, {kFinalFormat},
                    Blend::Premultiplied}, "overlay text");
  err = gpu_.pop_error_scope();
  if (!err.empty()) {
    shader_error_ = err;
    if (error) *error = err;
    return false;
  }
  mesh_main_ = mesh_main, mesh_wire_ = mesh_wire, mesh_prepass_ = mesh_pre, mesh_shadow_ = mesh_shadow;
  points_main_ = points_main, points_prepass_ = points_pre;
  arrows_main_ = arrows_main, arrows_prepass_ = arrows_pre;
  grid_main_ = grid_main, grid_prepass_ = grid_pre;
  ssao_ = ssao_p, blur_ = blur_p, composite_ = comp_p, lines_ = lines_p, text_ = text_p;
  blit_pipelines_.clear();
  shader_error_.clear();
  return true;
}

void Renderer::resize(uint32_t w, uint32_t h) {
  w = std::max(w, 1u);
  h = std::max(h, 1u);
  if (w == width_ && h == height_ && final_) return;
  width_ = w;
  height_ = h;
  if (frame_ubo_) create_targets();  // before init() only the size is recorded
}

void Renderer::create_targets() {
  const uint32_t w = width_, h = height_;
  auto make = [&](wgpu::Texture& tex, wgpu::TextureView& view, TF fmt, wgpu::TextureUsage usage,
                  const char* label, uint32_t samples = 1) {
    tex = gpu_.create_texture(w, h, fmt, usage, label, samples);
    view = tex.CreateView();
  };
  make(msaa_color_, msaa_color_view_, TF::RGBA16Float, TU::RenderAttachment, "msaa color", 4);
  make(msaa_depth_, msaa_depth_view_, TF::Depth32Float, TU::RenderAttachment, "msaa depth", 4);
  make(resolved_, resolved_view_, TF::RGBA16Float, TU::RenderAttachment | TU::TextureBinding, "resolved");
  make(pre_depth_, pre_depth_view_, TF::Depth32Float, TU::RenderAttachment | TU::TextureBinding, "prepass depth");
  make(pre_normal_, pre_normal_view_, TF::RGBA16Float, TU::RenderAttachment | TU::TextureBinding, "normals");
  make(pre_ids_, pre_ids_view_, TF::RGBA32Uint, TU::RenderAttachment | TU::TextureBinding | TU::CopySrc, "ids");
  make(ao_raw_, ao_raw_view_, TF::R8Unorm, TU::RenderAttachment | TU::TextureBinding, "ao raw");
  make(ao_, ao_view_, TF::R8Unorm, TU::RenderAttachment | TU::TextureBinding, "ao");
  make(final_, final_view_, kFinalFormat, TU::RenderAttachment | TU::TextureBinding | TU::CopySrc, "final");

  ssao_group_ = make_group(gpu_, ssao_layout_, {{0, frame_ubo_}, {1, pre_depth_view_}, {2, pre_normal_view_}});
  blur_group_ = make_group(gpu_, blur_layout_, {{0, frame_ubo_}, {1, pre_depth_view_}, {3, ao_raw_view_}});
  composite_group_ = make_group(gpu_, composite_layout_,
                                {{0, frame_ubo_}, {1, resolved_view_}, {2, pre_ids_view_},
                                 {3, pre_depth_view_}, {4, pre_normal_view_}});
  lines_group_ = make_group(gpu_, lines_layout_, {{0, frame_ubo_}, {1, pre_depth_view_}});
  text_group_ = make_group(gpu_, text_layout_,
                           {{0, frame_ubo_}, {1, pre_depth_view_}, {2, font_tex_.CreateView()}, {3, clamp_sampler_}});
  blit_group_ = make_group(gpu_, blit_layout_, {{0, final_view_}});
  rebuild_scene_group();
}

void Renderer::rebuild_scene_group() {
  if (!env_.view || !ao_view_) return;
  scene_group_ = make_group(gpu_, scene_layout_,
                            {{0, frame_ubo_}, {1, clamp_sampler_}, {2, colormap_tex_.CreateView()},
                             {3, matcap_tex_.CreateView()}, {4, env_.view}, {5, shadow_view_},
                             {6, shadow_sampler_}, {7, ao_view_}, {8, repeat_sampler_}});
}

void Renderer::update_environment(const RenderSettings& s) {
  bool changed = false;
  if (s.matcap != matcap_built_) {
    std::vector<uint8_t> px = make_matcap(s.matcap, 256);
    wgpu::TexelCopyTextureInfo dst{};
    dst.texture = matcap_tex_;
    wgpu::TexelCopyBufferLayout l{};
    l.bytesPerRow = 256 * 4;
    l.rowsPerImage = 256;
    wgpu::Extent3D e{256, 256, 1};
    gpu_.queue.WriteTexture(&dst, px.data(), px.size(), &l, &e);
    matcap_built_ = s.matcap;
  }
  if (int(s.environment) != env_key_ || s.environment_file != env_file_) {
    EnvironmentImage img;
    if (s.environment_file.empty() || !load_hdr(s.environment_file, img))
      img = make_environment(s.environment);
    std::string err;
    if (env_.build(gpu_, shaders_, img, &err)) changed = true;
    else shader_error_ = err;
    env_key_ = int(s.environment);
    env_file_ = s.environment_file;
  }
  if (changed) rebuild_scene_group();
}

// ---- Per-frame sync -------------------------------------------------------------

void Renderer::sync(const Scene& scene, const RenderSettings& settings, const Selection& sel) {
  // Drop GPU copies of removed structures (keyed by pointer, validated by id).
  std::unordered_set<const Structure*> alive;
  for (const auto& s : scene.structures()) alive.insert(s.get());
  std::erase_if(meshes_, [&](auto& kv) { return !alive.count(kv.first); });
  std::erase_if(points_, [&](auto& kv) { return !alive.count(kv.first); });
  std::erase_if(vectors_, [&](auto& kv) { return !alive.count(kv.first); });

  // Selected indices per object for the current pick mode.
  std::unordered_map<uint32_t, std::vector<uint32_t>> selected;
  for (const ElementRef& e : sel.items()) selected[e.object].push_back(e.index);
  const ElementRef* active = sel.active();
  const float edge_angle = std::max(settings.flat_edge_angle, 0.0f);

  const BU storage = BU::Storage;
  for (const auto& sp : scene.structures()) {
    const Structure* s = sp.get();
    if (auto* m = dynamic_cast<const SurfaceMesh*>(s)) {
      auto& slot = meshes_[s];
      if (!slot || slot->u.object_id != m->id()) {
        slot = std::make_unique<MeshGpu>();
        slot->ubo = gpu_.create_buffer(sizeof(MeshUniforms), BU::Uniform | BU::CopyDst, "mesh uniforms");
      }
      MeshGpu& g = *slot;
      bool rebind = !g.group;
      if (g.pos_ver != m->positions_version()) {
        rebind |= g.positions.upload(gpu_, m->positions().data(), m->positions().size() * 4, storage, "positions");
        g.pos_ver = m->positions_version();
      }
      if (g.topo_ver != m->topology_version()) {
        rebind |= g.triangles.upload(gpu_, m->triangles().data(), m->triangles().size() * 4, storage, "triangles");
        rebind |= g.face_segment.upload(gpu_, m->face_segment().data(), m->face_segment().size() * 4, storage,
                                        "face segment");
        g.faces = uint32_t(m->num_faces());
        g.topo_ver = m->topology_version();
      }

      // Resolve what colors the mesh.
      const Quantity* q = m->color_source == ColorSource::Quantity ? m->quantity(m->color_quantity) : nullptr;
      uint32_t mode = 0;
      if (m->color_source == ColorSource::SegmentPalette) mode = 1;
      if (q) mode = q->on == ElementKind::Vertex ? 2 : q->on == ElementKind::Face ? 3
                  : q->on == ElementKind::Segment ? 4 : 0;
      std::string key = std::to_string(mode) + (q ? q->name : "");
      bool mask_stale = g.edge_angle != edge_angle ||
                        (edge_angle > 0 && !m->rigid_segments && g.mask_ver != m->positions_version());
      if (g.attr_ver != m->attributes_version() || g.sel_ver != sel.version() || g.color_key != key || mask_stale) {
        auto value = [&](size_t i) {
          if (q->dims == 1) return q->data[i];
          const float* v = &q->data[3 * i];
          return std::sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
        };
        const auto& sel_idx = selected[m->id()];
        std::vector<SegmentInfo> segs(std::max<size_t>(m->num_segments(), 1));
        for (size_t k = 0; k < m->num_segments(); ++k) {
          segs[k].color = pack_srgb(m->segment_color(uint32_t(k)));
          segs[k].flags = m->segment_visible(uint32_t(k)) ? 0u : 1u;
          segs[k].scalar = mode == 4 && k * q->dims < q->data.size() ? value(k) : 0.0f;
        }
        std::vector<uint32_t> face_info(2 * std::max<size_t>(m->num_faces(), 1), 0);
        if (mode == 3)
          for (size_t f = 0; f < m->num_faces() && f * q->dims < q->data.size(); ++f) {
            float v = value(f);
            std::memcpy(&face_info[2 * f], &v, 4);
          }
        bool is_active_obj = active && active->object == m->id();
        if (sel.mode() == PickMode::Face) {
          for (uint32_t f : sel_idx)
            if (f < m->num_faces()) face_info[2 * f + 1] |= 1u;
          if (is_active_obj && active->index < m->num_faces()) face_info[2 * active->index + 1] |= 2u;
        }
        if (sel.mode() == PickMode::Segment) {
          for (uint32_t k : sel_idx)
            if (k < segs.size()) segs[k].flags |= 2u;
          if (is_active_obj && active->index < segs.size()) segs[active->index].flags |= 4u;
        }
        if (edge_angle > 0) {
          const auto& flat = m->flat_edge_mask(edge_angle);
          for (size_t f = 0; f < flat.size(); ++f) face_info[2 * f + 1] |= uint32_t(flat[f]) << 2;
        }
        g.edge_angle = edge_angle;
        g.mask_ver = m->positions_version();
        std::vector<float> vs(1, 0.0f);
        if (mode == 2) {
          vs.resize(std::max<size_t>(m->num_vertices(), 1));
          for (size_t i = 0; i < m->num_vertices() && i * q->dims < q->data.size(); ++i) vs[i] = value(i);
        }
        rebind |= g.segments.upload(gpu_, segs.data(), segs.size() * sizeof(SegmentInfo), storage, "segments");
        rebind |= g.face_info.upload(gpu_, face_info.data(), face_info.size() * 4, storage, "face info");
        rebind |= g.vertex_scalar.upload(gpu_, vs.data(), vs.size() * 4, storage, "vertex scalar");
        if (q && mode != 0) {
          glm::vec2 r = m->auto_range ? m->quantity_range(*q) : m->range;
          g.u.scalar_range = r;
        }
        g.attr_ver = m->attributes_version();
        g.sel_ver = sel.version();
        g.color_key = key;
      }
      g.u.base_color = glm::vec4(srgb_to_linear(m->color), 1.0f);
      g.u.color_mode = mode;
      g.u.cmap_row = uint32_t(std::clamp(m->colormap, 0, kColormapCount - 1));
      g.u.flags = m->isolines ? 1u : 0u;
      g.u.object_id = m->id();
      if (!m->auto_range && mode >= 2) g.u.scalar_range = m->range;
      g.u.iso_spacing = m->isoline_spacing;
      g.u.material = glm::vec4(m->metallic, m->roughness, 0, 0);
      gpu_.queue.WriteBuffer(g.ubo, 0, &g.u, sizeof(MeshUniforms));
      if (rebind)
        g.group = make_group(gpu_, mesh_layout_,
                             {{0, g.ubo}, {1, g.positions.buffer}, {2, g.triangles.buffer},
                              {3, g.face_segment.buffer}, {4, g.segments.buffer}, {5, g.vertex_scalar.buffer},
                              {6, g.face_info.buffer}});
    } else if (auto* p = dynamic_cast<const PointCloud*>(s)) {
      auto& slot = points_[s];
      if (!slot) {
        slot = std::make_unique<PointsGpu>();
        slot->ubo = gpu_.create_buffer(sizeof(ItemUniforms), BU::Uniform | BU::CopyDst, "points uniforms");
      }
      PointsGpu& g = *slot;
      bool rebind = !g.group;
      if (g.ver != p->version()) {
        rebind |= g.points.upload(gpu_, p->packed().data(), std::max<size_t>(p->packed().size() * 4, 16), storage,
                                  "points");
        g.count = uint32_t(p->size());
        g.ver = p->version();
      }
      ItemUniforms u{glm::vec4(srgb_to_linear(p->color), 1), glm::vec4(0, 0.35f, 0, 0), p->radius, 0, p->id(), 0};
      gpu_.queue.WriteBuffer(g.ubo, 0, &u, sizeof(u));
      if (rebind) g.group = make_group(gpu_, item_layout_, {{0, g.ubo}, {1, g.points.buffer}});
    } else if (auto* v = dynamic_cast<const VectorSet*>(s)) {
      auto& slot = vectors_[s];
      if (!slot) {
        slot = std::make_unique<VectorsGpu>();
        slot->ubo = gpu_.create_buffer(sizeof(ItemUniforms), BU::Uniform | BU::CopyDst, "vectors uniforms");
      }
      VectorsGpu& g = *slot;
      bool rebind = !g.group;
      if (g.ver != v->version()) {
        std::vector<glm::vec4> packed(std::max<size_t>(2 * v->size(), 2), glm::vec4(0));
        for (size_t i = 0; i < v->size(); ++i) {
          packed[2 * i] = glm::vec4(v->origins()[3 * i], v->origins()[3 * i + 1], v->origins()[3 * i + 2], 0);
          packed[2 * i + 1] = glm::vec4(v->vectors()[3 * i], v->vectors()[3 * i + 1], v->vectors()[3 * i + 2], 0);
        }
        rebind |= g.arrows.upload(gpu_, packed.data(), packed.size() * sizeof(glm::vec4), storage, "arrows");
        g.count = uint32_t(v->size());
        g.ver = v->version();
      }
      ItemUniforms u{glm::vec4(srgb_to_linear(v->color), 1), glm::vec4(0, 0.35f, 0, 0), v->radius,
                     v->length_scale, v->id(), 0};
      gpu_.queue.WriteBuffer(g.ubo, 0, &u, sizeof(u));
      if (rebind) g.group = make_group(gpu_, item_layout_, {{0, g.ubo}, {1, g.arrows.buffer}});
    }
  }
}

void Renderer::fill_frame(const Camera& cam, const RenderSettings& s, const Scene& scene) {
  FrameUniforms& f = frame_;
  float aspect = float(width_) / float(height_);
  f.view = cam.view();
  f.proj = cam.proj(aspect);
  f.view_proj = f.proj * f.view;
  f.inv_view_proj = glm::inverse(f.view_proj);
  f.inv_proj = glm::inverse(f.proj);
  f.inv_view = glm::inverse(f.view);
  f.camera_pos = glm::vec4(cam.eye(), cam.ortho ? 1.0f : 0.0f);
  f.viewport = glm::vec4(width_, height_, 1.0f / width_, 1.0f / height_);

  // Sun shadow: orthographic box around everything visible (and the ground below it).
  glm::vec3 sun = glm::normalize(s.style == Style::EnvironmentPBR ? env_.sun_dir : s.sun_dir);
  glm::vec3 lo, hi;
  if (!scene.bounds(lo, hi)) lo = hi = cam.target;
  lo.z = std::min(lo.z, s.ground_height);
  glm::vec3 c = 0.5f * (lo + hi);
  float r = 0.5f * glm::length(hi - lo) * 1.05f + 0.05f;
  glm::vec3 up = std::abs(sun.z) > 0.99f ? glm::vec3(0, 1, 0) : glm::vec3(0, 0, 1);
  glm::mat4 lv = glm::lookAtRH(c + sun * (2.0f * r), c, up);
  glm::mat4 lp = glm::orthoRH_ZO(-r, r, -r, r, 0.0f, 4.0f * r);
  f.light_view_proj = lp * lv;
  f.sun_dir = glm::vec4(sun, s.shadow_strength);

  bool dark = s.theme == Theme::Dark;
  f.bg_top = dark ? lin(0.235f, 0.243f, 0.259f) : lin(0.965f, 0.969f, 0.976f);
  f.bg_bottom = dark ? lin(0.114f, 0.118f, 0.129f) : lin(0.820f, 0.835f, 0.859f);
  f.grid_minor = dark ? lin(0.62f, 0.64f, 0.68f, 0.20f) : lin(0.30f, 0.32f, 0.36f, 0.16f);
  f.grid_major = dark ? lin(0.74f, 0.76f, 0.80f, 0.42f) : lin(0.20f, 0.22f, 0.26f, 0.36f);
  const bool wire_mode = s.shading == Shading::Wireframe;
  const GridPlane gp = grid_plane(cam, s);
  f.grid_params = glm::vec4(gp.offset, std::max(cam.distance * 12.0f, 8.0f), s.grid ? 1.0f : 0.0f,
                            s.ground_shadow && !wire_mode ? 1.0f : 0.0f);
  f.grid_plane = glm::vec4(float(gp.normal), gp.background ? 1.0f : 0.0f, float(gp.u), float(gp.v));
  const glm::vec4 axis_colors[3] = {lin(0.92f, 0.26f, 0.34f, 0.85f), lin(0.52f, 0.80f, 0.20f, 0.85f),
                                    lin(0.24f, 0.52f, 0.96f, 0.85f)};
  f.axis_u = axis_colors[gp.u];
  f.axis_v = axis_colors[gp.v];
  // Wires: dark over shaded surfaces; in wireframe shading they contrast with
  // the background instead.
  if (wire_mode) {
    f.wire = dark ? lin(0.70f, 0.72f, 0.76f) : lin(0.10f, 0.11f, 0.13f);
    f.wire.a = std::max(s.wire_width, 1.0f);
  } else {
    f.wire = dark ? lin(0.05f, 0.05f, 0.06f) : lin(0.06f, 0.06f, 0.07f);
    f.wire.a = s.wireframe ? s.wire_width : 0.0f;
  }
  f.wire_mode = glm::vec4(wire_mode ? 1.0f : 0.0f, s.face_opacity, s.wire_object_colors ? 1.0f : 0.0f, 0);
  // Selection: orange; the active element is paler on dark, deeper on light.
  f.select_color = dark ? lin(1.0f, 0.63f, 0.20f) : lin(1.0f, 0.55f, 0.10f);
  f.active_color = dark ? lin(1.0f, 0.88f, 0.62f) : lin(0.85f, 0.30f, 0.0f);
  f.outline_color = dark ? lin(0.02f, 0.02f, 0.025f, 0.85f) : lin(0.10f, 0.10f, 0.12f, 0.80f);

  // Wireframe shading has no surfaces to shadow, occlude or outline.
  f.style = glm::vec4(s.ssao && !wire_mode ? s.ao_strength : 0.0f, s.exposure,
                      s.shadows && !wire_mode ? 1.0f : 0.0f, wire_mode ? 0.0f : float(int(s.outline)));
  switch (s.style) {
    case Style::Studio: f.style2 = {s.studio_specular, s.studio_wrap, s.studio_ambient, 0}; break;
    case Style::MatCap: f.style2 = {s.matcap_tint, 0, 0, 0}; break;
    case Style::Technical: f.style2 = {s.gooch_shift, s.gooch_contrast, 0, 0}; break;
    default: f.style2 = glm::vec4(0); break;
  }
  f.env = glm::vec4(glm::radians(s.env_rotation), s.env_intensity, float(env_.mip_count - 1), 0);
  f.ao = glm::vec4(s.ao_radius, 0.02f, 1.0f, 0);
  f.post = glm::vec4(s.style == Style::EnvironmentPBR ? 1.0f : 0.0f, s.outline_width, 0, 0);
  for (int k = 0; k < 9; ++k) f.sh[k] = glm::vec4(env_.sh[k], 0);
  gpu_.queue.WriteBuffer(frame_ubo_, 0, &f, sizeof(FrameUniforms));
}

// ---- Frame ----------------------------------------------------------------------

void Renderer::render(const Scene& scene, const Camera& camera, const RenderSettings& s,
                      const Selection& sel, const Overlay& overlay,
                      const std::function<void(wgpu::RenderPassEncoder&)>& ui) {
  auto t0 = std::chrono::steady_clock::now();
  update_environment(s);
  bool reload = shaders_.poll_changes();
  // On a shader error the previous pipelines stay in use and the error is
  // shown in the UI until the file is fixed (hot reload retries).
  if (s.style != built_style_ || reload) {
    built_style_ = s.style;
    build_pipelines(nullptr);
  }
  sync(scene, s, sel);
  fill_frame(camera, s, scene);

  // Overlay geometry.
  std::vector<GlyphInstance> glyphs;
  for (const TextLabel& l : overlay.labels)
    font_.layout(l.text, l.anchor, l.size_px, l.align, l.offset, l.color, l.halo, l.halo_px, l.hidden_alpha,
                 l.ignore_depth, glyphs);
  if (lines_buffer_.upload(gpu_, overlay.lines.data(), std::max<size_t>(overlay.lines.size() * sizeof(OverlayLine), 256),
                           BU::Storage, "overlay lines") || !lines_storage_group_)
    lines_storage_group_ = make_group(gpu_, storage_layout_, {{0, lines_buffer_.buffer}});
  if (text_buffer_.upload(gpu_, glyphs.data(), std::max<size_t>(glyphs.size() * sizeof(GlyphInstance), 256),
                          BU::Storage, "glyphs") || !text_storage_group_)
    text_storage_group_ = make_group(gpu_, storage_layout_, {{0, text_buffer_.buffer}});

  const bool ground = s.grid || s.ground_shadow;
  const bool wire_mode = s.shading == Shading::Wireframe;
  wgpu::CommandEncoder enc = gpu_.device.CreateCommandEncoder();

  auto draw_meshes = [&](wgpu::RenderPassEncoder& pass) {
    for (const auto& sp : scene.structures())
      if (sp->visible)
        if (auto it = meshes_.find(sp.get()); it != meshes_.end() && it->second->faces) {
          pass.SetBindGroup(1, it->second->group);
          pass.Draw(3 * it->second->faces);
        }
  };
  auto draw_items = [&](wgpu::RenderPassEncoder& pass, const wgpu::RenderPipeline& pts,
                        const wgpu::RenderPipeline& arr) {
    pass.SetPipeline(pts);
    for (const auto& sp : scene.structures())
      if (sp->visible)
        if (auto it = points_.find(sp.get()); it != points_.end() && it->second->count) {
          pass.SetBindGroup(1, it->second->group);
          pass.Draw(6, it->second->count);
        }
    pass.SetPipeline(arr);
    pass.SetVertexBuffer(0, arrow_template_);
    for (const auto& sp : scene.structures())
      if (sp->visible)
        if (auto it = vectors_.find(sp.get()); it != vectors_.end() && it->second->count) {
          pass.SetBindGroup(1, it->second->group);
          pass.Draw(arrow_vertex_count_, it->second->count);
        }
  };

  // 1. Sun shadow map.
  {
    wgpu::RenderPassDepthStencilAttachment d{};
    d.view = shadow_view_;
    d.depthLoadOp = wgpu::LoadOp::Clear;
    d.depthStoreOp = wgpu::StoreOp::Store;
    d.depthClearValue = 1.0f;
    wgpu::RenderPassDescriptor rp{};
    rp.depthStencilAttachment = &d;
    wgpu::RenderPassEncoder pass = enc.BeginRenderPass(&rp);
    if (s.shadows && !wire_mode) {
      pass.SetPipeline(mesh_shadow_);
      pass.SetBindGroup(0, frame_group_);
      draw_meshes(pass);
    }
    pass.End();
  }
  // 2. Prepass: depth, normals, ids.
  {
    wgpu::RenderPassColorAttachment c[2]{};
    c[0].view = pre_normal_view_;
    c[1].view = pre_ids_view_;
    for (auto& a : c) {
      a.loadOp = wgpu::LoadOp::Clear;
      a.storeOp = wgpu::StoreOp::Store;
      a.clearValue = {0, 0, 0, 0};
    }
    wgpu::RenderPassDepthStencilAttachment d{};
    d.view = pre_depth_view_;
    d.depthLoadOp = wgpu::LoadOp::Clear;
    d.depthStoreOp = wgpu::StoreOp::Store;
    d.depthClearValue = 0.0f;
    wgpu::RenderPassDescriptor rp{};
    rp.colorAttachmentCount = 2;
    rp.colorAttachments = c;
    rp.depthStencilAttachment = &d;
    wgpu::RenderPassEncoder pass = enc.BeginRenderPass(&rp);
    pass.SetBindGroup(0, scene_group_);
    pass.SetPipeline(mesh_prepass_);
    draw_meshes(pass);
    draw_items(pass, points_prepass_, arrows_prepass_);
    if (ground) {
      pass.SetPipeline(grid_prepass_);
      pass.Draw(3);
    }
    pass.End();
  }
  // 3. Ambient occlusion.
  {
    auto fullscreen = [&](const wgpu::TextureView& target, const wgpu::RenderPipeline* p,
                          const wgpu::BindGroup* g, double clear) {
      wgpu::RenderPassColorAttachment c{};
      c.view = target;
      c.loadOp = wgpu::LoadOp::Clear;
      c.storeOp = wgpu::StoreOp::Store;
      c.clearValue = {clear, clear, clear, 1};
      wgpu::RenderPassDescriptor rp{};
      rp.colorAttachmentCount = 1;
      rp.colorAttachments = &c;
      wgpu::RenderPassEncoder pass = enc.BeginRenderPass(&rp);
      if (p) {
        pass.SetPipeline(*p);
        pass.SetBindGroup(0, *g);
        pass.Draw(3);
      }
      pass.End();
    };
    if (s.ssao && s.ao_strength > 0 && !wire_mode) {
      fullscreen(ao_raw_view_, &ssao_, &ssao_group_, 1.0);
      fullscreen(ao_view_, &blur_, &blur_group_, 1.0);
    } else {
      fullscreen(ao_view_, nullptr, nullptr, 1.0);
    }
  }
  // 4. Main color pass (4x MSAA).
  {
    wgpu::RenderPassColorAttachment c{};
    c.view = msaa_color_view_;
    c.resolveTarget = resolved_view_;
    c.loadOp = wgpu::LoadOp::Clear;
    c.storeOp = wgpu::StoreOp::Discard;
    c.clearValue = {0, 0, 0, 0};
    wgpu::RenderPassDepthStencilAttachment d{};
    d.view = msaa_depth_view_;
    d.depthLoadOp = wgpu::LoadOp::Clear;
    d.depthStoreOp = wgpu::StoreOp::Discard;
    d.depthClearValue = 0.0f;
    wgpu::RenderPassDescriptor rp{};
    rp.colorAttachmentCount = 1;
    rp.colorAttachments = &c;
    rp.depthStencilAttachment = &d;
    wgpu::RenderPassEncoder pass = enc.BeginRenderPass(&rp);
    pass.SetBindGroup(0, scene_group_);
    if (wire_mode) {
      // X-ray: grid first, then wires over everything (no depth test).
      if (ground) {
        pass.SetPipeline(grid_main_);
        pass.Draw(3);
      }
      draw_items(pass, points_main_, arrows_main_);
      pass.SetPipeline(mesh_wire_);
      draw_meshes(pass);
    } else {
      pass.SetPipeline(mesh_main_);
      draw_meshes(pass);
      draw_items(pass, points_main_, arrows_main_);
      if (ground) {
        pass.SetPipeline(grid_main_);
        pass.Draw(3);
      }
    }
    pass.End();
  }
  // 5. Composite, 6. overlays + UI, all on the final texture.
  {
    wgpu::RenderPassColorAttachment c{};
    c.view = final_view_;
    c.loadOp = wgpu::LoadOp::Clear;
    c.storeOp = wgpu::StoreOp::Store;
    wgpu::RenderPassDescriptor rp{};
    rp.colorAttachmentCount = 1;
    rp.colorAttachments = &c;
    wgpu::RenderPassEncoder pass = enc.BeginRenderPass(&rp);
    pass.SetPipeline(composite_);
    pass.SetBindGroup(0, composite_group_);
    pass.Draw(3);
    if (!overlay.lines.empty()) {
      pass.SetPipeline(lines_);
      pass.SetBindGroup(0, lines_group_);
      pass.SetBindGroup(1, lines_storage_group_);
      pass.Draw(6, uint32_t(overlay.lines.size()));
    }
    if (!glyphs.empty()) {
      pass.SetPipeline(text_);
      pass.SetBindGroup(0, text_group_);
      pass.SetBindGroup(1, text_storage_group_);
      pass.Draw(6, uint32_t(glyphs.size()));
    }
    if (ui) ui(pass);
    pass.End();
  }
  wgpu::CommandBuffer cmd = enc.Finish();
  gpu_.queue.Submit(1, &cmd);
  frame_ms_ = std::chrono::duration<float, std::milli>(std::chrono::steady_clock::now() - t0).count();
}

void Renderer::blit(const wgpu::TextureView& target, wgpu::TextureFormat format) {
  auto& p = blit_pipelines_[int(format)];
  if (!p) {
    std::string err;
    wgpu::ShaderModule m = shaders_.compile(gpu_, "blit.wgsl", {}, &err);
    if (!m) return;
    p = make_pipeline(gpu_, {m, "vs_fullscreen", "fs_blit", {blit_layout_}, {format}}, "blit");
  }
  wgpu::CommandEncoder enc = gpu_.device.CreateCommandEncoder();
  wgpu::RenderPassColorAttachment c{};
  c.view = target;
  c.loadOp = wgpu::LoadOp::Clear;
  c.storeOp = wgpu::StoreOp::Store;
  wgpu::RenderPassDescriptor rp{};
  rp.colorAttachmentCount = 1;
  rp.colorAttachments = &c;
  wgpu::RenderPassEncoder pass = enc.BeginRenderPass(&rp);
  pass.SetPipeline(p);
  pass.SetBindGroup(0, blit_group_);
  pass.Draw(3);
  pass.End();
  wgpu::CommandBuffer cmd = enc.Finish();
  gpu_.queue.Submit(1, &cmd);
}

// ---- Readback -------------------------------------------------------------------

static bool read_texture(const Gpu& gpu, const wgpu::Texture& tex, int x0, int y0, int w, int h,
                         uint32_t bytes_per_px, std::vector<uint8_t>& out) {
  uint32_t row = (uint32_t(w) * bytes_per_px + 255) & ~255u;
  wgpu::Buffer buf = gpu.create_buffer(uint64_t(row) * h, BU::CopyDst | BU::MapRead, "readback");
  wgpu::TexelCopyTextureInfo src{};
  src.texture = tex;
  src.origin = {uint32_t(x0), uint32_t(y0), 0};
  wgpu::TexelCopyBufferInfo dst{};
  dst.buffer = buf;
  dst.layout.bytesPerRow = row;
  dst.layout.rowsPerImage = uint32_t(h);
  wgpu::Extent3D e{uint32_t(w), uint32_t(h), 1};
  wgpu::CommandEncoder enc = gpu.device.CreateCommandEncoder();
  enc.CopyTextureToBuffer(&src, &dst, &e);
  wgpu::CommandBuffer cmd = enc.Finish();
  gpu.queue.Submit(1, &cmd);
  bool ok = false;
  gpu.wait(buf.MapAsync(wgpu::MapMode::Read, 0, uint64_t(row) * h, wgpu::CallbackMode::WaitAnyOnly,
                        [&ok](wgpu::MapAsyncStatus status, wgpu::StringView) {
                          ok = status == wgpu::MapAsyncStatus::Success;
                        }));
  if (!ok) return false;
  const uint8_t* data = static_cast<const uint8_t*>(buf.GetConstMappedRange());
  out.resize(size_t(w) * h * bytes_per_px);
  for (int y = 0; y < h; ++y)
    std::memcpy(&out[size_t(y) * w * bytes_per_px], data + size_t(y) * row, size_t(w) * bytes_per_px);
  buf.Unmap();
  return true;
}

std::vector<IdPixel> Renderer::read_ids(int x0, int y0, int w, int h) {
  int x1 = std::min(x0 + w, int(width_)), y1 = std::min(y0 + h, int(height_));
  x0 = std::max(x0, 0);
  y0 = std::max(y0, 0);
  std::vector<IdPixel> out;
  if (x1 <= x0 || y1 <= y0) return out;
  std::vector<uint8_t> raw;
  if (!read_texture(gpu_, pre_ids_, x0, y0, x1 - x0, y1 - y0, 16, raw)) return out;
  out.resize(raw.size() / 16);
  std::memcpy(out.data(), raw.data(), raw.size());
  return out;
}

bool Renderer::read_final(std::vector<uint8_t>& rgba) {
  return read_texture(gpu_, final_, 0, 0, int(width_), int(height_), 4, rgba);
}

}  // namespace avbd_viz
