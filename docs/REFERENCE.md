# rillfacet reference

Real-time scientific viewer for simulators, replacing
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
| Optional | `ffmpeg` (.mp4 capture), Node >= 20.19 or >= 22.12 (the web client; required by `pip install .`) | | |

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

Python module (`rillfacet`, nanobind):

```bash
pip install nanobind                         # CMake finds it through the interpreter
cmake -S . -B build -G Ninja -DRILLFACET_BUILD_PYTHON=ON \
      -DPython_EXECUTABLE=$(which python) && cmake --build build
PYTHONPATH=python python -m pytest tests -q  # headless checks (numpy, websockets, pytest)
```

Installable wheel (extension, Dawn, shaders and fonts in one package; needs Dawn
built as above, and a Vulkan driver at run time):

```bash
pip install .                                # scikit-build-core runs the CMake build
docker/verify.sh --wheel                     # builds it in a container, installs it in a clean image, runs the tests
docker/verify.sh --manylinux                 # manylinux_2_28 wheels for CPython 3.10-3.14 (auditwheel), tested on Ubuntu, Debian, Fedora
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

HiDPI: the viewer follows the desktop scale (e.g. 200% on GNOME or Windows,
Retina on macOS). The window size, built-in panels, fonts and overlay labels
scale with it; sizes and positions you hard-code in your own ImGui calls should
be multiplied by `v.ui_scale` (2 at 200%), e.g.
`imgui.SetNextWindowPos((12 * v.ui_scale, 80 * v.ui_scale))`.

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

Every object has display DEFAULTS, `obj.set_display(visible=, opacity=)`:
the native viewer's Structures list and the web Display panel (a Visible box
and an Opacity slider per object) start from them and the user changes them
there.
They are part of the snapshot (`attrs["display"]`, left out when default),
not per-frame state, so an overlay that is only sometimes wanted is created
hidden and costs nothing on screen until ticked. A rigid mesh's segment
colors changed after creation are streamed (and recorded) with its poses.

Camera rendering (`rillfacet.render`, for vision RL and synthetic data): a
scene also carries what viewers ignore. Rigid meshes take `normals`, `uvs`,
`materials` (`Material`: glTF's PBR metallic-roughness, optional base color
texture) and `triangle_material`; each instance (env) has its own copy of
every material's parameters, so domain randomization is an array write
(`set_materials(base_color=[E, M, 3], roughness=[E, M], metallic=...)`).
A material with `solid_texture=True` takes its base color and roughness
from a procedural SOLID (3D) texture instead (`rillfacet.solid_texture`):
a pattern defined in 3D and evaluated at the body-local position of each
surface point, so it needs no UVs (convex hulls have none), has no seams
and moves with its body. Families: plain, wood, marble, granite, stone
(domain-warped fBm), 3D checker. Each env has a row of 32 parameters per
slot (`RigidMesh.material_solid_texture` `[E, M, 32]`: family, scale,
noise offset, rotation, three sRGB colors, family knobs, roughness at the
pattern's low / high end, bump amplitude); `solid_texture.sample_params(rng,
(E, M))` draws random rows, `make_params(...)` builds one, and
`set_materials(solid_texture=rows)` applies them without recompiling.
`bump=True` on the material also perturbs the shading normal by the
pattern's height. The noise and the families are written once over an
ops layer, run in Dr.Jit by Mitsuba and in torch by
`solid_texture.evaluate` (the reference the tests check the renderers
against); the raster backend runs a line-by-line WGSL port
(`shaders/common/noise.wgsl`, `shaders/common/solid_texture.wgsl`), which
fades detail finer than a pixel to its mean (`solid_texture_filter`; it
shades one point per pixel, where Mitsuba averages over its samples); the
Cycles backend (`rillfacet-cycles`) runs an OSL port, unfiltered as
Mitsuba (OptiX and CPU only; Cycles has no OSL on CUDA).
`scene.light(...)` adds lights shared by all envs (`directional`,
`ambient`, `envmap`). `scene.background(name, images, instances=E)` gives
each env its own panorama, SEEN ONLY (it lights nothing; the lights do):
a pool of equirect images `[N, H, W, 3]` (linear, HDR; the envmap's z-up
mapping) and per env `index` (-1 = none: the lights' background), `yaw`
and `intensity`, changed by `set(...)` at the cost of a buffer write
(e.g. a new draw per episode). Raster, Mitsuba and Cycles show it where a
camera ray hits nothing within `far`, mip-filtered to the pixel's size
(`render.background_mips`, the same chain everywhere): raster looks it up
in its remap pass (a texture array), Mitsuba replaces the samples whose
ray `ray_test` misses, Cycles renders that env's beauty pass with a
transparent film and adds `(1 - alpha)` times the panorama after its
resample (`render.BackgroundLookup` in torch for both). `rillfacet.sky`
makes such pools procedurally (`random_skies(rng, n, height)`: a
horizon-to-zenith gradient, a sun disk and halo, fractal-noise clouds on a
plane, a skyline of hills or blocks, a ground; palettes day, overcast,
dusk and surreal; integer-hash noise, the same image on any device;
tests/test_sky.py). `scene.camera_sensor(...)` adds a camera per env with
OpenCV intrinsics and distortion (`K`, `dist`; camera frame x right, y down,
z forward), mounted on a body (`mount`, `body`, `local_pose`), with
per-env lens and sensor values (`aperture_radius`, `focus_distance` for
depth of field; `gain` for exposure / white balance; `vignetting`,
`shot_noise`, `read_noise`; all settable later with `set_lens`). The
intrinsics can be per env too, for lens randomization (e.g. a
focus-dependent calibration evaluated at a random lens position per env):
`K` `[envs, 3, 3]` and `dist` `[envs, n]` (`per_instance_intrinsics`,
`intrinsics(i)`; raster and Mitsuba; the raster renderer keeps one remap
table per env behind one shared pinhole proxy, Cycles refuses them). A
`Renderer` is a scene backend whose `render(camera, outputs)` returns every
env's images as torch tensors; each env is rendered in its own world (envs
sit `env_spacing` apart, beyond the cameras' `far`).

Every backend passes its linear radiance `L` through the same sensor stage
(`render/sensor.py`, `Renderer.sensor_image`) before the `linear` and `rgb`
outputs: `x = gain * (1 - vignetting * r^2) * L`, with `r` = 1 at the image
corner farthest from the principal point (so `vignetting` is the light lost
there), then Gaussian noise of variance `shot_noise * x + read_noise^2` per
channel (the Poisson-Gaussian sensor model; white = 1), clamped at 0. The
noise is seeded by the renderer's `seed`. The module docstring gives
published randomization ranges for the noise.

```python
from rillfacet.assets import load_mesh, merge_bodies     # glTF 2.0 (.glb) / OBJ
from rillfacet.render.camera import look_at, scale_intrinsics
from rillfacet.render.mitsuba import MitsubaRenderer      # pip install rillfacet[mitsuba]

