"""rillfacet: real-time scientific viewer (WebGPU).

    import rillfacet as viz
    v = viz.Viewer()
    mesh = v.scene.add_mesh("cloth")
    mesh.set_geometry(vertices, triangles)
    v.run()
"""

from ._rillfacet import *  # noqa: F401,F403
from ._rillfacet import imgui  # noqa: F401
