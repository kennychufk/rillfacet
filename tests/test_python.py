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
    viewer.drag_enabled = False
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
    m.color_source = viz.ColorSource.Quantity
    m.colormap = "turbo"
    assert m.color_source == viz.ColorSource.Quantity
    m.color_quantity = "len"  # naming a quantity must not change color_source
    assert m.color_source == viz.ColorSource.Quantity
    m.color_quantity = "x"
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


def test_segment_queries(v):
    verts, tris = grid(n=4)
    m = v.scene.add_mesh("bodies")
    m.set_geometry(verts, tris)
    half = m.num_faces // 2
    m.set_segments([0, half, m.num_faces], ["a", "b"])
    assert m.num_segments == 2
    assert m.segment_name(1) == "b"
    assert m.segment_of_face(0) == 0 and m.segment_of_face(m.num_faces - 1) == 1
    assert m.segment_of_vertex(0) == 0
    m.set_segment_color(1, (0.1, 0.2, 0.3))
    assert np.allclose(m.segment_color(1), (0.1, 0.2, 0.3), atol=1e-6)
    # app- and user-hidden are independent
    m.set_segment_visible(0, False)
    m.set_segment_hidden_by_user(1, True)
    assert m.segment_hidden_by_app(0) and m.segment_hidden_by_user(1)
    assert not m.segment_visible(0) and not m.segment_visible(1)
    assert m.unhide_all_by_user() == 1
    assert m.segment_visible(1) and not m.segment_visible(0)  # app-hidden stays hidden


def test_measurements_and_anchors(v):
    verts, tris = grid()
    m = v.scene.add_mesh("sheet")
    m.set_geometry(verts, tris)
    a, b = viz.Anchor(), viz.Anchor()
    for anc, idx in ((a, 0), (b, 5)):
        anc.kind = viz.Anchor.Kind.Vertex
        anc.object = m.id
        anc.index = idx
    meas = viz.Measurement()
    meas.anchors = [a, b]
    v.measurements.append(meas)
    assert len(v.measurements) == 1 and len(v.measurements[0].anchors) == 2
    assert v.frame()
    v.measurements.clear()
    assert len(v.measurements) == 0


def test_input_injection_and_pick_kind(v):
    verts, tris = grid(z=0.3)
    m = v.scene.add_mesh("sheet")
    m.set_geometry(verts, tris)
    v.frame_all(False)
    seen = {}

    def cb():
        io = viz.imgui.GetIO()
        seen["ctrl"] = io.KeyCtrl
        seen["clicked"] = viz.imgui.IsMouseClicked(0)
        seen["mouse"] = tuple(v.mouse)

    v.set_callback(cb)
    v.frame()
    io = viz.imgui.GetIO()
    w, h = v.viewport
    x, y, _ = v.camera.project((0.0, 0.0, 0.3), w, h)
    io.AddKeyEvent(viz.imgui.ImGuiMod_Ctrl, True)
    io.AddMousePosEvent(x, y)
    v.frame()
    io.AddMouseButtonEvent(0, True)
    v.frame()
    assert seen["ctrl"] and seen["clicked"]
    assert seen["mouse"] == pytest.approx((x, y), abs=1.5)
    hit = v.pick(x, y)
    assert hit.valid and hit.kind == viz.Anchor.Kind.Surface and hit.object == m.id
    assert hit.surface.object == m.id
    io.AddMouseButtonEvent(0, False)
    io.AddKeyEvent(viz.imgui.ImGuiMod_Ctrl, False)
    v.frame()
    v.set_callback(None)


def test_implot_panel(v):
    def cb():
        if viz.implot.BeginPlot("##h", (-1, 120)):
            viz.implot.SetupAxes("step", None, viz.implot.ImPlotAxisFlags_AutoFit,
                                 viz.implot.ImPlotAxisFlags_AutoFit)
            viz.implot.SetupAxis(viz.implot.ImAxis_Y2, "energy",
                                 viz.implot.ImPlotAxisFlags_AuxDefault
                                 | viz.implot.ImPlotAxisFlags_AutoFit)
            viz.implot.PlotLine("contacts", [1.0, 4.0, 2.0])
            viz.implot.SetAxes(viz.implot.ImAxis_X1, viz.implot.ImAxis_Y2)
            viz.implot.PlotLine("energy", [0.5, 0.25, 0.1])
            viz.implot.EndPlot()
        changed, mode = viz.imgui.RadioButton("A", 1, 0)
        assert not changed and mode == 1

    v.set_callback(cb)
    assert v.frame()
    v.set_callback(None)


def _center(v):
    w, h = v.viewport
    return w / 2, h / 2


def _weighted(verts, d):
    return (np.asarray(verts)[d.vertices] * d.weights[:, None]).sum(0)


