"""rillfacet.render.raster: the batched GPU rasterizer. Geometry against
analytic values and Mitsuba, the sensor stage, chunking / zero-copy
invariance, shadows, textures, the envmap mapping."""
import numpy as np
import pytest

torch = pytest.importorskip("torch")

from rillfacet.render import linear_to_srgb                 # noqa: E402
from rillfacet.render.camera import look_at                 # noqa: E402
from rillfacet.render.sensor import radius2                 # noqa: E402
from rillfacet.scene_api import Material, Scene             # noqa: E402

try:
    from rillfacet.render.raster import RasterRenderer
    RasterRenderer(chunk=1).close()
except Exception as e:                                       # noqa: BLE001
    pytest.skip(f"no raster renderer: {e}", allow_module_level=True)

W, H = 64, 48
K = np.array([[50.0, 0, 31.5], [0, 50.0, 23.5], [0, 0, 1]])
#: A strong wide-angle model (barrel), invertible over the image.
DIST = np.array([-0.3, 0.08, 0.001, -0.0005, 0.0])
IDENTITY = np.array([0, 0, 0, 0, 0, 0, 1.0])


def box(center, half):
    c, h = np.asarray(center, float), np.asarray(half, float)
    s = np.array([[x, y, z] for x in (-1, 1) for y in (-1, 1) for z in (-1, 1)])
    v = c + s * h
    f = [[0, 1, 3], [0, 3, 2], [4, 6, 7], [4, 7, 5], [0, 4, 5], [0, 5, 1],
         [2, 3, 7], [2, 7, 6], [0, 2, 6], [0, 6, 4], [1, 5, 7], [1, 7, 3]]
    return v, np.array(f)


def quad(z, half):
    v = np.array([[-half, -half, z], [half, -half, z], [half, half, z],
                  [-half, half, z]], float)
    return v, np.array([[0, 1, 2], [0, 2, 3]])


def rigid(scene, name, parts, instances, **kw):
    """One rigid mesh with a body per (vertices, triangles) part."""
    verts, tris, vb, offs = [], [], [], [0]
    n = 0
    for b, (v, f) in enumerate(parts):
        verts.append(v)
        tris.append(f + n)
        vb += [b] * len(v)
        n += len(v)
        offs.append(offs[-1] + len(f))
    return scene.rigid_mesh(name, np.concatenate(verts).astype(np.float32),
                            np.array(vb), np.concatenate(tris), offs,
                            instances=instances, **kw)


def identity_poses(I, B):
    p = np.zeros((I, B, 7), np.float32)
    p[..., 6] = 1
    return p


def plane_scene(renderer, I=2, dist=None, **cam):
    """A 2 x 2 m quad at z = 2 (body 0) and a box x in [0.1, 0.5], y in
    [0, 0.4], z in [1.3, 1.7] in front of it (body 1), seen by a camera at
    the origin looking along +z."""
    sc = Scene(renderer)
    m = rigid(sc, "m", [quad(2.0, 1.0), box((0.3, 0.2, 1.5), (0.2, 0.2, 0.2))], I)
    m.set_poses(identity_poses(I, 2))
    sc.light("sky", "ambient", intensity=0.5)
    sc.camera_sensor("c", W, H, K, dist=dist, instances=I,
                     local_pose=IDENTITY, near=0.05, far=10.0, **cam)
    return sc, m


def pixel_rays(dist):
    from rillfacet.render.camera import PixelRays
    r = PixelRays(K, W, H, dist, device="cpu")
    return r.center.numpy().reshape(H, W, 2)


