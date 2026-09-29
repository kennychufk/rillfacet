// The right panel: the focused env (its outcome and channels, each with a
// sparkline), the batch numbers (sparklines of their recent history when
// live), and a table of every shown env (click a row to focus it).
import { type Arr, isArr } from "./protocol";
import { OUTCOMES } from "./replay";

const OUTCOME_COLOR: Record<string, string> = Object.fromEntries(OUTCOMES);

export const fmt = (v: number) => {
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

// A series to draw as a sparkline, and where "now" is on it (null: the end).
export interface Series { data: ArrayLike<number>; cursor: number | null }

// Where sparklines come from: a live history, or a replay's tracks.
export interface SeriesSource {
  scalar(name: string): Series | null;
  perEnv(name: string, env: number): Series | null;
}

export interface PanelData {
  channels: Record<string, number | Arr>;
  numEnvs: number;
  envNames?: number[]; // task env index per shown env
  outcomes?: string[]; // replay: each env's outcome...
  ended?: boolean[]; // ...shown once it ended
  series?: SeriesSource;
}

// Rows of name / value / sparkline, rebuilt only when the names change.
class SparkList {
  private names = "";
  private rows: { value: HTMLElement; canvas: HTMLCanvasElement }[] = [];

  constructor(private root: HTMLElement) {}

  update(items: [string, number, Series | null][], empty = "none") {
    const names = items.map(([k]) => k).join("\n") + "\n" + empty;
    if (names !== this.names) {
      this.names = names;
      this.root.innerHTML = items.length
        ? items.map(([k]) => `<div class="spark-row"><span class="k" title="${k}">${k}</span>` +
          `<span class="v num"></span><canvas class="spark"></canvas></div>`).join("")
        : `<div class="empty">${empty}</div>`;
      this.rows = [...this.root.querySelectorAll(".spark-row")].map((r) => ({
        value: r.querySelector(".v") as HTMLElement, canvas: r.querySelector("canvas") as HTMLCanvasElement,
      }));
    }
    items.forEach(([, v, s], i) => {
      const row = this.rows[i];
      row.value.textContent = fmt(v);
      drawSpark(row.canvas, s);
    });
  }
}

function drawSpark(c: HTMLCanvasElement, s: Series | null) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(c.clientWidth * dpr)), h = Math.max(1, Math.round(c.clientHeight * dpr));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, w, h);
  if (!s || s.data.length < 2) return;
  const d = s.data;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < d.length; i++) if (Number.isFinite(d[i])) { lo = Math.min(lo, d[i]); hi = Math.max(hi, d[i]); }
  if (!Number.isFinite(lo)) return;
  if (hi - lo < 1e-12) { hi += 0.5; lo -= 0.5; }
  const X = (i: number) => (i / (d.length - 1)) * (w - 2) + 1;
  const Y = (v: number) => h - 2 - ((v - lo) / (hi - lo)) * (h - 4);
  g.strokeStyle = "#8fb7e3";
  g.lineWidth = dpr;
  g.beginPath();
  for (let i = 0; i < d.length; i++) (i ? g.lineTo : g.moveTo).call(g, X(i), Y(d[i]));
  g.stroke();
  const k = s.cursor ?? d.length - 1;
  g.fillStyle = "#e4e6ea";
  g.beginPath();
  g.arc(X(k), Y(d[Math.max(0, Math.min(d.length - 1, k))]), 1.8 * dpr, 0, 2 * Math.PI);
  g.fill();
}

export class Panel {
  private focusHead: HTMLElement;
  private focusList: SparkList;
  private batchList: SparkList;
  private tableEl: HTMLElement;
  focus = -1;
  onFocus: (env: number) => void = () => {};

  constructor(root: HTMLElement) {
    root.innerHTML = `
      <section class="focus-sec"><h3 class="focus-head"></h3><div class="focus-list"></div></section>
      <section><h3>Batch</h3><div class="batch-list"></div></section>
      <section><h3>Envs</h3><div class="table"></div></section>`;
    this.focusHead = root.querySelector(".focus-head")!;
    this.focusList = new SparkList(root.querySelector(".focus-list")!);
    this.batchList = new SparkList(root.querySelector(".batch-list")!);
    this.tableEl = root.querySelector(".table")!;
    this.tableEl.addEventListener("click", (e) => {
      const tr = (e.target as HTMLElement).closest("tr[data-env]") as HTMLElement | null;
      if (!tr) return;
      const env = Number(tr.dataset.env);
      this.onFocus(this.focus === env ? -1 : env);
    });
  }

