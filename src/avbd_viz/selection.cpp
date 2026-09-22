#include "avbd_viz/selection.h"

#include <algorithm>
#include <cmath>
#include <limits>
#include <set>

namespace avbd_viz {

const char* pick_mode_name(PickMode m) {
  switch (m) {
    case PickMode::Vertex: return "Vertex";
    case PickMode::Edge: return "Edge";
    case PickMode::Face: return "Face";
    case PickMode::Segment: return "Body";
  }
  return "?";
}

void Selection::set_mode(PickMode m) {
  if (m == mode_) return;
  mode_ = m;
  clear();
}

void Selection::clear() {
  if (items_.empty()) return;
  items_.clear();
  lookup_.clear();
  ++version_;
}

void Selection::set(const ElementRef& e) {
  items_ = {e};
  lookup_ = {key(e)};
  ++version_;
}

void Selection::toggle(const ElementRef& e) {
  if (lookup_.erase(key(e))) {
    std::erase(items_, e);
  } else {
    items_.push_back(e);
    lookup_.insert(key(e));
  }
  ++version_;
}

void Selection::add(const std::vector<ElementRef>& es, bool extend) {
  if (!extend) {
    items_.clear();
    lookup_.clear();
  }
  for (const ElementRef& e : es)
    if (lookup_.insert(key(e)).second) items_.push_back(e);
  ++version_;
}

// ---- Anchors ----------------------------------------------------------------

glm::vec3 resolve_anchor(const Scene& scene, const Anchor& a) {
  switch (a.kind) {
    case Anchor::Vertex:
      if (auto* m = scene.get<SurfaceMesh>(a.object); m && a.index < m->num_vertices())
        return m->vertex(a.index);
      break;
    case Anchor::Surface:
      if (auto* m = scene.get<SurfaceMesh>(a.object); m && a.index < m->num_faces()) {
        glm::uvec3 f = m->face(a.index);
        return a.bary.x * m->vertex(f.x) + a.bary.y * m->vertex(f.y) + a.bary.z * m->vertex(f.z);
      }
      break;
    case Anchor::Point:
      if (auto* p = scene.get<PointCloud>(a.object); p && a.index < p->size()) return p->point(a.index);
      if (auto* v = scene.get<VectorSet>(a.object); v && a.index < v->size())
        return {v->origins()[3 * a.index], v->origins()[3 * a.index + 1], v->origins()[3 * a.index + 2]};
      break;
    case Anchor::Ground: break;
  }
  return a.point;
}

std::string anchor_label(const Scene& scene, const Anchor& a) {
  const Structure* s = scene.find(a.object);
  std::string name = s ? s->name() : "?";
  switch (a.kind) {
    case Anchor::Vertex: return name + " v" + std::to_string(a.index);
    case Anchor::Surface: return name + " f" + std::to_string(a.index);
    case Anchor::Point: return name + " #" + std::to_string(a.index);
    case Anchor::Ground: return "ground";
  }
  return "?";
}

// ---- Hits -------------------------------------------------------------------

// Ray vs triangle plane, returning barycentrics of the plane hit (clamped
// onto the triangle, so a hit on an anti-aliased edge pixel still counts).
static bool ray_triangle(const Ray& r, const glm::vec3& a, const glm::vec3& b, const glm::vec3& c,
                         glm::vec3& bary, glm::vec3& point) {
  glm::vec3 n = glm::cross(b - a, c - a);
  float denom = glm::dot(n, r.dir);
  if (std::abs(denom) < 1e-20f) return false;
  float t = glm::dot(n, a - r.origin) / denom;
  glm::vec3 p = r.origin + r.dir * t;
  float area = glm::dot(n, n);
  bary.x = glm::dot(glm::cross(c - b, p - b), n) / area;
  bary.y = glm::dot(glm::cross(a - c, p - c), n) / area;
  bary = glm::vec3(bary.x, bary.y, 1.0f - bary.x - bary.y);
  bary = glm::max(bary, glm::vec3(0.0f));
  bary /= bary.x + bary.y + bary.z;
  point = bary.x * a + bary.y * b + bary.z * c;
  return true;
}

Hit refine_hit(const Scene& scene, const IdPixel& px, const Ray& ray, float ground_height) {
  Hit hit;
  if (px.object == kGroundId) {
    if (std::abs(ray.dir.z) < 1e-8f) return hit;
    float t = (ground_height - ray.origin.z) / ray.dir.z;
    if (t <= 0) return hit;
    hit.point = ray.origin + ray.dir * t;
    hit.surface.kind = Anchor::Ground;
    hit.surface.point = hit.point;
    hit.valid = true;
    return hit;
  }
  const Structure* s = scene.find(px.object);
  if (!s) return hit;
  if (auto* m = dynamic_cast<const SurfaceMesh*>(s); m && px.element < m->num_faces()) {
    glm::uvec3 f = m->face(px.element);
    glm::vec3 bary, p;
    if (!ray_triangle(ray, m->vertex(f.x), m->vertex(f.y), m->vertex(f.z), bary, p)) return hit;
    hit.surface = {Anchor::Surface, px.object, px.element, bary, p};
    hit.point = p;
    hit.valid = true;
  } else {
    hit.surface = {Anchor::Point, px.object, px.element, {}, {}};
    hit.point = resolve_anchor(scene, hit.surface);
    hit.valid = true;
  }
  return hit;
}

static float dist_to_segment(const glm::vec2& p, const glm::vec2& a, const glm::vec2& b) {
  glm::vec2 ab = b - a;
  float t = glm::clamp(glm::dot(p - a, ab) / std::max(glm::dot(ab, ab), 1e-12f), 0.0f, 1.0f);
  return glm::length(p - a - ab * t);
}

static glm::vec2 to_screen(const Camera& cam, const glm::vec3& p, const glm::vec2& vp, bool* in_front = nullptr) {
  glm::vec3 s = cam.project(p, vp.x, vp.y);
  if (in_front) *in_front = s.z < 0.0f;
  return {s.x, s.y};
}

bool pick_element(const Scene& scene, const Camera& cam, PickMode mode,
                  const std::vector<IdPixel>& window, const glm::vec2& cursor, const glm::vec2& vp,
                  ElementRef& out) {
  if (window.empty()) return false;
  const IdPixel& center = window[window.size() / 2];
  // Points / vectors under the cursor win in every mode.
  if (center.object != 0 && center.object != kGroundId && !scene.get<SurfaceMesh>(center.object)) {
    out = {center.object, center.element};
    return true;
  }
  std::set<std::pair<uint32_t, uint32_t>> faces;
  for (const IdPixel& p : window)
    if (p.object != 0 && p.object != kGroundId && scene.get<SurfaceMesh>(p.object))
      faces.insert({p.object, p.element});
  if (faces.empty()) return false;

  bool center_is_face = center.object != 0 && center.object != kGroundId &&
                        scene.get<SurfaceMesh>(center.object);
  if (mode == PickMode::Face && center_is_face) {
    out = {center.object, center.element};
    return true;
  }
  if (mode == PickMode::Segment && center_is_face) {
    out = {center.object, center.segment};
    return true;
  }

  float best = std::numeric_limits<float>::max();
  for (auto [obj, face] : faces) {
    const SurfaceMesh* m = scene.get<SurfaceMesh>(obj);
    if (!m || face >= m->num_faces()) continue;
    glm::uvec3 f = m->face(face);
    glm::vec2 s[3] = {to_screen(cam, m->vertex(f.x), vp), to_screen(cam, m->vertex(f.y), vp),
                      to_screen(cam, m->vertex(f.z), vp)};
    uint32_t v[3] = {f.x, f.y, f.z};
    switch (mode) {
      case PickMode::Vertex:
        for (int k = 0; k < 3; ++k) {
          float d = glm::length(s[k] - cursor);
          if (d < best) {
            best = d;
            out = {obj, v[k]};
          }
        }
        break;
      case PickMode::Edge:
        for (int k = 0; k < 3; ++k) {
          float d = dist_to_segment(cursor, s[k], s[(k + 1) % 3]);
          if (d < best) {
            best = d;
            out = {obj, m->face_edges()[3 * face + k]};
          }
        }
        break;
      case PickMode::Face:
      case PickMode::Segment: {
        float d = glm::length((s[0] + s[1] + s[2]) / 3.0f - cursor);
        if (d < best) {
          best = d;
          out = {obj, mode == PickMode::Face ? face : m->segment_of_face(face)};
        }
        break;
      }
    }
  }
  return best < std::numeric_limits<float>::max();
}

std::vector<ElementRef> box_select(const Scene& scene, const Camera& cam, PickMode mode,
                                   const std::vector<IdPixel>& region, const glm::vec2& lo,
                                   const glm::vec2& hi, const glm::vec2& vp, bool xray) {
  auto inside = [&](const glm::vec3& p) {
    bool front;
    glm::vec2 s = to_screen(cam, p, vp, &front);
    return front && s.x >= lo.x && s.x <= hi.x && s.y >= lo.y && s.y <= hi.y;
  };
  // Candidate faces: visible ones from the id buffer, or all of them in x-ray.
  std::set<std::pair<uint32_t, uint32_t>> faces, points;
  if (xray) {
    for (const auto& s : scene.structures()) {
      if (!s->visible) continue;
      if (auto* m = dynamic_cast<const SurfaceMesh*>(s.get())) {
        for (uint32_t f = 0; f < m->num_faces(); ++f)
          if (m->segment_visible(m->segment_of_face(f))) faces.insert({m->id(), f});
      } else if (auto* p = dynamic_cast<const PointCloud*>(s.get())) {
        for (uint32_t i = 0; i < p->size(); ++i) points.insert({p->id(), i});
      }
    }
  } else {
    for (const IdPixel& p : region) {
      if (p.object == 0 || p.object == kGroundId) continue;
      if (scene.get<SurfaceMesh>(p.object))
        faces.insert({p.object, p.element});
      else
        points.insert({p.object, p.element});
    }
  }

  std::vector<ElementRef> out;
  std::set<std::pair<uint32_t, uint32_t>> seen;
  auto push = [&](uint32_t obj, uint32_t idx) {
    if (seen.insert({obj, idx}).second) out.push_back({obj, idx});
  };
  for (auto [obj, face] : faces) {
    const SurfaceMesh* m = scene.get<SurfaceMesh>(obj);
    glm::uvec3 f = m->face(face);
    glm::vec3 p[3] = {m->vertex(f.x), m->vertex(f.y), m->vertex(f.z)};
    uint32_t v[3] = {f.x, f.y, f.z};
    switch (mode) {
      case PickMode::Vertex:
        for (int k = 0; k < 3; ++k)
          if (inside(p[k])) push(obj, v[k]);
        break;
      case PickMode::Edge:
        for (int k = 0; k < 3; ++k)
          if (inside(p[k]) && inside(p[(k + 1) % 3])) push(obj, m->face_edges()[3 * face + k]);
        break;
      case PickMode::Face:
        if (inside((p[0] + p[1] + p[2]) / 3.0f)) push(obj, face);
        break;
      case PickMode::Segment:
        if (!xray || inside((p[0] + p[1] + p[2]) / 3.0f)) push(obj, m->segment_of_face(face));
        break;
    }
  }
  for (auto [obj, idx] : points) {
    Anchor a{Anchor::Point, obj, idx, {}, {}};
    if (inside(resolve_anchor(scene, a))) push(obj, idx);
  }
  return out;
}

size_t hide_selected_segments(Scene& scene, Selection& selection) {
  if (selection.mode() != PickMode::Segment) return 0;
  size_t n = 0;
  for (const ElementRef& e : selection.items())
    if (auto* m = scene.get<SurfaceMesh>(e.object); m && e.index < m->num_segments()) {
      m->set_segment_hidden_by_user(e.index, true);
      ++n;
    }
  selection.clear();
  return n;
}

size_t unhide_all_segments(Scene& scene) {
  size_t n = 0;
  for (const auto& s : scene.structures())
    if (auto* m = dynamic_cast<SurfaceMesh*>(s.get())) n += m->unhide_all_by_user();
  return n;
}

size_t count_user_hidden_segments(const Scene& scene) {
  size_t n = 0;
  for (const auto& s : scene.structures())
    if (auto* m = dynamic_cast<const SurfaceMesh*>(s.get()))
      for (uint32_t k = 0; k < m->num_segments(); ++k) n += m->segment_hidden_by_user(k);
  return n;
}

glm::vec3 element_position(const Scene& scene, PickMode mode, const ElementRef& e) {
  const SurfaceMesh* m = scene.get<SurfaceMesh>(e.object);
  if (!m) return resolve_anchor(scene, {Anchor::Point, e.object, e.index, {}, {}});
  switch (mode) {
    case PickMode::Vertex: return m->vertex(e.index);
    case PickMode::Edge: {
      const auto& ed = m->edges();
      return 0.5f * (m->vertex(ed[2 * e.index]) + m->vertex(ed[2 * e.index + 1]));
    }
    case PickMode::Face: {
      glm::uvec3 f = m->face(e.index);
      return (m->vertex(f.x) + m->vertex(f.y) + m->vertex(f.z)) / 3.0f;
    }
    case PickMode::Segment: {
      glm::vec3 lo(std::numeric_limits<float>::max()), hi = -lo;
      const auto& off = m->segment_offsets();
      for (uint32_t f = off[e.index]; f < off[e.index + 1]; ++f)
        for (int k = 0; k < 3; ++k) {
          glm::vec3 p = m->vertex(m->triangles()[3 * f + k]);
          lo = glm::min(lo, p);
          hi = glm::max(hi, p);
        }
      return 0.5f * (lo + hi);
    }
  }
  return {};
}

}  // namespace avbd_viz
