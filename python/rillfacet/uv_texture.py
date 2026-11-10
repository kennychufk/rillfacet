"""Procedural UV (2D) textures: the backend-neutral spec.

A material slot with ``uv_texture=True``
(:class:`~rillfacet.scene_api.Material`) can take its base color and
roughness (optionally also a bump) from a UV texture: a 2D pattern
evaluated at the mesh's METRIC UVs (:attr:`RigidMesh.metric_uvs`: UVs
rescaled per mesh primitive so that one unit is one meter on the surface,
:func:`rillfacet.assets.metric_uvs`), so a pattern's scale is pattern units
per METER, the same on every mesh and level of detail. Unlike solid
textures (:mod:`rillfacet.solid_texture`) it needs UVs: on an unwrapped
mesh it follows the charts (seams and orientation changes between charts
show), on a primitive (:mod:`rillfacet.primitives`) the faces. Each
instance (env) has its own row of :data:`K` parameters per slot
(``RigidMesh.material_uv_texture`` ``[I, M, K]``, set with
``RigidMesh.set_materials(uv_texture=...)``). A row of family ``none``
(the default) leaves the slot to its solid texture (if it is also a
solid-texture slot) or its ordinary material, so a slot can be plain,
solid- or UV-textured per instance. :func:`make_params` builds a row,
:func:`sample_params` draws random ones.

Families (:data:`FAMILIES`, grouped in :data:`GROUPS`), knobs ``a0..a3``
and ``b0..b3``; one pattern unit is one cell / period:

- ``none``: not a UV texture (see above).
- regular: ``stripes`` (bands along pattern x of period 1: ``a0`` the
  fraction in ``c1``, ``a1`` / ``a2`` amplitude (pattern units) and angular
  frequency of a waviness along y, ``b0`` the width of a ``c2`` pinstripe
  centered in the ``c0`` band, 0 = none); ``tiles`` (cells 1 x ``b0`` in
  ``c0``..``c2`` (``a2`` color variation per tile) with ``c1`` grout of
  half width ``a0``, rows shifted by ``a1`` cells: 0 a grid, 0.5 running
  bond); ``dots`` (one ``c1`` dot per cell on ``c0``, rows shifted by
  ``b0``: radius ``a0``, position jitter ``a1`` (0..1 of the free room),
  radius variation ``a2``, fraction of ``c2`` dots ``a3``); ``hexagons``
  (unit-inradius-0.5 hexagons in ``c0``..``c2`` (``a1`` variation), ``c1``
  borders of half width ``a0``).
- material-like: ``weave`` (plain-weave fabric, one thread per unit, warp
  ``c0`` along y over weft ``c1`` on alternate cells: ``a0`` gap between
  threads, ``a1`` fiber noise, ``a2`` shading depth); ``brushed`` (brushed
  metal, streak noise stretched along pattern x: ``a0`` contrast toward
  ``c1``, ``a1`` / ``a2`` the noise frequency along x / y); ``perforated``
  (``c0`` sheet with ``c1`` holes of radius ``a0``, rows shifted by
  ``b0``); ``twill`` (2 x 2 twill carbon fiber, one tow per unit: ``a0``
  fibers per tow, ``a1`` how much darker the weft tows are, ``a2`` tow
  edge width; ``c0`` sheen, ``c1`` dark).
- decals: ``decals`` (rectangles, one per cell with probability ``a0``,
  half sizes ``a1``..``a2``, corner radius ``a3``, ``c1`` or ``c2`` on
  ``c0``); ``glyphs`` (text-like lines of segment glyphs, line height 1,
  glyph cell width ``b0``, ``b1`` glyphs per column (an integer), stroke
  width ``a2``, blank lines ``a0``, word gaps ``a1``; ``c1`` ink on ``c0``);
  ``stickers`` (rounded squares to discs, one per cell with probability
  ``a0``, half size ``a1``..``a2``, roundness ``b1`` (1 = disc), a ``c2``
  border of ``a3`` of the half size around a ``c1`` fill).

Every family also returns a height ``h`` in 0..1 (``1`` raised: stripes,
tiles, dots, threads, ...): roughness is ``lerp(rough0, rough1, h)`` and a
bump displaces the surface by ``bump * h`` (m) along its normal.

Row layout (:data:`PARAM`): ``family``, ``scale`` (pattern units per
meter), ``offset[2]`` (pattern units), ``rot[2]`` (cos, sin of the pattern
rotation), ``seed`` (an integer below 2^24 as a float: the cells' random
draws), ``b[4]``, three spares, ``c0[3]``, ``c1[3]``, ``c2[3]`` (sRGB,
renderers interpolate in linear), ``a[4]``, ``rough0``, ``rough1``,
``bump`` (m), ``eps`` (the bump's finite-difference step, a fraction of a
pattern unit), one spare: colors, knobs ``a``, roughness and bump at the
indices of the solid texture rows (:data:`rillfacet.solid_texture.PARAM`),
so :func:`~rillfacet.solid_texture.linearize` serves both. The pattern
point of a metric UV ``u`` is ``q = Rot @ (scale * u) + offset``.

Renderers draw both kinds through one row per (instance, slot)
(:func:`render_rows`), a UV row's family shifted by
:data:`RENDER_FAMILY_OFFSET`. The families are written over the array-ops
layer of :mod:`rillfacet.solid_texture` (:class:`~rillfacet.solid_texture.DrOps`
in Mitsuba, :class:`~rillfacet.solid_texture.TorchOps` in :func:`evaluate`,
the reference the renderers are tested against) with its hash and noise;
the raster backend's ``shaders/common/uv_texture.wgsl`` and the Cycles
backend's OSL are line-by-line ports.

Filtering: a renderer that shades one point per pixel (raster) passes the
pixel's footprint ``fw`` (pattern units). Edges are smoothed over one
footprint, stripes and the tiles' grout box filtered exactly, and every
detail whose size falls below about 2 footprints (dots, glyphs, threads,
fibers, ...) fades toward its mean, fully at 1. ``fw = 0`` (Mitsuba,
Cycles) evaluates the unfiltered pattern.
"""
from __future__ import annotations

