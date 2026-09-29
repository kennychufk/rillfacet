// The Inspect panel, the web counterpart of the native viewer's Inspect
// window (ui.cpp inspector_panel): pick mode, x-ray select, hiding bodies,
// the measure tool, a property table of the selection and the measurement
// list. The controls are built once; the table and list update in place,
// so a click is never lost to a rebuild between press and release.
import { type Interaction } from "./interaction";
import { type Vec3 } from "./math";
import {
  anchorLabel, elementPosition, measurementValue, PICK_MODE_NAMES, pickedKind, PickMode,
  segmentBounds,
} from "./selection";
import { formatG } from "./text";

const fmt3 = (v: Vec3) => v.map((x) => formatG(x, 4)).join(", ");
const g6 = (v: number) => formatG(v, 6);

type Row = [string, string] | [string]; // name + value, or a section title

export class Inspector {
  private modeBtns: HTMLButtonElement[] = [];
  private xray: HTMLInputElement;
  private hideRow: HTMLElement;
  private hideBtn: HTMLButtonElement;
  private unhideBtn: HTMLButtonElement;
  private tools: HTMLInputElement[] = [];
  private table: HTMLElement;
  private actions: HTMLElement;
  private list: HTMLElement;
  private rowsKey = "";
  private listKey = "";
  private copyText = "";
  private shown = -1;

