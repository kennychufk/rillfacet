(function(){let e=document.createElement(`link`).relList;if(e&&e.supports&&e.supports(`modulepreload`))return;for(let e of document.querySelectorAll(`link[rel="modulepreload"]`))n(e);new MutationObserver(e=>{for(let t of e)if(t.type===`childList`)for(let e of t.addedNodes)e.tagName===`LINK`&&e.rel===`modulepreload`&&n(e)}).observe(document,{childList:!0,subtree:!0});function t(e){let t={};return e.integrity&&(t.integrity=e.integrity),e.referrerPolicy&&(t.referrerPolicy=e.referrerPolicy),t.credentials=e.crossOrigin===`use-credentials`?`include`:e.crossOrigin===`anonymous`?`omit`:`same-origin`,t}function n(e){if(e.ep)return;e.ep=!0;let n=t(e);fetch(e.href,n)}})();var e={float32:Float32Array,int32:Int32Array,uint32:Uint32Array,int16:Int16Array,uint16:Uint16Array,uint8:Uint8Array};function t(e){return typeof e==`object`&&!!e&&`data`in e&&`shape`in e}function n(t){let n=new Uint8Array(t,0,4);if(String.fromCharCode(...n)!==`AVZ1`)throw Error(`bad message magic`);let r=new DataView(t).getUint32(4,!0),i=JSON.parse(new TextDecoder().decode(new Uint8Array(t,8,r))),a=i.$buffers??[];delete i.$buffers;let o=a.map(n=>{let r=e[n.dtype];return{data:new r(t,n.offset,n.nbytes/r.BYTES_PER_ELEMENT),shape:n.shape}}),s=e=>{if(Array.isArray(e))return e.map(s);if(e&&typeof e==`object`){let t=e,n=Object.keys(t);if(n.length===1&&n[0]===`$b`)return o[t.$b];for(let e of n)t[e]=s(t[e])}return e};return s(i)}var r=class{info;n;B;dyn=[];q;loaded=0;out;a=new Float32Array(7);b=new Float32Array(7);constructor(e){this.info=e,this.n=e.envs,this.B=e.bodies;for(let t=0;t<this.B;t++)e.static_mask.data[t]||this.dyn.push(t);this.q=new Int16Array(e.samples*this.n*this.dyn.length*7),this.out=new Float32Array(this.n*this.B*7);let t=e.static_poses.data;for(let n=0;n<this.n;n++){let r=0;for(let i=0;i<this.B;i++){if(!e.static_mask.data[i])continue;let a=e.static_poses.shape[1];for(let e=0;e<7;e++)this.out[(n*this.B+i)*7+e]=t[(n*a+r)*7+e];r++}}e.chunks===0&&(this.loaded=e.samples)}async addChunk(e){let t=e.data.data,n=new Blob([t]).stream().pipeThrough(new DecompressionStream(`deflate`)),r=new Int16Array(await new Response(n).arrayBuffer()),i=this.n*this.dyn.length*7,a=this.q.subarray(e.start*i,(e.start+e.count)*i);a.set(r.subarray(0,i));for(let t=1;t<e.count;t++)for(let e=0;e<i;e++)a[t*i+e]=a[(t-1)*i+e]+r[t*i+e];this.loaded=Math.max(this.loaded,e.start+e.count)}dequant(e,t,n,r){let i=this.dyn.length,a=((e*this.n+t)*i+n)*7,o=this.info.pos_lo.data,s=this.info.pos_span.data;for(let e=0;e<3;e++)r[e]=(this.q[a+e]+32768)/65535*s[e]+o[e];for(let e=3;e<7;e++)r[e]=this.q[a+e]/32767}sample(e,t){let n=Math.min(e+1,this.loaded-1);n<=e&&(t=0);let r=this.out,o=this.a,s=this.b;for(let c=0;c<this.n;c++)for(let l=0;l<this.dyn.length;l++){this.dequant(e,c,l,o);let u=(c*this.B+this.dyn[l])*7;if(t>0){this.dequant(n,c,l,s);for(let e=0;e<3;e++)r[u+e]=o[e]+(s[e]-o[e])*t;a(o,s,t,r,u+3)}else{for(let e=0;e<3;e++)r[u+e]=o[e];i(o,r,u+3)}}return r}};function i(e,t,n){let r=Math.hypot(e[3],e[4],e[5],e[6])||1;for(let i=0;i<4;i++)t[n+i]=e[3+i]/r}function a(e,t,n,r,i){let a=e[3]*t[3]+e[4]*t[4]+e[5]*t[5]+e[6]*t[6],o=a<0?-1:1;a*=o;let s,c;if(a>.9995)s=1-n,c=n;else{let e=Math.acos(Math.min(1,a)),t=Math.sin(e);s=Math.sin((1-n)*e)/t,c=Math.sin(n*e)/t}let l=0;for(let n=0;n<4;n++){let a=s*e[3+n]+c*o*t[3+n];r[i+n]=a,l+=a*a}l=Math.sqrt(l)||1;for(let e=0;e<4;e++)r[i+e]/=l}function o(e,t,n=e.length){let r=0,i=n-1;if(n===0||t<e[0])return 0;for(;r<i;){let n=r+i+1>>1;e[n]<=t?r=n:i=n-1}return r}var s=[[`success`,`var(--ok)`],[`forbidden`,`var(--bad)`],[`overload`,`var(--warn)`],[`unstable`,`var(--purple)`],[`timeout`,`var(--muted)`]];function c(e){if(!e)return``;for(let[t]of s)if(e[t]===!0)return t;return e.complete===!1||e.unfinished?`running`:`ended`}var l=class{msg;numEnvs;endStep;poses=new Map;cache=new Map;chain=Promise.resolve();chunksDone=0;chunksTotal;onChunk=()=>{};constructor(e){this.msg=e;let t=e.scene.objects.find(e=>e.kind===`rigid_mesh`);this.numEnvs=t?t.attrs.instances:0,this.endStep=Array.from({length:this.numEnvs},(t,n)=>e.summary.envs?.[n]?.end_step??e.duration);let n=0;e.tracks.forEach((e,t)=>{e.pose&&(this.poses.set(t,new r(e.pose)),n+=e.pose.chunks)}),this.chunksTotal=n}get id(){return this.msg.id}get duration(){return this.msg.duration}get physTicks(){let e=this.msg.meta.dt,t=this.msg.tick_seconds;return e&&t?e/t:1}get ctrlTicks(){return this.physTicks*(this.msg.meta.decimation??1)}get loadedUntil(){let e=this.duration;for(let[t,n]of this.poses){let r=this.msg.tracks[t].t.data;e=Math.min(e,n.loaded?r[n.loaded-1]:0)}return e}addChunk(e){return this.chain=this.chain.then(async()=>{await this.poses.get(e.track)?.addChunk(e),this.chunksDone++,this.onChunk()}),this.chain}channel(e){return this.msg.tracks.find(t=>t.object===`channels`&&t.field===e)?.values??null}channelTimes(e){let t=this.msg.tracks.find(t=>t.object===`channels`&&t.field===e);return t?t.t.data:null}perEnvChannels(){return this.msg.tracks.filter(e=>e.object===`channels`&&e.values&&e.values.shape.length===2&&e.values.shape[1]===this.numEnvs).map(e=>e.field)}sample(e,t=!1){let n={},r={},i=this.numEnvs;return this.msg.tracks.forEach((a,s)=>{let c=a.t.data,l=this.poses.get(s);if(l){if(!l.loaded)return;let t=o(c,e,l.loaded),r=t+1<l.loaded?c[t+1]-c[t]:0,i=r>0?Math.max(0,Math.min(1,(e-c[t])/r)):0;(n[a.object]??={})[a.field]={data:l.sample(t,i),shape:[l.n,l.B,7]};return}let u=a.values,d=u.shape.slice(1),f=d.reduce((e,t)=>e*t,1);if(a.object===`channels`){if(d.length===0)r[a.field]=u.data[o(c,e)];else if(d.length===1&&d[0]===i){let t=new Float32Array(i);for(let n=0;n<i;n++){let r=o(c,Math.min(e,this.endStep[n]));t[n]=u.data[r*i+n]}r[a.field]={data:t,shape:[i]}}else{let t=o(c,e);r[a.field]={data:u.data.subarray(t*f,(t+1)*f),shape:d}}return}let p=o(c,e);(t||this.cache.get(s)!==p)&&(this.cache.set(s,p),(n[a.object]??={})[a.field]={data:u.data.subarray(p*f,(p+1)*f),shape:d})}),{objects:n,channels:r}}resetCache(){this.cache.clear()}series(e){let t=e=>this.msg.tracks.find(t=>t.object===`channels`&&t.field===e&&t.values);return{scalar:n=>{let r=t(n);return!r||r.values.shape.length!==1?null:{data:r.values.data,cursor:o(r.t.data,e)}},perEnv:(n,r)=>{let i=t(n),a=this.numEnvs;if(!i||i.values.shape.length!==2||i.values.shape[1]!==a)return null;let s=`${n}/${r}`,c=this.columns.get(s);if(!c){let e=o(i.t.data,this.endStep[r])+1,t=new Float32Array(e);for(let n=0;n<e;n++)t[n]=i.values.data[n*a+r];this.columns.set(s,c={data:t,cursor:null})}return{data:c.data,cursor:o(i.t.data,Math.min(e,this.endStep[r]))}}}}columns=new Map},u=Object.fromEntries(s),d=e=>{if(!Number.isFinite(e))return String(e);let t=Math.abs(e);return t!==0&&(t<.001||t>=1e5)?e.toExponential(2):e.toFixed(t>=100?1:3)},f=class{root;names=``;rows=[];constructor(e){this.root=e}update(e,t=`none`){let n=e.map(([e])=>e).join(`
`)+`
`+t;n!==this.names&&(this.names=n,this.root.innerHTML=e.length?e.map(([e])=>`<div class="spark-row"><span class="k" title="${e}">${e}</span><span class="v num"></span><canvas class="spark"></canvas></div>`).join(``):`<div class="empty">${t}</div>`,this.rows=[...this.root.querySelectorAll(`.spark-row`)].map(e=>({value:e.querySelector(`.v`),canvas:e.querySelector(`canvas`)}))),e.forEach(([,e,t],n)=>{let r=this.rows[n];r.value.textContent=d(e),p(r.canvas,t)})}};function p(e,t){let n=window.devicePixelRatio||1,r=Math.max(1,Math.round(e.clientWidth*n)),i=Math.max(1,Math.round(e.clientHeight*n));(e.width!==r||e.height!==i)&&(e.width=r,e.height=i);let a=e.getContext(`2d`);if(a.clearRect(0,0,r,i),!t||t.data.length<2)return;let o=t.data,s=1/0,c=-1/0;for(let e=0;e<o.length;e++)Number.isFinite(o[e])&&(s=Math.min(s,o[e]),c=Math.max(c,o[e]));if(!Number.isFinite(s))return;c-s<1e-12&&(c+=.5,s-=.5);let l=e=>e/(o.length-1)*(r-2)+1,u=e=>i-2-(e-s)/(c-s)*(i-4);a.strokeStyle=`#8fb7e3`,a.lineWidth=n,a.beginPath();for(let e=0;e<o.length;e++)(e?a.lineTo:a.moveTo).call(a,l(e),u(o[e]));a.stroke();let d=t.cursor??o.length-1;a.fillStyle=`#e4e6ea`,a.beginPath(),a.arc(l(d),u(o[Math.max(0,Math.min(o.length-1,d))]),1.8*n,0,2*Math.PI),a.fill()}var m=class{focusHead;focusList;batchList;tableEl;focus=-1;onFocus=()=>{};constructor(e){e.innerHTML=`
      <section class="focus-sec"><h3 class="focus-head"></h3><div class="focus-list"></div></section>
      <section><h3>Batch</h3><div class="batch-list"></div></section>
      <section><h3>Envs</h3><div class="table"></div></section>`,this.focusHead=e.querySelector(`.focus-head`),this.focusList=new f(e.querySelector(`.focus-list`)),this.batchList=new f(e.querySelector(`.batch-list`)),this.tableEl=e.querySelector(`.table`),this.tableEl.addEventListener(`click`,e=>{let t=e.target.closest(`tr[data-env]`);if(!t)return;let n=Number(t.dataset.env);this.onFocus(this.focus===n?-1:n)})}update(e){let n=[],r=[];for(let[i,a]of Object.entries(e.channels))typeof a==`number`?n.push([i,a]):t(a)&&a.shape.length===1&&a.shape[0]===e.numEnvs&&r.push([i,a]);let i=t=>String(e.envNames?.[t]??t),a=t=>e.outcomes&&e.ended?.[t]?e.outcomes[t]:``,o=this.focus;if(o>=0&&o<e.numEnvs){let t=a(o);this.focusHead.innerHTML=`Env ${i(o)}`+(t?` <span class="oc" style="color:${u[t]??`inherit`}">${t}</span>`:``),this.focusList.update(r.map(([t,n])=>[t,n.data[o],e.series?.perEnv(t,o)??null]))}else this.focusHead.textContent=`Focus`,this.focusList.update([],`select something in an env (or click a row below) to focus it; double-click an env to show it alone`);if(this.batchList.update(n.map(([t,n])=>[t,n,e.series?.scalar(t)??null])),!r.length){this.tableKey!==``&&(this.tableKey=``,this.tableEl.innerHTML=`<div class="empty">none</div>`);return}let s=r.map(([e])=>e),c=[e.numEnvs,+!!e.outcomes,...s].join(`
`);if(c!==this.tableKey){this.tableKey=c;let t=`<tr><th>env</th>${e.outcomes?`<th>outcome</th>`:``}${s.map(e=>`<th>${e}</th>`).join(``)}</tr>`,n=`<td></td>${e.outcomes?`<td class="oc"></td>`:``}${s.map(()=>`<td class="num"></td>`).join(``)}`,r=Array.from({length:e.numEnvs},(e,t)=>`<tr data-env="${t}">${n}</tr>`);this.tableEl.innerHTML=`<table>${t}${r.join(``)}</table>`,this.rowEls=[...this.tableEl.querySelectorAll(`tr[data-env]`)]}let l=(e,t)=>{e.textContent!==t&&(e.textContent=t)};this.rowEls.forEach((t,n)=>{t.classList.toggle(`focus`,n===o);let s=t.children,c=0;if(l(s[c++],i(n)),e.outcomes){let e=a(n),t=s[c++];l(t,e||`…`),t.style.color=u[e]??``}for(let[,e]of r)l(s[c++],d(e.data[n]))})}tableKey=``;rowEls=[]},h=class{length;scalars=new Map;envs=new Map;constructor(e=240){this.length=e}clear(){this.scalars.clear(),this.envs.clear()}push(e,n){let r=(e,t)=>{e.push(t),e.length>this.length&&e.shift()};for(let[i,a]of Object.entries(e))if(typeof a==`number`)this.scalars.has(i)||this.scalars.set(i,[]),r(this.scalars.get(i),a);else if(t(a)&&a.shape.length===1&&a.shape[0]===n){let e=this.envs.get(i);(!e||e.length!==n)&&this.envs.set(i,e=Array.from({length:n},()=>[]));for(let t=0;t<n;t++)r(e[t],a.data[t])}}scalar(e){let t=this.scalars.get(e);return t?{data:t,cursor:null}:null}perEnv(e,t){let n=this.envs.get(e)?.[t];return n?{data:n,cursor:null}:null}},g=`// Web client: rigid bodies drawn from BODY-LOCAL vertices and one pose per
// (instance, body), so a frame only uploads the poses. One instanced draw per
// rigid mesh (instance = env). As the native mesh.wgsl, the vertex shader
// "pulls" positions from storage buffers (vertex k of an instance is corner
// k%3 of its triangle k/3), which gives flat normals and barycentric
// coordinates (for wires) for free. Faces and segments are numbered as the
// native viewer's merged mesh of all instances: face = instance * T + t,
// segment = instance * B + body. Fragment stages in surface.wgsl.
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
  num_faces: u32,      // triangles per instance
  material: vec4f,     // x = metallic, y = roughness, z = opacity
};

@group(1) @binding(0) var<uniform> params: Params;
@group(1) @binding(1) var<storage, read> poses: array<vec4f>;     // 2 per segment: t, q (xyzw)
// Per segment: x = packed sRGB color, y = flags (bit 0 hidden, bit 1 selected, bit 2 active).
@group(1) @binding(2) var<storage, read> segments: array<vec2u>;
@group(1) @binding(3) var<storage, read> offsets: array<vec4f>;   // per instance (display grid)
@group(1) @binding(4) var<storage, read> local: array<f32>;       // xyz per template vertex
@group(1) @binding(5) var<storage, read> vertex_body: array<u32>;
@group(1) @binding(6) var<storage, read> triangles: array<u32>;   // 3 per template face
// Per face of all instances: bit 0 selected, bit 1 active, bits 2..4 = edge k
// (corners k, k+1) is flat and hidden in wireframes (mesh.wgsl face_info.y).
@group(1) @binding(7) var<storage, read> face_info: array<u32>;

// Vertex outputs of the web client's meshes and the shared corner setup
// (the native mesh.wgsl vs_main for flat-shaded, uniformly colored faces).

struct VsOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) @interpolate(flat) normal: vec3f,
  @location(2) bary: vec3f,
  @location(3) @interpolate(flat) color: vec3f,
  @location(4) @interpolate(flat) ids: vec4u,  // object id, face, segment, face flags
  @location(5) @interpolate(flat) seg_flags: u32,
};

struct ShadowOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
};

// Pushes a vertex outside the clip volume so its triangle is dropped.
const CULLED = vec4f(0.0, 0.0, -2.0, 1.0);

// Corner \`corner\` of the world triangle p0 p1 p2; \`seg\` = (packed color, flags).
fn surface_vertex(p0: vec3f, p1: vec3f, p2: vec3f, corner: u32, face: u32, segment: u32,
                  seg: vec2u, face_flags: u32) -> VsOut {
  let p = select(select(p2, p1, corner == 1u), p0, corner == 0u);
  var out: VsOut;
  out.world = p;
  out.clip = select(frame.view_proj * vec4f(p, 1.0), CULLED, (seg.y & 1u) != 0u);
  let c = cross(p1 - p0, p2 - p0);
  out.normal = select(vec3f(0.0, 0.0, 1.0), normalize(c), dot(c, c) > 1e-30);
  out.bary = vec3f(f32(corner == 0u), f32(corner == 1u), f32(corner == 2u));
  out.color = unpack_srgb(seg.x);
  out.ids = vec4u(params.object_id, face, segment, face_flags);
  out.seg_flags = seg.y;
  return out;
}


fn quat_rotate(q: vec4f, v: vec3f) -> vec3f {
  let u = 2.0 * cross(q.xyz, v);
  return v + q.w * u + cross(q.xyz, u);
}

fn world_of(v: u32, inst: u32) -> vec3f {
  let s = inst * params.num_bodies + vertex_body[v];
  let p = vec3f(local[3u * v], local[3u * v + 1u], local[3u * v + 2u]);
  return poses[2u * s].xyz + quat_rotate(poses[2u * s + 1u], p) + offsets[inst].xyz;
}

fn segment_of(t: u32, inst: u32) -> u32 {
  return inst * params.num_bodies + vertex_body[triangles[3u * t]];
}

@vertex
fn vs_main(@builtin(vertex_index) vid: u32, @builtin(instance_index) inst: u32) -> VsOut {
  let t = vid / 3u;
  let corner = vid % 3u;
  let p0 = world_of(triangles[3u * t], inst);
  let p1 = world_of(triangles[3u * t + 1u], inst);
  let p2 = world_of(triangles[3u * t + 2u], inst);
  let s = segment_of(t, inst);
  let face = inst * params.num_faces + t;
  return surface_vertex(p0, p1, p2, corner, face, s, segments[s], face_info[face]);
}

@vertex
fn vs_shadow(@builtin(vertex_index) vid: u32, @builtin(instance_index) inst: u32) -> ShadowOut {
  let t = vid / 3u;
  let w = world_of(triangles[vid], inst);
  var out: ShadowOut;
  out.world = w;
  let hidden = (segments[segment_of(t, inst)].y & 1u) != 0u;
  out.clip = select(frame.light_view_proj * vec4f(w, 1.0), CULLED, hidden);
  return out;
}

// Shared fragment stages of the web client's meshes, as the native mesh.wgsl
// does them for flat-shaded, two-sided, uniformly colored faces: lit color
// with selection tints and the wire overlay, see-through (OIT), wireframe
// shading, prepass ids and shadow depth. Expects \`params\` (flags, material)
// and VsOut / ShadowOut (surface_io.wgsl).

// Fragments on the far side of the slice plane are cut away.
fn clipped(p: vec3f) -> bool {
  return (params.flags & 2u) != 0u && dot(frame.slice.xyz, p) > frame.slice.w;
}

// Coverage (0..1) of this triangle's edges at the pixel, \`width_px\` wide.
// Each triangle draws the inner half of its edges, so a shared edge comes out
// full width. Edges flagged flat in \`flags\` are skipped.
fn edge_coverage(bary: vec3f, bary_width: vec3f, flags: u32, width_px: f32) -> f32 {
  var d = bary / max(bary_width, vec3f(1e-6));  // pixels to the edge opposite each corner
  // Edge k joins corners k and k+1, so it lies opposite corner (k + 2) % 3.
  if ((flags & 4u) != 0u) { d.z = 1e6; }
  if ((flags & 8u) != 0u) { d.x = 1e6; }
  if ((flags & 16u) != 0u) { d.y = 1e6; }
  let edge = min(d.x, min(d.y, d.z));
  let w = width_px * 0.5;
  return 1.0 - smoothstep(w - 0.5, w + 0.5, edge);
}

// Wire color: theme or object color, orange when its body is selected.
fn wire_color(seg_flags: u32, albedo: vec3f) -> vec3f {
  if ((seg_flags & 2u) != 0u) {
    return select(frame.select_color.rgb, frame.active_color.rgb, (seg_flags & 4u) != 0u);
  }
  return select(frame.wire.rgb, albedo, frame.wire_mode.z > 0.5);
}

// Lit surface color, selection tint and wireframe overlay.
fn surface_color(in: VsOut, front: bool, bary_width: vec3f) -> vec3f {
  var s: Surface;
  s.n = select(-in.normal, in.normal, front);  // two-sided lighting
  s.p = in.world;
  s.v = view_dir(in.world);
  s.albedo = in.color;
  s.ao = sample_ao(in.clip.xy);
  s.shadow = sample_shadow(in.world, s.n);
  s.metallic = params.material.x;
  s.roughness = params.material.y;
  var color = shade(s) * frame.style.y;
  if ((in.ids.w & 1u) != 0u) {
    color = mix(color, frame.select_color.rgb, 0.45);
  }
  if ((in.seg_flags & 2u) != 0u) {
    color = mix(color, frame.select_color.rgb, 0.15);
  }
  if (frame.wire.a > 0.0) {
    let cov = edge_coverage(in.bary, bary_width, in.ids.w, frame.wire.a);
    color = mix(color, wire_color(in.seg_flags & 6u, frame.wire.rgb), cov);
  }
  return color;
}

// Lit color into the HDR target (composite.wgsl tone maps and encodes).
@fragment
fn fs_main(in: VsOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  // Screen-space derivatives first: they must run in uniform control flow.
  let bary_width = fwidth(in.bary);
  if (clipped(in.world)) {
    discard;
  }
  return vec4f(surface_color(in, front, bary_width), 1.0);
}

// Weighted blended order-independent transparency (McGuire & Bavoil 2013),
// as mesh.wgsl's fs_transparent; composite.wgsl resolves it.
struct OitOut {
  @location(0) accum: vec4f,
  @location(1) reveal: vec4f,
};

@fragment
fn fs_transparent(in: VsOut, @builtin(front_facing) front: bool) -> OitOut {
  let bary_width = fwidth(in.bary);
  if (clipped(in.world)) {
    discard;
  }
  let color = surface_color(in, front, bary_width);
  let a = params.material.z;
  let z = view_depth(in.clip.z) / 50.0;
  let w = a * clamp(0.03 / (1e-5 + pow(z, 4.0)), 1e-2, 3e3);
  var out: OitOut;
  out.accum = vec4f(color * a * w, a * w);
  out.reveal = vec4f(a);
  return out;
}

// Wireframe shading (Blender's "Wireframe" mode with X-ray): only edges, no
// depth test, so hidden edges show through. An optional faint face fill
// (frame.wire_mode.y) keeps shapes readable; selected faces get a tint.
@fragment
fn fs_wire(in: VsOut) -> @location(0) vec4f {
  let bary_width = fwidth(in.bary);
  let flags = in.ids.w;
  let albedo = in.color;
  let cov = edge_coverage(in.bary, bary_width, flags, frame.wire.a);
  let wire = wire_color(in.seg_flags, albedo);

  var fill = albedo;
  var fill_a = frame.wire_mode.y;
  if ((flags & 1u) != 0u) {
    fill = select(frame.select_color.rgb, frame.active_color.rgb, (flags & 2u) != 0u);
    fill_a = max(fill_a, 0.3);
  }
  // Premultiplied "wire over fill".
  let a = cov + fill_a * (1.0 - cov);
  if (a <= 0.001 || clipped(in.world)) {
    discard;
  }
  return vec4f(wire * cov + fill * fill_a * (1.0 - cov), a);
}

struct PrepassOut {
  @location(0) normal: vec4f,  // view-space normal
  @location(1) ids: vec4u,     // object id, face, segment, flags (bit 0 segment selected)
};

@fragment
fn fs_prepass(in: VsOut, @builtin(front_facing) front: bool) -> PrepassOut {
  if (clipped(in.world)) {
    discard;
  }
  var out: PrepassOut;
  out.normal = vec4f(to_view(select(-in.normal, in.normal, front)), 1.0);
  out.ids = vec4u(in.ids.x, in.ids.y, in.ids.z, (in.seg_flags >> 1u) & 1u);
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
// rigid mesh (instance = env). As the native mesh.wgsl, the vertex shader
// "pulls" positions from storage buffers (vertex k of an instance is corner
// k%3 of its triangle k/3), which gives flat normals and barycentric
// coordinates (for wires) for free. Faces and segments are numbered as the
// native viewer's merged mesh of all instances: face = instance * T + t,
// segment = instance * B + body. Fragment stages in surface.wgsl.
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
  num_faces: u32,      // triangles per instance
  material: vec4f,     // x = metallic, y = roughness, z = opacity
};

@group(1) @binding(0) var<uniform> params: Params;
@group(1) @binding(1) var<storage, read> poses: array<vec4f>;     // 2 per segment: t, q (xyzw)
// Per segment: x = packed sRGB color, y = flags (bit 0 hidden, bit 1 selected, bit 2 active).
@group(1) @binding(2) var<storage, read> segments: array<vec2u>;
@group(1) @binding(3) var<storage, read> offsets: array<vec4f>;   // per instance (display grid)
@group(1) @binding(4) var<storage, read> local: array<f32>;       // xyz per template vertex
@group(1) @binding(5) var<storage, read> vertex_body: array<u32>;
@group(1) @binding(6) var<storage, read> triangles: array<u32>;   // 3 per template face
// Per face of all instances: bit 0 selected, bit 1 active, bits 2..4 = edge k
// (corners k, k+1) is flat and hidden in wireframes (mesh.wgsl face_info.y).
@group(1) @binding(7) var<storage, read> face_info: array<u32>;

// Vertex outputs of the web client's meshes and the shared corner setup
// (the native mesh.wgsl vs_main for flat-shaded, uniformly colored faces).

struct VsOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) @interpolate(flat) normal: vec3f,
  @location(2) bary: vec3f,
  @location(3) @interpolate(flat) color: vec3f,
  @location(4) @interpolate(flat) ids: vec4u,  // object id, face, segment, face flags
  @location(5) @interpolate(flat) seg_flags: u32,
};

struct ShadowOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
};

// Pushes a vertex outside the clip volume so its triangle is dropped.
const CULLED = vec4f(0.0, 0.0, -2.0, 1.0);

// Corner \`corner\` of the world triangle p0 p1 p2; \`seg\` = (packed color, flags).
fn surface_vertex(p0: vec3f, p1: vec3f, p2: vec3f, corner: u32, face: u32, segment: u32,
                  seg: vec2u, face_flags: u32) -> VsOut {
  let p = select(select(p2, p1, corner == 1u), p0, corner == 0u);
  var out: VsOut;
  out.world = p;
  out.clip = select(frame.view_proj * vec4f(p, 1.0), CULLED, (seg.y & 1u) != 0u);
  let c = cross(p1 - p0, p2 - p0);
  out.normal = select(vec3f(0.0, 0.0, 1.0), normalize(c), dot(c, c) > 1e-30);
  out.bary = vec3f(f32(corner == 0u), f32(corner == 1u), f32(corner == 2u));
  out.color = unpack_srgb(seg.x);
  out.ids = vec4u(params.object_id, face, segment, face_flags);
  out.seg_flags = seg.y;
  return out;
}


fn quat_rotate(q: vec4f, v: vec3f) -> vec3f {
  let u = 2.0 * cross(q.xyz, v);
  return v + q.w * u + cross(q.xyz, u);
}

fn world_of(v: u32, inst: u32) -> vec3f {
  let s = inst * params.num_bodies + vertex_body[v];
  let p = vec3f(local[3u * v], local[3u * v + 1u], local[3u * v + 2u]);
  return poses[2u * s].xyz + quat_rotate(poses[2u * s + 1u], p) + offsets[inst].xyz;
}

fn segment_of(t: u32, inst: u32) -> u32 {
  return inst * params.num_bodies + vertex_body[triangles[3u * t]];
}

@vertex
fn vs_main(@builtin(vertex_index) vid: u32, @builtin(instance_index) inst: u32) -> VsOut {
  let t = vid / 3u;
  let corner = vid % 3u;
  let p0 = world_of(triangles[3u * t], inst);
  let p1 = world_of(triangles[3u * t + 1u], inst);
  let p2 = world_of(triangles[3u * t + 2u], inst);
  let s = segment_of(t, inst);
  let face = inst * params.num_faces + t;
  return surface_vertex(p0, p1, p2, corner, face, s, segments[s], face_info[face]);
}

@vertex
fn vs_shadow(@builtin(vertex_index) vid: u32, @builtin(instance_index) inst: u32) -> ShadowOut {
  let t = vid / 3u;
  let w = world_of(triangles[vid], inst);
  var out: ShadowOut;
  out.world = w;
  let hidden = (segments[segment_of(t, inst)].y & 1u) != 0u;
  out.clip = select(frame.light_view_proj * vec4f(w, 1.0), CULLED, hidden);
  return out;
}

// Shared fragment stages of the web client's meshes, as the native mesh.wgsl
// does them for flat-shaded, two-sided, uniformly colored faces: lit color
// with selection tints and the wire overlay, see-through (OIT), wireframe
// shading, prepass ids and shadow depth. Expects \`params\` (flags, material)
// and VsOut / ShadowOut (surface_io.wgsl).

// Fragments on the far side of the slice plane are cut away.
fn clipped(p: vec3f) -> bool {
  return (params.flags & 2u) != 0u && dot(frame.slice.xyz, p) > frame.slice.w;
}

// Coverage (0..1) of this triangle's edges at the pixel, \`width_px\` wide.
// Each triangle draws the inner half of its edges, so a shared edge comes out
// full width. Edges flagged flat in \`flags\` are skipped.
fn edge_coverage(bary: vec3f, bary_width: vec3f, flags: u32, width_px: f32) -> f32 {
  var d = bary / max(bary_width, vec3f(1e-6));  // pixels to the edge opposite each corner
  // Edge k joins corners k and k+1, so it lies opposite corner (k + 2) % 3.
  if ((flags & 4u) != 0u) { d.z = 1e6; }
  if ((flags & 8u) != 0u) { d.x = 1e6; }
  if ((flags & 16u) != 0u) { d.y = 1e6; }
  let edge = min(d.x, min(d.y, d.z));
  let w = width_px * 0.5;
  return 1.0 - smoothstep(w - 0.5, w + 0.5, edge);
}

// Wire color: theme or object color, orange when its body is selected.
fn wire_color(seg_flags: u32, albedo: vec3f) -> vec3f {
  if ((seg_flags & 2u) != 0u) {
    return select(frame.select_color.rgb, frame.active_color.rgb, (seg_flags & 4u) != 0u);
  }
  return select(frame.wire.rgb, albedo, frame.wire_mode.z > 0.5);
}

// Lit surface color, selection tint and wireframe overlay.
fn surface_color(in: VsOut, front: bool, bary_width: vec3f) -> vec3f {
  var s: Surface;
  s.n = select(-in.normal, in.normal, front);  // two-sided lighting
  s.p = in.world;
  s.v = view_dir(in.world);
  s.albedo = in.color;
  s.ao = sample_ao(in.clip.xy);
  s.shadow = sample_shadow(in.world, s.n);
  s.metallic = params.material.x;
  s.roughness = params.material.y;
  var color = shade(s) * frame.style.y;
  if ((in.ids.w & 1u) != 0u) {
    color = mix(color, frame.select_color.rgb, 0.45);
  }
  if ((in.seg_flags & 2u) != 0u) {
    color = mix(color, frame.select_color.rgb, 0.15);
  }
  if (frame.wire.a > 0.0) {
    let cov = edge_coverage(in.bary, bary_width, in.ids.w, frame.wire.a);
    color = mix(color, wire_color(in.seg_flags & 6u, frame.wire.rgb), cov);
  }
  return color;
}

// Lit color into the HDR target (composite.wgsl tone maps and encodes).
@fragment
fn fs_main(in: VsOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  // Screen-space derivatives first: they must run in uniform control flow.
  let bary_width = fwidth(in.bary);
  if (clipped(in.world)) {
    discard;
  }
  return vec4f(surface_color(in, front, bary_width), 1.0);
}

// Weighted blended order-independent transparency (McGuire & Bavoil 2013),
// as mesh.wgsl's fs_transparent; composite.wgsl resolves it.
struct OitOut {
  @location(0) accum: vec4f,
  @location(1) reveal: vec4f,
};

@fragment
fn fs_transparent(in: VsOut, @builtin(front_facing) front: bool) -> OitOut {
  let bary_width = fwidth(in.bary);
  if (clipped(in.world)) {
    discard;
  }
  let color = surface_color(in, front, bary_width);
  let a = params.material.z;
  let z = view_depth(in.clip.z) / 50.0;
  let w = a * clamp(0.03 / (1e-5 + pow(z, 4.0)), 1e-2, 3e3);
  var out: OitOut;
  out.accum = vec4f(color * a * w, a * w);
  out.reveal = vec4f(a);
  return out;
}

// Wireframe shading (Blender's "Wireframe" mode with X-ray): only edges, no
// depth test, so hidden edges show through. An optional faint face fill
// (frame.wire_mode.y) keeps shapes readable; selected faces get a tint.
@fragment
fn fs_wire(in: VsOut) -> @location(0) vec4f {
  let bary_width = fwidth(in.bary);
  let flags = in.ids.w;
  let albedo = in.color;
  let cov = edge_coverage(in.bary, bary_width, flags, frame.wire.a);
  let wire = wire_color(in.seg_flags, albedo);

  var fill = albedo;
  var fill_a = frame.wire_mode.y;
  if ((flags & 1u) != 0u) {
    fill = select(frame.select_color.rgb, frame.active_color.rgb, (flags & 2u) != 0u);
    fill_a = max(fill_a, 0.3);
  }
  // Premultiplied "wire over fill".
  let a = cov + fill_a * (1.0 - cov);
  if (a <= 0.001 || clipped(in.world)) {
    discard;
  }
  return vec4f(wire * cov + fill * fill_a * (1.0 - cov), a);
}

struct PrepassOut {
  @location(0) normal: vec4f,  // view-space normal
  @location(1) ids: vec4u,     // object id, face, segment, flags (bit 0 segment selected)
};

@fragment
fn fs_prepass(in: VsOut, @builtin(front_facing) front: bool) -> PrepassOut {
  if (clipped(in.world)) {
    discard;
  }
  var out: PrepassOut;
  out.normal = vec4f(to_view(select(-in.normal, in.normal, front)), 1.0);
  out.ids = vec4u(in.ids.x, in.ids.y, in.ids.z, (in.seg_flags >> 1u) & 1u);
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
// rigid mesh (instance = env). As the native mesh.wgsl, the vertex shader
// "pulls" positions from storage buffers (vertex k of an instance is corner
// k%3 of its triangle k/3), which gives flat normals and barycentric
// coordinates (for wires) for free. Faces and segments are numbered as the
// native viewer's merged mesh of all instances: face = instance * T + t,
// segment = instance * B + body. Fragment stages in surface.wgsl.
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
  num_faces: u32,      // triangles per instance
  material: vec4f,     // x = metallic, y = roughness, z = opacity
};

@group(1) @binding(0) var<uniform> params: Params;
@group(1) @binding(1) var<storage, read> poses: array<vec4f>;     // 2 per segment: t, q (xyzw)
// Per segment: x = packed sRGB color, y = flags (bit 0 hidden, bit 1 selected, bit 2 active).
@group(1) @binding(2) var<storage, read> segments: array<vec2u>;
@group(1) @binding(3) var<storage, read> offsets: array<vec4f>;   // per instance (display grid)
@group(1) @binding(4) var<storage, read> local: array<f32>;       // xyz per template vertex
@group(1) @binding(5) var<storage, read> vertex_body: array<u32>;
@group(1) @binding(6) var<storage, read> triangles: array<u32>;   // 3 per template face
// Per face of all instances: bit 0 selected, bit 1 active, bits 2..4 = edge k
// (corners k, k+1) is flat and hidden in wireframes (mesh.wgsl face_info.y).
@group(1) @binding(7) var<storage, read> face_info: array<u32>;

// Vertex outputs of the web client's meshes and the shared corner setup
// (the native mesh.wgsl vs_main for flat-shaded, uniformly colored faces).

struct VsOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) @interpolate(flat) normal: vec3f,
  @location(2) bary: vec3f,
  @location(3) @interpolate(flat) color: vec3f,
  @location(4) @interpolate(flat) ids: vec4u,  // object id, face, segment, face flags
  @location(5) @interpolate(flat) seg_flags: u32,
};

struct ShadowOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
};

// Pushes a vertex outside the clip volume so its triangle is dropped.
const CULLED = vec4f(0.0, 0.0, -2.0, 1.0);

// Corner \`corner\` of the world triangle p0 p1 p2; \`seg\` = (packed color, flags).
fn surface_vertex(p0: vec3f, p1: vec3f, p2: vec3f, corner: u32, face: u32, segment: u32,
                  seg: vec2u, face_flags: u32) -> VsOut {
  let p = select(select(p2, p1, corner == 1u), p0, corner == 0u);
  var out: VsOut;
  out.world = p;
  out.clip = select(frame.view_proj * vec4f(p, 1.0), CULLED, (seg.y & 1u) != 0u);
  let c = cross(p1 - p0, p2 - p0);
  out.normal = select(vec3f(0.0, 0.0, 1.0), normalize(c), dot(c, c) > 1e-30);
  out.bary = vec3f(f32(corner == 0u), f32(corner == 1u), f32(corner == 2u));
  out.color = unpack_srgb(seg.x);
  out.ids = vec4u(params.object_id, face, segment, face_flags);
  out.seg_flags = seg.y;
  return out;
}


fn quat_rotate(q: vec4f, v: vec3f) -> vec3f {
  let u = 2.0 * cross(q.xyz, v);
  return v + q.w * u + cross(q.xyz, u);
}

fn world_of(v: u32, inst: u32) -> vec3f {
  let s = inst * params.num_bodies + vertex_body[v];
  let p = vec3f(local[3u * v], local[3u * v + 1u], local[3u * v + 2u]);
  return poses[2u * s].xyz + quat_rotate(poses[2u * s + 1u], p) + offsets[inst].xyz;
}

fn segment_of(t: u32, inst: u32) -> u32 {
  return inst * params.num_bodies + vertex_body[triangles[3u * t]];
}

@vertex
fn vs_main(@builtin(vertex_index) vid: u32, @builtin(instance_index) inst: u32) -> VsOut {
  let t = vid / 3u;
  let corner = vid % 3u;
  let p0 = world_of(triangles[3u * t], inst);
  let p1 = world_of(triangles[3u * t + 1u], inst);
  let p2 = world_of(triangles[3u * t + 2u], inst);
  let s = segment_of(t, inst);
  let face = inst * params.num_faces + t;
  return surface_vertex(p0, p1, p2, corner, face, s, segments[s], face_info[face]);
}

@vertex
fn vs_shadow(@builtin(vertex_index) vid: u32, @builtin(instance_index) inst: u32) -> ShadowOut {
  let t = vid / 3u;
  let w = world_of(triangles[vid], inst);
  var out: ShadowOut;
  out.world = w;
  let hidden = (segments[segment_of(t, inst)].y & 1u) != 0u;
  out.clip = select(frame.light_view_proj * vec4f(w, 1.0), CULLED, hidden);
  return out;
}

// Shared fragment stages of the web client's meshes, as the native mesh.wgsl
// does them for flat-shaded, two-sided, uniformly colored faces: lit color
// with selection tints and the wire overlay, see-through (OIT), wireframe
// shading, prepass ids and shadow depth. Expects \`params\` (flags, material)
// and VsOut / ShadowOut (surface_io.wgsl).

// Fragments on the far side of the slice plane are cut away.
fn clipped(p: vec3f) -> bool {
  return (params.flags & 2u) != 0u && dot(frame.slice.xyz, p) > frame.slice.w;
}

// Coverage (0..1) of this triangle's edges at the pixel, \`width_px\` wide.
// Each triangle draws the inner half of its edges, so a shared edge comes out
// full width. Edges flagged flat in \`flags\` are skipped.
fn edge_coverage(bary: vec3f, bary_width: vec3f, flags: u32, width_px: f32) -> f32 {
  var d = bary / max(bary_width, vec3f(1e-6));  // pixels to the edge opposite each corner
  // Edge k joins corners k and k+1, so it lies opposite corner (k + 2) % 3.
  if ((flags & 4u) != 0u) { d.z = 1e6; }
  if ((flags & 8u) != 0u) { d.x = 1e6; }
  if ((flags & 16u) != 0u) { d.y = 1e6; }
  let edge = min(d.x, min(d.y, d.z));
  let w = width_px * 0.5;
  return 1.0 - smoothstep(w - 0.5, w + 0.5, edge);
}

// Wire color: theme or object color, orange when its body is selected.
fn wire_color(seg_flags: u32, albedo: vec3f) -> vec3f {
  if ((seg_flags & 2u) != 0u) {
    return select(frame.select_color.rgb, frame.active_color.rgb, (seg_flags & 4u) != 0u);
  }
  return select(frame.wire.rgb, albedo, frame.wire_mode.z > 0.5);
}

// Lit surface color, selection tint and wireframe overlay.
fn surface_color(in: VsOut, front: bool, bary_width: vec3f) -> vec3f {
  var s: Surface;
  s.n = select(-in.normal, in.normal, front);  // two-sided lighting
  s.p = in.world;
  s.v = view_dir(in.world);
  s.albedo = in.color;
  s.ao = sample_ao(in.clip.xy);
  s.shadow = sample_shadow(in.world, s.n);
  s.metallic = params.material.x;
  s.roughness = params.material.y;
  var color = shade(s) * frame.style.y;
  if ((in.ids.w & 1u) != 0u) {
    color = mix(color, frame.select_color.rgb, 0.45);
  }
  if ((in.seg_flags & 2u) != 0u) {
    color = mix(color, frame.select_color.rgb, 0.15);
  }
  if (frame.wire.a > 0.0) {
    let cov = edge_coverage(in.bary, bary_width, in.ids.w, frame.wire.a);
    color = mix(color, wire_color(in.seg_flags & 6u, frame.wire.rgb), cov);
  }
  return color;
}

// Lit color into the HDR target (composite.wgsl tone maps and encodes).
@fragment
fn fs_main(in: VsOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  // Screen-space derivatives first: they must run in uniform control flow.
  let bary_width = fwidth(in.bary);
  if (clipped(in.world)) {
    discard;
  }
  return vec4f(surface_color(in, front, bary_width), 1.0);
}

// Weighted blended order-independent transparency (McGuire & Bavoil 2013),
// as mesh.wgsl's fs_transparent; composite.wgsl resolves it.
struct OitOut {
  @location(0) accum: vec4f,
  @location(1) reveal: vec4f,
};

@fragment
fn fs_transparent(in: VsOut, @builtin(front_facing) front: bool) -> OitOut {
  let bary_width = fwidth(in.bary);
  if (clipped(in.world)) {
    discard;
  }
  let color = surface_color(in, front, bary_width);
  let a = params.material.z;
  let z = view_depth(in.clip.z) / 50.0;
  let w = a * clamp(0.03 / (1e-5 + pow(z, 4.0)), 1e-2, 3e3);
  var out: OitOut;
  out.accum = vec4f(color * a * w, a * w);
  out.reveal = vec4f(a);
  return out;
}

// Wireframe shading (Blender's "Wireframe" mode with X-ray): only edges, no
// depth test, so hidden edges show through. An optional faint face fill
// (frame.wire_mode.y) keeps shapes readable; selected faces get a tint.
@fragment
fn fs_wire(in: VsOut) -> @location(0) vec4f {
  let bary_width = fwidth(in.bary);
  let flags = in.ids.w;
  let albedo = in.color;
  let cov = edge_coverage(in.bary, bary_width, flags, frame.wire.a);
  let wire = wire_color(in.seg_flags, albedo);

  var fill = albedo;
  var fill_a = frame.wire_mode.y;
  if ((flags & 1u) != 0u) {
    fill = select(frame.select_color.rgb, frame.active_color.rgb, (flags & 2u) != 0u);
    fill_a = max(fill_a, 0.3);
  }
  // Premultiplied "wire over fill".
  let a = cov + fill_a * (1.0 - cov);
  if (a <= 0.001 || clipped(in.world)) {
    discard;
  }
  return vec4f(wire * cov + fill * fill_a * (1.0 - cov), a);
}

struct PrepassOut {
  @location(0) normal: vec4f,  // view-space normal
  @location(1) ids: vec4u,     // object id, face, segment, flags (bit 0 segment selected)
};

@fragment
fn fs_prepass(in: VsOut, @builtin(front_facing) front: bool) -> PrepassOut {
  if (clipped(in.world)) {
    discard;
  }
  var out: PrepassOut;
  out.normal = vec4f(to_view(select(-in.normal, in.normal, front)), 1.0);
  out.ids = vec4u(in.ids.x, in.ids.y, in.ids.z, (in.seg_flags >> 1u) & 1u);
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
// rigid mesh (instance = env). As the native mesh.wgsl, the vertex shader
// "pulls" positions from storage buffers (vertex k of an instance is corner
// k%3 of its triangle k/3), which gives flat normals and barycentric
// coordinates (for wires) for free. Faces and segments are numbered as the
// native viewer's merged mesh of all instances: face = instance * T + t,
// segment = instance * B + body. Fragment stages in surface.wgsl.
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
  num_faces: u32,      // triangles per instance
  material: vec4f,     // x = metallic, y = roughness, z = opacity
};

@group(1) @binding(0) var<uniform> params: Params;
@group(1) @binding(1) var<storage, read> poses: array<vec4f>;     // 2 per segment: t, q (xyzw)
// Per segment: x = packed sRGB color, y = flags (bit 0 hidden, bit 1 selected, bit 2 active).
@group(1) @binding(2) var<storage, read> segments: array<vec2u>;
@group(1) @binding(3) var<storage, read> offsets: array<vec4f>;   // per instance (display grid)
@group(1) @binding(4) var<storage, read> local: array<f32>;       // xyz per template vertex
@group(1) @binding(5) var<storage, read> vertex_body: array<u32>;
@group(1) @binding(6) var<storage, read> triangles: array<u32>;   // 3 per template face
// Per face of all instances: bit 0 selected, bit 1 active, bits 2..4 = edge k
// (corners k, k+1) is flat and hidden in wireframes (mesh.wgsl face_info.y).
@group(1) @binding(7) var<storage, read> face_info: array<u32>;

// Vertex outputs of the web client's meshes and the shared corner setup
// (the native mesh.wgsl vs_main for flat-shaded, uniformly colored faces).

struct VsOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) @interpolate(flat) normal: vec3f,
  @location(2) bary: vec3f,
  @location(3) @interpolate(flat) color: vec3f,
  @location(4) @interpolate(flat) ids: vec4u,  // object id, face, segment, face flags
  @location(5) @interpolate(flat) seg_flags: u32,
};

struct ShadowOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
};

// Pushes a vertex outside the clip volume so its triangle is dropped.
const CULLED = vec4f(0.0, 0.0, -2.0, 1.0);

// Corner \`corner\` of the world triangle p0 p1 p2; \`seg\` = (packed color, flags).
fn surface_vertex(p0: vec3f, p1: vec3f, p2: vec3f, corner: u32, face: u32, segment: u32,
                  seg: vec2u, face_flags: u32) -> VsOut {
  let p = select(select(p2, p1, corner == 1u), p0, corner == 0u);
  var out: VsOut;
  out.world = p;
  out.clip = select(frame.view_proj * vec4f(p, 1.0), CULLED, (seg.y & 1u) != 0u);
  let c = cross(p1 - p0, p2 - p0);
  out.normal = select(vec3f(0.0, 0.0, 1.0), normalize(c), dot(c, c) > 1e-30);
  out.bary = vec3f(f32(corner == 0u), f32(corner == 1u), f32(corner == 2u));
  out.color = unpack_srgb(seg.x);
  out.ids = vec4u(params.object_id, face, segment, face_flags);
  out.seg_flags = seg.y;
  return out;
}


fn quat_rotate(q: vec4f, v: vec3f) -> vec3f {
  let u = 2.0 * cross(q.xyz, v);
  return v + q.w * u + cross(q.xyz, u);
}

fn world_of(v: u32, inst: u32) -> vec3f {
  let s = inst * params.num_bodies + vertex_body[v];
  let p = vec3f(local[3u * v], local[3u * v + 1u], local[3u * v + 2u]);
  return poses[2u * s].xyz + quat_rotate(poses[2u * s + 1u], p) + offsets[inst].xyz;
}

fn segment_of(t: u32, inst: u32) -> u32 {
  return inst * params.num_bodies + vertex_body[triangles[3u * t]];
}

@vertex
fn vs_main(@builtin(vertex_index) vid: u32, @builtin(instance_index) inst: u32) -> VsOut {
  let t = vid / 3u;
  let corner = vid % 3u;
  let p0 = world_of(triangles[3u * t], inst);
  let p1 = world_of(triangles[3u * t + 1u], inst);
  let p2 = world_of(triangles[3u * t + 2u], inst);
  let s = segment_of(t, inst);
  let face = inst * params.num_faces + t;
  return surface_vertex(p0, p1, p2, corner, face, s, segments[s], face_info[face]);
}

@vertex
fn vs_shadow(@builtin(vertex_index) vid: u32, @builtin(instance_index) inst: u32) -> ShadowOut {
  let t = vid / 3u;
  let w = world_of(triangles[vid], inst);
  var out: ShadowOut;
  out.world = w;
  let hidden = (segments[segment_of(t, inst)].y & 1u) != 0u;
  out.clip = select(frame.light_view_proj * vec4f(w, 1.0), CULLED, hidden);
  return out;
}

// Shared fragment stages of the web client's meshes, as the native mesh.wgsl
// does them for flat-shaded, two-sided, uniformly colored faces: lit color
// with selection tints and the wire overlay, see-through (OIT), wireframe
// shading, prepass ids and shadow depth. Expects \`params\` (flags, material)
// and VsOut / ShadowOut (surface_io.wgsl).

// Fragments on the far side of the slice plane are cut away.
fn clipped(p: vec3f) -> bool {
  return (params.flags & 2u) != 0u && dot(frame.slice.xyz, p) > frame.slice.w;
}

// Coverage (0..1) of this triangle's edges at the pixel, \`width_px\` wide.
// Each triangle draws the inner half of its edges, so a shared edge comes out
// full width. Edges flagged flat in \`flags\` are skipped.
fn edge_coverage(bary: vec3f, bary_width: vec3f, flags: u32, width_px: f32) -> f32 {
  var d = bary / max(bary_width, vec3f(1e-6));  // pixels to the edge opposite each corner
  // Edge k joins corners k and k+1, so it lies opposite corner (k + 2) % 3.
  if ((flags & 4u) != 0u) { d.z = 1e6; }
  if ((flags & 8u) != 0u) { d.x = 1e6; }
  if ((flags & 16u) != 0u) { d.y = 1e6; }
  let edge = min(d.x, min(d.y, d.z));
  let w = width_px * 0.5;
  return 1.0 - smoothstep(w - 0.5, w + 0.5, edge);
}

// Wire color: theme or object color, orange when its body is selected.
fn wire_color(seg_flags: u32, albedo: vec3f) -> vec3f {
  if ((seg_flags & 2u) != 0u) {
    return select(frame.select_color.rgb, frame.active_color.rgb, (seg_flags & 4u) != 0u);
  }
  return select(frame.wire.rgb, albedo, frame.wire_mode.z > 0.5);
}

// Lit surface color, selection tint and wireframe overlay.
fn surface_color(in: VsOut, front: bool, bary_width: vec3f) -> vec3f {
  var s: Surface;
  s.n = select(-in.normal, in.normal, front);  // two-sided lighting
  s.p = in.world;
  s.v = view_dir(in.world);
  s.albedo = in.color;
  s.ao = sample_ao(in.clip.xy);
  s.shadow = sample_shadow(in.world, s.n);
  s.metallic = params.material.x;
  s.roughness = params.material.y;
  var color = shade(s) * frame.style.y;
  if ((in.ids.w & 1u) != 0u) {
    color = mix(color, frame.select_color.rgb, 0.45);
  }
  if ((in.seg_flags & 2u) != 0u) {
    color = mix(color, frame.select_color.rgb, 0.15);
  }
  if (frame.wire.a > 0.0) {
    let cov = edge_coverage(in.bary, bary_width, in.ids.w, frame.wire.a);
    color = mix(color, wire_color(in.seg_flags & 6u, frame.wire.rgb), cov);
  }
  return color;
}

// Lit color into the HDR target (composite.wgsl tone maps and encodes).
@fragment
fn fs_main(in: VsOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  // Screen-space derivatives first: they must run in uniform control flow.
  let bary_width = fwidth(in.bary);
  if (clipped(in.world)) {
    discard;
  }
  return vec4f(surface_color(in, front, bary_width), 1.0);
}

// Weighted blended order-independent transparency (McGuire & Bavoil 2013),
// as mesh.wgsl's fs_transparent; composite.wgsl resolves it.
struct OitOut {
  @location(0) accum: vec4f,
  @location(1) reveal: vec4f,
};

@fragment
fn fs_transparent(in: VsOut, @builtin(front_facing) front: bool) -> OitOut {
  let bary_width = fwidth(in.bary);
  if (clipped(in.world)) {
    discard;
  }
  let color = surface_color(in, front, bary_width);
  let a = params.material.z;
  let z = view_depth(in.clip.z) / 50.0;
  let w = a * clamp(0.03 / (1e-5 + pow(z, 4.0)), 1e-2, 3e3);
  var out: OitOut;
  out.accum = vec4f(color * a * w, a * w);
  out.reveal = vec4f(a);
  return out;
}

// Wireframe shading (Blender's "Wireframe" mode with X-ray): only edges, no
// depth test, so hidden edges show through. An optional faint face fill
// (frame.wire_mode.y) keeps shapes readable; selected faces get a tint.
@fragment
fn fs_wire(in: VsOut) -> @location(0) vec4f {
  let bary_width = fwidth(in.bary);
  let flags = in.ids.w;
  let albedo = in.color;
  let cov = edge_coverage(in.bary, bary_width, flags, frame.wire.a);
  let wire = wire_color(in.seg_flags, albedo);

  var fill = albedo;
  var fill_a = frame.wire_mode.y;
  if ((flags & 1u) != 0u) {
    fill = select(frame.select_color.rgb, frame.active_color.rgb, (flags & 2u) != 0u);
    fill_a = max(fill_a, 0.3);
  }
  // Premultiplied "wire over fill".
  let a = cov + fill_a * (1.0 - cov);
  if (a <= 0.001 || clipped(in.world)) {
    discard;
  }
  return vec4f(wire * cov + fill * fill_a * (1.0 - cov), a);
}

struct PrepassOut {
  @location(0) normal: vec4f,  // view-space normal
  @location(1) ids: vec4u,     // object id, face, segment, flags (bit 0 segment selected)
};

@fragment
fn fs_prepass(in: VsOut, @builtin(front_facing) front: bool) -> PrepassOut {
  if (clipped(in.world)) {
    discard;
  }
  var out: PrepassOut;
  out.normal = vec4f(to_view(select(-in.normal, in.normal, front)), 1.0);
  out.ids = vec4u(in.ids.x, in.ids.y, in.ids.z, (in.seg_flags >> 1u) & 1u);
  return out;
}

@fragment
fn fs_shadow(in: ShadowOut) {
  if (clipped(in.world)) {
    discard;
  }
}

`,b=`// Web client: small geometry rebuilt on the CPU when it changes (meter boxes,
// markers): world-space vertices with a packed sRGB color each, pulled per
// triangle corner as in rigid.wgsl. Fragment stages in surface.wgsl.
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
@group(1) @binding(1) var<storage, read> positions: array<f32>;  // xyz per vertex
@group(1) @binding(2) var<storage, read> colors: array<u32>;     // packed sRGB per vertex
@group(1) @binding(3) var<storage, read> triangles: array<u32>;  // 3 per face
// Per face: as rigid.wgsl, plus bit 5 hidden (a box of an env not shown).
@group(1) @binding(4) var<storage, read> face_info: array<u32>;
// The object's one segment: color (unused), flags (bit 1 selected, bit 2 active).
@group(1) @binding(5) var<storage, read> segments: array<vec2u>;

// Vertex outputs of the web client's meshes and the shared corner setup
// (the native mesh.wgsl vs_main for flat-shaded, uniformly colored faces).

struct VsOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) @interpolate(flat) normal: vec3f,
  @location(2) bary: vec3f,
  @location(3) @interpolate(flat) color: vec3f,
  @location(4) @interpolate(flat) ids: vec4u,  // object id, face, segment, face flags
  @location(5) @interpolate(flat) seg_flags: u32,
};

struct ShadowOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
};

// Pushes a vertex outside the clip volume so its triangle is dropped.
const CULLED = vec4f(0.0, 0.0, -2.0, 1.0);

// Corner \`corner\` of the world triangle p0 p1 p2; \`seg\` = (packed color, flags).
fn surface_vertex(p0: vec3f, p1: vec3f, p2: vec3f, corner: u32, face: u32, segment: u32,
                  seg: vec2u, face_flags: u32) -> VsOut {
  let p = select(select(p2, p1, corner == 1u), p0, corner == 0u);
  var out: VsOut;
  out.world = p;
  out.clip = select(frame.view_proj * vec4f(p, 1.0), CULLED, (seg.y & 1u) != 0u);
  let c = cross(p1 - p0, p2 - p0);
  out.normal = select(vec3f(0.0, 0.0, 1.0), normalize(c), dot(c, c) > 1e-30);
  out.bary = vec3f(f32(corner == 0u), f32(corner == 1u), f32(corner == 2u));
  out.color = unpack_srgb(seg.x);
  out.ids = vec4u(params.object_id, face, segment, face_flags);
  out.seg_flags = seg.y;
  return out;
}


fn load_position(i: u32) -> vec3f {
  return vec3f(positions[3u * i], positions[3u * i + 1u], positions[3u * i + 2u]);
}

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VsOut {
  let face = vid / 3u;
  let corner = vid % 3u;
  let p0 = load_position(triangles[3u * face]);
  let p1 = load_position(triangles[3u * face + 1u]);
  let p2 = load_position(triangles[3u * face + 2u]);
  var seg = segments[0];
  seg.x = colors[triangles[vid]];
  seg.y |= select(0u, 1u, (face_info[face] & 32u) != 0u);
  return surface_vertex(p0, p1, p2, corner, face, 0u, seg, face_info[face]);
}

@vertex
fn vs_shadow(@builtin(vertex_index) vid: u32) -> ShadowOut {
  let w = load_position(triangles[vid]);
  var out: ShadowOut;
  out.world = w;
  out.clip = select(frame.light_view_proj * vec4f(w, 1.0), CULLED, (face_info[vid / 3u] & 32u) != 0u);
  return out;
}

// Shared fragment stages of the web client's meshes, as the native mesh.wgsl
// does them for flat-shaded, two-sided, uniformly colored faces: lit color
// with selection tints and the wire overlay, see-through (OIT), wireframe
// shading, prepass ids and shadow depth. Expects \`params\` (flags, material)
// and VsOut / ShadowOut (surface_io.wgsl).

// Fragments on the far side of the slice plane are cut away.
fn clipped(p: vec3f) -> bool {
  return (params.flags & 2u) != 0u && dot(frame.slice.xyz, p) > frame.slice.w;
}

// Coverage (0..1) of this triangle's edges at the pixel, \`width_px\` wide.
// Each triangle draws the inner half of its edges, so a shared edge comes out
// full width. Edges flagged flat in \`flags\` are skipped.
fn edge_coverage(bary: vec3f, bary_width: vec3f, flags: u32, width_px: f32) -> f32 {
  var d = bary / max(bary_width, vec3f(1e-6));  // pixels to the edge opposite each corner
  // Edge k joins corners k and k+1, so it lies opposite corner (k + 2) % 3.
  if ((flags & 4u) != 0u) { d.z = 1e6; }
  if ((flags & 8u) != 0u) { d.x = 1e6; }
  if ((flags & 16u) != 0u) { d.y = 1e6; }
  let edge = min(d.x, min(d.y, d.z));
  let w = width_px * 0.5;
  return 1.0 - smoothstep(w - 0.5, w + 0.5, edge);
}

// Wire color: theme or object color, orange when its body is selected.
fn wire_color(seg_flags: u32, albedo: vec3f) -> vec3f {
  if ((seg_flags & 2u) != 0u) {
    return select(frame.select_color.rgb, frame.active_color.rgb, (seg_flags & 4u) != 0u);
  }
  return select(frame.wire.rgb, albedo, frame.wire_mode.z > 0.5);
}

// Lit surface color, selection tint and wireframe overlay.
fn surface_color(in: VsOut, front: bool, bary_width: vec3f) -> vec3f {
  var s: Surface;
  s.n = select(-in.normal, in.normal, front);  // two-sided lighting
  s.p = in.world;
  s.v = view_dir(in.world);
  s.albedo = in.color;
  s.ao = sample_ao(in.clip.xy);
  s.shadow = sample_shadow(in.world, s.n);
  s.metallic = params.material.x;
  s.roughness = params.material.y;
  var color = shade(s) * frame.style.y;
  if ((in.ids.w & 1u) != 0u) {
    color = mix(color, frame.select_color.rgb, 0.45);
  }
  if ((in.seg_flags & 2u) != 0u) {
    color = mix(color, frame.select_color.rgb, 0.15);
  }
  if (frame.wire.a > 0.0) {
    let cov = edge_coverage(in.bary, bary_width, in.ids.w, frame.wire.a);
    color = mix(color, wire_color(in.seg_flags & 6u, frame.wire.rgb), cov);
  }
  return color;
}

// Lit color into the HDR target (composite.wgsl tone maps and encodes).
@fragment
fn fs_main(in: VsOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  // Screen-space derivatives first: they must run in uniform control flow.
  let bary_width = fwidth(in.bary);
  if (clipped(in.world)) {
    discard;
  }
  return vec4f(surface_color(in, front, bary_width), 1.0);
}

// Weighted blended order-independent transparency (McGuire & Bavoil 2013),
// as mesh.wgsl's fs_transparent; composite.wgsl resolves it.
struct OitOut {
  @location(0) accum: vec4f,
  @location(1) reveal: vec4f,
};

@fragment
fn fs_transparent(in: VsOut, @builtin(front_facing) front: bool) -> OitOut {
  let bary_width = fwidth(in.bary);
  if (clipped(in.world)) {
    discard;
  }
  let color = surface_color(in, front, bary_width);
  let a = params.material.z;
  let z = view_depth(in.clip.z) / 50.0;
  let w = a * clamp(0.03 / (1e-5 + pow(z, 4.0)), 1e-2, 3e3);
  var out: OitOut;
  out.accum = vec4f(color * a * w, a * w);
  out.reveal = vec4f(a);
  return out;
}

// Wireframe shading (Blender's "Wireframe" mode with X-ray): only edges, no
// depth test, so hidden edges show through. An optional faint face fill
// (frame.wire_mode.y) keeps shapes readable; selected faces get a tint.
@fragment
fn fs_wire(in: VsOut) -> @location(0) vec4f {
  let bary_width = fwidth(in.bary);
  let flags = in.ids.w;
  let albedo = in.color;
  let cov = edge_coverage(in.bary, bary_width, flags, frame.wire.a);
  let wire = wire_color(in.seg_flags, albedo);

  var fill = albedo;
  var fill_a = frame.wire_mode.y;
  if ((flags & 1u) != 0u) {
    fill = select(frame.select_color.rgb, frame.active_color.rgb, (flags & 2u) != 0u);
    fill_a = max(fill_a, 0.3);
  }
  // Premultiplied "wire over fill".
  let a = cov + fill_a * (1.0 - cov);
  if (a <= 0.001 || clipped(in.world)) {
    discard;
  }
  return vec4f(wire * cov + fill * fill_a * (1.0 - cov), a);
}

struct PrepassOut {
  @location(0) normal: vec4f,  // view-space normal
  @location(1) ids: vec4u,     // object id, face, segment, flags (bit 0 segment selected)
};

@fragment
fn fs_prepass(in: VsOut, @builtin(front_facing) front: bool) -> PrepassOut {
  if (clipped(in.world)) {
    discard;
  }
  var out: PrepassOut;
  out.normal = vec4f(to_view(select(-in.normal, in.normal, front)), 1.0);
  out.ids = vec4u(in.ids.x, in.ids.y, in.ids.z, (in.seg_flags >> 1u) & 1u);
  return out;
}

@fragment
fn fs_shadow(in: ShadowOut) {
  if (clipped(in.world)) {
    discard;
  }
}

`,ee=`// Web client: small geometry rebuilt on the CPU when it changes (meter boxes,
// markers): world-space vertices with a packed sRGB color each, pulled per
// triangle corner as in rigid.wgsl. Fragment stages in surface.wgsl.
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
@group(1) @binding(1) var<storage, read> positions: array<f32>;  // xyz per vertex
@group(1) @binding(2) var<storage, read> colors: array<u32>;     // packed sRGB per vertex
@group(1) @binding(3) var<storage, read> triangles: array<u32>;  // 3 per face
// Per face: as rigid.wgsl, plus bit 5 hidden (a box of an env not shown).
@group(1) @binding(4) var<storage, read> face_info: array<u32>;
// The object's one segment: color (unused), flags (bit 1 selected, bit 2 active).
@group(1) @binding(5) var<storage, read> segments: array<vec2u>;

// Vertex outputs of the web client's meshes and the shared corner setup
// (the native mesh.wgsl vs_main for flat-shaded, uniformly colored faces).

struct VsOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) @interpolate(flat) normal: vec3f,
  @location(2) bary: vec3f,
  @location(3) @interpolate(flat) color: vec3f,
  @location(4) @interpolate(flat) ids: vec4u,  // object id, face, segment, face flags
  @location(5) @interpolate(flat) seg_flags: u32,
};

struct ShadowOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
};

// Pushes a vertex outside the clip volume so its triangle is dropped.
const CULLED = vec4f(0.0, 0.0, -2.0, 1.0);

// Corner \`corner\` of the world triangle p0 p1 p2; \`seg\` = (packed color, flags).
fn surface_vertex(p0: vec3f, p1: vec3f, p2: vec3f, corner: u32, face: u32, segment: u32,
                  seg: vec2u, face_flags: u32) -> VsOut {
  let p = select(select(p2, p1, corner == 1u), p0, corner == 0u);
  var out: VsOut;
  out.world = p;
  out.clip = select(frame.view_proj * vec4f(p, 1.0), CULLED, (seg.y & 1u) != 0u);
  let c = cross(p1 - p0, p2 - p0);
  out.normal = select(vec3f(0.0, 0.0, 1.0), normalize(c), dot(c, c) > 1e-30);
  out.bary = vec3f(f32(corner == 0u), f32(corner == 1u), f32(corner == 2u));
  out.color = unpack_srgb(seg.x);
  out.ids = vec4u(params.object_id, face, segment, face_flags);
  out.seg_flags = seg.y;
  return out;
}


fn load_position(i: u32) -> vec3f {
  return vec3f(positions[3u * i], positions[3u * i + 1u], positions[3u * i + 2u]);
}

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VsOut {
  let face = vid / 3u;
  let corner = vid % 3u;
  let p0 = load_position(triangles[3u * face]);
  let p1 = load_position(triangles[3u * face + 1u]);
  let p2 = load_position(triangles[3u * face + 2u]);
  var seg = segments[0];
  seg.x = colors[triangles[vid]];
  seg.y |= select(0u, 1u, (face_info[face] & 32u) != 0u);
  return surface_vertex(p0, p1, p2, corner, face, 0u, seg, face_info[face]);
}

@vertex
fn vs_shadow(@builtin(vertex_index) vid: u32) -> ShadowOut {
  let w = load_position(triangles[vid]);
  var out: ShadowOut;
  out.world = w;
  out.clip = select(frame.light_view_proj * vec4f(w, 1.0), CULLED, (face_info[vid / 3u] & 32u) != 0u);
  return out;
}

// Shared fragment stages of the web client's meshes, as the native mesh.wgsl
// does them for flat-shaded, two-sided, uniformly colored faces: lit color
// with selection tints and the wire overlay, see-through (OIT), wireframe
// shading, prepass ids and shadow depth. Expects \`params\` (flags, material)
// and VsOut / ShadowOut (surface_io.wgsl).

// Fragments on the far side of the slice plane are cut away.
fn clipped(p: vec3f) -> bool {
  return (params.flags & 2u) != 0u && dot(frame.slice.xyz, p) > frame.slice.w;
}

// Coverage (0..1) of this triangle's edges at the pixel, \`width_px\` wide.
// Each triangle draws the inner half of its edges, so a shared edge comes out
// full width. Edges flagged flat in \`flags\` are skipped.
fn edge_coverage(bary: vec3f, bary_width: vec3f, flags: u32, width_px: f32) -> f32 {
  var d = bary / max(bary_width, vec3f(1e-6));  // pixels to the edge opposite each corner
  // Edge k joins corners k and k+1, so it lies opposite corner (k + 2) % 3.
  if ((flags & 4u) != 0u) { d.z = 1e6; }
  if ((flags & 8u) != 0u) { d.x = 1e6; }
  if ((flags & 16u) != 0u) { d.y = 1e6; }
  let edge = min(d.x, min(d.y, d.z));
  let w = width_px * 0.5;
  return 1.0 - smoothstep(w - 0.5, w + 0.5, edge);
}

// Wire color: theme or object color, orange when its body is selected.
fn wire_color(seg_flags: u32, albedo: vec3f) -> vec3f {
  if ((seg_flags & 2u) != 0u) {
    return select(frame.select_color.rgb, frame.active_color.rgb, (seg_flags & 4u) != 0u);
  }
  return select(frame.wire.rgb, albedo, frame.wire_mode.z > 0.5);
}

// Lit surface color, selection tint and wireframe overlay.
fn surface_color(in: VsOut, front: bool, bary_width: vec3f) -> vec3f {
  var s: Surface;
  s.n = select(-in.normal, in.normal, front);  // two-sided lighting
  s.p = in.world;
  s.v = view_dir(in.world);
  s.albedo = in.color;
  s.ao = sample_ao(in.clip.xy);
  s.shadow = sample_shadow(in.world, s.n);
  s.metallic = params.material.x;
  s.roughness = params.material.y;
  var color = shade(s) * frame.style.y;
  if ((in.ids.w & 1u) != 0u) {
    color = mix(color, frame.select_color.rgb, 0.45);
  }
  if ((in.seg_flags & 2u) != 0u) {
    color = mix(color, frame.select_color.rgb, 0.15);
  }
  if (frame.wire.a > 0.0) {
    let cov = edge_coverage(in.bary, bary_width, in.ids.w, frame.wire.a);
    color = mix(color, wire_color(in.seg_flags & 6u, frame.wire.rgb), cov);
  }
  return color;
}

// Lit color into the HDR target (composite.wgsl tone maps and encodes).
@fragment
fn fs_main(in: VsOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  // Screen-space derivatives first: they must run in uniform control flow.
  let bary_width = fwidth(in.bary);
  if (clipped(in.world)) {
    discard;
  }
  return vec4f(surface_color(in, front, bary_width), 1.0);
}

// Weighted blended order-independent transparency (McGuire & Bavoil 2013),
// as mesh.wgsl's fs_transparent; composite.wgsl resolves it.
struct OitOut {
  @location(0) accum: vec4f,
  @location(1) reveal: vec4f,
};

@fragment
fn fs_transparent(in: VsOut, @builtin(front_facing) front: bool) -> OitOut {
  let bary_width = fwidth(in.bary);
  if (clipped(in.world)) {
    discard;
  }
  let color = surface_color(in, front, bary_width);
  let a = params.material.z;
  let z = view_depth(in.clip.z) / 50.0;
  let w = a * clamp(0.03 / (1e-5 + pow(z, 4.0)), 1e-2, 3e3);
  var out: OitOut;
  out.accum = vec4f(color * a * w, a * w);
  out.reveal = vec4f(a);
  return out;
}

// Wireframe shading (Blender's "Wireframe" mode with X-ray): only edges, no
// depth test, so hidden edges show through. An optional faint face fill
// (frame.wire_mode.y) keeps shapes readable; selected faces get a tint.
@fragment
fn fs_wire(in: VsOut) -> @location(0) vec4f {
  let bary_width = fwidth(in.bary);
  let flags = in.ids.w;
  let albedo = in.color;
  let cov = edge_coverage(in.bary, bary_width, flags, frame.wire.a);
  let wire = wire_color(in.seg_flags, albedo);

  var fill = albedo;
  var fill_a = frame.wire_mode.y;
  if ((flags & 1u) != 0u) {
    fill = select(frame.select_color.rgb, frame.active_color.rgb, (flags & 2u) != 0u);
    fill_a = max(fill_a, 0.3);
  }
  // Premultiplied "wire over fill".
  let a = cov + fill_a * (1.0 - cov);
  if (a <= 0.001 || clipped(in.world)) {
    discard;
  }
  return vec4f(wire * cov + fill * fill_a * (1.0 - cov), a);
}

struct PrepassOut {
  @location(0) normal: vec4f,  // view-space normal
  @location(1) ids: vec4u,     // object id, face, segment, flags (bit 0 segment selected)
};

@fragment
fn fs_prepass(in: VsOut, @builtin(front_facing) front: bool) -> PrepassOut {
  if (clipped(in.world)) {
    discard;
  }
  var out: PrepassOut;
  out.normal = vec4f(to_view(select(-in.normal, in.normal, front)), 1.0);
  out.ids = vec4u(in.ids.x, in.ids.y, in.ids.z, (in.seg_flags >> 1u) & 1u);
  return out;
}

@fragment
fn fs_shadow(in: ShadowOut) {
  if (clipped(in.world)) {
    discard;
  }
}

`,x=`// Web client: small geometry rebuilt on the CPU when it changes (meter boxes,
// markers): world-space vertices with a packed sRGB color each, pulled per
// triangle corner as in rigid.wgsl. Fragment stages in surface.wgsl.
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
@group(1) @binding(1) var<storage, read> positions: array<f32>;  // xyz per vertex
@group(1) @binding(2) var<storage, read> colors: array<u32>;     // packed sRGB per vertex
@group(1) @binding(3) var<storage, read> triangles: array<u32>;  // 3 per face
// Per face: as rigid.wgsl, plus bit 5 hidden (a box of an env not shown).
@group(1) @binding(4) var<storage, read> face_info: array<u32>;
// The object's one segment: color (unused), flags (bit 1 selected, bit 2 active).
@group(1) @binding(5) var<storage, read> segments: array<vec2u>;

// Vertex outputs of the web client's meshes and the shared corner setup
// (the native mesh.wgsl vs_main for flat-shaded, uniformly colored faces).

struct VsOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) @interpolate(flat) normal: vec3f,
  @location(2) bary: vec3f,
  @location(3) @interpolate(flat) color: vec3f,
  @location(4) @interpolate(flat) ids: vec4u,  // object id, face, segment, face flags
  @location(5) @interpolate(flat) seg_flags: u32,
};

struct ShadowOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
};

// Pushes a vertex outside the clip volume so its triangle is dropped.
const CULLED = vec4f(0.0, 0.0, -2.0, 1.0);

// Corner \`corner\` of the world triangle p0 p1 p2; \`seg\` = (packed color, flags).
fn surface_vertex(p0: vec3f, p1: vec3f, p2: vec3f, corner: u32, face: u32, segment: u32,
                  seg: vec2u, face_flags: u32) -> VsOut {
  let p = select(select(p2, p1, corner == 1u), p0, corner == 0u);
  var out: VsOut;
  out.world = p;
  out.clip = select(frame.view_proj * vec4f(p, 1.0), CULLED, (seg.y & 1u) != 0u);
  let c = cross(p1 - p0, p2 - p0);
  out.normal = select(vec3f(0.0, 0.0, 1.0), normalize(c), dot(c, c) > 1e-30);
  out.bary = vec3f(f32(corner == 0u), f32(corner == 1u), f32(corner == 2u));
  out.color = unpack_srgb(seg.x);
  out.ids = vec4u(params.object_id, face, segment, face_flags);
  out.seg_flags = seg.y;
  return out;
}


fn load_position(i: u32) -> vec3f {
  return vec3f(positions[3u * i], positions[3u * i + 1u], positions[3u * i + 2u]);
}

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VsOut {
  let face = vid / 3u;
  let corner = vid % 3u;
  let p0 = load_position(triangles[3u * face]);
  let p1 = load_position(triangles[3u * face + 1u]);
  let p2 = load_position(triangles[3u * face + 2u]);
  var seg = segments[0];
  seg.x = colors[triangles[vid]];
  seg.y |= select(0u, 1u, (face_info[face] & 32u) != 0u);
  return surface_vertex(p0, p1, p2, corner, face, 0u, seg, face_info[face]);
}

@vertex
fn vs_shadow(@builtin(vertex_index) vid: u32) -> ShadowOut {
  let w = load_position(triangles[vid]);
  var out: ShadowOut;
  out.world = w;
  out.clip = select(frame.light_view_proj * vec4f(w, 1.0), CULLED, (face_info[vid / 3u] & 32u) != 0u);
  return out;
}

// Shared fragment stages of the web client's meshes, as the native mesh.wgsl
// does them for flat-shaded, two-sided, uniformly colored faces: lit color
// with selection tints and the wire overlay, see-through (OIT), wireframe
// shading, prepass ids and shadow depth. Expects \`params\` (flags, material)
// and VsOut / ShadowOut (surface_io.wgsl).

// Fragments on the far side of the slice plane are cut away.
fn clipped(p: vec3f) -> bool {
  return (params.flags & 2u) != 0u && dot(frame.slice.xyz, p) > frame.slice.w;
}

// Coverage (0..1) of this triangle's edges at the pixel, \`width_px\` wide.
// Each triangle draws the inner half of its edges, so a shared edge comes out
// full width. Edges flagged flat in \`flags\` are skipped.
fn edge_coverage(bary: vec3f, bary_width: vec3f, flags: u32, width_px: f32) -> f32 {
  var d = bary / max(bary_width, vec3f(1e-6));  // pixels to the edge opposite each corner
  // Edge k joins corners k and k+1, so it lies opposite corner (k + 2) % 3.
  if ((flags & 4u) != 0u) { d.z = 1e6; }
  if ((flags & 8u) != 0u) { d.x = 1e6; }
  if ((flags & 16u) != 0u) { d.y = 1e6; }
  let edge = min(d.x, min(d.y, d.z));
  let w = width_px * 0.5;
  return 1.0 - smoothstep(w - 0.5, w + 0.5, edge);
}

// Wire color: theme or object color, orange when its body is selected.
fn wire_color(seg_flags: u32, albedo: vec3f) -> vec3f {
  if ((seg_flags & 2u) != 0u) {
    return select(frame.select_color.rgb, frame.active_color.rgb, (seg_flags & 4u) != 0u);
  }
  return select(frame.wire.rgb, albedo, frame.wire_mode.z > 0.5);
}

// Lit surface color, selection tint and wireframe overlay.
fn surface_color(in: VsOut, front: bool, bary_width: vec3f) -> vec3f {
  var s: Surface;
  s.n = select(-in.normal, in.normal, front);  // two-sided lighting
  s.p = in.world;
  s.v = view_dir(in.world);
  s.albedo = in.color;
  s.ao = sample_ao(in.clip.xy);
  s.shadow = sample_shadow(in.world, s.n);
  s.metallic = params.material.x;
  s.roughness = params.material.y;
  var color = shade(s) * frame.style.y;
  if ((in.ids.w & 1u) != 0u) {
    color = mix(color, frame.select_color.rgb, 0.45);
  }
  if ((in.seg_flags & 2u) != 0u) {
    color = mix(color, frame.select_color.rgb, 0.15);
  }
  if (frame.wire.a > 0.0) {
    let cov = edge_coverage(in.bary, bary_width, in.ids.w, frame.wire.a);
    color = mix(color, wire_color(in.seg_flags & 6u, frame.wire.rgb), cov);
  }
  return color;
}

// Lit color into the HDR target (composite.wgsl tone maps and encodes).
@fragment
fn fs_main(in: VsOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  // Screen-space derivatives first: they must run in uniform control flow.
  let bary_width = fwidth(in.bary);
  if (clipped(in.world)) {
    discard;
  }
  return vec4f(surface_color(in, front, bary_width), 1.0);
}

// Weighted blended order-independent transparency (McGuire & Bavoil 2013),
// as mesh.wgsl's fs_transparent; composite.wgsl resolves it.
struct OitOut {
  @location(0) accum: vec4f,
  @location(1) reveal: vec4f,
};

@fragment
fn fs_transparent(in: VsOut, @builtin(front_facing) front: bool) -> OitOut {
  let bary_width = fwidth(in.bary);
  if (clipped(in.world)) {
    discard;
  }
  let color = surface_color(in, front, bary_width);
  let a = params.material.z;
  let z = view_depth(in.clip.z) / 50.0;
  let w = a * clamp(0.03 / (1e-5 + pow(z, 4.0)), 1e-2, 3e3);
  var out: OitOut;
  out.accum = vec4f(color * a * w, a * w);
  out.reveal = vec4f(a);
  return out;
}

// Wireframe shading (Blender's "Wireframe" mode with X-ray): only edges, no
// depth test, so hidden edges show through. An optional faint face fill
// (frame.wire_mode.y) keeps shapes readable; selected faces get a tint.
@fragment
fn fs_wire(in: VsOut) -> @location(0) vec4f {
  let bary_width = fwidth(in.bary);
  let flags = in.ids.w;
  let albedo = in.color;
  let cov = edge_coverage(in.bary, bary_width, flags, frame.wire.a);
  let wire = wire_color(in.seg_flags, albedo);

  var fill = albedo;
  var fill_a = frame.wire_mode.y;
  if ((flags & 1u) != 0u) {
    fill = select(frame.select_color.rgb, frame.active_color.rgb, (flags & 2u) != 0u);
    fill_a = max(fill_a, 0.3);
  }
  // Premultiplied "wire over fill".
  let a = cov + fill_a * (1.0 - cov);
  if (a <= 0.001 || clipped(in.world)) {
    discard;
  }
  return vec4f(wire * cov + fill * fill_a * (1.0 - cov), a);
}

struct PrepassOut {
  @location(0) normal: vec4f,  // view-space normal
  @location(1) ids: vec4u,     // object id, face, segment, flags (bit 0 segment selected)
};

@fragment
fn fs_prepass(in: VsOut, @builtin(front_facing) front: bool) -> PrepassOut {
  if (clipped(in.world)) {
    discard;
  }
  var out: PrepassOut;
  out.normal = vec4f(to_view(select(-in.normal, in.normal, front)), 1.0);
  out.ids = vec4u(in.ids.x, in.ids.y, in.ids.z, (in.seg_flags >> 1u) & 1u);
  return out;
}

@fragment
fn fs_shadow(in: ShadowOut) {
  if (clipped(in.world)) {
    discard;
  }
}

`,te=`// Web client: small geometry rebuilt on the CPU when it changes (meter boxes,
// markers): world-space vertices with a packed sRGB color each, pulled per
// triangle corner as in rigid.wgsl. Fragment stages in surface.wgsl.
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
@group(1) @binding(1) var<storage, read> positions: array<f32>;  // xyz per vertex
@group(1) @binding(2) var<storage, read> colors: array<u32>;     // packed sRGB per vertex
@group(1) @binding(3) var<storage, read> triangles: array<u32>;  // 3 per face
// Per face: as rigid.wgsl, plus bit 5 hidden (a box of an env not shown).
@group(1) @binding(4) var<storage, read> face_info: array<u32>;
// The object's one segment: color (unused), flags (bit 1 selected, bit 2 active).
@group(1) @binding(5) var<storage, read> segments: array<vec2u>;

// Vertex outputs of the web client's meshes and the shared corner setup
// (the native mesh.wgsl vs_main for flat-shaded, uniformly colored faces).

struct VsOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) @interpolate(flat) normal: vec3f,
  @location(2) bary: vec3f,
  @location(3) @interpolate(flat) color: vec3f,
  @location(4) @interpolate(flat) ids: vec4u,  // object id, face, segment, face flags
  @location(5) @interpolate(flat) seg_flags: u32,
};

struct ShadowOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
};

// Pushes a vertex outside the clip volume so its triangle is dropped.
const CULLED = vec4f(0.0, 0.0, -2.0, 1.0);

// Corner \`corner\` of the world triangle p0 p1 p2; \`seg\` = (packed color, flags).
fn surface_vertex(p0: vec3f, p1: vec3f, p2: vec3f, corner: u32, face: u32, segment: u32,
                  seg: vec2u, face_flags: u32) -> VsOut {
  let p = select(select(p2, p1, corner == 1u), p0, corner == 0u);
  var out: VsOut;
  out.world = p;
  out.clip = select(frame.view_proj * vec4f(p, 1.0), CULLED, (seg.y & 1u) != 0u);
  let c = cross(p1 - p0, p2 - p0);
  out.normal = select(vec3f(0.0, 0.0, 1.0), normalize(c), dot(c, c) > 1e-30);
  out.bary = vec3f(f32(corner == 0u), f32(corner == 1u), f32(corner == 2u));
  out.color = unpack_srgb(seg.x);
  out.ids = vec4u(params.object_id, face, segment, face_flags);
  out.seg_flags = seg.y;
  return out;
}


fn load_position(i: u32) -> vec3f {
  return vec3f(positions[3u * i], positions[3u * i + 1u], positions[3u * i + 2u]);
}

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VsOut {
  let face = vid / 3u;
  let corner = vid % 3u;
  let p0 = load_position(triangles[3u * face]);
  let p1 = load_position(triangles[3u * face + 1u]);
  let p2 = load_position(triangles[3u * face + 2u]);
  var seg = segments[0];
  seg.x = colors[triangles[vid]];
  seg.y |= select(0u, 1u, (face_info[face] & 32u) != 0u);
  return surface_vertex(p0, p1, p2, corner, face, 0u, seg, face_info[face]);
}

@vertex
fn vs_shadow(@builtin(vertex_index) vid: u32) -> ShadowOut {
  let w = load_position(triangles[vid]);
  var out: ShadowOut;
  out.world = w;
  out.clip = select(frame.light_view_proj * vec4f(w, 1.0), CULLED, (face_info[vid / 3u] & 32u) != 0u);
  return out;
}

// Shared fragment stages of the web client's meshes, as the native mesh.wgsl
// does them for flat-shaded, two-sided, uniformly colored faces: lit color
// with selection tints and the wire overlay, see-through (OIT), wireframe
// shading, prepass ids and shadow depth. Expects \`params\` (flags, material)
// and VsOut / ShadowOut (surface_io.wgsl).

// Fragments on the far side of the slice plane are cut away.
fn clipped(p: vec3f) -> bool {
  return (params.flags & 2u) != 0u && dot(frame.slice.xyz, p) > frame.slice.w;
}

// Coverage (0..1) of this triangle's edges at the pixel, \`width_px\` wide.
// Each triangle draws the inner half of its edges, so a shared edge comes out
// full width. Edges flagged flat in \`flags\` are skipped.
fn edge_coverage(bary: vec3f, bary_width: vec3f, flags: u32, width_px: f32) -> f32 {
  var d = bary / max(bary_width, vec3f(1e-6));  // pixels to the edge opposite each corner
  // Edge k joins corners k and k+1, so it lies opposite corner (k + 2) % 3.
  if ((flags & 4u) != 0u) { d.z = 1e6; }
  if ((flags & 8u) != 0u) { d.x = 1e6; }
  if ((flags & 16u) != 0u) { d.y = 1e6; }
  let edge = min(d.x, min(d.y, d.z));
  let w = width_px * 0.5;
  return 1.0 - smoothstep(w - 0.5, w + 0.5, edge);
}

// Wire color: theme or object color, orange when its body is selected.
fn wire_color(seg_flags: u32, albedo: vec3f) -> vec3f {
  if ((seg_flags & 2u) != 0u) {
    return select(frame.select_color.rgb, frame.active_color.rgb, (seg_flags & 4u) != 0u);
  }
  return select(frame.wire.rgb, albedo, frame.wire_mode.z > 0.5);
}

// Lit surface color, selection tint and wireframe overlay.
fn surface_color(in: VsOut, front: bool, bary_width: vec3f) -> vec3f {
  var s: Surface;
  s.n = select(-in.normal, in.normal, front);  // two-sided lighting
  s.p = in.world;
  s.v = view_dir(in.world);
  s.albedo = in.color;
  s.ao = sample_ao(in.clip.xy);
  s.shadow = sample_shadow(in.world, s.n);
  s.metallic = params.material.x;
  s.roughness = params.material.y;
  var color = shade(s) * frame.style.y;
  if ((in.ids.w & 1u) != 0u) {
    color = mix(color, frame.select_color.rgb, 0.45);
  }
  if ((in.seg_flags & 2u) != 0u) {
    color = mix(color, frame.select_color.rgb, 0.15);
  }
  if (frame.wire.a > 0.0) {
    let cov = edge_coverage(in.bary, bary_width, in.ids.w, frame.wire.a);
    color = mix(color, wire_color(in.seg_flags & 6u, frame.wire.rgb), cov);
  }
  return color;
}

// Lit color into the HDR target (composite.wgsl tone maps and encodes).
@fragment
fn fs_main(in: VsOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  // Screen-space derivatives first: they must run in uniform control flow.
  let bary_width = fwidth(in.bary);
  if (clipped(in.world)) {
    discard;
  }
  return vec4f(surface_color(in, front, bary_width), 1.0);
}

// Weighted blended order-independent transparency (McGuire & Bavoil 2013),
// as mesh.wgsl's fs_transparent; composite.wgsl resolves it.
struct OitOut {
  @location(0) accum: vec4f,
  @location(1) reveal: vec4f,
};

@fragment
fn fs_transparent(in: VsOut, @builtin(front_facing) front: bool) -> OitOut {
  let bary_width = fwidth(in.bary);
  if (clipped(in.world)) {
    discard;
  }
  let color = surface_color(in, front, bary_width);
  let a = params.material.z;
  let z = view_depth(in.clip.z) / 50.0;
  let w = a * clamp(0.03 / (1e-5 + pow(z, 4.0)), 1e-2, 3e3);
  var out: OitOut;
  out.accum = vec4f(color * a * w, a * w);
  out.reveal = vec4f(a);
  return out;
}

// Wireframe shading (Blender's "Wireframe" mode with X-ray): only edges, no
// depth test, so hidden edges show through. An optional faint face fill
// (frame.wire_mode.y) keeps shapes readable; selected faces get a tint.
@fragment
fn fs_wire(in: VsOut) -> @location(0) vec4f {
  let bary_width = fwidth(in.bary);
  let flags = in.ids.w;
  let albedo = in.color;
  let cov = edge_coverage(in.bary, bary_width, flags, frame.wire.a);
  let wire = wire_color(in.seg_flags, albedo);

  var fill = albedo;
  var fill_a = frame.wire_mode.y;
  if ((flags & 1u) != 0u) {
    fill = select(frame.select_color.rgb, frame.active_color.rgb, (flags & 2u) != 0u);
    fill_a = max(fill_a, 0.3);
  }
  // Premultiplied "wire over fill".
  let a = cov + fill_a * (1.0 - cov);
  if (a <= 0.001 || clipped(in.world)) {
    discard;
  }
  return vec4f(wire * cov + fill * fill_a * (1.0 - cov), a);
}

struct PrepassOut {
  @location(0) normal: vec4f,  // view-space normal
  @location(1) ids: vec4u,     // object id, face, segment, flags (bit 0 segment selected)
};

@fragment
fn fs_prepass(in: VsOut, @builtin(front_facing) front: bool) -> PrepassOut {
  if (clipped(in.world)) {
    discard;
  }
  var out: PrepassOut;
  out.normal = vec4f(to_view(select(-in.normal, in.normal, front)), 1.0);
  out.ids = vec4u(in.ids.x, in.ids.y, in.ids.z, (in.seg_flags >> 1u) & 1u);
  return out;
}

@fragment
fn fs_shadow(in: ShadowOut) {
  if (clipped(in.world)) {
    discard;
  }
}

`,ne=`// The native viewer's screen-space ambient occlusion, unchanged.
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

`,re=`// The native viewer's infinite ground grid (+ shadow / AO catcher), unchanged.
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

`,ie=`// The native viewer's composite (background, outlines, sRGB), unchanged.
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

`,ae=`// The native viewer's overlay lines and dots (the slice plane outline), unchanged.
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

`,oe=`// The native viewer's SDF text labels, unchanged.
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

`,S=(e,t)=>[e[0]-t[0],e[1]-t[1],e[2]-t[2]],C=(e,t)=>[e[1]*t[2]-e[2]*t[1],e[2]*t[0]-e[0]*t[2],e[0]*t[1]-e[1]*t[0]],w=(e,t)=>e[0]*t[0]+e[1]*t[1]+e[2]*t[2],se=e=>{let t=Math.hypot(e[0],e[1],e[2])||1;return[e[0]/t,e[1]/t,e[2]/t]};function ce(e,t,n=[0,0,1]){let r=se(S(t,e)),i=C(r,n);Math.hypot(...i)<1e-6&&(i=C(r,[0,1,0])),i=se(i);let a=C(i,r);return new Float32Array([i[0],a[0],-r[0],0,i[1],a[1],-r[1],0,i[2],a[2],-r[2],0,-w(i,e),-w(a,e),w(r,e),1])}function le(e,t,n){let r=1/Math.tan(e/2);return new Float32Array([r/t,0,0,0,0,r,0,0,0,0,0,-1,0,0,n,0])}function ue(e,t){let n=new Float32Array(16);for(let r=0;r<4;r++)for(let i=0;i<4;i++){let a=0;for(let n=0;n<4;n++)a+=e[n*4+i]*t[r*4+n];n[r*4+i]=a}return n}function de(e){let t=new Float32Array(16),n=e;t[0]=n[5]*n[10]*n[15]-n[5]*n[11]*n[14]-n[9]*n[6]*n[15]+n[9]*n[7]*n[14]+n[13]*n[6]*n[11]-n[13]*n[7]*n[10],t[4]=-n[4]*n[10]*n[15]+n[4]*n[11]*n[14]+n[8]*n[6]*n[15]-n[8]*n[7]*n[14]-n[12]*n[6]*n[11]+n[12]*n[7]*n[10],t[8]=n[4]*n[9]*n[15]-n[4]*n[11]*n[13]-n[8]*n[5]*n[15]+n[8]*n[7]*n[13]+n[12]*n[5]*n[11]-n[12]*n[7]*n[9],t[12]=-n[4]*n[9]*n[14]+n[4]*n[10]*n[13]+n[8]*n[5]*n[14]-n[8]*n[6]*n[13]-n[12]*n[5]*n[10]+n[12]*n[6]*n[9],t[1]=-n[1]*n[10]*n[15]+n[1]*n[11]*n[14]+n[9]*n[2]*n[15]-n[9]*n[3]*n[14]-n[13]*n[2]*n[11]+n[13]*n[3]*n[10],t[5]=n[0]*n[10]*n[15]-n[0]*n[11]*n[14]-n[8]*n[2]*n[15]+n[8]*n[3]*n[14]+n[12]*n[2]*n[11]-n[12]*n[3]*n[10],t[9]=-n[0]*n[9]*n[15]+n[0]*n[11]*n[13]+n[8]*n[1]*n[15]-n[8]*n[3]*n[13]-n[12]*n[1]*n[11]+n[12]*n[3]*n[9],t[13]=n[0]*n[9]*n[14]-n[0]*n[10]*n[13]-n[8]*n[1]*n[14]+n[8]*n[2]*n[13]+n[12]*n[1]*n[10]-n[12]*n[2]*n[9],t[2]=n[1]*n[6]*n[15]-n[1]*n[7]*n[14]-n[5]*n[2]*n[15]+n[5]*n[3]*n[14]+n[13]*n[2]*n[7]-n[13]*n[3]*n[6],t[6]=-n[0]*n[6]*n[15]+n[0]*n[7]*n[14]+n[4]*n[2]*n[15]-n[4]*n[3]*n[14]-n[12]*n[2]*n[7]+n[12]*n[3]*n[6],t[10]=n[0]*n[5]*n[15]-n[0]*n[7]*n[13]-n[4]*n[1]*n[15]+n[4]*n[3]*n[13]+n[12]*n[1]*n[7]-n[12]*n[3]*n[5],t[14]=-n[0]*n[5]*n[14]+n[0]*n[6]*n[13]+n[4]*n[1]*n[14]-n[4]*n[2]*n[13]-n[12]*n[1]*n[6]+n[12]*n[2]*n[5],t[3]=-n[1]*n[6]*n[11]+n[1]*n[7]*n[10]+n[5]*n[2]*n[11]-n[5]*n[3]*n[10]-n[9]*n[2]*n[7]+n[9]*n[3]*n[6],t[7]=n[0]*n[6]*n[11]-n[0]*n[7]*n[10]-n[4]*n[2]*n[11]+n[4]*n[3]*n[10]+n[8]*n[2]*n[7]-n[8]*n[3]*n[6],t[11]=-n[0]*n[5]*n[11]+n[0]*n[7]*n[9]+n[4]*n[1]*n[11]-n[4]*n[3]*n[9]-n[8]*n[1]*n[7]+n[8]*n[3]*n[5],t[15]=n[0]*n[5]*n[10]-n[0]*n[6]*n[9]-n[4]*n[1]*n[10]+n[4]*n[2]*n[9]+n[8]*n[1]*n[6]-n[8]*n[2]*n[5];let r=n[0]*t[0]+n[1]*t[4]+n[2]*t[8]+n[3]*t[12],i=r===0?0:1/r;for(let e=0;e<16;e++)t[e]*=i;return t}var fe=.008,pe=class{target=[0,0,0];distance=10;yaw=-Math.PI/2;pitch=.35;fovy=40*Math.PI/180;ortho=!1;autoPerspective=!0;orthoFromPreset=!1;anim=null;lookAt(e,t){let n=S(e,t);this.target=[...t],this.distance=Math.max(Math.hypot(...n),1e-4),this.yaw=Math.atan2(n[1],n[0]),this.pitch=Math.asin(Math.max(-1,Math.min(1,n[2]/this.distance))),this.anim=null}forward(){let e=Math.cos(this.pitch);return[-e*Math.cos(this.yaw),-e*Math.sin(this.yaw),-Math.sin(this.pitch)]}eye(){let e=this.forward();return[this.target[0]-e[0]*this.distance,this.target[1]-e[1]*this.distance,this.target[2]-e[2]*this.distance]}right(){return[-Math.sin(this.yaw),Math.cos(this.yaw),0]}up(){return C(this.right(),this.forward())}view(){let e=this.forward(),t=this.right(),n=this.up(),r=this.eye();return new Float32Array([t[0],n[0],-e[0],0,t[1],n[1],-e[1],0,t[2],n[2],-e[2],0,-w(t,r),-w(n,r),w(e,r),1])}nearPlane(){return Math.max(1e-4,this.distance*.001)}viewHeight(){return 2*this.distance*Math.tan(.5*this.fovy)}proj(e){if(!this.ortho)return le(this.fovy,e,this.nearPlane());let t=.5*this.viewHeight(),n=t*e,r=-this.distance*50,i=this.distance*50,a=new Float32Array(16);return a[0]=1/n,a[5]=1/t,a[10]=1/(i-r),a[14]=i/(i-r),a[15]=1,a}ray(e,t,n,r){let i=e/n*2-1,a=1-t/r*2,o=n/r,s=.5*this.viewHeight(),c=this.forward(),l=this.right(),u=this.up();if(this.ortho)return{origin:[0,1,2].map(e=>this.target[e]+l[e]*i*s*o+u[e]*a*s-c[e]*this.distance*50),dir:c};let d=Math.tan(.5*this.fovy),f=se([0,1,2].map(e=>c[e]+l[e]*i*d*o+u[e]*a*d));return{origin:this.eye(),dir:f}}project(e,t,n){return he(this.view(),this.proj(t/n),this.ortho,e,t,n)}projector(e,t){let n=this.view(),r=this.proj(e/t),i=this.ortho;return a=>he(n,r,i,a,e,t)}pixelSizeAt(e,t){return this.ortho?this.viewHeight()/t:2*Math.max(w(S(e,this.eye()),this.forward()),this.nearPlane())*Math.tan(.5*this.fovy)/t}orbit(e,t){this.anim=null,this.yaw-=e*fe,this.pitch=Math.max(-.5*Math.PI,Math.min(.5*Math.PI,this.pitch+t*fe)),this.autoPerspective&&this.orthoFromPreset&&(this.ortho=!1,this.orthoFromPreset=!1)}pan(e,t,n){this.anim=null;let r=this.viewHeight()/n,i=this.right(),a=this.up();for(let n=0;n<3;n++)this.target[n]+=(-e*i[n]+t*a[n])*r}dolly(e){this.anim=null,this.distance=Math.max(.001,Math.min(1e5,this.distance*1.15**-e))}toggleOrtho(){this.ortho=!this.ortho,this.orthoFromPreset=!1}animateTo(e,t,n,r,i=.2){let a=me(n-this.yaw,2*Math.PI);this.anim={t:0,len:i,from:[...this.target,this.distance,this.yaw,this.pitch],to:[...e,t,this.yaw+a,r]},i<=0&&this.update(0)}update(e){let t=this.anim;if(!t)return!1;t.t=Math.min(t.t+e,t.len);let n=t.len>0?t.t/t.len:1;n=n*n*(3-2*n);let r=t.from.map((e,r)=>e+(t.to[r]-e)*n);return this.target=[r[0],r[1],r[2]],[this.distance,this.yaw,this.pitch]=[r[3],r[4],r[5]],t.t>=t.len&&(this.anim=null),!0}get animating(){return this.anim!==null}setView(e){let t=.5*Math.PI,n=this.yaw,r=0;switch(e){case`front`:n=-t;break;case`back`:n=t;break;case`right`:n=0;break;case`left`:n=Math.PI;break;case`top`:n=-t,r=t;break;case`bottom`:n=-t,r=-t}this.autoPerspective&&!this.ortho&&(this.ortho=!0,this.orthoFromPreset=!0),this.animateTo(this.target,this.distance,n,r)}alignedAxis(){let e=.001;if(Math.abs(Math.abs(this.pitch)-.5*Math.PI)<e)return 2;if(Math.abs(this.pitch)>e)return-1;let t=Math.abs(me(this.yaw,2*Math.PI));return t<e||Math.abs(t-Math.PI)<e?0:Math.abs(t-.5*Math.PI)<e?1:-1}frameBounds(e,t,n=!0){let r=[(e[0]+t[0])/2,(e[1]+t[1])/2,(e[2]+t[2])/2],i=Math.max(.5*Math.hypot(t[0]-e[0],t[1]-e[1],t[2]-e[2]),.001)/Math.sin(.5*this.fovy)*1.1;n?this.animateTo(r,i,this.yaw,this.pitch):(this.target=r,this.distance=i)}};function me(e,t){let n=e/t,r=Math.round(n);return Math.abs(n-Math.trunc(n))===.5&&(r=2*Math.round(n/2)),e-r*t}function he(e,t,n,r,i,a){let o=[0,0,0,0],s=[0,0,0,0];for(let t=0;t<4;t++)o[t]=e[t]*r[0]+e[4+t]*r[1]+e[8+t]*r[2]+e[12+t];for(let e=0;e<4;e++)s[e]=t[e]*o[0]+t[4+e]*o[1]+t[8+e]*o[2]+t[12+e]*o[3];let c=n?1:s[3];return!n&&c<=1e-8?[-1e9,-1e9,o[2]]:[(s[0]/c*.5+.5)*i,(.5-s[1]/c*.5)*a,o[2]]}function ge(e,t){let n=[],r=[],i=new Uint32Array(3*t),a=new Map;for(let o=0;o<t;o++)for(let t=0;t<3;t++){let s=e[3*o+t],c=e[3*o+(t+1)%3],l=Math.min(s,c),u=Math.max(s,c),d=l*4294967296+u,f=a.get(d);f===void 0?(f=n.length/2,a.set(d,f),n.push(l,u),r.push(o,-1)):r[2*f+1]===-1&&(r[2*f+1]=o),i[3*o+t]=f}return{edges:Uint32Array.from(n),edgeFaces:Int32Array.from(r),faceEdges:i}}function _e(e,t,n,r,i){let a=new Uint8Array(t);if(i<=0)return a;let o=new Float64Array(3*t);for(let r=0;r<t;r++){let t=n(e[3*r]),i=n(e[3*r+1]),a=n(e[3*r+2]),s=[i[0]-t[0],i[1]-t[1],i[2]-t[2]],c=[a[0]-t[0],a[1]-t[1],a[2]-t[2]],l=s[1]*c[2]-s[2]*c[1],u=s[2]*c[0]-s[0]*c[2],d=s[0]*c[1]-s[1]*c[0],f=Math.hypot(l,u,d);f>0&&o.set([l/f,u/f,d/f],3*r)}let s=Math.cos(i*Math.PI/180);for(let e=0;e<t;e++)for(let t=0;t<3;t++){let n=r.faceEdges[3*e+t],i=r.edgeFaces[2*n]===e?r.edgeFaces[2*n+1]:r.edgeFaces[2*n];i>=0&&o[3*e]*o[3*i]+o[3*e+1]*o[3*i+1]+o[3*e+2]*o[3*i+2]>=s&&(a[e]|=1<<t)}return a}var T=class{name;id;kind=`mesh`;V;T;B;instances;local;vertexBody;tris;faceBody;bodyOffsets;offsets;edges;poses=null;appVisible;userHidden;isolated=-1;bodyNames;instanceNames;flat=null;constructor(e,t,n){this.name=e,this.id=t;let r=n.arrays;this.instances=n.attrs.instances,this.local=Float32Array.from(r.local_vertices.data),this.vertexBody=Uint32Array.from(r.vertex_body.data),this.tris=Uint32Array.from(r.triangles.data),this.bodyOffsets=Int32Array.from(r.body_triangle_offsets.data),this.V=this.vertexBody.length,this.T=this.tris.length/3,this.B=this.bodyOffsets.length-1,this.faceBody=new Uint32Array(this.T);for(let e=0;e<this.B;e++)this.faceBody.fill(e,this.bodyOffsets[e],this.bodyOffsets[e+1]);this.offsets=new Float32Array(this.instances*4);for(let e=0;e<this.instances;e++)for(let t=0;t<3;t++)this.offsets[e*4+t]=r.offsets.data[e*3+t];this.edges=ge(this.tris,this.T);let i=this.instances*this.B,a=r.segment_visible?.data;this.appVisible=new Uint8Array(i).map((e,t)=>a&&!a[t]?0:1),this.userHidden=new Uint8Array(i),this.bodyNames=n.attrs.body_names??Array.from({length:this.B},(e,t)=>`body${t}`),this.instanceNames=n.attrs.instance_names??Array.from({length:this.instances},(e,t)=>`env${t}`)}get numVertices(){return this.instances*this.V}get numFaces(){return this.instances*this.T}get numEdges(){return this.instances*(this.edges.edges.length/2)}get numSegments(){return this.instances*this.B}vertex(e){let t=Math.floor(e/this.V),n=e-t*this.V,r=this.local,i=r[3*n],a=r[3*n+1],o=r[3*n+2],s=this.offsets[4*t],c=this.offsets[4*t+1],l=this.offsets[4*t+2],u=this.poses;if(!u)return[i+s,a+c,o+l];let d=(t*this.B+this.vertexBody[n])*7,f=u[d+3],p=u[d+4],m=u[d+5],h=u[d+6],g=2*(p*o-m*a),_=2*(m*i-f*o),v=2*(f*a-p*i);return[u[d]+s+i+h*g+(p*v-m*_),u[d+1]+c+a+h*_+(m*g-f*v),u[d+2]+l+o+h*v+(f*_-p*g)]}face(e){let t=Math.floor(e/this.T),n=e-t*this.T,r=t*this.V;return[this.tris[3*n]+r,this.tris[3*n+1]+r,this.tris[3*n+2]+r]}faceEdge(e,t){let n=Math.floor(e/this.T),r=e-n*this.T;return this.edges.faceEdges[3*r+t]+n*(this.edges.edges.length/2)}edge(e){let t=this.edges.edges.length/2,n=Math.floor(e/t),r=e-n*t;return[this.edges.edges[2*r]+n*this.V,this.edges.edges[2*r+1]+n*this.V]}segmentOfFace(e){let t=Math.floor(e/this.T);return t*this.B+this.faceBody[e-t*this.T]}segmentOfVertex(e){let t=Math.floor(e/this.V);return t*this.B+this.vertexBody[e-t*this.V]}segmentFaces(e){let t=Math.floor(e/this.B),n=e-t*this.B;return[t*this.T+this.bodyOffsets[n],t*this.T+this.bodyOffsets[n+1]]}segmentName(e){let t=Math.floor(e/this.B),n=e-t*this.B;return this.instances===1?this.bodyNames[n]:`${this.instanceNames[t]}/${this.bodyNames[n]}`}instanceOf(e){return Math.floor(e/this.B)}segmentVisible(e){return!!this.appVisible[e]&&!this.userHidden[e]&&(this.isolated<0||Math.floor(e/this.B)===this.isolated)}faceVisible(e){return this.segmentVisible(this.segmentOfFace(e))}flatMask(e){if(this.flat?.angle!==e){let t=this.local;this.flat={angle:e,mask:_e(this.tris,this.T,e=>[t[3*e],t[3*e+1],t[3*e+2]],this.edges,e)}}return this.flat.mask}},ve=[0,0,0,1,0,0,1,1,0,0,1,0,0,0,1,1,0,1,1,1,1,0,1,1],ye=[0,3,2,0,2,1,4,5,6,4,6,7,0,1,5,0,5,4,1,2,6,1,6,5,2,3,7,2,7,6,3,0,4,3,4,7],be=class{name;id;kind=`mesh`;pos=new Float32Array;tris=new Uint32Array;hidden=new Uint8Array;userHidden=!1;edges=ge([],0);flat=null;n=-1;constructor(e,t){this.name=e,this.id=t}set(e,t,n){let r=e.length/3;this.pos=new Float32Array(24*r);for(let n=0;n<r;n++)for(let r=0;r<8;r++)for(let i=0;i<3;i++)this.pos[n*24+r*3+i]=e[3*n+i]+ve[r*3+i]*(t[3*n+i]-e[3*n+i]);if(r!==this.n){this.tris=new Uint32Array(36*r);for(let e=0;e<r;e++)for(let t=0;t<36;t++)this.tris[e*36+t]=ye[t]+8*e;this.edges=ge(this.tris,12*r),this.n=r}this.hidden=n,this.flat=null}get boxes(){return this.n}get numVertices(){return 8*this.n}get numFaces(){return 12*this.n}get numEdges(){return this.edges.edges.length/2}get numSegments(){return 1}vertex(e){return[this.pos[3*e],this.pos[3*e+1],this.pos[3*e+2]]}face(e){return[this.tris[3*e],this.tris[3*e+1],this.tris[3*e+2]]}faceEdge(e,t){return this.edges.faceEdges[3*e+t]}edge(e){return[this.edges.edges[2*e],this.edges.edges[2*e+1]]}segmentOfFace(){return 0}segmentOfVertex(){return 0}segmentFaces(){return[0,this.numFaces]}segmentName(){return`segment 0`}segmentVisible(){return!this.userHidden}faceVisible(e){return!this.userHidden&&!this.hidden[Math.floor(e/12)]}flatMask(e){return this.flat?.angle!==e&&(this.flat={angle:e,mask:_e(this.tris,this.numFaces,e=>this.vertex(e),this.edges,e)}),this.flat.mask}},xe=class{name;id;kind=`points`;points=new Float32Array;radii=null;defaultRadius=.01;hidden=new Uint8Array;constructor(e,t){this.name=e,this.id=t}get count(){return this.points.length/3}point(e){return[this.points[3*e],this.points[3*e+1],this.points[3*e+2]]}radius(e){return this.radii?this.radii[e]:this.defaultRadius}visible(e){return!this.hidden[e]}},E=function(e){return e[e.Vertex=0]=`Vertex`,e[e.Edge=1]=`Edge`,e[e.Face=2]=`Face`,e[e.Body=3]=`Body`,e}({}),Se=[`Vertex`,`Edge`,`Face`,`Body`],Ce=class{_mode=2;_items=[];lookup=new Set;version=1;get mode(){return this._mode}get items(){return this._items}get active(){return this._items.length?this._items[this._items.length-1]:null}get empty(){return this._items.length===0}setMode(e){e!==this._mode&&(this._mode=e,this.clear(),this.version++)}contains(e){return this.lookup.has(we(e))}clear(){this._items.length&&(this._items=[],this.lookup.clear(),this.version++)}set(e){this._items=[e],this.lookup=new Set([we(e)]),this.version++}toggle(e){let t=we(e);this.lookup.delete(t)?this._items=this._items.filter(e=>we(e)!==t):(this._items.push(e),this.lookup.add(t)),this.version++}add(e,t){t||(this._items=[],this.lookup.clear());for(let t of e){let e=we(t);this.lookup.has(e)||(this.lookup.add(e),this._items.push(t))}this.version++}},we=e=>`${e.object}:${e.index}`;function D(e,t){return e.kind===`mesh`?[`vertex`,`edge`,`face`,`segment`][t]:t===3?`segment`:`vertex`}var O=(e,t)=>[e[0]+t[0],e[1]+t[1],e[2]+t[2]],k=(e,t)=>[e[0]*t,e[1]*t,e[2]*t];function Te(e,t){let[n,r]=e.segmentFaces(t),i=[1/0,1/0,1/0],a=[-1/0,-1/0,-1/0];for(let t=n;t<r;t++)for(let n of e.face(t)){let t=e.vertex(n);for(let e=0;e<3;e++)i[e]=Math.min(i[e],t[e]),a[e]=Math.max(a[e],t[e])}return r>n?[i,a]:null}function Ee(e){let t=[1/0,1/0,1/0],n=[-1/0,-1/0,-1/0];for(let r=0;r<e.count;r++){if(!e.visible(r))continue;let i=e.point(r),a=e.radius(r);for(let e=0;e<3;e++)t[e]=Math.min(t[e],i[e]-a),n[e]=Math.max(n[e],i[e]+a)}return Number.isFinite(t[0])?[t,n]:null}var De=e=>e?[(e[0][0]+e[1][0])/2,(e[0][1]+e[1][1])/2,(e[0][2]+e[1][2])/2]:[0,0,0];function Oe(e,t,n){let r=e.find(n.object);if(!r)return[0,0,0];let i=D(r,t);if(r.kind===`points`)return i===`segment`||n.index>=r.count?De(Ee(r)):r.point(n.index);switch(i){case`vertex`:return n.index<r.numVertices?r.vertex(n.index):[0,0,0];case`edge`:{if(n.index>=r.numEdges)return[0,0,0];let[e,t]=r.edge(n.index);return k(O(r.vertex(e),r.vertex(t)),.5)}case`face`:{if(n.index>=r.numFaces)return[0,0,0];let[e,t,i]=r.face(n.index);return k(O(O(r.vertex(e),r.vertex(t)),r.vertex(i)),1/3)}default:return n.index<r.numSegments?De(Te(r,n.index)):[0,0,0]}}function ke(e,t){let n=e.find(t.object);if(t.kind===`vertex`&&n?.kind===`mesh`&&t.index<n.numVertices)return n.vertex(t.index);if(t.kind===`surface`&&n?.kind===`mesh`&&t.index<n.numFaces){let[e,r,i]=n.face(t.index),a=[n.vertex(e),n.vertex(r),n.vertex(i)];return[0,1,2].map(e=>t.bary[0]*a[0][e]+t.bary[1]*a[1][e]+t.bary[2]*a[2][e])}return t.kind===`point`&&n?.kind===`points`&&t.index<n.count?n.point(t.index):t.point}function Ae(e,t,n,r){let i=C(S(n,t),S(r,t)),a=w(i,e.dir);if(Math.abs(a)<1e-20)return null;let o=w(i,S(t,e.origin))/a,s=O(e.origin,k(e.dir,o)),c=w(i,i),l=w(C(S(r,n),S(s,n)),i)/c,u=w(C(S(t,r),S(s,r)),i)/c,d=1-l-u;l=Math.max(l,0),u=Math.max(u,0),d=Math.max(d,0);let f=l+u+d,p=[l/f,u/f,d/f];return{bary:p,point:O(O(k(t,p[0]),k(n,p[1])),k(r,p[2]))}}var je=()=>({kind:`ground`,object:0,index:0,bary:[0,0,0],point:[0,0,0]});function Me(e,t,n,r){let i={valid:!1,surface:je(),point:[0,0,0]};if(t.object===4294967295){if(Math.abs(n.dir[2])<1e-8)return i;let e=(r-n.origin[2])/n.dir[2];if(e<=0)return i;let t=O(n.origin,k(n.dir,e));return{valid:!0,surface:{...je(),point:t},point:t}}let a=e.find(t.object);if(!a)return i;if(a.kind===`mesh`){if(t.element>=a.numFaces)return i;let[e,r,o]=a.face(t.element),s=Ae(n,a.vertex(e),a.vertex(r),a.vertex(o));return s?{valid:!0,surface:{kind:`surface`,object:t.object,index:t.element,bary:s.bary,point:s.point},point:s.point}:i}let o=Math.floor(t.element/12),s={kind:`point`,object:t.object,index:o,bary:[0,0,0],point:[0,0,0]};return{valid:!0,surface:s,point:ke(e,s)}}function Ne(e,t,n){let r=[n[0]-t[0],n[1]-t[1]],i=Math.max(0,Math.min(1,((e[0]-t[0])*r[0]+(e[1]-t[1])*r[1])/Math.max(r[0]**2+r[1]**2,1e-12)));return Math.hypot(e[0]-t[0]-r[0]*i,e[1]-t[1]-r[1]*i)}var Pe=e=>e.object!==0&&e.object!==4294967295;function Fe(e,t,n,r,i,a){if(!r.length)return null;let o=r[Math.floor(r.length/2)];if(Pe(o)){let t=e.find(o.object);if(!t)return null;let r=D(t,n);if(t.kind===`points`)return{object:o.object,index:r===`segment`?0:Math.floor(o.element/12)};if(r===`face`)return{object:o.object,index:o.element};if(r===`segment`)return{object:o.object,index:o.segment}}let s=t.projector(a[0],a[1]),c=e=>{let t=s(e);return[t[0],t[1]]},l=new Set,u=1/0,d=null,f=(e,t,n)=>{n<u&&(u=n,d={object:e,index:t})};for(let t of r){if(!Pe(t))continue;let r=`${t.object}:${t.element}`;if(l.has(r))continue;l.add(r);let a=e.find(t.object);if(!a)continue;let o=D(a,n);if(a.kind===`mesh`){if(t.element>=a.numFaces)continue;let e=a.face(t.element),n=e.map(e=>c(a.vertex(e)));for(let r=0;r<3;r++)o===`vertex`&&f(t.object,e[r],Math.hypot(n[r][0]-i[0],n[r][1]-i[1])),o===`edge`&&f(t.object,a.faceEdge(t.element,r),Ne(i,n[r],n[(r+1)%3]));let r=(n[0][0]+n[1][0]+n[2][0])/3,s=(n[0][1]+n[1][1]+n[2][1])/3,l=Math.hypot(r-i[0],s-i[1]);o===`face`&&f(t.object,t.element,l),o===`segment`&&f(t.object,a.segmentOfFace(t.element),l)}else{let e=Math.floor(t.element/12),n=c(a.point(e));f(t.object,o===`segment`?0:e,Math.hypot(n[0]-i[0],n[1]-i[1]))}}return d}function Ie(e,t,n,r,i,a,o,s){let c=t.projector(o[0],o[1]),l=e=>{let n=c(e);return(n[2]<0||t.ortho)&&n[0]>=i[0]&&n[0]<=a[0]&&n[1]>=i[1]&&n[1]<=a[1]},u=[],d=new Set,f=(e,t)=>{let n=`${e}:${t}`;d.has(n)||(d.add(n),u.push({object:e,index:t}))},p=new Map;if(!s)for(let e of r){if(!Pe(e))continue;let t=p.get(e.object);t||p.set(e.object,t=new Set),t.add(e.element)}for(let t of e.all()){if(!s&&!p.has(t.id))continue;let e=t.id,r=D(t,n);if(t.kind===`mesh`){let n=s?Le(t.numFaces):[...p.get(e)].sort((e,t)=>e-t);for(let i of n){if(!t.faceVisible(i))continue;let n=t.face(i),a=n.map(e=>t.vertex(e));switch(r){case`vertex`:for(let t=0;t<3;t++)l(a[t])&&f(e,n[t]);break;case`edge`:for(let n=0;n<3;n++)l(a[n])&&l(a[(n+1)%3])&&f(e,t.faceEdge(i,n));break;case`face`:l(k(O(O(a[0],a[1]),a[2]),1/3))&&f(e,i);break;default:(!s||l(k(O(O(a[0],a[1]),a[2]),1/3)))&&f(e,t.segmentOfFace(i))}}}else{let n=s?Le(t.count):[...new Set([...p.get(e)].map(e=>Math.floor(e/12)))].sort((e,t)=>e-t);for(let i of n)t.visible(i)&&l(t.point(i))&&f(e,r===`segment`?0:i)}}return u}var Le=e=>Array.from({length:e},(e,t)=>t),A=function(e){return e[e.Off=0]=`Off`,e[e.Distance=1]=`Distance`,e[e.Angle=2]=`Angle`,e}({});function Re(e,t){if(t.anchors.length<2)return{value:0,delta:[0,0,0]};let n=ke(e,t.anchors[0]),r=ke(e,t.anchors[1]);if(!t.angle){let e=S(r,n);return{value:Math.hypot(...e),delta:e}}if(t.anchors.length<3)return{value:0,delta:[0,0,0]};let i=ke(e,t.anchors[2]),a=S(n,r),o=S(i,r),s=w(a,o)/(Math.hypot(...a)*Math.hypot(...o)||1);return{value:Math.acos(Math.max(-1,Math.min(1,s)))*180/Math.PI,delta:[0,0,0]}}function ze(e,t){let n=e.find(t.object)?.name??`?`;switch(t.kind){case`vertex`:return`${n} v${t.index}`;case`surface`:return`${n} f${t.index}`;case`point`:return`${n} #${t.index}`;case`fixed`:return`${n} point`;default:return`ground`}}var Be=[0,0,0,.75],Ve=2,He=.3,Ue=4;async function We(e){let[t,n]=await Promise.all([fetch(`${e}font/label.json`).then(e=>e.json()),fetch(`${e}font/label.png`).then(e=>e.blob())]);return{info:t,image:await createImageBitmap(n,{colorSpaceConversion:`none`,premultiplyAlpha:`none`})}}var Ge=class{font;glyphs=new Map;constructor(e){this.font=e;for(let[t,n]of Object.entries(e.glyphs))this.glyphs.set(Number(t),n)}find(e){return this.glyphs.get(e)??this.glyphs.get(63)}layout(e,t,n){let r=this.font;for(let i of e){let e=i.sizePx;if(i.worldHeight>0){let n=[i.anchor[0]-t.eye[0],i.anchor[1]-t.eye[1],i.anchor[2]-t.eye[2]],r=n[0]*t.forward[0]+n[1]*t.forward[1]+n[2]*t.forward[2];if(!t.ortho&&r<=t.near)continue;let a=t.ortho?t.viewHeight/t.height:2*Math.max(r,t.near)*Math.tan(.5*t.fovy)/t.height;if(e=i.worldHeight/Math.max(a,1e-12),e<Ue)continue}let a=e/r.base_px,o=Array.from(i.text,e=>e.codePointAt(0)),s=0;for(let e of o)s+=(this.find(e)?.advance??0)*a;let c=i.offset??[0,0],l=Math.round(c[0]-i.align[0]*s),u=Math.round(c[1]-i.align[1]*r.ascent*a*.78),d=i.halo??Be,f=Math.min(Ve/a*r.sdf_per_px,.45),p=0;for(let e of o){let t=this.find(e);t&&(t.size[0]>0&&n.push(i.anchor[0],i.anchor[1],i.anchor[2],i.hiddenAlpha??He,l+(p+t.offset[0])*a,u+(t.offset[1]-r.ascent*.22)*a,t.size[0]*a,t.size[1]*a,t.uv[0],t.uv[1],t.uv[2],t.uv[3],i.color[0],i.color[1],i.color[2],i.color[3]??1,d[0],d[1],d[2],d[3],f,0,0,0),p+=t.advance)}}}};function Ke(e,t){return e.replace(/\{(?::([+ ]?)(\d*)(?:\.(\d+))?([defgG%]?))?\}/g,(e,n,r,i,a)=>{let o=i===void 0?void 0:Number(i),s;switch(a){case`f`:s=t.toFixed(o??6);break;case`e`:s=qe(t,o??6);break;case`%`:s=(t*100).toFixed(o??6)+`%`;break;case`d`:s=Math.trunc(t).toString();break;case`g`:case`G`:s=Je(t,o??6);break;default:s=o===void 0?Ye(t):Je(t,o)}return n&&t>=0&&!s.startsWith(`-`)&&(s=(n===`+`?`+`:` `)+s),r?s.padStart(Number(r)):s})}function qe(e,t){return e.toExponential(t).replace(/e([+-])(\d)$/,`e$10$2`)}function Je(e,t){if(e===0)return`0`;let n=Math.max(t,1),r=Math.floor(Math.log10(Math.abs(e)));return(r<-4||r>=n?qe(e,n-1):e.toFixed(Math.max(n-1-r,0))).replace(/(\.\d*?)0+(e|$)/,`$1$2`).replace(/\.(e|$)/,`$1`)}function Ye(e){return Number.isInteger(e)?e.toFixed(1):String(e)}function Xe(e){if(!(e>0))return 1;let t=10**Math.floor(Math.log10(e));for(let n of[1,2,5,10])if(n*t>=e)return n*t;return 10*t}function Ze(e,t){let n=Math.abs(t);if(Math.abs(e)<1e-12)return`0`;if(n>=.1){let t=e.toFixed(n>=1?0:1);return t.includes(`.`)&&(t=t.replace(/0+$/,``).replace(/\.$/,``)),t+` m`}return n>=.01?`${(e*100).toFixed(0)} cm`:n>=.001?`${(e*1e3).toFixed(0)} mm`:`${(e*1e6).toFixed(0)} \u00b5m`}var Qe=(e,t)=>Number.isFinite(e)?Je(e,t):String(e),$e=`// The native viewer's environment prefilter (GGX, per roughness mip), unchanged.
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

`,et=[`Clay`,`Porcelain`,`Chrome`,`Toon`],tt=[`Studio softboxes`,`Clear sky`,`Soft white room`],j=Math.PI,M=(e,t)=>e[0]*t[0]+e[1]*t[1]+e[2]*t[2],nt=(e,t)=>[e[1]*t[2]-e[2]*t[1],e[2]*t[0]-e[0]*t[2],e[0]*t[1]-e[1]*t[0]],rt=e=>{let t=Math.hypot(e[0],e[1],e[2]);return[e[0]/t,e[1]/t,e[2]/t]},it=(e,t,n)=>Math.min(n,Math.max(t,e)),at=(e,t,n)=>{let r=it((n-e)/(t-e),0,1);return r*r*(3-2*r)},ot=e=>e*j/180,st=e=>e===2?0:1;function ct(e){e=it(e,0,1);let t=e<=.0031308?e*12.92:1.055*e**(1/2.4)-.055;return Math.round(t*255)}function lt(e,t=256){let n=new Uint8Array(t*t*4),r=rt([-.5,.6,.62]),i=rt([.75,-.05,.65]),a=[0,0,1],o=rt([r[0]+a[0],r[1]+a[1],r[2]+a[2]]);for(let a=0;a<t;a++)for(let s=0;s<t;s++){let c=(s+.5)/t*2-1,l=1-(a+.5)/t*2,u=c*c+l*l;if(u>1){let e=Math.sqrt(u);c/=e,l/=e,u=1}let d=[c,l,Math.sqrt(Math.max(0,1-u))],f=Math.max(0,M(d,r)),p=Math.max(0,M(d,i)),m=Math.max(0,(M(d,r)+.4)/1.4),h=Math.max(0,M(d,o)),g=(1-d[2])**3,_=[0,0,0],v=0;if(e===0){let e=.1+.5*m+.14*p+.1*d[1];_=[1*e,.97*e,.93*e],v=.06*h**10}else if(e===1){let e=.12+.52*f+.16*p+.1*(d[1]*.5+.5);_=[e,e,e],v=.9*h**140+.25*h**18+.12*g}else if(e===2){let e=2*d[2],t=[e*d[0],e*d[1],-1+e*d[2]],n=at(-.05,.25,t[1]),i=[.06,.06,.07],a=[.85,.88,.95],o=.5*Math.exp(-(((t[1]-.05)*14)**2)),s=2*Math.max(0,M(t,r))**200;_=[0,1,2].map(e=>(i[e]+(a[e]-i[e])*n+o+s)*.9)}else{let e=f>.55?.62:f>.15?.42:.24;_=[e,e,e],v=h>.985?.6:0}let y=(a*t+s)*4;n[y]=ct(_[0]),n[y+1]=ct(_[1]),n[y+2]=ct(_[2]),n[y+3]=Math.round(it(v,0,1)*255)}return n}function ut(e,t){let n=(e-.5)*2*j,r=t*j;return[Math.sin(r)*Math.cos(n),Math.sin(r)*Math.sin(n),Math.cos(r)]}function dt(e,t){let n=ot(e),r=ot(t);return[Math.cos(r)*Math.cos(n),Math.cos(r)*Math.sin(n),Math.sin(r)]}function ft(e,t,n,r){let i=Math.acos(it(M(e,t),-1,1)),a=ot(n);return 1-at(a*(1-r),a,i)}function pt(e,t,n,r){let i=rt(nt(t,[0,0,1])),a=nt(i,t),o=M(e,t);if(o<=0)return 0;let s=Math.atan2(M(e,i),o),c=Math.atan2(M(e,a),o),l=ot(n),u=ot(r);return(1-at(l*.75,l,Math.abs(s)))*(1-at(u*.75,u,Math.abs(c)))}function mt(e,t=1024){let n=t/2,r=new Float32Array(t*n*3),i=dt(-130,55),a=dt(-40,25),o=dt(100,30),s=dt(-120,50),c=e===1?s:e===0?i:[0,0,1],l=(e,t,n)=>[e[0]+(t[0]-e[0])*n,e[1]+(t[1]-e[1])*n,e[2]+(t[2]-e[2])*n];for(let c=0;c<n;c++)for(let u=0;u<t;u++){let d=ut((u+.5)/t,(c+.5)/n),f=at(-.08,.08,d[2]),p;if(e===0){p=l([.07,.07,.07],l([.1,.1,.1],[.3,.3,.32],d[2]*.5+.5),f);let e=9*pt(d,i,22,14),t=2.5*pt(d,a,30,10),n=5*pt(d,o,8,22),r=1.5*ft(d,[0,0,1],25,.5);p=[p[0]+e*1+t*.92+n+r,p[1]+e*.97+t*.96+n+r,p[2]+e*.92+t*1+n+r]}else if(e===1){p=l([.16,.15,.13],l([.75,.84,.95],[.18,.36,.8],Math.max(d[2],0)**.45).map(e=>e*1.3),f);let e=400*ft(d,s,1.2,.3),t=2*ft(d,s,18,1);p=[p[0]+e*1+t*1,p[1]+e*.95+t*.9,p[2]+e*.85+t*.7]}else{let e=.3+.7*(d[2]*.5+.5);p=[e,e,e]}r.set(p,(c*t+u)*3)}return{width:t,height:n,rgb:r,sunDir:c}}function ht(e){let t=new Float32Array([e]),n=new Uint32Array(t.buffer)[0],r=n>>>16&32768,i=n>>>23&255,a=n&8388607;if(i===255)return r|31744|(a?512:0);let o=i-127+15;return o>=31?r|31744:o<=0?o<-10?r:(a|=8388608,r|a>>>14-o):r|o<<10|a>>>13}function gt(e,t){let{width:n,height:r}=t,i=new Float32Array(36);for(let e=0;e<r;e++){let a=(e+.5)/r*j,o=2*j/n*(j/r)*Math.sin(a);for(let a=0;a<n;a++){let s=ut((a+.5)/n,(e+.5)/r),c=(e*n+a)*3,l=[.282095,.488603*s[1],.488603*s[2],.488603*s[0],1.092548*s[0]*s[1],1.092548*s[1]*s[2],.315392*(3*s[2]*s[2]-1),1.092548*s[0]*s[2],.546274*(s[0]*s[0]-s[1]*s[1])];for(let e=0;e<3;e++){let n=Math.min(t.rgb[c+e],50)*o;for(let t=0;t<9;t++)i[4*t+e]+=n*l[t]}}}for(let e=0;e<36;e++)i[e]/=j;let a=1;for(;n>>a>=32&&r>>a>=16;)a++;let o=GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST,s=e.createTexture({size:[n,r],format:`rgba16float`,usage:o,mipLevelCount:a}),c=t.rgb,l=n,u=r;for(let t=0;t<a;t++){let n=new Uint16Array(l*u*4);for(let e=0;e<l*u;e++){for(let t=0;t<3;t++)n[4*e+t]=ht(Math.min(c[3*e+t],6e4));n[4*e+3]=15360}if(e.queue.writeTexture({texture:s,mipLevel:t},n,{bytesPerRow:l*8,rowsPerImage:u},[l,u]),t+1===a)break;let r=l>>1,i=u>>1,o=new Float32Array(r*i*3);for(let e=0;e<i;e++)for(let t=0;t<r;t++)for(let n=0;n<3;n++)o[(e*r+t)*3+n]=.25*(c[(2*e*l+2*t)*3+n]+c[(2*e*l+2*t+1)*3+n]+c[((2*e+1)*l+2*t)*3+n]+c[((2*e+1)*l+2*t+1)*3+n]);c=o,l=r,u=i}let d=e.createTexture({size:[n,r],format:`rgba16float`,mipLevelCount:a,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING}),f=e.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:`uniform`}},{binding:1,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:`float`}},{binding:2,visibility:GPUShaderStage.COMPUTE,sampler:{type:`filtering`}},{binding:3,visibility:GPUShaderStage.COMPUTE,storageTexture:{access:`write-only`,format:`rgba16float`}}]}),p=e.createComputePipeline({layout:e.createPipelineLayout({bindGroupLayouts:[f]}),compute:{module:e.createShaderModule({code:$e}),entryPoint:`main`}}),m=e.createSampler({addressModeU:`repeat`,addressModeV:`clamp-to-edge`,magFilter:`linear`,minFilter:`linear`,mipmapFilter:`linear`}),h=s.createView(),g=e.createCommandEncoder(),_=[];for(let t=0;t<a;t++){let i=a>1?t/(a-1):0,o=e.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});e.queue.writeBuffer(o,0,new Float32Array([i*i,a,n,0])),_.push(o);let s=e.createBindGroup({layout:f,entries:[{binding:0,resource:{buffer:o}},{binding:1,resource:h},{binding:2,resource:m},{binding:3,resource:d.createView({baseMipLevel:t,mipLevelCount:1})}]}),c=g.beginComputePass();c.setPipeline(p),c.setBindGroup(0,s),c.dispatchWorkgroups(Math.ceil((n>>t)/8),Math.ceil((r>>t)/8)),c.end()}return e.queue.submit([g.finish()]),e.queue.onSubmittedWorkDone().then(()=>{s.destroy();for(let e of _)e.destroy()}),{view:d.createView(),texture:d,mips:a,sh:i,sunDir:t.sunDir}}var N={view:0,proj:16,viewProj:32,invViewProj:48,invProj:64,invView:80,lightViewProj:96,cameraPos:112,viewport:116,sunDir:120,bgTop:124,bgBottom:128,gridMinor:132,gridMajor:136,gridParams:140,gridPlane:144,axisU:148,axisV:152,wire:156,wireMode:160,select:164,active:168,outline:172,style:176,style2:180,env:184,ao:188,post:192,slice:196,sh:200,size:236},P=4,_t=2048,F=`rgba16float`,I=`depth32float`,vt=[[`studio`,`Studio`],[`matcap`,`MatCap`],[`pbr`,`Environment PBR`],[`technical`,`Technical`]],yt={studio:[g,b],matcap:[_,ee],pbr:[v,x],technical:[y,te]};function bt(){return{shading:`solid`,style:`studio`,wireframe:!1,wireWidth:1,flatEdgeAngle:0,wireObjectColors:!1,faceOpacity:0,shadows:!0,shadowStrength:.6,ssao:!0,aoStrength:.8,aoRadius:.35,outline:1,outlineWidth:1,exposure:1,grid:!0,groundShadow:!0,studioSpecular:.35,studioWrap:.35,studioAmbient:.38,matcap:0,matcapTint:1,environment:0,envIntensity:1,envRotation:0,goochShift:1,goochContrast:.8,slice:{enabled:!1,axis:0,offset:0,flip:!1,show:!0}}}function xt(e,t){e.style=t;let n={studio:[.8,1],matcap:[.6,0],pbr:[.7,0],technical:[.45,2]}[t];e.ssao=!0,e.aoStrength=n[0],e.shadows=!0,e.outline=n[1]}var St=()=>({opacity:1,sliced:!0,metallic:0,roughness:.45}),Ct=[.25,-.35,1],wt=e=>e<=.04045?e/12.92:((e+.055)/1.055)**2.4,L=(e,t,n,r=1)=>[wt(e),wt(t),wt(n),r];function Tt(e,t,n,r=1){let i=e=>Math.max(0,Math.min(255,Math.round(e*255)));return(i(e)|i(t)<<8|i(n)<<16|i(r)<<24)>>>0}function Et(e){let t=e.alignedAxis();return e.ortho&&(t===0||t===1)?{normal:t,u:+(t===0),v:2,offset:0,background:!0}:{normal:2,u:0,v:1,offset:0,background:!1}}var Dt=GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,Ot=32,kt=class e{device;context;canvas;camera=new pe;settings=bt();display=new Map;overlay={lines:[],labels:[]};frame=new Float32Array(N.size);frameBuf;objects=new Map;nextId=1;size=[0,0];layouts={};pipes={};builtStyle=null;samplers={};t={};groups={};dummy;shadowView;fontView;matcapTex;matcapBuilt=-1;env=null;envBuilt=-1;text;glyphBuf;glyphCap=0;glyphGroup;lineBuf;lineCap=0;lineGroup;isolated=-1;selection=new Map;selectionVersion=0;hiddenVersion=0;constructor(e,t,n,r,i){this.device=e,this.context=t,this.canvas=r;let a=e;this.frameBuf=a.createBuffer({size:N.size*4,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});let o=e=>a.createBindGroupLayout({entries:e}),s=e=>({binding:e,visibility:Dt,buffer:{type:`uniform`}}),c=(e,t=Dt)=>({binding:e,visibility:t,buffer:{type:`read-only-storage`}}),l=e=>c(e,GPUShaderStage.VERTEX),u=(e,t=`float`)=>({binding:e,visibility:Dt,texture:{sampleType:t}}),d=(e,t=`filtering`)=>({binding:e,visibility:Dt,sampler:{type:t}});this.layouts={frame:o([s(0)]),scene:o([s(0),d(1),u(2),u(3),u(4),u(5,`depth`),d(6,`comparison`),u(7),d(8)]),rigid:o([s(0),l(1),l(2),l(3),l(4),l(5),l(6),l(7)]),dyn:o([s(0),l(1),l(2),l(3),l(4),l(5)]),ssao:o([s(0),u(1,`depth`),u(2,`unfilterable-float`)]),blur:o([s(0),u(1,`depth`),u(3,`unfilterable-float`)]),composite:o([s(0),u(1,`unfilterable-float`),u(2,`uint`),u(3,`depth`),u(4,`unfilterable-float`),u(5,`unfilterable-float`),u(6,`unfilterable-float`)]),lines:o([s(0),u(1,`depth`)]),text:o([s(0),u(1,`depth`),u(2),d(3)]),storage:o([c(0)])},this.samplers.clamp=a.createSampler({magFilter:`linear`,minFilter:`linear`,mipmapFilter:`linear`}),this.samplers.repeat=a.createSampler({magFilter:`linear`,minFilter:`linear`,mipmapFilter:`linear`,addressModeU:`repeat`}),this.samplers.shadow=a.createSampler({magFilter:`linear`,minFilter:`linear`,compare:`less-equal`});let f=a.createTexture({size:[1,1],format:`rgba8unorm`,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});a.queue.writeTexture({texture:f},new Uint8Array([255,255,255,255]),{bytesPerRow:4},[1,1]),this.dummy=f.createView(),this.matcapTex=a.createTexture({size:[256,256],format:`rgba8unorm-srgb`,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});let p=a.createTexture({size:[_t,_t],format:I,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});this.t.shadow=p,this.shadowView=p.createView();let m=a.createTexture({size:[i.info.width,i.info.height],format:`rgba8unorm`,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});a.queue.copyExternalImageToTexture({source:i.image},{texture:m},[i.info.width,i.info.height]),this.fontView=m.createView(),this.text=new Ge(i.info),this.glyphBuf=this.storageBuffer(`glyph`,256),this.lineBuf=this.storageBuffer(`line`,16);let h=e=>a.createShaderModule({code:e}),g=h(re),_=h(ne),v=h(ie),y=h(ae),b=h(oe),ee=this.premult,x=(e,t,n,r,i={})=>a.createRenderPipeline({layout:this.pipelineLayout(...n),primitive:{topology:`triangle-list`},vertex:{module:e,entryPoint:`vs_fullscreen`},fragment:{module:e,entryPoint:t,targets:r},...i}),te=(e,t)=>a.createRenderPipeline({layout:this.pipelineLayout(t,this.layouts.storage),primitive:{topology:`triangle-list`},vertex:{module:e,entryPoint:`vs_main`},fragment:{module:e,entryPoint:`fs_main`,targets:[{format:n,blend:ee}]}});Object.assign(this.pipes,{gridMain:x(g,`fs_main`,[this.layouts.scene],[{format:F,blend:ee}],{depthStencil:this.depthGreater(!1),multisample:{count:P}}),gridPre:x(g,`fs_prepass`,[this.layouts.scene],this.prepassTargets,{depthStencil:this.depthGreater()}),ssao:x(_,`fs_ssao`,[this.layouts.ssao],[{format:`r8unorm`}]),blur:x(_,`fs_blur`,[this.layouts.blur],[{format:`r8unorm`}]),composite:x(v,`fs_composite`,[this.layouts.composite],[{format:n}]),lines:te(y,this.layouts.lines),text:te(b,this.layouts.text)}),this.buildStylePipelines(`studio`),this.groups.frame=a.createBindGroup({layout:this.layouts.frame,entries:[{binding:0,resource:{buffer:this.frameBuf}}]})}premult={color:{srcFactor:`one`,dstFactor:`one-minus-src-alpha`,operation:`add`},alpha:{srcFactor:`one`,dstFactor:`one-minus-src-alpha`,operation:`add`}};prepassTargets=[{format:F},{format:`rgba32uint`}];depthGreater=(e=!0)=>({format:I,depthWriteEnabled:e,depthCompare:`greater`});pipelineLayout=(...e)=>this.device.createPipelineLayout({bindGroupLayouts:e});buildStylePipelines(e){let t=this.device,[n,r]=yt[e],i={topology:`triangle-list`,cullMode:`none`},a=[{format:F,blend:{color:{srcFactor:`one`,dstFactor:`one`},alpha:{srcFactor:`one`,dstFactor:`one`}}},{format:`r16float`,blend:{color:{srcFactor:`zero`,dstFactor:`one-minus-src`},alpha:{srcFactor:`zero`,dstFactor:`one-minus-src`}}}];for(let[e,o,s]of[[`rigid`,n,this.layouts.rigid],[`dyn`,r,this.layouts.dyn]]){let n=t.createShaderModule({code:o}),r={module:n,entryPoint:`vs_main`},c=this.pipelineLayout(this.layouts.scene,s);this.pipes[`${e}Main`]=t.createRenderPipeline({layout:c,primitive:i,vertex:r,fragment:{module:n,entryPoint:`fs_main`,targets:[{format:F}]},depthStencil:this.depthGreater(),multisample:{count:P}}),this.pipes[`${e}Transparent`]=t.createRenderPipeline({layout:c,primitive:i,vertex:r,fragment:{module:n,entryPoint:`fs_transparent`,targets:a},depthStencil:this.depthGreater(!1),multisample:{count:P}}),this.pipes[`${e}Wire`]=t.createRenderPipeline({layout:c,primitive:i,vertex:r,fragment:{module:n,entryPoint:`fs_wire`,targets:[{format:F,blend:this.premult}]},depthStencil:{format:I,depthWriteEnabled:!1,depthCompare:`always`},multisample:{count:P}}),this.pipes[`${e}Pre`]=t.createRenderPipeline({layout:c,primitive:i,vertex:r,fragment:{module:n,entryPoint:`fs_prepass`,targets:this.prepassTargets},depthStencil:this.depthGreater()}),this.pipes[`${e}Shadow`]=t.createRenderPipeline({layout:this.pipelineLayout(this.layouts.frame,s),primitive:i,vertex:{module:n,entryPoint:`vs_shadow`},fragment:{module:n,entryPoint:`fs_shadow`,targets:[]},depthStencil:{format:I,depthWriteEnabled:!0,depthCompare:`less`}})}this.builtStyle=e}static async create(t){if(!navigator.gpu)throw Error(`WebGPU is not available in this browser`);let n=await navigator.gpu.requestAdapter({powerPreference:`high-performance`});if(!n)throw Error(`no WebGPU adapter (is hardware acceleration on?)`);let r=await n.requestDevice();r.lost.then(e=>console.error(`WebGPU device lost:`,e.message)),r.addEventListener(`uncapturederror`,e=>console.error(`WebGPU:`,e.error.message));let i=t.getContext(`webgpu`);if(!i)throw Error(`could not get a WebGPU canvas context`);let a=navigator.gpu.getPreferredCanvasFormat();i.configure({device:r,format:a,alphaMode:`opaque`});let o=await We(new URL(`.`,location.href).href);return new e(r,i,a,t,o)}storageBuffer(e,t){let n=e===`glyph`?24:16,r=this.device.createBuffer({size:t*n*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),i=this.device.createBindGroup({layout:this.layouts.storage,entries:[{binding:0,resource:{buffer:r}}]});return e===`glyph`?(this.glyphBuf?.destroy(),this.glyphCap=t,this.glyphGroup=i):(this.lineBuf?.destroy(),this.lineCap=t,this.lineGroup=i),r}buffer(e,t=GPUBufferUsage.STORAGE){let n=this.device.createBuffer({size:Math.max(16,jt(e.byteLength)),usage:t|GPUBufferUsage.COPY_DST});return this.device.queue.writeBuffer(n,0,e.buffer,e.byteOffset,e.byteLength),n}clear(){for(let e of this.objects.values())Mt(e);this.objects.clear(),this.nextId=1}objectNames(){return[...this.objects].filter(([,e])=>e.kind!==`labels`).map(([e,t])=>({name:e,kind:t.kind}))}geometries(){let e=[];for(let t of this.objects.values())t.kind===`rigid`?e.push(t.geo):t.kind===`dyn`&&e.push(t.points??t.geo);return e}displayOf(e){let t=this.display.get(e);return t||this.display.set(e,t=St()),t}setScene(e){this.clear(),this.isolated=-1,this.selection.clear();for(let t of e)if(t.kind===`rigid_mesh`)this.objects.set(t.name,this.makeRigid(t));else if(t.kind===`boxes`||t.kind===`points`){let e=this.nextId++,n={kind:`dyn`,id:e,obj:t,params:this.device.createBuffer({size:Ot,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),geo:new be(t.name,e),points:t.kind===`points`?new xe(t.name,e):null,segments:this.device.createBuffer({size:16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),bind:null,faces:0,capacity:0,flagsKey:``,version:0};this.objects.set(t.name,n),this.rebuildDyn(n)}else if(t.kind===`labels`){let e=t.arrays.values?.data;this.objects.set(t.name,{kind:`labels`,obj:t,values:e?Float32Array.from(e):null})}}rigidInfo(){for(let[e,t]of this.objects)if(t.kind===`rigid`)return{name:e,id:t.id,instances:t.geo.instances,bodies:t.geo.B,offsets:t.geo.offsets,geo:t.geo};return null}makeRigid(e){let t=this.device,n=this.nextId++,r=new T(e.name,n,e),i=r.numSegments,a=t.createBuffer({size:Math.max(32,i*32),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),o=new Float32Array(i*8);for(let e=0;e<i;e++)o[e*8+7]=1;t.queue.writeBuffer(a,0,o);let s=t.createBuffer({size:Math.max(16,i*8),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),c=t.createBuffer({size:Math.max(16,r.numFaces*4),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),l=this.buffer(r.offsets),u=this.buffer(r.local),d=this.buffer(r.vertexBody),f=this.buffer(r.tris),p=t.createBuffer({size:Ot,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),m=t.createBindGroup({layout:this.layouts.rigid,entries:[p,a,s,l,u,d,f,c].map((e,t)=>({binding:t,resource:{buffer:e}}))}),h=new Uint32Array(i),g=e.arrays.segment_colors.data;for(let e=0;e<i;e++)h[e]=Tt(g[3*e],g[3*e+1],g[3*e+2]);let _={kind:`rigid`,id:n,geo:r,buffers:[p,a,s,c,l,u,d,f],params:p,poses:a,segments:s,faceInfo:c,bind:m,poseScratch:o,poseVersion:0,baseColors:h,flagsKey:``};return e.arrays.poses&&this.setPoses(_,e.arrays.poses),_}setIsolated(e){if(e!==this.isolated){this.isolated=e;for(let t of this.objects.values())t.kind===`rigid`?t.geo.isolated=e:t.kind===`dyn`&&this.rebuildDyn(t)}}get isolatedEnv(){return this.isolated}setSelection(e,t,n){this.selection.clear();let r=e=>{let t=this.selection.get(e);return t||this.selection.set(e,t={faces:[],segments:[],activeFace:-1,activeSegment:-1}),t};for(let n of t)e===E.Face&&r(n.object).faces.push(n.index),e===E.Body&&r(n.object).segments.push(n.index);n&&e===E.Face&&(r(n.object).activeFace=n.index),n&&e===E.Body&&(r(n.object).activeSegment=n.index),this.selectionVersion++}hiddenChanged(){this.hiddenVersion++}writeRigidFlags(e){let t=e.geo,n=Math.max(this.settings.flatEdgeAngle,0),r=`${this.selectionVersion}/${this.hiddenVersion}/${this.isolated}/${n}`;if(r===e.flagsKey)return;e.flagsKey=r;let i=this.selection.get(e.id),a=t.numSegments,o=new Uint32Array(2*a);for(let n=0;n<a;n++)o[2*n]=e.baseColors[n],o[2*n+1]=+!t.segmentVisible(n);for(let e of i?.segments??[])e<a&&(o[2*e+1]|=2);i&&i.activeSegment>=0&&i.activeSegment<a&&(o[2*i.activeSegment+1]|=4),this.device.queue.writeBuffer(e.segments,0,o);let s=t.flatMask(n),c=t.T,l=new Uint32Array(t.numFaces);for(let e=0;e<t.instances;e++)for(let t=0;t<c;t++)l[e*c+t]=s[t]<<2;for(let e of i?.faces??[])e<l.length&&(l[e]|=1);i&&i.activeFace>=0&&i.activeFace<l.length&&(l[i.activeFace]|=2),this.device.queue.writeBuffer(e.faceInfo,0,l)}setPoses(e,t){let n=e.geo.numSegments,r=e.poseScratch;for(let e=0;e<n;e++){for(let n=0;n<3;n++)r[8*e+n]=t.data[7*e+n];for(let n=0;n<4;n++)r[8*e+4+n]=t.data[7*e+3+n]}this.device.queue.writeBuffer(e.poses,0,r),e.geo.poses=Float32Array.from(t.data),e.poseVersion++}applyFrame(e){for(let[t,n]of Object.entries(e)){let e=this.objects.get(t);if(e){if(e.kind===`rigid`){if(n.poses&&this.setPoses(e,n.poses),n.segment_colors){let t=n.segment_colors.data;for(let n=0;n<e.baseColors.length;n++)e.baseColors[n]=Tt(t[3*n],t[3*n+1],t[3*n+2]);e.flagsKey=``}}else e.kind===`labels`?n.values&&(e.values=Float32Array.from(n.values.data)):(Object.assign(e.obj.arrays,n),this.rebuildDyn(e))}}}envOf(e,t){let n=this.rigidInfo();if(!n)return-1;let r=-1,i=1/0;for(let a=0;a<n.instances;a++){let o=(e-n.offsets[4*a])**2+(t-n.offsets[4*a+1])**2;o<i&&(i=o,r=a)}return r}rebuildDyn(e){let t=e.obj,n,r,i;if(t.kind===`boxes`)n=t.arrays.lo.data,r=t.arrays.hi.data,i=n.length/3;else{let a=t.arrays.points.data,o=t.arrays.radii?.data;i=a.length/3;let s=new Float32Array(a.length),c=new Float32Array(a.length);for(let e=0;e<i;e++)for(let n=0;n<3;n++){let r=o?o[e]:t.attrs.radius;s[3*e+n]=a[3*e+n]-r,c[3*e+n]=a[3*e+n]+r}n=s,r=c;let l=e.points;l.points=Float32Array.from(a),l.radii=o?Float32Array.from(o):null,l.defaultRadius=t.attrs.radius}let a=new Uint8Array(i);if(this.isolated>=0)for(let e=0;e<i;e++){let t=.5*(n[3*e]+r[3*e]),i=.5*(n[3*e+1]+r[3*e+1]);a[e]=this.envOf(t,i)===this.isolated?0:1}e.geo.set(n,r,a),e.points&&(e.points.hidden=a);let o=new Uint32Array(i*8),s=t.arrays.colors?.data,c=t.attrs.color;for(let e=0;e<i;e++)o.fill(s?Tt(s[3*e],s[3*e+1],s[3*e+2]):Tt(c[0],c[1],c[2]),8*e,8*e+8);let l=this.device;if(e.capacity<i||!e.pos){e.pos?.destroy(),e.color?.destroy(),e.tris?.destroy(),e.faceInfo?.destroy();let t=Math.max(4,i),n=e=>l.createBuffer({size:e,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});e.pos=n(t*96),e.color=n(t*32),e.tris=n(t*144),e.faceInfo=n(t*48),e.capacity=t,e.bind=l.createBindGroup({layout:this.layouts.dyn,entries:[e.params,e.pos,e.color,e.tris,e.faceInfo,e.segments].map((e,t)=>({binding:t,resource:{buffer:e}}))})}i&&(l.queue.writeBuffer(e.pos,0,e.geo.pos),l.queue.writeBuffer(e.color,0,o),l.queue.writeBuffer(e.tris,0,e.geo.tris)),e.faces=12*i,e.version++}writeDynFlags(e){let t=Math.max(this.settings.flatEdgeAngle,0),n=`${this.selectionVersion}/${this.hiddenVersion}/${e.version}/${t}`;if(n===e.flagsKey||!e.faceInfo)return;e.flagsKey=n;let r=this.selection.get(e.id),i=e.faces,a=new Uint32Array(Math.max(i,1)),o=e.points?null:e.geo.flatMask(t);for(let t=0;t<i;t++)a[t]=(o?o[t]<<2:0)|(e.geo.hidden[Math.floor(t/12)]?32:0);if(!e.points){for(let e of r?.faces??[])e<i&&(a[e]|=1);r&&r.activeFace>=0&&r.activeFace<i&&(a[r.activeFace]|=2)}this.device.queue.writeBuffer(e.faceInfo,0,a);let s=+!!e.geo.userHidden|(r?.segments.includes(0)?2:0)|(r?.activeSegment===0?4:0);this.device.queue.writeBuffer(e.segments,0,new Uint32Array([0,s,0,0]))}ensureTargets(){let e=window.devicePixelRatio||1,t=Math.max(1,Math.floor(this.canvas.clientWidth*e)),n=Math.max(1,Math.floor(this.canvas.clientHeight*e));if(t===this.size[0]&&n===this.size[1]&&this.t.resolved)return;this.canvas.width=t,this.canvas.height=n,this.size=[t,n];for(let e of Object.keys(this.t))e!==`shadow`&&this.t[e].destroy();let r=GPUTextureUsage.RENDER_ATTACHMENT,i=GPUTextureUsage.TEXTURE_BINDING,a=(e,r,i,a=1)=>this.t[e]=this.device.createTexture({size:[t,n],format:r,usage:i,sampleCount:a});a(`msaaColor`,F,r,P),a(`msaaDepth`,I,r,P),a(`resolved`,F,r|i),a(`oitAccumMsaa`,F,r,P),a(`oitRevealMsaa`,`r16float`,r,P),a(`accum`,F,r|i),a(`reveal`,`r16float`,r|i),a(`preDepth`,I,r|i),a(`preNormal`,F,r|i),a(`preIds`,`rgba32uint`,r|i|GPUTextureUsage.COPY_SRC),a(`aoRaw`,`r8unorm`,r|i),a(`ao`,`r8unorm`,r|i);let o=e=>this.t[e].createView(),s={buffer:this.frameBuf};this.groups.ssao=this.group(`ssao`,[[0,s],[1,o(`preDepth`)],[2,o(`preNormal`)]]),this.groups.blur=this.group(`blur`,[[0,s],[1,o(`preDepth`)],[3,o(`aoRaw`)]]),this.groups.composite=this.group(`composite`,[[0,s],[1,o(`resolved`)],[2,o(`preIds`)],[3,o(`preDepth`)],[4,o(`preNormal`)],[5,o(`accum`)],[6,o(`reveal`)]]),this.groups.lines=this.group(`lines`,[[0,s],[1,o(`preDepth`)]]),this.groups.text=this.group(`text`,[[0,s],[1,o(`preDepth`)],[2,this.fontView],[3,this.samplers.clamp]]),this.rebuildSceneGroup()}group(e,t){return this.device.createBindGroup({layout:this.layouts[e],entries:t.map(([e,t])=>({binding:e,resource:t}))})}rebuildSceneGroup(){this.t.ao&&(this.groups.scene=this.group(`scene`,[[0,{buffer:this.frameBuf}],[1,this.samplers.clamp],[2,this.dummy],[3,this.matcapTex.createView()],[4,this.env?.view??this.dummy],[5,this.shadowView],[6,this.samplers.shadow],[7,this.t.ao.createView()],[8,this.samplers.repeat]]))}ensureStyle(){let e=this.settings,t=!1;this.builtStyle!==e.style&&this.buildStylePipelines(e.style),e.style===`matcap`&&this.matcapBuilt!==e.matcap&&(this.device.queue.writeTexture({texture:this.matcapTex},lt(e.matcap,256),{bytesPerRow:1024},[256,256]),this.matcapBuilt=e.matcap),e.style===`pbr`&&this.envBuilt!==e.environment&&(this.env?.texture.destroy(),this.env=gt(this.device,mt(e.environment)),this.envBuilt=e.environment,t=!0),t&&this.rebuildSceneGroup()}rigidBounds=new WeakMap;boundsOf(e){let t=e.geo;if(!t.poses)return null;let n=`${e.poseVersion}/${this.isolated}/${this.hiddenVersion}`,r=this.rigidBounds.get(e);if(r?.key===n)return r;let i=[1/0,1/0,1/0],a=[-1/0,-1/0,-1/0];for(let e=0;e<t.numVertices;e++){if(!t.segmentVisible(t.segmentOfVertex(e)))continue;let n=t.vertex(e);for(let e=0;e<3;e++)n[e]<i[e]&&(i[e]=n[e]),n[e]>a[e]&&(a[e]=n[e])}let o={key:n,lo:i,hi:a};return this.rigidBounds.set(e,o),o}bounds(){let e=[1/0,1/0,1/0],t=[-1/0,-1/0,-1/0],n=(n,r=0)=>{for(let i=0;i<3;i++)e[i]=Math.min(e[i],n[r+i]),t[i]=Math.max(t[i],n[r+i])};for(let e of this.objects.values())if(e.kind===`rigid`){let t=this.boundsOf(e);t&&Number.isFinite(t.lo[0])&&(n(t.lo),n(t.hi))}else if(e.kind===`dyn`){let t=e.geo;if(!t.userHidden)for(let e=0;e<t.numVertices;e++)t.hidden[Math.floor(e/8)]||n(t.pos,3*e)}return Number.isFinite(e[0])?[e,t]:null}sliceEquation(){let e=this.settings.slice,t=[0,0,0];return t[e.axis]=e.flip?-1:1,[...t,e.flip?-e.offset:e.offset]}get wireMode(){return this.settings.shading===`wireframe`}writeFrame(){let[e,t]=this.size,n=this.settings,r=this.frame,i=this.camera,a=i.view(),o=i.proj(e/t),s=ue(o,a);r.set(a,N.view),r.set(o,N.proj),r.set(s,N.viewProj),r.set(de(s),N.invViewProj),r.set(de(o),N.invProj),r.set(de(a),N.invView);let c=i.eye();r.set([c[0],c[1],c[2],+!!i.ortho],N.cameraPos),r.set([e,t,1/e,1/t],N.viewport);let l=n.style===`pbr`&&this.env?this.env.sunDir:Ct,u=Math.hypot(...l),d=[l[0]/u,l[1]/u,l[2]/u],f=this.bounds()??[[...i.target],[...i.target]],p=f[0],m=f[1];p[2]=Math.min(p[2],0);let h=[(p[0]+m[0])/2,(p[1]+m[1])/2,(p[2]+m[2])/2],g=.5*Math.hypot(m[0]-p[0],m[1]-p[1],m[2]-p[2])*1.05+.05,_=Math.abs(d[2])>.99?[0,1,0]:[0,0,1],v=ce([h[0]+d[0]*2*g,h[1]+d[1]*2*g,h[2]+d[2]*2*g],h,_);r.set(ue(At(-g,g,-g,g,0,4*g),v),N.lightViewProj),r.set([d[0],d[1],d[2],n.shadowStrength],N.sunDir);let y=this.wireMode,b=Et(i);r.set(L(.235,.243,.259),N.bgTop),r.set(L(.114,.118,.129),N.bgBottom),r.set(L(.62,.64,.68,.2),N.gridMinor),r.set(L(.74,.76,.8,.42),N.gridMajor),r.set([b.offset,Math.max(i.distance*12,8),+!!n.grid,n.groundShadow&&!y?1:0],N.gridParams),r.set([b.normal,+!!b.background,b.u,b.v],N.gridPlane);let ee=[L(.92,.26,.34,.85),L(.52,.8,.2,.85),L(.24,.52,.96,.85)];r.set(ee[b.u],N.axisU),r.set(ee[b.v],N.axisV),y?r.set([...L(.7,.72,.76).slice(0,3),Math.max(n.wireWidth,1)],N.wire):r.set([...L(.05,.05,.06).slice(0,3),n.wireframe?n.wireWidth:0],N.wire),r.set([+!!y,n.faceOpacity,+!!n.wireObjectColors,0],N.wireMode),r.set(L(1,.63,.2),N.select),r.set(L(1,.88,.62),N.active),r.set(L(.02,.02,.025,.85),N.outline),r.set([n.ssao&&!y?n.aoStrength:0,n.exposure,n.shadows&&!y?1:0,y?0:n.outline],N.style);let x={studio:[n.studioSpecular,n.studioWrap,n.studioAmbient,0],matcap:[n.matcapTint,0,0,0],pbr:[0,0,0,0],technical:[n.goochShift,n.goochContrast,0,0]}[n.style];r.set(x,N.style2),r.set([n.envRotation*Math.PI/180,n.envIntensity,(this.env?.mips??1)-1,0],N.env),r.set([n.aoRadius,.02,1,0],N.ao),r.set([+(n.style===`pbr`),n.outlineWidth,0,0],N.post),r.set(this.sliceEquation(),N.slice),r.set(this.env?this.env.sh:new Float32Array(36),N.sh),this.device.queue.writeBuffer(this.frameBuf,0,r)}writeObjectParams(){let e=this.settings.slice.enabled;for(let[t,n]of this.objects){if(n.kind===`labels`)continue;let r=this.displayOf(t),i=e&&r.sliced?2:0,a=new ArrayBuffer(Ot),o=new Uint32Array(a),s=new Float32Array(a);n.kind===`rigid`?(o.set([n.geo.B,n.id,i,n.geo.T]),this.writeRigidFlags(n)):(o.set([n.id,i,0,0]),this.writeDynFlags(n)),s.set([r.metallic,r.roughness,Math.min(Math.max(r.opacity,0),1),0],4),this.device.queue.writeBuffer(n.params,0,a)}}transparent(e){return this.displayOf(e).opacity<.999}get viewport(){return[this.size[0]||1,this.size[1]||1]}view(){let e=this.camera;return{eye:e.eye(),forward:e.forward(),near:e.nearPlane(),fovy:e.fovy,height:this.size[1],ortho:e.ortho,viewHeight:e.viewHeight()}}sliceOverlay(){let e=this.settings.slice,t=e.enabled&&e.show?this.bounds():null;if(!t)return{lines:[],label:null};let[n,r]=t,i=e.axis,a=(i+1)%3,o=(i+2)%3;for(let e=0;e<3;e++){let t=.05*(r[e]-n[e])+.01;n[e]-=t,r[e]+=t}let s=[0,1,2,3].map(t=>{let s=[0,0,0];return s[i]=e.offset,s[a]=t===1||t===2?r[a]:n[a],s[o]=t>=2?r[o]:n[o],s}),c=[.4,.82,1,.9],l=[];for(let e=0;e<4;e++){let t=s[(e+1)%4];l.push(...s[e],1.5,...t,.3,...c,0,0,0,0)}return{lines:l,label:{text:`${`xyz`[i]} = ${Ze(e.offset,.001)}`,anchor:s[2],color:c,align:[0,0],offset:[6,-16],worldHeight:0,sizePx:12,halo:[.05,.05,.06,.75],hiddenAlpha:.5}}}glyphs(e){let t=[];for(let e of this.objects.values()){if(e.kind!==`labels`)continue;let n=e.obj.attrs,r=e.obj.arrays.anchors.data,i=r.length/3;for(let a=0;a<i;a++){let i=n.texts?String(n.texts[a]):e.values?Ke(n.fmt,e.values[a]):``;if(!i)continue;let o=[r[3*a],r[3*a+1],r[3*a+2]];this.isolated>=0&&this.envOf(o[0],o[1])!==this.isolated||t.push({text:i,anchor:o,color:n.color,align:n.align,worldHeight:n.world_height,sizePx:n.size_px})}}this.settings.grid&&t.push(...this.rulers()),t.push(...e);let n=[];return this.text.layout(t,this.view(),n),n}rulers(){let[e,t]=this.size,n=this.camera,r=Et(n),i=(e,t)=>{let n=[0,0,0];return n[r.normal]=r.offset,n[r.u]=e,n[r.v]=t,n},a=n.projector(e,t),o=r=>{let i=a(r);return(n.ortho||i[2]<0)&&i[0]>8&&i[1]>8&&i[0]<e-8&&i[1]<t-8?[i[0],i[1]]:null},s=n.target[r.u],c=n.target[r.v],l=Xe(n.pixelSizeAt(i(s,c),t)*90),u=[.05,.05,.06,.75],d=[[.98,.66,.7,1],[.74,.9,.56,1],[.62,.78,1,1]],f=[];for(let e=0;e<2;e++){let t=o(e===0?i(s,0):i(0,c))===null?Math.round((e===0?c:s)/l)*l:0,n=e===0?s:c,a=d[e===0?r.u:r.v],p=r.background&&e===1,m=[-1e9,-1e9];for(let r of[1,-1]){let s=m;for(let c=r>0?0:-1;Math.abs(c)<=12;c+=r){let r=(Math.round(n/l)+c)*l,d=e===0?i(r,t):i(t,r),h=o(d);if(h){if(Math.hypot(h[0]-s[0],h[1]-s[1])<44)break;s=h,c===0&&(m=h),!(Math.abs(r)<1e-9*l&&e===1)&&f.push({text:Ze(r,l),anchor:d,color:a,align:p?[0,.5]:[.5,0],offset:p?[8,0]:[0,6],worldHeight:0,sizePx:12,halo:u,hiddenAlpha:0})}}}}return f}drawGeometry(e,t){let n=t===`Wire`||t===`Pre`&&this.wireMode,r=t===`Transparent`;for(let[i,a]of this.objects)a.kind!==`labels`&&(n||this.transparent(i)===r)&&this.drawOne(e,a,t)}drawOne(e,t,n){t.kind===`rigid`?(e.setPipeline(this.pipes[`rigid${n}`]),e.setBindGroup(1,t.bind),e.draw(3*t.geo.T,t.geo.instances)):t.faces>0&&t.bind&&(e.setPipeline(this.pipes[`dyn${n}`]),e.setBindGroup(1,t.bind),e.draw(3*t.faces))}render(){this.ensureTargets(),this.ensureStyle(),this.writeFrame(),this.writeObjectParams();let e=this.settings,t=this.wireMode,n=this.sliceOverlay(),r=this.glyphs([...n.label?[n.label]:[],...this.overlay.labels]),i=r.length/24;i>this.glyphCap&&(this.glyphBuf=this.storageBuffer(`glyph`,Math.max(i,2*this.glyphCap))),i&&this.device.queue.writeBuffer(this.glyphBuf,0,new Float32Array(r));let a=[...n.lines,...this.overlay.lines],o=a.length/16;o>this.lineCap&&(this.lineBuf=this.storageBuffer(`line`,Math.max(o,2*this.lineCap))),o&&this.device.queue.writeBuffer(this.lineBuf,0,new Float32Array(a));let s=!t&&[...this.objects].some(([e,t])=>t.kind!==`labels`&&this.transparent(e)),c=e.grid||e.groundShadow,l=this.device,u=l.createCommandEncoder(),d=e=>this.t[e].createView(),f=(e,t,n)=>({view:e,resolveTarget:n,loadOp:`clear`,storeOp:n?`discard`:`store`,clearValue:{r:t[0],g:t[1],b:t[2],a:t[3]}}),p=(e,t)=>u.beginRenderPass({colorAttachments:[f(d(e),[t,t,t,1])]}).end(),m=u.beginRenderPass({colorAttachments:[],depthStencilAttachment:{view:this.shadowView,depthLoadOp:`clear`,depthStoreOp:`store`,depthClearValue:1}});if(e.shadows&&!t&&(m.setBindGroup(0,this.groups.frame),this.drawGeometry(m,`Shadow`)),m.end(),m=u.beginRenderPass({colorAttachments:[f(d(`preNormal`),[0,0,0,0]),f(d(`preIds`),[0,0,0,0])],depthStencilAttachment:{view:d(`preDepth`),depthLoadOp:`clear`,depthStoreOp:`store`,depthClearValue:0}}),m.setBindGroup(0,this.groups.scene),this.drawGeometry(m,`Pre`),c&&(m.setPipeline(this.pipes.gridPre),m.draw(3)),m.end(),e.ssao&&e.aoStrength>0&&!t)for(let[e,t]of[[`aoRaw`,`ssao`],[`ao`,`blur`]])m=u.beginRenderPass({colorAttachments:[f(d(e),[1,1,1,1])]}),m.setPipeline(this.pipes[t]),m.setBindGroup(0,this.groups[t]),m.draw(3),m.end();else p(`ao`,1);m=u.beginRenderPass({colorAttachments:[f(d(`msaaColor`),[0,0,0,0],d(`resolved`))],depthStencilAttachment:{view:d(`msaaDepth`),depthLoadOp:`clear`,depthStoreOp:s?`store`:`discard`,depthClearValue:0}}),m.setBindGroup(0,this.groups.scene),t?(c&&(m.setPipeline(this.pipes.gridMain),m.draw(3)),this.drawGeometry(m,`Wire`)):(this.drawGeometry(m,`Main`),c&&(m.setPipeline(this.pipes.gridMain),m.draw(3))),m.end(),s?(m=u.beginRenderPass({colorAttachments:[f(d(`oitAccumMsaa`),[0,0,0,0],d(`accum`)),f(d(`oitRevealMsaa`),[1,1,1,1],d(`reveal`))],depthStencilAttachment:{view:d(`msaaDepth`),depthLoadOp:`load`,depthStoreOp:`discard`}}),m.setBindGroup(0,this.groups.scene),this.drawGeometry(m,`Transparent`),m.end()):p(`reveal`,1),m=u.beginRenderPass({colorAttachments:[f(this.context.getCurrentTexture().createView(),[0,0,0,1])]}),m.setPipeline(this.pipes.composite),m.setBindGroup(0,this.groups.composite),m.draw(3),o&&(m.setPipeline(this.pipes.lines),m.setBindGroup(0,this.groups.lines),m.setBindGroup(1,this.lineGroup),m.draw(6,o)),i&&(m.setPipeline(this.pipes.text),m.setBindGroup(0,this.groups.text),m.setBindGroup(1,this.glyphGroup),m.draw(6,i)),m.end(),l.queue.submit([u.finish()])}async readIds(e,t,n,r){let i=Array.from({length:n*r},()=>({object:0,element:0,segment:0,flags:0})),[a,o]=this.size,s=Math.max(e,0),c=Math.max(t,0),l=Math.min(e+n,a),u=Math.min(t+r,o);if(l<=s||u<=c||!this.t.preIds)return i;let d=l-s,f=u-c,p=Math.ceil(d*16/256)*256,m=this.device.createBuffer({size:p*f,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),h=this.device.createCommandEncoder();h.copyTextureToBuffer({texture:this.t.preIds,origin:[s,c]},{buffer:m,bytesPerRow:p},[d,f]),this.device.queue.submit([h.finish()]),await m.mapAsync(GPUMapMode.READ);let g=new Uint32Array(m.getMappedRange());for(let r=0;r<f;r++)for(let a=0;a<d;a++){let o=r*p/4+4*a;i[(r+c-t)*n+(a+s-e)]={object:g[o],element:g[o+1],segment:g[o+2],flags:g[o+3]}}return m.unmap(),m.destroy(),i}geoById(e){if(e!==0&&e!==4294967295){for(let t of this.objects.values())if(t.kind!==`labels`&&t.id===e)return t.kind===`rigid`?t.geo:t.points??t.geo}}};function At(e,t,n,r,i,a){let o=new Float32Array(16);return o[0]=2/(t-e),o[5]=2/(r-n),o[10]=-1/(a-i),o[12]=-(t+e)/(t-e),o[13]=-(r+n)/(r-n),o[14]=-i/(a-i),o[15]=1,o}function jt(e){return e+3&-4}function Mt(e){if(e.kind===`rigid`)for(let t of e.buffers)t.destroy();else e.kind===`dyn`&&(e.pos?.destroy(),e.color?.destroy(),e.tris?.destroy(),e.faceInfo?.destroy(),e.params.destroy(),e.segments.destroy())}var Nt=[1,.63,.2,1],Pt=[1,.93,.75,1],Ft=[.05,.05,.05,1.5],It=[.05,.05,.06,.75],Lt=[1,.86,.35,1];function Rt(e){let t=e=>String(Number(e.toPrecision(4)));return e>=1?`${t(e)} m`:e>=.01?`${t(e*100)} cm`:`${t(e*1e3)} mm`}var zt=class{canvas;renderer;selection=new Ce;measurements=[];pending={anchors:[],angle:!1};measureTool=A.Off;xraySelect=!1;onDirty=()=>{};onSelection=()=>{};onIsolate=()=>{};onStatus=()=>{};onEscape=()=>!1;version=1;scene;navDrag=!1;lastMove=null;lmb=null;boxEl;sentSelection=0;constructor(e,t,n){this.canvas=e,this.renderer=t,this.boxEl=n,this.scene={find:e=>t.geoById(e),all:()=>t.geometries()},this.attach()}get camera(){return this.renderer.camera}dpr(){return this.canvas.width/Math.max(this.canvas.clientWidth,1)}px(e){let t=this.canvas.getBoundingClientRect(),n=this.dpr();return[(e.clientX-t.left)*n,(e.clientY-t.top)*n]}attach(){let e=this.canvas;e.addEventListener(`contextmenu`,e=>e.preventDefault()),e.addEventListener(`mousedown`,e=>{e.button===1&&e.preventDefault()}),e.addEventListener(`auxclick`,e=>e.preventDefault()),e.addEventListener(`pointerdown`,e=>this.buttons(e)),e.addEventListener(`pointermove`,e=>{e.button>=0&&this.buttons(e),this.move(e)}),e.addEventListener(`pointerup`,e=>this.buttons(e)),e.addEventListener(`pointercancel`,()=>{this.navDrag=!1,this.lmb=null,this.boxEl.hidden=!0}),e.addEventListener(`wheel`,e=>{e.preventDefault();let t=e.deltaMode===1?-e.deltaY/3:e.deltaMode===2?-e.deltaY:-e.deltaY/100;this.camera.dolly(t),this.onDirty()},{passive:!1}),e.addEventListener(`dblclick`,async e=>{if(e.altKey||e.ctrlKey||e.shiftKey||this.measureTool!==A.Off)return;let[t,n]=this.px(e),[r]=await this.renderer.readIds(Math.floor(t),Math.floor(n),1,1),i=this.scene.find(r.object);i instanceof T&&this.onIsolate(i.instanceOf(r.segment))}),window.addEventListener(`keydown`,e=>this.key(e))}buttons(e){let t=[1,4,2,8,16][e.button]??0;if(e.buttons&t){this.canvas.setPointerCapture(e.pointerId),this.lastMove=[e.clientX,e.clientY],!this.navDrag&&(e.button===1||e.altKey&&e.button===0)?(this.navDrag=!0,this.lmb=null,this.boxEl.hidden=!0):e.button===0&&!e.ctrlKey&&!e.altKey&&!this.navDrag&&(this.lmb={x:e.clientX,y:e.clientY,box:!1});return}if(!(e.buttons&4)&&!(e.altKey&&e.buttons&1)&&(this.navDrag=!1),e.button===0&&this.lmb){let t=this.lmb;this.lmb=null,this.boxEl.hidden=!0;let n=this.px({clientX:t.x,clientY:t.y}),r=this.px(e);t.box?this.handleBox(n,r,e.shiftKey):this.measureTool===A.Off?this.handleClick(r,e.shiftKey):this.handleMeasureClick(r)}}move(e){let t=this.lastMove;if(this.lastMove=[e.clientX,e.clientY],!t)return;let n=e.clientX-t[0],r=e.clientY-t[1],i=!!(e.buttons&4)||e.altKey&&!!(e.buttons&1);if(this.navDrag&&!i&&(this.navDrag=!1),this.navDrag&&(n||r)){e.shiftKey?this.camera.pan(n,r,this.canvas.clientHeight):e.ctrlKey?this.camera.dolly(-r*.05):this.camera.orbit(n,r),this.onDirty();return}let a=this.lmb;if(a&&e.buttons&1&&(!a.box&&this.measureTool===A.Off&&Math.hypot(e.clientX-a.x,e.clientY-a.y)>5&&(a.box=!0),a.box)){let t=this.canvas.getBoundingClientRect();Object.assign(this.boxEl.style,{left:`${Math.min(a.x,e.clientX)-t.left}px`,top:`${Math.min(a.y,e.clientY)-t.top}px`,width:`${Math.abs(e.clientX-a.x)}px`,height:`${Math.abs(e.clientY-a.y)}px`}),this.boxEl.hidden=!1}}async idWindow(e,t){let n=2*t+1;return this.renderer.readIds(Math.floor(e[0])-t,Math.floor(e[1])-t,n,n)}async handleClick(e,t){let n=await this.idWindow(e,6),r=Fe(this.scene,this.camera,this.selection.mode,n,e,this.renderer.viewport);r?t?this.selection.toggle(r):this.selection.set(r):t||this.selection.clear(),this.changed()}async handleBox(e,t,n){let r=this.renderer.viewport,i=[Math.max(Math.min(e[0],t[0]),0),Math.max(Math.min(e[1],t[1]),0)],a=[Math.min(Math.max(e[0],t[0]),r[0]-1),Math.min(Math.max(e[1],t[1]),r[1]-1)];if(a[0]<=i[0]||a[1]<=i[1])return;let o=this.xraySelect||this.renderer.settings.shading===`wireframe`,s=o?[]:await this.renderer.readIds(Math.floor(i[0]),Math.floor(i[1]),Math.floor(a[0]-i[0])+1,Math.floor(a[1]-i[1])+1);this.selection.add(Ie(this.scene,this.camera,this.selection.mode,s,i,a,r,o),n),this.changed()}async handleMeasureClick(e){let t=this.renderer.viewport,[n]=await this.renderer.readIds(Math.floor(e[0]),Math.floor(e[1]),1,1),r=Me(this.scene,n,this.camera.ray(e[0],e[1],t[0],t[1]),0);if(!r.valid)return;let i=r.surface,a=Fe(this.scene,this.camera,E.Vertex,await this.idWindow(e,8),e,t),o=a?this.scene.find(a.object):void 0;if(a&&o?.kind===`mesh`){let n=this.camera.project(o.vertex(a.index),t[0],t[1]);Math.hypot(n[0]-e[0],n[1]-e[1])<=12&&(i={kind:`vertex`,object:a.object,index:a.index,bary:[0,0,0],point:[0,0,0]})}this.pending.angle=this.measureTool===A.Angle,this.pending.anchors.push(i),this.pending.anchors.length>=(this.pending.angle?3:2)&&(this.measurements.push(this.pending),this.pending={anchors:[],angle:!1}),this.version++,this.onDirty()}changed(){this.selection.version!==this.sentSelection&&(this.sentSelection=this.selection.version,this.renderer.setSelection(this.selection.mode,this.selection.items,this.selection.active),this.onSelection()),this.version++,this.onDirty()}setMode(e){this.selection.setMode(e),this.changed()}setMeasureTool(e){e!==this.measureTool&&(this.pending={anchors:[],angle:!1}),this.measureTool=e,this.version++,this.onDirty()}selectSegments(e,t){this.selection.setMode(E.Body),this.selection.add(t.map(t=>({object:e,index:t})),!1),this.changed()}envOf(e){let t=this.scene.find(e.object);if(!t)return-1;if(t instanceof T){let n=D(t,this.selection.mode),r=n===`vertex`?t.V:n===`edge`?t.edges.edges.length/2:n===`face`?t.T:t.B;return Math.floor(e.index/r)}let n=Oe(this.scene,this.selection.mode,e);return this.renderer.envOf(n[0],n[1])}hiddenCount(){let e=0;for(let t of this.scene.all())if(t instanceof T)for(let n of t.userHidden)e+=n;else t.kind===`mesh`&&`userHidden`in t&&t.userHidden&&e++;return e}hideSelected(){if(this.selection.mode!==E.Body)return 0;let e=0;for(let t of this.selection.items){let n=this.scene.find(t.object);if(n instanceof T&&t.index<n.numSegments)n.userHidden[t.index]=1;else if(n?.kind===`mesh`&&`userHidden`in n)n.userHidden=!0;else continue;e++}return this.selection.clear(),this.renderer.hiddenChanged(),this.changed(),e}unhideAll(){let e=0;for(let t of this.scene.all())if(t instanceof T){for(let n of t.userHidden)e+=n;t.userHidden.fill(0)}else t.kind===`mesh`&&`userHidden`in t&&t.userHidden&&(t.userHidden=!1,e++);return this.renderer.hiddenChanged(),this.changed(),e}frameAll(){let e=this.renderer.bounds();e&&this.camera.frameBounds(e[0],e[1]),this.onDirty()}frameSelection(){if(this.selection.empty)return this.frameAll();let e=[1/0,1/0,1/0],t=[-1/0,-1/0,-1/0],n=n=>{for(let r=0;r<3;r++)e[r]=Math.min(e[r],n[r]),t[r]=Math.max(t[r],n[r])};for(let e of this.selection.items){n(Oe(this.scene,this.selection.mode,e));let t=this.scene.find(e.object);if(this.selection.mode===E.Body&&t?.kind===`mesh`){let r=Te(t,e.index);r&&(n(r[0]),n(r[1]))}}this.camera.frameBounds(e,t),this.onDirty()}key(e){let t=e.target;if(t&&(t.tagName===`INPUT`||t.tagName===`SELECT`||t.tagName===`TEXTAREA`||t.isContentEditable))return;let n=e.altKey,r=e.ctrlKey,i=e.shiftKey,a=this.camera,o=15*Math.PI/180,s=this.renderer.settings,c=!0;switch(e.code){case`Numpad1`:a.setView(r?`back`:`front`);break;case`Numpad3`:a.setView(r?`left`:`right`);break;case`Numpad7`:a.setView(r?`bottom`:`top`);break;case`Numpad5`:a.toggleOrtho();break;case`Numpad4`:a.animateTo(a.target,a.distance,a.yaw+o,a.pitch);break;case`Numpad6`:a.animateTo(a.target,a.distance,a.yaw-o,a.pitch);break;case`Numpad8`:a.animateTo(a.target,a.distance,a.yaw,Math.min(a.pitch+o,Math.PI/2));break;case`Numpad2`:a.animateTo(a.target,a.distance,a.yaw,Math.max(a.pitch-o,-Math.PI/2));break;case`NumpadDecimal`:case`KeyF`:r||n?c=!1:this.frameSelection();break;case`Home`:this.frameAll();break;case`Digit1`:case`Digit2`:case`Digit3`:case`Digit4`:r||n?c=!1:this.setMode(Number(e.code.slice(5))-1);break;case`KeyZ`:r?c=!1:n?this.xraySelect=!this.xraySelect:i?s.shading=s.shading===`wireframe`?`solid`:`wireframe`:s.wireframe=!s.wireframe;break;case`KeyM`:r||n?c=!1:this.setMeasureTool((this.measureTool+1)%3);break;case`KeyA`:n?(this.selection.clear(),this.changed()):c=!1;break;case`Escape`:this.pending.anchors.length?this.pending={anchors:[],angle:!1}:this.measureTool===A.Off?this.selection.empty?this.onEscape()||(c=!1):(this.selection.clear(),this.changed()):this.measureTool=A.Off;break;case`KeyH`:if(r)c=!1;else if(n){let e=this.unhideAll();this.onStatus(e?`Unhid ${e} bodies`:`No hidden bodies`)}else if(this.selection.mode!==E.Body)this.onStatus(`H hides bodies: switch to Body mode (4) first`);else{let e=this.hideSelected();this.onStatus(e?`Hid ${e} bodies (Alt+H or Unhide all brings them back)`:`Select bodies to hide`)}break;default:c=!1}c&&(e.preventDefault(),this.version++,this.onDirty())}update(e){let t=this.camera.update(e);return this.buildOverlays(),t}buildOverlays(){let e=[],t=[],n=(t,n,r,i,a,o=[0,0,0,0])=>e.push(...t,i,...n,a,...r,...o),r=(t,n,r,i,a=[0,0,0,1.5])=>e.push(...t,r,...t,i,...n,...a),i=this.selection,a=i.mode,o=i.active,s=this.renderer.settings.shading===`wireframe`;for(let e of i.items){let t=this.scene.find(e.object);if(!t)continue;let i=e===o,c=i?Pt:Nt,l=D(t,a);if(t.kind===`mesh`){if(l===`vertex`&&e.index<t.numVertices)r(t.vertex(e.index),c,i?10:8,.35,Ft);else if(l===`edge`&&e.index<t.numEdges){let[r,i]=t.edge(e.index);n(t.vertex(r),t.vertex(i),c,3,.35)}else if(l===`face`&&s&&e.index<t.numFaces){let r=t.face(e.index).map(e=>t.vertex(e));for(let e=0;e<3;e++)n(r[e],r[(e+1)%3],c,this.renderer.settings.wireWidth+1,1)}}else l!==`segment`&&r(Oe(this.scene,a,e),c,10,.4,Ft)}if(o){let e=this.scene.find(o.object);e&&t.push(this.activeLabel(e,o))}let c=(e,i)=>{let a=e.anchors.map(e=>ke(this.scene,e));for(let e of a)r(e,[1,1,1,1],8,.5,Ft);if(!i)return;let o={text:``,anchor:a[0],color:[1,.95,.8,1],align:[.5,1],offset:[0,-8],worldHeight:0,sizePx:14,halo:[.05,.05,.06,.85],hiddenAlpha:.7};if(!e.angle)n(a[0],a[1],Lt,2,.4),o.anchor=[(a[0][0]+a[1][0])/2,(a[0][1]+a[1][1])/2,(a[0][2]+a[1][2])/2],o.text=Rt(Math.hypot(a[1][0]-a[0][0],a[1][1]-a[0][1],a[1][2]-a[0][2]));else{n(a[1],a[0],Lt,2,.4),n(a[1],a[2],Lt,2,.4);let e=a[0].map((e,t)=>e-a[1][t]),t=a[2].map((e,t)=>e-a[1][t]),r=(e[0]*t[0]+e[1]*t[1]+e[2]*t[2])/(Math.hypot(...e)*Math.hypot(...t)||1);o.anchor=a[1],o.text=`${(Math.acos(Math.max(-1,Math.min(1,r)))*180/Math.PI).toFixed(2)}°`}t.push(o)};for(let e of this.measurements)c(e,!0);c(this.pending,!1),this.renderer.overlay={lines:e,labels:t}}activeLabel(e,t){let n=this.selection.mode,r=D(e,n),i;i=e.kind===`mesh`&&r===`segment`?e.segmentName(t.index):r===`segment`?e.name:e.kind===`points`?`#${t.index}`:`${{vertex:`v`,edge:`e`,face:`f`}[r]}${t.index}`;let a=Oe(this.scene,n,t);if(n===E.Body&&e.kind===`mesh`){let n=Te(e,t.index);n&&(a[2]=Math.max(a[2],n[1][2]))}return{text:i,anchor:a,sizePx:13,offset:[10,-22],color:Pt,align:[0,0],worldHeight:0,halo:It,hiddenAlpha:.6}}},R=e=>e.map(e=>Qe(e,4)).join(`, `),Bt=e=>Qe(e,6),Vt=class{ix;modeBtns=[];xray;hideRow;hideBtn;unhideBtn;tools=[];table;actions;list;rowsKey=``;listKey=``;copyText=``;shown=-1;constructor(e,t){this.ix=t;let n=(e,t={},...n)=>{let r=Object.assign(document.createElement(e),t);return r.append(...n),r},r=n(`div`,{className:`i-modes`});r.setAttribute(`role`,`group`),r.setAttribute(`aria-label`,`Pick mode`),Se.forEach((e,i)=>{let a=n(`button`,{textContent:e,title:`${e} mode (${i+1})`});a.addEventListener(`click`,()=>t.setMode(i)),this.modeBtns.push(a),r.append(a)}),this.xray=n(`input`,{type:`checkbox`}),this.xray.addEventListener(`change`,()=>{t.xraySelect=this.xray.checked,t.version++}),this.hideBtn=n(`button`,{textContent:`Hide selected (H)`}),this.hideBtn.addEventListener(`click`,()=>t.hideSelected()),this.unhideBtn=n(`button`,{textContent:`Unhide all (Alt+H)`}),this.unhideBtn.addEventListener(`click`,()=>t.unhideAll()),this.hideRow=n(`div`,{className:`i-row`},this.hideBtn,this.unhideBtn);let i=n(`div`,{className:`i-row`},`Measure (M)`);i.setAttribute(`role`,`radiogroup`),[`Off`,`Distance`,`Angle`].forEach((e,r)=>{let a=n(`input`,{type:`radio`,name:`i-measure`});a.addEventListener(`change`,()=>t.setMeasureTool(r)),this.tools.push(a),i.append(n(`label`,{},a,e))}),this.table=n(`div`,{className:`i-table`});let a=n(`button`,{textContent:`Copy`});a.addEventListener(`click`,()=>void navigator.clipboard?.writeText(this.copyText));let o=n(`button`,{textContent:`Clear selection`});o.addEventListener(`click`,()=>{t.selection.clear(),t.changed()}),this.actions=n(`div`,{className:`i-row`},a,o),this.list=n(`div`,{className:`i-list`}),this.list.addEventListener(`click`,e=>{let n=e.target.closest(`button`);n&&(n.dataset.remove?t.measurements.splice(Number(n.dataset.remove),1):t.measurements.length=0,t.version++,t.onDirty())}),e.append(r,n(`label`,{className:`d-check`},this.xray,`X-ray select (Alt+Z)`),this.hideRow,i,n(`hr`),this.table,this.actions,this.list)}update(e){let t=this.ix;if(this.shown===t.version&&e-this.lastValues<200)return;this.lastValues=e,this.shown=t.version;let n=t.selection,r=n.mode;this.modeBtns.forEach((e,t)=>{e.classList.toggle(`on`,t===r),e.setAttribute(`aria-pressed`,String(t===r))}),this.xray.checked=t.xraySelect;let i=t.hiddenCount();this.hideRow.hidden=!(r===E.Body||i),this.hideBtn.disabled=r!==E.Body||n.empty,this.unhideBtn.disabled=i===0,this.unhideBtn.textContent=`Unhide all (Alt+H)${i?`  [${i}]`:``}`,this.tools.forEach((e,n)=>e.checked=n===t.measureTool),this.setRows(this.rows()),this.actions.hidden=n.empty,this.setList()}lastValues=0;rows(){let e=this.ix,t=e.selection,n=t.mode,r=e.scene,i=t.items;if(!i.length)return[];if(i.length>1){let e=[1/0,1/0,1/0],t=[-1/0,-1/0,-1/0],a=[0,0,0];for(let o of i){let i=Oe(r,n,o);for(let n=0;n<3;n++)e[n]=Math.min(e[n],i[n]),t[n]=Math.max(t[n],i[n]),a[n]+=i[n]}return[[`Selected`,`${i.length} ${Se[n]}`],[`Centroid`,R(a.map(e=>e/i.length))],[`Extent`,R([t[0]-e[0],t[1]-e[1],t[2]-e[2]])]]}let a=i[0],o=r.find(a.object),s=[[`Object`,o?.name??`?`]];if(!o)return s;if(o.kind===`points`){if(D(o,n)===`segment`){s.push([`Points`,String(o.count)]);let e=[0,1,2].map(e=>{let t=1/0,n=-1/0;for(let r=0;r<o.count;r++)t=Math.min(t,o.point(r)[e]-o.radius(r)),n=Math.max(n,o.point(r)[e]+o.radius(r));return[t,n]});o.count&&(s.push([`Size`,R(e.map(([e,t])=>t-e))]),s.push([`Bounds center`,R(e.map(([e,t])=>(e+t)/2))]))}else a.index<o.count&&s.push([`Point`,String(a.index)],[`Position`,R(o.point(a.index))],[`Radius`,Qe(o.radius(a.index),4)]);return s}let c=0,l=(e,t)=>[e[0]-t[0],e[1]-t[1],e[2]-t[2]],u=e=>{let t=Math.hypot(...e)||1;return[e[0]/t,e[1]/t,e[2]/t]};switch(n){case E.Vertex:s.push([`Vertex`,String(a.index)],[`Position`,R(o.vertex(a.index))]),c=o.segmentOfVertex(a.index);break;case E.Edge:{let[e,t]=o.edge(a.index),n=o.vertex(e),r=o.vertex(t),i=l(r,n);s.push([`Edge`,String(a.index)],[`Vertices`,`${e}, ${t}`],[`Length`,Bt(Math.hypot(...i))],[`Direction`,R(u(i))],[`Midpoint`,R([(n[0]+r[0])/2,(n[1]+r[1])/2,(n[2]+r[2])/2])]),c=o.segmentOfVertex(e);break}case E.Face:{let e=o.face(a.index),[t,n,r]=e.map(e=>o.vertex(e)),i=l(n,t),d=l(r,t),f=[i[1]*d[2]-i[2]*d[1],i[2]*d[0]-i[0]*d[2],i[0]*d[1]-i[1]*d[0]];s.push([`Face`,String(a.index)],[`Vertices`,e.join(`, `)],[`Area`,Bt(.5*Math.hypot(...f))],[`Normal`,R(u(f))],[`Centroid`,R([0,1,2].map(e=>(t[e]+n[e]+r[e])/3))]),c=o.segmentOfFace(a.index);break}default:c=a.index}s.push([o.segmentName(c)]);let d=Te(o,c);if(n===E.Body){let[e,t]=o.segmentFaces(c),n=new Set;for(let r=e;r<t;r++)for(let e of o.face(r))n.add(e);s.push([`Faces`,String(t-e)],[`Vertices`,String(n.size)]),d&&s.push([`Size`,R(l(d[1],d[0]))])}return d&&s.push([`Bounds center`,R([0,1,2].map(e=>(d[0][e]+d[1][e])/2))]),s}setRows(e){this.copyText=e.map(e=>e.length===1?`[${e[0]}]`:`${e[0]}\t${e[1]}`).join(`
`)+`
`;let t=e.map(e=>e[0]).join(`
`);if(!e.length){this.rowsKey!==``&&(this.rowsKey=``,this.table.innerHTML=``),this.table.firstChild||(this.table.innerHTML=`<div class="empty">Click to select, Shift+click to add,<br>drag to box-select. Keys 1-4 switch mode.</div>`);return}if(t!==this.rowsKey){this.rowsKey=t;let n=document.createElement(`table`);for(let t of e){let e=n.insertRow();if(t.length===1){e.className=`i-section`;let n=e.insertCell();n.colSpan=2,n.textContent=t[0]}else e.insertCell().textContent=t[0],e.insertCell().className=`mono`}this.table.replaceChildren(n)}let n=this.table.querySelectorAll(`td.mono`),r=0;for(let t of e)t.length===2&&(n[r++].textContent=t[1])}setList(){let e=this.ix,t=e.measurements,n=t.map(e=>e.angle?`a`:`d`).join(``);n!==this.listKey&&(this.listKey=n,this.list.innerHTML=t.length?`<h3>Measurements</h3>`+t.map((e,t)=>`<div class="i-meas"><button data-remove="${t}" aria-label="Remove measurement ${t+1}">x</button><span class="mono"></span></div>`).join(``)+`<button class="i-clear">Clear all</button>`:``);let r=this.list.querySelectorAll(`.i-meas`);t.forEach((t,n)=>{let{value:i,delta:a}=Re(e.scene,t),o=r[n]?.querySelector(`span`);o&&(o.textContent=t.angle?`${n+1}  ${i.toFixed(3)} deg`:`${n+1}  ${Qe(i,5)} m   d=(${a.map(e=>Qe(e,3)).join(`, `)})`,o.parentElement.title=t.anchors.map(t=>ze(e.scene,t)).join(` → `))})}},Ht=46,Ut=[{axis:[1,0,0],color:`237,74,92`,label:`X`,preset:`right`},{axis:[0,1,0],color:`138,210,52`,label:`Y`,preset:`back`},{axis:[0,0,1],color:`69,140,243`,label:`Z`,preset:`top`},{axis:[-1,0,0],color:`237,74,92`,label:null,preset:`left`},{axis:[0,-1,0],color:`138,210,52`,label:null,preset:`front`},{axis:[0,0,-1],color:`69,140,243`,label:null,preset:`bottom`}];function Wt(e){let t=.001,n=Math.PI,r=``;if(Math.abs(e.pitch-.5*n)<t)r=`Top`;else if(Math.abs(e.pitch+.5*n)<t)r=`Bottom`;else if(Math.abs(e.pitch)<t){let i=e.yaw-2*n*Math.round(e.yaw/(2*n));Math.abs(i+.5*n)<t?r=`Front`:Math.abs(i-.5*n)<t?r=`Back`:Math.abs(i)<t?r=`Right`:Math.abs(Math.abs(i)-n)<t&&(r=`Left`)}return(r||`User`)+(e.ortho?` Orthographic`:` Perspective`)}var Gt=class{renderer;ix;onChange;gizmo;projBtn;shadeBtn;hot=-1;drag=null;text;bar;renders=[];last=``;constructor(e,t,n,r,i,a){this.renderer=r,this.ix=i,this.onChange=a,this.text=t,this.bar=n,this.gizmo=Object.assign(document.createElement(`canvas`),{className:`gizmo`}),this.gizmo.style.width=this.gizmo.style.height=`112px`,this.gizmo.setAttribute(`role`,`img`),this.gizmo.setAttribute(`aria-label`,`View axes: click an axis to look along it, drag to orbit`),this.projBtn=Object.assign(document.createElement(`button`),{title:`Perspective / orthographic (Numpad 5)`}),this.shadeBtn=Object.assign(document.createElement(`button`),{title:`Shading: Solid / Wireframe (Shift+Z)`}),this.projBtn.addEventListener(`click`,()=>{r.camera.toggleOrtho(),this.changed()}),this.shadeBtn.addEventListener(`click`,()=>{let e=r.settings;e.shading=e.shading===`wireframe`?`solid`:`wireframe`,this.changed()});let o=document.createElement(`div`);o.className=`gizmo-btns`,o.append(this.projBtn,this.shadeBtn),e.append(this.gizmo,o),this.attach()}changed(){this.ix.version++,this.onChange()}balls(){let e=this.renderer.camera,t=e.right(),n=e.up(),r=e.forward(),i=(e,t)=>e[0]*t[0]+e[1]*t[1]+e[2]*t[2];return Ut.map(e=>({...e,x:56+i(e.axis,t)*Ht*.78,y:56-i(e.axis,n)*Ht*.78,depth:-i(e.axis,r)})).sort((e,t)=>e.depth-t.depth)}hit(e){let t=this.gizmo.getBoundingClientRect(),n=e.clientX-t.left,r=e.clientY-t.top,i=11,a=-1;return this.balls().forEach((e,t)=>{let o=Math.hypot(n-e.x,r-e.y);o<i&&(i=o,a=t)}),a}attach(){let e=this.gizmo;e.addEventListener(`pointermove`,e=>{if(this.drag&&e.buttons&1){let t=e.clientX-this.drag.x,n=e.clientY-this.drag.y;(this.drag.moved||Math.hypot(t,n)>2)&&(this.drag.moved=!0,this.renderer.camera.orbit(t,n),this.drag.x=e.clientX,this.drag.y=e.clientY,this.changed());return}let t=this.hit(e);t!==this.hot&&(this.hot=t,this.draw(!0))}),e.addEventListener(`pointerleave`,()=>{this.drag||(this.hot=-1,this.draw(!0))}),e.addEventListener(`pointerdown`,t=>{t.button===0&&(e.setPointerCapture(t.pointerId),this.drag={x:t.clientX,y:t.clientY,moved:!1})}),e.addEventListener(`pointerup`,e=>{let t=this.drag;if(this.drag=null,!t||t.moved||e.button!==0)return;let n=this.hit(e);n>=0&&(this.renderer.camera.setView(this.balls()[n].preset),this.changed())})}rendered(e){this.renders.push(e)}update(e){for(;this.renders.length&&this.renders[0]<e-1e3;)this.renders.shift();let t=this.renders.length,n=t&&e-this.renders[t-1]<500?`${t} fps`:`idle`;this.draw(!1);let r=this.renderer.camera,i=this.renderer.settings,[,a]=this.renderer.viewport,o=window.devicePixelRatio||1,s=Et(r),c=[r.target[0],r.target[1],r.target[2]];c[s.normal]=s.offset;let l=r.pixelSizeAt(c,a),u=10**Math.ceil(Math.log10(l*7)),d=this.ix.measureTool===A.Distance?`Measure distance: click two points (snaps to vertices)`:this.ix.measureTool===A.Angle?`Measure angle: click three points, the middle is the apex`:``,f=[Wt(r)+(i.shading===`wireframe`?`  ·  Wireframe`:``),`Grid ${Ze(u,u)}   ${n}`],p=f.join(`|`)+d;p!==this.last&&(this.last=p,this.text.innerHTML=`<div>${f[0]}</div><div class="muted">${f[1]}</div>`+(d?`<div class="hint">${d}</div>`:``));let m=l*o,h=Xe(m*110);this.bar.style.width=`${h/m}px`,this.bar.dataset.label=Ze(h,h),this.projBtn.textContent=r.ortho?`Ortho`:`Persp`,this.shadeBtn.textContent=i.shading===`wireframe`?`Wire`:`Solid`}drawn=``;draw(e){let t=this.renderer.camera,n=`${t.yaw},${t.pitch},${this.hot}`;if(!e&&n===this.drawn)return;this.drawn=n;let r=window.devicePixelRatio||1,i=this.gizmo;i.width!==Math.round(112*r)&&(i.width=i.height=Math.round(112*r));let a=i.getContext(`2d`);a.setTransform(r,0,0,r,0,0),a.clearRect(0,0,112,112),(this.hot>=0||this.drag)&&(a.fillStyle=`rgba(255,255,255,0.11)`,a.beginPath(),a.arc(56,56,52,0,2*Math.PI),a.fill()),a.font=`600 12px system-ui, sans-serif`,a.textAlign=`center`,a.textBaseline=`middle`,this.balls().forEach((e,t)=>{e.label?(a.strokeStyle=`rgb(${e.color})`,a.lineWidth=2,a.beginPath(),a.moveTo(56,56),a.lineTo(e.x,e.y),a.stroke(),a.fillStyle=`rgb(${e.color})`,a.beginPath(),a.arc(e.x,e.y,9,0,2*Math.PI),a.fill(),a.fillStyle=`rgb(20,20,20)`,a.fillText(e.label,e.x,e.y+.5)):(a.fillStyle=`rgba(${e.color},0.27)`,a.strokeStyle=`rgb(${e.color})`,a.lineWidth=1.5,a.beginPath(),a.arc(e.x,e.y,7.5,0,2*Math.PI),a.fill(),a.stroke()),t===this.hot&&(a.strokeStyle=`rgba(255,255,255,0.9)`,a.lineWidth=1.5,a.beginPath(),a.arc(e.x,e.y,10.5,0,2*Math.PI),a.stroke())})}},Kt=[.1,.25,.5,1,2,4],qt=(e,t)=>getComputedStyle(e).getPropertyValue(t).trim(),Jt=class{root;modeBtns;outer;outerRow;inner;plot;timeEl;playBtn;speedSel;chanSel;evals=[];mode=`live`;replay=null;selectedEval=null;t=0;playing=!1;speed=1;focus=-1;onMode=()=>{};onPickEval=()=>{};onSeek=()=>{};constructor(e){this.root=e,e.innerHTML=`
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
            ${Kt.map(e=>`<option value="${e}"${e===1?` selected`:``}>${e}×</option>`).join(``)}
          </select>
          <span class="time"></span>
          <select class="chan" title="Channel plotted under the scrubber"></select>
        </div>
        <canvas class="plot" aria-label="Episode scrubber"></canvas>
      </div>`;let t=t=>e.querySelector(t);this.modeBtns={live:t(`[data-mode=live]`),ring:t(`[data-mode=ring]`),eval:t(`[data-mode=eval]`)};for(let[e,t]of Object.entries(this.modeBtns))t.addEventListener(`click`,()=>this.onMode(e));this.outerRow=t(`.outer-wrap`),this.outer=t(`.outer`),this.inner=t(`.inner`),this.plot=t(`.plot`),this.timeEl=t(`.time`),this.playBtn=t(`.b-play`),this.speedSel=t(`.speed`),this.chanSel=t(`.chan`),this.playBtn.addEventListener(`click`,()=>this.togglePlay()),t(`.b-start`).addEventListener(`click`,()=>this.seek(0)),t(`.b-pback`).addEventListener(`click`,()=>this.step(-1,!1)),t(`.b-pfwd`).addEventListener(`click`,()=>this.step(1,!1)),t(`.b-cback`).addEventListener(`click`,()=>this.step(-1,!0)),t(`.b-cfwd`).addEventListener(`click`,()=>this.step(1,!0)),this.speedSel.addEventListener(`change`,()=>this.speed=Number(this.speedSel.value)),this.chanSel.addEventListener(`change`,()=>this.drawPlot()),this.outer.addEventListener(`click`,e=>{let t=e.target.closest(`[data-id]`);t&&this.onPickEval(t.dataset.id)});let n=!1,r=e=>{if(!this.replay)return;let t=this.plot.getBoundingClientRect(),n=Math.max(0,Math.min(1,(e.clientX-t.left)/t.width));this.seek(n*this.replay.duration)};this.plot.addEventListener(`pointerdown`,e=>{n=!0,this.plot.setPointerCapture(e.pointerId),this.playing=!1,r(e)}),this.plot.addEventListener(`pointermove`,e=>n&&r(e)),this.plot.addEventListener(`pointerup`,()=>n=!1),new ResizeObserver(()=>this.drawPlot()).observe(this.plot),window.addEventListener(`keydown`,e=>{if(this.mode!==`live`&&this.replay&&!e.target.closest(`select, input`)){if(e.key===` `)this.togglePlay();else if(e.key===`ArrowLeft`)this.step(-1,e.shiftKey);else if(e.key===`ArrowRight`)this.step(1,e.shiftKey);else if(e.key===`Home`)this.seek(0);else if(e.key===`End`)this.seek(this.replay.duration);else if(e.key===`[`||e.key===`]`)this.pickNeighbor(e.key===`]`?1:-1);else return;e.preventDefault()}}),this.render()}setAvailable(e,t,n){this.modeBtns.live.disabled=!e,this.modeBtns.ring.disabled=!t,this.modeBtns.eval.disabled=!n}setMode(e){this.mode=e,this.playing=!1,this.render()}setEvals(e){this.evals=[...e].sort((e,t)=>(e.timestep??0)-(t.timestep??0)),this.renderOuter()}get evalList(){return this.evals}setReplay(e){this.replay=e,this.t=0,this.playing=!1;let t=this.chanSel.value,n=e?e.perEnvChannels():[];this.chanSel.innerHTML=n.map(e=>`<option>${e}</option>`).join(``);let r=n.includes(t)?t:n.includes(`flux`)?`flux`:n[0];r&&(this.chanSel.value=r),this.render()}pickNeighbor(e){if(this.mode!==`eval`||!this.evals.length)return;let t=this.evals.findIndex(e=>e.id===this.selectedEval),n=Math.max(0,Math.min(this.evals.length-1,(t<0?this.evals.length:t)+e));this.onPickEval(this.evals[n].id)}togglePlay(){this.replay&&(!this.playing&&this.t>=this.replay.duration&&(this.t=0),this.playing=!this.playing,this.render())}step(e,t){if(!this.replay)return;this.playing=!1;let n=t?this.replay.ctrlTicks:this.replay.physTicks,r=Math.round(this.t/n);this.seek((r+e)*n)}seek(e){this.replay&&(this.t=Math.max(0,Math.min(this.replay.duration,e)),this.render(),this.onSeek())}advance(e){let t=this.replay;if(!t||!this.playing)return!1;let n=e*this.speed/(t.msg.tick_seconds||.01),r=Math.min(t.duration,t.loadedUntil);return this.t=Math.min(r,this.t+n),this.t>=t.duration&&(this.playing=!1),this.render(),!0}render(){for(let[e,t]of Object.entries(this.modeBtns))t.classList.toggle(`on`,e===this.mode),t.setAttribute(`aria-selected`,String(e===this.mode));this.outerRow.style.visibility=this.mode===`eval`?`visible`:`hidden`,this.inner.style.display=this.mode===`live`?`none`:``,this.playBtn.textContent=this.playing?`⏸`:`▶`;let e=this.replay;if(e){let t=this.t*e.msg.tick_seconds,n=e.duration*e.msg.tick_seconds,r=Math.floor(this.t/e.ctrlTicks+1e-6),i=Math.floor(this.t/e.physTicks+1e-6),a=Math.round(e.duration/e.ctrlTicks),o=e.chunksDone<e.chunksTotal?` · loading ${Math.round(100*e.chunksDone/e.chunksTotal)}%`:``;this.timeEl.textContent=`${t.toFixed(3)} / ${n.toFixed(2)} s · control ${r}/${a} · physics ${i}${o}`}else this.timeEl.textContent=this.mode===`live`?``:`loading…`;this.drawPlot()}renderOuter(){let e=this.evals;if(!e.length){this.outer.innerHTML=`<span class="empty">no saved evals yet</span>`;return}let t=Math.max(...e.map(e=>e.timestep??0),1);this.outer.innerHTML=e.map((n,r)=>{let i=e.length===1?100:100*((n.timestep??r)-0)/(t-0),a=n.summary??{},o=0,c=[],l=s.reduce((e,[t])=>e+(a[t]??0),0)||1;for(let[e,t]of s){let n=(a[e]??0)/l;n<=0||(c.push(`<i style="bottom:${(100*o).toFixed(1)}%;height:${(100*n).toFixed(1)}%;background:${t}"></i>`),o+=n)}let u=[`t=${n.timestep??`?`}`,...s.filter(([e])=>a[e]!==void 0).map(([e])=>`${e} ${(a[e]*100).toFixed(0)}%`)].join(` · `);return`<button class="tick${n.id===this.selectedEval?` sel`:``}" data-id="${n.id}" style="left:${i.toFixed(2)}%" title="${u}" aria-label="${u}">${c.join(``)}</button>`}).join(``)}selectEval(e){this.selectedEval=e,this.renderOuter()}drawPlot(){let e=this.plot,t=window.devicePixelRatio||1,n=Math.max(1,Math.floor(e.clientWidth*t)),r=Math.max(1,Math.floor(e.clientHeight*t));(e.width!==n||e.height!==r)&&(e.width=n,e.height=r);let i=e.getContext(`2d`);i.clearRect(0,0,n,r);let a=this.replay;if(!a||this.mode===`live`)return;let o=e=>e/Math.max(1,a.duration)*n;i.fillStyle=`rgba(255,255,255,0.04)`,i.fillRect(0,0,o(a.loadedUntil),r);let s=this.chanSel.value,c=s?a.channel(s):null,l=s?a.channelTimes(s):null;if(c&&l){let e=c.shape[1],n=1/0,u=-1/0;for(let e=0;e<c.data.length;e++){let t=c.data[e];Number.isFinite(t)&&(n=Math.min(n,t),u=Math.max(u,t))}u>n||(u=n+1);let d=4*t,f=e=>r-d-(e-n)/(u-n)*(r-2*d),p=(t,n,r)=>{i.strokeStyle=n,i.lineWidth=r,i.beginPath();let s=a.endStep[t]??a.duration,u=!1;for(let n=0;n<l.length&&!(l[n]>s);n++){let r=o(l[n]),a=f(c.data[n*e+t]);u?i.lineTo(r,a):(i.moveTo(r,a),u=!0)}i.stroke()};for(let n=0;n<e;n++)n!==this.focus&&p(n,`rgba(154,160,168,0.35)`,t);this.focus>=0&&this.focus<e&&p(this.focus,qt(this.root,`--accent`)||`#4d8fd6`,2*t),i.fillStyle=qt(this.root,`--muted`)||`#9aa0a8`,i.font=`${10*t}px system-ui, sans-serif`,i.fillText(`${s}  ${Yt(u)}`,4*t,11*t),i.fillText(Yt(n),4*t,r-3*t)}i.fillStyle=`rgba(224,90,79,0.8)`;for(let e of a.endStep)e<a.duration&&i.fillRect(o(e)-t/2,r-5*t,t,5*t);i.fillStyle=`#e4e6ea`,i.fillRect(o(this.t)-t,0,2*t,r)}};function Yt(e){let t=Math.abs(e);return t!==0&&(t<.001||t>=1e4)?e.toExponential(1):e.toFixed(t>=10?1:3)}var Xt=`avbd-viz.display.v1`,Zt=class{renderer;root;onChange=()=>{};constructor(e,t){this.renderer=t,this.root=e,this.load(),e.addEventListener(`input`,()=>this.changed()),e.addEventListener(`change`,()=>this.changed()),this.build()}get open(){return!this.root.hidden}toggle(e=!this.open){this.root.hidden=!e,e&&this.build()}sceneChanged(){this.open&&this.build()}load(){try{let e=JSON.parse(localStorage.getItem(Xt)??`null`);if(e?.settings){let t=bt();Object.assign(t,e.settings,{slice:{...t.slice,...e.settings.slice}}),this.renderer.settings=t}for(let[t,n]of Object.entries(e?.objects??{}))Object.assign(this.renderer.displayOf(t),n)}catch{}}save(){try{localStorage.setItem(Xt,JSON.stringify({settings:this.renderer.settings,objects:Object.fromEntries(this.renderer.display)}))}catch{}}changed(){this.save(),this.onChange()}slider(e,t,n,r,i,a=e=>e.toFixed(2)){let o=document.createElement(`label`);o.className=`d-row`;let s=document.createElement(`output`),c=Object.assign(document.createElement(`input`),{type:`range`,min:String(r),max:String(i),step:String((i-r)/200),value:String(t())});return s.textContent=a(t()),c.addEventListener(`input`,()=>{n(Number(c.value)),s.textContent=a(t())}),o.append(Object.assign(document.createElement(`span`),{textContent:e}),c,s),o}check(e,t,n,r=!1){let i=document.createElement(`label`);i.className=`d-check`;let a=Object.assign(document.createElement(`input`),{type:`checkbox`,checked:t()});return a.addEventListener(`change`,()=>{n(a.checked),r&&this.build()}),i.append(a,document.createTextNode(e)),i}select(e,t,n,r,i=!1){let a=document.createElement(`label`);a.className=`d-row`;let o=document.createElement(`select`);return o.innerHTML=t.map((e,t)=>`<option value="${t}">${e}</option>`).join(``),o.value=String(n()),o.addEventListener(`change`,()=>{r(Number(o.value)),i&&this.build()}),a.append(Object.assign(document.createElement(`span`),{textContent:e}),o),a}buttons(e,t,n,r){let i=document.createElement(`div`);return i.className=`d-buttons`,i.setAttribute(`role`,`group`),i.setAttribute(`aria-label`,r),e.forEach((e,r)=>{let a=Object.assign(document.createElement(`button`),{textContent:e});a.classList.toggle(`on`,t()===r),a.setAttribute(`aria-pressed`,String(t()===r)),a.addEventListener(`click`,()=>{n(r),this.build()}),i.append(a)}),i}radios(e,t,n,r){let i=document.createElement(`div`);i.className=`d-radios`,i.setAttribute(`role`,`radiogroup`),i.setAttribute(`aria-label`,e),i.append(Object.assign(document.createElement(`span`),{textContent:e}));let a=`d-${e.replace(/\W/g,``)}`;return t.forEach((e,t)=>{let o=document.createElement(`label`),s=Object.assign(document.createElement(`input`),{type:`radio`,name:a,checked:n()===t});s.addEventListener(`change`,()=>r(t)),o.append(s,document.createTextNode(e)),i.append(o)}),i}wireRows(e){return[this.slider(`Wire width`,()=>e.wireWidth,t=>e.wireWidth=t,.5,3,e=>`${e.toFixed(1)} px`),this.slider(`Hide flat edges`,()=>e.flatEdgeAngle,t=>e.flatEdgeAngle=t,0,30,e=>e>0?`< ${e.toFixed(1)} deg`:`off`)]}builtShading=``;sync(){let e=this.renderer.settings;this.open&&`${e.shading}/${e.wireframe}`!==this.builtShading&&this.build()}heading(e){return Object.assign(document.createElement(`h3`),{textContent:e})}build(){let e=this.renderer.settings;this.builtShading=`${e.shading}/${e.wireframe}`;let t=[];t.push(this.buttons([`Solid`,`Wireframe`],()=>+(e.shading===`wireframe`),t=>e.shading=t?`wireframe`:`solid`,`Shading`)),e.shading===`wireframe`?(t.push(this.radios(`Wire color`,[`Theme`,`Object`],()=>+!!e.wireObjectColors,t=>e.wireObjectColors=t===1)),t.push(this.slider(`Face opacity`,()=>e.faceOpacity,t=>e.faceOpacity=t,0,1)),t.push(...this.wireRows(e))):this.solidRows(e,t),t.push(this.heading(`Ground`)),t.push(this.check(`Grid`,()=>e.grid,t=>e.grid=t)),t.push(this.check(`Shadow catcher`,()=>e.groundShadow,t=>e.groundShadow=t)),this.sliceAndObjects(e,t)}solidRows(e,t){t.push(this.select(`Style`,vt.map(([,e])=>e),()=>vt.findIndex(([t])=>t===e.style),t=>xt(e,vt[t][0]),!0)),e.style===`studio`?(t.push(this.slider(`Specular`,()=>e.studioSpecular,t=>e.studioSpecular=t,0,1)),t.push(this.slider(`Softness`,()=>e.studioWrap,t=>e.studioWrap=t,0,1)),t.push(this.slider(`Ambient`,()=>e.studioAmbient,t=>e.studioAmbient=t,0,1))):e.style===`matcap`?(t.push(this.select(`Matcap`,[...et],()=>e.matcap,t=>{e.matcap=t,e.matcapTint=st(t)},!0)),t.push(this.slider(`Object color`,()=>e.matcapTint,t=>e.matcapTint=t,0,1))):e.style===`pbr`?(t.push(this.select(`Environment`,[...tt],()=>e.environment,t=>e.environment=t)),t.push(this.slider(`Intensity`,()=>e.envIntensity,t=>e.envIntensity=t,0,3)),t.push(this.slider(`Rotation`,()=>e.envRotation,t=>e.envRotation=t,-180,180,e=>`${e.toFixed(0)} deg`))):(t.push(this.slider(`Cool/warm`,()=>e.goochShift,t=>e.goochShift=t,0,2)),t.push(this.slider(`Contrast`,()=>e.goochContrast,t=>e.goochContrast=t,0,1))),t.push(this.heading(`Shading`)),t.push(this.check(`Wireframe overlay (Z)`,()=>e.wireframe,t=>e.wireframe=t,!0)),e.wireframe&&t.push(...this.wireRows(e)),t.push(this.check(`Shadows`,()=>e.shadows,t=>e.shadows=t,!0)),e.shadows&&t.push(this.slider(`Strength`,()=>e.shadowStrength,t=>e.shadowStrength=t,0,1)),t.push(this.check(`Ambient occlusion`,()=>e.ssao,t=>e.ssao=t,!0)),e.ssao&&(t.push(this.slider(`AO strength`,()=>e.aoStrength,t=>e.aoStrength=t,0,1)),t.push(this.slider(`AO radius`,()=>e.aoRadius,t=>e.aoRadius=t,.02,2,e=>`${e.toFixed(2)} m`))),t.push(this.select(`Outlines`,[`Off`,`Silhouettes`,`Silhouettes + creases`],()=>e.outline,t=>e.outline=t,!0)),e.outline>0&&t.push(this.slider(`Outline width`,()=>e.outlineWidth,t=>e.outlineWidth=Math.round(t),1,4,e=>`${e.toFixed(0)} px`)),t.push(this.slider(`Exposure`,()=>e.exposure,t=>e.exposure=t,.2,3))}sliceAndObjects(e,t){let n=this.renderer;t.push(this.heading(`Slice plane`));let r=e.slice;if(t.push(this.check(`Cut the scene`,()=>r.enabled,e=>{r.enabled=e,e&&this.centerSlice()},!0)),r.enabled){let e=document.createElement(`div`);e.className=`d-axes`,e.setAttribute(`role`,`radiogroup`),e.setAttribute(`aria-label`,`Slice axis`),[`X`,`Y`,`Z`].forEach((t,n)=>{let i=document.createElement(`label`),a=Object.assign(document.createElement(`input`),{type:`radio`,name:`slice-axis`,checked:r.axis===n});a.addEventListener(`change`,()=>{r.axis=n,this.centerSlice(),this.build()}),i.append(a,document.createTextNode(t)),e.append(i)}),t.push(e);let i=n.bounds(),a=i?i[0][r.axis]:-1,o=i?i[1][r.axis]:1;o-a<1e-6&&(a-=.5,o+=.5),t.push(this.slider(`Position`,()=>r.offset,e=>r.offset=e,a,o,e=>`${e.toPrecision(4)} m`)),t.push(this.check(`Flip side`,()=>r.flip,e=>r.flip=e)),t.push(this.check(`Outline`,()=>r.show,e=>r.show=e))}let i=n.objectNames();i.length&&t.push(this.heading(`Objects`));for(let{name:a}of i){let i=n.displayOf(a),o=document.createElement(`div`);o.className=`d-object`,o.append(Object.assign(document.createElement(`div`),{className:`d-name`,textContent:a})),o.append(this.slider(`Opacity`,()=>i.opacity,e=>i.opacity=e,.05,1)),r.enabled&&o.append(this.check(`Cut by the slice plane`,()=>i.sliced,e=>i.sliced=e)),e.style===`pbr`&&(o.append(this.slider(`Metallic`,()=>i.metallic,e=>i.metallic=e,0,1)),o.append(this.slider(`Roughness`,()=>i.roughness,e=>i.roughness=e,.02,1))),t.push(o)}let a=Object.assign(document.createElement(`button`),{textContent:`Reset display`,className:`d-reset`});a.addEventListener(`click`,()=>{n.settings=bt(),n.display.clear(),this.build(),this.changed()}),t.push(a),this.root.replaceChildren(...t),this.changed()}centerSlice(){let e=this.renderer.bounds(),t=this.renderer.settings.slice;e&&(t.offset=.5*(e[0][t.axis]+e[1][t.axis]))}},Qt=`live`,z=e=>document.getElementById(e),$t=z(`view`),B=z(`top`),en=new m(z(`stats`)),tn=z(`bar`),V=new Jt(tn),nn=z(`error`),H=z(`envs`),rn=z(`rate`),an=z(`save`),on=z(`eval`),U={status:`connecting`,name:``,time:null,frames:0,dropped:0,fps:0,lastFrameAt:0,mode:`live`,replay:null,focus:-1,isolated:-1};window.__avbd=U,window.__timeline=V;var sn=[];U.errors=sn;var cn=console.error.bind(console);console.error=(...e)=>{sn.length<20&&sn.push(e.map(String).join(` `)),cn(...e)};var W=null,G=null,K=null,ln=null,un=null,q=!0,dn=null,fn=0,pn=0,mn,J=null,hn=!1,Y=null,X=!1,gn=!1,_n=!1,vn=[],Z=!1,yn=Number(rn.value),bn=null,xn={},Sn=new h,Q=null,Cn=0,wn=0;function Tn(e){nn.textContent=e,nn.style.display=`block`}function En(e,t=`info`){let n=document.createElement(`div`);n.className=`toast ${t}`,n.textContent=e,z(`toasts`).append(n),setTimeout(()=>n.remove(),t===`error`?9e3:5e3)}function $(e){Y?.readyState===WebSocket.OPEN&&Y.send(JSON.stringify(e))}function Dn(e){W.setScene(e.objects),K&&(K.measurements.length=0,K.pending={anchors:[],angle:!1},K.selection.clear(),K.changed());let t=W.rigidInfo();pn=t?t.instances:0,e.camera&&(J=e.camera),e.camera&&!hn&&(W.camera.lookAt(e.camera[0],e.camera[1]),hn=!0),U.focus>=pn&&(U.focus=-1),U.isolated=-1,jn(),G?.sceneChanged(),q=!0}function On(e){if(hn)return;let t=W.rigidInfo()?.offsets,n=[1/0,1/0,1/0],r=[-1/0,-1/0,-1/0];for(let i of Object.values(e)){let e=i.poses;if(!e)continue;let[a,o]=e.shape;for(let i=0;i<a;i++)for(let a=0;a<o;a++)for(let s=0;s<3;s++){let c=e.data[(i*o+a)*7+s]+(t?t[4*i+s]:0);n[s]=Math.min(n[s],c),r[s]=Math.max(r[s],c)}}if(!Number.isFinite(n[0]))return;let i=[(n[0]+r[0])/2,(n[1]+r[1])/2,(n[2]+r[2])/2],a=Math.max(.5,Math.hypot(r[0]-n[0],r[1]-n[1],r[2]-n[2])/2),o=[i[0],i[1]-2.2*a,i[2]+1.6*a];W.camera.lookAt(o,i),J=[o,i],hn=!0}function kn(e){let t=W?.rigidInfo();if(!t||e<0||e>=t.instances)return null;let n=J?J[1]:[0,0,1];return[t.offsets[4*e]+n[0],t.offsets[4*e+1]+n[1],t.offsets[4*e+2]+n[2]]}function An(e,t){let n=W.camera;n.animateTo(e,t,n.yaw,n.pitch,.35),q=!0}function jn(){W?.setIsolated(U.isolated),en.focus=U.focus,V.focus=U.focus,V.drawPlot(),Un(!0),q=!0}function Mn(e){let t=W?.rigidInfo();if(t&&K&&e>=0&&e<t.instances&&K.selectSegments(t.id,Array.from({length:t.bodies},(n,r)=>e*t.bodies+r)),U.focus=e,jn(),!W)return;let n=kn(e);if(n)An(n,Math.min(W.camera.distance,2.5));else if(J&&U.isolated<0){let[e,t]=J;An([...t],Math.hypot(e[0]-t[0],e[1]-t[1],e[2]-t[2]))}}function Nn(e){U.isolated=U.isolated===e?-1:e,e>=0&&(U.focus=e),jn();let t=kn(U.isolated>=0?U.isolated:U.focus);t&&W&&An(t,Math.min(W.camera.distance,2.5))}en.onFocus=e=>Mn(e);function Pn(){let e=U.mode===`live`;for(let t of B.querySelectorAll(`.live-only`))t.style.display=e&&X?``:`none`;H.disabled=!vn.includes(`select_envs`),an.style.display=vn.includes(`save_checkpoint`)?``:`none`,on.style.display=vn.includes(`run_eval`)?``:`none`}function Fn(e){let t=e?.envs,n=e?.env_total;if(!t?.length||!n){H.innerHTML=``;return}let r=t.length,i=[];for(let e=0;e<n;e+=r){let t=Math.min(e,n-r);if(i.push(`<option value="${t}">${t}–${t+r-1} of ${n}</option>`),t+r>=n)break}H.innerHTML=i.join(``),H.value=String(t[0])}H.addEventListener(`change`,()=>$({type:`select_envs`,first:Number(H.value)})),rn.addEventListener(`change`,()=>{yn=Number(rn.value),Z&&$({type:`subscribe`,stream:Qt,rate:yn})});for(let[e,t]of[[an,`save_checkpoint`],[on,`run_eval`]])e.addEventListener(`click`,()=>{$({type:t}),e.disabled=!0,setTimeout(()=>e.disabled=!1,2e3)});function In(e){if(U.mode=e,V.setMode(e),Pn(),e===`live`){Q=null,V.setReplay(null),!Z&&X&&($({type:`subscribe`,stream:Qt,rate:yn}),Z=!0),bn&&(mn=bn.info?.envs,Dn(bn));return}if(Z&&=($({type:`unsubscribe`,stream:Qt}),!1),e===`ring`)Ln({source:`ring`});else{let e=V.evalList,t=V.selectedEval??e[e.length-1]?.id;t?Rn(t):(Q=null,V.setReplay(null))}}function Ln(e){Cn++,Q=null,V.setReplay(null),$({type:`open_replay`,...e})}function Rn(e){if(V.selectEval(e),U.mode!==`eval`){In(`eval`);return}Ln({source:`eval`,id:e})}function zn(e){if(e.id!==Cn)return;let t=new l(e);Q=t,U.replay={id:e.id,source:e.source,name:e.name,duration:e.duration,chunks:t.chunksTotal},mn=e.meta.envs,Dn(e.scene),V.setReplay(t),t.onChunk=()=>{$({type:`replay_ack`,id:t.id,n:t.chunksDone}),U.replay.loaded=t.chunksDone,t===Q&&(V.render(),Hn(!0))},Hn(!0)}function Bn(){let e=Q;if(!e)return U.mode===`ring`?`asking the trainer for its latest episodes…`:`loading…`;let t=e.msg.summary.batch??{},n=s.filter(([e])=>t[e]!==void 0&&t[e]>0).map(([e])=>`${e} ${(100*t[e]).toFixed(0)}%`).join(` · `);if(e.msg.source===`ring`){let t=e.msg.summary.envs??[],r=t.filter(e=>e.complete).length;return`last episodes at step ${e.msg.meta.timestep} · ${r}/${t.length} complete${n?` · `+n:``}`}let r=String(e.msg.meta.checkpoint??``).split(`/`).pop();return`${r?r+` · `:``}seed ${e.msg.meta.seed??`?`}${n?` · `+n:``}`}var Vn=null;function Hn(e=!1){let t=Q;if(!t||!W)return;e&&t.resetCache();let n=t.sample(V.t,e);On(n.objects),W.applyFrame(n.objects);for(let[e,r]of Object.entries(t.msg.summary.batch??{}))typeof r==`number`&&(n.channels[`episode ${e}`]=r);Vn=n,Un(e),q=!0}function Un(e=!1){let t=performance.now();if(!e&&t-wn<100)return;if(wn=t,U.mode===`live`){en.update({channels:xn,numEnvs:pn,envNames:mn,series:Sn});return}let n=Q;if(!n||!Vn)return;let r=n.series(V.t);en.update({channels:Vn.channels,numEnvs:n.numEnvs,envNames:mn,outcomes:n.msg.summary.envs?.map(e=>c(e))??[],ended:n.endStep.map(e=>V.t>=e),series:r})}V.onMode=In,V.onPickEval=Rn,V.onSeek=()=>Hn();function Wn(e){if(dn=e.seq,U.mode!==`live`)return;fn&&e.seq>fn+1&&(U.dropped+=e.seq-fn-1),fn=e.seq;let t=performance.now();U.lastFrameAt&&(U.fps=.8*U.fps+.2*(1e3/Math.max(1,t-U.lastFrameAt))),U.lastFrameAt=t,U.frames++,U.time=e.time,On(e.objects),W.applyFrame(e.objects),xn=e.channels,Sn.push(e.channels,pn),Un(),q=!0}function Gn(){let e=`${location.protocol===`https:`?`wss`:`ws`}://${location.host}/ws`;U.status=`connecting`,Y=new WebSocket(e),Y.binaryType=`arraybuffer`,Y.onmessage=e=>{if(!(e.data instanceof ArrayBuffer))return;let t=n(e.data);if(t.type===`hello`)U.name=t.name,document.title=`${t.name||`avbd-viz`} — avbd-viz`,X=t.streams.some(e=>e.name===Qt),gn=!!t.replay?.ring,_n=!!t.replay?.evals,vn=t.accepts??[],Z=!1,Cn=0,V.setAvailable(X,gn,_n),U.status=X?`waiting for the scene`:`replay`,In(U.mode===`live`&&!X?`eval`:U.mode);else if(t.type===`scene`){U.status=`live`;let e=bn?.info?.envs?.[0]!==t.info?.envs?.[0];bn=t,Fn(t.info),e&&Sn.clear(),U.mode===`live`&&(mn=t.info?.envs,Dn(t))}else if(t.type===`frame`)Wn(t);else if(t.type===`evals`){let e=!_n||!V.evalList.length;_n=!0,V.setAvailable(X,gn,!0),V.setEvals(t.evals),U.mode===`eval`&&e&&!Q&&In(`eval`)}else if(t.type===`replay`)zn(t);else if(t.type===`replay_chunk`){let e=t;Q&&e.id===Q.id&&Q.addChunk(e)}else t.type===`event`&&En(t.text,t.level)},Y.onclose=()=>{U.status=`disconnected — retrying`,fn=0,Z=!1,setTimeout(Gn,1500)}}window.__golden=async(e,t,n,r,i={})=>{document.body.classList.add(`bare`);let a=W,{style:o,slice:s,objects:c,ortho:l,select:u,...d}=i;a.settings=bt(),o&&xt(a.settings,o),Object.assign(a.settings,d),Object.assign(a.settings.slice,s??{}),a.display.clear();for(let[e,t]of Object.entries(c??{}))Object.assign(a.displayOf(e),t);Rn(e);let f=e=>new Promise(t=>setTimeout(t,e));for(let t=0;t<600;t++){let t=Q;if(t&&t.msg.meta.id===e&&t.chunksDone===t.chunksTotal)break;await f(50)}if(V.seek(t),W.camera.lookAt(n,r),W.camera.ortho=!!l,hn=!0,u&&K){K.selection.setMode(u.mode);let e=W.geometries().find(e=>e.name===u.object);e&&K.selection.add(u.indices.map(t=>({object:e.id,index:t})),!1),K.changed()}q=!0;for(let e=0;e<3;e++)await new Promise(e=>requestAnimationFrame(e));return Q?`ok`:`no replay`};{let e=new ResizeObserver(()=>{let e=document.documentElement.style;e.setProperty(`--bar-h`,`${tn.offsetHeight+12}px`),e.setProperty(`--top-h`,`${B.offsetHeight+12}px`)});for(let t of[tn,B,document.body])e.observe(t)}function Kn(){let e,t,n,r=U.name||`avbd-viz`;if(U.mode===`live`){e=U.status===`live`?`ok`:U.status===`connecting`?`wait`:`bad`,t=`${r} — ${U.status}`;let i=U.lastFrameAt?(performance.now()-U.lastFrameAt)/1e3:NaN;n=`step ${U.time??`–`} · ${U.frames} frames (${U.dropped} dropped) · ${U.fps.toFixed(1)} fps · last ${Number.isFinite(i)?i.toFixed(1)+` s`:`–`} ago`}else e=Q?`ok`:`wait`,t=`${r} — ${Q?Q.msg.name:U.mode===`ring`?`training ring`:`evals`}`,n=Bn();B.className=e,B.querySelector(`.title`).textContent=t,B.querySelector(`.clock`).textContent=n}var qn=performance.now();function Jn(e){let t=Math.min(.1,(e-qn)/1e3);qn=e,U.mode!==`live`&&V.advance(t)&&Hn(),K?.update(t)&&(q=!0),document.body.classList.contains(`bare`)&&(q=!0),W&&q&&(W.render(),q=!1,un?.rendered(e)),un?.update(e),ln?.update(e),G?.sync(),dn!==null&&Y?.readyState===WebSocket.OPEN&&(Y.send(JSON.stringify({type:`ack`,stream:Qt,seq:dn})),dn=null),Kn(),requestAnimationFrame(Jn)}kt.create($t).then(e=>{W=e,G=new Zt(z(`display`),e),G.onChange=()=>q=!0;let t=z(`display-btn`);t.addEventListener(`click`,()=>{G.toggle(),t.setAttribute(`aria-expanded`,String(G.open))}),K=new zt($t,e,z(`selbox`)),K.onDirty=()=>q=!0,K.onSelection=()=>{let e=K.selection.active;U.focus=e?K.envOf(e):-1,jn()},K.onIsolate=Nn,K.onStatus=e=>En(e),K.onEscape=()=>U.isolated<0?!1:(Nn(-1),!0),window.__ix=K,ln=new Vt(z(`inspect`),K),un=new Gt(z(`gizmo`),z(`hud`),z(`scalebar`),e,K,()=>q=!0),new ResizeObserver(()=>q=!0).observe($t),Pn(),Gn(),requestAnimationFrame(Jn)}).catch(e=>Tn(`Cannot start the viewer: ${e.message}`));