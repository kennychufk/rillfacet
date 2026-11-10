"""rillfacet.uv_texture (the spec and its torch reference), metric UVs
(rillfacet.assets.metric_uvs), primitive meshes (rillfacet.primitives) and
the scene API's UV-texture slots.

    PYTHONPATH=python python -m pytest tests -q
"""
import warnings

import numpy as np
import pytest

torch = pytest.importorskip("torch")

from rillfacet import primitives as pr                                  # noqa: E402
from rillfacet import solid_texture as sx                               # noqa: E402
from rillfacet import uv_texture as ut                                  # noqa: E402
from rillfacet.assets import MeshAsset, merge_bodies, metric_uvs        # noqa: E402
from rillfacet.scene_api import Material, Scene                         # noqa: E402


def test_metric_uvs_scale_to_meters_and_keep_missing_ones():
    v = np.array([[0, 0, 0], [0.2, 0, 0], [0.2, 0.1, 0], [0, 0.1, 0]], float)
    t = np.array([[0, 1, 2], [0, 2, 3]])
    uv = v[:, :2] * 3.7                            # any uniform scale
    m = metric_uvs(v, t, uv)
    assert np.allclose(m, v[:, :2], atol=1e-6)
    uv[3] = np.nan                                 # one triangle loses its UVs
    m = metric_uvs(v, t, uv)
    assert np.isnan(m[3]).all() and np.allclose(m[:3], v[:3, :2], atol=1e-6)
    assert np.isnan(metric_uvs(v, t, np.full((4, 2), np.nan))).all()


@pytest.mark.parametrize("make, ratio", [
    (lambda: pr.box((1.2, 0.81, 0.95)), 1.0),
    (lambda: pr.cylinder(0.05, 0.2), 1.0),
    # a lat-long sphere's u is the arc length at the equator: the UV area
    # overestimates the surface by pi / 2 (less on a coarse mesh)
    (lambda: pr.sphere(0.1), 2 / np.pi)])
def test_primitives_face_outward_with_metric_uvs(make, ratio):
    a = make()
    p = a.vertices[a.triangles].astype(np.float64)
    fn = np.cross(p[:, 1] - p[:, 0], p[:, 2] - p[:, 0])
    assert (np.einsum("ij,ij->i", fn, p.mean(1)) > 0).all()
    assert (np.einsum("ij,ij->i", fn, a.normals[a.triangles].mean(1)) > 0).all()
    u = a.metric_uvs[a.triangles].astype(np.float64)
    d = u[:, 1:] - u[:, :1]
    au = 0.5 * np.abs(d[:, 0, 0] * d[:, 1, 1] - d[:, 0, 1] * d[:, 1, 0])
    assert 0.5 * np.linalg.norm(fn, axis=1).sum() / au.sum() == pytest.approx(
        ratio, rel=0.05)


def test_merge_bodies_and_slot_has_uvs():
    hull = MeshAsset(np.eye(3, dtype=np.float32), np.array([[0, 1, 2]]),
                     materials=[Material("hull")])
    box = pr.box((0.1, 0.2, 0.3), material=Material("box", uv_texture=True))
    g = merge_bodies([hull, box])
    assert np.isnan(g["metric_uvs"][:3]).all()
    assert np.isfinite(g["metric_uvs"][3:]).all()
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        m = Scene().rigid_mesh("m", instances=2, **g)
    assert m.slot_has_uvs.tolist() == [False, True]
    assert m.material_uv_texture.shape == (2, 2, ut.K)
    assert (m.material_uv_texture[..., 0] == 0).all()           # none
    g["materials"] = [Material("hull", uv_texture=True), g["materials"][1]]
    with pytest.warns(UserWarning, match="without UVs"):
        Scene().rigid_mesh("m", **g)


def test_rigid_mesh_derives_metric_uvs_per_body():
    a, b = pr.box((0.1, 0.1, 0.1)), pr.box((0.4, 0.4, 0.4))
    g = merge_bodies([a, b])
    raw = np.concatenate([a.uvs, b.uvs])           # per-asset normalized
    g.pop("metric_uvs")
    m = Scene().rigid_mesh("m", **dict(g, uvs=raw))
    assert np.allclose(m.metric_uvs, np.concatenate(
        [a.metric_uvs, b.metric_uvs]), atol=1e-6)


