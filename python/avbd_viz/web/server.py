"""The avbd-viz web viewer server: serves the browser client and streams
scenes to it over a WebSocket, from inside a running process (a training
loop), without slowing it down.

    server = VizServer(port=8080, name="oven grasp")      # thread, starts now
    stream = StreamBackend(server.stream("live"))
    scene = Scene(stream)                                 # avbd_viz.scene_api
    viz = OvenSceneViz(scene, task)
    ...
    # in the training loop, once per step:
    if stream.wanted():            # a browser is connected and ready for more
        viz.update()
        stream.commit(scene, time=step)

One port serves both the client (plain HTTP GET, the built bundle in
``static/``) and the WebSocket (``/ws``). The server runs an asyncio loop on
a daemon thread; the caller's thread only snapshots the scene state
(:meth:`StreamBackend.commit`: host copies, and CUDA pose tensors copied to
pinned memory WITHOUT blocking) and never waits on the network.

Delivery is best effort, newest frame wins: each stream keeps only its
latest frame, and a client is sent the next one only after it acked the
previous one (or :data:`ACK_TIMEOUT` passed), so a slow link or a
background tab drops frames instead of queueing them. :meth:`Stream.wanted`
is False while nobody is connected, so an unwatched run pays nothing.
Frames carry the whole dynamic state (not deltas), so a dropped frame
loses nothing. A client connecting mid-run gets the latest scene first.
See :mod:`avbd_viz.web.protocol` for the messages.
"""
from __future__ import annotations

import asyncio
import json
import mimetypes
import os
import socket
import threading
import time

import numpy as np

from ..scene_api import Backend, Boxes, Labels, Points, Polyline, RigidMesh
from .protocol import VERSION, encode

__all__ = ["VizServer", "Stream", "StreamBackend", "ACK_TIMEOUT"]

#: Seconds a client may leave a frame unacked before it is sent the next one.
ACK_TIMEOUT = 2.0

STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                          "static")


def _host_copy(x):
    """A host copy of ``x`` that later scene updates cannot change: numpy
    arrays are copied; CUDA tensors are copied into a fresh pinned buffer
    without blocking (valid once the commit's CUDA event completes)."""
    if hasattr(x, "detach"):
        x = x.detach()
        if x.is_cuda:
            import torch
            buf = torch.empty(x.shape, dtype=x.dtype, pin_memory=True)
            buf.copy_(x, non_blocking=True)
            return buf
        return x.cpu().numpy().copy()
    return np.array(x, copy=True) if isinstance(x, np.ndarray) else x


def _to_numpy(x):
    if isinstance(x, dict):
        return {k: _to_numpy(v) for k, v in x.items()}
    if isinstance(x, list):
        return [_to_numpy(v) for v in x]
    if hasattr(x, "detach"):
        return x.numpy()
    return x


class _Client:
    def __init__(self, conn, loop):
        self.conn = conn
        self.wake = asyncio.Event()
        self.loop = loop
        self.rate = 20.0
        self.scene_version = -1
        self.last_seq = 0
        self.awaiting = False
        self.sent_at = 0.0
        self.dropped = 0

    def ready(self, now: float) -> bool:
        return not self.awaiting or now - self.sent_at > ACK_TIMEOUT


class Stream:
    """One scene stream (e.g. the training envs) and its subscribers."""

    def __init__(self, server: "VizServer", name: str, kind: str = "live"):
        self.server, self.name, self.kind = server, name, kind
        self._lock = threading.Lock()
        self.clients: set = set()
        self.scene_version = 0
        self._scene_msg = None
        self._scene_bytes = None
        self.seq = 0
        self._frame = None                # (seq, msg, cuda event | None)
        self._frame_bytes = (0, None)
        self._last_commit = 0.0
        self.scene_requested = False
        self.commits = 0

    # -- producer (the caller's thread) ---------------------------------------

    def wanted(self) -> bool:
        """True when a frame committed now would be sent to someone: a
        client is subscribed, ready for a new frame, and its rate allows
        one. Cheap; call every step."""
        clients = list(self.clients)
        if not clients:
            return False
        if self.scene_requested:
            return True
        now = time.monotonic()
        rate = max(c.rate for c in clients)
        if rate <= 0 or now - self._last_commit < 1.0 / rate:
            return False
        return any(c.ready(now) for c in clients)

    def publish(self, frame: dict, event=None, scene: dict | None = None):
        with self._lock:
            if scene is not None:
                self.scene_version += 1
                self._scene_msg = dict(scene, type="scene", stream=self.name,
                                       version=self.scene_version)
                self._scene_bytes = None
                self.scene_requested = False
            self.seq += 1
            self._frame = (self.seq, dict(frame, type="frame",
                                          stream=self.name, seq=self.seq,
                                          scene_version=self.scene_version),
                           event)
            self._last_commit = time.monotonic()
            self.commits += 1
        self.server._wake(self)

    # -- consumer (the server thread) -----------------------------------------

    def _scene(self):
        with self._lock:
            if self._scene_msg is None:
                return None, None
            if self._scene_bytes is None:
                self._scene_bytes = encode(_to_numpy(self._scene_msg))
            return self.scene_version, self._scene_bytes

    async def _frame_encoded(self):
        with self._lock:
            if self._frame is None:
                return 0, None
            seq, msg, event = self._frame
            if self._frame_bytes[0] == seq:
                return self._frame_bytes
        while event is not None and not event.query():
            await asyncio.sleep(0.001)
        data = encode(_to_numpy(msg))
        with self._lock:
            if self._frame is not None and self._frame[0] == seq:
                self._frame_bytes = (seq, data)
        return seq, data


