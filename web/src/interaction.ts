// Viewport input of the web client, the native Viewer's (viewer.cpp
// handle_input / handle_click / handle_box / handle_measure_click /
// build_overlays) on a canvas:
//
// Navigation (Blender style):
//   MMB drag orbit | Shift+MMB pan | Ctrl+MMB / wheel zoom | Alt+LMB orbit
//   (Shift / Ctrl + Alt+LMB pan / zoom), Numpad 1/3/7 front/right/top
//   (Ctrl = opposite), 5 persp/ortho, 2/4/6/8 orbit steps, . or F frame
//   the selection, Home frame all (Shift+Home while replaying, where Home
//   seeks to the start).
// Selection:
//   LMB click select, Shift+click add/remove, LMB drag box select (Shift
//   extends), 1/2/3/4 vertex/edge/face/body mode, Alt+Z x-ray select,
//   Alt+A / Esc clear, H hide selected bodies, Alt+H unhide.
// Shading: Shift+Z Solid <-> Wireframe (see-through), Z wire overlay on Solid.
// Tools: M measure (distance -> angle -> off).
// Web only: double-click shows the env under the cursor alone (again, or
// Esc with nothing else to cancel: all envs).
//
// Coordinates: pointer deltas in CSS pixels (as ImGui's), picking and
// projection in device pixels (the canvas's).
import { type Geo, RigidGeo } from "./geometry";
import { type Vec3 } from "./math";
import { type Renderer } from "./renderer";
import {
  type Anchor, boxSelect, elementPosition, type ElementRef, type GeoLookup, type IdPixel, type Measurement,
  MeasureTool, pickedKind, pickElement, PickMode, refineHit, resolveAnchor, segmentBounds, Selection,
} from "./selection";
import { type Label } from "./text";
import { GROUND } from "./renderer";

const SELECT = [1.0, 0.63, 0.2, 1];
const ACTIVE = [1.0, 0.93, 0.75, 1];
const BORDER = [0.05, 0.05, 0.05, 1.5];
const HALO = [0.05, 0.05, 0.06, 0.75];
const MEASURE = [1.0, 0.86, 0.35, 1];

export function formatMeasure(d: number): string {
  const g = (x: number) => String(Number(x.toPrecision(4)));
  if (d >= 1) return `${g(d)} m`;
  if (d >= 0.01) return `${g(d * 100)} cm`;
  return `${g(d * 1000)} mm`;
}

export class Interaction {
  selection = new Selection();
  measurements: Measurement[] = [];
  pending: Measurement = { anchors: [], angle: false };
  measureTool = MeasureTool.Off;
  xraySelect = false;
  // Changes the page reacts to: redraw, selection (for the panel's env
  // focus), isolate an env (double-click), a status message.
  onDirty = () => {};
  onSelection = () => {};
  onIsolate: (env: number) => void = () => {};
  onStatus: (msg: string) => void = () => {};
  onEscape: () => boolean = () => false; // true: the page handled it
  homeTaken: () => boolean = () => false; // true: plain Home belongs to the page
  version = 1; // bumps on any inspector-visible change (tools, measurements, hiding)

  readonly scene: GeoLookup;
  private navDrag = false;
  private lastMove: [number, number] | null = null;
  private lmb: { x: number; y: number; box: boolean } | null = null;
  private boxEl: HTMLElement;
  private sentSelection = 0;

  constructor(private canvas: HTMLCanvasElement, private renderer: Renderer, boxEl: HTMLElement) {
    this.boxEl = boxEl;
    this.scene = { find: (id) => renderer.geoById(id), all: () => renderer.geometries() };
    this.attach();
  }

  private get camera() {
    return this.renderer.camera;
  }

  private dpr() {
    return this.canvas.width / Math.max(this.canvas.clientWidth, 1);
  }

  // CSS offset in the canvas -> device pixels.
  private px(e: { clientX: number; clientY: number }): [number, number] {
    const r = this.canvas.getBoundingClientRect(), d = this.dpr();
    return [(e.clientX - r.left) * d, (e.clientY - r.top) * d];
  }

