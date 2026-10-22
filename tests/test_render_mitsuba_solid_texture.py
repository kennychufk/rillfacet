"""Procedural solid (3D) textures in rillfacet.render.mitsuba.

    PYTHONPATH=python python -m pytest tests -q

Skipped without mitsuba (pip install rillfacet[mitsuba]) or a CUDA GPU.
"""

import gc
import weakref

import numpy as np
import pytest

torch = pytest.importorskip("torch")
pytest.importorskip("mitsuba")
if not torch.cuda.is_available():
    pytest.skip("needs CUDA", allow_module_level=True)

from rillfacet import solid_texture as sx                                  # noqa: E402
from rillfacet.render.camera import look_at                             # noqa: E402
from rillfacet.render.mitsuba import MitsubaRenderer, _qrot             # noqa: E402
from rillfacet.scene_api import Material, box_mesh                      # noqa: E402

from test_render_mitsuba import rigid, setup                            # noqa: E402

DOWN = look_at([0, 0, 1.2], [0, 0, 0], up=(0, 1, 0))
K128 = [[160.0, 0, 63.5], [0, 160.0, 63.5], [0, 0, 1]]


def blocks_scene(solid, instances=2, bump=False, mount=False,
                 light=None, **kw):
    """A floor (ordinary material) and two cubes (slots 1 and 2,
    solid-texture slots or not) per env, a camera looking down."""
    sc, r = setup(**kw)
    parts = [box_mesh([[-0.4, -0.4, -0.02]], [[0.4, 0.4, 0]]),
             box_mesh([[-0.25, -0.1, 0]], [[-0.05, 0.1, 0.2]]),
             box_mesh([[0.05, -0.1, 0]], [[0.25, 0.1, 0.15]])]
    mats = [Material("floor", (0.5, 0.5, 0.5))] + [
        Material(n, solid_texture=solid, bump=bump) for n in ("a", "b")]
    m = rigid(sc, "blocks", parts, instances=instances, materials=mats,
              triangle_material=np.repeat([0, 1, 2], 12))
    if light is not None:
        sc.light("sun", "directional", direction=light, intensity=3.0)
    if mount:
        sc.camera_sensor("cam", 128, 128, K128, mount=m, body=0,
                         local_pose=DOWN)
    else:
        sc.camera_sensor("cam", 128, 128, K128, instances=instances,
                         local_pose=DOWN)
    return sc, r, m


def test_dr_jit_families_match_the_reference():
    """The Mitsuba plugin evaluates the same functions as the torch
    reference (sx.evaluate), every family, random rows and points."""
    from rillfacet.render._mitsuba_solid_texture import plugins
    r = MitsubaRenderer()
    mi = r.mi
    State, _, _ = plugins(mi)
    rng = np.random.default_rng(0)
    n = 1 << 16
    rows = sx.sample_params(rng, n, families=sx.FAMILIES)
    pts = rng.uniform(-0.3, 0.3, (n, 3)).astype(np.float32)
    st = State(1, [0], 1)
    st.set_params(sx.linearize(rows)[:, None])
    h, c = st.pattern(tuple(mi.Float(pts[:, i]) for i in range(3)),
                      mi.UInt32(np.arange(n, dtype=np.uint32)), True)
    got = torch.stack([h.torch()] + [x.torch() for x in c], -1)
    hr, cr = sx.evaluate(torch.as_tensor(pts, device="cuda"),
                         torch.as_tensor(rows, device="cuda"))
    want = torch.cat([hr[:, None], cr], -1)
    err = (got - want).abs().max(-1).values
    fam = torch.as_tensor(rows[:, sx.PARAM["family"]], device="cuda")
    for f, name in enumerate(sx.FAMILIES):
        e = err[fam == f]
        # granite / checker: rare ties at cell boundaries pick another cell
        assert float((e > 1e-3).float().mean()) < 1e-3, name
        assert float(e.median()) < 1e-5, name


def test_plain_rows_render_like_ordinary_materials():
    """Solid-texture slots with plain rows of each env's color and roughness
    render the same image as ordinary materials with those values (the
    (env, slot) -> row mapping, sRGB, roughness, metallic, both sides)."""
    rng = np.random.default_rng(1)
    col = rng.uniform(0, 1, (2, 3, 3))
    rough = rng.uniform(0.1, 1, (2, 3))
    metal = rng.uniform(0, 1, (2, 3))
    imgs = []
    for solid in (False, True):
        sc, r, m = blocks_scene(solid, spp=4,
                                integrator={"type": "direct"})
        m.set_materials(base_color=col, roughness=rough, metallic=metal)
        if solid:
            rows = np.stack([[sx.make_params("plain", colors=(col[e, s],),
                                             roughness=rough[e, s])
                              for s in range(3)] for e in range(2)])
            m.set_materials(solid_texture=rows)
        imgs.append(r.render("cam", outputs=("linear",))["linear"])
    a, b = imgs
    assert float((a - b).abs().mean()) < 1e-4
    assert float((a - b).abs().max()) < 2e-2       # rare BVH/fp ties


