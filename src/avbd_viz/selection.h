#pragma once
// Selection (vertex / edge / face / segment) and measurements.
//
// Picking reads the prepass id buffer (object id, face, segment per pixel),
// so what you click is exactly what you see; the exact hit point is then
// refined on the CPU by intersecting the view ray with that triangle.

#include "avbd_viz/camera.h"
#include "avbd_viz/scene.h"

#include <glm/glm.hpp>

#include <cstdint>
#include <string>
#include <unordered_set>
#include <vector>

namespace avbd_viz {

enum class PickMode : int { Vertex, Edge, Face, Segment };
const char* pick_mode_name(PickMode m);

constexpr uint32_t kGroundId = 0xffffffffu;

// One pixel of the id buffer.
struct IdPixel {
  uint32_t object = 0;   // structure id, 0 = background, kGroundId = ground
  uint32_t element = 0;  // face (meshes) or point/vector index
  uint32_t segment = 0;
  uint32_t flags = 0;
};

// What a selected index means depends on the structure and pick mode:
//   surface mesh   vertex / edge / face / segment ("body")
//   curve network  node (Vertex mode) / edge (Edge, Face) / 0 = whole (Body)
//   volume mesh    vertex (Vertex) / tet cell (Edge, Face) / 0 = whole (Body)
//   points, vectors  item index, or 0 = whole (Body)
struct ElementRef {
  uint32_t object = 0;
  uint32_t index = 0;
  bool operator==(const ElementRef& o) const { return object == o.object && index == o.index; }
};

class Selection {
 public:
  PickMode mode() const { return mode_; }
  void set_mode(PickMode m);

  const std::vector<ElementRef>& items() const { return items_; }
  const ElementRef* active() const { return items_.empty() ? nullptr : &items_.back(); }
  bool contains(const ElementRef& e) const { return lookup_.count(key(e)) != 0; }
  bool empty() const { return items_.empty(); }

  void clear();
  void set(const ElementRef& e);     // replace
  void toggle(const ElementRef& e);  // shift-click
  void add(const std::vector<ElementRef>& es, bool extend);  // box select
  uint64_t version() const { return version_; }

 private:
  static uint64_t key(const ElementRef& e) { return (uint64_t(e.object) << 32) | e.index; }
  PickMode mode_ = PickMode::Face;
  std::vector<ElementRef> items_;
  std::unordered_set<uint64_t> lookup_;
  uint64_t version_ = 1;
};

// A point that follows moving geometry.
struct Anchor {
  enum Kind { Vertex, Surface, Ground, Point, Fixed } kind = Ground;
  uint32_t object = 0;
  uint32_t index = 0;    // vertex/node, face or point index
  glm::vec3 bary{0.0f};  // Surface: barycentric coordinates in the face
  glm::vec3 point{0.0f}; // Ground / Fixed: world position
};

// Element kind a pick mode selects on a structure (Segment for whole
// structures other than meshes).
ElementKind picked_kind(const Structure& s, PickMode mode);

enum class MeasureTool : int { Off, Distance, Angle };

struct Measurement {
  std::vector<Anchor> anchors;  // 2 = distance, 3 = angle at the middle anchor
  bool angle = false;
};

glm::vec3 resolve_anchor(const Scene& scene, const Anchor& a);
std::string anchor_label(const Scene& scene, const Anchor& a);

// Exact hit of `ray` on the element under an id pixel.
struct Hit {
  bool valid = false;
  Anchor surface;       // Surface / Ground / Point anchor at the hit
  glm::vec3 point{0.0f};
};
Hit refine_hit(const Scene& scene, const IdPixel& px, const Ray& ray, float ground_height);

// Chooses the element of the current pick mode closest to the cursor among
// the faces seen in a small id window around it. Returns false if none.
bool pick_element(const Scene& scene, const Camera& cam, PickMode mode,
                  const std::vector<IdPixel>& window, const glm::vec2& cursor,
                  const glm::vec2& viewport, ElementRef& out);

// All elements inside a screen rectangle. Visible-only unless `xray`.
std::vector<ElementRef> box_select(const Scene& scene, const Camera& cam, PickMode mode,
                                   const std::vector<IdPixel>& region, const glm::vec2& lo,
                                   const glm::vec2& hi, const glm::vec2& viewport, bool xray);

// Hide the selected bodies (segment mode) / bring back every body the user
// hid. Bodies hidden by the application (e.g. a ground slab) stay hidden.
size_t hide_selected_segments(Scene& scene, Selection& selection);
size_t unhide_all_segments(Scene& scene);
size_t count_user_hidden_segments(const Scene& scene);

// World-space representative position of a selected element.
glm::vec3 element_position(const Scene& scene, PickMode mode, const ElementRef& e);

}  // namespace avbd_viz