@pytest.mark.parametrize("dist", [None, DIST])
def test_plane_depth_and_labels(dist):
    r = RasterRenderer(chunk=4)
    plane_scene(r, dist=dist)
    out = r.render("c", outputs=("depth", "segmentation"))
    depth, seg = out["depth"].cpu().numpy(), out["segmentation"].cpu().numpy()
    xy = pixel_rays(dist)
    x, y = xy[..., 0], xy[..., 1]
    # a margin of ~1.5 pixels around every edge (labels are nearest-pixel)
    m = 1.5 * np.abs(np.diff(x, axis=1)).max()
    in_quad = lambda d: (np.abs(x) < 0.5 - d) & (np.abs(y) < 0.5 - d)  # noqa: E731
    # the box's silhouette spans x/z in [0.1/1.7, 0.5/1.3], y/z in [0, 0.4/1.3]
    shadowed = ((x > 0.1 / 1.7 - m) & (x < 0.5 / 1.3 + m)
                & (y > -m) & (y < 0.4 / 1.3 + m))
    sure_quad = in_quad(m) & ~shadowed
    sure_box = ((x > 0.1 / 1.3 + m) & (x < 0.5 / 1.3 - m)
                & (y > m) & (y < 0.4 / 1.3 - m))           # its front face
    sure_none = ~in_quad(-m)
    assert sure_quad.sum() > 500 and sure_box.sum() > 30 and sure_none.sum() > 100
    for i in range(2):
        assert np.all(seg[i][sure_quad] == 0)
        assert np.all(seg[i][sure_box] == 1)
        assert np.all(seg[i][sure_none] == -1)
        np.testing.assert_allclose(depth[i][sure_quad], 2.0, rtol=1e-5)
        np.testing.assert_allclose(depth[i][sure_box], 1.3, rtol=1e-5)
        assert np.all(depth[i][sure_none] == 0)


def test_background_gain_and_vignetting():
    I = 3
    gain = np.array([[1, 1, 1], [0.5, 1.0, 2.0], [1, 1, 1]], np.float32)
    vig = np.array([0.0, 0.0, 0.6], np.float32)
    r = RasterRenderer()
    sc = Scene(r)
    m = rigid(sc, "m", [quad(50.0, 0.1)], I)      # beyond far: background only
    m.set_poses(identity_poses(I, 1))
    sc.light("sky", "ambient", intensity=0.4, color=(1.0, 0.5, 0.25))
    sc.camera_sensor("c", W, H, K, instances=I, local_pose=IDENTITY, far=10.0,
                     gain=gain, vignetting=vig)
    out = r.render("c", outputs=("rgb", "linear", "segmentation"))
    lin = out["linear"].cpu().numpy()
    sky = 0.4 * np.array([1.0, 0.5, 0.25])
    np.testing.assert_allclose(lin[0], np.broadcast_to(sky, (H, W, 3)), rtol=2e-3)
    np.testing.assert_allclose(lin[1], np.broadcast_to(sky * gain[1], (H, W, 3)), rtol=2e-3)
    fall = (1 - 0.6 * radius2(K, W, H).numpy())[..., None]
    np.testing.assert_allclose(lin[2], sky * fall, rtol=2e-3, atol=1e-4)
    rgb = out["rgb"].cpu().numpy()
    np.testing.assert_allclose(rgb, linear_to_srgb(lin), atol=1 / 255 + 1e-3)
    assert np.all(out["segmentation"].cpu().numpy() == -1)


def test_sensor_noise_statistics():
    """Mean unchanged, variance shot * x + read^2, channels independent."""
    I, Wn, Hn = 3, 256, 192
    Kn = np.array([[200.0, 0, 127.5], [0, 200.0, 95.5], [0, 0, 1]])
    r = RasterRenderer(seed=3)
    sc = Scene(r)
    m = rigid(sc, "m", [quad(50.0, 0.1)], I)
    m.set_poses(identity_poses(I, 1))
    sc.light("sky", "ambient", intensity=0.25)
    shot, read = 0.01, 0.02
    sc.camera_sensor("c", Wn, Hn, Kn, instances=I, local_pose=IDENTITY, far=10.0,
                     shot_noise=[0.0, shot, shot], read_noise=[0.0, read, read],
                     gain=[[1, 1, 1], [1, 1, 1], [2, 2, 2]])
    lin = r.render("c", outputs=("linear",))["linear"].float()
    assert torch.allclose(lin[0], torch.tensor(0.25, device=lin.device), rtol=1e-3)
    for i, x in ((1, 0.25), (2, 0.5)):
        v = lin[i]
        assert float(v.mean()) == pytest.approx(x, abs=3e-3)
        assert float(v.var()) == pytest.approx(shot * x + read ** 2, rel=0.05)
    c = torch.corrcoef(lin[1].reshape(-1, 3).T)
    assert float((c - torch.eye(3, device=c.device)).abs().max()) < 0.03
    # a new render draws new noise; envs differ
    lin2 = r.render("c", outputs=("linear",))["linear"]
    assert not torch.equal(lin2[1], lin[1].half())
    assert not torch.equal(lin[1], lin[2] / 2)



