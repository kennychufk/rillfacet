#include "avbd_viz/renderer.h"

#include <glm/gtc/matrix_transform.hpp>

#include <algorithm>
#include <bit>
#include <cmath>
#include <cstring>
#include <set>
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

static uint32_t pack_srgb(float r, float g, float b) {
  auto q = [](float x) { return uint32_t(std::lround(std::clamp(x, 0.0f, 1.0f) * 255.0f)); };
  return q(r) | (q(g) << 8) | (q(b) << 16) | (255u << 24);
}

static uint32_t pack_srgb(const glm::vec3& c) { return pack_srgb(c.r, c.g, c.b); }

static float bits_to_float(uint32_t u) {
  float f;
  std::memcpy(&f, &u, 4);
  return f;
}

static uint32_t float_to_bits(float f) {
  uint32_t u;
  std::memcpy(&u, &f, 4);
  return u;
}

// Per-element value a shader reads: the scalar (vector magnitude), or a
// packed sRGB color reinterpreted as a float.
static float attr_value(const Quantity& q, size_t i) {
  if (q.type == QuantityType::Color)
    return bits_to_float(pack_srgb(q.data[3 * i], q.data[3 * i + 1], q.data[3 * i + 2]));
  return q.value(i);
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

glm::vec4 SlicePlane::equation() const {
  glm::vec3 n(0.0f);
  n[axis] = flip ? -1.0f : 1.0f;
  return {n, flip ? -offset : offset};
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
  float iso_spacing = 0, edge_band = 2;
  glm::vec4 material{0};
};
static_assert(sizeof(MeshUniforms) == 128);

struct SegmentInfo {
  uint32_t color, flags;
  float scalar;
  uint32_t pad;
};

// Mirrors `ArrowObject` in shaders/arrows.wgsl.
struct ItemUniforms {
  glm::vec4 color;
  glm::vec4 material;
  float radius;
  float length_scale;
  uint32_t object_id;
  uint32_t flags;  // bit 1: cut by the slice plane
};

// Mirrors `PointObject` (points.wgsl) and `CurveObject` (curves.wgsl).
struct PointUniforms {
  glm::vec4 color{1.0f};
  glm::vec4 material{0.0f};
  float radius = 0;
  uint32_t color_mode = 0, object_id = 0, flags = 0;
  glm::vec2 scalar_range{0, 1};
  uint32_t cmap_row = 0, pad = 0;
};
static_assert(sizeof(PointUniforms) == 64);
using CurveUniforms = PointUniforms;

struct Renderer::MeshSelection {
  std::vector<uint32_t> faces, segments;
  int64_t active_face = -1, active_segment = -1;
  uint64_t version = 0;
};

struct Renderer::MeshGpu {
  uint64_t pos_ver = 0, topo_ver = 0, attr_ver = 0, sel_ver = 0, mask_ver = 0;
  float edge_angle = 0.0f;
  std::string color_key;
  wgpu::Buffer ubo;
  DynamicBuffer positions, triangles, face_segment, segments, vertex_attr, face_info, vertex_faces;
  wgpu::BindGroup group;
  wgpu::TextureView texture;
  MeshUniforms u;
  uint32_t faces = 0;
  bool transparent = false;
};

struct Renderer::PointsGpu {
  uint64_t pos_ver = 0, attr_ver = 0;
  std::string color_key;
  wgpu::Buffer ubo;
  DynamicBuffer points, attr;
  wgpu::BindGroup group;
  PointUniforms u;
  uint32_t count = 0;
};

struct Renderer::CurvesGpu {
  uint64_t pos_ver = 0, topo_ver = 0, attr_ver = 0;
  std::string color_key;
  wgpu::Buffer ubo;
  DynamicBuffer nodes, edges, node_attr, edge_attr;
  wgpu::BindGroup group;
  CurveUniforms u;
  uint32_t count = 0;
};

struct Renderer::VectorsGpu {
  uint64_t ver = 0, attr_ver = 0;
  wgpu::Buffer ubo;
  DynamicBuffer arrows;
  wgpu::BindGroup group;
  uint32_t count = 0;
};

// A volume mesh draws as two internal surface meshes: its boundary, clipped
// by the slice plane, and the cross-section at the plane.
struct Renderer::VolumeGpu {
  SurfaceMesh boundary, cut;
  MeshGpu boundary_gpu, cut_gpu;
  uint64_t topo = 0, pos = 0, attr = 0;
  glm::vec4 plane{0.0f};
  bool cut_active = false;
};

// ---- Pipeline construction ----------------------------------------------------

namespace {

enum class Blend { Opaque, Premultiplied, WeightedOit };

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

  using BF = wgpu::BlendFactor;
  using BO = wgpu::BlendOperation;
  wgpu::BlendState premult{}, accum{}, reveal{};
  premult.color = {BO::Add, BF::One, BF::OneMinusSrcAlpha};
  premult.alpha = premult.color;
  accum.color = {BO::Add, BF::One, BF::One};  // weighted sums
  accum.alpha = accum.color;
  reveal.color = {BO::Add, BF::Zero, BF::OneMinusSrc};  // product of (1 - alpha)
  reveal.alpha = reveal.color;
  std::vector<wgpu::ColorTargetState> targets(p.colors.size());
  for (size_t i = 0; i < p.colors.size(); ++i) {
    targets[i].format = p.colors[i];
    if (p.blend == Blend::Premultiplied && i == 0) targets[i].blend = &premult;
    if (p.blend == Blend::WeightedOit) targets[i].blend = i == 0 ? &accum : &reveal;
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
                              {4, BK::Storage}, {5, BK::Storage}, {6, BK::Storage}, {7, BK::Storage},
                              {8, BK::Texture}, {9, BK::Sampler}});
  item_layout_ = make_layout(gpu_, "item", {{0, BK::Uniform}, {1, BK::Storage}});
  points_layout_ = make_layout(gpu_, "points", {{0, BK::Uniform}, {1, BK::Storage}, {2, BK::Storage}});
  curves_layout_ = make_layout(gpu_, "curves",
                               {{0, BK::Uniform}, {1, BK::Storage}, {2, BK::Storage}, {3, BK::Storage},
                                {4, BK::Storage}});
  ssao_layout_ = make_layout(gpu_, "ssao", {{0, BK::Uniform}, {1, BK::DepthTexture}, {2, BK::Texture}});
  blur_layout_ = make_layout(gpu_, "blur", {{0, BK::Uniform}, {1, BK::DepthTexture}, {3, BK::Texture}});
  composite_layout_ = make_layout(gpu_, "composite",
                                  {{0, BK::Uniform}, {1, BK::Texture}, {2, BK::UintTexture},
                                   {3, BK::DepthTexture}, {4, BK::Texture}, {5, BK::Texture}, {6, BK::Texture}});
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

  // Stand-in for textured meshes whose image is missing.
  {
    wgpu::Texture white = gpu_.create_texture(1, 1, TF::RGBA8UnormSrgb, TU::TextureBinding | TU::CopyDst,
                                              "white");
    const uint8_t px[4] = {255, 255, 255, 255};
    wgpu::TexelCopyTextureInfo dst{};
    dst.texture = white;
    wgpu::TexelCopyBufferLayout l{};
    l.bytesPerRow = 4;
    l.rowsPerImage = 1;
    wgpu::Extent3D e{1, 1, 1};
    gpu_.queue.WriteTexture(&dst, px, 4, &l, &e);
    white_view_ = white.CreateView();
  }

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
  const char* styled[] = {"mesh.wgsl", "points.wgsl", "curves.wgsl", "arrows.wgsl"};
  const char* plain[] = {"grid.wgsl", "ssao.wgsl", "composite.wgsl", "overlay_lines.wgsl", "overlay_text.wgsl"};
  std::map<std::string, wgpu::ShaderModule> mod;
  for (const char* f : styled)
    if (!(mod[f] = shaders_.compile(gpu_, f, style, &err))) break;
  if (err.empty())
    for (const char* f : plain)
      if (!(mod[f] = shaders_.compile(gpu_, f, {}, &err))) break;
  if (!err.empty()) {
    shader_error_ = err;
    if (error) *error = err;
    return false;
  }

  const TF hdr = TF::RGBA16Float, depth = TF::Depth32Float;
  const std::vector<TF> prepass_targets = {TF::RGBA16Float, TF::RGBA32Uint};
  const std::vector<TF> oit_targets = {TF::RGBA16Float, TF::R16Float};
  using CF = wgpu::CompareFunction;
  wgpu::VertexAttribute attr{};
  attr.format = wgpu::VertexFormat::Float32x2;
  wgpu::VertexBufferLayout arrow_vbl{};
  arrow_vbl.arrayStride = sizeof(glm::vec2);
  arrow_vbl.attributeCount = 1;
  arrow_vbl.attributes = &attr;
  const auto& mesh = mod["mesh.wgsl"];
  const auto& points = mod["points.wgsl"];
  const auto& curves = mod["curves.wgsl"];
  const auto& arrows = mod["arrows.wgsl"];
  const auto& grid = mod["grid.wgsl"];
  const auto& ssao = mod["ssao.wgsl"];
  const std::vector<wgpu::BindGroupLayout> mesh_l = {scene_layout_, mesh_layout_};

  gpu_.push_error_scope();
  auto mk = [&](PipelineSpec p, const char* label) { return make_pipeline(gpu_, p, label); };
  auto mesh_main = mk({mesh, "vs_main", "fs_main", mesh_l, {hdr}, Blend::Opaque, depth, true, CF::Greater, 4}, "mesh main");
  auto mesh_transparent = mk({mesh, "vs_main", "fs_transparent", mesh_l, oit_targets, Blend::WeightedOit, depth,
                              false, CF::Greater, 4}, "mesh transparent");
  auto mesh_wire = mk({mesh, "vs_main", "fs_wire", mesh_l, {hdr}, Blend::Premultiplied, depth, false, CF::Always, 4},
                      "mesh wire");
  auto mesh_pre = mk({mesh, "vs_main", "fs_prepass", mesh_l, prepass_targets, Blend::Opaque, depth}, "mesh prepass");
  auto mesh_shadow = mk({mesh, "vs_shadow", "fs_shadow", {frame_layout_, mesh_layout_}, {}, Blend::Opaque, depth,
                         true, CF::Less}, "mesh shadow");
  auto points_main = mk({points, "vs_main", "fs_main", {scene_layout_, points_layout_}, {hdr}, Blend::Opaque, depth,
                         true, CF::Greater, 4}, "points main");
  auto points_pre = mk({points, "vs_main", "fs_prepass", {scene_layout_, points_layout_}, prepass_targets,
                        Blend::Opaque, depth}, "points prepass");
  auto curves_main = mk({curves, "vs_main", "fs_main", {scene_layout_, curves_layout_}, {hdr}, Blend::Opaque, depth,
                         true, CF::Greater, 4}, "curves main");
  auto curves_pre = mk({curves, "vs_main", "fs_prepass", {scene_layout_, curves_layout_}, prepass_targets,
                        Blend::Opaque, depth}, "curves prepass");
  auto arrows_main = mk({arrows, "vs_main", "fs_main", {scene_layout_, item_layout_}, {hdr}, Blend::Opaque, depth,
                         true, CF::Greater, 4, &arrow_vbl}, "arrows main");
  auto arrows_pre = mk({arrows, "vs_main", "fs_prepass", {scene_layout_, item_layout_}, prepass_targets,
                        Blend::Opaque, depth, true, CF::Greater, 1, &arrow_vbl}, "arrows prepass");
  auto grid_main = mk({grid, "vs_fullscreen", "fs_main", {scene_layout_}, {hdr}, Blend::Premultiplied, depth, false,
                       CF::Greater, 4}, "grid main");
  auto grid_pre = mk({grid, "vs_fullscreen", "fs_prepass", {scene_layout_}, prepass_targets, Blend::Opaque, depth},
                     "grid prepass");
  auto ssao_p = mk({ssao, "vs_fullscreen", "fs_ssao", {ssao_layout_}, {TF::R8Unorm}}, "ssao");
  auto blur_p = mk({ssao, "vs_fullscreen", "fs_blur", {blur_layout_}, {TF::R8Unorm}}, "ssao blur");
  auto comp_p = mk({mod["composite.wgsl"], "vs_fullscreen", "fs_composite", {composite_layout_}, {kFinalFormat}},
                   "composite");
  auto lines_p = mk({mod["overlay_lines.wgsl"], "vs_main", "fs_main", {lines_layout_, storage_layout_},
                     {kFinalFormat}, Blend::Premultiplied}, "overlay lines");
  auto text_p = mk({mod["overlay_text.wgsl"], "vs_main", "fs_main", {text_layout_, storage_layout_}, {kFinalFormat},
                    Blend::Premultiplied}, "overlay text");
  err = gpu_.pop_error_scope();
  if (!err.empty()) {
    shader_error_ = err;
    if (error) *error = err;
    return false;
  }
  mesh_main_ = mesh_main, mesh_transparent_ = mesh_transparent, mesh_wire_ = mesh_wire;
  mesh_prepass_ = mesh_pre, mesh_shadow_ = mesh_shadow;
  points_main_ = points_main, points_prepass_ = points_pre;
  curves_main_ = curves_main, curves_prepass_ = curves_pre;
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
  const auto sampled = TU::RenderAttachment | TU::TextureBinding;
  make(msaa_color_, msaa_color_view_, TF::RGBA16Float, TU::RenderAttachment, "msaa color", 4);
  make(msaa_depth_, msaa_depth_view_, TF::Depth32Float, TU::RenderAttachment, "msaa depth", 4);
  make(resolved_, resolved_view_, TF::RGBA16Float, sampled, "resolved");
  make(oit_accum_msaa_, oit_accum_msaa_view_, TF::RGBA16Float, TU::RenderAttachment, "oit accum msaa", 4);
  make(oit_reveal_msaa_, oit_reveal_msaa_view_, TF::R16Float, TU::RenderAttachment, "oit reveal msaa", 4);
  make(oit_accum_, oit_accum_view_, TF::RGBA16Float, sampled, "oit accum");
  make(oit_reveal_, oit_reveal_view_, TF::R16Float, sampled, "oit reveal");
  make(pre_depth_, pre_depth_view_, TF::Depth32Float, sampled, "prepass depth");
  make(pre_normal_, pre_normal_view_, TF::RGBA16Float, sampled, "normals");
  make(pre_ids_, pre_ids_view_, TF::RGBA32Uint, sampled | TU::CopySrc, "ids");
  make(ao_raw_, ao_raw_view_, TF::R8Unorm, sampled, "ao raw");
  make(ao_, ao_view_, TF::R8Unorm, sampled, "ao");
  make(final_, final_view_, kFinalFormat, sampled | TU::CopySrc, "final");
  scene_image_ = gpu_.create_texture(w, h, kFinalFormat, TU::CopyDst | TU::CopySrc, "scene image");

  ssao_group_ = make_group(gpu_, ssao_layout_, {{0, frame_ubo_}, {1, pre_depth_view_}, {2, pre_normal_view_}});
  blur_group_ = make_group(gpu_, blur_layout_, {{0, frame_ubo_}, {1, pre_depth_view_}, {3, ao_raw_view_}});
  composite_group_ = make_group(gpu_, composite_layout_,
                                {{0, frame_ubo_}, {1, resolved_view_}, {2, pre_ids_view_}, {3, pre_depth_view_},
                                 {4, pre_normal_view_}, {5, oit_accum_view_}, {6, oit_reveal_view_}});
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

wgpu::TextureView Renderer::image_view(const Scene& scene, const std::string& name) {
  const Scene::Image* im = scene.image(name);
  if (!im || !im->width || !im->height || im->rgba.size() < size_t(im->width) * im->height * 4) {
    if (auto it = images_.find(name); it != images_.end()) {
      retired_images_.push_back(it->second.texture);
      images_.erase(it);
    }
    return white_view_;
  }
  ImageGpu& g = images_[name];
  if (g.width != im->width || g.height != im->height || !g.texture) {
    if (g.texture) retired_images_.push_back(g.texture);
    g.texture = gpu_.create_texture(im->width, im->height, wgpu::TextureFormat::RGBA8UnormSrgb,
                                    wgpu::TextureUsage::TextureBinding | wgpu::TextureUsage::CopyDst,
                                    name.c_str());
    g.view = g.texture.CreateView();
    g.width = im->width;
    g.height = im->height;
    g.version = 0;
  }
  if (g.version != im->version) {
    wgpu::TexelCopyTextureInfo dst{};
    dst.texture = g.texture;
    wgpu::TexelCopyBufferLayout l{};
    l.bytesPerRow = 4 * im->width;
    l.rowsPerImage = im->height;
    wgpu::Extent3D e{im->width, im->height, 1};
    gpu_.queue.WriteTexture(&dst, im->rgba.data(), size_t(im->width) * im->height * 4, &l, &e);
    g.version = im->version;
  }
  return g.view;
}

void Renderer::sync_mesh(MeshGpu& g, const SurfaceMesh& m, uint32_t object_id, const MeshSelection& sel,
                         bool clip, float edge_angle, float edge_band) {
  const BU storage = BU::Storage;
  if (!g.ubo) g.ubo = gpu_.create_buffer(sizeof(MeshUniforms), BU::Uniform | BU::CopyDst, "mesh uniforms");
  bool rebind = !g.group;
  if (g.pos_ver != m.positions_version()) {
    rebind |= g.positions.upload(gpu_, m.positions().data(), m.positions().size() * 4, storage, "positions");
    g.pos_ver = m.positions_version();
  }
  if (g.topo_ver != m.topology_version()) {
    rebind |= g.triangles.upload(gpu_, m.triangles().data(), m.triangles().size() * 4, storage, "triangles");
    rebind |= g.face_segment.upload(gpu_, m.face_segment().data(), m.face_segment().size() * 4, storage,
                                    "face segment");
    rebind |= g.vertex_faces.upload(gpu_, m.vertex_faces().data(), m.vertex_faces().size() * 4, storage,
                                    "vertex faces");
    g.faces = uint32_t(m.num_faces());
    g.topo_ver = m.topology_version();
  }

  // What colors the mesh (modes as in base_color() of mesh.wgsl).
  const Quantity* q = m.coloring_quantity();
  uint32_t mode = m.color_source == ColorSource::SegmentPalette ? 1 : 0;
  const bool textured = m.color_source == ColorSource::Texture && !m.texture.empty() &&
                        m.uvs().size() == 2 * m.num_vertices() && sync_scene_;
  wgpu::TextureView tex = textured ? image_view(*sync_scene_, m.texture) : white_view_;
  if (g.texture.Get() != tex.Get()) {
    g.texture = tex;
    rebind = true;
  }
  if (textured) {
    mode = 9;
  } else if (q) {
    bool rgb = q->type == QuantityType::Color;
    switch (q->on) {
      case ElementKind::Vertex: mode = rgb ? 5 : 2; break;
      case ElementKind::Face: mode = rgb ? 6 : 3; break;
      case ElementKind::Segment: mode = rgb ? 1 : 4; break;
      case ElementKind::Edge: mode = rgb ? 8 : 7; break;
      default: mode = 0; break;
    }
  }
  std::string key = std::to_string(mode) + (textured ? m.texture : q ? q->name : "");
  bool mask_stale = g.edge_angle != edge_angle || (edge_angle > 0 && !m.rigid_segments && g.mask_ver != m.positions_version());
  if (g.attr_ver != m.attributes_version() || g.sel_ver != sel.version || g.color_key != key || mask_stale) {
    size_t nf = m.num_faces(), ns = m.num_segments();
    std::vector<SegmentInfo> segs(std::max<size_t>(ns, 1), SegmentInfo{0, 0, 0.0f, 0});
    for (size_t k = 0; k < ns; ++k) {
      bool seg_rgb = q && q->on == ElementKind::Segment && q->type == QuantityType::Color;
      segs[k].color = seg_rgb ? float_to_bits(attr_value(*q, k)) : pack_srgb(m.segment_color(uint32_t(k)));
      segs[k].flags = m.segment_visible(uint32_t(k)) ? 0u : 1u;
      segs[k].scalar = mode == 4 ? q->value(k) : 0.0f;
    }
    for (uint32_t k : sel.segments)
      if (k < segs.size()) segs[k].flags |= 2u;
    if (sel.active_segment >= 0 && size_t(sel.active_segment) < segs.size()) segs[sel.active_segment].flags |= 4u;

    std::vector<uint32_t> face_info(2 * std::max<size_t>(nf, 1), 0);
    if (mode == 3 || mode == 6)
      for (size_t f = 0; f < nf; ++f) face_info[2 * f] = float_to_bits(attr_value(*q, f));
    for (uint32_t f : sel.faces)
      if (f < nf) face_info[2 * f + 1] |= 1u;
    if (sel.active_face >= 0 && size_t(sel.active_face) < nf) face_info[2 * sel.active_face + 1] |= 2u;
    if (edge_angle > 0) {
      const auto& flat = m.flat_edge_mask(edge_angle);
      for (size_t f = 0; f < flat.size(); ++f) face_info[2 * f + 1] |= uint32_t(flat[f]) << 2;
    }

    std::vector<float> attr(1, 0.0f);
    if (mode == 2 || mode == 5) {
      attr.resize(std::max<size_t>(m.num_vertices(), 1));
      for (size_t i = 0; i < m.num_vertices(); ++i) attr[i] = attr_value(*q, i);
    } else if (mode == 9) {
      // Texture coordinates packed as two unorm16 (bitcast in the shader).
      const auto& uv = m.uvs();
      attr.resize(std::max<size_t>(m.num_vertices(), 1));
      for (size_t i = 0; i < m.num_vertices(); ++i) {
        glm::vec2 t = glm::clamp(glm::vec2(uv[2 * i], uv[2 * i + 1]), 0.0f, 1.0f);
        uint32_t packed = uint32_t(std::lround(t.x * 65535.0f)) | (uint32_t(std::lround(t.y * 65535.0f)) << 16);
        attr[i] = std::bit_cast<float>(packed);
      }
    } else if (mode == 7 || mode == 8) {
      const auto& fe = m.face_edges();
      attr.resize(std::max<size_t>(3 * nf, 1));
      for (size_t k = 0; k < 3 * nf; ++k) attr[k] = attr_value(*q, fe[k]);
    }
    rebind |= g.segments.upload(gpu_, segs.data(), segs.size() * sizeof(SegmentInfo), storage, "segments");
    rebind |= g.face_info.upload(gpu_, face_info.data(), face_info.size() * 4, storage, "face info");
    rebind |= g.vertex_attr.upload(gpu_, attr.data(), attr.size() * 4, storage, "vertex attr");
    g.u.scalar_range = m.color_range();
    g.attr_ver = m.attributes_version();
    g.sel_ver = sel.version;
    g.color_key = key;
    g.edge_angle = edge_angle;
    g.mask_ver = m.positions_version();
  }
  g.u.base_color = glm::vec4(srgb_to_linear(m.color), std::clamp(m.opacity, 0.0f, 1.0f));
  g.u.color_mode = mode;
  g.u.cmap_row = uint32_t(std::clamp(m.colormap, 0, kColormapCount - 1));
  g.u.flags = (m.isolines ? 1u : 0u) | (clip ? 2u : 0u) | (m.smooth_shading ? 4u : 0u) | (m.unlit ? 8u : 0u);
  g.u.object_id = object_id;
  if (!m.auto_range) g.u.scalar_range = m.range;
  g.u.iso_spacing = m.isoline_spacing;
  g.u.edge_band = edge_band;
  g.u.material = glm::vec4(m.metallic, m.roughness, 0, 0);
  gpu_.queue.WriteBuffer(g.ubo, 0, &g.u, sizeof(MeshUniforms));
  g.transparent = m.opacity < 0.999f;
  if (rebind)
    g.group = make_group(gpu_, mesh_layout_,
                         {{0, g.ubo}, {1, g.positions.buffer}, {2, g.triangles.buffer}, {3, g.face_segment.buffer},
                          {4, g.segments.buffer}, {5, g.vertex_attr.buffer}, {6, g.face_info.buffer},
                          {7, g.vertex_faces.buffer}, {8, g.texture}, {9, clamp_sampler_}});
}

void Renderer::sync_volume(VolumeGpu& g, const VolumeMesh& v, const RenderSettings& s, const Selection& sel) {
  const bool slicing = s.slice.enabled && v.sliced;
  const glm::vec4 plane = s.slice.equation();
  bool geometry = false;
  if (g.topo != v.topology_version()) {
    const auto& bf = v.boundary_faces();
    g.boundary.set_geometry(v.positions().data(), v.num_vertices(), bf.data(), bf.size() / 3);
    g.topo = v.topology_version();
    g.pos = v.positions_version();
    geometry = true;
  } else if (g.pos != v.positions_version()) {
    g.boundary.set_positions(v.positions().data());
    g.pos = v.positions_version();
    geometry = true;
  }
  bool cut_changed = false;
  if (slicing && (geometry || !g.cut_active || plane != g.plane)) {
    const VolumeMesh::Section& sec = v.slice(glm::vec3(plane), plane.w);
    size_t nt = sec.triangles.size() / 3;
    g.cut.set_geometry(sec.positions.data(), sec.positions.size() / 3, sec.triangles.data(), nt);
    g.cut.set_segments({0, 0, uint32_t(nt)});  // all faces in segment 1: tells cut from boundary when picking
    g.plane = plane;
    cut_changed = true;
  }
  g.cut_active = slicing;

  // Both derived meshes take the volume's coloring; its quantity is copied
  // over (vertex values interpolated onto the cut, cell values per face).
  if (geometry || cut_changed || g.attr != v.attributes_version()) {
    const Quantity* q = v.coloring_quantity();
    const glm::vec2 r = v.color_range();
    for (SurfaceMesh* m : {&g.boundary, &g.cut}) {
      m->color = v.color;
      m->colormap = v.colormap;
      m->auto_range = false;
      m->range = r;
      m->isolines = v.isolines;
      m->isoline_spacing = v.isoline_spacing;
      m->metallic = v.metallic;
      m->roughness = v.roughness;
      m->color_source = q ? ColorSource::Quantity : ColorSource::Uniform;
      m->color_quantity = "value";
    }
    if (q && (q->on == ElementKind::Vertex || q->on == ElementKind::Cell)) {
      const int dims = q->type == QuantityType::Color ? 3 : 1;
      auto get = [&](size_t i, int c) { return dims == 3 ? q->data[3 * i + c] : q->value(i); };
      auto put = [&](SurfaceMesh& m, ElementKind on, std::vector<float> data) {
        if (dims == 3)
          m.add_color("value", on, std::move(data));
        else
          m.add_scalar("value", on, std::move(data));
      };
      const VolumeMesh::Section& sec = v.last_section();
      if (q->on == ElementKind::Vertex) {
        std::vector<float> bd(dims * v.num_vertices());
        for (size_t i = 0; i < v.num_vertices(); ++i)
          for (int c = 0; c < dims; ++c) bd[dims * i + c] = get(i, c);
        put(g.boundary, ElementKind::Vertex, std::move(bd));
        if (slicing) {
          std::vector<float> cd(dims * sec.vertex_t.size());
          for (size_t j = 0; j < sec.vertex_t.size(); ++j)
            for (int c = 0; c < dims; ++c)
              cd[dims * j + c] = glm::mix(get(sec.vertex_pair[2 * j], c), get(sec.vertex_pair[2 * j + 1], c),
                                          sec.vertex_t[j]);
          put(g.cut, ElementKind::Vertex, std::move(cd));
        }
      } else {
        const auto& bc = v.boundary_cells();
        std::vector<float> bd(dims * bc.size());
        for (size_t f = 0; f < bc.size(); ++f)
          for (int c = 0; c < dims; ++c) bd[dims * f + c] = get(bc[f], c);
        put(g.boundary, ElementKind::Face, std::move(bd));
        if (slicing) {
          std::vector<float> cd(dims * sec.face_cell.size());
          for (size_t f = 0; f < sec.face_cell.size(); ++f)
            for (int c = 0; c < dims; ++c) cd[dims * f + c] = get(sec.face_cell[f], c);
          put(g.cut, ElementKind::Face, std::move(cd));
        }
      }
    }
    g.boundary.touch_attributes();
    g.cut.touch_attributes();
    g.attr = v.attributes_version();
  }
  g.boundary.opacity = v.opacity;

  MeshSelection ms;
  ms.version = sel.version();
  if (sel.mode() == PickMode::Segment && sel.contains({v.id(), 0})) ms.segments = {0, 1};
  sync_mesh(g.boundary_gpu, g.boundary, v.id(), ms, slicing, 0.0f, 2.0f);
  if (slicing) sync_mesh(g.cut_gpu, g.cut, v.id(), ms, false, 0.0f, 2.0f);
}

void Renderer::sync_arrows(const QuantityStructure& s, bool clip) {
  for (const Quantity& q : s.quantities()) {
    if (q.type != QuantityType::Vector || !q.show_arrows || s.count(q.on) == 0) continue;
    auto& slot = quantity_arrows_[{s.id(), q.name}];
    if (!slot) {
      slot = std::make_unique<VectorsGpu>();
      slot->ubo = gpu_.create_buffer(sizeof(ItemUniforms), BU::Uniform | BU::CopyDst, "arrow uniforms");
    }
    VectorsGpu& g = *slot;
    size_t n = std::min(s.count(q.on), q.data.size() / 3);
    float mean_len = 0.0f;
    if (g.ver != s.positions_version() || g.attr_ver != s.attributes_version() || !g.group) {
      std::vector<glm::vec4> packed(std::max<size_t>(2 * n, 2), glm::vec4(0));
      for (size_t i = 0; i < n; ++i) {
        packed[2 * i] = glm::vec4(s.element_position(q.on, uint32_t(i)), 0);
        packed[2 * i + 1] = glm::vec4(q.data[3 * i], q.data[3 * i + 1], q.data[3 * i + 2], 0);
      }
      if (g.arrows.upload(gpu_, packed.data(), packed.size() * sizeof(glm::vec4), BU::Storage, "arrows") || !g.group)
        g.group = make_group(gpu_, item_layout_, {{0, g.ubo}, {1, g.arrows.buffer}});
      g.count = uint32_t(n);
      g.ver = s.positions_version();
      g.attr_ver = s.attributes_version();
    }
    for (size_t i = 0; i < n; ++i) mean_len += q.value(i);
    mean_len = n ? mean_len / float(n) * q.arrow_scale : 0.0f;
    float radius = q.arrow_radius > 0 ? q.arrow_radius : std::max(0.04f * mean_len, 1e-5f);
    ItemUniforms u{glm::vec4(srgb_to_linear(q.arrow_color), 1), glm::vec4(0, 0.4f, 0, 0), radius, q.arrow_scale, 0,
                   clip ? 2u : 0u};
    gpu_.queue.WriteBuffer(g.ubo, 0, &u, sizeof(u));
    draw_arrows_.push_back(&g);
  }
}

void Renderer::sync(const Scene& scene, const RenderSettings& settings, const Selection& sel) {
  sync_scene_ = &scene;
  std::erase_if(images_, [&](auto& kv) {
    if (scene.image(kv.first)) return false;
    retired_images_.push_back(kv.second.texture);
    return true;
  });
  // Drop GPU copies of removed structures (and arrows no longer shown).
  std::unordered_set<uint32_t> alive;
  std::set<std::pair<uint32_t, std::string>> arrows_alive;
  for (const auto& s : scene.structures()) {
    alive.insert(s->id());
    if (auto* qs = dynamic_cast<const QuantityStructure*>(s.get()))
      for (const Quantity& q : qs->quantities())
        if (q.show_arrows && q.type == QuantityType::Vector) arrows_alive.insert({s->id(), q.name});
  }
  auto prune = [&](auto& map) { std::erase_if(map, [&](auto& kv) { return !alive.count(kv.first); }); };
  prune(meshes_);
  prune(points_);
  prune(curves_);
  prune(vectors_);
  prune(volumes_);
  std::erase_if(quantity_arrows_, [&](auto& kv) { return !arrows_alive.count(kv.first); });
  opaque_meshes_.clear();
  transparent_meshes_.clear();
  draw_points_.clear();
  draw_curves_.clear();
  draw_arrows_.clear();

  const bool solid = settings.shading == Shading::Solid;
  const float edge_angle = std::max(settings.flat_edge_angle, 0.0f);
  const float edge_band = std::max(2.0f, 1.5f * settings.wire_width);
  auto whole_selected = [&](uint32_t id) { return sel.mode() == PickMode::Segment && sel.contains({id, 0}); };
  auto clip = [&](const Structure& s) { return settings.slice.enabled && s.sliced; };
  const BU storage = BU::Storage;

  // Faces/segments selected per mesh for the current pick mode.
  std::unordered_map<uint32_t, MeshSelection> mesh_sel;
  for (const ElementRef& e : sel.items()) {
    if (sel.mode() == PickMode::Face) mesh_sel[e.object].faces.push_back(e.index);
    if (sel.mode() == PickMode::Segment) mesh_sel[e.object].segments.push_back(e.index);
  }
  if (const ElementRef* a = sel.active()) {
    if (sel.mode() == PickMode::Face) mesh_sel[a->object].active_face = a->index;
    if (sel.mode() == PickMode::Segment) mesh_sel[a->object].active_segment = a->index;
  }

  for (const auto& sp : scene.structures()) {
    const Structure* s = sp.get();
    if (auto* qs = dynamic_cast<const QuantityStructure*>(s); qs && s->visible) sync_arrows(*qs, clip(*qs));
    if (auto* m = dynamic_cast<const SurfaceMesh*>(s)) {
      auto& slot = meshes_[m->id()];
      if (!slot) slot = std::make_unique<MeshGpu>();
      MeshSelection& ms = mesh_sel[m->id()];
      ms.version = sel.version();
      sync_mesh(*slot, *m, m->id(), ms, clip(*m), edge_angle, edge_band);
      if (m->visible && slot->faces)
        (slot->transparent && solid ? transparent_meshes_ : opaque_meshes_).push_back(slot.get());
    } else if (auto* v = dynamic_cast<const VolumeMesh*>(s)) {
      auto& slot = volumes_[v->id()];
      if (!slot) slot = std::make_unique<VolumeGpu>();
      sync_volume(*slot, *v, settings, sel);
      if (v->visible) {
        MeshGpu& b = slot->boundary_gpu;
        if (b.faces) (b.transparent && solid ? transparent_meshes_ : opaque_meshes_).push_back(&b);
        if (slot->cut_active && slot->cut_gpu.faces) opaque_meshes_.push_back(&slot->cut_gpu);
      }
    } else if (auto* p = dynamic_cast<const PointCloud*>(s)) {
      auto& slot = points_[p->id()];
      if (!slot) {
        slot = std::make_unique<PointsGpu>();
        slot->ubo = gpu_.create_buffer(sizeof(PointUniforms), BU::Uniform | BU::CopyDst, "points uniforms");
      }
      PointsGpu& g = *slot;
      bool rebind = !g.group;
      if (g.pos_ver != p->positions_version()) {
        rebind |= g.points.upload(gpu_, p->packed().data(), p->packed().size() * 4, storage, "points");
        g.count = uint32_t(p->size());
        g.pos_ver = p->positions_version();
      }
      const Quantity* q = p->coloring_quantity();
      uint32_t mode = q ? (q->type == QuantityType::Color ? 5 : 2) : 0;
      std::string key = std::to_string(mode) + (q ? q->name : "");
      if (g.attr_ver != p->attributes_version() || g.color_key != key || rebind) {
        std::vector<float> attr(std::max<size_t>(p->size(), 1), 0.0f);
        if (q)
          for (size_t i = 0; i < p->size(); ++i) attr[i] = attr_value(*q, i);
        rebind |= g.attr.upload(gpu_, attr.data(), attr.size() * 4, storage, "point attr");
        g.u.scalar_range = p->color_range();
        g.attr_ver = p->attributes_version();
        g.color_key = key;
      }
      g.u.color = glm::vec4(srgb_to_linear(p->color), 1);
      g.u.material = glm::vec4(p->metallic, p->roughness, 0, 0);
      g.u.radius = p->radius;
      g.u.color_mode = mode;
      g.u.object_id = p->id();
      g.u.flags = (clip(*p) ? 2u : 0u) | (whole_selected(p->id()) ? 8u : 0u);
      if (!p->auto_range) g.u.scalar_range = p->range;
      g.u.cmap_row = uint32_t(std::clamp(p->colormap, 0, kColormapCount - 1));
      gpu_.queue.WriteBuffer(g.ubo, 0, &g.u, sizeof(g.u));
      if (rebind) g.group = make_group(gpu_, points_layout_, {{0, g.ubo}, {1, g.points.buffer}, {2, g.attr.buffer}});
      if (p->visible && g.count) draw_points_.push_back(&g);
    } else if (auto* c = dynamic_cast<const CurveNetwork*>(s)) {
      auto& slot = curves_[c->id()];
      if (!slot) {
        slot = std::make_unique<CurvesGpu>();
        slot->ubo = gpu_.create_buffer(sizeof(CurveUniforms), BU::Uniform | BU::CopyDst, "curve uniforms");
      }
      CurvesGpu& g = *slot;
      bool rebind = !g.group;
      if (g.pos_ver != c->positions_version()) {
        rebind |= g.nodes.upload(gpu_, c->nodes().data(), c->nodes().size() * 4, storage, "nodes");
        g.pos_ver = c->positions_version();
      }
      if (g.topo_ver != c->topology_version()) {
        rebind |= g.edges.upload(gpu_, c->edges().data(), c->edges().size() * 4, storage, "edges");
        g.count = uint32_t(c->num_edges());
        g.topo_ver = c->topology_version();
      }
      const Quantity* q = c->coloring_quantity();
      bool rgb = q && q->type == QuantityType::Color;
      uint32_t mode = !q ? 0 : q->on == ElementKind::Vertex ? (rgb ? 5 : 2) : (rgb ? 6 : 3);
      std::string key = std::to_string(mode) + (q ? q->name : "");
      if (g.attr_ver != c->attributes_version() || g.color_key != key || rebind) {
        std::vector<float> na(std::max<size_t>(c->num_nodes(), 1), 0.0f), ea(std::max<size_t>(c->num_edges(), 1), 0.0f);
        if (q && q->on == ElementKind::Vertex)
          for (size_t i = 0; i < c->num_nodes(); ++i) na[i] = attr_value(*q, i);
        if (q && q->on == ElementKind::Edge)
          for (size_t i = 0; i < c->num_edges(); ++i) ea[i] = attr_value(*q, i);
        rebind |= g.node_attr.upload(gpu_, na.data(), na.size() * 4, storage, "node attr");
        rebind |= g.edge_attr.upload(gpu_, ea.data(), ea.size() * 4, storage, "edge attr");
        g.u.scalar_range = c->color_range();
        g.attr_ver = c->attributes_version();
        g.color_key = key;
      }
      g.u.color = glm::vec4(srgb_to_linear(c->color), 1);
      g.u.material = glm::vec4(c->metallic, c->roughness, 0, 0);
      g.u.radius = c->radius;
      g.u.color_mode = mode;
      g.u.object_id = c->id();
      g.u.flags = (clip(*c) ? 2u : 0u) | (whole_selected(c->id()) ? 8u : 0u);
      if (!c->auto_range) g.u.scalar_range = c->range;
      g.u.cmap_row = uint32_t(std::clamp(c->colormap, 0, kColormapCount - 1));
      gpu_.queue.WriteBuffer(g.ubo, 0, &g.u, sizeof(g.u));
      if (rebind)
        g.group = make_group(gpu_, curves_layout_,
                             {{0, g.ubo}, {1, g.nodes.buffer}, {2, g.edges.buffer}, {3, g.node_attr.buffer},
                              {4, g.edge_attr.buffer}});
      if (c->visible && g.count) draw_curves_.push_back(&g);
    } else if (auto* v = dynamic_cast<const VectorSet*>(s)) {
      auto& slot = vectors_[v->id()];
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
                     v->length_scale, v->id(), clip(*v) ? 2u : 0u};
      gpu_.queue.WriteBuffer(g.ubo, 0, &u, sizeof(u));
      if (rebind) g.group = make_group(gpu_, item_layout_, {{0, g.ubo}, {1, g.arrows.buffer}});
      if (v->visible && g.count) draw_arrows_.push_back(&g);
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
  f.slice = s.slice.equation();
  for (int k = 0; k < 9; ++k) f.sh[k] = glm::vec4(env_.sh[k], 0);
  gpu_.queue.WriteBuffer(frame_ubo_, 0, &f, sizeof(FrameUniforms));
}

// ---- Frame ----------------------------------------------------------------------

void Renderer::render(const Scene& scene, const Camera& camera, const RenderSettings& s,
                      const Selection& sel, const Overlay& overlay,
                      const std::function<void(wgpu::RenderPassEncoder&)>& ui) {
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
  for (const TextLabel& l : overlay.labels) {
    float size_px = l.size_px;
    if (l.world_height > 0.0f) {
      if (!camera.ortho && glm::dot(l.anchor - camera.eye(), camera.forward()) <= camera.near_plane()) continue;
      size_px = l.world_height / std::max(camera.pixel_size_at(l.anchor, float(height_)), 1e-12f);
      if (size_px < l.min_px) continue;
    }
    font_.layout(l.text, l.anchor, size_px, l.align, l.offset, l.color, l.halo, l.halo_px, l.hidden_alpha,
                 l.ignore_depth, glyphs);
  }
  if (lines_buffer_.upload(gpu_, overlay.lines.data(), std::max<size_t>(overlay.lines.size() * sizeof(OverlayLine), 256),
                           BU::Storage, "overlay lines") || !lines_storage_group_)
    lines_storage_group_ = make_group(gpu_, storage_layout_, {{0, lines_buffer_.buffer}});
  if (text_buffer_.upload(gpu_, glyphs.data(), std::max<size_t>(glyphs.size() * sizeof(GlyphInstance), 256),
                          BU::Storage, "glyphs") || !text_storage_group_)
    text_storage_group_ = make_group(gpu_, storage_layout_, {{0, text_buffer_.buffer}});

  const bool ground = s.grid || s.ground_shadow;
  const bool wire_mode = s.shading == Shading::Wireframe;
  const bool see_through = !wire_mode && !transparent_meshes_.empty();
  wgpu::CommandEncoder enc = gpu_.device.CreateCommandEncoder();

  auto draw_meshes = [&](wgpu::RenderPassEncoder& pass, const std::vector<MeshGpu*>& list) {
    for (MeshGpu* g : list) {
      pass.SetBindGroup(1, g->group);
      pass.Draw(3 * g->faces);
    }
  };
  auto draw_items = [&](wgpu::RenderPassEncoder& pass, bool prepass) {
    pass.SetPipeline(prepass ? points_prepass_ : points_main_);
    for (PointsGpu* g : draw_points_) {
      pass.SetBindGroup(1, g->group);
      pass.Draw(6, g->count);
    }
    pass.SetPipeline(prepass ? curves_prepass_ : curves_main_);
    for (CurvesGpu* g : draw_curves_) {
      pass.SetBindGroup(1, g->group);
      pass.Draw(36, g->count);
    }
    pass.SetPipeline(prepass ? arrows_prepass_ : arrows_main_);
    pass.SetVertexBuffer(0, arrow_template_);
    for (VectorsGpu* g : draw_arrows_) {
      pass.SetBindGroup(1, g->group);
      pass.Draw(arrow_vertex_count_, g->count);
    }
  };
  // In wireframe shading every mesh is drawn (and pickable) as wires.
  std::vector<MeshGpu*> all_meshes = opaque_meshes_;
  all_meshes.insert(all_meshes.end(), transparent_meshes_.begin(), transparent_meshes_.end());
  const std::vector<MeshGpu*>& picked_meshes = wire_mode ? all_meshes : opaque_meshes_;

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
      draw_meshes(pass, opaque_meshes_);
    }
    pass.End();
  }
  // 2. Prepass: depth, normals, ids (see-through surfaces take no part).
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
    draw_meshes(pass, picked_meshes);
    draw_items(pass, true);
    if (ground) {
      pass.SetPipeline(grid_prepass_);
      pass.Draw(3);
    }
    pass.End();
  }
  auto fullscreen = [&](const wgpu::TextureView& target, const wgpu::RenderPipeline* p, const wgpu::BindGroup* g,
                        double clear) {
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
  // 3. Ambient occlusion.
  if (s.ssao && s.ao_strength > 0 && !wire_mode) {
    fullscreen(ao_raw_view_, &ssao_, &ssao_group_, 1.0);
    fullscreen(ao_view_, &blur_, &blur_group_, 1.0);
  } else {
    fullscreen(ao_view_, nullptr, nullptr, 1.0);
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
    d.depthStoreOp = see_through ? wgpu::StoreOp::Store : wgpu::StoreOp::Discard;
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
      draw_items(pass, false);
      pass.SetPipeline(mesh_wire_);
      draw_meshes(pass, all_meshes);
    } else {
      pass.SetPipeline(mesh_main_);
      draw_meshes(pass, opaque_meshes_);
      draw_items(pass, false);
      if (ground) {
        pass.SetPipeline(grid_main_);
        pass.Draw(3);
      }
    }
    pass.End();
  }
  // 5. See-through meshes: weighted blended OIT against the opaque depth.
  if (see_through) {
    wgpu::RenderPassColorAttachment c[2]{};
    c[0].view = oit_accum_msaa_view_;
    c[0].resolveTarget = oit_accum_view_;
    c[0].clearValue = {0, 0, 0, 0};
    c[1].view = oit_reveal_msaa_view_;
    c[1].resolveTarget = oit_reveal_view_;
    c[1].clearValue = {1, 1, 1, 1};
    for (auto& a : c) {
      a.loadOp = wgpu::LoadOp::Clear;
      a.storeOp = wgpu::StoreOp::Discard;
    }
    wgpu::RenderPassDepthStencilAttachment d{};
    d.view = msaa_depth_view_;
    d.depthLoadOp = wgpu::LoadOp::Load;
    d.depthStoreOp = wgpu::StoreOp::Discard;
    wgpu::RenderPassDescriptor rp{};
    rp.colorAttachmentCount = 2;
    rp.colorAttachments = c;
    rp.depthStencilAttachment = &d;
    wgpu::RenderPassEncoder pass = enc.BeginRenderPass(&rp);
    pass.SetBindGroup(0, scene_group_);
    pass.SetPipeline(mesh_transparent_);
    draw_meshes(pass, transparent_meshes_);
    pass.End();
  } else {
    fullscreen(oit_reveal_view_, nullptr, nullptr, 1.0);
  }
  // 6. Composite, then overlays and the UI on the final texture. When the
  //    scene image is kept (video without UI), it is copied before the UI.
  auto begin_final = [&](wgpu::LoadOp load) {
    wgpu::RenderPassColorAttachment c{};
    c.view = final_view_;
    c.loadOp = load;
    c.storeOp = wgpu::StoreOp::Store;
    wgpu::RenderPassDescriptor rp{};
    rp.colorAttachmentCount = 1;
    rp.colorAttachments = &c;
    return enc.BeginRenderPass(&rp);
  };
  wgpu::RenderPassEncoder pass = begin_final(wgpu::LoadOp::Clear);
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
  if (keep_scene_) {
    pass.End();
    wgpu::TexelCopyTextureInfo src{}, dst{};
    src.texture = final_;
    dst.texture = scene_image_;
    wgpu::Extent3D e{width_, height_, 1};
    enc.CopyTextureToTexture(&src, &dst, &e);
    pass = begin_final(wgpu::LoadOp::Load);
  }
  if (ui) ui(pass);
  pass.End();
  wgpu::CommandBuffer cmd = enc.Finish();
  gpu_.queue.Submit(1, &cmd);
  retired_images_.clear();  // WebGPU keeps them alive for the submitted work
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

bool Renderer::read_image(std::vector<uint8_t>& rgba, bool with_ui) {
  const wgpu::Texture& tex = with_ui || !keep_scene_ ? final_ : scene_image_;
  return read_texture(gpu_, tex, 0, 0, int(width_), int(height_), 4, rgba);
}

}  // namespace avbd_viz
