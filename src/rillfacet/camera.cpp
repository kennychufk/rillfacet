#include "rillfacet/camera.h"

#include <glm/gtc/matrix_transform.hpp>

#include <algorithm>
#include <cmath>

namespace rillfacet {

static constexpr float kPi = 3.14159265358979f;

glm::vec3 Camera::forward() const {
  // Eye sits at target - forward * distance.
  return -glm::vec3(std::cos(pitch) * std::cos(yaw), std::cos(pitch) * std::sin(yaw),
                    std::sin(pitch));
}

glm::vec3 Camera::eye() const { return target - forward() * distance; }

// Turntable: "right" never tilts, so the horizon stays level and views
// straight down (Top) are still well defined.
glm::vec3 Camera::right() const { return {-std::sin(yaw), std::cos(yaw), 0.0f}; }

glm::vec3 Camera::up() const { return glm::cross(right(), forward()); }

glm::mat4 Camera::view() const {
  glm::vec3 f = forward(), r = right(), u = up(), e = eye();
  glm::mat4 m(1.0f);
  m[0] = {r.x, u.x, -f.x, 0};
  m[1] = {r.y, u.y, -f.y, 0};
  m[2] = {r.z, u.z, -f.z, 0};
  m[3] = {-glm::dot(r, e), -glm::dot(u, e), glm::dot(f, e), 1};
  return m;
}

float Camera::near_plane() const { return std::max(1e-4f, distance * 1e-3f); }

float Camera::view_height() const { return 2.0f * distance * std::tan(0.5f * fov_y); }

glm::mat4 Camera::proj(float aspect) const {
  glm::mat4 p(0.0f);
  if (ortho) {
    // Reversed-Z orthographic: depth 1 at the near plane, 0 at `far`.
    float h = 0.5f * view_height(), w = h * aspect;
    float n = -distance * 50.0f, f = distance * 50.0f;
    p[0][0] = 1.0f / w;
    p[1][1] = 1.0f / h;
    p[2][2] = 1.0f / (f - n);
    p[3][2] = f / (f - n);
    p[3][3] = 1.0f;
  } else {
    // Reversed-Z infinite perspective: depth = near / (-z_view).
    float t = 1.0f / std::tan(0.5f * fov_y);
    p[0][0] = t / aspect;
    p[1][1] = t;
    p[2][3] = -1.0f;
    p[3][2] = near_plane();
  }
  return p;
}

Ray Camera::ray(float px, float py, float width, float height) const {
  float nx = px / width * 2.0f - 1.0f;
  float ny = 1.0f - py / height * 2.0f;
  float aspect = width / height;
  float h = 0.5f * view_height();
  if (ortho) {
    glm::vec3 o = target + right() * (nx * h * aspect) + up() * (ny * h) - forward() * distance * 50.0f;
    return {o, forward()};
  }
  float t = std::tan(0.5f * fov_y);
  glm::vec3 d = forward() + right() * (nx * t * aspect) + up() * (ny * t);
  return {eye(), glm::normalize(d)};
}

glm::vec3 Camera::project(const glm::vec3& p, float width, float height) const {
  glm::vec4 v = view() * glm::vec4(p, 1.0f);
  glm::vec4 c = proj(width / height) * v;
  float w = ortho ? 1.0f : c.w;
  if (!ortho && w <= 1e-8f) return {-1e9f, -1e9f, v.z};
  return {(c.x / w * 0.5f + 0.5f) * width, (0.5f - c.y / w * 0.5f) * height, v.z};
}

float Camera::pixel_size_at(const glm::vec3& p, float height) const {
  if (ortho) return view_height() / height;
  float depth = std::max(glm::dot(p - eye(), forward()), near_plane());
  return 2.0f * depth * std::tan(0.5f * fov_y) / height;
}

void Camera::orbit(float dx, float dy) {
  anim_len_ = 0;
  yaw -= dx * 0.008f;
  pitch = std::clamp(pitch + dy * 0.008f, -0.5f * kPi, 0.5f * kPi);
  if (auto_perspective && ortho_from_preset_) {
    ortho = false;
    ortho_from_preset_ = false;
  }
}

void Camera::pan(float dx, float dy, float viewport_height) {
  anim_len_ = 0;
  float s = view_height() / viewport_height;
  target += (-dx * right() + dy * up()) * s;
}

void Camera::dolly(float steps) {
  anim_len_ = 0;
  distance = std::clamp(distance * std::pow(1.15f, -steps), 1e-3f, 1e5f);
}

void Camera::animate_to(const glm::vec3& t, float d, float y, float p, float seconds) {
  from_target_ = target;
  from_dist_ = distance;
  from_pitch_ = pitch;
  // Take the short way around.
  float dy = std::remainder(y - yaw, 2.0f * kPi);
  from_yaw_ = yaw;
  to_yaw_ = yaw + dy;
  to_target_ = t;
  to_dist_ = d;
  to_pitch_ = p;
  anim_t_ = 0;
  anim_len_ = seconds;
  if (seconds <= 0) update(0);
}

void Camera::update(float dt) {
  if (anim_len_ <= 0 || anim_t_ >= anim_len_) {
    if (anim_len_ <= 0 && anim_t_ < 1) anim_t_ = 1;
    return;
  }
  anim_t_ = std::min(anim_t_ + dt, anim_len_);
  float s = anim_t_ / anim_len_;
  s = s * s * (3 - 2 * s);
  target = glm::mix(from_target_, to_target_, s);
  distance = from_dist_ + (to_dist_ - from_dist_) * s;
  yaw = from_yaw_ + (to_yaw_ - from_yaw_) * s;
  pitch = from_pitch_ + (to_pitch_ - from_pitch_) * s;
}

void Camera::set_view(ViewPreset preset) {
  float y = yaw, p = 0.0f;
  switch (preset) {
    case ViewPreset::Front: y = -0.5f * kPi; break;
    case ViewPreset::Back: y = 0.5f * kPi; break;
    case ViewPreset::Right: y = 0.0f; break;
    case ViewPreset::Left: y = kPi; break;
    case ViewPreset::Top: y = -0.5f * kPi; p = 0.5f * kPi; break;
    case ViewPreset::Bottom: y = -0.5f * kPi; p = -0.5f * kPi; break;
  }
  if (auto_perspective && !ortho) {
    ortho = true;
    ortho_from_preset_ = true;
  }
  animate_to(target, distance, y, p);
}

int Camera::aligned_axis() const {
  const float eps = 1e-3f;
  if (std::abs(std::abs(pitch) - 0.5f * kPi) < eps) return 2;
  if (std::abs(pitch) > eps) return -1;
  float y = std::abs(std::remainder(yaw, 2.0f * kPi));
  if (y < eps || std::abs(y - kPi) < eps) return 0;
  if (std::abs(y - 0.5f * kPi) < eps) return 1;
  return -1;
}

void Camera::frame_bounds(const glm::vec3& lo, const glm::vec3& hi, bool animate) {
  glm::vec3 c = 0.5f * (lo + hi);
  float r = std::max(0.5f * glm::length(hi - lo), 1e-3f);
  float d = r / std::sin(0.5f * fov_y) * 1.1f;
  if (animate)
    animate_to(c, d, yaw, pitch);
  else {
    target = c;
    distance = d;
  }
}

}  // namespace rillfacet
