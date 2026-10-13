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
``far``). Lights are shared by all instances.

Backends: :mod:`rillfacet.render.mitsuba` (Mitsuba 3 path tracing on CUDA,
thin-lens depth of field, exact OpenCV distortion); Blender Cycles in the
separate GPL-3.0 package ``rillfacet-cycles`` (``rillfacet_cycles``).
"""
from __future__ import annotations

import numpy as np

from ..scene_api import Backend, CameraSensor, Light, RigidMesh

__all__ = ["Renderer", "srgb_to_linear", "linear_to_srgb"]


def srgb_to_linear(c):
    """sRGB 0..1 -> linear (numpy or torch)."""
    if hasattr(c, "detach"):
        import torch
        return torch.where(c <= 0.04045, c / 12.92,
                           ((c.clamp(min=0) + 0.055) / 1.055) ** 2.4)
    c = np.asarray(c, np.float32)
    return np.where(c <= 0.04045, c / 12.92,
                    ((np.maximum(c, 0) + 0.055) / 1.055) ** 2.4)


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
    size of one env's geometry."""

    OUTPUTS = ("rgb", "linear", "depth", "segmentation")

    def __init__(self, env_spacing=50.0):
        self.env_spacing = float(env_spacing)
        self.meshes: dict = {}                 # name -> RigidMesh (in order)
        self.lights: dict = {}
        self.cameras: dict = {}
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

    def render(self, camera: str, outputs=("rgb",), **kw) -> dict:
        """Images of every instance from ``camera``: a dict of the requested
        ``outputs`` (``"rgb"`` sRGB ``[I, H, W, 3]``, ``"linear"`` linear
        radiance ``[I, H, W, 3]``, ``"depth"`` ``[I, H, W]``,
        ``"segmentation"`` ``[I, H, W]`` int32)."""
        raise NotImplementedError