class VizServer:
    """HTTP + WebSocket server on ``host:port``, started on construction
    (a daemon thread). If the port is taken, the next free one up to
    ``port + 20`` is used; :attr:`url` tells which."""

    def __init__(self, host: str = "0.0.0.0", port: int = 8080, *,
                 name: str = "", static_dir: str | None = None,
                 verbose: bool = True):
        self.host, self.name = host, name
        self.static_dir = static_dir or STATIC_DIR
        self.streams: dict = {}
        self._loop = None
        self._server = None
        self._clients: set = set()
        self._stopped = threading.Event()
        self.port = None
        err = None
        for p in range(int(port), int(port) + 21):
            started = threading.Event()
            self._error = None
            self._thread = threading.Thread(
                target=self._run, args=(p, started), daemon=True,
                name="avbd-viz web server")
            self._thread.start()
            started.wait()
            if self._error is None:
                self.port = p
                break
            err = self._error
        if self.port is None:
            raise OSError(f"avbd-viz web: no free port in {port}..{port + 20}: {err}")
        if verbose:
            print(f"[avbd-viz] web viewer at {self.url}")

    @property
    def url(self) -> str:
        host = socket.gethostname() if self.host in ("0.0.0.0", "") else self.host
        return f"http://{host}:{self.port}/"

    def stream(self, name: str, kind: str = "live") -> Stream:
        s = self.streams.get(name)
        if s is None:
            s = self.streams[name] = Stream(self, name, kind)
        return s

    @property
    def num_clients(self) -> int:
        return len(self._clients)

    def close(self) -> None:
        if self._loop is not None and not self._stopped.is_set():
            self._loop.call_soon_threadsafe(self._shutdown)
            self._stopped.wait(5.0)

    # -- asyncio side -----------------------------------------------------------

    def _run(self, port, started):
        from websockets.asyncio.server import serve

        async def main():
            self._loop = asyncio.get_running_loop()
            try:
                self._server = await serve(
                    self._handler, self.host, port,
                    process_request=self._http, compression=None,
                    max_size=1 << 20)
            except OSError as e:
                self._error = e
                started.set()
                return
            started.set()
            await self._server.wait_closed()

        try:
            asyncio.run(main())
        finally:
            if self._error is None:
                self._stopped.set()

    def _shutdown(self):
        if self._server is not None:
            self._server.close()

    def _wake(self, stream: Stream) -> None:
        loop = self._loop
        if loop is None:
            return

        def wake():
            for c in stream.clients:
                c.wake.set()
        try:
            loop.call_soon_threadsafe(wake)
        except RuntimeError:                       # loop closed
            pass

    def _http(self, conn, request):
        from websockets.datastructures import Headers
        from websockets.http11 import Response
        path = request.path.split("?", 1)[0]
        if path == "/ws":
            return None                            # the WebSocket handshake
        rel = "index.html" if path in ("", "/") else path.lstrip("/")
        full = os.path.normpath(os.path.join(self.static_dir, rel))
        if (not full.startswith(os.path.normpath(self.static_dir) + os.sep)
                or not os.path.isfile(full)):
            if not os.path.isdir(self.static_dir):
                return conn.respond(503, "avbd-viz web client not built: run "
                                    "`npm install && npm run build` in "
                                    "avbd-viz/web\n")
            return conn.respond(404, "not found\n")
        with open(full, "rb") as f:
            body = f.read()
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        if full.endswith((".js", ".mjs")):
            ctype = "text/javascript"
        headers = Headers([("Content-Type", ctype),
                           ("Content-Length", str(len(body))),
                           ("Cache-Control", "no-cache")])
        return Response(200, "OK", headers, body)

    async def _handler(self, conn):
        client = _Client(conn, self._loop)
        self._clients.add(client)
        subs: dict = {}
        await conn.send(encode(dict(
            type="hello", version=VERSION, name=self.name,
            streams=[dict(name=s.name, kind=s.kind)
                     for s in self.streams.values()])))
        sender = asyncio.create_task(self._send_loop(client, subs))
        try:
            async for raw in conn:
                if isinstance(raw, bytes):
                    continue
                try:
                    m = json.loads(raw)
                except ValueError:
                    continue
                s = self.streams.get(m.get("stream", ""))
                if s is None:
                    continue
                if m.get("type") == "subscribe":
                    client.rate = float(m.get("rate", 20.0))
                    subs[s.name] = s
                    s.clients.add(client)
                    if s._scene_msg is None:
                        s.scene_requested = True
                elif m.get("type") == "unsubscribe":
                    subs.pop(s.name, None)
                    s.clients.discard(client)
                elif m.get("type") == "ack":
                    if int(m.get("seq", -1)) >= client.last_seq:
                        client.awaiting = False
                client.wake.set()
        except Exception:                          # noqa: BLE001 (closed)
            pass
        finally:
            sender.cancel()
            for s in subs.values():
                s.clients.discard(client)
            self._clients.discard(client)

    async def _send_loop(self, client: _Client, subs: dict):
        try:
            while True:
                try:
                    await asyncio.wait_for(client.wake.wait(), 0.25)
                except asyncio.TimeoutError:
                    pass
                client.wake.clear()
                for s in list(subs.values()):
                    version, scene = s._scene()
                    if scene is not None and version != client.scene_version:
                        await client.conn.send(scene)
                        client.scene_version = version
                    if s.seq <= client.last_seq or scene is None:
                        continue
                    if not client.ready(time.monotonic()):
                        continue
                    seq, data = await s._frame_encoded()
                    if data is None or seq <= client.last_seq:
                        continue
                    client.dropped += seq - client.last_seq - 1 if client.last_seq else 0
                    await client.conn.send(data)
                    client.last_seq = seq
                    client.awaiting = True
                    client.sent_at = time.monotonic()
        except asyncio.CancelledError:
            pass
        except Exception:                          # noqa: BLE001 (closed)
            pass


