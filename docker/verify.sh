#!/usr/bin/env bash
# Build rillfacet from scratch inside Docker, once per base image, then the web
# client. The build context is the tracked + not-ignored files only, so nothing
# that merely happens to sit in this working tree (third_party/, build/, a
# stale .so) can leak in.
#   docker/verify.sh [BASE_IMAGE[+clang]...]   # default: the list below
#   e.g. docker/verify.sh fedora:latest+clang   (+clang: Clang instead of GCC)
#   docker/verify.sh --wheel [BASE_IMAGE...]   # instead: build the wheel, install it in a clean image, run the tests
#   docker/verify.sh --manylinux [BASE_IMAGE...]   # same with the auditwheel-repaired manylinux_2_28 wheels
#                                                  # (cp310, cp311 and one abi3 wheel for CPython 3.12+); default bases ubuntu:24.04 debian:13 fedora:latest
#   DOCKER="sudo docker" docker/verify.sh   # if your user is not in the docker group
set -euo pipefail
cd "$(dirname "$0")/.."
DOCKER=${DOCKER:-docker}
wheel=0; wheels=wheel
case "${1:-}" in --wheel) wheel=1; shift;; --manylinux) wheel=1; wheels=manylinux-wheel; shift;; esac
bases=("$@")
[ ${#bases[@]} -gt 0 ] || { [ $wheel = 1 ] && { [ $wheels = wheel ] && bases=(ubuntu:24.04) || bases=(ubuntu:24.04 debian:13 fedora:latest); } || bases=(ubuntu:24.04 debian:13 fedora:latest ubuntu:24.04+clang fedora:latest+clang); }

ctx=$(mktemp)
trap 'rm -f "$ctx"' EXIT
git ls-files -z --cached --others --exclude-standard | tar --null -T - -cf "$ctx"

for spec in "${bases[@]}"; do
  base=${spec%+clang}
  compiler=gcc; [ "$base" = "$spec" ] || compiler=clang
  echo "=== $spec"
  target=test; [ $wheel = 1 ] && target=wheel-test
  $DOCKER build --progress=plain --build-arg BASE="$base" --build-arg COMPILER=$compiler --build-arg WHEELS=$wheels \
    --target $target -f docker/Dockerfile -t "rillfacet-verify:${spec//[:\/+]/-}" - < "$ctx"
done
[ $wheel = 1 ] && { echo "ALL OK"; exit 0; }
echo "=== web client"
$DOCKER build --progress=plain --target web -f docker/Dockerfile -t rillfacet-verify:web - < "$ctx"
echo "ALL OK"
