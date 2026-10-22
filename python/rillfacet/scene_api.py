"""Backend-neutral scene for simulator visualizations.

Visualization code describes WHAT to show through a :class:`Scene`; backends
decide HOW: :class:`NativeBackend` drives an ``rillfacet.Viewer`` window, and
the web stream / eval recorder backends (rillfacet web viewer) send the same
calls to a browser or to disk. So one task visualization serves ``--gui``,
live streaming and replay.

The scene is split by how often things change, so streaming stays cheap:

- rigid meshes: body-local vertices and triangles once, then one pose per
  (instance, body) per frame (:class:`RigidMesh`);
- boxes, points, polylines: small geometry, resent when it changes;
- labels: world-anchored text, either fixed strings or VALUES formatted by
  the backend (``fmt``), so a stream carries numbers, not strings;
- channels: named value arrays (per-env metrics, batch stats) that panels
  and plots read. The native backend keeps them only for the application.

Handles keep their latest state, so a backend attached later (a browser
connecting mid-run) can be sent the whole scene.

For camera rendering (``rillfacet.render``) a scene also carries what a
viewer ignores: PBR materials on rigid meshes (per instance, for domain
randomization), :class:`Light` s and :class:`CameraSensor` s mounted on
bodies.

Poses are ``[..., 7]`` = translation xyz + quaternion xyzw. Arrays may be
numpy or torch (CUDA ok); they are converted where a backend needs host data.
Colors are sRGB in 0..1.
"""
from __future__ import annotations

import numpy as np

__all__ = ["Scene", "Backend", "NativeBackend", "RigidMesh", "Boxes",
           "Points", "Polyline", "Labels", "Material", "Light",
           "CameraSensor", "box_mesh", "skin", "compose", "as_scene"]


def _host(a, dtype=np.float32) -> np.ndarray:
    """numpy copy-free view of ``a`` (torch tensors are moved to the host)."""
    if hasattr(a, "detach"):
        a = a.detach().cpu().numpy()
    return np.asarray(a, dtype=dtype)


def _rgb(c) -> tuple:
    return tuple(float(x) for x in c)


# --------------------------------------------------------------------------
# geometry helpers
# --------------------------------------------------------------------------

