"""Replay of recorded scene sessions in the web viewer, and the standalone
replay server::

    python -m avbd_viz.web.replay RUN_DIR [--port 8080] [--host 0.0.0.0]

``RUN_DIR`` is a training run's experiment directory (its ``evals/``
records, see :mod:`avbd_viz.web.record`) or an ``evals`` directory itself.
The same client that watches a live run then browses and scrubs its saved
evals, with no simulator and no GPU.

A replay goes to the browser as one ``replay`` message (the start snapshot,
metadata, summary and every small track in full) followed by
``replay_chunk`` messages carrying the pose tracks: int16-quantized (the
record's codec), delta-coded along time within the chunk and zlib-deflated,
so a 16-env eval of 2,500 physics steps is about 3 MB on the wire instead
of 32 MB. The client plays tracks as recorded: at time ``t`` each track
shows its latest sample at or before ``t``; poses are interpolated.

Sources: :class:`EvalLibrary` (records on disk) and :class:`RingMailbox`
(records built on request by the producing process, e.g. a trainer's
in-memory ring of the last training episodes).
"""
from __future__ import annotations

import argparse
import concurrent.futures
import os
import threading
import time
import zlib

import numpy as np

from .record import encode_poses, read_index, read_record

__all__ = ["ReplayData", "EvalLibrary", "RingMailbox", "CHUNK_TICKS",
           "decode_chunk", "build_scene", "set_state", "main"]

#: Pose samples per ``replay_chunk``.
CHUNK_TICKS = 256


