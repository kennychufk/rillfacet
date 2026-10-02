#include "rillfacet/scene.h"

#include <algorithm>
#include <cmath>
#include <limits>
#include <unordered_map>

namespace rillfacet {

const char* element_name(ElementKind kind) {
  switch (kind) {
    case ElementKind::Vertex: return "vertex";
    case ElementKind::Edge: return "edge";
    case ElementKind::Face: return "face";
    case ElementKind::Segment: return "segment";
    case ElementKind::Cell: return "cell";
  }
  return "?";
}

const char* structure_kind_name(StructureKind kind) {
  switch (kind) {
    case StructureKind::SurfaceMesh: return "surface mesh";
    case StructureKind::PointCloud: return "point cloud";
    case StructureKind::VectorSet: return "vectors";
    case StructureKind::CurveNetwork: return "curve network";
    case StructureKind::VolumeMesh: return "volume mesh";
  }
  return "?";
}

float Quantity::value(size_t i) const {
  if (dims == 1) return data[i];
  const float* v = &data[3 * i];
  return std::sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

namespace {

struct Bounds {
  glm::vec3 lo{std::numeric_limits<float>::max()}, hi{-std::numeric_limits<float>::max()};
  bool any = false;
  void add(const glm::vec3& p) {
    lo = glm::min(lo, p);
    hi = glm::max(hi, p);
    any = true;
  }
  bool out(glm::vec3& l, glm::vec3& h) const {
    l = lo;
    h = hi;
    return any;
  }
};

Bounds packed_bounds(const std::vector<float>& xyz, size_t stride) {
  Bounds b;
  for (size_t i = 0; i + 2 < xyz.size(); i += stride) b.add({xyz[i], xyz[i + 1], xyz[i + 2]});
  return b;
}

}  // namespace

// ---- QuantityStructure ------------------------------------------------------

Quantity& QuantityStructure::put(const std::string& name, ElementKind on, QuantityType type,
                                 std::vector<float> data) {
  Quantity* q = quantity(name);
  if (!q) {
    q = &quantities_.emplace_back();
    q->name = name;
  }
  q->on = on;
  q->type = type;
  q->dims = type == QuantityType::Scalar ? 1 : 3;
  q->data = std::move(data);
  ++attributes_version_;
  return *q;
}

Quantity& QuantityStructure::add_scalar(const std::string& name, ElementKind on, std::vector<float> v) {
  return put(name, on, QuantityType::Scalar, std::move(v));
}

Quantity& QuantityStructure::add_vector(const std::string& name, ElementKind on, std::vector<float> v) {
  return put(name, on, QuantityType::Vector, std::move(v));
}

Quantity& QuantityStructure::add_color(const std::string& name, ElementKind on, std::vector<float> v) {
  return put(name, on, QuantityType::Color, std::move(v));
}

void QuantityStructure::remove_quantity(const std::string& name) {
  if (std::erase_if(quantities_, [&](const Quantity& q) { return q.name == name; })) ++attributes_version_;
}

Quantity* QuantityStructure::quantity(const std::string& name) {
  for (Quantity& q : quantities_)
    if (q.name == name) return &q;
  return nullptr;
}

const Quantity* QuantityStructure::quantity(const std::string& name) const {
  return const_cast<QuantityStructure*>(this)->quantity(name);
}

const Quantity* QuantityStructure::coloring_quantity() const {
  if (color_source != ColorSource::Quantity) return nullptr;
  const Quantity* q = quantity(color_quantity);
  return q && count(q->on) > 0 && q->data.size() >= count(q->on) * q->dims ? q : nullptr;
}

glm::vec2 QuantityStructure::quantity_range(const Quantity& q) const {
  float lo = std::numeric_limits<float>::max(), hi = -lo;
  for (size_t i = 0; i * q.dims < q.data.size(); ++i) {
    float v = q.value(i);
    if (std::isfinite(v)) {
      lo = std::min(lo, v);
      hi = std::max(hi, v);
    }
  }
  if (lo > hi) return {0.0f, 1.0f};
  if (hi - lo < 1e-12f) hi = lo + 1e-6f;
  return {lo, hi};
}

glm::vec2 QuantityStructure::color_range() const {
  const Quantity* q = coloring_quantity();
  return q && auto_range && q->type != QuantityType::Color ? quantity_range(*q) : range;
}

// ---- Structure transform ----------------------------------------------------

void Structure::set_transform(const glm::mat4& T) {
  if (!placed_) {
    capture_local();
    placed_ = true;
  }
  transform_ = T;
  place();
}

void Structure::transform_points(const glm::mat4& T, const std::vector<float>& src, std::vector<float>& dst,
                                 size_t stride) {
  dst.resize(src.size());
  for (size_t i = 0; i + 2 < src.size(); i += stride) {
    glm::vec3 p = glm::vec3(T * glm::vec4(src[i], src[i + 1], src[i + 2], 1.0f));
    dst[i] = p.x;
    dst[i + 1] = p.y;
    dst[i + 2] = p.z;
    for (size_t k = 3; k < stride; ++k) dst[i + k] = src[i + k];
  }
}

// ---- SurfaceMesh ------------------------------------------------------------

void SurfaceMesh::set_geometry(const float* xyz, size_t num_vertices, const uint32_t* tris,
                               size_t num_triangles) {
  if (placed_) {
    local_.assign(xyz, xyz + 3 * num_vertices);
    transform_points(transform_, local_, positions_, 3);
  } else {
    positions_.assign(xyz, xyz + 3 * num_vertices);
  }
  if (uvs_.size() != 2 * num_vertices) uvs_.clear();
  triangles_.assign(tris, tris + 3 * num_triangles);
  if (segment_offsets_.back() != num_triangles) segment_offsets_ = {0, uint32_t(num_triangles)};
  edges_valid_ = face_segment_valid_ = false;
  ++positions_version_;
  ++topology_version_;
  ++attributes_version_;
}

void SurfaceMesh::set_positions(const float* xyz) {
  if (placed_) {
    std::copy(xyz, xyz + local_.size(), local_.begin());
    transform_points(transform_, local_, positions_, 3);
  } else {
    std::copy(xyz, xyz + positions_.size(), positions_.begin());
  }
  ++positions_version_;
}

void SurfaceMesh::place() {
  transform_points(transform_, local_, positions_, 3);
  ++positions_version_;
}

void SurfaceMesh::set_uvs(const float* uv, size_t n) {
  uvs_.assign(uv, uv + 2 * n);
  ++attributes_version_;
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

bool SurfaceMesh::bounds(glm::vec3& lo, glm::vec3& hi) const {
  Bounds b;
  for (size_t k = 0; k + 1 < segment_offsets_.size(); ++k) {
    if (!segment_visible(uint32_t(k))) continue;
    for (uint32_t f = segment_offsets_[k]; f < segment_offsets_[k + 1]; ++f)
      for (int c = 0; c < 3; ++c) b.add(vertex(triangles_[3 * f + c]));
  }
  return b.out(lo, hi);
}

size_t SurfaceMesh::count(ElementKind kind) const {
  switch (kind) {
    case ElementKind::Vertex: return num_vertices();
    case ElementKind::Edge: return num_edges();
    case ElementKind::Face: return num_faces();
    case ElementKind::Segment: return num_segments();
    case ElementKind::Cell: return 0;
  }
  return 0;
}

glm::vec3 SurfaceMesh::element_position(ElementKind kind, uint32_t i) const {
  switch (kind) {
    case ElementKind::Vertex: return vertex(i);
    case ElementKind::Edge: return 0.5f * (vertex(edges()[2 * i]) + vertex(edges()[2 * i + 1]));
    case ElementKind::Face: {
      glm::uvec3 f = face(i);
      return (vertex(f.x) + vertex(f.y) + vertex(f.z)) / 3.0f;
    }
    case ElementKind::Segment: {
      Bounds b;
      for (uint32_t f = segment_offsets_[i]; f < segment_offsets_[i + 1]; ++f)
        for (int c = 0; c < 3; ++c) b.add(vertex(triangles_[3 * f + c]));
      return b.any ? 0.5f * (b.lo + b.hi) : glm::vec3(0.0f);
    }
    case ElementKind::Cell: break;
  }
  return {};
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

const std::vector<uint32_t>& SurfaceMesh::vertex_faces() const {
  if (vertex_faces_version_ == topology_version_) return vertex_faces_;
  size_t nv = num_vertices(), nf = num_faces();
  vertex_faces_.assign(nv + 1 + 3 * nf, 0);
  std::vector<uint32_t> fill(nv, 0);
  for (uint32_t t : triangles_) ++fill[t];
  uint32_t off = uint32_t(nv + 1);
  for (size_t v = 0; v < nv; ++v) {
    vertex_faces_[v] = off;
    off += fill[v];
    fill[v] = vertex_faces_[v];
  }
  vertex_faces_[nv] = off;
  for (size_t f = 0; f < nf; ++f)
    for (int k = 0; k < 3; ++k) vertex_faces_[fill[triangles_[3 * f + k]]++] = uint32_t(f);
  vertex_faces_version_ = topology_version_;
  return vertex_faces_;
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

// ---- PointCloud ---------------------------------------------------------------

void PointCloud::set_points(const float* xyz, size_t n, const float* radii) {
  if (n != size()) ++topology_version_;
  points_.resize(4 * n);
  for (size_t i = 0; i < n; ++i) {
    points_[4 * i] = xyz[3 * i];
    points_[4 * i + 1] = xyz[3 * i + 1];
    points_[4 * i + 2] = xyz[3 * i + 2];
    points_[4 * i + 3] = radii ? radii[i] : -1.0f;  // negative: use `radius`
  }
  if (placed_) {
    local_ = points_;
    transform_points(transform_, local_, points_, 4);
  }
  ++positions_version_;
}

void PointCloud::place() {
  transform_points(transform_, local_, points_, 4);
  ++positions_version_;
}

bool PointCloud::bounds(glm::vec3& lo, glm::vec3& hi) const { return packed_bounds(points_, 4).out(lo, hi); }

// ---- CurveNetwork ---------------------------------------------------------------

void CurveNetwork::set_nodes(const float* xyz, size_t n) {
  if (n != num_nodes()) ++topology_version_;
  if (placed_) {
    local_.assign(xyz, xyz + 3 * n);
    transform_points(transform_, local_, nodes_, 3);
  } else {
    nodes_.assign(xyz, xyz + 3 * n);
  }
  ++positions_version_;
}

void CurveNetwork::place() {
  transform_points(transform_, local_, nodes_, 3);
  ++positions_version_;
}

void CurveNetwork::set_edges(const uint32_t* pairs, size_t n) {
  edges_.assign(pairs, pairs + 2 * n);
  ++topology_version_;
}

void CurveNetwork::set_polyline(const float* xyz, size_t n, bool closed) {
  set_nodes(xyz, n);
  std::vector<uint32_t> e;
  for (uint32_t i = 0; i + 1 < n; ++i) e.insert(e.end(), {i, i + 1});
  if (closed && n > 2) e.insert(e.end(), {uint32_t(n - 1), 0u});
  set_edges(e.data(), e.size() / 2);
}

bool CurveNetwork::bounds(glm::vec3& lo, glm::vec3& hi) const {
  Bounds b = packed_bounds(nodes_, 3);
  if (b.any) {
    b.lo -= glm::vec3(radius);
    b.hi += glm::vec3(radius);
  }
  return b.out(lo, hi);
}

size_t CurveNetwork::count(ElementKind kind) const {
  return kind == ElementKind::Vertex ? num_nodes() : kind == ElementKind::Edge ? num_edges() : 0;
}

glm::vec3 CurveNetwork::element_position(ElementKind kind, uint32_t i) const {
  if (kind == ElementKind::Edge) return 0.5f * (node(edge(i).x) + node(edge(i).y));
  return node(i);
}

// ---- VolumeMesh -----------------------------------------------------------------

void VolumeMesh::set_geometry(const float* xyz, size_t num_vertices, const uint32_t* tets, size_t num_tets) {
  if (placed_) {
    local_.assign(xyz, xyz + 3 * num_vertices);
    transform_points(transform_, local_, positions_, 3);
  } else {
    positions_.assign(xyz, xyz + 3 * num_vertices);
  }
  tets_.assign(tets, tets + 4 * num_tets);
  ++positions_version_;
  ++topology_version_;
  ++attributes_version_;
}

void VolumeMesh::set_positions(const float* xyz) {
  if (placed_) {
    std::copy(xyz, xyz + local_.size(), local_.begin());
    transform_points(transform_, local_, positions_, 3);
  } else {
    std::copy(xyz, xyz + positions_.size(), positions_.begin());
  }
  ++positions_version_;
}

void VolumeMesh::place() {
  transform_points(transform_, local_, positions_, 3);
  ++positions_version_;
}

bool VolumeMesh::bounds(glm::vec3& lo, glm::vec3& hi) const { return packed_bounds(positions_, 3).out(lo, hi); }

size_t VolumeMesh::count(ElementKind kind) const {
  return kind == ElementKind::Vertex ? num_vertices() : kind == ElementKind::Cell ? num_cells() : 0;
}

glm::vec3 VolumeMesh::element_position(ElementKind kind, uint32_t i) const {
  if (kind == ElementKind::Cell) {
    glm::uvec4 c = cell(i);
    return 0.25f * (vertex(c.x) + vertex(c.y) + vertex(c.z) + vertex(c.w));
  }
  return vertex(i);
}

float VolumeMesh::cell_volume(uint32_t c) const {
  glm::uvec4 t = cell(c);
  glm::vec3 a = vertex(t.x);
  return std::abs(glm::dot(vertex(t.y) - a, glm::cross(vertex(t.z) - a, vertex(t.w) - a))) / 6.0f;
}

const std::vector<uint32_t>& VolumeMesh::boundary_faces() const {
  if (boundary_version_ == topology_version_) return boundary_faces_;
  // Each tet face (a, b, c) opposite corner d; a face seen once is on the boundary.
  static const int kFaces[4][4] = {{0, 1, 2, 3}, {0, 1, 3, 2}, {0, 2, 3, 1}, {1, 2, 3, 0}};
  struct Seen {
    uint32_t count = 0, cell = 0, local = 0;
  };
  std::unordered_map<uint64_t, Seen> seen;
  seen.reserve(tets_.size());
  auto key = [](uint32_t a, uint32_t b, uint32_t c) {
    uint32_t s[3] = {a, b, c};
    std::sort(s, s + 3);
    return (uint64_t(s[0]) << 42) ^ (uint64_t(s[1]) << 21) ^ uint64_t(s[2]);
  };
  for (uint32_t c = 0; c < num_cells(); ++c)
    for (int f = 0; f < 4; ++f) {
      const uint32_t* t = &tets_[4 * c];
      Seen& s = seen[key(t[kFaces[f][0]], t[kFaces[f][1]], t[kFaces[f][2]])];
      ++s.count;
      s.cell = c;
      s.local = uint32_t(f);
    }
  boundary_faces_.clear();
  boundary_cells_.clear();
  for (uint32_t c = 0; c < num_cells(); ++c)
    for (int f = 0; f < 4; ++f) {
      const uint32_t* t = &tets_[4 * c];
      uint32_t a = t[kFaces[f][0]], b = t[kFaces[f][1]], cc = t[kFaces[f][2]], d = t[kFaces[f][3]];
      const Seen& s = seen[key(a, b, cc)];
      if (s.count != 1) continue;
      // Wind outward: the normal points away from the opposite corner.
      if (glm::dot(glm::cross(vertex(b) - vertex(a), vertex(cc) - vertex(a)), vertex(d) - vertex(a)) > 0)
        std::swap(b, cc);
      boundary_faces_.insert(boundary_faces_.end(), {a, b, cc});
      boundary_cells_.push_back(c);
    }
  boundary_version_ = topology_version_;
  return boundary_faces_;
}

const std::vector<uint32_t>& VolumeMesh::boundary_cells() const {
  boundary_faces();
  return boundary_cells_;
}

const VolumeMesh::Section& VolumeMesh::slice(const glm::vec3& n, float offset) const {
  glm::vec4 plane(n, offset);
  uint64_t version = positions_version_ + topology_version_;
  if (plane == section_plane_ && version == section_version_) return section_;
  section_plane_ = plane;
  section_version_ = version;
  Section& out = section_;
  out = {};
  auto emit = [&](uint32_t a, uint32_t b, float sa, float sb) {
    float t = sa / (sa - sb);
    glm::vec3 p = glm::mix(vertex(a), vertex(b), t);
    out.positions.insert(out.positions.end(), {p.x, p.y, p.z});
    out.vertex_pair.insert(out.vertex_pair.end(), {a, b});
    out.vertex_t.push_back(t);
    return uint32_t(out.vertex_t.size() - 1);
  };
  for (uint32_t c = 0; c < num_cells(); ++c) {
    const uint32_t* t = &tets_[4 * c];
    float s[4];
    int pos[4], neg[4], np = 0, nn = 0;
    for (int k = 0; k < 4; ++k) {
      s[k] = glm::dot(n, vertex(t[k])) - offset;
      if (s[k] > 0)
        pos[np++] = k;
      else
        neg[nn++] = k;
    }
    if (np == 0 || nn == 0) continue;
    if (np == 1 || nn == 1) {
      // One corner alone on its side: a triangle on its three edges.
      int lone = np == 1 ? pos[0] : neg[0];
      const int* others = np == 1 ? neg : pos;
      uint32_t v[3];
      for (int k = 0; k < 3; ++k) v[k] = emit(t[lone], t[others[k]], s[lone], s[others[k]]);
      out.triangles.insert(out.triangles.end(), {v[0], v[1], v[2]});
      out.face_cell.push_back(c);
    } else {
      // Two and two: a quad on edges (p0,n0), (p0,n1), (p1,n1), (p1,n0).
      int a = pos[0], b = pos[1], cc = neg[0], d = neg[1];
      uint32_t v0 = emit(t[a], t[cc], s[a], s[cc]), v1 = emit(t[a], t[d], s[a], s[d]);
      uint32_t v2 = emit(t[b], t[d], s[b], s[d]), v3 = emit(t[b], t[cc], s[b], s[cc]);
      out.triangles.insert(out.triangles.end(), {v0, v1, v2, v0, v2, v3});
      out.face_cell.insert(out.face_cell.end(), {c, c});
    }
  }
  return out;
}

// ---- VectorSet ------------------------------------------------------------------

void VectorSet::set_vectors(const float* origins, const float* vectors, size_t n) {
  origins_.assign(origins, origins + 3 * n);
  vectors_.assign(vectors, vectors + 3 * n);
  if (placed_) {
    capture_local();
    place();
  }
  ++version_;
}

void VectorSet::place() {
  transform_points(transform_, local_, origins_, 3);
  // Directions: the linear part only.
  glm::mat4 L = transform_;
  L[3] = glm::vec4(0.0f, 0.0f, 0.0f, 1.0f);
  transform_points(L, local_vectors_, vectors_, 3);
  ++version_;
}

bool VectorSet::bounds(glm::vec3& lo, glm::vec3& hi) const { return packed_bounds(origins_, 3).out(lo, hi); }

// ---- Scene ----------------------------------------------------------------------

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
CurveNetwork& Scene::add_curves(const std::string& name) { return add<CurveNetwork>(name); }
VolumeMesh& Scene::add_volume(const std::string& name) { return add<VolumeMesh>(name); }
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

void Scene::set_image(const std::string& name, uint32_t width, uint32_t height, std::vector<uint8_t> rgba) {
  Image& im = images_[name];
  im.width = width;
  im.height = height;
  im.rgba = std::move(rgba);
  im.version = ++image_version_;
}

const Scene::Image* Scene::image(const std::string& name) const {
  auto it = images_.find(name);
  return it == images_.end() ? nullptr : &it->second;
}

bool Scene::bounds(glm::vec3& lo, glm::vec3& hi) const {
  Bounds b;
  for (const auto& s : structures_) {
    glm::vec3 l, h;
    if (s->visible && s->bounds(l, h)) {
      b.add(l);
      b.add(h);
    }
  }
  return b.out(lo, hi);
}

}  // namespace rillfacet
