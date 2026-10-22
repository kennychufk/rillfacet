"""Batched GPU rasterizer for camera images (Dawn / WebGPU; part of the
``rillfacet`` extension, no extra dependency).

Made for vision RL at thousands of envs: every env of a chunk is drawn in
one go, and with zero-copy (Linux + Vulkan + NVIDIA; poses and images stay
on the GPU) a frame never waits on the CPU. How it maps the scene, and why
(the engine is ``src/rillfacet/camera_raster.h``):

- All envs share one world frame (no ``env_spacing``): each env is drawn
  into its own tile of a layered texture atlas by instanced draws, one per
  body and atlas layer (instance = body * n + env), and clip distances keep
  an env inside its tile. Body poses go to the GPU as a texture (per env:
  every body's pose, then the camera's) and the vertex shader poses the
  body-local vertices, so the geometry is uploaded once.
- Each env renders a centered PINHOLE proxy of its camera, which a compute
  pass resamples through the exact OpenCV distortion (``supersample`` x
  ``supersample`` taps per output pixel; the same proxy and remap as the
  Cycles backend), then adds the background (the ambient light and the
  envmap, seen directly), applies the shared sensor stage (gain,
  vignetting, shot and read noise; :mod:`rillfacet.render.sensor`'s model,
  with its own GPU random numbers) and writes the outputs.
- Shading: forward PBR with Mitsuba's principled BRDF (Burley diffuse,
  GGX with separable Smith masking; glTF metallic-roughness, base color
  textures times the per-env base color, solid (3D) textures of
  :mod:`rillfacet.solid_texture` evaluated at the interpolated body-local
  position, ``shaders/common/solid_texture.wgsl``) under up to 4
  directional lights, the first one casting shadows (a
  ``shadow_resolution``\\ :sup:`2` map per env over the scene's bounding
  box or ahead of the camera, 3x3 PCF), plus
  the uniform sky (``ambient``; the BRDF's exact directional albedo,
  :func:`brdf_lut`) and an ``envmap`` (diffuse from 9 spherical harmonics,
  specular from its mip chain). No depth of field, motion blur,
  interreflections or occlusion of the sky: images are sharp and
  direct-lit, like Mitsuba's ``direct`` integrator, except that the sky
  reaches every surface unblocked.
- Depth and segmentation: per output pixel, the label of the proxy pixel
  nearest its center ray and a z-depth interpolated in 1/z between its 4
  proxy neighbors where they agree (as the Cycles backend).
- Chunks: :meth:`RasterRenderer.render_chunks` yields ``chunk`` envs at a
  time; with ``double_buffer`` the next chunk renders while the caller
  uses the current one (e.g. a detector on the same CUDA stream).

Without zero-copy (no CUDA, or ``zero_copy=False``) poses are uploaded from
the host and images read back: correct, much slower.
"""
from __future__ import annotations

import warnings
import zlib

import numpy as np

from . import Renderer, srgb_to_linear
from .camera import PixelRays
from .sensor import radius2

__all__ = ["RasterRenderer", "brdf_lut"]

_BITS = {"rgb": 1, "linear": 2, "depth": 4, "segmentation": 8}
_DEFAULT_LIGHTS = (("ambient", 0.35, (1.0, 1.0, 1.0), None),
                   ("directional", 2.5, (1.0, 1.0, 1.0), (0.3, 0.2, -1.0)))
#: Largest tangent of the angle off the optical axis a pinhole proxy covers.
MAX_TAN = 5.0
MAX_DIRECTIONAL = 4


_LUT = None


