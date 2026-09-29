// The bottom bar: mode switch (Live / Training ring / Evals), the outer
// timeline (one mark per saved eval along trainer timesteps, colored by its
// outcome mix) and the inner one (the episode scrubber: play/pause, speed,
// physics- or control-step stepping, and a channel plot to scrub along).
import { type Replay, OUTCOMES } from "./replay";

export type Mode = "live" | "ring" | "eval";

export interface EvalEntry { id: string; timestep?: number; summary?: Record<string, number> }

const SPEEDS = [0.1, 0.25, 0.5, 1, 2, 4];

const cssVar = (el: Element, name: string) => getComputedStyle(el).getPropertyValue(name).trim();

export class Timeline {
  private root: HTMLElement;
  private modeBtns: Record<Mode, HTMLButtonElement>;
  private outer: HTMLElement;
  private outerRow: HTMLElement;
  private inner: HTMLElement;
  private plot: HTMLCanvasElement;
  private timeEl: HTMLElement;
  private playBtn: HTMLButtonElement;
  private speedSel: HTMLSelectElement;
  private chanSel: HTMLSelectElement;
  private evals: EvalEntry[] = [];

  mode: Mode = "live";
  replay: Replay | null = null;
  selectedEval: string | null = null;
  t = 0; // ticks
  playing = false;
  speed = 1;
  focus = -1;

  onMode: (m: Mode) => void = () => {};
  onPickEval: (id: string) => void = () => {};
  onSeek: () => void = () => {};

  constructor(root: HTMLElement) {
    this.root = root;
    root.innerHTML = `
      <div class="bar-row">
        <div class="modes" role="tablist">
          <button data-mode="live" role="tab">Live</button>
          <button data-mode="ring" role="tab" title="Last episode of each streamed training env">Training ring</button>
          <button data-mode="eval" role="tab" title="Saved deterministic evals">Evals</button>
        </div>
        <div class="outer-wrap"><div class="outer" aria-label="Saved evals"></div></div>
      </div>
      <div class="inner">
        <div class="controls">
          <button class="b-start" title="Start (Home)">⏮</button>
          <button class="b-cback" title="Back one control step (Shift+←)">«</button>
          <button class="b-pback" title="Back one physics step (←)">‹</button>
          <button class="b-play" title="Play / pause (Space)">▶</button>
          <button class="b-pfwd" title="Forward one physics step (→)">›</button>
          <button class="b-cfwd" title="Forward one control step (Shift+→)">»</button>
          <select class="speed" title="Playback speed (1× = real time)">
            ${SPEEDS.map((s) => `<option value="${s}"${s === 1 ? " selected" : ""}>${s}×</option>`).join("")}
          </select>
          <span class="time"></span>
          <select class="chan" title="Channel plotted under the scrubber"></select>
        </div>
        <canvas class="plot" aria-label="Episode scrubber"></canvas>
      </div>`;
    const q = <T extends Element>(s: string) => root.querySelector(s) as T;
    this.modeBtns = {
      live: q("[data-mode=live]"), ring: q("[data-mode=ring]"), eval: q("[data-mode=eval]"),
    };
    for (const [m, b] of Object.entries(this.modeBtns)) b.addEventListener("click", () => this.onMode(m as Mode));
    this.outerRow = q(".outer-wrap");
    this.outer = q(".outer");
    this.inner = q(".inner");
    this.plot = q(".plot");
    this.timeEl = q(".time");
    this.playBtn = q(".b-play");
    this.speedSel = q(".speed");
    this.chanSel = q(".chan");
    this.playBtn.addEventListener("click", () => this.togglePlay());
    q(".b-start").addEventListener("click", () => this.seek(0));
    q(".b-pback").addEventListener("click", () => this.step(-1, false));
    q(".b-pfwd").addEventListener("click", () => this.step(1, false));
    q(".b-cback").addEventListener("click", () => this.step(-1, true));
    q(".b-cfwd").addEventListener("click", () => this.step(1, true));
    this.speedSel.addEventListener("change", () => (this.speed = Number(this.speedSel.value)));
    this.chanSel.addEventListener("change", () => this.drawPlot());
    this.outer.addEventListener("click", (e) => {
      const el = (e.target as HTMLElement).closest("[data-id]") as HTMLElement | null;
      if (el) this.onPickEval(el.dataset.id!);
    });

    let dragging = false;
    const scrub = (e: PointerEvent) => {
      if (!this.replay) return;
      const r = this.plot.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      this.seek(x * this.replay.duration);
    };
    this.plot.addEventListener("pointerdown", (e) => {
      dragging = true;
      this.plot.setPointerCapture(e.pointerId);
      this.playing = false;
      scrub(e);
    });
    this.plot.addEventListener("pointermove", (e) => dragging && scrub(e));
    this.plot.addEventListener("pointerup", () => (dragging = false));
    new ResizeObserver(() => this.drawPlot()).observe(this.plot);

    window.addEventListener("keydown", (e) => {
      if (this.mode === "live" || !this.replay) return;
      if ((e.target as HTMLElement).closest("select, input")) return;
      if (e.key === " ") this.togglePlay();
      else if (e.key === "ArrowLeft") this.step(-1, e.shiftKey);
      else if (e.key === "ArrowRight") this.step(1, e.shiftKey);
      else if (e.key === "Home") this.seek(0);
      else if (e.key === "End") this.seek(this.replay.duration);
      else if (e.key === "[" || e.key === "]") this.pickNeighbor(e.key === "]" ? 1 : -1);
      else return;
      e.preventDefault();
    });
    this.render();
  }

