"""Wire format of the avbd-viz web viewer (server -> browser).

A message is ONE binary WebSocket frame::

    b"AVZ1" | u32 header length (LE) | JSON header | zero pad to 8 |
    buffer 0 | pad to 8 | buffer 1 | ...

The JSON header is the message itself, with every numpy array replaced by
``{"$b": i}``; ``header["$buffers"][i] = {"dtype", "shape", "offset",
"nbytes"}`` locates its raw little-endian bytes (offset from the start of the
message). Buffers are 8-byte aligned, so the browser wraps them as typed
arrays without copying. dtypes on the wire: float32, int32, uint32, int16,
uint16, uint8 (float64 goes out as float32, int64 as int32, bool as uint8).

Messages (``type``):

- ``hello``: ``version``, ``name`` (the run), ``streams`` [{"name", "kind"}],
  ``replay`` {"evals": bool, "ring": bool} (what can be replayed),
  ``accepts`` [request types the producer handles, e.g. "save_checkpoint",
  "run_eval", "select_envs"].
- ``scene``: ``stream``, ``version``, ``objects`` [{"kind", "name",
  "attrs", "arrays"}], ``camera``, ``channels`` — a ``Scene.snapshot()`` —
  and ``info`` (``Stream.info``, e.g. ``envs`` shown and ``env_total``).
- ``frame``: ``stream``, ``seq``, ``time``, ``scene_version``, ``objects``
  {name: {field: array}} (the whole dynamic state: rigid ``poses``, box
  ``lo``/``hi``/``colors``, label ``values``, ``points``), ``channels``.
- ``event``: ``level``, ``text``.
- ``evals``: ``evals`` — the saved-eval index (``record.read_index``
  entries: ``id``, ``timestep``, ``checkpoint``, ``summary`` batch rates);
  sent on connect and whenever it changes.
- ``replay``: ``id`` (per connection), ``source`` ("eval" | "ring"),
  ``name``, ``meta``, ``summary`` (per-env outcomes, ``envs[e].end_step``),
  ``tick_seconds``, ``duration`` (last tick), ``scene`` (the start snapshot:
  ``objects``, ``camera``), ``tracks`` [{"object", "field", "t" int32 [K],
  and "values" [K, ...] or, for poses, "pose" {"samples", "envs",
  "bodies", "static_mask", "static_poses", "pos_lo", "pos_span", "chunk",
  "chunks"}}]. See :mod:`avbd_viz.web.replay`.
- ``replay_chunk``: ``id``, ``track``, ``start``, ``count``, ``shape``
  [n, moving bodies, 7], ``data`` (uint8: zlib of int16 samples,
  delta-coded along time).

Browser -> server messages are JSON text: ``{"type": "subscribe", "stream",
"rate"}``, ``{"type": "unsubscribe", "stream"}``, ``{"type": "ack",
"stream", "seq"}`` (flow control: the server sends a stream's next frame
once the previous one is acked), ``{"type": "open_replay", "source":
"eval", "id"}`` or ``{"source": "ring"}``, and ``{"type": "replay_ack",
"id", "n"}`` (chunks received so far). Requests the producer accepts
(``hello.accepts``) are queued for it as sent: ``{"type":
"save_checkpoint"}``, ``{"type": "run_eval"}``, ``{"type": "select_envs",
"first": k}``.
"""
from __future__ import annotations

import json
import struct

import numpy as np

__all__ = ["VERSION", "encode", "decode"]

VERSION = 1
MAGIC = b"AVZ1"

_WIRE = {np.dtype(np.float32): "float32", np.dtype(np.int32): "int32",
         np.dtype(np.uint32): "uint32", np.dtype(np.int16): "int16",
         np.dtype(np.uint16): "uint16", np.dtype(np.uint8): "uint8"}
_CAST = {np.dtype(np.float64): np.float32, np.dtype(np.float16): np.float32,
         np.dtype(np.int64): np.int32, np.dtype(np.uint64): np.uint32,
         np.dtype(np.bool_): np.uint8, np.dtype(np.int8): np.int16}


def _pad8(n: int) -> int:
    return (8 - n % 8) % 8


def encode(msg: dict) -> bytes:
    """Serialize ``msg`` (JSON-able values and numpy arrays)."""
    arrays: list = []

    def walk(x):
        if isinstance(x, np.ndarray):
            a = x
            if a.dtype in _CAST:
                a = a.astype(_CAST[a.dtype])
            if a.dtype not in _WIRE:
                raise TypeError(f"protocol: unsupported dtype {a.dtype}")
            arrays.append(np.ascontiguousarray(a).astype(a.dtype.newbyteorder("<"),
                                                         copy=False))
            return {"$b": len(arrays) - 1}
        if isinstance(x, dict):
            return {str(k): walk(v) for k, v in x.items()}
        if isinstance(x, (list, tuple)):
            return [walk(v) for v in x]
        if isinstance(x, np.generic):
            return x.item()
        return x

    body = walk(msg)
    # Two passes: the header's length decides where the buffers start.
    metas = [dict(dtype=_WIRE[a.dtype.newbyteorder("=")], shape=list(a.shape),
                  offset=0, nbytes=int(a.nbytes)) for a in arrays]
    body["$buffers"] = metas
    for _ in range(3):
        head = json.dumps(body, separators=(",", ":")).encode()
        start = 8 + len(head)
        off = start + _pad8(start)
        changed = False
        for m in metas:
            if m["offset"] != off:
                m["offset"], changed = off, True
            off += m["nbytes"] + _pad8(m["nbytes"])
        if not changed:
            break
    head = json.dumps(body, separators=(",", ":")).encode()
    parts = [MAGIC, struct.pack("<I", len(head)), head]
    pos = 8 + len(head)
    for m, a in zip(metas, arrays):
        pad = m["offset"] - pos
        parts.append(b"\0" * pad)
        parts.append(a.tobytes())
        pos = m["offset"] + m["nbytes"]
    return b"".join(parts)


def decode(data: bytes) -> dict:
    """Inverse of :func:`encode` (arrays come back as numpy views)."""
    if data[:4] != MAGIC:
        raise ValueError("protocol: bad magic")
    (n,) = struct.unpack("<I", data[4:8])
    body = json.loads(data[8:8 + n])
    metas = body.pop("$buffers", [])
    bufs = [np.frombuffer(data, dtype=np.dtype(m["dtype"]).newbyteorder("<"),
                          count=int(np.prod(m["shape"], dtype=np.int64)),
                          offset=m["offset"]).reshape(m["shape"])
            for m in metas]

    def walk(x):
        if isinstance(x, dict):
            if set(x) == {"$b"}:
                return bufs[x["$b"]]
            return {k: walk(v) for k, v in x.items()}
        if isinstance(x, list):
            return [walk(v) for v in x]
        return x

    return walk(body)