def brdf_lut(n=32, samples=64):
    """``[n, n, 4]`` float32 directional albedo of the shader's BRDF, by
    roughness (rows, 0..1) and n_dot_v (columns, 0..1): the GGX lobe's
    scale and bias (its albedo is ``F0 * scale + bias`` with Schlick's
    Fresnel; alpha = roughness^2, separable Smith masking) and the Burley
    diffuse albedo (relative to Lambert's). ``samples``^2 stratified
    importance samples per entry (torch, CPU)."""
    import torch
    T = torch.float64
    j = torch.arange(n, dtype=T) / (n - 1)
    rough = j.clamp(min=0.03)[:, None, None]               # as the shader
    nv = j.clamp(min=1e-3)[None, :, None]
    g = (torch.arange(samples, dtype=T) + 0.5) / samples
    u1, u2 = torch.meshgrid(g, g, indexing="ij")
    u1, u2 = u1.reshape(1, 1, -1), u2.reshape(1, 1, -1)
    V = torch.stack(torch.broadcast_tensors(
        (1 - nv * nv).sqrt(), torch.zeros_like(nv), nv), -1)  # [1, n, 1, 3]
    a2 = rough ** 4

    def g1(x):
        return 2 * x / (x + (a2 + (1 - a2) * x * x).sqrt())

    # GGX lobe: half vectors from the NDF, estimator G VdH / (NdV NdH)
    ct = ((1 - u1) / (1 + (a2 - 1) * u1)).sqrt()
    st = (1 - ct * ct).clamp(min=0).sqrt()
    ph = 2 * np.pi * u2
    Hv = torch.stack(torch.broadcast_tensors(st * ph.cos(), st * ph.sin(), ct), -1)
    vdh = (V * Hv).sum(-1)
    ndl = 2 * vdh * Hv[..., 2] - nv
    est = torch.where(ndl > 0, g1(nv) * g1(ndl.clamp(min=1e-9)) * vdh
                      / (nv * Hv[..., 2]), torch.zeros_like(ndl))
    w = (1 - vdh).clamp(0, 1) ** 5
    scale, bias = (est * (1 - w)).mean(-1), (est * w).mean(-1)
    # Burley diffuse: cosine-sampled light directions
    r = u1.sqrt()
    L = torch.stack(torch.broadcast_tensors(r * ph.cos(), r * ph.sin(),
                                            (1 - u1).sqrt()), -1)
    Hd = L + V
    Hd = Hd / Hd.norm(dim=-1, keepdim=True)
    ldh = (L * Hd).sum(-1)
    fo, fi = (1 - nv) ** 5, (1 - L[..., 2]) ** 5
    rr = 2 * rough * ldh * ldh
    diff = ((1 - 0.5 * fi) * (1 - 0.5 * fo)
            + rr * (fo + fi + fo * fi * (rr - 1))).mean(-1)
    out = torch.stack([scale, bias, diff, torch.zeros_like(diff)], -1)
    return out.float().numpy()


def _sh_basis(x, y, z):
    """The 9 real SH basis functions (order matching the shader)."""
    return np.stack([np.full_like(x, 0.282095), 0.488603 * y, 0.488603 * z,
                     0.488603 * x, 1.092548 * x * y, 1.092548 * y * z,
                     0.315392 * (3 * z * z - 1), 1.092548 * x * z,
                     0.546274 * (x * x - y * y)], -1)


def _env_dirs(h, w):
    """World directions of an equirect image's pixel centers (z-up; the
    mapping of the shader's ``env_uv``) and their solid angles."""
    v = (np.arange(h) + 0.5) / h
    u = (np.arange(w) + 0.5) / w
    th = np.pi * v[:, None]
    ph = 2 * np.pi * u[None, :]
    d = np.stack([np.sin(th) * np.sin(ph), np.sin(th) * np.cos(ph),
                  np.cos(th) * np.ones_like(ph)], -1)
    dw = np.sin(th) * (2 * np.pi / w) * (np.pi / h) * np.ones_like(ph)
    return d, dw


def _load_envmap(path):
    """Linear float RGB of an equirectangular image (EXR / HDR through
    imageio, else PIL with sRGB decoding)."""
    p = str(path).lower()
    if p.endswith((".exr", ".hdr")):
        try:
            import imageio.v3 as iio
        except ImportError as e:
            raise ImportError("RasterRenderer: EXR / HDR envmaps need imageio") from e
        return np.asarray(iio.imread(path), np.float32)[..., :3]
    from PIL import Image
    img = np.asarray(Image.open(path).convert("RGB"), np.float32) / 255.0
    return srgb_to_linear(img)


def _downsample(img):
    h, w = img.shape[:2]
    img = img[:h - h % 2, :w - w % 2]
    return 0.25 * (img[0::2, 0::2] + img[1::2, 0::2] + img[0::2, 1::2]
                   + img[1::2, 1::2])


