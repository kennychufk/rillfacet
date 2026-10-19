#include "rillfacet/metal_layer.h"

#include <GLFW/glfw3.h>
#define GLFW_EXPOSE_NATIVE_COCOA
#include <GLFW/glfw3native.h>

#import <Cocoa/Cocoa.h>
#import <QuartzCore/CAMetalLayer.h>

namespace rillfacet {

void* create_metal_layer(GLFWwindow* window) {
  NSWindow* ns_window = glfwGetCocoaWindow(window);
  NSView* view = [ns_window contentView];
  [view setWantsLayer:YES];
  CAMetalLayer* layer = [CAMetalLayer layer];
  [layer setContentsScale:[ns_window backingScaleFactor]];
  [view setLayer:layer];
  return (__bridge void*)layer;
}

}  // namespace rillfacet
