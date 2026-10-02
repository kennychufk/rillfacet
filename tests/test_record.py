"""rillfacet.web.record: recording scene sessions and reading them back.

    PYTHONPATH=python python -m pytest tests -q
"""

import os

import numpy as np
import pytest

from rillfacet.scene_api import Scene, box_mesh
from rillfacet.web.record import (Recorder, decode_poses, encode_poses,
                                 pose_codec_error, read_index, read_record,
                                 RecordWriter, write_record)


def unit_pose(n, B):
    p = np.zeros((n, B, 7), np.float32)
    p[..., 6] = 1.0
    return p


def scene_with_recorder():
    sc = Scene()
    v, t = box_mesh([[0, 0, 0]], [[1, 1, 1]])
    body = np.zeros(len(v), int)
    rm = sc.rigid_mesh("bodies", np.concatenate([v, v]), np.r_[body, body + 1],
                       np.concatenate([t, t + len(v)]), [0, 12, 24], instances=2)
    rm.set_poses(unit_pose(2, 2))
    bars = sc.boxes("bars", [[0, 0, 0]], [[1, 1, 1]])
    lab = sc.labels("vals", [[0, 0, 0], [1, 0, 0]], fmt="{:.2f}")
    rec = Recorder()
    sc.add_backend(rec)
    return sc, rm, bars, lab, rec


def test_pose_codec_roundtrip_static_bodies_and_wraparound():
    rng = np.random.default_rng(0)
    K, n, B = 300, 2, 3
    poses = np.zeros((K, n, B, 7), np.float32)
    t = np.linspace(0, 1, K)[:, None]
    poses[:, :, 0, :3] = rng.normal(size=(n, 3)) * 0.01           # static body 0
    poses[:, :, 0, 6] = 1.0
    poses[:, :, 1, :3] = (np.sin(7 * t) * 2.0)[:, :, None]         # smooth
    poses[:, :, 2, :3] = np.where(t > 0.5, 3.0, -3.0)[:, :, None]  # jump: full-range deltas
    q = rng.normal(size=(K, n, 2, 4))
    poses[:, :, 1:, 3:] = q / np.linalg.norm(q, axis=-1, keepdims=True)
    enc = encode_poses(poses)
    assert enc["static_mask"].tolist() == [True, False, False]
    dec = decode_poses(enc)
    assert np.array_equal(dec[:, :, 0], poses[:, :, 0])
    err = np.abs(dec[..., :3] - poses[..., :3]).max()
    assert err <= 1.01 * pose_codec_error(enc) + 1e-6
    assert np.abs(dec[..., 3:] - poses[..., 3:]).max() < 1e-4


def test_recorder_tracks_initial_state_and_updates():
    sc, rm, bars, lab, rec = scene_with_recorder()
    sc.set_channels(stale=np.ones(2))          # before start: not recorded
    sc.channels.clear()
    rec.start(sc, t=0)
    for k in range(1, 4):
        rec.tick(k)
        p = unit_pose(2, 2)
        p[:, :, 0] = k
        rm.set_poses(p)
        if k == 3:
            bars.set_boxes([[0, 0, 0]], [[2, 1, 1]], colors=[(1, 0, 0)])
            lab.set_values([1.0, 2.0])
            sc.set_channels(flux=np.array([0.5, 0.25]))
    r = rec.finish()
    t, v = r.track("bodies", "poses")
    assert t.tolist() == [0, 1, 2, 3] and v.shape == (4, 2, 2, 7)
    assert v[3, 0, 0, 0] == 3.0
    assert r.track("bars", "hi")[0].tolist() == [0, 3]      # initial + update
    assert r.track("vals", "values")[1][-1].tolist() == [1.0, 2.0]
    assert r.track("channels", "flux")[0].tolist() == [3]
    # The stored snapshot is static: no poses, no label values, no channels.
    objs = {o["name"]: o for o in r.snapshot["objects"]}
    assert "poses" not in objs["bodies"]["arrays"]
    assert "values" not in objs["vals"]["arrays"]
    assert r.snapshot["channels"] == {}
    # Not recording: updates are ignored.
    rm.set_poses(unit_pose(2, 2))
    assert not rec._tracks


def test_recorder_copies_cuda_tensors():
    torch = pytest.importorskip("torch")
    if not torch.cuda.is_available():
        pytest.skip("no CUDA")
    sc, rm, _, _, rec = scene_with_recorder()
    rec.start(sc)
    base = torch.as_tensor(unit_pose(2, 2), device="cuda")
    for k in range(1, 700):                     # more than one pinned chunk
        rec.tick(k)
        p = base.clone()
        p[:, :, 0] = k
        rm.set_poses(p)                         # p is reused/freed right away
    t, v = rec.finish().track("bodies", "poses")
    assert len(t) == 700 and np.array_equal(v[1:, 0, 0, 0], np.arange(1, 700))


def test_write_read_index_and_shared_scene(tmp_path):
    root = str(tmp_path / "evals")
    writer = RecordWriter(root)
    for step in (10, 20):
        sc, rm, _, lab, rec = scene_with_recorder()
        rec.start(sc)
        rec.tick(1)
        p = unit_pose(2, 2)
        p[1, 1, :3] = (step, 0, 0)
        rm.set_poses(p)
        lab.set_values([step, 0])
        writer.submit(f"t{step}", rec.finish(), meta=dict(timestep=step),
                      summary=dict(batch=dict(success=step / 100)))
    writer.flush()
    writer.close()
    assert not writer.errors
    assert len(os.listdir(os.path.join(root, "scenes"))) == 1    # one scene
    idx = read_index(root)
    assert [e["id"] for e in idx] == ["t10", "t20"]
    assert idx[1]["summary"] == {"success": 0.2}
    meta, r, summary = read_record(os.path.join(root, "t20"))
    assert meta["timestep"] == 20 and summary["batch"]["success"] == 0.2
    t, v = r.track("bodies", "poses")
    assert t.tolist() == [0, 1]
    assert abs(v[1, 1, 1, 0] - 20) <= pose_codec_error(
        encode_poses(v)) + 1e-3
    assert [o["name"] for o in r.snapshot["objects"]] == ["bodies", "bars", "vals"]
    # Rewriting an id replaces its index entry.
    sc, _, _, _, rec = scene_with_recorder()
    rec.start(sc)
    write_record(root, "t10", rec.finish(), meta=dict(timestep=10),
                 summary=dict(batch={}))
    assert [e["id"] for e in read_index(root)] == ["t20", "t10"]
