cmake_minimum_required(VERSION 3.24)
project(avbd_viz LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_SCAN_FOR_MODULES OFF)
if(NOT CMAKE_BUILD_TYPE AND CMAKE_SOURCE_DIR STREQUAL PROJECT_SOURCE_DIR)
  set(CMAKE_BUILD_TYPE Release)
endif()

set(AVBD_VIZ_ROOT ${CMAKE_CURRENT_SOURCE_DIR})
include(cmake/deps.cmake)

add_library(avbd_viz STATIC
  src/avbd_viz/gpu.cpp
  src/avbd_viz/shader_library.cpp
  src/avbd_viz/camera.cpp
  src/avbd_viz/scene.cpp
  src/avbd_viz/environment.cpp
  src/avbd_viz/text.cpp
  src/avbd_viz/renderer.cpp
  src/avbd_viz/selection.cpp
  src/avbd_viz/ui.cpp
  src/avbd_viz/viewer.cpp
  src/avbd_viz/stb_impl.cpp)
target_include_directories(avbd_viz PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/src)
target_compile_features(avbd_viz PUBLIC cxx_std_20)  # webgpu_cpp.h needs C++20
if(NOT CMAKE_BUILD_TYPE)  # e.g. added to a parent project without a build type
  target_compile_options(avbd_viz PRIVATE -O2)
  target_compile_options(avbd_viz_imgui PRIVATE -O2)
endif()
target_link_libraries(avbd_viz PUBLIC avbd_viz_imgui glm::glm dawn::webgpu_dawn
                      PRIVATE avbd_viz_stb)
# Shaders and fonts are read at runtime from the source tree so WGSL edits
# hot-reload without rebuilding.
target_compile_definitions(avbd_viz PUBLIC
  AVBD_VIZ_SHADER_DIR="${CMAKE_CURRENT_SOURCE_DIR}/shaders"
  AVBD_VIZ_ASSET_DIR="${CMAKE_CURRENT_SOURCE_DIR}/assets"
  GLM_ENABLE_EXPERIMENTAL GLM_FORCE_DEPTH_ZERO_TO_ONE)
target_compile_options(avbd_viz PRIVATE -Wall -Wextra -Wno-missing-field-initializers)
set_target_properties(avbd_viz PROPERTIES POSITION_INDEPENDENT_CODE ON)

option(AVBD_VIZ_BUILD_EXAMPLES "Build avbd-viz standalone examples" ${PROJECT_IS_TOP_LEVEL})
if(AVBD_VIZ_BUILD_EXAMPLES)
  add_executable(showcase examples/showcase.cpp)
  target_link_libraries(showcase PRIVATE avbd_viz)
endif()

# Python module `avbd_viz` (built into python/avbd_viz/; `pip install -e .`
# makes it importable).
option(AVBD_VIZ_BUILD_PYTHON "Build the avbd_viz Python module" OFF)
if(AVBD_VIZ_BUILD_PYTHON)
  find_package(Python3 REQUIRED COMPONENTS Interpreter Development.Module)
  execute_process(COMMAND ${Python3_EXECUTABLE} -m pybind11 --cmakedir
                  OUTPUT_VARIABLE pybind11_DIR OUTPUT_STRIP_TRAILING_WHITESPACE)
  find_package(pybind11 CONFIG REQUIRED)
  pybind11_add_module(_avbd_viz src/python/module.cpp)
  target_link_libraries(_avbd_viz PRIVATE avbd_viz)
  set_target_properties(_avbd_viz PROPERTIES
    LIBRARY_OUTPUT_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}/python/avbd_viz)
endif()
