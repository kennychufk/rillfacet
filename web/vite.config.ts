// Vite build of the avbd-viz web client into the Python package, where the
// training process's server (avbd_viz.web.server) serves it.
//
// WGSL: `import src from "./shaders/rigid.wgsl"` yields the shader source
// with the repo's `#include "common/..."` / `#include STYLE` resolved exactly
// like src/avbd_viz/shader_library.cpp does, so the browser shades with the
// same code as the native viewer (Studio style).
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const SHADERS = resolve(here, "../shaders");
const STYLE = "styles/studio.wgsl";

function resolveIncludes(path: string, depth = 0, deps: string[] = []): string {
  if (depth > 16) throw new Error(`include depth exceeded at ${path}`);
  deps.push(path);
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => {
      const m = line.match(/^\s*#include\s+(?:"([^"]+)"|(STYLE))\s*$/);
      if (!m) return line;
      // Quoted: next to the including file first, then the shared shaders/.
      const local = m[1] ? resolve(dirname(path), m[1]) : "";
      const target = local && existsSync(local) ? local : resolve(SHADERS, m[1] ?? STYLE);
      return resolveIncludes(target, depth + 1, deps);
    })
    .join("\n");
}

function wgsl(): Plugin {
  return {
    name: "avbd-wgsl",
    enforce: "pre",
    load(id) {
      if (!id.endsWith(".wgsl")) return null;
      const deps: string[] = [];
      const code = resolveIncludes(id, 0, deps);
      for (const d of deps) this.addWatchFile(d);
      return `export default ${JSON.stringify(code)};`;
    },
  };
}

export default defineConfig({
  root: here,
  base: "./",
  plugins: [wgsl()],
  build: {
    outDir: resolve(here, "../python/avbd_viz/web/static"),
    emptyOutDir: true,
    target: "es2022",
  },
  server: {
    // `npm run dev` against a running training process's server.
    proxy: { "/ws": { target: "ws://127.0.0.1:8080", ws: true } },
  },
});