import math

import numpy as np

from . import solid_texture as sx
from .solid_texture import (TorchOps, _fade, _fract, _lerp, _lerp3,
                            _smooth, _unfiltered, fbm, linearize, pcg3d,
                            perlin)

__all__ = ["K", "PARAM", "FAMILIES", "GROUPS", "RENDER_FAMILY_OFFSET",
           "make_params", "default_params", "sample_params", "families_of",
           "render_rows", "uv_gradients", "evaluate", "linearize"]

K = 32
PARAM = dict(family=0, scale=1, offset=2, rot=4, seed=6, b=7, c0=14, c1=17,
             c2=20, a=23, rough0=27, rough1=28, bump=29, eps=30)
FAMILIES = ("none", "stripes", "tiles", "dots", "hexagons", "weave",
            "brushed", "perforated", "twill", "decals", "glyphs", "stickers")
GROUPS = dict(regular=("stripes", "tiles", "dots", "hexagons"),
              material=("weave", "brushed", "perforated", "twill"),
              decal=("decals", "glyphs", "stickers"))
#: Renderers' rows: a UV row's family is stored as this plus its index.
RENDER_FAMILY_OFFSET = 64
SQRT3 = 1.7320508075688772
_COLORS = ("c0", "c1", "c2")
# a, b knobs of make_params' defaults
DEFAULT_KNOBS = dict(
    none=((0, 0, 0, 0), (0, 0, 0, 0)),
    stripes=((0.5, 0.0, 0.0, 0), (0.0, 0, 0, 0)),
    tiles=((0.04, 0.5, 0.3, 0), (0.5, 0, 0, 0)),
    dots=((0.3, 0.5, 0.2, 0.2), (0.5, 0, 0, 0)),
    hexagons=((0.05, 0.4, 0, 0), (0, 0, 0, 0)),
    weave=((0.15, 0.2, 0.5, 0), (0, 0, 0, 0)),
    brushed=((0.4, 0.05, 8.0, 0), (0, 0, 0, 0)),
    perforated=((0.3, 0, 0, 0), (0.5, 0, 0, 0)),
    twill=((8.0, 0.4, 0.1, 0), (0, 0, 0, 0)),
    decals=((0.5, 0.15, 0.4, 0.04), (0, 0, 0, 0)),
    glyphs=((0.2, 0.15, 0.08, 0), (0.55, 16, 0, 0)),
    stickers=((0.5, 0.25, 0.42, 0.2), (0, 0.6, 0, 0)))
#: sample_params' scale range is multiplied by this per family (threads
#: and glyphs are finer than tiles).
SCALE_FACTOR = dict(none=1.0, stripes=1.0, tiles=1.0, dots=1.5, hexagons=1.0,
                    weave=8.0, brushed=1.0, perforated=3.0, twill=4.0,
                    decals=0.6, glyphs=3.0, stickers=0.6)
# means of filtered-out details
WEAVE_H_MEAN = 0.5
GLYPH_SEGMENTS = 9


# ---------------------------------------------------------------- rows

def _family_index(family) -> int:
    f = FAMILIES.index(family) if isinstance(family, str) else int(family)
    if not 0 <= f < len(FAMILIES):
        raise ValueError(f"uv_texture: no family {family!r}")
    return f


def families_of(names) -> tuple:
    """Family names from family and group names (:data:`GROUPS`), in
    order, without repeats."""
    out = []
    for n in names:
        for f in GROUPS.get(n, (n,)):
            _family_index(f)
            if f not in out:
                out.append(f)
    return tuple(out)


def make_params(family="none", *, colors=((0.8, 0.8, 0.8),), scale=10.0,
                rotation=0.0, offset=(0.0, 0.0), seed=0, knobs=None,
                knobs_b=None, roughness=0.5, bump=0.0,
                eps=0.02) -> np.ndarray:
    """One ``[K]`` parameter row. ``colors``: up to three sRGB colors (``c0``,
    ``c1``, ``c2``; missing ones repeat the last); ``rotation``: the pattern
    rotation (rad); ``knobs`` / ``knobs_b``: ``a0..a3`` / ``b0..b3``
    (default :data:`DEFAULT_KNOBS` of the family); ``roughness``: one value
    or ``(rough0, rough1)``; ``bump``: displacement amplitude in m (rendered
    by slots whose material has ``bump=True``)."""
    f = _family_index(family)
    row = np.zeros(K, np.float32)
    row[PARAM["family"]] = f
    row[PARAM["scale"]] = scale
    row[PARAM["offset"]:PARAM["offset"] + 2] = offset
    row[PARAM["rot"]], row[PARAM["rot"] + 1] = (math.cos(rotation),
                                                math.sin(rotation))
    row[PARAM["seed"]] = int(seed) % (1 << 24)
    cols = [np.asarray(c, np.float32).reshape(3) for c in colors]
    if not 1 <= len(cols) <= 3:
        raise ValueError("uv_texture: give one to three colors")
    cols += [cols[-1]] * (3 - len(cols))
    for name, c in zip(_COLORS, cols):
        row[PARAM[name]:PARAM[name] + 3] = c
    da, db = DEFAULT_KNOBS[FAMILIES[f]]
    row[PARAM["a"]:PARAM["a"] + 4] = da if knobs is None else knobs
    row[PARAM["b"]:PARAM["b"] + 4] = db if knobs_b is None else knobs_b
    r0, r1 = np.broadcast_to(np.asarray(roughness, np.float32), (2,))
    row[PARAM["rough0"]], row[PARAM["rough1"]] = r0, r1
    row[PARAM["bump"]], row[PARAM["eps"]] = bump, eps
    return row


