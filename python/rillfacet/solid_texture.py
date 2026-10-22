"""Procedural SOLID (3D) textures: the backend-neutral spec.

A material slot with ``solid_texture=True``
(:class:`~rillfacet.scene_api.Material`) takes its base color and roughness
(optionally also a bump) from a solid texture: a pattern defined throughout
3D space and evaluated at the BODY-LOCAL position of each surface point,
not at UVs. It needs no UVs (convex decomposition hulls have none), has no
seams, and travels with its body. Each instance (env) has its own row of
:data:`K` parameters per slot (``RigidMesh.material_solid_texture``
``[I, M, K]``, set with ``RigidMesh.set_materials(solid_texture=...)``), so
randomizing solid textures is an array write, like the other material
parameters; renderers do not recompile for new values. :func:`make_params` builds a row, :func:`sample_params`
draws random ones.

Families (:data:`FAMILIES`) and their knobs ``a0..a3``:

- ``plain``: ``c0``, no pattern.
- ``wood``: concentric rings about the pattern z axis; ``a0`` rings per
  pattern unit, ``a1`` ring distortion, ``a2`` ring center shift along
  pattern x (pattern units), ``a3`` fibre strength. ``c0`` early wood,
  ``c1`` late wood.
- ``marble``: turbulent bands along pattern x; ``a0`` band frequency,
  ``a1`` turbulence, ``a2`` vein sharpness (0 soft, 1 thin). ``c0`` base,
  ``c1`` veins, ``c2`` a faint tint.
- ``granite``: Worley grains; ``a0`` grains per pattern unit, ``a1`` / ``a2``
  fractions of ``c1`` / ``c2`` grains (the rest ``c0``), dark boundaries.
- ``stone``: domain-warped fBm; ``a0`` warp strength, ``a1`` contrast.
  ``c0`` -> ``c1`` with ``c2`` spots.
- ``checker``: 3D checker of unit pattern cells, ``c0`` / ``c1``.

Every family also returns a height ``h`` in 0..1: roughness is
``lerp(rough0, rough1, h)`` and a bump displaces the surface by
``bump * h`` (m) along its normal.

Row layout (:data:`PARAM`, indices into the K floats): ``family`` (index
into FAMILIES, as a float), ``scale`` (pattern units per meter),
``offset[3]`` (pattern units, shifts the noise only: keep it below ~256,
fp32), ``R[9]`` (row-major rotation, body-local -> pattern frame),
``c0[3]``, ``c1[3]``, ``c2[3]`` (sRGB 0..1, like every color of the scene
API; renderers interpolate in linear), ``a[4]`` (family knobs), ``rough0``,
``rough1``, ``bump`` (m), ``eps`` (bump finite-difference step, a fraction
of a pattern unit), and one spare. The pattern point of a body-local ``p``
is ``q = R @ (scale * p)``.

The noise and the families are written once over an array-ops layer:
:class:`DrOps` runs them in Dr.Jit (inside Mitsuba's kernels,
:mod:`rillfacet.render.mitsuba`) and :class:`TorchOps` in torch
(:func:`evaluate`, the reference the renderers are tested against). The
hash is PCG3D (Jarzynski & Olano 2020, "Hash Functions for GPU
Rendering"), uint32 only so that it ports to shading languages without
64-bit integers; gradient noise is improved Perlin noise (quintic fade, 16
edge gradients), cellular noise Worley F1/F2 over 27 cells.
"""
from __future__ import annotations

import numpy as np

__all__ = ["K", "PARAM", "FAMILIES", "DEFAULT_KNOBS", "make_params",
           "default_params", "sample_params", "linearize", "evaluate",
           "DrOps", "TorchOps"]

K = 32
PARAM = dict(family=0, scale=1, offset=2, R=5, c0=14, c1=17, c2=20, a=23,
             rough0=27, rough1=28, bump=29, eps=30)
FAMILIES = ("plain", "wood", "marble", "granite", "stone", "checker")
OCTAVES = 4          # compile-time octave count of every fBm
DEFAULT_KNOBS = dict(plain=(0, 0, 0, 0), wood=(3.0, 0.3, 0.0, 0.25),
                     marble=(2.0, 0.7, 0.5, 0), granite=(15.0, 0.35, 0.15, 0),
                     stone=(1.0, 1.0, 0, 0), checker=(0, 0, 0, 0))
_COLORS = ("c0", "c1", "c2")


# ---------------------------------------------------------------- rows