class StreamBackend(Backend):
    """Scene backend that streams through ``stream``: call :meth:`wanted`
    every step and, when True, update the scene and :meth:`commit`."""

    def __init__(self, stream: Stream):
        self.stream = stream
        self._structure_dirty = True

    def create(self, obj) -> None:
        self._structure_dirty = True

    def remove(self, name: str) -> None:
        self._structure_dirty = True

    def look_at(self, eye, target) -> None:
        self._structure_dirty = True

    def wanted(self) -> bool:
        return self.stream.wanted()

    def commit(self, scene, *, time=None, **extra) -> None:
        """Snapshot the scene's current state as the stream's latest frame
        (and its structure, when that changed or a new client needs it).
        ``time`` is shown by clients (e.g. the training step); ``extra``
        JSON-able fields ride along in the frame."""
        snap = None
        if (self._structure_dirty or self.stream.scene_requested
                or self.stream._scene_msg is None):
            snap = scene.snapshot()
            for o in snap["objects"]:
                o["arrays"] = {k: np.array(v, copy=True)
                               for k, v in o["arrays"].items()}
            snap["channels"] = {k: _host_copy(v)
                                for k, v in snap["channels"].items()}
            self._structure_dirty = False
        objects, cuda = {}, False
        for o in scene.objects.values():
            f = {}
            if isinstance(o, RigidMesh):
                if o.poses is not None:
                    f["poses"] = _host_copy(o.poses)
                    cuda |= hasattr(f["poses"], "is_pinned")
            elif isinstance(o, Boxes):
                f.update(lo=o.lo.copy(), hi=o.hi.copy())
                if o.colors is not None:
                    f["colors"] = o.colors.copy()
            elif isinstance(o, Labels):
                if o.values is not None:
                    f["values"] = o.values.copy()
            elif isinstance(o, (Points, Polyline)):
                f["points"] = o.points.copy()
            if f:
                objects[o.name] = f
        event = None
        if cuda:
            import torch
            event = torch.cuda.Event()
            event.record()
        frame = dict(time=time, objects=objects,
                     channels={k: _host_copy(v)
                               for k, v in scene.channels.items()}, **extra)
        self.stream.publish(frame, event, scene=snap)