def default_params(materials, instances: int) -> np.ndarray:
    """``[instances, M, K]``: every slot ``none`` (no UV texture)."""
    rows = np.tile(make_params("none"), (len(materials), 1))
    return np.tile(rows[None], (int(instances), 1, 1)).astype(np.float32)


def _hsv(h, s, v):
    return sx._hsv(h, s, v)


def sample_params(rng, shape, families=GROUPS["regular"] + GROUPS["material"]
                  + GROUPS["decal"], *, scale=(5.0, 30.0),
                  roughness=(0.2, 0.9), bump=(0.0, 0.0)) -> np.ndarray:
    """Random rows ``[*shape, K]`` (e.g. ``shape=(E, M)``): a family drawn
    uniformly from ``families`` (names or :data:`GROUPS` names),
    ``scale`` log-uniform in the given range times the family's
    :data:`SCALE_FACTOR` (pattern units per meter), a uniformly random
    rotation, offset and seed, family-typical colors (brushed metal grays,
    dark carbon fiber, light labels with dark ink, ...) and knobs,
    ``rough0`` uniform in ``roughness`` with ``rough1`` within 0.3 of it
    (brushed metal and carbon fiber: shinier), ``bump`` uniform in the
    given range (m). ``rng``: a ``numpy.random.Generator``. A row's draws
    do not depend on its family: every row draws the same numbers."""
    shape = tuple(np.atleast_1d(shape).tolist())
    n = int(np.prod(shape))
    names = families_of(families)
    fi = np.array([_family_index(f) for f in names])
    fam = fi[rng.integers(0, len(fi), n)]
    u = rng.uniform(0, 1, (n, 28))           # every row: the same draws
    U = lambda k, lo, hi: lo + (hi - lo) * u[:, k]            # noqa: E731
    out = np.zeros((n, K), np.float32)
    out[:, PARAM["family"]] = fam
    factor = np.array([SCALE_FACTOR[FAMILIES[f]] for f in fam])
    out[:, PARAM["scale"]] = factor * np.exp(U(0, np.log(scale[0]),
                                               np.log(scale[1])))
    out[:, PARAM["offset"]] = U(1, 0, 64)
    out[:, PARAM["offset"] + 1] = U(2, 0, 64)
    ang = U(3, 0, 2 * np.pi)
    out[:, PARAM["rot"]], out[:, PARAM["rot"] + 1] = np.cos(ang), np.sin(ang)
    out[:, PARAM["seed"]] = np.floor(U(4, 0, 1 << 24))
    hue = u[:, 5]
    # generic contrasting colors, then per family
    c0 = _hsv(hue, U(6, 0, 1), U(7, 0.15, 0.95))
    c1 = _hsv(hue + U(8, 0.25, 0.75), U(9, 0, 1), U(10, 0.1, 0.9))
    c2 = _hsv(u[:, 11], U(12, 0.2, 1), U(13, 0.2, 0.95))
    a = np.zeros((n, 4))
    b = np.zeros((n, 4))
    r0 = U(14, *roughness)
    r1 = np.clip(r0 + U(15, -0.3, 0.3), 0.05, 1.0)
    k1, k2, k3, k4 = (u[:, 16 + i] for i in range(4))
    stagger = np.where(u[:, 20] < 0.5, 0.0, 0.5)
    m = lambda name: fam == FAMILIES.index(name)              # noqa: E731

    def put(name, aa, bb=None):
        sel = m(name)
        a[sel] = np.stack(aa, 1)[sel]
        if bb is not None:
            b[sel] = np.stack(bb, 1)[sel]
    z = np.zeros(n)
    put("stripes", (0.2 + 0.6 * k1, np.where(k2 < 0.5, 0, 0.3 * k3),
                    0.5 + 3 * k4, z), (np.where(u[:, 20] < 0.5, 0,
                                                0.04 + 0.08 * k3), z, z, z))
    ar = 0.3 + 0.7 * k4
    put("tiles", (0.01 + 0.07 * k1 * ar, np.where(k2 < 0.5, 0, 0.5) +
                  np.where(k2 > 0.9, 0.25, 0), 0.6 * k3, z), (ar, z, z, z))
    put("dots", (0.15 + 0.3 * k1, k2, 0.5 * k3, 0.5 * k4), (stagger, z, z, z))
    put("hexagons", (0.02 + 0.08 * k1, 0.8 * k2, z, z))
    put("weave", (0.05 + 0.25 * k1, 0.4 * k2, 0.3 + 0.4 * k3, z))
    put("brushed", (0.2 + 0.6 * k1, 0.01 + 0.09 * k2, 4 + 16 * k3, z))
    put("perforated", (0.15 + 0.27 * k1, z, z, z), (stagger, z, z, z))
    put("twill", (4 + 8 * k1, 0.2 + 0.5 * k2, 0.04 + 0.16 * k3, z))
    put("decals", (0.2 + 0.6 * k1, 0.08 + 0.12 * k2, 0.25 + 0.2 * k3,
                   0.08 * k4))
    put("glyphs", (0.4 * k1, 0.1 + 0.15 * k2, 0.06 + 0.06 * k3, z),
        (0.45 + 0.2 * k4, np.floor(8 + 17 * u[:, 20]), z, z))
    put("stickers", (0.2 + 0.6 * k1, 0.15 + 0.15 * k2, 0.3 + 0.15 * k3,
                     0.1 + 0.2 * k4), (z, 0.3 + 0.7 * u[:, 20], z, z))
    # family-typical colors
    gray = U(21, 0.45, 0.9)
    tint = _hsv(hue, U(22, 0, 0.15), gray)
    sel = m("brushed")
    c0[sel] = tint[sel]
    c1[sel] = (tint * U(23, 0.5, 0.85)[:, None])[sel]
    r0[sel] = U(14, 0.15, 0.45)[sel]
    r1[sel] = np.clip(r0 + U(15, 0.05, 0.3), 0.05, 1.0)[sel]
    sel = m("perforated")
    c0[sel] = _hsv(hue, U(6, 0, 0.6), U(7, 0.4, 0.95))[sel]
    c1[sel] = _hsv(hue, U(9, 0, 0.3), U(10, 0.01, 0.12))[sel]
    sel = m("twill")
    c0[sel] = _hsv(hue, U(22, 0, 0.2), U(21, 0.25, 0.5))[sel]
    c1[sel] = _hsv(hue, U(22, 0, 0.2), U(23, 0.01, 0.06))[sel]
    r0[sel] = U(14, 0.1, 0.35)[sel]
    r1[sel] = np.clip(r0 + U(15, 0.0, 0.25), 0.05, 1.0)[sel]
    sel = m("glyphs")
    paper = U(21, 0.7, 0.97)
    c0[sel] = _hsv(hue, U(22, 0, 0.25), paper)[sel]
    c1[sel] = _hsv(u[:, 11], U(12, 0, 0.8), U(23, 0.02, 0.3))[sel]
    sel = m("decals") | m("stickers")
    c1[sel] = _hsv(hue + U(8, 0.25, 0.75), U(9, 0.5, 1), U(10, 0.5, 1))[sel]
    out[:, PARAM["c0"]:PARAM["c0"] + 3] = c0
    out[:, PARAM["c1"]:PARAM["c1"] + 3] = c1
    out[:, PARAM["c2"]:PARAM["c2"] + 3] = c2
    out[:, PARAM["a"]:PARAM["a"] + 4] = a
    out[:, PARAM["b"]:PARAM["b"] + 4] = b
    out[:, PARAM["rough0"]] = r0
    out[:, PARAM["rough1"]] = r1
    out[:, PARAM["bump"]] = U(24, *bump)
    out[:, PARAM["eps"]] = 0.02
    return out.reshape(shape + (K,))