def _family_index(family) -> int:
    f = FAMILIES.index(family) if isinstance(family, str) else int(family)
    if not 0 <= f < len(FAMILIES):
        raise ValueError(f"solid_texture: no family {family!r}")
    return f


def _quat_to_mat(q):
    """``[..., 4]`` xyzw unit quaternions -> ``[..., 3, 3]``."""
    x, y, z, w = (q[..., i] for i in range(4))
    return np.stack([
        1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
        2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
        2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
        -1).reshape(q.shape[:-1] + (3, 3))


def make_params(family="plain", *, colors=((0.8, 0.8, 0.8),), scale=10.0,
                rotation=None, offset=(0.0, 0.0, 0.0), knobs=None,
                roughness=0.5, bump=0.0, eps=0.02) -> np.ndarray:
    """One ``[K]`` parameter row. ``colors``: up to three sRGB colors (``c0``,
    ``c1``, ``c2``; missing ones repeat the last); ``rotation``: the
    body-local -> pattern rotation, ``[3, 3]`` or an xyzw quaternion
    (default identity); ``knobs``: ``a0..a3`` (default
    :data:`DEFAULT_KNOBS` of the family); ``roughness``: one value or
    ``(rough0, rough1)``; ``bump``: displacement amplitude in m (rendered by
    slots whose material has ``bump=True``)."""
    f = _family_index(family)
    row = np.zeros(K, np.float32)
    row[PARAM["family"]] = f
    row[PARAM["scale"]] = scale
    row[PARAM["offset"]:PARAM["offset"] + 3] = offset
    R = np.eye(3) if rotation is None else np.asarray(rotation, np.float64)
    if R.shape == (4,):
        R = _quat_to_mat(R / np.linalg.norm(R))
    row[PARAM["R"]:PARAM["R"] + 9] = R.reshape(9)
    cols = [np.asarray(c, np.float32).reshape(3) for c in colors]
    if not 1 <= len(cols) <= 3:
        raise ValueError("solid_texture: give one to three colors")
    cols += [cols[-1]] * (3 - len(cols))
    for name, c in zip(_COLORS, cols):
        row[PARAM[name]:PARAM[name] + 3] = c
    row[PARAM["a"]:PARAM["a"] + 4] = (DEFAULT_KNOBS[FAMILIES[f]]
                                      if knobs is None else knobs)
    r0, r1 = np.broadcast_to(np.asarray(roughness, np.float32), (2,))
    row[PARAM["rough0"]], row[PARAM["rough1"]] = r0, r1
    row[PARAM["bump"]], row[PARAM["eps"]] = bump, eps
    return row


def default_params(materials, instances: int) -> np.ndarray:
    """``[instances, M, K]``: every slot plain, in its material's base color
    and roughness (so a solid-texture slot looks like an ordinary one
    until its parameters are set)."""
    rows = np.stack([make_params("plain", colors=(m.base_color,),
                                 scale=1.0, roughness=m.roughness)
                     for m in materials]) if materials else np.zeros((0, K))
    return np.tile(rows[None].astype(np.float32), (int(instances), 1, 1))


def _hsv(h, s, v):
    """Vectorized HSV -> sRGB, ``[n, 3]``."""
    h = (h % 1.0) * 6.0
    i = np.floor(h).astype(int) % 6
    f = h - np.floor(h)
    p, q, t = v * (1 - s), v * (1 - s * f), v * (1 - s * (1 - f))
    table = np.stack([np.stack(c, -1) for c in (
        (v, t, p), (q, v, p), (p, v, t), (p, q, v), (t, p, v), (v, p, q))])
    return table[i, np.arange(len(h))]


def sample_params(rng, shape, families=("wood", "marble", "granite", "stone",
                                        "checker"), *, scale=(4.0, 25.0),
                  roughness=(0.2, 0.9), bump=(0.0, 0.0)) -> np.ndarray:
    """Random rows ``[*shape, K]`` (e.g. ``shape=(E, M)`` for every slot of
    every env): a family drawn uniformly from ``families``, ``scale``
    log-uniform in the given range (pattern units per meter), a uniformly
    random pattern rotation and noise offset, family-typical colors (wood
    mostly brown, marble light with darker veins, ...) and knobs,
    ``rough0`` uniform in ``roughness`` with ``rough1`` within 0.3 of it,
    ``bump`` uniform in the given range (m). ``rng``: a
    ``numpy.random.Generator``."""
    shape = tuple(np.atleast_1d(shape).tolist())
    n = int(np.prod(shape))
    fi = np.array([_family_index(f) for f in families])
    fam = fi[rng.integers(0, len(fi), n)]
    U = lambda lo, hi, *s: rng.uniform(lo, hi, (n,) + s)      # noqa: E731
    out = np.zeros((n, K), np.float32)
    out[:, PARAM["family"]] = fam
    out[:, PARAM["scale"]] = np.exp(U(np.log(scale[0]), np.log(scale[1])))
    out[:, PARAM["offset"]:PARAM["offset"] + 3] = U(0, 256, 3)
    q = rng.normal(size=(n, 4))
    out[:, PARAM["R"]:PARAM["R"] + 9] = _quat_to_mat(
        q / np.linalg.norm(q, axis=1, keepdims=True)).reshape(n, 9)
    h0 = U(0, 1)
    # every family's candidates are drawn for all rows (the stream does not
    # depend on which family a row got), then selected by family
    cand = {
        "any": (_hsv(h0, U(0, 1), U(0.1, 0.9)),
                _hsv(U(0, 1), U(0, 1), U(0.1, 0.9)), np.zeros((n, 4))),
        "wood": None, "marble": None, "granite": None, "stone": None}
    hue = np.where(U(0, 1) < 0.7, U(0.04, 0.11), U(0, 1))
    cand["wood"] = (_hsv(hue, U(0.3, 0.7), U(0.5, 0.85)),
                    _hsv(hue, U(0.5, 0.9), U(0.15, 0.45)),
                    np.stack([U(1.5, 5), U(0.1, 0.6), U(-3, 3), U(0.1, 0.4)], 1))
    cand["marble"] = (_hsv(h0, U(0, 0.25), U(0.75, 0.95)),
                      _hsv(h0 + U(-0.1, 0.1), U(0, 0.5), U(0.05, 0.45)),
                      np.stack([U(1, 4), U(0.3, 1.2), U(0, 1), 0 * h0], 1))
    cand["granite"] = (_hsv(h0, U(0, 0.3), U(0.4, 0.8)),
                       _hsv(h0 + 0.5, U(0, 0.4), U(0.05, 0.3)),
                       np.stack([U(8, 25), U(0.2, 0.5), U(0.05, 0.25), 0 * h0], 1))
    cand["stone"] = (_hsv(h0, U(0, 0.4), U(0.2, 0.5)),
                     _hsv(h0 + U(-0.1, 0.1), U(0, 0.4), U(0.5, 0.9)),
                     np.stack([U(0.5, 2), U(0.6, 1.5), 0 * h0, 0 * h0], 1))
    c0, c1, a = cand["any"]
    for name in ("wood", "marble", "granite", "stone"):
        m = (fam == FAMILIES.index(name))[:, None]
        c0, c1, a = (np.where(m, x, y) for x, y in zip(cand[name], (c0, c1, a)))
    out[:, PARAM["c0"]:PARAM["c0"] + 3] = c0
    out[:, PARAM["c1"]:PARAM["c1"] + 3] = c1
    out[:, PARAM["c2"]:PARAM["c2"] + 3] = _hsv(U(0, 1), U(0, 0.8), U(0.1, 0.9))
    out[:, PARAM["a"]:PARAM["a"] + 4] = a
    r0 = U(*roughness)
    out[:, PARAM["rough0"]] = r0
    out[:, PARAM["rough1"]] = np.clip(r0 + U(-0.3, 0.3), 0.05, 1.0)
    out[:, PARAM["bump"]] = U(*bump)
    out[:, PARAM["eps"]] = 0.02
    return out.reshape(shape + (K,))


def linearize(params):
    """Rows with their colors converted sRGB -> linear (numpy or torch; a
    copy): what renderers evaluate."""
    if hasattr(params, "detach"):
        out = params.clone()
    else:
        out = np.array(params, np.float32)
    for name in _COLORS:
        k = PARAM[name]
        c = out[..., k:k + 3]
        lin = c / 12.92
        hi = ((c.clamp(min=0) if hasattr(c, "detach") else np.maximum(c, 0))
              + 0.055) / 1.055
        out[..., k:k + 3] = (lin * (c <= 0.04045) + hi ** 2.4 * (c > 0.04045))
    return out


# ---------------------------------------------------------------- ops layers

class DrOps:
    """Dr.Jit arrays (``mi.Float`` / ``mi.UInt32``)."""

    def __init__(self, mi, dr):
        self.mi, self.dr = mi, dr
        self.F, self.U = mi.Float, mi.UInt32

    def u32_of_floor(self, x):
        dr, mi = self.dr, self.mi
        return dr.reinterpret_array(mi.UInt32, mi.Int32(dr.floor(x)))

    def u32(self, c):
        return self.U(c & 0xFFFFFFFF) if isinstance(c, int) else c

    def mul(self, a, b): return a * b
    def add(self, a, b): return a + b
    def xor(self, a, b): return a ^ b
    def shr(self, a, k): return a >> k
    def band(self, a, k): return a & k
    def eq(self, a, k): return a == k
    def lt_u(self, a, k): return a < k

    def unit(self, h):                       # uint32 -> [0, 1)
        return self.F(h >> 8) * (1.0 / 16777216.0)

    def floor(self, x): return self.dr.floor(x)
    def select(self, m, a, b): return self.dr.select(m, a, b)
    def sqrt(self, x): return self.dr.sqrt(x)
    def sin(self, x): return self.dr.sin(x)
    def abs(self, x): return self.dr.abs(x)
    def minimum(self, a, b): return self.dr.minimum(a, b)
    def clip(self, x, lo, hi): return self.dr.clip(x, lo, hi)
    def zeros_like(self, x): return self.dr.zeros(self.F, self.dr.width(x))
    def full_like(self, x, v): return self.dr.full(self.F, v, self.dr.width(x))


class TorchOps:
    """torch tensors; uint32 emulated in int64 (masked), multiplication
    split so that the product never overflows."""
    M = 0xFFFFFFFF

    def __init__(self, torch):
        self.t = torch

    def u32_of_floor(self, x):
        return self.t.floor(x).to(self.t.int64) & self.M

    def u32(self, c):
        return c & self.M if isinstance(c, int) else c

    def mul(self, a, b):
        lo = a * (b & 0xFFFF)
        hi = ((a * (b >> 16)) & self.M) << 16
        return (lo + hi) & self.M

    def add(self, a, b): return (a + b) & self.M
    def xor(self, a, b): return a ^ b
    def shr(self, a, k): return a >> k
    def band(self, a, k): return a & k
    def eq(self, a, k): return a == k
    def lt_u(self, a, k): return a < k
    def unit(self, h): return (h >> 8).to(self.t.float32) * (1.0 / 16777216.0)

    def floor(self, x): return self.t.floor(x)

    def select(self, m, a, b):
        t = self.t
        if not isinstance(a, t.Tensor):
            a = t.full_like(b, a)
        if not isinstance(b, t.Tensor):
            b = t.full_like(a, b)
        return t.where(m, a, b)

    def sqrt(self, x): return self.t.sqrt(x)
    def sin(self, x): return self.t.sin(x)
    def abs(self, x): return self.t.abs(x)

    def minimum(self, a, b):
        return (self.t.minimum(a, b) if isinstance(b, self.t.Tensor)
                else self.t.clamp(a, max=b))

    def clip(self, x, lo, hi): return self.t.clamp(x, lo, hi)
    def zeros_like(self, x): return self.t.zeros_like(x)
    def full_like(self, x, v): return self.t.full_like(x, v)


# ---------------------------------------------------------------- noise

def _fract(o, x): return x - o.floor(x)
def _lerp(a, b, t): return a + (b - a) * t
def _lerp3(c0, c1, t): return tuple(_lerp(a, b, t) for a, b in zip(c0, c1))


def _smooth(o, e0, e1, x):
    t = o.clip((x - e0) * (1.0 / (e1 - e0)), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def pcg3d(o, x, y, z):
    x = o.add(o.mul(x, 1664525), o.u32(1013904223))
    y = o.add(o.mul(y, 1664525), o.u32(1013904223))
    z = o.add(o.mul(z, 1664525), o.u32(1013904223))
    x = o.add(x, o.mul(y, z)); y = o.add(y, o.mul(z, x)); z = o.add(z, o.mul(x, y))  # noqa: E702
    x = o.xor(x, o.shr(x, 16)); y = o.xor(y, o.shr(y, 16)); z = o.xor(z, o.shr(z, 16))  # noqa: E702
    x = o.add(x, o.mul(y, z)); y = o.add(y, o.mul(z, x)); z = o.add(z, o.mul(x, y))  # noqa: E702
    return x, y, z


def _grad(o, h, x, y, z):
    h = o.band(h, 15)
    u = o.select(o.lt_u(h, 8), x, y)
    v = o.select(o.lt_u(h, 4), y, o.select(o.eq(h, 12) | o.eq(h, 14), x, z))
    return (o.select(o.eq(o.band(h, 1), 0), u, -u)
            + o.select(o.eq(o.band(h, 2), 0), v, -v))


def perlin(o, p):
    """Gradient noise, about -1..1."""
    fl = [o.floor(c) for c in p]
    f = [c - a for c, a in zip(p, fl)]
    i = [o.u32_of_floor(c) for c in p]
    w = [t * t * t * (t * (t * 6.0 - 15.0) + 10.0) for t in f]
    vals = []
    for dz in (0, 1):
        for dy in (0, 1):
            for dx in (0, 1):
                h, _, _ = pcg3d(o, o.add(i[0], o.u32(dx)),
                                o.add(i[1], o.u32(dy)), o.add(i[2], o.u32(dz)))
                vals.append(_grad(o, h, f[0] - dx, f[1] - dy, f[2] - dz))
    x00 = _lerp(vals[0], vals[1], w[0])
    x10 = _lerp(vals[2], vals[3], w[0])
    x01 = _lerp(vals[4], vals[5], w[0])
    x11 = _lerp(vals[6], vals[7], w[0])
    return _lerp(_lerp(x00, x10, w[1]), _lerp(x01, x11, w[1]), w[2])


def fbm(o, p, gain=0.5, lac=2.0, octaves=OCTAVES, turbulence=False):
    """Normalized fractal sum: about -1..1 (turbulence: 0..1)."""
    tot, amp, norm, s = None, 1.0, 0.0, 1.0
    for _ in range(octaves):
        n = perlin(o, tuple(c * s for c in p))
        if turbulence:
            n = o.abs(n)
        tot = n * amp if tot is None else tot + n * amp
        norm += amp
        amp *= gain
        s *= lac
    return tot * (1.0 / norm)


def worley(o, p):
    """(F1, F2, uint32 hash of the nearest cell)."""
    fl = [o.floor(c) for c in p]
    f = [c - a for c, a in zip(p, fl)]
    i = [o.u32_of_floor(c) for c in p]
    F1 = o.full_like(p[0], 8.0)
    F2 = o.full_like(p[0], 8.0)
    cid = None
    for dz in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                hx, hy, hz = pcg3d(o, o.add(i[0], o.u32(dx)),
                                   o.add(i[1], o.u32(dy)),
                                   o.add(i[2], o.u32(dz)))
                ddx = dx + o.unit(hx) - f[0]
                ddy = dy + o.unit(hy) - f[1]
                ddz = dz + o.unit(hz) - f[2]
                d = ddx * ddx + ddy * ddy + ddz * ddz
                closer = d < F1
                F2 = o.select(closer, F1, o.minimum(F2, d))
                cid = hz if cid is None else o.select(closer, hz, cid)
                F1 = o.select(closer, d, F1)
    return o.sqrt(F1), o.sqrt(F2), cid


# ---------------------------------------------------------------- families
# Each takes the pattern point q and a parameter accessor P(k) (k an index
# into the row, colors already linear), and returns (h in 0..1, linear rgb).

def _c(P, name):
    k = PARAM[name]
    return (P(k), P(k + 1), P(k + 2))


def _off(q, P, k=1.0):
    """Noise lookup point: the offset applies to noise only, so that ring
    centers stay near the body and fract() keeps its fp32 precision."""
    return tuple(c * k + P(PARAM["offset"] + i) for i, c in enumerate(q))


def fam_plain(o, q, P):
    return o.zeros_like(q[0]), _c(P, "c0")


def fam_wood(o, q, P):
    a0, a1, a2, a3 = (P(PARAM["a"] + k) for k in range(4))
    x = q[0] + a2
    r = o.sqrt(x * x + q[1] * q[1])
    qo = _off(q, P)
    warp = fbm(o, (qo[0] * 0.8, qo[1] * 0.8, qo[2] * 0.12), octaves=3)
    t = _fract(o, (r + a1 * warp) * a0)
    ring = _smooth(o, 0.0, 0.85, t) * (1.0 - _smooth(o, 0.85, 1.0, t))
    ring = ring * ring
    fib = fbm(o, (qo[0] * 14.0, qo[1] * 14.0, qo[2] * 0.7), octaves=2)
    h = o.clip(ring * (1.0 - a3) + (fib * 0.5 + 0.5) * a3, 0.0, 1.0)
    return h, _lerp3(_c(P, "c0"), _c(P, "c1"), h)


def fam_marble(o, q, P):
    a0, a1, a2 = (P(PARAM["a"] + k) for k in range(3))
    qo = _off(q, P)
    turb = fbm(o, qo, turbulence=True)
    s = 0.5 + 0.5 * o.sin(q[0] * a0 + a1 * turb * 6.0)
    v = o.clip(1.0 - s, 0.0, 1.0)
    v2 = v * v
    vein = v2 * v2 * v2 * a2 + v2 * (1.0 - a2)
    tint = fbm(o, (qo[0] * 0.5 + 7.0, qo[1] * 0.5, qo[2] * 0.5),
               octaves=2) * 0.5 + 0.5
    base = _lerp3(_c(P, "c0"), _c(P, "c2"), tint * 0.35)
    return vein, _lerp3(base, _c(P, "c1"), vein)


def fam_granite(o, q, P):
    a0, a1, a2 = (P(PARAM["a"] + k) for k in range(3))
    F1, F2, cid = worley(o, _off(q, P, a0))
    u = o.unit(cid)
    col = _c(P, "c0")
    col = tuple(o.select(u < a1, b, a) for a, b in zip(col, _c(P, "c1")))
    col = tuple(o.select(u > 1.0 - a2, b, a) for a, b in zip(col, _c(P, "c2")))
    edge = _smooth(o, 0.0, 0.12, F2 - F1)            # dark grain boundaries
    shade = 0.75 + 0.25 * edge
    return 1.0 - edge, tuple(c * shade for c in col)


def fam_stone(o, q, P):
    a0, a1 = P(PARAM["a"]), P(PARAM["a"] + 1)
    q = _off(q, P)
    w = (fbm(o, (q[0] + 1.7, q[1] + 9.2, q[2]), octaves=3),
         fbm(o, (q[0] + 8.3, q[1] + 2.8, q[2] + 4.1), octaves=3),
         fbm(o, (q[0] + 4.4, q[1] + 6.6, q[2] + 1.3), octaves=3))
    n = fbm(o, tuple(c + a0 * d for c, d in zip(q, w)))
    h = o.clip(0.5 + a1 * n, 0.0, 1.0)
    col = _lerp3(_c(P, "c0"), _c(P, "c1"), h)
    spot = _smooth(o, 0.55, 0.75, fbm(o, (q[0] * 3.0, q[1] * 3.0, q[2] * 3.0),
                                      octaves=2) * 0.5 + 0.5)
    return h, _lerp3(col, _c(P, "c2"), spot * 0.6)


def fam_checker(o, q, P):
    s = o.floor(q[0]) + o.floor(q[1]) + o.floor(q[2])
    odd = (s - 2.0 * o.floor(s * 0.5)) > 0.5
    h = o.select(odd, o.full_like(q[0], 1.0), o.zeros_like(q[0]))
    return h, tuple(o.select(odd, b, a)
                    for a, b in zip(_c(P, "c0"), _c(P, "c1")))


FAMILY_FNS = (fam_plain, fam_wood, fam_marble, fam_granite, fam_stone,
              fam_checker)


def pattern_point(o, p, P):
    """q = R @ (scale * p), p body-local."""
    s = P(PARAM["scale"])
    R = [P(PARAM["R"] + k) for k in range(9)]
    ps = tuple(c * s for c in p)
    return tuple(R[3 * r] * ps[0] + R[3 * r + 1] * ps[1] + R[3 * r + 2] * ps[2]
                 for r in range(3))


def evaluate(points, params):
    """The torch reference: ``points`` ``[N, 3]`` body-local (m) and their
    rows ``params`` ``[N, K]`` (as stored: sRGB) -> ``(h [N], linear rgb
    [N, 3])``. Each point's own family is evaluated (all families are
    computed, then selected)."""
    import torch
    o = TorchOps(torch)
    p = tuple(points[:, i].float() for i in range(3))
    rows = linearize(params.float())
    P = lambda k: rows[:, k]                                  # noqa: E731
    fam = rows[:, PARAM["family"]].round().long().clamp(0, len(FAMILIES) - 1)
    q = pattern_point(o, p, P)
    h = torch.zeros_like(p[0])
    rgb = torch.zeros(len(h), 3, device=h.device)
    for f, fn in enumerate(FAMILY_FNS):
        m = fam == f
        if bool(m.any()):
            hf, cf = fn(o, q, P)
            h = torch.where(m, hf, h)
            rgb = torch.where(m[:, None], torch.stack(cf, -1), rgb)
    return h, rgb
