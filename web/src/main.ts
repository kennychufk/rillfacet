// rillfacet web client: connects to the server that served this page (a
// training process, or a replay server). Modes: Live (the "live" stream),
// Training ring (the trainer's last episode per streamed env) and Evals
// (saved evals, picked on the outer timeline); the replay modes play a
// Replay under the episode scrubber. The viewport works as the native
// viewer's (interaction.ts: Blender-style navigation, vertex / edge / face /
// body selection, measuring, wireframe shading); the selected element's env
// is the panel's focus. Double-click an env to show it alone (Esc: all).
import "./style.css";
import { LiveHistory, Panel, type SeriesSource, type StreamStats } from "./panel";
import { type Arr, decode } from "./protocol";
import { applyStyleDefaults, defaultSettings, Renderer, type SceneObject } from "./renderer";
import { type Vec3 } from "./math";
import { Interaction } from "./interaction";
import { Inspector } from "./inspector";
import { Hud } from "./hud";
import { envOutcome, OUTCOMES, Replay, type ChunkMsg, type ReplayMsg } from "./replay";
import { type EvalEntry, type Mode, Timeline } from "./timeline";
import { DisplayPanel } from "./display";

const STREAM = "live";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("view");
const top = $("top");
const panel = new Panel($("stats"));
const bar = $("bar");
const timeline = new Timeline(bar);
const errorEl = $("error");
const envSel = $<HTMLSelectElement>("envs");
const rateSel = $<HTMLSelectElement>("rate");
const saveBtn = $<HTMLButtonElement>("save");
const evalBtn = $<HTMLButtonElement>("eval");

const stats: StreamStats & { mode: Mode; replay: unknown; focus: number; isolated: number } = {
  status: "connecting", name: "", time: null, frames: 0, dropped: 0, fps: 0, lastFrameAt: 0,
  mode: "live", replay: null, focus: -1, isolated: -1,
};
// For automated checks (e.g. a CDP screenshot harness), with console errors.
(window as unknown as { __rillfacet: unknown }).__rillfacet = stats;
(window as unknown as { __timeline: unknown }).__timeline = timeline;
const errors: string[] = [];
(stats as unknown as { errors: string[] }).errors = errors;
const consoleError = console.error.bind(console);
console.error = (...a: unknown[]) => {
  if (errors.length < 20) errors.push(a.map(String).join(" "));
  consoleError(...a);
};

type SceneMsg = { objects: SceneObject[]; camera: [Vec3, Vec3] | null; info?: { envs?: number[]; env_total?: number } };

let renderer: Renderer | null = null;
let display: DisplayPanel | null = null;
let ix: Interaction | null = null;
let inspector: Inspector | null = null;
let hud: Hud | null = null;
let dirty = true;
let pendingAck: number | null = null;
let lastSeq = 0;
let numEnvs = 0;
let envNames: number[] | undefined;
let sceneCamera: [Vec3, Vec3] | null = null;
let cameraSet = false;
let ws: WebSocket | null = null;

let hasLive = false;
let hasRing = false;
let hasEvals = false;
let accepts: string[] = [];
let subscribed = false;
let rate = Number(rateSel.value);
let liveScene: SceneMsg | null = null;
let liveChannels: Record<string, number | Arr> = {};
const history = new LiveHistory();
let replay: Replay | null = null;
let replayRequests = 0; // the server numbers replays per connection, in order
let lastPanel = 0;

function fail(msg: string) {
  errorEl.textContent = msg;
  errorEl.style.display = "block";
}

function toast(msg: string, level = "info") {
  const el = document.createElement("div");
  el.className = `toast ${level}`;
  el.textContent = msg;
  $("toasts").append(el);
  setTimeout(() => el.remove(), level === "error" ? 9000 : 5000);
}

function send(m: object) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
}

// -- scenes -----------------------------------------------------------------

function showScene(msg: SceneMsg) {
  renderer!.setScene(msg.objects);
  // Object ids restart with every scene.
  if (ix) {
    ix.measurements.length = 0;
    ix.pending = { anchors: [], angle: false };
    ix.selection.clear();
    ix.changed();
  }
  const rigid = renderer!.rigidInfo();
  numEnvs = rigid ? rigid.instances : 0;
  if (msg.camera) sceneCamera = msg.camera;
  if (msg.camera && !cameraSet) {
    renderer!.camera.lookAt(msg.camera[0], msg.camera[1]);
    cameraSet = true;
  }
  if (stats.focus >= numEnvs) stats.focus = -1;
  stats.isolated = -1;
  applyEnvState();
  display?.sceneChanged();
  dirty = true;
}

