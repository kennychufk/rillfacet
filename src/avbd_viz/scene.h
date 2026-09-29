#pragma once
// Scene data model: named structures (surface meshes, point clouds, curve
// networks, tet volume meshes, vector sets) carrying per-element quantities.
// Plain CPU data; the renderer mirrors whatever changed (tracked by version
// counters) to the GPU each frame.
//
// A "segment" is a contiguous triangle range of a surface mesh, e.g. one rigid
// body in a simulator's concatenated render mesh. Segments can be colored,
// hidden, picked and inspected as a unit.

#include <glm/glm.hpp>

#include <cstdint>
#include <map>
#include <memory>
#include <string>
#include <vector>

namespace avbd_viz {

// Elements a quantity can live on. Curves use Vertex (nodes) and Edge;
// volume meshes use Vertex and Cell (tetrahedra).
enum class ElementKind : uint8_t { Vertex, Edge, Face, Segment, Cell };
const char* element_name(ElementKind kind);

enum class QuantityType : uint8_t { Scalar, Vector, Color };

struct Quantity {
  std::string name;
  ElementKind on = ElementKind::Vertex;
  QuantityType type = QuantityType::Scalar;
  int dims = 1;             // 1 for scalars, 3 for vectors and colors
  std::vector<float> data;  // count(on) * dims values; colors are sRGB 0..1

  // Vector quantities can be drawn as arrows at their elements.
  bool show_arrows = false;
  float arrow_scale = 1.0f;   // world length per unit of the vector
  float arrow_radius = 0.0f;  // 0 = automatic (from the arrow lengths)
  glm::vec3 arrow_color{0.15f, 0.35f, 0.90f};

  float value(size_t i) const;  // scalar, or the magnitude of a vector
};

// Texture: a surface mesh with per-vertex UVs sampling one of the scene's
// images (Scene::set_image), e.g. a camera frame on a billboard.
enum class ColorSource : int { Uniform, SegmentPalette, Quantity, Texture };

enum class StructureKind : uint8_t { SurfaceMesh, PointCloud, VectorSet, CurveNetwork, VolumeMesh };
const char* structure_kind_name(StructureKind kind);

class Structure {
 public:
  virtual ~Structure() = default;
  virtual StructureKind kind() const = 0;
  const std::string& name() const { return name_; }
  uint32_t id() const { return id_; }  // stable, nonzero; written to the pick buffer

  // Axis-aligned bounds of the visible parts. Returns false when empty.
  virtual bool bounds(glm::vec3& lo, glm::vec3& hi) const = 0;

  bool visible = true;
  float opacity = 1.0f;  // below 1 the structure is see-through (and no longer pickable)
  bool sliced = true;    // cut by the slice plane when it is on
  bool draggable = true; // Ctrl+LMB can grab it (when the viewer's drag is enabled)

  // Placement of the structure's coordinates in the world (polyscope's
  // structure transform). Once set, the geometry setters take LOCAL
  // coordinates and every accessor (positions, bounds, picking) returns
  // placed ones; moving a structure is then one call, whatever its size.
  const glm::mat4& transform() const { return transform_; }
  void set_transform(const glm::mat4& world_from_local);

 protected:
  // Re-derives the world coordinates from local_ (and bumps the versions).
  virtual void place() = 0;
  // Copies the world coordinates into local_ the first time a transform is set.
  virtual void capture_local() = 0;
  // dst = T * src over points of `stride` floats (xyz first; the rest copied).
  static void transform_points(const glm::mat4& T, const std::vector<float>& src, std::vector<float>& dst,
                               size_t stride);

  glm::mat4 transform_{1.0f};
  bool placed_ = false;          // a transform was set: local_ is the source of truth
  std::vector<float> local_;     // local coordinates, laid out like the world array

