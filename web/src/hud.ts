// Viewport overlays drawn with the page, not the renderer: the navigation
// gizmo (ui.cpp nav_gizmo: click an axis ball to align the view, drag to
// orbit, Persp/Ortho and Solid/Wire toggles under it) and the HUD (ui.cpp
// hud: view name, grid spacing, frame rate, measure hint, scale bar).
import { type Interaction } from "./interaction";
import { type Camera, type Vec3, type ViewPreset } from "./math";
import { gridPlane, type Renderer } from "./renderer";
import { MeasureTool } from "./selection";
import { formatLength, niceStep } from "./text";

const R = 46, PAD = 10; // gizmo radius and padding (CSS px), as native
const BALLS: { axis: Vec3; color: string; label: string | null; preset: ViewPreset }[] = [
  { axis: [1, 0, 0], color: "237,74,92", label: "X", preset: "right" },
  { axis: [0, 1, 0], color: "138,210,52", label: "Y", preset: "back" },
  { axis: [0, 0, 1], color: "69,140,243", label: "Z", preset: "top" },
  { axis: [-1, 0, 0], color: "237,74,92", label: null, preset: "left" },
  { axis: [0, -1, 0], color: "138,210,52", label: null, preset: "front" },
  { axis: [0, 0, -1], color: "69,140,243", label: null, preset: "bottom" },
];

export function viewName(cam: Camera): string {
  const eps = 1e-3, pi = Math.PI;
  let name = "";
  if (Math.abs(cam.pitch - 0.5 * pi) < eps) name = "Top";
  else if (Math.abs(cam.pitch + 0.5 * pi) < eps) name = "Bottom";
  else if (Math.abs(cam.pitch) < eps) {
    const y = cam.yaw - 2 * pi * Math.round(cam.yaw / (2 * pi));
    if (Math.abs(y + 0.5 * pi) < eps) name = "Front";
    else if (Math.abs(y - 0.5 * pi) < eps) name = "Back";
    else if (Math.abs(y) < eps) name = "Right";
    else if (Math.abs(Math.abs(y) - pi) < eps) name = "Left";
  }
  return (name || "User") + (cam.ortho ? " Orthographic" : " Perspective");
}

export class Hud {
  private gizmo: HTMLCanvasElement;
  private projBtn: HTMLButtonElement;
  private shadeBtn: HTMLButtonElement;
  private hot = -1;
  private drag: { x: number; y: number; moved: boolean } | null = null;
  private text: HTMLElement;
  private bar: HTMLElement;
  private renders: number[] = []; // times (ms) of the frames rendered in the last second
  private last = "";

  constructor(root: HTMLElement, hudEl: HTMLElement, barEl: HTMLElement, private renderer: Renderer,
    private ix: Interaction, private onChange: () => void) {
    this.text = hudEl;
    this.bar = barEl;
    const d = 2 * (R + PAD);
    this.gizmo = Object.assign(document.createElement("canvas"), { className: "gizmo" });
    this.gizmo.style.width = this.gizmo.style.height = `${d}px`;
    this.gizmo.setAttribute("role", "img");
    this.gizmo.setAttribute("aria-label", "View axes: click an axis to look along it, drag to orbit");
    this.projBtn = Object.assign(document.createElement("button"), { title: "Perspective / orthographic (Numpad 5)" });
    this.shadeBtn = Object.assign(document.createElement("button"), { title: "Shading: Solid / Wireframe (Shift+Z)" });
    this.projBtn.addEventListener("click", () => {
      renderer.camera.toggleOrtho();
      this.changed();
    });
    this.shadeBtn.addEventListener("click", () => {
      const s = renderer.settings;
      s.shading = s.shading === "wireframe" ? "solid" : "wireframe";
      this.changed();
    });
    const btns = document.createElement("div");
    btns.className = "gizmo-btns";
    btns.append(this.projBtn, this.shadeBtn);
    root.append(this.gizmo, btns);
    this.attach();
  }

  private changed() {
    this.ix.version++;
    this.onChange();
  }

  private balls() {
    const cam = this.renderer.camera;
    const r = cam.right(), u = cam.up(), f = cam.forward(), c = R + PAD;
    const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    return BALLS.map((b) => ({ ...b, x: c + dot(b.axis, r) * R * 0.78, y: c - dot(b.axis, u) * R * 0.78, depth: -dot(b.axis, f) }))
      .sort((a, b) => a.depth - b.depth);
  }

  private hit(e: PointerEvent) {
    const rc = this.gizmo.getBoundingClientRect();
    const x = e.clientX - rc.left, y = e.clientY - rc.top;
    let best = 11, hot = -1;
    this.balls().forEach((b, i) => {
      const d = Math.hypot(x - b.x, y - b.y);
      if (d < best) {
        best = d;
        hot = i;
      }
    });
    return hot;
  }

