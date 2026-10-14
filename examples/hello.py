"""Hello, rillfacet: a sheet rippled by a travelling wave, colored by height.

    pip install rillfacet
    python hello.py
"""

import numpy as np

import rillfacet as viz

# An n x n grid over a 4 x 4 square, two triangles per cell.
n, size = 60, 4.0
u, v = np.meshgrid(np.linspace(-0.5, 0.5, n), np.linspace(-0.5, 0.5, n))
r = np.hypot(u, v)
a = (np.arange(n - 1)[:, None] * n + np.arange(n - 1)).ravel()
tris = np.stack([a, a + 1, a + n + 1, a, a + n + 1, a + n], axis=1).reshape(-1, 3)


def positions(t):
    """Vertex positions at time t: a ripple spreading out from the centre."""
    z = 1.3 + 0.35 * np.cos(9 * r - 2 * t) * np.exp(-2 * r) - 0.6 * r**2
    return np.stack([u * size, v * size, z], axis=-1).reshape(-1, 3)


viewer = viz.Viewer(title="hello rillfacet")
sheet = viewer.scene.add_mesh("sheet")
p = positions(0.0)
sheet.set_geometry(p, tris)
sheet.add_scalar("height", viz.ElementKind.Vertex, p[:, 2])
sheet.color_source = viz.ColorSource.Quantity
sheet.color_quantity = "height"
sheet.isolines = True
sheet.isoline_spacing = 0.05
sheet.smooth_shading = True
viewer.camera.target = (0.0, 0.0, 1.0)
viewer.camera.distance = 8.5
viewer.camera.yaw = -0.6
viewer.camera.pitch = 0.5

t = 0.0


def callback():  # runs every frame
    global t
    t += viewer.frame_seconds
    p = positions(t)
    sheet.set_positions(p)
    sheet.add_scalar("height", viz.ElementKind.Vertex, p[:, 2])


viewer.set_callback(callback)
viewer.run()
