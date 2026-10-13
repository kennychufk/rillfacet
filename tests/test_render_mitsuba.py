"""rillfacet.render.mitsuba: batched camera rendering with Mitsuba 3 (CUDA).

    PYTHONPATH=python python -m pytest tests -q

Skipped without mitsuba (pip install rillfacet[mitsuba]) or a CUDA GPU.
"""

import numpy as np
import pytest

torch = pytest.importorskip("torch")
pytest.importorskip("mitsuba")
if not torch.cuda.is_available():
    pytest.skip("needs CUDA", allow_module_level=True)

from rillfacet.render.camera import distort, look_at, scale_intrinsics  # noqa: E402
from rillfacet.render.mitsuba import MitsubaRenderer                    # noqa: E402
from rillfacet.scene_api import Material, Scene, box_mesh               # noqa: E402

from test_render_camera import WIDE_DIST, WIDE_K, WIDE_SIZE             # noqa: E402

IDENTITY = np.array([0, 0, 0, 0, 0, 0, 1.0])


def quad(center, half, z_axis=2):
    """Two triangles of a square facing the camera axis, at ``center``."""
    c = np.asarray(center, np.float32)
    v = np.array([[-1, -1], [1, -1], [1, 1], [-1, 1]], np.float32) * half
    out = np.zeros((4, 3), np.float32)
    axes = [a for a in range(3) if a != z_axis]
    out[:, axes[0]], out[:, axes[1]] = v[:, 0], v[:, 1]
    return out + c, np.array([[0, 1, 2], [0, 2, 3]])


def rigid(scene, name, parts, instances=1, **kw):
    """One body per (vertices, triangles) part."""
    verts, tris, body, off = [], [], [], [0]
    n = 0
    for b, (v, t) in enumerate(parts):
        verts.append(v)
        tris.append(np.asarray(t) + n)
        body.append(np.full(len(v), b))
        off.append(off[-1] + len(t))
        n += len(v)
    return scene.rigid_mesh(name, np.concatenate(verts), np.concatenate(body),
                            np.concatenate(tris), off, instances=instances,
                            **kw)


def setup(instances=1, **kw):
    sc = Scene()
    r = MitsubaRenderer(**kw)
    sc.add_backend(r)
    return sc, r


def centroid(mask):
    ys, xs = torch.nonzero(mask, as_tuple=True)
    return xs.double().mean().item(), ys.double().mean().item()


def test_projection_matches_opencv_with_distortion():
    W, H = 320, 180
    K = scale_intrinsics(WIDE_K, WIDE_SIZE, (W, H))
    sc, r = setup()
    X = np.array([0.5, -0.25, 1.0]) * 2.0           # normalized (0.5, -0.25)
    rigid(sc, "marker", [quad(X, 0.05)])     # ~7 px wide
    rigid(sc, "wall", [quad([0, 0, 4.0], 20.0)])
    sc.camera_sensor("cam", W, H, K, dist=WIDE_DIST, instances=1,
                     local_pose=IDENTITY)
    with pytest.warns(UserWarning, match="fold"):     # a few corner pixels
        seg = r.render("cam", outputs=("segmentation",))["segmentation"][0]
    assert r.segment_labels() == ["marker/body0", "wall/body0"]
    xd, yd = distort(np.array(0.5), np.array(-0.25), WIDE_DIST)
    u, v = K[0, 0] * xd + K[0, 2], K[1, 1] * yd + K[1, 2]
    cu, cv = centroid(seg == 0)
    assert abs(cu - u) < 0.5 and abs(cv - v) < 0.5
    assert (seg == 1).float().mean() > 0.9


def test_depth_is_z_depth_and_far_clips():
    W, H = 64, 48
    K = [[40.0, 0, 31.5], [0, 40.0, 23.5], [0, 0, 1]]
    sc, r = setup()
    rigid(sc, "wall", [quad([0, 0, 2.0], 20.0)])
    sc.camera_sensor("cam", W, H, K, instances=1, dist=[-0.2, 0.05],
                     local_pose=IDENTITY, far=10.0)
    d = r.render("cam", outputs=("depth",))["depth"][0]
    assert torch.allclose(d, torch.full_like(d, 2.0), atol=1e-4)
    sc.camera_sensor("near", W, H, K, instances=1, local_pose=IDENTITY,
                     far=1.5)
    out = r.render("near", outputs=("depth", "segmentation"))
    assert float(out["depth"].abs().max()) == 0.0
    assert int(out["segmentation"].max()) == -1


