"""rillfacet.web: wire protocol and the stream server, end to end with a
Python WebSocket client.

    PYTHONPATH=python python -m pytest tests -q
"""

import json
import shutil
import ssl
import subprocess
import time
import urllib.request

import numpy as np
import pytest

from rillfacet.scene_api import Scene, box_mesh
from rillfacet.web.protocol import decode, encode
from rillfacet.web.server import CERT_ENV, KEY_ENV, StreamBackend, VizServer

websockets = pytest.importorskip("websockets")
from websockets.sync.client import connect  # noqa: E402


def test_protocol_roundtrip_alignment_and_casts():
    msg = dict(type="frame", seq=3, nested=dict(a=np.arange(5, dtype=np.float64),
                                               b=[np.ones((2, 3), np.uint8), 7]),
               flag=np.bool_(True), c=np.array([True, False]),
               i=np.arange(3, dtype=np.int64), s=np.zeros(0, np.float32))
    data = encode(msg)
    head = json.loads(data[8:8 + int.from_bytes(data[4:8], "little")])
    assert all(m["offset"] % 8 == 0 for m in head["$buffers"])
    out = decode(data)
    assert out["seq"] == 3 and out["flag"] is True
    assert out["nested"]["a"].dtype == np.float32
    assert np.array_equal(out["nested"]["a"], np.arange(5))
    assert out["nested"]["b"][0].shape == (2, 3) and out["nested"]["b"][1] == 7
    assert out["c"].tolist() == [1, 0] and out["i"].dtype == np.int32
    assert out["s"].shape == (0,)


@pytest.fixture(autouse=True)
def _no_tls_env(monkeypatch):
    # A certificate in the environment would turn these servers https.
    monkeypatch.delenv(CERT_ENV, raising=False)
    monkeypatch.delenv(KEY_ENV, raising=False)


def make_scene(backend):
    sc = Scene(backend)
    v, t = box_mesh([[0, 0, 0]], [[1, 1, 1]])
    rm = sc.rigid_mesh("bodies", v, np.zeros(len(v), int), t, [0, 12], instances=2)
    poses = np.zeros((2, 1, 7), np.float32)
    poses[..., 6] = 1
    rm.set_poses(poses)
    sc.boxes("bars", [[0, 0, 0]], [[1, 1, 1]])
    sc.look_at((3, 3, 3), (0, 0, 0))
    return sc, rm


@pytest.fixture
def server(tmp_path):
    (tmp_path / "index.html").write_text("<html>hi</html>")
    (tmp_path / "app.js").write_text("console.log(1)")
    srv = VizServer("127.0.0.1", 18765, name="test run", static_dir=str(tmp_path),
                    verbose=False)
    yield srv
    srv.close()


def recv(ws, timeout=5.0):
    return decode(ws.recv(timeout=timeout))


def test_http_serves_the_client(server):
    base = f"http://127.0.0.1:{server.port}/"
    with urllib.request.urlopen(base) as r:
        assert r.read() == b"<html>hi</html>"
    with urllib.request.urlopen(base + "app.js") as r:
        assert r.headers["Content-Type"] == "text/javascript"
    with pytest.raises(urllib.error.HTTPError):
        urllib.request.urlopen(base + "../secret")


