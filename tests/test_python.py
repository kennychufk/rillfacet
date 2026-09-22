"""Headless checks of the avbd_viz Python module (needs a Vulkan GPU).

    PYTHONPATH=python python -m pytest tests -q
"""

import numpy as np
import pytest

import avbd_viz as viz


@pytest.fixture(scope="module")
def viewer():
    return viz.Viewer(headless=True, width=640, height=480)


@pytest.fixture
def v(viewer):
    viewer.scene.clear()
    viewer.selection.clear()
    viewer.set_callback(None)
    viewer.settings.slice.enabled = False
    return viewer


def grid(n=10, z=0.5):
    x, y = np.meshgrid(np.linspace(-1, 1, n), np.linspace(-1, 1, n))
    verts = np.stack([x.ravel(), y.ravel(), np.full(n * n, z)], 1).astype(np.float32)
    tris = []
    for i in range(n - 1):
        for j in range(n - 1):
            a = i * n + j
            tris += [[a, a + 1, a + n + 1], [a, a + n + 1, a + n]]
    return verts, np.array(tris)


def cube_tets():
    verts = np.array([[x, y, z] for x in (0, 1) for y in (0, 1) for z in (0, 1)], np.float32)
    tets = np.array([[0, 4, 6, 7], [0, 4, 5, 7], [0, 1, 5, 7],
                     [0, 1, 3, 7], [0, 2, 3, 7], [0, 2, 6, 7]])
    return verts, tets


def test_mesh_quantities(v):
    verts, tris = grid()
    m = v.scene.add_mesh("sheet")
    m.set_geometry(verts, tris)
    assert (m.num_vertices, m.num_faces) == (100, 162)
    assert m.edges.shape == (m.num_edges, 2)
    m.add_scalar("x", viz.ElementKind.Vertex, verts[:, 0])
    m.add_scalar("len", viz.ElementKind.Edge, np.ones(m.num_edges))
    m.add_vector("n", viz.ElementKind.Face, np.tile([0, 0, 1], (m.num_faces, 1)))
    m.color_quantity = "x"
    m.colormap = "turbo"
    assert m.color_source == viz.ColorSource.Quantity
    assert m.colormap == "turbo"
    assert m.quantity_names == ["x", "len", "n"]
    assert m.quantity("x").data.shape == (100,)
    m.set_positions(verts + [0, 0, 0.1])
    assert m.positions[0, 2] == pytest.approx(0.6)
    with pytest.raises(ValueError):
        m.set_positions(verts[:10])
    assert v.frame()


def test_structures_and_lookup(v):
    c = v.scene.add_curves("rope")
    c.set_polyline([[0, 0, 1], [1, 0, 1], [2, 0, 1]])
    p = v.scene.add_points("pts")
    p.set_points(np.zeros((5, 3)))
    vol = v.scene.add_volume("cube")
    vol.set_geometry(*cube_tets())
    vol.add_scalar("id", viz.ElementKind.Cell, np.arange(6))
    assert (c.num_nodes, c.num_edges, p.size, vol.num_cells) == (3, 2, 5, 6)
    assert isinstance(v.scene.get("cube"), viz.VolumeMesh)
    assert v.scene.get("missing") is None
    v.scene.remove("pts")
    assert v.scene.names == ["rope", "cube"]
    assert v.frame()


def test_pick_and_screenshot(v, tmp_path):
    verts, tris = grid(z=0.3)
    v.scene.add_mesh("sheet").set_geometry(verts, tris)
    v.frame_all(False)
    v.set_ui_visible(False)
    v.frame()
    w, h = v.viewport
    x, y, _ = v.camera.project((0.1, 0.2, 0.3), w, h)
    hit = v.pick(x, y)
    assert hit.valid and hit.object == v.scene.get("sheet").id
    assert np.allclose(hit.point, (0.1, 0.2, 0.3), atol=1e-3)
    path = tmp_path / "shot.png"
    assert v.screenshot(str(path)) and path.stat().st_size > 0
    v.set_ui_visible(True)


def test_callback_and_imgui(v):
    calls = []

    def cb():
        viz.imgui.Begin("Test")
        changed, value = viz.imgui.SliderFloat("x", 0.5, 0.0, 1.0)
        changed, on = viz.imgui.Checkbox("on", True)
        viz.imgui.End()
        v.overlay.text("label", (0, 0, 0))
        calls.append((value, on))

    v.set_callback(cb)
    v.frame()
    assert calls == [(0.5, True)]

    def bad():
        raise RuntimeError("from callback")

    v.set_callback(bad)
    with pytest.raises(RuntimeError, match="from callback"):
        v.frame()
    v.set_callback(None)
    assert v.frame()


def test_slice_and_settings(v):
    vol = v.scene.add_volume("cube")
    vol.set_geometry(*cube_tets())
    s = v.settings
    s.slice.enabled, s.slice.axis, s.slice.offset = True, 0, 0.5
    s.style = viz.Style.Technical
    s.shading = viz.Shading.Wireframe
    assert v.frame()
    s.style = viz.Style.Studio
    s.shading = viz.Shading.Solid


def test_torch_input(v):
    torch = pytest.importorskip("torch")
    verts, tris = grid()
    m = v.scene.add_mesh("sheet")
    m.set_geometry(torch.from_numpy(verts), torch.from_numpy(tris))
    if torch.cuda.is_available():
        m.set_positions(torch.from_numpy(verts).cuda())
    assert m.num_vertices == 100