def render_rows(mesh) -> tuple:
    """``(slots, rows)``: the textured slots of a rigid mesh (solid- or
    UV-texture materials) and their rows ``[I, len(slots), K]`` as
    renderers draw them, colors linear: per (instance, slot) its UV row
    when the slot is a UV-texture slot and the row's family is not
    ``none`` (the family plus :data:`RENDER_FAMILY_OFFSET`), else its
    solid texture row (solid-texture slots), else a plain solid row in the
    instance's base color and roughness."""
    mats = mesh.materials
    slots = [s for s, m in enumerate(mats)
             if m.solid_texture or getattr(m, "uv_texture", False)]
    I = mesh.instances
    if not slots:
        return slots, np.zeros((I, 0, K), np.float32)
    sl = np.array(slots)
    P = sx.PARAM
    rows = np.zeros((I, len(slots), K), np.float32)
    rows[..., P["scale"]] = 1.0
    rows[..., P["R"]:P["R"] + 9] = np.eye(3, dtype=np.float32).ravel()
    for name in _COLORS:
        rows[..., P[name]:P[name] + 3] = mesh.material_base_color[:, sl]
    rows[..., P["rough0"]] = rows[..., P["rough1"]] = \
        mesh.material_roughness[:, sl]
    solid = np.array([mats[s].solid_texture for s in slots])
    if solid.any():
        rows[:, solid] = mesh.material_solid_texture[:, sl[solid]]
    uv = np.array([getattr(mats[s], "uv_texture", False) for s in slots])
    if uv.any() and getattr(mesh, "material_uv_texture", None) is not None:
        urows = mesh.material_uv_texture[:, sl]
        on = uv[None] & (np.rint(urows[..., PARAM["family"]]) > 0)
        urows = urows.copy()
        urows[..., PARAM["family"]] += RENDER_FAMILY_OFFSET
        rows = np.where(on[..., None], urows, rows)
    return slots, linearize(rows)