def test_stream_scene_frames_acks_and_dropping(server):
    stream = server.stream("live")
    backend = StreamBackend(stream)
    sc, rm = make_scene(backend)
    assert not backend.wanted()                      # nobody watching: free

    with connect(f"ws://127.0.0.1:{server.port}/ws") as ws:
        hello = recv(ws)
        assert hello["type"] == "hello" and hello["name"] == "test run"
        assert hello["streams"] == [{"name": "live", "kind": "live"}]
        ws.send(json.dumps(dict(type="subscribe", stream="live", rate=1000)))
        for _ in range(100):                         # subscription lands
            if backend.wanted():
                break
            time.sleep(0.01)
        assert backend.wanted()                      # scene requested

        backend.commit(sc, time=1)
        scene = recv(ws)
        assert scene["type"] == "scene" and scene["version"] == 1
        assert [o["name"] for o in scene["objects"]] == ["bodies", "bars"]
        assert scene["camera"] == [[3, 3, 3], [0, 0, 0]]
        f1 = recv(ws)
        assert f1["type"] == "frame" and f1["seq"] == 1 and f1["time"] == 1
        assert f1["objects"]["bodies"]["poses"].shape == (2, 1, 7)

        # Unacked: nothing more is sent; later commits overwrite each other.
        time.sleep(0.01)
        assert not backend.wanted()
        for k in range(2, 6):
            p = np.zeros((2, 1, 7), np.float32)
            p[..., 0] = k
            rm.set_poses(p)
            backend.commit(sc, time=k)
        with pytest.raises(TimeoutError):
            ws.recv(timeout=0.3)
        ws.send(json.dumps(dict(type="ack", stream="live", seq=1)))
        f = recv(ws)
        assert f["seq"] == 5 and f["objects"]["bodies"]["poses"][0, 0, 0] == 5
        assert stream.commits == 5

    for _ in range(100):                             # disconnect lands
        if not stream.clients:
            break
        time.sleep(0.01)
    assert not backend.wanted()


def test_cuda_poses_are_streamed(server):
    torch = pytest.importorskip("torch")
    if not torch.cuda.is_available():
        pytest.skip("no CUDA")
    stream = server.stream("gpu")
    backend = StreamBackend(stream)
    sc, rm = make_scene(backend)
    with connect(f"ws://127.0.0.1:{server.port}/ws") as ws:
        recv(ws)
        ws.send(json.dumps(dict(type="subscribe", stream="gpu", rate=1000)))
        while not backend.wanted():
            time.sleep(0.01)
        p = torch.zeros(2, 1, 7, device="cuda")
        p[..., 6] = 1
        p[1, 0, 2] = 42
        rm.set_poses(p)
        backend.commit(sc, time=0)
        recv(ws)                                     # scene
        f = recv(ws)
        assert f["objects"]["bodies"]["poses"][1, 0, 2] == 42


def test_recolors_and_display_are_streamed(server):
    stream = server.stream("overlay")
    backend = StreamBackend(stream)
    sc, rm = make_scene(backend)
    rm.set_display(visible=False, opacity=0.25)
    with connect(f"ws://127.0.0.1:{server.port}/ws") as ws:
        recv(ws)
        ws.send(json.dumps(dict(type="subscribe", stream="overlay",
                                rate=1000)))
        while not backend.wanted():
            time.sleep(0.01)
        backend.commit(sc, time=0)
        scene = recv(ws)
        objs = {o["name"]: o for o in scene["objects"]}
        assert objs["bodies"]["attrs"]["display"] == {"visible": False,
                                                      "opacity": 0.25}
        f = recv(ws)
        assert "segment_colors" not in f["objects"]["bodies"]   # unchanged
        ws.send(json.dumps(dict(type="ack", stream="overlay", seq=f["seq"])))
        rm.set_segment_color(1, (1, 0, 0))
        while not backend.wanted():
            time.sleep(0.01)
        backend.commit(sc, time=1)
        f = recv(ws)
        assert f["objects"]["bodies"]["segment_colors"][1].tolist() == [1, 0, 0]


def test_port_in_use_moves_on(server):
    other = VizServer("127.0.0.1", server.port, verbose=False)
    try:
        assert other.port > server.port
    finally:
        other.close()


# -- replay ------------------------------------------------------------------

