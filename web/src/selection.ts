// Selection (vertex / edge / face / body) and measurements, a port of the
// native src/avbd_viz/selection.cpp for the web's structures (meshes and
// point clouds, see geometry.ts).
//
// Picking reads the prepass id buffer (object id, face, segment per pixel),
// so what you click is exactly what you see; the exact hit point is then
// refined on the CPU by intersecting the view ray with that triangle.
import { type Geo, type MeshGeo } from "./geometry";
import { type Camera, cross, dot, type Ray, sub, type Vec3 } from "./math";

export enum PickMode { Vertex, Edge, Face, Body }
export const PICK_MODE_NAMES = ["Vertex", "Edge", "Face", "Body"];

export const GROUND_ID = 0xffffffff;

// One pixel of the id buffer.
export interface IdPixel { object: number; element: number; segment: number; flags: number }
export const EMPTY_PIXEL: IdPixel = { object: 0, element: 0, segment: 0, flags: 0 };

// A selected index: vertex / edge / face / segment of a mesh, point (or 0 =
// the whole cloud in Body mode) of a point cloud.
export interface ElementRef { object: number; index: number }

export type ElementKind = "vertex" | "edge" | "face" | "segment";

export interface GeoLookup {
  find(id: number): Geo | undefined;
  all(): Geo[];
}

export class Selection {
  private _mode = PickMode.Face;
  private _items: ElementRef[] = [];
  private lookup = new Set<string>();
  version = 1;

  get mode() { return this._mode; }
  get items(): readonly ElementRef[] { return this._items; }
  get active(): ElementRef | null { return this._items.length ? this._items[this._items.length - 1] : null; }
  get empty() { return this._items.length === 0; }

  setMode(m: PickMode) {
    if (m === this._mode) return;
    this._mode = m;
    this.clear();
    this.version++;
  }

  contains(e: ElementRef) { return this.lookup.has(key(e)); }

  clear() {
    if (!this._items.length) return;
    this._items = [];
    this.lookup.clear();
    this.version++;
  }

  set(e: ElementRef) {
    this._items = [e];
    this.lookup = new Set([key(e)]);
    this.version++;
  }

  toggle(e: ElementRef) {
    const k = key(e);
    if (this.lookup.delete(k)) this._items = this._items.filter((x) => key(x) !== k);
    else {
      this._items.push(e);
      this.lookup.add(k);
    }
    this.version++;
  }

  add(es: ElementRef[], extend: boolean) {
    if (!extend) {
      this._items = [];
      this.lookup.clear();
    }
    for (const e of es) {
      const k = key(e);
      if (!this.lookup.has(k)) {
        this.lookup.add(k);
        this._items.push(e);
      }
    }
    this.version++;
  }
}

const key = (e: ElementRef) => `${e.object}:${e.index}`;

// Element kind a pick mode selects on a structure.
export function pickedKind(g: Geo, mode: PickMode): ElementKind {
  if (g.kind === "mesh") return (["vertex", "edge", "face", "segment"] as const)[mode];
  return mode === PickMode.Body ? "segment" : "vertex";
}

// ---- positions and anchors ----------------------------------------------------

const add3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale3 = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];

export function segmentBounds(m: MeshGeo, s: number): [Vec3, Vec3] | null {
  const [f0, f1] = m.segmentFaces(s);
  const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let f = f0; f < f1; f++)
    for (const v of m.face(f)) {
      const p = m.vertex(v);
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], p[k]);
        hi[k] = Math.max(hi[k], p[k]);
      }
    }
  return f1 > f0 ? [lo, hi] : null;
}

function pointsBounds(g: Geo & { kind: "points" }): [Vec3, Vec3] | null {
  const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < g.count; i++) {
    if (!g.visible(i)) continue;
    const p = g.point(i), r = g.radius(i);
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], p[k] - r);
      hi[k] = Math.max(hi[k], p[k] + r);
    }
  }
  return Number.isFinite(lo[0]) ? [lo, hi] : null;
}

const center = (b: [Vec3, Vec3] | null): Vec3 =>
  b ? [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2, (b[0][2] + b[1][2]) / 2] : [0, 0, 0];

