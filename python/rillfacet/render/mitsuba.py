"""Mitsuba 3 camera renderer (``pip install rillfacet[mitsuba]``; CUDA).

Path-traced RGB with thin-lens depth of field, and a sharp geometry pass
(z-depth, segmentation), for every instance of a scene at once.

How it maps the scene onto Mitsuba, and why:

- Each rigid mesh becomes a FEW Mitsuba meshes holding all instances: one
  for its untextured materials (base color, roughness and metallic as
  per-face attributes, so per-env randomization is a buffer write), one
  per textured material, and one for its solid-texture materials (one
  more for those with bump; :mod:`._mitsuba_solid_texture`). Mitsuba
  re-traces its kernels on the host every render, at a cost that grows
  with the number of shapes, so one shape per env (or Mitsuba instancing)
  would grow quadratically with the env count.
- Poses are applied by skinning the body-local vertices on the GPU (torch)
  into those meshes' vertex buffers; envs sit on a grid ``env_spacing``
  apart so that each camera sees only its own env.
- Camera rays are generated in torch, not by Mitsuba sensors: per-env poses
  and lens values stay tensors (setting hundreds of Mitsuba sensor
  transforms costs more than the render), and OpenCV distortion is applied
  exactly per sample (:class:`~rillfacet.render.camera.PixelRays`).
  Mitsuba's integrator then does the light transport.
- Lights are shared by all envs: an env's own point light would be picked
  by the light sampling of every other env, wasting samples.
- A :class:`~rillfacet.scene_api.Background` (per-env panoramas, seen
  only) is resolved in torch: samples whose camera ray hits nothing
  (``ray_test``, within ``far``) take their env's panorama
  (:class:`~rillfacet.render.BackgroundLookup`) instead of the emitters'
  radiance, which a miss returns; the emitters still light the scene.

Large batches are rendered in chunks of at most ``max_samples`` samples.
"""
from __future__ import annotations

import re
import warnings
from types import SimpleNamespace

import numpy as np

from . import Renderer, linear_to_srgb, srgb_to_linear
from .camera import PixelRays

__all__ = ["MitsubaRenderer"]

_DEFAULT_LIGHTS = (
    dict(type="constant", radiance=0.35),
    dict(type="directional", direction=[0.3, 0.2, -1.0], irradiance=2.5),
)


def _sid(name):
    return re.sub(r"[^A-Za-z0-9_]", "_", name)


def _qrot(q, v):
    """Rotate ``v`` ``[..., 3]`` by xyzw quaternions ``q`` ``[..., 4]``."""
    import torch
    qv, qw = q[..., :3], q[..., 3:]
    u = 2.0 * torch.linalg.cross(qv, v, dim=-1)
    return v + qw * u + torch.linalg.cross(qv, u, dim=-1)


class _Group:
    """One Mitsuba mesh: a subset of a rigid mesh's triangles, all
    instances."""

    def __init__(self, mesh, sid, tri_idx, slot, torch, dev,
                 solid_texture=False, bump=False):
        tris = mesh.triangles[tri_idx].astype(np.int64)
        gv, inv = np.unique(tris.ravel(), return_inverse=True)
        self.sid, self.slot, self.mesh = sid, slot, mesh
        # color and roughness from a solid (3D) texture, rillfacet.solid_texture
        self.solid_texture, self.bump = bool(solid_texture), bool(bump)
        self.state = None                  # its _mitsuba_solid_texture.State
        self.nv, self.nt = len(gv), len(tri_idx)
        self.faces = inv.reshape(-1, 3)
        T = torch
        self.local = T.as_tensor(mesh.local_vertices[gv], device=dev)
        self.vbody = T.as_tensor(mesh.vertex_body[gv], device=dev)
        self.normals = (None if mesh.normals is None
                        else T.as_tensor(mesh.normals[gv], device=dev))
        self.uvs = None if mesh.uvs is None else mesh.uvs[gv]
        tri_body = np.searchsorted(mesh.body_triangle_offsets, tri_idx,
                                   side="right") - 1
        self.tri_body = tri_body
        self.tri_slot = (None if mesh.triangle_material is None
                         else mesh.triangle_material[tri_idx])


