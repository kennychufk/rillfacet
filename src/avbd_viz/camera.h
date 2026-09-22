#pragma once
// Z-up turntable camera with Blender-style navigation.
//
// Depth convention: reversed-Z (near plane -> depth 1, infinity -> depth 0)
// with an infinite far plane. It keeps float depth precise from millimetres
// to kilometres, which matters for a huge ground grid next to small parts.

#include <glm/glm.hpp>

namespace avbd_viz {

struct Ray {
  glm::vec3 origin;
  glm::vec3 dir;  // unit length
};

enum class ViewPreset { Front, Back, Right, Left, Top, Bottom };

class Camera {
 public:
  glm::vec3 target{0.0f, 0.0f, 0.0f};
  float distance = 10.0f;
  float yaw = -1.5708f;  // radians around +Z; -pi/2 looks along +Y (Blender "Front")
  float pitch = 0.35f;   // radians above the ground plane
  float fov_y = 0.6981f; // 40 degrees
  bool ortho = false;

  glm::vec3 eye() const;
  glm::vec3 forward() const;  // unit, from eye toward target
  glm::vec3 right() const;
  glm::vec3 up() const;

  glm::mat4 view() const;
  glm::mat4 proj(float aspect) const;
  float near_plane() const;
  // World-space height of the view at the target distance (ortho zoom level).
  float view_height() const;

  // Pixel coordinates (origin top-left) -> world ray.
  Ray ray(float px, float py, float width, float height) const;
  // World point -> pixel coordinates; z = view depth (negative behind camera).
  glm::vec3 project(const glm::vec3& p, float width, float height) const;
  // World size of one pixel at `p`.
  float pixel_size_at(const glm::vec3& p, float height) const;

  // Navigation (deltas in pixels).
  void orbit(float dx, float dy);
  void pan(float dx, float dy, float viewport_height);
  void dolly(float steps);  // wheel steps; positive zooms in

  // Animated transitions (Blender "smooth view").
  void animate_to(const glm::vec3& target, float distance, float yaw, float pitch,
                  float seconds = 0.2f);
  void set_view(ViewPreset preset);  // axis-aligned view, switches to ortho (auto perspective)
  // World axis the view looks along when it is exactly axis-aligned
  // (0 = X, 1 = Y, 2 = Z), otherwise -1.
  int aligned_axis() const;
  void frame_bounds(const glm::vec3& lo, const glm::vec3& hi, bool animate = true);
  void update(float dt);  // advances animations
  bool animating() const { return anim_t_ < anim_len_; }

  // Blender "auto perspective": axis views go ortho, orbiting returns to perspective.
  bool auto_perspective = true;

 private:
  glm::vec3 from_target_{0}, to_target_{0};
  float from_dist_ = 0, to_dist_ = 0, from_yaw_ = 0, to_yaw_ = 0, from_pitch_ = 0, to_pitch_ = 0;
  float anim_t_ = 1, anim_len_ = 0;
  bool ortho_from_preset_ = false;
};

}  // namespace avbd_viz
