# rillfacet

**A fast 3D viewer for simulations.** Feed it plain arrays; get an interactive scene in a native window or in your browser.

<p align="center">
  <img src="https://media.githubusercontent.com/media/kennychufk/public-assets/main/rillfacet/hero.png" alt="rillfacet showcase scene" width="800">
</p>

- **Simple.** Meshes, points, curves, volumes and arrows, colored by any quantity you attach.
- **Fast.** WebGPU rendering with soft shadows, ambient occlusion and transparency.
- **Everywhere.** Python, C++, and a browser client that streams from a running process.
- **Independent.** It never depends on a simulator. NumPy and torch tensors (CUDA too) just work.

*The name:* a **rill** is a small stream, like the stream of poses and meshes flowing from your simulator. A **facet** is one flat face of a mesh, or the flat near and far planes that bound what a camera sees.

## Python

```bash
pip install rillfacet
```

Start with [examples/hello.py](examples/hello.py): a rippling sheet colored by height, in about 50 lines with no simulator.

<p align="center">
  <img src="https://media.githubusercontent.com/media/kennychufk/public-assets/main/rillfacet/hello.gif" alt="A rippling sheet colored by height" width="560">
</p>

Plugging in your own simulator looks like this:

```python
import rillfacet as viz

v = viz.Viewer()
cloth = v.scene.add_mesh("cloth")
cloth.set_geometry(verts, tris)
cloth.add_scalar("speed", viz.ElementKind.Vertex, speed)
cloth.color_source = viz.ColorSource.Quantity
cloth.color_quantity = "speed"
cloth.colormap = "viridis"

def callback():              # runs every frame
    sim.step()
    cloth.set_positions(sim.positions)

v.set_callback(callback)
v.run()
```

<p align="center">
  <img src="https://media.githubusercontent.com/media/kennychufk/public-assets/main/rillfacet/python-cloth.gif" alt="Cloth in the wind" width="560">
</p>

Use `Viewer(headless=True)` to render offscreen, for screenshots and CI. Your own panels use the familiar `imgui` API.

## Look closer

Switch styles and themes, see through to the wireframe, or slice a volume open to inspect what is inside.

Select vertices, edges, faces or bodies. Measure distances and angles. Drag objects with the mouse. Controls follow Blender.

## C++

Link the static library and use the same scene API. The bundled demo needs no simulator:

```bash
./build/showcase
```

## In the browser

Stream a live run, or replay saved ones, in any WebGPU browser. The browser renders the same shaders as the native window.

```python
from rillfacet.scene_api import Scene
from rillfacet.web.server import StreamBackend, VizServer

server = VizServer("0.0.0.0", 8080)
backend = StreamBackend(server.stream("live"))
scene = Scene(backend)

if backend.wanted():             # a browser is watching
    backend.commit(scene, time=step)
```

Open `http://<host>:8080/`. It suits physical simulation and reinforcement learning alike; the clip below shows robots from a training run.

<p align="center">
  <img src="https://media.githubusercontent.com/media/kennychufk/public-assets/main/rillfacet/web.gif" alt="Robots from a training run in the browser" width="640">
</p>

## Requirements

- Linux x86-64 and Python 3.10 or newer.
- A Vulkan driver (your GPU's, or Mesa's software one).
- Optional: `ffmpeg` to record `.mp4` video.

## Build from source

```bash
./scripts/build_dawn.sh                      # once, about 10 minutes
cmake -S . -B build -G Ninja && cmake --build build
pip install .                                # the Python wheel
```

You need GCC 13 or newer (or Clang), CMake 3.24 or newer, Ninja and git. Full details, the complete API notes and the controls table are in [docs/REFERENCE.md](docs/REFERENCE.md).

## License

MIT. Wheels also bundle Dawn, GLFW, Dear ImGui, ImPlot, nanobind and fonts under their own licenses; see `THIRD_PARTY_LICENSES.txt`.
