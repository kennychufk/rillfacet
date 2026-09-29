// avbd-viz web client: connects to the server that served this page (a
// training process, or a replay server). Modes: Live (the "live" stream),
// Training ring (the trainer's last episode per streamed env) and Evals
// (saved evals, picked on the outer timeline); the replay modes play a
// Replay under the episode scrubber.
import "./style.css";
import { Panel, type StreamStats } from "./panel";
import { type Arr, decode } from "./protocol";
import { Renderer, type SceneObject } from "./renderer";
import { type Vec3 } from "./math";
import { envOutcome, OUTCOMES, Replay, type ChunkMsg, type ReplayMsg } from "./replay";
import { type EvalEntry, type Mode, Timeline } from "./timeline";

const STREAM = "live";
const RATE = 20;

const canvas = document.getElementById("view") as HTMLCanvasElement;
const panel = new Panel(document.getElementById("panel")!);
const bar = document.getElementById("bar")!;
const timeline = new Timeline(bar);
const errorEl = document.getElementById("error")!;

const stats: StreamStats & { mode: Mode; replay: unknown } = {
  status: "connecting", name: "", time: null, frames: 0, dropped: 0, fps: 0, lastFrameAt: 0,
  mode: "live", replay: null,
};
// For automated checks (e.g. a CDP screenshot harness).
(window as unknown as { __avbd: unknown }).__avbd = stats;
(window as unknown as { __timeline: unknown }).__timeline = timeline;

type SceneMsg = { objects: SceneObject[]; camera: [Vec3, Vec3] | null };

let renderer: Renderer | null = null;
let dirty = true;
let pendingAck: number | null = null;
let lastSeq = 0;
let numEnvs = 0;
let offsets: Float32Array | null = null;
let sceneCamera: [Vec3, Vec3] | null = null;
let cameraSet = false;
let ws: WebSocket | null = null;

let hasLive = false;
let hasRing = false;
let hasEvals = false;
let subscribed = false;
let liveScene: SceneMsg | null = null;
let replay: Replay | null = null;
let replayRequests = 0; // the server numbers replays per connection, in order
let lastPanel = 0;
let toastTimer = 0;

function fail(msg: string) {
  errorEl.textContent = msg;
  errorEl.style.display = "block";
}

function toast(msg: string) {
  errorEl.textContent = msg;
  errorEl.style.display = "block";
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (errorEl.style.display = "none"), 6000);
}

function send(m: object) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
}

// -- scenes -----------------------------------------------------------------

function showScene(msg: SceneMsg) {
  renderer!.setScene(msg.objects);
  const rigid = msg.objects.find((o) => o.kind === "rigid_mesh");
  numEnvs = rigid ? rigid.attrs.instances : 0;
  offsets = rigid ? (rigid.arrays.offsets.data as Float32Array) : null;
  if (msg.camera) sceneCamera = msg.camera;
  if (msg.camera && !cameraSet) {
    renderer!.camera.lookAt(msg.camera[0], msg.camera[1]);
    cameraSet = true;
  }
  dirty = true;
}

// A scene without a camera: frame the body origins of the first poses.
function frameOnce(objects: Record<string, Record<string, Arr>>) {
  if (cameraSet) return;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const f of Object.values(objects)) {
    const p = f.poses;
    if (!p) continue;
    const [n, B] = p.shape;
    for (let e = 0; e < n; e++)
      for (let b = 0; b < B; b++)
        for (let k = 0; k < 3; k++) {
          const x = p.data[(e * B + b) * 7 + k] + (offsets ? offsets[3 * e + k] : 0);
          lo[k] = Math.min(lo[k], x);
          hi[k] = Math.max(hi[k], x);
        }
  }
  if (!Number.isFinite(lo[0])) return;
  const c: Vec3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  const r = Math.max(0.5, Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2);
  const eye: Vec3 = [c[0], c[1] - 2.2 * r, c[2] + 1.6 * r];
  renderer!.camera.lookAt(eye, c);
  sceneCamera = [eye, c];
  cameraSet = true;
}

// -- modes ------------------------------------------------------------------

function setMode(m: Mode) {
  stats.mode = m;
  timeline.setMode(m);
  if (m === "live") {
    replay = null;
    timeline.setReplay(null);
    if (!subscribed && hasLive) {
      send({ type: "subscribe", stream: STREAM, rate: RATE });
      subscribed = true;
    }
    if (liveScene) showScene(liveScene);
    return;
  }
  // Replay modes: no live frames needed (the trainer then pays nothing).
  if (subscribed) {
    send({ type: "unsubscribe", stream: STREAM });
    subscribed = false;
  }
  if (m === "ring") openReplay({ source: "ring" });
  else {
    const list = timeline.evalList;
    const id = timeline.selectedEval ?? list[list.length - 1]?.id;
    if (id) pickEval(id);
    else {
      replay = null;
      timeline.setReplay(null);
    }
  }
}

function openReplay(m: object) {
  replayRequests++;
  replay = null;
  timeline.setReplay(null);
  send({ type: "open_replay", ...m });
}

function pickEval(id: string) {
  timeline.selectEval(id);
  if (stats.mode !== "eval") {
    setMode("eval");
    return;
  }
  openReplay({ source: "eval", id });
}