  private attach() {
    const g = this.gizmo;
    g.addEventListener("pointermove", (e) => {
      if (this.drag && e.buttons & 1) {
        const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
        if (this.drag.moved || Math.hypot(dx, dy) > 2) {
          this.drag.moved = true;
          this.renderer.camera.orbit(dx, dy);
          this.drag.x = e.clientX;
          this.drag.y = e.clientY;
          this.changed();
        }
        return;
      }
      const hot = this.hit(e);
      if (hot !== this.hot) {
        this.hot = hot;
        this.draw(true);
      }
    });
    g.addEventListener("pointerleave", () => {
      if (!this.drag) {
        this.hot = -1;
        this.draw(true);
      }
    });
    g.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      g.setPointerCapture(e.pointerId);
      this.drag = { x: e.clientX, y: e.clientY, moved: false };
    });
    g.addEventListener("pointerup", (e) => {
      const d = this.drag;
      this.drag = null;
      if (!d || d.moved || e.button !== 0) return;
      const hot = this.hit(e);
      if (hot >= 0) {
        this.renderer.camera.setView(this.balls()[hot].preset);
        this.changed();
      }
    });
  }

  // A frame was rendered (the page renders only when something changed).
  rendered(now: number) {
    this.renders.push(now);
  }

  // Per animation frame: the gizmo when the view changed, the HUD text.
  update(now: number) {
    while (this.renders.length && this.renders[0] < now - 1000) this.renders.shift();
    const n = this.renders.length;
    const rate = n && now - this.renders[n - 1] < 500 ? `${n} fps` : "idle";
    this.draw(false);
    const cam = this.renderer.camera, s = this.renderer.settings;
    const [, H] = this.renderer.viewport;
    const dpr = window.devicePixelRatio || 1;
    // Finest grid spacing drawn at the view target: shaders/grid.wgsl fades a
    // line family out once its lines are closer than ~7 px.
    const gp = gridPlane(cam);
    const g: Vec3 = [cam.target[0], cam.target[1], cam.target[2]];
    g[gp.normal] = gp.offset;
    const px = cam.pixelSizeAt(g, H); // world per device pixel
    const spacing = Math.pow(10, Math.ceil(Math.log10(px * 7)));
    const hint = this.ix.measureTool === MeasureTool.Distance ? "Measure distance: click two points (snaps to vertices)"
      : this.ix.measureTool === MeasureTool.Angle ? "Measure angle: click three points, the middle is the apex" : "";
    const lines = [viewName(cam) + (s.shading === "wireframe" ? "  ·  Wireframe" : ""),
      `Grid ${formatLength(spacing, spacing)}   ${rate}`];
    const key = lines.join("|") + hint;
    if (key !== this.last) {
      this.last = key;
      this.text.innerHTML = `<div>${lines[0]}</div><div class="muted">${lines[1]}</div>` +
        (hint ? `<div class="hint">${hint}</div>` : "");
    }
    // Scale bar at the target depth (CSS px).
    const cssPx = px * dpr;
    const len = niceStep(cssPx * 110);
    this.bar.style.width = `${len / cssPx}px`;
    this.bar.dataset.label = formatLength(len, len);
    this.projBtn.textContent = cam.ortho ? "Ortho" : "Persp";
    this.shadeBtn.textContent = s.shading === "wireframe" ? "Wire" : "Solid";
  }

  private drawn = "";

  private draw(force: boolean) {
    const cam = this.renderer.camera;
    const key = `${cam.yaw},${cam.pitch},${this.hot}`;
    if (!force && key === this.drawn) return;
    this.drawn = key;
    const dpr = window.devicePixelRatio || 1, d = 2 * (R + PAD);
    const g = this.gizmo;
    if (g.width !== Math.round(d * dpr)) g.width = g.height = Math.round(d * dpr);
    const ctx = g.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, d, d);
    const c = R + PAD;
    if (this.hot >= 0 || this.drag) {
      ctx.fillStyle = "rgba(255,255,255,0.11)";
      ctx.beginPath();
      ctx.arc(c, c, R + PAD * 0.6, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.font = "600 12px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    this.balls().forEach((b, i) => {
      if (b.label) {
        ctx.strokeStyle = `rgb(${b.color})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(c, c);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.fillStyle = `rgb(${b.color})`;
        ctx.beginPath();
        ctx.arc(b.x, b.y, 9, 0, 2 * Math.PI);
        ctx.fill();
        ctx.fillStyle = "rgb(20,20,20)";
        ctx.fillText(b.label, b.x, b.y + 0.5);
      } else {
        ctx.fillStyle = `rgba(${b.color},0.27)`;
        ctx.strokeStyle = `rgb(${b.color})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(b.x, b.y, 7.5, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
      }
      if (i === this.hot) {
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(b.x, b.y, 10.5, 0, 2 * Math.PI);
        ctx.stroke();
      }
    });
  }
}
