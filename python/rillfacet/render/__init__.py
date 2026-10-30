"""Camera rendering of :class:`~rillfacet.scene_api.Scene` s, batched over
instances (envs), for vision-based RL and synthetic data.

A :class:`Renderer` is a scene backend: attach it (``scene.add_backend``)
and it mirrors the rigid meshes, materials, lights and camera sensors; then
:meth:`Renderer.render` returns images of every instance at once as torch
tensors::

    from rillfacet.render.mitsuba import MitsubaRenderer
    r = MitsubaRenderer(spp=8)
    scene.add_backend(r)
    out = r.render("wrist", outputs=("rgb", "depth", "segmentation"))
    out["rgb"]            # [E, H, W, 3] float32, sRGB 0..1
    out["depth"]          # [E, H, W] float32 z-depth in m, 0 = nothing
    out["segmentation"]   # [E, H, W] int32 label, -1 = background
    r.segment_labels()    # label -> "mesh/body"

Every instance is rendered in its own world: a camera of env k sees only
env k's geometry (renderers place the envs far apart, beyond the cameras'
``far``). Lights are shared by all instances; a
:class:`~rillfacet.scene_api.Background` gives each instance its own
panorama, seen where the camera sees nothing (it lights nothing). Every
backend passes its
radiance through the same sensor stage (:mod:`rillfacet.render.sensor`:
gain, vignetting, shot and read noise, per instance) before ``"linear"``
and ``"rgb"``.

Backends: :mod:`rillfacet.render.mitsuba` (Mitsuba 3 path tracing on CUDA,
thin-lens depth of field, exact OpenCV distortion);
:mod:`rillfacet.render.raster` (batched GPU rasterization with Dawn, for
thousands of envs; zero-copy to torch on Linux + NVIDIA); Blender Cycles in
the separate GPL-3.0 package ``rillfacet-cycles`` (``rillfacet_cycles``).
"""
from __future__ import annotations

import numpy as np

from ..scene_api import Background, Backend, CameraSensor, Light, RigidMesh

__all__ = ["Renderer", "srgb_to_linear", "linear_to_srgb",
           "background_mips", "BackgroundLookup"]


def srgb_to_linear(c):
    """sRGB 0..1 -> linear (numpy or torch)."""
    if hasattr(c, "detach"):
        import torch
        return torch.where(c <= 0.04045, c / 12.92,
                           ((c.clamp(min=0) + 0.055) / 1.055) ** 2.4)
    c = np.asarray(c, np.float32)
    return np.where(c <= 0.04045, c / 12.92,
                    ((np.maximum(c, 0) + 0.055) / 1.055) ** 2.4)


def background_mips(images):
    """The mip chain of a background's panoramas ``[N, H, W, 3]`` (numpy):
    2 x 2 box averages while both sizes are even and the height above 4.
    Every backend filters the background through this same chain."""
    mips = [np.asarray(images, np.float32)]
    while (mips[-1].shape[1] % 2 == 0 and mips[-1].shape[2] % 2 == 0
           and mips[-1].shape[1] > 4):
        m = mips[-1]
        mips.append(0.25 * (m[:, 0::2, 0::2] + m[:, 1::2, 0::2]
                            + m[:, 0::2, 1::2] + m[:, 1::2, 1::2]))
    return mips


def background_lod(footprint, width, levels):
    """Mip level of a pixel that spans ``footprint`` radians, for panoramas
    ``width`` texels around (a texel spans 2 pi / width at the horizon)."""
    import torch
    f = torch.as_tensor(footprint).clamp(min=1e-12)
    return torch.log2(f * (width / (2 * np.pi))).clamp(0, levels - 1)


def equirect_uv(d):
    """Equirect coordinates in 0..1 of z-up world directions ``[..., 3]``
    (torch; the envmap mapping): ``u = atan2(x, y) / 2 pi``, ``v = acos(z)
    / pi`` (u wraps)."""
    import torch
    u = torch.atan2(d[..., 0], d[..., 1]) / (2 * np.pi)
    v = torch.acos(d[..., 2].clamp(-1, 1)) / np.pi
    return u, v


