# avbd-viz

Real-time scientific viewer for the AVBD simulators, replacing polyscope.
WebGPU (Dawn, Vulkan backend on Linux) + WGSL shaders + Dear ImGui. No
dependency on avbd: simulators feed it plain arrays.

Status: **v1 in progress.** Default look: **Studio**. MatCap, Environment PBR
and Technical remain available under Display → Style. Shading is Solid (in the
chosen style) or Wireframe (see-through, Blender's X-ray wireframe).

## Build

```bash
./scripts/build_dawn.sh                    # once, ~10 min: Dawn -> third_party/dawn
cmake -S . -B build -G Ninja && cmake --build build
./build/showcase                           # standalone demo (no simulator)
./build/showcase --headless --style 2 --out shot.png
```

`build_dawn.sh` pins a Dawn commit. It needs the X11 development headers,
including `libx11-xcb-dev`.

Simulator demo (lives in avbd-cuda, links this repo):

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
| Misc | Alt+A / Esc clear selection, F12 screenshot |
| Sim demo | Space shoot box, Ctrl+LMB drag body, P pause, → step |

Axis views (numpad or gizmo) switch to orthographic; in the side views the grid
moves to the view plane through the origin (YZ looking along X, XZ along Y)
and sits behind everything, as in Blender. Orbiting returns to perspective and
the ground grid.

In wireframe shading, "Hide flat edges" skips edges between (nearly) coplanar
faces, so triangulated convex hulls show only their real edges. Leave it off
for cloth: on a flat sheet every edge is flat.

## Layout

```
src/avbd_viz/
  gpu.*             WebGPU device, buffers, bind-group shorthands
  shader_library.*  WGSL loader: `#include`, hot reload on save
  camera.*          z-up turntable, reversed-Z infinite projection, smooth views
  scene.*           SurfaceMesh (segments + quantities), PointCloud, VectorSet
  renderer.*        frame graph: shadow -> prepass (depth/normal/ids) -> SSAO ->
                    main (4x MSAA) -> composite (tonemap, outlines) -> overlays -> UI
  selection.*       id-buffer picking, element choice, box select, measurements
  text.*            SDF font atlas (stb_truetype) for 3D labels
  environment.*     procedural / .hdr environments (GGX prefilter, SH9), matcaps
  ui.*, viewer.*    ImGui panels, gizmo, HUD, input, window loop, headless mode
shaders/
  styles/{studio,matcap,pbr,technical}.wgsl   one `shade()` each: edit these to restyle
  mesh, points, arrows, grid, ssao, composite, overlay_*, env_prefilter .wgsl
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
