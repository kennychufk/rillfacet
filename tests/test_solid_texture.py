"""rillfacet.solid_texture (procedural solid / 3D textures): parameter
rows, the sampler, the torch reference, and solid-texture materials in the
scene API.

    PYTHONPATH=python python -m pytest tests -q
"""

import numpy as np
import pytest

from rillfacet import solid_texture as sx
from rillfacet.render import srgb_to_linear
from rillfacet.scene_api import Material, Scene, box_mesh


def test_make_params_layout():
    row = sx.make_params("wood", colors=((1, 0, 0), (0, 1, 0)), scale=7.0,
                         rotation=(0, 0, np.sin(0.5), np.cos(0.5)),
                         offset=(1, 2, 3), roughness=(0.2, 0.6), bump=1e-3)
    P = sx.PARAM
    assert row.shape == (sx.K,) and row[P["family"]] == 1
    assert row[P["scale"]] == 7.0
    assert np.allclose(row[P["offset"]:P["offset"] + 3], (1, 2, 3))
    R = row[P["R"]:P["R"] + 9].reshape(3, 3)
    assert np.allclose(R @ R.T, np.eye(3), atol=1e-6)
    assert np.allclose(R[:2, :2], [[np.cos(1), -np.sin(1)],
                                   [np.sin(1), np.cos(1)]], atol=1e-6)
    assert np.allclose(row[P["c1"]:P["c1"] + 3], (0, 1, 0))
    assert np.allclose(row[P["c2"]:P["c2"] + 3], (0, 1, 0))   # repeats c1
    assert np.allclose(row[P["a"]:P["a"] + 4], sx.DEFAULT_KNOBS["wood"])
    assert np.allclose(row[[P["rough0"], P["rough1"], P["bump"]]],
                       (0.2, 0.6, 1e-3))
    with pytest.raises(ValueError):
        sx.make_params("velvet")


def test_sample_params():
    a = sx.sample_params(np.random.default_rng(1), (6, 5))
    b = sx.sample_params(np.random.default_rng(1), (6, 5))
    assert a.shape == (6, 5, sx.K) and np.array_equal(a, b)
    rows = sx.sample_params(np.random.default_rng(2), 4000,
                            families=("wood", "checker"), bump=(1e-3, 2e-3))
    P = sx.PARAM
    assert set(np.unique(rows[:, P["family"]])) == {1, 5}
    R = rows[:, P["R"]:P["R"] + 9].reshape(-1, 3, 3)
    assert np.allclose(R @ R.transpose(0, 2, 1), np.eye(3), atol=1e-5)
    assert np.allclose(np.linalg.det(R), 1, atol=1e-5)
    cols = rows[:, P["c0"]:P["c2"] + 3]
    assert cols.min() >= 0 and cols.max() <= 1
    s = rows[:, P["scale"]]
    assert 4 <= s.min() and s.max() <= 25
    assert (rows[:, P["bump"]] >= 1e-3).all()


def test_linearize_converts_only_colors():
    rows = sx.sample_params(np.random.default_rng(3), 50)
    lin = sx.linearize(rows)
    for name in ("c0", "c1", "c2"):
        k = sx.PARAM[name]
        assert np.allclose(lin[:, k:k + 3], srgb_to_linear(rows[:, k:k + 3]),
                           atol=1e-6)
    keep = np.setdiff1d(np.arange(sx.K), np.arange(sx.PARAM["c0"],
                                                   sx.PARAM["c2"] + 3))
    assert np.array_equal(lin[:, keep], rows[:, keep])


def _pcg3d_numpy(x, y, z):
    x, y, z = (np.asarray(v, np.uint32) for v in (x, y, z))
    with np.errstate(over="ignore"):
        x = x * np.uint32(1664525) + np.uint32(1013904223)
        y = y * np.uint32(1664525) + np.uint32(1013904223)
        z = z * np.uint32(1664525) + np.uint32(1013904223)
        x += y * z; y += z * x; z += x * y        # noqa: E702
        x ^= x >> 16; y ^= y >> 16; z ^= z >> 16  # noqa: E702
        x += y * z; y += z * x; z += x * y        # noqa: E702
    return x, y, z


def test_torch_hash_is_uint32_pcg3d():
    torch = pytest.importorskip("torch")
    rng = np.random.default_rng(4)
    v = rng.integers(0, 2 ** 32, (3, 10000), dtype=np.uint64)
    o = sx.TorchOps(torch)
    got = sx.pcg3d(o, *(torch.as_tensor(a.astype(np.int64)) for a in v))
    for g, w in zip(got, _pcg3d_numpy(*v)):
        assert np.array_equal(g.numpy().astype(np.uint32), w)


