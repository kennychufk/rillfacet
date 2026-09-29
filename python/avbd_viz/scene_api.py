"""Backend-neutral scene for simulator visualizations.

Visualization code describes WHAT to show through a :class:`Scene`; backends
decide HOW: :class:`NativeBackend` drives an ``avbd_viz.Viewer`` window, and
the web stream / eval recorder backends (avbd-viz web viewer) send the same
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

Poses are ``[..., 7]`` = translation xyz + quaternion xyzw. Arrays may be
numpy or torch (CUDA ok); they are converted where a backend needs host data.
Colors are sRGB in 0..1.
"""
from __future__ import annotations

import numpy as np

__all__ = ["Scene", "Backend", "NativeBackend", "RigidMesh", "Boxes",
           "Points", "Polyline", "Labels", "box_mesh", "as_scene"]


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


class RigidMesh(_Object):
    """Rigid bodies of one simulator, drawn for ``instances`` copies (envs).

    ``local_vertices`` ``[V, 3]`` are body-local, ``vertex_body`` ``[V]`` the
    body of each vertex, ``triangles`` ``[T, 3]`` index them, and
    ``body_triangle_offsets`` ``[B+1]`` group the triangles by body (bodies
    in order, contiguous). A segment is one (instance, body):
    ``segment = instance * B + body``. ``offsets`` ``[instances, 3]`` shift
    each instance render-side (a display grid). Segment names are
    ``"<instance name>/<body name>"`` (just the body name for one instance);
    ``instance_names`` default to ``env0``, ``env1``, ..."""
    kind = "rigid_mesh"

    def __init__(self, scene, name, local_vertices, vertex_body, triangles,
                 body_triangle_offsets, *, instances=1, offsets=None,
                 body_names=None, instance_names=None, colors=None,
                 smooth=False):
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
        return (dict(instances=self.instances, body_names=self.body_names,
                     instance_names=self.instance_names, smooth=self.smooth),
                arrays)


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


# --------------------------------------------------------------------------
# scene + backends
# --------------------------------------------------------------------------

class Backend:
    """What a scene sends its changes to. ``create`` gets a new object,
    ``update`` the object and what changed ("poses", "colors",
    "visibility", "boxes", "points", "values", "texts"), ``remove`` its
    name. ``draw_overlay`` is called once per frame with every label set
    (immediate-mode viewers rebuild text each frame)."""

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
    """Mirrors a :class:`Scene` into an ``avbd_viz.Viewer``: rigid meshes
    and boxes become segmented surface meshes, points and polylines point
    clouds and curves, labels overlay text. :meth:`structure` returns the
    viewer structure behind an object for native-only features (picking,
    the inspector)."""

    def __init__(self, viewer):
        from . import _avbd_viz as native
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
    ``avbd_viz.Viewer`` ``target`` (one shared scene per viewer)."""
    if isinstance(target, Scene):
        return target
    key = id(target)
    sc = _WRAPPED.get(key)
    if sc is None or sc.backend(NativeBackend).v is not target:
        sc = _WRAPPED[key] = Scene(NativeBackend(target))
    return sc
