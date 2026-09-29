(function(){let e=document.createElement(`link`).relList;if(e&&e.supports&&e.supports(`modulepreload`))return;for(let e of document.querySelectorAll(`link[rel="modulepreload"]`))n(e);new MutationObserver(e=>{for(let t of e)if(t.type===`childList`)for(let e of t.addedNodes)e.tagName===`LINK`&&e.rel===`modulepreload`&&n(e)}).observe(document,{childList:!0,subtree:!0});function t(e){let t={};return e.integrity&&(t.integrity=e.integrity),e.referrerPolicy&&(t.referrerPolicy=e.referrerPolicy),t.credentials=e.crossOrigin===`use-credentials`?`include`:e.crossOrigin===`anonymous`?`omit`:`same-origin`,t}function n(e){if(e.ep)return;e.ep=!0;let n=t(e);fetch(e.href,n)}})();var e={float32:Float32Array,int32:Int32Array,uint32:Uint32Array,int16:Int16Array,uint16:Uint16Array,uint8:Uint8Array};function t(e){return typeof e==`object`&&!!e&&`data`in e&&`shape`in e}function n(t){let n=new Uint8Array(t,0,4);if(String.fromCharCode(...n)!==`AVZ1`)throw Error(`bad message magic`);let r=new DataView(t).getUint32(4,!0),i=JSON.parse(new TextDecoder().decode(new Uint8Array(t,8,r))),a=i.$buffers??[];delete i.$buffers;let o=a.map(n=>{let r=e[n.dtype];return{data:new r(t,n.offset,n.nbytes/r.BYTES_PER_ELEMENT),shape:n.shape}}),s=e=>{if(Array.isArray(e))return e.map(s);if(e&&typeof e==`object`){let t=e,n=Object.keys(t);if(n.length===1&&n[0]===`$b`)return o[t.$b];for(let e of n)t[e]=s(t[e])}return e};return s(i)}var r=class{info;n;B;dyn=[];q;loaded=0;out;a=new Float32Array(7);b=new Float32Array(7);constructor(e){this.info=e,this.n=e.envs,this.B=e.bodies;for(let t=0;t<this.B;t++)e.static_mask.data[t]||this.dyn.push(t);this.q=new Int16Array(e.samples*this.n*this.dyn.length*7),this.out=new Float32Array(this.n*this.B*7);let t=e.static_poses.data;for(let n=0;n<this.n;n++){let r=0;for(let i=0;i<this.B;i++){if(!e.static_mask.data[i])continue;let a=e.static_poses.shape[1];for(let e=0;e<7;e++)this.out[(n*this.B+i)*7+e]=t[(n*a+r)*7+e];r++}}e.chunks===0&&(this.loaded=e.samples)}async addChunk(e){let t=e.data.data,n=new Blob([t]).stream().pipeThrough(new DecompressionStream(`deflate`)),r=new Int16Array(await new Response(n).arrayBuffer()),i=this.n*this.dyn.length*7,a=this.q.subarray(e.start*i,(e.start+e.count)*i);a.set(r.subarray(0,i));for(let t=1;t<e.count;t++)for(let e=0;e<i;e++)a[t*i+e]=a[(t-1)*i+e]+r[t*i+e];this.loaded=Math.max(this.loaded,e.start+e.count)}dequant(e,t,n,r){let i=this.dyn.length,a=((e*this.n+t)*i+n)*7,o=this.info.pos_lo.data,s=this.info.pos_span.data;for(let e=0;e<3;e++)r[e]=(this.q[a+e]+32768)/65535*s[e]+o[e];for(let e=3;e<7;e++)r[e]=this.q[a+e]/32767}sample(e,t){let n=Math.min(e+1,this.loaded-1);n<=e&&(t=0);let r=this.out,o=this.a,s=this.b;for(let c=0;c<this.n;c++)for(let l=0;l<this.dyn.length;l++){this.dequant(e,c,l,o);let u=(c*this.B+this.dyn[l])*7;if(t>0){this.dequant(n,c,l,s);for(let e=0;e<3;e++)r[u+e]=o[e]+(s[e]-o[e])*t;a(o,s,t,r,u+3)}else{for(let e=0;e<3;e++)r[u+e]=o[e];i(o,r,u+3)}}return r}};function i(e,t,n){let r=Math.hypot(e[3],e[4],e[5],e[6])||1;for(let i=0;i<4;i++)t[n+i]=e[3+i]/r}function a(e,t,n,r,i){let a=e[3]*t[3]+e[4]*t[4]+e[5]*t[5]+e[6]*t[6],o=a<0?-1:1;a*=o;let s,c;if(a>.9995)s=1-n,c=n;else{let e=Math.acos(Math.min(1,a)),t=Math.sin(e);s=Math.sin((1-n)*e)/t,c=Math.sin(n*e)/t}let l=0;for(let n=0;n<4;n++){let a=s*e[3+n]+c*o*t[3+n];r[i+n]=a,l+=a*a}l=Math.sqrt(l)||1;for(let e=0;e<4;e++)r[i+e]/=l}function o(e,t,n=e.length){let r=0,i=n-1;if(n===0||t<e[0])return 0;for(;r<i;){let n=r+i+1>>1;e[n]<=t?r=n:i=n-1}return r}var s=[[`success`,`var(--ok)`],[`forbidden`,`var(--bad)`],[`overload`,`var(--warn)`],[`unstable`,`var(--purple)`],[`timeout`,`var(--muted)`]];function c(e){if(!e)return``;for(let[t]of s)if(e[t]===!0)return t;return e.complete===!1||e.unfinished?`running`:`ended`}var l=class{msg;numEnvs;endStep;poses=new Map;cache=new Map;chain=Promise.resolve();chunksDone=0;chunksTotal;onChunk=()=>{};constructor(e){this.msg=e;let t=e.scene.objects.find(e=>e.kind===`rigid_mesh`);this.numEnvs=t?t.attrs.instances:0,this.endStep=Array.from({length:this.numEnvs},(t,n)=>e.summary.envs?.[n]?.end_step??e.duration);let n=0;e.tracks.forEach((e,t)=>{e.pose&&(this.poses.set(t,new r(e.pose)),n+=e.pose.chunks)}),this.chunksTotal=n}get id(){return this.msg.id}get duration(){return this.msg.duration}get physTicks(){let e=this.msg.meta.dt,t=this.msg.tick_seconds;return e&&t?e/t:1}get ctrlTicks(){return this.physTicks*(this.msg.meta.decimation??1)}get loadedUntil(){let e=this.duration;for(let[t,n]of this.poses){let r=this.msg.tracks[t].t.data;e=Math.min(e,n.loaded?r[n.loaded-1]:0)}return e}addChunk(e){return this.chain=this.chain.then(async()=>{await this.poses.get(e.track)?.addChunk(e),this.chunksDone++,this.onChunk()}),this.chain}channel(e){return this.msg.tracks.find(t=>t.object===`channels`&&t.field===e)?.values??null}channelTimes(e){let t=this.msg.tracks.find(t=>t.object===`channels`&&t.field===e);return t?t.t.data:null}perEnvChannels(){return this.msg.tracks.filter(e=>e.object===`channels`&&e.values&&e.values.shape.length===2&&e.values.shape[1]===this.numEnvs).map(e=>e.field)}sample(e,t=!1){let n={},r={},i=this.numEnvs;return this.msg.tracks.forEach((a,s)=>{let c=a.t.data,l=this.poses.get(s);if(l){if(!l.loaded)return;let t=o(c,e,l.loaded),r=t+1<l.loaded?c[t+1]-c[t]:0,i=r>0?Math.max(0,Math.min(1,(e-c[t])/r)):0;(n[a.object]??={})[a.field]={data:l.sample(t,i),shape:[l.n,l.B,7]};return}let u=a.values,d=u.shape.slice(1),f=d.reduce((e,t)=>e*t,1);if(a.object===`channels`){if(d.length===0)r[a.field]=u.data[o(c,e)];else if(d.length===1&&d[0]===i){let t=new Float32Array(i);for(let n=0;n<i;n++){let r=o(c,Math.min(e,this.endStep[n]));t[n]=u.data[r*i+n]}r[a.field]={data:t,shape:[i]}}else{let t=o(c,e);r[a.field]={data:u.data.subarray(t*f,(t+1)*f),shape:d}}return}let p=o(c,e);(t||this.cache.get(s)!==p)&&(this.cache.set(s,p),(n[a.object]??={})[a.field]={data:u.data.subarray(p*f,(p+1)*f),shape:d})}),{objects:n,channels:r}}resetCache(){this.cache.clear()}series(e){let t=e=>this.msg.tracks.find(t=>t.object===`channels`&&t.field===e&&t.values);return{scalar:n=>{let r=t(n);return!r||r.values.shape.length!==1?null:{data:r.values.data,cursor:o(r.t.data,e)}},perEnv:(n,r)=>{let i=t(n),a=this.numEnvs;if(!i||i.values.shape.length!==2||i.values.shape[1]!==a)return null;let s=`${n}/${r}`,c=this.columns.get(s);if(!c){let e=o(i.t.data,this.endStep[r])+1,t=new Float32Array(e);for(let n=0;n<e;n++)t[n]=i.values.data[n*a+r];this.columns.set(s,c={data:t,cursor:null})}return{data:c.data,cursor:o(i.t.data,Math.min(e,this.endStep[r]))}}}}columns=new Map},u=Object.fromEntries(s),d=e=>{if(!Number.isFinite(e))return String(e);let t=Math.abs(e);return t!==0&&(t<.001||t>=1e5)?e.toExponential(2):e.toFixed(t>=100?1:3)},f=class{root;names=``;rows=[];constructor(e){this.root=e}update(e,t=`none`){let n=e.map(([e])=>e).join(`
`)+`
`+t;n!==this.names&&(this.names=n,this.root.innerHTML=e.length?e.map(([e])=>`<div class="spark-row"><span class="k" title="${e}">${e}</span><span class="v num"></span><canvas class="spark"></canvas></div>`).join(``):`<div class="empty">${t}</div>`,this.rows=[...this.root.querySelectorAll(`.spark-row`)].map(e=>({value:e.querySelector(`.v`),canvas:e.querySelector(`canvas`)}))),e.forEach(([,e,t],n)=>{let r=this.rows[n];r.value.textContent=d(e),p(r.canvas,t)})}};function p(e,t){let n=window.devicePixelRatio||1,r=Math.max(1,Math.round(e.clientWidth*n)),i=Math.max(1,Math.round(e.clientHeight*n));(e.width!==r||e.height!==i)&&(e.width=r,e.height=i);let a=e.getContext(`2d`);if(a.clearRect(0,0,r,i),!t||t.data.length<2)return;let o=t.data,s=1/0,c=-1/0;for(let e=0;e<o.length;e++)Number.isFinite(o[e])&&(s=Math.min(s,o[e]),c=Math.max(c,o[e]));if(!Number.isFinite(s))return;c-s<1e-12&&(c+=.5,s-=.5);let l=e=>e/(o.length-1)*(r-2)+1,u=e=>i-2-(e-s)/(c-s)*(i-4);a.strokeStyle=`#8fb7e3`,a.lineWidth=n,a.beginPath();for(let e=0;e<o.length;e++)(e?a.lineTo:a.moveTo).call(a,l(e),u(o[e]));a.stroke();let d=t.cursor??o.length-1;a.fillStyle=`#e4e6ea`,a.beginPath(),a.arc(l(d),u(o[Math.max(0,Math.min(o.length-1,d))]),1.8*n,0,2*Math.PI),a.fill()}var m=class{focusHead;focusList;batchList;tableEl;focus=-1;onFocus=()=>{};constructor(e){e.innerHTML=`
      <section class="focus-sec"><h3 class="focus-head"></h3><div class="focus-list"></div></section>
      <section><h3>Batch</h3><div class="batch-list"></div></section>
      <section><h3>Envs</h3><div class="table"></div></section>`,this.focusHead=e.querySelector(`.focus-head`),this.focusList=new f(e.querySelector(`.focus-list`)),this.batchList=new f(e.querySelector(`.batch-list`)),this.tableEl=e.querySelector(`.table`),this.tableEl.addEventListener(`click`,e=>{let t=e.target.closest(`tr[data-env]`);if(!t)return;let n=Number(t.dataset.env);this.onFocus(this.focus===n?-1:n)})}update(e){let n=[],r=[];for(let[i,a]of Object.entries(e.channels))typeof a==`number`?n.push([i,a]):t(a)&&a.shape.length===1&&a.shape[0]===e.numEnvs&&r.push([i,a]);let i=t=>String(e.envNames?.[t]??t),a=t=>e.outcomes&&e.ended?.[t]?e.outcomes[t]:``,o=this.focus;if(o>=0&&o<e.numEnvs){let t=a(o);this.focusHead.innerHTML=`Env ${i(o)}`+(t?` <span class="oc" style="color:${u[t]??`inherit`}">${t}</span>`:``),this.focusList.update(r.map(([t,n])=>[t,n.data[o],e.series?.perEnv(t,o)??null]))}else this.focusHead.textContent=`Focus`,this.focusList.update([],`click an env (or a row below) to focus it; double-click to show it alone`);if(this.batchList.update(n.map(([t,n])=>[t,n,e.series?.scalar(t)??null])),!r.length){this.tableKey!==``&&(this.tableKey=``,this.tableEl.innerHTML=`<div class="empty">none</div>`);return}let s=r.map(([e])=>e),c=[e.numEnvs,+!!e.outcomes,...s].join(`
`);if(c!==this.tableKey){this.tableKey=c;let t=`<tr><th>env</th>${e.outcomes?`<th>outcome</th>`:``}${s.map(e=>`<th>${e}</th>`).join(``)}</tr>`,n=`<td></td>${e.outcomes?`<td class="oc"></td>`:``}${s.map(()=>`<td class="num"></td>`).join(``)}`,r=Array.from({length:e.numEnvs},(e,t)=>`<tr data-env="${t}">${n}</tr>`);this.tableEl.innerHTML=`<table>${t}${r.join(``)}</table>`,this.rowEls=[...this.tableEl.querySelectorAll(`tr[data-env]`)]}let l=(e,t)=>{e.textContent!==t&&(e.textContent=t)};this.rowEls.forEach((t,n)=>{t.classList.toggle(`focus`,n===o);let s=t.children,c=0;if(l(s[c++],i(n)),e.outcomes){let e=a(n),t=s[c++];l(t,e||`…`),t.style.color=u[e]??``}for(let[,e]of r)l(s[c++],d(e.data[n]))})}tableKey=``;rowEls=[]},h=class{length;scalars=new Map;envs=new Map;constructor(e=240){this.length=e}clear(){this.scalars.clear(),this.envs.clear()}push(e,n){let r=(e,t)=>{e.push(t),e.length>this.length&&e.shift()};for(let[i,a]of Object.entries(e))if(typeof a==`number`)this.scalars.has(i)||this.scalars.set(i,[]),r(this.scalars.get(i),a);else if(t(a)&&a.shape.length===1&&a.shape[0]===n){let e=this.envs.get(i);(!e||e.length!==n)&&this.envs.set(i,e=Array.from({length:n},()=>[]));for(let t=0;t<n;t++)r(e[t],a.data[t])}}scalar(e){let t=this.scalars.get(e);return t?{data:t,cursor:null}:null}perEnv(e,t){let n=this.envs.get(e)?.[t];return n?{data:n,cursor:null}:null}},g=`// Web client: rigid bodies drawn from BODY-LOCAL vertices and one pose per
// (instance, body), so a frame only uploads the poses. One instanced draw per
// rigid mesh (instance = env). Shading, prepass and shadow follow the native
// mesh.wgsl (shared frame/scene helpers and the style's shade()); see
// surface.wgsl for the fragment stages.
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
  object_id: u32,
  flags: u32,          // bit 1: cut by the slice plane (as MeshObject.flags)
  _pad0: u32,
  material: vec4f,     // x = metallic, y = roughness, z = opacity
};

@group(1) @binding(0) var<uniform> params: Params;
@group(1) @binding(1) var<storage, read> poses: array<vec4f>;   // 2 per segment: t, q (xyzw)
@group(1) @binding(2) var<storage, read> seg_color: array<u32>; // packed sRGB; a = 0 hidden, 254 selected
@group(1) @binding(3) var<storage, read> offsets: array<vec4f>; // per instance (display grid)

struct VsOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) @interpolate(flat) color: vec3f,
  @location(2) @interpolate(flat) ids: vec3u,  // object id, segment, flags (bit 0 selected)
};

fn quat_rotate(q: vec4f, v: vec3f) -> vec3f {
  let u = 2.0 * cross(q.xyz, v);
  return v + q.w * u + cross(q.xyz, u);
}

struct ShadowOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
};

// Pushes a vertex outside the clip volume so its triangle is dropped.
const CULLED = vec4f(0.0, 0.0, -2.0, 1.0);

fn world_of(pos: vec3f, body: u32, inst: u32) -> vec3f {
  let s = inst * params.num_bodies + body;
  return poses[2u * s].xyz + quat_rotate(poses[2u * s + 1u], pos) + offsets[inst].xyz;
}

fn hidden(body: u32, inst: u32) -> bool {
  return (seg_color[inst * params.num_bodies + body] >> 24u) == 0u;
}

@vertex
fn vs_main(@location(0) pos: vec3f, @location(1) body: u32,
           @builtin(instance_index) inst: u32) -> VsOut {
  let s = inst * params.num_bodies + body;
  let w = world_of(pos, body, inst);
  var out: VsOut;
  out.world = w;
  out.clip = select(frame.view_proj * vec4f(w, 1.0), CULLED, hidden(body, inst));
  out.color = unpack_srgb(seg_color[s]);
  out.ids = vec3u(params.object_id, s, u32((seg_color[s] >> 24u) == 254u));
  return out;
}

@vertex
fn vs_shadow(@location(0) pos: vec3f, @location(1) body: u32,
             @builtin(instance_index) inst: u32) -> ShadowOut {
  let w = world_of(pos, body, inst);
  var out: ShadowOut;
  out.world = w;
  out.clip = select(frame.light_view_proj * vec4f(w, 1.0), CULLED, hidden(body, inst));
  return out;
}

// Shared fragment stages of the web client's meshes, as the native mesh.wgsl
// does them for flat-shaded, two-sided, uniformly colored faces: face normals
// from screen-space derivatives (no per-face vertex copies), turned toward
// the viewer. Expects \`params\` (flags, material) and VsOut / ShadowOut.

fn face_normal(in: VsOut) -> vec3f {
  let face = cross(dpdx(in.world), dpdy(in.world));
  let n = select(vec3f(0.0, 0.0, 1.0), normalize(face), dot(face, face) > 1e-30);
  return select(-n, n, dot(n, view_dir(in.world)) >= 0.0);
}

// Fragments on the far side of the slice plane are cut away.
fn clipped(p: vec3f) -> bool {
  return (params.flags & 2u) != 0u && dot(frame.slice.xyz, p) > frame.slice.w;
}

fn surface_color(in: VsOut, n: vec3f) -> vec3f {
  var s: Surface;
  s.albedo = in.color;
  s.n = n;
  s.v = view_dir(in.world);
  s.p = in.world;
  s.ao = sample_ao(in.clip.xy);
  s.shadow = sample_shadow(in.world, n);
  s.metallic = params.material.x;
  s.roughness = params.material.y;
  return shade(s) * frame.style.y;
}

// Lit color into the HDR target (composite.wgsl tone maps and encodes).
@fragment
fn fs_main(in: VsOut) -> @location(0) vec4f {
  let n = face_normal(in);  // derivatives before any discard
  if (clipped(in.world)) {
    discard;
  }
  return vec4f(surface_color(in, n), 1.0);
}

// Weighted blended order-independent transparency (McGuire & Bavoil 2013),
// as mesh.wgsl's fs_transparent; composite.wgsl resolves it.
struct OitOut {
  @location(0) accum: vec4f,
  @location(1) reveal: vec4f,
};

@fragment
fn fs_transparent(in: VsOut) -> OitOut {
  let n = face_normal(in);
  if (clipped(in.world)) {
    discard;
  }
  let color = surface_color(in, n);
  let a = params.material.z;
  let z = view_depth(in.clip.z) / 50.0;
  let w = a * clamp(0.03 / (1e-5 + pow(z, 4.0)), 1e-2, 3e3);
  var out: OitOut;
  out.accum = vec4f(color * a * w, a * w);
  out.reveal = vec4f(a);
  return out;
}

struct PrepassOut {
  @location(0) normal: vec4f,  // view-space normal
  @location(1) ids: vec4u,     // object id, face (unused), segment, flags (bit 0 selected)
};

@fragment
fn fs_prepass(in: VsOut) -> PrepassOut {
  let n = face_normal(in);
  if (clipped(in.world)) {
    discard;
  }
  var out: PrepassOut;
  out.normal = vec4f(to_view(n), 1.0);
  out.ids = vec4u(in.ids.x, 0u, in.ids.y, in.ids.z);
  return out;
}

@fragment
fn fs_shadow(in: ShadowOut) {
  if (clipped(in.world)) {
    discard;
  }
}

`,_=`// Web client: rigid bodies drawn from BODY-LOCAL vertices and one pose per
// (instance, body), so a frame only uploads the poses. One instanced draw per
// rigid mesh (instance = env). Shading, prepass and shadow follow the native
// mesh.wgsl (shared frame/scene helpers and the style's shade()); see
// surface.wgsl for the fragment stages.
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

// MATCAP — "material capture": all lighting is baked into a picture of a lit
// sphere. The surface normal, seen from the camera, picks the pixel of that
// sphere to use. Swap the picture to restyle everything; there are no lights.
//
// Matcap texture: rgb = shading (neutral gray for tintable presets),
//                 a   = white highlight added on top.
// Knobs: frame.style2.x = tint (0 = picture colors as-is, 1 = times object color)

fn shade(s: Surface) -> vec3f {
  let n = to_view(s.n);
  let uv = vec2f(n.x, -n.y) * 0.485 + 0.5;
  let m = textureSampleLevel(matcap_tex, clamp_sampler, uv, 0.0);
  let tint = mix(vec3f(1.0), s.albedo * 1.6, frame.style2.x);
  let occlusion = s.ao * mix(0.6, 1.0, s.shadow);
  return (m.rgb * tint + vec3f(m.a)) * occlusion;
}


struct Params {
  num_bodies: u32,
  object_id: u32,
  flags: u32,          // bit 1: cut by the slice plane (as MeshObject.flags)
  _pad0: u32,
  material: vec4f,     // x = metallic, y = roughness, z = opacity
};

@group(1) @binding(0) var<uniform> params: Params;
@group(1) @binding(1) var<storage, read> poses: array<vec4f>;   // 2 per segment: t, q (xyzw)
@group(1) @binding(2) var<storage, read> seg_color: array<u32>; // packed sRGB; a = 0 hidden, 254 selected
@group(1) @binding(3) var<storage, read> offsets: array<vec4f>; // per instance (display grid)

struct VsOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) @interpolate(flat) color: vec3f,
  @location(2) @interpolate(flat) ids: vec3u,  // object id, segment, flags (bit 0 selected)
};

fn quat_rotate(q: vec4f, v: vec3f) -> vec3f {
  let u = 2.0 * cross(q.xyz, v);
  return v + q.w * u + cross(q.xyz, u);
}

struct ShadowOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
};

// Pushes a vertex outside the clip volume so its triangle is dropped.
const CULLED = vec4f(0.0, 0.0, -2.0, 1.0);

fn world_of(pos: vec3f, body: u32, inst: u32) -> vec3f {
  let s = inst * params.num_bodies + body;
  return poses[2u * s].xyz + quat_rotate(poses[2u * s + 1u], pos) + offsets[inst].xyz;
}

fn hidden(body: u32, inst: u32) -> bool {
  return (seg_color[inst * params.num_bodies + body] >> 24u) == 0u;
}

@vertex
fn vs_main(@location(0) pos: vec3f, @location(1) body: u32,
           @builtin(instance_index) inst: u32) -> VsOut {
  let s = inst * params.num_bodies + body;
  let w = world_of(pos, body, inst);
  var out: VsOut;
  out.world = w;
  out.clip = select(frame.view_proj * vec4f(w, 1.0), CULLED, hidden(body, inst));
  out.color = unpack_srgb(seg_color[s]);
  out.ids = vec3u(params.object_id, s, u32((seg_color[s] >> 24u) == 254u));
  return out;
}

@vertex
fn vs_shadow(@location(0) pos: vec3f, @location(1) body: u32,
             @builtin(instance_index) inst: u32) -> ShadowOut {
  let w = world_of(pos, body, inst);
  var out: ShadowOut;
  out.world = w;
  out.clip = select(frame.light_view_proj * vec4f(w, 1.0), CULLED, hidden(body, inst));
  return out;
}

// Shared fragment stages of the web client's meshes, as the native mesh.wgsl
// does them for flat-shaded, two-sided, uniformly colored faces: face normals
// from screen-space derivatives (no per-face vertex copies), turned toward
// the viewer. Expects \`params\` (flags, material) and VsOut / ShadowOut.

fn face_normal(in: VsOut) -> vec3f {
  let face = cross(dpdx(in.world), dpdy(in.world));
  let n = select(vec3f(0.0, 0.0, 1.0), normalize(face), dot(face, face) > 1e-30);
  return select(-n, n, dot(n, view_dir(in.world)) >= 0.0);
}

// Fragments on the far side of the slice plane are cut away.
fn clipped(p: vec3f) -> bool {
  return (params.flags & 2u) != 0u && dot(frame.slice.xyz, p) > frame.slice.w;
}

fn surface_color(in: VsOut, n: vec3f) -> vec3f {
  var s: Surface;
  s.albedo = in.color;
  s.n = n;
  s.v = view_dir(in.world);
  s.p = in.world;
  s.ao = sample_ao(in.clip.xy);
  s.shadow = sample_shadow(in.world, n);
  s.metallic = params.material.x;
  s.roughness = params.material.y;
  return shade(s) * frame.style.y;
}

// Lit color into the HDR target (composite.wgsl tone maps and encodes).
@fragment
fn fs_main(in: VsOut) -> @location(0) vec4f {
  let n = face_normal(in);  // derivatives before any discard
  if (clipped(in.world)) {
    discard;
  }
  return vec4f(surface_color(in, n), 1.0);
}

// Weighted blended order-independent transparency (McGuire & Bavoil 2013),
// as mesh.wgsl's fs_transparent; composite.wgsl resolves it.
struct OitOut {
  @location(0) accum: vec4f,
  @location(1) reveal: vec4f,
};

@fragment
fn fs_transparent(in: VsOut) -> OitOut {
  let n = face_normal(in);
  if (clipped(in.world)) {
    discard;
  }
  let color = surface_color(in, n);
  let a = params.material.z;
  let z = view_depth(in.clip.z) / 50.0;
  let w = a * clamp(0.03 / (1e-5 + pow(z, 4.0)), 1e-2, 3e3);
  var out: OitOut;
  out.accum = vec4f(color * a * w, a * w);
  out.reveal = vec4f(a);
  return out;
}

struct PrepassOut {
  @location(0) normal: vec4f,  // view-space normal
  @location(1) ids: vec4u,     // object id, face (unused), segment, flags (bit 0 selected)
};

@fragment
fn fs_prepass(in: VsOut) -> PrepassOut {
  let n = face_normal(in);
  if (clipped(in.world)) {
    discard;
  }
  var out: PrepassOut;
  out.normal = vec4f(to_view(n), 1.0);
  out.ids = vec4u(in.ids.x, 0u, in.ids.y, in.ids.z);
  return out;
}

@fragment
fn fs_shadow(in: ShadowOut) {
  if (clipped(in.world)) {
    discard;
  }
}

`,v=`// Web client: rigid bodies drawn from BODY-LOCAL vertices and one pose per
// (instance, body), so a frame only uploads the poses. One instanced draw per
// rigid mesh (instance = env). Shading, prepass and shadow follow the native
// mesh.wgsl (shared frame/scene helpers and the style's shade()); see
// surface.wgsl for the fragment stages.
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

// ENVIRONMENT PBR — physically based metal/roughness materials lit only by an
// environment image (image-based lighting), like EEVEE or three.js with an
// HDRI. Change the mood by swapping or rotating the environment, never by
// placing lights. The sun shadow darkens the environment light it blocks.
//
// Material: s.metallic, s.roughness (per structure, see SurfaceMesh).
// Knobs: frame.env.y = environment intensity, frame.env.x = rotation.

// Analytic fit of the split-sum BRDF integral (Karis, "Mobile PBR", 2014).
fn env_brdf(f0: vec3f, roughness: f32, n_dot_v: f32) -> vec3f {
  let c0 = vec4f(-1.0, -0.0275, -0.572, 0.022);
  let c1 = vec4f(1.0, 0.0425, 1.04, -0.04);
  let r = roughness * c0 + c1;
  let a004 = min(r.x * r.x, exp2(-9.28 * n_dot_v)) * r.x + r.y;
  let ab = vec2f(-1.04, 1.04) * a004 + r.zw;
  return f0 * ab.x + ab.y;
}

fn shade(s: Surface) -> vec3f {
  let n_dot_v = max(dot(s.n, s.v), 1e-4);
  let f0 = mix(vec3f(0.04), s.albedo, s.metallic);

  let diffuse = s.albedo * (1.0 - s.metallic) * env_irradiance(s.n);

  let r = reflect(-s.v, s.n);
  let lod = sqrt(s.roughness) * frame.env.z;
  let reflected = textureSampleLevel(env_tex, repeat_sampler, env_uv(r), lod).rgb;
  let specular = reflected * env_brdf(f0, s.roughness, n_dot_v);

  let occlusion = s.ao * mix(0.35, 1.0, s.shadow);
  return (diffuse + specular) * occlusion * frame.env.y;
}


struct Params {
  num_bodies: u32,
  object_id: u32,
  flags: u32,          // bit 1: cut by the slice plane (as MeshObject.flags)
  _pad0: u32,
  material: vec4f,     // x = metallic, y = roughness, z = opacity
};

@group(1) @binding(0) var<uniform> params: Params;
@group(1) @binding(1) var<storage, read> poses: array<vec4f>;   // 2 per segment: t, q (xyzw)
@group(1) @binding(2) var<storage, read> seg_color: array<u32>; // packed sRGB; a = 0 hidden, 254 selected
@group(1) @binding(3) var<storage, read> offsets: array<vec4f>; // per instance (display grid)

struct VsOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) @interpolate(flat) color: vec3f,
  @location(2) @interpolate(flat) ids: vec3u,  // object id, segment, flags (bit 0 selected)
};

fn quat_rotate(q: vec4f, v: vec3f) -> vec3f {
  let u = 2.0 * cross(q.xyz, v);
  return v + q.w * u + cross(q.xyz, u);
}

struct ShadowOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
};

// Pushes a vertex outside the clip volume so its triangle is dropped.
const CULLED = vec4f(0.0, 0.0, -2.0, 1.0);

fn world_of(pos: vec3f, body: u32, inst: u32) -> vec3f {
  let s = inst * params.num_bodies + body;
  return poses[2u * s].xyz + quat_rotate(poses[2u * s + 1u], pos) + offsets[inst].xyz;
}

fn hidden(body: u32, inst: u32) -> bool {
  return (seg_color[inst * params.num_bodies + body] >> 24u) == 0u;
}

@vertex
fn vs_main(@location(0) pos: vec3f, @location(1) body: u32,
           @builtin(instance_index) inst: u32) -> VsOut {
  let s = inst * params.num_bodies + body;
  let w = world_of(pos, body, inst);
  var out: VsOut;
  out.world = w;
  out.clip = select(frame.view_proj * vec4f(w, 1.0), CULLED, hidden(body, inst));
  out.color = unpack_srgb(seg_color[s]);
  out.ids = vec3u(params.object_id, s, u32((seg_color[s] >> 24u) == 254u));
  return out;
}

@vertex
fn vs_shadow(@location(0) pos: vec3f, @location(1) body: u32,
             @builtin(instance_index) inst: u32) -> ShadowOut {
  let w = world_of(pos, body, inst);
  var out: ShadowOut;
  out.world = w;
  out.clip = select(frame.light_view_proj * vec4f(w, 1.0), CULLED, hidden(body, inst));
  return out;
}

// Shared fragment stages of the web client's meshes, as the native mesh.wgsl
// does them for flat-shaded, two-sided, uniformly colored faces: face normals
// from screen-space derivatives (no per-face vertex copies), turned toward
// the viewer. Expects \`params\` (flags, material) and VsOut / ShadowOut.

fn face_normal(in: VsOut) -> vec3f {
  let face = cross(dpdx(in.world), dpdy(in.world));
  let n = select(vec3f(0.0, 0.0, 1.0), normalize(face), dot(face, face) > 1e-30);
  return select(-n, n, dot(n, view_dir(in.world)) >= 0.0);
}

// Fragments on the far side of the slice plane are cut away.
fn clipped(p: vec3f) -> bool {
  return (params.flags & 2u) != 0u && dot(frame.slice.xyz, p) > frame.slice.w;
}

fn surface_color(in: VsOut, n: vec3f) -> vec3f {
  var s: Surface;
  s.albedo = in.color;
  s.n = n;
  s.v = view_dir(in.world);
  s.p = in.world;
  s.ao = sample_ao(in.clip.xy);
  s.shadow = sample_shadow(in.world, n);
  s.metallic = params.material.x;
  s.roughness = params.material.y;
  return shade(s) * frame.style.y;
}

// Lit color into the HDR target (composite.wgsl tone maps and encodes).
@fragment
fn fs_main(in: VsOut) -> @location(0) vec4f {
  let n = face_normal(in);  // derivatives before any discard
  if (clipped(in.world)) {
    discard;
  }
  return vec4f(surface_color(in, n), 1.0);
}

// Weighted blended order-independent transparency (McGuire & Bavoil 2013),
// as mesh.wgsl's fs_transparent; composite.wgsl resolves it.
struct OitOut {
  @location(0) accum: vec4f,
  @location(1) reveal: vec4f,
};

@fragment
fn fs_transparent(in: VsOut) -> OitOut {
  let n = face_normal(in);
  if (clipped(in.world)) {
    discard;
  }
  let color = surface_color(in, n);
  let a = params.material.z;
  let z = view_depth(in.clip.z) / 50.0;
  let w = a * clamp(0.03 / (1e-5 + pow(z, 4.0)), 1e-2, 3e3);
  var out: OitOut;
  out.accum = vec4f(color * a * w, a * w);
  out.reveal = vec4f(a);
  return out;
}

struct PrepassOut {
  @location(0) normal: vec4f,  // view-space normal
  @location(1) ids: vec4u,     // object id, face (unused), segment, flags (bit 0 selected)
};

@fragment
fn fs_prepass(in: VsOut) -> PrepassOut {
  let n = face_normal(in);
  if (clipped(in.world)) {
    discard;
  }
  var out: PrepassOut;
  out.normal = vec4f(to_view(n), 1.0);
  out.ids = vec4u(in.ids.x, 0u, in.ids.y, in.ids.z);
  return out;
}

@fragment
fn fs_shadow(in: ShadowOut) {
  if (clipped(in.world)) {
    discard;
  }
}

`,y=`// Web client: rigid bodies drawn from BODY-LOCAL vertices and one pose per
// (instance, body), so a frame only uploads the poses. One instanced draw per
// rigid mesh (instance = env). Shading, prepass and shadow follow the native
// mesh.wgsl (shared frame/scene helpers and the style's shade()); see
// surface.wgsl for the fragment stages.
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

// TECHNICAL — Gooch "cool-to-warm" shading, as in technical illustration.
// Surfaces turning away from the (camera-attached) light shift toward a cool
// tone instead of going dark, so shape stays readable while colors, including
// colormaps, stay faithful. Outlines are drawn later in composite.wgsl.
//
// Knobs: frame.style2.x = cool/warm hue shift
//        frame.style2.y = shading contrast (0 = flat)

fn shade(s: Surface) -> vec3f {
  let n = to_view(s.n);
  let l = normalize(vec3f(-0.40, 0.60, 0.70));
  let t = dot(n, l) * 0.5 + 0.5;  // 0 = facing away, 1 = facing the light

  // The tints multiply the base color, so dark colors (e.g. the low end of a
  // colormap) keep their hue instead of being washed toward the tint.
  let k = frame.style2.x;
  let contrast = frame.style2.y;
  let cool = s.albedo * (1.0 - 0.45 * contrast) * pow(vec3f(0.90, 0.96, 1.10), vec3f(k));
  let warm = s.albedo * (1.0 + 0.10 * contrast) * pow(vec3f(1.06, 1.02, 0.92), vec3f(k));

  let occlusion = mix(0.7, 1.0, s.ao) * mix(0.75, 1.0, s.shadow);
  return mix(cool, warm, t) * occlusion;
}


struct Params {
  num_bodies: u32,
  object_id: u32,
  flags: u32,          // bit 1: cut by the slice plane (as MeshObject.flags)
  _pad0: u32,
  material: vec4f,     // x = metallic, y = roughness, z = opacity
};

@group(1) @binding(0) var<uniform> params: Params;
@group(1) @binding(1) var<storage, read> poses: array<vec4f>;   // 2 per segment: t, q (xyzw)
@group(1) @binding(2) var<storage, read> seg_color: array<u32>; // packed sRGB; a = 0 hidden, 254 selected
@group(1) @binding(3) var<storage, read> offsets: array<vec4f>; // per instance (display grid)

struct VsOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) @interpolate(flat) color: vec3f,
  @location(2) @interpolate(flat) ids: vec3u,  // object id, segment, flags (bit 0 selected)
};

fn quat_rotate(q: vec4f, v: vec3f) -> vec3f {
  let u = 2.0 * cross(q.xyz, v);
  return v + q.w * u + cross(q.xyz, u);
}

struct ShadowOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
};

// Pushes a vertex outside the clip volume so its triangle is dropped.
const CULLED = vec4f(0.0, 0.0, -2.0, 1.0);

fn world_of(pos: vec3f, body: u32, inst: u32) -> vec3f {
  let s = inst * params.num_bodies + body;
  return poses[2u * s].xyz + quat_rotate(poses[2u * s + 1u], pos) + offsets[inst].xyz;
}

fn hidden(body: u32, inst: u32) -> bool {
  return (seg_color[inst * params.num_bodies + body] >> 24u) == 0u;
}

@vertex
fn vs_main(@location(0) pos: vec3f, @location(1) body: u32,
           @builtin(instance_index) inst: u32) -> VsOut {
  let s = inst * params.num_bodies + body;
  let w = world_of(pos, body, inst);
  var out: VsOut;
  out.world = w;
  out.clip = select(frame.view_proj * vec4f(w, 1.0), CULLED, hidden(body, inst));
  out.color = unpack_srgb(seg_color[s]);
  out.ids = vec3u(params.object_id, s, u32((seg_color[s] >> 24u) == 254u));
  return out;
}

@vertex
fn vs_shadow(@location(0) pos: vec3f, @location(1) body: u32,
             @builtin(instance_index) inst: u32) -> ShadowOut {
  let w = world_of(pos, body, inst);
  var out: ShadowOut;
  out.world = w;
  out.clip = select(frame.light_view_proj * vec4f(w, 1.0), CULLED, hidden(body, inst));
  return out;
}

// Shared fragment stages of the web client's meshes, as the native mesh.wgsl
// does them for flat-shaded, two-sided, uniformly colored faces: face normals
// from screen-space derivatives (no per-face vertex copies), turned toward
// the viewer. Expects \`params\` (flags, material) and VsOut / ShadowOut.

fn face_normal(in: VsOut) -> vec3f {
  let face = cross(dpdx(in.world), dpdy(in.world));
  let n = select(vec3f(0.0, 0.0, 1.0), normalize(face), dot(face, face) > 1e-30);
  return select(-n, n, dot(n, view_dir(in.world)) >= 0.0);
}

// Fragments on the far side of the slice plane are cut away.
fn clipped(p: vec3f) -> bool {
  return (params.flags & 2u) != 0u && dot(frame.slice.xyz, p) > frame.slice.w;
}

fn surface_color(in: VsOut, n: vec3f) -> vec3f {
  var s: Surface;
  s.albedo = in.color;
  s.n = n;
  s.v = view_dir(in.world);
  s.p = in.world;
  s.ao = sample_ao(in.clip.xy);
  s.shadow = sample_shadow(in.world, n);
  s.metallic = params.material.x;
  s.roughness = params.material.y;
  return shade(s) * frame.style.y;
}

// Lit color into the HDR target (composite.wgsl tone maps and encodes).
@fragment
fn fs_main(in: VsOut) -> @location(0) vec4f {
  let n = face_normal(in);  // derivatives before any discard
  if (clipped(in.world)) {
    discard;
  }
  return vec4f(surface_color(in, n), 1.0);
}

// Weighted blended order-independent transparency (McGuire & Bavoil 2013),
// as mesh.wgsl's fs_transparent; composite.wgsl resolves it.
struct OitOut {
  @location(0) accum: vec4f,
  @location(1) reveal: vec4f,
};

@fragment
fn fs_transparent(in: VsOut) -> OitOut {
  let n = face_normal(in);
  if (clipped(in.world)) {
    discard;
  }
  let color = surface_color(in, n);
  let a = params.material.z;
  let z = view_depth(in.clip.z) / 50.0;
  let w = a * clamp(0.03 / (1e-5 + pow(z, 4.0)), 1e-2, 3e3);
  var out: OitOut;
  out.accum = vec4f(color * a * w, a * w);
  out.reveal = vec4f(a);
  return out;
}

struct PrepassOut {
  @location(0) normal: vec4f,  // view-space normal
  @location(1) ids: vec4u,     // object id, face (unused), segment, flags (bit 0 selected)
};

@fragment
fn fs_prepass(in: VsOut) -> PrepassOut {
  let n = face_normal(in);
  if (clipped(in.world)) {
    discard;
  }
  var out: PrepassOut;
  out.normal = vec4f(to_view(n), 1.0);
  out.ids = vec4u(in.ids.x, 0u, in.ids.y, in.ids.z);
  return out;
}

@fragment
fn fs_shadow(in: ShadowOut) {
  if (clipped(in.world)) {
    discard;
  }
}

`,b=`// Web client: small geometry rebuilt on the CPU when it changes (meter boxes,
// markers): world-space vertices with a packed sRGB color each. Fragment
// stages in surface.wgsl.
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
  object_id: u32,
  flags: u32,          // bit 1: cut by the slice plane (as MeshObject.flags)
  _pad0: u32,
  _pad1: u32,
  material: vec4f,     // x = metallic, y = roughness, z = opacity
};

@group(1) @binding(0) var<uniform> params: Params;

struct VsOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) @interpolate(flat) color: vec3f,
  @location(2) @interpolate(flat) ids: vec3u,  // object id, segment (one per object), flags
};

@vertex
fn vs_main(@location(0) pos: vec3f, @location(1) color: u32) -> VsOut {
  var out: VsOut;
  out.world = pos;
  out.clip = frame.view_proj * vec4f(pos, 1.0);
  out.color = unpack_srgb(color);
  out.ids = vec3u(params.object_id, 0u, 0u);
  return out;
}

struct ShadowOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
};

@vertex
fn vs_shadow(@location(0) pos: vec3f, @location(1) color: u32) -> ShadowOut {
  var out: ShadowOut;
  out.world = pos;
  out.clip = frame.light_view_proj * vec4f(pos, 1.0);
  return out;
}

// Shared fragment stages of the web client's meshes, as the native mesh.wgsl
// does them for flat-shaded, two-sided, uniformly colored faces: face normals
// from screen-space derivatives (no per-face vertex copies), turned toward
// the viewer. Expects \`params\` (flags, material) and VsOut / ShadowOut.

fn face_normal(in: VsOut) -> vec3f {
  let face = cross(dpdx(in.world), dpdy(in.world));
  let n = select(vec3f(0.0, 0.0, 1.0), normalize(face), dot(face, face) > 1e-30);
  return select(-n, n, dot(n, view_dir(in.world)) >= 0.0);
}

// Fragments on the far side of the slice plane are cut away.
fn clipped(p: vec3f) -> bool {
  return (params.flags & 2u) != 0u && dot(frame.slice.xyz, p) > frame.slice.w;
}

fn surface_color(in: VsOut, n: vec3f) -> vec3f {
  var s: Surface;
  s.albedo = in.color;
  s.n = n;
  s.v = view_dir(in.world);
  s.p = in.world;
  s.ao = sample_ao(in.clip.xy);
  s.shadow = sample_shadow(in.world, n);
  s.metallic = params.material.x;
  s.roughness = params.material.y;
  return shade(s) * frame.style.y;
}

// Lit color into the HDR target (composite.wgsl tone maps and encodes).
@fragment
fn fs_main(in: VsOut) -> @location(0) vec4f {
  let n = face_normal(in);  // derivatives before any discard
  if (clipped(in.world)) {
    discard;
  }
  return vec4f(surface_color(in, n), 1.0);
}

// Weighted blended order-independent transparency (McGuire & Bavoil 2013),
// as mesh.wgsl's fs_transparent; composite.wgsl resolves it.
struct OitOut {
  @location(0) accum: vec4f,
  @location(1) reveal: vec4f,
};

@fragment
fn fs_transparent(in: VsOut) -> OitOut {
  let n = face_normal(in);
  if (clipped(in.world)) {
    discard;
  }
  let color = surface_color(in, n);
  let a = params.material.z;
  let z = view_depth(in.clip.z) / 50.0;
  let w = a * clamp(0.03 / (1e-5 + pow(z, 4.0)), 1e-2, 3e3);
  var out: OitOut;
  out.accum = vec4f(color * a * w, a * w);
  out.reveal = vec4f(a);
  return out;
}

struct PrepassOut {
  @location(0) normal: vec4f,  // view-space normal
  @location(1) ids: vec4u,     // object id, face (unused), segment, flags (bit 0 selected)
};

@fragment
fn fs_prepass(in: VsOut) -> PrepassOut {
  let n = face_normal(in);
  if (clipped(in.world)) {
    discard;
  }
  var out: PrepassOut;
  out.normal = vec4f(to_view(n), 1.0);
  out.ids = vec4u(in.ids.x, 0u, in.ids.y, in.ids.z);
  return out;
}

@fragment
fn fs_shadow(in: ShadowOut) {
  if (clipped(in.world)) {
    discard;
  }
}

`,x=`// Web client: small geometry rebuilt on the CPU when it changes (meter boxes,
// markers): world-space vertices with a packed sRGB color each. Fragment
// stages in surface.wgsl.
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

// MATCAP — "material capture": all lighting is baked into a picture of a lit
// sphere. The surface normal, seen from the camera, picks the pixel of that
// sphere to use. Swap the picture to restyle everything; there are no lights.
//
// Matcap texture: rgb = shading (neutral gray for tintable presets),
//                 a   = white highlight added on top.
// Knobs: frame.style2.x = tint (0 = picture colors as-is, 1 = times object color)

fn shade(s: Surface) -> vec3f {
  let n = to_view(s.n);
  let uv = vec2f(n.x, -n.y) * 0.485 + 0.5;
  let m = textureSampleLevel(matcap_tex, clamp_sampler, uv, 0.0);
  let tint = mix(vec3f(1.0), s.albedo * 1.6, frame.style2.x);
  let occlusion = s.ao * mix(0.6, 1.0, s.shadow);
  return (m.rgb * tint + vec3f(m.a)) * occlusion;
}


struct Params {
  object_id: u32,
  flags: u32,          // bit 1: cut by the slice plane (as MeshObject.flags)
  _pad0: u32,
  _pad1: u32,
  material: vec4f,     // x = metallic, y = roughness, z = opacity
};

@group(1) @binding(0) var<uniform> params: Params;

struct VsOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) @interpolate(flat) color: vec3f,
  @location(2) @interpolate(flat) ids: vec3u,  // object id, segment (one per object), flags
};

@vertex
fn vs_main(@location(0) pos: vec3f, @location(1) color: u32) -> VsOut {
  var out: VsOut;
  out.world = pos;
  out.clip = frame.view_proj * vec4f(pos, 1.0);
  out.color = unpack_srgb(color);
  out.ids = vec3u(params.object_id, 0u, 0u);
  return out;
}

struct ShadowOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
};

@vertex
fn vs_shadow(@location(0) pos: vec3f, @location(1) color: u32) -> ShadowOut {
  var out: ShadowOut;
  out.world = pos;
  out.clip = frame.light_view_proj * vec4f(pos, 1.0);
  return out;
}

// Shared fragment stages of the web client's meshes, as the native mesh.wgsl
// does them for flat-shaded, two-sided, uniformly colored faces: face normals
// from screen-space derivatives (no per-face vertex copies), turned toward
// the viewer. Expects \`params\` (flags, material) and VsOut / ShadowOut.

fn face_normal(in: VsOut) -> vec3f {
  let face = cross(dpdx(in.world), dpdy(in.world));
  let n = select(vec3f(0.0, 0.0, 1.0), normalize(face), dot(face, face) > 1e-30);
  return select(-n, n, dot(n, view_dir(in.world)) >= 0.0);
}

// Fragments on the far side of the slice plane are cut away.
fn clipped(p: vec3f) -> bool {
  return (params.flags & 2u) != 0u && dot(frame.slice.xyz, p) > frame.slice.w;
}

fn surface_color(in: VsOut, n: vec3f) -> vec3f {
  var s: Surface;
  s.albedo = in.color;
  s.n = n;
  s.v = view_dir(in.world);
  s.p = in.world;
  s.ao = sample_ao(in.clip.xy);
  s.shadow = sample_shadow(in.world, n);
  s.metallic = params.material.x;
  s.roughness = params.material.y;
  return shade(s) * frame.style.y;
}

// Lit color into the HDR target (composite.wgsl tone maps and encodes).
@fragment
fn fs_main(in: VsOut) -> @location(0) vec4f {
  let n = face_normal(in);  // derivatives before any discard
  if (clipped(in.world)) {
    discard;
  }
  return vec4f(surface_color(in, n), 1.0);
}

// Weighted blended order-independent transparency (McGuire & Bavoil 2013),
// as mesh.wgsl's fs_transparent; composite.wgsl resolves it.
struct OitOut {
  @location(0) accum: vec4f,
  @location(1) reveal: vec4f,
};

@fragment
fn fs_transparent(in: VsOut) -> OitOut {
  let n = face_normal(in);
  if (clipped(in.world)) {
    discard;
  }
  let color = surface_color(in, n);
  let a = params.material.z;
  let z = view_depth(in.clip.z) / 50.0;
  let w = a * clamp(0.03 / (1e-5 + pow(z, 4.0)), 1e-2, 3e3);
  var out: OitOut;
  out.accum = vec4f(color * a * w, a * w);
  out.reveal = vec4f(a);
  return out;
}

struct PrepassOut {
  @location(0) normal: vec4f,  // view-space normal
  @location(1) ids: vec4u,     // object id, face (unused), segment, flags (bit 0 selected)
};

@fragment
fn fs_prepass(in: VsOut) -> PrepassOut {
  let n = face_normal(in);
  if (clipped(in.world)) {
    discard;
  }
  var out: PrepassOut;
  out.normal = vec4f(to_view(n), 1.0);
  out.ids = vec4u(in.ids.x, 0u, in.ids.y, in.ids.z);
  return out;
}

@fragment
fn fs_shadow(in: ShadowOut) {
  if (clipped(in.world)) {
    discard;
  }
}

`,S=`// Web client: small geometry rebuilt on the CPU when it changes (meter boxes,
// markers): world-space vertices with a packed sRGB color each. Fragment
// stages in surface.wgsl.
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

// ENVIRONMENT PBR — physically based metal/roughness materials lit only by an
// environment image (image-based lighting), like EEVEE or three.js with an
// HDRI. Change the mood by swapping or rotating the environment, never by
// placing lights. The sun shadow darkens the environment light it blocks.
//
// Material: s.metallic, s.roughness (per structure, see SurfaceMesh).
// Knobs: frame.env.y = environment intensity, frame.env.x = rotation.

// Analytic fit of the split-sum BRDF integral (Karis, "Mobile PBR", 2014).
fn env_brdf(f0: vec3f, roughness: f32, n_dot_v: f32) -> vec3f {
  let c0 = vec4f(-1.0, -0.0275, -0.572, 0.022);
  let c1 = vec4f(1.0, 0.0425, 1.04, -0.04);
  let r = roughness * c0 + c1;
  let a004 = min(r.x * r.x, exp2(-9.28 * n_dot_v)) * r.x + r.y;
  let ab = vec2f(-1.04, 1.04) * a004 + r.zw;
  return f0 * ab.x + ab.y;
}

fn shade(s: Surface) -> vec3f {
  let n_dot_v = max(dot(s.n, s.v), 1e-4);
  let f0 = mix(vec3f(0.04), s.albedo, s.metallic);

  let diffuse = s.albedo * (1.0 - s.metallic) * env_irradiance(s.n);

  let r = reflect(-s.v, s.n);
  let lod = sqrt(s.roughness) * frame.env.z;
  let reflected = textureSampleLevel(env_tex, repeat_sampler, env_uv(r), lod).rgb;
  let specular = reflected * env_brdf(f0, s.roughness, n_dot_v);

  let occlusion = s.ao * mix(0.35, 1.0, s.shadow);
  return (diffuse + specular) * occlusion * frame.env.y;
}


struct Params {
  object_id: u32,
  flags: u32,          // bit 1: cut by the slice plane (as MeshObject.flags)
  _pad0: u32,
  _pad1: u32,
  material: vec4f,     // x = metallic, y = roughness, z = opacity
};

@group(1) @binding(0) var<uniform> params: Params;

struct VsOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) @interpolate(flat) color: vec3f,
  @location(2) @interpolate(flat) ids: vec3u,  // object id, segment (one per object), flags
};

@vertex
fn vs_main(@location(0) pos: vec3f, @location(1) color: u32) -> VsOut {
  var out: VsOut;
  out.world = pos;
  out.clip = frame.view_proj * vec4f(pos, 1.0);
  out.color = unpack_srgb(color);
  out.ids = vec3u(params.object_id, 0u, 0u);
  return out;
}

struct ShadowOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
};

@vertex
fn vs_shadow(@location(0) pos: vec3f, @location(1) color: u32) -> ShadowOut {
  var out: ShadowOut;
  out.world = pos;
  out.clip = frame.light_view_proj * vec4f(pos, 1.0);
  return out;
}

// Shared fragment stages of the web client's meshes, as the native mesh.wgsl
// does them for flat-shaded, two-sided, uniformly colored faces: face normals
// from screen-space derivatives (no per-face vertex copies), turned toward
// the viewer. Expects \`params\` (flags, material) and VsOut / ShadowOut.

fn face_normal(in: VsOut) -> vec3f {
  let face = cross(dpdx(in.world), dpdy(in.world));
  let n = select(vec3f(0.0, 0.0, 1.0), normalize(face), dot(face, face) > 1e-30);
  return select(-n, n, dot(n, view_dir(in.world)) >= 0.0);
}

// Fragments on the far side of the slice plane are cut away.
fn clipped(p: vec3f) -> bool {
  return (params.flags & 2u) != 0u && dot(frame.slice.xyz, p) > frame.slice.w;
}

fn surface_color(in: VsOut, n: vec3f) -> vec3f {
  var s: Surface;
  s.albedo = in.color;
  s.n = n;
  s.v = view_dir(in.world);
  s.p = in.world;
  s.ao = sample_ao(in.clip.xy);
  s.shadow = sample_shadow(in.world, n);
  s.metallic = params.material.x;
  s.roughness = params.material.y;
  return shade(s) * frame.style.y;
}

// Lit color into the HDR target (composite.wgsl tone maps and encodes).
@fragment
fn fs_main(in: VsOut) -> @location(0) vec4f {
  let n = face_normal(in);  // derivatives before any discard
  if (clipped(in.world)) {
    discard;
  }
  return vec4f(surface_color(in, n), 1.0);
}

// Weighted blended order-independent transparency (McGuire & Bavoil 2013),
// as mesh.wgsl's fs_transparent; composite.wgsl resolves it.
struct OitOut {
  @location(0) accum: vec4f,
  @location(1) reveal: vec4f,
};

@fragment
fn fs_transparent(in: VsOut) -> OitOut {
  let n = face_normal(in);
  if (clipped(in.world)) {
    discard;
  }
  let color = surface_color(in, n);
  let a = params.material.z;
  let z = view_depth(in.clip.z) / 50.0;
  let w = a * clamp(0.03 / (1e-5 + pow(z, 4.0)), 1e-2, 3e3);
  var out: OitOut;
  out.accum = vec4f(color * a * w, a * w);
  out.reveal = vec4f(a);
  return out;
}

struct PrepassOut {
  @location(0) normal: vec4f,  // view-space normal
  @location(1) ids: vec4u,     // object id, face (unused), segment, flags (bit 0 selected)
};

@fragment
fn fs_prepass(in: VsOut) -> PrepassOut {
  let n = face_normal(in);
  if (clipped(in.world)) {
    discard;
  }
  var out: PrepassOut;
  out.normal = vec4f(to_view(n), 1.0);
  out.ids = vec4u(in.ids.x, 0u, in.ids.y, in.ids.z);
  return out;
}

@fragment
fn fs_shadow(in: ShadowOut) {
  if (clipped(in.world)) {
    discard;
  }
}

`,ee=`// Web client: small geometry rebuilt on the CPU when it changes (meter boxes,
// markers): world-space vertices with a packed sRGB color each. Fragment
// stages in surface.wgsl.
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

// TECHNICAL — Gooch "cool-to-warm" shading, as in technical illustration.
// Surfaces turning away from the (camera-attached) light shift toward a cool
// tone instead of going dark, so shape stays readable while colors, including
// colormaps, stay faithful. Outlines are drawn later in composite.wgsl.
//
// Knobs: frame.style2.x = cool/warm hue shift
//        frame.style2.y = shading contrast (0 = flat)

fn shade(s: Surface) -> vec3f {
  let n = to_view(s.n);
  let l = normalize(vec3f(-0.40, 0.60, 0.70));
  let t = dot(n, l) * 0.5 + 0.5;  // 0 = facing away, 1 = facing the light

  // The tints multiply the base color, so dark colors (e.g. the low end of a
  // colormap) keep their hue instead of being washed toward the tint.
  let k = frame.style2.x;
  let contrast = frame.style2.y;
  let cool = s.albedo * (1.0 - 0.45 * contrast) * pow(vec3f(0.90, 0.96, 1.10), vec3f(k));
  let warm = s.albedo * (1.0 + 0.10 * contrast) * pow(vec3f(1.06, 1.02, 0.92), vec3f(k));

  let occlusion = mix(0.7, 1.0, s.ao) * mix(0.75, 1.0, s.shadow);
  return mix(cool, warm, t) * occlusion;
}


struct Params {
  object_id: u32,
  flags: u32,          // bit 1: cut by the slice plane (as MeshObject.flags)
  _pad0: u32,
  _pad1: u32,
  material: vec4f,     // x = metallic, y = roughness, z = opacity
};

@group(1) @binding(0) var<uniform> params: Params;

struct VsOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) @interpolate(flat) color: vec3f,
  @location(2) @interpolate(flat) ids: vec3u,  // object id, segment (one per object), flags
};

@vertex
fn vs_main(@location(0) pos: vec3f, @location(1) color: u32) -> VsOut {
  var out: VsOut;
  out.world = pos;
  out.clip = frame.view_proj * vec4f(pos, 1.0);
  out.color = unpack_srgb(color);
  out.ids = vec3u(params.object_id, 0u, 0u);
  return out;
}

struct ShadowOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
};

@vertex
fn vs_shadow(@location(0) pos: vec3f, @location(1) color: u32) -> ShadowOut {
  var out: ShadowOut;
  out.world = pos;
  out.clip = frame.light_view_proj * vec4f(pos, 1.0);
  return out;
}

// Shared fragment stages of the web client's meshes, as the native mesh.wgsl
// does them for flat-shaded, two-sided, uniformly colored faces: face normals
// from screen-space derivatives (no per-face vertex copies), turned toward
// the viewer. Expects \`params\` (flags, material) and VsOut / ShadowOut.

fn face_normal(in: VsOut) -> vec3f {
  let face = cross(dpdx(in.world), dpdy(in.world));
  let n = select(vec3f(0.0, 0.0, 1.0), normalize(face), dot(face, face) > 1e-30);
  return select(-n, n, dot(n, view_dir(in.world)) >= 0.0);
}

// Fragments on the far side of the slice plane are cut away.
fn clipped(p: vec3f) -> bool {
  return (params.flags & 2u) != 0u && dot(frame.slice.xyz, p) > frame.slice.w;
}

fn surface_color(in: VsOut, n: vec3f) -> vec3f {
  var s: Surface;
  s.albedo = in.color;
  s.n = n;
  s.v = view_dir(in.world);
  s.p = in.world;
  s.ao = sample_ao(in.clip.xy);
  s.shadow = sample_shadow(in.world, n);
  s.metallic = params.material.x;
  s.roughness = params.material.y;
  return shade(s) * frame.style.y;
}

// Lit color into the HDR target (composite.wgsl tone maps and encodes).
@fragment
fn fs_main(in: VsOut) -> @location(0) vec4f {
  let n = face_normal(in);  // derivatives before any discard
  if (clipped(in.world)) {
    discard;
  }
  return vec4f(surface_color(in, n), 1.0);
}

// Weighted blended order-independent transparency (McGuire & Bavoil 2013),
// as mesh.wgsl's fs_transparent; composite.wgsl resolves it.
struct OitOut {
  @location(0) accum: vec4f,
  @location(1) reveal: vec4f,
};

@fragment
fn fs_transparent(in: VsOut) -> OitOut {
  let n = face_normal(in);
  if (clipped(in.world)) {
    discard;
  }
  let color = surface_color(in, n);
  let a = params.material.z;
  let z = view_depth(in.clip.z) / 50.0;
  let w = a * clamp(0.03 / (1e-5 + pow(z, 4.0)), 1e-2, 3e3);
  var out: OitOut;
  out.accum = vec4f(color * a * w, a * w);
  out.reveal = vec4f(a);
  return out;
}

struct PrepassOut {
  @location(0) normal: vec4f,  // view-space normal
  @location(1) ids: vec4u,     // object id, face (unused), segment, flags (bit 0 selected)
};

@fragment
fn fs_prepass(in: VsOut) -> PrepassOut {
  let n = face_normal(in);
  if (clipped(in.world)) {
    discard;
  }
  var out: PrepassOut;
  out.normal = vec4f(to_view(n), 1.0);
  out.ids = vec4u(in.ids.x, 0u, in.ids.y, in.ids.z);
  return out;
}

@fragment
fn fs_shadow(in: ShadowOut) {
  if (clipped(in.world)) {
    discard;
  }
}

`,te=`// The native viewer's screen-space ambient occlusion, unchanged.
// Screen-space ambient occlusion from the prepass depth + normals.
// Estimator: McGuire et al., "Scalable Ambient Obscurance" (HPG 2012).
// A cheap way to darken creases and contact points without any lights.

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


@group(0) @binding(1) var depth_tex: texture_depth_2d;
@group(0) @binding(2) var normal_tex: texture_2d<f32>;
@group(0) @binding(3) var ao_raw: texture_2d<f32>;  // blur pass input

struct VsOut {
  @builtin(position) clip: vec4f,
};

@vertex
fn vs_fullscreen(@builtin(vertex_index) vid: u32) -> VsOut {
  let uv = vec2f(f32((vid << 1u) & 2u), f32(vid & 2u));
  var out: VsOut;
  out.clip = vec4f(uv * 2.0 - 1.0, 0.0, 1.0);
  return out;
}

fn view_pos(px: vec2i) -> vec3f {
  let d = textureLoad(depth_tex, px, 0);
  let uv = (vec2f(px) + 0.5) * frame.viewport.zw;
  let v = frame.inv_proj * vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, max(d, 1e-7), 1.0);
  return v.xyz / v.w;
}

const SAMPLES: i32 = 16;
const TURNS: f32 = 7.0;

@fragment
fn fs_ssao(in: VsOut) -> @location(0) vec4f {
  let px = vec2i(in.clip.xy);
  let size = vec2i(textureDimensions(depth_tex));
  if (textureLoad(depth_tex, px, 0) <= 0.0) {
    return vec4f(1.0);  // sky
  }
  let p = view_pos(px);
  let n = textureLoad(normal_tex, px, 0).xyz;

  let radius = frame.ao.x;
  // Radius in pixels: projected size of \`radius\` at this depth.
  let scale = frame.viewport.y * frame.proj[1][1] * 0.5;
  let radius_px = select(radius * scale / max(-p.z, 1e-4), radius * scale, is_ortho());
  if (radius_px < 1.0) {
    return vec4f(1.0);
  }
  // Each pixel of a 4x4 tile rotates the sample spiral differently; the 4x4
  // blur below then averages all 16 rotations, removing the noise.
  let tile = (px.x & 3) + 4 * (px.y & 3);
  let spin = f32((tile * 7) % 16) / 16.0 * 2.0 * PI;
  let r2 = radius * radius;
  var sum = 0.0;
  for (var i = 0; i < SAMPLES; i++) {
    let alpha = (f32(i) + 0.5) / f32(SAMPLES);
    let angle = alpha * TURNS * 2.0 * PI + spin;
    let offset = vec2f(cos(angle), sin(angle)) * alpha * min(radius_px, 120.0);
    let q_px = clamp(px + vec2i(offset), vec2i(0), size - 1);
    if (textureLoad(depth_tex, q_px, 0) <= 0.0) {
      continue;
    }
    let v = view_pos(q_px) - p;
    let vv = dot(v, v);
    let vn = dot(v, n);
    let f = max(r2 - vv, 0.0);
    sum += f * f * f * max((vn - frame.ao.y * radius) / (0.01 * r2 + vv), 0.0);
  }
  let ao = max(0.0, 1.0 - sum * frame.ao.z * 5.0 / (r2 * r2 * r2 * f32(SAMPLES)));
  return vec4f(ao, ao, ao, 1.0);
}

// 4x4 blur (one full rotation tile) that does not bleed across depth edges.
@fragment
fn fs_blur(in: VsOut) -> @location(0) vec4f {
  let px = vec2i(in.clip.xy);
  let size = vec2i(textureDimensions(ao_raw));
  let z0 = view_pos(px).z;
  var sum = 0.0;
  var weight = 0.0;
  for (var y = -2; y <= 1; y++) {
    for (var x = -2; x <= 1; x++) {
      let q = clamp(px + vec2i(x, y), vec2i(0), size - 1);
      let z = view_pos(q).z;
      let w = 1.0 / (1e-4 + abs(z - z0) / max(abs(z0), 1e-3) * 50.0 + 1.0);
      sum += textureLoad(ao_raw, q, 0).r * w;
      weight += w;
    }
  }
  let ao = sum / weight;
  return vec4f(ao, ao, ao, 1.0);
}

`,ne=`// The native viewer's infinite ground grid (+ shadow / AO catcher), unchanged.
// Infinite grid, drawn as one full-screen triangle: each pixel intersects its
// view ray with the grid plane.
//
// The plane is normally the ground (z = ground height), which also catches
// the sun shadow and ambient occlusion. In an axis-aligned orthographic side
// view it is the view plane through the origin (YZ for the X axis, XZ for Y),
// drawn behind everything, as in Blender.
//
// Line spacing adapts per pixel in powers of ten, so the grid is always a
// readable length scale: minor lines fade in/out as you zoom, every tenth
// line is major, and the two in-plane axes are highlighted in axis colors.

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


struct VsOut {
  @builtin(position) clip: vec4f,
  @location(0) ndc: vec2f,
};

@vertex
fn vs_fullscreen(@builtin(vertex_index) vid: u32) -> VsOut {
  let uv = vec2f(f32((vid << 1u) & 2u), f32(vid & 2u));
  var out: VsOut;
  out.ndc = uv * 2.0 - 1.0;
  out.clip = vec4f(out.ndc, 0.0, 1.0);
  return out;
}

fn unproject(ndc: vec2f, z: f32) -> vec3f {
  let p = frame.inv_view_proj * vec4f(ndc, z, 1.0);
  return p.xyz / p.w;
}

fn is_background() -> bool {
  return frame.grid_plane.y > 0.5;
}

struct PlaneHit {
  pos: vec3f,
  uv: vec2f,    // coordinates along the plane's two axes
  t: f32,       // ray distance; <= 0 means the ray misses the plane
  depth: f32,
  facing: f32,  // |cos| between view ray and plane normal (0 at the horizon)
};

fn plane_hit(ndc: vec2f) -> PlaneHit {
  // Build the view ray from well-separated points: two unprojected points
  // only a near-plane distance apart would give a noisy direction.
  var o = frame.camera_pos.xyz;
  var d = normalize(unproject(ndc, 0.001) - o);  // reversed-Z: 0.001 = 1000x the near distance
  if (is_ortho()) {
    o = unproject(ndc, 1.0);
    d = -normalize(vec3f(frame.view[0].z, frame.view[1].z, frame.view[2].z));
  }
  let n = u32(frame.grid_plane.x);
  var h: PlaneHit;
  h.facing = abs(d[n]);
  h.t = (frame.grid_params.x - o[n]) / select(d[n], 1e-20, abs(d[n]) < 1e-20);
  h.pos = o + d * h.t;
  h.uv = vec2f(h.pos[u32(frame.grid_plane.z)], h.pos[u32(frame.grid_plane.w)]);
  let clip = frame.view_proj * vec4f(h.pos, 1.0);
  // Background grids sit just in front of the far plane (reversed-Z: 0), so
  // any geometry covers them.
  h.depth = select(clamp(clip.z / clip.w, 0.0, 1.0), 1e-7, is_background());
  return h;
}

// Coverage (0..1) of lines every \`spacing\` world units, \`width_px\` wide.
// Each direction fades out once its lines get closer than a few pixels on
// screen, which is what happens to one direction first at grazing angles.
fn lines(p: vec2f, spacing: f32, width_px: f32) -> f32 {
  let coord = p / spacing;
  let w = max(fwidth(coord), vec2f(1e-8));
  let dist = abs(fract(coord - 0.5) - 0.5) / w;
  let keep = smoothstep(vec2f(2.5), vec2f(7.0), 1.0 / w);  // pixels between lines
  let cov = (1.0 - smoothstep(vec2f(width_px * 0.5 - 0.5), vec2f(width_px * 0.5 + 0.5), dist)) * keep;
  return max(cov.x, cov.y);
}

fn axis_line(v: f32, width_px: f32) -> f32 {
  let d = abs(v) / max(fwidth(v), 1e-8);
  return 1.0 - smoothstep(width_px * 0.5 - 0.5, width_px * 0.5 + 0.5, d);
}

struct ColorOut {
  @location(0) color: vec4f,   // premultiplied alpha
  @builtin(frag_depth) depth: f32,
};

@fragment
fn fs_main(in: VsOut) -> ColorOut {
  let g = plane_hit(in.ndc);

  // Pick the decade whose cells are ~12 px wide here. Four decades are drawn
  // and their weights cross-fade, so nothing pops while zooming: as \`fade\`
  // goes 0 -> 1, every level's weight moves to the next finer level's.
  let footprint = max(length(fwidth(g.uv)), 1e-8);
  let level = log2(footprint * 12.0) / log2(10.0);
  let base = pow(10.0, floor(level));
  let fade = fract(level);
  let wa = frame.grid_minor.a * 0.5;
  let wb = frame.grid_minor.a;
  let wc = frame.grid_major.a;
  let a0 = lines(g.uv, base, 1.0) * wa * (1.0 - fade);
  let a1 = lines(g.uv, base * 10.0, 1.0) * mix(wb, wa, fade);
  let a2 = lines(g.uv, base * 100.0, 1.25) * mix(wc, wb, fade);
  let a3 = lines(g.uv, base * 1000.0, 1.25) * wc * fade;
  let au = axis_line(g.uv.y, 2.0);  // the u axis is the line v = 0
  let av = axis_line(g.uv.x, 2.0);

  // Fade toward the horizon and with distance to avoid shimmering (ground only).
  var vis = frame.grid_params.z;
  if (!is_background()) {
    let horizon = smoothstep(0.03, 0.3, g.facing);
    let far = 1.0 - smoothstep(0.5, 1.0, length(g.pos - frame.camera_pos.xyz) / frame.grid_params.y);
    vis *= horizon * far;
  }

  let minor = max(a0, a1);
  let major = max(a2, a3);
  var rgb = select(frame.grid_minor.rgb, frame.grid_major.rgb, major >= minor);
  var a = max(minor, major) * vis;
  if (au * frame.axis_u.a * vis > a) {
    rgb = frame.axis_u.rgb;
    a = au * frame.axis_u.a * vis;
  }
  if (av * frame.axis_v.a * vis > a) {
    rgb = frame.axis_v.rgb;
    a = av * frame.axis_v.a * vis;
  }

  // Shadow + ambient occlusion catcher: black with alpha = darkness.
  var shade_a = 0.0;
  if (frame.grid_params.w > 0.5 && !is_background()) {
    let lit = sample_shadow(g.pos, vec3f(0.0, 0.0, 1.0)) * sample_ao(in.clip.xy);
    shade_a = (1.0 - lit) * 0.75 * smoothstep(0.0, 0.1, g.facing);
  }

  var out: ColorOut;
  out.color = vec4f(rgb * a, a + shade_a * (1.0 - a));
  out.depth = g.depth;
  if (g.t <= 0.0 && !is_background()) {
    discard;
  }
  return out;
}

struct PrepassOut {
  @location(0) normal: vec4f,
  @location(1) ids: vec4u,
  @builtin(frag_depth) depth: f32,
};

const GROUND_ID: u32 = 0xffffffffu;

// Only the ground takes part in picking and ambient occlusion.
@fragment
fn fs_prepass(in: VsOut) -> PrepassOut {
  let g = plane_hit(in.ndc);
  if (g.t <= 0.0 || is_background()) {
    discard;
  }
  var out: PrepassOut;
  out.normal = vec4f(to_view(vec3f(0.0, 0.0, 1.0)), 1.0);
  out.ids = vec4u(GROUND_ID, 0u, 0u, 0u);
  out.depth = g.depth;
  return out;
}

`,re=`// The native viewer's composite (background, outlines, sRGB), unchanged.
// Final image: background gradient + tone mapping + outlines + selection
// outline, then sRGB encoding. Outlines come from the prepass buffers:
//  - silhouettes where the object/segment id changes,
//  - creases where normals or depth jump (outline mode 2 only).

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


@group(0) @binding(1) var color_tex: texture_2d<f32>;  // main pass, premultiplied alpha
@group(0) @binding(2) var id_tex: texture_2d<u32>;
@group(0) @binding(3) var depth_tex: texture_depth_2d;
@group(0) @binding(4) var normal_tex: texture_2d<f32>;
@group(0) @binding(5) var accum_tex: texture_2d<f32>;   // see-through surfaces: weighted color sum
@group(0) @binding(6) var reveal_tex: texture_2d<f32>;  // and how much of the background shows

struct VsOut {
  @builtin(position) clip: vec4f,
};

@vertex
fn vs_fullscreen(@builtin(vertex_index) vid: u32) -> VsOut {
  let uv = vec2f(f32((vid << 1u) & 2u), f32(vid & 2u));
  var out: VsOut;
  out.clip = vec4f(uv * 2.0 - 1.0, 0.0, 1.0);
  return out;
}

// Khronos PBR Neutral tone mapper: keeps base colors faithful, rolls off highlights.
fn tonemap_neutral(c_in: vec3f) -> vec3f {
  let start = 0.8 - 0.04;
  let desat = 0.15;
  let x = min(c_in.r, min(c_in.g, c_in.b));
  let offset = select(0.04, x - 6.25 * x * x, x < 0.08);
  var c = c_in - offset;
  let peak = max(c.r, max(c.g, c.b));
  if (peak < start) {
    return c;
  }
  let d = 1.0 - start;
  let new_peak = 1.0 - d * d / (peak + d - start);
  c *= new_peak / peak;
  let g = 1.0 - 1.0 / (desat * (peak - new_peak) + 1.0);
  return mix(c, vec3f(new_peak), g);
}

const GROUND_ID: u32 = 0xffffffffu;

fn is_object(id: u32) -> bool {
  return id != 0u && id != GROUND_ID;
}

fn linear_depth(px: vec2i) -> f32 {
  return view_depth(textureLoad(depth_tex, px, 0));
}

@fragment
fn fs_composite(in: VsOut) -> @location(0) vec4f {
  let px = vec2i(in.clip.xy);
  let size = vec2i(textureDimensions(id_tex));
  let uv = in.clip.xy * frame.viewport.zw;

  var bg = mix(frame.bg_top.rgb, frame.bg_bottom.rgb, uv.y);
  let c = textureLoad(color_tex, px, 0);
  var color = c.rgb / max(c.a, 1e-4);
  if (frame.post.x > 0.5) {
    color = tonemap_neutral(color);
  }
  var rgb = color * c.a + bg * (1.0 - c.a);

  // Outlines: compare this pixel against 8 neighbours \`w\` pixels away.
  let ids = textureLoad(id_tex, px, 0);
  let w = i32(max(frame.post.y, 1.0));
  let n0 = textureLoad(normal_tex, px, 0).xyz;
  let z0 = linear_depth(px);
  var edge = 0.0;
  var select_edge = 0.0;
  let mode = frame.style.w;  // 0 off, 1 silhouettes, 2 silhouettes + creases
  var dirs = array<vec2i, 8>(vec2i(1, 0), vec2i(-1, 0), vec2i(0, 1), vec2i(0, -1),
                             vec2i(1, 1), vec2i(-1, -1), vec2i(1, -1), vec2i(-1, 1));
  for (var k = 0; k < 8; k++) {
    let q = clamp(px + dirs[k] * w, vec2i(0), size - 1);
    let other = textureLoad(id_tex, q, 0);
    let objects = is_object(ids.x) || is_object(other.x);
    if (mode > 0.5 && objects && (other.x != ids.x || other.z != ids.z)) {
      edge += 1.0;
    } else if (mode > 1.5 && is_object(ids.x) && is_object(other.x)) {
      let n1 = textureLoad(normal_tex, q, 0).xyz;
      let z1 = linear_depth(q);
      if (dot(n0, n1) < 0.8 || abs(z1 - z0) > 0.03 * z0) {
        edge += 0.6;
      }
    }
    if ((other.w & 1u) != (ids.w & 1u)) {
      select_edge += 1.0;
    }
  }
  rgb = mix(rgb, frame.outline_color.rgb, min(edge / 3.0, 1.0) * frame.outline_color.a);

  // See-through surfaces over everything opaque (weighted blended OIT resolve).
  let reveal = textureLoad(reveal_tex, px, 0).r;
  if (reveal < 0.999) {
    let acc = textureLoad(accum_tex, px, 0);
    var t_rgb = acc.rgb / max(acc.a, 1e-5);
    if (frame.post.x > 0.5) {
      t_rgb = tonemap_neutral(t_rgb);
    }
    rgb = mix(rgb, t_rgb, 1.0 - reveal);
  }
  // Selected segments get a bright outline (drawn on both sides of the edge).
  // Wireframe shading colors the selected wires instead.
  var select_width = 0.0;
  if ((ids.w & 1u) == 0u && select_edge > 0.0) {
    select_width = 1.0;
  } else if (select_edge > 0.0) {
    select_width = 0.6;
  }
  if (frame.wire_mode.x > 0.5) {
    select_width = 0.0;
  }
  rgb = mix(rgb, frame.select_color.rgb, select_width);

  // Tiny noise hides banding in the background gradient.
  let noise = fract(sin(dot(in.clip.xy, vec2f(12.9898, 78.233))) * 43758.5453) - 0.5;
  return vec4f(linear_to_srgb(rgb) + noise / 255.0, 1.0);
}

`,ie=`// The native viewer's overlay lines and dots (the slice plane outline), unchanged.
// Screen-space lines and dots (measurements, selected vertices/edges).
// Each item is a capsule of constant pixel width between two 3D points;
// a dot is a capsule whose ends coincide. Drawn over the final image, dimmed
// (not hidden) where scene geometry is in front, like Blender's overlays.

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


@group(0) @binding(1) var depth_tex: texture_depth_2d;  // prepass depth

// Must match \`OverlayLine\` in overlay.h.
struct Item {
  a: vec4f,       // xyz, w = width in pixels
  b: vec4f,       // xyz, w = opacity where hidden behind geometry
  color: vec4f,   // sRGB + alpha
  border: vec4f,  // sRGB, a = border width in pixels
};

@group(1) @binding(0) var<storage, read> items: array<Item>;

struct VsOut {
  @builtin(position) clip: vec4f,
  @location(0) px: vec2f,
  @location(1) @interpolate(flat) a_px: vec2f,
  @location(2) @interpolate(flat) b_px: vec2f,
  @location(3) depth: f32,
  @location(4) @interpolate(flat) index: u32,
};

fn to_pixels(c: vec4f) -> vec2f {
  let ndc = c.xy / c.w;
  return vec2f((ndc.x * 0.5 + 0.5) * frame.viewport.x, (0.5 - ndc.y * 0.5) * frame.viewport.y);
}

@vertex
fn vs_main(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> VsOut {
  let it = items[iid];
  var ca = frame.view_proj * vec4f(it.a.xyz, 1.0);
  var cb = frame.view_proj * vec4f(it.b.xyz, 1.0);
  // Clip against the near plane (reversed-Z: visible where w >= z).
  let da = ca.w - ca.z;
  let db = cb.w - cb.z;
  var out: VsOut;
  if (da < 0.0 && db < 0.0) {
    out.clip = vec4f(0.0, 0.0, -2.0, 1.0);
    return out;
  }
  if (da < 0.0) {
    ca = mix(ca, cb, da / (da - db) + 1e-4);
  } else if (db < 0.0) {
    cb = mix(cb, ca, db / (db - da) + 1e-4);
  }
  let pa = to_pixels(ca);
  let pb = to_pixels(cb);
  let r = it.a.w * 0.5 + it.border.a + 1.0;
  var dir = pb - pa;
  let len = length(dir);
  dir = select(vec2f(1.0, 0.0), dir / max(len, 1e-6), len > 1e-3);
  let nrm = vec2f(-dir.y, dir.x);
  var corners = array<vec2f, 6>(vec2f(0.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
                                vec2f(0.0, -1.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0));
  let k = corners[vid];
  let base = mix(pa - dir * r, pb + dir * r, k.x);
  let px = base + nrm * r * k.y;
  out.px = px;
  out.a_px = pa;
  out.b_px = pb;
  out.depth = mix(ca.z / ca.w, cb.z / cb.w, k.x);
  out.clip = vec4f(px.x * frame.viewport.z * 2.0 - 1.0, 1.0 - px.y * frame.viewport.w * 2.0, 0.5, 1.0);
  out.index = iid;
  return out;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4f {
  let it = items[in.index];
  let ba = in.b_px - in.a_px;
  let h = clamp(dot(in.px - in.a_px, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  let d = length(in.px - in.a_px - ba * h);
  let r = it.a.w * 0.5;
  let fill = 1.0 - smoothstep(r - 0.5, r + 0.5, d);
  let outer = 1.0 - smoothstep(r + it.border.a - 0.5, r + it.border.a + 0.5, d);

  // Dots test the depth at their center, lines at every pixel.
  let is_dot = dot(ba, ba) < 1.0;
  let probe = select(in.px, in.a_px, is_dot);
  let size = vec2i(textureDimensions(depth_tex));
  let scene = textureLoad(depth_tex, clamp(vec2i(probe), vec2i(0), size - 1), 0);
  // Wireframe shading is see-through (x-ray).
  let hidden = occluded(scene, in.depth) && frame.wire_mode.x < 0.5;
  let vis = select(1.0, it.b.w, hidden);

  let rgb = mix(it.border.rgb, it.color.rgb, select(fill / max(outer, 1e-4), 1.0, it.border.a <= 0.0));
  let a = select(outer, fill, it.border.a <= 0.0) * it.color.a * vis;
  return vec4f(rgb * a, a);
}

`,ae=`// The native viewer's SDF text labels, unchanged.
// Text labels anchored to 3D points, from a signed-distance-field font atlas
// (crisp at any size, with an optional halo for contrast on any background).
// Labels keep a constant pixel size and dim when their anchor is hidden.

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


@group(0) @binding(1) var depth_tex: texture_depth_2d;
@group(0) @binding(2) var font_atlas: texture_2d<f32>;
@group(0) @binding(3) var font_sampler: sampler;

// Must match \`GlyphInstance\` in text.h.
struct Glyph {
  anchor: vec4f,  // world xyz, w = opacity when the anchor is hidden
  rect: vec4f,    // quad relative to the anchor in pixels: x, y (top-left, y down), w, h
  uv: vec4f,      // atlas rect: u0, v0, u1, v1
  color: vec4f,   // sRGB + alpha
  halo: vec4f,    // sRGB + alpha
  params: vec4f,  // x = halo thickness in SDF units, y = 1 to ignore depth
};

@group(1) @binding(0) var<storage, read> glyphs: array<Glyph>;

struct VsOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) index: u32,
  @location(2) @interpolate(flat) vis: f32,
};

@vertex
fn vs_main(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> VsOut {
  let g = glyphs[iid];
  var out: VsOut;
  let c = frame.view_proj * vec4f(g.anchor.xyz, 1.0);
  if (c.w <= 0.0 || c.z > c.w) {
    out.clip = vec4f(0.0, 0.0, -2.0, 1.0);
    return out;
  }
  let ndc = c.xyz / c.w;
  // Snap the anchor to whole pixels so text stays crisp.
  let anchor_px = floor(vec2f((ndc.x * 0.5 + 0.5) * frame.viewport.x,
                              (0.5 - ndc.y * 0.5) * frame.viewport.y) + 0.5);
  var corners = array<vec2f, 6>(vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0),
                                vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0));
  let k = corners[vid];
  let px = anchor_px + g.rect.xy + g.rect.zw * k;
  out.clip = vec4f(px.x * frame.viewport.z * 2.0 - 1.0, 1.0 - px.y * frame.viewport.w * 2.0, 0.5, 1.0);
  out.uv = mix(g.uv.xy, g.uv.zw, k);
  out.index = iid;

  let size = vec2i(textureDimensions(depth_tex));
  let scene = textureLoad(depth_tex, clamp(vec2i(anchor_px), vec2i(0), size - 1), 0);
  let hidden = occluded(scene, ndc.z) && g.params.y < 0.5 && frame.wire_mode.x < 0.5;
  out.vis = select(1.0, g.anchor.w, hidden);
  return out;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4f {
  let g = glyphs[in.index];
  let sdf = textureSampleLevel(font_atlas, font_sampler, in.uv, 0.0).r;
  let w = max(fwidth(sdf) * 0.7, 1e-3);
  let fill = smoothstep(0.5 - w, 0.5 + w, sdf);
  let edge = 0.5 - g.params.x;
  let halo = smoothstep(edge - w, edge + w, sdf) * g.halo.a;
  let a_fill = fill * g.color.a;
  let a = (a_fill + halo * (1.0 - a_fill)) * in.vis;
  let rgb = mix(g.halo.rgb, g.color.rgb, a_fill / max(a_fill + halo * (1.0 - a_fill), 1e-4));
  return vec4f(rgb * a, a);
}

`,oe=(e,t)=>[e[0]-t[0],e[1]-t[1],e[2]-t[2]],se=(e,t)=>[e[1]*t[2]-e[2]*t[1],e[2]*t[0]-e[0]*t[2],e[0]*t[1]-e[1]*t[0]],ce=(e,t)=>e[0]*t[0]+e[1]*t[1]+e[2]*t[2],le=e=>{let t=Math.hypot(e[0],e[1],e[2])||1;return[e[0]/t,e[1]/t,e[2]/t]};function ue(e,t,n=[0,0,1]){let r=le(oe(t,e)),i=se(r,n);Math.hypot(...i)<1e-6&&(i=se(r,[0,1,0])),i=le(i);let a=se(i,r);return new Float32Array([i[0],a[0],-r[0],0,i[1],a[1],-r[1],0,i[2],a[2],-r[2],0,-ce(i,e),-ce(a,e),ce(r,e),1])}function de(e,t,n){let r=1/Math.tan(e/2);return new Float32Array([r/t,0,0,0,0,r,0,0,0,0,0,-1,0,0,n,0])}function fe(e,t){let n=new Float32Array(16);for(let r=0;r<4;r++)for(let i=0;i<4;i++){let a=0;for(let n=0;n<4;n++)a+=e[n*4+i]*t[r*4+n];n[r*4+i]=a}return n}function pe(e){let t=new Float32Array(16),n=e;t[0]=n[5]*n[10]*n[15]-n[5]*n[11]*n[14]-n[9]*n[6]*n[15]+n[9]*n[7]*n[14]+n[13]*n[6]*n[11]-n[13]*n[7]*n[10],t[4]=-n[4]*n[10]*n[15]+n[4]*n[11]*n[14]+n[8]*n[6]*n[15]-n[8]*n[7]*n[14]-n[12]*n[6]*n[11]+n[12]*n[7]*n[10],t[8]=n[4]*n[9]*n[15]-n[4]*n[11]*n[13]-n[8]*n[5]*n[15]+n[8]*n[7]*n[13]+n[12]*n[5]*n[11]-n[12]*n[7]*n[9],t[12]=-n[4]*n[9]*n[14]+n[4]*n[10]*n[13]+n[8]*n[5]*n[14]-n[8]*n[6]*n[13]-n[12]*n[5]*n[10]+n[12]*n[6]*n[9],t[1]=-n[1]*n[10]*n[15]+n[1]*n[11]*n[14]+n[9]*n[2]*n[15]-n[9]*n[3]*n[14]-n[13]*n[2]*n[11]+n[13]*n[3]*n[10],t[5]=n[0]*n[10]*n[15]-n[0]*n[11]*n[14]-n[8]*n[2]*n[15]+n[8]*n[3]*n[14]+n[12]*n[2]*n[11]-n[12]*n[3]*n[10],t[9]=-n[0]*n[9]*n[15]+n[0]*n[11]*n[13]+n[8]*n[1]*n[15]-n[8]*n[3]*n[13]-n[12]*n[1]*n[11]+n[12]*n[3]*n[9],t[13]=n[0]*n[9]*n[14]-n[0]*n[10]*n[13]-n[8]*n[1]*n[14]+n[8]*n[2]*n[13]+n[12]*n[1]*n[10]-n[12]*n[2]*n[9],t[2]=n[1]*n[6]*n[15]-n[1]*n[7]*n[14]-n[5]*n[2]*n[15]+n[5]*n[3]*n[14]+n[13]*n[2]*n[7]-n[13]*n[3]*n[6],t[6]=-n[0]*n[6]*n[15]+n[0]*n[7]*n[14]+n[4]*n[2]*n[15]-n[4]*n[3]*n[14]-n[12]*n[2]*n[7]+n[12]*n[3]*n[6],t[10]=n[0]*n[5]*n[15]-n[0]*n[7]*n[13]-n[4]*n[1]*n[15]+n[4]*n[3]*n[13]+n[12]*n[1]*n[7]-n[12]*n[3]*n[5],t[14]=-n[0]*n[5]*n[14]+n[0]*n[6]*n[13]+n[4]*n[1]*n[14]-n[4]*n[2]*n[13]-n[12]*n[1]*n[6]+n[12]*n[2]*n[5],t[3]=-n[1]*n[6]*n[11]+n[1]*n[7]*n[10]+n[5]*n[2]*n[11]-n[5]*n[3]*n[10]-n[9]*n[2]*n[7]+n[9]*n[3]*n[6],t[7]=n[0]*n[6]*n[11]-n[0]*n[7]*n[10]-n[4]*n[2]*n[11]+n[4]*n[3]*n[10]+n[8]*n[2]*n[7]-n[8]*n[3]*n[6],t[11]=-n[0]*n[5]*n[11]+n[0]*n[7]*n[9]+n[4]*n[1]*n[11]-n[4]*n[3]*n[9]-n[8]*n[1]*n[7]+n[8]*n[3]*n[5],t[15]=n[0]*n[5]*n[10]-n[0]*n[6]*n[9]-n[4]*n[1]*n[10]+n[4]*n[2]*n[9]+n[8]*n[1]*n[6]-n[8]*n[2]*n[5];let r=n[0]*t[0]+n[1]*t[4]+n[2]*t[8]+n[3]*t[12],i=r===0?0:1/r;for(let e=0;e<16;e++)t[e]*=i;return t}var me=class{target=[0,0,0];distance=5;yaw=-Math.PI/2;pitch=.4;fovy=45*Math.PI/180;lookAt(e,t){let n=oe(e,t);this.target=[...t],this.distance=Math.max(Math.hypot(...n),.001),this.yaw=Math.atan2(n[1],n[0]),this.pitch=Math.asin(Math.max(-1,Math.min(1,n[2]/this.distance)))}eye(){let e=Math.cos(this.pitch);return[this.target[0]+this.distance*e*Math.cos(this.yaw),this.target[1]+this.distance*e*Math.sin(this.yaw),this.target[2]+this.distance*Math.sin(this.pitch)]}view(){return ue(this.eye(),this.target)}proj(e){return de(this.fovy,e,Math.max(this.distance*.001,.001))}orbit(e,t){this.yaw-=e*.008,this.pitch=Math.max(-1.55,Math.min(1.55,this.pitch+t*.008))}pan(e,t,n){let r=this.view(),i=[r[0],r[4],r[8]],a=[r[1],r[5],r[9]],o=2*this.distance*Math.tan(this.fovy/2)/n;for(let n=0;n<3;n++)this.target[n]+=(-e*i[n]+t*a[n])*o}zoom(e){this.distance=Math.max(.001,this.distance*Math.exp(e*.001))}attach(e,t){let n=null,r=`orbit`;e.addEventListener(`contextmenu`,e=>e.preventDefault()),e.addEventListener(`pointerdown`,t=>{n=[t.clientX,t.clientY],r=t.button===2||t.button===1||t.shiftKey?`pan`:`orbit`,e.setPointerCapture(t.pointerId)}),e.addEventListener(`pointermove`,i=>{if(!n)return;let a=i.clientX-n[0],o=i.clientY-n[1];n=[i.clientX,i.clientY],r===`orbit`?this.orbit(a,o):this.pan(a,o,e.clientHeight),t()}),e.addEventListener(`pointerup`,()=>n=null),e.addEventListener(`wheel`,e=>{e.preventDefault(),this.zoom(e.deltaY),t()},{passive:!1})}},he=[0,0,0,.75],ge=2,_e=.3,ve=4;async function ye(e){let[t,n]=await Promise.all([fetch(`${e}font/label.json`).then(e=>e.json()),fetch(`${e}font/label.png`).then(e=>e.blob())]);return{info:t,image:await createImageBitmap(n,{colorSpaceConversion:`none`,premultiplyAlpha:`none`})}}var be=class{font;glyphs=new Map;constructor(e){this.font=e;for(let[t,n]of Object.entries(e.glyphs))this.glyphs.set(Number(t),n)}find(e){return this.glyphs.get(e)??this.glyphs.get(63)}layout(e,t,n){let r=this.font;for(let i of e){let e=i.sizePx;if(i.worldHeight>0){let n=[i.anchor[0]-t.eye[0],i.anchor[1]-t.eye[1],i.anchor[2]-t.eye[2]],r=n[0]*t.forward[0]+n[1]*t.forward[1]+n[2]*t.forward[2];if(r<=t.near)continue;let a=2*Math.max(r,t.near)*Math.tan(.5*t.fovy)/t.height;if(e=i.worldHeight/Math.max(a,1e-12),e<ve)continue}let a=e/r.base_px,o=Array.from(i.text,e=>e.codePointAt(0)),s=0;for(let e of o)s+=(this.find(e)?.advance??0)*a;let c=i.offset??[0,0],l=Math.round(c[0]-i.align[0]*s),u=Math.round(c[1]-i.align[1]*r.ascent*a*.78),d=i.halo??he,f=Math.min(ge/a*r.sdf_per_px,.45),p=0;for(let e of o){let t=this.find(e);t&&(t.size[0]>0&&n.push(i.anchor[0],i.anchor[1],i.anchor[2],i.hiddenAlpha??_e,l+(p+t.offset[0])*a,u+(t.offset[1]-r.ascent*.22)*a,t.size[0]*a,t.size[1]*a,t.uv[0],t.uv[1],t.uv[2],t.uv[3],i.color[0],i.color[1],i.color[2],i.color[3]??1,d[0],d[1],d[2],d[3],f,0,0,0),p+=t.advance)}}}};function xe(e,t){return e.replace(/\{(?::([+ ]?)(\d*)(?:\.(\d+))?([defgG%]?))?\}/g,(e,n,r,i,a)=>{let o=i===void 0?void 0:Number(i),s;switch(a){case`f`:s=t.toFixed(o??6);break;case`e`:s=Se(t,o??6);break;case`%`:s=(t*100).toFixed(o??6)+`%`;break;case`d`:s=Math.trunc(t).toString();break;case`g`:case`G`:s=Ce(t,o??6);break;default:s=o===void 0?we(t):Ce(t,o)}return n&&t>=0&&!s.startsWith(`-`)&&(s=(n===`+`?`+`:` `)+s),r?s.padStart(Number(r)):s})}function Se(e,t){return e.toExponential(t).replace(/e([+-])(\d)$/,`e$10$2`)}function Ce(e,t){if(e===0)return`0`;let n=Math.max(t,1),r=Math.floor(Math.log10(Math.abs(e)));return(r<-4||r>=n?Se(e,n-1):e.toFixed(Math.max(n-1-r,0))).replace(/(\.\d*?)0+(e|$)/,`$1$2`).replace(/\.(e|$)/,`$1`)}function we(e){return Number.isInteger(e)?e.toFixed(1):String(e)}function Te(e){if(!(e>0))return 1;let t=10**Math.floor(Math.log10(e));for(let n of[1,2,5,10])if(n*t>=e)return n*t;return 10*t}function Ee(e,t){let n=Math.abs(t);if(Math.abs(e)<1e-12)return`0`;if(n>=.1){let t=e.toFixed(n>=1?0:1);return t.includes(`.`)&&(t=t.replace(/0+$/,``).replace(/\.$/,``)),t+` m`}return n>=.01?`${(e*100).toFixed(0)} cm`:n>=.001?`${(e*1e3).toFixed(0)} mm`:`${(e*1e6).toFixed(0)} \u00b5m`}var De=`// The native viewer's environment prefilter (GGX, per roughness mip), unchanged.
// Pre-blurs the environment map for rough reflections (run once per
// environment, not per frame). Mip k of the output holds the reflection for
// roughness (k / (mips - 1))^2, integrated with GGX importance sampling.

const PI: f32 = 3.14159265358979;

struct Params {
  roughness: f32,
  src_mips: f32,
  src_width: f32,
  _pad: f32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var src_sampler: sampler;
@group(0) @binding(3) var dst: texture_storage_2d<rgba16float, write>;

fn dir_from_uv(uv: vec2f) -> vec3f {
  let phi = (uv.x - 0.5) * 2.0 * PI;
  let theta = uv.y * PI;
  return vec3f(sin(theta) * cos(phi), sin(theta) * sin(phi), cos(theta));
}

fn uv_from_dir(d: vec3f) -> vec2f {
  return vec2f(atan2(d.y, d.x) / (2.0 * PI) + 0.5, acos(clamp(d.z, -1.0, 1.0)) / PI);
}

fn hammersley(i: u32, n: u32) -> vec2f {
  var bits = i;
  bits = (bits << 16u) | (bits >> 16u);
  bits = ((bits & 0x55555555u) << 1u) | ((bits & 0xAAAAAAAAu) >> 1u);
  bits = ((bits & 0x33333333u) << 2u) | ((bits & 0xCCCCCCCCu) >> 2u);
  bits = ((bits & 0x0F0F0F0Fu) << 4u) | ((bits & 0xF0F0F0F0u) >> 4u);
  bits = ((bits & 0x00FF00FFu) << 8u) | ((bits & 0xFF00FF00u) >> 8u);
  return vec2f(f32(i) / f32(n), f32(bits) * 2.3283064365386963e-10);
}

const SAMPLES: u32 = 256u;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) {
    return;
  }
  let uv = (vec2f(id.xy) + 0.5) / vec2f(size);
  let n = dir_from_uv(uv);
  let a = params.roughness * params.roughness;
  if (a < 1e-4) {
    textureStore(dst, id.xy, textureSampleLevel(src, src_sampler, uv, 0.0));
    return;
  }
  let helper = select(vec3f(0.0, 0.0, 1.0), vec3f(1.0, 0.0, 0.0), abs(n.z) > 0.999);
  let t = normalize(cross(helper, n));
  let b = cross(n, t);
  // Solid angle of one source texel (equator), for mip selection.
  let texel_sa = 4.0 * PI / (params.src_width * params.src_width * 0.5);

  var sum = vec3f(0.0);
  var weight = 0.0;
  for (var i = 0u; i < SAMPLES; i++) {
    let xi = hammersley(i, SAMPLES);
    // GGX half vector around n (view = normal assumption).
    let phi = 2.0 * PI * xi.x;
    let cos_t = sqrt((1.0 - xi.y) / (1.0 + (a * a - 1.0) * xi.y));
    let sin_t = sqrt(1.0 - cos_t * cos_t);
    let h = normalize(t * (sin_t * cos(phi)) + b * (sin_t * sin(phi)) + n * cos_t);
    let l = 2.0 * dot(n, h) * h - n;
    let n_dot_l = dot(n, l);
    if (n_dot_l <= 0.0) {
      continue;
    }
    // Sample a blurrier source mip for low-probability directions.
    let d = (a * a - 1.0) * cos_t * cos_t + 1.0;
    let pdf = (a * a) / (PI * d * d) * 0.25;
    let sample_sa = 1.0 / (f32(SAMPLES) * pdf + 1e-6);
    let mip = clamp(0.5 * log2(sample_sa / texel_sa) + 1.0, 0.0, params.src_mips - 1.0);
    sum += textureSampleLevel(src, src_sampler, uv_from_dir(l), mip).rgb * n_dot_l;
    weight += n_dot_l;
  }
  textureStore(dst, id.xy, vec4f(sum / max(weight, 1e-6), 1.0));
}

`,Oe=[`Clay`,`Porcelain`,`Chrome`,`Toon`],ke=[`Studio softboxes`,`Clear sky`,`Soft white room`],C=Math.PI,w=(e,t)=>e[0]*t[0]+e[1]*t[1]+e[2]*t[2],Ae=(e,t)=>[e[1]*t[2]-e[2]*t[1],e[2]*t[0]-e[0]*t[2],e[0]*t[1]-e[1]*t[0]],je=e=>{let t=Math.hypot(e[0],e[1],e[2]);return[e[0]/t,e[1]/t,e[2]/t]},Me=(e,t,n)=>Math.min(n,Math.max(t,e)),T=(e,t,n)=>{let r=Me((n-e)/(t-e),0,1);return r*r*(3-2*r)},E=e=>e*C/180,Ne=e=>e===2?0:1;function Pe(e){e=Me(e,0,1);let t=e<=.0031308?e*12.92:1.055*e**(1/2.4)-.055;return Math.round(t*255)}function Fe(e,t=256){let n=new Uint8Array(t*t*4),r=je([-.5,.6,.62]),i=je([.75,-.05,.65]),a=[0,0,1],o=je([r[0]+a[0],r[1]+a[1],r[2]+a[2]]);for(let a=0;a<t;a++)for(let s=0;s<t;s++){let c=(s+.5)/t*2-1,l=1-(a+.5)/t*2,u=c*c+l*l;if(u>1){let e=Math.sqrt(u);c/=e,l/=e,u=1}let d=[c,l,Math.sqrt(Math.max(0,1-u))],f=Math.max(0,w(d,r)),p=Math.max(0,w(d,i)),m=Math.max(0,(w(d,r)+.4)/1.4),h=Math.max(0,w(d,o)),g=(1-d[2])**3,_=[0,0,0],v=0;if(e===0){let e=.1+.5*m+.14*p+.1*d[1];_=[1*e,.97*e,.93*e],v=.06*h**10}else if(e===1){let e=.12+.52*f+.16*p+.1*(d[1]*.5+.5);_=[e,e,e],v=.9*h**140+.25*h**18+.12*g}else if(e===2){let e=2*d[2],t=[e*d[0],e*d[1],-1+e*d[2]],n=T(-.05,.25,t[1]),i=[.06,.06,.07],a=[.85,.88,.95],o=.5*Math.exp(-(((t[1]-.05)*14)**2)),s=2*Math.max(0,w(t,r))**200;_=[0,1,2].map(e=>(i[e]+(a[e]-i[e])*n+o+s)*.9)}else{let e=f>.55?.62:f>.15?.42:.24;_=[e,e,e],v=h>.985?.6:0}let y=(a*t+s)*4;n[y]=Pe(_[0]),n[y+1]=Pe(_[1]),n[y+2]=Pe(_[2]),n[y+3]=Math.round(Me(v,0,1)*255)}return n}function Ie(e,t){let n=(e-.5)*2*C,r=t*C;return[Math.sin(r)*Math.cos(n),Math.sin(r)*Math.sin(n),Math.cos(r)]}function Le(e,t){let n=E(e),r=E(t);return[Math.cos(r)*Math.cos(n),Math.cos(r)*Math.sin(n),Math.sin(r)]}function Re(e,t,n,r){let i=Math.acos(Me(w(e,t),-1,1)),a=E(n);return 1-T(a*(1-r),a,i)}function ze(e,t,n,r){let i=je(Ae(t,[0,0,1])),a=Ae(i,t),o=w(e,t);if(o<=0)return 0;let s=Math.atan2(w(e,i),o),c=Math.atan2(w(e,a),o),l=E(n),u=E(r);return(1-T(l*.75,l,Math.abs(s)))*(1-T(u*.75,u,Math.abs(c)))}function Be(e,t=1024){let n=t/2,r=new Float32Array(t*n*3),i=Le(-130,55),a=Le(-40,25),o=Le(100,30),s=Le(-120,50),c=e===1?s:e===0?i:[0,0,1],l=(e,t,n)=>[e[0]+(t[0]-e[0])*n,e[1]+(t[1]-e[1])*n,e[2]+(t[2]-e[2])*n];for(let c=0;c<n;c++)for(let u=0;u<t;u++){let d=Ie((u+.5)/t,(c+.5)/n),f=T(-.08,.08,d[2]),p;if(e===0){p=l([.07,.07,.07],l([.1,.1,.1],[.3,.3,.32],d[2]*.5+.5),f);let e=9*ze(d,i,22,14),t=2.5*ze(d,a,30,10),n=5*ze(d,o,8,22),r=1.5*Re(d,[0,0,1],25,.5);p=[p[0]+e*1+t*.92+n+r,p[1]+e*.97+t*.96+n+r,p[2]+e*.92+t*1+n+r]}else if(e===1){p=l([.16,.15,.13],l([.75,.84,.95],[.18,.36,.8],Math.max(d[2],0)**.45).map(e=>e*1.3),f);let e=400*Re(d,s,1.2,.3),t=2*Re(d,s,18,1);p=[p[0]+e*1+t*1,p[1]+e*.95+t*.9,p[2]+e*.85+t*.7]}else{let e=.3+.7*(d[2]*.5+.5);p=[e,e,e]}r.set(p,(c*t+u)*3)}return{width:t,height:n,rgb:r,sunDir:c}}function Ve(e){let t=new Float32Array([e]),n=new Uint32Array(t.buffer)[0],r=n>>>16&32768,i=n>>>23&255,a=n&8388607;if(i===255)return r|31744|(a?512:0);let o=i-127+15;return o>=31?r|31744:o<=0?o<-10?r:(a|=8388608,r|a>>>14-o):r|o<<10|a>>>13}function He(e,t){let{width:n,height:r}=t,i=new Float32Array(36);for(let e=0;e<r;e++){let a=(e+.5)/r*C,o=2*C/n*(C/r)*Math.sin(a);for(let a=0;a<n;a++){let s=Ie((a+.5)/n,(e+.5)/r),c=(e*n+a)*3,l=[.282095,.488603*s[1],.488603*s[2],.488603*s[0],1.092548*s[0]*s[1],1.092548*s[1]*s[2],.315392*(3*s[2]*s[2]-1),1.092548*s[0]*s[2],.546274*(s[0]*s[0]-s[1]*s[1])];for(let e=0;e<3;e++){let n=Math.min(t.rgb[c+e],50)*o;for(let t=0;t<9;t++)i[4*t+e]+=n*l[t]}}}for(let e=0;e<36;e++)i[e]/=C;let a=1;for(;n>>a>=32&&r>>a>=16;)a++;let o=GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST,s=e.createTexture({size:[n,r],format:`rgba16float`,usage:o,mipLevelCount:a}),c=t.rgb,l=n,u=r;for(let t=0;t<a;t++){let n=new Uint16Array(l*u*4);for(let e=0;e<l*u;e++){for(let t=0;t<3;t++)n[4*e+t]=Ve(Math.min(c[3*e+t],6e4));n[4*e+3]=15360}if(e.queue.writeTexture({texture:s,mipLevel:t},n,{bytesPerRow:l*8,rowsPerImage:u},[l,u]),t+1===a)break;let r=l>>1,i=u>>1,o=new Float32Array(r*i*3);for(let e=0;e<i;e++)for(let t=0;t<r;t++)for(let n=0;n<3;n++)o[(e*r+t)*3+n]=.25*(c[(2*e*l+2*t)*3+n]+c[(2*e*l+2*t+1)*3+n]+c[((2*e+1)*l+2*t)*3+n]+c[((2*e+1)*l+2*t+1)*3+n]);c=o,l=r,u=i}let d=e.createTexture({size:[n,r],format:`rgba16float`,mipLevelCount:a,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING}),f=e.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:`uniform`}},{binding:1,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:`float`}},{binding:2,visibility:GPUShaderStage.COMPUTE,sampler:{type:`filtering`}},{binding:3,visibility:GPUShaderStage.COMPUTE,storageTexture:{access:`write-only`,format:`rgba16float`}}]}),p=e.createComputePipeline({layout:e.createPipelineLayout({bindGroupLayouts:[f]}),compute:{module:e.createShaderModule({code:De}),entryPoint:`main`}}),m=e.createSampler({addressModeU:`repeat`,addressModeV:`clamp-to-edge`,magFilter:`linear`,minFilter:`linear`,mipmapFilter:`linear`}),h=s.createView(),g=e.createCommandEncoder(),_=[];for(let t=0;t<a;t++){let i=a>1?t/(a-1):0,o=e.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});e.queue.writeBuffer(o,0,new Float32Array([i*i,a,n,0])),_.push(o);let s=e.createBindGroup({layout:f,entries:[{binding:0,resource:{buffer:o}},{binding:1,resource:h},{binding:2,resource:m},{binding:3,resource:d.createView({baseMipLevel:t,mipLevelCount:1})}]}),c=g.beginComputePass();c.setPipeline(p),c.setBindGroup(0,s),c.dispatchWorkgroups(Math.ceil((n>>t)/8),Math.ceil((r>>t)/8)),c.end()}return e.queue.submit([g.finish()]),e.queue.onSubmittedWorkDone().then(()=>{s.destroy();for(let e of _)e.destroy()}),{view:d.createView(),texture:d,mips:a,sh:i,sunDir:t.sunDir}}var D={view:0,proj:16,viewProj:32,invViewProj:48,invProj:64,invView:80,lightViewProj:96,cameraPos:112,viewport:116,sunDir:120,bgTop:124,bgBottom:128,gridMinor:132,gridMajor:136,gridParams:140,gridPlane:144,axisU:148,axisV:152,wire:156,wireMode:160,select:164,active:168,outline:172,style:176,style2:180,env:184,ao:188,post:192,slice:196,sh:200,size:236},O=4,Ue=2048,k=`rgba16float`,A=`depth32float`,We=[[`studio`,`Studio`],[`matcap`,`MatCap`],[`pbr`,`Environment PBR`],[`technical`,`Technical`]],Ge={studio:[g,b],matcap:[_,x],pbr:[v,S],technical:[y,ee]};function Ke(){return{style:`studio`,shadows:!0,shadowStrength:.6,ssao:!0,aoStrength:.8,aoRadius:.35,outline:1,outlineWidth:1,exposure:1,grid:!0,groundShadow:!0,studioSpecular:.35,studioWrap:.35,studioAmbient:.38,matcap:0,matcapTint:1,environment:0,envIntensity:1,envRotation:0,goochShift:1,goochContrast:.8,slice:{enabled:!1,axis:0,offset:0,flip:!1,show:!0}}}function qe(e,t){e.style=t;let n={studio:[.8,1],matcap:[.6,0],pbr:[.7,0],technical:[.45,2]}[t];e.ssao=!0,e.aoStrength=n[0],e.shadows=!0,e.outline=n[1]}var Je=()=>({opacity:1,sliced:!0,metallic:0,roughness:.45}),Ye=[.25,-.35,1],Xe=0,Ze=254,Qe=e=>e<=.04045?e/12.92:((e+.055)/1.055)**2.4,j=(e,t,n,r=1)=>[Qe(e),Qe(t),Qe(n),r];function $e(e,t,n,r=1){let i=e=>Math.max(0,Math.min(255,Math.round(e*255)));return(i(e)|i(t)<<8|i(n)<<16|i(r)<<24)>>>0}var et=[0,0,0,1,0,0,1,1,0,0,1,0,0,0,1,1,0,1,1,1,1,0,1,1],tt=[0,3,2,0,2,1,4,5,6,4,6,7,0,1,5,0,5,4,1,2,6,1,6,5,2,3,7,2,7,6,3,0,4,3,4,7],nt=GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,rt=32,it=class e{device;context;canvas;camera=new me;settings=Ke();display=new Map;frame=new Float32Array(D.size);frameBuf;objects=new Map;nextId=1;size=[0,0];layouts={};pipes={};builtStyle=null;samplers={};t={};groups={};dummy;shadowView;fontView;matcapTex;matcapBuilt=-1;env=null;envBuilt=-1;text;glyphBuf;glyphCap=0;glyphGroup;lineBuf;lineCap=0;lineGroup;isolated=-1;selected=-1;constructor(e,t,n,r,i){this.device=e,this.context=t,this.canvas=r;let a=e;this.camera.fovy=40*Math.PI/180,this.frameBuf=a.createBuffer({size:D.size*4,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});let o=e=>a.createBindGroupLayout({entries:e}),s=e=>({binding:e,visibility:nt,buffer:{type:`uniform`}}),c=e=>({binding:e,visibility:nt,buffer:{type:`read-only-storage`}}),l=(e,t=`float`)=>({binding:e,visibility:nt,texture:{sampleType:t}}),u=(e,t=`filtering`)=>({binding:e,visibility:nt,sampler:{type:t}});this.layouts={frame:o([s(0)]),scene:o([s(0),u(1),l(2),l(3),l(4),l(5,`depth`),u(6,`comparison`),l(7),u(8)]),rigid:o([s(0),c(1),c(2),c(3)]),dyn:o([s(0)]),ssao:o([s(0),l(1,`depth`),l(2,`unfilterable-float`)]),blur:o([s(0),l(1,`depth`),l(3,`unfilterable-float`)]),composite:o([s(0),l(1,`unfilterable-float`),l(2,`uint`),l(3,`depth`),l(4,`unfilterable-float`),l(5,`unfilterable-float`),l(6,`unfilterable-float`)]),lines:o([s(0),l(1,`depth`)]),text:o([s(0),l(1,`depth`),l(2),u(3)]),storage:o([c(0)])},this.samplers.clamp=a.createSampler({magFilter:`linear`,minFilter:`linear`,mipmapFilter:`linear`}),this.samplers.repeat=a.createSampler({magFilter:`linear`,minFilter:`linear`,mipmapFilter:`linear`,addressModeU:`repeat`}),this.samplers.shadow=a.createSampler({magFilter:`linear`,minFilter:`linear`,compare:`less-equal`});let d=a.createTexture({size:[1,1],format:`rgba8unorm`,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});a.queue.writeTexture({texture:d},new Uint8Array([255,255,255,255]),{bytesPerRow:4},[1,1]),this.dummy=d.createView(),this.matcapTex=a.createTexture({size:[256,256],format:`rgba8unorm-srgb`,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});let f=a.createTexture({size:[Ue,Ue],format:A,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});this.t.shadow=f,this.shadowView=f.createView();let p=a.createTexture({size:[i.info.width,i.info.height],format:`rgba8unorm`,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});a.queue.copyExternalImageToTexture({source:i.image},{texture:p},[i.info.width,i.info.height]),this.fontView=p.createView(),this.text=new be(i.info),this.glyphBuf=this.storageBuffer(`glyph`,256),this.lineBuf=this.storageBuffer(`line`,16);let m=e=>a.createShaderModule({code:e}),h=m(ne),g=m(te),_=m(re),v=m(ie),y=m(ae),b=this.premult,x=(e,t,n,r,i={})=>a.createRenderPipeline({layout:this.pipelineLayout(...n),primitive:{topology:`triangle-list`},vertex:{module:e,entryPoint:`vs_fullscreen`},fragment:{module:e,entryPoint:t,targets:r},...i}),S=(e,t)=>a.createRenderPipeline({layout:this.pipelineLayout(t,this.layouts.storage),primitive:{topology:`triangle-list`},vertex:{module:e,entryPoint:`vs_main`},fragment:{module:e,entryPoint:`fs_main`,targets:[{format:n,blend:b}]}});Object.assign(this.pipes,{gridMain:x(h,`fs_main`,[this.layouts.scene],[{format:k,blend:b}],{depthStencil:this.depthGreater(!1),multisample:{count:O}}),gridPre:x(h,`fs_prepass`,[this.layouts.scene],this.prepassTargets,{depthStencil:this.depthGreater()}),ssao:x(g,`fs_ssao`,[this.layouts.ssao],[{format:`r8unorm`}]),blur:x(g,`fs_blur`,[this.layouts.blur],[{format:`r8unorm`}]),composite:x(_,`fs_composite`,[this.layouts.composite],[{format:n}]),lines:S(v,this.layouts.lines),text:S(y,this.layouts.text)}),this.buildStylePipelines(`studio`),this.groups.frame=a.createBindGroup({layout:this.layouts.frame,entries:[{binding:0,resource:{buffer:this.frameBuf}}]})}premult={color:{srcFactor:`one`,dstFactor:`one-minus-src-alpha`,operation:`add`},alpha:{srcFactor:`one`,dstFactor:`one-minus-src-alpha`,operation:`add`}};prepassTargets=[{format:k},{format:`rgba32uint`}];depthGreater=(e=!0)=>({format:A,depthWriteEnabled:e,depthCompare:`greater`});pipelineLayout=(...e)=>this.device.createPipelineLayout({bindGroupLayouts:e});buildStylePipelines(e){let t=this.device,[n,r]=Ge[e],i={topology:`triangle-list`,cullMode:`none`},a=[{arrayStride:12,attributes:[{shaderLocation:0,offset:0,format:`float32x3`}]},{arrayStride:4,attributes:[{shaderLocation:1,offset:0,format:`uint32`}]}],o=[{format:k,blend:{color:{srcFactor:`one`,dstFactor:`one`},alpha:{srcFactor:`one`,dstFactor:`one`}}},{format:`r16float`,blend:{color:{srcFactor:`zero`,dstFactor:`one-minus-src`},alpha:{srcFactor:`zero`,dstFactor:`one-minus-src`}}}];for(let[e,s,c]of[[`rigid`,n,this.layouts.rigid],[`dyn`,r,this.layouts.dyn]]){let n=t.createShaderModule({code:s}),r={module:n,entryPoint:`vs_main`,buffers:a},l=this.pipelineLayout(this.layouts.scene,c);this.pipes[`${e}Main`]=t.createRenderPipeline({layout:l,primitive:i,vertex:r,fragment:{module:n,entryPoint:`fs_main`,targets:[{format:k}]},depthStencil:this.depthGreater(),multisample:{count:O}}),this.pipes[`${e}Transparent`]=t.createRenderPipeline({layout:l,primitive:i,vertex:r,fragment:{module:n,entryPoint:`fs_transparent`,targets:o},depthStencil:this.depthGreater(!1),multisample:{count:O}}),this.pipes[`${e}Pre`]=t.createRenderPipeline({layout:l,primitive:i,vertex:r,fragment:{module:n,entryPoint:`fs_prepass`,targets:this.prepassTargets},depthStencil:this.depthGreater()}),this.pipes[`${e}Shadow`]=t.createRenderPipeline({layout:this.pipelineLayout(this.layouts.frame,c),primitive:i,vertex:{module:n,entryPoint:`vs_shadow`,buffers:a},fragment:{module:n,entryPoint:`fs_shadow`,targets:[]},depthStencil:{format:A,depthWriteEnabled:!0,depthCompare:`less`}})}this.builtStyle=e}static async create(t){if(!navigator.gpu)throw Error(`WebGPU is not available in this browser`);let n=await navigator.gpu.requestAdapter({powerPreference:`high-performance`});if(!n)throw Error(`no WebGPU adapter (is hardware acceleration on?)`);let r=await n.requestDevice();r.lost.then(e=>console.error(`WebGPU device lost:`,e.message)),r.addEventListener(`uncapturederror`,e=>console.error(`WebGPU:`,e.error.message));let i=t.getContext(`webgpu`);if(!i)throw Error(`could not get a WebGPU canvas context`);let a=navigator.gpu.getPreferredCanvasFormat();i.configure({device:r,format:a,alphaMode:`opaque`});let o=await ye(new URL(`.`,location.href).href);return new e(r,i,a,t,o)}storageBuffer(e,t){let n=e===`glyph`?24:16,r=this.device.createBuffer({size:t*n*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),i=this.device.createBindGroup({layout:this.layouts.storage,entries:[{binding:0,resource:{buffer:r}}]});return e===`glyph`?(this.glyphBuf?.destroy(),this.glyphCap=t,this.glyphGroup=i):(this.lineBuf?.destroy(),this.lineCap=t,this.lineGroup=i),r}clear(){for(let e of this.objects.values())st(e);this.objects.clear(),this.nextId=1}objectNames(){return[...this.objects].filter(([,e])=>e.kind!==`labels`).map(([e,t])=>({name:e,kind:t.kind}))}displayOf(e){let t=this.display.get(e);return t||this.display.set(e,t=Je()),t}setScene(e){this.clear();for(let t of e)if(t.kind===`rigid_mesh`)this.objects.set(t.name,this.makeRigid(t));else if(t.kind===`boxes`||t.kind===`points`){let e=this.device.createBuffer({size:rt,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),n={kind:`dyn`,id:this.nextId++,obj:t,params:e,indexCount:0,capacity:0,bind:this.device.createBindGroup({layout:this.layouts.dyn,entries:[{binding:0,resource:{buffer:e}}]}),lo:new Float32Array,hi:new Float32Array};this.objects.set(t.name,n),this.rebuildDyn(n)}else if(t.kind===`labels`){let e=t.arrays.values?.data;this.objects.set(t.name,{kind:`labels`,obj:t,values:e?Float32Array.from(e):null})}this.isolated=-1,this.selected=-1}rigidInfo(){for(let[e,t]of this.objects)if(t.kind===`rigid`)return{name:e,id:t.id,instances:t.instances,bodies:t.bodies,offsets:t.offsets};return null}makeRigid(e){let t=this.device,n=e.arrays,r=e.attrs.instances,i=n.body_triangle_offsets.data.length-1,a=this.nextId++,o=(e,n)=>{let r=t.createBuffer({size:Math.max(16,ot(e.byteLength)),usage:n|GPUBufferUsage.COPY_DST});return t.queue.writeBuffer(r,0,e.buffer,e.byteOffset,e.byteLength),r},s=n.local_vertices.data,c=new Uint32Array(n.vertex_body.data),l=o(s,GPUBufferUsage.VERTEX),u=o(c,GPUBufferUsage.VERTEX),d=o(n.triangles.data,GPUBufferUsage.INDEX),f=r*i,p=t.createBuffer({size:f*32,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),m=new Float32Array(f*8);for(let e=0;e<f;e++)m[e*8+7]=1;t.queue.writeBuffer(p,0,m);let h=t.createBuffer({size:Math.max(16,f*4),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),g=new Float32Array(r*4);for(let e=0;e<r;e++)for(let t=0;t<3;t++)g[e*4+t]=n.offsets.data[e*3+t];let _=o(g,GPUBufferUsage.STORAGE),v=t.createBuffer({size:rt,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),y=t.createBindGroup({layout:this.layouts.rigid,entries:[{binding:0,resource:{buffer:v}},{binding:1,resource:{buffer:p}},{binding:2,resource:{buffer:h}},{binding:3,resource:{buffer:_}}]}),b=new Uint32Array(f),x=n.segment_colors.data,S=n.segment_visible?.data;for(let e=0;e<f;e++)b[e]=$e(x[3*e],x[3*e+1],x[3*e+2],S&&!S[e]?0:1);let ee={kind:`rigid`,id:a,instances:r,bodies:i,indexCount:n.triangles.data.length,buffers:[l,u,d,p,h,_,v],params:v,pos:l,body:u,index:d,poses:p,colors:h,offsets:g,bind:y,poseScratch:m,poseHost:null,poseVersion:0,local:Float32Array.from(s),vertexBody:c,baseColors:b};return n.poses&&this.setPoses(ee,n.poses),this.writeColors(ee),ee}writeColors(e){let t=new Uint32Array(e.baseColors);for(let n=0;n<t.length;n++){let r=Math.floor(n/e.bodies);t[n]>>>24&&(this.isolated>=0&&r!==this.isolated?t[n]&=16777215:r===this.selected&&(t[n]=(t[n]&16777215|Ze<<24)>>>0))}this.device.queue.writeBuffer(e.colors,0,t)}setEnvState(e,t){if(e!==this.isolated||t!==this.selected){this.isolated=e,this.selected=t;for(let e of this.objects.values())e.kind===`rigid`?this.writeColors(e):e.kind===`dyn`&&this.rebuildDyn(e)}}setPoses(e,t){let n=e.instances*e.bodies,r=e.poseScratch;for(let e=0;e<n;e++){for(let n=0;n<3;n++)r[8*e+n]=t.data[7*e+n];for(let n=0;n<4;n++)r[8*e+4+n]=t.data[7*e+3+n]}this.device.queue.writeBuffer(e.poses,0,r),e.poseHost=Float32Array.from(t.data),e.poseVersion++}applyFrame(e){for(let[t,n]of Object.entries(e)){let e=this.objects.get(t);if(e){if(e.kind===`rigid`){if(n.poses&&this.setPoses(e,n.poses),n.segment_colors){let t=n.segment_colors.data;for(let n=0;n<e.baseColors.length;n++)e.baseColors[n]=$e(t[3*n],t[3*n+1],t[3*n+2],e.baseColors[n]>>>24?1:0);this.writeColors(e)}}else e.kind===`labels`?n.values&&(e.values=Float32Array.from(n.values.data)):(Object.assign(e.obj.arrays,n),this.rebuildDyn(e))}}}envOf(e,t){let n=this.rigidInfo();if(!n)return-1;let r=-1,i=1/0;for(let a=0;a<n.instances;a++){let o=(e-n.offsets[4*a])**2+(t-n.offsets[4*a+1])**2;o<i&&(i=o,r=a)}return r}rebuildDyn(e){let t=e.obj,n,r,i;if(t.kind===`boxes`)n=t.arrays.lo.data,r=t.arrays.hi.data,i=n.length/3;else{let e=t.arrays.points.data,a=t.arrays.radii?.data;i=e.length/3;let o=new Float32Array(e.length),s=new Float32Array(e.length);for(let n=0;n<i;n++)for(let r=0;r<3;r++){let i=a?a[n]:t.attrs.radius;o[3*n+r]=e[3*n+r]-i,s[3*n+r]=e[3*n+r]+i}n=o,r=s}e.lo=Float32Array.from(n),e.hi=Float32Array.from(r);let a=[];for(let e=0;e<i;e++){if(this.isolated>=0){let t=.5*(n[3*e]+r[3*e]),i=.5*(n[3*e+1]+r[3*e+1]);if(this.envOf(t,i)!==this.isolated)continue}a.push(e)}let o=a.length,s=new Float32Array(o*24),c=new Uint32Array(o*8),l=new Uint32Array(o*36),u=t.arrays.colors?.data,d=t.attrs.color;a.forEach((e,t)=>{let i=u?$e(u[3*e],u[3*e+1],u[3*e+2]):$e(d[0],d[1],d[2]);for(let a=0;a<8;a++){for(let i=0;i<3;i++)s[t*24+a*3+i]=n[3*e+i]+et[a*3+i]*(r[3*e+i]-n[3*e+i]);c[t*8+a]=i}for(let e=0;e<36;e++)l[t*36+e]=tt[e]+8*t});let f=this.device;if(e.capacity<s.byteLength||!e.pos){e.pos?.destroy(),e.color?.destroy(),e.index?.destroy();let t=Math.max(96,s.byteLength);e.pos=f.createBuffer({size:t,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST}),e.color=f.createBuffer({size:t/3,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST}),e.index=f.createBuffer({size:t*1.5,usage:GPUBufferUsage.INDEX|GPUBufferUsage.COPY_DST}),e.capacity=t}o&&(f.queue.writeBuffer(e.pos,0,s),f.queue.writeBuffer(e.color,0,c),f.queue.writeBuffer(e.index,0,l)),e.indexCount=l.length}ensureTargets(){let e=window.devicePixelRatio||1,t=Math.max(1,Math.floor(this.canvas.clientWidth*e)),n=Math.max(1,Math.floor(this.canvas.clientHeight*e));if(t===this.size[0]&&n===this.size[1]&&this.t.resolved)return;this.canvas.width=t,this.canvas.height=n,this.size=[t,n];for(let e of Object.keys(this.t))e!==`shadow`&&this.t[e].destroy();let r=GPUTextureUsage.RENDER_ATTACHMENT,i=GPUTextureUsage.TEXTURE_BINDING,a=(e,r,i,a=1)=>this.t[e]=this.device.createTexture({size:[t,n],format:r,usage:i,sampleCount:a});a(`msaaColor`,k,r,O),a(`msaaDepth`,A,r,O),a(`resolved`,k,r|i),a(`oitAccumMsaa`,k,r,O),a(`oitRevealMsaa`,`r16float`,r,O),a(`accum`,k,r|i),a(`reveal`,`r16float`,r|i),a(`preDepth`,A,r|i),a(`preNormal`,k,r|i),a(`preIds`,`rgba32uint`,r|i|GPUTextureUsage.COPY_SRC),a(`aoRaw`,`r8unorm`,r|i),a(`ao`,`r8unorm`,r|i);let o=e=>this.t[e].createView(),s={buffer:this.frameBuf};this.groups.ssao=this.group(`ssao`,[[0,s],[1,o(`preDepth`)],[2,o(`preNormal`)]]),this.groups.blur=this.group(`blur`,[[0,s],[1,o(`preDepth`)],[3,o(`aoRaw`)]]),this.groups.composite=this.group(`composite`,[[0,s],[1,o(`resolved`)],[2,o(`preIds`)],[3,o(`preDepth`)],[4,o(`preNormal`)],[5,o(`accum`)],[6,o(`reveal`)]]),this.groups.lines=this.group(`lines`,[[0,s],[1,o(`preDepth`)]]),this.groups.text=this.group(`text`,[[0,s],[1,o(`preDepth`)],[2,this.fontView],[3,this.samplers.clamp]]),this.rebuildSceneGroup()}group(e,t){return this.device.createBindGroup({layout:this.layouts[e],entries:t.map(([e,t])=>({binding:e,resource:t}))})}rebuildSceneGroup(){this.t.ao&&(this.groups.scene=this.group(`scene`,[[0,{buffer:this.frameBuf}],[1,this.samplers.clamp],[2,this.dummy],[3,this.matcapTex.createView()],[4,this.env?.view??this.dummy],[5,this.shadowView],[6,this.samplers.shadow],[7,this.t.ao.createView()],[8,this.samplers.repeat]]))}ensureStyle(){let e=this.settings,t=!1;this.builtStyle!==e.style&&this.buildStylePipelines(e.style),e.style===`matcap`&&this.matcapBuilt!==e.matcap&&(this.device.queue.writeTexture({texture:this.matcapTex},Fe(e.matcap,256),{bytesPerRow:1024},[256,256]),this.matcapBuilt=e.matcap),e.style===`pbr`&&this.envBuilt!==e.environment&&(this.env?.texture.destroy(),this.env=He(this.device,Be(e.environment)),this.envBuilt=e.environment,t=!0),t&&this.rebuildSceneGroup()}rigidBounds=new WeakMap;boundsOf(e){let t=e.poseHost;if(!t)return null;let n=`${e.poseVersion}/${this.isolated}`,r=this.rigidBounds.get(e);if(r?.key===n)return r;let i=[1/0,1/0,1/0],a=[-1/0,-1/0,-1/0],o=e.local,s=e.vertexBody,c=s.length;for(let n=0;n<e.instances;n++){if(this.isolated>=0&&n!==this.isolated)continue;let r=e.offsets[4*n],l=e.offsets[4*n+1],u=e.offsets[4*n+2];for(let d=0;d<c;d++){let c=(n*e.bodies+s[d])*7,f=o[3*d],p=o[3*d+1],m=o[3*d+2],h=t[c+3],g=t[c+4],_=t[c+5],v=t[c+6],y=2*(g*m-_*p),b=2*(_*f-h*m),x=2*(h*p-g*f),S=[t[c]+r+f+v*y+(g*x-_*b),t[c+1]+l+p+v*b+(_*y-h*x),t[c+2]+u+m+v*x+(h*b-g*y)];for(let e=0;e<3;e++)S[e]<i[e]&&(i[e]=S[e]),S[e]>a[e]&&(a[e]=S[e])}}let l={key:n,lo:i,hi:a};return this.rigidBounds.set(e,l),l}bounds(){let e=[1/0,1/0,1/0],t=[-1/0,-1/0,-1/0],n=(n,r,i)=>{e[0]=Math.min(e[0],n),e[1]=Math.min(e[1],r),e[2]=Math.min(e[2],i),t[0]=Math.max(t[0],n),t[1]=Math.max(t[1],r),t[2]=Math.max(t[2],i)};for(let e of this.objects.values())if(e.kind===`rigid`){let t=this.boundsOf(e);t&&(n(...t.lo),n(...t.hi))}else if(e.kind===`dyn`)for(let t=0;t<e.lo.length/3;t++)n(e.lo[3*t],e.lo[3*t+1],e.lo[3*t+2]),n(e.hi[3*t],e.hi[3*t+1],e.hi[3*t+2]);return Number.isFinite(e[0])?[e,t]:null}sliceEquation(){let e=this.settings.slice,t=[0,0,0];return t[e.axis]=e.flip?-1:1,[...t,e.flip?-e.offset:e.offset]}writeFrame(){let[e,t]=this.size,n=this.settings,r=this.frame,i=this.camera,a=i.view(),o=i.proj(e/t),s=fe(o,a);r.set(a,D.view),r.set(o,D.proj),r.set(s,D.viewProj),r.set(pe(s),D.invViewProj),r.set(pe(o),D.invProj),r.set(pe(a),D.invView);let c=i.eye();r.set([c[0],c[1],c[2],0],D.cameraPos),r.set([e,t,1/e,1/t],D.viewport);let l=n.style===`pbr`&&this.env?this.env.sunDir:Ye,u=Math.hypot(...l),d=[l[0]/u,l[1]/u,l[2]/u],f=this.bounds()??[[...i.target],[...i.target]],p=f[0],m=f[1];p[2]=Math.min(p[2],Xe);let h=[(p[0]+m[0])/2,(p[1]+m[1])/2,(p[2]+m[2])/2],g=.5*Math.hypot(m[0]-p[0],m[1]-p[1],m[2]-p[2])*1.05+.05,_=Math.abs(d[2])>.99?[0,1,0]:[0,0,1],v=ue([h[0]+d[0]*2*g,h[1]+d[1]*2*g,h[2]+d[2]*2*g],h,_);r.set(fe(at(-g,g,-g,g,0,4*g),v),D.lightViewProj),r.set([d[0],d[1],d[2],n.shadowStrength],D.sunDir),r.set(j(.235,.243,.259),D.bgTop),r.set(j(.114,.118,.129),D.bgBottom),r.set(j(.62,.64,.68,.2),D.gridMinor),r.set(j(.74,.76,.8,.42),D.gridMajor),r.set([Xe,Math.max(i.distance*12,8),+!!n.grid,+!!n.groundShadow],D.gridParams),r.set([2,0,0,1],D.gridPlane),r.set(j(.92,.26,.34,.85),D.axisU),r.set(j(.52,.8,.2,.85),D.axisV),r.set([...j(.05,.05,.06).slice(0,3),0],D.wire),r.set([0,0,0,0],D.wireMode),r.set(j(1,.63,.2),D.select),r.set(j(1,.88,.62),D.active),r.set(j(.02,.02,.025,.85),D.outline),r.set([n.ssao?n.aoStrength:0,n.exposure,+!!n.shadows,n.outline],D.style);let y={studio:[n.studioSpecular,n.studioWrap,n.studioAmbient,0],matcap:[n.matcapTint,0,0,0],pbr:[0,0,0,0],technical:[n.goochShift,n.goochContrast,0,0]}[n.style];r.set(y,D.style2),r.set([n.envRotation*Math.PI/180,n.envIntensity,(this.env?.mips??1)-1,0],D.env),r.set([n.aoRadius,.02,1,0],D.ao),r.set([+(n.style===`pbr`),n.outlineWidth,0,0],D.post),r.set(this.sliceEquation(),D.slice),r.set(this.env?this.env.sh:new Float32Array(36),D.sh),this.device.queue.writeBuffer(this.frameBuf,0,r)}writeObjectParams(){let e=this.settings.slice.enabled;for(let[t,n]of this.objects){if(n.kind===`labels`)continue;let r=this.displayOf(t),i=e&&r.sliced?2:0,a=new ArrayBuffer(rt),o=new Uint32Array(a),s=new Float32Array(a);n.kind===`rigid`?o.set([n.bodies,n.id,i,0]):o.set([n.id,i,0,0]),s.set([r.metallic,r.roughness,Math.min(Math.max(r.opacity,0),1),0],4),this.device.queue.writeBuffer(n.params,0,a)}}transparent(e){return this.displayOf(e).opacity<.999}view(){let e=this.camera,t=e.eye(),n=[e.target[0]-t[0],e.target[1]-t[1],e.target[2]-t[2]],r=Math.hypot(...n)||1;return{eye:t,forward:[n[0]/r,n[1]/r,n[2]/r],near:Math.max(1e-4,e.distance*.001),fovy:e.fovy,height:this.size[1]}}sliceOverlay(){let e=this.settings.slice,t=e.enabled&&e.show?this.bounds():null;if(!t)return{lines:[],label:null};let[n,r]=t,i=e.axis,a=(i+1)%3,o=(i+2)%3;for(let e=0;e<3;e++){let t=.05*(r[e]-n[e])+.01;n[e]-=t,r[e]+=t}let s=[0,1,2,3].map(t=>{let s=[0,0,0];return s[i]=e.offset,s[a]=t===1||t===2?r[a]:n[a],s[o]=t>=2?r[o]:n[o],s}),c=[.4,.82,1,.9],l=[];for(let e=0;e<4;e++){let t=s[(e+1)%4];l.push(...s[e],1.5,...t,.3,...c,0,0,0,0)}return{lines:l,label:{text:`${`xyz`[i]} = ${Ee(e.offset,.001)}`,anchor:s[2],color:c,align:[0,0],offset:[6,-16],worldHeight:0,sizePx:12,halo:[.05,.05,.06,.75],hiddenAlpha:.5}}}glyphs(e){let t=[];for(let e of this.objects.values()){if(e.kind!==`labels`)continue;let n=e.obj.attrs,r=e.obj.arrays.anchors.data,i=r.length/3;for(let a=0;a<i;a++){let i=n.texts?String(n.texts[a]):e.values?xe(n.fmt,e.values[a]):``;if(!i)continue;let o=[r[3*a],r[3*a+1],r[3*a+2]];this.isolated>=0&&this.envOf(o[0],o[1])!==this.isolated||t.push({text:i,anchor:o,color:n.color,align:n.align,worldHeight:n.world_height,sizePx:n.size_px})}}let n=this.view();this.settings.grid&&t.push(...this.rulers(n)),t.push(...e);let r=[];return this.text.layout(t,n,r),r}rulers(e){let[t,n]=this.size,r=this.camera,i=Xe,a=r.view(),o=r.proj(t/n),s=e=>{let r=[0,0,0,0],i=[0,0,0,0];for(let t=0;t<4;t++)r[t]=a[t]*e[0]+a[4+t]*e[1]+a[8+t]*e[2]+a[12+t];for(let e=0;e<4;e++)i[e]=o[e]*r[0]+o[4+e]*r[1]+o[8+e]*r[2]+o[12+e]*r[3];return i[3]<=1e-8?[-1e9,-1e9,r[2]]:[(i[0]/i[3]*.5+.5)*t,(.5-i[1]/i[3]*.5)*n,r[2]]},c=e=>{let r=s(e);return r[2]<0&&r[0]>8&&r[1]>8&&r[0]<t-8&&r[1]<n-8?[r[0],r[1]]:null},l=r.target[0],u=r.target[1],d=[l,u,i],f=Te(2*Math.max((d[0]-e.eye[0])*e.forward[0]+(d[1]-e.eye[1])*e.forward[1]+(d[2]-e.eye[2])*e.forward[2],e.near)*Math.tan(.5*r.fovy)/n*90),p=[.05,.05,.06,.75],m=[[.98,.66,.7,1],[.74,.9,.56,1]],h=[];for(let e=0;e<2;e++){let t=(e,t)=>[e,t,i],n=c(e===0?t(l,0):t(0,u))===null?Math.round((e===0?u:l)/f)*f:0,r=e===0?l:u,a=[-1e9,-1e9];for(let i of[1,-1]){let o=a;for(let s=i>0?0:-1;Math.abs(s)<=12;s+=i){let i=(Math.round(r/f)+s)*f,l=e===0?t(i,n):t(n,i),u=c(l);if(u){if(Math.hypot(u[0]-o[0],u[1]-o[1])<44)break;o=u,s===0&&(a=u),!(Math.abs(i)<1e-9*f&&e===1)&&h.push({text:Ee(i,f),anchor:l,color:m[e],align:[.5,0],offset:[0,6],worldHeight:0,sizePx:12,halo:p,hiddenAlpha:0})}}}}return h}drawGeometry(e,t){let n=t===`Transparent`;for(let[r,i]of this.objects)i.kind!==`labels`&&this.transparent(r)===n&&this.drawOne(e,i,t)}drawOne(e,t,n){t.kind===`rigid`?(e.setPipeline(this.pipes[`rigid${n}`]),e.setBindGroup(1,t.bind),e.setVertexBuffer(0,t.pos),e.setVertexBuffer(1,t.body),e.setIndexBuffer(t.index,`uint32`),e.drawIndexed(t.indexCount,t.instances)):t.indexCount>0&&(e.setPipeline(this.pipes[`dyn${n}`]),e.setBindGroup(1,t.bind),e.setVertexBuffer(0,t.pos),e.setVertexBuffer(1,t.color),e.setIndexBuffer(t.index,`uint32`),e.drawIndexed(t.indexCount))}render(){this.ensureTargets(),this.ensureStyle(),this.writeFrame(),this.writeObjectParams();let e=this.settings,t=this.sliceOverlay(),n=this.glyphs(t.label?[t.label]:[]),r=n.length/24;r>this.glyphCap&&(this.glyphBuf=this.storageBuffer(`glyph`,Math.max(r,2*this.glyphCap))),r&&this.device.queue.writeBuffer(this.glyphBuf,0,new Float32Array(n));let i=t.lines.length/16;i>this.lineCap&&(this.lineBuf=this.storageBuffer(`line`,Math.max(i,2*this.lineCap))),i&&this.device.queue.writeBuffer(this.lineBuf,0,new Float32Array(t.lines));let a=[...this.objects].some(([e,t])=>t.kind!==`labels`&&this.transparent(e)),o=e.grid||e.groundShadow,s=this.device,c=s.createCommandEncoder(),l=e=>this.t[e].createView(),u=(e,t,n)=>({view:e,resolveTarget:n,loadOp:`clear`,storeOp:n?`discard`:`store`,clearValue:{r:t[0],g:t[1],b:t[2],a:t[3]}}),d=(e,t)=>c.beginRenderPass({colorAttachments:[u(l(e),[t,t,t,1])]}).end(),f=c.beginRenderPass({colorAttachments:[],depthStencilAttachment:{view:this.shadowView,depthLoadOp:`clear`,depthStoreOp:`store`,depthClearValue:1}});if(e.shadows&&(f.setBindGroup(0,this.groups.frame),this.drawGeometry(f,`Shadow`)),f.end(),f=c.beginRenderPass({colorAttachments:[u(l(`preNormal`),[0,0,0,0]),u(l(`preIds`),[0,0,0,0])],depthStencilAttachment:{view:l(`preDepth`),depthLoadOp:`clear`,depthStoreOp:`store`,depthClearValue:0}}),f.setBindGroup(0,this.groups.scene),this.drawGeometry(f,`Pre`),o&&(f.setPipeline(this.pipes.gridPre),f.draw(3)),f.end(),e.ssao&&e.aoStrength>0)for(let[e,t]of[[`aoRaw`,`ssao`],[`ao`,`blur`]])f=c.beginRenderPass({colorAttachments:[u(l(e),[1,1,1,1])]}),f.setPipeline(this.pipes[t]),f.setBindGroup(0,this.groups[t]),f.draw(3),f.end();else d(`ao`,1);f=c.beginRenderPass({colorAttachments:[u(l(`msaaColor`),[0,0,0,0],l(`resolved`))],depthStencilAttachment:{view:l(`msaaDepth`),depthLoadOp:`clear`,depthStoreOp:a?`store`:`discard`,depthClearValue:0}}),f.setBindGroup(0,this.groups.scene),this.drawGeometry(f,`Main`),o&&(f.setPipeline(this.pipes.gridMain),f.draw(3)),f.end(),a?(f=c.beginRenderPass({colorAttachments:[u(l(`oitAccumMsaa`),[0,0,0,0],l(`accum`)),u(l(`oitRevealMsaa`),[1,1,1,1],l(`reveal`))],depthStencilAttachment:{view:l(`msaaDepth`),depthLoadOp:`load`,depthStoreOp:`discard`}}),f.setBindGroup(0,this.groups.scene),this.drawGeometry(f,`Transparent`),f.end()):d(`reveal`,1),f=c.beginRenderPass({colorAttachments:[u(this.context.getCurrentTexture().createView(),[0,0,0,1])]}),f.setPipeline(this.pipes.composite),f.setBindGroup(0,this.groups.composite),f.draw(3),i&&(f.setPipeline(this.pipes.lines),f.setBindGroup(0,this.groups.lines),f.setBindGroup(1,this.lineGroup),f.draw(6,i)),r&&(f.setPipeline(this.pipes.text),f.setBindGroup(0,this.groups.text),f.setBindGroup(1,this.glyphGroup),f.draw(6,r)),f.end(),s.queue.submit([c.finish()])}async pick(e,t){let n=window.devicePixelRatio||1,r=Math.floor(e*n),i=Math.floor(t*n);if(r<0||i<0||r>=this.size[0]||i>=this.size[1]||!this.t.preIds)return null;let a=this.device.createBuffer({size:256,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),o=this.device.createCommandEncoder();o.copyTextureToBuffer({texture:this.t.preIds,origin:[r,i]},{buffer:a,bytesPerRow:256},[1,1]),this.device.queue.submit([o.finish()]),await a.mapAsync(GPUMapMode.READ);let s=new Uint32Array(a.getMappedRange().slice(0,16));a.unmap(),a.destroy();for(let[e,t]of this.objects)if(t.kind!==`labels`&&t.id===s[0])return{object:e,segment:s[2]};return null}};function at(e,t,n,r,i,a){let o=new Float32Array(16);return o[0]=2/(t-e),o[5]=2/(r-n),o[10]=-1/(a-i),o[12]=-(t+e)/(t-e),o[13]=-(r+n)/(r-n),o[14]=-i/(a-i),o[15]=1,o}function ot(e){return e+3&-4}function st(e){if(e.kind===`rigid`)for(let t of e.buffers)t.destroy();else e.kind===`dyn`&&(e.pos?.destroy(),e.color?.destroy(),e.index?.destroy(),e.params.destroy())}var ct=[.1,.25,.5,1,2,4],lt=(e,t)=>getComputedStyle(e).getPropertyValue(t).trim(),ut=class{root;modeBtns;outer;outerRow;inner;plot;timeEl;playBtn;speedSel;chanSel;evals=[];mode=`live`;replay=null;selectedEval=null;t=0;playing=!1;speed=1;focus=-1;onMode=()=>{};onPickEval=()=>{};onSeek=()=>{};constructor(e){this.root=e,e.innerHTML=`
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
            ${ct.map(e=>`<option value="${e}"${e===1?` selected`:``}>${e}×</option>`).join(``)}
          </select>
          <span class="time"></span>
          <select class="chan" title="Channel plotted under the scrubber"></select>
        </div>
        <canvas class="plot" aria-label="Episode scrubber"></canvas>
      </div>`;let t=t=>e.querySelector(t);this.modeBtns={live:t(`[data-mode=live]`),ring:t(`[data-mode=ring]`),eval:t(`[data-mode=eval]`)};for(let[e,t]of Object.entries(this.modeBtns))t.addEventListener(`click`,()=>this.onMode(e));this.outerRow=t(`.outer-wrap`),this.outer=t(`.outer`),this.inner=t(`.inner`),this.plot=t(`.plot`),this.timeEl=t(`.time`),this.playBtn=t(`.b-play`),this.speedSel=t(`.speed`),this.chanSel=t(`.chan`),this.playBtn.addEventListener(`click`,()=>this.togglePlay()),t(`.b-start`).addEventListener(`click`,()=>this.seek(0)),t(`.b-pback`).addEventListener(`click`,()=>this.step(-1,!1)),t(`.b-pfwd`).addEventListener(`click`,()=>this.step(1,!1)),t(`.b-cback`).addEventListener(`click`,()=>this.step(-1,!0)),t(`.b-cfwd`).addEventListener(`click`,()=>this.step(1,!0)),this.speedSel.addEventListener(`change`,()=>this.speed=Number(this.speedSel.value)),this.chanSel.addEventListener(`change`,()=>this.drawPlot()),this.outer.addEventListener(`click`,e=>{let t=e.target.closest(`[data-id]`);t&&this.onPickEval(t.dataset.id)});let n=!1,r=e=>{if(!this.replay)return;let t=this.plot.getBoundingClientRect(),n=Math.max(0,Math.min(1,(e.clientX-t.left)/t.width));this.seek(n*this.replay.duration)};this.plot.addEventListener(`pointerdown`,e=>{n=!0,this.plot.setPointerCapture(e.pointerId),this.playing=!1,r(e)}),this.plot.addEventListener(`pointermove`,e=>n&&r(e)),this.plot.addEventListener(`pointerup`,()=>n=!1),new ResizeObserver(()=>this.drawPlot()).observe(this.plot),window.addEventListener(`keydown`,e=>{if(this.mode!==`live`&&this.replay&&!e.target.closest(`select, input`)){if(e.key===` `)this.togglePlay();else if(e.key===`ArrowLeft`)this.step(-1,e.shiftKey);else if(e.key===`ArrowRight`)this.step(1,e.shiftKey);else if(e.key===`Home`)this.seek(0);else if(e.key===`End`)this.seek(this.replay.duration);else if(e.key===`[`||e.key===`]`)this.pickNeighbor(e.key===`]`?1:-1);else return;e.preventDefault()}}),this.render()}setAvailable(e,t,n){this.modeBtns.live.disabled=!e,this.modeBtns.ring.disabled=!t,this.modeBtns.eval.disabled=!n}setMode(e){this.mode=e,this.playing=!1,this.render()}setEvals(e){this.evals=[...e].sort((e,t)=>(e.timestep??0)-(t.timestep??0)),this.renderOuter()}get evalList(){return this.evals}setReplay(e){this.replay=e,this.t=0,this.playing=!1;let t=this.chanSel.value,n=e?e.perEnvChannels():[];this.chanSel.innerHTML=n.map(e=>`<option>${e}</option>`).join(``);let r=n.includes(t)?t:n.includes(`flux`)?`flux`:n[0];r&&(this.chanSel.value=r),this.render()}pickNeighbor(e){if(this.mode!==`eval`||!this.evals.length)return;let t=this.evals.findIndex(e=>e.id===this.selectedEval),n=Math.max(0,Math.min(this.evals.length-1,(t<0?this.evals.length:t)+e));this.onPickEval(this.evals[n].id)}togglePlay(){this.replay&&(!this.playing&&this.t>=this.replay.duration&&(this.t=0),this.playing=!this.playing,this.render())}step(e,t){if(!this.replay)return;this.playing=!1;let n=t?this.replay.ctrlTicks:this.replay.physTicks,r=Math.round(this.t/n);this.seek((r+e)*n)}seek(e){this.replay&&(this.t=Math.max(0,Math.min(this.replay.duration,e)),this.render(),this.onSeek())}advance(e){let t=this.replay;if(!t||!this.playing)return!1;let n=e*this.speed/(t.msg.tick_seconds||.01),r=Math.min(t.duration,t.loadedUntil);return this.t=Math.min(r,this.t+n),this.t>=t.duration&&(this.playing=!1),this.render(),!0}render(){for(let[e,t]of Object.entries(this.modeBtns))t.classList.toggle(`on`,e===this.mode),t.setAttribute(`aria-selected`,String(e===this.mode));this.outerRow.style.visibility=this.mode===`eval`?`visible`:`hidden`,this.inner.style.display=this.mode===`live`?`none`:``,this.playBtn.textContent=this.playing?`⏸`:`▶`;let e=this.replay;if(e){let t=this.t*e.msg.tick_seconds,n=e.duration*e.msg.tick_seconds,r=Math.floor(this.t/e.ctrlTicks+1e-6),i=Math.floor(this.t/e.physTicks+1e-6),a=Math.round(e.duration/e.ctrlTicks),o=e.chunksDone<e.chunksTotal?` · loading ${Math.round(100*e.chunksDone/e.chunksTotal)}%`:``;this.timeEl.textContent=`${t.toFixed(3)} / ${n.toFixed(2)} s · control ${r}/${a} · physics ${i}${o}`}else this.timeEl.textContent=this.mode===`live`?``:`loading…`;this.drawPlot()}renderOuter(){let e=this.evals;if(!e.length){this.outer.innerHTML=`<span class="empty">no saved evals yet</span>`;return}let t=Math.max(...e.map(e=>e.timestep??0),1);this.outer.innerHTML=e.map((n,r)=>{let i=e.length===1?100:100*((n.timestep??r)-0)/(t-0),a=n.summary??{},o=0,c=[],l=s.reduce((e,[t])=>e+(a[t]??0),0)||1;for(let[e,t]of s){let n=(a[e]??0)/l;n<=0||(c.push(`<i style="bottom:${(100*o).toFixed(1)}%;height:${(100*n).toFixed(1)}%;background:${t}"></i>`),o+=n)}let u=[`t=${n.timestep??`?`}`,...s.filter(([e])=>a[e]!==void 0).map(([e])=>`${e} ${(a[e]*100).toFixed(0)}%`)].join(` · `);return`<button class="tick${n.id===this.selectedEval?` sel`:``}" data-id="${n.id}" style="left:${i.toFixed(2)}%" title="${u}" aria-label="${u}">${c.join(``)}</button>`}).join(``)}selectEval(e){this.selectedEval=e,this.renderOuter()}drawPlot(){let e=this.plot,t=window.devicePixelRatio||1,n=Math.max(1,Math.floor(e.clientWidth*t)),r=Math.max(1,Math.floor(e.clientHeight*t));(e.width!==n||e.height!==r)&&(e.width=n,e.height=r);let i=e.getContext(`2d`);i.clearRect(0,0,n,r);let a=this.replay;if(!a||this.mode===`live`)return;let o=e=>e/Math.max(1,a.duration)*n;i.fillStyle=`rgba(255,255,255,0.04)`,i.fillRect(0,0,o(a.loadedUntil),r);let s=this.chanSel.value,c=s?a.channel(s):null,l=s?a.channelTimes(s):null;if(c&&l){let e=c.shape[1],n=1/0,u=-1/0;for(let e=0;e<c.data.length;e++){let t=c.data[e];Number.isFinite(t)&&(n=Math.min(n,t),u=Math.max(u,t))}u>n||(u=n+1);let d=4*t,f=e=>r-d-(e-n)/(u-n)*(r-2*d),p=(t,n,r)=>{i.strokeStyle=n,i.lineWidth=r,i.beginPath();let s=a.endStep[t]??a.duration,u=!1;for(let n=0;n<l.length&&!(l[n]>s);n++){let r=o(l[n]),a=f(c.data[n*e+t]);u?i.lineTo(r,a):(i.moveTo(r,a),u=!0)}i.stroke()};for(let n=0;n<e;n++)n!==this.focus&&p(n,`rgba(154,160,168,0.35)`,t);this.focus>=0&&this.focus<e&&p(this.focus,lt(this.root,`--accent`)||`#4d8fd6`,2*t),i.fillStyle=lt(this.root,`--muted`)||`#9aa0a8`,i.font=`${10*t}px system-ui, sans-serif`,i.fillText(`${s}  ${dt(u)}`,4*t,11*t),i.fillText(dt(n),4*t,r-3*t)}i.fillStyle=`rgba(224,90,79,0.8)`;for(let e of a.endStep)e<a.duration&&i.fillRect(o(e)-t/2,r-5*t,t,5*t);i.fillStyle=`#e4e6ea`,i.fillRect(o(this.t)-t,0,2*t,r)}};function dt(e){let t=Math.abs(e);return t!==0&&(t<.001||t>=1e4)?e.toExponential(1):e.toFixed(t>=10?1:3)}var ft=`avbd-viz.display.v1`,pt=class{renderer;root;onChange=()=>{};constructor(e,t){this.renderer=t,this.root=e,this.load(),e.addEventListener(`input`,()=>this.changed()),e.addEventListener(`change`,()=>this.changed()),this.build()}get open(){return!this.root.hidden}toggle(e=!this.open){this.root.hidden=!e,e&&this.build()}sceneChanged(){this.open&&this.build()}load(){try{let e=JSON.parse(localStorage.getItem(ft)??`null`);if(e?.settings){let t=Ke();Object.assign(t,e.settings,{slice:{...t.slice,...e.settings.slice}}),this.renderer.settings=t}for(let[t,n]of Object.entries(e?.objects??{}))Object.assign(this.renderer.displayOf(t),n)}catch{}}save(){try{localStorage.setItem(ft,JSON.stringify({settings:this.renderer.settings,objects:Object.fromEntries(this.renderer.display)}))}catch{}}changed(){this.save(),this.onChange()}slider(e,t,n,r,i,a=e=>e.toFixed(2)){let o=document.createElement(`label`);o.className=`d-row`;let s=document.createElement(`output`),c=Object.assign(document.createElement(`input`),{type:`range`,min:String(r),max:String(i),step:String((i-r)/200),value:String(t())});return s.textContent=a(t()),c.addEventListener(`input`,()=>{n(Number(c.value)),s.textContent=a(t())}),o.append(Object.assign(document.createElement(`span`),{textContent:e}),c,s),o}check(e,t,n,r=!1){let i=document.createElement(`label`);i.className=`d-check`;let a=Object.assign(document.createElement(`input`),{type:`checkbox`,checked:t()});return a.addEventListener(`change`,()=>{n(a.checked),r&&this.build()}),i.append(a,document.createTextNode(e)),i}select(e,t,n,r,i=!1){let a=document.createElement(`label`);a.className=`d-row`;let o=document.createElement(`select`);return o.innerHTML=t.map((e,t)=>`<option value="${t}">${e}</option>`).join(``),o.value=String(n()),o.addEventListener(`change`,()=>{r(Number(o.value)),i&&this.build()}),a.append(Object.assign(document.createElement(`span`),{textContent:e}),o),a}heading(e){return Object.assign(document.createElement(`h3`),{textContent:e})}build(){let e=this.renderer,t=e.settings,n=[];n.push(this.select(`Style`,We.map(([,e])=>e),()=>We.findIndex(([e])=>e===t.style),e=>qe(t,We[e][0]),!0)),t.style===`studio`?(n.push(this.slider(`Specular`,()=>t.studioSpecular,e=>t.studioSpecular=e,0,1)),n.push(this.slider(`Softness`,()=>t.studioWrap,e=>t.studioWrap=e,0,1)),n.push(this.slider(`Ambient`,()=>t.studioAmbient,e=>t.studioAmbient=e,0,1))):t.style===`matcap`?(n.push(this.select(`Matcap`,[...Oe],()=>t.matcap,e=>{t.matcap=e,t.matcapTint=Ne(e)},!0)),n.push(this.slider(`Object color`,()=>t.matcapTint,e=>t.matcapTint=e,0,1))):t.style===`pbr`?(n.push(this.select(`Environment`,[...ke],()=>t.environment,e=>t.environment=e)),n.push(this.slider(`Intensity`,()=>t.envIntensity,e=>t.envIntensity=e,0,3)),n.push(this.slider(`Rotation`,()=>t.envRotation,e=>t.envRotation=e,-180,180,e=>`${e.toFixed(0)} deg`))):(n.push(this.slider(`Cool/warm`,()=>t.goochShift,e=>t.goochShift=e,0,2)),n.push(this.slider(`Contrast`,()=>t.goochContrast,e=>t.goochContrast=e,0,1))),n.push(this.check(`Shadows`,()=>t.shadows,e=>t.shadows=e,!0)),t.shadows&&n.push(this.slider(`Strength`,()=>t.shadowStrength,e=>t.shadowStrength=e,0,1)),n.push(this.check(`Ambient occlusion`,()=>t.ssao,e=>t.ssao=e,!0)),t.ssao&&(n.push(this.slider(`AO strength`,()=>t.aoStrength,e=>t.aoStrength=e,0,1)),n.push(this.slider(`AO radius`,()=>t.aoRadius,e=>t.aoRadius=e,.02,2,e=>`${e.toFixed(2)} m`))),n.push(this.select(`Outlines`,[`Off`,`Silhouettes`,`Silhouettes + creases`],()=>t.outline,e=>t.outline=e,!0)),t.outline>0&&n.push(this.slider(`Outline width`,()=>t.outlineWidth,e=>t.outlineWidth=Math.round(e),1,4,e=>`${e.toFixed(0)} px`)),n.push(this.slider(`Exposure`,()=>t.exposure,e=>t.exposure=e,.2,3)),n.push(this.check(`Grid`,()=>t.grid,e=>t.grid=e)),n.push(this.check(`Shadow catcher`,()=>t.groundShadow,e=>t.groundShadow=e)),n.push(this.heading(`Slice plane`));let r=t.slice;if(n.push(this.check(`Cut the scene`,()=>r.enabled,e=>{r.enabled=e,e&&this.centerSlice()},!0)),r.enabled){let t=document.createElement(`div`);t.className=`d-axes`,t.setAttribute(`role`,`radiogroup`),t.setAttribute(`aria-label`,`Slice axis`),[`X`,`Y`,`Z`].forEach((e,n)=>{let i=document.createElement(`label`),a=Object.assign(document.createElement(`input`),{type:`radio`,name:`slice-axis`,checked:r.axis===n});a.addEventListener(`change`,()=>{r.axis=n,this.centerSlice(),this.build()}),i.append(a,document.createTextNode(e)),t.append(i)}),n.push(t);let i=e.bounds(),a=i?i[0][r.axis]:-1,o=i?i[1][r.axis]:1;o-a<1e-6&&(a-=.5,o+=.5),n.push(this.slider(`Position`,()=>r.offset,e=>r.offset=e,a,o,e=>`${e.toPrecision(4)} m`)),n.push(this.check(`Flip side`,()=>r.flip,e=>r.flip=e)),n.push(this.check(`Outline`,()=>r.show,e=>r.show=e))}let i=e.objectNames();i.length&&n.push(this.heading(`Objects`));for(let{name:a}of i){let i=e.displayOf(a),o=document.createElement(`div`);o.className=`d-object`,o.append(Object.assign(document.createElement(`div`),{className:`d-name`,textContent:a})),o.append(this.slider(`Opacity`,()=>i.opacity,e=>i.opacity=e,.05,1)),r.enabled&&o.append(this.check(`Cut by the slice plane`,()=>i.sliced,e=>i.sliced=e)),t.style===`pbr`&&(o.append(this.slider(`Metallic`,()=>i.metallic,e=>i.metallic=e,0,1)),o.append(this.slider(`Roughness`,()=>i.roughness,e=>i.roughness=e,.02,1))),n.push(o)}let a=Object.assign(document.createElement(`button`),{textContent:`Reset display`,className:`d-reset`});a.addEventListener(`click`,()=>{e.settings=Ke(),e.display.clear(),this.build(),this.changed()}),n.push(a),this.root.replaceChildren(...n),this.changed()}centerSlice(){let e=this.renderer.bounds(),t=this.renderer.settings.slice;e&&(t.offset=.5*(e[0][t.axis]+e[1][t.axis]))}},M=`live`,N=e=>document.getElementById(e),P=N(`view`),F=N(`top`),I=new m(N(`panel`)),mt=N(`bar`),L=new ut(mt),ht=N(`error`),R=N(`envs`),gt=N(`rate`),_t=N(`save`),vt=N(`eval`),z={status:`connecting`,name:``,time:null,frames:0,dropped:0,fps:0,lastFrameAt:0,mode:`live`,replay:null,focus:-1,isolated:-1};window.__avbd=z,window.__timeline=L;var yt=[];z.errors=yt;var bt=console.error.bind(console);console.error=(...e)=>{yt.length<20&&yt.push(e.map(String).join(` `)),bt(...e)};var B=null,V=null,H=!0,xt=null,U=0,St=0,W,G=null,K=!1,q=null,J=!1,Ct=!1,wt=!1,Tt=[],Y=!1,Et=Number(gt.value),X=null,Dt={},Ot=new h,Z=null,kt=0,At=0;function jt(e){ht.textContent=e,ht.style.display=`block`}function Mt(e,t=`info`){let n=document.createElement(`div`);n.className=`toast ${t}`,n.textContent=e,N(`toasts`).append(n),setTimeout(()=>n.remove(),t===`error`?9e3:5e3)}function Q(e){q?.readyState===WebSocket.OPEN&&q.send(JSON.stringify(e))}function Nt(e){B.setScene(e.objects);let t=B.rigidInfo();St=t?t.instances:0,e.camera&&(G=e.camera),e.camera&&!K&&(B.camera.lookAt(e.camera[0],e.camera[1]),K=!0),z.focus>=St&&(z.focus=-1),z.isolated=-1,Lt(),V?.sceneChanged(),H=!0}function Pt(e){if(K)return;let t=B.rigidInfo()?.offsets,n=[1/0,1/0,1/0],r=[-1/0,-1/0,-1/0];for(let i of Object.values(e)){let e=i.poses;if(!e)continue;let[a,o]=e.shape;for(let i=0;i<a;i++)for(let a=0;a<o;a++)for(let s=0;s<3;s++){let c=e.data[(i*o+a)*7+s]+(t?t[4*i+s]:0);n[s]=Math.min(n[s],c),r[s]=Math.max(r[s],c)}}if(!Number.isFinite(n[0]))return;let i=[(n[0]+r[0])/2,(n[1]+r[1])/2,(n[2]+r[2])/2],a=Math.max(.5,Math.hypot(r[0]-n[0],r[1]-n[1],r[2]-n[2])/2),o=[i[0],i[1]-2.2*a,i[2]+1.6*a];B.camera.lookAt(o,i),G=[o,i],K=!0}var $=null;function Ft(e){let t=B?.rigidInfo();if(!t||e<0||e>=t.instances)return null;let n=G?G[1]:[0,0,1];return[t.offsets[4*e]+n[0],t.offsets[4*e+1]+n[1],t.offsets[4*e+2]+n[2]]}function It(e,t){let n=B.camera;$={from:[...n.target],to:e,d0:n.distance,d1:t,t0:performance.now()}}function Lt(){B?.setEnvState(z.isolated,z.focus),I.focus=z.focus,L.focus=z.focus,L.drawPlot(),Yt(!0),H=!0}function Rt(e,t=!0){if(z.focus=e,Lt(),!B||!t)return;let n=Ft(e);if(n)It(n,Math.min(B.camera.distance,2.5));else if(G&&z.isolated<0){let[e,t]=G;It([...t],Math.hypot(e[0]-t[0],e[1]-t[1],e[2]-t[2]))}}function zt(e){z.isolated=z.isolated===e?-1:e,e>=0&&(z.focus=e),Lt();let t=Ft(z.isolated>=0?z.isolated:z.focus);t&&B&&It(t,Math.min(B.camera.distance,2.5))}I.onFocus=e=>Rt(e);{let e=null,t=0;P.addEventListener(`pointerdown`,t=>e=[t.clientX,t.clientY]),P.addEventListener(`pointerup`,async n=>{if(!e||Math.hypot(n.clientX-e[0],n.clientY-e[1])>4||n.button!==0)return;e=null;let r=P.getBoundingClientRect(),i=await B?.pick(n.clientX-r.left,n.clientY-r.top),a=B?.rigidInfo(),o=i&&a&&i.object===a.name?Math.floor(i.segment/a.bodies):-1;n.detail>=2?(clearTimeout(t),o>=0&&zt(o)):t=window.setTimeout(()=>Rt(o,o>=0||z.focus>=0),220)}),window.addEventListener(`keydown`,e=>{e.key===`Escape`&&(z.isolated=-1,Rt(-1))})}function Bt(){let e=z.mode===`live`;for(let t of F.querySelectorAll(`.live-only`))t.style.display=e&&J?``:`none`;R.disabled=!Tt.includes(`select_envs`),_t.style.display=Tt.includes(`save_checkpoint`)?``:`none`,vt.style.display=Tt.includes(`run_eval`)?``:`none`}function Vt(e){let t=e?.envs,n=e?.env_total;if(!t?.length||!n){R.innerHTML=``;return}let r=t.length,i=[];for(let e=0;e<n;e+=r){let t=Math.min(e,n-r);if(i.push(`<option value="${t}">${t}–${t+r-1} of ${n}</option>`),t+r>=n)break}R.innerHTML=i.join(``),R.value=String(t[0])}R.addEventListener(`change`,()=>Q({type:`select_envs`,first:Number(R.value)})),gt.addEventListener(`change`,()=>{Et=Number(gt.value),Y&&Q({type:`subscribe`,stream:M,rate:Et})});for(let[e,t]of[[_t,`save_checkpoint`],[vt,`run_eval`]])e.addEventListener(`click`,()=>{Q({type:t}),e.disabled=!0,setTimeout(()=>e.disabled=!1,2e3)});function Ht(e){if(z.mode=e,L.setMode(e),Bt(),e===`live`){Z=null,L.setReplay(null),!Y&&J&&(Q({type:`subscribe`,stream:M,rate:Et}),Y=!0),X&&(W=X.info?.envs,Nt(X));return}if(Y&&=(Q({type:`unsubscribe`,stream:M}),!1),e===`ring`)Ut({source:`ring`});else{let e=L.evalList,t=L.selectedEval??e[e.length-1]?.id;t?Wt(t):(Z=null,L.setReplay(null))}}function Ut(e){kt++,Z=null,L.setReplay(null),Q({type:`open_replay`,...e})}function Wt(e){if(L.selectEval(e),z.mode!==`eval`){Ht(`eval`);return}Ut({source:`eval`,id:e})}function Gt(e){if(e.id!==kt)return;let t=new l(e);Z=t,z.replay={id:e.id,source:e.source,name:e.name,duration:e.duration,chunks:t.chunksTotal},W=e.meta.envs,Nt(e.scene),L.setReplay(t),t.onChunk=()=>{Q({type:`replay_ack`,id:t.id,n:t.chunksDone}),z.replay.loaded=t.chunksDone,t===Z&&(L.render(),Jt(!0))},Jt(!0)}function Kt(){let e=Z;if(!e)return z.mode===`ring`?`asking the trainer for its latest episodes…`:`loading…`;let t=e.msg.summary.batch??{},n=s.filter(([e])=>t[e]!==void 0&&t[e]>0).map(([e])=>`${e} ${(100*t[e]).toFixed(0)}%`).join(` · `);if(e.msg.source===`ring`){let t=e.msg.summary.envs??[],r=t.filter(e=>e.complete).length;return`last episodes at step ${e.msg.meta.timestep} · ${r}/${t.length} complete${n?` · `+n:``}`}let r=String(e.msg.meta.checkpoint??``).split(`/`).pop();return`${r?r+` · `:``}seed ${e.msg.meta.seed??`?`}${n?` · `+n:``}`}var qt=null;function Jt(e=!1){let t=Z;if(!t||!B)return;e&&t.resetCache();let n=t.sample(L.t,e);Pt(n.objects),B.applyFrame(n.objects);for(let[e,r]of Object.entries(t.msg.summary.batch??{}))typeof r==`number`&&(n.channels[`episode ${e}`]=r);qt=n,Yt(e),H=!0}function Yt(e=!1){let t=performance.now();if(!e&&t-At<100)return;if(At=t,z.mode===`live`){I.update({channels:Dt,numEnvs:St,envNames:W,series:Ot});return}let n=Z;if(!n||!qt)return;let r=n.series(L.t);I.update({channels:qt.channels,numEnvs:n.numEnvs,envNames:W,outcomes:n.msg.summary.envs?.map(e=>c(e))??[],ended:n.endStep.map(e=>L.t>=e),series:r})}L.onMode=Ht,L.onPickEval=Wt,L.onSeek=()=>Jt();function Xt(e){if(xt=e.seq,z.mode!==`live`)return;U&&e.seq>U+1&&(z.dropped+=e.seq-U-1),U=e.seq;let t=performance.now();z.lastFrameAt&&(z.fps=.8*z.fps+.2*(1e3/Math.max(1,t-z.lastFrameAt))),z.lastFrameAt=t,z.frames++,z.time=e.time,Pt(e.objects),B.applyFrame(e.objects),Dt=e.channels,Ot.push(e.channels,St),Yt(),H=!0}function Zt(){let e=`${location.protocol===`https:`?`wss`:`ws`}://${location.host}/ws`;z.status=`connecting`,q=new WebSocket(e),q.binaryType=`arraybuffer`,q.onmessage=e=>{if(!(e.data instanceof ArrayBuffer))return;let t=n(e.data);if(t.type===`hello`)z.name=t.name,document.title=`${t.name||`avbd-viz`} — avbd-viz`,J=t.streams.some(e=>e.name===M),Ct=!!t.replay?.ring,wt=!!t.replay?.evals,Tt=t.accepts??[],Y=!1,kt=0,L.setAvailable(J,Ct,wt),z.status=J?`waiting for the scene`:`replay`,Ht(z.mode===`live`&&!J?`eval`:z.mode);else if(t.type===`scene`){z.status=`live`;let e=X?.info?.envs?.[0]!==t.info?.envs?.[0];X=t,Vt(t.info),e&&Ot.clear(),z.mode===`live`&&(W=t.info?.envs,Nt(t))}else if(t.type===`frame`)Xt(t);else if(t.type===`evals`){let e=!wt||!L.evalList.length;wt=!0,L.setAvailable(J,Ct,!0),L.setEvals(t.evals),z.mode===`eval`&&e&&!Z&&Ht(`eval`)}else if(t.type===`replay`)Gt(t);else if(t.type===`replay_chunk`){let e=t;Z&&e.id===Z.id&&Z.addChunk(e)}else t.type===`event`&&Mt(t.text,t.level)},q.onclose=()=>{z.status=`disconnected — retrying`,U=0,Y=!1,setTimeout(Zt,1500)}}window.__golden=async(e,t,n,r,i={})=>{document.body.classList.add(`bare`);let a=B,{style:o,slice:s,objects:c,...l}=i;a.settings=Ke(),o&&qe(a.settings,o),Object.assign(a.settings,l),Object.assign(a.settings.slice,s??{}),a.display.clear();for(let[e,t]of Object.entries(c??{}))Object.assign(a.displayOf(e),t);Wt(e);let u=e=>new Promise(t=>setTimeout(t,e));for(let t=0;t<600;t++){let t=Z;if(t&&t.msg.meta.id===e&&t.chunksDone===t.chunksTotal)break;await u(50)}L.seek(t),B.camera.lookAt(n,r),K=!0,H=!0;for(let e=0;e<3;e++)await new Promise(e=>requestAnimationFrame(e));return Z?`ok`:`no replay`};{let e=new ResizeObserver(()=>{let e=document.documentElement.style;e.setProperty(`--bar-h`,`${mt.offsetHeight+12}px`),e.setProperty(`--top-h`,`${F.offsetHeight+12}px`)});for(let t of[mt,F,document.body])e.observe(t)}function Qt(){let e,t,n,r=z.name||`avbd-viz`;if(z.mode===`live`){e=z.status===`live`?`ok`:z.status===`connecting`?`wait`:`bad`,t=`${r} — ${z.status}`;let i=z.lastFrameAt?(performance.now()-z.lastFrameAt)/1e3:NaN;n=`step ${z.time??`–`} · ${z.frames} frames (${z.dropped} dropped) · ${z.fps.toFixed(1)} fps · last ${Number.isFinite(i)?i.toFixed(1)+` s`:`–`} ago`}else e=Z?`ok`:`wait`,t=`${r} — ${Z?Z.msg.name:z.mode===`ring`?`training ring`:`evals`}`,n=Kt();F.className=e,F.querySelector(`.title`).textContent=t,F.querySelector(`.clock`).textContent=n}var $t=performance.now();function en(e){let t=Math.min(.1,(e-$t)/1e3);if($t=e,z.mode!==`live`&&L.advance(t)&&Jt(),$&&B){let t=Math.min(1,(e-$.t0)/350),n=t*t*(3-2*t),r=B.camera;for(let e=0;e<3;e++)r.target[e]=$.from[e]+($.to[e]-$.from[e])*n;r.distance=$.d0+($.d1-$.d0)*n,t>=1&&($=null),H=!0}document.body.classList.contains(`bare`)&&(H=!0),B&&H&&(B.render(),H=!1),xt!==null&&q?.readyState===WebSocket.OPEN&&(q.send(JSON.stringify({type:`ack`,stream:M,seq:xt})),xt=null),Qt(),requestAnimationFrame(en)}it.create(P).then(e=>{B=e,V=new pt(N(`display`),e),V.onChange=()=>H=!0;let t=N(`display-btn`);t.addEventListener(`click`,()=>{V.toggle(),t.setAttribute(`aria-expanded`,String(V.open))}),e.camera.attach(P,()=>{$=null,H=!0}),new ResizeObserver(()=>H=!0).observe(P),Bt(),Zt(),requestAnimationFrame(en)}).catch(e=>jt(`Cannot start the viewer: ${e.message}`));