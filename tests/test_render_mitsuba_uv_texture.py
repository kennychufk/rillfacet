"""Procedural UV (2D) textures in rillfacet.render.mitsuba.

    PYTHONPATH=python python -m pytest tests -q

Skipped without mitsuba (pip install rillfacet[mitsuba]) or a CUDA GPU.
"""

import gc

import numpy as np
import pytest

torch = pytest.importorskip("torch")
pytest.importorskip("mitsuba")
if not torch.cuda.is_available():
    pytest.skip("needs CUDA", allow_module_level=True)

from rillfacet import primitives as pr                                  # noqa: E402
from rillfacet import solid_texture as sx                               # noqa: E402
from rillfacet import uv_texture as ut                                  # noqa: E402
from rillfacet.assets import merge_bodies                               # noqa: E402
from rillfacet.render.camera import look_at                             # noqa: E402
from rillfacet.render.mitsuba import MitsubaRenderer, _qrot             # noqa: E402
from rillfacet.scene_api import Material, Scene                         # noqa: E402

K128 = [[160.0, 0, 63.5], [0, 160.0, 63.5], [0, 0, 1]]
VIEW = look_at([0.5, -0.6, 0.6], [0, 0, 0.08])


def primitives_scene(kind, instances=2, bump=False, mount=False, light=None,
                     **kw):
    """A floor (ordinary material), a box, a sphere and a cylinder (slots
    1..3: UV-texture slots, ``kind="uv"``, or ordinary ones) per env."""
    r = MitsubaRenderer(**kw)
    sc = Scene(r)
    uv = kind == "uv"
    mats = [Material("floor", (0.5, 0.5, 0.5))] + [
        Material(n, uv_texture=uv, solid_texture=uv and n == "c",
                 bump=bump and uv) for n in ("a", "b", "c")]
    assets = [pr.box((0.8, 0.8, 0.02), material=mats[0]),
              pr.box((0.2, 0.2, 0.2), material=mats[1]),
              pr.sphere(0.1, material=mats[2]),
              pr.cylinder(0.06, 0.2, material=mats[3])]
    m = sc.rigid_mesh("prims", instances=instances, **merge_bodies(assets))
    poses = np.zeros((instances, 4, 7), np.float32)
    poses[..., 6] = 1
    poses[:, :, :3] = [[0, 0, -0.01], [-0.15, -0.1, 0.1], [0.15, -0.1, 0.1],
                       [0, 0.17, 0.1]]
    m.set_poses(poses)
    if light is not None:
        sc.light("sun", "directional", direction=light, intensity=3.0)
    if mount:
        sc.camera_sensor("cam", 128, 128, K128, mount=m, body=0,
                         local_pose=VIEW)
    else:
        sc.camera_sensor("cam", 128, 128, K128, instances=instances,
                         local_pose=VIEW)
    return sc, r, m


def test_dr_jit_families_match_the_reference():
    """The Mitsuba plugin evaluates the same functions as the torch
    reference (ut.evaluate), every family, random rows and UVs."""
    from rillfacet.render._mitsuba_solid_texture import plugins
    r = MitsubaRenderer()
    mi = r.mi
    State, _, _ = plugins(mi)
    rng = np.random.default_rng(0)
    n = 1 << 16
    rows = ut.sample_params(rng, n)
    uv = rng.uniform(-0.3, 0.3, (n, 2)).astype(np.float32)
    lin = sx.linearize(rows)
    lin[:, ut.PARAM["family"]] += ut.RENDER_FAMILY_OFFSET
    st = State(1, [0], 1, uv=True)
    st.set_params(lin[:, None])
    z = mi.Float(np.zeros(n, np.float32))
    h, c = st.pattern((z, z, z), mi.UInt32(np.arange(n, dtype=np.uint32)),
                      True, (mi.Float(uv[:, 0]), mi.Float(uv[:, 1])))
    got = torch.stack([h.torch()] + [x.torch() for x in c], -1)
    hr, cr = ut.evaluate(torch.as_tensor(uv, device="cuda"),
                         torch.as_tensor(rows, device="cuda"))
    err = (got - torch.cat([hr[:, None], cr], -1)).abs().max(-1).values
    fam = torch.as_tensor(rows[:, ut.PARAM["family"]], device="cuda")
    for f, name in enumerate(ut.FAMILIES[1:], 1):
        e = err[fam == f]
        assert len(e), name
        # hexagons: rare ties between the two lattices
        assert float((e > 1e-3).float().mean()) < 1e-3, name
        assert float(e.median()) < 1e-5, name