// World-space representative position of a selected element.
export function elementPosition(scene: GeoLookup, mode: PickMode, e: ElementRef): Vec3 {
  const g = scene.find(e.object);
  if (!g) return [0, 0, 0];
  const k = pickedKind(g, mode);
  if (g.kind === "points") return k === "segment" || e.index >= g.count ? center(pointsBounds(g)) : g.point(e.index);
  switch (k) {
    case "vertex": return e.index < g.numVertices ? g.vertex(e.index) : [0, 0, 0];
    case "edge": {
      if (e.index >= g.numEdges) return [0, 0, 0];
      const [a, b] = g.edge(e.index);
      return scale3(add3(g.vertex(a), g.vertex(b)), 0.5);
    }
    case "face": {
      if (e.index >= g.numFaces) return [0, 0, 0];
      const [a, b, c] = g.face(e.index);
      return scale3(add3(add3(g.vertex(a), g.vertex(b)), g.vertex(c)), 1 / 3);
    }
    default: return e.index < g.numSegments ? center(segmentBounds(g, e.index)) : [0, 0, 0];
  }
}

// A point that follows moving geometry.
export interface Anchor {
  kind: "vertex" | "surface" | "ground" | "point" | "fixed";
  object: number;
  index: number; // vertex, face or point
  bary: Vec3; // surface: barycentric coordinates in the face
  point: Vec3; // ground / fixed: world position
}

export function resolveAnchor(scene: GeoLookup, a: Anchor): Vec3 {
  const g = scene.find(a.object);
  if (a.kind === "vertex" && g?.kind === "mesh" && a.index < g.numVertices) return g.vertex(a.index);
  if (a.kind === "surface" && g?.kind === "mesh" && a.index < g.numFaces) {
    const [i, j, k] = g.face(a.index);
    const p = [g.vertex(i), g.vertex(j), g.vertex(k)];
    return [0, 1, 2].map((c) => a.bary[0] * p[0][c] + a.bary[1] * p[1][c] + a.bary[2] * p[2][c]) as Vec3;
  }
  if (a.kind === "point" && g?.kind === "points" && a.index < g.count) return g.point(a.index);
  return a.point;
}

export interface Hit { valid: boolean; surface: Anchor; point: Vec3 }

// Ray vs triangle plane, returning barycentrics of the plane hit (clamped
// onto the triangle, so a hit on an anti-aliased edge pixel still counts).
function rayTriangle(r: Ray, a: Vec3, b: Vec3, c: Vec3): { bary: Vec3; point: Vec3 } | null {
  const n = cross(sub(b, a), sub(c, a));
  const denom = dot(n, r.dir);
  if (Math.abs(denom) < 1e-20) return null;
  const t = dot(n, sub(a, r.origin)) / denom;
  const p = add3(r.origin, scale3(r.dir, t));
  const area = dot(n, n);
  let x = dot(cross(sub(c, b), sub(p, b)), n) / area;
  let y = dot(cross(sub(a, c), sub(p, c)), n) / area;
  let z = 1 - x - y;
  x = Math.max(x, 0); y = Math.max(y, 0); z = Math.max(z, 0);
  const s = x + y + z;
  const bary: Vec3 = [x / s, y / s, z / s];
  return { bary, point: add3(add3(scale3(a, bary[0]), scale3(b, bary[1])), scale3(c, bary[2])) };
}

const NO_ANCHOR = (): Anchor => ({ kind: "ground", object: 0, index: 0, bary: [0, 0, 0], point: [0, 0, 0] });

