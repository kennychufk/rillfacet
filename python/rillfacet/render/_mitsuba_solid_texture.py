"""Mitsuba 3 plugins for the procedural solid (3D) textures of
:mod:`rillfacet.solid_texture` (used by
:class:`~rillfacet.render.mitsuba.MitsubaRenderer`).

The solid-texture slots of a rigid mesh form one Mitsuba mesh (two with bump:
it is a different BSDF) holding every instance. Its BSDF is
``scope(twosided([normalmap](principled)))``, with

- ``base_color``, ``roughness`` (and the ``normalmap``'s normals): three
  :class:`SolidTexture` s sharing one :class:`State`, which finds a
  lane's parameter row (instance = triangle index // triangles per
  instance, then the triangle's slot) in a flat buffer that is rewritten
  for new parameters without recompiling, evaluates the row's family with
  ``dr.switch`` at the body-local position (the ``vertex_plocal`` mesh
  attribute), and bumps with finite differences along the triangle's
  tangents (world edges ``si.dp_du`` / ``si.dp_dv``, which Mitsuba sets
  for meshes without UVs, and the same edges body-local, the
  ``face_le1`` / ``face_le2`` attributes).
- ``scope`` (:class:`ScopeBSDF`): forwards every call, and memoizes the
  pattern within ONE call. ``principled`` reads its textures separately,
  in each of eval / sample / pdf, and ``twosided`` once per side, so
  without it the pattern would be traced many times per call. Memoizing
  across calls would be wrong: different calls are different Dr.Jit
  recordings.

Dr.Jit traces EVERY live BSDF as a target of a BSDF call, so the
``twosided`` and ``principled`` inside a scope are traced on their own too,
although no lane reaches them but through the scope. Outside a scope call
the textures therefore return a constant instead of tracing the pattern
(dead code: about half of the host tracing and the kernel size otherwise).

Nothing here holds the Mitsuba mesh: Python plugins that referenced it
would close a reference cycle through C++ that Python's collector cannot
see, and Dr.Jit would keep tracing the dead renderers' BSDFs into every
later render.
"""
from __future__ import annotations

import numpy as np

from .. import solid_texture as sx

_PLUGINS: dict = {}            # variant -> (State, make_texture, make_scope)


def plugins(mi):
    """``(State, texture(state, mode), scope(state, bsdf))`` for the current
    variant, registering the plugins on first use."""
    hit = _PLUGINS.get(mi.variant())
    if hit is None:
        hit = _PLUGINS[mi.variant()] = _define(mi)
    return hit


