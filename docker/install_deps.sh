#!/bin/sh
# Install the prerequisites listed in README.md on a bare image, for the
# clean-room check (docker/Dockerfile). Not needed on a developer machine.
#   install_deps.sh build [gcc|clang]   toolchain, X11 headers, Python
#   install_deps.sh run                 a Vulkan driver (Mesa software rasteriser), Python
set -eu
stage=$1
compiler=${2:-gcc}
. /etc/os-release

if command -v apt-get >/dev/null; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  case $stage in
    build)
      apt-get install -y --no-install-recommends \
        build-essential cmake ninja-build git ca-certificates pkg-config \
        python3 python3-dev python3-venv \
        libx11-dev libx11-xcb-dev libxcb1-dev \
        libxrandr-dev libxinerama-dev libxcursor-dev libxi-dev
      [ "$compiler" = clang ] && apt-get install -y --no-install-recommends clang
      ;;
    run) apt-get install -y --no-install-recommends libvulkan1 mesa-vulkan-drivers python3 python3-venv ;;
  esac
  rm -rf /var/lib/apt/lists/*
elif command -v dnf >/dev/null; then
  case $stage in
    build)
      dnf install -y --setopt=install_weak_deps=False \
        gcc-c++ make cmake ninja-build git ca-certificates pkgconf-pkg-config \
        python3 python3-devel \
        libX11-devel libxcb-devel libXrandr-devel libXinerama-devel \
        libXcursor-devel libXi-devel
      [ "$compiler" = clang ] && dnf install -y --setopt=install_weak_deps=False clang
      ;;
    run) dnf install -y --setopt=install_weak_deps=False vulkan-loader mesa-vulkan-drivers python3 ;;
  esac
  dnf clean all
else
  echo "install_deps.sh: no apt-get or dnf" >&2; exit 1
fi

# Make CMake (which looks for `cc` / `c++`) and Dawn's script pick clang.
if [ "$stage" = build ] && [ "$compiler" = clang ]; then
  ln -sf "$(command -v clang)" /usr/local/bin/cc
  ln -sf "$(command -v clang++)" /usr/local/bin/c++
fi
echo "== $PRETTY_NAME, $(cc --version | head -1) / $(c++ --version | head -1)"