// Exact hit of `ray` on the element under an id pixel.
export function refineHit(scene: GeoLookup, px: IdPixel, ray: Ray, groundHeight: number): Hit {
  const miss: Hit = { valid: false, surface: NO_ANCHOR(), point: [0, 0, 0] };
  if (px.object === GROUND_ID) {
    if (Math.abs(ray.dir[2]) < 1e-8) return miss;
    const t = (groundHeight - ray.origin[2]) / ray.dir[2];
    if (t <= 0) return miss;
    const p = add3(ray.origin, scale3(ray.dir, t));
    return { valid: true, surface: { ...NO_ANCHOR(), point: p }, point: p };
  }
  const g = scene.find(px.object);
  if (!g) return miss;
  if (g.kind === "mesh") {
    if (px.element >= g.numFaces) return miss;
    const [i, j, k] = g.face(px.element);
    const h = rayTriangle(ray, g.vertex(i), g.vertex(j), g.vertex(k));
    if (!h) return miss;
    return { valid: true, surface: { kind: "surface", object: px.object, index: px.element, bary: h.bary, point: h.point },
      point: h.point };
  }
  const i = Math.floor(px.element / 12);
  const a: Anchor = { kind: "point", object: px.object, index: i, bary: [0, 0, 0], point: [0, 0, 0] };
  return { valid: true, surface: a, point: resolveAnchor(scene, a) };
}

// ---- picking ------------------------------------------------------------------

function distToSegment(p: [number, number], a: [number, number], b: [number, number]) {
  const ab = [b[0] - a[0], b[1] - a[1]];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / Math.max(ab[0] ** 2 + ab[1] ** 2, 1e-12)));
  return Math.hypot(p[0] - a[0] - ab[0] * t, p[1] - a[1] - ab[1] * t);
}

const isObject = (p: IdPixel) => p.object !== 0 && p.object !== GROUND_ID;