function onReplay(msg: ReplayMsg) {
  if (msg.id !== replayRequests) return; // superseded
  const r = new Replay(msg);
  replay = r;
  stats.replay = { id: msg.id, source: msg.source, name: msg.name, duration: msg.duration, chunks: r.chunksTotal };
  showScene(msg.scene);
  timeline.setReplay(r);
  r.onChunk = () => {
    send({ type: "replay_ack", id: r.id, n: r.chunksDone });
    (stats.replay as Record<string, unknown>).loaded = r.chunksDone;
    if (r === replay) {
      timeline.render();
      applyReplay(true);
    }
  };
  applyReplay(true);
}

function outcomeText(): string {
  const r = replay;
  if (!r) return stats.mode === "ring" ? "asking the trainer for its latest episodes…" : "loading…";
  const b = r.msg.summary.batch ?? {};
  const mix = OUTCOMES.filter(([k]) => b[k] !== undefined && b[k] > 0)
    .map(([k]) => `${k} ${(100 * b[k]).toFixed(0)}%`).join(" · ");
  if (r.msg.source === "ring") {
    const envs = r.msg.summary.envs ?? [];
    const done = envs.filter((e) => e.complete).length;
    return `last episodes at step ${r.msg.meta.timestep} · ${done}/${envs.length} complete${mix ? " · " + mix : ""}`;
  }
  const ck = String(r.msg.meta.checkpoint ?? "").split("/").pop();
  return `${ck ? ck + " · " : ""}seed ${r.msg.meta.seed ?? "?"}${mix ? " · " + mix : ""}`;
}

function applyReplay(all = false) {
  const r = replay;
  if (!r || !renderer) return;
  if (all) r.resetCache();
  const s = r.sample(timeline.t, all);
  frameOnce(s.objects);
  renderer.applyFrame(s.objects);
  const now = performance.now();
  if (all || now - lastPanel > 100) {
    lastPanel = now;
    const outcomes = r.msg.summary.envs?.map((e) => envOutcome(e)) ?? [];
    const ended = r.endStep.map((e) => timeline.t >= e);
    // The episode's summary rates and means as the batch numbers.
    for (const [k, v] of Object.entries(r.msg.summary.batch ?? {}))
      if (typeof v === "number") s.channels[`episode ${k}`] = v;
    panel.setChannels(s.channels, r.numEnvs, outcomes, ended);
  }
  dirty = true;
}

timeline.onMode = setMode;
timeline.onPickEval = pickEval;
timeline.onSeek = () => applyReplay();

// -- connection -------------------------------------------------------------

function onFrame(msg: {
  seq: number; time: number | null; objects: Record<string, Record<string, Arr>>;
  channels: Record<string, number | Arr>;
}) {
  pendingAck = msg.seq;
  if (stats.mode !== "live") return;
  if (lastSeq && msg.seq > lastSeq + 1) stats.dropped += msg.seq - lastSeq - 1;
  lastSeq = msg.seq;
  const now = performance.now();
  if (stats.lastFrameAt) stats.fps = 0.8 * stats.fps + 0.2 * (1000 / Math.max(1, now - stats.lastFrameAt));
  stats.lastFrameAt = now;
  stats.frames++;
  stats.time = msg.time;
  frameOnce(msg.objects);
  renderer!.applyFrame(msg.objects);
  panel.setChannels(msg.channels, numEnvs);
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
      hasLive = msg.streams.some((s: { name: string }) => s.name === STREAM);
      hasRing = !!msg.replay?.ring;
      hasEvals = !!msg.replay?.evals;
      subscribed = false;
      replayRequests = 0;
      timeline.setAvailable(hasLive, hasRing, hasEvals);
      stats.status = hasLive ? "waiting for the scene" : "replay";
      const m = stats.mode === "live" && !hasLive ? "eval" : stats.mode;
      setMode(m);
    } else if (msg.type === "scene") {
      stats.status = "live";
      liveScene = msg;
      if (stats.mode === "live") showScene(msg);
    } else if (msg.type === "frame") {
      onFrame(msg);
    } else if (msg.type === "evals") {
      const first = !hasEvals || !timeline.evalList.length;
      hasEvals = true;
      timeline.setAvailable(hasLive, hasRing, true);
      timeline.setEvals(msg.evals as EvalEntry[]);
      if (stats.mode === "eval" && first && !replay) setMode("eval");
    } else if (msg.type === "replay") {
      onReplay(msg as ReplayMsg);
    } else if (msg.type === "replay_chunk") {
      const c = msg as ChunkMsg;
      if (replay && c.id === replay.id) replay.addChunk(c);
    } else if (msg.type === "event") {
      toast(msg.text);
    }
  };
  ws.onclose = () => {
    stats.status = "disconnected — retrying";
    lastSeq = 0;
    subscribed = false;
    setTimeout(connect, 1500);
  };
}

panel.onFocus = (env) => {
  timeline.focus = env;
  timeline.drawPlot();
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

// Keep the panel clear of the bottom bar.
new ResizeObserver(() =>
  document.documentElement.style.setProperty("--bar-h", `${bar.offsetHeight + 12}px`)).observe(bar);

let lastT = performance.now();
function loop(now: number) {
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  if (stats.mode !== "live" && timeline.advance(dt)) applyReplay();
  if (renderer && dirty) {
    renderer.render();
    dirty = false;
  }
  if (pendingAck !== null && ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "ack", stream: STREAM, seq: pendingAck }));
    pendingAck = null;
  }
  if (stats.mode === "live") panel.setStatus(stats);
  else {
    const title = replay ? replay.msg.name : stats.mode === "ring" ? "training ring" : "evals";
    panel.setHeader(replay ? "ok" : "wait", `${stats.name || "avbd-viz"} — ${title}`, outcomeText());
  }
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
