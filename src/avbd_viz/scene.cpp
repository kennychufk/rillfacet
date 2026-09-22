#include "avbd_viz/scene.h"

#include <algorithm>
#include <cmath>
#include <limits>
#include <unordered_map>

namespace avbd_viz {

const char* element_name(ElementKind kind) {
  switch (kind) {
    case ElementKind::Vertex: return "vertex";
    case ElementKind::Edge: return "edge";
    case ElementKind::Face: return "face";
    case ElementKind::Segment: return "segment";
  }
  return "?";
}

// ---- SurfaceMesh ----------------------------------------------------------

void SurfaceMesh::set_geometry(const float* xyz, size_t num_vertices, const uint32_t* tris,
                               size_t num_triangles) {
  positions_.assign(xyz, xyz + 3 * num_vertices);
  triangles_.assign(tris, tris + 3 * num_triangles);
  if (segment_offsets_.back() != num_triangles) segment_offsets_ = {0, uint32_t(num_triangles)};
  edges_valid_ = face_segment_valid_ = false;
  ++positions_version_;
  ++topology_version_;
  ++attributes_version_;
}

void SurfaceMesh::set_positions(const float* xyz) {
  std::copy(xyz, xyz + positions_.size(), positions_.begin());
  ++positions_version_;
}

void SurfaceMesh::set_segments(std::vector<uint32_t> offsets, std::vector<std::string> names) {
  segment_offsets_ = std::move(offsets);
  segment_names_ = std::move(names);
  size_t s = num_segments();
  segment_hidden_.assign(s, 0);
  segment_colors_.resize(s);
  // Default palette: golden-ratio hue steps, soft saturation (Blender's
  // "Random" color mode looks similar).
  for (size_t i = 0; i < s; ++i) {
    float h = std::fmod(0.61803398875f * float(i) + 0.08f, 1.0f);
    float r = std::abs(h * 6 - 3) - 1, g = 2 - std::abs(h * 6 - 2), b = 2 - std::abs(h * 6 - 4);
    glm::vec3 rgb = glm::clamp(glm::vec3(r, g, b), 0.0f, 1.0f);
    segment_colors_[i] = glm::mix(glm::vec3(0.92f), rgb, 0.55f) * 0.95f;
  }
  face_segment_valid_ = false;
  ++topology_version_;
  ++attributes_version_;
}

size_t SurfaceMesh::count(ElementKind kind) const {
  switch (kind) {
    case ElementKind::Vertex: return num_vertices();
    case ElementKind::Edge: return num_edges();
    case ElementKind::Face: return num_faces();
    case ElementKind::Segment: return num_segments();
  }
  return 0;
}

void SurfaceMesh::build_edges() const {
  edges_.clear();
  edge_faces_.clear();
  face_edges_.assign(triangles_.size(), 0);
  std::unordered_map<uint64_t, uint32_t> index;
  index.reserve(triangles_.size());
  for (size_t f = 0; f < num_faces(); ++f) {
    for (int k = 0; k < 3; ++k) {
      uint32_t a = triangles_[3 * f + k], b = triangles_[3 * f + (k + 1) % 3];
      uint64_t key = (uint64_t(std::min(a, b)) << 32) | std::max(a, b);
      auto [it, inserted] = index.try_emplace(key, uint32_t(edges_.size() / 2));
      if (inserted) {
        edges_.push_back(std::min(a, b));
        edges_.push_back(std::max(a, b));
        edge_faces_.push_back(uint32_t(f));
        edge_faces_.push_back(UINT32_MAX);
      } else if (edge_faces_[2 * it->second + 1] == UINT32_MAX) {
        edge_faces_[2 * it->second + 1] = uint32_t(f);
      }
      face_edges_[3 * f + k] = it->second;  // edge k joins corners k and k+1
    }
  }
  edges_valid_ = true;
}

size_t SurfaceMesh::num_edges() const { return edges().size() / 2; }

const std::vector<uint32_t>& SurfaceMesh::edges() const {
  if (!edges_valid_) build_edges();
  return edges_;
}

const std::vector<uint32_t>& SurfaceMesh::face_edges() const {
  if (!edges_valid_) build_edges();
  return face_edges_;
}

const std::vector<uint8_t>& SurfaceMesh::flat_edge_mask(float angle_deg) const {
  uint64_t version = (rigid_segments ? 0 : positions_version_) + topology_version_;
  if (angle_deg == flat_mask_angle_ && flat_mask_version_ == version) return flat_mask_;
  const auto& fe = face_edges();
  size_t nf = num_faces();
  std::vector<glm::vec3> n(nf);
  for (size_t f = 0; f < nf; ++f) {
    glm::uvec3 t = face(uint32_t(f));
    glm::vec3 c = glm::cross(vertex(t.y) - vertex(t.x), vertex(t.z) - vertex(t.x));
    float l = glm::length(c);
    n[f] = l > 0 ? c / l : glm::vec3(0.0f);
  }
  float cos_limit = std::cos(angle_deg * 3.14159265f / 180.0f);
  flat_mask_.assign(nf, 0);
  if (angle_deg > 0)
    for (size_t f = 0; f < nf; ++f)
      for (int k = 0; k < 3; ++k) {
        uint32_t e = fe[3 * f + k];
        uint32_t other = edge_faces_[2 * e] == f ? edge_faces_[2 * e + 1] : edge_faces_[2 * e];
        if (other != UINT32_MAX && glm::dot(n[f], n[other]) >= cos_limit) flat_mask_[f] |= uint8_t(1u << k);
      }
  flat_mask_angle_ = angle_deg;
  flat_mask_version_ = version;
  return flat_mask_;
}

const std::vector<uint32_t>& SurfaceMesh::face_segment() const {
  if (!face_segment_valid_) {
    face_segment_.assign(num_faces(), 0);
    vertex_segment_.assign(num_vertices(), 0);
    for (size_t s = 0; s + 1 < segment_offsets_.size(); ++s)
      for (uint32_t f = segment_offsets_[s]; f < segment_offsets_[s + 1] && f < num_faces(); ++f) {
        face_segment_[f] = uint32_t(s);
        for (int k = 0; k < 3; ++k) vertex_segment_[triangles_[3 * f + k]] = uint32_t(s);
      }
    face_segment_valid_ = true;
  }
  return face_segment_;
}

uint32_t SurfaceMesh::segment_of_vertex(uint32_t v) const {
  face_segment();
  return v < vertex_segment_.size() ? vertex_segment_[v] : 0;
}

std::string SurfaceMesh::segment_name(uint32_t s) const {
  if (s < segment_names_.size() && !segment_names_[s].empty()) return segment_names_[s];
  return "segment " + std::to_string(s);
}

static void set_bit(std::vector<uint8_t>& bits, size_t n, uint32_t s, uint8_t bit, bool on, uint64_t& version) {
  if (bits.size() < n) bits.resize(n, 0);
  if (s >= bits.size() || bool(bits[s] & bit) == on) return;
  bits[s] = on ? (bits[s] | bit) : (bits[s] & ~bit);
  ++version;
}

void SurfaceMesh::set_segment_visible(uint32_t s, bool v) {
  set_bit(segment_hidden_, num_segments(), s, 1, !v, attributes_version_);
}

void SurfaceMesh::set_segment_hidden_by_user(uint32_t s, bool hidden) {
  set_bit(segment_hidden_, num_segments(), s, 2, hidden, attributes_version_);
}

bool SurfaceMesh::segment_visible(uint32_t s) const {
  return s >= segment_hidden_.size() || !segment_hidden_[s];
}

bool SurfaceMesh::segment_hidden_by_app(uint32_t s) const {
  return s < segment_hidden_.size() && (segment_hidden_[s] & 1);
}

bool SurfaceMesh::segment_hidden_by_user(uint32_t s) const {
  return s < segment_hidden_.size() && (segment_hidden_[s] & 2);
}

size_t SurfaceMesh::unhide_all_by_user() {
  size_t n = 0;
  for (uint8_t& h : segment_hidden_)
    if (h & 2) {
      h &= ~2;
      ++n;
    }
  if (n) ++attributes_version_;
  return n;
}

void SurfaceMesh::set_segment_color(uint32_t s, const glm::vec3& srgb) {
  if (s >= segment_colors_.size()) segment_colors_.resize(num_segments(), glm::vec3(0.8f));
  if (s < segment_colors_.size()) segment_colors_[s] = srgb;
  ++attributes_version_;
}

glm::vec3 SurfaceMesh::segment_color(uint32_t s) const {
  return s < segment_colors_.size() ? segment_colors_[s] : color;
}

Quantity& SurfaceMesh::add_scalar(const std::string& name, ElementKind on, std::vector<float> v) {
  Quantity* q = quantity(name);
  if (!q) q = &quantities_.emplace_back();
  q->name = name;
  q->on = on;
  q->dims = 1;
  q->data = std::move(v);
  ++attributes_version_;
  return *q;
}

Quantity& SurfaceMesh::add_vector(const std::string& name, ElementKind on, std::vector<float> v) {
  Quantity& q = add_scalar(name, on, std::move(v));
  q.dims = 3;
  return q;
}

Quantity* SurfaceMesh::quantity(const std::string& name) {
  for (Quantity& q : quantities_)
    if (q.name == name) return &q;
  return nullptr;
}

const Quantity* SurfaceMesh::quantity(const std::string& name) const {
  return const_cast<SurfaceMesh*>(this)->quantity(name);
}

glm::vec2 SurfaceMesh::quantity_range(const Quantity& q) const {
  float lo = std::numeric_limits<float>::max(), hi = -lo;
  for (size_t i = 0; i < q.data.size(); i += q.dims) {
    float v = q.data[i];
    if (q.dims == 3) v = std::sqrt(v * v + q.data[i + 1] * q.data[i + 1] + q.data[i + 2] * q.data[i + 2]);
    if (std::isfinite(v)) {
      lo = std::min(lo, v);
      hi = std::max(hi, v);
    }
  }
  if (lo > hi) return {0.0f, 1.0f};
  if (hi - lo < 1e-12f) hi = lo + 1e-6f;
  return {lo, hi};
}

// ---- PointCloud / VectorSet -----------------------------------------------

void PointCloud::set_points(const float* xyz, size_t n, const float* radii) {
  points_.resize(4 * n);
  per_point_radius_ = radii != nullptr;
  for (size_t i = 0; i < n; ++i) {
    points_[4 * i] = xyz[3 * i];
    points_[4 * i + 1] = xyz[3 * i + 1];
    points_[4 * i + 2] = xyz[3 * i + 2];
    points_[4 * i + 3] = radii ? radii[i] : -1.0f;  // negative: use `radius`
  }
  ++version_;
}

void VectorSet::set_vectors(const float* origins, const float* vectors, size_t n) {
  origins_.assign(origins, origins + 3 * n);
  vectors_.assign(vectors, vectors + 3 * n);
  ++version_;
}

// ---- Scene ----------------------------------------------------------------

template <class T>
T& Scene::add(const std::string& name) {
  remove(name);
  auto s = std::make_unique<T>();
  s->name_ = name;
  s->id_ = next_id_++;
  T& ref = *s;
  structures_.push_back(std::move(s));
  return ref;
}

SurfaceMesh& Scene::add_mesh(const std::string& name) { return add<SurfaceMesh>(name); }
PointCloud& Scene::add_points(const std::string& name) { return add<PointCloud>(name); }
VectorSet& Scene::add_vectors(const std::string& name) { return add<VectorSet>(name); }

void Scene::remove(const std::string& name) {
  std::erase_if(structures_, [&](const auto& s) { return s->name() == name; });
}

void Scene::clear() { structures_.clear(); }

Structure* Scene::find(const std::string& name) const {
  for (const auto& s : structures_)
    if (s->name() == name) return s.get();
  return nullptr;
}

Structure* Scene::find(uint32_t id) const {
  for (const auto& s : structures_)
    if (s->id() == id) return s.get();
  return nullptr;
}

bool Scene::bounds(glm::vec3& lo, glm::vec3& hi) const {
  lo = glm::vec3(std::numeric_limits<float>::max());
  hi = -lo;
  bool any = false;
  auto grow = [&](const glm::vec3& p) {
    lo = glm::min(lo, p);
    hi = glm::max(hi, p);
    any = true;
  };
  for (const auto& s : structures_) {
    if (!s->visible) continue;
    if (auto* m = dynamic_cast<const SurfaceMesh*>(s.get())) {
      const auto& seg = m->segment_offsets();
      for (size_t k = 0; k + 1 < seg.size(); ++k) {
        if (!m->segment_visible(uint32_t(k))) continue;
        for (uint32_t f = seg[k]; f < seg[k + 1]; ++f)
          for (int c = 0; c < 3; ++c) grow(m->vertex(m->triangles()[3 * f + c]));
      }
    } else if (auto* p = dynamic_cast<const PointCloud*>(s.get())) {
      for (size_t i = 0; i < p->size(); ++i) grow(p->point(uint32_t(i)));
    }
  }
  return any;
}

}  // namespace avbd_viz