def test_render_rows_pick_uv_then_solid_then_plain():
    mats = [Material("plain"), Material("solid", solid_texture=True),
            Material("uv", uv_texture=True),
            Material("both", solid_texture=True, uv_texture=True)]
    g = merge_bodies([MeshAsset(
        np.eye(3, dtype=np.float32), np.array([[0, 1, 2]] * 4),
        triangle_material=np.arange(4), materials=mats)])
    m = Scene().rigid_mesh("m", instances=2, **g)
    rng = np.random.default_rng(0)
    m.set_materials(base_color=rng.uniform(0, 1, (2, 4, 3)),
                    roughness=rng.uniform(0, 1, (2, 4)))
    srows = sx.sample_params(rng, (2, 4))
    urows = ut.sample_params(rng, (2, 4))
    urows[1, 3, ut.PARAM["family"]] = 0             # env 1: "both" -> solid
    m.set_materials(solid_texture=srows, uv_texture=urows)
    slots, rows = ut.render_rows(m)
    assert slots == [1, 2, 3]
    fam = rows[..., 0]
    assert np.allclose(fam[:, 0], srows[:, 1, 0])              # solid
    assert np.allclose(fam[:, 1], urows[:, 2, 0] + ut.RENDER_FAMILY_OFFSET)
    assert fam[0, 2] == urows[0, 3, 0] + ut.RENDER_FAMILY_OFFSET
    assert fam[1, 2] == srows[1, 3, 0]
    # a UV-only slot with a "none" row: plain, in the env's color / roughness
    urows[:, 2, ut.PARAM["family"]] = 0
    m.set_materials(uv_texture=urows)
    _, rows = ut.render_rows(m)
    k = sx.PARAM["c0"]
    assert (rows[:, 1, 0] == 0).all()
    assert np.allclose(rows[:, 1, k:k + 3],
                       sx.linearize(np.pad(m.material_base_color[:, 2],
                                           ((0, 0), (14, 15))))[:, 14:17])
    assert np.allclose(rows[:, 1, sx.PARAM["rough0"]], m.material_roughness[:, 2])


def test_sample_params_families_and_stream():
    rng = np.random.default_rng(0)
    rows = ut.sample_params(rng, (3, 400), families=("decal", "weave"))
    fam = {ut.FAMILIES[int(f)] for f in rows[..., 0].ravel()}
    assert fam == {"decals", "glyphs", "stickers", "weave"}
    assert np.isfinite(rows).all()
    # a row's draws do not depend on its family: the same row, re-labeled
    a = ut.sample_params(np.random.default_rng(1), 50, families=("stripes",))
    b = ut.sample_params(np.random.default_rng(1), 50, families=("tiles",))
    k = ut.PARAM["offset"]
    assert np.array_equal(a[:, k:k + 5], b[:, k:k + 5])
    with pytest.raises(ValueError):
        ut.families_of(["nope"])


def test_families_cover_both_colors_and_heights():
    """Every family draws a pattern (heights in 0..1, not a constant)."""
    rng = np.random.default_rng(2)
    uv = torch.as_tensor(rng.uniform(0, 0.5, (20000, 2)), dtype=torch.float32)
    for f in ut.FAMILIES[1:]:
        row = torch.as_tensor(ut.sample_params(rng, 1, families=(f,),
                                               scale=(20, 20))[0])
        h, c = ut.evaluate(uv, row.expand(len(uv), ut.K))
        assert float(h.min()) >= 0 and float(h.max()) <= 1, f
        assert float(h.std()) > 0.02, f
        assert torch.isfinite(c).all(), f


def test_filter_fades_to_the_mean():
    """At a footprint far above every detail, each family is about
    constant, and its value is about the unfiltered pattern's mean."""
    rng = np.random.default_rng(3)
    uv = torch.as_tensor(rng.uniform(0, 2.0, (40000, 2)), dtype=torch.float32)
    for f in ut.FAMILIES[1:]:
        row = ut.sample_params(rng, 1, families=(f,), scale=(40, 40))[0]
        rows = torch.as_tensor(row).expand(len(uv), ut.K)
        _, c0 = ut.evaluate(uv, rows)
        _, c1 = ut.evaluate(uv, rows, footprint=4.0 / 40 * ut.SCALE_FACTOR[f])
        assert float(c1.std(0).max()) < 0.02, f
        if f != "brushed":            # its fBm's mean is 0 only on average
            assert float((c1.mean(0) - c0.mean(0)).abs().max()) < 0.06, f


def test_uv_gradients():
    """u, v linear on a triangle: its surface gradients reproduce the UVs'
    change along any in-plane direction; the edge basis carries over."""
    rng = np.random.default_rng(4)
    p = rng.normal(size=(3, 3))
    A = rng.normal(size=(2, 3))
    uv = p @ A.T
    gu, gv = ut.uv_gradients(p, np.array([[0, 1, 2]]), uv)
    gu_e, gv_e = ut.uv_gradients(p, np.array([[0, 1, 2]]), uv, edge_basis=True)
    e1, e2 = p[1] - p[0], p[2] - p[0]
    for g, ge, c in ((gu, gu_e, 0), (gv, gv_e, 1)):
        for e, k in ((e1, 1), (e2, 2)):
            assert float(g[0] @ e) == pytest.approx(uv[k, c] - uv[0, c],
                                                    rel=1e-4, abs=1e-5)
        assert np.allclose(ge[0, 0] * e1 + ge[0, 1] * e2, g[0], atol=1e-5)