def test_reseed_restarts_the_noise():
    r = RasterRenderer(seed=4)
    plane_scene(r, I=2, shot_noise=1e-2, read_noise=1e-2)
    a = r.render("c", outputs=("linear",))["linear"].cpu()
    b = r.render("c", outputs=("linear",))["linear"].cpu()
    assert not torch.equal(a, b)
    r.reseed()
    assert torch.equal(r.render("c", outputs=("linear",))["linear"].cpu(), a)
    r.reseed(5)
    assert not torch.equal(r.render("c", outputs=("linear",))["linear"].cpu(), a)

def test_chunking_zero_copy_and_render_chunks_agree():
    """Double buffering and the host (no zero-copy) path are bit-identical;
    another chunk size puts envs in other atlas tiles, which may round a
    vertex differently (a last-bit change in a few pixels). The noise is
    drawn per env, so it does not depend on the chunking."""
    I = 10
    poses = identity_poses(I, 2)
    poses[:, 1, 0] = np.linspace(-0.4, 0.4, I)      # the box moves per env
    outs = []
    configs = [dict(chunk=4), dict(chunk=4, double_buffer=False),
               dict(chunk=4, zero_copy=False), dict(chunk=10), dict(chunk=3)]
    for cfg in configs:
        r = RasterRenderer(seed=1, **cfg)
        sc, m = plane_scene(r, I=I, dist=DIST, shot_noise=1e-3, read_noise=1e-3)
        m.set_poses(poses)
        sc.light("sun", "directional", direction=(0.2, 0.1, 1.0), intensity=2.0)
        outs.append({k: v.cpu() for k, v in r.render(
            "c", outputs=("rgb", "linear", "depth", "segmentation")).items()})
        r.close()
    for o in outs[1:3]:
        for k in outs[0]:
            assert torch.equal(outs[0][k], o[k]), k
    for o in outs[3:]:
        assert torch.equal(outs[0]["segmentation"], o["segmentation"])
        for k, tol in (("rgb", 1.5 / 255), ("linear", 1e-3), ("depth", 1e-6)):
            diff = (outs[0][k] - o[k]).abs()
            assert float(diff.max()) < tol and float((diff > 0).float().mean()) < 0.01, k
    # the chunk iterator: same images, raw dtypes, every env once
    r = RasterRenderer(seed=1, chunk=4)
    sc, m = plane_scene(r, I=I, dist=DIST, shot_noise=1e-3, read_noise=1e-3)
    m.set_poses(poses)
    sc.light("sun", "directional", direction=(0.2, 0.1, 1.0), intensity=2.0)
    seen = []
    for e0, e1, img in r.render_chunks("c", outputs=("rgb", "segmentation")):
        seen.append((e0, e1))
        assert img["rgb"].dtype == torch.uint8 and img["rgb"].shape == (e1 - e0, H, W, 3)
        assert torch.equal(img["rgb"].cpu(), (outs[0]["rgb"][e0:e1] * 255).round().byte())
        assert torch.equal(img["segmentation"].int().cpu(),
                           outs[0]["segmentation"][e0:e1].cpu())
    assert seen == [(0, 4), (4, 8), (8, 10)]



def per_instance_intrinsics():
    """Three instances' (K, dist): the shared test camera, its principal
    point moved, its focal length 10% longer (all different distortion)."""
    K1 = K.copy()
    K1[0, 2] += 3.0
    K1[1, 2] -= 2.0
    K2 = K.copy()
    K2[0, 0] *= 1.1
    K2[1, 1] *= 1.1
    return np.stack([K, K1, K2]), np.stack([DIST, 0.5 * DIST, 0.0 * DIST])


