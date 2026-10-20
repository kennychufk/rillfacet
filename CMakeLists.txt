cmake_minimum_required(VERSION 3.24)
project(rillfacet LANGUAGES C CXX)
if(APPLE)
  enable_language(OBJC OBJCXX)
endif()

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
  src/rillfacet/resources.cpp
  src/rillfacet/shader_library.cpp
  src/rillfacet/camera.cpp
  src/rillfacet/scene.cpp
  src/rillfacet/environment.cpp
  src/rillfacet/text.cpp
  src/rillfacet/renderer.cpp
  src/rillfacet/selection.cpp
  src/rillfacet/ui.cpp
  src/rillfacet/viewer.cpp
  src/rillfacet/camera_raster.cpp
  src/rillfacet/cuda_share.cpp
  src/rillfacet/stb_impl.cpp)
if(APPLE)
  target_sources(rillfacet PRIVATE src/rillfacet/metal_layer.mm)
  target_link_libraries(rillfacet PUBLIC "-framework Cocoa" "-framework QuartzCore" "-framework Metal")
endif()
target_include_directories(rillfacet PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/src)
target_compile_features(rillfacet PUBLIC cxx_std_20)  # webgpu_cpp.h needs C++20
if(NOT CMAKE_BUILD_TYPE AND NOT MSVC)  # e.g. added to a parent project without a build type
  target_compile_options(rillfacet PRIVATE -O2)
  target_compile_options(rillfacet_imgui PRIVATE -O2)
endif()
target_link_libraries(rillfacet PUBLIC rillfacet_imgui glm::glm dawn::webgpu_dawn ${CMAKE_DL_LIBS}
                      PRIVATE rillfacet_stb)
# Shaders and fonts are read at runtime: from <module dir>/{shaders,assets} when
# installed (a wheel), else from the source tree so WGSL edits hot-reload
# without rebuilding (src/rillfacet/resources.cpp).
target_compile_definitions(rillfacet PUBLIC
  RILLFACET_SHADER_DIR="${CMAKE_CURRENT_SOURCE_DIR}/shaders"
  RILLFACET_ASSET_DIR="${CMAKE_CURRENT_SOURCE_DIR}/assets"
  GLM_ENABLE_EXPERIMENTAL GLM_FORCE_DEPTH_ZERO_TO_ONE)
if(MSVC)
  target_compile_options(rillfacet PRIVATE /utf-8 /bigobj /W3)
  target_compile_definitions(rillfacet PUBLIC NOMINMAX WIN32_LEAN_AND_MEAN _USE_MATH_DEFINES)
else()
  target_compile_options(rillfacet PRIVATE -Wall -Wextra -Wno-missing-field-initializers)
