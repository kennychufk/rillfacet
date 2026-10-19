#pragma once
// macOS: attaches a CAMetalLayer to a GLFW window's content view for Dawn's surface.

struct GLFWwindow;

namespace rillfacet {

void* create_metal_layer(GLFWwindow* window);

}  // namespace rillfacet
