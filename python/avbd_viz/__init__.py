"""avbd-viz: real-time scientific viewer (WebGPU).

    import avbd_viz as viz
    v = viz.Viewer()
    mesh = v.scene.add_mesh("cloth")
    mesh.set_geometry(vertices, triangles)
    v.run()
"""

from ._avbd_viz import *  # noqa: F401,F403
from ._avbd_viz import imgui  # noqa: F401