def test_per_instance_intrinsics_match_shared_cameras():
    """Every instance of a camera with per-instance K / dist renders as a
    camera with that instance's K / dist for all, chunk boundaries
    included (the shared proxy is matched with ``oversample``)."""
    I = 3
    Ks, dists = per_instance_intrinsics()
    f = max(k[0, 0] for k in Ks)
    poses = identity_poses(I, 2)
    poses[:, 1, 0] = np.linspace(-0.2, 0.2, I)
    outputs = ("rgb", "depth", "segmentation")

    def render(K_, dist_, oversample=1.0):
        r = RasterRenderer(chunk=2, oversample=oversample)
        sc = Scene(r)
        m = rigid(sc, "m", [quad(2.0, 1.0),
                            box((0.3, 0.2, 1.5), (0.2, 0.2, 0.2))], I)
        m.set_poses(poses)
        sc.light("sky", "ambient", intensity=0.5)
        sc.light("sun", "directional", direction=(0.2, 0.1, 1.0), intensity=2.0)
        cam = sc.camera_sensor("c", W, H, K_, dist=dist_, instances=I,
                               local_pose=IDENTITY, near=0.05, far=10.0,
                               vignetting=0.5)
        out = {k: v.cpu() for k, v in r.render("c", outputs=outputs).items()}
        r.close()
        return cam, out

    cam, got = render(Ks, dists)
    assert cam.per_instance_intrinsics and cam.K.shape == (I, 3, 3)
    k1, d1 = cam.intrinsics(1)
    assert np.array_equal(k1, Ks[1]) and np.array_equal(d1, dists[1])
    for i in range(I):
        _, want = render(Ks[i], dists[i], oversample=f / Ks[i][0, 0])
        assert torch.equal(got["segmentation"][i], want["segmentation"][i]), i
        for k, tol in (("rgb", 1.5 / 255), ("depth", 1e-6)):
            diff = (got[k][i] - want[k][i]).abs()
            assert float(diff.max()) < tol, (i, k)
    # the instances really differ
    assert not torch.equal(got["segmentation"][0], got["segmentation"][1])


def test_per_instance_vignetting_follows_the_principal_point():
    I = 3
    Ks, _ = per_instance_intrinsics()
    r = RasterRenderer(chunk=2)
    sc = Scene(r)
    m = rigid(sc, "m", [quad(50.0, 0.1)], I)      # beyond far: background only
    m.set_poses(identity_poses(I, 1))
    sc.light("sky", "ambient", intensity=0.4)
    sc.camera_sensor("c", W, H, Ks, instances=I, local_pose=IDENTITY,
                     far=10.0, vignetting=0.6)
    lin = r.render("c", outputs=("linear",))["linear"].cpu().numpy()
    for i in range(I):
        fall = (1 - 0.6 * radius2(Ks[i], W, H).numpy())[..., None]
        np.testing.assert_allclose(lin[i], 0.4 * np.broadcast_to(fall, (H, W, 3)),
                                   rtol=2e-3, atol=1e-4)
    assert radius2(Ks, W, H).shape == (I, H, W)

def test_hidden_body_disappears():
    r = RasterRenderer()
    sc, m = plane_scene(r, I=2)
    m.set_segment_visible(1 * 2 + 1, False)          # env 1, body 1 (the box)
    seg = r.render("c", outputs=("segmentation",))["segmentation"].cpu().numpy()
    assert (seg[0] == 1).sum() > 10 and (seg[1] == 1).sum() == 0