def make_record(K=600, n=2):
    """A recorded session: one moving and one static body per env, a box
    set and a channel, clock 0..K-1."""
    from rillfacet.web.record import Recorder
    rec = Recorder()
    sc = Scene(rec)
    v, t = box_mesh([[0, 0, 0], [2, 0, 0]], [[1, 1, 1], [3, 1, 1]])
    body = np.repeat([0, 1], 8)
    rm = sc.rigid_mesh("bodies", v, body, t, [0, 12, 24], instances=n)
    bars = sc.boxes("bars", [[0, 0, 0]], [[1, 1, 1]])

    def pose(k):
        p = np.zeros((n, 2, 7), np.float32)
        p[..., 6] = 1
        p[:, 0, 0] = np.sin(0.01 * k) + np.arange(n)
        return p

    rm.set_poses(pose(0))
    sc.set_channels(flux=np.zeros(n, np.float32))
    rec.start(sc)
    for k in range(1, K):
        rec.tick(k)
        rm.set_poses(pose(k))
        if k % 10 == 0:
            bars.set_boxes([[0, 0, 0]], [[1 + k, 1, 1]])
            sc.set_channels(flux=np.full(n, k, np.float32))
    return rec.finish(), np.stack([pose(k) for k in range(K)])


def read_replay(ws):
    """The ``replay`` header and its pose tracks, reassembled from the
    chunks (acking each)."""
    from rillfacet.web.replay import decode_chunk
    head = recv(ws)
    assert head["type"] == "replay", head
    poses = {}
    total = sum(t["pose"]["chunks"] for t in head["tracks"] if "pose" in t)
    for k in range(total):
        m = recv(ws)
        assert m["type"] == "replay_chunk" and m["id"] == head["id"]
        poses.setdefault(m["track"], []).append((m["start"], decode_chunk(m)))
        ws.send(json.dumps(dict(type="replay_ack", id=m["id"], n=k + 1)))
    out = {}
    for i, parts in poses.items():
        p = head["tracks"][i]["pose"]
        q = np.concatenate([c for _, c in sorted(parts, key=lambda x: x[0])])
        pos = ((q[..., :3].astype(np.float32) + 32768.0) / 65535.0
               * p["pos_span"] + p["pos_lo"])
        out[i] = pos
    return head, out


def test_eval_index_push_and_replay(tmp_path):
    from rillfacet.web.record import write_record
    root = tmp_path / "evals"
    rec, truth = make_record()
    srv = VizServer("127.0.0.1", 18780, name="r", static_dir=str(tmp_path),
                    verbose=False)
    try:
        with connect(f"ws://127.0.0.1:{srv.port}/ws") as ws:
            hello = recv(ws)
            assert hello["replay"] == {"evals": False, "ring": False,
                                       "eval_sets": []}
            srv.offer_evals(str(root))              # before any eval exists
            assert recv(ws) == {"type": "evals", "set": "evals", "evals": []}
            write_record(str(root), "t000000100", rec,
                         meta=dict(timestep=100, dt=0.01,
                               clock="physics_step"),
                         summary=dict(envs=[dict(env=0, end_step=599)] * 2,
                                      batch=dict(success=0.5)))
            ev = recv(ws)                           # pushed on change
            assert ev["type"] == "evals"
            assert ev["evals"][0]["id"] == "t000000100"
            assert ev["evals"][0]["summary"] == {"success": 0.5}

            ws.send(json.dumps(dict(type="open_replay", source="eval",
                                    id="t000000100")))
            head, poses = read_replay(ws)
            assert head["source"] == "eval" and head["duration"] == 599
            assert head["tick_seconds"] == pytest.approx(0.01)
            assert head["meta"]["timestep"] == 100
            assert [o["name"] for o in head["scene"]["objects"]] == ["bodies",
                                                                     "bars"]
            tracks = {(t["object"], t["field"]): t for t in head["tracks"]}
            flux = tracks[("channels", "flux")]
            assert flux["t"].tolist() == [0] + list(range(10, 600, 10))
            assert flux["values"][-1].tolist() == [590, 590]
            p = tracks[("bodies", "poses")]["pose"]
            assert p["samples"] == 600 and p["chunks"] == 3
            assert p["static_mask"].tolist() == [0, 1]
            i = head["tracks"].index(tracks[("bodies", "poses")])
            err = np.abs(poses[i][:, :, 0] - truth[:, :, 0, :3]).max()
            assert err < 1e-4

            ws.send(json.dumps(dict(type="open_replay", source="eval",
                                    id="../x")))
            e = recv(ws)
            assert e["type"] == "event" and e["level"] == "error"
    finally:
        srv.close()


