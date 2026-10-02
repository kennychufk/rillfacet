// Screenshot / probe the web client in a REAL Chromium window over CDP.
// Headless snap Chromium gets no WebGPU adapter on this machine; a normal
// window (DISPLAY=:0, placed off-screen) does. Usage:
//   node screenshot.mjs URL WAIT_MS JS_EXPR [OUT.png] [W H]
// e.g. node screenshot.mjs http://127.0.0.1:8080/ 5000 "JSON.stringify(window.__rillfacet)" shot.png
// (window.__rillfacet = the client's connection/stream stats). Profile dir:
// $HOME/snap_tmp_webgpu/profile (snap Chromium can only write under $HOME).
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
const [url, waitMs, expr, out, W = "1280", H = "800"] = process.argv.slice(2);
const port = 9333 + Math.floor(Math.random() * 500);
const prof = process.env.HOME + "/snap_tmp_webgpu/profile";
mkdirSync(prof, { recursive: true });
const chrome = spawn("chromium", [
  `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`,
  "--enable-unsafe-webgpu", "--enable-features=Vulkan", "--no-first-run",
  "--no-default-browser-check", `--window-size=${W},${H}`,
  "--window-position=3000,3000", "--new-window", url], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, id = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((res) => {
  const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
});
try {
  let page;
  for (let k = 0; k < 60 && !page; k++) {
    await sleep(500);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      page = list.find((p) => p.type === "page" && p.url.startsWith(url.slice(0, 20)));
    } catch {}
  }
  if (!page) throw new Error("no page");
  ws = new WebSocket(page.webSocketDebuggerUrl);
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  await new Promise((r) => (ws.onopen = r));
  await send("Emulation.setDeviceMetricsOverride", { width: +W, height: +H, deviceScaleFactor: 1, mobile: false });
  await sleep(+waitMs);
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  console.log("EVAL", JSON.stringify(r.result?.result?.value ?? r.result));
  if (out) {
    const s = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(out, Buffer.from(s.result.data, "base64"));
    console.log("SHOT", out);
  }
} catch (e) { console.log("ERR", e.message); }
finally { chrome.kill("SIGTERM"); await sleep(300); process.exit(0); }