@pytest.mark.parametrize("extent", [None, 1.5])
def test_shadow_and_sun(extent):
    """A box between the sun and a floor darkens the floor below it, with
    the scene's shadow box or one ahead of the camera (shadow_extent)."""
    r = RasterRenderer(shadow_resolution=512, shadow_extent=extent)
    sc = Scene(r)
    floor = np.array([[-2, -2, 0], [2, -2, 0], [2, 2, 0], [-2, 2, 0]], float)
    m = rigid(sc, "m", [(floor, np.array([[0, 1, 2], [0, 2, 3]])),
                        box((0, 0, 0.5), (0.25, 0.25, 0.05))], 1,
              materials=[Material("grey", (0.5, 0.5, 0.5), roughness=1.0)],
              triangle_material=np.zeros(14, int))
    m.set_poses(identity_poses(1, 2))
    sc.light("sun", "directional", direction=(0, 0, -1.0), intensity=3.0)
    sc.light("sky", "ambient", intensity=0.1)
    # camera above, looking down past the box at the floor
    sc.camera_sensor("c", 128, 128, [[60, 0, 63.5], [0, 60, 63.5], [0, 0, 1]],
                     instances=1, local_pose=look_at((1.2, 0, 2.5), (0.3, 0, 0),
                                                     up=(1, 0, 0)), far=10)
    out = r.render("c", outputs=("linear", "segmentation", "depth"))
    lin = out["linear"][0].float().mean(-1).cpu().numpy()
    seg = out["segmentation"][0].cpu().numpy()
    floor_px = seg == 0
    # floor pixels whose ray hits z = 0 inside the box's footprint
    from rillfacet.render.camera import PixelRays
    pose = look_at((1.2, 0, 2.5), (0.3, 0, 0), up=(1, 0, 0))
    q = pose[3:]
    Rm = _quat_mat(q)
    rays = PixelRays([[60, 0, 63.5], [0, 60, 63.5], [0, 0, 1]], 128, 128,
                     device="cpu").center.numpy().reshape(128, 128, 2)
    d = np.concatenate([rays, np.ones((128, 128, 1))], -1) @ Rm.T
    t = -pose[2] / d[..., 2]
    hit = pose[:3] + t[..., None] * d
    under = floor_px & (np.abs(hit[..., 0]) < 0.2) & (np.abs(hit[..., 1]) < 0.2)
    open_ = floor_px & (np.abs(hit[..., 0]) > 0.4)
    assert under.sum() > 20 and open_.sum() > 200
    assert lin[under].mean() < 0.2 * lin[open_].mean()


def _quat_mat(q):
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def test_texture():
    """A 2 x 2 texture on a quad facing the camera, lit by the sky only:
    each quadrant shows its texel times the base color."""
    tex = np.array([[[255, 0, 0], [0, 255, 0]], [[0, 0, 255], [255, 255, 255]]],
                   np.uint8).repeat(32, 0).repeat(32, 1)
    r = RasterRenderer(texture_size=64)
    sc = Scene(r)
    v, f = quad(2.0, 1.0)
    uvs = np.array([[0, 0], [1, 0], [1, 1], [0, 1]], np.float32)
    m = sc.rigid_mesh("m", v.astype(np.float32), [0] * 4, f, [0, 2], instances=1,
                      uvs=uvs, materials=[Material("t", (1, 1, 1), roughness=1.0,
                                                   base_color_texture=tex)])
    m.set_poses(identity_poses(1, 1))
    sc.light("sky", "ambient", intensity=1.0)
    sc.camera_sensor("c", W, H, K, instances=1, local_pose=IDENTITY, far=10)
    lin = r.render("c", outputs=("linear",))["linear"][0].cpu().numpy()
    # uv (0, 0) is the texture's top-left, at the quad's (-1, -1) corner,
    # which the camera (y down) sees top-left
    q = {"tl": lin[14, 19], "tr": lin[14, 44], "bl": lin[33, 19], "br": lin[33, 44]}
    assert q["tl"].argmax() == 0 and q["tr"].argmax() == 1 and q["bl"].argmax() == 2
    assert q["br"].min() > 0.8 * q["br"].max()
    for k in ("tl", "tr", "bl"):
        c = q[k]
        assert c.max() > 0.9 and np.sort(c)[1] < 0.1


def _mitsuba():
    pytest.importorskip("mitsuba")
    from rillfacet.render.mitsuba import MitsubaRenderer
    try:
        return MitsubaRenderer(spp=256, integrator={"type": "direct"})
    except Exception as e:                                   # noqa: BLE001
        pytest.skip(f"no Mitsuba CUDA variant: {e}")


def _boxes_scene(renderer, I, rng):
    sc = Scene(renderer)
    parts = [box(rng.uniform(-0.4, 0.4, 3) + [0, 0, 2.0], rng.uniform(0.05, 0.3, 3))
             for _ in range(6)] + [quad(3.0, 3.0)]
    m = rigid(sc, "m", parts, I)
    poses = identity_poses(I, len(parts))
    poses[:, :6, :3] = rng.uniform(-0.2, 0.2, (I, 6, 3))
    m.set_poses(poses)
    sc.light("sky", "ambient", intensity=0.3)
    sc.light("sun", "directional", direction=(0.3, 0.2, 1.0), intensity=2.0)
    cam_poses = np.stack([look_at(rng.uniform(-0.2, 0.2, 3), (0, 0, 2.0), up=(0, -1, 0))
                          for _ in range(I)])
    sc.camera_sensor("c", W, H, K, dist=DIST, instances=I, local_pose=cam_poses,
                     near=0.05, far=10.0)
    return sc