def two_env_scene(**kw):
    """Two instances: a floor and a cube body each, camera looking down."""
    sc, r = setup(**kw)
    floor = box_mesh([[-1, -1, -0.02]], [[1, 1, 0]])
    cube = box_mesh([[-0.1, -0.1, 0]], [[0.1, 0.1, 0.2]])
    mats = [Material("floor", (0.5, 0.5, 0.5)), Material("cube", (1, 1, 1))]
    m = rigid(sc, "world", [floor, cube], instances=2, materials=mats,
              triangle_material=np.repeat([0, 1], 12))
    K = [[60.0, 0, 31.5], [0, 60.0, 31.5], [0, 0, 1]]
    cam = sc.camera_sensor("cam", 64, 64, K, instances=2,
                           local_pose=look_at([0, 0, 1.5], [0, 0, 0],
                                              up=(0, 1, 0)))
    return sc, r, m, cam


def test_instances_have_their_own_materials_and_world():
    sc, r, m, cam = two_env_scene(spp=4)
    col = m.material_base_color.copy()
    col[0, 1], col[1, 1] = (1, 0, 0), (0, 1, 0)
    m.set_materials(base_color=col)
    out = r.render("cam", outputs=("linear", "segmentation"))
    lin, seg = out["linear"], out["segmentation"]
    for k, ch in ((0, 0), (1, 1)):
        px = lin[k][seg[k] == 1].mean(0)
        assert px[ch] > 3 * px[1 - ch] and px[ch] > 3 * px[2]
    # each env sees one cube (its own) at the center
    for k in range(2):
        assert seg[k, 32, 32] == 1
        assert (seg[k] == 1).sum() < 0.15 * 64 * 64


def test_poses_visibility_and_mounted_camera():
    sc, r, m, cam = two_env_scene()
    poses = torch.zeros(2, 2, 7, device="cuda")
    poses[..., 6] = 1
    poses[1, 1, 0] = 0.4                            # env 1's cube moves +x
    m.set_poses(poses)
    seg = r.render("cam", outputs=("segmentation",))["segmentation"]
    c0, c1 = centroid(seg[0] == 1), centroid(seg[1] == 1)
    # looking down with image-up = +y: +x is image-right; z-up top at 1.3 m
    assert c1[0] - c0[0] == pytest.approx(60.0 * 0.4 / 1.3, abs=1.5)
    m.set_segment_visible(1, False)                 # env 0's cube
    seg = r.render("cam", outputs=("segmentation",))["segmentation"]
    assert not bool((seg[0] == 1).any()) and bool((seg[1] == 1).any())
    # a camera mounted on the cube: moves with it, looks down at the floor
    sc.camera_sensor("on_cube", 32, 32, [[20, 0, 15.5], [0, 20, 15.5], [0, 0, 1]],
                     mount="world", body=1,
                     local_pose=np.concatenate([[0, 0, 0.5],
                                                look_at([0, 0, 0], [0, 0, -1],
                                                        up=(0, 1, 0))[3:]]))
    d = r.render("on_cube", outputs=("depth",))["depth"]
    # env 0: its cube is hidden, the floor is 0.5 below; env 1: its own
    # cube's top (0.2 high) is below the camera
    assert torch.allclose(d[:, 16, 16], torch.tensor([0.5, 0.3], device="cuda"),
                          atol=1e-4)