def _json(x):
    """``x`` with numpy scalars made JSON-able (arrays are left alone)."""
    if isinstance(x, dict):
        return {str(k): _json(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_json(v) for v in x]
    if isinstance(x, np.generic):
        return x.item()
    return x


class ReplayData:
    """One record prepared for the wire. ``record.tracks`` pose values may
    be float ``[K, n, B, 7]`` arrays or :func:`encode_poses` dicts.
    ``tick_seconds`` is the duration of one clock tick (a physics step for
    evals); ``source`` / ``name`` label it in the client."""

    def __init__(self, meta: dict, record, summary: dict, *, source: str,
                 name: str, tick_seconds: float):
        self.meta, self.summary = meta, summary
        self.source, self.name = source, name
        self.tick_seconds = float(tick_seconds)
        self.snapshot = record.snapshot
        self.tracks = []                  # (object, field, t, values | enc)
        self.poses = []                   # track index -> absolute int16 q
        for (obj, field), (t, v) in sorted(record.tracks.items()):
            if field == "poses" and (isinstance(v, dict) or (
                    np.ndim(v) == 4 and np.shape(v)[-1] == 7)):
                enc = v if isinstance(v, dict) else encode_poses(v)
                self.tracks.append((obj, field, t, enc))
            else:
                self.tracks.append((obj, field, t, np.asarray(v)))
        self.duration = max((int(t[-1]) for _, _, t, _ in self.tracks
                             if len(t)), default=0)

    def header(self, rid: int) -> dict:
        tracks = []
        for obj, field, t, v in self.tracks:
            e: dict = dict(object=obj, field=field,
                           t=np.asarray(t, np.int32))
            if isinstance(v, dict):
                K, n, B, _ = (int(x) for x in v["shape"])
                static = v["static_mask"].astype(bool)
                e["pose"] = dict(
                    samples=K, envs=n, bodies=B,
                    static_mask=static.astype(np.uint8),
                    static_poses=v["static_poses"].astype(np.float32),
                    pos_lo=np.asarray(v.get("pos_lo", np.zeros(3)), np.float32),
                    pos_span=np.asarray(v.get("pos_span", np.ones(3)),
                                        np.float32),
                    chunk=CHUNK_TICKS,
                    chunks=-(-K // CHUNK_TICKS) if "pos_dq" in v else 0)
            else:
                e["values"] = v
            tracks.append(e)
        snap = self.snapshot
        return dict(type="replay", id=rid, source=self.source,
                    name=self.name, meta=_json(self.meta),
                    summary=_json(self.summary),
                    tick_seconds=self.tick_seconds, duration=self.duration,
                    scene=dict(objects=snap["objects"],
                               camera=snap.get("camera")),
                    tracks=tracks)

    def chunks(self, rid: int):
        """``replay_chunk`` messages, in order (encoded on demand)."""
        for i, (_, _, _, v) in enumerate(self.tracks):
            if not isinstance(v, dict) or "pos_dq" not in v:
                continue
            q = np.concatenate([np.cumsum(v["pos_dq"], axis=0, dtype=np.int16),
                                np.cumsum(v["rot_dq"], axis=0, dtype=np.int16)],
                               axis=-1)                       # [K, n, Bd, 7]
            K = len(q)
            for k0 in range(0, K, CHUNK_TICKS):
                c = q[k0:k0 + CHUNK_TICKS]
                d = np.diff(c, axis=0, prepend=np.zeros_like(c[:1]))
                data = zlib.compress(np.ascontiguousarray(d, "<i2").tobytes(), 6)
                yield dict(type="replay_chunk", id=rid, track=i, start=k0,
                           count=len(c), shape=list(c.shape[1:]),
                           data=np.frombuffer(data, np.uint8))


def decode_chunk(msg: dict) -> np.ndarray:
    """Absolute int16 pose samples ``[count, n, Bd, 7]`` of a
    ``replay_chunk`` (what the browser does; for tests)."""
    d = np.frombuffer(zlib.decompress(msg["data"].tobytes()), "<i2")
    d = d.reshape([msg["count"], *msg["shape"]])
    return np.cumsum(d, axis=0, dtype=np.int16)


def build_scene(scene, snapshot: dict) -> None:
    """Recreate a record's start ``snapshot`` (``Scene.snapshot()``) in
    ``scene`` (any backends). Dynamic state comes from :func:`set_state`."""
    for o in snapshot["objects"]:
        k, n, at, ar = o["kind"], o["name"], o["attrs"], o["arrays"]
        if k == "rigid_mesh":
            m = scene.rigid_mesh(n, ar["local_vertices"], ar["vertex_body"],
                                 ar["triangles"], ar["body_triangle_offsets"],
                                 instances=at["instances"],
                                 offsets=ar["offsets"],
                                 body_names=at["body_names"],
                                 instance_names=at["instance_names"],
                                 smooth=at["smooth"])
            m.segment_colors[:] = ar["segment_colors"]
            m.segment_visible[:] = ar["segment_visible"]
            m._changed("colors")
            m._changed("visibility")
        elif k == "boxes":
            scene.boxes(n, ar["lo"], ar["hi"], color=at["color"],
                        colors=ar.get("colors"))
        elif k == "points":
            scene.points(n, ar["points"], at["color"], at["radius"])
        elif k == "polyline":
            scene.polyline(n, ar["points"], at["color"], at["radius"],
                           at["closed"])
        elif k == "labels":
            scene.labels(n, ar["anchors"], texts=at["texts"], fmt=at["fmt"],
                         color=at["color"], align=at["align"],
                         world_height=at["world_height"],
                         size_px=at["size_px"])
    if snapshot.get("camera"):
        scene.look_at(*snapshot["camera"])


def set_state(scene, record, t: int) -> None:
    """Set every tracked field of ``scene`` (built by :func:`build_scene`) to
    its value at tick ``t``: the latest sample at or before ``t``."""
    at = {}
    for (obj, field), (tt, v) in record.tracks.items():
        i = max(int(np.searchsorted(tt, t, side="right")) - 1, 0)
        at[(obj, field)] = v[i]
    for name, o in scene.objects.items():
        if o.kind == "rigid_mesh" and (name, "poses") in at:
            o.set_poses(at[(name, "poses")])
        elif o.kind == "boxes" and (name, "lo") in at:
            o.set_boxes(at[(name, "lo")], at[(name, "hi")],
                        colors=at.get((name, "colors")))
        elif o.kind == "labels" and (name, "values") in at:
            o.set_values(at[(name, "values")])
        elif o.kind in ("points", "polyline") and (name, "points") in at:
            o.set_points(at[(name, "points")])
    ch = {f: v for (obj, f), v in at.items() if obj == "channels"}
    if ch:
        scene.set_channels(**ch)


class EvalLibrary:
    """The saved evals under ``root`` (``index.json`` + record dirs)."""

    def __init__(self, root: str):
        self.root = root
        self._stamp = None
        self._index: list = []
        self.index()

    @property
    def entries(self) -> list:
        """The index as of the last :meth:`index` check."""
        return self._index

    def index(self) -> tuple:
        """``(changed, entries)``; cheap when ``index.json`` is unchanged."""
        path = os.path.join(self.root, "index.json")
        try:
            st = os.stat(path)
            stamp = (st.st_mtime_ns, st.st_size)
        except OSError:
            stamp = None
        if stamp == self._stamp:
            return False, self._index
        self._stamp = stamp
        try:
            self._index = read_index(self.root) if stamp else []
        except (OSError, ValueError):             # mid-write; next poll
            self._stamp = None
        return True, self._index

    def load(self, rid: str) -> ReplayData:
        if os.sep in rid or rid.startswith("."):
            raise ValueError(f"bad eval id {rid!r}")
        meta, rec, summary = read_record(os.path.join(self.root, rid),
                                         raw_poses=True)
        clock = meta.get("clock", "physics_step")
        dt = float(meta.get("dt") or 0.0)
        tick = dt if clock == "physics_step" else dt * float(
            meta.get("decimation") or 1)
        name = f"eval t={meta.get('timestep', rid)}"
        return ReplayData(meta, rec, summary, source="eval", name=name,
                          tick_seconds=tick)


class RingMailbox:
    """Requests for a record that only the producing thread can build (it
    owns the GPU state), e.g. the last episode of each streamed training
    env. The server calls :meth:`ask`; the producer checks :attr:`pending`
    once per step (cheap) and calls :meth:`fulfil` with a builder returning
    ``(meta, Record, summary)``; its ``meta`` carries ``tick_seconds``."""

    def __init__(self, name: str = "training ring"):
        self.name = name
        self._lock = threading.Lock()
        self._waiting: list = []

    @property
    def pending(self) -> bool:
        return bool(self._waiting)

    def ask(self) -> concurrent.futures.Future:
        f = concurrent.futures.Future()
        with self._lock:
            self._waiting.append(f)
        return f

    def fulfil(self, build) -> None:
        with self._lock:
            waiting, self._waiting = self._waiting, []
        if not waiting:
            return
        try:
            meta, rec, summary = build()
            data = ReplayData(meta, rec, summary, source="ring",
                              name=self.name,
                              tick_seconds=meta.get("tick_seconds", 0.0))
        except Exception as e:                     # noqa: BLE001
            for f in waiting:
                f.set_exception(e)
            return
        for f in waiting:
            f.set_result(data)


# --------------------------------------------------------------------------
# standalone replay server
# --------------------------------------------------------------------------

def _evals_dir(path: str) -> str:
    path = os.path.abspath(path)
    if os.path.isfile(os.path.join(path, "index.json")):
        return path
    sub = os.path.join(path, "evals")
    if os.path.isdir(sub):
        return sub
    raise SystemExit(f"no evals under {path} (expected {sub}/index.json)")


def main(argv=None) -> None:
    p = argparse.ArgumentParser(
        prog="python -m avbd_viz.web.replay",
        description="Serve a run's saved evals to the avbd-viz web client.")
    p.add_argument("run_dir", help="experiment dir (with evals/) or an "
                   "evals dir")
    p.add_argument("--port", type=int, default=8080)
    p.add_argument("--host", default="0.0.0.0",
                   help="bind address (127.0.0.1 to keep it local)")
    args = p.parse_args(argv)
    from .server import VizServer
    root = _evals_dir(args.run_dir)
    run = os.path.dirname(root) if os.path.basename(root) == "evals" else root
    n = len(read_index(root))
    server = VizServer(args.host, args.port, name=os.path.basename(run),
                       evals=root)
    print(f"[avbd-viz] replaying {n} evals from {root}; Ctrl-C to stop")
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        pass
    finally:
        server.close()


if __name__ == "__main__":
    main()