// A scene without a camera: frame the body origins of the first poses.
function frameOnce(objects: Record<string, Record<string, Arr>>) {
  if (cameraSet) return;
  const off = renderer!.rigidInfo()?.offsets;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const f of Object.values(objects)) {
    const p = f.poses;
    if (!p) continue;
    const [n, B] = p.shape;
    for (let e = 0; e < n; e++)
      for (let b = 0; b < B; b++)
        for (let k = 0; k < 3; k++) {
          const x = p.data[(e * B + b) * 7 + k] + (off ? off[4 * e + k] : 0);
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

// -- focus / isolate ----------------------------------------------------------

function envCenter(env: number): Vec3 | null {
  const r = renderer?.rigidInfo();
  if (!r || env < 0 || env >= r.instances) return null;
  const c: Vec3 = sceneCamera ? sceneCamera[1] : [0, 0, 1];
  return [r.offsets[4 * env] + c[0], r.offsets[4 * env + 1] + c[1], r.offsets[4 * env + 2] + c[2]];
}

function flyTo(target: Vec3, distance: number) {
  const c = renderer!.camera;
  c.animateTo(target, distance, c.yaw, c.pitch, 0.35);
  dirty = true;
}

function applyEnvState() {
  renderer?.setIsolated(stats.isolated);
  panel.focus = stats.focus;
  timeline.focus = stats.focus;
  timeline.drawPlot();
  refreshPanel(true);
  dirty = true;
}

// An env picked in the panel: select its bodies and fly there (none: back
// to the scene's view).
function focusEnv(env: number) {
  const r = renderer?.rigidInfo();
  if (r && ix && env >= 0 && env < r.instances)
    ix.selectSegments(r.id, Array.from({ length: r.bodies }, (_, b) => env * r.bodies + b));
  stats.focus = env;
  applyEnvState();
  if (!renderer) return;
  const c = envCenter(env);
  if (c) flyTo(c, Math.min(renderer.camera.distance, 2.5));
  else if (sceneCamera && stats.isolated < 0) {
    const [eye, t] = sceneCamera;
    flyTo([...t], Math.hypot(eye[0] - t[0], eye[1] - t[1], eye[2] - t[2]));
  }
}

function isolateEnv(env: number) {
  stats.isolated = stats.isolated === env ? -1 : env;
  if (env >= 0) stats.focus = env;
  applyEnvState();
  const c = envCenter(stats.isolated >= 0 ? stats.isolated : stats.focus);
  if (c && renderer) flyTo(c, Math.min(renderer.camera.distance, 2.5));
}

panel.onFocus = (env) => focusEnv(env);

// -- top bar ------------------------------------------------------------------

function renderTop() {
  const live = stats.mode === "live";
  for (const el of top.querySelectorAll<HTMLElement>(".live-only")) el.style.display = live && hasLive ? "" : "none";
  envSel.disabled = !accepts.includes("select_envs");
  saveBtn.style.display = accepts.includes("save_checkpoint") ? "" : "none";
  evalBtn.style.display = accepts.includes("run_eval") ? "" : "none";
}

function setEnvOptions(info: SceneMsg["info"]) {
  const envs = info?.envs, total = info?.env_total;
  if (!envs?.length || !total) {
    envSel.innerHTML = "";
    return;
  }
  const n = envs.length;
  const opts: string[] = [];
  for (let first = 0; first < total; first += n) {
    const f = Math.min(first, total - n);
    opts.push(`<option value="${f}">${f}–${f + n - 1} of ${total}</option>`);
    if (f + n >= total) break;
  }
  envSel.innerHTML = opts.join("");
  envSel.value = String(envs[0]);
}

envSel.addEventListener("change", () => send({ type: "select_envs", first: Number(envSel.value) }));
rateSel.addEventListener("change", () => {
  rate = Number(rateSel.value);
  if (subscribed) send({ type: "subscribe", stream: STREAM, rate });
});
for (const [btn, type] of [[saveBtn, "save_checkpoint"], [evalBtn, "run_eval"]] as const) {
  btn.addEventListener("click", () => {
    send({ type });
    btn.disabled = true;
    setTimeout(() => (btn.disabled = false), 2000);
  });
}

// -- modes ------------------------------------------------------------------

function setMode(m: Mode) {
  stats.mode = m;
  timeline.setMode(m);
  renderTop();
  if (m === "live") {
    replay = null;
    timeline.setReplay(null);
    if (!subscribed && hasLive) {
      send({ type: "subscribe", stream: STREAM, rate });
      subscribed = true;
    }
    if (liveScene) {
      envNames = liveScene.info?.envs;
      showScene(liveScene);
    }
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
  envNames = msg.meta.envs;
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

function replayText(): string {
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

let replaySample: { channels: Record<string, number | Arr> } | null = null;

function applyReplay(all = false) {
  const r = replay;
  if (!r || !renderer) return;
  if (all) r.resetCache();
  const s = r.sample(timeline.t, all);
  frameOnce(s.objects);
  renderer.applyFrame(s.objects);
  // The episode's summary rates and means as the batch numbers.
  for (const [k, v] of Object.entries(r.msg.summary.batch ?? {}))
    if (typeof v === "number") s.channels[`episode ${k}`] = v;
  replaySample = s;
  refreshPanel(all);
  dirty = true;
}

function refreshPanel(force = false) {
  const now = performance.now();
  if (!force && now - lastPanel < 100) return;
  lastPanel = now;
  if (stats.mode === "live") {
    panel.update({ channels: liveChannels, numEnvs, envNames, series: history });
    return;
  }
  const r = replay;
  if (!r || !replaySample) return;
  const series: SeriesSource = r.series(timeline.t);
  panel.update({
    channels: replaySample.channels, numEnvs: r.numEnvs, envNames,
    outcomes: r.msg.summary.envs?.map((e) => envOutcome(e)) ?? [],
    ended: r.endStep.map((e) => timeline.t >= e), series,
  });
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
  liveChannels = msg.channels;
  history.push(msg.channels, numEnvs);
  refreshPanel();
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
      document.title = `${msg.name || "rillfacet"} — rillfacet`;
      hasLive = msg.streams.some((s: { name: string }) => s.name === STREAM);
      hasRing = !!msg.replay?.ring;
      hasEvals = !!msg.replay?.evals;
      accepts = msg.accepts ?? [];
      subscribed = false;
      replayRequests = 0;
      timeline.setAvailable(hasLive, hasRing, hasEvals);
      stats.status = hasLive ? "waiting for the scene" : "replay";
      const m = stats.mode === "live" && !hasLive ? "eval" : stats.mode;
      setMode(m);
    } else if (msg.type === "scene") {
      stats.status = "live";
      const changed = liveScene?.info?.envs?.[0] !== msg.info?.envs?.[0];
      liveScene = msg;
      setEnvOptions(msg.info);
      if (changed) history.clear();
      if (stats.mode === "live") {
        envNames = msg.info?.envs;
        showScene(msg);
      }
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
      toast(msg.text, msg.level);
    }
  };
  ws.onclose = () => {
    stats.status = "disconnected — retrying";
    lastSeq = 0;
    subscribed = false;
    setTimeout(connect, 1500);
  };
}

// Golden-image hook (tools/golden.py): eval `id` at tick `t` seen from
// eye -> target, UI hidden, display settings reset to the defaults plus
// `disp` ({style, ...settings, slice, objects: {name: ObjectDisplay}});
// resolves once that frame is on screen.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as unknown as { __golden: unknown }).__golden = async (id: string, t: number, eye: Vec3, target: Vec3, disp: any = {}) => {
  document.body.classList.add("bare");
  const r0 = renderer!;
  const { style, slice, objects, ortho, select, ...rest } = disp;
  r0.settings = defaultSettings();
  if (style) applyStyleDefaults(r0.settings, style);
  Object.assign(r0.settings, rest);
  Object.assign(r0.settings.slice, slice ?? {});
  r0.display.clear();
  for (const [name, d] of Object.entries(objects ?? {})) Object.assign(r0.displayOf(name), d);
  pickEval(id);
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  for (let k = 0; k < 600; k++) {
    const r = replay;
    if (r && r.msg.meta.id === id && r.chunksDone === r.chunksTotal) break;
    await sleep(50);
  }
  timeline.seek(t);
  renderer!.camera.lookAt(eye, target);
  renderer!.camera.ortho = !!ortho;
  cameraSet = true;
  // select: {mode: 0-3, object: name, indices: [...]}
  if (select && ix) {
    ix.selection.setMode(select.mode);
    const g = renderer!.geometries().find((x) => x.name === select.object);
    if (g) ix.selection.add(select.indices.map((index: number) => ({ object: g.id, index })), false);
    ix.changed();
  }
  dirty = true;
  for (let k = 0; k < 3; k++) await new Promise((r) => requestAnimationFrame(r));
  return replay ? "ok" : "no replay";
};

// Keep the panel clear of the top and bottom bars.
{
  const ro = new ResizeObserver(() => {
    const s = document.documentElement.style;
    s.setProperty("--bar-h", `${bar.offsetHeight + 12}px`);
    s.setProperty("--top-h", `${top.offsetHeight + 12}px`);
  });
  for (const el of [bar, top, document.body]) ro.observe(el);
}

function renderStatus() {
  let state: string, title: string, clock: string;
  const name = stats.name || "rillfacet";
  if (stats.mode === "live") {
    const live = stats.status === "live";
    state = live ? "ok" : stats.status === "connecting" ? "wait" : "bad";
    title = `${name} — ${stats.status}`;
    const age = stats.lastFrameAt ? (performance.now() - stats.lastFrameAt) / 1000 : NaN;
    clock = `step ${stats.time ?? "–"} · ${stats.frames} frames (${stats.dropped} dropped) · ` +
      `${stats.fps.toFixed(1)} fps · last ${Number.isFinite(age) ? age.toFixed(1) + " s" : "–"} ago`;
  } else {
    state = replay ? "ok" : "wait";
    title = `${name} — ${replay ? replay.msg.name : stats.mode === "ring" ? "training ring" : "evals"}`;
    clock = replayText();
  }
  top.className = state;
  top.querySelector(".title")!.textContent = title;
  top.querySelector(".clock")!.textContent = clock;
}

let lastT = performance.now();
function loop(now: number) {
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  if (stats.mode !== "live" && timeline.advance(dt)) applyReplay();
  if (ix?.update(dt)) dirty = true;
  // Golden captures keep presenting frames, so a screenshot never finds
  // the canvas without one.
  if (document.body.classList.contains("bare")) dirty = true;
  if (renderer && dirty) {
    renderer.render();
    dirty = false;
    hud?.rendered(now);
  }
  hud?.update(now);
  inspector?.update(now);
  display?.sync();
  if (pendingAck !== null && ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "ack", stream: STREAM, seq: pendingAck }));
    pendingAck = null;
  }
  renderStatus();
  requestAnimationFrame(loop);
}