def test_none_rows_render_like_ordinary_materials():
    """UV-texture slots whose rows are all ``none`` render the image of
    ordinary materials (per-env colors, roughness, metallic); with the
    solid-texture slot's plain rows, too."""
    rng = np.random.default_rng(1)
    col = rng.uniform(0, 1, (2, 4, 3))
    rough = rng.uniform(0.1, 1, (2, 4))
    metal = rng.uniform(0, 1, (2, 4))
    imgs = []
    for kind in ("plain", "uv"):
        sc, r, m = primitives_scene(kind, spp=4, integrator={"type": "direct"})
        m.set_materials(base_color=col, roughness=rough, metallic=metal)
        if kind == "uv":
            m.set_materials(solid_texture=np.stack([[
                sx.make_params("plain", colors=(col[e, s],),
                               roughness=rough[e, s]) for s in range(4)]
                for e in range(2)]))
        imgs.append(r.render("cam", outputs=("linear",))["linear"])
    a, b = imgs
    assert float((a - b).abs().mean()) < 1e-4
    assert float((a - b).abs().max()) < 2e-2


def test_texture_sticks_to_the_body():
    """Bodies, the mounted camera and the sun moved by one rigid motion
    (bumped UV textures): the image does not change."""
    q = np.array([0.2, -0.1, 0.3, 0.9])
    q /= np.linalg.norm(q)
    t = np.array([0.3, -0.2, 0.1])
    qt = torch.as_tensor(q, dtype=torch.float32)

    def rot(v):
        v = torch.as_tensor(v, dtype=torch.float32)
        return _qrot(qt.expand(v.shape[:-1] + (4,)), v).numpy()
    sun = np.array([-0.3, -0.2, -1.0])
    rows = ut.sample_params(np.random.default_rng(2), (2, 4),
                            bump=(0.001, 0.003))
    imgs = []
    for moved in (False, True):
        sc, r, m = primitives_scene("uv", bump=True, mount=True, spp=4,
                                    light=rot(sun) if moved else sun,
                                    integrator={"type": "direct"})
        poses = np.array(m.poses)
        if moved:
            p0 = poses[..., :3].copy()
            poses[..., :3] = rot(p0) + t
            poses[..., 3:] = q          # identity body rotations before
        m.set_poses(poses)
        m.set_materials(uv_texture=rows)
        imgs.append(r.render("cam", outputs=("linear", "segmentation")))
    a, b = (x["linear"] for x in imgs)
    prims = imgs[0]["segmentation"] >= 1
    assert torch.equal(prims, imgs[1]["segmentation"] >= 1)
    assert float(a[prims].std(0).mean()) > 0.03      # textured, lit
    assert float((a - b).abs().mean()) < 2e-3
    assert float(((a - b).abs().amax(-1) > 0.05).float().mean()) < 5e-3


def test_new_parameters_do_not_recompile():
    import drjit as dr
    gc.collect()                    # see the solid-texture test
    sc, r, m = primitives_scene("uv", bump=True, spp=2,
                                integrator={"type": "direct"})
    rng = np.random.default_rng(3)
    m.set_materials(uv_texture=ut.sample_params(rng, (2, 4)),
                    solid_texture=sx.sample_params(rng, (2, 4)))
    r.render("cam")
    dr.set_flag(dr.JitFlag.KernelHistory, True)
    try:
        dr.kernel_history()                              # clear
        rows = ut.sample_params(rng, (2, 4), bump=(0, 2e-3))
        rows[0, :, 0] = 0                                # env 0: none
        m.set_materials(uv_texture=rows)
        r.render("cam")
        jit = [k for k in dr.kernel_history()
               if k.get("type") == dr.KernelType.JIT]
    finally:
        dr.set_flag(dr.JitFlag.KernelHistory, False)
    assert jit and all(k.get("cache_hit", False) for k in jit)
