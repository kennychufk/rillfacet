"""rillfacet.render.camera: the OpenCV camera model shared by renderers.

    PYTHONPATH=python python -m pytest tests -q
"""

import numpy as np
import pytest

from rillfacet.render.camera import (PixelRays, distort, look_at,
                                     radial_fold, scale_intrinsics, undistort)
from rillfacet.scene_api import compose

#: A Raspberry Pi Camera Module 3 Wide calibration (4608 x 2592, OpenCV
#: rational + thin prism model): strong barrel distortion, ~100 deg hfov.
WIDE_K = np.array([[1955.85657, 0.0, 2311.34803],
                   [0.0, 1955.67366, 1305.57668],
                   [0.0, 0.0, 1.0]])
WIDE_DIST = np.array([-1.36533644, 0.969922653, 1.08871707e-3, -2.14976849e-5,
                      -0.106356684, -1.33222722, 0.887543784, -5.29946910e-2,
                      0, 0, 0, 0, 0, 0])
WIDE_SIZE = (4608, 2592)


def test_undistort_inverts_distort_over_the_wide_image():
    u, v = np.meshgrid(np.linspace(-0.5, WIDE_SIZE[0] - 0.5, 41),
                       np.linspace(-0.5, WIDE_SIZE[1] - 0.5, 23))
    xd = (u - WIDE_K[0, 2]) / WIDE_K[0, 0]
    yd = (v - WIDE_K[1, 2]) / WIDE_K[1, 1]
    x, y, res = undistort(xd, yd, WIDE_DIST)
    # This calibration's radial map folds back just inside the corners
    # (r * radial(r) peaks at ~1.347 < the corners' 1.357): only those
    # have no inverse.
    r_fold = radial_fold(WIDE_DIST)
    assert 1.7 < r_fold < 1.9
    beyond = res * WIDE_K[0, 0] > 0.01
    assert 0 < beyond.sum() <= 8
    assert np.all(np.hypot(xd, yd)[beyond] > 1.33)    # only at the corners
    assert res[~beyond].max() * WIDE_K[0, 0] < 1e-6   # pixels
    assert np.all(np.hypot(x, y) <= r_fold + 1e-9)
    # barrel: off-axis pixels see much further out than a pinhole would
    assert abs(x[0, 1]) > 1.15 * abs(xd[0, 1])


def test_undistort_mild_model_everywhere():
    d = [-0.2, 0.05, 1e-3, -2e-3, -0.01]
    xd, yd = np.meshgrid(np.linspace(-0.8, 0.8, 9), np.linspace(-0.5, 0.5, 7))
    x, y, res = undistort(xd, yd, d)
    assert res.max() < 1e-12


def test_distort_matches_opencv_formula_by_hand():
    d = np.array([0.1, -0.05, 0.001, 0.002, 0.01, 0.02, -0.01, 0.003,
                  1e-3, 2e-3, 3e-3, 4e-3])
    x, y = 0.3, -0.2
    r2 = x * x + y * y
    rad = (1 + d[0] * r2 + d[1] * r2 ** 2 + d[4] * r2 ** 3) / \
          (1 + d[5] * r2 + d[6] * r2 ** 2 + d[7] * r2 ** 3)
    xd = x * rad + 2 * d[2] * x * y + d[3] * (r2 + 2 * x * x) + d[8] * r2 + d[9] * r2 ** 2
    yd = y * rad + d[2] * (r2 + 2 * y * y) + 2 * d[3] * x * y + d[10] * r2 + d[11] * r2 ** 2
    assert np.allclose(distort(np.array(x), np.array(y), d), (xd, yd))


def test_tilt_is_rejected():
    with pytest.raises(NotImplementedError):
        distort(np.zeros(1), np.zeros(1), [0] * 12 + [0.1, 0])


def test_pixel_rays_pinhole_exact():
    torch = pytest.importorskip("torch")
    K = np.array([[100.0, 0, 30.2], [0, 90.0, 20.7], [0, 0, 1]])
    pr = PixelRays(K, 64, 48, device="cpu")
    u = torch.tensor([0.5, 10.25, 63.5])               # from the top-left corner
    v = torch.tensor([0.5, 7.75, 47.5])
    x, y = pr.at(u, v)
    assert np.allclose(x.numpy(), (u.numpy() - 0.5 - 30.2) / 100.0, atol=1e-6)
    assert np.allclose(y.numpy(), (v.numpy() - 0.5 - 20.7) / 90.0, atol=1e-6)


def test_pixel_rays_wide_reproject_to_their_pixels():
    torch = pytest.importorskip("torch")
    W, H = 640, 360
    K = scale_intrinsics(WIDE_K, WIDE_SIZE, (W, H))
    pr = PixelRays(K, W, H, WIDE_DIST, device="cpu")
    assert pr.max_residual < 1e-6
    assert 0 < pr.outside < 1e-3                      # a few corner pixels
    u, v = np.meshgrid(np.arange(W) + 0.5, np.arange(H) + 0.5)
    x, y = pr.at(torch.as_tensor(u), torch.as_tensor(v))
    xd, yd = distort(x.double().numpy(), y.double().numpy(), WIDE_DIST)
    pu = K[0, 0] * xd + K[0, 2]
    pv = K[1, 1] * yd + K[1, 2]
    err = np.hypot(pu - (u - 0.5), pv - (v - 0.5))
    inner = err[8:-8, 8:-8]                           # away from the fold
    assert inner.max() < 0.02                         # bilinear within a pixel
    assert np.median(err) < 1e-3


def test_scale_intrinsics_keeps_projections():
    K2 = scale_intrinsics(WIDE_K, WIDE_SIZE, (640, 360))
    P = np.array([0.2, -0.1, 1.0])
    p1 = (WIDE_K @ P)[:2]
    p2 = (K2 @ P)[:2]
    s = np.array([640 / 4608, 360 / 2592])
    assert np.allclose((p1 + 0.5) * s - 0.5, p2)


def test_look_at_is_an_opencv_frame():
    pose = look_at([1, -1, 1], [0, 0, 0])
    # camera axes in the world: x right, y down, z forward
    def axis(a):
        p = np.concatenate([a, [0, 0, 0, 1.0]])
        return compose(np.concatenate([[0, 0, 0], pose[3:]]), p)[:3]
    z = axis([0, 0, 1.0])
    assert np.allclose(z, -np.array([1, -1, 1]) / np.sqrt(3))
    assert axis([0, 1.0, 0])[2] < 0                    # y points down
    assert abs(axis([1.0, 0, 0])[2]) < 1e-12           # x level


def test_compose_matches_matrices():
    rng = np.random.default_rng(1)

    def rand_pose():
        q = rng.normal(size=4)
        return np.concatenate([rng.normal(size=3), q / np.linalg.norm(q)])

    def mat(p):
        x, y, z, w = p[3:]
        M = np.eye(4)
        M[:3, :3] = [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]
        M[:3, 3] = p[:3]
        return M

    a, b = rand_pose(), rand_pose()
    assert np.allclose(mat(compose(a, b)), mat(a) @ mat(b))
    torch = pytest.importorskip("torch")
    ct = compose(torch.as_tensor(a)[None], torch.as_tensor(b)[None])[0]
    assert np.allclose(ct.numpy(), compose(a, b))