Renderer.create(canvas)
  .then((r) => {
    renderer = r;
    display = new DisplayPanel($("display"), r);
    display.onChange = () => (dirty = true);
    const btn = $("display-btn");
    btn.addEventListener("click", () => {
      display!.toggle();
      btn.setAttribute("aria-expanded", String(display!.open));
    });
    ix = new Interaction(canvas, r, $("selbox"));
    ix.onDirty = () => (dirty = true);
    ix.onSelection = () => {
      const a = ix!.selection.active;
      stats.focus = a ? ix!.envOf(a) : -1;
      applyEnvState();
    };
    ix.onIsolate = isolateEnv;
    ix.homeTaken = () => stats.mode !== "live" && replay !== null;
    ix.onStatus = (m) => toast(m);
    ix.onEscape = () => {
      if (stats.isolated < 0) return false;
      isolateEnv(-1);
      return true;
    };
    (window as unknown as { __ix: unknown }).__ix = ix; // automated checks
    inspector = new Inspector($("inspect"), ix);
    hud = new Hud($("gizmo"), $("hud"), $("scalebar"), r, ix, () => (dirty = true));
    new ResizeObserver(() => (dirty = true)).observe(canvas);
    renderTop();
    connect();
    requestAnimationFrame(loop);
  })
  .catch((e) => fail(`Cannot start the viewer: ${e.message}`));