// Chooses the element of the current pick mode closest to the cursor among
// the faces seen in a small id window around it (pixels, window centered on
// the cursor). Null if none.
export function pickElement(scene: GeoLookup, cam: Camera, mode: PickMode, window: IdPixel[],
  cursor: [number, number], vp: [number, number]): ElementRef | null {
  if (!window.length) return null;
  const c = window[Math.floor(window.length / 2)];
  // Clicking right on something picks it directly in the "area" modes.
  if (isObject(c)) {
    const g = scene.find(c.object);
    if (!g) return null;
    const k = pickedKind(g, mode);
    if (g.kind === "points") return { object: c.object, index: k === "segment" ? 0 : Math.floor(c.element / 12) };
    if (k === "face") return { object: c.object, index: c.element };
    if (k === "segment") return { object: c.object, index: c.segment };
  }
  // Otherwise the nearest element (on screen) among everything under the window.
  const project = cam.projector(vp[0], vp[1]);
  const screen = (p: Vec3): [number, number] => {
    const s = project(p);
    return [s[0], s[1]];
  };
  const seen = new Set<string>();
  let best = Infinity, out: ElementRef | null = null;
  const consider = (object: number, index: number, d: number) => {
    if (d < best) {
      best = d;
      out = { object, index };
    }
  };
  for (const p of window) {
    if (!isObject(p)) continue;
    const id = `${p.object}:${p.element}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const g = scene.find(p.object);
    if (!g) continue;
    const k = pickedKind(g, mode);
    if (g.kind === "mesh") {
      if (p.element >= g.numFaces) continue;
      const v = g.face(p.element);
      const sp = v.map((i) => screen(g.vertex(i)));
      for (let c2 = 0; c2 < 3; c2++) {
        if (k === "vertex") consider(p.object, v[c2], Math.hypot(sp[c2][0] - cursor[0], sp[c2][1] - cursor[1]));
        if (k === "edge") consider(p.object, g.faceEdge(p.element, c2), distToSegment(cursor, sp[c2], sp[(c2 + 1) % 3]));
      }
      const cx = (sp[0][0] + sp[1][0] + sp[2][0]) / 3, cy = (sp[0][1] + sp[1][1] + sp[2][1]) / 3;
      const d = Math.hypot(cx - cursor[0], cy - cursor[1]);
      if (k === "face") consider(p.object, p.element, d);
      if (k === "segment") consider(p.object, g.segmentOfFace(p.element), d);
    } else {
      const i = Math.floor(p.element / 12);
      const s = screen(g.point(i));
      consider(p.object, k === "segment" ? 0 : i, Math.hypot(s[0] - cursor[0], s[1] - cursor[1]));
    }
  }
  return out;
}

// All elements inside a screen rectangle. Visible-only unless `xray`
// (`region` = the id pixels inside it, unused in x-ray).
export function boxSelect(scene: GeoLookup, cam: Camera, mode: PickMode, region: IdPixel[],
  lo: [number, number], hi: [number, number], vp: [number, number], xray: boolean): ElementRef[] {
  const project = cam.projector(vp[0], vp[1]);
  const inside = (p: Vec3) => {
    const s = project(p);
    return (s[2] < 0 || cam.ortho) && s[0] >= lo[0] && s[0] <= hi[0] && s[1] >= lo[1] && s[1] <= hi[1];
  };
  const out: ElementRef[] = [];
  const taken = new Set<string>();
  const push = (object: number, index: number) => {
    const k = `${object}:${index}`;
    if (!taken.has(k)) {
      taken.add(k);
      out.push({ object, index });
    }
  };
  // Candidates per structure: faces seen in the region, or everything in x-ray mode.
  const seen = new Map<number, Set<number>>();
  if (!xray)
    for (const p of region) {
      if (!isObject(p)) continue;
      let s = seen.get(p.object);
      if (!s) seen.set(p.object, (s = new Set()));
      s.add(p.element);
    }
  for (const g of scene.all()) {
    if (!xray && !seen.has(g.id)) continue;
    const id = g.id, k = pickedKind(g, mode);
    if (g.kind === "mesh") {
      const cand = xray ? range(g.numFaces) : [...seen.get(id)!].sort((a, b) => a - b);
      for (const f of cand) {
        if (!g.faceVisible(f)) continue;
        const t = g.face(f);
        const p = t.map((i) => g.vertex(i));
        switch (k) {
          case "vertex":
            for (let c = 0; c < 3; c++) if (inside(p[c])) push(id, t[c]);
            break;
          case "edge":
            for (let c = 0; c < 3; c++) if (inside(p[c]) && inside(p[(c + 1) % 3])) push(id, g.faceEdge(f, c));
            break;
          case "face":
            if (inside(scale3(add3(add3(p[0], p[1]), p[2]), 1 / 3))) push(id, f);
            break;
          default:
            if (!xray || inside(scale3(add3(add3(p[0], p[1]), p[2]), 1 / 3))) push(id, g.segmentOfFace(f));
        }
      }
    } else {
      const cand = xray ? range(g.count) : [...new Set([...seen.get(id)!].map((f) => Math.floor(f / 12)))].sort((a, b) => a - b);
      for (const i of cand)
        if (g.visible(i) && inside(g.point(i))) push(id, k === "segment" ? 0 : i);
    }
  }
  return out;
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

// ---- measurements ---------------------------------------------------------------

export enum MeasureTool { Off, Distance, Angle }

export interface Measurement { anchors: Anchor[]; angle: boolean }

// Distance (and the vector a -> b), or the angle at the middle anchor in degrees.
export function measurementValue(scene: GeoLookup, m: Measurement): { value: number; delta: Vec3 } {
  if (m.anchors.length < 2) return { value: 0, delta: [0, 0, 0] };
  const a = resolveAnchor(scene, m.anchors[0]), b = resolveAnchor(scene, m.anchors[1]);
  if (!m.angle) {
    const d = sub(b, a);
    return { value: Math.hypot(...d), delta: d };
  }
  if (m.anchors.length < 3) return { value: 0, delta: [0, 0, 0] };
  const c = resolveAnchor(scene, m.anchors[2]);
  const u = sub(a, b), w = sub(c, b);
  const cos = dot(u, w) / (Math.hypot(...u) * Math.hypot(...w) || 1);
  return { value: (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI, delta: [0, 0, 0] };
}

export function anchorLabel(scene: GeoLookup, a: Anchor): string {
  const name = scene.find(a.object)?.name ?? "?";
  switch (a.kind) {
    case "vertex": return `${name} v${a.index}`;
    case "surface": return `${name} f${a.index}`;
    case "point": return `${name} #${a.index}`;
    case "fixed": return `${name} point`;
    default: return "ground";
  }
}