class MitsubaRenderer(Renderer):
    """Mitsuba 3 renderer (see the module docstring).

    ``spp`` samples per pixel (RGB); ``integrator`` a Mitsuba integrator
    dict (default ``{"type": "path", "max_depth": 4}``; ``"direct"`` is
    faster and less noisy, without indirect light); ``denoise`` runs
    Mitsuba's OptiX denoiser on the RGB; ``seed`` seeds the sampling.
    Without :class:`~rillfacet.scene_api.Light` s the scene gets a sky
    and a sun.
    """

    def __init__(self, *, spp=8, integrator=None, denoise=False,
                 env_spacing=50.0, max_samples=8_000_000, seed=0,
                 variant="cuda_ad_rgb"):
        super().__init__(env_spacing=env_spacing, seed=seed)
        import mitsuba as mi
        import torch
        if mi.variant() != variant:
            mi.set_variant(variant)
        self.mi, self.torch = mi, torch
        self.dev = torch.device("cuda")
        self.spp, self.denoise = int(spp), bool(denoise)
        self.max_samples = int(max_samples)
        self.integrator_spec = dict(integrator or {"type": "path",
                                                   "max_depth": 4})
        self._gen = torch.Generator(device=self.dev)
        self._gen.manual_seed(int(seed))
        self._seed = int(seed) * 7919
        self._groups: dict = {}                # mesh name -> [_Group]
        self._scene = self._params = self._integrator = None
        self._sampler = None
        self._rays: dict = {}                  # camera name -> (key, PixelRays)
        self._denoiser = None
        self._warned_tint = set()

    def reseed(self, seed=None) -> None:
        super().reseed(seed)
        s = self._sensor_seed if seed is None else int(seed)
        self._gen.manual_seed(s)
        self._seed = s * 7919

    # -- build ----------------------------------------------------------------

    def _build(self):
        mi, torch = self.mi, self.torch
        bases = self.label_bases()
        d = {"type": "scene"}
        self._groups = {}
        for mi_idx, m in enumerate(self.meshes.values()):
            groups = []
            textured = ([i for i, mat in enumerate(m.materials)
                         if mat.base_color_texture is not None]
                        if m.uvs is not None else [])
            if m.materials and m.uvs is None and any(
                    mat.base_color_texture is not None for mat in m.materials):
                warnings.warn(f"rigid mesh {m.name!r}: textures without UVs "
                              "are drawn untextured")
            solid = [[i for i, mat in enumerate(m.materials)
                     if mat.solid_texture and mat.bump == bump]
                    for bump in (False, True)]
            tri_slot = (m.triangle_material if m.triangle_material is not None
                        else np.zeros(len(m.triangles), np.int32))
            flat = np.nonzero(~np.isin(tri_slot, textured + sum(solid, [])))[0]
            parts = [(flat, None, None)] if len(flat) else []
            parts += [(np.nonzero(np.isin(tri_slot, sl))[0], None, bump)
                      for bump, sl in zip((False, True), solid) if sl]
            parts += [(np.nonzero(tri_slot == s)[0], s, None) for s in textured]
            for gi, (tri_idx, slot, bump) in enumerate(parts):
                if not len(tri_idx):
                    continue
                g = _Group(m, f"m{mi_idx}_{_sid(m.name)}_{gi}", tri_idx, slot,
                           torch, self.dev, solid_texture=bump is not None,
                           bump=bool(bump))
                d[g.sid] = self._make_mesh(g, m, bases[m.name])
                groups.append(g)
            self._groups[m.name] = groups
        lights = list(self.lights.values())
        if lights:
            for i, light in enumerate(lights):
                d[f"light{i}_{_sid(light.name)}"] = self._emitter(light)
        else:
            for i, e in enumerate(_DEFAULT_LIGHTS):
                d[f"default_light{i}"] = dict(e)
        self._scene = mi.load_dict(d)
        self._params = mi.traverse(self._scene)
        self._integrator = mi.load_dict(self.integrator_spec)
        self._sampler = mi.load_dict({"type": "independent"})
        self._structure_dirty = False
        self._dirty_poses = set(self.meshes)
        self._dirty_appearance = set(self.meshes)

    def _make_mesh(self, g, m, label_base):
        mi = self.mi
        I = m.instances
        mesh = mi.Mesh(g.sid, I * g.nv, I * g.nt,
                       has_vertex_normals=g.normals is not None,
                       has_vertex_texcoords=g.slot is not None)
        faces = (g.faces[None] + g.nv * np.arange(I)[:, None, None]).ravel()
        seg = np.tile(label_base + g.tri_body, I).astype(np.float32)
        mesh.add_attribute("face_seg", 1, seg)
        if g.solid_texture:
            local = g.local.cpu().numpy()
            mesh.add_attribute("vertex_plocal", 3,
                               np.tile(local, (I, 1)).ravel())
            for k in (1, 2):    # body-local edges, for the bump's tangents
                e = local[g.faces[:, k]] - local[g.faces[:, 0]]
                mesh.add_attribute(f"face_le{k}", 3,
                                   np.tile(e, (I, 1)).ravel())
        else:
            if g.slot is None:
                mesh.add_attribute("face_color", 3,
                                   np.zeros(3 * I * g.nt, np.float32))
            mesh.add_attribute("face_rough", 1, np.zeros(I * g.nt, np.float32))
        mesh.add_attribute("face_metal", 1, np.zeros(I * g.nt, np.float32))
        p = mi.traverse(mesh)
        p["vertex_positions"] = mi.Float(np.tile(
            g.local.cpu().numpy(), (I, 1)).ravel())
        p["faces"] = mi.UInt32(faces.astype(np.uint32))
        if g.normals is not None:
            p["vertex_normals"] = mi.Float(np.tile(
                g.normals.cpu().numpy(), (I, 1)).ravel())
        if g.slot is not None:
            p["vertex_texcoords"] = mi.Float(np.tile(
                g.uvs, (I, 1)).astype(np.float32).ravel())
        p.update()
        if g.solid_texture:
            mesh.set_bsdf(self._solid_texture_bsdf(g, m))
            return mesh
        if g.slot is None:
            base = {"type": "mesh_attribute", "name": "face_color"}
        else:
            base = {"type": "bitmap", "bitmap": self._texture(m, g.slot),
                    "raw": True, "filter_type": "bilinear",
                    "wrap_mode": "repeat"}
        mesh.set_bsdf(mi.load_dict({"type": "twosided", "bsdf": {
            "type": "principled", "base_color": base,
            "roughness": {"type": "mesh_attribute", "name": "face_rough"},
            "metallic": {"type": "mesh_attribute", "name": "face_metal"}}}))
        return mesh

    def _solid_texture_bsdf(self, g, m):
        from ._mitsuba_solid_texture import plugins
        mi = self.mi
        State, texture, scope = plugins(mi)
        g.state = State(g.nt, g.tri_slot, len(m.materials))
        bsdf = {"type": "principled",
                "base_color": texture(g.state, "color"),
                "roughness": texture(g.state, "rough"),
                "metallic": {"type": "mesh_attribute", "name": "face_metal"}}
        if g.bump:
            bsdf = {"type": "normalmap", "bsdf": bsdf,
                    "normalmap": texture(g.state, "normal")}
        return scope(g.state, mi.load_dict({"type": "twosided",
                                            "bsdf": bsdf}))

    def _texture(self, m, slot):
        """Linear float bitmap of a slot's texture times its base color."""
        mi = self.mi
        mat = m.materials[slot]
        tex = mat.base_color_texture
        if isinstance(tex, str):
            from PIL import Image
            tex = np.asarray(Image.open(tex).convert("RGB"))
        tex = np.asarray(tex)
        tex = (tex[..., :3].astype(np.float32) / 255.0
               if tex.dtype == np.uint8 else tex[..., :3].astype(np.float32))
        lin = srgb_to_linear(tex) * srgb_to_linear(
            np.asarray(mat.base_color, np.float32))
        return mi.Bitmap(np.ascontiguousarray(lin, np.float32))

    def _emitter(self, light):
        c = (np.asarray(light.color) * light.intensity).tolist()
        if light.type == "directional":
            return dict(type="directional", direction=list(light.direction),
                        irradiance={"type": "rgb", "value": c})
        if light.type == "ambient":
            return dict(type="constant", radiance={"type": "rgb", "value": c})
        T = self.mi.ScalarTransform4f
        return dict(type="envmap", filename=str(light.envmap),
                    scale=float(light.intensity),
                    # Mitsuba envmaps are y-up; the scene is z-up.
                    to_world=T().rotate([1, 0, 0], 90))

    # -- per-render sync ------------------------------------------------------

    def _key(self, sid, field):
        return f"{sid}.{field}"

    def _sync(self):
        if self._structure_dirty or self._scene is None:
            self._build()
        torch, mi = self.torch, self.mi
        changed = False
        for name in self._dirty_appearance:
            m = self.meshes.get(name)
            if m is not None:
                for g in self._groups[name]:
                    self._write_appearance(g, m)
                changed = True
        for name in self._dirty_poses:
            m = self.meshes.get(name)
            if m is None:
                continue
            offs = torch.as_tensor(self.env_offsets(m.instances),
                                   device=self.dev)
            I, B = m.instances, m.num_bodies
            if m.poses is None:
                poses = torch.zeros(I, B, 7, device=self.dev)
                poses[..., 6] = 1.0
            else:
                poses = torch.as_tensor(m.poses, device=self.dev).float()
            vis = torch.as_tensor(m.segment_visible.reshape(I, B),
                                  device=self.dev)
            for g in self._groups[name]:
                p = poses[:, g.vbody]                         # [I, nv, 7]
                x = p[..., :3] + _qrot(p[..., 3:], g.local[None])
                hide = ~vis[:, g.vbody]
                if bool(hide.any()):        # collapse hidden bodies
                    x = torch.where(hide[..., None], p[..., :3], x)
                x = x + offs[:, None]
                self._params[self._key(g.sid, "vertex_positions")] = \
                    mi.Float(x.reshape(-1).contiguous())
                if g.normals is not None:
                    n = _qrot(p[..., 3:], g.normals[None])
                    self._params[self._key(g.sid, "vertex_normals")] = \
                        mi.Float(n.reshape(-1).contiguous())
            changed = True
        self._dirty_poses.clear()
        self._dirty_appearance.clear()
        if changed:
            self._params.update()

    def _write_appearance(self, g, m):
        mi = self.mi
        I, B = m.instances, m.num_bodies
        if m.materials:
            slot = g.tri_slot
            rough = m.material_roughness[:, slot]
            metal = m.material_metallic[:, slot]
            color = m.material_base_color[:, slot]          # [I, nt, 3]
            if g.slot is not None:
                key = (m.name, g.slot)
                if (key not in self._warned_tint and not np.allclose(
                        m.material_base_color[:, g.slot],
                        m.materials[g.slot].base_color)):
                    self._warned_tint.add(key)
                    warnings.warn(f"{m.name!r}: per-instance base color of "
                                  f"textured material "
                                  f"{m.materials[g.slot].name!r} is ignored")
        else:
            seg = (np.arange(I)[:, None] * B + g.tri_body[None])
            color = m.segment_colors[seg]
            rough = np.full((I, g.nt), 0.5, np.float32)
            metal = np.zeros((I, g.nt), np.float32)
        p = self._params
        if g.solid_texture:
            from ..solid_texture import linearize
            g.state.set_params(linearize(m.material_solid_texture))
        else:
            if g.slot is None:
                p[self._key(g.sid, "face_color")] = mi.Float(
                    srgb_to_linear(color).astype(np.float32).ravel())
            p[self._key(g.sid, "face_rough")] = mi.Float(
                np.ascontiguousarray(rough, np.float32).ravel())
        p[self._key(g.sid, "face_metal")] = mi.Float(
            np.ascontiguousarray(metal, np.float32).ravel())

    # -- rays -----------------------------------------------------------------

    def _pixel_rays(self, cam):
        """The camera's :class:`PixelRays`; with per-instance intrinsics an
        object whose ``center`` / ``d_du`` / ``d_dv`` are ``[I, P, 2]``."""
        key = (cam.width, cam.height, cam.instances, cam.K.tobytes(),
               None if cam.dist is None else cam.dist.tobytes())
        hit = self._rays.get(cam.name)
        if hit is None or hit[0] != key:
            n = cam.instances if cam.per_instance_intrinsics else 1
            rays = [PixelRays(K, cam.width, cam.height, dist,
                              device=self.dev)
                    for K, dist in map(cam.intrinsics, range(n))]
            residual = max(r.max_residual for r in rays)
            outside = max(r.outside for r in rays)
            if residual > 0.05:
                warnings.warn(f"camera {cam.name!r}: undistortion residual "
                              f"{residual:.3f} px")
            if outside > 0:
                warnings.warn(f"camera {cam.name!r}: {100 * outside:.2f}"
                              "% of the image lies beyond the distortion "
                              "model's fold (drawn with its edge rays)")
            if n == 1:
                rays = rays[0]
            else:
                torch = self.torch
                rays = SimpleNamespace(**{
                    a: torch.stack([getattr(r, a) for r in rays])
                    for a in ("center", "d_du", "d_dv")})
            hit = self._rays[cam.name] = (key, rays)
        return hit[1]

    def _make_rays(self, cam, pix_rays, rot, pos, e0, e1, spp, lens):
        """Rays of envs ``e0:e1``, ``spp`` per pixel, laid out ``[env,
        pixel, sample]`` (row-major pixels): ``(origin xyz, direction xyz,
        maxt, dz)``, each flat, with ``dz`` the z of the unit camera-space
        direction. ``rot`` ``[I, 3, 3]`` / ``pos`` ``[I, 3]``: camera to
        world. ``lens``: jittered sample positions and the thin lens (else
        pixel centers, pinhole). Everything broadcasts over (env, pixel,
        sample); nothing is gathered per sample."""
        torch = self.torch
        ne, P = e1 - e0, cam.width * cam.height
        shape = (ne, P, spp)
        def rows(t):            # [1 | ne, P, 1, 2]: shared or per instance
            return (t[None, :, None] if t.dim() == 2
                    else t[e0:e1, :, None])

        c = rows(pix_rays.center)
        x, y = c[..., 0], c[..., 1]
        if lens:
            j = torch.rand(*shape, 2, device=self.dev,
                           generator=self._gen) - 0.5
            du = rows(pix_rays.d_du)
            dv = rows(pix_rays.d_dv)
            x = x + j[..., 0] * du[..., 0] + j[..., 1] * dv[..., 0]
            y = y + j[..., 0] * du[..., 1] + j[..., 1] * dv[..., 1]
        x, y = x.expand(shape), y.expand(shape)
        z = torch.ones(shape, device=self.dev)
        ox = oy = None
        if lens:
            a = torch.as_tensor(cam.aperture_radius[e0:e1],
                                device=self.dev).float()[:, None, None]
            fd = torch.as_tensor(cam.focus_distance[e0:e1],
                                 device=self.dev).float()[:, None, None]
            if bool((a > 0).any()):
                s = torch.rand(*shape, 2, device=self.dev, generator=self._gen)
                r = a * s[..., 0].sqrt()
                th = (2 * np.pi) * s[..., 1]
                ox, oy = r * th.cos(), r * th.sin()
                # aim through the sample's point on the focal plane
                x, y, z = x * fd - ox, y * fd - oy, z * fd
        inv = torch.rsqrt(x * x + y * y + z * z)
        x, y, dz = x * inv, y * inv, z * inv
        maxt = (cam.far - cam.near) / dz
        t0 = cam.near / dz                       # start at the near plane
        ox = x * t0 if ox is None else ox + x * t0
        oy = y * t0 if oy is None else oy + y * t0
        oz = dz * t0
        R = rot[e0:e1, :, :, None, None]                     # [ne,3,3,1,1]
        t = pos[e0:e1, :, None, None]                        # [ne,3,1,1]
        o = [t[:, i] + R[:, i, 0] * ox + R[:, i, 1] * oy + R[:, i, 2] * oz
             for i in range(3)]
        d = [R[:, i, 0] * x + R[:, i, 1] * y + R[:, i, 2] * dz
             for i in range(3)]
        return ([a.reshape(-1) for a in o], [a.reshape(-1) for a in d],
                maxt.reshape(-1), dz.reshape(-1))

    def _mi_ray(self, o, d, maxt):
        mi = self.mi
        ray = mi.Ray3f(mi.Point3f(*(mi.Float(a) for a in o)),
                       mi.Vector3f(*(mi.Float(a) for a in d)))
        ray.maxt = mi.Float(maxt)
        return ray

    # -- render ---------------------------------------------------------------

    def render(self, camera, outputs=("rgb",), *, spp=None) -> dict:
        torch, mi = self.torch, self.mi
        bad = set(outputs) - set(self.OUTPUTS)
        if bad:
            raise ValueError(f"unknown outputs {sorted(bad)}")
        cam = self._camera(camera)
        for m in self.meshes.values():
            if m.instances != cam.instances:
                raise ValueError(f"camera {camera!r} has {cam.instances} "
                                 f"instances, rigid mesh {m.name!r} "
                                 f"{m.instances}")
        self._sync()
        spp = int(spp or self.spp)
        I = cam.instances
        pose = torch.as_tensor(cam.world_poses(), device=self.dev).float()
        pose = pose.reshape(I, 7)
        pos = pose[:, :3] + torch.as_tensor(self.env_offsets(I),
                                            device=self.dev)
        rot = _qrot(pose[:, None, 3:], torch.eye(3, device=self.dev)[None])
        pose = (rot.transpose(1, 2), pos)        # columns = camera axes
        pix_rays = self._pixel_rays(cam)
        out = {}
        want_rgb = "rgb" in outputs or "linear" in outputs
        if want_rgb:
            lin = self.sensor_image(
                cam, self._render_rgb(cam, pix_rays, pose, spp))
            if "linear" in outputs:
                out["linear"] = lin
            if "rgb" in outputs:
                out["rgb"] = linear_to_srgb(lin)
        if "depth" in outputs or "segmentation" in outputs:
            depth, seg = self._render_geometry(cam, pix_rays, pose)
            if "depth" in outputs:
                out["depth"] = depth
            if "segmentation" in outputs:
                out["segmentation"] = seg
        return out

    def _chunks(self, I, per_env):
        step = max(1, self.max_samples // per_env)
        return [(e0, min(I, e0 + step)) for e0 in range(0, I, step)]

    def _render_rgb(self, cam, pix_rays, pose, spp):
        torch, mi = self.torch, self.mi
        I, W, H = cam.instances, cam.width, cam.height
        imgs = []
        if (self.background is not None
                and self.background.instances != I):
            raise ValueError(f"camera {cam.name!r} has {I} instances, "
                             f"background {self.background.name!r} "
                             f"{self.background.instances}")
        for e0, e1 in self._chunks(I, H * W * spp):
            o, d, maxt, _ = self._make_rays(cam, pix_rays, *pose, e0, e1, spp,
                                            lens=True)
            ray = self._mi_ray(o, d, maxt)
            self._seed += 1
            self._sampler.seed(self._seed, maxt.numel())
            L, _, _ = self._integrator.sample(self._scene, self._sampler, ray)
            rgb = torch.stack([L[i].torch() for i in range(3)], -1)
            rgb = torch.nan_to_num(rgb, nan=0.0, posinf=0.0, neginf=0.0)
            if self.background is not None:
                rgb = self._with_background(cam, pix_rays, ray, d, rgb,
                                            e0, e1, spp)
            imgs.append(rgb.view(e1 - e0, H, W, spp, 3).mean(3))
        img = torch.cat(imgs)
        if self.denoise:
            img = self._denoise(img)
        return img

    def _with_background(self, cam, pix_rays, ray, d, rgb, e0, e1, spp):
        """``rgb`` ``[n]`` samples with the camera misses replaced by their
        env's panorama (envs with index -1 keep the emitters' radiance)."""
        torch, mi = self.torch, self.mi
        import drjit as dr
        hit = self._scene.ray_test(ray)
        miss = mi.Float(dr.select(hit, 0.0, 1.0)).torch() > 0.5
        ne, P = e1 - e0, cam.width * cam.height
        env = torch.arange(e0, e1, device=self.dev)[:, None, None].expand(
            ne, P, spp).reshape(-1)
        fp = torch.maximum(pix_rays.d_du.norm(dim=-1),
                           pix_rays.d_dv.norm(dim=-1))      # [P] | [I, P]
        fp = (fp[None] if fp.dim() == 1 else fp[e0:e1])[..., None]
        fp = fp.expand(ne, P, spp).reshape(-1)
        idx = torch.nonzero(miss).squeeze(1)
        if not len(idx):
            return rgb
        dirs = torch.stack([a[idx] for a in d], -1)
        bg, has = self.background_radiance(cam, env[idx], dirs, fp[idx],
                                           self.dev)
        rgb = rgb.clone()
        rgb[idx[has]] = bg[has]
        return rgb

    def _denoise(self, img):
        mi = self.mi
        I, H, W, _ = img.shape
        size = (W, I * H)
        if self._denoiser is None or self._denoiser[0] != size:
            self._denoiser = (size, mi.OptixDenoiser(
                input_size=mi.ScalarVector2u(*size), albedo=False,
                normals=False, temporal=False))
        out = self._denoiser[1](mi.TensorXf(img.reshape(I * H, W, 3)
                                            .contiguous()))
        return out.torch().reshape(I, H, W, 3)

    def _render_geometry(self, cam, pix_rays, pose):
        torch = self.torch
        I, W, H = cam.instances, cam.width, cam.height
        depths, segs = [], []
        for e0, e1 in self._chunks(I, H * W):
            o, d, maxt, dz = self._make_rays(cam, pix_rays, *pose, e0, e1, 1,
                                             lens=False)
            ray = self._mi_ray(o, d, maxt)
            si = self._scene.ray_intersect(ray)
            ok = si.is_valid()
            seg = si.shape.eval_attribute_1("face_seg", si, ok)
            ok_t = ok.torch().bool()
            t = si.t.torch()
            z = torch.where(ok_t, t * dz + cam.near, torch.zeros_like(t))
            s = torch.where(ok_t, seg.torch().round().int(),
                            torch.full_like(t, -1, dtype=torch.int32))
            depths.append(z.view(e1 - e0, H, W))
            segs.append(s.view(e1 - e0, H, W))
        return torch.cat(depths), torch.cat(segs)
