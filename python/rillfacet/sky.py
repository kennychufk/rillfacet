"""Procedural sky panoramas for background randomization.

:func:`sky_images` turns parameter rows (:func:`sample_params`) into
equirectangular panoramas ``[N, H, W, 3]``: linear RGB, HDR (the sun disk
is far above 1), z-up with the envmap mapping of
:class:`~rillfacet.scene_api.Light` (row 0 = zenith, column ``j`` at
azimuth ``atan2(x, y) = 2 pi (j + 0.5) / W``), ready for a
:class:`~rillfacet.scene_api.Background`. Each sky is a sum of:

- a gradient from the horizon color to the zenith color over elevation,
  brightened toward the sun near the horizon (forward scattering);
- the sun: a disk and an exponential halo;
- clouds: fractal value noise on a plane above the camera (so they shrink
  toward the horizon and fade there), thresholded by the cover, shaded
  darker on the side away from the sun;
- a skyline (hills from fractal noise, or blocks of random heights, like
  buildings), hazed toward the horizon color;
- a ground below the horizon.

Palettes (:data:`PALETTES`): ``day``, ``overcast``, ``dusk`` and
``surreal`` (random colors, for randomization beyond realism). The noise is
an integer hash of the lattice, so a parameter row gives the same image on
any device. Torch is used for the images (CUDA when available).

    import numpy as np
    from rillfacet import sky
    imgs = sky.random_skies(np.random.default_rng(0), 64, height=256)
    scene.background("sky", imgs, instances=E, index=np.arange(E) % 64)
"""
from __future__ import annotations

import numpy as np

__all__ = ["PALETTES", "sample_params", "sky_images", "random_skies"]

#: Palette names; ``sample_params(palettes=...)`` takes probabilities.
PALETTES = ("day", "overcast", "dusk", "surreal")
_DEFAULT_P = {"day": 0.5, "overcast": 0.2, "dusk": 0.15, "surreal": 0.15}

_DEG = np.pi / 180.0


def _jitter(rng, c, n, amount=0.15):
    return np.asarray(c, np.float64) * rng.uniform(1 - amount, 1 + amount,
                                                   (n, 3))


def sample_params(rng, n, palettes=None) -> dict:
    """``n`` random skies: a dict of ``[n, ...]`` numpy arrays (the
    :func:`sky_images` input), drawn from the numpy Generator ``rng``.
    ``palettes``: ``{name: probability}`` over :data:`PALETTES` (default
    day 0.5, overcast 0.2, dusk 0.15, surreal 0.15)."""
    p = dict(_DEFAULT_P if palettes is None else palettes)
    bad = set(p) - set(PALETTES)
    if bad:
        raise ValueError(f"sample_params: unknown palettes {sorted(bad)}")
    names = list(p)
    w = np.asarray([p[k] for k in names], np.float64)
    kind = rng.choice(len(names), n, p=w / w.sum())
    kind = np.asarray([PALETTES.index(names[k]) for k in kind])
    day, over, dusk, odd = (kind == i for i in range(4))

    b = rng.uniform(0.6, 1.4, (n, 1))                     # overall brightness
    zen = _jitter(rng, (0.05, 0.15, 0.5), n) * b
    hor = _jitter(rng, (0.45, 0.6, 0.8), n) * b
    g = rng.uniform(0.3, 0.9, (n, 1))
    tint = rng.uniform(0.95, 1.05, (n, 3))
    zen[over], hor[over] = (g * tint)[over], (1.1 * g * tint)[over]
    zen[dusk] = _jitter(rng, (0.03, 0.04, 0.15), n)[dusk] * b[dusk]
    hor[dusk] = _jitter(rng, (0.9, 0.45, 0.2), n, 0.25)[dusk] * b[dusk]
    zen[odd] = rng.uniform(0, 1, (n, 3))[odd] * b[odd]
    hor[odd] = rng.uniform(0, 1, (n, 3))[odd] * b[odd]

    elev = rng.uniform(10, 75, n)
    elev[dusk] = rng.uniform(-2, 10, n)[dusk]
    az = rng.uniform(-180, 180, n)
    sun_color = _jitter(rng, (1.0, 0.95, 0.85), n, 0.05)
    sun_color[dusk] = _jitter(rng, (1.0, 0.5, 0.2), n)[dusk]
    sun_color[odd] = rng.uniform(0.3, 1.0, (n, 3))[odd]
    disk = rng.uniform(5.0, 30.0, n)
    disk[over] = 0.0
    halo = rng.uniform(0.2, 1.0, n)
    halo[over] *= 0.2

    cover = rng.uniform(0.0, 0.7, n)
    cover[over] = rng.uniform(0.7, 1.0, n)[over]
    cloud_color = rng.uniform(0.6, 1.5, (n, 1)) * np.maximum(
        hor.mean(1, keepdims=True), 0.3) * _jitter(rng, (1, 1, 1), n, 0.05)
    cloud_color[dusk] *= sun_color[dusk]

    skyline = rng.uniform(size=n) < 0.6
    blocks = rng.uniform(size=n) < 0.4
    return dict(
        kind=kind, zenith=zen, horizon=hor,
        gradient=rng.uniform(0.3, 1.0, n),          # exponent over elevation
        sun_az=az * _DEG, sun_elev=elev * _DEG, sun_color=sun_color,
        sun_disk=disk, sun_radius=rng.uniform(0.5, 2.0, n) * _DEG,
        sun_halo=halo, sun_halo_width=rng.uniform(3, 15, n) * _DEG,
        cloud_cover=cover, cloud_scale=rng.uniform(1.5, 6.0, n),
        cloud_softness=rng.uniform(0.05, 0.3, n),
        cloud_opacity=rng.uniform(0.6, 1.0, n), cloud_color=cloud_color,
        cloud_shade=rng.uniform(0.3, 0.8, n),        # darkening away from the sun
        skyline=np.where(skyline, np.where(blocks, 2, 1), 0),  # none/hills/blocks
        skyline_base=rng.uniform(0, 4, n) * _DEG,
        skyline_amp=rng.uniform(2, 12, n) * _DEG,
        skyline_segments=rng.integers(40, 200, n),
        skyline_color=rng.uniform(0.02, 0.15, (n, 1)) * _jitter(
            rng, (1, 1, 1), n, 0.3),
        skyline_haze=rng.uniform(0.2, 0.8, n),
        ground=rng.uniform(0.05, 0.25, (n, 1)) * _jitter(
            rng, (0.9, 0.8, 0.6), n, 0.3),
        seed=rng.integers(0, 2 ** 31 - 1, n))


