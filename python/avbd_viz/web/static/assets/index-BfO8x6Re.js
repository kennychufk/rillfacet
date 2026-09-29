(function(){let e=document.createElement(`link`).relList;if(e&&e.supports&&e.supports(`modulepreload`))return;for(let e of document.querySelectorAll(`link[rel="modulepreload"]`))n(e);new MutationObserver(e=>{for(let t of e)if(t.type===`childList`)for(let e of t.addedNodes)e.tagName===`LINK`&&e.rel===`modulepreload`&&n(e)}).observe(document,{childList:!0,subtree:!0});function t(e){let t={};return e.integrity&&(t.integrity=e.integrity),e.referrerPolicy&&(t.referrerPolicy=e.referrerPolicy),t.credentials=e.crossOrigin===`use-credentials`?`include`:e.crossOrigin===`anonymous`?`omit`:`same-origin`,t}function n(e){if(e.ep)return;e.ep=!0;let n=t(e);fetch(e.href,n)}})();var e={float32:Float32Array,int32:Int32Array,uint32:Uint32Array,int16:Int16Array,uint16:Uint16Array,uint8:Uint8Array};function t(e){return typeof e==`object`&&!!e&&`data`in e&&`shape`in e}function n(t){let n=new Uint8Array(t,0,4);if(String.fromCharCode(...n)!==`AVZ1`)throw Error(`bad message magic`);let r=new DataView(t).getUint32(4,!0),i=JSON.parse(new TextDecoder().decode(new Uint8Array(t,8,r))),a=i.$buffers??[];delete i.$buffers;let o=a.map(n=>{let r=e[n.dtype];return{data:new r(t,n.offset,n.nbytes/r.BYTES_PER_ELEMENT),shape:n.shape}}),s=e=>{if(Array.isArray(e))return e.map(s);if(e&&typeof e==`object`){let t=e,n=Object.keys(t);if(n.length===1&&n[0]===`$b`)return o[t.$b];for(let e of n)t[e]=s(t[e])}return e};return s(i)}var r=class{info;n;B;dyn=[];q;loaded=0;out;a=new Float32Array(7);b=new Float32Array(7);constructor(e){this.info=e,this.n=e.envs,this.B=e.bodies;for(let t=0;t<this.B;t++)e.static_mask.data[t]||this.dyn.push(t);this.q=new Int16Array(e.samples*this.n*this.dyn.length*7),this.out=new Float32Array(this.n*this.B*7);let t=e.static_poses.data;for(let n=0;n<this.n;n++){let r=0;for(let i=0;i<this.B;i++){if(!e.static_mask.data[i])continue;let a=e.static_poses.shape[1];for(let e=0;e<7;e++)this.out[(n*this.B+i)*7+e]=t[(n*a+r)*7+e];r++}}e.chunks===0&&(this.loaded=e.samples)}async addChunk(e){let t=e.data.data,n=new Blob([t]).stream().pipeThrough(new DecompressionStream(`deflate`)),r=new Int16Array(await new Response(n).arrayBuffer()),i=this.n*this.dyn.length*7,a=this.q.subarray(e.start*i,(e.start+e.count)*i);a.set(r.subarray(0,i));for(let t=1;t<e.count;t++)for(let e=0;e<i;e++)a[t*i+e]=a[(t-1)*i+e]+r[t*i+e];this.loaded=Math.max(this.loaded,e.start+e.count)}dequant(e,t,n,r){let i=this.dyn.length,a=((e*this.n+t)*i+n)*7,o=this.info.pos_lo.data,s=this.info.pos_span.data;for(let e=0;e<3;e++)r[e]=(this.q[a+e]+32768)/65535*s[e]+o[e];for(let e=3;e<7;e++)r[e]=this.q[a+e]/32767}sample(e,t){let n=Math.min(e+1,this.loaded-1);n<=e&&(t=0);let r=this.out,o=this.a,s=this.b;for(let c=0;c<this.n;c++)for(let l=0;l<this.dyn.length;l++){this.dequant(e,c,l,o);let u=(c*this.B+this.dyn[l])*7;if(t>0){this.dequant(n,c,l,s);for(let e=0;e<3;e++)r[u+e]=o[e]+(s[e]-o[e])*t;a(o,s,t,r,u+3)}else{for(let e=0;e<3;e++)r[u+e]=o[e];i(o,r,u+3)}}return r}};function i(e,t,n){let r=Math.hypot(e[3],e[4],e[5],e[6])||1;for(let i=0;i<4;i++)t[n+i]=e[3+i]/r}function a(e,t,n,r,i){let a=e[3]*t[3]+e[4]*t[4]+e[5]*t[5]+e[6]*t[6],o=a<0?-1:1;a*=o;let s,c;if(a>.9995)s=1-n,c=n;else{let e=Math.acos(Math.min(1,a)),t=Math.sin(e);s=Math.sin((1-n)*e)/t,c=Math.sin(n*e)/t}let l=0;for(let n=0;n<4;n++){let a=s*e[3+n]+c*o*t[3+n];r[i+n]=a,l+=a*a}l=Math.sqrt(l)||1;for(let e=0;e<4;e++)r[i+e]/=l}function o(e,t,n=e.length){let r=0,i=n-1;if(n===0||t<e[0])return 0;for(;r<i;){let n=r+i+1>>1;e[n]<=t?r=n:i=n-1}return r}var s=[[`success`,`var(--ok)`],[`forbidden`,`var(--bad)`],[`overload`,`var(--warn)`],[`unstable`,`var(--purple)`],[`timeout`,`var(--muted)`]];function c(e){if(!e)return``;for(let[t]of s)if(e[t]===!0)return t;return e.complete===!1||e.unfinished?`running`:`ended`}var l=class{msg;numEnvs;endStep;poses=new Map;cache=new Map;chain=Promise.resolve();chunksDone=0;chunksTotal;onChunk=()=>{};constructor(e){this.msg=e;let t=e.scene.objects.find(e=>e.kind===`rigid_mesh`);this.numEnvs=t?t.attrs.instances:0,this.endStep=Array.from({length:this.numEnvs},(t,n)=>e.summary.envs?.[n]?.end_step??e.duration);let n=0;e.tracks.forEach((e,t)=>{e.pose&&(this.poses.set(t,new r(e.pose)),n+=e.pose.chunks)}),this.chunksTotal=n}get id(){return this.msg.id}get duration(){return this.msg.duration}get physTicks(){let e=this.msg.meta.dt,t=this.msg.tick_seconds;return e&&t?e/t:1}get ctrlTicks(){return this.physTicks*(this.msg.meta.decimation??1)}get loadedUntil(){let e=this.duration;for(let[t,n]of this.poses){let r=this.msg.tracks[t].t.data;e=Math.min(e,n.loaded?r[n.loaded-1]:0)}return e}addChunk(e){return this.chain=this.chain.then(async()=>{await this.poses.get(e.track)?.addChunk(e),this.chunksDone++,this.onChunk()}),this.chain}channel(e){return this.msg.tracks.find(t=>t.object===`channels`&&t.field===e)?.values??null}channelTimes(e){let t=this.msg.tracks.find(t=>t.object===`channels`&&t.field===e);return t?t.t.data:null}perEnvChannels(){return this.msg.tracks.filter(e=>e.object===`channels`&&e.values&&e.values.shape.length===2&&e.values.shape[1]===this.numEnvs).map(e=>e.field)}sample(e,t=!1){let n={},r={},i=this.numEnvs;return this.msg.tracks.forEach((a,s)=>{let c=a.t.data,l=this.poses.get(s);if(l){if(!l.loaded)return;let t=o(c,e,l.loaded),r=t+1<l.loaded?c[t+1]-c[t]:0,i=r>0?Math.max(0,Math.min(1,(e-c[t])/r)):0;(n[a.object]??={})[a.field]={data:l.sample(t,i),shape:[l.n,l.B,7]};return}let u=a.values,d=u.shape.slice(1),f=d.reduce((e,t)=>e*t,1);if(a.object===`channels`){if(d.length===0)r[a.field]=u.data[o(c,e)];else if(d.length===1&&d[0]===i){let t=new Float32Array(i);for(let n=0;n<i;n++){let r=o(c,Math.min(e,this.endStep[n]));t[n]=u.data[r*i+n]}r[a.field]={data:t,shape:[i]}}else{let t=o(c,e);r[a.field]={data:u.data.subarray(t*f,(t+1)*f),shape:d}}return}let p=o(c,e);(t||this.cache.get(s)!==p)&&(this.cache.set(s,p),(n[a.object]??={})[a.field]={data:u.data.subarray(p*f,(p+1)*f),shape:d})}),{objects:n,channels:r}}resetCache(){this.cache.clear()}},u=Object.fromEntries(s),d=e=>{if(!Number.isFinite(e))return String(e);let t=Math.abs(e);return t!==0&&(t<.001||t>=1e5)?e.toExponential(2):e.toFixed(t>=100?1:3)},f=class{statusEl;clockEl;scalarsEl;tableEl;focus=-1;onFocus=()=>{};constructor(e){e.innerHTML=`
      <div class="head"><span class="dot"></span><span class="status"></span></div>
      <div class="clock"></div>
      <h3>Batch</h3><div class="scalars"></div>
      <h3>Envs</h3><div class="table"></div>`,this.statusEl=e.querySelector(`.head`),this.clockEl=e.querySelector(`.clock`),this.scalarsEl=e.querySelector(`.scalars`),this.tableEl=e.querySelector(`.table`),this.tableEl.addEventListener(`click`,e=>{let t=e.target.closest(`tr[data-env]`);if(!t)return;let n=Number(t.dataset.env);this.focus=this.focus===n?-1:n,this.onFocus(this.focus)})}setHeader(e,t,n){this.statusEl.className=`head ${e}`,this.statusEl.querySelector(`.status`).textContent=t,this.clockEl.textContent=n}setStatus(e){let t=e.status===`live`,n=e.lastFrameAt?(performance.now()-e.lastFrameAt)/1e3:NaN;this.setHeader(t?`ok`:e.status===`connecting`?`wait`:`bad`,`${e.name||`avbd-viz`} — ${e.status}`,`step ${e.time??`–`} · ${e.frames} frames (${e.dropped} dropped) · ${e.fps.toFixed(1)} fps · last ${Number.isFinite(n)?n.toFixed(1)+` s`:`–`} ago`)}setChannels(e,n,r,i){let a=[],o=[];for(let[r,i]of Object.entries(e))typeof i==`number`?a.push([r,i]):t(i)&&i.shape.length===1&&i.shape[0]===n&&o.push([r,i]);if(this.scalarsEl.innerHTML=a.length?`<table>${a.map(([e,t])=>`<tr><td>${e}</td><td class="num">${d(t)}</td></tr>`).join(``)}</table>`:`<div class="empty">none</div>`,!o.length){this.tableEl.innerHTML=`<div class="empty">none</div>`;return}let s=`<tr><th>env</th>${r?`<th>outcome</th>`:``}${o.map(([e])=>`<th>${e}</th>`).join(``)}</tr>`,c=[];for(let e=0;e<n;e++){let t=e===this.focus?` class="focus"`:``,n=``;if(r){let t=i?.[e]?r[e]:``,a=u[t];n=`<td class="oc"${a?` style="color:${a}"`:``}>${t||`…`}</td>`}c.push(`<tr data-env="${e}"${t}><td>${e}</td>${n}${o.map(([,t])=>`<td class="num">${d(t.data[e])}</td>`).join(``)}</tr>`)}this.tableEl.innerHTML=`<table>${s}${c.join(``)}</table>`}},p=`// Web client: the native viewer's background gradient (frame.bg_top at the
// top of the view, frame.bg_bottom at the bottom), one full-screen triangle.
// Per-frame constants shared by every pass.
// Must match \`FrameUniforms\` in src/avbd_viz/renderer.h field for field.
struct Frame {
  view: mat4x4f,
  proj: mat4x4f,
  view_proj: mat4x4f,
  inv_view_proj: mat4x4f,
  inv_proj: mat4x4f,
  inv_view: mat4x4f,
  light_view_proj: mat4x4f,  // sun shadow map projection
  camera_pos: vec4f,         // xyz = eye, w = 1 when orthographic
  viewport: vec4f,           // width, height, 1/width, 1/height (pixels)
  sun_dir: vec4f,            // world direction toward the sun, w = shadow strength
  bg_top: vec4f,             // background gradient, linear rgb
  bg_bottom: vec4f,
  grid_minor: vec4f,         // grid line colors (linear rgb, a = opacity)
  grid_major: vec4f,
  grid_params: vec4f,        // x = plane offset, y = fade distance, z = grid on, w = ground shadow on
  grid_plane: vec4f,         // x = normal axis (0 x, 1 y, 2 z), y = 1 behind everything, z/w = in-plane u/v axes
  axis_u: vec4f,             // color of the u axis line (v = 0) on the grid plane
  axis_v: vec4f,             // color of the v axis line (u = 0)
  wire: vec4f,               // rgb = wire color, a = line width in pixels (0 = off)
  wire_mode: vec4f,          // x = 1 in wireframe shading, y = face opacity, z = 1 wires take object colors
  select_color: vec4f,
  active_color: vec4f,       // the most recently selected element
  outline_color: vec4f,
  style: vec4f,              // x = ao strength, y = exposure, z = shadows on, w = outline mode
  style2: vec4f,             // per-style knobs, see shaders/styles/*.wgsl
  env: vec4f,                // x = env rotation (rad), y = env intensity, z = max mip level
  ao: vec4f,                 // x = radius (world), y = bias, z = intensity
  post: vec4f,               // x = tonemap (0 clamp, 1 PBR neutral), y = outline width px
  slice: vec4f,              // slice plane: xyz = unit normal toward the cut-away side, w = offset
  sh: array<vec4f, 9>,       // environment irradiance (spherical harmonics, order 2)
};

@group(0) @binding(0) var<uniform> frame: Frame;

const PI: f32 = 3.14159265358979;

fn srgb_to_linear(c: vec3f) -> vec3f {
  return select(pow((c + 0.055) / 1.055, vec3f(2.4)), c / 12.92, c <= vec3f(0.04045));
}

fn linear_to_srgb(c: vec3f) -> vec3f {
  let x = clamp(c, vec3f(0.0), vec3f(1.0));
  return select(1.055 * pow(x, vec3f(1.0 / 2.4)) - 0.055, x * 12.92, x <= vec3f(0.0031308));
}

// Colors stored as packed sRGB bytes (r | g << 8 | b << 16 | a << 24).
fn unpack_srgb(c: u32) -> vec3f {
  return srgb_to_linear(unpack4x8unorm(c).rgb);
}

fn is_ortho() -> bool {
  return frame.camera_pos.w > 0.5;
}

// Unit vector from a world point toward the viewer.
fn view_dir(p: vec3f) -> vec3f {
  if (is_ortho()) {
    return normalize(vec3f(frame.view[0].z, frame.view[1].z, frame.view[2].z));
  }
  return normalize(frame.camera_pos.xyz - p);
}

// Distance in front of the camera for a (reversed-Z) depth buffer value.
// Works for both projections; depth 0 (nothing drawn) maps to very far.
fn view_depth(depth: f32) -> f32 {
  let v = frame.inv_proj * vec4f(0.0, 0.0, max(depth, 1e-7), 1.0);
  return -v.z / v.w;
}

// True when the scene surface at \`scene_depth\` is in front of a point at
// \`depth\` (both depth-buffer values), with a small relative tolerance.
fn occluded(scene_depth: f32, depth: f32) -> bool {
  let z = view_depth(depth);
  return view_depth(scene_depth) < z * 0.997 - 1e-4;
}

// World -> view-space direction (view space: +x right, +y up, +z toward the viewer).
fn to_view(n: vec3f) -> vec3f {
  return normalize((frame.view * vec4f(n, 0.0)).xyz);
}


struct VsOut {
  @builtin(position) clip: vec4f,
  @location(0) t: f32,
};

@vertex
fn vs_main(@builtin(vertex_index) i: u32) -> VsOut {
  let xy = vec2f(f32((i << 1u) & 2u), f32(i & 2u)) * 2.0 - 1.0;
  var out: VsOut;
  out.clip = vec4f(xy, 0.0, 1.0);
  out.t = xy.y * 0.5 + 0.5;
  return out;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4f {
  return vec4f(linear_to_srgb(mix(frame.bg_bottom.rgb, frame.bg_top.rgb, in.t)), 1.0);
}
`,m=`// Web client: small geometry rebuilt on the CPU when it changes (meter boxes,
// markers): world-space vertices with a packed sRGB color each.
// Per-frame constants shared by every pass.
// Must match \`FrameUniforms\` in src/avbd_viz/renderer.h field for field.
struct Frame {
  view: mat4x4f,
  proj: mat4x4f,
  view_proj: mat4x4f,
  inv_view_proj: mat4x4f,
  inv_proj: mat4x4f,
  inv_view: mat4x4f,
  light_view_proj: mat4x4f,  // sun shadow map projection
  camera_pos: vec4f,         // xyz = eye, w = 1 when orthographic
  viewport: vec4f,           // width, height, 1/width, 1/height (pixels)
  sun_dir: vec4f,            // world direction toward the sun, w = shadow strength
  bg_top: vec4f,             // background gradient, linear rgb
  bg_bottom: vec4f,
  grid_minor: vec4f,         // grid line colors (linear rgb, a = opacity)
  grid_major: vec4f,
  grid_params: vec4f,        // x = plane offset, y = fade distance, z = grid on, w = ground shadow on
  grid_plane: vec4f,         // x = normal axis (0 x, 1 y, 2 z), y = 1 behind everything, z/w = in-plane u/v axes
  axis_u: vec4f,             // color of the u axis line (v = 0) on the grid plane
  axis_v: vec4f,             // color of the v axis line (u = 0)
  wire: vec4f,               // rgb = wire color, a = line width in pixels (0 = off)
  wire_mode: vec4f,          // x = 1 in wireframe shading, y = face opacity, z = 1 wires take object colors
  select_color: vec4f,
  active_color: vec4f,       // the most recently selected element
  outline_color: vec4f,
  style: vec4f,              // x = ao strength, y = exposure, z = shadows on, w = outline mode
  style2: vec4f,             // per-style knobs, see shaders/styles/*.wgsl
  env: vec4f,                // x = env rotation (rad), y = env intensity, z = max mip level
  ao: vec4f,                 // x = radius (world), y = bias, z = intensity
  post: vec4f,               // x = tonemap (0 clamp, 1 PBR neutral), y = outline width px
  slice: vec4f,              // slice plane: xyz = unit normal toward the cut-away side, w = offset
  sh: array<vec4f, 9>,       // environment irradiance (spherical harmonics, order 2)
};

@group(0) @binding(0) var<uniform> frame: Frame;

const PI: f32 = 3.14159265358979;

fn srgb_to_linear(c: vec3f) -> vec3f {
  return select(pow((c + 0.055) / 1.055, vec3f(2.4)), c / 12.92, c <= vec3f(0.04045));
}

fn linear_to_srgb(c: vec3f) -> vec3f {
  let x = clamp(c, vec3f(0.0), vec3f(1.0));
  return select(1.055 * pow(x, vec3f(1.0 / 2.4)) - 0.055, x * 12.92, x <= vec3f(0.0031308));
}

// Colors stored as packed sRGB bytes (r | g << 8 | b << 16 | a << 24).
fn unpack_srgb(c: u32) -> vec3f {
  return srgb_to_linear(unpack4x8unorm(c).rgb);
}

fn is_ortho() -> bool {
  return frame.camera_pos.w > 0.5;
}

// Unit vector from a world point toward the viewer.
fn view_dir(p: vec3f) -> vec3f {
  if (is_ortho()) {
    return normalize(vec3f(frame.view[0].z, frame.view[1].z, frame.view[2].z));
  }
  return normalize(frame.camera_pos.xyz - p);
}

// Distance in front of the camera for a (reversed-Z) depth buffer value.
// Works for both projections; depth 0 (nothing drawn) maps to very far.
fn view_depth(depth: f32) -> f32 {
  let v = frame.inv_proj * vec4f(0.0, 0.0, max(depth, 1e-7), 1.0);
  return -v.z / v.w;
}

// True when the scene surface at \`scene_depth\` is in front of a point at
// \`depth\` (both depth-buffer values), with a small relative tolerance.
fn occluded(scene_depth: f32, depth: f32) -> bool {
  let z = view_depth(depth);
  return view_depth(scene_depth) < z * 0.997 - 1e-4;
}

// World -> view-space direction (view space: +x right, +y up, +z toward the viewer).
fn to_view(n: vec3f) -> vec3f {
  return normalize((frame.view * vec4f(n, 0.0)).xyz);
}

// Resources and helpers for passes that shade 3D geometry.

@group(0) @binding(1) var clamp_sampler: sampler;
@group(0) @binding(2) var colormaps: texture_2d<f32>;    // 256 x N, one colormap per row
@group(0) @binding(3) var matcap_tex: texture_2d<f32>;   // MatCap style
@group(0) @binding(4) var env_tex: texture_2d<f32>;      // equirect; mip k = blurrier (rougher)
@group(0) @binding(5) var shadow_map: texture_depth_2d;
@group(0) @binding(6) var shadow_sampler: sampler_comparison;
@group(0) @binding(7) var ao_tex: texture_2d<f32>;       // screen-space ambient occlusion
@group(0) @binding(8) var repeat_sampler: sampler;

// Everything a style needs to shade one pixel. See shaders/styles/.
struct Surface {
  albedo: vec3f,     // base color, linear rgb
  n: vec3f,          // world normal, facing the viewer
  v: vec3f,          // world direction toward the viewer
  p: vec3f,          // world position
  ao: f32,           // ambient occlusion, 1 = open
  shadow: f32,       // sun visibility, 1 = lit
  metallic: f32,
  roughness: f32,
};

fn colormap(row: u32, t: f32) -> vec3f {
  let rows = f32(textureDimensions(colormaps).y);
  let uv = vec2f((clamp(t, 0.0, 1.0) * 255.0 + 0.5) / 256.0, (f32(row) + 0.5) / rows);
  return textureSampleLevel(colormaps, clamp_sampler, uv, 0.0).rgb;
}

fn sample_ao(frag_xy: vec2f) -> f32 {
  let ao = textureLoad(ao_tex, vec2i(frag_xy), 0).r;
  return mix(1.0, ao, frame.style.x);
}

// Sun shadow, 3x3 percentage-closer filtering. Returns 1 when lit.
fn sample_shadow(p: vec3f, n: vec3f) -> f32 {
  if (frame.style.z < 0.5) {
    return 1.0;
  }
  let lp = frame.light_view_proj * vec4f(p + n * 0.01, 1.0);
  let uv = vec2f(lp.x * 0.5 + 0.5, 0.5 - lp.y * 0.5);
  let texel = 1.0 / vec2f(textureDimensions(shadow_map));
  var lit = 0.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      lit += textureSampleCompareLevel(shadow_map, shadow_sampler,
                                       uv + vec2f(f32(x), f32(y)) * texel, lp.z - 0.0015);
    }
  }
  lit /= 9.0;
  let outside = any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)) || lp.z > 1.0;
  return select(mix(1.0, lit, frame.sun_dir.w), 1.0, outside);
}

// Equirectangular lookup in a z-up world, rotated by frame.env.x.
fn env_uv(d: vec3f) -> vec2f {
  let phi = atan2(d.y, d.x) + frame.env.x;
  let theta = acos(clamp(d.z, -1.0, 1.0));
  return vec2f(phi / (2.0 * PI) + 0.5, theta / PI);
}

// Diffuse light arriving from the whole environment around normal n.
fn env_irradiance(n: vec3f) -> vec3f {
  // Rotate the normal into the environment's frame first.
  let c = cos(frame.env.x);
  let s = sin(frame.env.x);
  let d = vec3f(c * n.x - s * n.y, s * n.x + c * n.y, n.z);
  let sh = frame.sh;
  var r = sh[0].rgb * 0.886227;
  r += sh[1].rgb * (1.023328 * d.y) + sh[2].rgb * (1.023328 * d.z) + sh[3].rgb * (1.023328 * d.x);
  r += sh[4].rgb * (0.858086 * d.x * d.y) + sh[5].rgb * (0.858086 * d.y * d.z);
  r += sh[6].rgb * (0.247708 * (3.0 * d.z * d.z - 1.0));
  r += sh[7].rgb * (0.858086 * d.x * d.z) + sh[8].rgb * (0.429043 * (d.x * d.x - d.y * d.y));
  return max(r, vec3f(0.0));
}

// STUDIO — Blender "Workbench" (Solid mode) style.
//
// Three lights are attached to the camera, so any view is well lit and no
// scene ever needs lights of its own. A soft sky/ground ambient adds the sense
// of "up". Ambient occlusion darkens creases; the sun shadow only darkens.
//
// Knobs: frame.style2.x = specular strength
//        frame.style2.y = light wrap (0 = hard terminator, 1 = very soft)
//        frame.style2.z = ambient level

fn wrap_diffuse(n: vec3f, l: vec3f, wrap: f32) -> f32 {
  return max((dot(n, l) + wrap) / (1.0 + wrap), 0.0);
}

fn shade(s: Surface) -> vec3f {
  let n = to_view(s.n);  // lights below are in view space, i.e. they follow the camera
  let key = normalize(vec3f(-0.45, 0.60, 0.66));   // upper left, in front
  let fill = normalize(vec3f(0.80, 0.05, 0.60));   // right
  let rim = normalize(vec3f(0.10, 0.45, -0.89));   // behind, above

  let wrap = frame.style2.y;
  let diffuse = 0.80 * wrap_diffuse(n, key, wrap)
              + 0.30 * wrap_diffuse(n, fill, wrap)
              + 0.25 * max(dot(n, rim), 0.0);
  let sky = s.n.z * 0.5 + 0.5;  // world up is +z
  let ambient = frame.style2.z * mix(0.55, 1.0, sky);

  let h = normalize(key + vec3f(0.0, 0.0, 1.0));
  let spec = pow(max(dot(n, h), 0.0), 60.0) * frame.style2.x;

  let occlusion = s.ao * mix(0.55, 1.0, s.shadow);
  return s.albedo * (ambient + diffuse) * occlusion + vec3f(spec) * occlusion;
}


struct VsOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) @interpolate(flat) color: vec3f,
};

@vertex
fn vs_main(@location(0) pos: vec3f, @location(1) color: u32) -> VsOut {
  var out: VsOut;
  out.world = pos;
  out.clip = frame.view_proj * vec4f(pos, 1.0);
  out.color = unpack_srgb(color);
  return out;
}

// Shared fragment stage of the web client's meshes: flat faces (normals from
// screen-space derivatives, so no per-face vertex copies), turned toward the
// viewer, shaded by the style, exposure, then sRGB for the canvas.
@fragment
fn fs_main(in: VsOut) -> @location(0) vec4f {
  let face = normalize(cross(dpdx(in.world), dpdy(in.world)));
  let v = view_dir(in.world);
  var s: Surface;
  s.albedo = in.color;
  s.n = select(-face, face, dot(face, v) >= 0.0);
  s.v = v;
  s.p = in.world;
  s.ao = 1.0;
  s.shadow = 1.0;
  s.metallic = 0.0;
  s.roughness = 0.45;
  return vec4f(linear_to_srgb(shade(s) * frame.style.y), 1.0);
}

`,h=`// Web client: rigid bodies drawn from BODY-LOCAL vertices and one pose per
// (instance, body), so a frame only uploads the poses. One instanced draw per
// rigid mesh (instance = env). Shading is the native viewer's (shared
// frame/scene helpers and the selected style's shade()).
// Per-frame constants shared by every pass.
// Must match \`FrameUniforms\` in src/avbd_viz/renderer.h field for field.
struct Frame {
  view: mat4x4f,
  proj: mat4x4f,
  view_proj: mat4x4f,
  inv_view_proj: mat4x4f,
  inv_proj: mat4x4f,
  inv_view: mat4x4f,
  light_view_proj: mat4x4f,  // sun shadow map projection
  camera_pos: vec4f,         // xyz = eye, w = 1 when orthographic
  viewport: vec4f,           // width, height, 1/width, 1/height (pixels)
  sun_dir: vec4f,            // world direction toward the sun, w = shadow strength
  bg_top: vec4f,             // background gradient, linear rgb
  bg_bottom: vec4f,
  grid_minor: vec4f,         // grid line colors (linear rgb, a = opacity)
  grid_major: vec4f,
  grid_params: vec4f,        // x = plane offset, y = fade distance, z = grid on, w = ground shadow on
  grid_plane: vec4f,         // x = normal axis (0 x, 1 y, 2 z), y = 1 behind everything, z/w = in-plane u/v axes
  axis_u: vec4f,             // color of the u axis line (v = 0) on the grid plane
  axis_v: vec4f,             // color of the v axis line (u = 0)
  wire: vec4f,               // rgb = wire color, a = line width in pixels (0 = off)
  wire_mode: vec4f,          // x = 1 in wireframe shading, y = face opacity, z = 1 wires take object colors
  select_color: vec4f,
  active_color: vec4f,       // the most recently selected element
  outline_color: vec4f,
  style: vec4f,              // x = ao strength, y = exposure, z = shadows on, w = outline mode
  style2: vec4f,             // per-style knobs, see shaders/styles/*.wgsl
  env: vec4f,                // x = env rotation (rad), y = env intensity, z = max mip level
  ao: vec4f,                 // x = radius (world), y = bias, z = intensity
  post: vec4f,               // x = tonemap (0 clamp, 1 PBR neutral), y = outline width px
  slice: vec4f,              // slice plane: xyz = unit normal toward the cut-away side, w = offset
  sh: array<vec4f, 9>,       // environment irradiance (spherical harmonics, order 2)
};

@group(0) @binding(0) var<uniform> frame: Frame;

const PI: f32 = 3.14159265358979;

fn srgb_to_linear(c: vec3f) -> vec3f {
  return select(pow((c + 0.055) / 1.055, vec3f(2.4)), c / 12.92, c <= vec3f(0.04045));
}

fn linear_to_srgb(c: vec3f) -> vec3f {
  let x = clamp(c, vec3f(0.0), vec3f(1.0));
  return select(1.055 * pow(x, vec3f(1.0 / 2.4)) - 0.055, x * 12.92, x <= vec3f(0.0031308));
}

// Colors stored as packed sRGB bytes (r | g << 8 | b << 16 | a << 24).
fn unpack_srgb(c: u32) -> vec3f {
  return srgb_to_linear(unpack4x8unorm(c).rgb);
}

fn is_ortho() -> bool {
  return frame.camera_pos.w > 0.5;
}

// Unit vector from a world point toward the viewer.
fn view_dir(p: vec3f) -> vec3f {
  if (is_ortho()) {
    return normalize(vec3f(frame.view[0].z, frame.view[1].z, frame.view[2].z));
  }
  return normalize(frame.camera_pos.xyz - p);
}

// Distance in front of the camera for a (reversed-Z) depth buffer value.
// Works for both projections; depth 0 (nothing drawn) maps to very far.
fn view_depth(depth: f32) -> f32 {
  let v = frame.inv_proj * vec4f(0.0, 0.0, max(depth, 1e-7), 1.0);
  return -v.z / v.w;
}

// True when the scene surface at \`scene_depth\` is in front of a point at
// \`depth\` (both depth-buffer values), with a small relative tolerance.
fn occluded(scene_depth: f32, depth: f32) -> bool {
  let z = view_depth(depth);
  return view_depth(scene_depth) < z * 0.997 - 1e-4;
}

// World -> view-space direction (view space: +x right, +y up, +z toward the viewer).
fn to_view(n: vec3f) -> vec3f {
  return normalize((frame.view * vec4f(n, 0.0)).xyz);
}

// Resources and helpers for passes that shade 3D geometry.

@group(0) @binding(1) var clamp_sampler: sampler;
@group(0) @binding(2) var colormaps: texture_2d<f32>;    // 256 x N, one colormap per row
@group(0) @binding(3) var matcap_tex: texture_2d<f32>;   // MatCap style
@group(0) @binding(4) var env_tex: texture_2d<f32>;      // equirect; mip k = blurrier (rougher)
@group(0) @binding(5) var shadow_map: texture_depth_2d;
@group(0) @binding(6) var shadow_sampler: sampler_comparison;
@group(0) @binding(7) var ao_tex: texture_2d<f32>;       // screen-space ambient occlusion
@group(0) @binding(8) var repeat_sampler: sampler;

// Everything a style needs to shade one pixel. See shaders/styles/.
struct Surface {
  albedo: vec3f,     // base color, linear rgb
  n: vec3f,          // world normal, facing the viewer
  v: vec3f,          // world direction toward the viewer
  p: vec3f,          // world position
  ao: f32,           // ambient occlusion, 1 = open
  shadow: f32,       // sun visibility, 1 = lit
  metallic: f32,
  roughness: f32,
};

fn colormap(row: u32, t: f32) -> vec3f {
  let rows = f32(textureDimensions(colormaps).y);
  let uv = vec2f((clamp(t, 0.0, 1.0) * 255.0 + 0.5) / 256.0, (f32(row) + 0.5) / rows);
  return textureSampleLevel(colormaps, clamp_sampler, uv, 0.0).rgb;
}

fn sample_ao(frag_xy: vec2f) -> f32 {
  let ao = textureLoad(ao_tex, vec2i(frag_xy), 0).r;
  return mix(1.0, ao, frame.style.x);
}

// Sun shadow, 3x3 percentage-closer filtering. Returns 1 when lit.
fn sample_shadow(p: vec3f, n: vec3f) -> f32 {
  if (frame.style.z < 0.5) {
    return 1.0;
  }
  let lp = frame.light_view_proj * vec4f(p + n * 0.01, 1.0);
  let uv = vec2f(lp.x * 0.5 + 0.5, 0.5 - lp.y * 0.5);
  let texel = 1.0 / vec2f(textureDimensions(shadow_map));
  var lit = 0.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      lit += textureSampleCompareLevel(shadow_map, shadow_sampler,
                                       uv + vec2f(f32(x), f32(y)) * texel, lp.z - 0.0015);
    }
  }
  lit /= 9.0;
  let outside = any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)) || lp.z > 1.0;
  return select(mix(1.0, lit, frame.sun_dir.w), 1.0, outside);
}

// Equirectangular lookup in a z-up world, rotated by frame.env.x.
fn env_uv(d: vec3f) -> vec2f {
  let phi = atan2(d.y, d.x) + frame.env.x;
  let theta = acos(clamp(d.z, -1.0, 1.0));
  return vec2f(phi / (2.0 * PI) + 0.5, theta / PI);
}

// Diffuse light arriving from the whole environment around normal n.
fn env_irradiance(n: vec3f) -> vec3f {
  // Rotate the normal into the environment's frame first.
  let c = cos(frame.env.x);
  let s = sin(frame.env.x);
  let d = vec3f(c * n.x - s * n.y, s * n.x + c * n.y, n.z);
  let sh = frame.sh;
  var r = sh[0].rgb * 0.886227;
  r += sh[1].rgb * (1.023328 * d.y) + sh[2].rgb * (1.023328 * d.z) + sh[3].rgb * (1.023328 * d.x);
  r += sh[4].rgb * (0.858086 * d.x * d.y) + sh[5].rgb * (0.858086 * d.y * d.z);
  r += sh[6].rgb * (0.247708 * (3.0 * d.z * d.z - 1.0));
  r += sh[7].rgb * (0.858086 * d.x * d.z) + sh[8].rgb * (0.429043 * (d.x * d.x - d.y * d.y));
  return max(r, vec3f(0.0));
}

// STUDIO — Blender "Workbench" (Solid mode) style.
//
// Three lights are attached to the camera, so any view is well lit and no
// scene ever needs lights of its own. A soft sky/ground ambient adds the sense
// of "up". Ambient occlusion darkens creases; the sun shadow only darkens.
//
// Knobs: frame.style2.x = specular strength
//        frame.style2.y = light wrap (0 = hard terminator, 1 = very soft)
//        frame.style2.z = ambient level

fn wrap_diffuse(n: vec3f, l: vec3f, wrap: f32) -> f32 {
  return max((dot(n, l) + wrap) / (1.0 + wrap), 0.0);
}

fn shade(s: Surface) -> vec3f {
  let n = to_view(s.n);  // lights below are in view space, i.e. they follow the camera
  let key = normalize(vec3f(-0.45, 0.60, 0.66));   // upper left, in front
  let fill = normalize(vec3f(0.80, 0.05, 0.60));   // right
  let rim = normalize(vec3f(0.10, 0.45, -0.89));   // behind, above

  let wrap = frame.style2.y;
  let diffuse = 0.80 * wrap_diffuse(n, key, wrap)
              + 0.30 * wrap_diffuse(n, fill, wrap)
              + 0.25 * max(dot(n, rim), 0.0);
  let sky = s.n.z * 0.5 + 0.5;  // world up is +z
  let ambient = frame.style2.z * mix(0.55, 1.0, sky);

  let h = normalize(key + vec3f(0.0, 0.0, 1.0));
  let spec = pow(max(dot(n, h), 0.0), 60.0) * frame.style2.x;

  let occlusion = s.ao * mix(0.55, 1.0, s.shadow);
  return s.albedo * (ambient + diffuse) * occlusion + vec3f(spec) * occlusion;
}


struct Params {
  num_bodies: u32,
  _pad0: u32,
  _pad1: u32,
  _pad2: u32,
};

@group(1) @binding(0) var<uniform> params: Params;
@group(1) @binding(1) var<storage, read> poses: array<vec4f>;   // 2 per segment: t, q (xyzw)
@group(1) @binding(2) var<storage, read> seg_color: array<u32>; // packed sRGB, a = 0 hidden
@group(1) @binding(3) var<storage, read> offsets: array<vec4f>; // per instance (display grid)

struct VsOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) @interpolate(flat) color: vec3f,
};

fn quat_rotate(q: vec4f, v: vec3f) -> vec3f {
  let u = 2.0 * cross(q.xyz, v);
  return v + q.w * u + cross(q.xyz, u);
}

@vertex
fn vs_main(@location(0) pos: vec3f, @location(1) body: u32,
           @builtin(instance_index) inst: u32) -> VsOut {
  let s = inst * params.num_bodies + body;
  let w = poses[2u * s].xyz + quat_rotate(poses[2u * s + 1u], pos) + offsets[inst].xyz;
  let c = seg_color[s];
  var out: VsOut;
  out.world = w;
  out.clip = frame.view_proj * vec4f(w, 1.0);
  if ((c >> 24u) == 0u) {
    out.clip = vec4f(0.0, 0.0, -2.0, 1.0);  // hidden segment: clipped away
  }
  out.color = unpack_srgb(c);
  return out;
}

// Shared fragment stage of the web client's meshes: flat faces (normals from
// screen-space derivatives, so no per-face vertex copies), turned toward the
// viewer, shaded by the style, exposure, then sRGB for the canvas.
@fragment
fn fs_main(in: VsOut) -> @location(0) vec4f {
  let face = normalize(cross(dpdx(in.world), dpdy(in.world)));
  let v = view_dir(in.world);
  var s: Surface;
  s.albedo = in.color;
  s.n = select(-face, face, dot(face, v) >= 0.0);
  s.v = v;
  s.p = in.world;
  s.ao = 1.0;
  s.shadow = 1.0;
  s.metallic = 0.0;
  s.roughness = 0.45;
  return vec4f(linear_to_srgb(shade(s) * frame.style.y), 1.0);
}

`,g=(e,t)=>[e[0]-t[0],e[1]-t[1],e[2]-t[2]],_=(e,t)=>[e[1]*t[2]-e[2]*t[1],e[2]*t[0]-e[0]*t[2],e[0]*t[1]-e[1]*t[0]],v=(e,t)=>e[0]*t[0]+e[1]*t[1]+e[2]*t[2],y=e=>{let t=Math.hypot(e[0],e[1],e[2])||1;return[e[0]/t,e[1]/t,e[2]/t]};function ee(e,t,n=[0,0,1]){let r=y(g(t,e)),i=_(r,n);Math.hypot(...i)<1e-6&&(i=_(r,[0,1,0])),i=y(i);let a=_(i,r);return new Float32Array([i[0],a[0],-r[0],0,i[1],a[1],-r[1],0,i[2],a[2],-r[2],0,-v(i,e),-v(a,e),v(r,e),1])}function te(e,t,n){let r=1/Math.tan(e/2);return new Float32Array([r/t,0,0,0,0,r,0,0,0,0,0,-1,0,0,n,0])}function ne(e,t){let n=new Float32Array(16);for(let r=0;r<4;r++)for(let i=0;i<4;i++){let a=0;for(let n=0;n<4;n++)a+=e[n*4+i]*t[r*4+n];n[r*4+i]=a}return n}function b(e){let t=new Float32Array(16),n=e;t[0]=n[5]*n[10]*n[15]-n[5]*n[11]*n[14]-n[9]*n[6]*n[15]+n[9]*n[7]*n[14]+n[13]*n[6]*n[11]-n[13]*n[7]*n[10],t[4]=-n[4]*n[10]*n[15]+n[4]*n[11]*n[14]+n[8]*n[6]*n[15]-n[8]*n[7]*n[14]-n[12]*n[6]*n[11]+n[12]*n[7]*n[10],t[8]=n[4]*n[9]*n[15]-n[4]*n[11]*n[13]-n[8]*n[5]*n[15]+n[8]*n[7]*n[13]+n[12]*n[5]*n[11]-n[12]*n[7]*n[9],t[12]=-n[4]*n[9]*n[14]+n[4]*n[10]*n[13]+n[8]*n[5]*n[14]-n[8]*n[6]*n[13]-n[12]*n[5]*n[10]+n[12]*n[6]*n[9],t[1]=-n[1]*n[10]*n[15]+n[1]*n[11]*n[14]+n[9]*n[2]*n[15]-n[9]*n[3]*n[14]-n[13]*n[2]*n[11]+n[13]*n[3]*n[10],t[5]=n[0]*n[10]*n[15]-n[0]*n[11]*n[14]-n[8]*n[2]*n[15]+n[8]*n[3]*n[14]+n[12]*n[2]*n[11]-n[12]*n[3]*n[10],t[9]=-n[0]*n[9]*n[15]+n[0]*n[11]*n[13]+n[8]*n[1]*n[15]-n[8]*n[3]*n[13]-n[12]*n[1]*n[11]+n[12]*n[3]*n[9],t[13]=n[0]*n[9]*n[14]-n[0]*n[10]*n[13]-n[8]*n[1]*n[14]+n[8]*n[2]*n[13]+n[12]*n[1]*n[10]-n[12]*n[2]*n[9],t[2]=n[1]*n[6]*n[15]-n[1]*n[7]*n[14]-n[5]*n[2]*n[15]+n[5]*n[3]*n[14]+n[13]*n[2]*n[7]-n[13]*n[3]*n[6],t[6]=-n[0]*n[6]*n[15]+n[0]*n[7]*n[14]+n[4]*n[2]*n[15]-n[4]*n[3]*n[14]-n[12]*n[2]*n[7]+n[12]*n[3]*n[6],t[10]=n[0]*n[5]*n[15]-n[0]*n[7]*n[13]-n[4]*n[1]*n[15]+n[4]*n[3]*n[13]+n[12]*n[1]*n[7]-n[12]*n[3]*n[5],t[14]=-n[0]*n[5]*n[14]+n[0]*n[6]*n[13]+n[4]*n[1]*n[14]-n[4]*n[2]*n[13]-n[12]*n[1]*n[6]+n[12]*n[2]*n[5],t[3]=-n[1]*n[6]*n[11]+n[1]*n[7]*n[10]+n[5]*n[2]*n[11]-n[5]*n[3]*n[10]-n[9]*n[2]*n[7]+n[9]*n[3]*n[6],t[7]=n[0]*n[6]*n[11]-n[0]*n[7]*n[10]-n[4]*n[2]*n[11]+n[4]*n[3]*n[10]+n[8]*n[2]*n[7]-n[8]*n[3]*n[6],t[11]=-n[0]*n[5]*n[11]+n[0]*n[7]*n[9]+n[4]*n[1]*n[11]-n[4]*n[3]*n[9]-n[8]*n[1]*n[7]+n[8]*n[3]*n[5],t[15]=n[0]*n[5]*n[10]-n[0]*n[6]*n[9]-n[4]*n[1]*n[10]+n[4]*n[2]*n[9]+n[8]*n[1]*n[6]-n[8]*n[2]*n[5];let r=n[0]*t[0]+n[1]*t[4]+n[2]*t[8]+n[3]*t[12],i=r===0?0:1/r;for(let e=0;e<16;e++)t[e]*=i;return t}var re=class{target=[0,0,0];distance=5;yaw=-Math.PI/2;pitch=.4;fovy=45*Math.PI/180;lookAt(e,t){let n=g(e,t);this.target=[...t],this.distance=Math.max(Math.hypot(...n),.001),this.yaw=Math.atan2(n[1],n[0]),this.pitch=Math.asin(Math.max(-1,Math.min(1,n[2]/this.distance)))}eye(){let e=Math.cos(this.pitch);return[this.target[0]+this.distance*e*Math.cos(this.yaw),this.target[1]+this.distance*e*Math.sin(this.yaw),this.target[2]+this.distance*Math.sin(this.pitch)]}view(){return ee(this.eye(),this.target)}proj(e){return te(this.fovy,e,Math.max(this.distance*.001,.001))}orbit(e,t){this.yaw-=e*.008,this.pitch=Math.max(-1.55,Math.min(1.55,this.pitch+t*.008))}pan(e,t,n){let r=this.view(),i=[r[0],r[4],r[8]],a=[r[1],r[5],r[9]],o=2*this.distance*Math.tan(this.fovy/2)/n;for(let n=0;n<3;n++)this.target[n]+=(-e*i[n]+t*a[n])*o}zoom(e){this.distance=Math.max(.001,this.distance*Math.exp(e*.001))}attach(e,t){let n=null,r=`orbit`;e.addEventListener(`contextmenu`,e=>e.preventDefault()),e.addEventListener(`pointerdown`,t=>{n=[t.clientX,t.clientY],r=t.button===2||t.button===1||t.shiftKey?`pan`:`orbit`,e.setPointerCapture(t.pointerId)}),e.addEventListener(`pointermove`,i=>{if(!n)return;let a=i.clientX-n[0],o=i.clientY-n[1];n=[i.clientX,i.clientY],r===`orbit`?this.orbit(a,o):this.pan(a,o,e.clientHeight),t()}),e.addEventListener(`pointerup`,()=>n=null),e.addEventListener(`wheel`,e=>{e.preventDefault(),this.zoom(e.deltaY),t()},{passive:!1})}},x={view:0,proj:16,viewProj:32,invViewProj:48,invProj:64,invView:80,cameraPos:112,viewport:116,sunDir:120,bgTop:124,bgBottom:128,style:176,style2:180,size:236},S=4,C=e=>e<=.04045?e/12.92:((e+.055)/1.055)**2.4;function w(e,t,n,r=1){let i=e=>Math.max(0,Math.min(255,Math.round(e*255)));return(i(e)|i(t)<<8|i(n)<<16|i(r)<<24)>>>0}var ie=[0,0,0,1,0,0,1,1,0,0,1,0,0,0,1,1,0,1,1,1,1,0,1,1],ae=[0,3,2,0,2,1,4,5,6,4,6,7,0,1,5,0,5,4,1,2,6,1,6,5,2,3,7,2,7,6,3,0,4,3,4,7],oe=class e{device;context;format;canvas;camera=new re;frame=new Float32Array(x.size);frameBuf;rigidPipe;dynPipe;bgPipe;frameBind=new Map;objects=new Map;color;depth;size=[0,0];dark=!0;constructor(e,t,n,r){this.device=e,this.context=t,this.format=n,this.canvas=r,this.frameBuf=e.createBuffer({size:x.size*4,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});let i={format:`depth32float`,depthWriteEnabled:!0,depthCompare:`greater`},a=[{format:n}],o={count:S},s=t=>e.createShaderModule({code:t}),c=s(h);this.rigidPipe=e.createRenderPipeline({layout:`auto`,vertex:{module:c,entryPoint:`vs_main`,buffers:[{arrayStride:12,attributes:[{shaderLocation:0,offset:0,format:`float32x3`}]},{arrayStride:4,attributes:[{shaderLocation:1,offset:0,format:`uint32`}]}]},fragment:{module:c,entryPoint:`fs_main`,targets:a},primitive:{topology:`triangle-list`,cullMode:`none`},depthStencil:i,multisample:o});let l=s(m);this.dynPipe=e.createRenderPipeline({layout:`auto`,vertex:{module:l,entryPoint:`vs_main`,buffers:[{arrayStride:12,attributes:[{shaderLocation:0,offset:0,format:`float32x3`}]},{arrayStride:4,attributes:[{shaderLocation:1,offset:0,format:`uint32`}]}]},fragment:{module:l,entryPoint:`fs_main`,targets:a},primitive:{topology:`triangle-list`,cullMode:`none`},depthStencil:i,multisample:o});let u=s(p);this.bgPipe=e.createRenderPipeline({layout:`auto`,vertex:{module:u,entryPoint:`vs_main`},fragment:{module:u,entryPoint:`fs_main`,targets:a},depthStencil:{format:`depth32float`,depthWriteEnabled:!1,depthCompare:`always`},multisample:o});for(let t of[this.rigidPipe,this.dynPipe,this.bgPipe])this.frameBind.set(t,e.createBindGroup({layout:t.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.frameBuf}}]}))}static async create(t){if(!navigator.gpu)throw Error(`WebGPU is not available in this browser`);let n=await navigator.gpu.requestAdapter({powerPreference:`high-performance`});if(!n)throw Error(`no WebGPU adapter (is hardware acceleration on?)`);let r=await n.requestDevice();r.lost.then(e=>console.error(`WebGPU device lost:`,e.message));let i=t.getContext(`webgpu`);if(!i)throw Error(`could not get a WebGPU canvas context`);let a=navigator.gpu.getPreferredCanvasFormat();return i.configure({device:r,format:a,alphaMode:`opaque`}),new e(r,i,a,t)}clear(){for(let e of this.objects.values())T(e);this.objects.clear()}setScene(e){this.clear();for(let t of e)if(t.kind===`rigid_mesh`)this.objects.set(t.name,this.makeRigid(t));else if(t.kind===`boxes`||t.kind===`points`){let e={kind:`dyn`,obj:t,indexCount:0,capacity:[0,0]};this.objects.set(t.name,e),this.rebuildDyn(e)}}makeRigid(e){let t=this.device,n=e.arrays,r=e.attrs.instances,i=n.body_triangle_offsets.data.length-1,a=(e,n)=>{let r=t.createBuffer({size:Math.max(16,se(e.byteLength)),usage:n|GPUBufferUsage.COPY_DST});return t.queue.writeBuffer(r,0,e.buffer,e.byteOffset,e.byteLength),r},o=a(n.local_vertices.data,GPUBufferUsage.VERTEX),s=a(new Uint32Array(n.vertex_body.data),GPUBufferUsage.VERTEX),c=a(n.triangles.data,GPUBufferUsage.INDEX),l=r*i,u=t.createBuffer({size:l*32,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),d=new Float32Array(l*8);for(let e=0;e<l;e++)d[e*8+7]=1;t.queue.writeBuffer(u,0,d);let f=t.createBuffer({size:Math.max(16,l*4),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),p=new Float32Array(r*4);for(let e=0;e<r;e++)for(let t=0;t<3;t++)p[e*4+t]=n.offsets.data[e*3+t];let m=a(p,GPUBufferUsage.STORAGE),h=a(new Uint32Array([i,0,0,0]),GPUBufferUsage.UNIFORM),g=t.createBindGroup({layout:this.rigidPipe.getBindGroupLayout(1),entries:[{binding:0,resource:{buffer:h}},{binding:1,resource:{buffer:u}},{binding:2,resource:{buffer:f}},{binding:3,resource:{buffer:m}}]}),_={kind:`rigid`,instances:r,bodies:i,indexCount:n.triangles.data.length,pos:o,body:s,index:c,poses:u,colors:f,offsets:p,bind:g,poseScratch:d};return this.setSegmentColors(_,n.segment_colors,n.segment_visible),_}setSegmentColors(e,t,n){let r=e.instances*e.bodies,i=new Uint32Array(r);for(let e=0;e<r;e++){let r=!n||n.data[e]!==0;i[e]=w(t.data[3*e],t.data[3*e+1],t.data[3*e+2],+!!r)}this.device.queue.writeBuffer(e.colors,0,i)}applyFrame(e){for(let[t,n]of Object.entries(e)){let e=this.objects.get(t);if(e){if(e.kind===`rigid`){let t=n.poses;if(!t)continue;let r=e.instances*e.bodies,i=e.poseScratch;for(let e=0;e<r;e++){for(let n=0;n<3;n++)i[8*e+n]=t.data[7*e+n];for(let n=0;n<4;n++)i[8*e+4+n]=t.data[7*e+3+n]}this.device.queue.writeBuffer(e.poses,0,i)}else Object.assign(e.obj.arrays,n),this.rebuildDyn(e)}}}rebuildDyn(e){let t=e.obj,n,r,i;if(t.kind===`boxes`)n=t.arrays.lo.data,r=t.arrays.hi.data,i=n.length/3;else{let e=t.arrays.points.data,a=t.arrays.radii?.data;i=e.length/3;let o=new Float32Array(e.length),s=new Float32Array(e.length);for(let n=0;n<i;n++)for(let r=0;r<3;r++){let i=a?a[n]:t.attrs.radius;o[3*n+r]=e[3*n+r]-i,s[3*n+r]=e[3*n+r]+i}n=o,r=s}let a=new Float32Array(i*24),o=new Uint32Array(i*8),s=new Uint32Array(i*36),c=t.arrays.colors?.data,l=t.attrs.color;for(let e=0;e<i;e++){let t=c?w(c[3*e],c[3*e+1],c[3*e+2]):w(l[0],l[1],l[2]);for(let i=0;i<8;i++){for(let t=0;t<3;t++)a[e*24+i*3+t]=n[3*e+t]+ie[i*3+t]*(r[3*e+t]-n[3*e+t]);o[e*8+i]=t}for(let t=0;t<36;t++)s[e*36+t]=ae[t]+8*e}let u=this.device;if(e.capacity[0]<a.byteLength||!e.pos){T(e);let t=Math.max(64,a.byteLength);e.pos=u.createBuffer({size:t,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST}),e.color=u.createBuffer({size:Math.max(64,o.byteLength),usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST}),e.index=u.createBuffer({size:Math.max(64,s.byteLength),usage:GPUBufferUsage.INDEX|GPUBufferUsage.COPY_DST}),e.capacity=[t,0]}u.queue.writeBuffer(e.pos,0,a),u.queue.writeBuffer(e.color,0,o),u.queue.writeBuffer(e.index,0,s),e.indexCount=s.length}ensureTargets(){let e=window.devicePixelRatio||1,t=Math.max(1,Math.floor(this.canvas.clientWidth*e)),n=Math.max(1,Math.floor(this.canvas.clientHeight*e));t===this.size[0]&&n===this.size[1]&&this.color||(this.canvas.width=t,this.canvas.height=n,this.size=[t,n],this.color?.destroy(),this.depth?.destroy(),this.color=this.device.createTexture({size:[t,n],format:this.format,sampleCount:S,usage:GPUTextureUsage.RENDER_ATTACHMENT}),this.depth=this.device.createTexture({size:[t,n],format:`depth32float`,sampleCount:S,usage:GPUTextureUsage.RENDER_ATTACHMENT}))}writeFrame(){let[e,t]=this.size,n=this.frame,r=this.camera.view(),i=this.camera.proj(e/t),a=ne(i,r);n.set(r,x.view),n.set(i,x.proj),n.set(a,x.viewProj),n.set(b(a),x.invViewProj),n.set(b(i),x.invProj),n.set(b(r),x.invView);let o=this.camera.eye();n.set([o[0],o[1],o[2],0],x.cameraPos),n.set([e,t,1/e,1/t],x.viewport),n.set([.25,-.35,1,0],x.sunDir);let s=(e,t,n)=>[C(e),C(t),C(n),1];n.set(this.dark?s(.235,.243,.259):s(.965,.969,.976),x.bgTop),n.set(this.dark?s(.114,.118,.129):s(.82,.835,.859),x.bgBottom),n.set([0,1,0,0],x.style),n.set([.35,.35,.38,0],x.style2),this.device.queue.writeBuffer(this.frameBuf,0,n)}render(){this.ensureTargets(),this.writeFrame();let e=this.device.createCommandEncoder(),t=e.beginRenderPass({colorAttachments:[{view:this.color.createView(),resolveTarget:this.context.getCurrentTexture().createView(),clearValue:{r:0,g:0,b:0,a:1},loadOp:`clear`,storeOp:`discard`}],depthStencilAttachment:{view:this.depth.createView(),depthClearValue:0,depthLoadOp:`clear`,depthStoreOp:`discard`}});t.setPipeline(this.bgPipe),t.setBindGroup(0,this.frameBind.get(this.bgPipe)),t.draw(3);for(let e of this.objects.values())e.kind===`rigid`?(t.setPipeline(this.rigidPipe),t.setBindGroup(0,this.frameBind.get(this.rigidPipe)),t.setBindGroup(1,e.bind),t.setVertexBuffer(0,e.pos),t.setVertexBuffer(1,e.body),t.setIndexBuffer(e.index,`uint32`),t.drawIndexed(e.indexCount,e.instances)):e.indexCount>0&&(t.setPipeline(this.dynPipe),t.setBindGroup(0,this.frameBind.get(this.dynPipe)),t.setVertexBuffer(0,e.pos),t.setVertexBuffer(1,e.color),t.setIndexBuffer(e.index,`uint32`),t.drawIndexed(e.indexCount));t.end(),this.device.queue.submit([e.finish()])}};function se(e){return e+3&-4}function T(e){if(e.kind===`rigid`)for(let t of[e.pos,e.body,e.index,e.poses,e.colors])t.destroy();else e.pos?.destroy(),e.color?.destroy(),e.index?.destroy(),e.pos=e.color=e.index=void 0}var ce=[.1,.25,.5,1,2,4],le=(e,t)=>getComputedStyle(e).getPropertyValue(t).trim(),ue=class{root;modeBtns;outer;outerRow;inner;plot;timeEl;playBtn;speedSel;chanSel;evals=[];mode=`live`;replay=null;selectedEval=null;t=0;playing=!1;speed=1;focus=-1;onMode=()=>{};onPickEval=()=>{};onSeek=()=>{};constructor(e){this.root=e,e.innerHTML=`
      <div class="bar-row">
        <div class="modes" role="tablist">
          <button data-mode="live" role="tab">Live</button>
          <button data-mode="ring" role="tab" title="Last episode of each streamed training env">Training ring</button>
          <button data-mode="eval" role="tab" title="Saved deterministic evals">Evals</button>
        </div>
        <div class="outer-wrap"><div class="outer" aria-label="Saved evals"></div></div>
      </div>
      <div class="inner">
        <div class="controls">
          <button class="b-start" title="Start (Home)">⏮</button>
          <button class="b-cback" title="Back one control step (Shift+←)">«</button>
          <button class="b-pback" title="Back one physics step (←)">‹</button>
          <button class="b-play" title="Play / pause (Space)">▶</button>
          <button class="b-pfwd" title="Forward one physics step (→)">›</button>
          <button class="b-cfwd" title="Forward one control step (Shift+→)">»</button>
          <select class="speed" title="Playback speed (1× = real time)">
            ${ce.map(e=>`<option value="${e}"${e===1?` selected`:``}>${e}×</option>`).join(``)}
          </select>
          <span class="time"></span>
          <select class="chan" title="Channel plotted under the scrubber"></select>
        </div>
        <canvas class="plot" aria-label="Episode scrubber"></canvas>
      </div>`;let t=t=>e.querySelector(t);this.modeBtns={live:t(`[data-mode=live]`),ring:t(`[data-mode=ring]`),eval:t(`[data-mode=eval]`)};for(let[e,t]of Object.entries(this.modeBtns))t.addEventListener(`click`,()=>this.onMode(e));this.outerRow=t(`.outer-wrap`),this.outer=t(`.outer`),this.inner=t(`.inner`),this.plot=t(`.plot`),this.timeEl=t(`.time`),this.playBtn=t(`.b-play`),this.speedSel=t(`.speed`),this.chanSel=t(`.chan`),this.playBtn.addEventListener(`click`,()=>this.togglePlay()),t(`.b-start`).addEventListener(`click`,()=>this.seek(0)),t(`.b-pback`).addEventListener(`click`,()=>this.step(-1,!1)),t(`.b-pfwd`).addEventListener(`click`,()=>this.step(1,!1)),t(`.b-cback`).addEventListener(`click`,()=>this.step(-1,!0)),t(`.b-cfwd`).addEventListener(`click`,()=>this.step(1,!0)),this.speedSel.addEventListener(`change`,()=>this.speed=Number(this.speedSel.value)),this.chanSel.addEventListener(`change`,()=>this.drawPlot()),this.outer.addEventListener(`click`,e=>{let t=e.target.closest(`[data-id]`);t&&this.onPickEval(t.dataset.id)});let n=!1,r=e=>{if(!this.replay)return;let t=this.plot.getBoundingClientRect(),n=Math.max(0,Math.min(1,(e.clientX-t.left)/t.width));this.seek(n*this.replay.duration)};this.plot.addEventListener(`pointerdown`,e=>{n=!0,this.plot.setPointerCapture(e.pointerId),this.playing=!1,r(e)}),this.plot.addEventListener(`pointermove`,e=>n&&r(e)),this.plot.addEventListener(`pointerup`,()=>n=!1),new ResizeObserver(()=>this.drawPlot()).observe(this.plot),window.addEventListener(`keydown`,e=>{if(this.mode!==`live`&&this.replay&&!e.target.closest(`select, input`)){if(e.key===` `)this.togglePlay();else if(e.key===`ArrowLeft`)this.step(-1,e.shiftKey);else if(e.key===`ArrowRight`)this.step(1,e.shiftKey);else if(e.key===`Home`)this.seek(0);else if(e.key===`End`)this.seek(this.replay.duration);else if(e.key===`[`||e.key===`]`)this.pickNeighbor(e.key===`]`?1:-1);else return;e.preventDefault()}}),this.render()}setAvailable(e,t,n){this.modeBtns.live.disabled=!e,this.modeBtns.ring.disabled=!t,this.modeBtns.eval.disabled=!n}setMode(e){this.mode=e,this.playing=!1,this.render()}setEvals(e){this.evals=[...e].sort((e,t)=>(e.timestep??0)-(t.timestep??0)),this.renderOuter()}get evalList(){return this.evals}setReplay(e){this.replay=e,this.t=0,this.playing=!1;let t=this.chanSel.value,n=e?e.perEnvChannels():[];this.chanSel.innerHTML=n.map(e=>`<option>${e}</option>`).join(``);let r=n.includes(t)?t:n.includes(`flux`)?`flux`:n[0];r&&(this.chanSel.value=r),this.render()}pickNeighbor(e){if(this.mode!==`eval`||!this.evals.length)return;let t=this.evals.findIndex(e=>e.id===this.selectedEval),n=Math.max(0,Math.min(this.evals.length-1,(t<0?this.evals.length:t)+e));this.onPickEval(this.evals[n].id)}togglePlay(){this.replay&&(!this.playing&&this.t>=this.replay.duration&&(this.t=0),this.playing=!this.playing,this.render())}step(e,t){if(!this.replay)return;this.playing=!1;let n=t?this.replay.ctrlTicks:this.replay.physTicks,r=Math.round(this.t/n);this.seek((r+e)*n)}seek(e){this.replay&&(this.t=Math.max(0,Math.min(this.replay.duration,e)),this.render(),this.onSeek())}advance(e){let t=this.replay;if(!t||!this.playing)return!1;let n=e*this.speed/(t.msg.tick_seconds||.01),r=Math.min(t.duration,t.loadedUntil);return this.t=Math.min(r,this.t+n),this.t>=t.duration&&(this.playing=!1),this.render(),!0}render(){for(let[e,t]of Object.entries(this.modeBtns))t.classList.toggle(`on`,e===this.mode),t.setAttribute(`aria-selected`,String(e===this.mode));this.outerRow.style.visibility=this.mode===`eval`?`visible`:`hidden`,this.inner.style.display=this.mode===`live`?`none`:``,this.playBtn.textContent=this.playing?`⏸`:`▶`;let e=this.replay;if(e){let t=this.t*e.msg.tick_seconds,n=e.duration*e.msg.tick_seconds,r=Math.floor(this.t/e.ctrlTicks+1e-6),i=Math.floor(this.t/e.physTicks+1e-6),a=Math.round(e.duration/e.ctrlTicks),o=e.chunksDone<e.chunksTotal?` · loading ${Math.round(100*e.chunksDone/e.chunksTotal)}%`:``;this.timeEl.textContent=`${t.toFixed(3)} / ${n.toFixed(2)} s · control ${r}/${a} · physics ${i}${o}`}else this.timeEl.textContent=this.mode===`live`?``:`loading…`;this.drawPlot()}renderOuter(){let e=this.evals;if(!e.length){this.outer.innerHTML=`<span class="empty">no saved evals yet</span>`;return}let t=Math.max(...e.map(e=>e.timestep??0),1);this.outer.innerHTML=e.map((n,r)=>{let i=e.length===1?100:100*((n.timestep??r)-0)/(t-0),a=n.summary??{},o=0,c=[],l=s.reduce((e,[t])=>e+(a[t]??0),0)||1;for(let[e,t]of s){let n=(a[e]??0)/l;n<=0||(c.push(`<i style="bottom:${(100*o).toFixed(1)}%;height:${(100*n).toFixed(1)}%;background:${t}"></i>`),o+=n)}let u=[`t=${n.timestep??`?`}`,...s.filter(([e])=>a[e]!==void 0).map(([e])=>`${e} ${(a[e]*100).toFixed(0)}%`)].join(` · `);return`<button class="tick${n.id===this.selectedEval?` sel`:``}" data-id="${n.id}" style="left:${i.toFixed(2)}%" title="${u}" aria-label="${u}">${c.join(``)}</button>`}).join(``)}selectEval(e){this.selectedEval=e,this.renderOuter()}drawPlot(){let e=this.plot,t=window.devicePixelRatio||1,n=Math.max(1,Math.floor(e.clientWidth*t)),r=Math.max(1,Math.floor(e.clientHeight*t));(e.width!==n||e.height!==r)&&(e.width=n,e.height=r);let i=e.getContext(`2d`);i.clearRect(0,0,n,r);let a=this.replay;if(!a||this.mode===`live`)return;let o=e=>e/Math.max(1,a.duration)*n;i.fillStyle=`rgba(255,255,255,0.04)`,i.fillRect(0,0,o(a.loadedUntil),r);let s=this.chanSel.value,c=s?a.channel(s):null,l=s?a.channelTimes(s):null;if(c&&l){let e=c.shape[1],n=1/0,u=-1/0;for(let e=0;e<c.data.length;e++){let t=c.data[e];Number.isFinite(t)&&(n=Math.min(n,t),u=Math.max(u,t))}u>n||(u=n+1);let d=4*t,f=e=>r-d-(e-n)/(u-n)*(r-2*d),p=(t,n,r)=>{i.strokeStyle=n,i.lineWidth=r,i.beginPath();let s=a.endStep[t]??a.duration,u=!1;for(let n=0;n<l.length&&!(l[n]>s);n++){let r=o(l[n]),a=f(c.data[n*e+t]);u?i.lineTo(r,a):(i.moveTo(r,a),u=!0)}i.stroke()};for(let n=0;n<e;n++)n!==this.focus&&p(n,`rgba(154,160,168,0.35)`,t);this.focus>=0&&this.focus<e&&p(this.focus,le(this.root,`--accent`)||`#4d8fd6`,2*t),i.fillStyle=le(this.root,`--muted`)||`#9aa0a8`,i.font=`${10*t}px system-ui, sans-serif`,i.fillText(`${s}  ${de(u)}`,4*t,11*t),i.fillText(de(n),4*t,r-3*t)}i.fillStyle=`rgba(224,90,79,0.8)`;for(let e of a.endStep)e<a.duration&&i.fillRect(o(e)-t/2,r-5*t,t,5*t);i.fillStyle=`#e4e6ea`,i.fillRect(o(this.t)-t,0,2*t,r)}};function de(e){let t=Math.abs(e);return t!==0&&(t<.001||t>=1e4)?e.toExponential(1):e.toFixed(t>=10?1:3)}var E=`live`,fe=20,D=document.getElementById(`view`),O=new f(document.getElementById(`panel`)),k=document.getElementById(`bar`),A=new ue(k),j=document.getElementById(`error`),M={status:`connecting`,name:``,time:null,frames:0,dropped:0,fps:0,lastFrameAt:0,mode:`live`,replay:null};window.__avbd=M,window.__timeline=A;var N=null,P=!0,F=null,I=0,L=0,R=null,z=null,B=!1,V=null,H=!1,U=!1,W=!1,G=!1,K=null,q=null,J=0,Y=0,pe=0;function me(e){j.textContent=e,j.style.display=`block`}function he(e){j.textContent=e,j.style.display=`block`,clearTimeout(pe),pe=window.setTimeout(()=>j.style.display=`none`,6e3)}function X(e){V?.readyState===WebSocket.OPEN&&V.send(JSON.stringify(e))}function Z(e){N.setScene(e.objects);let t=e.objects.find(e=>e.kind===`rigid_mesh`);L=t?t.attrs.instances:0,R=t?t.arrays.offsets.data:null,e.camera&&(z=e.camera),e.camera&&!B&&(N.camera.lookAt(e.camera[0],e.camera[1]),B=!0),P=!0}function ge(e){if(B)return;let t=[1/0,1/0,1/0],n=[-1/0,-1/0,-1/0];for(let r of Object.values(e)){let e=r.poses;if(!e)continue;let[i,a]=e.shape;for(let r=0;r<i;r++)for(let i=0;i<a;i++)for(let o=0;o<3;o++){let s=e.data[(r*a+i)*7+o]+(R?R[3*r+o]:0);t[o]=Math.min(t[o],s),n[o]=Math.max(n[o],s)}}if(!Number.isFinite(t[0]))return;let r=[(t[0]+n[0])/2,(t[1]+n[1])/2,(t[2]+n[2])/2],i=Math.max(.5,Math.hypot(n[0]-t[0],n[1]-t[1],n[2]-t[2])/2),a=[r[0],r[1]-2.2*i,r[2]+1.6*i];N.camera.lookAt(a,r),z=[a,r],B=!0}function Q(e){if(M.mode=e,A.setMode(e),e===`live`){q=null,A.setReplay(null),!G&&H&&(X({type:`subscribe`,stream:E,rate:fe}),G=!0),K&&Z(K);return}if(G&&=(X({type:`unsubscribe`,stream:E}),!1),e===`ring`)_e({source:`ring`});else{let e=A.evalList,t=A.selectedEval??e[e.length-1]?.id;t?ve(t):(q=null,A.setReplay(null))}}function _e(e){J++,q=null,A.setReplay(null),X({type:`open_replay`,...e})}function ve(e){if(A.selectEval(e),M.mode!==`eval`){Q(`eval`);return}_e({source:`eval`,id:e})}function ye(e){if(e.id!==J)return;let t=new l(e);q=t,M.replay={id:e.id,source:e.source,name:e.name,duration:e.duration,chunks:t.chunksTotal},Z(e.scene),A.setReplay(t),t.onChunk=()=>{X({type:`replay_ack`,id:t.id,n:t.chunksDone}),M.replay.loaded=t.chunksDone,t===q&&(A.render(),$(!0))},$(!0)}function be(){let e=q;if(!e)return M.mode===`ring`?`asking the trainer for its latest episodes…`:`loading…`;let t=e.msg.summary.batch??{},n=s.filter(([e])=>t[e]!==void 0&&t[e]>0).map(([e])=>`${e} ${(100*t[e]).toFixed(0)}%`).join(` · `);if(e.msg.source===`ring`){let t=e.msg.summary.envs??[],r=t.filter(e=>e.complete).length;return`last episodes at step ${e.msg.meta.timestep} · ${r}/${t.length} complete${n?` · `+n:``}`}let r=String(e.msg.meta.checkpoint??``).split(`/`).pop();return`${r?r+` · `:``}seed ${e.msg.meta.seed??`?`}${n?` · `+n:``}`}function $(e=!1){let t=q;if(!t||!N)return;e&&t.resetCache();let n=t.sample(A.t,e);ge(n.objects),N.applyFrame(n.objects);let r=performance.now();if(e||r-Y>100){Y=r;let e=t.msg.summary.envs?.map(e=>c(e))??[],i=t.endStep.map(e=>A.t>=e);for(let[e,r]of Object.entries(t.msg.summary.batch??{}))typeof r==`number`&&(n.channels[`episode ${e}`]=r);O.setChannels(n.channels,t.numEnvs,e,i)}P=!0}A.onMode=Q,A.onPickEval=ve,A.onSeek=()=>$();function xe(e){if(F=e.seq,M.mode!==`live`)return;I&&e.seq>I+1&&(M.dropped+=e.seq-I-1),I=e.seq;let t=performance.now();M.lastFrameAt&&(M.fps=.8*M.fps+.2*(1e3/Math.max(1,t-M.lastFrameAt))),M.lastFrameAt=t,M.frames++,M.time=e.time,ge(e.objects),N.applyFrame(e.objects),O.setChannels(e.channels,L),P=!0}function Se(){let e=`${location.protocol===`https:`?`wss`:`ws`}://${location.host}/ws`;M.status=`connecting`,V=new WebSocket(e),V.binaryType=`arraybuffer`,V.onmessage=e=>{if(!(e.data instanceof ArrayBuffer))return;let t=n(e.data);if(t.type===`hello`)M.name=t.name,document.title=`${t.name||`avbd-viz`} — avbd-viz`,H=t.streams.some(e=>e.name===E),U=!!t.replay?.ring,W=!!t.replay?.evals,G=!1,J=0,A.setAvailable(H,U,W),M.status=H?`waiting for the scene`:`replay`,Q(M.mode===`live`&&!H?`eval`:M.mode);else if(t.type===`scene`)M.status=`live`,K=t,M.mode===`live`&&Z(t);else if(t.type===`frame`)xe(t);else if(t.type===`evals`){let e=!W||!A.evalList.length;W=!0,A.setAvailable(H,U,!0),A.setEvals(t.evals),M.mode===`eval`&&e&&!q&&Q(`eval`)}else if(t.type===`replay`)ye(t);else if(t.type===`replay_chunk`){let e=t;q&&e.id===q.id&&q.addChunk(e)}else t.type===`event`&&he(t.text)},V.onclose=()=>{M.status=`disconnected — retrying`,I=0,G=!1,setTimeout(Se,1500)}}O.onFocus=e=>{if(A.focus=e,A.drawPlot(),N){if(e<0||!R)z&&N.camera.lookAt(z[0],z[1]);else{let t=N.camera,n=z?z[1]:[0,0,1];t.target=[R[3*e]+n[0],R[3*e+1]+n[1],R[3*e+2]+n[2]],t.distance=Math.min(t.distance,2.5)}P=!0}},new ResizeObserver(()=>document.documentElement.style.setProperty(`--bar-h`,`${k.offsetHeight+12}px`)).observe(k);var Ce=performance.now();function we(e){let t=Math.min(.1,(e-Ce)/1e3);if(Ce=e,M.mode!==`live`&&A.advance(t)&&$(),N&&P&&(N.render(),P=!1),F!==null&&V?.readyState===WebSocket.OPEN&&(V.send(JSON.stringify({type:`ack`,stream:E,seq:F})),F=null),M.mode===`live`)O.setStatus(M);else{let e=q?q.msg.name:M.mode===`ring`?`training ring`:`evals`;O.setHeader(q?`ok`:`wait`,`${M.name||`avbd-viz`} — ${e}`,be())}requestAnimationFrame(we)}oe.create(D).then(e=>{N=e,e.camera.attach(D,()=>P=!0),new ResizeObserver(()=>P=!0).observe(D),Se(),requestAnimationFrame(we)}).catch(e=>me(`Cannot start the viewer: ${e.message}`));