def noisy_images(K, n=2, C=4, H=48, W=64, seed=0):
    """``[K, n, C, H, W, 3]``: a gradient per (env, view), plus sensor noise."""
    r = np.random.default_rng(seed)
    y, x = np.mgrid[0:H, 0:W]
    base = np.stack([40 + 2 * x, 40 + 3 * y, 0 * x + 90], -1).astype(np.float32)
    out = np.empty((K, n, C, H, W, 3), np.uint8)
    for k in range(K):
        for e in range(n):
            for c in range(C):
                out[k, e, c] = np.clip(base + 8 * (e + c + k)
                                       + r.normal(0, 3, base.shape), 0, 255)
    return out


def image_scene(backend, n=2):
    sc = Scene(backend)
    v, t = box_mesh([[0, 0, 0]], [[1, 1, 1]])
    rm = sc.rigid_mesh("bodies", v, np.zeros(8, np.int32), t, [0, 12],
                       instances=n)
    p = np.zeros((n, 1, 7), np.float32)
    p[..., 6] = 1
    rm.set_poses(p)
    return sc, sc.images("cams", n, ["a", "b", "c", "d"], 48, 64)


def recv_until(ws, kind):
    for _ in range(50):
        m = recv(ws)
        if m["type"] == kind:
            return m
    raise AssertionError(f"no {kind} message")


def test_live_images_go_only_to_the_client_that_asked(server):
    from rillfacet.web.images import decode_sheet
    stream = server.stream("cams live")
    backend = StreamBackend(stream)
    scene, cams = image_scene(backend)
    x = noisy_images(1)[0]
    cams.set_images(x)

    def wait(cond):
        t0 = time.monotonic()
        while not cond() and time.monotonic() - t0 < 5:
            time.sleep(0.005)
        assert cond()

    with connect(f"ws://127.0.0.1:{server.port}/ws") as a, \
            connect(f"ws://127.0.0.1:{server.port}/ws") as b:
        for ws in (a, b):
            recv(ws)                                # hello
            ws.send(json.dumps(dict(type="subscribe", stream=stream.name)))
        wait(lambda: len(stream.clients) == 2)
        backend.commit(scene, time=1)
        assert stream._images is None               # nobody asked: not copied
        for ws in (a, b):
            assert recv(ws)["type"] == "scene"
            assert recv(ws)["type"] == "frame"
            ws.send(json.dumps(dict(type="ack", stream=stream.name, seq=1)))

        a.send(json.dumps(dict(type="images", on=True)))
        wait(backend.images_wanted)
        time.sleep(0.05)                            # the acks too
        backend.commit(scene, time=2)
        assert recv(a)["type"] == "frame"
        m = recv(a)
        assert m["type"] == "images" and m["time"] == 2
        assert m["images"]["cams"]["shape"] == [2, 4, 48, 64]
        got = decode_sheet(m["images"]["cams"]["data"].tobytes(),
                           (2, 4, 48, 64)).astype(np.float32)
        assert np.abs(got - x).mean() < 6
        assert recv(b)["type"] == "frame"           # b: its frame, no images
        with pytest.raises(TimeoutError):
            b.recv(timeout=0.2)

        a.send(json.dumps(dict(type="images", on=False)))
        wait(lambda: not backend.images_wanted())
        backend.commit(scene, time=3)
        assert stream._images is None