# ---- noise ------------------------------------------------------------------

_M32 = 0xFFFFFFFF


def _hash(ix, iy, seed):
    """Uniform 0..1 per integer lattice point (int64 tensors), the same on
    every device (32-bit arithmetic in int64)."""
    h = (ix & _M32) * 374761393 & _M32
    h = (h ^ ((iy & _M32) * 668265263 & _M32)) & _M32
    h = (h ^ ((seed & _M32) * 2246822519 & _M32)) & _M32
    h = (h ^ (h >> 13)) * 1274126177 & _M32
    h = h ^ (h >> 16)
    return (h & 0xFFFFFF).float() / 16777216.0


def _value_noise(x, y, seed):
    import torch
    fx, fy = torch.floor(x), torch.floor(y)
    ix, iy = fx.long(), fy.long()
    tx, ty = x - fx, y - fy
    tx, ty = tx * tx * (3 - 2 * tx), ty * ty * (3 - 2 * ty)
    a = _hash(ix, iy, seed)
    b = _hash(ix + 1, iy, seed)
    c = _hash(ix, iy + 1, seed)
    d = _hash(ix + 1, iy + 1, seed)
    return (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty


def _fbm(x, y, seed, octaves=6):
    """Fractal value noise, ~0..1 (mean 0.5)."""
    total, amp, norm = 0.0, 0.5, 0.0
    for k in range(octaves):
        total = total + amp * _value_noise(x, y, seed + 7919 * k)
        norm += amp
        x, y = 2.03 * x + 17.1, 2.03 * y - 5.3
        amp *= 0.5
    return total / norm


def _smoothstep(a, b, x):
    t = ((x - a) / (b - a)).clamp(0, 1)
    return t * t * (3 - 2 * t)


# ---- images -----------------------------------------------------------------

def sky_images(params, height=256, width=None, *, device=None, chunk=8):
    """``[N, height, width, 3]`` float32 torch panoramas of the parameter
    rows ``params`` (:func:`sample_params`; ``width`` defaults to
    ``2 * height``), rendered ``chunk`` skies at a time on ``device``
    (default: CUDA when available)."""
    import torch
    if device is None:
        device = "cuda" if torch.cuda.is_available() else "cpu"
    dev = torch.device(device)
    H = int(height)
    W = 2 * H if width is None else int(width)
    n = len(params["seed"])
    th = (torch.arange(H, device=dev, dtype=torch.float32) + 0.5) * (np.pi / H)
    ph = (torch.arange(W, device=dev, dtype=torch.float32) + 0.5) * (2 * np.pi / W)
    th, ph = th[:, None].expand(H, W), ph[None].expand(H, W)
    d = torch.stack([th.sin() * ph.sin(), th.sin() * ph.cos(), th.cos()], -1)
    elev = (np.pi / 2) - th                                       # [H, W]
    out = torch.empty((n, H, W, 3), device=dev)
    for s0 in range(0, n, chunk):
        s1 = min(n, s0 + chunk)
        rows = {k: torch.as_tensor(np.asarray(v)[s0:s1], device=dev)
                for k, v in params.items()}
        out[s0:s1] = _render(rows, d, elev, ph)
    return out


def _render(p, d, elev, ph):
    import torch
    f32 = torch.float32

    def col(k):                                     # [n, 1, 1, 3]
        return p[k].to(f32)[:, None, None, :]

    def sc(k):                                      # [n, 1, 1]
        return p[k].to(f32)[:, None, None]

    e = elev[None]
    # sky gradient over elevation
    t = (e.clamp(min=0) / (np.pi / 2)) ** sc("gradient")
    sky = col("horizon") + (col("zenith") - col("horizon")) * t[..., None]
    # the sun and forward scattering
    se, sa = sc("sun_elev"), sc("sun_az")
    sun = torch.stack([se.cos() * sa.sin(), se.cos() * sa.cos(), se.sin()], -1)
    cosg = (d[None] * sun).sum(-1).clamp(-1, 1)
    ang = torch.acos(cosg)
    fwd = ((1 + cosg) / 2) ** 8 * (1 - t)
    sky = sky + col("sun_color") * (0.5 * fwd)[..., None] * col("horizon")
    # clouds on a plane above: q = d.xy / d.z
    up = d[None, ..., 2]
    z = up.clamp(min=0.02) + 0.15
    s = sc("cloud_scale")
    seed = p["seed"].long()[:, None, None]
    qx, qy = d[None, ..., 0] / z * s, d[None, ..., 1] / z * s
    den = _fbm(qx, qy, seed)
    # toward the sun: a little denser = more shadowed on this side
    off = 0.15 * s
    lit = _fbm(qx + off * sun[..., 0], qy + off * sun[..., 1], seed)
    cover = sc("cloud_cover")
    soft = sc("cloud_softness")
    mask = _smoothstep(1.0 - cover - soft, 1.0 - cover + soft,
                       den * 0.8 + 0.2 * cover)
    mask = mask * _smoothstep(0.0, 0.12, e) * sc("cloud_opacity")
    shade = 1.0 - sc("cloud_shade") * (lit - den + 0.5).clamp(0, 1)
    cloud = col("cloud_color") * shade[..., None]
    sky = sky + (cloud - sky) * mask[..., None]
    # the sun over the sky, dimmed by the clouds in front of it
    disk = _smoothstep(sc("sun_radius") * 1.15, sc("sun_radius") * 0.85, ang)
    glow = (sc("sun_disk") * disk + sc("sun_halo")
            * torch.exp(-ang / sc("sun_halo_width")))
    sky = sky + col("sun_color") * (glow * (1 - 0.9 * mask))[..., None]
    # ground below the horizon, hazed toward the horizon color near it
    haze_g = torch.exp(-(-e).clamp(min=0) / (5 * np.pi / 180))
    ground = col("ground") + (col("horizon") - col("ground")) * (
        0.6 * haze_g)[..., None]
    img = torch.where((e < 0)[..., None], ground, sky)
    # skyline: two layers, the far one hazier
    kind = p["skyline"].long()[:, None, None]
    phi = ph[None]
    for layer, (scale, haze_k) in enumerate(((1.0, 1.0), (0.55, 0.5))):
        ls = seed + 1013 * (layer + 1)
        hills = _fbm(3 * phi.cos() + 11.0 * layer, 3 * phi.sin(), ls, 5)
        seg = torch.floor(phi / (2 * np.pi) * sc("skyline_segments") * (
            1 + layer)).long()
        blocks = _hash(seg, layer, ls) ** 2
        prof = torch.where(kind == 2, blocks, (hills - 0.3).clamp(min=0) / 0.7)
        h = sc("skyline_base") * scale + sc("skyline_amp") * scale * prof
        inside = (kind > 0) & (e >= 0) & (e < h)
        haze = (sc("skyline_haze") * haze_k).clamp(0, 1)
        sil = col("skyline_color") + (col("horizon") - col("skyline_color")) * (
            haze[..., None] * (1 - layer * 0.3))
        img = torch.where(inside[..., None], sil, img)
    return img.clamp(min=0)


def random_skies(rng, n, height=256, width=None, *, palettes=None,
                 device=None):
    """``n`` random panoramas: :func:`sky_images` of
    :func:`sample_params` ``(rng, n, palettes)``."""
    return sky_images(sample_params(rng, n, palettes), height, width,
                      device=device)
