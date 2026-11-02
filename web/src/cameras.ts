// The camera panel: a scene's Images (scene_api.py), what e.g. a vision policy
// sees, next to the 3D view. One JPEG sheet per step (a row per instance, a
// column per view, rillfacet/web/images.py) is cut into tiles on a canvas:
// every shown env, or the focused env's views alone, large. Pixels stay
// square: these are the images themselves, not a smoothed picture of them.
import { type SceneObject } from "./renderer";

export interface ImagesInfo { name: string; instances: number; views: string[]; height: number; width: number }

export function imagesInfo(objects: SceneObject[]): ImagesInfo | null {
  const o = objects.find((x) => x.kind === "images");
  return o ? { name: o.name, ...o.attrs } : null;
}

const GAP = 2; // canvas pixels between envs

export class CameraPanel {
  private head: HTMLElement;
  private canvas: HTMLCanvasElement;
  private note: HTMLElement;
  private info: ImagesInfo | null = null;
  private sheet: ImageBitmap | null = null;
  private rate = 0;
  private lastAt = 0;
  focus = -1;
  envNames?: number[];
  onPick: (env: number) => void = () => {};
  sheets = 0; // sheets shown (automated checks)

  constructor(private root: HTMLElement) {
    root.innerHTML = `<div class="cam-head"></div><canvas class="cam-view"></canvas><div class="empty cam-note"></div>`;
    this.head = root.querySelector(".cam-head")!;
    this.canvas = root.querySelector("canvas")!;
    this.note = root.querySelector(".cam-note")!;
    this.canvas.addEventListener("click", (e) => this.click(e));
  }

  set visible(on: boolean) {
    this.root.hidden = !on;
  }

  setInfo(info: ImagesInfo | null) {
    this.info = info;
    this.clear();
  }

  clear() {
    this.sheet?.close();
    this.sheet = null;
    this.rate = 0;
    this.lastAt = 0;
    this.draw();
  }

  // A decoded sheet; `bytes` is what it cost on the wire (0: already here).
  show(sheet: ImageBitmap, bytes = 0) {
    this.sheet?.close();
    this.sheet = sheet;
    this.sheets++;
    if (bytes) {
      const now = performance.now();
      if (this.lastAt) this.rate = 0.8 * this.rate + 0.2 * (bytes / Math.max(1, now - this.lastAt)) * 1000;
      this.lastAt = now;
    }
    this.draw();
  }

  // Tiles per env: views in a square, envs in a square.
  private layout() {
    const i = this.info!;
    const V = i.views.length;
    const vc = Math.ceil(Math.sqrt(V)), vr = Math.ceil(V / vc);
    const envs = this.focus >= 0 && this.focus < i.instances
      ? [this.focus] : Array.from({ length: i.instances }, (_, e) => e);
    const ec = Math.ceil(Math.sqrt(envs.length)), er = Math.ceil(envs.length / ec);
    const bw = vc * i.width, bh = vr * i.height;
    return { V, vc, vr, envs, ec, er, bw, bh, W: ec * bw + (ec - 1) * GAP, H: er * bh + (er - 1) * GAP };
  }

  draw() {
    const i = this.info;
    const c = this.canvas;
    if (!i || !this.sheet) {
      c.style.display = "none";
      this.head.textContent = "Cameras";
      this.note.textContent = !i ? "no camera images in this record" : "waiting for images…";
      this.note.style.display = "";
      return;
    }
    const l = this.layout();
    if (c.width !== l.W || c.height !== l.H) {
      c.width = l.W;
      c.height = l.H;
    }
    const g = c.getContext("2d")!;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, l.W, l.H);
    l.envs.forEach((e, k) => {
      const x0 = (k % l.ec) * (l.bw + GAP), y0 = Math.floor(k / l.ec) * (l.bh + GAP);
      for (let v = 0; v < l.V; v++)
        g.drawImage(this.sheet!, v * i.width, e * i.height, i.width, i.height,
          x0 + (v % l.vc) * i.width, y0 + Math.floor(v / l.vc) * i.height, i.width, i.height);
    });
    c.style.display = "";
    this.note.style.display = "none";
    const who = l.envs.length === 1 ? `env ${this.envNames?.[l.envs[0]] ?? l.envs[0]} · ${i.views.join(" ")}`
      : `${i.instances} envs × ${l.V} views · click an env`;
    const net = this.rate ? ` · ${(this.rate / 1e6).toFixed(2)} MB/s` : "";
    this.head.textContent = `Cameras · ${who} · ${i.width}×${i.height}${net}`;
  }

  private click(e: MouseEvent) {
    if (!this.info || !this.sheet) return;
    const l = this.layout();
    if (l.envs.length === 1) {
      this.onPick(-1);
      return;
    }
    const r = this.canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * l.W, y = ((e.clientY - r.top) / r.height) * l.H;
    const k = Math.floor(x / (l.bw + GAP)) + l.ec * Math.floor(y / (l.bh + GAP));
    if (k < l.envs.length) this.onPick(l.envs[k]);
  }
}