  private attach() {
    const c = this.canvas;
    c.addEventListener("contextmenu", (e) => e.preventDefault());
    // Middle-button autoscroll / paste would steal the drag.
    c.addEventListener("mousedown", (e) => {
      if (e.button === 1) e.preventDefault();
    });
    c.addEventListener("auxclick", (e) => e.preventDefault());
    c.addEventListener("pointerdown", (e) => this.buttons(e));
    // A second button pressed while another is held arrives as a move.
    c.addEventListener("pointermove", (e) => {
      if (e.button >= 0) this.buttons(e);
      this.move(e);
    });
    c.addEventListener("pointerup", (e) => this.buttons(e));
    c.addEventListener("pointercancel", () => {
      this.navDrag = false;
      this.lmb = null;
      this.boxEl.hidden = true;
    });
    c.addEventListener("wheel", (e) => {
      e.preventDefault();
      const steps = e.deltaMode === 1 ? -e.deltaY / 3 : e.deltaMode === 2 ? -e.deltaY : -e.deltaY / 100;
      this.camera.dolly(steps);
      this.onDirty();
    }, { passive: false });
    c.addEventListener("dblclick", async (e) => {
      if (e.altKey || e.ctrlKey || e.shiftKey || this.measureTool !== MeasureTool.Off) return;
      const [x, y] = this.px(e);
      const [p] = await this.renderer.readIds(Math.floor(x), Math.floor(y), 1, 1);
      const g = this.scene.find(p.object);
      if (g instanceof RigidGeo) this.onIsolate(g.instanceOf(p.segment));
    });
    window.addEventListener("keydown", (e) => this.key(e));
  }

  // A button pressed or released (pointer events report one change at a time).
  private buttons(e: PointerEvent) {
    const bit = [1, 4, 2, 8, 16][e.button] ?? 0;
    if (e.buttons & bit) {
      this.canvas.setPointerCapture(e.pointerId);
      this.lastMove = [e.clientX, e.clientY];
      if (!this.navDrag && (e.button === 1 || (e.altKey && e.button === 0))) {
        this.navDrag = true;
        this.lmb = null;
        this.boxEl.hidden = true;
      } else if (e.button === 0 && !e.ctrlKey && !e.altKey && !this.navDrag) {
        this.lmb = { x: e.clientX, y: e.clientY, box: false };
      }
      return;
    }
    if (!(e.buttons & 4) && !(e.altKey && e.buttons & 1)) this.navDrag = false;
    if (e.button === 0 && this.lmb) {
      const l = this.lmb;
      this.lmb = null;
      this.boxEl.hidden = true;
      const a = this.px({ clientX: l.x, clientY: l.y }), b = this.px(e);
      if (l.box) void this.handleBox(a, b, e.shiftKey);
      else if (this.measureTool !== MeasureTool.Off) void this.handleMeasureClick(b);
      else void this.handleClick(b, e.shiftKey);
    }
  }

  private move(e: PointerEvent) {
    const last = this.lastMove;
    this.lastMove = [e.clientX, e.clientY];
    if (!last) return;
    const dx = e.clientX - last[0], dy = e.clientY - last[1];
    const navButton = (e.buttons & 4) !== 0 || (e.altKey && (e.buttons & 1) !== 0);
    if (this.navDrag && !navButton) this.navDrag = false;
    if (this.navDrag && (dx || dy)) {
      if (e.shiftKey) this.camera.pan(dx, dy, this.canvas.clientHeight);
      else if (e.ctrlKey) this.camera.dolly(-dy * 0.05);
      else this.camera.orbit(dx, dy);
      this.onDirty();
      return;
    }
    const l = this.lmb;
    if (l && (e.buttons & 1)) {
      if (!l.box && this.measureTool === MeasureTool.Off && Math.hypot(e.clientX - l.x, e.clientY - l.y) > 5) l.box = true;
      if (l.box) {
        const r = this.canvas.getBoundingClientRect();
        Object.assign(this.boxEl.style, {
          left: `${Math.min(l.x, e.clientX) - r.left}px`, top: `${Math.min(l.y, e.clientY) - r.top}px`,
          width: `${Math.abs(e.clientX - l.x)}px`, height: `${Math.abs(e.clientY - l.y)}px`,
        });
        this.boxEl.hidden = false;
      }
    }
  }

  // -- selection ----------------------------------------------------------------

  private async idWindow(p: [number, number], radius: number): Promise<IdPixel[]> {
    const n = 2 * radius + 1;
    return this.renderer.readIds(Math.floor(p[0]) - radius, Math.floor(p[1]) - radius, n, n);
  }

  private async handleClick(p: [number, number], extend: boolean) {
    const window = await this.idWindow(p, 6);
    const e = pickElement(this.scene, this.camera, this.selection.mode, window, p, this.renderer.viewport);
    if (e) {
      if (extend) this.selection.toggle(e);
      else this.selection.set(e);
    } else if (!extend) this.selection.clear();
    this.changed();
  }