def uv_gradients(vertices, triangles, uvs, *, edge_basis=False):
    """Per triangle, the surface gradients of the (metric) u and v: two
    ``[T, 3]`` arrays, vectors in the frame of ``vertices`` (what a UV
    texture's bump needs: ``grad h = dh/du grad u + dh/dv grad v``). With
    ``edge_basis``, their coefficients ``(alpha, beta, 0)`` in the
    triangle's edge basis instead (``alpha * e1 + beta * e2``, e1 / e2 the
    edges from its first vertex), which carry over to any rigidly moved
    copy of the triangle. Degenerate triangles and non-finite UVs: 0."""
    p = np.asarray(vertices, np.float64)[np.asarray(triangles, np.int64)]
    t = np.nan_to_num(np.asarray(uvs, np.float64))[np.asarray(triangles,
                                                              np.int64)]
    e1, e2 = p[:, 1] - p[:, 0], p[:, 2] - p[:, 0]
    d1, d2 = t[:, 1] - t[:, 0], t[:, 2] - t[:, 0]           # [T, 2]
    g11 = (e1 * e1).sum(1)
    g12 = (e1 * e2).sum(1)
    g22 = (e2 * e2).sum(1)
    det = g11 * g22 - g12 * g12
    ok = det > 1e-12 * g11 * g22
    inv = np.where(ok, 1.0 / np.where(ok, det, 1.0), 0.0)
    out = []
    for c in (0, 1):
        a = (g22 * d1[:, c] - g12 * d2[:, c]) * inv
        b = (g11 * d2[:, c] - g12 * d1[:, c]) * inv
        g = (np.stack([a, b, np.zeros_like(a)], 1) if edge_basis
             else a[:, None] * e1 + b[:, None] * e2)
        out.append(g.astype(np.float32))
    return out[0], out[1]


# ---------------------------------------------------------------- helpers

def _c(P, name):
    k = PARAM[name]
    return (P(k), P(k + 1), P(k + 2))


def _knobs(P, name="a"):
    return tuple(P(PARAM[name] + k) for k in range(4))


def _one(o, like):
    return o.full_like(like, 1.0)


def _cover(o, d, fw):
    """Coverage of ``d >= 0`` (``d`` a signed distance in pattern units,
    positive inside), smoothed over one footprint."""
    if _unfiltered(fw):
        return o.select(d >= 0.0, _one(o, d), o.zeros_like(d))
    return o.clip(d / o.maximum(fw, 1e-6) + 0.5, 0.0, 1.0)


def _pulse(o, x, lo, width, fw):
    """Coverage of ``fract(x - lo) < width`` (``width`` in 0..1), box
    filtered over ``fw``: the difference of its integral."""
    if _unfiltered(fw):
        y = _fract(o, x - lo)
        return o.select(y < width, _one(o, y), o.zeros_like(y))
    w = o.maximum(fw, 1e-2)
    xr = _fract(o, x) - lo           # the integral is periodic + linear

    def F(y):
        fl = o.floor(y)
        return fl * width + o.minimum(y - fl, width)
    return o.clip((F(xr + 0.5 * w) - F(xr - 0.5 * w)) / w, 0.0, 1.0)


def _seed(o, P):
    return o.u32_of_floor(P(PARAM["seed"]))


def _cell_hash(o, x, y, seed):
    return pcg3d(o, o.u32_of_floor(x), o.u32_of_floor(y), seed)


def _rand2(o, h):
    """Two more uniforms of a hash word."""
    return (o.unit(o.mul(h, 0x27D4EB2D)),
            o.unit(o.mul(o.xor(h, o.shr(h, 15)), 0x165667B1)))


def _round_box(o, px, py, hx, hy, r):
    """Signed distance to a rounded box (half sizes ``hx``, ``hy``, corner
    radius ``r``) centered at 0, negative inside."""
    qx = o.abs(px) - hx + r
    qy = o.abs(py) - hy + r
    mx, my = o.maximum(qx, 0.0), o.maximum(qy, 0.0)
    return (o.sqrt(mx * mx + my * my)
            + o.minimum(o.maximum(qx, qy), 0.0) - r)


def _mean_fade(o, fw, f, mean, value):
    """``value`` faded toward ``mean`` for a detail of frequency ``f``
    (per pattern unit)."""
    if _unfiltered(fw):
        return value
    return _lerp(mean, value, _fade(o, fw * f))


def _mean_fade3(o, fw, f, mean, value):
    if _unfiltered(fw):
        return value
    w = _fade(o, fw * f)
    return _lerp3(mean, value, w)


# ---------------------------------------------------------------- families
# Each takes the pattern point q (2-tuple), a parameter accessor P(k)
# (colors already linear) and the footprint fw (pattern units), and returns
# (h in 0..1, linear rgb).

def fam_none(o, q, P, fw=0.0):
    return o.zeros_like(q[0]), _c(P, "c0")


def fam_stripes(o, q, P, fw=0.0):
    a0, a1, a2, _ = _knobs(P)
    b0 = P(PARAM["b"])
    x = q[0] + a1 * o.sin(q[1] * a2)
    s1 = _pulse(o, x, 0.0, a0, fw)
    s2 = _pulse(o, x, a0 + 0.5 * (1.0 - a0) - 0.5 * b0, b0, fw)
    col = _lerp3(_lerp3(_c(P, "c0"), _c(P, "c1"), s1), _c(P, "c2"), s2)
    return o.clip(s1 + 0.5 * s2, 0.0, 1.0), col


