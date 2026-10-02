# Clean-room check that rillfacet builds from a bare Linux image using only the
# prerequisites README.md lists (C++ part: Dawn, the library, showcase; Python
# part: venv, extension module, tests; web client: npm build).
#   DOCKER="sudo docker" docker/verify.sh [BASE_IMAGE[+clang]...]
ARG BASE=ubuntu:24.04
ARG COMPILER=gcc

FROM ${BASE} AS toolchain
ARG COMPILER
COPY docker/install_deps.sh /usr/local/bin/install_deps.sh
RUN install_deps.sh build ${COMPILER}

# Dawn: ~10 min, only depends on the script, so it stays cached.
FROM toolchain AS dawn
WORKDIR /src
COPY scripts/build_dawn.sh scripts/build_dawn.sh
RUN scripts/build_dawn.sh

FROM dawn AS build
COPY . .
RUN python3 -m venv /venv && /venv/bin/pip install --no-cache-dir -e ".[build,test]"
ENV PATH=/venv/bin:$PATH
RUN cmake -S . -B build -G Ninja -DRILLFACET_BUILD_PYTHON=ON \
          -DPython3_EXECUTABLE=/venv/bin/python \
    && cmake --build build

# Running needs a Vulkan driver; Mesa's software one (lavapipe) stands in for a GPU.
FROM build AS test
RUN install_deps.sh run
RUN ./build/showcase --headless --style 2 --out /tmp/shot.png && test -s /tmp/shot.png
RUN python -m pytest tests -q

# Only needed to change web/: rebuilds the committed client from the lockfile.
FROM node:22-slim AS web
WORKDIR /src
COPY . .
RUN cd web && npm ci && npm run build
