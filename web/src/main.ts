// avbd-viz web client: connects to the server that served this page (a
// training process, or a replay server), shows the "live" stream.
import "./style.css";
import { Panel, type StreamStats } from "./panel";
import { type Arr, decode } from "./protocol";
import { Renderer, type SceneObject } from "./renderer";
import { type Vec3 } from "./math";

const STREAM = "live";
const RATE = 20;

const canvas = document.getElementById("view") as HTMLCanvasElement;
const panel = new Panel(document.getElementById("panel")!);
const errorEl = document.getElementById("error")!;

const stats: StreamStats = {
  status: "connecting", name: "", time: null, frames: 0, dropped: 0, fps: 0, lastFrameAt: 0,
};
// For automated checks (e.g. a CDP screenshot harness).
(window as unknown as { __avbd: unknown }).__avbd = stats;

let renderer: Renderer | null = null;
let dirty = true;
let pendingAck: number | null = null;
let lastSeq = 0;
let numEnvs = 0;
let offsets: Float32Array | null = null;
let sceneCamera: [Vec3, Vec3] | null = null;
let ws: WebSocket | null = null;

function fail(msg: string) {
  errorEl.textContent = msg;
  errorEl.style.display = "block";
}

function onScene(msg: { objects: SceneObject[]; camera: [Vec3, Vec3] | null }) {
  renderer!.setScene(msg.objects);
  const rigid = msg.objects.find((o) => o.kind === "rigid_mesh");
  numEnvs = rigid ? rigid.attrs.instances : 0;
  offsets = rigid ? (rigid.arrays.offsets.data as Float32Array) : null;
  if (msg.camera && !sceneCamera) renderer!.camera.lookAt(msg.camera[0], msg.camera[1]);
  sceneCamera = msg.camera;
  dirty = true;
}

function onFrame(msg: {
  seq: number; time: number | null; objects: Record<string, Record<string, Arr>>;
  channels: Record<string, number | Arr>;
}) {
  if (lastSeq && msg.seq > lastSeq + 1) stats.dropped += msg.seq - lastSeq - 1;
  lastSeq = msg.seq;
  const now = performance.now();
  if (stats.lastFrameAt) stats.fps = 0.8 * stats.fps + 0.2 * (1000 / Math.max(1, now - stats.lastFrameAt));
  stats.lastFrameAt = now;
  stats.frames++;
  stats.time = msg.time;
  renderer!.applyFrame(msg.objects);
  panel.setChannels(msg.channels, numEnvs);
  pendingAck = msg.seq;
  dirty = true;
}

function connect() {
  const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
  stats.status = "connecting";
  ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";
  ws.onmessage = (ev) => {
    if (!(ev.data instanceof ArrayBuffer)) return;
    const msg = decode(ev.data);
    if (msg.type === "hello") {
      stats.name = msg.name;
      document.title = `${msg.name || "avbd-viz"} — avbd-viz`;
      const live = msg.streams.find((s: { name: string }) => s.name === STREAM) ?? msg.streams[0];
      if (live) ws!.send(JSON.stringify({ type: "subscribe", stream: live.name, rate: RATE }));
      else stats.status = "no stream";
    } else if (msg.type === "scene") {
      stats.status = "live";
      onScene(msg);
    } else if (msg.type === "frame") {
      onFrame(msg);
    }
  };
  ws.onclose = () => {
    stats.status = "disconnected — retrying";
    lastSeq = 0;
    setTimeout(connect, 1500);
  };
}

panel.onFocus = (env) => {
  if (!renderer) return;
  if (env < 0 || !offsets) {
    if (sceneCamera) renderer.camera.lookAt(sceneCamera[0], sceneCamera[1]);
  } else {
    // Keep the view direction, move onto the env's grid cell.
    const c = renderer.camera;
    const center: Vec3 = sceneCamera ? sceneCamera[1] : [0, 0, 1];
    c.target = [offsets[3 * env] + center[0], offsets[3 * env + 1] + center[1], offsets[3 * env + 2] + center[2]];
    c.distance = Math.min(c.distance, 2.5);
  }
  dirty = true;
};

function loop() {
  if (renderer && dirty) {
    renderer.render();
    dirty = false;
    if (pendingAck !== null && ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "ack", stream: STREAM, seq: pendingAck }));
      pendingAck = null;
    }
  }
  panel.setStatus(stats);
  requestAnimationFrame(loop);
}

Renderer.create(canvas)
  .then((r) => {
    renderer = r;
    r.camera.attach(canvas, () => (dirty = true));
    new ResizeObserver(() => (dirty = true)).observe(canvas);
    connect();
    requestAnimationFrame(loop);
  })
  .catch((e) => fail(`Cannot start the viewer: ${e.message}`));