def test_replay_images_only_on_request_and_resumable(tmp_path):
    from rillfacet.web.images import decode_sheet
    from rillfacet.web.record import Recorder, write_record
    from rillfacet.web.replay import IMAGE_CHUNK
    K = 2 * IMAGE_CHUNK + 3
    rec = Recorder()
    scene, cams = image_scene(rec)
    x = noisy_images(K)
    cams.set_images(x[0])
    rec.start(scene, t=0)
    for k in range(1, K):
        rec.tick(25 * k)
        cams.set_images(x[k])
    root = tmp_path / "evals"
    write_record(str(root), "t1", rec.finish(), meta=dict(dt=0.002),
                 summary=dict(envs=[], batch={}))
    srv = VizServer("127.0.0.1", 18790, static_dir=str(tmp_path),
                    evals=str(root), verbose=False)
    try:
        with connect(f"ws://127.0.0.1:{srv.port}/ws") as ws:
            hello = recv(ws)
            assert hello["replay"]["eval_sets"] == ["evals"]
            assert recv(ws)["type"] == "evals"
            ws.send(json.dumps(dict(type="open_replay", id="t1")))
            head = recv_until(ws, "replay")
            tr = next(t for t in head["tracks"] if t["field"] == "images")
            assert tr["images"] == dict(samples=K, shape=[2, 4, 48, 64])
            assert "values" not in tr and tr["t"][-1] == 25 * (K - 1)
            assert any(o["kind"] == "images" for o in head["scene"]["objects"])
            with pytest.raises(TimeoutError):       # not asked for
                while True:
                    m = recv(ws, 0.2)
                    assert m["type"] == "replay_chunk"

            def fetch(start):
                ws.send(json.dumps(dict(type="replay_images", id=head["id"],
                                        on=True, **{"from": start})))
                out, n = {}, start
                while n < K:
                    m = recv_until(ws, "replay_images")
                    assert m["id"] == head["id"] and m["start"] == n
                    at = 0
                    for i, size in enumerate(m["sizes"].tolist()):
                        out[n + i] = m["data"][at:at + size].tobytes()
                        at += size
                    n += len(m["sizes"])
                return out

            sheets = fetch(0)
            assert sorted(sheets) == list(range(K))
            assert np.abs(decode_sheet(sheets[K - 1], (2, 4, 48, 64))
                          .astype(np.float32) - x[K - 1]).mean() < 6
            assert sorted(fetch(IMAGE_CHUNK)) == list(range(IMAGE_CHUNK, K))
    finally:
        srv.close()


def test_eval_sets(tmp_path):
    from rillfacet.web.record import write_record
    from rillfacet.web.replay import _sibling_sets
    rec, _ = make_record()
    run = tmp_path / "run"
    for sub, ts in (("evals", 100), ("evals_seen", 200)):
        write_record(str(run / sub), "t1", rec,
                     meta=dict(timestep=ts, dt=0.01, clock="physics_step"),
                     summary=dict(envs=[dict(env=0, end_step=599)] * 2,
                                  batch={}))
    assert _sibling_sets(str(run / "evals")) == {"seen": str(run / "evals_seen")}
    assert _sibling_sets(str(run / "evals_seen")) == {}
    srv = VizServer("127.0.0.1", 18800, static_dir=str(tmp_path), verbose=False)
    try:
        srv.offer_evals(str(run / "evals"), "held-out")
        srv.offer_evals(str(run / "evals_seen"), "seen")
        with connect(f"ws://127.0.0.1:{srv.port}/ws") as ws:
            assert recv(ws)["replay"]["eval_sets"] == ["held-out", "seen"]
            sets = {}
            for _ in range(2):
                m = recv_until(ws, "evals")
                sets[m["set"]] = m["evals"][0]["timestep"]
            assert sets == {"held-out": 100, "seen": 200}
            ws.send(json.dumps(dict(type="open_replay", set="seen", id="t1")))
            assert recv_until(ws, "replay")["meta"]["timestep"] == 200
            ws.send(json.dumps(dict(type="open_replay", set="held-out",
                                    id="t1")))
            assert recv_until(ws, "replay")["meta"]["timestep"] == 100
    finally:
        srv.close()