r = MitsubaRenderer(spp=8)          # path tracing on CUDA
sc = Scene(r)
robot = sc.rigid_mesh("robot", **merge_bodies([load_mesh(p) for p in links]),
                      instances=E)
robot.set_poses(poses)              # [E, B, 7], torch CUDA ok
robot.set_materials(base_color=rng.uniform(0, 1, (E, len(robot.materials), 3)))
sc.camera_sensor("wrist", 320, 180, scale_intrinsics(K, (4608, 2592), (320, 180)),
                 dist=dist, mount=robot, body=6, local_pose=cam_in_flange,
                 aperture_radius=0.6e-3, focus_distance=rng.uniform(0.1, 1, E))
out = r.render("wrist", outputs=("rgb", "depth", "segmentation"))
# rgb [E, H, W, 3] sRGB 0..1, depth [E, H, W] z in m (0 = none),
# segmentation [E, H, W] int32 (-1 = none; r.segment_labels() names them)
```

`MitsubaRenderer` (Mitsuba 3, `cuda_ad_rgb`) path-traces RGB (any Mitsuba
integrator: `integrator={"type": "direct"}` is faster and cleaner) and
casts one sharp pinhole ray per pixel for depth and segmentation. It keeps
the shape count independent of the env count (one Mitsuba mesh per rigid
mesh and textured material, holding all envs; poses are GPU-skinned into
its vertex buffer) because Mitsuba re-traces its kernels on the host each
render at a cost growing with the shapes, and generates camera rays in
torch: per-env poses and lenses stay tensors, and the OpenCV distortion is
applied exactly per sample (`render.camera.PixelRays`; strong wide-angle
models often fold just outside the calibrated area, and the pixels there
get the nearest reachable ray, with a warning). Large batches render in
chunks of `max_samples`. Measured on an RTX 5070 Ti, 224x224 RGB with depth
of field plus depth and segmentation, simple scene: 256 envs at 4 spp in
~260 ms (`path`, max depth 4) or ~117 ms (`direct`); 1024 envs at 1 spp
(`direct`) in ~165 ms. The first render compiles kernels (~0.2-0.7 s).
`denoise=True` runs Mitsuba's OptiX denoiser on the batch. Solid textures
are Python Mitsuba plugins (`render/_mitsuba_solid_texture.py`): every
slot solid, 224x224 at 4 spp, they take ~1.35x the time of plain
materials (64 envs `direct` 35 vs 25 ms, 256 envs `path` 204 vs 152 ms),
~2.6x with bump; the first compile of their kernels takes a few seconds.

Blender Cycles is a second backend with the same interface, in the separate
GPL-3.0 package `rillfacet-cycles` (`from rillfacet_cycles import
CyclesRenderer`; it imports `bpy`, so it cannot live in this MIT package).
It renders one Blender render per env and camera (a pinhole proxy, with
Cycles' own depth of field and denoiser, resampled through the exact OpenCV
distortion in torch) and is several times slower than Mitsuba at RL batch
sizes, with less noise per sample; per-env tints also apply to textured
materials there.

`RasterRenderer` (`rillfacet.render.raster`, part of the extension, no extra
dependency) rasterizes with Dawn for vision RL at thousands of envs:
`RasterRenderer(chunk=256)`, then `render(camera, outputs)` as above (or
`raw=True` for uint8 rgb, float16 linear, int16 labels) or
`render_chunks(camera, outputs)`, which yields `(e0, e1, images)` per chunk
of envs in those raw dtypes (rgb is a `[n, H, W, 3]` view of RGBA; buffers
are reused, so use or copy a chunk before asking for the one after the
next). All envs share one world frame: each is drawn into its own tile of a
layered atlas by instanced draws (instance = body * n + env) posed in the
vertex shader from a pose texture, and kept in its tile by clip distances.
Each env renders a centered pinhole proxy (as the Cycles backend), which a
compute pass resamples through the exact OpenCV distortion (`supersample`
x `supersample` taps), adding the background (the env's panorama, else
the ambient light and the envmap) and the shared sensor stage (same model, its own GPU random
numbers, drawn per env so images do not depend on the chunking). Shading is
forward with Mitsuba's principled BRDF (Burley diffuse, GGX with separable
Smith masking; base color textures times the per-env color; solid
textures at the interpolated body-local position) under up to 4
directional lights, the first casting shadows (`shadow_resolution`^2 per
env, 3x3 PCF), plus the uniform sky (the BRDF's exact directional albedo,
a table `brdf_lut()` computes once) and the envmap (9 SH coefficients for
diffuse, its mip chain for specular). The shadow maps cover the scene's
box (fit at the first render or given as `shadow_box`) or, with
`shadow_extent` (m, per camera as a dict), a box that far ahead of each
env's camera: a close-up camera then gets millimeter shadow texels at 512^2
(the oven-grasp wrist camera: 0.4 m, sharper than 2048^2 over the scene),
and every caster in the scene still casts into it. Next to Mitsuba's
`direct` integrator a surface under the sun is within 1% (and on the
oven-grasp scene too, per body); the sky is not: it reaches every surface
unblocked (no occlusion of the sky), so surfaces that see the table or the
oven instead of the sky are brighter (up to 1.5x on the oven-grasp scene
with its 0.5 sky). No depth of field (a warning), motion blur or
interreflections. Geometry agrees with Mitsuba's (labels on all pixels away
from edges, z-depth to 1e-5; tests/test_render_raster.py). Solid textures
match the torch reference unfiltered and Mitsuba's images up to
anti-aliasing; with every slot solid, 4096 envs at 224x224 take 55 ms
instead of 35 (96 ms with bump).

On Linux + Vulkan + NVIDIA the poses and images never leave the GPU
(`src/rillfacet/cuda_share.h`): the shared textures are allocated on our own
VkDevice as exportable memory and imported by both Dawn and CUDA (driver
API, loaded at runtime; the build only needs CUDA's headers), each hand-over
ordered by a semaphore in each direction, so torch receives images with one
device-to-device copy and a chunk loop never waits on the CPU (with
`double_buffer`, Dawn renders the next chunk while CUDA work on torch's
stream uses the current one). Elsewhere (`info` tells) poses are uploaded
from the host and images read back. Measured on an RTX 5070 Ti, the
oven-grasp wrist camera (Pi Camera Module 3 Wide calibration, 640 x 384,
proxy 860 x 522), chunk 256, 512^2 shadows, the UR5e's visual meshes
decimated to 10% (17.6k triangles in the scene): rgb in 3.4 ms for 128 envs
(Mitsuba, direct, 4 spp: 215 ms), 27 ms for 1024, 106 ms for 4096 (178 ms
at full detail, 134k triangles); rgb + depth + segmentation 131 ms for 4096.
The time goes mostly to memory traffic of the wide proxy (`oversample=0.75`
saves a third) and to triangles at full detail, so give `BodyMesh`
low-detail visual meshes for RL. A detector of YOLOv8n's size on the same
GPU costs ~5x the rendering, and overlapping the two buys nothing there
(CUDA and Vulkan work time-slice the GPU).

Records: `rillfacet.web.record.Recorder` is a scene backend that logs every
update between `start(scene)` and `finish()` against a caller-driven clock
(`tick(t)`), as tracks `(object, field) -> (t, values)`; CUDA tensors are
copied to pinned memory without blocking. `RecordWriter(root)` writes records
on a background thread (`<root>/<id>/meta.json, tracks.npz, summary.json`,
the static scene once per content hash under `<root>/scenes/`, an
`index.json`); pose tracks store never-moving bodies once and the rest as
time-delta-coded int16. `read_record(path)` returns `(meta, record,
summary)`. A training loop can record every checkpoint's evaluation this way.

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

HTTPS: WebGPU needs a secure context, which plain http is only on
`localhost` (the client says so instead of starting). To open the viewer
from other machines, give the server a PEM certificate and key:
`VizServer(ssl_cert=, ssl_key=)`, or the environment variables
`RILLFACET_WEB_CERT` / `RILLFACET_WEB_KEY` so every script using the server
(and `rillfacet.web.replay`) serves https + wss on the same port without a
flag; `ssl_cert=""` keeps it http. The browsers must trust the certificate:
a private CA whose `ca.crt` is imported on each client, its name
constraints limited to the hosts it signs for, is one way.

The browser renders like the native viewer: the same WGSL (the shared
`shaders/common`, all four styles, SSAO, grid, composite, overlays, SDF
text) and the same viewport, so everything under Controls below applies,
except video, screenshots and the application drag: navigation, vertex /
edge / face / body selection with the same element numbering, box and x-ray
select, hiding, measuring, wireframe shading, axis views and the gizmo, and
the Display and Inspect panels. Web only: double-click shows one env alone
(Esc: all), and the right panel lists the focused env's channels.

The built client is not committed (`python/rillfacet/web/static/` is
ignored). `pip install .` / `pip wheel .` build it into the wheel with npm
(`npm ci`, then `npm run build`; CMakeLists.txt reruns it when `web/` or
`shaders/` change), and so does a plain CMake build with
`-DRILLFACET_BUILD_PYTHON=ON` into `python/rillfacet/web/static/` when npm is
on the PATH. `-DRILLFACET_WEB_DIST=DIR` ships an already built client instead
(docker/Dockerfile and the CI build it once for all their wheels; with pip:
`-C cmake.define.RILLFACET_WEB_DIST=DIR`), `-DRILLFACET_WEB=OFF` builds
without it (the server then answers 503). By hand, for `PYTHONPATH=python`:

```bash
cd web && npm ci && npm run build          # typecheck + bundle into python/rillfacet/web/static
npm run dev                                # dev server, proxies /ws to :8080
```

Checks: `web/tools/golden.py EVALS_DIR RECORD_ID TICK OUT [--display JSON]`
renders one record frame in a headless native viewer and in Chromium at the
same camera and settings (style, wireframe, ortho, a selection, ...) and
diffs them; `web/tools/screenshot.mjs URL WAIT_MS EXPR [OUT.png]` opens the
client in a real Chromium window over CDP (headless Chromium may have no
WebGPU adapter) and evaluates `EXPR` (`window.__rillfacet` holds the stream
stats).

Dragging: with `v.drag_enabled = True`, Ctrl+LMB (Cmd+LMB on macOS) grabs the element under the
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

## Controls (Blender style)

On macOS Ctrl and Cmd are swapped, as in ImGui's Mac behavior: Cmd acts as Ctrl, and Ctrl+click is a right-click. Scripted input then injects `ImGuiMod_Super` for Ctrl.

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
| Drag | Ctrl+LMB (Cmd+LMB on macOS), when the app enables it (`drag_enabled`) |
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
  camera_raster.wgsl (+ common/noise.wgsl, common/solid_texture.wgsl)   RasterRenderer
src/python/module.cpp   nanobind module `_rillfacet` (+ `rillfacet.imgui`)
python/rillfacet/        Python package
  scene_api.py          backend-neutral scene (+ materials, lights, backgrounds,
                        camera sensors)
  assets.py             glTF / OBJ visual meshes, merge_bodies
  solid_texture.py      procedural solid (3D) textures: parameter rows, sampler,
                        noise + families (Dr.Jit / torch), torch reference
  sky.py                procedural sky panoramas (background pools)
  render/               camera renderers: camera.py (OpenCV model), sensor.py
                        (gain, vignetting, noise), mitsuba.py
                        (+ _mitsuba_solid_texture.py plugins), raster.py
  web/                  stream server, recorder, replay, built browser client
tests/                  headless Python tests (render tests need CUDA + mitsuba)
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

## License

MIT (`LICENSE`). Wheels also contain Dawn (BSD-3-Clause), GLFW (zlib), Dear ImGui and
ImPlot (MIT), nanobind, and the Inter and JetBrains Mono fonts (OFL-1.1); their
licenses are in `THIRD_PARTY_LICENSES.txt` and `assets/fonts/`.
