"""Golden-image check of the web client against the native viewer: one frame
of a saved record, rendered by both at the same size and camera.

    PYTHONPATH=python python web/tools/golden.py EVALS_DIR RECORD_ID TICK OUT_DIR \\
        [--size 1280 800] [--eye X Y Z --target X Y Z] [--display JSON]

The native side rebuilds the record's scene at TICK in a headless
``avbd_viz.Viewer`` (NativeBackend, labels through the overlay); the web
side is the built client served by a replay server over EVALS_DIR, driven in
a real Chromium window by screenshot.mjs (``window.__golden``). Writes
native.png, web.png, diff.png (|web - native|, x4) and side.png, and prints
per-channel mean / 99th-percentile differences. The camera defaults to the
record's own (``look_at_grid``) and must be given for records without one.

``--display`` sets the same display options on both sides, e.g.
``'{"style": "pbr", "environment": 1, "slice": {"enabled": true, "axis": 0,
"offset": 0.3}, "objects": {"oven envs": {"opacity": 0.4}}}'`` (web
``DisplaySettings`` / ``ObjectDisplay`` names; everything else at defaults),
``{"shading": "wireframe", "faceOpacity": 0.2, "ortho": true}``, or a
selection on both sides, ``{"select": {"mode": 3, "object": "oven envs",
"indices": [0, 5]}}`` (mode 0-3 = vertex / edge / face / body; native
element numbering).
"""
import argparse
import json
import os
import subprocess
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))


STYLES = {"studio": "Studio", "matcap": "MatCap", "pbr": "EnvironmentPBR",
          "technical": "Technical"}
MATCAPS = ["Clay", "Porcelain", "Chrome", "Toon"]
ENVS = ["Studio", "Sky", "Soft"]
OUTLINES = ["Off", "Silhouettes", "SilhouettesAndCreases"]
SETTINGS = dict(shadows="shadows", shadowStrength="shadow_strength", ssao="ssao",
                aoStrength="ao_strength", aoRadius="ao_radius",
                outlineWidth="outline_width", exposure="exposure", grid="grid",
                groundShadow="ground_shadow", envIntensity="env_intensity",
                envRotation="env_rotation", wireframe="wireframe",
                wireWidth="wire_width", flatEdgeAngle="flat_edge_angle",
                wireObjectColors="wire_object_colors",
                faceOpacity="face_opacity")


def apply_display(v, disp):
    """The web display options ``disp`` on a native viewer."""
    import avbd_viz
    s = v.settings
    if "style" in disp:
        s.style = getattr(avbd_viz.Style, STYLES[disp["style"]])
    for k, n in SETTINGS.items():
        if k in disp:
            setattr(s, n, disp[k])
    if "outline" in disp:
        s.outline = getattr(avbd_viz.OutlineMode, OUTLINES[disp["outline"]])
    if "matcap" in disp:
        s.matcap = getattr(avbd_viz.MatcapPreset, MATCAPS[disp["matcap"]])
    if "environment" in disp:
        s.environment = getattr(avbd_viz.EnvironmentPreset, ENVS[disp["environment"]])
    for k, val in disp.get("slice", {}).items():
        setattr(s.slice, k, val)
    for name, d in disp.get("objects", {}).items():
        st = v.scene.get(name)
        for k, val in d.items():
            setattr(st, k, val)
    if "shading" in disp:
        s.shading = getattr(avbd_viz.Shading, disp["shading"].capitalize())
    v.camera.ortho = bool(disp.get("ortho", False))
    sel = disp.get("select")
    if sel:
        v.selection.mode = list(avbd_viz.PickMode.__members__.values())[sel["mode"]]
        oid = v.scene.get(sel["object"]).id
        for i, idx in enumerate(sel["indices"]):
            if i == 0:
                v.selection.set(oid, idx)
            else:
                v.selection.toggle(oid, idx)


def native(snapshot, record, tick, size, eye, target, out, disp):
    import avbd_viz
    from avbd_viz.scene_api import NativeBackend, Scene
    from avbd_viz.web.replay import build_scene, set_state

    v = avbd_viz.Viewer(headless=True, width=size[0], height=size[1])
    scene = Scene(NativeBackend(v))
    build_scene(scene, snapshot)
    set_state(scene, record, tick)
    v.camera.look_at(eye, target)
    apply_display(v, disp)
    v.set_callback(scene.draw_overlay)
    for _ in range(3):
        v.frame()
    v.request_screenshot(out, with_ui=False)
    v.frame()


def web(root, rid, tick, size, eye, target, out, port, disp):
    from avbd_viz.web.server import VizServer
    srv = VizServer("127.0.0.1", port, evals=root, verbose=False)
    try:
        expr = (f"window.__golden({json.dumps(rid)}, {tick}, {json.dumps(list(eye))}, "
                f"{json.dumps(list(target))}, {json.dumps(disp)})")
        r = subprocess.run(
            ["node", os.path.join(HERE, "screenshot.mjs"),
             f"http://127.0.0.1:{srv.port}/", "1500", expr, out,
             str(size[0]), str(size[1])],
            capture_output=True, text=True, timeout=120,
            env=dict(os.environ, DISPLAY=os.environ.get("DISPLAY", ":0")))
        print(r.stdout.strip())
        if not os.path.exists(out):
            sys.exit(f"web screenshot failed: {r.stderr}")
    finally:
        srv.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("evals")
    ap.add_argument("rid")
    ap.add_argument("tick", type=int)
    ap.add_argument("out")
    ap.add_argument("--size", type=int, nargs=2, default=(1280, 800))
    ap.add_argument("--eye", type=float, nargs=3)
    ap.add_argument("--target", type=float, nargs=3)
    ap.add_argument("--port", type=int, default=18990)
    ap.add_argument("--display", type=json.loads, default={})
    args = ap.parse_args()

    from avbd_viz.web.record import read_record
    _, rec, _ = read_record(os.path.join(args.evals, args.rid))
    cam = rec.snapshot.get("camera")
    eye = args.eye or (cam and cam[0])
    target = args.target or (cam and cam[1])
    if eye is None or target is None:
        sys.exit("record has no camera: pass --eye and --target")
    os.makedirs(args.out, exist_ok=True)
    n_png = os.path.join(args.out, "native.png")
    w_png = os.path.join(args.out, "web.png")
    native(rec.snapshot, rec, args.tick, args.size, eye, target, n_png,
           args.display)
    web(args.evals, args.rid, args.tick, args.size, eye, target, w_png,
        args.port, args.display)

    a = np.asarray(Image.open(n_png).convert("RGB"), np.float32)
    b = np.asarray(Image.open(w_png).convert("RGB"), np.float32)
    if a.shape != b.shape:
        sys.exit(f"size mismatch: native {a.shape}, web {b.shape}")
    d = np.abs(a - b)
    print("mean |diff| per channel:", np.round(d.mean(axis=(0, 1)), 2),
          " p99:", np.percentile(d, 99, axis=(0, 1)),
          f" pixels > 32: {100 * (d.max(axis=2) > 32).mean():.2f}%")
    Image.fromarray(np.clip(d * 4, 0, 255).astype(np.uint8)).save(
        os.path.join(args.out, "diff.png"))
    Image.fromarray(np.concatenate([a, b], axis=1).astype(np.uint8)).save(
        os.path.join(args.out, "side.png"))


if __name__ == "__main__":
    main()