class BackgroundLookup:
    """Torch lookups of a :class:`~rillfacet.scene_api.Background` (the
    backends that resolve camera misses in torch: Mitsuba, Cycles):
    bilinear within a level of :func:`background_mips`, linear between
    levels, as a GPU sampler with an explicit level."""

    def __init__(self, bg, device):
        import torch
        self.version = None
        self.dev = torch.device(device)
        self.levels = [torch.as_tensor(m, device=self.dev).contiguous()
                       for m in background_mips(bg.images)]
        self.width = self.levels[0].shape[2]

    def _bilinear(self, level, layer, u, v):
        import torch
        img = self.levels[level]
        N, H, W, _ = img.shape
        x, y = u * W - 0.5, v * H - 0.5
        x0, y0 = torch.floor(x), torch.floor(y)
        fx, fy = (x - x0)[..., None], (y - y0)[..., None]
        x0, y0 = x0.long(), y0.long()
        flat = img.reshape(-1, 3)
        base = layer * (H * W)

        def at(xi, yi):
            return flat[base + yi.clamp(0, H - 1) * W + xi % W]

        a, b = at(x0, y0), at(x0 + 1, y0)
        c, d = at(x0, y0 + 1), at(x0 + 1, y0 + 1)
        return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy

    def __call__(self, layer, yaw, d, lod):
        """Radiance ``[..., 3]`` of panoramas ``layer`` (long, >= 0),
        rotated by ``yaw``, in world directions ``d`` ``[..., 3]``, at mip
        level ``lod`` (float, broadcast; :func:`background_lod`)."""
        import torch
        c, s = torch.cos(yaw), torch.sin(yaw)
        d0 = torch.stack([c * d[..., 0] + s * d[..., 1],
                          -s * d[..., 0] + c * d[..., 1], d[..., 2]], -1)
        u, v = equirect_uv(d0)
        lod = torch.as_tensor(lod, device=d.device).expand(u.shape)
        lo = lod.floor().long().clamp(0, len(self.levels) - 1)
        t = (lod - lo)[..., None]
        out = torch.zeros(u.shape + (3,), device=d.device)
        for k in range(len(self.levels)):
            sel = lo == k
            if not bool(sel.any()):
                continue
            a = self._bilinear(k, layer[sel], u[sel], v[sel])
            if k + 1 < len(self.levels):
                b = self._bilinear(k + 1, layer[sel], u[sel], v[sel])
                a = a + (b - a) * t[sel]
            out[sel] = a
        return out


def linear_to_srgb(c):
    """Linear -> sRGB, clamped to 0..1 (numpy or torch)."""
    if hasattr(c, "detach"):
        import torch
        c = c.clamp(0.0, 1.0)
        return torch.where(c <= 0.0031308, 12.92 * c,
                           1.055 * c ** (1 / 2.4) - 0.055)
    c = np.clip(np.asarray(c, np.float32), 0.0, 1.0)
    return np.where(c <= 0.0031308, 12.92 * c, 1.055 * c ** (1 / 2.4) - 0.055)


