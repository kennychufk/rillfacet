#pragma once
// Scene data model: named structures (surface meshes, point clouds, vector
// sets) carrying per-element quantities. Plain CPU data; the renderer mirrors
// whatever changed (tracked by version counters) to the GPU each frame.
//
// A "segment" is a contiguous triangle range of a mesh, e.g. one rigid body in
// a simulator's concatenated render mesh. Segments can be colored, hidden,
// picked and inspected as a unit.

#include <glm/glm.hpp>

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace avbd_viz {

enum class ElementKind : uint8_t { Vertex, Edge, Face, Segment };
const char* element_name(ElementKind kind);

struct Quantity {
  std::string name;
  ElementKind on = ElementKind::Vertex;
  int dims = 1;             // 1 = scalar, 3 = vector
  std::vector<float> data;  // count(on) * dims values
};

enum class ColorSource : int { Uniform, SegmentPalette, Quantity };

enum class StructureKind : uint8_t { SurfaceMesh, PointCloud, VectorSet };

class Structure {
 public:
  virtual ~Structure() = default;
  virtual StructureKind kind() const = 0;
  const std::string& name() const { return name_; }
  uint32_t id() const { return id_; }  // stable, nonzero; written to the pick buffer

  bool visible = true;

 private:
  friend class Scene;
  std::string name_;
  uint32_t id_ = 0;
};

class SurfaceMesh : public Structure {
 public:
  StructureKind kind() const override { return StructureKind::SurfaceMesh; }

  // Geometry. `xyz` holds 3 floats per vertex, `tris` 3 indices per face.
  void set_geometry(const float* xyz, size_t num_vertices, const uint32_t* tris,
                    size_t num_triangles);
  void set_positions(const float* xyz);  // same vertex count, e.g. once per sim step
  // Segments as CSR offsets over triangles (size S+1). Default: one segment.
  void set_segments(std::vector<uint32_t> triangle_offsets,
                    std::vector<std::string> names = {});

  size_t num_vertices() const { return positions_.size() / 3; }
  size_t num_faces() const { return triangles_.size() / 3; }
  size_t num_segments() const { return segment_offsets_.size() - 1; }
  size_t num_edges() const;
  size_t count(ElementKind kind) const;

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
  // Per face, bit k is set when edge k (corners k, k+1) joins two faces whose
  // normals differ by less than `angle_deg`, i.e. a flat edge that wireframes
  // may hide (the diagonals of a box face). Cached per angle and positions.
  const std::vector<uint8_t>& flat_edge_mask(float angle_deg) const;
  uint32_t segment_of_face(uint32_t f) const { return face_segment()[f]; }
  const std::vector<uint32_t>& face_segment() const;
  uint32_t segment_of_vertex(uint32_t v) const;
  std::string segment_name(uint32_t s) const;

  // Appearance (colors are sRGB, 0..1).
  glm::vec3 color{0.80f, 0.52f, 0.25f};
  ColorSource color_source = ColorSource::Uniform;
  std::string color_quantity;  // quantity name when color_source == Quantity
  int colormap = 0;            // index into colormap_names()
  bool auto_range = true;
  glm::vec2 range{0.0f, 1.0f};
  bool isolines = false;
  float isoline_spacing = 0.1f;
  float metallic = 0.0f;
  float roughness = 0.45f;
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

  // Quantities; adding one with an existing name replaces it.
  Quantity& add_scalar(const std::string& name, ElementKind on, std::vector<float> values);
  Quantity& add_vector(const std::string& name, ElementKind on, std::vector<float> xyz);
  Quantity* quantity(const std::string& name);
  const Quantity* quantity(const std::string& name) const;
  const std::vector<Quantity>& quantities() const { return quantities_; }
  // Value range of a scalar quantity (NaN-safe).
  glm::vec2 quantity_range(const Quantity& q) const;

  // Change tracking.
  uint64_t positions_version() const { return positions_version_; }
  uint64_t topology_version() const { return topology_version_; }
  uint64_t attributes_version() const { return attributes_version_; }
  void touch_attributes() { ++attributes_version_; }  // call after editing public fields/quantities in place

 private:
  void build_edges() const;

  std::vector<float> positions_;
  std::vector<uint32_t> triangles_;
  std::vector<uint32_t> segment_offsets_{0, 0};
  std::vector<std::string> segment_names_;
  std::vector<uint8_t> segment_hidden_;  // bit 0 by the application, bit 1 by the user
  std::vector<glm::vec3> segment_colors_;
  std::vector<Quantity> quantities_;

  mutable std::vector<uint32_t> edges_, face_edges_, edge_faces_, face_segment_, vertex_segment_;
  mutable bool edges_valid_ = false, face_segment_valid_ = false;
  mutable std::vector<uint8_t> flat_mask_;
  mutable float flat_mask_angle_ = -1.0f;
  mutable uint64_t flat_mask_version_ = 0;  // positions + topology versions the mask was built at

  uint64_t positions_version_ = 1, topology_version_ = 1, attributes_version_ = 1;
};

// Spheres (rendered as ray-cast impostors: perfectly round at any zoom).
class PointCloud : public Structure {
 public:
  StructureKind kind() const override { return StructureKind::PointCloud; }
  void set_points(const float* xyz, size_t n, const float* radii = nullptr);
  size_t size() const { return points_.size() / 4; }
  glm::vec3 point(uint32_t i) const { return {points_[4 * i], points_[4 * i + 1], points_[4 * i + 2]}; }
  const std::vector<float>& packed() const { return points_; }  // xyz + radius

  float radius = 0.05f;  // used when no per-point radii are given
  glm::vec3 color{0.85f, 0.15f, 0.12f};
  uint64_t version() const { return version_; }
  void touch() { ++version_; }

 private:
  std::vector<float> points_;
  bool per_point_radius_ = false;
  uint64_t version_ = 1;
};

// Arrows from origins along vectors (length = |vector| * length_scale).
class VectorSet : public Structure {
 public:
  StructureKind kind() const override { return StructureKind::VectorSet; }
  void set_vectors(const float* origins, const float* vectors, size_t n);
  size_t size() const { return origins_.size() / 3; }
  const std::vector<float>& origins() const { return origins_; }
  const std::vector<float>& vectors() const { return vectors_; }

  float radius = 0.015f;  // shaft radius (world units)
  float length_scale = 1.0f;
  glm::vec3 color{0.15f, 0.35f, 0.90f};
  uint64_t version() const { return version_; }
  void touch() { ++version_; }

 private:
  std::vector<float> origins_, vectors_;
  uint64_t version_ = 1;
};

class Scene {
 public:
  SurfaceMesh& add_mesh(const std::string& name);
  PointCloud& add_points(const std::string& name);
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

 private:
  template <class T>
  T& add(const std::string& name);

  std::vector<std::unique_ptr<Structure>> structures_;
  uint32_t next_id_ = 1;
};

}  // namespace avbd_viz
