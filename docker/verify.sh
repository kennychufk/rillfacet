#!/usr/bin/env bash
# Build rillfacet from scratch inside Docker, once per base image, then the web
# client. The build context is the tracked + not-ignored files only, so nothing
# that merely happens to sit in this working tree (third_party/, build/, a
# stale .so) can leak in.
#   docker/verify.sh [BASE_IMAGE[+clang]...]   # default: the list below
#   e.g. docker/verify.sh fedora:latest+clang   (+clang: Clang instead of GCC)
#   DOCKER="sudo docker" docker/verify.sh   # if your user is not in the docker group
set -euo pipefail
cd "$(dirname "$0")/.."
DOCKER=${DOCKER:-docker}
bases=("$@")
[ ${#bases[@]} -gt 0 ] || bases=(ubuntu:24.04 debian:13 fedora:latest ubuntu:24.04+clang fedora:latest+clang)

ctx=$(mktemp)
trap 'rm -f "$ctx"' EXIT
git ls-files -z --cached --others --exclude-standard | tar --null -T - -cf "$ctx"

for spec in "${bases[@]}"; do
  base=${spec%+clang}
  compiler=gcc; [ "$base" = "$spec" ] || compiler=clang
  echo "=== $spec"
  $DOCKER build --progress=plain --build-arg BASE="$base" --build-arg COMPILER=$compiler \
    --target test -f docker/Dockerfile -t "rillfacet-verify:${spec//[:\/+]/-}" - < "$ctx"
done
echo "=== web client"
$DOCKER build --progress=plain --target web -f docker/Dockerfile -t rillfacet-verify:web - < "$ctx"
echo "ALL OK"
