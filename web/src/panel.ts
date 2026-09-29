// The side panel: connection state, stream clock, and the stream's channels
// — scalars (batch stats) as a list, per-env arrays as a table.
import { type Arr, isArr } from "./protocol";

const fmt = (v: number) => {
  if (!Number.isFinite(v)) return String(v);
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return v.toExponential(2);
  return v.toFixed(a >= 100 ? 1 : 3);
};

export interface StreamStats {
  status: string;
  name: string;
  time: number | null;
  frames: number;
  dropped: number;
  fps: number;
  lastFrameAt: number;
}

export class Panel {
  private statusEl: HTMLElement;
  private clockEl: HTMLElement;
  private scalarsEl: HTMLElement;
  private tableEl: HTMLElement;
  focus = -1;
  onFocus: (env: number) => void = () => {};

  constructor(root: HTMLElement) {
    root.innerHTML = `
      <div class="head"><span class="dot"></span><span class="status"></span></div>
      <div class="clock"></div>
      <h3>Batch</h3><div class="scalars"></div>
      <h3>Envs</h3><div class="table"></div>`;
    this.statusEl = root.querySelector(".head")!;
    this.clockEl = root.querySelector(".clock")!;
    this.scalarsEl = root.querySelector(".scalars")!;
    this.tableEl = root.querySelector(".table")!;
    this.tableEl.addEventListener("click", (e) => {
      const tr = (e.target as HTMLElement).closest("tr[data-env]") as HTMLElement | null;
      if (!tr) return;
      const env = Number(tr.dataset.env);
      this.focus = this.focus === env ? -1 : env;
      this.onFocus(this.focus);
    });
  }

  setStatus(s: StreamStats) {
    const live = s.status === "live";
    this.statusEl.className = `head ${live ? "ok" : s.status === "connecting" ? "wait" : "bad"}`;
    this.statusEl.querySelector(".status")!.textContent =
      `${s.name || "avbd-viz"} — ${s.status}`;
    const age = s.lastFrameAt ? (performance.now() - s.lastFrameAt) / 1000 : NaN;
    this.clockEl.textContent =
      `step ${s.time ?? "–"} · ${s.frames} frames (${s.dropped} dropped) · ` +
      `${s.fps.toFixed(1)} fps · last ${Number.isFinite(age) ? age.toFixed(1) + " s" : "–"} ago`;
  }

  setChannels(channels: Record<string, number | Arr>, numEnvs: number) {
    const scalars: [string, number][] = [];
    const perEnv: [string, Arr][] = [];
    for (const [k, v] of Object.entries(channels)) {
      if (typeof v === "number") scalars.push([k, v]);
      else if (isArr(v) && v.shape.length === 1 && v.shape[0] === numEnvs) perEnv.push([k, v]);
    }
    this.scalarsEl.innerHTML = scalars.length
      ? `<table>${scalars.map(([k, v]) => `<tr><td>${k}</td><td class="num">${fmt(v)}</td></tr>`).join("")}</table>`
      : `<div class="empty">none</div>`;
    if (!perEnv.length) {
      this.tableEl.innerHTML = `<div class="empty">none</div>`;
      return;
    }
    const head = `<tr><th>env</th>${perEnv.map(([k]) => `<th>${k}</th>`).join("")}</tr>`;
    const rows: string[] = [];
    for (let e = 0; e < numEnvs; e++) {
      const cls = e === this.focus ? ` class="focus"` : "";
      rows.push(`<tr data-env="${e}"${cls}><td>${e}</td>${perEnv
        .map(([, a]) => `<td class="num">${fmt(a.data[e])}</td>`).join("")}</tr>`);
    }
    this.tableEl.innerHTML = `<table>${head}${rows.join("")}</table>`;
  }
}
