"""rillfacet.sky: procedural sky panoramas."""
import numpy as np
import pytest

torch = pytest.importorskip("torch")

from rillfacet import sky                                    # noqa: E402


def test_shapes_and_range():
    imgs = sky.random_skies(np.random.default_rng(0), 5, height=32, device="cpu")
    assert imgs.shape == (5, 32, 64, 3) and imgs.dtype == torch.float32
    assert float(imgs.min()) >= 0 and bool(torch.isfinite(imgs).all())


def test_same_image_on_every_device():
    if not torch.cuda.is_available():
        pytest.skip("no CUDA")
    p = sky.sample_params(np.random.default_rng(1), 4)
    a = sky.sky_images(p, 32, device="cpu")
    b = sky.sky_images(p, 32, device="cuda").cpu()
    np.testing.assert_allclose(a.numpy(), b.numpy(), rtol=1e-4, atol=1e-4)


def test_sun_where_its_parameters_put_it():
    """The brightest pixel of a cloudless day sky is the sun, at its
    azimuth atan2(x, y) and elevation (the envmap mapping)."""
    p = sky.sample_params(np.random.default_rng(2), 3, palettes={"day": 1.0})
    p["cloud_cover"][:] = 0.0
    p["skyline"][:] = 0
    H, W = 90, 180
    imgs = sky.sky_images(p, H, W, device="cpu").sum(-1)
    for k in range(3):
        r, c = np.unravel_index(int(imgs[k].argmax()), (H, W))
        elev = np.pi / 2 - (r + 0.5) * np.pi / H
        az = (c + 0.5) * 2 * np.pi / W
        assert abs(elev - p["sun_elev"][k]) < 0.05
        assert abs(np.angle(np.exp(1j * (az - p["sun_az"][k])))) < 0.05


def test_ground_below_the_horizon():
    p = sky.sample_params(np.random.default_rng(3), 2)
    imgs = sky.sky_images(p, 64, device="cpu").numpy()
    low = imgs[:, -4:].reshape(2, -1, 3)
    np.testing.assert_allclose(low.mean(1), p["ground"], rtol=0.05)


def test_unknown_palette():
    with pytest.raises(ValueError):
        sky.sample_params(np.random.default_rng(0), 1, palettes={"night": 1.0})
