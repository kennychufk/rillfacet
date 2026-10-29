# Clean-room check that rillfacet builds from a bare Linux image using only the
# prerequisites README.md lists (C++ part: Dawn, the library, showcase; Python
# part: venv, extension module, tests; web client: npm build).
#   DOCKER="sudo docker" docker/verify.sh [BASE_IMAGE[+clang]...]
ARG BASE=ubuntu:24.04
ARG COMPILER=gcc
# Which stage's /dist the wheel-test stage installs: wheel (native) or manylinux-wheel.
ARG WHEELS=wheel
ARG MANYLINUX=quay.io/pypa/manylinux_2_28_x86_64

# The web client (web/, not committed), built once from the lockfile into
# /src/python/rillfacet/web/static; every wheel ships this copy
# (RILLFACET_WEB_DIST), so the wheel images need no Node.
FROM node:22-slim AS web
WORKDIR /src
COPY web/package.json web/package-lock.json web/
RUN cd web && npm ci --no-audit --no-fund
COPY web web
COPY shaders shaders
RUN cd web && npm run build

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
          -DPython_EXECUTABLE=/venv/bin/python \
    && cmake --build build

# Running needs a Vulkan driver; Mesa's software one (lavapipe) stands in for a GPU.
FROM build AS test
RUN install_deps.sh run
RUN ./build/showcase --headless --style 2 --out /tmp/shot.png && test -s /tmp/shot.png
RUN python -m pytest tests -q

# The installable wheel (scikit-build-core: extension + Dawn + shaders + fonts),
# then tested in a clean image that has only the runtime prerequisites: no
# compiler, no source tree, so a missing resource or library shows up here.
FROM dawn AS wheel
COPY . .
COPY --from=web /src/python/rillfacet/web/static /web
RUN python3 -m venv /venv && /venv/bin/pip wheel --no-deps -w /dist \
      -C cmake.define.RILLFACET_WEB_DIST=/web .

# Distributable wheels: built in the manylinux_2_28 image (glibc 2.28, GCC 14),
# Dawn once (it is Python-independent), the module once per CPython, then
# auditwheel checks the policy and bundles what is needed.
FROM ${MANYLINUX} AS manylinux-toolchain
RUN yum install -y libXrandr-devel libXinerama-devel libXcursor-devel libXi-devel \
    libX11-devel libxcb-devel && yum clean all
# Dawn's dependency fetcher needs a modern python3; CMake 3 (Dawn's deps predate CMake 4).
ENV PATH=/opt/python/cp312-cp312/bin:$PATH
RUN pip install --no-cache-dir ninja "cmake>=3.24,<4" auditwheel

FROM manylinux-toolchain AS manylinux-dawn
WORKDIR /src
COPY scripts/build_dawn.sh scripts/build_dawn.sh
RUN scripts/build_dawn.sh

FROM manylinux-dawn AS manylinux-wheel
COPY . .
COPY --from=web /src/python/rillfacet/web/static /web
RUN set -e; for v in cp310-cp310 cp311-cp311 cp312-cp312; do \
      /opt/python/$v/bin/pip wheel --no-deps -w /raw -C cmake.define.RILLFACET_WEB_DIST=/web . ; done; \
    for w in /raw/*.whl; do auditwheel repair --plat manylinux_2_28_x86_64 -w /dist $w; done; \
    ls -l /dist

# `docker build --target manylinux-dist --output dist` writes just the wheels.
FROM scratch AS manylinux-dist
COPY --from=manylinux-wheel /dist /

FROM ${WHEELS} AS wheels

FROM ${BASE} AS wheel-test
COPY docker/install_deps.sh /usr/local/bin/install_deps.sh
RUN install_deps.sh run
COPY --from=wheels /dist /dist
COPY tests /work/tests
WORKDIR /work
# --no-index for rillfacet itself: the wheel under test, not whatever an index has.
RUN python3 -m venv /venv && /venv/bin/pip install --no-cache-dir pytest numpy websockets \
    && /venv/bin/pip install --no-cache-dir --no-index --no-deps --find-links /dist rillfacet
ENV PATH=/venv/bin:$PATH
RUN python -c "import rillfacet, pathlib; p = pathlib.Path(rillfacet.__file__).parent; \
print(sorted(x.name for x in p.iterdir())); \
assert (p/'shaders').is_dir() and (p/'assets'/'fonts').is_dir(); \
assert (p/'web'/'static'/'index.html').is_file(); \
import importlib.metadata as md; d = md.distribution('rillfacet'); \
lic = sorted(f.name for f in d.files if 'licenses' in f.parts); print(d.metadata['License-Expression'], lic); \
assert lic == ['LICENSE', 'THIRD_PARTY_LICENSES.txt'] and d.metadata['License-Expression'] == 'MIT'"
RUN python -m pytest tests -q
