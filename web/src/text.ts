// 3D text labels as the native viewer draws them: the same SDF font atlas
// (exported from src/avbd_viz/text.cpp by tools/export_font.py) and a port
// of Font::layout / the label culling in Renderer::render, producing the
// GlyphInstance records shaders/overlay_text.wgsl reads.
import { type Vec3 } from "./math";

interface GlyphInfo { advance: number; uv: number[]; offset: number[]; size: number[] }

export interface FontInfo {
  width: number; height: number; base_px: number; ascent: number;
  line_height: number; sdf_per_px: number; glyphs: Record<string, GlyphInfo>;
}

// Floats per GlyphInstance (6 x vec4).
export const GLYPH_FLOATS = 24;

export interface Label {
  text: string;
  anchor: Vec3;
  color: number[]; // sRGB + alpha
  align: [number, number];
  worldHeight: number;
  sizePx: number;
  offset?: [number, number]; // pixels
  halo?: number[]; // sRGB + alpha
  hiddenAlpha?: number;
}

// Native TextLabel defaults (overlay.h / the Python Overlay.text binding).
const HALO = [0, 0, 0, 0.75];
const HALO_PX = 2.0;
const HIDDEN_ALPHA = 0.3;
const MIN_PX = 4.0;

export async function loadFont(base: string): Promise<{ info: FontInfo; image: ImageBitmap }> {
  const [info, blob] = await Promise.all([
    fetch(`${base}font/label.json`).then((r) => r.json()),
    fetch(`${base}font/label.png`).then((r) => r.blob()),
  ]);
  const image = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  return { info, image };
}

export interface View {
  eye: Vec3;
  forward: Vec3; // unit
  near: number;
  fovy: number;
  height: number; // pixels
  ortho?: boolean;
  viewHeight?: number; // world height of an orthographic view
}

export class TextLayout {
  private glyphs = new Map<number, GlyphInfo>();

  constructor(private font: FontInfo) {
    for (const [cp, g] of Object.entries(font.glyphs)) this.glyphs.set(Number(cp), g);
  }

  private find(cp: number): GlyphInfo | undefined {
    return this.glyphs.get(cp) ?? this.glyphs.get(63); // '?'
  }

  // Appends the glyph instances of `labels` to `out` (Font::layout).
  layout(labels: Label[], view: View, out: number[]) {
    const f = this.font;
    for (const l of labels) {
      let sizePx = l.sizePx;
      if (l.worldHeight > 0) {
        const d = [l.anchor[0] - view.eye[0], l.anchor[1] - view.eye[1], l.anchor[2] - view.eye[2]];
        const depth = d[0] * view.forward[0] + d[1] * view.forward[1] + d[2] * view.forward[2];
        if (!view.ortho && depth <= view.near) continue;
        const pixel = view.ortho ? view.viewHeight! / view.height
          : (2 * Math.max(depth, view.near) * Math.tan(0.5 * view.fovy)) / view.height;
        sizePx = l.worldHeight / Math.max(pixel, 1e-12);
        if (sizePx < MIN_PX) continue;
      }
      const s = sizePx / f.base_px;
      const cps = Array.from(l.text, (c) => c.codePointAt(0)!);
      let width = 0;
      for (const cp of cps) width += (this.find(cp)?.advance ?? 0) * s;
      // Tighter vertical box: cap height rather than the full line height.
      const off = l.offset ?? [0, 0];
      const ox = Math.round(off[0] - l.align[0] * width);
      const oy = Math.round(off[1] - l.align[1] * f.ascent * s * 0.78);
      const halo = l.halo ?? HALO;
      const haloSdf = Math.min((HALO_PX / s) * f.sdf_per_px, 0.45);
      let pen = 0;
      for (const cp of cps) {
        const g = this.find(cp);
        if (!g) continue;
        if (g.size[0] > 0) {
          out.push(
            l.anchor[0], l.anchor[1], l.anchor[2], l.hiddenAlpha ?? HIDDEN_ALPHA,
            ox + (pen + g.offset[0]) * s, oy + (g.offset[1] - f.ascent * 0.22) * s, g.size[0] * s, g.size[1] * s,
            g.uv[0], g.uv[1], g.uv[2], g.uv[3],
            l.color[0], l.color[1], l.color[2], l.color[3] ?? 1,
            halo[0], halo[1], halo[2], halo[3],
            haloSdf, 0, 0, 0,
          );
        }
        pen += g.advance;
      }
    }
  }
}

// The subset of Python's str.format used by label formats: "{}", "{:.3f}",
// "{:+.2e}", "{:d}", "{:.1%}", with literal text around them.
export function pyFormat(fmt: string, v: number): string {
  return fmt.replace(/\{(?::([+ ]?)(\d*)(?:\.(\d+))?([defgG%]?))?\}/g, (_m, sign, width, prec, type) => {
    const p = prec === undefined ? undefined : Number(prec);
    let s: string;
    switch (type) {
      case "f": s = v.toFixed(p ?? 6); break;
      case "e": s = pyExp(v, p ?? 6); break;
      case "%": s = (v * 100).toFixed(p ?? 6) + "%"; break;
      case "d": s = Math.trunc(v).toString(); break;
      case "g": case "G": s = pyGeneral(v, p ?? 6); break;
      default: s = p === undefined ? pyRepr(v) : pyGeneral(v, p);
    }
    if (sign && v >= 0 && !s.startsWith("-")) s = (sign === "+" ? "+" : " ") + s;
    return width ? s.padStart(Number(width)) : s;
  });
}

function pyExp(v: number, p: number) {
  // JS: 1.5e+2 -> Python: 1.5e+02
  return v.toExponential(p).replace(/e([+-])(\d)$/, "e$10$2");
}

function pyGeneral(v: number, p: number) {
  if (v === 0) return "0";
  const P = Math.max(p, 1);
  const exp = Math.floor(Math.log10(Math.abs(v)));
  const s = exp < -4 || exp >= P ? pyExp(v, P - 1) : v.toFixed(Math.max(P - 1 - exp, 0));
  return s.replace(/(\.\d*?)0+(e|$)/, "$1$2").replace(/\.(e|$)/, "$1");
}

function pyRepr(v: number) {
  if (Number.isInteger(v)) return v.toFixed(1);
  return String(v);
}

// ui::nice_step: the smallest 1/2/5 x 10^k at least x.
export function niceStep(x: number): number {
  if (!(x > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(x)));
  for (const m of [1, 2, 5, 10]) if (m * p >= x) return m * p;
  return 10 * p;
}

// ui::format_length: a ruler value in m / cm / mm / um for a given step.
export function formatLength(v: number, step: number): string {
  const a = Math.abs(step);
  if (Math.abs(v) < 1e-12) return "0";
  if (a >= 0.1) {
    let t = v.toFixed(a >= 1 ? 0 : 1);
    if (t.includes(".")) t = t.replace(/0+$/, "").replace(/\.$/, "");
    return t + " m";
  }
  if (a >= 0.01) return `${(v * 100).toFixed(0)} cm`;
  if (a >= 0.001) return `${(v * 1000).toFixed(0)} mm`;
  return `${(v * 1e6).toFixed(0)} \u00b5m`;
}

// C printf "%.<p>g".
export const formatG = (v: number, p: number) => (Number.isFinite(v) ? pyGeneral(v, p) : String(v));
