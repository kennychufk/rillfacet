"""avbd_viz.web: wire protocol and the stream server, end to end with a
Python WebSocket client.

    PYTHONPATH=python python -m pytest tests -q
"""

import json
import time
import urllib.request

import numpy as np
import pytest

from avbd_viz.scene_api import Scene, box_mesh
from avbd_viz.web.protocol import decode, encode
from avbd_viz.web.server import StreamBackend, VizServer

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


def test_port_in_use_moves_on(server):
    other = VizServer("127.0.0.1", server.port, verbose=False)
    try:
        assert other.port > server.port
    finally:
        other.close()