def fam_tiles(o, q, P, fw=0.0):
    a0, a1, a2, _ = _knobs(P)
    ar = P(PARAM["b"])
    y = q[1] / ar
    j = o.floor(y)
    x = q[0] + a1 * j
    cx = _pulse(o, x, a0, 1.0 - 2.0 * a0, fw)
    cy = _pulse(o, y, a0 / ar, 1.0 - 2.0 * a0 / ar,
                fw if _unfiltered(fw) else fw / ar)
    t = cx * cy
    hx, _, _ = _cell_hash(o, x, y, _seed(o, P))
    c0, c2 = _c(P, "c0"), _c(P, "c2")
    tile = _lerp3(c0, c2, a2 * o.unit(hx))
    if not _unfiltered(fw):    # tiles below the footprint: their mean
        tile = _mean_fade3(o, fw, 1.0 / o.minimum(ar, 1.0),
                           _lerp3(c0, c2, 0.5 * a2), tile)
    return t, _lerp3(_c(P, "c1"), tile, t)


def _disc_cell(o, q, P, r, jitter, rvar, stagger, fw):
    """A disc per cell (rows shifted by ``stagger``): (coverage, hash
    word for the disc's draws)."""
    y = q[1]
    x = q[0] + stagger * o.floor(y)
    hx, hy, hz = _cell_hash(o, x, y, _seed(o, P))
    rr = r * (1.0 - rvar * o.unit(hz))
    room = 0.5 - rr
    cx = 0.5 + jitter * room * (2.0 * o.unit(hx) - 1.0)
    cy = 0.5 + jitter * room * (2.0 * o.unit(hy) - 1.0)
    dx, dy = _fract(o, x) - cx, _fract(o, y) - cy
    return _cover(o, rr - o.sqrt(dx * dx + dy * dy), fw), hz


def fam_dots(o, q, P, fw=0.0):
    a0, a1, a2, a3 = _knobs(P)
    cov, hz = _disc_cell(o, q, P, a0, a1, a2, P(PARAM["b"]), fw)
    c1, c2 = _c(P, "c1"), _c(P, "c2")
    pick = o.unit(o.mul(hz, 0x27D4EB2D)) < a3
    dot = tuple(o.select(pick, b, a) for a, b in zip(c1, c2))
    if not _unfiltered(fw):    # dots below the footprint: their mean
        mr = a0 * (1.0 - 0.5 * a2)
        cov = _mean_fade(o, fw, 1.0, math.pi * mr * mr, cov)
        dot = _mean_fade3(o, fw, 1.0, _lerp3(c1, c2, a3), dot)
    return cov, _lerp3(_c(P, "c0"), dot, cov)


def fam_perforated(o, q, P, fw=0.0):
    a0 = P(PARAM["a"])
    cov, _ = _disc_cell(o, q, P, a0, 0.0, 0.0, P(PARAM["b"]), fw)
    cov = _mean_fade(o, fw, 1.0, math.pi * a0 * a0, cov)
    return 1.0 - cov, _lerp3(_c(P, "c0"), _c(P, "c1"), cov)


def fam_hexagons(o, q, P, fw=0.0):
    a0, a1, _, _ = _knobs(P)
    hy = 0.5 * SQRT3
    # two rectangular lattices of hexagon centers (1 x sqrt3), the nearer
    ax = q[0] - o.floor(q[0]) - 0.5
    ay = q[1] - SQRT3 * o.floor(q[1] * (1.0 / SQRT3)) - hy
    bxs, bys = q[0] - 0.5, q[1] - hy
    bx = bxs - o.floor(bxs) - 0.5
    by = bys - SQRT3 * o.floor(bys * (1.0 / SQRT3)) - hy
    near_a = ax * ax + ay * ay < bx * bx + by * by
    gx, gy = o.select(near_a, ax, bx), o.select(near_a, ay, by)
    # center -> integer cell coordinates (centers at 0.5 x, hy y steps)
    cx, cy = q[0] - gx, q[1] - gy
    h0, _, _ = _cell_hash(o, cx * 2.0 + 0.5, cy * (1.0 / hy) + 0.5,
                          _seed(o, P))
    d = o.maximum(o.abs(gx), o.abs(gx) * 0.5 + o.abs(gy) * hy)
    t = _cover(o, 0.5 - d - a0, fw)
    c0, c2 = _c(P, "c0"), _c(P, "c2")
    cell = _lerp3(c0, c2, a1 * o.unit(h0))
    if not _unfiltered(fw):
        cell = _mean_fade3(o, fw, 1.0, _lerp3(c0, c2, 0.5 * a1), cell)
        # border fraction of a hexagon: 1 - ((0.5 - a0) / 0.5)^2
        f = 1.0 - 2.0 * a0
        t = _mean_fade(o, fw, 1.0, f * f, t)
    return t, _lerp3(_c(P, "c1"), cell, t)