class _View:
    """A camera's engine view and the proxy geometry behind it."""

    def __init__(self, r, cam, bits, chunk, sets, shadow_res, supersample,
                 oversample):
        rays = PixelRays(cam.K, cam.width, cam.height, cam.dist, device="cpu")
        if rays.max_residual > 0.05:
            warnings.warn(f"camera {cam.name!r}: undistortion residual "
                          f"{rays.max_residual:.3f} px")
        if rays.outside > 0:
            warnings.warn(f"camera {cam.name!r}: {100 * rays.outside:.2f}% of "
                          "the image lies beyond the distortion model's fold "
                          "(drawn with its edge rays)")
        c = rays.corners.reshape(-1, 2).numpy()
        tx, ty = float(np.abs(c[:, 0]).max()), float(np.abs(c[:, 1]).max())
        if max(tx, ty) > MAX_TAN:
            raise ValueError(
                f"camera {cam.name!r}: its rays reach "
                f"{np.degrees(np.arctan(max(tx, ty))):.0f} degrees off axis, "
                "beyond what a pinhole proxy covers")
        K = cam.K
        self.f = float(oversample) * max(K[0, 0], K[1, 1])
        self.pw = 2 * int(np.ceil(self.f * tx + 1.0))
        self.ph = 2 * int(np.ceil(self.f * ty + 1.0))
        self.cx, self.cy = (self.pw - 1) / 2, (self.ph - 1) / 2
        f = self.f
        center = rays.center.numpy()
        remap = np.zeros((cam.width * cam.height, 8), np.float32)
        remap[:, 0] = f * center[:, 0] + self.cx
        remap[:, 1] = f * center[:, 1] + self.cy
        remap[:, 2:4] = f * rays.d_du.numpy()
        remap[:, 4:6] = f * rays.d_dv.numpy()
        remap[:, 6] = radius2(cam.K, cam.width, cam.height).numpy().ravel()
        self.bits, self.chunk, self.sets = bits, chunk, sets
        self.id = r.add_view(cam.width, cam.height, self.pw, self.ph, self.f,
                             self.cx, self.cy, cam.near, cam.far, chunk, sets,
                             shadow_res, bits, supersample, remap)
        if self.id < 0:
            raise RuntimeError(
                f"RasterRenderer: cannot set up camera {cam.name!r} (proxy "
                f"{self.pw}x{self.ph}, chunk {chunk}, shadow maps "
                f"{shadow_res}^2): beyond the GPU's limits or memory; use a "
                "smaller chunk, shadow_resolution or oversample")
        self.bufs = {}                 # set -> raw chunk buffers


