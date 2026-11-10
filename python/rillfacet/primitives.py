"""Primitive meshes with UVs: boxes, spheres and cylinders as
:class:`~rillfacet.assets.MeshAsset` s, for bodies a simulator models as
primitives (a table cuboid, a ball) that should take UV textures
(:mod:`rillfacet.uv_texture`) or image textures.

Each builder returns smooth or per-face normals, ``metric_uvs`` in meters
along the surface (a box: one chart per face, its in-plane coordinates
from the face's corner; a sphere: longitude x latitude arc lengths at the
equator; a cylinder: arc length x height on the side, planar caps), and
``uvs`` = the metric UVs over the primitive's largest extent (0..1-ish
charts that overlap: enough for a tiling image texture). Geometry is
centered at the origin (the body frame of a primitive), in meters, z up
for the cylinder's axis. Place it with :func:`~rillfacet.assets.merge_bodies`'
``origins`` or a ``BodyMesh(visuals=)`` origin.
"""
from __future__ import annotations

import numpy as np

from .assets import MeshAsset
from .scene_api import Material

__all__ = ["box", "sphere", "cylinder"]


def _asset(v, t, n, muv, extent, material):
    muv = np.asarray(muv, np.float32)
    return MeshAsset(np.asarray(v, np.float32), np.asarray(t, np.int64),
                     np.asarray(n, np.float32), muv / np.float32(extent),
                     None, [material or Material("default")], muv)


def box(size, *, material=None) -> MeshAsset:
    """A cuboid of full extents ``size`` (x, y, z): 24 vertices (4 per
    face, flat normals), 12 triangles."""
    sx, sy, sz = (float(x) for x in size)
    h = np.array([sx, sy, sz]) / 2
    v, n, uv, t = [], [], [], []
    for axis in range(3):
        a, b = (axis + 1) % 3, (axis + 2) % 3        # right-handed (a, b, n)
        for sign in (1.0, -1.0):
            nn = np.zeros(3)
            nn[axis] = sign
            ua, ub = (a, b) if sign > 0 else (b, a)
            k = len(v)
            for ca, cb in ((0, 0), (1, 0), (1, 1), (0, 1)):
                p = np.zeros(3)
                p[axis] = sign * h[axis]
                p[ua] = (2 * ca - 1) * h[ua]
                p[ub] = (2 * cb - 1) * h[ub]
                v.append(p)
                n.append(nn)
                uv.append((ca * 2 * h[ua], cb * 2 * h[ub]))
            t += [(k, k + 1, k + 2), (k, k + 2, k + 3)]
    return _asset(v, t, n, uv, max(sx, sy, sz), material)


def sphere(radius, *, segments=48, rings=24, material=None) -> MeshAsset:
    """A UV sphere: ``segments`` around z, ``rings`` from pole to pole
    (a seam of duplicate vertices at longitude 0)."""
    r = float(radius)
    lon = np.linspace(0, 2 * np.pi, segments + 1)
    lat = np.linspace(-np.pi / 2, np.pi / 2, rings + 1)
    LA, LO = np.meshgrid(lat, lon, indexing="ij")         # [rings+1, seg+1]
    n = np.stack([np.cos(LA) * np.cos(LO), np.cos(LA) * np.sin(LO),
                  np.sin(LA)], -1).reshape(-1, 3)
    muv = np.stack([r * LO, r * LA], -1).reshape(-1, 2)
    W = segments + 1
    t = []
    for i in range(rings):
        for j in range(segments):
            a, b = i * W + j, i * W + j + 1
            c, d = a + W, b + W
            if i > 0:
                t.append((a, b, d))
            if i < rings - 1:
                t.append((a, d, c))
    return _asset(r * n, t, n, muv, 2 * np.pi * r, material)


def cylinder(radius, height, *, segments=48, caps=True,
             material=None) -> MeshAsset:
    """A cylinder about z from ``-height/2`` to ``height/2``: a smooth side
    (seam at angle 0) and, with ``caps``, flat disks."""
    r, hz = float(radius), float(height) / 2
    th = np.linspace(0, 2 * np.pi, segments + 1)
    c, s = np.cos(th), np.sin(th)
    v, n, muv, t = [], [], [], []
    for z in (-hz, hz):
        v += [np.stack([r * c, r * s, np.full_like(c, z)], -1)]
        n += [np.stack([c, s, np.zeros_like(c)], -1)]
        muv += [np.stack([r * th, np.full_like(c, z + hz)], -1)]
    W = segments + 1
    t = [(j, j + 1, W + j + 1) for j in range(segments)]
    t += [(j, W + j + 1, W + j) for j in range(segments)]
    k = 2 * W
    if caps:
        for z, sign in ((-hz, -1.0), (hz, 1.0)):
            ring = np.stack([r * c[:-1], r * s[:-1], np.full(segments, z)], -1)
            v += [np.array([[0.0, 0.0, z]]), ring]
            n += [np.tile([0.0, 0.0, sign], (segments + 1, 1))]
            muv += [np.concatenate([[[r, r]], ring[:, :2] + r])]
            for j in range(segments):
                a, b = k + 1 + j, k + 1 + (j + 1) % segments
                t.append((k, b, a) if sign < 0 else (k, a, b))
            k += segments + 1
    extent = max(2 * np.pi * r, 2 * hz)
    return _asset(np.concatenate(v), t, np.concatenate(n),
                  np.concatenate(muv), extent, material)
