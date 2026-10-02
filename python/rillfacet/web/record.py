"""Records of a scene session: what an eval episode looked like, replayable
without a simulator or a GPU.

A :class:`Recorder` is a ``scene_api`` backend. Between :meth:`Recorder.start`
and :meth:`Recorder.finish` it logs every scene update against a clock the
caller advances with :meth:`Recorder.tick` (e.g. the physics step index), as
TRACKS: ``(object, field)`` -> sample times ``t [K]`` + values ``[K, ...]``.
Rigid-mesh poses become the ``(name, "poses")`` track, box sets their
``lo``/``hi``/``colors``, labels their ``values``, channels
``("channels", name)``, and so on. Replay shows, at time ``t``, each track's
latest sample at or before ``t`` over the start snapshot.

On disk (:func:`write_record` / :func:`read_record`), a record is a
directory ``<root>/<id>/`` with ``meta.json`` (caller metadata + the track
manifest), ``tracks.npz`` and ``summary.json``; the start snapshot is stored
once per content hash as ``<root>/scenes/<hash>.npz`` and ``<root>/index.json``
lists the records (append-only). Pose tracks are compressed: bodies that
never move are stored once, the rest quantized to int16 (positions over
their range, quaternions over [-1, 1]); :func:`pose_codec_error` reports the
worst position error. :class:`RecordWriter` does the compression and file
I/O on a background thread.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import queue
import threading

import numpy as np

from ..scene_api import Backend, Boxes, Labels, Points, Polyline, RigidMesh

__all__ = ["Recorder", "Record", "RecordWriter", "write_record",
           "read_record", "read_index", "encode_poses", "decode_poses",
           "pose_codec_error"]

#: Samples per pinned host chunk for GPU tracks.
_CHUNK = 512

#: Per object kind: snapshot arrays that are dynamic (recorded as tracks,
#: left out of the stored snapshot) and the updates that log the initial
#: dynamic state.
_DYNAMIC = {"rigid_mesh": ("poses",), "labels": ("values",)}
_INITIAL = {"rigid_mesh": ("poses",), "boxes": ("boxes",),
            "labels": ("values",), "points": ("points",),
            "polyline": ("points",)}


class _Track:
    """Samples of one field. torch CUDA samples are copied without blocking
    into pinned host chunks (valid after a device sync); anything else is
    copied to numpy right away."""

    def __init__(self):
        self.t: list = []
        self._items: list = []             # numpy array | index of a GPU sample
        self._chunks: list = []            # pinned torch [_CHUNK, *shape]
        self._ngpu = 0
        self._shape = None

    def append(self, t: int, x) -> None:
        if hasattr(x, "is_cuda") and x.is_cuda:
            import torch
            if self._shape is None:
                self._shape = tuple(x.shape)
            elif tuple(x.shape) != self._shape:
                raise ValueError("record track: shape changed mid-record")
            i = self._ngpu % _CHUNK
            if i == 0:
                self._chunks.append(torch.empty((_CHUNK, *self._shape),
                                                dtype=x.dtype,
                                                pin_memory=True))
            self._chunks[-1][i].copy_(x.detach(), non_blocking=True)
            self._items.append(self._ngpu)
            self._ngpu += 1
        else:
            if hasattr(x, "detach"):
                x = x.detach().cpu().numpy()
            self._items.append(np.array(x, copy=True))
        self.t.append(int(t))

    def arrays(self):
        """``(t [K] int32, values [K, ...])``; call after a device sync."""
        t = np.asarray(self.t, np.int32)
        gpu = None
        if self._chunks:
            import torch
            gpu = torch.cat(self._chunks)[:self._ngpu].numpy()
            if self._ngpu == len(self._items):
                return t, gpu
        return t, np.stack([gpu[x] if isinstance(x, int) else x
                            for x in self._items])


class Record:
    """A finished recording: the start ``snapshot`` (``Scene.snapshot()``)
    and ``tracks`` ``{(object, field): (t, values)}``."""

    def __init__(self, snapshot: dict, tracks: dict):
        self.snapshot, self.tracks = snapshot, tracks

    def track(self, obj: str, field: str):
        return self.tracks[(obj, field)]


class Recorder(Backend):
    """Scene backend logging updates between :meth:`start` and
    :meth:`finish` (ignored otherwise)."""

    def __init__(self):
        self.active = False
        self.t = 0
        self._scene = None
        self._snapshot = None
        self._tracks: dict = {}

    def start(self, scene, t: int = 0) -> None:
        """Begin logging at time ``t``. The scene's STATIC part (geometry,
        layout, colors) becomes the record's snapshot; its current DYNAMIC
        state (poses, box extents, label values, channels) is logged as the
        first samples at ``t``, so the snapshot of a scene is the same for
        every record of it (stored once, see :func:`write_record`)."""
        self._scene = scene
        snap = scene.snapshot()
        for o in snap["objects"]:
            for k in _DYNAMIC.get(o["kind"], ()):
                o["arrays"].pop(k, None)
        snap["channels"] = {}
        self._snapshot = snap
        self._tracks = {}
        self.t = int(t)
        self.active = True
        for obj in scene.objects.values():
            for what in _INITIAL.get(obj.kind, ()):
                if what == "poses" and obj.poses is None:
                    continue
                self.update(obj, what)
        if scene.channels:
            self.set_channels(scene.channels)

    def tick(self, t: int) -> None:
        """Advance the clock: later updates are logged at ``t``."""
        self.t = int(t)

    def finish(self) -> Record:
        self.active = False
        try:
            import torch
            if torch.cuda.is_available():
                torch.cuda.synchronize()
        except ImportError:
            pass
        tracks = {k: tr.arrays() for k, tr in self._tracks.items()}
        self._tracks = {}
        return Record(self._snapshot, tracks)

    def _log(self, obj: str, field: str, x) -> None:
        tr = self._tracks.get((obj, field))
        if tr is None:
            tr = self._tracks[(obj, field)] = _Track()
        tr.append(self.t, x)

    # -- Backend ------------------------------------------------------------

    def update(self, obj, what: str) -> None:
        if not self.active:
            return
        n = obj.name
        if isinstance(obj, RigidMesh):
            if what == "poses":
                self._log(n, "poses", obj.poses)
            elif what == "colors":
                self._log(n, "segment_colors", obj.segment_colors)
            elif what == "visibility":
                self._log(n, "segment_visible", obj.segment_visible)
        elif isinstance(obj, Boxes):
            self._log(n, "lo", obj.lo)
            self._log(n, "hi", obj.hi)
            if obj.colors is not None:
                self._log(n, "colors", obj.colors)
        elif isinstance(obj, (Points, Polyline)):
            self._log(n, "points", obj.points)
        elif isinstance(obj, Labels) and what == "values":
            if obj.values is not None:
                self._log(n, "values", obj.values)

    def set_channels(self, channels: dict) -> None:
        if not self.active:
            return
        for k, v in channels.items():
            self._log("channels", k, np.asarray(v))

    def create(self, obj) -> None:
        if self.active:
            raise RuntimeError("Recorder: scene objects added mid-record")


# --------------------------------------------------------------------------
# pose codec
# --------------------------------------------------------------------------

def encode_poses(poses: np.ndarray) -> dict:
    """Compress ``[K, n, B, 7]`` poses: static bodies (same pose in every
    sample, per env) once, the rest as int16."""
    poses = np.asarray(poses, np.float32)
    static = np.all(poses == poses[:1], axis=(0, 1, 3))        # [B]
    dyn = poses[:, :, ~static]
    out = dict(static_mask=static, static_poses=poses[0][:, static],
               shape=np.asarray(poses.shape, np.int64))
    if dyn.size:
        p = dyn[..., :3]
        lo = p.min(axis=(0, 1, 2))
        span = np.maximum(p.max(axis=(0, 1, 2)) - lo, 1e-9)
        out["pos_lo"], out["pos_span"] = lo, span
        pos_q = np.round((p - lo) / span * 65535.0 - 32768.0).astype(np.int16)
        rot_q = np.round(np.clip(dyn[..., 3:], -1, 1) * 32767.0
                         ).astype(np.int16)
        # Delta along time (wrapping int16): smooth motion -> small values
        # that compress well.
        out["pos_dq"] = np.diff(pos_q, axis=0, prepend=np.zeros_like(pos_q[:1]))
        out["rot_dq"] = np.diff(rot_q, axis=0, prepend=np.zeros_like(rot_q[:1]))
    return out


def decode_poses(enc: dict) -> np.ndarray:
    K, n, B, _ = (int(x) for x in enc["shape"])
    static = enc["static_mask"].astype(bool)
    poses = np.empty((K, n, B, 7), np.float32)
    poses[:, :, static] = enc["static_poses"][None]
    if "pos_dq" in enc:
        pos_q = np.cumsum(enc["pos_dq"], axis=0, dtype=np.int16)
        rot_q = np.cumsum(enc["rot_dq"], axis=0, dtype=np.int16)
        pos = ((pos_q.astype(np.float32) + 32768.0) / 65535.0
               * enc["pos_span"] + enc["pos_lo"])
        q = rot_q.astype(np.float32) / 32767.0
        q /= np.linalg.norm(q, axis=-1, keepdims=True)
        poses[:, :, ~static] = np.concatenate([pos, q], axis=-1)
    return poses


def pose_codec_error(enc: dict) -> float:
    """Worst-case position quantization error (world units)."""
    return 0.0 if "pos_span" not in enc else float(
        np.max(enc["pos_span"]) / 65535.0 / 2.0)


# --------------------------------------------------------------------------
# files
# --------------------------------------------------------------------------

def _npz_bytes(arrays: dict) -> bytes:
    buf = io.BytesIO()
    np.savez_compressed(buf, **arrays)
    return buf.getvalue()


def _write_atomic(path: str, data: bytes) -> None:
    tmp = path + ".tmp"
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, path)


def _snapshot_npz(snapshot: dict) -> bytes:
    manifest, arrays = [], {}
    for i, o in enumerate(snapshot["objects"]):
        keys = []
        for k, a in o["arrays"].items():
            arrays[f"{i}/{k}"] = a
            keys.append(k)
        manifest.append(dict(kind=o["kind"], name=o["name"],
                             attrs=o["attrs"], arrays=keys))
    for k, v in snapshot.get("channels", {}).items():
        arrays[f"channels/{k}"] = np.asarray(v)
    arrays["manifest"] = np.frombuffer(json.dumps(dict(
        objects=manifest, camera=snapshot.get("camera"))).encode(), np.uint8)
    return _npz_bytes(arrays)


def _read_snapshot(path: str) -> dict:
    z = np.load(path)
    man = json.loads(bytes(z["manifest"]).decode())
    objs = [dict(kind=o["kind"], name=o["name"], attrs=o["attrs"],
                 arrays={k: z[f"{i}/{k}"] for k in o["arrays"]})
            for i, o in enumerate(man["objects"])]
    ch = {k.split("/", 1)[1]: z[k] for k in z.files
          if k.startswith("channels/")}
    return dict(objects=objs, camera=man["camera"], channels=ch)


def write_record(root: str, rid: str, record: Record, *, meta: dict,
                 summary: dict) -> str:
    """Write ``record`` as ``<root>/<rid>/`` and append it to
    ``<root>/index.json``. Returns the record directory."""
    d = os.path.join(root, rid)
    os.makedirs(os.path.join(root, "scenes"), exist_ok=True)
    os.makedirs(d, exist_ok=True)

    scene_bytes = _snapshot_npz(record.snapshot)
    scene_hash = hashlib.sha1(scene_bytes).hexdigest()[:16]
    scene_path = os.path.join(root, "scenes", f"{scene_hash}.npz")
    if not os.path.exists(scene_path):
        _write_atomic(scene_path, scene_bytes)

    arrays, manifest, codec_err = {}, [], 0.0
    for i, ((obj, field), (t, v)) in enumerate(sorted(record.tracks.items())):
        entry = dict(object=obj, field=field, key=str(i), samples=len(t))
        arrays[f"{i}/t"] = t
        if field == "poses" and v.ndim == 4 and v.shape[-1] == 7:
            enc = encode_poses(v)
            codec_err = max(codec_err, pose_codec_error(enc))
            for k, a in enc.items():
                arrays[f"{i}/poses.{k}"] = a
            entry["codec"] = "poses_q16"
        else:
            arrays[f"{i}/v"] = v
        manifest.append(entry)
    _write_atomic(os.path.join(d, "tracks.npz"), _npz_bytes(arrays))

    meta = dict(meta, id=rid, scene=f"scenes/{scene_hash}.npz",
                tracks=manifest, pose_error=codec_err)
    _write_atomic(os.path.join(d, "meta.json"),
                  json.dumps(meta, indent=1).encode())
    _write_atomic(os.path.join(d, "summary.json"),
                  json.dumps(summary, indent=1).encode())

    index = read_index(root)
    index = [e for e in index if e.get("id") != rid]
    index.append(dict(id=rid, **{k: meta[k] for k in ("timestep",
                                                      "checkpoint")
                                 if k in meta},
                      summary=summary.get("batch", {})))
    _write_atomic(os.path.join(root, "index.json"),
                  json.dumps(index, indent=1).encode())
    return d


def read_index(root: str) -> list:
    path = os.path.join(root, "index.json")
    if not os.path.exists(path):
        return []
    with open(path) as f:
        return json.load(f)


def read_record(path: str, *, raw_poses: bool = False):
    """``(meta, Record, summary)`` of the record directory ``path``. Pose
    tracks are decoded, or with ``raw_poses`` left as their
    :func:`encode_poses` dicts (what the web replay sends)."""
    with open(os.path.join(path, "meta.json")) as f:
        meta = json.load(f)
    with open(os.path.join(path, "summary.json")) as f:
        summary = json.load(f)
    root = os.path.dirname(os.path.normpath(path))
    snapshot = _read_snapshot(os.path.join(root, meta["scene"]))
    z = np.load(os.path.join(path, "tracks.npz"))
    tracks = {}
    for e in meta["tracks"]:
        k = e["key"]
        if e.get("codec") == "poses_q16":
            pre = f"{k}/poses."
            v = {n[len(pre):]: z[n] for n in z.files if n.startswith(pre)}
            if not raw_poses:
                v = decode_poses(v)
        else:
            v = z[f"{k}/v"]
        tracks[(e["object"], e["field"])] = (z[f"{k}/t"], v)
    return meta, Record(snapshot, tracks), summary


class RecordWriter:
    """Writes records on a background thread (compression + file I/O stay
    off the caller's thread). :meth:`close` waits for pending writes."""

    def __init__(self, root: str):
        self.root = root
        self._q: queue.Queue = queue.Queue()
        self.errors: list = []
        self._thread = threading.Thread(target=self._run, daemon=True,
                                        name="rillfacet record writer")
        self._thread.start()

    def submit(self, rid: str, record: Record, *, meta: dict, summary: dict,
               done=None) -> None:
        """Queue a write; ``done(path)`` is called on the writer thread."""
        self._q.put((rid, record, meta, summary, done))

    def _run(self):
        while True:
            item = self._q.get()
            if item is None:
                self._q.task_done()
                return
            rid, record, meta, summary, done = item
            try:
                path = write_record(self.root, rid, record, meta=meta,
                                    summary=summary)
                if done is not None:
                    done(path)
            except Exception as e:                  # noqa: BLE001
                self.errors.append((rid, e))
                print(f"[rillfacet] record {rid} failed: {e!r}")
            finally:
                self._q.task_done()

    def flush(self) -> None:
        self._q.join()

    def close(self) -> None:
        self._q.put(None)
        self._thread.join()