def fam_weave(o, q, P, fw=0.0):
    a0, a1, a2, _ = _knobs(P)
    i, j = o.floor(q[0]), o.floor(q[1])
    fx, fy = q[0] - i, q[1] - j
    s = i + j
    warp = (s - 2.0 * o.floor(s * 0.5)) < 0.5      # warp (along y) on top
    across = o.select(warp, o.abs(fx - 0.5), o.abs(fy - 0.5)) * 2.0
    along = o.select(warp, fy, fx)
    width = 1.0 - a0
    on = _cover(o, (width - across) * 0.5, fw)
    t = o.clip(across / width, 0.0, 1.0)
    prof = 1.0 - t * t
    bulge = 0.75 + 0.25 * o.sin(along * math.pi)
    z = P(PARAM["seed"]) * (1.0 / 65536.0)
    oa = o.select(warp, q[0], q[1])
    ob = o.select(warp, q[1], q[0])
    fib = perlin(o, (oa * 9.0, ob * 0.7, z)) * a1
    fib = _mean_fade(o, fw, 9.0, 0.0, fib)
    h = o.clip((prof * bulge + fib) * on + 0.15 * (1.0 - on), 0.0, 1.0)
    c0, c1 = _c(P, "c0"), _c(P, "c1")
    top = tuple(o.select(warp, a, b) for a, b in zip(c0, c1))
    under = tuple(o.select(warp, b, a) for a, b in zip(c0, c1))
    col = _lerp3(under, top, on)
    if not _unfiltered(fw):    # threads below the footprint: their mean
        w = _fade(o, fw * 1.0)
        h = _lerp(WEAVE_H_MEAN, h, w)
        col = _lerp3(_lerp3(c0, c1, 0.5), col, w)
    shade = (1.0 - a2) + a2 * h
    return h, tuple(c * shade for c in col)


def fam_brushed(o, q, P, fw=0.0):
    a0, a1, a2, _ = _knobs(P)
    z = P(PARAM["seed"]) * (1.0 / 65536.0)
    n = fbm(o, (q[0] * a1, q[1] * a2, z), fw=fw if _unfiltered(fw)
            else fw * a2)
    h = o.clip(0.5 + n, 0.0, 1.0)
    return h, _lerp3(_c(P, "c0"), _c(P, "c1"), a0 * h)


def fam_twill(o, q, P, fw=0.0):
    a0, a1, a2, _ = _knobs(P)
    i, j = o.floor(q[0]), o.floor(q[1])
    fx, fy = q[0] - i, q[1] - j
    s = i - j
    m = s - 4.0 * o.floor(s * 0.25)
    warp = m < 1.5                       # 2 over 2, stepping diagonally
    across = o.select(warp, fx, fy)
    fiber = 0.5 + 0.5 * o.sin(across * (2.0 * math.pi) * a0)
    fiber = _mean_fade(o, fw, a0, 0.5, fiber)
    edge = _smooth(o, 0.0, a2, across) * _smooth(o, 0.0, a2, 1.0 - across)
    edge = _mean_fade(o, fw, 0.5 / a2 if not _unfiltered(fw) else 1.0,
                      1.0 - a2, edge)
    tow = o.select(warp, _one(o, fx), o.full_like(fx, 1.0) - a1)
    if not _unfiltered(fw):
        tow = _mean_fade(o, fw, 1.0, 1.0 - 0.5 * a1, tow)
    tone = tow * (0.85 + 0.15 * fiber) * (0.55 + 0.45 * edge)
    return o.clip(tone, 0.0, 1.0), _lerp3(_c(P, "c1"), _c(P, "c0"), tone)


def _shape_cell(o, q, P):
    """Per cell: (x, y in the cell, hash words, uniforms)."""
    hx, hy, hz = _cell_hash(o, q[0], q[1], _seed(o, P))
    r3, r4 = _rand2(o, hx)
    return _fract(o, q[0]), _fract(o, q[1]), (hx, hy, hz), (r3, r4)


def fam_decals(o, q, P, fw=0.0):
    a0, a1, a2, a3 = _knobs(P)
    fx, fy, (hx, hy, hz), (r3, r4) = _shape_cell(o, q, P)
    w = _lerp(a1, a2, o.unit(hx))
    h = _lerp(a1, a2, o.unit(hy))
    cx = 0.5 + (0.5 - w) * (2.0 * r3 - 1.0)
    cy = 0.5 + (0.5 - h) * (2.0 * r4 - 1.0)
    present = o.unit(hz) < a0
    sd = _round_box(o, fx - cx, fy - cy, w, h, o.minimum(a3, o.minimum(w, h)))
    cov = o.select(present, _cover(o, -sd, fw), o.zeros_like(fx))
    c1, c2 = _c(P, "c1"), _c(P, "c2")
    pick = o.eq(o.band(hz, 1), 0)
    ink = tuple(o.select(pick, a, b) for a, b in zip(c1, c2))
    if not _unfiltered(fw):
        m = 0.5 * (a1 + a2)
        cov = _mean_fade(o, fw, 1.0, a0 * 4.0 * m * m, cov)
        ink = _mean_fade3(o, fw, 1.0, _lerp3(c1, c2, 0.5), ink)
    return cov, _lerp3(_c(P, "c0"), ink, cov)


def fam_stickers(o, q, P, fw=0.0):
    a0, a1, a2, a3 = _knobs(P)
    b1 = P(PARAM["b"] + 1)
    fx, fy, (hx, _, hz), (r3, r4) = _shape_cell(o, q, P)
    s = _lerp(a1, a2, o.unit(hx))
    cx = 0.5 + (0.5 - s) * (2.0 * r3 - 1.0)
    cy = 0.5 + (0.5 - s) * (2.0 * r4 - 1.0)
    present = o.unit(hz) < a0
    sd = _round_box(o, fx - cx, fy - cy, s, s, b1 * s)
    shape = o.select(present, _cover(o, -sd, fw), o.zeros_like(fx))
    fill = _cover(o, -sd - a3 * s, fw)
    c0, c1, c2 = _c(P, "c0"), _c(P, "c1"), _c(P, "c2")
    if not _unfiltered(fw):
        m = 0.5 * (a1 + a2)
        area = a0 * 4.0 * m * m * (1.0 - (4.0 - math.pi) / 4.0 * b1 * b1)
        shape = _mean_fade(o, fw, 1.0, area, shape)
        k = 1.0 - a3
        fill = _mean_fade(o, fw, 1.0, k * k, fill)
    return shape, _lerp3(c0, _lerp3(c2, c1, fill), shape)


