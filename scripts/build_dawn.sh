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

if [ "$(uname)" = Darwin ]; then  # Metal backend, no X11/Vulkan
  BACKEND_FLAGS="-DDAWN_ENABLE_METAL=ON -DDAWN_ENABLE_VULKAN=OFF -DDAWN_USE_X11=OFF"
  TINT_MSL=-DTINT_BUILD_MSL_WRITER=ON
  JOBS=$(sysctl -n hw.ncpu)
else
  BACKEND_FLAGS="-DDAWN_ENABLE_METAL=OFF -DDAWN_ENABLE_VULKAN=ON -DDAWN_USE_X11=ON"
  TINT_MSL=-DTINT_BUILD_MSL_WRITER=OFF
  JOBS=$(nproc)
fi

# Dawn's dependency fetch (DAWN_FETCH_DEPENDENCIES, run by the configure step)
# sometimes leaves a dependency half-downloaded (a missing CMakeLists.txt, an
# empty python package) without failing; the next configure then dies. Retry
# from a fresh checkout instead of trusting a partial tree. (`|| return 1`, not
# set -e: errexit is off inside a function called from `if`.)
configure_dawn() {
  if [ ! -d "$SRC/.git" ]; then
    git clone https://dawn.googlesource.com/dawn "$SRC" || return 1
  fi
  git -C "$SRC" fetch -q origin "$DAWN_COMMIT" || true
  git -C "$SRC" checkout -q "$DAWN_COMMIT" || return 1

  if [ "$(uname)" = Darwin ]; then
    # Apple clang 15 / an older SDK need a few small source workarounds.
    D=$SRC/src
    f=$D/tint/lang/core/ir/transform/multiplanar_external_texture.cc  # no aggregate CTAD
    grep -q 'overloaded(Ts...)' "$f" || sed -i '' 's|^using MultiplanarTexture =|template <class... Ts>\
overloaded(Ts...) -> overloaded<Ts...>;\
\
&|' "$f"
    # Lambdas capturing structured bindings (C++20, not in Apple clang 15).
    f=$D/dawn/native/SharedResourceMemory.cpp
    grep -q fenceObj "$f" || sed -i '' 's|^        auto it = std::find_if($|        auto* fenceObj = fence;\
&|; s|pendingFence.object.Get() == fence;|pendingFence.object.Get() == fenceObj;|' "$f"
    f=$D/dawn/wire/client/Buffer.cpp
    grep -q futureIDCopy "$f" || sed -i '' 's|^    bool success = mState.Use(\[&\](auto state) {$|    auto futureIDCopy = futureIDInternal;\
&|; s|pendingMapRequest = {futureIDInternal,|pendingMapRequest = {futureIDCopy,|' "$f"
    # A pixel format constant missing from older SDKs.
    sed -i '' '/kCVPixelFormatType_Lossless_420YpCbCr10PackedBiPlanarFullRange:/d' \
      "$D/dawn/native/metal/SharedTextureMemoryMTL.mm"
  fi

  cmake -S "$SRC" -B "$BUILD" -G Ninja \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_INSTALL_PREFIX="$PREFIX" \
    -DDAWN_FETCH_DEPENDENCIES=ON \
    -DDAWN_SUPPORTS_CXX_MODULES=OFF \
    -DDAWN_ENABLE_INSTALL=ON \
    -DDAWN_BUILD_MONOLITHIC_LIBRARY=SHARED \
    -DDAWN_BUILD_SAMPLES=OFF -DDAWN_BUILD_TESTS=OFF -DDAWN_BUILD_BENCHMARKS=OFF \
    -DDAWN_ENABLE_D3D11=OFF -DDAWN_ENABLE_D3D12=OFF \
    -DDAWN_ENABLE_NULL=OFF -DDAWN_ENABLE_DESKTOP_GL=OFF -DDAWN_ENABLE_OPENGLES=OFF \
    $BACKEND_FLAGS -DDAWN_USE_WAYLAND=OFF -DDAWN_USE_GLFW=OFF \
    -DTINT_BUILD_TESTS=OFF -DTINT_BUILD_CMD_TOOLS=ON \
    -DTINT_BUILD_GLSL_WRITER=OFF -DTINT_BUILD_HLSL_WRITER=OFF $TINT_MSL \
    -DTINT_BUILD_GLSL_VALIDATOR=OFF -DTINT_BUILD_SPV_READER=OFF || return 1
}
for attempt in 1 2 3; do
  if configure_dawn; then break; fi
  [ "$attempt" -lt 3 ] || { echo "build_dawn.sh: configure failed 3 times" >&2; exit 1; }
  echo "build_dawn.sh: configure failed (attempt $attempt), retrying from a fresh checkout" >&2
  rm -rf "$SRC" "$BUILD"
done
cmake --build "$BUILD" -j"$JOBS"
cmake --install "$BUILD"
# tint CLI is handy for offline WGSL validation (scripts/check_shaders.sh).
mkdir -p "$PREFIX/bin" && cp -f "$BUILD/tint" "$PREFIX/bin/"
echo "Dawn installed to $PREFIX"
