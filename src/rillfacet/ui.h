#pragma once
// Built-in ImGui panels and viewport decorations.

#include "rillfacet/camera.h"
#include "rillfacet/renderer.h"
#include "rillfacet/scene.h"
#include "rillfacet/selection.h"

#include <string>
#include <vector>

struct ImFont;

namespace rillfacet::ui {

void apply_theme(Theme theme);

// "Display": shading mode and style, lighting toggles, per-structure
// appearance and a body list with visibility checkboxes.
void display_panel(Scene& scene, RenderSettings& settings, Selection& selection);

// "Inspect": pick mode, selected element properties, measurements.
void inspector_panel(Scene& scene, Selection& selection, std::vector<Measurement>& measurements,
                     MeasureTool& tool, bool& xray, ImFont* mono);

// Blender-like axis gizmo in the top-right corner (click an axis to align the
// view), with projection and shading toggles under it.
void nav_gizmo(Camera& camera, RenderSettings& settings, const glm::vec2& viewport);

// View name, grid spacing, frame rate (top-left) and a length scale bar (bottom-left).
void hud(const Camera& camera, const RenderSettings& settings, const glm::vec2& viewport, float dt,
         const std::string& status, MeasureTool tool);

// Legend for the first mesh colored by a quantity.
void colorbar(const Scene& scene, const glm::vec2& viewport);

void shader_error_toast(const std::string& error, const glm::vec2& viewport);

// 1-2-5 sequence step >= x, and a length formatted with sensible units.
double nice_step(double x);
std::string format_length(double value, double step);

}  // namespace rillfacet::ui