 private:
  friend class Scene;
  std::string name_;
  uint32_t id_ = 0;
};

// A structure whose elements carry quantities and that can be colored by
// one of them.
class QuantityStructure : public Structure {
 public:
  // Number of elements of a kind (0 when the structure has none of that kind).
  virtual size_t count(ElementKind kind) const = 0;
  // Representative world position of an element (arrow origins, labels).
  virtual glm::vec3 element_position(ElementKind kind, uint32_t i) const = 0;

  // Coloring (colors are sRGB, 0..1).
  glm::vec3 color{0.80f, 0.52f, 0.25f};
  ColorSource color_source = ColorSource::Uniform;
  std::string color_quantity;  // quantity name when color_source == Quantity
  int colormap = 0;            // see colormap_name()
  bool auto_range = true;
  glm::vec2 range{0.0f, 1.0f};
  bool isolines = false;
  float isoline_spacing = 0.1f;
  float metallic = 0.0f;
  float roughness = 0.45f;

  // Adding a quantity with an existing name replaces its data but keeps its
  // display settings, so it can be updated every frame.
  Quantity& add_scalar(const std::string& name, ElementKind on, std::vector<float> values);
  Quantity& add_vector(const std::string& name, ElementKind on, std::vector<float> xyz);
  Quantity& add_color(const std::string& name, ElementKind on, std::vector<float> rgb);
  void remove_quantity(const std::string& name);
  Quantity* quantity(const std::string& name);
  const Quantity* quantity(const std::string& name) const;
  const std::vector<Quantity>& quantities() const { return quantities_; }
  std::vector<Quantity>& quantities() { return quantities_; }
  // The quantity currently used for coloring, if any.
  const Quantity* coloring_quantity() const;
  // Value range of a scalar/vector quantity (NaN-safe).
  glm::vec2 quantity_range(const Quantity& q) const;
  // Range the colormap spans: automatic from the coloring quantity, or `range`.
  glm::vec2 color_range() const;

  // Change tracking.
  uint64_t positions_version() const { return positions_version_; }
  uint64_t topology_version() const { return topology_version_; }
  uint64_t attributes_version() const { return attributes_version_; }
  void touch_attributes() { ++attributes_version_; }  // after editing public fields/quantities in place

 protected:
  Quantity& put(const std::string& name, ElementKind on, QuantityType type, std::vector<float> data);

  std::vector<Quantity> quantities_;
  uint64_t positions_version_ = 1, topology_version_ = 1, attributes_version_ = 1;
};

class SurfaceMesh : public QuantityStructure {
 public:
  StructureKind kind() const override { return StructureKind::SurfaceMesh; }
  bool bounds(glm::vec3& lo, glm::vec3& hi) const override;
  size_t count(ElementKind kind) const override;
  glm::vec3 element_position(ElementKind kind, uint32_t i) const override;

  // Geometry. `xyz` holds 3 floats per vertex, `tris` 3 indices per face.
  void set_geometry(const float* xyz, size_t num_vertices, const uint32_t* tris,
                    size_t num_triangles);
  void set_positions(const float* xyz);  // same vertex count, e.g. once per sim step
  // Texture coordinates (2 per vertex, origin at the image's top-left) for
  // ColorSource::Texture.
  void set_uvs(const float* uv, size_t num_vertices);
  const std::vector<float>& uvs() const { return uvs_; }
  // Segments as CSR offsets over triangles (size S+1). Default: one segment.
  void set_segments(std::vector<uint32_t> triangle_offsets,
                    std::vector<std::string> names = {});

  size_t num_vertices() const { return positions_.size() / 3; }
  size_t num_faces() const { return triangles_.size() / 3; }
  size_t num_segments() const { return segment_offsets_.size() - 1; }
  size_t num_edges() const;