def test_texture_orientation():
    pytest.importorskip("PIL")
    sc, r = setup(spp=4, integrator={"type": "direct"})
    tex = np.zeros((8, 8, 3), np.uint8)
    tex[:, :4] = (255, 0, 0)                         # left half red
    tex[:4, 4:] = (0, 0, 255)                        # top-right blue
    tex[4:, 4:] = (0, 255, 0)                        # bottom-right green
    v, t = quad([0, 0, 1.0], 0.5)
    uv = (v[:, :2] + 0.5)                            # image x right, y down
    sc.rigid_mesh("card", v, np.zeros(4, int), t, [0, 2],
                  uvs=uv, materials=[Material("tex", (1, 1, 1),
                                              base_color_texture=tex)])
    sc.light("sky", "ambient", intensity=1.0)
    sc.camera_sensor("cam", 40, 40, [[40, 0, 19.5], [0, 40, 19.5], [0, 0, 1]],
                     instances=1, local_pose=IDENTITY)
    rgb = r.render("cam")["rgb"][0]
    left, tr, br = rgb[20, 12], rgb[12, 28], rgb[28, 28]
    assert left.argmax() == 0 and tr.argmax() == 2 and br.argmax() == 1


def edge_width(row):
    """Pixels over which a dark-to-bright edge rises from 10% to 90%."""
    row = (row - row.min()) / (row.max() - row.min())
    return int(((row > 0.1) & (row < 0.9)).sum())


def test_depth_of_field_blurs_out_of_focus():
    sc, r = setup(spp=256, integrator={"type": "direct"})
    rigid(sc, "edge", [quad([-0.5, 0, 2.0], 0.5), quad([0.5, 0, 2.0], 0.5)],
          instances=2, colors=[(0.02, 0.02, 0.02), (0.9, 0.9, 0.9)])
    sc.light("sky", "ambient", intensity=1.0)
    K = [[100, 0, 31.5], [0, 100, 7.5], [0, 0, 1]]
    cam = sc.camera_sensor("cam", 64, 16, K, instances=2,
                           local_pose=IDENTITY, aperture_radius=[0.0, 0.03],
                           focus_distance=[2.0, 0.5])
    rgb = r.render("cam")["rgb"].mean(-1)            # [2, 16, 64]
    sharp, blurred = edge_width(rgb[0, 8]), edge_width(rgb[1, 8])
    assert sharp <= 2 and blurred >= 6
    cam.set_lens(focus_distance=2.0)                 # now in focus
    rgb = r.render("cam")["rgb"].mean(-1)
    assert edge_width(rgb[1, 8]) <= 2


def test_gain_and_chunking():
    sc, r = setup(spp=16, integrator={"type": "direct"}, seed=3)
    rigid(sc, "wall", [quad([0, 0, 2.0], 20.0)], instances=3,
          colors=[(0.5, 0.5, 0.5)])
    sc.light("sky", "ambient", intensity=0.5)
    cam = sc.camera_sensor("cam", 32, 24, [[30, 0, 15.5], [0, 30, 11.5], [0, 0, 1]],
                           instances=3, local_pose=IDENTITY,
                           gain=[[1, 1, 1], [2, 1, 1], [1, 1, 1]])
    lin = r.render("cam", outputs=("linear",))["linear"].mean((1, 2)).cpu()
    assert (lin[1, 0] / lin[0, 0]).item() == pytest.approx(2.0, rel=0.02)
    assert (lin[1, 1] / lin[0, 1]).item() == pytest.approx(1.0, rel=0.02)
    whole = r.render("cam", outputs=("depth", "segmentation"))
    r.max_samples = 32 * 24                          # one env per chunk
    parts = r.render("cam", outputs=("depth", "segmentation"))
    assert torch.equal(whole["segmentation"], parts["segmentation"])
    assert torch.allclose(whole["depth"], parts["depth"])
    assert cam.instances == 3


def test_instance_counts_must_match():
    sc, r = setup()
    rigid(sc, "wall", [quad([0, 0, 2.0], 1.0)])
    sc.camera_sensor("cam", 8, 8, np.eye(3), instances=2)
    with pytest.raises(ValueError, match="instances"):
        r.render("cam")


def test_far_must_fit_the_env_spacing():
    sc, r = setup(env_spacing=5.0)
    rigid(sc, "wall", [quad([0, 0, 2.0], 1.0)])
    sc.camera_sensor("cam", 8, 8, np.eye(3), instances=1, far=10.0)
    with pytest.raises(ValueError, match="env_spacing"):
        r.render("cam")