def test_geometry_matches_mitsuba():
    mr = _mitsuba()
    I = 4
    rr = RasterRenderer(chunk=3)
    _boxes_scene(rr, I, np.random.default_rng(0))
    _boxes_scene(mr, I, np.random.default_rng(0))
    a = rr.render("c", outputs=("depth", "segmentation"))
    b = mr.render("c", outputs=("depth", "segmentation"))
    sa, sb = a["segmentation"].cpu().numpy(), b["segmentation"].cpu().numpy()
    agree = sa == sb
    assert agree.mean() > 0.99
    da, db = a["depth"].cpu().numpy(), b["depth"].cpu().numpy()
    both = agree & (sa >= 0)
    rel = np.abs(da[both] - db[both]) / db[both]
    assert np.median(rel) < 1e-4 and np.quantile(rel, 0.99) < 5e-3


@pytest.mark.parametrize("light", [
    ("ambient", dict(intensity=1.0)),
    ("directional", dict(direction=(0, 0, 1.0), intensity=1.0)),
    ("directional", dict(direction=(0.6, 0, 0.8), intensity=1.0))])
@pytest.mark.parametrize("roughness,metallic", [(1.0, 0.0), (0.5, 0.0), (0.2, 0.0),
                                                (0.5, 1.0), (0.3, 0.5)])
def test_shading_matches_mitsuba(light, roughness, metallic):
    """A plane facing the camera under one light: within 1.5% of Mitsuba's
    principled BRDF (direct integrator). What is not compared: the sky
    blocked by other geometry (no occlusion of the sky in the raster)."""
    res = []
    for R in (RasterRenderer(), _mitsuba()):
        sc = Scene(R)
        v, f = quad(2.0, 1.0)
        m = sc.rigid_mesh("m", v.astype(np.float32), [0] * 4, f, [0, 2], instances=1,
                          materials=[Material("a", (0.6, 0.5, 0.4), roughness=roughness,
                                              metallic=metallic)])
        m.set_poses(identity_poses(1, 1))
        sc.light("l", light[0], **light[1])
        sc.camera_sensor("c", W, H, K, instances=1, local_pose=IDENTITY, far=10)
        res.append(R.render("c", outputs=("linear",))["linear"][0, 18:30, 26:38]
                   .float().mean((0, 1)).cpu().numpy())
    np.testing.assert_allclose(res[0], res[1], rtol=0.015)


def test_envmap_matches_mitsuba(tmp_path):
    """Background lookups of an equirect image (Mitsuba's z-up mapping)."""
    from PIL import Image
    mr = _mitsuba()
    h, w = 64, 128
    img = np.zeros((h, w, 3), np.uint8)
    img[..., 0] = ((np.arange(w) + 0.5) / w * 255).astype(np.uint8)[None]
    img[..., 1] = ((np.arange(h) + 0.5) / h * 255).astype(np.uint8)[:, None]
    img[..., 2] = 128
    path = str(tmp_path / "env.png")
    Image.fromarray(img).save(path)
    dirs = [(1, 0, 0), (-1, 0, 0), (0, -1, 0), (0.5, 0.3, 0.8), (0.2, -0.6, -0.7)]
    poses = np.stack([look_at((0, 0, 0), d) for d in dirs])
    res = []
    for R in (RasterRenderer(), mr):
        sc = Scene(R)
        m = rigid(sc, "m", [quad(100.0, 0.01)], len(dirs))
        m.set_poses(identity_poses(len(dirs), 1))
        sc.light("env", "envmap", envmap=path)
        sc.camera_sensor("c", 8, 8, [[8, 0, 3.5], [0, 8, 3.5], [0, 0, 1]],
                         instances=len(dirs), local_pose=poses, far=10)
        res.append(R.render("c", outputs=("rgb",))["rgb"][:, 3:5, 3:5].mean((1, 2))
                   .cpu().numpy())
    np.testing.assert_allclose(res[0], res[1], atol=0.02)