  update(p: PanelData) {
    const scalars: [string, number][] = [];
    const perEnv: [string, Arr][] = [];
    for (const [k, v] of Object.entries(p.channels)) {
      if (typeof v === "number") scalars.push([k, v]);
      else if (isArr(v) && v.shape.length === 1 && v.shape[0] === p.numEnvs) perEnv.push([k, v]);
    }
    const name = (e: number) => String(p.envNames?.[e] ?? e);
    const outcome = (e: number) => (p.outcomes && p.ended?.[e] ? p.outcomes[e] : "");

    // Focused env.
    const f = this.focus;
    if (f >= 0 && f < p.numEnvs) {
      const o = outcome(f);
      this.focusHead.innerHTML = `Env ${name(f)}` +
        (o ? ` <span class="oc" style="color:${OUTCOME_COLOR[o] ?? "inherit"}">${o}</span>` : "");
      this.focusList.update(perEnv.map(([k, a]) => [k, a.data[f], p.series?.perEnv(k, f) ?? null]));
    } else {
      this.focusHead.textContent = "Focus";
      this.focusList.update([], "click an env (or a row below) to focus it; double-click to show it alone");
    }
    this.batchList.update(scalars.map(([k, v]) => [k, v, p.series?.scalar(k) ?? null]));

    // Every env. The table is rebuilt only when its layout changes; each
    // update rewrites cell contents in place, so a row being clicked is
    // still the same element when the button comes up (a rebuild between
    // press and release loses the click).
    if (!perEnv.length) {
      if (this.tableKey !== "") {
        this.tableKey = "";
        this.tableEl.innerHTML = `<div class="empty">none</div>`;
      }
      return;
    }
    const cols = perEnv.map(([k]) => k);
    const key = [p.numEnvs, p.outcomes ? 1 : 0, ...cols].join("\n");
    if (key !== this.tableKey) {
      this.tableKey = key;
      const oc = p.outcomes ? `<th>outcome</th>` : "";
      const head = `<tr><th>env</th>${oc}${cols.map((k) => `<th>${k}</th>`).join("")}</tr>`;
      const cells = `<td></td>${p.outcomes ? `<td class="oc"></td>` : ""}${cols.map(() => `<td class="num"></td>`).join("")}`;
      const rows = Array.from({ length: p.numEnvs }, (_, e) => `<tr data-env="${e}">${cells}</tr>`);
      this.tableEl.innerHTML = `<table>${head}${rows.join("")}</table>`;
      this.rowEls = [...this.tableEl.querySelectorAll<HTMLTableRowElement>("tr[data-env]")];
    }
    const setText = (el: Element, t: string) => {
      if (el.textContent !== t) el.textContent = t;
    };
    this.rowEls.forEach((tr, e) => {
      tr.classList.toggle("focus", e === f);
      const td = tr.children;
      let c = 0;
      setText(td[c++], name(e));
      if (p.outcomes) {
        const o = outcome(e);
        const cell = td[c++] as HTMLElement;
        setText(cell, o || "\u2026");
        cell.style.color = OUTCOME_COLOR[o] ?? "";
      }
      for (const [, a] of perEnv) setText(td[c++], fmt(a.data[e]));
    });
  }

  private tableKey = "";
  private rowEls: HTMLTableRowElement[] = [];
}

// Recent values of every live channel, for the sparklines.
export class LiveHistory implements SeriesSource {
  private scalars = new Map<string, number[]>();
  private envs = new Map<string, number[][]>();

  constructor(private length = 240) {}

  clear() {
    this.scalars.clear();
    this.envs.clear();
  }

  push(channels: Record<string, number | Arr>, numEnvs: number) {
    const add = (arr: number[], v: number) => {
      arr.push(v);
      if (arr.length > this.length) arr.shift();
    };
    for (const [k, v] of Object.entries(channels)) {
      if (typeof v === "number") {
        if (!this.scalars.has(k)) this.scalars.set(k, []);
        add(this.scalars.get(k)!, v);
      } else if (isArr(v) && v.shape.length === 1 && v.shape[0] === numEnvs) {
        let per = this.envs.get(k);
        if (!per || per.length !== numEnvs) this.envs.set(k, (per = Array.from({ length: numEnvs }, () => [])));
        for (let e = 0; e < numEnvs; e++) add(per[e], v.data[e]);
      }
    }
  }

  scalar(name: string): Series | null {
    const d = this.scalars.get(name);
    return d ? { data: d, cursor: null } : null;
  }

  perEnv(name: string, env: number): Series | null {
    const d = this.envs.get(name)?.[env];
    return d ? { data: d, cursor: null } : null;
  }
}
