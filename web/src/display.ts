// The Display popover, the web counterpart of the native viewer's Display
// window (ui.cpp display_panel): shading (Solid / Wireframe) with the wire
// options, style and its knobs, shadows, ambient occlusion, outlines,
// exposure, grid, the slice plane, and per object
// opacity (see-through), "cut by the slice plane" and, in Environment PBR,
// metallic / roughness. Settings are remembered in this browser.
import { ENVIRONMENTS, MATCAPS, matcapDefaultTint } from "./environment";
import { applyStyleDefaults, defaultSettings, type DisplaySettings, type ObjectDisplay, type Renderer,
  type StyleName, STYLES } from "./renderer";

const KEY = "avbd-viz.display.v1";

type Row = HTMLElement;

export class DisplayPanel {
  private root: HTMLElement;
  onChange: () => void = () => {};

  constructor(root: HTMLElement, private renderer: Renderer) {
    this.root = root;
    this.load();
    root.addEventListener("input", () => this.changed());
    root.addEventListener("change", () => this.changed());
    this.build();
  }

  get open() {
    return !this.root.hidden;
  }

  toggle(open = !this.open) {
    this.root.hidden = !open;
    if (open) this.build();
  }

  // The scene changed (objects, bounds): refresh the object list.
  sceneChanged() {
    if (this.open) this.build();
  }