  setAvailable(live: boolean, ring: boolean, evals: boolean) {
    this.modeBtns.live.disabled = !live;
    this.modeBtns.ring.disabled = !ring;
    this.modeBtns.eval.disabled = !evals;
  }

  setMode(m: Mode) {
    this.mode = m;
    this.playing = false;
    this.render();
  }

  setEvals(evals: EvalEntry[]) {
    this.evals = [...evals].sort((a, b) => (a.timestep ?? 0) - (b.timestep ?? 0));
    this.renderOuter();
  }

  get evalList() { return this.evals; }

  setReplay(r: Replay | null) {
    this.replay = r;
    this.t = 0;
    this.playing = false;
    const prev = this.chanSel.value;
    const chans = r ? r.perEnvChannels() : [];
    this.chanSel.innerHTML = chans.map((c) => `<option>${c}</option>`).join("");
    const pick = chans.includes(prev) ? prev : chans.includes("flux") ? "flux" : chans[0];
    if (pick) this.chanSel.value = pick;
    this.render();
  }

  private pickNeighbor(dir: number) {
    if (this.mode !== "eval" || !this.evals.length) return;
    const i = this.evals.findIndex((e) => e.id === this.selectedEval);
    const j = Math.max(0, Math.min(this.evals.length - 1, (i < 0 ? this.evals.length : i) + dir));
    this.onPickEval(this.evals[j].id);
  }

  togglePlay() {
    if (!this.replay) return;
    if (!this.playing && this.t >= this.replay.duration) this.t = 0;
    this.playing = !this.playing;
    this.render();
  }

  step(dir: number, control: boolean) {
    if (!this.replay) return;
    this.playing = false;
    const d = control ? this.replay.ctrlTicks : this.replay.physTicks;
    // Land on the step grid, then move one step.
    const k = Math.round(this.t / d);
    this.seek((k + dir) * d);
  }

  seek(t: number) {
    if (!this.replay) return;
    this.t = Math.max(0, Math.min(this.replay.duration, t));
    this.render();
    this.onSeek();
  }

  // Advance playback by dtWall seconds; true when the time moved.
  advance(dtWall: number): boolean {
    const r = this.replay;
    if (!r || !this.playing) return false;
    const ticks = (dtWall * this.speed) / (r.msg.tick_seconds || 0.01);
    const limit = Math.min(r.duration, r.loadedUntil);
    this.t = Math.min(limit, this.t + ticks);
    if (this.t >= r.duration) this.playing = false;
    this.render();
    return true;
  }

  // -- drawing ----------------------------------------------------------

  render() {
    for (const [m, b] of Object.entries(this.modeBtns)) {
      b.classList.toggle("on", m === this.mode);
      b.setAttribute("aria-selected", String(m === this.mode));
    }
    this.outerRow.style.visibility = this.mode === "eval" ? "visible" : "hidden";
    this.inner.style.display = this.mode === "live" ? "none" : "";
    this.playBtn.textContent = this.playing ? "⏸" : "▶";
    const r = this.replay;
    if (r) {
      const secs = this.t * r.msg.tick_seconds;
      const total = r.duration * r.msg.tick_seconds;
      const ctrl = Math.floor(this.t / r.ctrlTicks + 1e-6);
      const phys = Math.floor(this.t / r.physTicks + 1e-6);
      const ctrlTotal = Math.round(r.duration / r.ctrlTicks);
      const loading = r.chunksDone < r.chunksTotal
        ? ` · loading ${Math.round((100 * r.chunksDone) / r.chunksTotal)}%` : "";
      this.timeEl.textContent =
        `${secs.toFixed(3)} / ${total.toFixed(2)} s · control ${ctrl}/${ctrlTotal} · physics ${phys}${loading}`;
    } else {
      this.timeEl.textContent = this.mode === "live" ? "" : "loading…";
    }
    this.drawPlot();
  }