endif()
# Zero-copy camera images (cuda_share.cpp): Vulkan and the CUDA driver are
# loaded at runtime, so only their headers are needed here. Vulkan's come
# with Dawn's source checkout (scripts/build_dawn.sh); without CUDA's
# (cuda.h, a CUDA toolkit) the camera rasterizer reads images back instead.
find_package(CUDAToolkit QUIET)
if(CUDAToolkit_FOUND AND CMAKE_SYSTEM_NAME STREQUAL "Linux")  # the Vulkan/CUDA fd hand-over is Linux-only
  set(RILLFACET_VULKAN_INCLUDE ${RILLFACET_ROOT}/third_party/dawn-src/third_party/vulkan-headers/src/include)
  if(NOT EXISTS ${RILLFACET_VULKAN_INCLUDE}/vulkan/vulkan.h)
    FetchContent_Declare(vulkan_headers
      GIT_REPOSITORY https://github.com/KhronosGroup/Vulkan-Headers GIT_TAG v1.4.309)
    FetchContent_Populate(vulkan_headers)
    set(RILLFACET_VULKAN_INCLUDE ${vulkan_headers_SOURCE_DIR}/include)
  endif()
  target_include_directories(rillfacet SYSTEM PRIVATE ${RILLFACET_VULKAN_INCLUDE} ${CUDAToolkit_INCLUDE_DIRS})
  target_compile_definitions(rillfacet PRIVATE RILLFACET_HAVE_CUDA_H=1)
  message(STATUS "rillfacet: zero-copy camera images with CUDA ${CUDAToolkit_VERSION}")
else()
  message(STATUS "rillfacet: no CUDA toolkit, camera images are read back (no zero-copy)")
endif()
set_target_properties(rillfacet PROPERTIES POSITION_INDEPENDENT_CODE ON)

option(RILLFACET_BUILD_EXAMPLES "Build rillfacet standalone examples" ${PROJECT_IS_TOP_LEVEL})
if(RILLFACET_BUILD_EXAMPLES)
  add_executable(showcase examples/showcase.cpp)
  target_link_libraries(showcase PRIVATE rillfacet)
endif()

# Python module `rillfacet`. A plain build puts it into python/rillfacet/ (then
# `pip install -e .` or PYTHONPATH=python makes it importable); under
# scikit-build-core (pip install / pip wheel) it is installed into the package
# together with Dawn, the shaders and the fonts.
option(RILLFACET_BUILD_PYTHON "Build the rillfacet Python module" OFF)
if(SKBUILD)
  set(RILLFACET_BUILD_PYTHON ON)
endif()
if(RILLFACET_BUILD_PYTHON)
  find_package(Python 3.10 REQUIRED COMPONENTS Interpreter Development.Module Development.SABIModule)
  execute_process(COMMAND ${Python_EXECUTABLE} -m nanobind --cmake_dir
                  OUTPUT_VARIABLE nanobind_ROOT OUTPUT_STRIP_TRAILING_WHITESPACE)
  find_package(nanobind CONFIG REQUIRED)
  # STABLE_ABI: one abi3 module for every Python >= 3.12 (older ones get a version-specific one).
  nanobind_add_module(_rillfacet STABLE_ABI src/python/module.cpp src/python/camera_raster_bindings.cpp)
  target_link_libraries(_rillfacet PRIVATE rillfacet)
  if(SKBUILD)
    set_target_properties(_rillfacet PROPERTIES INSTALL_RPATH "$<IF:$<PLATFORM_ID:Darwin>,@loader_path,$ORIGIN>")
    install(TARGETS _rillfacet LIBRARY DESTINATION rillfacet RUNTIME DESTINATION rillfacet)
    install(IMPORTED_RUNTIME_ARTIFACTS dawn::webgpu_dawn LIBRARY DESTINATION rillfacet
            RUNTIME DESTINATION rillfacet)
    if(WIN32)
      # Dawn's D3D12 backend loads d3dcompiler_47.dll with LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR, which
      # fails (error 87) for a bare name: it has to sit next to webgpu_dawn.dll. Ship the Windows
      # SDK's redistributable copy (newer than the one bundled with older Windows versions).
      file(TO_CMAKE_PATH "$ENV{WindowsSdkDir}" _sdk_dir)  # trailing backslash would escape the list ';'
      set(_sdk_dirs "${_sdk_dir}" "$ENV{ProgramFiles} (x86)/Windows Kits/10")
      find_file(RILLFACET_D3DCOMPILER d3dcompiler_47.dll
                HINTS ${_sdk_dirs} PATH_SUFFIXES Redist/D3D/x64 NO_DEFAULT_PATH)
      if(NOT RILLFACET_D3DCOMPILER)
        message(FATAL_ERROR "d3dcompiler_47.dll (Windows SDK Redist/D3D/x64) not found; "
                            "set RILLFACET_D3DCOMPILER to its path")
      endif()
      install(FILES ${RILLFACET_D3DCOMPILER} DESTINATION rillfacet)
    endif()
    install(DIRECTORY shaders/ DESTINATION rillfacet/shaders)
    install(DIRECTORY assets/ DESTINATION rillfacet/assets)
  else()
    set_target_properties(_rillfacet PROPERTIES
      LIBRARY_OUTPUT_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}/python/rillfacet)
  endif()
endif()