class RasterRenderer(Renderer):
    """Batched rasterizer (see the module docstring).

    ``chunk``: envs per pass (memory grows with it: the proxy, output and
    shadow atlases of a chunk, twice the outputs with ``double_buffer``).
    ``supersample``: S x S radiance taps per output pixel from the proxy;
    ``oversample`` scales the proxy's resolution. ``shadow_resolution``: per
    env (0 = no shadows); the shadow box is fit to the scene at the first
    render (over all envs, 5% margin) unless ``shadow_box=(center,
    half_extent)``; :meth:`fit_shadow_box` refits it. ``shadow_extent``
    (m; a float, or a dict by camera name) instead centers each env's shadow
    map ``shadow_extent`` ahead of the camera with that half extent: far
    sharper shadows for a close-up camera (every caster in the scene still
    casts into it; receivers outside it are lit). ``zero_copy``: share
    poses and images with CUDA (needs torch with CUDA; falls back to host
    copies when unavailable). ``seed`` seeds the sensor noise.
    ``solid_texture_filter``: fade the solid textures' detail finer than a
    proxy pixel to its mean (the rasterizer shades one point per pixel,
    so it would alias; Mitsuba averages over its samples instead).
    """

    def __init__(self, *, chunk=256, double_buffer=True, supersample=2,
                 oversample=1.0, shadow_resolution=512, shadow_box=None,
                 shadow_extent=None, texture_size=1024, zero_copy=True,
                 seed=0, solid_texture_filter=True):
        super().__init__(env_spacing=np.inf, seed=seed)
        from .. import _rillfacet
        import torch
        self.torch = torch
        cuda = torch.cuda.is_available()
        if zero_copy and cuda:
            torch.cuda.init()            # the engine uses torch's context
        self._r = _rillfacet.CameraRaster(bool(zero_copy and cuda))
        if not self._r.ok:
            raise RuntimeError("RasterRenderer: no usable WebGPU device "
                               "(needs Vulkan with clip distances)")
        global _LUT
        if _LUT is None:
            _LUT = brdf_lut()
        self._r.set_brdf_lut(_LUT.astype(np.float16).view(np.uint16))
        self.zero_copy = self._r.zero_copy
        self.dev = torch.device("cuda" if cuda else "cpu")
        self.chunk = int(chunk)
        self.sets = 2 if double_buffer else 1
        self.supersample = int(supersample)
        self.oversample = float(oversample)
        self.shadow_resolution = int(shadow_resolution)
        self.shadow_extent = shadow_extent
        self.texture_size = int(texture_size)
        self.solid_texture_filter = bool(solid_texture_filter)
        self._shadow_box = None if shadow_box is None else (
            np.asarray(shadow_box[0], np.float64), float(shadow_box[1]))
        self._shadow_box_fixed = shadow_box is not None
        self._views: dict = {}             # camera name -> (key, _View)
        self._frame = np.zeros(_rillfacet.CameraRaster.FRAME_FLOATS, np.float32)
        self._bases: dict = {}             # mesh name -> first global body
        self._slot_bases: dict = {}        # mesh name -> first material slot
        self._solid: dict = {}             # mesh name -> (first row, slots)
        self._nb = self._slots = self._solid_rows = 0
        self._mats = None
        self._visible = {}                 # mesh name -> [I, B] float
        self._body_spheres = None          # [NB, 4] local center, radius
        self._renders = 0
        self._warned = set()

    @property
    def info(self) -> str:
        """Adapter and zero-copy status."""
        return self._r.info

    def close(self) -> None:
        for _, v in self._views.values():
            self._r.remove_view(v.id)
        self._views.clear()

    # -- build ----------------------------------------------------------------

    def _build(self):
        verts, idx, ranges, spheres = [], [], [], []
        tex_layers, tex_index = [], {}
        nb = slots = nv = nt = rows = 0
        self._bases, self._slot_bases, self._solid = {}, {}, {}
        for m in self.meshes.values():
            B = m.num_bodies
            self._bases[m.name], self._slot_bases[m.name] = nb, slots
            tris = m.triangles.astype(np.int64)
            tri_body = np.repeat(np.arange(B), np.diff(m.body_triangle_offsets))
            if m.materials:
                slot_t = m.triangle_material.astype(np.int64)
                M = len(m.materials)
            else:
                slot_t, M = tri_body, B
            # one vertex per (vertex, slot): a slot is a flat attribute
            key = tris * M + slot_t[:, None]
            uk, inv = np.unique(key.ravel(), return_inverse=True)
            src, vslot = uk // M, uk % M
            V = len(src)
            v = np.zeros((V, 9), np.float32)
            v[:, :3] = m.local_vertices[src]
            if m.normals is not None:
                v[:, 3:6] = m.normals[src]
            if m.uvs is not None:
                v[:, 6:8] = m.uvs[src]
            v[:, 8] = (vslot + slots).astype(np.uint32).view(np.float32)
            verts.append(v)
            idx.append((inv.reshape(-1, 3) + nv).astype(np.uint32))
            off = m.body_triangle_offsets
            for b in range(B):
                ranges.append((3 * (nt + off[b]), 3 * (off[b + 1] - off[b])))
            # body bounding spheres (local), for the shadow box
            vb = m.vertex_body
            for b in range(B):
                p = m.local_vertices[vb == b]
                if len(p):
                    lo, hi = p.min(0), p.max(0)
                    spheres.append([*(lo + hi) / 2, np.linalg.norm(hi - lo) / 2])
                else:
                    spheres.append([0, 0, 0, -1])
            solid = [s for s, mat in enumerate(m.materials)
                     if mat.solid_texture]
            if solid:
                self._solid[m.name] = (rows, solid)
                rows += len(solid)
            for s, mat in enumerate(m.materials):
                if mat.base_color_texture is None:
                    continue
                if m.uvs is None:
                    warnings.warn(f"rigid mesh {m.name!r}: textures without "
                                  "UVs are drawn untextured")
                    continue
                tex_index[(m.name, s)] = len(tex_layers)
                tex_layers.append(mat.base_color_texture)
            nb += B
            slots += M
            nv += V
            nt += len(tris)
        self._nb, self._slots, self._solid_rows = nb, slots, rows
        self._tex_index = tex_index
        verts = np.concatenate(verts) if verts else np.zeros((0, 9), np.float32)
        idx = (np.concatenate(idx).ravel() if idx
               else np.zeros(0, np.uint32))
        self._r.set_geometry(verts, idx, np.asarray(ranges, np.uint32)
                             .reshape(-1, 2))
        self._body_spheres = np.asarray(spheres, np.float32).reshape(-1, 4)
        if tex_layers:
            self._r.set_textures(self._texture_mips(tex_layers))
        self._build_lights()
        for _, v in self._views.values():   # body count may have changed
            self._r.remove_view(v.id)
        self._views.clear()
        self._visible = {}
        self._structure_dirty = False
        self._dirty_appearance = set(self.meshes)
        self._dirty_poses = set(self.meshes)
        if not self._shadow_box_fixed:
            self._shadow_box = None

    def _texture_mips(self, textures):
        from PIL import Image
        s = self.texture_size
        layers = []
        for t in textures:
            img = (Image.open(t) if isinstance(t, str) else Image.fromarray(
                np.asarray(t) if np.asarray(t).dtype == np.uint8 else
                (np.clip(np.asarray(t), 0, 1) * 255).astype(np.uint8)))
            layers.append(img.convert("RGBA").resize((s, s), Image.LANCZOS))
        mips, k = [], 0
        while True:
            sk = max(s >> k, 1)
            mips.append(np.stack([np.asarray(im.resize((sk, sk), Image.BOX))
                                  for im in layers]).astype(np.uint8))
            if sk == 1:
                return mips
            k += 1

    def _build_lights(self):
        F = np.zeros_like(self._frame)
        lights = [(l.type, l.intensity, l.color, l.direction, l.envmap)
                  for l in self.lights.values()]
        if not lights:
            lights = [(t, i, c, d, None) for t, i, c, d in _DEFAULT_LIGHTS]
        dirs = []
        env = None
        for typ, inten, color, d, envmap in lights:
            c = np.asarray(color, np.float64) * inten
            if typ == "ambient":
                F[0:3] += c
            elif typ == "directional":
                dirs.append((np.asarray(d, np.float64), c))
            elif env is None:
                env = (envmap, inten)
            else:
                warnings.warn("RasterRenderer: only the first envmap is used")
        if len(dirs) > MAX_DIRECTIONAL:
            warnings.warn(f"RasterRenderer: only {MAX_DIRECTIONAL} directional "
                          "lights are used")
            dirs = dirs[:MAX_DIRECTIONAL]
        for i, (d, c) in enumerate(dirs):
            d = d / np.linalg.norm(d)
            F[24 + 4 * i:27 + 4 * i] = -d                 # toward the light
            F[40 + 4 * i:43 + 4 * i] = c
        F[5] = len(dirs)
        F[6] = 1.0 if dirs and self.shadow_resolution > 0 else 0.0
        if dirs:
            lz = dirs[0][0] / np.linalg.norm(dirs[0][0])
            up = (np.array([0.0, 0, 1]) if abs(lz[2]) < 0.99
                  else np.array([1.0, 0, 0]))
            lx = np.cross(lz, up)
            lx /= np.linalg.norm(lx)
            F[12:15], F[16:19], F[20:23] = lx, np.cross(lz, lx), lz
        if env is not None:
            img = _load_envmap(env[0])
            mips = [img]
            while mips[-1].shape[0] > 8 and mips[-1].shape[1] > 16:
                mips.append(_downsample(mips[-1]))
            self._r.set_envmap([np.concatenate(
                [m, np.ones(m.shape[:2] + (1,), np.float32)], -1)
                .astype(np.float16).view(np.uint16) for m in mips])
            F[3] = env[1]
            F[4] = len(mips)
            small = next((m for m in mips if m.shape[0] <= 128), mips[-1])
            d, dw = _env_dirs(*small.shape[:2])
            Y = _sh_basis(d[..., 0], d[..., 1], d[..., 2])     # [h, w, 9]
            L = np.einsum("hwk,hwc,hw->kc", Y, small, dw)
            A = np.array([np.pi] + [2 * np.pi / 3] * 3 + [np.pi / 4] * 5)
            F[56:92].reshape(9, 4)[:, :3] = A[:, None] * L * env[1]
        self._frame = F
        self._shadow_ready = False

    def fit_shadow_box(self, margin=0.05):
        """Fits the shadow box to the bodies' current poses in every env
        (one GPU sync)."""
        torch = self.torch
        cen, rad = [], []
        for m in self.meshes.values():
            if m.poses is None:
                continue
            base = self._bases[m.name]
            sp = torch.as_tensor(self._body_spheres[base:base + m.num_bodies],
                                 device=self.dev)
            p = torch.as_tensor(m.poses, device=self.dev).float()
            ok = sp[:, 3] >= 0
            c = p[..., :3] + _qrot(p[..., 3:], sp[None, :, :3].expand(
                p.shape[0], -1, -1))
            cen.append(c[:, ok].reshape(-1, 3))
            rad.append(sp[ok, 3].repeat(p.shape[0]))
        if not cen:
            self._shadow_box = (np.zeros(3), 1.0)
            return
        c, r = torch.cat(cen), torch.cat(rad)[:, None]
        lo = (c - r).amin(0).cpu().numpy()
        hi = (c + r).amax(0).cpu().numpy()
        self._shadow_box = ((lo + hi) / 2,
                            float(np.linalg.norm(hi - lo) / 2 * (1 + margin)))

    # -- per-render state -------------------------------------------------------

    def _sync(self, cam):
        if self._structure_dirty:
            self._build()
        if self._dirty_appearance:
            self._write_materials(cam.instances)
            self._dirty_appearance.clear()
        if self._shadow_box is None and self._frame[6] > 0:
            self.fit_shadow_box()    # the extent of the scene, also for shadow_extent
        F = self._frame.copy()
        if self._shadow_box is not None:
            c, r = self._shadow_box
            ext = self.shadow_extent
            ext = ext.get(cam.name) if isinstance(ext, dict) else ext
            F[8:11], F[11] = c, r
            F[23] = r                       # depth range toward the light
            if ext:                         # a box ahead of each camera
                F[11], F[15] = ext, ext
                F[23] = 2 * r + ext         # casters anywhere in the scene
            F[7] = 1.5 * 2 * F[11] / max(self.shadow_resolution, 1)  # bias (m)
        self._r.set_frame(F)
        lens = np.zeros((cam.instances, 8), np.float32)
        lens[:, :3] = cam.gain
        lens[:, 3] = cam.vignetting
        lens[:, 4] = cam.shot_noise
        lens[:, 5] = cam.read_noise
        self._r.set_lens(lens)

    def _write_materials(self, I):
        mats = np.zeros((I, max(self._slots, 1), 8), np.float32)
        mats[..., 5:7] = -1.0
        NS = self._solid_rows
        if NS:
            from ..solid_texture import linearize
            rows = np.zeros((I, NS, 32), np.float32)
        for m in self.meshes.values():
            s0 = self._slot_bases[m.name]
            if m.materials:
                M = len(m.materials)
                mats[:, s0:s0 + M, :3] = srgb_to_linear(m.material_base_color)
                mats[:, s0:s0 + M, 3] = m.material_roughness
                mats[:, s0:s0 + M, 4] = m.material_metallic
                if m.name in self._solid:
                    r0, solid = self._solid[m.name]
                    rows[:, r0:r0 + len(solid)] = linearize(
                        m.material_solid_texture[:, solid])
                    k = np.arange(len(solid))
                    mats[:, s0 + np.array(solid), 6] = (
                        np.arange(I)[:, None] * NS + r0 + k[None])
                    mats[:, s0 + np.array(solid), 7] = [
                        float(m.materials[s].bump) for s in solid]
                for s in range(M):
                    layer = self._tex_index.get((m.name, s))
                    if layer is not None:
                        mats[:, s0 + s, 5] = layer
            else:
                B = m.num_bodies
                mats[:, s0:s0 + B, :3] = srgb_to_linear(
                    m.segment_colors.reshape(I, B, 3))
                mats[:, s0:s0 + B, 3] = 0.5
        if NS:
            rows[..., 31] = float(self.solid_texture_filter)
            self._r.set_solid_textures(rows.reshape(-1, 32))
        self._r.set_materials(mats)

    def _poses(self, cam):
        """``[I, NB + 1, 2, 4]`` float32: per body (pos, visible), quat; the
        camera last. torch on the device, or numpy without zero-copy."""
        torch = self.torch
        I = cam.instances
        dev = self.dev if self.zero_copy else torch.device("cpu")
        P = torch.zeros((I, self._nb + 1, 2, 4), device=dev)
        P[..., 1, 3] = 1.0
        for m in self.meshes.values():
            b0, B = self._bases[m.name], m.num_bodies
            if m.name in self._dirty_poses or m.name not in self._visible:
                self._visible[m.name] = torch.as_tensor(
                    m.segment_visible.reshape(I, B), device=dev).float()
            P[:, b0:b0 + B, 0, 3] = self._visible[m.name]
            if m.poses is not None:
                p = torch.as_tensor(m.poses, device=dev).float().reshape(I, B, 7)
                P[:, b0:b0 + B, 0, :3] = p[..., :3]
                P[:, b0:b0 + B, 1] = p[..., 3:]
        self._dirty_poses.clear()
        cp = torch.as_tensor(cam.world_poses(), device=dev).float().reshape(I, 7)
        P[:, self._nb, 0, :3] = cp[:, :3]
        P[:, self._nb, 1] = cp[:, 3:]
        P = P.reshape(I, -1).contiguous()
        return P if self.zero_copy else P.numpy()

    def _view(self, cam, bits):
        key = (cam.width, cam.height, cam.K.tobytes(),
               None if cam.dist is None else cam.dist.tobytes(), cam.near,
               cam.far, self._nb)
        hit = self._views.get(cam.name)
        if hit is not None and hit[0] == key and (hit[1].bits & bits) == bits:
            return hit[1]
        if hit is not None:
            bits |= hit[1].bits if hit[0] == key else 0
            self._r.remove_view(hit[1].id)
        v = _View(self._r, cam, bits, min(self.chunk, cam.instances),
                  self.sets, self.shadow_resolution, self.supersample,
                  self.oversample)
        self._views[cam.name] = (key, v)
        return v

    # -- render -----------------------------------------------------------------

    def _check(self, camera, outputs):
        bad = set(outputs) - set(self.OUTPUTS)
        if bad:
            raise ValueError(f"unknown outputs {sorted(bad)}")
        cam = self._camera(camera)
        for m in self.meshes.values():
            if m.instances != cam.instances:
                raise ValueError(f"camera {camera!r} has {cam.instances} "
                                 f"instances, rigid mesh {m.name!r} "
                                 f"{m.instances}")
        if np.any(cam.aperture_radius > 0) and "dof" not in self._warned:
            self._warned.add("dof")
            warnings.warn("RasterRenderer renders pinhole images: the "
                          "cameras' depth of field is ignored")
        return cam

    def _raw(self, n, H, W, bits, dev):
        torch = self.torch
        seg = torch.int16 if self._r.seg16 else torch.int32
        return [torch.empty((n, H, W, 4), dtype=torch.uint8, device=dev)
                if bits & 1 else None,
                torch.empty((n, H, W, 4), dtype=torch.float16, device=dev)
                if bits & 2 else None,
                torch.empty((n, H, W), dtype=torch.float32, device=dev)
                if bits & 4 else None,
                torch.empty((n, H, W), dtype=seg, device=dev)
                if bits & 8 else None]

    def _run(self, cam, bits, dst=None):
        """Renders every env chunk by chunk; yields ``(e0, e1, raw)`` with the
        raw buffers of the chunk (``dst`` slices when given)."""
        torch = self.torch
        self._sync(cam)
        view = self._view(cam, bits)
        P = self._poses(cam)
        I, H, W, C = cam.instances, cam.height, cam.width, view.chunk
        n_chunks = -(-I // C)
        seed0 = zlib.crc32(np.array([self._sensor_seed, self._renders],
                                    np.int64).tobytes())
        self._renders += 1
        if not self.zero_copy:
            for k in range(n_chunks):
                e0, e1 = k * C, min(I, (k + 1) * C)
                if not self._r.launch(view.id, 0, e0, e1 - e0,
                                      poses_host=P[e0:e1], seed=seed0,
                                      outputs=bits):
                    raise RuntimeError("RasterRenderer: launch failed")
                host = [None if b is None else b.numpy()
                        for b in self._raw(e1 - e0, H, W, bits,
                                           torch.device("cpu"))]
                if not self._r.collect_host(view.id, 0, e1 - e0, host):
                    raise RuntimeError("RasterRenderer: readback failed")
                raw = [None if h is None else torch.from_numpy(h).to(self.dev)
                       for h in host]
                if dst is not None:
                    for d, r in zip(dst, raw):
                        if d is not None:
                            d[e0:e1] = r
                    raw = [None if d is None else d[e0:e1] for d in dst]
                yield e0, e1, raw
            return
        stream = torch.cuda.current_stream(P.device).cuda_stream
        pitch = P.stride(0) * 4

        def launch(k):
            e0, e1 = k * C, min(I, (k + 1) * C)
            if not self._r.launch(view.id, k % view.sets, e0, e1 - e0,
                                  P[e0].data_ptr(), pitch, None, stream,
                                  seed0, bits):
                raise RuntimeError("RasterRenderer: launch failed")

        launch(0)
        for k in range(n_chunks):
            if view.sets > 1 and k + 1 < n_chunks:
                launch(k + 1)
            e0, e1 = k * C, min(I, (k + 1) * C)
            if dst is not None:
                raw = [None if d is None else d[e0:e1] for d in dst]
            else:
                s = k % view.sets
                if s not in view.bufs or view.bufs[s][0] != bits:
                    view.bufs[s] = (bits, self._raw(C, H, W, bits, P.device))
                raw = [None if b is None else b[:e1 - e0]
                       for b in view.bufs[s][1]]
            ptrs = [0 if r is None else r.data_ptr() for r in raw]
            if not self._r.collect(view.id, k % view.sets, e1 - e0, ptrs,
                                   stream):
                raise RuntimeError("RasterRenderer: collect failed")
            yield e0, e1, raw
            if view.sets == 1 and k + 1 < n_chunks:
                launch(k + 1)

    @staticmethod
    def _bits(outputs):
        bits = 0
        for o in outputs:
            bits |= _BITS[o]
        return bits

    def render_chunks(self, camera, outputs=("rgb",)):
        """Yields ``(e0, e1, images)`` for consecutive env ranges of at most
        ``chunk`` envs, with the images in their raw GPU form: ``"rgb"``
        uint8 sRGB ``[n, H, W, 3]`` (a view of RGBA), ``"linear"`` float16
        ``[n, H, W, 3]`` (a view), ``"depth"`` float32 ``[n, H, W]``,
        ``"segmentation"`` int16 (int32 on GPUs without 16-bit storage
        textures) ``[n, H, W]``, -1 = nothing. The buffers are reused: use
        or copy a chunk before requesting the one after the next. Work on
        torch's current CUDA stream is ordered after the chunk."""
        cam = self._check(camera, outputs)
        bits = self._bits(outputs)
        for e0, e1, raw in self._run(cam, bits):
            yield e0, e1, self._as_dict(raw, outputs)

    @staticmethod
    def _as_dict(raw, outputs):
        out = {}
        if "rgb" in outputs:
            out["rgb"] = raw[0][..., :3]
        if "linear" in outputs:
            out["linear"] = raw[1][..., :3]
        if "depth" in outputs:
            out["depth"] = raw[2]
        if "segmentation" in outputs:
            out["segmentation"] = raw[3]
        return out

    def render(self, camera, outputs=("rgb",), *, raw=False) -> dict:
        """Every env's images (see :class:`~rillfacet.render.Renderer`):
        ``"rgb"`` float32 sRGB, ``"linear"`` float32, ``"depth"`` float32,
        ``"segmentation"`` int32. ``raw=True`` returns
        :meth:`render_chunks`' dtypes instead (uint8 rgb, float16 linear,
        int16 labels), for large batches."""
        torch = self.torch
        cam = self._check(camera, outputs)
        bits = self._bits(outputs)
        dst = self._raw(cam.instances, cam.height, cam.width, bits, self.dev)
        for _ in self._run(cam, bits, dst):
            pass
        out = self._as_dict(dst, outputs)
        if raw:
            return out
        if "rgb" in out:
            out["rgb"] = out["rgb"].float() / 255.0
        if "linear" in out:
            out["linear"] = out["linear"].float()
        if "segmentation" in out:
            out["segmentation"] = out["segmentation"].int()
        return out


def _qrot(q, v):
    """Rotate ``v`` ``[..., 3]`` by xyzw quaternions ``q`` ``[..., 4]``."""
    import torch
    qv, qw = q[..., :3], q[..., 3:]
    u = 2.0 * torch.linalg.cross(qv, v, dim=-1)
    return v + qw * u + torch.linalg.cross(qv, u, dim=-1)
