#!/usr/bin/env bash
# Build Dawn (native WebGPU) once into third_party/dawn (gitignored).
# Vulkan backend only; X11 surfaces; installs a CMake package (find_package(Dawn)).
# Needs the X11 dev headers, including libx11-xcb-dev.
set -euo pipefail
DAWN_COMMIT=${DAWN_COMMIT:-42a517fc1fc721921659f02533d1aace7e969d4b}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SRC=$ROOT/third_party/dawn-src
BUILD=$ROOT/third_party/dawn-build
PREFIX=$ROOT/third_party/dawn

if [ ! -d "$SRC/.git" ]; then
  git clone https://dawn.googlesource.com/dawn "$SRC"
fi
git -C "$SRC" fetch -q origin "$DAWN_COMMIT" || true
git -C "$SRC" checkout -q "$DAWN_COMMIT"

cmake -S "$SRC" -B "$BUILD" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_PREFIX="$PREFIX" \
  -DDAWN_FETCH_DEPENDENCIES=ON \
  -DDAWN_SUPPORTS_CXX_MODULES=OFF \
  -DDAWN_ENABLE_INSTALL=ON \
  -DDAWN_BUILD_MONOLITHIC_LIBRARY=SHARED \
  -DDAWN_BUILD_SAMPLES=OFF -DDAWN_BUILD_TESTS=OFF -DDAWN_BUILD_BENCHMARKS=OFF \
  -DDAWN_ENABLE_D3D11=OFF -DDAWN_ENABLE_D3D12=OFF -DDAWN_ENABLE_METAL=OFF \
  -DDAWN_ENABLE_NULL=OFF -DDAWN_ENABLE_DESKTOP_GL=OFF -DDAWN_ENABLE_OPENGLES=OFF \
  -DDAWN_ENABLE_VULKAN=ON -DDAWN_USE_X11=ON -DDAWN_USE_WAYLAND=OFF -DDAWN_USE_GLFW=OFF \
  -DTINT_BUILD_TESTS=OFF -DTINT_BUILD_CMD_TOOLS=ON \
  -DTINT_BUILD_GLSL_WRITER=OFF -DTINT_BUILD_HLSL_WRITER=OFF -DTINT_BUILD_MSL_WRITER=OFF \
  -DTINT_BUILD_GLSL_VALIDATOR=OFF -DTINT_BUILD_SPV_READER=OFF
cmake --build "$BUILD" -j"$(nproc)"
cmake --install "$BUILD"
# tint CLI is handy for offline WGSL validation (scripts/check_shaders.sh).
mkdir -p "$PREFIX/bin" && cp -f "$BUILD/tint" "$PREFIX/bin/"
echo "Dawn installed to $PREFIX"