def test_ring_replay_is_built_by_the_producer(tmp_path):
    from rillfacet.web.replay import RingMailbox
    srv = VizServer("127.0.0.1", 18790, static_dir=str(tmp_path),
                    verbose=False)
    srv.ring = box = RingMailbox()
    rec, truth = make_record(K=50)
    try:
        with connect(f"ws://127.0.0.1:{srv.port}/ws") as ws:
            assert recv(ws)["replay"]["ring"] is True
            ws.send(json.dumps(dict(type="open_replay", source="ring")))
            for _ in range(200):                     # the producer's loop
                if box.pending:
                    break
                time.sleep(0.01)
            assert box.pending
            box.fulfil(lambda: (dict(tick_seconds=0.05), rec,
                                dict(envs=[], batch={})))
            head, poses = read_replay(ws)
            assert head["source"] == "ring" and head["tick_seconds"] == 0.05
            assert head["duration"] == 49
            (i, pos), = poses.items()
            assert np.abs(pos[:, :, 0] - truth[:, :, 0, :3]).max() < 1e-4
    finally:
        srv.close()


def test_requests_events_and_stream_info(server):
    stream = server.stream("live")
    backend = StreamBackend(stream)
    sc, _ = make_scene(backend)
    stream.info = dict(envs=[4, 5], env_total=8)
    server.accept("run_eval", "select_envs")
    assert server.take_requests() == []
    with connect(f"ws://127.0.0.1:{server.port}/ws") as ws:
        hello = recv(ws)
        assert hello["accepts"] == ["run_eval", "select_envs"]
        ws.send(json.dumps(dict(type="subscribe", stream="live", rate=1000)))
        ws.send(json.dumps(dict(type="select_envs", first=4)))
        ws.send(json.dumps(dict(type="run_eval")))
        ws.send(json.dumps(dict(type="format_disk")))      # not accepted
        got = []
        for _ in range(200):
            got += server.take_requests()
            if len(got) == 2:
                break
            time.sleep(0.01)
        assert got == [dict(type="select_envs", first=4), dict(type="run_eval")]
        backend.commit(sc, time=0)
        scene = recv(ws)
        assert scene["info"] == {"envs": [4, 5], "env_total": 8}
        recv(ws)                                     # frame
        server.event("eval done", "info")
        assert recv(ws) == {"type": "event", "level": "info", "text": "eval done"}


@pytest.mark.skipif(shutil.which("openssl") is None, reason="needs openssl")
def test_tls_from_the_environment(tmp_path, monkeypatch):
    cert, key = tmp_path / "c.pem", tmp_path / "k.pem"
    subprocess.run(["openssl", "req", "-x509", "-newkey", "ec", "-pkeyopt",
                    "ec_paramgen_curve:prime256v1", "-nodes", "-days", "1",
                    "-keyout", str(key), "-out", str(cert), "-subj", "/CN=localhost",
                    "-addext", "subjectAltName=IP:127.0.0.1"],
                   check=True, capture_output=True)
    (tmp_path / "index.html").write_text("<html>tls</html>")
    monkeypatch.setenv(CERT_ENV, str(cert))
    monkeypatch.setenv(KEY_ENV, str(key))
    srv = VizServer("127.0.0.1", 18800, static_dir=str(tmp_path), verbose=False)
    try:
        assert srv.url.startswith("https://")
        ctx = ssl.create_default_context(cafile=str(cert))
        with urllib.request.urlopen(f"https://127.0.0.1:{srv.port}/", context=ctx) as r:
            assert r.read() == b"<html>tls</html>"
        with connect(f"wss://127.0.0.1:{srv.port}/ws", ssl=ctx) as ws:
            assert recv(ws)["type"] == "hello"
    finally:
        srv.close()
    off = VizServer("127.0.0.1", 18800, static_dir=str(tmp_path), verbose=False,
                    ssl_cert="")                      # explicit off beats the env
    try:
        assert off.url.startswith("http://")
    finally:
        off.close()
    with pytest.raises(FileNotFoundError):            # in the caller, not a port skip
        VizServer("127.0.0.1", 18800, ssl_cert=str(tmp_path / "missing.pem"))