  const std::vector<float>& positions() const { return positions_; }
  const std::vector<uint32_t>& triangles() const { return triangles_; }
  const std::vector<uint32_t>& segment_offsets() const { return segment_offsets_; }
  glm::vec3 vertex(uint32_t v) const {
    return {positions_[3 * v], positions_[3 * v + 1], positions_[3 * v + 2]};
  }
  glm::uvec3 face(uint32_t f) const {
    return {triangles_[3 * f], triangles_[3 * f + 1], triangles_[3 * f + 2]};
  }
  // Unique edges (2 vertex ids each) and the 3 edge ids of every face,
  // built lazily from the triangles.
  const std::vector<uint32_t>& edges() const;
  const std::vector<uint32_t>& face_edges() const;
  // Faces around each vertex as CSR: [V+1 offsets | face ids], the offsets
  // indexing the same array (smooth normals are gathered on the GPU).
  const std::vector<uint32_t>& vertex_faces() const;
  // Per face, bit k is set when edge k (corners k, k+1) joins two faces whose
  // normals differ by less than `angle_deg`, i.e. a flat edge that wireframes
  // may hide (the diagonals of a box face). Cached per angle and positions.
  const std::vector<uint8_t>& flat_edge_mask(float angle_deg) const;
  uint32_t segment_of_face(uint32_t f) const { return face_segment()[f]; }
  const std::vector<uint32_t>& face_segment() const;
  uint32_t segment_of_vertex(uint32_t v) const;
  std::string segment_name(uint32_t s) const;

  bool smooth_shading = false;  // interpolate vertex normals (cloth); flat faces otherwise
  std::string texture;          // Scene image sampled with ColorSource::Texture
  bool unlit = false;           // show the base color as is (images, markers): no lighting
  // Set when every segment only moves rigidly (e.g. rigid bodies): angles
  // between faces never change, so flat-edge masks are computed once.
  bool rigid_segments = false;

  // Visibility has two independent sources: the application hides segments
  // with set_segment_visible() (e.g. a ground slab), the user with the
  // *_by_user calls (H / Alt+H, the body list). A segment shows when neither
  // hides it, so un-hiding never reveals what the application hid.
  void set_segment_visible(uint32_t s, bool v);
  void set_segment_hidden_by_user(uint32_t s, bool hidden);
  bool segment_visible(uint32_t s) const;
  bool segment_hidden_by_app(uint32_t s) const;
  bool segment_hidden_by_user(uint32_t s) const;
  size_t unhide_all_by_user();  // returns how many segments came back
  void set_segment_color(uint32_t s, const glm::vec3& srgb);
  glm::vec3 segment_color(uint32_t s) const;

 private:
  void build_edges() const;
  void place() override;
  void capture_local() override { local_ = positions_; }

  std::vector<float> positions_;
  std::vector<float> uvs_;
  std::vector<uint32_t> triangles_;
  std::vector<uint32_t> segment_offsets_{0, 0};
  std::vector<std::string> segment_names_;
  std::vector<uint8_t> segment_hidden_;  // bit 0 by the application, bit 1 by the user
  std::vector<glm::vec3> segment_colors_;

  mutable std::vector<uint32_t> edges_, face_edges_, edge_faces_, face_segment_, vertex_segment_,
      vertex_faces_;
  mutable bool edges_valid_ = false, face_segment_valid_ = false;
  mutable uint64_t vertex_faces_version_ = 0;
  mutable std::vector<uint8_t> flat_mask_;
  mutable float flat_mask_angle_ = -1.0f;
  mutable uint64_t flat_mask_version_ = 0;  // positions + topology versions the mask was built at
};

// Spheres (rendered as ray-cast impostors: perfectly round at any zoom).
class PointCloud : public QuantityStructure {
 public:
  PointCloud() { color = {0.85f, 0.15f, 0.12f}; }
  StructureKind kind() const override { return StructureKind::PointCloud; }
  bool bounds(glm::vec3& lo, glm::vec3& hi) const override;
  size_t count(ElementKind kind) const override { return kind == ElementKind::Vertex ? size() : 0; }
  glm::vec3 element_position(ElementKind, uint32_t i) const override { return point(i); }

