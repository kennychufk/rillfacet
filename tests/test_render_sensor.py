"""The shared camera sensor stage (rillfacet.render.sensor): gain,
vignetting, shot and read noise, per instance. Pure torch (CPU)."""
import numpy as np
import pytest

torch = pytest.importorskip("torch")

from rillfacet.render import Renderer                  # noqa: E402
from rillfacet.render.sensor import apply, radius2     # noqa: E402
from rillfacet.scene_api import Scene                  # noqa: E402

W, H = 160, 120
K = np.array([[100.0, 0, 70.0], [0, 100.0, 50.0], [0, 0, 1]])  # off-center


def _cam(instances=2, **kw):
    return Scene().camera_sensor("cam", W, H, K, instances=instances, **kw)


def _const(value, instances=2):
    return torch.full((instances, H, W, 3), float(value))


def test_radius2():
    r2 = radius2(K, W, H)
    assert r2.shape == (H, W)
    # the farthest corner from (70, 50) is the bottom-right one
    corner = ((W - 0.5 - 70) ** 2 + (H - 0.5 - 50) ** 2)
    assert float(r2[-1, -1]) == pytest.approx(
        ((W - 1 - 70) ** 2 + (H - 1 - 50) ** 2) / corner, rel=1e-6)
    assert float(r2[50, 70]) == 0.0
    assert float(r2.max()) < 1.0


def test_passthrough_and_gain():
    cam = _cam(gain=[[1, 1, 1], [2, 1, 0.5]])
    out = apply(cam, _const(0.25))
    assert torch.equal(out[0], _const(0.25, 1)[0])
    assert torch.allclose(out[1, ..., 0], torch.tensor(0.5))
    assert torch.allclose(out[1, ..., 2], torch.tensor(0.125))


def test_vignetting():
    cam = _cam(vignetting=[0.0, 0.4])
    out = apply(cam, _const(1.0))
    r2 = radius2(K, W, H)
    assert torch.equal(out[0], _const(1.0, 1)[0])
    assert torch.allclose(out[1], (1 - 0.4 * r2)[..., None].expand(H, W, 3))
    assert float(out[1].min()) > 0.6 - 1e-6           # 1 - v at most


def test_noise_statistics():
    """Mean unchanged, variance shot * x + read^2 (with x after gain)."""
    x, shot, read = 0.25, 0.01, 0.02
    cam = _cam(instances=3, gain=[[1, 1, 1], [1, 1, 1], [2, 2, 2]],
               shot_noise=[0.0, shot, shot], read_noise=[0.0, read, read])
    g = torch.Generator().manual_seed(0)
    out = apply(cam, _const(x, 3), generator=g)
    assert torch.equal(out[0], _const(x, 1)[0])       # no noise: exact
    for i, xi in ((1, x), (2, 2 * x)):
        v = out[i]
        assert float(v.mean()) == pytest.approx(xi, abs=2e-3)
        assert float(v.var()) == pytest.approx(shot * xi + read ** 2,
                                               rel=0.05)
    # channels and pixels are independent
    c = torch.corrcoef(out[1].reshape(-1, 3).T)
    assert float((c - torch.eye(3)).abs().max()) < 0.03


def test_noise_clamped_at_zero():
    cam = _cam(read_noise=0.05)
    out = apply(cam, _const(0.0), generator=torch.Generator().manual_seed(1))
    assert float(out.min()) == 0.0 and float(out.max()) > 0.0


def test_vignetting_then_noise():
    """Shot noise follows the vignetted signal."""
    cam = _cam(instances=1, vignetting=0.9, shot_noise=0.05)
    out = apply(cam, _const(1.0, 1), generator=torch.Generator().manual_seed(2))
    r2 = radius2(K, W, H)
    center, edge = out[0][r2 < 0.05], out[0][r2 > 0.8]
    sig_c = 1 - 0.9 * float(r2[r2 < 0.05].mean())
    sig_e = 1 - 0.9 * float(r2[r2 > 0.8].mean())
    assert float(center.var()) == pytest.approx(0.05 * sig_c, rel=0.15)
    assert float(edge.var()) == pytest.approx(0.05 * sig_e, rel=0.25)


def test_set_lens_and_validation():
    cam = _cam()
    cam.set_lens(vignetting=0.2, shot_noise=[1e-3, 2e-3], read_noise=1e-3)
    assert cam.vignetting.tolist() == pytest.approx([0.2, 0.2])
    assert cam.shot_noise.tolist() == pytest.approx([1e-3, 2e-3])
    _, values = cam.state()
    assert set(values) >= {"vignetting", "shot_noise", "read_noise"}
    with pytest.raises(ValueError):
        cam.set_lens(shot_noise=-1e-3)
    with pytest.raises(ValueError):
        cam.set_lens(vignetting=1.5)
    with pytest.raises(ValueError):
        _cam(read_noise=-0.1)


def test_renderer_sensor_image_is_seeded():
    cam = _cam(shot_noise=0.01, read_noise=0.01, vignetting=0.3)
    a = Renderer(seed=5).sensor_image(cam, _const(0.5))
    b = Renderer(seed=5).sensor_image(cam, _const(0.5))
    c = Renderer(seed=6).sensor_image(cam, _const(0.5))
    assert torch.equal(a, b) and not torch.equal(a, c)
    assert not torch.equal(a[0], a[1])                # per-instance draws
