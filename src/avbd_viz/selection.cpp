#include "avbd_viz/selection.h"

#include <algorithm>
#include <cmath>
#include <limits>
#include <map>
#include <set>
#include <tuple>

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

ElementKind picked_kind(const Structure& s, PickMode mode) {
  switch (s.kind()) {
    case StructureKind::SurfaceMesh: return ElementKind(int(mode));
    case StructureKind::CurveNetwork:
      return mode == PickMode::Vertex ? ElementKind::Vertex
             : mode == PickMode::Segment ? ElementKind::Segment : ElementKind::Edge;
    case StructureKind::VolumeMesh:
      return mode == PickMode::Vertex ? ElementKind::Vertex
             : mode == PickMode::Segment ? ElementKind::Segment : ElementKind::Cell;
    default: return mode == PickMode::Segment ? ElementKind::Segment : ElementKind::Vertex;
  }
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

// ---- Positions and anchors ----------------------------------------------------

static glm::vec3 bounds_center(const Structure& s) {
  glm::vec3 lo, hi;
  return s.bounds(lo, hi) ? 0.5f * (lo + hi) : glm::vec3(0.0f);
}

glm::vec3 element_position(const Scene& scene, PickMode mode, const ElementRef& e) {
  const Structure* s = scene.find(e.object);
  if (!s) return {};
  ElementKind kind = picked_kind(*s, mode);
  if (auto* v = dynamic_cast<const VectorSet*>(s))
    return kind == ElementKind::Segment || e.index >= v->size() ? bounds_center(*s) : v->origin(e.index);
  auto* q = dynamic_cast<const QuantityStructure*>(s);
  if (!q) return {};
  if (kind == ElementKind::Segment && s->kind() != StructureKind::SurfaceMesh) return bounds_center(*s);
  if (e.index >= q->count(kind)) return {};
  return q->element_position(kind, e.index);
}

glm::vec3 resolve_anchor(const Scene& scene, const Anchor& a) {
  switch (a.kind) {
    case Anchor::Vertex:
      if (auto* q = scene.get<QuantityStructure>(a.object); q && a.index < q->count(ElementKind::Vertex))
        return q->element_position(ElementKind::Vertex, a.index);
      break;
    case Anchor::Surface:
      if (auto* m = scene.get<SurfaceMesh>(a.object); m && a.index < m->num_faces()) {
        glm::uvec3 f = m->face(a.index);
        return a.bary.x * m->vertex(f.x) + a.bary.y * m->vertex(f.y) + a.bary.z * m->vertex(f.z);
      }
      break;
    case Anchor::Point:
      if (auto* p = scene.get<PointCloud>(a.object); p && a.index < p->size()) return p->point(a.index);
      if (auto* v = scene.get<VectorSet>(a.object); v && a.index < v->size()) return v->origin(a.index);
      break;
    case Anchor::Ground:
    case Anchor::Fixed: break;
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
    case Anchor::Fixed: return name + " point";
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

// The three corners of a face of a volume's boundary (segment 0) or of its
// current cross-section (segment 1), and the tet it belongs to.
static bool volume_face(const VolumeMesh& v, uint32_t segment, uint32_t face, glm::vec3 p[3], uint32_t& cell) {
  if (segment == 0) {
    const auto& bf = v.boundary_faces();
    if (3 * face + 2 >= bf.size()) return false;
    for (int k = 0; k < 3; ++k) p[k] = v.vertex(bf[3 * face + k]);
    cell = v.boundary_cells()[face];
    return true;
  }
  const VolumeMesh::Section& sec = v.last_section();
  if (3 * face + 2 >= sec.triangles.size()) return false;
  for (int k = 0; k < 3; ++k) {
    const float* x = &sec.positions[3 * sec.triangles[3 * face + k]];
    p[k] = {x[0], x[1], x[2]};
  }
  cell = sec.face_cell[face];
  return true;
}

// Closest point on segment [a, b] to a ray.
static glm::vec3 closest_on_segment(const Ray& r, const glm::vec3& a, const glm::vec3& b) {
  glm::vec3 u = b - a, w = a - r.origin;
  float uu = glm::dot(u, u), ud = glm::dot(u, r.dir), uw = glm::dot(u, w), dw = glm::dot(r.dir, w);
  float den = uu - ud * ud;
  float t = den > 1e-12f ? (ud * dw - uw) / den : 0.0f;
  return a + u * glm::clamp(t, 0.0f, 1.0f);
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
  glm::vec3 bary, p;
  if (auto* m = dynamic_cast<const SurfaceMesh*>(s); m && px.element < m->num_faces()) {
    glm::uvec3 f = m->face(px.element);
    if (!ray_triangle(ray, m->vertex(f.x), m->vertex(f.y), m->vertex(f.z), bary, p)) return hit;
    hit.surface = {Anchor::Surface, px.object, px.element, bary, p};
  } else if (auto* v = dynamic_cast<const VolumeMesh*>(s)) {
    glm::vec3 c[3];
    uint32_t cell;
    if (!volume_face(*v, px.segment, px.element, c, cell) || !ray_triangle(ray, c[0], c[1], c[2], bary, p)) return hit;
    hit.surface = {Anchor::Fixed, px.object, cell, {}, p};
  } else if (auto* cn = dynamic_cast<const CurveNetwork*>(s); cn && px.element < cn->num_edges()) {
    glm::uvec2 e = cn->edge(px.element);
    p = closest_on_segment(ray, cn->node(e.x), cn->node(e.y));
    hit.surface = {Anchor::Fixed, px.object, px.element, {}, p};
  } else {
    hit.surface = {Anchor::Point, px.object, px.element, {}, {}};
    p = resolve_anchor(scene, hit.surface);
  }
  hit.point = p;
  hit.valid = true;
  return hit;
}

// ---- Picking --------------------------------------------------------------------

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

bool pick_element(const Scene& scene, const Camera& cam, PickMode mode, const std::vector<IdPixel>& window,
                  const glm::vec2& cursor, const glm::vec2& vp, ElementRef& out) {
  if (window.empty()) return false;
  auto is_object = [](const IdPixel& p) { return p.object != 0 && p.object != kGroundId; };
  const IdPixel& center = window[window.size() / 2];

  // Clicking right on something picks it directly in the "area" modes.
  if (is_object(center)) {
    const Structure* s = scene.find(center.object);
    if (!s) return false;
    ElementKind k = picked_kind(*s, mode);
    if (k == ElementKind::Segment && s->kind() != StructureKind::SurfaceMesh) {
      out = {center.object, 0};
      return true;
    }
    switch (s->kind()) {
      case StructureKind::PointCloud:
      case StructureKind::VectorSet: out = {center.object, center.element}; return true;
      case StructureKind::SurfaceMesh:
        if (k == ElementKind::Face) return out = {center.object, center.element}, true;
        if (k == ElementKind::Segment) return out = {center.object, center.segment}, true;
        break;
      case StructureKind::CurveNetwork:
        if (k == ElementKind::Edge) return out = {center.object, center.element}, true;
        break;
      case StructureKind::VolumeMesh: {
        glm::vec3 p[3];
        uint32_t cell;
        if (k == ElementKind::Cell && volume_face(*static_cast<const VolumeMesh*>(s), center.segment,
                                                  center.element, p, cell))
          return out = {center.object, cell}, true;
        break;
      }
    }
  }

  // Otherwise the nearest element (on screen) among everything under the window.
  std::set<std::tuple<uint32_t, uint32_t, uint32_t>> seen;
  for (const IdPixel& p : window)
    if (is_object(p)) seen.insert({p.object, p.element, p.segment});
  float best = std::numeric_limits<float>::max();
  auto consider = [&](uint32_t obj, uint32_t idx, float d) {
    if (d < best) {
      best = d;
      out = {obj, idx};
    }
  };
  auto near_point = [&](const glm::vec3& p) { return glm::length(to_screen(cam, p, vp) - cursor); };
  for (auto [obj, elem, seg] : seen) {
    const Structure* s = scene.find(obj);
    if (!s) continue;
    ElementKind k = picked_kind(*s, mode);
    if (auto* m = dynamic_cast<const SurfaceMesh*>(s)) {
      if (elem >= m->num_faces()) continue;
      glm::uvec3 f = m->face(elem);
      uint32_t v[3] = {f.x, f.y, f.z};
      glm::vec2 sp[3] = {to_screen(cam, m->vertex(f.x), vp), to_screen(cam, m->vertex(f.y), vp),
                         to_screen(cam, m->vertex(f.z), vp)};
      for (int c = 0; c < 3; ++c) {
        if (k == ElementKind::Vertex) consider(obj, v[c], glm::length(sp[c] - cursor));
        if (k == ElementKind::Edge)
          consider(obj, m->face_edges()[3 * elem + c], dist_to_segment(cursor, sp[c], sp[(c + 1) % 3]));
      }
      glm::vec2 centroid = (sp[0] + sp[1] + sp[2]) / 3.0f;
      if (k == ElementKind::Face) consider(obj, elem, glm::length(centroid - cursor));
      if (k == ElementKind::Segment) consider(obj, m->segment_of_face(elem), glm::length(centroid - cursor));
    } else if (auto* c = dynamic_cast<const CurveNetwork*>(s); c && elem < c->num_edges()) {
      glm::uvec2 e = c->edge(elem);
      if (k == ElementKind::Vertex) {
        consider(obj, e.x, near_point(c->node(e.x)));
        consider(obj, e.y, near_point(c->node(e.y)));
      } else if (k == ElementKind::Edge) {
        consider(obj, elem, dist_to_segment(cursor, to_screen(cam, c->node(e.x), vp), to_screen(cam, c->node(e.y), vp)));
      } else {
        consider(obj, 0, 0.0f);
      }
    } else if (auto* v = dynamic_cast<const VolumeMesh*>(s)) {
      glm::vec3 p[3];
      uint32_t cell;
      if (!volume_face(*v, seg, elem, p, cell)) continue;
      glm::uvec4 t = v->cell(cell);
      if (k == ElementKind::Vertex)
        for (uint32_t vi : {t.x, t.y, t.z, t.w}) consider(obj, vi, near_point(v->vertex(vi)));
      else if (k == ElementKind::Cell)
        consider(obj, cell, near_point(v->element_position(ElementKind::Cell, cell)));
      else
        consider(obj, 0, 0.0f);
    } else {
      consider(obj, k == ElementKind::Segment ? 0 : elem,
               near_point(resolve_anchor(scene, {Anchor::Point, obj, elem, {}, {}})));
    }
  }
  return best < std::numeric_limits<float>::max();
}

std::vector<ElementRef> box_select(const Scene& scene, const Camera& cam, PickMode mode,
                                   const std::vector<IdPixel>& region, const glm::vec2& lo, const glm::vec2& hi,
                                   const glm::vec2& vp, bool xray) {
  auto inside = [&](const glm::vec3& p) {
    bool front;
    glm::vec2 s = to_screen(cam, p, vp, &front);
    return (front || cam.ortho) && s.x >= lo.x && s.x <= hi.x && s.y >= lo.y && s.y <= hi.y;
  };
  std::vector<ElementRef> out;
  std::set<std::pair<uint32_t, uint32_t>> taken;
  auto push = [&](uint32_t obj, uint32_t idx) {
    if (taken.insert({obj, idx}).second) out.push_back({obj, idx});
  };

  // Candidates per structure: elements seen in the region (mesh faces, curve
  // edges, volume cells, points), or everything in x-ray mode.
  std::map<uint32_t, std::set<uint32_t>> seen;
  if (!xray)
    for (const IdPixel& p : region) {
      if (p.object == 0 || p.object == kGroundId) continue;
      uint32_t elem = p.element;
      if (auto* v = scene.get<VolumeMesh>(p.object)) {
        glm::vec3 c[3];
        if (!volume_face(*v, p.segment, p.element, c, elem)) continue;
      }
      seen[p.object].insert(elem);
    }

  for (const auto& sp : scene.structures()) {
    const Structure* s = sp.get();
    if (!s->visible || (!xray && !seen.count(s->id()))) continue;
    const uint32_t id = s->id();
    ElementKind k = picked_kind(*s, mode);
    std::vector<uint32_t> cand;
    if (xray) {
      size_t n = 0;
      if (auto* m = dynamic_cast<const SurfaceMesh*>(s)) n = m->num_faces();
      else if (auto* c = dynamic_cast<const CurveNetwork*>(s)) n = c->num_edges();
      else if (auto* v = dynamic_cast<const VolumeMesh*>(s)) n = v->num_cells();
      else if (auto* p = dynamic_cast<const PointCloud*>(s)) n = p->size();
      else if (auto* vs = dynamic_cast<const VectorSet*>(s)) n = vs->size();
      for (uint32_t i = 0; i < n; ++i) cand.push_back(i);
    } else {
      cand.assign(seen[id].begin(), seen[id].end());
    }

    if (auto* m = dynamic_cast<const SurfaceMesh*>(s)) {
      for (uint32_t f : cand) {
        if (!m->segment_visible(m->segment_of_face(f))) continue;
        glm::uvec3 t = m->face(f);
        glm::vec3 p[3] = {m->vertex(t.x), m->vertex(t.y), m->vertex(t.z)};
        uint32_t v[3] = {t.x, t.y, t.z};
        switch (k) {
          case ElementKind::Vertex:
            for (int c = 0; c < 3; ++c)
              if (inside(p[c])) push(id, v[c]);
            break;
          case ElementKind::Edge:
            for (int c = 0; c < 3; ++c)
              if (inside(p[c]) && inside(p[(c + 1) % 3])) push(id, m->face_edges()[3 * f + c]);
            break;
          case ElementKind::Face:
            if (inside((p[0] + p[1] + p[2]) / 3.0f)) push(id, f);
            break;
          default:
            if (!xray || inside((p[0] + p[1] + p[2]) / 3.0f)) push(id, m->segment_of_face(f));
            break;
        }
      }
    } else if (auto* c = dynamic_cast<const CurveNetwork*>(s)) {
      for (uint32_t e : cand) {
        glm::uvec2 ed = c->edge(e);
        bool a = inside(c->node(ed.x)), b = inside(c->node(ed.y));
        if (k == ElementKind::Vertex) {
          if (a) push(id, ed.x);
          if (b) push(id, ed.y);
        } else if (k == ElementKind::Edge) {
          if (a && b) push(id, e);
        } else if (a || b) {
          push(id, 0);
        }
      }
    } else if (auto* v = dynamic_cast<const VolumeMesh*>(s)) {
      for (uint32_t cell : cand) {
        glm::uvec4 t = v->cell(cell);
        if (k == ElementKind::Vertex) {
          for (uint32_t vi : {t.x, t.y, t.z, t.w})
            if (inside(v->vertex(vi))) push(id, vi);
        } else if (inside(v->element_position(ElementKind::Cell, cell))) {
          push(id, k == ElementKind::Cell ? cell : 0);
        }
      }
    } else {
      for (uint32_t i : cand)
        if (inside(resolve_anchor(scene, {Anchor::Point, id, i, {}, {}}))) push(id, k == ElementKind::Segment ? 0 : i);
    }
  }
  return out;
}

// ---- Hiding -------------------------------------------------------------------

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

}  // namespace avbd_viz