# ---- solid (3D) textures ----------------------------------------------------

#: 1 cm pixels on the plane at z = 2 (finer than the patterns' detail).
K_FINE = np.array([[200.0, 0, 31.5], [0, 200.0, 23.5], [0, 0, 1]])


def _solid_plane(renderer, rows, half=3.0, light=("ambient", dict(intensity=1.0)),
                 bump=False, materials=None, Kc=K):
    """One textured plane at z = 2 facing the camera per env (body pose =
    identity, so body-local = world)."""
    from rillfacet import solid_texture as sx
    I = len(rows)
    sc = Scene(renderer)
    m = rigid(sc, "m", [quad(2.0, half)], I, materials=materials or [
        Material("a", solid_texture=True, bump=bump)])
    m.set_poses(identity_poses(I, 1))
    if m.material_solid_texture is not None:
        m.set_materials(solid_texture=np.asarray(rows)[:, None])
    sc.light("l", light[0], **light[1])
    sc.camera_sensor("c", W, H, Kc, instances=I, local_pose=IDENTITY, far=10)
    return sc, m


def _plane_points(z=2.0, Kc=K):
    """Body-local points of the pixel centers on the plane z (no distortion)."""
    v, u = np.mgrid[0:H, 0:W].astype(np.float32)
    x = (u - Kc[0, 2]) / Kc[0, 0] * z
    y = (v - Kc[1, 2]) / Kc[1, 1] * z
    return np.stack([x, y, np.full_like(x, z)], -1)


