# avbd-viz

Real-time scientific viewer for the AVBD simulators, replacing polyscope.
WebGPU (Dawn, Vulkan backend on Linux) + WGSL shaders + Dear ImGui. No
dependency on avbd: simulators feed it plain arrays.

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

```bash
./scripts/build_dawn.sh                    # once, ~10 min: Dawn -> third_party/dawn
cmake -S . -B build -G Ninja && cmake --build build
./build/showcase                           # standalone demo (no simulator)
./build/showcase --headless --style 2 --out shot.png
```

`build_dawn.sh` pins a Dawn commit. It needs the X11 development headers,
including `libx11-xcb-dev`.

At startup Dawn prints `maxDynamicUniformBuffersPerPipelineLayout artificially
reduced from 500000 to 16 ...` and the storage-buffer twin. That is Dawn
clamping the limits the driver advertises to its own internal cap
(`NormalizeLimits`), once per device, whatever a client asks for. Nothing here
binds with dynamic offsets, so the warning is harmless.

Python module (`avbd_viz`, pybind11):

```bash
cmake -S . -B build -G Ninja -DAVBD_VIZ_BUILD_PYTHON=ON \
      -DPython3_EXECUTABLE=$(which python) && cmake --build build
pip install -e . --no-build-isolation        # or: PYTHONPATH=python
PYTHONPATH=python python -m pytest tests -q   # headless checks
```

```python
import avbd_viz as viz
from avbd_viz import imgui              # polyscope.imgui-style subset

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
images. `avbd_viz.implot` wraps the line-plot
subset (`BeginPlot`/`SetupAxis`/`PlotLine`/`SetAxes`), and `imgui.GetIO()` can
inject input (`AddKeyEvent`, `AddMousePosEvent`, `AddMouseButtonEvent`) so a
viewer app can be driven headlessly from a test.

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
src/avbd_viz/
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
src/python/module.cpp   pybind11 module `_avbd_viz` (+ `avbd_viz.imgui`)
python/avbd_viz/        Python package
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