def _define(mi):
    import drjit as dr
    o = sx.DrOps(mi, dr)
    NF = len(sx.FAMILY_FNS)
    PAR = sx.PARAM

    class State:
        def __init__(self, nt, tri_slot, M):
            self.nt, self.M = int(nt), int(M)
            self.tri_slot = mi.UInt32(np.asarray(tri_slot, np.uint32))
            self.params = None                # mi.Float [I * M * K], linear
            self.depth = 0                    # > 0 inside a scope call
            self.cache = {}

        def set_params(self, rows):
            """``rows`` ``[I, M, K]`` with linear colors."""
            self.params = mi.Float(np.ascontiguousarray(rows, np.float32)
                                   .ravel())

        def row(self, si, active):
            prim = si.prim_index
            env = prim // self.nt
            slot = dr.gather(mi.UInt32, self.tri_slot, prim - env * self.nt,
                             active)
            return env * self.M + slot

        def accessor(self, row, active):
            params, base = self.params, row * sx.K
            return lambda k: dr.gather(mi.Float, params, base + k, active)

        def pattern(self, p, row, active):
            """(h, (r, g, b)) of the row's family at body-local ``p``."""
            params = self.params
            fam = mi.UInt32(dr.gather(mi.Float, params,
                                      row * sx.K + PAR["family"], active))

            def make(fn):
                def target(px, py, pz, row, active=True):
                    P = lambda k: dr.gather(mi.Float, params,           # noqa: E731
                                            row * sx.K + k, active)
                    h, c = fn(o, sx.pattern_point(o, (px, py, pz), P), P)
                    return h, c[0], c[1], c[2]
                return target
            h, r, g, b = dr.switch(dr.minimum(fam, NF - 1),
                                   [make(fn) for fn in sx.FAMILY_FNS],
                                   p[0], p[1], p[2], row, active=active)
            return h, (r, g, b)

        def at(self, si, active):
            """(row, p, h, rgb) at ``si``; inside a scope call once per
            ``si`` (the same variables), for every valid lane: a call
            evaluates its textures under different masks (twosided: front,
            then back)."""
            key = None
            if self.depth:
                key = (si.p.x.index, si.p.y.index, si.p.z.index,
                       si.prim_index.index)
                hit = self.cache.get(key)
                if hit is not None:
                    return hit[0]
                active = si.is_valid()
            row = self.row(si, active)
            c = si.shape.eval_attribute_3("vertex_plocal", si, active)
            p = (c.x, c.y, c.z)
            h, rgb = self.pattern(p, row, active)
            if key is not None:   # keep the keyed variables alive
                self.cache[key] = ((row, p, h, rgb), (si.p, si.prim_index))
            return row, p, h, rgb

        def tangents(self, si, active):
            """Orthonormal world tangents of the hit triangle and the same
            directions body-local. Lengths and angles come from the exact
            body-local edges (the world edges lose bits far from the
            origin)."""
            sh = si.shape
            l1 = sh.eval_attribute_3("face_le1", si, active)
            l2 = sh.eval_attribute_3("face_le2", si, active)
            l1, l2 = mi.Vector3f(l1.x, l1.y, l1.z), mi.Vector3f(l2.x, l2.y, l2.z)
            inv1 = dr.rsqrt(dr.squared_norm(l1))
            L1, t1 = l1 * inv1, si.dp_du * inv1
            d = dr.dot(l2, L1)
            u2l, u2w = l2 - d * L1, si.dp_dv - d * t1
            inv2 = dr.rsqrt(dr.squared_norm(u2l))
            return t1, u2w * inv2, L1, u2l * inv2

    class SolidTexture(mi.Texture):
        """``mode``: ``color`` (linear rgb), ``rough``
        (lerp(rough0, rough1, h)) or ``normal`` (the bumped shading normal,
        as ``normalmap`` reads it: local frame, mapped to 0..1)."""

        def __init__(self, props):
            super().__init__(props)
            self.mode = props.get("mode", "color")
            self.state = None

        def _color(self, si, active):
            if not self.state.depth:          # a dead call target
                return mi.Color3f(0.5)
            return mi.Color3f(*self.state.at(si, active)[3])

        def _rough(self, si, active):
            if not self.state.depth:
                return mi.Float(0.5)
            row, _, h, _ = self.state.at(si, active)
            P = self.state.accessor(row, active)
            return dr.lerp(P(PAR["rough0"]), P(PAR["rough1"]), h)

        def _normal(self, si, active):
            st = self.state
            if not st.depth:
                return mi.Color3f(0.5, 0.5, 1.0)
            row, p, h0, _ = st.at(si, active)
            P = st.accessor(row, active)
            t1, t2, L1, L2 = st.tangents(si, active)
            eps = P(PAR["eps"]) / P(PAR["scale"])
            h1, _ = st.pattern(tuple(a + eps * b for a, b in zip(p, L1)),
                               row, active)
            h2, _ = st.pattern(tuple(a + eps * b for a, b in zip(p, L2)),
                               row, active)
            g = (t1 * (h1 - h0) + t2 * (h2 - h0)) * (P(PAR["bump"]) / eps)
            m = dr.normalize(si.sh_frame.n - g)
            return mi.Color3f(si.to_local(m)) * 0.5 + 0.5

        def eval_3(self, si, active=True):
            if self.mode == "color":
                return self._color(si, active)
            if self.mode == "normal":
                return self._normal(si, active)
            v = self._rough(si, active)
            return mi.Color3f(v, v, v)

        def eval(self, si, active=True):
            return mi.UnpolarizedSpectrum(self.eval_3(si, active))

        def eval_1(self, si, active=True):
            if self.mode == "rough":
                return self._rough(si, active)
            return dr.mean(self.eval_3(si, active))

        def mean(self):
            return 0.5

        def is_spatially_varying(self):
            return True

        def traverse(self, cb):
            pass

        def parameters_changed(self, keys=None):
            pass

        def to_string(self):
            return f"SolidTexture[mode={self.mode}]"

    class ScopeBSDF(mi.BSDF):
        """Forwards to ``bsdf``; each call is one memo scope of ``state``
        (see the module docstring)."""

        def __init__(self, props):
            super().__init__(props)
            self.inner = props["bsdf"]
            self.state = None
            self.m_flags = self.inner.flags()
            self.m_components = [self.inner.flags(i) for i in
                                 range(self.inner.component_count())]

        def _scoped(self, fn, *a):
            st = self.state
            st.cache.clear()
            st.depth += 1
            try:
                return fn(*a)
            finally:
                st.depth -= 1
                st.cache.clear()

        def sample(self, ctx, si, s1, s2, active=True):
            return self._scoped(self.inner.sample, ctx, si, s1, s2, active)

        def eval(self, ctx, si, wo, active=True):
            return self._scoped(self.inner.eval, ctx, si, wo, active)

        def pdf(self, ctx, si, wo, active=True):
            return self._scoped(self.inner.pdf, ctx, si, wo, active)

        def eval_pdf(self, ctx, si, wo, active=True):
            return self._scoped(self.inner.eval_pdf, ctx, si, wo, active)

        def eval_pdf_sample(self, ctx, si, wo, s1, s2, active=True):
            return self._scoped(self.inner.eval_pdf_sample, ctx, si, wo, s1,
                                s2, active)

        def eval_diffuse_reflectance(self, si, active=True):
            return self._scoped(self.inner.eval_diffuse_reflectance, si,
                                active)

        def eval_null_transmission(self, si, active=True):
            return self._scoped(self.inner.eval_null_transmission, si,
                                active)

        def has_attribute(self, name, active=True):
            return self.inner.has_attribute(name, active)

        def eval_attribute(self, name, si, active=True):
            return self._scoped(self.inner.eval_attribute, name, si, active)

        def eval_attribute_1(self, name, si, active=True):
            return self._scoped(self.inner.eval_attribute_1, name, si, active)

        def eval_attribute_3(self, name, si, active=True):
            return self._scoped(self.inner.eval_attribute_3, name, si, active)

        def traverse(self, cb):
            cb.put("bsdf", self.inner, mi.ParamFlags.NonDifferentiable)

        def parameters_changed(self, keys=None):
            pass

        def to_string(self):
            return f"ScopeBSDF[{self.inner}]"

    mi.register_texture("rillfacet_solid_texture",
                        lambda props: SolidTexture(props))
    mi.register_bsdf("rillfacet_scope", lambda props: ScopeBSDF(props))

    def texture(state, mode):
        t = mi.load_dict({"type": "rillfacet_solid_texture", "mode": mode})
        t.state = state
        return t

    def scope(state, bsdf):
        s = mi.load_dict({"type": "rillfacet_scope", "bsdf": bsdf})
        s.state = state
        return s

    return State, texture, scope
