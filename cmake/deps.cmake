# Third-party dependencies (small; each build tree fetches its own copy from
# GitHub, so a first configure needs network access; see README.md for the system
# packages: compiler, X11 headers for GLFW, ...). Python-side ones are in
# pyproject.toml.
include(FetchContent)
set(FETCHCONTENT_QUIET ON)

# Dawn (native WebGPU) is prebuilt by scripts/build_dawn.sh (it fetches its own
# dependencies: abseil, SPIRV-Tools, Vulkan headers, ...).
find_package(Dawn CONFIG REQUIRED HINTS ${RILLFACET_ROOT}/third_party/dawn)

set(GLFW_BUILD_WAYLAND OFF CACHE BOOL "" FORCE)
if(APPLE)
  set(GLFW_BUILD_X11 OFF CACHE BOOL "" FORCE)
else()
  set(GLFW_BUILD_X11 ON CACHE BOOL "" FORCE)
endif()
set(GLFW_BUILD_DOCS OFF CACHE BOOL "" FORCE)
set(GLFW_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(GLFW_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(GLFW_INSTALL OFF CACHE BOOL "" FORCE)
FetchContent_Declare(glfw GIT_REPOSITORY https://github.com/glfw/glfw GIT_TAG 3.4)

FetchContent_Declare(glm GIT_REPOSITORY https://github.com/g-truc/glm GIT_TAG 1.0.3)

FetchContent_Declare(imgui
  GIT_REPOSITORY https://github.com/ocornut/imgui GIT_TAG v1.92.9b-docking)
FetchContent_Declare(implot
  GIT_REPOSITORY https://github.com/epezent/implot
  GIT_TAG 7eeb9168d2e5e6b14e266d8782ecf7e649dfc3a4)
FetchContent_Declare(stb
  GIT_REPOSITORY https://github.com/nothings/stb
  GIT_TAG 2c980bb59875b0d32144a71867fbdebb2f77cd20)

FetchContent_MakeAvailable(glfw glm)
set_target_properties(glfw PROPERTIES POSITION_INDEPENDENT_CODE ON)  # linked into the Python module
# WebGPU only: keep glfw3.h (also included by ImGui's GLFW backend) from pulling in
# GL/gl.h, so no OpenGL development package is needed (INTERFACE: GLFW itself
# refuses to be compiled with it).
target_compile_definitions(glfw INTERFACE GLFW_INCLUDE_NONE)
FetchContent_Populate(imgui)   # no CMakeLists upstream: built below
FetchContent_Populate(implot)
FetchContent_Populate(stb)

add_library(rillfacet_imgui STATIC
  ${imgui_SOURCE_DIR}/imgui.cpp
  ${imgui_SOURCE_DIR}/imgui_draw.cpp
  ${imgui_SOURCE_DIR}/imgui_tables.cpp
  ${imgui_SOURCE_DIR}/imgui_widgets.cpp
  ${imgui_SOURCE_DIR}/imgui_demo.cpp
  ${imgui_SOURCE_DIR}/backends/imgui_impl_glfw.cpp
  ${imgui_SOURCE_DIR}/backends/imgui_impl_wgpu.cpp
  ${implot_SOURCE_DIR}/implot.cpp
  ${implot_SOURCE_DIR}/implot_items.cpp)
target_include_directories(rillfacet_imgui PUBLIC
  ${imgui_SOURCE_DIR} ${imgui_SOURCE_DIR}/backends ${implot_SOURCE_DIR})
target_compile_definitions(rillfacet_imgui PUBLIC IMGUI_IMPL_WEBGPU_BACKEND_DAWN)
target_link_libraries(rillfacet_imgui PUBLIC glfw dawn::webgpu_dawn)
set_target_properties(rillfacet_imgui PROPERTIES POSITION_INDEPENDENT_CODE ON)

add_library(rillfacet_stb INTERFACE)
target_include_directories(rillfacet_stb SYSTEM INTERFACE ${stb_SOURCE_DIR})
if(APPLE)  # the WebGPU backend creates a CAMetalLayer there, in Objective-C++
  set_source_files_properties(${imgui_SOURCE_DIR}/backends/imgui_impl_wgpu.cpp PROPERTIES LANGUAGE OBJCXX)
  target_link_libraries(rillfacet_imgui PUBLIC "-framework Cocoa" "-framework QuartzCore" "-framework Metal")
endif()