def test_reference_families():
    torch = pytest.importorskip("torch")
    rng = np.random.default_rng(5)
    n = 4096
    pts = torch.as_tensor(rng.uniform(-0.2, 0.2, (n, 3)), dtype=torch.float32)
    # plain: c0 everywhere; checker: alternating unit cells
    rows = np.stack([sx.make_params("plain", colors=((0.2, 0.4, 0.6),)),
                     sx.make_params("checker", colors=((1, 1, 1), (0, 0, 0)),
                                    scale=10.0)])
    idx = rng.integers(0, 2, n)
    h, rgb = sx.evaluate(pts, torch.as_tensor(rows[idx]))
    lin = srgb_to_linear(np.array([0.2, 0.4, 0.6]))
    plain = idx == 0
    assert np.allclose(rgb.numpy()[plain], lin, atol=1e-6)
    cell = np.floor(10 * pts.numpy()[~plain]).sum(1) % 2
    assert np.array_equal(h.numpy()[~plain], cell)
    assert np.allclose(rgb.numpy()[~plain], (1 - cell)[:, None])
    # every family: h in 0..1, colors finite and in range, varies in space
    for f in sx.FAMILIES[1:]:
        rows = sx.sample_params(rng, n, families=(f,))
        h, rgb = sx.evaluate(pts, torch.as_tensor(rows))
        assert torch.isfinite(rgb).all() and 0 <= h.min() and h.max() <= 1
        assert -1e-6 <= rgb.min() and rgb.max() <= 1 + 1e-6
        assert h.std() > 0.05, f


def test_filtering_fades_to_the_mean():
    """A footprint far above every feature leaves each family's spatial
    mean; a tiny one changes (almost) nothing."""
    torch = pytest.importorskip("torch")
    rng = np.random.default_rng(6)
    n = 200000
    pts = torch.as_tensor(rng.uniform(-2, 2, (n, 3)), dtype=torch.float32)
    for f in sx.FAMILIES[1:]:
        rows = torch.as_tensor(sx.sample_params(rng, 1, families=(f,))
                               ).expand(n, sx.K)
        h, rgb = sx.evaluate(pts, rows)
        hf, cf = sx.evaluate(pts[:1000], rows[:1000], footprint=2.0)
        assert float(hf.std()) < 1e-3 and float(cf.std(0).max()) < 1e-3, f
        assert abs(float(hf.mean() - h.mean())) < 0.01, f
        assert float((cf.mean(0) - rgb.mean(0)).abs().max()) < 0.015, f
        hs, cs = sx.evaluate(pts[:20000], rows[:20000], footprint=1e-5)
        far = ((cs - rgb[:20000]).abs().max(-1).values > 1e-3).float().mean()
        assert float(far) < 0.01, f                      # checker edges


def scene_with(materials, instances=2):
    sc = Scene()
    v, t = box_mesh([[0, 0, 0], [1, 0, 0]], [[0.5, 0.5, 0.5], [1.5, 0.5, 0.5]])
    rm = sc.rigid_mesh("b", v, np.repeat([0, 1], 8), t, [0, 12, 24],
                       instances=instances, materials=materials,
                       triangle_material=np.repeat([0, len(materials) - 1], 12))
    return sc, rm


def test_solid_texture_materials_in_the_scene_api():
    with pytest.raises(ValueError):
        Material("m", solid_texture=True, base_color_texture="t.png")
    with pytest.raises(ValueError):
        Material("m", bump=True)
    _, rm = scene_with([Material("a"), Material("b")])
    assert rm.material_solid_texture is None
    with pytest.raises(ValueError):
        rm.set_materials(solid_texture=sx.make_params("wood"))
    _, rm = scene_with([Material("a", (1, 0, 0), roughness=0.3),
                        Material("w", (0, 0, 1), solid_texture=True, bump=True)])
    mp = rm.material_solid_texture
    assert mp.shape == (2, 2, sx.K)
    P = sx.PARAM
    # default rows: plain, the material's color and roughness
    assert (mp[..., P["family"]] == 0).all()
    assert np.allclose(mp[:, 1, P["c0"]:P["c0"] + 3], (0, 0, 1))
    assert np.allclose(mp[:, 0, [P["rough0"], P["rough1"]]], 0.3)
    rm.set_materials(solid_texture=sx.make_params("wood"))      # broadcast
    assert (rm.material_solid_texture[..., P["family"]] == 1).all()
    rows = sx.sample_params(np.random.default_rng(0), (2, 2))
    rm.set_materials(solid_texture=rows)
    assert np.array_equal(rm.material_solid_texture, rows)
    attrs, arrays = rm.state()
    assert attrs["materials"][1]["solid_texture"] and attrs["materials"][1]["bump"]
    assert np.array_equal(arrays["material_solid_texture"], rows)
    assert "solid texture + bump" in repr(rm.materials[1])