#: Unit-box template: corners and outward-wound triangles.
_BOX_CORNERS = np.array([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
                         [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
                        dtype=np.float32)
_BOX_TRIS = np.array([[0, 3, 2], [0, 2, 1], [4, 5, 6], [4, 6, 7],
                      [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5],
                      [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]],
                     dtype=np.int32)


def box_mesh(lo, hi):
    """Axis-aligned boxes ``lo``/``hi`` ``[n, 3]`` as ONE mesh:
    ``([8n, 3] vertices, [12n, 3] triangles)``."""
    lo = np.asarray(lo, np.float32).reshape(-1, 3)
    hi = np.asarray(hi, np.float32).reshape(-1, 3)
    verts = lo[:, None, :] + _BOX_CORNERS[None] * (hi - lo)[:, None, :]
    tris = _BOX_TRIS[None] + (8 * np.arange(len(lo)))[:, None, None]
    return verts.reshape(-1, 3).astype(np.float32), tris.reshape(-1, 3)


def skin(local, vertex_body, poses):
    """World vertices of rigid bodies: ``local`` ``[V, 3]`` body-local
    vertices, ``vertex_body`` ``[V]`` their body index, ``poses``
    ``[n, B, 7]`` -> ``[n, V, 3]``. numpy or torch (same type as ``poses``;
    ``local`` / ``vertex_body`` must live on its device)."""
    if hasattr(poses, "detach"):
        import torch
        cross = torch.linalg.cross
    else:
        cross = np.cross
    p = poses[:, vertex_body]
    t, qv, qw = p[..., :3], p[..., 3:6], p[..., 6:7]
    u = 2.0 * cross(qv, local[None])
    return t + local[None] + qw * u + cross(qv, u)


def compose(a, b):
    """Pose product ``a * b`` of ``[..., 7]`` poses (broadcasting): pose
    ``b`` given in frame ``a``, expressed in ``a``'s parent frame. numpy or
    torch (both the same type)."""
    if hasattr(a, "detach"):
        import torch
        cross, cat = torch.linalg.cross, torch.cat
        a, b = torch.broadcast_tensors(a, b)
    else:
        cross, cat = np.cross, np.concatenate
        a, b = np.broadcast_arrays(np.asarray(a, np.float64),
                                   np.asarray(b, np.float64))
    av, aw, bv, bw = a[..., 3:6], a[..., 6:7], b[..., 3:6], b[..., 6:7]
    u = 2.0 * cross(av, b[..., :3])
    t = a[..., :3] + b[..., :3] + aw * u + cross(av, u)
    qv = aw * bv + bw * av + cross(av, bv)
    qw = aw * bw - (av * bv).sum(-1)[..., None]
    return cat([t, qv, qw], -1)


# --------------------------------------------------------------------------
# scene objects
# --------------------------------------------------------------------------

class _Object:
    kind = ""

    def __init__(self, scene: "Scene", name: str):
        self.scene, self.name = scene, name

    def _changed(self, what: str) -> None:
        self.scene._update(self, what)

    def state(self) -> tuple:
        """``(attrs, arrays)``: everything needed to rebuild this object,
        as JSON-able attributes and numpy arrays (see
        :meth:`Scene.snapshot`)."""
        raise NotImplementedError


class Material:
    """A PBR metallic-roughness material (glTF 2.0's model): ``base_color``
    sRGB, ``metallic`` and ``roughness`` in 0..1, and an optional
    ``base_color_texture`` (an image path or an ``[H, W, 3|4]`` sRGB array,
    uint8 or 0..1 float) sampled at the mesh UVs (origin top-left, glTF's
    convention). The texture is multiplied by ``base_color``, as in glTF.

    ``solid_texture``: the base color and roughness come from a procedural
    SOLID (3D) texture evaluated at the body-local position instead of UVs
    (:mod:`rillfacet.solid_texture`: wood, marble, granite, ...; no UVs
    needed), with per-instance parameters
    :attr:`RigidMesh.material_solid_texture`
    (``set_materials(solid_texture=...)``). Until they are set, every
    instance shows the plain family in ``base_color`` and ``roughness``;
    after, those two are not used. ``bump`` also perturbs the shading
    normal by the solid texture's height (the parameters' ``bump``
    amplitude), at about twice the shading cost of a solid texture without
    it. Mitsuba, the raster backend and the Cycles backend (OSL: on OptiX
    and the CPU) render solid textures."""

    def __init__(self, name, base_color=(0.8, 0.8, 0.8), metallic=0.0,
                 roughness=0.5, base_color_texture=None, solid_texture=False,
                 bump=False):
        self.name = str(name)
        self.base_color = _rgb(base_color)
        self.metallic, self.roughness = float(metallic), float(roughness)
        self.base_color_texture = base_color_texture
        self.solid_texture, self.bump = bool(solid_texture), bool(bump)
        if self.solid_texture and base_color_texture is not None:
            raise ValueError("Material: solid_texture or "
                             "base_color_texture, not both")
        if self.bump and not self.solid_texture:
            raise ValueError("Material: bump needs solid_texture=True")

    def state(self) -> dict:
        tex = self.base_color_texture
        return dict(name=self.name, base_color=self.base_color,
                    metallic=self.metallic, roughness=self.roughness,
                    texture=(tex if isinstance(tex, str)
                             else None if tex is None else "<array>"),
                    solid_texture=self.solid_texture, bump=self.bump)

    def __repr__(self):
        kind = (", textured" if self.base_color_texture is not None
                else ", solid texture" + (" + bump" if self.bump else "")
                if self.solid_texture else "")
        return (f"Material({self.name!r}, base_color={self.base_color}, "
                f"metallic={self.metallic}, roughness={self.roughness}{kind})")


class RigidMesh(_Object):
    """Rigid bodies of one simulator, drawn for ``instances`` copies (envs).

    ``local_vertices`` ``[V, 3]`` are body-local, ``vertex_body`` ``[V]`` the
    body of each vertex, ``triangles`` ``[T, 3]`` index them, and
    ``body_triangle_offsets`` ``[B+1]`` group the triangles by body (bodies
    in order, contiguous). A segment is one (instance, body):
    ``segment = instance * B + body``. ``offsets`` ``[instances, 3]`` shift
    each instance render-side (a display grid). Segment names are
    ``"<instance name>/<body name>"`` (just the body name for one instance);
    ``instance_names`` default to ``env0``, ``env1``, ...

    Appearance for camera renderers (viewers ignore it): ``normals`` and
    ``uvs`` ``[V, 3|2]`` (body-local), and ``materials`` (a list of
    :class:`Material`) with ``triangle_material`` ``[T]`` the material slot
    of each triangle. Each instance has its own copy of every slot's
    parameters (:meth:`set_materials`), so appearance is randomized per env
    by writing arrays; solid-texture materials have a row of solid texture
    parameters per instance (:attr:`material_solid_texture`). Without
    materials, renderers shade each segment with its segment color
    (roughness 0.5, not metallic)."""
    kind = "rigid_mesh"

    def __init__(self, scene, name, local_vertices, vertex_body, triangles,
                 body_triangle_offsets, *, instances=1, offsets=None,
                 body_names=None, instance_names=None, colors=None,
                 smooth=False, normals=None, uvs=None, materials=None,
                 triangle_material=None):
        super().__init__(scene, name)
        self.local_vertices = _host(local_vertices)
        self.vertex_body = np.asarray(vertex_body, np.int64)
        self.triangles = np.asarray(triangles, np.uint32).reshape(-1, 3)
        self.body_triangle_offsets = np.asarray(body_triangle_offsets,
                                                np.int64)
        self.num_bodies = len(self.body_triangle_offsets) - 1
        self.instances = int(instances)
        self.offsets = (np.zeros((self.instances, 3), np.float32)
                        if offsets is None
                        else _host(offsets).reshape(self.instances, 3))
        B = self.num_bodies
        self.body_names = (list(body_names) if body_names is not None
                           else [f"body{b}" for b in range(B)])
        self.instance_names = (list(instance_names)
                               if instance_names is not None
                               else [f"env{k}" for k in range(self.instances)])
        base = np.broadcast_to(np.asarray(
            colors if colors is not None else (0.49, 0.678, 0.8),
            np.float32), (B, 3))
        self.segment_colors = np.tile(base, (self.instances, 1)).copy()
        self.segment_visible = np.ones(self.instances * B, bool)
        self.smooth = bool(smooth)
        self.poses = None                  # [instances, B, 7] once set
        self.world_vertices = None         # optional exact vertices (native)
        V, T = len(self.local_vertices), len(self.triangles)
        self.normals = (None if normals is None
                        else _host(normals).reshape(V, 3))
        self.uvs = None if uvs is None else _host(uvs).reshape(V, 2)
        self.materials = list(materials) if materials else []
        if self.materials:
            self.triangle_material = (
                np.zeros(T, np.int32) if triangle_material is None
                else np.asarray(triangle_material, np.int32).reshape(T))
            if self.triangle_material.max(initial=0) >= len(self.materials):
                raise ValueError("RigidMesh: triangle_material out of range")
        elif triangle_material is not None:
            raise ValueError("RigidMesh: triangle_material needs materials")
        else:
            self.triangle_material = None
        M, I = len(self.materials), self.instances
        self.material_base_color = np.tile(np.asarray(
            [m.base_color for m in self.materials], np.float32
        ).reshape(1, M, 3), (I, 1, 1))
        self.material_metallic = np.tile(np.asarray(
            [m.metallic for m in self.materials], np.float32), (I, 1))
        self.material_roughness = np.tile(np.asarray(
            [m.roughness for m in self.materials], np.float32), (I, 1))
        #: ``[instances, M, K]`` solid texture parameters (rows of every
        #: slot; read for the solid-texture ones), None without
        #: solid-texture materials
        self.material_solid_texture = None
        if any(m.solid_texture for m in self.materials):
            from .solid_texture import default_params
            self.material_solid_texture = default_params(self.materials, I)

    @property
    def num_segments(self) -> int:
        return self.instances * self.num_bodies

    def segment_names(self) -> list:
        if self.instances == 1:
            return list(self.body_names)
        return [f"{k}/{n}" for k in self.instance_names
                for n in self.body_names]

    def set_poses(self, poses, world_vertices=None) -> None:
        """Body poses ``[instances, B, 7]``. ``world_vertices``
        ``[instances * V, 3]`` (un-offset), when the caller already has them
        (a simulator's own vertex buffer), lets a backend that draws
        vertices use them as is instead of skinning. It may be a
        zero-argument callable, evaluated only by a backend that uses it."""
        self.poses = poses
        self.world_vertices = world_vertices
        self._changed("poses")

    def set_segment_color(self, segment: int, rgb) -> None:
        self.segment_colors[int(segment)] = _rgb(rgb)
        self._changed("colors")

    def set_segment_visible(self, segment: int, on: bool) -> None:
        self.segment_visible[int(segment)] = bool(on)
        self._changed("visibility")

    def material_index(self, name: str) -> int:
        """Slot of the material called ``name``."""
        for i, m in enumerate(self.materials):
            if m.name == name:
                return i
        raise KeyError(f"RigidMesh {self.name!r}: no material {name!r}")

    def set_materials(self, base_color=None, metallic=None,
                      roughness=None, solid_texture=None) -> None:
        """Per-instance material parameters: ``base_color`` broadcasts to
        ``[instances, M, 3]`` (sRGB), ``metallic`` / ``roughness`` to
        ``[instances, M]``, ``solid_texture`` (parameter rows of
        :mod:`rillfacet.solid_texture`, e.g. ``solid_texture.sample_params(
        rng, (E, M))``) to ``[instances, M, K]``; None keeps the current values.
        E.g. ``base_color=rng.uniform(0, 1, (E, M, 3))`` randomizes every
        slot of every env; write a slice of :attr:`material_base_color` and
        pass it back to change a few."""
        I, M = self.instances, len(self.materials)
        if solid_texture is not None:
            if self.material_solid_texture is None:
                raise ValueError(f"RigidMesh {self.name!r}: no "
                                 "solid-texture material")
            self.material_solid_texture = np.ascontiguousarray(np.broadcast_to(
                _host(solid_texture), self.material_solid_texture.shape))
        if base_color is not None:
            self.material_base_color = np.ascontiguousarray(np.broadcast_to(
                _host(base_color), (I, M, 3)))
        if metallic is not None:
            self.material_metallic = np.ascontiguousarray(np.broadcast_to(
                _host(metallic), (I, M)))
        if roughness is not None:
            self.material_roughness = np.ascontiguousarray(np.broadcast_to(
                _host(roughness), (I, M)))
        self._changed("materials")

    def state(self):
        arrays = dict(local_vertices=self.local_vertices,
                      vertex_body=self.vertex_body.astype(np.int32),
                      triangles=self.triangles,
                      body_triangle_offsets=self.body_triangle_offsets
                      .astype(np.int32),
                      offsets=self.offsets,
                      segment_colors=self.segment_colors,
                      segment_visible=self.segment_visible)
        if self.poses is not None:
            arrays["poses"] = _host(self.poses)
        attrs = dict(instances=self.instances, body_names=self.body_names,
                     instance_names=self.instance_names, smooth=self.smooth)
        if self.normals is not None:
            arrays["normals"] = self.normals
        if self.uvs is not None:
            arrays["uvs"] = self.uvs
        if self.materials:
            attrs["materials"] = [m.state() for m in self.materials]
            arrays.update(triangle_material=self.triangle_material,
                          material_base_color=self.material_base_color,
                          material_metallic=self.material_metallic,
                          material_roughness=self.material_roughness)
            if self.material_solid_texture is not None:
                arrays["material_solid_texture"] = self.material_solid_texture
        return attrs, arrays


class Boxes(_Object):
    """Axis-aligned boxes ``lo``/``hi`` ``[n, 3]``, one color or one per
    box."""
    kind = "boxes"

    def __init__(self, scene, name, lo, hi, color=(0.8, 0.8, 0.8),
                 colors=None):
        super().__init__(scene, name)
        self.color = _rgb(color)
        self.lo = self.hi = self.colors = None
        self._set(lo, hi, colors)

    def _set(self, lo, hi, colors):
        self.lo = _host(lo).reshape(-1, 3)
        self.hi = _host(hi).reshape(-1, 3)
        self.colors = None if colors is None else _host(colors).reshape(-1, 3)

    def set_boxes(self, lo, hi, colors=None) -> None:
        self._set(lo, hi, colors)
        self._changed("boxes")

    def state(self):
        arrays = dict(lo=self.lo, hi=self.hi)
        if self.colors is not None:
            arrays["colors"] = self.colors
        return dict(color=self.color), arrays


class Points(_Object):
    """Spheres at ``points`` ``[n, 3]``."""
    kind = "points"

    def __init__(self, scene, name, points, color, radius):
        super().__init__(scene, name)
        self.points = _host(points).reshape(-1, 3)
        self.color, self.radius = _rgb(color), float(radius)
        self.radii = None

    def set_points(self, points, radii=None) -> None:
        self.points = _host(points).reshape(-1, 3)
        self.radii = None if radii is None else _host(radii).reshape(-1)
        self._changed("points")

    def state(self):
        arrays = dict(points=self.points)
        if self.radii is not None:
            arrays["radii"] = self.radii
        return dict(color=self.color, radius=self.radius), arrays


class Polyline(_Object):
    """A tube through ``points`` ``[n, 3]``."""
    kind = "polyline"

    def __init__(self, scene, name, points, color, radius, closed=False):
        super().__init__(scene, name)
        self.points = _host(points).reshape(-1, 3)
        self.color, self.radius = _rgb(color), float(radius)
        self.closed = bool(closed)

    def set_points(self, points) -> None:
        self.points = _host(points).reshape(-1, 3)
        self._changed("points")

    def state(self):
        return (dict(color=self.color, radius=self.radius,
                     closed=self.closed), dict(points=self.points))


class Labels(_Object):
    """Screen-facing text at world ``anchors`` ``[n, 3]``.

    Either fixed ``texts`` (one per anchor), or VALUES shown through
    ``fmt`` (``"{:.3f}"``): :meth:`set_values` updates the numbers and each
    backend formats them itself. ``world_height`` > 0 makes the text that
    tall in world units (it shrinks with distance), else ``size_px``
    pixels. ``align`` (0..1, 0..1) places the anchor within the text box."""
    kind = "labels"

    def __init__(self, scene, name, anchors, *, texts=None, fmt=None,
                 color=(1.0, 1.0, 1.0, 1.0), align=(0.0, 0.0),
                 world_height=0.0, size_px=14.0):
        super().__init__(scene, name)
        if (texts is None) == (fmt is None):
            raise ValueError("Labels: pass exactly one of texts / fmt")
        self.anchors = _host(anchors).reshape(-1, 3)
        self.texts = None if texts is None else [str(t) for t in texts]
        self.fmt = fmt
        self.values = (None if fmt is None
                       else np.zeros(len(self.anchors), np.float32))
        c = tuple(float(x) for x in color)
        self.color = c if len(c) == 4 else c + (1.0,)
        self.align = tuple(float(x) for x in align)
        self.world_height, self.size_px = float(world_height), float(size_px)

    def set_values(self, values) -> None:
        self.values = _host(values).reshape(-1)
        self._changed("values")

    def set_texts(self, texts) -> None:
        self.texts = [str(t) for t in texts]
        self._changed("texts")

    def state(self):
        attrs = dict(texts=self.texts, fmt=self.fmt, color=self.color,
                     align=self.align, world_height=self.world_height,
                     size_px=self.size_px)
        arrays = dict(anchors=self.anchors)
        if self.values is not None:
            arrays["values"] = self.values
        return attrs, arrays

    def strings(self) -> list:
        if self.texts is not None:
            return self.texts
        return [self.fmt.format(float(x)) for x in self.values]


class Light(_Object):
    """A light shared by every instance (env) of the scene.

    ``type``: ``"directional"`` (``direction`` it shines along, world;
    ``intensity`` = irradiance), ``"ambient"`` (uniform sky radiance
    ``intensity``, also the background) or ``"envmap"`` (an equirectangular
    HDR/LDR image ``envmap``, z-up, scaled by ``intensity``). ``color`` is
    linear RGB. Per-env lighting variation is left to the cameras'
    :attr:`CameraSensor.gain` (exposure / white balance)."""
    kind = "light"
    TYPES = ("directional", "ambient", "envmap")

    def __init__(self, scene, name, type="directional", *, intensity=1.0,
                 color=(1.0, 1.0, 1.0), direction=(0.0, 0.0, -1.0),
                 envmap=None):
        super().__init__(scene, name)
        if type not in self.TYPES:
            raise ValueError(f"Light: type must be one of {self.TYPES}")
        if type == "envmap" and envmap is None:
            raise ValueError("Light: envmap needs an image path")
        self.type = type
        self.intensity, self.color = float(intensity), _rgb(color)
        self.direction = _rgb(direction)
        self.envmap = envmap

    def set(self, *, intensity=None, color=None, direction=None) -> None:
        if intensity is not None:
            self.intensity = float(intensity)
        if color is not None:
            self.color = _rgb(color)
        if direction is not None:
            self.direction = _rgb(direction)
        self._changed("light")

    def state(self):
        return (dict(type=self.type, intensity=self.intensity,
                     color=self.color, direction=self.direction,
                     envmap=self.envmap), {})


class CameraSensor(_Object):
    """A camera (an image sensor, not the viewer's camera) per instance.

    Intrinsics are OpenCV's: ``K`` ``[3, 3]`` for a ``width`` x ``height``
    image (pixel centers at integers) and optional distortion ``dist``
    (OpenCV order k1 k2 p1 p2 [k3 [k4 k5 k6 [s1 s2 s3 s4]]], tilt not
    supported). The camera frame is OpenCV's too: x right, y down, z
    forward.

    ``mount`` (a :class:`RigidMesh` or its name) and ``body`` attach the
    camera to a body: its pose is that body's pose times ``local_pose``
    (``[7]`` or ``[instances, 7]``). Without a mount, ``local_pose`` is the
    camera's world pose and ``instances`` must be given.

    Per-instance lens and sensor values, for domain randomization:
    ``aperture_radius`` (m, 0 = pinhole; a lens of focal length f at
    f-number N has f / 2N) and ``focus_distance`` (m) give depth of field;
    ``gain`` ``[3]`` or ``[instances, 3]`` multiplies the linear RGB
    (exposure and white balance); ``vignetting`` is the fraction of light
    lost at the image corner farthest from the principal point (falloff
    ``1 - v r^2``, ``r`` = 1 there); ``shot_noise`` / ``read_noise`` add
    sensor noise of variance ``shot_noise * x + read_noise^2`` to each
    channel of the linear image ``x`` (white = 1). Renderers apply them in
    that order (:mod:`rillfacet.render.sensor`). ``near`` / ``far`` clip
    the z-depth.
    """
    kind = "camera_sensor"

    def __init__(self, scene, name, width, height, K, *, dist=None,
                 mount=None, body=0, local_pose=(0, 0, 0, 0, 0, 0, 1),
                 instances=None, near=0.01, far=10.0, aperture_radius=0.0,
                 focus_distance=1.0, gain=(1.0, 1.0, 1.0), vignetting=0.0,
                 shot_noise=0.0, read_noise=0.0):
        super().__init__(scene, name)
        self.width, self.height = int(width), int(height)
        self.K = np.asarray(K, np.float64).reshape(3, 3)
        d = None if dist is None else np.asarray(dist, np.float64).ravel()
        self.dist = None if d is None or not np.any(d) else d
        if self.dist is not None and len(self.dist) > 12 and np.any(
                self.dist[12:]):
            raise ValueError("CameraSensor: tilted sensors (tau_x, tau_y) "
                             "are not supported")
        self.mount = (None if mount is None
                      else mount if isinstance(mount, str) else mount.name)
        self.body = int(body)
        if self.mount is not None:
            m = scene.objects.get(self.mount)
            if not isinstance(m, RigidMesh):
                raise ValueError(f"CameraSensor: no rigid mesh {self.mount!r}")
            if not 0 <= self.body < m.num_bodies:
                raise ValueError("CameraSensor: body out of range")
            if instances is not None and int(instances) != m.instances:
                raise ValueError("CameraSensor: instances != the mount's")
            instances = m.instances
        elif instances is None:
            raise ValueError("CameraSensor: give a mount or instances")
        self.instances = int(instances)
        self.near, self.far = float(near), float(far)
        self.local_pose = None
        self.set_local_pose(local_pose, _notify=False)
        self.aperture_radius = self.focus_distance = self.gain = None
        self.vignetting = self.shot_noise = self.read_noise = None
        self.set_lens(aperture_radius=aperture_radius,
                      focus_distance=focus_distance, gain=gain,
                      vignetting=vignetting, shot_noise=shot_noise,
                      read_noise=read_noise, _notify=False)

    def set_local_pose(self, pose, _notify=True) -> None:
        """``[7]`` or ``[instances, 7]``: the camera in its mount body's
        frame (or in the world, without a mount). numpy or torch."""
        if hasattr(pose, "detach"):
            self.local_pose = pose.reshape(-1, 7).expand(self.instances, 7)
        else:
            self.local_pose = np.broadcast_to(
                np.asarray(pose, np.float32).reshape(-1, 7),
                (self.instances, 7)).copy()
        if _notify:
            self._changed("pose")

    def set_lens(self, *, aperture_radius=None, focus_distance=None,
                 gain=None, vignetting=None, shot_noise=None, read_noise=None,
                 _notify=True) -> None:
        """Per-instance (or shared) lens / sensor values."""
        I = self.instances
        for name, v in (("vignetting", vignetting), ("shot_noise", shot_noise),
                        ("read_noise", read_noise)):
            if v is not None:
                v = np.broadcast_to(_host(v), (I,)).astype(np.float32)
                if (v < 0).any() or (name == "vignetting" and (v > 1).any()):
                    raise ValueError(f"CameraSensor: {name} out of range")
                setattr(self, name, v.copy())
        if aperture_radius is not None:
            self.aperture_radius = np.broadcast_to(
                _host(aperture_radius), (I,)).copy()
        if focus_distance is not None:
            self.focus_distance = np.broadcast_to(
                _host(focus_distance), (I,)).copy()
        if gain is not None:
            self.gain = np.broadcast_to(_host(gain), (I, 3)).copy()
        if _notify:
            self._changed("lens")

    def world_poses(self):
        """``[instances, 7]`` camera poses in the world (env-local frame):
        the mount body's current poses composed with :attr:`local_pose`.
        torch if the mount's poses or the local pose are torch."""
        local = self.local_pose
        if self.mount is None:
            return local
        m = self.scene.objects.get(self.mount)
        if m is None:
            raise RuntimeError(f"CameraSensor {self.name!r}: mount "
                               f"{self.mount!r} was removed")
        if m.poses is None:
            raise RuntimeError(f"CameraSensor {self.name!r}: the mount has "
                               "no poses yet (set_poses)")
        body = m.poses[:, self.body]
        if hasattr(body, "detach") or hasattr(local, "detach"):
            import torch
            dev = body.device if hasattr(body, "device") else local.device
            body = torch.as_tensor(body, device=dev).float()
            local = torch.as_tensor(local, device=dev).float()
            return compose(body, local)
        return compose(np.asarray(body), local).astype(np.float32)

    def state(self):
        attrs = dict(width=self.width, height=self.height,
                     K=self.K.tolist(),
                     dist=None if self.dist is None else self.dist.tolist(),
                     mount=self.mount, body=self.body,
                     instances=self.instances, near=self.near, far=self.far)
        return attrs, dict(local_pose=_host(self.local_pose),
                           aperture_radius=self.aperture_radius,
                           focus_distance=self.focus_distance, gain=self.gain,
                           vignetting=self.vignetting,
                           shot_noise=self.shot_noise,
                           read_noise=self.read_noise)


# --------------------------------------------------------------------------
# scene + backends
# --------------------------------------------------------------------------

class Backend:
    """What a scene sends its changes to. ``create`` gets a new object,
    ``update`` the object and what changed ("poses", "colors",
    "visibility", "materials", "boxes", "points", "values", "texts",
    "light", "pose", "lens"), ``remove`` its name. Backends skip the
    object kinds they do not draw. ``draw_overlay`` is called once per
    frame with every label set (immediate-mode viewers rebuild text each
    frame)."""

    def create(self, obj) -> None: ...
    def update(self, obj, what: str) -> None: ...
    def remove(self, name: str) -> None: ...
    def set_channels(self, channels: dict) -> None: ...   # the changed ones
    def look_at(self, eye, target) -> None: ...
    def draw_overlay(self, labels) -> None: ...


class Scene:
    """Named scene objects, mirrored to every attached backend."""

    def __init__(self, *backends: Backend):
        self.backends = list(backends)
        self.objects: dict = {}
        self.channels: dict = {}
        self.camera = None                   # (eye, target) once set

    # -- backends -----------------------------------------------------------

    def add_backend(self, backend: Backend) -> None:
        """Attach a backend and send it everything shown so far."""
        self.backends.append(backend)
        for obj in self.objects.values():
            backend.create(obj)
        if self.camera is not None:
            backend.look_at(*self.camera)
        if self.channels:
            backend.set_channels(self.channels)

    def snapshot(self) -> dict:
        """The whole scene as data: ``{"objects": [{"kind", "name",
        "attrs", "arrays"}], "camera": (eye, target) | None, "channels":
        {name: array}}`` (host numpy arrays, JSON-able attrs). What a
        backend attached late, a record or a web client starts from."""
        objs = []
        for o in self.objects.values():
            attrs, arrays = o.state()
            objs.append(dict(kind=o.kind, name=o.name, attrs=attrs,
                             arrays=arrays))
        return dict(objects=objs, camera=self.camera,
                    channels={k: (v if np.isscalar(v) else _host(v))
                              for k, v in self.channels.items()})

    def backend(self, cls):
        """The first attached backend of type ``cls``, or None."""
        return next((b for b in self.backends if isinstance(b, cls)), None)

    # -- objects ------------------------------------------------------------

    def _add(self, obj):
        if obj.name in self.objects:
            self.remove(obj.name)
        self.objects[obj.name] = obj
        for b in self.backends:
            b.create(obj)
        return obj

    def _update(self, obj, what):
        for b in self.backends:
            b.update(obj, what)

    def remove(self, name: str) -> None:
        if self.objects.pop(name, None) is not None:
            for b in self.backends:
                b.remove(name)

    def rigid_mesh(self, name, local_vertices, vertex_body, triangles,
                   body_triangle_offsets, **kw) -> RigidMesh:
        return self._add(RigidMesh(self, name, local_vertices, vertex_body,
                                   triangles, body_triangle_offsets, **kw))

    def boxes(self, name, lo, hi, color=(0.8, 0.8, 0.8),
              colors=None) -> Boxes:
        return self._add(Boxes(self, name, lo, hi, color, colors))

    def points(self, name, points, color, radius) -> Points:
        return self._add(Points(self, name, points, color, radius))

    def polyline(self, name, points, color, radius,
                 closed=False) -> Polyline:
        return self._add(Polyline(self, name, points, color, radius, closed))

    def labels(self, name, anchors, **kw) -> Labels:
        return self._add(Labels(self, name, anchors, **kw))

    def light(self, name, type="directional", **kw) -> Light:
        return self._add(Light(self, name, type, **kw))

    def camera_sensor(self, name, width, height, K, **kw) -> CameraSensor:
        return self._add(CameraSensor(self, name, width, height, K, **kw))

    # -- per frame ----------------------------------------------------------

    def set_channels(self, **channels) -> None:
        """Named values (per-env arrays or scalars) for panels and plots.
        Backends are sent the channels passed here; :attr:`channels` keeps
        the latest value of every channel."""
        changed = {k: (v if np.isscalar(v) else _host(v))
                   for k, v in channels.items()}
        self.channels.update(changed)
        for b in self.backends:
            b.set_channels(changed)

    def look_at(self, eye, target) -> None:
        self.camera = (tuple(map(float, eye)), tuple(map(float, target)))
        for b in self.backends:
            b.look_at(*self.camera)

    def draw_overlay(self) -> None:
        """Per-frame text for immediate-mode backends: call from the viewer
        callback (a native ``Viewer`` rebuilds its overlay every frame)."""
        labels = [o for o in self.objects.values() if isinstance(o, Labels)]
        for b in self.backends:
            b.draw_overlay(labels)


class NativeBackend(Backend):
    """Mirrors a :class:`Scene` into an ``rillfacet.Viewer``: rigid meshes
    and boxes become segmented surface meshes, points and polylines point
    clouds and curves, labels overlay text. :meth:`structure` returns the
    viewer structure behind an object for native-only features (picking,
    the inspector)."""

    def __init__(self, viewer):
        from . import _rillfacet as native
        self.v = viewer
        self._native = native
        self._skin_cache: dict = {}        # rigid mesh name -> device arrays

    def structure(self, name: str):
        return self.v.scene.get(name)

    # -- create / update ----------------------------------------------------

    def create(self, obj) -> None:
        sc = self.v.scene
        if isinstance(obj, RigidMesh):
            m = sc.add_mesh(obj.name)
            V = len(obj.local_vertices)
            tris = (obj.triangles[None].astype(np.int64)
                    + V * np.arange(obj.instances)[:, None, None])
            T = int(obj.body_triangle_offsets[-1])
            seg = np.concatenate(
                [obj.body_triangle_offsets[:-1] + k * T
                 for k in range(obj.instances)] + [[obj.instances * T]])
            m.set_geometry(self._rigid_vertices(obj),
                           tris.reshape(-1, 3).astype(np.uint32))
            m.set_segments(seg.astype(np.uint32), obj.segment_names())
            m.rigid_segments = True
            m.smooth_shading = obj.smooth
            m.color_source = self._native.ColorSource.SegmentPalette
            for s in range(obj.num_segments):
                m.set_segment_color(s, _rgb(obj.segment_colors[s]))
                if not obj.segment_visible[s]:
                    m.set_segment_visible(s, False)
        elif isinstance(obj, Boxes):
            m = sc.add_mesh(obj.name)
            m.set_geometry(*box_mesh(obj.lo, obj.hi))
            m.color = obj.color
            self._box_colors(m, obj)
        elif isinstance(obj, Points):
            p = sc.add_points(obj.name)
            p.set_points(obj.points, obj.radii)
            p.color, p.radius = obj.color, obj.radius
        elif isinstance(obj, Polyline):
            c = sc.add_curves(obj.name)
            c.set_polyline(obj.points, obj.closed)
            c.color, c.radius = obj.color, obj.radius

    def update(self, obj, what: str) -> None:
        s = self.structure(obj.name)
        if s is None:
            return
        if isinstance(obj, RigidMesh):
            if what == "poses":
                s.set_positions(self._rigid_vertices(obj))
            elif what == "colors":
                for i in range(obj.num_segments):
                    s.set_segment_color(i, _rgb(obj.segment_colors[i]))
            elif what == "visibility":
                for i in range(obj.num_segments):
                    s.set_segment_visible(i, bool(obj.segment_visible[i]))
        elif isinstance(obj, Boxes):
            verts, tris = box_mesh(obj.lo, obj.hi)
            if s.num_vertices == len(verts):
                s.set_positions(verts)
            else:
                s.set_geometry(verts, tris)
            self._box_colors(s, obj)
        elif isinstance(obj, Points):
            s.set_points(obj.points, obj.radii)
        elif isinstance(obj, Polyline):
            s.set_polyline(obj.points, obj.closed)

    def remove(self, name: str) -> None:
        self._skin_cache.pop(name, None)
        if self.structure(name) is not None:
            self.v.scene.remove(name)

    def look_at(self, eye, target) -> None:
        self.v.camera.look_at(eye, target)

    def draw_overlay(self, labels) -> None:
        ov = self.v.overlay
        for lab in labels:
            kw = dict(color=lab.color, align=lab.align)
            if lab.world_height > 0.0:
                kw["world_height"] = lab.world_height
            else:
                kw["size_px"] = lab.size_px
            for text, a in zip(lab.strings(), lab.anchors):
                ov.text(text, (float(a[0]), float(a[1]), float(a[2])), **kw)

    # -- helpers ------------------------------------------------------------

    def _box_colors(self, m, obj: Boxes) -> None:
        if obj.colors is None:
            m.color_source = self._native.ColorSource.Uniform
            return
        m.add_color("value", self._native.ElementKind.Vertex,
                    np.repeat(obj.colors, 8, axis=0))
        m.color_quantity = "value"
        m.color_source = self._native.ColorSource.Quantity

    def _rigid_vertices(self, obj: RigidMesh) -> np.ndarray:
        """``[instances * V, 3]`` world vertices, grid offsets applied."""
        V = len(obj.local_vertices)
        if obj.world_vertices is not None:
            wv = obj.world_vertices
            w = _host(wv() if callable(wv) else wv).reshape(obj.instances, V, 3)
        elif obj.poses is not None:
            poses = obj.poses
            if hasattr(poses, "detach"):          # skin on the pose device
                import torch
                key = (obj.name, str(poses.device))
                if key not in self._skin_cache:
                    self._skin_cache.clear()
                    self._skin_cache[key] = (
                        torch.as_tensor(obj.local_vertices,
                                        device=poses.device),
                        torch.as_tensor(obj.vertex_body,
                                        device=poses.device))
                local, vb = self._skin_cache[key]
                w = _host(skin(local, vb, poses.float()))
            else:
                w = skin(obj.local_vertices, obj.vertex_body,
                         _host(poses)).astype(np.float32)
        else:                                      # rest pose
            w = np.broadcast_to(obj.local_vertices, (obj.instances, V, 3))
        return (w + obj.offsets[:, None, :]).reshape(-1, 3).astype(np.float32)


_WRAPPED: dict = {}


def as_scene(target) -> Scene:
    """``target`` if it is a :class:`Scene`, else a scene drawing into the
    ``rillfacet.Viewer`` ``target`` (one shared scene per viewer)."""
    if isinstance(target, Scene):
        return target
    key = id(target)
    sc = _WRAPPED.get(key)
    if sc is None or sc.backend(NativeBackend).v is not target:
        sc = _WRAPPED[key] = Scene(NativeBackend(target))
    return sc