  private load() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
      if (saved?.settings) {
        const s = defaultSettings();
        Object.assign(s, saved.settings, { slice: { ...s.slice, ...saved.settings.slice } });
        this.renderer.settings = s;
      }
      for (const [name, d] of Object.entries(saved?.objects ?? {}))
        Object.assign(this.renderer.displayOf(name), d as ObjectDisplay);
    } catch {
      /* private window or corrupt: defaults */
    }
  }

  private save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        settings: this.renderer.settings, objects: Object.fromEntries(this.renderer.display),
      }));
    } catch {
      /* not persisted */
    }
  }

  private changed() {
    this.save();
    this.onChange();
  }

  // -- controls ---------------------------------------------------------------

  private slider(label: string, get: () => number, set: (v: number) => void, lo: number, hi: number,
    fmt: (v: number) => string = (v) => v.toFixed(2)): Row {
    const row = document.createElement("label");
    row.className = "d-row";
    const out = document.createElement("output");
    const input = Object.assign(document.createElement("input"), {
      type: "range", min: String(lo), max: String(hi), step: String((hi - lo) / 200), value: String(get()),
    });
    out.textContent = fmt(get());
    input.addEventListener("input", () => {
      set(Number(input.value));
      out.textContent = fmt(get());
    });
    row.append(Object.assign(document.createElement("span"), { textContent: label }), input, out);
    return row;
  }

  private check(label: string, get: () => boolean, set: (v: boolean) => void, rebuild = false): Row {
    const row = document.createElement("label");
    row.className = "d-check";
    const input = Object.assign(document.createElement("input"), { type: "checkbox", checked: get() });
    input.addEventListener("change", () => {
      set(input.checked);
      if (rebuild) this.build();
    });
    row.append(input, document.createTextNode(label));
    return row;
  }

  private select(label: string, options: string[], get: () => number, set: (v: number) => void, rebuild = false): Row {
    const row = document.createElement("label");
    row.className = "d-row";
    const sel = document.createElement("select");
    sel.innerHTML = options.map((o, i) => `<option value="${i}">${o}</option>`).join("");
    sel.value = String(get());
    sel.addEventListener("change", () => {
      set(Number(sel.value));
      if (rebuild) this.build();
    });
    row.append(Object.assign(document.createElement("span"), { textContent: label }), sel);
    return row;
  }

  // One choice of several shown as a row of buttons (ui.cpp button_row).
  private buttons(labels: string[], get: () => number, set: (v: number) => void, label: string): Row {
    const row = document.createElement("div");
    row.className = "d-buttons";
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", label);
    labels.forEach((l, i) => {
      const b = Object.assign(document.createElement("button"), { textContent: l });
      b.classList.toggle("on", get() === i);
      b.setAttribute("aria-pressed", String(get() === i));
      b.addEventListener("click", () => {
        set(i);
        this.build();
      });
      row.append(b);
    });
    return row;
  }

  private radios(label: string, labels: string[], get: () => number, set: (v: number) => void): Row {
    const row = document.createElement("div");
    row.className = "d-radios";
    row.setAttribute("role", "radiogroup");
    row.setAttribute("aria-label", label);
    row.append(Object.assign(document.createElement("span"), { textContent: label }));
    const name = `d-${label.replace(/\W/g, "")}`;
    labels.forEach((l, i) => {
      const lab = document.createElement("label");
      const input = Object.assign(document.createElement("input"), { type: "radio", name, checked: get() === i });
      input.addEventListener("change", () => set(i));
      lab.append(input, document.createTextNode(l));
      row.append(lab);
    });
    return row;
  }

  // Wire width and flat-edge hiding (both shadings).
  private wireRows(s: DisplaySettings): Row[] {
    return [
      this.slider("Wire width", () => s.wireWidth, (v) => (s.wireWidth = v), 0.5, 3, (v) => `${v.toFixed(1)} px`),
      this.slider("Hide flat edges", () => s.flatEdgeAngle, (v) => (s.flatEdgeAngle = v), 0, 30,
        (v) => (v > 0 ? `< ${v.toFixed(1)} deg` : "off")),
    ];
  }

  private builtShading = "";

  // Rebuilds when the shading changed elsewhere (keys, the gizmo).
  sync() {
    const s = this.renderer.settings;
    if (this.open && `${s.shading}/${s.wireframe}` !== this.builtShading) this.build();
  }

  private heading(text: string): Row {
    return Object.assign(document.createElement("h3"), { textContent: text });
  }

  build() {
    const r = this.renderer, s: DisplaySettings = r.settings;
    this.builtShading = `${s.shading}/${s.wireframe}`;
    const rows: Row[] = [];
    rows.push(this.buttons(["Solid", "Wireframe"], () => (s.shading === "wireframe" ? 1 : 0),
      (i) => (s.shading = i ? "wireframe" : "solid"), "Shading"));
    if (s.shading === "wireframe") {
      rows.push(this.radios("Wire color", ["Theme", "Object"], () => (s.wireObjectColors ? 1 : 0),
        (i) => (s.wireObjectColors = i === 1)));
      rows.push(this.slider("Face opacity", () => s.faceOpacity, (v) => (s.faceOpacity = v), 0, 1));
      rows.push(...this.wireRows(s));
    } else this.solidRows(s, rows);
    rows.push(this.heading("Ground"));
    rows.push(this.check("Grid", () => s.grid, (v) => (s.grid = v)));
    rows.push(this.check("Shadow catcher", () => s.groundShadow, (v) => (s.groundShadow = v)));
    this.sliceAndObjects(s, rows);
  }

  private solidRows(s: DisplaySettings, rows: Row[]) {
    rows.push(this.select("Style", STYLES.map(([, l]) => l), () => STYLES.findIndex(([k]) => k === s.style),
      (i) => applyStyleDefaults(s, STYLES[i][0] as StyleName), true));
    if (s.style === "studio") {
      rows.push(this.slider("Specular", () => s.studioSpecular, (v) => (s.studioSpecular = v), 0, 1));
      rows.push(this.slider("Softness", () => s.studioWrap, (v) => (s.studioWrap = v), 0, 1));
      rows.push(this.slider("Ambient", () => s.studioAmbient, (v) => (s.studioAmbient = v), 0, 1));
    } else if (s.style === "matcap") {
      rows.push(this.select("Matcap", [...MATCAPS], () => s.matcap, (i) => {
        s.matcap = i;
        s.matcapTint = matcapDefaultTint(i);
      }, true));
      rows.push(this.slider("Object color", () => s.matcapTint, (v) => (s.matcapTint = v), 0, 1));
    } else if (s.style === "pbr") {
      rows.push(this.select("Environment", [...ENVIRONMENTS], () => s.environment, (i) => (s.environment = i)));
      rows.push(this.slider("Intensity", () => s.envIntensity, (v) => (s.envIntensity = v), 0, 3));
      rows.push(this.slider("Rotation", () => s.envRotation, (v) => (s.envRotation = v), -180, 180, (v) => `${v.toFixed(0)} deg`));
    } else {
      rows.push(this.slider("Cool/warm", () => s.goochShift, (v) => (s.goochShift = v), 0, 2));
      rows.push(this.slider("Contrast", () => s.goochContrast, (v) => (s.goochContrast = v), 0, 1));
    }
    rows.push(this.heading("Shading"));
    rows.push(this.check("Wireframe overlay (Z)", () => s.wireframe, (v) => (s.wireframe = v), true));
    if (s.wireframe) rows.push(...this.wireRows(s));
    rows.push(this.check("Shadows", () => s.shadows, (v) => (s.shadows = v), true));
    if (s.shadows) rows.push(this.slider("Strength", () => s.shadowStrength, (v) => (s.shadowStrength = v), 0, 1));
    rows.push(this.check("Ambient occlusion", () => s.ssao, (v) => (s.ssao = v), true));
    if (s.ssao) {
      rows.push(this.slider("AO strength", () => s.aoStrength, (v) => (s.aoStrength = v), 0, 1));
      rows.push(this.slider("AO radius", () => s.aoRadius, (v) => (s.aoRadius = v), 0.02, 2, (v) => `${v.toFixed(2)} m`));
    }
    rows.push(this.select("Outlines", ["Off", "Silhouettes", "Silhouettes + creases"], () => s.outline,
      (i) => (s.outline = i), true));
    if (s.outline > 0)
      rows.push(this.slider("Outline width", () => s.outlineWidth, (v) => (s.outlineWidth = Math.round(v)), 1, 4,
        (v) => `${v.toFixed(0)} px`));
    rows.push(this.slider("Exposure", () => s.exposure, (v) => (s.exposure = v), 0.2, 3));
  }

  private sliceAndObjects(s: DisplaySettings, rows: Row[]) {
    const r = this.renderer;
    // Slice plane (ui.cpp slice_section).
    rows.push(this.heading("Slice plane"));
    const sl = s.slice;
    rows.push(this.check("Cut the scene", () => sl.enabled, (v) => {
      sl.enabled = v;
      if (v) this.centerSlice();
    }, true));
    if (sl.enabled) {
      const axes = document.createElement("div");
      axes.className = "d-axes";
      axes.setAttribute("role", "radiogroup");
      axes.setAttribute("aria-label", "Slice axis");
      ["X", "Y", "Z"].forEach((a, i) => {
        const l = document.createElement("label");
        const input = Object.assign(document.createElement("input"), { type: "radio", name: "slice-axis", checked: sl.axis === i });
        input.addEventListener("change", () => {
          sl.axis = i;
          this.centerSlice();
          this.build();
        });
        l.append(input, document.createTextNode(a));
        axes.append(l);
      });
      rows.push(axes);
      const b = r.bounds();
      let lo = b ? b[0][sl.axis] : -1, hi = b ? b[1][sl.axis] : 1;
      if (hi - lo < 1e-6) { lo -= 0.5; hi += 0.5; }
      rows.push(this.slider("Position", () => sl.offset, (v) => (sl.offset = v), lo, hi, (v) => `${v.toPrecision(4)} m`));
      rows.push(this.check("Flip side", () => sl.flip, (v) => (sl.flip = v)));
      rows.push(this.check("Outline", () => sl.show, (v) => (sl.show = v)));
    }

    // Per object.
    const objs = r.objectNames();
    if (objs.length) rows.push(this.heading("Objects"));
    for (const { name } of objs) {
      const d = r.displayOf(name);
      const box = document.createElement("div");
      box.className = "d-object";
      box.append(Object.assign(document.createElement("div"), { className: "d-name", textContent: name }));
      box.append(this.slider("Opacity", () => d.opacity, (v) => (d.opacity = v), 0.05, 1));
      if (sl.enabled) box.append(this.check("Cut by the slice plane", () => d.sliced, (v) => (d.sliced = v)));
      if (s.style === "pbr") {
        box.append(this.slider("Metallic", () => d.metallic, (v) => (d.metallic = v), 0, 1));
        box.append(this.slider("Roughness", () => d.roughness, (v) => (d.roughness = v), 0.02, 1));
      }
      rows.push(box);
    }
    const reset = Object.assign(document.createElement("button"), { textContent: "Reset display", className: "d-reset" });
    reset.addEventListener("click", () => {
      r.settings = defaultSettings();
      r.display.clear();
      this.build();
      this.changed();
    });
    rows.push(reset);
    this.root.replaceChildren(...rows);
    this.changed();
  }

  // Slice position: the middle of the scene along its axis.
  private centerSlice() {
    const b = this.renderer.bounds();
    const sl = this.renderer.settings.slice;
    if (b) sl.offset = 0.5 * (b[0][sl.axis] + b[1][sl.axis]);
  }
}