# glyph segments in a W x H box: (center x, center y, half x, half y) as
# multiples of (W, H) and the stroke s: (kx, ky, hxW, hxS, hyH, hyS)
_SEGMENTS = (
    (0.5, 0.0, 0.5, 0.5, 0.0, 0.5),       # bottom
    (0.5, 0.5, 0.5, 0.5, 0.0, 0.5),       # middle
    (0.5, 1.0, 0.5, 0.5, 0.0, 0.5),       # top
    (0.0, 0.25, 0.0, 0.5, 0.25, 0.5),     # left, lower
    (0.0, 0.75, 0.0, 0.5, 0.25, 0.5),     # left, upper
    (0.5, 0.25, 0.0, 0.5, 0.25, 0.5),     # center, lower
    (0.5, 0.75, 0.0, 0.5, 0.25, 0.5),     # center, upper
    (1.0, 0.25, 0.0, 0.5, 0.25, 0.5),     # right, lower
    (1.0, 0.75, 0.0, 0.5, 0.25, 0.5))     # right, upper


def fam_glyphs(o, q, P, fw=0.0):
    a0, a1, a2, _ = _knobs(P)
    b0, b1 = P(PARAM["b"]), P(PARAM["b"] + 1)
    seed = _seed(o, P)
    j = o.floor(q[1])
    fy = q[1] - j
    gx = q[0] / b0
    gi = o.floor(gx)
    col = o.floor(gi / b1)
    pos = gi - col * b1
    hl, hl2, _ = pcg3d(o, o.u32_of_floor(col), o.u32_of_floor(j),
                       o.xor(seed, o.u32(0x2C1B3C6D)))
    length = b1 * (0.35 + 0.65 * o.unit(hl2)) - 2.0
    hg, _, hs = pcg3d(o, o.u32_of_floor(gi), o.u32_of_floor(j),
                      o.xor(seed, o.u32(0x5BD1E995)))
    show = ((o.unit(hl) >= a0) & (pos < length) & (o.unit(hs) >= a1))
    W, H = 0.7 * b0, 0.6
    px = (gx - gi) * b0 - 0.15 * b0
    py = fy - 0.2
    ink = o.zeros_like(px)
    for k, (kx, ky, hw, hs_, hh, hss) in enumerate(_SEGMENTS):
        sd = _round_box(o, px - kx * W, py - ky * H, hw * W + hs_ * a2,
                        hh * H + hss * a2, 0.0)
        on = o.eq(o.band(o.shr(hg, k), 1), 1)
        ink = o.select(on, o.maximum(ink, _cover(o, -sd, fw)), ink)
    ink = o.select(show, ink, o.zeros_like(px))
    if not _unfiltered(fw):    # glyph strokes below the footprint: mean ink
        shown = (1.0 - a0) * (1.0 - a1) * (0.675 - 2.0 / b1)
        per = (1.5 * W * a2 + 2.0 * H * a2) / b0
        ink = _mean_fade(o, fw, 0.25 / a2, shown * per, ink)
    return ink, _lerp3(_c(P, "c0"), _c(P, "c1"), ink)


FAMILY_FNS = (fam_none, fam_stripes, fam_tiles, fam_dots, fam_hexagons,
              fam_weave, fam_brushed, fam_perforated, fam_twill, fam_decals,
              fam_glyphs, fam_stickers)


def pattern_point(o, uv, P):
    """q = Rot @ (scale * uv) + offset, uv metric (m)."""
    s = P(PARAM["scale"])
    c, sn = P(PARAM["rot"]), P(PARAM["rot"] + 1)
    x, y = uv[0] * s, uv[1] * s
    return (c * x - sn * y + P(PARAM["offset"]),
            sn * x + c * y + P(PARAM["offset"] + 1))


def evaluate(uvs, params, footprint=0.0):
    """The torch reference: metric ``uvs`` ``[N, 2]`` (m) and their rows
    ``params`` ``[N, K]`` (as stored: sRGB) -> ``(h [N], linear rgb [N,
    3])``. ``footprint`` (m, a number or ``[N]``): the filter width (0 =
    unfiltered)."""
    import torch
    o = TorchOps(torch)
    uv = (uvs[:, 0].float(), uvs[:, 1].float())
    rows = linearize(params.float())
    P = lambda k: rows[:, k]                                  # noqa: E731
    fam = rows[:, PARAM["family"]].round().long().clamp(0, len(FAMILIES) - 1)
    q = pattern_point(o, uv, P)
    fw = footprint
    if not _unfiltered(fw):
        fw = torch.as_tensor(fw, device=uv[0].device).float() * P(PARAM["scale"])
    h = torch.zeros_like(uv[0])
    rgb = torch.zeros(len(h), 3, device=h.device)
    for f, fn in enumerate(FAMILY_FNS):
        m = fam == f
        if bool(m.any()):
            hf, cf = fn(o, q, P, fw)
            h = torch.where(m, torch.as_tensor(hf).expand_as(h), h)
            rgb = torch.where(m[:, None], torch.stack(
                [torch.as_tensor(c).expand_as(h) for c in cf], -1), rgb)
    return h, rgb