  private async handleBox(a: [number, number], b: [number, number], extend: boolean) {
    const vp = this.renderer.viewport;
    const lo: [number, number] = [Math.max(Math.min(a[0], b[0]), 0), Math.max(Math.min(a[1], b[1]), 0)];
    const hi: [number, number] = [Math.min(Math.max(a[0], b[0]), vp[0] - 1), Math.min(Math.max(a[1], b[1]), vp[1] - 1)];
    if (hi[0] <= lo[0] || hi[1] <= lo[1]) return;
    // Wireframe shading is see-through, so it always selects through (as Blender's X-ray).
    const xray = this.xraySelect || this.renderer.settings.shading === "wireframe";
    const region = xray ? [] : await this.renderer.readIds(Math.floor(lo[0]), Math.floor(lo[1]),
      Math.floor(hi[0] - lo[0]) + 1, Math.floor(hi[1] - lo[1]) + 1);
    this.selection.add(boxSelect(this.scene, this.camera, this.selection.mode, region, lo, hi, vp, xray), extend);
    this.changed();
  }

  private async handleMeasureClick(p: [number, number]) {
    const vp = this.renderer.viewport;
    const [px] = await this.renderer.readIds(Math.floor(p[0]), Math.floor(p[1]), 1, 1);
    const h = refineHit(this.scene, px, this.camera.ray(p[0], p[1], vp[0], vp[1]), GROUND);
    if (!h.valid) return;
    let a: Anchor = h.surface;
    // Snap to the nearest mesh vertex within 12 px, even if the cursor is on
    // the ground or a neighbouring face.
    const v = pickElement(this.scene, this.camera, PickMode.Vertex, await this.idWindow(p, 8), p, vp);
    const g = v ? this.scene.find(v.object) : undefined;
    if (v && g?.kind === "mesh") {
      const s = this.camera.project(g.vertex(v.index), vp[0], vp[1]);
      if (Math.hypot(s[0] - p[0], s[1] - p[1]) <= 12) a = { kind: "vertex", object: v.object, index: v.index, bary: [0, 0, 0], point: [0, 0, 0] };
    }
    this.pending.angle = this.measureTool === MeasureTool.Angle;
    this.pending.anchors.push(a);
    if (this.pending.anchors.length >= (this.pending.angle ? 3 : 2)) {
      this.measurements.push(this.pending);
      this.pending = { anchors: [], angle: false };
    }
    this.version++;
    this.onDirty();
  }

  // After any selection change: renderer flags, the page, the inspector.
  changed() {
    if (this.selection.version !== this.sentSelection) {
      this.sentSelection = this.selection.version;
      this.renderer.setSelection(this.selection.mode, this.selection.items, this.selection.active);
      this.onSelection();
    }
    this.version++;
    this.onDirty();
  }

  setMode(m: PickMode) {
    this.selection.setMode(m);
    this.changed();
  }

  setMeasureTool(t: MeasureTool) {
    if (t !== this.measureTool) this.pending = { anchors: [], angle: false };
    this.measureTool = t;
    this.version++;
    this.onDirty();
  }

  // The selection = these bodies (Body mode), e.g. an env's from the panel.
  selectSegments(object: number, segments: number[]) {
    this.selection.setMode(PickMode.Body);
    this.selection.add(segments.map((index) => ({ object, index })), false);
    this.changed();
  }

  // Env (display grid cell) of a selected element, or -1.
  envOf(e: ElementRef): number {
    const g = this.scene.find(e.object);
    if (!g) return -1;
    if (g instanceof RigidGeo) {
      const k = pickedKind(g, this.selection.mode);
      const n = k === "vertex" ? g.V : k === "edge" ? g.edges.edges.length / 2 : k === "face" ? g.T : g.B;
      return Math.floor(e.index / n);
    }
    const p = elementPosition(this.scene, this.selection.mode, e);
    return this.renderer.envOf(p[0], p[1]);
  }

  // -- hiding (Body mode) ----------------------------------------------------------

  hiddenCount(): number {
    let n = 0;
    for (const g of this.scene.all()) {
      if (g instanceof RigidGeo) for (const h of g.userHidden) n += h;
      else if (g.kind === "mesh" && "userHidden" in g && g.userHidden) n++;
    }
    return n;
  }

  hideSelected(): number {
    if (this.selection.mode !== PickMode.Body) return 0;
    let n = 0;
    for (const e of this.selection.items) {
      const g = this.scene.find(e.object);
      if (g instanceof RigidGeo && e.index < g.numSegments) g.userHidden[e.index] = 1;
      else if (g?.kind === "mesh" && "userHidden" in g) (g as { userHidden: boolean }).userHidden = true;
      else continue;
      n++;
    }
    this.selection.clear();
    this.renderer.hiddenChanged();
    this.changed();
    return n;
  }