  void set_points(const float* xyz, size_t n, const float* radii = nullptr);
  size_t size() const { return points_.size() / 4; }
  glm::vec3 point(uint32_t i) const { return {points_[4 * i], points_[4 * i + 1], points_[4 * i + 2]}; }
  float point_radius(uint32_t i) const { return points_[4 * i + 3] > 0 ? points_[4 * i + 3] : radius; }
  const std::vector<float>& packed() const { return points_; }  // xyz + radius

  float radius = 0.05f;  // used when no per-point radii are given

 private:
  void place() override;
  void capture_local() override { local_ = points_; }
  std::vector<float> points_;
};

// Nodes joined by edges, drawn as tubes (ray-cast capsules) of `radius`.
class CurveNetwork : public QuantityStructure {
 public:
  CurveNetwork() { color = {0.30f, 0.58f, 0.86f}; }
  StructureKind kind() const override { return StructureKind::CurveNetwork; }
  bool bounds(glm::vec3& lo, glm::vec3& hi) const override;
  size_t count(ElementKind kind) const override;
  glm::vec3 element_position(ElementKind kind, uint32_t i) const override;

  void set_nodes(const float* xyz, size_t n);  // same count keeps the edges
  void set_edges(const uint32_t* pairs, size_t n);
  void set_polyline(const float* xyz, size_t n, bool closed = false);  // nodes + consecutive edges

  size_t num_nodes() const { return nodes_.size() / 3; }
  size_t num_edges() const { return edges_.size() / 2; }
  glm::vec3 node(uint32_t i) const { return {nodes_[3 * i], nodes_[3 * i + 1], nodes_[3 * i + 2]}; }
  glm::uvec2 edge(uint32_t e) const { return {edges_[2 * e], edges_[2 * e + 1]}; }
  const std::vector<float>& nodes() const { return nodes_; }
  const std::vector<uint32_t>& edges() const { return edges_; }

  float radius = 0.01f;

 private:
  void place() override;
  void capture_local() override { local_ = nodes_; }
  std::vector<float> nodes_;
  std::vector<uint32_t> edges_;
};

// Tetrahedral mesh. Drawn as its boundary surface; with the slice plane on,
// the boundary is clipped and the cut through the tets is filled in, showing
// interior quantities.
class VolumeMesh : public QuantityStructure {
 public:
  VolumeMesh() { color = {0.42f, 0.66f, 0.72f}; }
  StructureKind kind() const override { return StructureKind::VolumeMesh; }
  bool bounds(glm::vec3& lo, glm::vec3& hi) const override;
  size_t count(ElementKind kind) const override;
  glm::vec3 element_position(ElementKind kind, uint32_t i) const override;

  void set_geometry(const float* xyz, size_t num_vertices, const uint32_t* tets, size_t num_tets);
  void set_positions(const float* xyz);

  size_t num_vertices() const { return positions_.size() / 3; }
  size_t num_cells() const { return tets_.size() / 4; }
  const std::vector<float>& positions() const { return positions_; }
  const std::vector<uint32_t>& tets() const { return tets_; }
  glm::vec3 vertex(uint32_t v) const {
    return {positions_[3 * v], positions_[3 * v + 1], positions_[3 * v + 2]};
  }
  glm::uvec4 cell(uint32_t c) const {
    return {tets_[4 * c], tets_[4 * c + 1], tets_[4 * c + 2], tets_[4 * c + 3]};
  }
  float cell_volume(uint32_t c) const;

  // Triangles used by exactly one tet, and that tet (built lazily).
  const std::vector<uint32_t>& boundary_faces() const;
  const std::vector<uint32_t>& boundary_cells() const;