def test_solid_texture_matches_the_reference():
    """Unfiltered, every family: the base color the raster shades with
    (recovered from renders of black and white plain materials under the
    sky alone) is the torch reference's at the pixel's body-local point."""
    from rillfacet import solid_texture as sx
    rng = np.random.default_rng(0)
    fams = sx.FAMILIES
    rows = sx.sample_params(rng, len(fams) * 2, families=fams, scale=(0.8, 1.5))
    rows[:, sx.PARAM["family"]] = np.repeat(np.arange(len(fams)), 2)
    rows[:, sx.PARAM["rough1"]] = rows[:, sx.PARAM["rough0"]] = 0.6
    out = []
    for kind in ("solid", "black", "white"):
        r = RasterRenderer(chunk=4, supersample=1, solid_texture_filter=False)
        mats = None if kind == "solid" else [Material(
            "a", (0, 0, 0) if kind == "black" else (1, 1, 1), roughness=0.6)]
        _solid_plane(r, rows, materials=mats)
        out.append(r.render("c", outputs=("linear",))["linear"].double())
        r.close()
    L, Lb, Lw = out
    base = ((L - Lb) / (Lw - Lb)).cpu()
    pts = torch.as_tensor(_plane_points()).reshape(-1, 3)
    for e in range(len(rows)):
        _, want = sx.evaluate(pts, torch.as_tensor(rows[e]).expand(len(pts), sx.K))
        err = (base[e].reshape(-1, 3) - want).abs().max(-1).values
        # fp16 output, bilinear proxy taps; checker / granite cell edges
        assert float(err.median()) < 3e-3, fams[e // 2]
        assert float((err > 0.03).float().mean()) < 0.03, fams[e // 2]


def test_solid_texture_bump_follows_the_height():
    """A bumped white plane under a tilted sun, unfiltered: radiance bumped
    / flat follows the cosine ratio of the reference's height gradient, and
    not its mirror image."""
    from rillfacet import solid_texture as sx
    amp, scale, eps = 0.02, 3.0, 0.02
    row = sx.make_params("stone", colors=((0.7, 0.7, 0.7),), scale=scale,
                         offset=(11, 23, 5), roughness=1.0, bump=amp, eps=eps)
    d = np.array([0.5, 0.3, 1.0])                  # the sun travels along +z
    out = []
    for a in (amp, 0.0):
        row[sx.PARAM["bump"]] = a
        r = RasterRenderer(chunk=1, supersample=1, shadow_resolution=0,
                           solid_texture_filter=False)
        _solid_plane(r, [row], bump=True, Kc=K_FINE,
                     light=("directional", dict(direction=tuple(d), intensity=3.0)))
        out.append(r.render("c", outputs=("linear",))["linear"][0].mean(-1).cpu())
        r.close()
    pts = torch.as_tensor(_plane_points(Kc=K_FINE)).reshape(-1, 3)
    rows = torch.as_tensor(row).expand(len(pts), sx.K)
    e = eps / scale
    h0, _ = sx.evaluate(pts, rows)
    # one-sided differences along the shader's tangents of N = -z
    # (solid_bump: -y, then -x), so the prediction is not shifted by e
    gx = (h0 - sx.evaluate(pts - torch.tensor([e, 0, 0]), rows)[0]) / e
    gy = (h0 - sx.evaluate(pts - torch.tensor([0, e, 0]), rows)[0]) / e
    L = -torch.as_tensor(d / np.linalg.norm(d), dtype=torch.float32)

    def cos_ratio(sign):
        n = torch.stack([-sign * amp * gx, -sign * amp * gy, -torch.ones_like(gx)], -1)
        n = n / n.norm(dim=-1, keepdim=True)
        return (n @ L).clamp(min=0) / -L[2]

    ratio = (out[0] / out[1].clamp(min=1e-4)).reshape(-1)
    corr = lambda x: float(torch.corrcoef(torch.stack([ratio, x]))[0, 1])  # noqa: E731
    assert float(ratio.std()) > 0.03
    assert corr(cos_ratio(1.0)) > 0.9
    assert corr(cos_ratio(-1.0)) < 0.0


def test_solid_texture_filter_removes_aliasing():
    """A checker of cells far below a pixel: unfiltered, pixels are either
    color (aliasing); filtered, every pixel is the mean."""
    from rillfacet import solid_texture as sx
    row = sx.make_params("checker", colors=((1, 1, 1), (0, 0, 0)), scale=400.0,
                         rotation=(0.3, 0.2, 0.1, 0.9), roughness=0.6)
    res = {}
    for filt in (False, True):
        r = RasterRenderer(chunk=1, solid_texture_filter=filt)
        _solid_plane(r, [row])
        res[filt] = r.render("c", outputs=("linear",))["linear"][0, 8:40, 8:56].float()
        r.close()
    assert float(res[False].std((0, 1)).mean()) > 0.1
    assert float(res[True].std((0, 1)).mean()) < 0.01
    # resolved detail: the filter keeps a checker's mean (it only blends
    # the cells' edges) and barely touches smooth noise
    stone = sx.make_params("stone", colors=((0.8, 0.7, 0.6), (0.2, 0.3, 0.4)),
                           scale=1.0, roughness=0.6)
    row[sx.PARAM["scale"]] = 2.0
    for filt in (False, True):
        r = RasterRenderer(chunk=2, solid_texture_filter=filt)
        _solid_plane(r, [row, stone])
        res[filt] = r.render("c", outputs=("linear",))["linear"].float()
        r.close()
    a, b = res[False], res[True]
    assert float((a[0].mean((0, 1)) - b[0].mean((0, 1))).abs().max()) < 0.01
    assert float(((a[1] - b[1]).abs().amax(-1) > 0.02).float().mean()) < 0.05


def test_solid_texture_matches_mitsuba():
    """Random rows of every family under the sun, against Mitsuba's direct
    integrator: the same images up to anti-aliasing."""
    from rillfacet import solid_texture as sx
    rows = sx.sample_params(np.random.default_rng(1), 6, families=sx.FAMILIES[1:],
                            scale=(0.8, 1.5), bump=(0.0, 0.002))
    imgs = []
    for R in (RasterRenderer(chunk=6, shadow_resolution=0), _mitsuba()):
        _solid_plane(R, rows, bump=True, Kc=K_FINE,
                     light=("directional", dict(direction=(0.2, 0.1, 1.0), intensity=2.0)))
        imgs.append(R.render("c", outputs=("linear",))["linear"].float().cpu())
    d = (imgs[0] - imgs[1]).abs().amax(-1)
    assert float(d.median()) < 0.01
    assert float((d > 0.05).float().mean()) < 0.03
