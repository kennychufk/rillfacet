cmake_minimum_required(VERSION 3.24)
project(rillfacet LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_SCAN_FOR_MODULES OFF)
if(NOT CMAKE_BUILD_TYPE AND CMAKE_SOURCE_DIR STREQUAL PROJECT_SOURCE_DIR)
  set(CMAKE_BUILD_TYPE Release)
endif()

set(RILLFACET_ROOT ${CMAKE_CURRENT_SOURCE_DIR})
include(cmake/deps.cmake)

add_library(rillfacet STATIC
  src/rillfacet/gpu.cpp
  src/rillfacet/shader_library.cpp
  src/rillfacet/camera.cpp
  src/rillfacet/scene.cpp
  src/rillfacet/environment.cpp
  src/rillfacet/text.cpp
  src/rillfacet/renderer.cpp
  src/rillfacet/selection.cpp
  src/rillfacet/ui.cpp
  src/rillfacet/viewer.cpp
  src/rillfacet/stb_impl.cpp)
target_include_directories(rillfacet PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/src)
target_compile_features(rillfacet PUBLIC cxx_std_20)  # webgpu_cpp.h needs C++20
if(NOT CMAKE_BUILD_TYPE)  # e.g. added to a parent project without a build type
  target_compile_options(rillfacet PRIVATE -O2)
  target_compile_options(rillfacet_imgui PRIVATE -O2)
endif()
target_link_libraries(rillfacet PUBLIC rillfacet_imgui glm::glm dawn::webgpu_dawn
                      PRIVATE rillfacet_stb)
# Shaders and fonts are read at runtime from the source tree so WGSL edits
# hot-reload without rebuilding.
target_compile_definitions(rillfacet PUBLIC
  RILLFACET_SHADER_DIR="${CMAKE_CURRENT_SOURCE_DIR}/shaders"
  RILLFACET_ASSET_DIR="${CMAKE_CURRENT_SOURCE_DIR}/assets"
  GLM_ENABLE_EXPERIMENTAL GLM_FORCE_DEPTH_ZERO_TO_ONE)
target_compile_options(rillfacet PRIVATE -Wall -Wextra -Wno-missing-field-initializers)
set_target_properties(rillfacet PROPERTIES POSITION_INDEPENDENT_CODE ON)

option(RILLFACET_BUILD_EXAMPLES "Build rillfacet standalone examples" ${PROJECT_IS_TOP_LEVEL})
if(RILLFACET_BUILD_EXAMPLES)
  add_executable(showcase examples/showcase.cpp)
  target_link_libraries(showcase PRIVATE rillfacet)
endif()

# Python module `rillfacet` (built into python/rillfacet/; `pip install -e .`
# makes it importable).
option(RILLFACET_BUILD_PYTHON "Build the rillfacet Python module" OFF)
if(RILLFACET_BUILD_PYTHON)
  find_package(Python3 REQUIRED COMPONENTS Interpreter Development.Module)
  execute_process(COMMAND ${Python3_EXECUTABLE} -m pybind11 --cmakedir
                  OUTPUT_VARIABLE pybind11_DIR OUTPUT_STRIP_TRAILING_WHITESPACE)
  find_package(pybind11 CONFIG REQUIRED)
  pybind11_add_module(_rillfacet src/python/module.cpp)
  target_link_libraries(_rillfacet PRIVATE rillfacet)
  set_target_properties(_rillfacet PROPERTIES
    LIBRARY_OUTPUT_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}/python/rillfacet)
endif()