  // Cross-section with the plane dot(normal, x) = offset: triangles with
  // their own vertices, each interpolating between two mesh vertices.
  // Cached until the plane or the mesh changes; last_section() is the most
  // recent one (what the viewer shows and picks).
  struct Section {
    std::vector<float> positions;       // 3 per vertex
    std::vector<uint32_t> triangles;    // 3 per face
    std::vector<uint32_t> face_cell;    // tet of each face
    std::vector<uint32_t> vertex_pair;  // 2 mesh vertices per section vertex
    std::vector<float> vertex_t;        // x = (1 - t) * a + t * b
  };
  const Section& slice(const glm::vec3& normal, float offset) const;
  const Section& last_section() const { return section_; }

 private:
  void place() override;
  void capture_local() override { local_ = positions_; }
  std::vector<float> positions_;
  std::vector<uint32_t> tets_;
  mutable std::vector<uint32_t> boundary_faces_, boundary_cells_;
  mutable uint64_t boundary_version_ = 0;
  mutable Section section_;
  mutable glm::vec4 section_plane_{0.0f};
  mutable uint64_t section_version_ = 0;
};

// Arrows from origins along vectors (length = |vector| * length_scale).
class VectorSet : public Structure {
 public:
  StructureKind kind() const override { return StructureKind::VectorSet; }
  bool bounds(glm::vec3& lo, glm::vec3& hi) const override;
  void set_vectors(const float* origins, const float* vectors, size_t n);
  size_t size() const { return origins_.size() / 3; }
  const std::vector<float>& origins() const { return origins_; }
  const std::vector<float>& vectors() const { return vectors_; }
  glm::vec3 origin(uint32_t i) const { return {origins_[3 * i], origins_[3 * i + 1], origins_[3 * i + 2]}; }

  float radius = 0.015f;  // shaft radius (world units)
  float length_scale = 1.0f;
  glm::vec3 color{0.15f, 0.35f, 0.90f};
  uint64_t version() const { return version_; }
  void touch() { ++version_; }

 private:
  void place() override;
  void capture_local() override {
    local_ = origins_;
    local_vectors_ = vectors_;
  }
  std::vector<float> origins_, vectors_, local_vectors_;
  uint64_t version_ = 1;
};

class Scene {
 public:
  SurfaceMesh& add_mesh(const std::string& name);
  PointCloud& add_points(const std::string& name);
  CurveNetwork& add_curves(const std::string& name);
  VolumeMesh& add_volume(const std::string& name);
  VectorSet& add_vectors(const std::string& name);
  void remove(const std::string& name);
  void clear();

  Structure* find(const std::string& name) const;
  Structure* find(uint32_t id) const;
  template <class T>
  T* get(const std::string& name) const { return dynamic_cast<T*>(find(name)); }
  template <class T>
  T* get(uint32_t id) const { return dynamic_cast<T*>(find(id)); }
  const std::vector<std::unique_ptr<Structure>>& structures() const { return structures_; }

  // Axis-aligned bounds of everything visible. Returns false when empty.
  bool bounds(glm::vec3& lo, glm::vec3& hi) const;

  // Named RGBA8 images: textures of surface meshes (ColorSource::Texture)
  // and ImGui images (Viewer::image_texture). Setting an existing name
  // replaces its pixels (any size), e.g. a camera stream every frame.
  struct Image {
    uint32_t width = 0, height = 0;
    std::vector<uint8_t> rgba;  // row-major, top row first, sRGB
    uint64_t version = 0;
  };
  void set_image(const std::string& name, uint32_t width, uint32_t height, std::vector<uint8_t> rgba);
  void remove_image(const std::string& name) { images_.erase(name); }
  const Image* image(const std::string& name) const;
  const std::map<std::string, Image>& images() const { return images_; }

 private:
  template <class T>
  T& add(const std::string& name);

  std::vector<std::unique_ptr<Structure>> structures_;
  std::map<std::string, Image> images_;
  uint64_t image_version_ = 0;
  uint32_t next_id_ = 1;
};

}  // namespace avbd_viz