  unhideAll(): number {
    let n = 0;
    for (const g of this.scene.all()) {
      if (g instanceof RigidGeo) {
        for (const h of g.userHidden) n += h;
        g.userHidden.fill(0);
      } else if (g.kind === "mesh" && "userHidden" in g && g.userHidden) {
        (g as { userHidden: boolean }).userHidden = false;
        n++;
      }
    }
    this.renderer.hiddenChanged();
    this.changed();
    return n;
  }

  // -- framing ----------------------------------------------------------------------

  frameAll() {
    const b = this.renderer.bounds();
    if (b) this.camera.frameBounds(b[0], b[1]);
    this.onDirty();
  }

  frameSelection() {
    if (this.selection.empty) return this.frameAll();
    const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
    const add = (p: Vec3) => {
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], p[k]);
        hi[k] = Math.max(hi[k], p[k]);
      }
    };
    for (const e of this.selection.items) {
      add(elementPosition(this.scene, this.selection.mode, e));
      const g = this.scene.find(e.object);
      if (this.selection.mode === PickMode.Body && g?.kind === "mesh") {
        const b = segmentBounds(g, e.index);
        if (b) {
          add(b[0]);
          add(b[1]);
        }
      }
    }
    this.camera.frameBounds(lo, hi);
    this.onDirty();
  }

  // -- keys -------------------------------------------------------------------------

  private key(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    const alt = e.altKey, ctrl = e.ctrlKey, shift = e.shiftKey;
    const cam = this.camera, step = (15 * Math.PI) / 180;
    const s = this.renderer.settings;
    let handled = true;
    switch (e.code) {
      case "Numpad1": cam.setView(ctrl ? "back" : "front"); break;
      case "Numpad3": cam.setView(ctrl ? "left" : "right"); break;
      case "Numpad7": cam.setView(ctrl ? "bottom" : "top"); break;
      case "Numpad5": cam.toggleOrtho(); break;
      case "Numpad4": cam.animateTo(cam.target, cam.distance, cam.yaw + step, cam.pitch); break;
      case "Numpad6": cam.animateTo(cam.target, cam.distance, cam.yaw - step, cam.pitch); break;
      case "Numpad8": cam.animateTo(cam.target, cam.distance, cam.yaw, Math.min(cam.pitch + step, Math.PI / 2)); break;
      case "Numpad2": cam.animateTo(cam.target, cam.distance, cam.yaw, Math.max(cam.pitch - step, -Math.PI / 2)); break;
      case "NumpadDecimal": case "KeyF": if (ctrl || alt) handled = false; else this.frameSelection(); break;
      case "Home": // while replaying, plain Home is the timeline's (seek to the start)
        if (!shift && this.homeTaken()) handled = false;
        else this.frameAll();
        break;
      case "Digit1": case "Digit2": case "Digit3": case "Digit4":
        if (ctrl || alt) handled = false;
        else this.setMode(Number(e.code.slice(5)) - 1);
        break;
      case "KeyZ":
        if (ctrl) handled = false;
        else if (alt) this.xraySelect = !this.xraySelect;
        else if (shift) s.shading = s.shading === "wireframe" ? "solid" : "wireframe";
        else s.wireframe = !s.wireframe;
        break;
      case "KeyM":
        if (ctrl || alt) handled = false;
        else this.setMeasureTool((this.measureTool + 1) % 3);
        break;
      case "KeyA":
        if (alt) {
          this.selection.clear();
          this.changed();
        } else handled = false;
        break;
      case "Escape":
        if (this.pending.anchors.length) this.pending = { anchors: [], angle: false };
        else if (this.measureTool !== MeasureTool.Off) this.measureTool = MeasureTool.Off;
        else if (!this.selection.empty) {
          this.selection.clear();
          this.changed();
        } else if (!this.onEscape()) handled = false;
        break;
      case "KeyH":
        if (ctrl) handled = false;
        else if (alt) {
          const n = this.unhideAll();
          this.onStatus(n ? `Unhid ${n} bodies` : "No hidden bodies");
        } else if (this.selection.mode !== PickMode.Body) {
          this.onStatus("H hides bodies: switch to Body mode (4) first");
        } else {
          const n = this.hideSelected();
          this.onStatus(n ? `Hid ${n} bodies (Alt+H or Unhide all brings them back)` : "Select bodies to hide");
        }
        break;
      default: handled = false;
    }
    if (!handled) return;
    e.preventDefault(); // Alt+letter menus, "/" quick find, Home scrolling
    this.version++;
    this.onDirty();
  }

  // -- overlays (Viewer::build_overlays) --------------------------------------------

  // Advances camera animations and rebuilds the overlays; true while animating.
  update(dt: number): boolean {
    const moving = this.camera.update(dt);
    this.buildOverlays();
    return moving;
  }

  private buildOverlays() {
    const lines: number[] = [];
    const labels: Label[] = [];
    const line = (a: Vec3, b: Vec3, color: number[], w: number, hidden: number, border = [0, 0, 0, 0]) =>
      lines.push(...a, w, ...b, hidden, ...color, ...border);
    const dot = (p: Vec3, color: number[], d: number, hidden: number, border = [0, 0, 0, 1.5]) =>
      lines.push(...p, d, ...p, hidden, ...color, ...border);

    // Selection highlights (faces and bodies are tinted by the shaders).
    const sel = this.selection, mode = sel.mode, active = sel.active;
    const xray = this.renderer.settings.shading === "wireframe";
    for (const e of sel.items) {
      const g = this.scene.find(e.object);
      if (!g) continue;
      const isActive = e === active;
      const col = isActive ? ACTIVE : SELECT;
      const k = pickedKind(g, mode);
      if (g.kind === "mesh") {
        if (k === "vertex" && e.index < g.numVertices) dot(g.vertex(e.index), col, isActive ? 10 : 8, 0.35, BORDER);
        else if (k === "edge" && e.index < g.numEdges) {
          const [a, b] = g.edge(e.index);
          line(g.vertex(a), g.vertex(b), col, 3, 0.35);
        } else if (k === "face" && xray && e.index < g.numFaces) {
          const p = g.face(e.index).map((i) => g.vertex(i));
          for (let c = 0; c < 3; c++) line(p[c], p[(c + 1) % 3], col, this.renderer.settings.wireWidth + 1, 1);
        }
      } else if (k !== "segment") {
        dot(elementPosition(this.scene, mode, e), col, 10, 0.4, BORDER);
      }
    }
    if (active) {
      const g = this.scene.find(active.object);
      if (g) labels.push(this.activeLabel(g, active));
    }

    // Measurements.
    const draw = (m: Measurement, done: boolean) => {
      const p = m.anchors.map((a) => resolveAnchor(this.scene, a));
      for (const q of p) dot(q, [1, 1, 1, 1], 8, 0.5, BORDER);
      if (!done) return;
      const l: Label = {
        text: "", anchor: p[0], color: [1, 0.95, 0.8, 1], align: [0.5, 1], offset: [0, -8], worldHeight: 0,
        sizePx: 14, halo: [0.05, 0.05, 0.06, 0.85], hiddenAlpha: 0.7,
      };
      if (!m.angle) {
        line(p[0], p[1], MEASURE, 2, 0.4);
        l.anchor = [(p[0][0] + p[1][0]) / 2, (p[0][1] + p[1][1]) / 2, (p[0][2] + p[1][2]) / 2];
        l.text = formatMeasure(Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]));
      } else {
        line(p[1], p[0], MEASURE, 2, 0.4);
        line(p[1], p[2], MEASURE, 2, 0.4);
        const u = p[0].map((x, i) => x - p[1][i]), w = p[2].map((x, i) => x - p[1][i]);
        const cos = (u[0] * w[0] + u[1] * w[1] + u[2] * w[2]) / (Math.hypot(...u) * Math.hypot(...w) || 1);
        l.anchor = p[1];
        l.text = `${((Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI).toFixed(2)}°`;
      }
      labels.push(l);
    };
    for (const m of this.measurements) draw(m, true);
    draw(this.pending, false);
    this.renderer.overlay = { lines, labels };
  }

  private activeLabel(g: Geo, e: ElementRef): Label {
    const mode = this.selection.mode, k = pickedKind(g, mode);
    let text: string;
    if (g.kind === "mesh" && k === "segment") text = g.segmentName(e.index);
    else if (k === "segment") text = g.name;
    else if (g.kind === "points") text = `#${e.index}`;
    else text = `${{ vertex: "v", edge: "e", face: "f" }[k as "vertex" | "edge" | "face"]}${e.index}`;
    const anchor = elementPosition(this.scene, mode, e);
    if (mode === PickMode.Body && g.kind === "mesh") {
      const b = segmentBounds(g, e.index);
      if (b) anchor[2] = Math.max(anchor[2], b[1][2]);
    }
    return { text, anchor, sizePx: 13, offset: [10, -22], color: ACTIVE, align: [0, 0], worldHeight: 0, halo: HALO, hiddenAlpha: 0.6 };
  }
}
