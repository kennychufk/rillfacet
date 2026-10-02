"""rillfacet.scene_api: the backend-neutral scene and its native backend.

    PYTHONPATH=python python -m pytest tests -q
"""

import numpy as np
import pytest

import rillfacet as viz
from rillfacet.scene_api import Backend, NativeBackend, Scene, box_mesh, skin


def quat(axis, angle):
    axis = np.asarray(axis, np.float64) / np.linalg.norm(axis)
    return np.concatenate([np.sin(angle / 2) * axis, [np.cos(angle / 2)]])


def two_boxes():
    """Two unit-ish boxes as body-local geometry: body 0 then body 1."""
    v0, t0 = box_mesh([[-0.5, -0.5, -0.5]], [[0.5, 0.5, 0.5]])
    v1, t1 = box_mesh([[-0.2, -0.2, -1.0]], [[0.2, 0.2, 1.0]])
    verts = np.concatenate([v0, v1])
    tris = np.concatenate([t0, t1 + len(v0)])
    body = np.repeat([0, 1], [len(v0), len(v1)])
    return verts, body, tris, np.array([0, len(t0), len(t0) + len(t1)])


class Recorder(Backend):
    def __init__(self):
        self.calls = []

    def create(self, obj):
        self.calls.append(("create", obj.name))

    def update(self, obj, what):
        self.calls.append(("update", obj.name, what))

    def remove(self, name):
        self.calls.append(("remove", name))

    def set_channels(self, channels):
        self.calls.append(("channels", tuple(sorted(channels))))

    def look_at(self, eye, target):
        self.calls.append(("look_at", eye, target))


@pytest.fixture(scope="module")
def viewer():
    return viz.Viewer(headless=True, width=320, height=240)


@pytest.fixture
def v(viewer):
    viewer.scene.clear()
    viewer.set_callback(None)
    return viewer


def test_skin_matches_rotation_matrices():
    rng = np.random.default_rng(0)
    local = rng.normal(size=(20, 3)).astype(np.float32)
    body = rng.integers(0, 3, 20)
    poses = np.zeros((2, 3, 7))
    for k in range(2):
        for b in range(3):
            poses[k, b, :3] = rng.normal(size=3)
            poses[k, b, 3:] = quat(rng.normal(size=3), rng.uniform(0, 6))
    out = skin(local, body, poses)
    for k in range(2):
        for i in range(20):
            x, y, z, w = poses[k, body[i], 3:]
            R = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                          [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                          [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
            assert np.allclose(out[k, i], R @ local[i] + poses[k, body[i], :3], atol=1e-5)


def test_skin_torch_matches_numpy():
    torch = pytest.importorskip("torch")
    rng = np.random.default_rng(1)
    local = rng.normal(size=(10, 3)).astype(np.float32)
    body = rng.integers(0, 2, 10)
    poses = np.zeros((3, 2, 7), np.float32)
    poses[..., :3] = rng.normal(size=(3, 2, 3))
    poses[..., 3:] = quat((0, 0, 1), 0.7)
    ref = skin(local, body, poses)
    got = skin(torch.as_tensor(local), torch.as_tensor(body), torch.as_tensor(poses))
    assert np.allclose(got.numpy(), ref, atol=1e-6)


def test_late_backend_gets_the_whole_scene():
    sc = Scene()
    verts, body, tris, toff = two_boxes()
    sc.rigid_mesh("bodies", verts, body, tris, toff, instances=2)
    sc.labels("names", [[0, 0, 0]], texts=["a"])
    sc.look_at((1, 2, 3), (0, 0, 0))
    sc.set_channels(flux=np.zeros(2))
    rec = Recorder()
    sc.add_backend(rec)
    assert rec.calls == [("create", "bodies"), ("create", "names"),
                         ("look_at", (1.0, 2.0, 3.0), (0.0, 0.0, 0.0)),
                         ("channels", ("flux",))]
    sc.objects["bodies"].set_poses(np.zeros((2, 2, 7)))
    sc.remove("names")
    assert rec.calls[-2:] == [("update", "bodies", "poses"), ("remove", "names")]


def test_labels_need_texts_or_fmt():
    sc = Scene()
    with pytest.raises(ValueError):
        sc.labels("x", [[0, 0, 0]])
    lab = sc.labels("v", [[0, 0, 0], [1, 0, 0]], fmt="{:.2f}")
    lab.set_values([0.5, 1.25])
    assert lab.strings() == ["0.50", "1.25"]


def test_native_rigid_mesh_segments_offsets_and_poses(v):
    sc = Scene(NativeBackend(v))
    verts, body, tris, toff = two_boxes()
    off = np.array([[0, 0, 0], [10, 0, 0]], np.float32)
    rm = sc.rigid_mesh("bodies", verts, body, tris, toff, instances=2, offsets=off,
                       body_names=["base", "rod"], colors=[(1, 0, 0), (0, 0, 1)])
    m = v.scene.get("bodies")
    assert m.num_segments == 4 and m.num_vertices == 2 * len(verts)
    assert np.allclose(m.segment_color(2), (1, 0, 0))
    assert np.allclose(m.segment_color(3), (0, 0, 1))

    poses = np.zeros((2, 2, 7), np.float32)
    poses[..., 6] = 1.0
    poses[1, 1, :3] = (0, 0, 2)
    poses[1, 1, 3:] = quat((1, 0, 0), np.pi / 2)
    rm.set_poses(poses)
    pos = m.positions
    V = len(verts)
    assert np.allclose(pos[:V], verts, atol=1e-6)                      # env 0 at rest
    rod = pos[V:][body == 1]
    assert np.allclose(rod, skin(verts, body, poses)[1][body == 1] + off[1], atol=1e-5)

    # Exact vertices bypass the skinning.
    w = np.full((2 * V, 3), 3.0, np.float32)
    rm.set_poses(poses, world_vertices=w)
    assert np.allclose(m.positions[V:], 3.0 + off[1])

    rm.set_segment_color(1, (0, 1, 0))
    rm.set_segment_visible(3, False)
    assert np.allclose(m.segment_color(1), (0, 1, 0))
    assert not m.segment_visible(3)
    assert v.frame()


def test_native_boxes_points_labels(v):
    sc = Scene(NativeBackend(v))
    bx = sc.boxes("bars", [[0, 0, 0], [2, 0, 0]], [[1, 1, 1], [3, 1, 1]], color=(0.5, 0.5, 0.5))
    m = v.scene.get("bars")
    assert m.num_vertices == 16
    bx.set_boxes([[0, 0, 0], [2, 0, 0]], [[1.5, 1, 1], [3, 1, 1]],
                 colors=[(1, 0, 0), (0, 1, 0)])
    assert m.positions[:, 0].max() == pytest.approx(3.0)
    assert m.color_quantity == "value"
    pts = sc.points("dots", [[0, 0, 0]], (1, 0, 0), 0.1)
    pts.set_points([[0, 0, 0], [1, 1, 1]])
    assert v.scene.get("dots").size == 2
    lab = sc.labels("vals", [[0, 0, 1]], fmt="{:.1f}", world_height=0.1)
    lab.set_values([2.0])
    v.set_callback(sc.draw_overlay)
    assert v.frame()
    sc.remove("dots")
    assert "dots" not in v.scene.names
