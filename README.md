# rillfacet

Real-time scientific viewer for simulators (AVBD, deskonica, ...), replacing
polyscope. WebGPU (Dawn, Vulkan backend on Linux) + WGSL shaders + Dear ImGui.
No dependency on any simulator: they feed it plain arrays. The name: a rill is
a small stream (the streaming of 3D assets and poses); a facet is a mesh's
primitive triangle, or the projection plane of a scene seen from a camera.

Status: **v1.** Default look: **Studio**. MatCap, Environment PBR and
Technical remain available under Display → Style. Shading is Solid (in the
chosen style) or Wireframe (see-through, Blender's X-ray wireframe).

Structures: surface meshes (with segments = bodies), point clouds, curve
networks (tubes), tet volume meshes and vector sets. Quantities: scalars,
vectors (drawn as arrows) and colors on vertices, edges, faces, bodies or
cells, colored through a colormap with optional isolines. Per structure
opacity (order-independent transparency), a global slice plane that also cuts
volumes open to show interior quantities, screenshots and video (ffmpeg).

## Build

Prerequisites (Linux x86-64). Package names are for Debian/Ubuntu (apt) and
Fedora (dnf):

| For | Needs | apt | dnf |
|---|---|---|---|
| C++ build | GCC >= 13 or Clang (GCC 12 cannot compile Dawn), CMake >= 3.24, Ninja, git, Python 3 (Dawn's dependency fetcher) | `build-essential cmake ninja-build git ca-certificates pkg-config python3` (+ `clang`) | `gcc-c++ make cmake ninja-build git ca-certificates pkgconf-pkg-config python3` (+ `clang`) |
| Windows (GLFW, Dawn X11 surfaces) | X11 development headers | `libx11-dev libx11-xcb-dev libxcb1-dev libxrandr-dev libxinerama-dev libxcursor-dev libxi-dev` | `libX11-devel libxcb-devel libXrandr-devel libXinerama-devel libXcursor-devel libXi-devel` |
| Python module | Python >= 3.10 with headers and venv | `python3-dev python3-venv` | `python3-devel` |
| Running | a Vulkan driver (a GPU's, or Mesa's software one) | `libvulkan1 mesa-vulkan-drivers` | `vulkan-loader mesa-vulkan-drivers` |
| Optional | `ffmpeg` (.mp4 capture), Node >= 20.19 or >= 22.12 (only to rebuild `web/`) | | |

No OpenGL packages are needed. `docker/verify.sh` checks the whole list from
bare images; it last passed (C++ part, Python module, 33 tests on Mesa's
software Vulkan, web client) on:

| Image | Compiler |
|---|---|
| Ubuntu 24.04 | GCC 13.3 and Clang 18.1 |
| Debian 13 | GCC 14.2 |
| Fedora 44 | GCC 16.2 and Clang 22.1 |

Not supported: GCC 12 (Debian 12) fails inside Dawn. Other distributions,
aarch64 and real GPUs are untested by that script.

The Dawn, GLFW, GLM, Dear ImGui, ImPlot and stb sources are downloaded during
the build (`scripts/build_dawn.sh`, `cmake/deps.cmake`), so it needs network
access to github.com and googlesource.com. Python packages are declared in
`pyproject.toml`.

```bash
./scripts/build_dawn.sh                    # once, ~10 min: Dawn -> third_party/dawn
cmake -S . -B build -G Ninja && cmake --build build
./build/showcase                           # standalone demo (no simulator)
./build/showcase --headless --style 2 --out shot.png
```

`build_dawn.sh` pins a Dawn commit.

`docker/verify.sh [IMAGE[+clang] ...]` builds from the tracked files only in
fresh containers (`DOCKER="sudo docker" docker/verify.sh` if your user is not
in the `docker` group); the install commands it uses are in
`docker/install_deps.sh`.

At startup Dawn prints `maxDynamicUniformBuffersPerPipelineLayout artificially
reduced from 500000 to 16 ...` and the storage-buffer twin. That is Dawn
clamping the limits the driver advertises to its own internal cap
(`NormalizeLimits`), once per device, whatever a client asks for. Nothing here
binds with dynamic offsets, so the warning is harmless.

Python module (`rillfacet`, pybind11):

```bash
pip install pybind11                         # CMake finds it through the interpreter
cmake -S . -B build -G Ninja -DRILLFACET_BUILD_PYTHON=ON \
      -DPython3_EXECUTABLE=$(which python) && cmake --build build
pip install -e ".[build,test]" --no-build-isolation   # or: PYTHONPATH=python (numpy, websockets)
python -m pytest tests -q                    # headless checks
```

```python
import rillfacet as viz
from rillfacet import imgui              # polyscope.imgui-style subset

v = viz.Viewer()                        # Viewer(headless=True) renders offscreen
cloth = v.scene.add_mesh("cloth")
cloth.set_geometry(verts, tris)         # numpy, lists or torch tensors (CUDA ok)
cloth.add_scalar("speed", viz.ElementKind.Vertex, speed)
cloth.color_source = viz.ColorSource.Quantity
cloth.color_quantity = "speed"
cloth.colormap = "viridis"

def callback():                         # every frame, inside the ImGui frame
    sim.step(dt, iters)
    cloth.set_positions(sim.positions)
    if imgui.Button("Reset"):
        ...
v.set_callback(callback)
v.run()
```

Placement: every structure has a `transform` (4x4, world from local, like
polyscope's structure transform). Once one is set, the geometry setters take
local coordinates and positions, bounds and picking report placed ones, so
moving a rigid part is one assignment.

Images: `v.scene.set_image(name, img)` stores an `[H, W, 3|4]` image (uint8,
or floats in 0..1, top row first; replace it every frame for a stream). A
surface mesh shows it with `set_uvs(uv)`, `texture = name` and
`color_source = ColorSource.Texture` (`unlit = True` shows it without
lighting, e.g. a camera frame on a billboard); ImGui shows it with
`imgui.Image(v.image_texture(name), (w, h))`.

Text: `v.overlay.text(text, anchor, ...)` draws a screen-facing SDF label at a
world point, `size_px` tall, or `world_height` tall in world units (it then
shrinks with distance like a sign in the scene, and is skipped below
`min_px`). The overlay is rebuilt every frame: add labels from the callback.

Threads and pacing: `frame()` / `run()` release the Python GIL for the whole
frame except the callback, so worker threads are never paced by the render
loop (touch structures only from the callback or the thread calling
`frame()`). `Viewer(vsync=False, max_fps=60)` presents without waiting for the
display — a vsynced present blocks while the display is off or locked, about
1 s per frame on X11 — and sleeps to hold the cap (0 = uncapped).
`request_close()` ends `run()` after the current frame.

ImGui has no out-parameters in Python, so widgets that write through a pointer
in C++ return the new value instead: `changed, value = imgui.SliderFloat(...)`,
`changed, on = imgui.Checkbox(...)`. Beyond widgets the subset covers tables,
tab bars, child windows, style vars/colors, text wrapping, the clipboard and
images. `rillfacet.implot` wraps the line-plot
subset (`BeginPlot`/`SetupAxis`/`PlotLine`/`SetAxes`), and `imgui.GetIO()` can
inject input (`AddKeyEvent`, `AddMousePosEvent`, `AddMouseButtonEvent`) so a
viewer app can be driven headlessly from a test.

Backend-neutral scenes: `rillfacet.scene_api.Scene` describes what to show,
split by how often it changes: rigid meshes (body-local vertices once, one
pose per instance and body per frame), boxes, points, polylines, labels
(fixed texts, or values a backend formats with `fmt`) and named channels.
`NativeBackend(viewer)` mirrors it into a viewer (`scene.draw_overlay()` from
the callback for the labels); the web viewer's stream and recorder backends
take the same calls, and a backend added later is sent the whole scene.

```python
from rillfacet.scene_api import NativeBackend, Scene
sc = Scene(NativeBackend(v))
bodies = sc.rigid_mesh("bodies", local_verts, vertex_body, tris, body_tri_offsets,
                       instances=4, offsets=grid)
bodies.set_poses(poses)                 # [4, B, 7] translation + xyzw quaternion
```

Records: `rillfacet.web.record.Recorder` is a scene backend that logs every
update between `start(scene)` and `finish()` against a caller-driven clock
(`tick(t)`), as tracks `(object, field) -> (t, values)`; CUDA tensors are
copied to pinned memory without blocking. `RecordWriter(root)` writes records
on a background thread (`<root>/<id>/meta.json, tracks.npz, summary.json`,
the static scene once per content hash under `<root>/scenes/`, an
`index.json`); pose tracks store never-moving bodies once and the rest as
time-delta-coded int16. `read_record(path)` returns `(meta, record,
summary)`. avbd-rl's side eval records every training checkpoint this way.

Web viewer: `rillfacet.web.server.VizServer(host, port)` serves the browser
client (WebGPU, `web/`) and streams scenes over a WebSocket from inside a
running process, on one port (the next free one if taken). A
`StreamBackend(server.stream("live"))` scene backend commits frames when
`wanted()` — a browser is connected and ready — so an unwatched process pays
one flag check per step; frames are best effort (newest wins, acked by the
client) and CUDA pose tensors are copied without blocking.

```python
from rillfacet.scene_api import Scene
from rillfacet.web.server import StreamBackend, VizServer
server = VizServer("0.0.0.0", 8080, name="my run")     # http://<host>:8080/
backend = StreamBackend(server.stream("live"))
scene = Scene(backend)                                  # fill it as any scene
if backend.wanted():                                    # once per step
    bodies.set_poses(poses)
    backend.commit(scene, time=step)
```

The client has three modes (bottom bar): **Live** (the stream), **Training
ring** (the producer's latest episodes, built on request through
`server.ring = RingMailbox()`), and **Evals** (saved records:
`VizServer(evals=dir)` or `server.offer_evals(dir)`, picked on the outer
timeline, played under the scrubber with Space, ←/→, Home/End, [ ]; there Home
seeks to the start and Shift+Home frames the scene).
`server.accept("save_checkpoint", ...)` names the browser requests the
producer handles; it collects them with `take_requests()` between steps and
answers with `event(text)` toasts. A finished run's records replay without
the producer:

```bash
python -m rillfacet.web.replay RUN_DIR      # RUN_DIR or its evals/ directory
```

The browser renders like the native viewer: the same WGSL (the shared
`shaders/common`, all four styles, SSAO, grid, composite, overlays, SDF
text) and the same viewport, so everything under Controls below applies,
except video, screenshots and the application drag: navigation, vertex /
edge / face / body selection with the same element numbering, box and x-ray
select, hiding, measuring, wireframe shading, axis views and the gizmo, and
the Display and Inspect panels. Web only: double-click shows one env alone
(Esc: all), and the right panel lists the focused env's channels.

The built client is committed under `python/rillfacet/web/static/`; rebuild it
after editing `web/`:

```bash
cd web && npm install && npm run build     # typecheck + bundle into the package
npm run dev                                # dev server, proxies /ws to :8080
```

Checks: `web/tools/golden.py EVALS_DIR RECORD_ID TICK OUT [--display JSON]`
renders one record frame in a headless native viewer and in Chromium at the
same camera and settings (style, wireframe, ortho, a selection, ...) and
diffs them; `web/tools/screenshot.mjs URL WAIT_MS EXPR [OUT.png]` opens the
client in a real Chromium window over CDP (headless Chromium may have no
WebGPU adapter) and evaluates `EXPR` (`window.__rillfacet` holds the stream
stats).

Dragging: with `v.drag_enabled = True`, Ctrl+LMB grabs the element under the
cursor (mesh face, tet, curve edge or point) of any structure whose
`draggable` is true, and `v.drag` reports it every frame: `phase`
(`Started` / `Held` / `Released` / `Idle`, Started and Released lasting one
frame), `object`, `element`, the element's `vertices` and the `weights` that
reproduce the grabbed point, `grab_point`, the current `point`, and `target`,
the cursor on the camera-facing plane through the grab point. The viewer draws
the grab-to-cursor line; what moves is up to the application (pin and move
vertices, pull a rigid body with a spring). `cancel_drag()` drops a drag
silently (e.g. after rebuilding the scene); `begin_drag(x, y)`, `drag_to(x, y)`
and `end_drag()` script one without the mouse.

Simulator demos (live in avbd-cuda, listed in its docs/VISUALIZATION.md).
Python, on the avbd `Simulator` (cloth, tet bodies as volume meshes, ropes)
and on the rigid simulators (`mixed_convex_demo.py` has the scenes of the C++
demo below):

```bash
cd ../avbd-cuda && python examples/soft_body_demo.py   # --headless --scene 1 --steps 400 --out knot.png
python examples/cloth_demo.py                          # rope_demo.py, rigid_demo.py box, ...
python examples/mixed_convex_demo.py                   # --num-envs 16, --headless --out shot.png
```

C++, on `RigidCompoundSimulator`:

```bash
cd ../avbd-cuda && conda activate avbd
cmake -S . -B build-viewer -G Ninja -DCMAKE_BUILD_TYPE=Release -DAVBD_BUILD_VIEWER=ON \
      -DBUILD_TESTS=OFF -DAVBD_BUILD_PYTHON_MODULE=OFF
cmake --build build-viewer --target mixed_convex_viewer
./build-viewer/mixed_convex_viewer                     # --num-envs 16 for the env grid
./build-viewer/mixed_convex_viewer --headless --scene "Chaos Drop" --steps 260 --style 3 --out s.png
```

## Controls (Blender style)

| Action | Input |
|---|---|
| Orbit / pan / zoom | MMB drag / Shift+MMB / wheel or Ctrl+MMB (Alt+LMB orbits too) |
| Views | Numpad 1 / 3 / 7 front / right / top (Ctrl = opposite), 5 persp/ortho, 2/4/6/8 orbit; click the axis gizmo |
| Frame | Numpad . or F (selection), Home (all) |
| Select | LMB click, Shift+click add/remove, LMB drag box (Shift extends); Alt+Z x-ray select |
| Pick mode | 1 vertex, 2 edge, 3 face, 4 body (segment) |
| Shading | Shift+Z Solid ↔ Wireframe (see-through; box select goes through), Z wire overlay on Solid |
| Hide | H hides selected bodies, Alt+H unhides all; or tick them in Display → Structures → Bodies |
| Measure | M cycles distance → angle → off; clicks snap to vertices within 12 px |
| Misc | Alt+A / Esc clear selection, F12 screenshot, F10 start/stop video |
| Drag | Ctrl+LMB, when the app enables it (`drag_enabled`) |
| Sim demo | Space shoot box, Ctrl+LMB drag body, P pause, → step |

Axis views (numpad or gizmo) switch to orthographic; in the side views the grid
moves to the view plane through the origin (YZ looking along X, XZ along Y)
and sits behind everything, as in Blender. Orbiting returns to perspective and
the ground grid.

In wireframe shading, "Hide flat edges" skips edges between (nearly) coplanar
faces, so triangulated convex hulls show only their real edges. Leave it off
for cloth: on a flat sheet every edge is flat.

Display → Slice plane cuts away everything on one side of an axis-aligned
plane (per structure, "Cut by the slice plane"). Volume meshes are filled in at the
cut, so cell and vertex quantities show inside the body; the cut faces can be
picked and inspected like any other.

Capture (Display panel): Screenshot writes a PNG; Record streams every frame
to ffmpeg (H.264 .mp4), or numbered PNGs without ffmpeg. "Include UI" chooses
between the full window and the 3D view alone.

## Layout

```
src/rillfacet/
  gpu.*             WebGPU device, buffers, bind-group shorthands
  shader_library.*  WGSL loader: `#include`, hot reload on save
  camera.*          z-up turntable, reversed-Z infinite projection, smooth views
  scene.*           SurfaceMesh (segments), PointCloud, CurveNetwork, VolumeMesh,
                    VectorSet; quantities on their elements
  renderer.*        frame graph: shadow -> prepass (depth/normal/ids) -> SSAO ->
                    main (4x MSAA) -> transparency (weighted blended OIT) ->
                    composite (tonemap, outlines) -> overlays -> UI
  selection.*       id-buffer picking, element choice, box select, measurements
  text.*            SDF font atlas (stb_truetype) for 3D labels
  environment.*     procedural / .hdr environments (GGX prefilter, SH9), matcaps
  ui.*, viewer.*    ImGui panels, gizmo, HUD, input, window loop, headless mode
shaders/
  styles/{studio,matcap,pbr,technical}.wgsl   one `shade()` each: edit these to restyle
  mesh, points, curves, arrows, grid, ssao, composite, overlay_*, env_prefilter .wgsl
src/python/module.cpp   pybind11 module `_rillfacet` (+ `rillfacet.imgui`)
python/rillfacet/        Python package
tests/                  headless Python tests
```

## Changing the look

Each style is one short function, `fn shade(s: Surface) -> vec3f`, in
`shaders/styles/`. Edit and save while the viewer runs: pipelines rebuild
automatically, and a WGSL error shows as a red banner while the previous
pipelines keep rendering. `python3 scripts/check_shaders.py` validates every
shader offline with Dawn's `tint`.

## Web portability

Everything is plain WebGPU/WGSL, so the shaders run unmodified in browsers and
the C++ host compiles to WebAssembly with Emscripten's `emdawnwebgpu` port.
Native-only pieces: `Gpu::wait` (browsers await instead of blocking) and the
GLFW/X11 surface. The only thing WebGPU cannot do is share CUDA buffers
directly; simulator data is copied through the CPU each frame.