def test_drag_phases_and_target(v):
    verts, tris = grid()
    m = v.scene.add_mesh("sheet")
    m.set_geometry(verts, tris)
    v.frame_all(False)
    v.frame()
    assert not v.drag_enabled and not v.begin_drag(*_center(v))

    v.drag_enabled = True
    seen = []
    v.set_callback(lambda: seen.append(v.drag.phase))
    assert v.begin_drag(*_center(v))
    d = v.drag
    assert d.phase == viz.Drag.Phase.Started and d.object == m.id
    assert len(d.vertices) == 3 and abs(d.weights.sum() - 1) < 1e-5
    assert np.allclose(_weighted(verts, d), d.grab_point, atol=1e-4)

    v.frame()  # Started is this frame's
    assert seen[-1] == viz.Drag.Phase.Started and v.drag.phase == viz.Drag.Phase.Started
    x, y = _center(v)
    v.drag_to(x, y - 60)
    v.frame()
    assert seen[-1] == viz.Drag.Phase.Held
    g, t, n = map(np.asarray, (d.grab_point, d.target, d.normal))
    assert np.linalg.norm(t - g) > 0.05 and abs(np.dot(t - g, n)) < 1e-4

    # The grabbed point follows the geometry.
    m.set_positions(verts + [0.0, 0.0, 0.25])
    v.frame()
    assert np.allclose(d.point, g + [0.0, 0.0, 0.25], atol=1e-4)

    v.end_drag()
    v.frame()
    assert seen[-1] == viz.Drag.Phase.Released and v.drag.phase == viz.Drag.Phase.Released
    v.frame()
    assert seen[-1] == viz.Drag.Phase.Idle and not v.drag.active
    v.drag_enabled = False


def test_drag_elements_and_filters(v):
    v.drag_enabled = True
    try:
        verts, tets = cube_tets()
        vol = v.scene.add_volume("cube")
        vol.set_geometry(verts - 0.5, tets)
        v.frame_all(False)
        v.frame()
        assert v.begin_drag(*_center(v))
        d = v.drag
        assert d.object == vol.id and len(d.vertices) == 4
        assert np.allclose(_weighted(verts - 0.5, d), d.grab_point, atol=1e-4)
        assert d.weights.min() > -1e-4  # the hit is inside (on) the tet

        vol.draggable = False
        v.frame()  # a structure that stops being draggable releases
        assert v.drag.phase == viz.Drag.Phase.Released
        v.cancel_drag()
        assert v.drag.phase == viz.Drag.Phase.Idle
        assert not v.begin_drag(*_center(v))

        v.scene.clear()
        nodes = np.array([[-1, 0, 0], [0, 0, 0], [1, 0, 0]], np.float32)
        c = v.scene.add_curves("rope")
        c.set_nodes(nodes)
        c.set_edges(np.array([[0, 1], [1, 2]]))
        c.radius = 0.1
        v.frame_all(False)
        v.frame()
        x, y = _center(v)
        assert v.begin_drag(x + 20, y)
        d = v.drag
        assert len(d.vertices) == 2 and abs(d.weights.sum() - 1) < 1e-5
        v.scene.clear()  # the structure went away: Released, not a dangling drag
        v.frame()
        assert v.drag.phase == viz.Drag.Phase.Released
        v.frame()
        assert v.drag.phase == viz.Drag.Phase.Idle
    finally:
        v.drag_enabled = False


def test_drag_with_mouse(v):
    verts, tris = grid()
    m = v.scene.add_mesh("sheet")
    m.set_geometry(verts, tris)
    v.frame_all(False)
    v.frame()
    io = viz.imgui.GetIO()
    x, y = _center(v)
    v.drag_enabled = True
    v.set_ui_visible(False)  # the panels cover the middle of a small viewport
    # ImGui trickles queued input: one kind of event per frame.
    io.AddMousePosEvent(x, y)
    v.frame()
    io.AddKeyEvent(viz.imgui.ImGuiMod_Ctrl, True)
    v.frame()
    io.AddMouseButtonEvent(0, True)
    v.frame()
    try:
        assert v.drag.phase == viz.Drag.Phase.Started and v.drag.object == m.id
        assert not v.selection.items  # Ctrl+LMB does not select
        io.AddMousePosEvent(x, y - 60)
        v.frame()
        assert v.drag.phase == viz.Drag.Phase.Held
        assert np.linalg.norm(np.subtract(v.drag.target, v.drag.grab_point)) > 0.05
        io.AddMouseButtonEvent(0, False)
        v.frame()
        assert v.drag.phase == viz.Drag.Phase.Released
    finally:
        io.AddMouseButtonEvent(0, False)
        io.AddKeyEvent(viz.imgui.ImGuiMod_Ctrl, False)
        v.frame()
        v.frame()
        v.set_ui_visible(True)
    assert v.drag.phase == viz.Drag.Phase.Idle