def test_texture_sticks_to_the_body():
    """Bodies, the mounted camera and the sun moved by one rigid motion:
    the image does not change (the texture lives in body-local
    coordinates)."""
    q = np.array([0.2, -0.1, 0.3, 0.9])
    q /= np.linalg.norm(q)
    t = np.array([0.3, -0.2, 0.1])
    qt = torch.as_tensor(q, dtype=torch.float32)

    def rot(v):
        v = torch.as_tensor(v, dtype=torch.float32)
        return _qrot(qt.expand(v.shape[:-1] + (4,)), v).numpy()
    sun = np.array([-0.3, -0.2, -1.0])
    rows = sx.sample_params(np.random.default_rng(2), (2, 3),
                            families=("wood", "marble", "granite", "checker"))
    imgs = []
    for moved in (False, True):
        sc, r, m = blocks_scene(True, mount=True, spp=4,
                                light=rot(sun) if moved else sun,
                                integrator={"type": "direct"})
        poses = np.zeros((2, 3, 7), np.float32)
        poses[..., 6] = 1
        if moved:
            poses[..., :3] = rot(poses[..., :3]) + t
            poses[..., 3:] = q
        m.set_poses(poses)
        m.set_materials(solid_texture=rows)
        imgs.append(r.render("cam", outputs=("linear", "segmentation")))
    a, b = (x["linear"] for x in imgs)
    cubes = imgs[0]["segmentation"] >= 1
    assert torch.equal(cubes, imgs[1]["segmentation"] >= 1)
    assert float(a[cubes].std(0).mean()) > 0.03      # textured, lit
    assert float((a - b).abs().mean()) < 2e-3
    assert float(((a - b).abs().amax(-1) > 0.05).float().mean()) < 5e-3


def test_new_parameters_do_not_recompile():
    import drjit as dr
    # earlier tests' renderers, freed by the cyclic collector at any time,
    # would change the BSDFs a call traces (so the kernel) between renders
    gc.collect()
    sc, r, m = blocks_scene(True, bump=True, spp=2,
                            integrator={"type": "direct"})
    rng = np.random.default_rng(3)
    m.set_materials(solid_texture=sx.sample_params(rng, (2, 3)))
    r.render("cam")
    dr.set_flag(dr.JitFlag.KernelHistory, True)
    try:
        dr.kernel_history()                              # clear
        m.set_materials(solid_texture=sx.sample_params(
            rng, (2, 3), families=sx.FAMILIES, bump=(0, 2e-3)))
        r.render("cam")
        jit = [k for k in dr.kernel_history()
               if k.get("type") == dr.KernelType.JIT]
    finally:
        dr.set_flag(dr.JitFlag.KernelHistory, False)
    assert jit and all(k.get("cache_hit", False) for k in jit)


def test_bump_follows_the_texture_height():
    """A bumped white floor under the sun: the radiance ratio bumped / flat
    follows the cosine ratio predicted from the reference's height
    gradient (and not its mirror image: the normal map's convention)."""
    sc, r = setup(spp=16, integrator={"type": "direct"})
    floor = box_mesh([[-0.6, -0.6, -0.02]], [[0.6, 0.6, 0]])
    m = rigid(sc, "floor", [floor], materials=[
        Material("f", solid_texture=True, bump=True)])
    sun = np.array([0.6, 0.3, 0.75])
    sc.light("sun", "directional", direction=-sun, intensity=3.0)
    sc.camera_sensor("cam", 128, 128, K128, instances=1, local_pose=DOWN)
    amp, scale, eps = 0.02, 3.0, 0.02
    row = sx.make_params("stone", colors=((0.7, 0.7, 0.7),), scale=scale,
                         offset=(11, 23, 5), roughness=1.0, bump=amp, eps=eps)
    out = []
    for a in (amp, 0.0):
        row[sx.PARAM["bump"]] = a
        m.set_materials(solid_texture=row)
        out.append(r.render("cam", outputs=("linear", "depth")))
    L, L0 = (o["linear"][0].mean(-1) for o in out)
    z = out[0]["depth"][0]
    # body-local hit points of the pixel centers (floor pose = identity)
    v, u = torch.meshgrid(torch.arange(128.0, device="cuda"),
                          torch.arange(128.0, device="cuda"), indexing="ij")
    xc = torch.stack([(u - 63.5) / 160 * z, (v - 63.5) / 160 * z, z], -1)
    pose = torch.as_tensor(DOWN, dtype=torch.float32, device="cuda")
    p = (pose[:3] + _qrot(pose[3:].expand(xc.shape[:-1] + (4,)), xc)).reshape(-1, 3)
    rows = torch.as_tensor(row, device="cuda").expand(len(p), sx.K)
    e = eps / scale
    h0, _ = sx.evaluate(p, rows)
    gx = (sx.evaluate(p + torch.tensor([e, 0, 0], device="cuda"), rows)[0] - h0) / e
    gy = (sx.evaluate(p + torch.tensor([0, e, 0], device="cuda"), rows)[0] - h0) / e
    s = torch.as_tensor(sun / np.linalg.norm(sun), dtype=torch.float32,
                        device="cuda")

    def cos_ratio(sign):
        n = torch.stack([-sign * amp * gx, -sign * amp * gy,
                         torch.ones_like(gx)], -1)
        n = n / n.norm(dim=-1, keepdim=True)
        return (n @ s).clamp(min=0) / s[2]

    ok = (z > 0).reshape(-1) & (L0.reshape(-1) > 0.05)
    ratio = (L / L0.clamp(min=1e-4)).reshape(-1)[ok]
    corr = lambda x: float(torch.corrcoef(torch.stack([ratio, x[ok]]))[0, 1])  # noqa: E731
    assert float(ratio.std()) > 0.03                     # visibly bumped
    assert corr(cos_ratio(1.0)) > 0.85
    assert corr(cos_ratio(-1.0)) < 0.0


def test_renderers_are_freed():
    """Nothing in the plugins keeps a renderer alive (Dr.Jit would trace
    every live BSDF into every later render)."""
    sc, r, m = blocks_scene(True, bump=True, spp=1,
                            integrator={"type": "direct"})
    r.render("cam")
    refs = [weakref.ref(g.state) for g in r._groups["blocks"] if g.solid_texture]
    assert len(refs) == 1
    del sc, r, m
    gc.collect()
    assert all(ref() is None for ref in refs)