class Renderer(Backend):
    """Base of the camera renderers: keeps the scene's rigid meshes, lights
    and camera sensors and what changed since the last render. Subclasses
    implement :meth:`render`.

    ``env_spacing`` (m): instance k is rendered at a grid offset of
    ``env_spacing`` per cell, so it must exceed a camera's ``far`` plus the
    size of one env's geometry. ``seed`` seeds the sensor noise
    (:meth:`sensor_image`)."""

    OUTPUTS = ("rgb", "linear", "depth", "segmentation")

    def __init__(self, env_spacing=50.0, seed=0):
        self.env_spacing = float(env_spacing)
        self._sensor_seed = int(seed)
        self._sensor_gen = None
        self._r2: dict = {}                    # camera -> (key, r^2 map)
        self.meshes: dict = {}                 # name -> RigidMesh (in order)
        self.lights: dict = {}
        self.cameras: dict = {}
        self.background = None                 # the scene's Background
        self._background_dirty = False         # new background images
        self._structure_dirty = True           # meshes / lights changed
        self._dirty_poses: set = set()
        self._dirty_appearance: set = set()

    # -- Backend --------------------------------------------------------------

    def create(self, obj) -> None:
        if isinstance(obj, RigidMesh):
            self.meshes[obj.name] = obj
            self._structure_dirty = True
        elif isinstance(obj, Light):
            self.lights[obj.name] = obj
            self._structure_dirty = True
        elif isinstance(obj, CameraSensor):
            self.cameras[obj.name] = obj
        elif isinstance(obj, Background):
            if self.background is not None and self.background is not obj:
                import warnings
                warnings.warn(f"renderer: background {obj.name!r} replaces "
                              f"{self.background.name!r} (one per scene)")
            self.background = obj
            self._background_dirty = True

    def update(self, obj, what: str) -> None:
        if isinstance(obj, RigidMesh):
            if what in ("poses", "visibility"):
                self._dirty_poses.add(obj.name)
            elif what in ("colors", "materials"):
                self._dirty_appearance.add(obj.name)
        elif isinstance(obj, Light):
            self._structure_dirty = True

    def remove(self, name: str) -> None:
        for d in (self.meshes, self.lights):
            if d.pop(name, None) is not None:
                self._structure_dirty = True
        self.cameras.pop(name, None)
        if self.background is not None and self.background.name == name:
            self.background = None
            self._background_dirty = True

    # -- shared helpers -------------------------------------------------------

    def segment_labels(self) -> list:
        """Names of the segmentation labels: label ``i`` is
        ``"<mesh>/<body>"``, numbered over the rigid meshes in creation
        order, bodies in order (the same in every instance)."""
        out = []
        for m in self.meshes.values():
            out += [f"{m.name}/{b}" for b in m.body_names]
        return out

    def label_bases(self) -> dict:
        """First segmentation label of each rigid mesh."""
        bases, n = {}, 0
        for m in self.meshes.values():
            bases[m.name] = n
            n += m.num_bodies
        return bases

    def env_offsets(self, instances: int) -> np.ndarray:
        """``[instances, 3]`` world offsets the renderer places envs at."""
        ncol = int(np.ceil(np.sqrt(instances)))
        k = np.arange(instances)
        return (np.stack([k % ncol, k // ncol, np.zeros(instances)], 1)
                * self.env_spacing).astype(np.float32)

    def _camera(self, name) -> CameraSensor:
        cam = self.cameras.get(name)
        if cam is None:
            raise KeyError(f"no camera sensor {name!r}")
        if cam.far >= self.env_spacing:
            raise ValueError(f"camera {name!r}: far ({cam.far} m) must be "
                             f"below env_spacing ({self.env_spacing} m)")
        return cam

    def reseed(self, seed=None) -> None:
        """Restart the renderer's random streams (sensor noise, and the
        backend's own sampling where it has one) from ``seed`` (default:
        the construction seed), so a rollout re-run from the same state
        draws the same noise."""
        if seed is not None:
            self._sensor_seed = int(seed)
        self._sensor_gen = None

    def sensor_image(self, cam, radiance):
        """The camera's linear image from the linear ``radiance`` a backend
        rendered (``[I, H, W, 3]`` torch): gain, vignetting and sensor
        noise, the stage every backend shares (:mod:`.sensor`)."""
        import torch
        from . import sensor
        dev = radiance.device
        if self._sensor_gen is None or self._sensor_gen.device != dev:
            self._sensor_gen = torch.Generator(device=dev)
            self._sensor_gen.manual_seed(self._sensor_seed)
        key = (cam.width, cam.height, cam.K.tobytes(), str(dev))
        hit = self._r2.get(cam.name)
        if hit is None or hit[0] != key:
            hit = self._r2[cam.name] = (
                key, sensor.radius2(cam.K, cam.width, cam.height, dev))
        return sensor.apply(cam, radiance, generator=self._sensor_gen,
                            r2=hit[1])

    def background_lookup(self, device):
        """The :class:`BackgroundLookup` of the scene's background (rebuilt
        when its images change), or None without one."""
        if self.background is None:
            self._background_dirty = False
            self._bg_lookup = None
            return None
        import torch
        lk = getattr(self, "_bg_lookup", None)
        if (self._background_dirty or lk is None
                or lk.dev != torch.device(device)):
            self._bg_lookup = BackgroundLookup(self.background, device)
            self._background_dirty = False
        return self._bg_lookup

    def background_radiance(self, cam, env, d, footprint, device):
        """Each ray's background ``[M, 3]`` and whether it has one ``[M]``
        (bool): ``env`` ``[M]`` (long) the instance of each world
        direction ``d`` ``[M, 3]``, ``footprint`` its pixel's angular size
        (radians, broadcast). Rays of instances with index -1 get False
        (the lights' background)."""
        import torch
        lk = self.background_lookup(device)
        bg = self.background
        if lk is None:
            return None, torch.zeros(env.shape, dtype=torch.bool,
                                     device=device)
        idx = torch.tensor(bg.index, device=device).long()[env]
        yaw = torch.tensor(bg.yaw, device=device).float()[env]
        gain = torch.tensor(bg.intensity, device=device).float()[env]
        has = idx >= 0
        out = torch.zeros(env.shape + (3,), device=device)
        if bool(has.any()):
            fp = torch.as_tensor(footprint, device=device).float().expand(
                env.shape)
            lod = background_lod(fp[has], lk.width, len(lk.levels))
            out[has] = lk(idx[has], yaw[has], d[has], lod) * gain[has, None]
        return out, has

    def render(self, camera: str, outputs=("rgb",), **kw) -> dict:
        """Images of every instance from ``camera``: a dict of the requested
        ``outputs`` (``"rgb"`` sRGB ``[I, H, W, 3]``, ``"linear"`` the
        linear camera image ``[I, H, W, 3]`` (:meth:`sensor_image`), ``"depth"`` ``[I, H, W]``,
        ``"segmentation"`` ``[I, H, W]`` int32)."""
        raise NotImplementedError