  constructor(root: HTMLElement, private ix: Interaction) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const el = <T extends HTMLElement = HTMLElement>(tag: string, props: Record<string, any> = {},
      ...kids: (Node | string)[]): T => {
      const e = Object.assign(document.createElement(tag), props) as T;
      e.append(...kids);
      return e;
    };
    const modes = el("div", { className: "i-modes" });
    modes.setAttribute("role", "group");
    modes.setAttribute("aria-label", "Pick mode");
    PICK_MODE_NAMES.forEach((name, m) => {
      const b = el<HTMLButtonElement>("button", { textContent: name, title: `${name} mode (${m + 1})` });
      b.addEventListener("click", () => ix.setMode(m));
      this.modeBtns.push(b);
      modes.append(b);
    });
    this.xray = el<HTMLInputElement>("input", { type: "checkbox" });
    this.xray.addEventListener("change", () => {
      ix.xraySelect = this.xray.checked;
      ix.version++;
    });
    this.hideBtn = el<HTMLButtonElement>("button", { textContent: "Hide selected (H)" });
    this.hideBtn.addEventListener("click", () => ix.hideSelected());
    this.unhideBtn = el<HTMLButtonElement>("button", { textContent: "Unhide all (Alt+H)" });
    this.unhideBtn.addEventListener("click", () => ix.unhideAll());
    this.hideRow = el("div", { className: "i-row" }, this.hideBtn, this.unhideBtn);
    const tools = el("div", { className: "i-row" }, "Measure (M)");
    tools.setAttribute("role", "radiogroup");
    ["Off", "Distance", "Angle"].forEach((name, t) => {
      const r = el<HTMLInputElement>("input", { type: "radio", name: "i-measure" });
      r.addEventListener("change", () => ix.setMeasureTool(t));
      this.tools.push(r);
      tools.append(el("label", {}, r, name));
    });
    this.table = el("div", { className: "i-table" });
    const copy = el<HTMLButtonElement>("button", { textContent: "Copy" });
    copy.addEventListener("click", () => void navigator.clipboard?.writeText(this.copyText));
    const clear = el<HTMLButtonElement>("button", { textContent: "Clear selection" });
    clear.addEventListener("click", () => {
      ix.selection.clear();
      ix.changed();
    });
    this.actions = el("div", { className: "i-row" }, copy, clear);
    this.list = el("div", { className: "i-list" });
    // Measurement removal: delegated, the list's rows update in place.
    this.list.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest("button");
      if (!b) return;
      if (b.dataset.remove) ix.measurements.splice(Number(b.dataset.remove), 1);
      else ix.measurements.length = 0;
      ix.version++;
      ix.onDirty();
    });
    root.append(modes,
      el("label", { className: "d-check" }, this.xray, "X-ray select (Alt+Z)"), this.hideRow, tools,
      el("hr"), this.table, this.actions, this.list);
  }

  // Called every frame; refreshes the controls when something changed and
  // the values a few times a second (the geometry moves).
  update(now: number) {
    const ix = this.ix;
    if (this.shown === ix.version && now - this.lastValues < 200) return;
    this.lastValues = now;
    this.shown = ix.version;
    const sel = ix.selection, mode = sel.mode;
    this.modeBtns.forEach((b, m) => {
      b.classList.toggle("on", m === mode);
      b.setAttribute("aria-pressed", String(m === mode));
    });
    this.xray.checked = ix.xraySelect;
    const hidden = ix.hiddenCount();
    this.hideRow.hidden = !(mode === PickMode.Body || hidden);
    this.hideBtn.disabled = mode !== PickMode.Body || sel.empty;
    this.unhideBtn.disabled = hidden === 0;
    this.unhideBtn.textContent = `Unhide all (Alt+H)${hidden ? `  [${hidden}]` : ""}`;
    this.tools.forEach((r, t) => (r.checked = t === ix.measureTool));
    this.setRows(this.rows());
    this.actions.hidden = sel.empty;
    this.setList();
  }

  private lastValues = 0;

  private rows(): Row[] {
    const ix = this.ix, sel = ix.selection, mode = sel.mode, scene = ix.scene;
    const items = sel.items;
    if (!items.length) return [];
    if (items.length > 1) {
      const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity], sum: Vec3 = [0, 0, 0];
      for (const e of items) {
        const p = elementPosition(scene, mode, e);
        for (let k = 0; k < 3; k++) {
          lo[k] = Math.min(lo[k], p[k]);
          hi[k] = Math.max(hi[k], p[k]);
          sum[k] += p[k];
        }
      }
      return [["Selected", `${items.length} ${PICK_MODE_NAMES[mode]}`],
        ["Centroid", fmt3(sum.map((x) => x / items.length) as Vec3)],
        ["Extent", fmt3([hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]])]];
    }
    const e = items[0], g = scene.find(e.object);
    const out: Row[] = [["Object", g?.name ?? "?"]];
    if (!g) return out;
    if (g.kind === "points") {
      if (pickedKind(g, mode) === "segment") {
        out.push(["Points", String(g.count)]);
        const b = [0, 1, 2].map((k) => {
          let lo = Infinity, hi = -Infinity;
          for (let i = 0; i < g.count; i++) {
            lo = Math.min(lo, g.point(i)[k] - g.radius(i));
            hi = Math.max(hi, g.point(i)[k] + g.radius(i));
          }
          return [lo, hi];
        });
        if (g.count) {
          out.push(["Size", fmt3(b.map(([l, h]) => h - l) as Vec3)]);
          out.push(["Bounds center", fmt3(b.map(([l, h]) => (l + h) / 2) as Vec3)]);
        }
      } else if (e.index < g.count) {
        out.push(["Point", String(e.index)], ["Position", fmt3(g.point(e.index))], ["Radius", formatG(g.radius(e.index), 4)]);
      }
      return out;
    }
    // A mesh element with its owning body (ui.cpp mesh_rows).
    let seg = 0;
    const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const unit = (v: Vec3): Vec3 => {
      const l = Math.hypot(...v) || 1;
      return [v[0] / l, v[1] / l, v[2] / l];
    };
    switch (mode) {
      case PickMode.Vertex:
        out.push(["Vertex", String(e.index)], ["Position", fmt3(g.vertex(e.index))]);
        seg = g.segmentOfVertex(e.index);
        break;
      case PickMode.Edge: {
        const [a, b] = g.edge(e.index);
        const pa = g.vertex(a), pb = g.vertex(b), d = sub(pb, pa);
        out.push(["Edge", String(e.index)], ["Vertices", `${a}, ${b}`], ["Length", g6(Math.hypot(...d))],
          ["Direction", fmt3(unit(d))], ["Midpoint", fmt3([(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2])]);
        seg = g.segmentOfVertex(a);
        break;
      }
      case PickMode.Face: {
        const f = g.face(e.index);
        const [p0, p1, p2] = f.map((i) => g.vertex(i));
        const u = sub(p1, p0), w = sub(p2, p0);
        const n: Vec3 = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
        out.push(["Face", String(e.index)], ["Vertices", f.join(", ")], ["Area", g6(0.5 * Math.hypot(...n))],
          ["Normal", fmt3(unit(n))], ["Centroid", fmt3([0, 1, 2].map((k) => (p0[k] + p1[k] + p2[k]) / 3) as Vec3)]);
        seg = g.segmentOfFace(e.index);
        break;
      }
      default: seg = e.index;
    }
    out.push([g.segmentName(seg)]);
    const b = segmentBounds(g, seg);
    if (mode === PickMode.Body) {
      const [f0, f1] = g.segmentFaces(seg);
      const verts = new Set<number>();
      for (let f = f0; f < f1; f++) for (const v of g.face(f)) verts.add(v);
      out.push(["Faces", String(f1 - f0)], ["Vertices", String(verts.size)]);
      if (b) out.push(["Size", fmt3(sub(b[1], b[0]))]);
    }
    if (b) out.push(["Bounds center", fmt3([0, 1, 2].map((k) => (b[0][k] + b[1][k]) / 2) as Vec3)]);
    return out;
  }

  private setRows(rows: Row[]) {
    this.copyText = rows.map((r) => (r.length === 1 ? `[${r[0]}]` : `${r[0]}\t${r[1]}`)).join("\n") + "\n";
    const key = rows.map((r) => r[0]).join("\n");
    if (!rows.length) {
      if (this.rowsKey !== "") {
        this.rowsKey = "";
        this.table.innerHTML = "";
      }
      if (!this.table.firstChild)
        this.table.innerHTML = `<div class="empty">Click to select, Shift+click to add,<br>drag to box-select. Keys 1-4 switch mode.</div>`;
      return;
    }
    if (key !== this.rowsKey) {
      this.rowsKey = key;
      const t = document.createElement("table");
      for (const r of rows) {
        const tr = t.insertRow();
        if (r.length === 1) {
          tr.className = "i-section";
          const td = tr.insertCell();
          td.colSpan = 2;
          td.textContent = r[0];
        } else {
          tr.insertCell().textContent = r[0];
          tr.insertCell().className = "mono";
        }
      }
      this.table.replaceChildren(t);
    }
    const cells = this.table.querySelectorAll("td.mono");
    let i = 0;
    for (const r of rows) if (r.length === 2) cells[i++].textContent = r[1];
  }

  private setList() {
    const ix = this.ix, ms = ix.measurements;
    const key = ms.map((m) => (m.angle ? "a" : "d")).join("");
    if (key !== this.listKey) {
      this.listKey = key;
      this.list.innerHTML = ms.length
        ? `<h3>Measurements</h3>` + ms.map((_, i) =>
          `<div class="i-meas"><button data-remove="${i}" aria-label="Remove measurement ${i + 1}">x</button>` +
          `<span class="mono"></span></div>`).join("") + `<button class="i-clear">Clear all</button>`
        : "";
    }
    const spans = this.list.querySelectorAll(".i-meas");
    ms.forEach((m, i) => {
      const { value, delta } = measurementValue(ix.scene, m);
      const s = spans[i]?.querySelector("span");
      if (!s) return;
      s.textContent = m.angle ? `${i + 1}  ${value.toFixed(3)} deg`
        : `${i + 1}  ${formatG(value, 5)} m   d=(${delta.map((x) => formatG(x, 3)).join(", ")})`;
      s.parentElement!.title = m.anchors.map((a) => anchorLabel(ix.scene, a)).join(" → ");
    });
  }
}