  private renderOuter() {
    const ev = this.evals;
    if (!ev.length) {
      this.outer.innerHTML = `<span class="empty">no saved evals yet</span>`;
      return;
    }
    const t0 = 0;
    const t1 = Math.max(...ev.map((e) => e.timestep ?? 0), 1);
    this.outer.innerHTML = ev.map((e, i) => {
      const x = ev.length === 1 ? 100 : (100 * ((e.timestep ?? i) - t0)) / (t1 - t0);
      const s = e.summary ?? {};
      let acc = 0;
      const segs: string[] = [];
      const total = OUTCOMES.reduce((a, [k]) => a + (s[k] ?? 0), 0) || 1;
      for (const [k, color] of OUTCOMES) {
        const f = (s[k] ?? 0) / total;
        if (f <= 0) continue;
        segs.push(`<i style="bottom:${(100 * acc).toFixed(1)}%;height:${(100 * f).toFixed(1)}%;background:${color}"></i>`);
        acc += f;
      }
      const tip = [`t=${e.timestep ?? "?"}`, ...OUTCOMES.filter(([k]) => s[k] !== undefined)
        .map(([k]) => `${k} ${(s[k] * 100).toFixed(0)}%`)].join(" · ");
      const sel = e.id === this.selectedEval ? " sel" : "";
      return `<button class="tick${sel}" data-id="${e.id}" style="left:${x.toFixed(2)}%" title="${tip}" aria-label="${tip}">${segs.join("")}</button>`;
    }).join("");
  }

  selectEval(id: string | null) {
    this.selectedEval = id;
    this.renderOuter();
  }

  drawPlot() {
    const c = this.plot;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(c.clientWidth * dpr));
    const h = Math.max(1, Math.floor(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const g = c.getContext("2d")!;
    g.clearRect(0, 0, w, h);
    const r = this.replay;
    if (!r || this.mode === "live") return;
    const X = (t: number) => (t / Math.max(1, r.duration)) * w;
    // Loaded range.
    g.fillStyle = "rgba(255,255,255,0.04)";
    g.fillRect(0, 0, X(r.loadedUntil), h);
    // Channel: every env faint, the focused one bright.
    const name = this.chanSel.value;
    const v = name ? r.channel(name) : null;
    const tt = name ? r.channelTimes(name) : null;
    if (v && tt) {
      const n = v.shape[1];
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < v.data.length; i++) {
        const x = v.data[i];
        if (Number.isFinite(x)) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
      }
      if (!(hi > lo)) { hi = lo + 1; }
      const pad = 4 * dpr;
      const Y = (x: number) => h - pad - ((x - lo) / (hi - lo)) * (h - 2 * pad);
      const line = (e: number, color: string, width: number) => {
        g.strokeStyle = color;
        g.lineWidth = width;
        g.beginPath();
        const end = r.endStep[e] ?? r.duration;
        let started = false;
        for (let k = 0; k < tt.length; k++) {
          if (tt[k] > end) break;
          const x = X(tt[k]), y = Y(v.data[k * n + e]);
          if (!started) { g.moveTo(x, y); started = true; } else g.lineTo(x, y);
        }
        g.stroke();
      };
      for (let e = 0; e < n; e++) if (e !== this.focus) line(e, "rgba(154,160,168,0.35)", dpr);
      if (this.focus >= 0 && this.focus < n) line(this.focus, cssVar(this.root, "--accent") || "#4d8fd6", 2 * dpr);
      g.fillStyle = cssVar(this.root, "--muted") || "#9aa0a8";
      g.font = `${10 * dpr}px system-ui, sans-serif`;
      g.fillText(`${name}  ${fmtNum(hi)}`, 4 * dpr, 11 * dpr);
      g.fillText(fmtNum(lo), 4 * dpr, h - 3 * dpr);
    }
    // Episode ends (per env), then the playhead.
    g.fillStyle = "rgba(224,90,79,0.8)";
    for (const e of r.endStep) if (e < r.duration) g.fillRect(X(e) - dpr / 2, h - 5 * dpr, dpr, 5 * dpr);
    g.fillStyle = "#e4e6ea";
    g.fillRect(X(this.t) - dpr, 0, 2 * dpr, h);
  }
}

function fmtNum(v: number) {
  const a = Math.abs(v);
  return a !== 0 && (a < 1e-3 || a >= 1e4) ? v.toExponential(1) : v.toFixed(a >= 10 ? 1 : 3);
}
