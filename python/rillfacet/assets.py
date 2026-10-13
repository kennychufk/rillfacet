"""Visual mesh assets for :class:`~rillfacet.scene_api.RigidMesh`.

The native format is glTF 2.0 (``.glb`` / ``.gltf``): PBR
metallic-roughness materials (what :class:`~rillfacet.scene_api.Material`
holds), UVs, normals and embedded textures in one file, written by Blender
and every DCC tool. Materials keep their names, so domain randomization
addresses them by name (``mesh.material_index("URBlue")``). OBJ (+ MTL) is
read too, for simple single-color meshes.

Load one asset per body (in that body's frame), then :func:`merge_bodies`
them into the arrays :meth:`Scene.rigid_mesh` takes::

    assets = [load_mesh(f"visual/{link}.glb") for link in links]
    mesh = scene.rigid_mesh("robot", **merge_bodies(assets), instances=E)

glTF is y-up; :func:`load_gltf` turns it z-up by default (Blender's
exporter maps its z-up to glTF's y-up with "+Y Up", so a mesh modelled in a
z-up robot link frame comes back in that frame). Units are meters.
"""
from __future__ import annotations

import base64
import json
import os
import struct
from dataclasses import dataclass, field

import numpy as np

from .scene_api import Material

__all__ = ["MeshAsset", "load_mesh", "load_gltf", "load_obj", "merge_bodies",
           "vertex_normals"]


@dataclass
class MeshAsset:
    """Triangles with optional normals / UVs and a material per triangle."""
    vertices: np.ndarray                       # [V, 3] float32
    triangles: np.ndarray                      # [T, 3] int64
    normals: np.ndarray | None = None          # [V, 3]
    uvs: np.ndarray | None = None              # [V, 2], origin top-left
    triangle_material: np.ndarray | None = None  # [T] index into materials
    materials: list = field(default_factory=list)

    def __post_init__(self):
        if self.triangle_material is None:
            self.triangle_material = np.zeros(len(self.triangles), np.int32)
        if not self.materials:
            self.materials = [Material("default")]


def load_mesh(path, **kw) -> MeshAsset:
    """:func:`load_gltf` or :func:`load_obj`, by extension."""
    ext = os.path.splitext(str(path))[1].lower()
    if ext in (".glb", ".gltf"):
        return load_gltf(path, **kw)
    if ext == ".obj":
        return load_obj(path, **kw)
    raise ValueError(f"load_mesh: unsupported format {ext!r} (glb, gltf, obj)")


def vertex_normals(vertices, triangles) -> np.ndarray:
    """Area-weighted vertex normals."""
    v = np.asarray(vertices, np.float64)
    t = np.asarray(triangles, np.int64)
    fn = np.cross(v[t[:, 1]] - v[t[:, 0]], v[t[:, 2]] - v[t[:, 0]])
    n = np.zeros_like(v)
    for k in range(3):
        np.add.at(n, t[:, k], fn)
    ln = np.linalg.norm(n, axis=1, keepdims=True)
    return (n / np.where(ln > 0, ln, 1.0)).astype(np.float32)


# --------------------------------------------------------------------------
# glTF 2.0
# --------------------------------------------------------------------------

_COMPONENT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16,
              5125: np.uint32, 5126: np.float32}
_NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT2": 4, "MAT3": 9,
          "MAT4": 16}
#: glTF y-up -> z-up: (x, y, z) -> (x, -z, y).
_Y_UP_TO_Z_UP = np.array([[1, 0, 0, 0], [0, 0, -1, 0], [0, 1, 0, 0],
                          [0, 0, 0, 1]], np.float64)


def _read_glb(path):
    with open(path, "rb") as f:
        data = f.read()
    magic, version, _ = struct.unpack_from("<4sII", data, 0)
    if magic != b"glTF" or version != 2:
        raise ValueError(f"{path}: not a glTF 2.0 binary")
    off, doc, binchunk = 12, None, None
    while off < len(data):
        n, kind = struct.unpack_from("<II", data, off)
        chunk = data[off + 8:off + 8 + n]
        if kind == 0x4E4F534A:
            doc = json.loads(chunk.decode("utf-8"))
        elif kind == 0x004E4942:
            binchunk = chunk
        off += 8 + n
    return doc, binchunk


def _buffers(doc, base_dir, binchunk):
    out = []
    for i, b in enumerate(doc.get("buffers", [])):
        uri = b.get("uri")
        if uri is None:
            if binchunk is None:
                raise ValueError("glTF: buffer without uri outside a .glb")
            out.append(binchunk)
        elif uri.startswith("data:"):
            out.append(base64.b64decode(uri.split(",", 1)[1]))
        else:
            with open(os.path.join(base_dir, uri), "rb") as f:
                out.append(f.read())
    return out


def _accessor(doc, buffers, index):
    a = doc["accessors"][index]
    if "sparse" in a:
        raise NotImplementedError("glTF: sparse accessors")
    dt = np.dtype(_COMPONENT[a["componentType"]])
    nc, count = _NCOMP[a["type"]], a["count"]
    if "bufferView" not in a:
        return np.zeros((count, nc), dt)
    bv = doc["bufferViews"][a["bufferView"]]
    buf = buffers[bv["buffer"]]
    start = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    stride = bv.get("byteStride", 0) or dt.itemsize * nc
    raw = np.frombuffer(buf, np.uint8, count=(count - 1) * stride
                        + dt.itemsize * nc, offset=start)
    rows = np.lib.stride_tricks.as_strided(
        raw, shape=(count, dt.itemsize * nc), strides=(stride, 1))
    out = np.ascontiguousarray(rows).view(dt).reshape(count, nc)
    if a.get("normalized") and dt != np.float32:
        info = np.iinfo(dt)
        out = np.maximum(out.astype(np.float32) / info.max, -1.0)
    return out


def _node_matrix(node):
    if "matrix" in node:
        return np.asarray(node["matrix"], np.float64).reshape(4, 4).T
    M = np.eye(4)
    x, y, z, w = node.get("rotation", [0, 0, 0, 1])
    R = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                  [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                  [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
    M[:3, :3] = R * np.asarray(node.get("scale", [1, 1, 1]))[None]
    M[:3, 3] = node.get("translation", [0, 0, 0])
    return M


def _image(doc, buffers, base_dir, index):
    img = doc["images"][index]
    uri = img.get("uri")
    if uri is not None and not uri.startswith("data:"):
        return os.path.join(base_dir, uri)
    if uri is not None:
        data = base64.b64decode(uri.split(",", 1)[1])
    else:
        bv = doc["bufferViews"][img["bufferView"]]
        o = bv.get("byteOffset", 0)
        data = buffers[bv["buffer"]][o:o + bv["byteLength"]]
    try:
        from PIL import Image
    except ImportError as e:
        raise ImportError("embedded glTF textures need Pillow "
                          "(pip install pillow)") from e
    import io
    return np.asarray(Image.open(io.BytesIO(data)).convert("RGB"))


def _gltf_material(doc, buffers, base_dir, index):
    if index is None:
        return Material("default", (1, 1, 1), metallic=1.0, roughness=1.0)
    m = doc["materials"][index]
    pbr = m.get("pbrMetallicRoughness", {})
    tex = None
    if "baseColorTexture" in pbr:
        if pbr["baseColorTexture"].get("texCoord", 0) != 0:
            raise NotImplementedError("glTF: base color on TEXCOORD_1")
        src = doc["textures"][pbr["baseColorTexture"]["index"]].get("source")
        if src is not None:
            tex = _image(doc, buffers, base_dir, src)
    color = pbr.get("baseColorFactor", [1, 1, 1, 1])[:3]
    # glTF factors are linear; Material holds sRGB.
    srgb = [_linear_to_srgb(c) for c in color]
    return Material(m.get("name", f"material{index}"), srgb,
                    metallic=pbr.get("metallicFactor", 1.0),
                    roughness=pbr.get("roughnessFactor", 1.0),
                    base_color_texture=tex)


def _linear_to_srgb(c):
    c = min(max(float(c), 0.0), 1.0)
    return 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


def load_gltf(path, *, y_up=True, scale=1.0) -> MeshAsset:
    """All triangle primitives of the default scene, node transforms
    applied, as one :class:`MeshAsset` (materials by glTF material, in
    order). ``y_up`` turns glTF's y-up into z-up; ``scale`` multiplies the
    vertices."""
    path = str(path)
    base_dir = os.path.dirname(os.path.abspath(path))
    if path.lower().endswith(".glb"):
        doc, binchunk = _read_glb(path)
    else:
        with open(path) as f:
            doc, binchunk = json.load(f), None
    buffers = _buffers(doc, base_dir, binchunk)
    root = _Y_UP_TO_Z_UP if y_up else np.eye(4)
    root = root @ np.diag([scale, scale, scale, 1.0])

    mat_slot: dict = {}
    materials: list = []
    parts = []                                  # (v, t, n|None, uv|None, slot)

    def visit(ni, parent):
        node = doc["nodes"][ni]
        M = parent @ _node_matrix(node)
        if "mesh" in node:
            for prim in doc["meshes"][node["mesh"]]["primitives"]:
                if prim.get("mode", 4) != 4:
                    continue                    # points / lines
                at = prim["attributes"]
                v = _accessor(doc, buffers, at["POSITION"]).astype(np.float64)
                if "indices" in prim:
                    t = _accessor(doc, buffers, prim["indices"]).astype(
                        np.int64).reshape(-1, 3)
                else:
                    t = np.arange(len(v), dtype=np.int64).reshape(-1, 3)
                n = (_accessor(doc, buffers, at["NORMAL"]).astype(np.float64)
                     if "NORMAL" in at else None)
                uv = (_accessor(doc, buffers, at["TEXCOORD_0"]).astype(
                    np.float32) if "TEXCOORD_0" in at else None)
                v = v @ M[:3, :3].T + M[:3, 3]
                if n is not None:
                    n = n @ np.linalg.inv(M[:3, :3])     # inverse transpose
                    n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True),
                                    1e-12)
                if np.linalg.det(M[:3, :3]) < 0:
                    t = t[:, ::-1]
                key = prim.get("material")
                if key not in mat_slot:
                    mat_slot[key] = len(materials)
                    materials.append(_gltf_material(doc, buffers, base_dir,
                                                    key))
                parts.append((v, t, n, uv, mat_slot[key]))
        for c in node.get("children", []):
            visit(c, M)

    sc = doc.get("scene", 0)
    roots = (doc["scenes"][sc]["nodes"] if doc.get("scenes")
             else range(len(doc.get("nodes", []))))
    for r in roots:
        visit(r, root)
    if not parts:
        raise ValueError(f"{path}: no triangle meshes")
    return _concat(parts, materials)


def _concat(parts, materials) -> MeshAsset:
    any_n = any(p[2] is not None for p in parts)
    any_uv = any(p[3] is not None for p in parts)
    vs, ts, ns, uvs, tm, off = [], [], [], [], [], 0
    for v, t, n, uv, slot in parts:
        vs.append(v)
        ts.append(t + off)
        if any_n:
            ns.append(n if n is not None else vertex_normals(v, t))
        if any_uv:
            uvs.append(uv if uv is not None else np.zeros((len(v), 2)))
        tm.append(np.full(len(t), slot, np.int32))
        off += len(v)
    return MeshAsset(
        np.concatenate(vs).astype(np.float32), np.concatenate(ts),
        np.concatenate(ns).astype(np.float32) if any_n else None,
        np.concatenate(uvs).astype(np.float32) if any_uv else None,
        np.concatenate(tm), materials)


# --------------------------------------------------------------------------
# OBJ
# --------------------------------------------------------------------------

def _read_mtl(path):
    mats, cur = {}, None
    with open(path) as f:
        for line in f:
            p = line.split()
            if not p:
                continue
            if p[0] == "newmtl":
                cur = mats[p[1]] = {}
            elif cur is not None and p[0] == "Kd":
                cur["Kd"] = [float(x) for x in p[1:4]]
            elif cur is not None and p[0] == "map_Kd":
                cur["map_Kd"] = os.path.join(os.path.dirname(path), p[-1])
    return mats


def load_obj(path, *, scale=1.0) -> MeshAsset:
    """Wavefront OBJ: polygons fan-triangulated, ``usemtl`` groups as
    materials (``Kd`` color, ``map_Kd`` texture from the ``mtllib``;
    metallic 0, roughness 0.5). UVs are flipped to the top-left origin."""
    path = str(path)
    P, UV, N = [], [], []
    verts: dict = {}
    order: list = []
    tris, tmat = [], []
    mtl: dict = {}
    names = ["default"]
    cur = 0
    with open(path) as f:
        for line in f:
            p = line.split()
            if not p:
                continue
            tag = p[0]
            if tag == "v":
                P.append([float(x) for x in p[1:4]])
            elif tag == "vt":
                UV.append([float(p[1]), 1.0 - float(p[2]) if len(p) > 2 else 0.0])
            elif tag == "vn":
                N.append([float(x) for x in p[1:4]])
            elif tag == "mtllib":
                mp = os.path.join(os.path.dirname(path), " ".join(p[1:]))
                if os.path.exists(mp):
                    mtl.update(_read_mtl(mp))
            elif tag == "usemtl":
                name = " ".join(p[1:])
                if name not in names:
                    names.append(name)
                cur = names.index(name)
            elif tag == "f":
                idx = []
                for w in p[1:]:
                    s = (w.split("/") + ["", ""])[:3]
                    key = tuple(int(x) if x else 0 for x in s)
                    key = tuple(k - 1 if k > 0 else
                                (k + (len(P), len(UV), len(N))[i] if k < 0
                                 else -1)
                                for i, k in enumerate(key))
                    if key not in verts:
                        verts[key] = len(order)
                        order.append(key)
                    idx.append(verts[key])
                for k in range(1, len(idx) - 1):
                    tris.append((idx[0], idx[k], idx[k + 1]))
                    tmat.append(cur)
    if not tris:
        raise ValueError(f"{path}: no faces")
    P = np.asarray(P, np.float64) * scale
    keys = np.asarray(order, np.int64)
    v = P[keys[:, 0]]
    uv = (np.asarray(UV, np.float32)[keys[:, 1]]
          if UV and np.all(keys[:, 1] >= 0) else None)
    n = (np.asarray(N, np.float32)[keys[:, 2]]
         if N and np.all(keys[:, 2] >= 0) else None)
    used = sorted(set(tmat))
    remap = {s: i for i, s in enumerate(used)}
    materials = []
    for s in used:
        m = mtl.get(names[s], {})
        materials.append(Material(
            names[s], [_linear_to_srgb(c) for c in m.get("Kd", [0.8] * 3)],
            metallic=0.0, roughness=0.5, base_color_texture=m.get("map_Kd")))
    return MeshAsset(v.astype(np.float32), np.asarray(tris, np.int64), n, uv,
                     np.asarray([remap[s] for s in tmat], np.int32), materials)


# --------------------------------------------------------------------------
# bodies -> one rigid mesh
# --------------------------------------------------------------------------

def merge_bodies(assets, origins=None) -> dict:
    """Keyword arguments of :meth:`Scene.rigid_mesh` for bodies with one
    :class:`MeshAsset` each (``None`` = no geometry): body-local vertices,
    triangles grouped by body, normals and UVs (filled in for assets
    without), and the materials merged BY NAME across bodies (the first
    definition wins). ``origins`` ``[B, 7]`` (or None per body) place each
    asset in its body's frame (a URDF visual origin)."""
    from .scene_api import compose
    vs, ts, ns, uvs, tm, vb, tri_off = [], [], [], [], [], [], [0]
    materials, slot_of = [], {}
    any_n = any(a is not None and a.normals is not None for a in assets)
    any_uv = any(a is not None and a.uvs is not None for a in assets)
    off = 0
    for b, a in enumerate(assets):
        if a is None:
            tri_off.append(tri_off[-1])
            continue
        v = a.vertices.astype(np.float64)
        n = a.normals
        o = None if origins is None else origins[b]
        if o is not None:
            o = np.asarray(o, np.float64)
            p = np.concatenate([v, np.tile([0, 0, 0, 1.0], (len(v), 1))], 1)
            v = compose(o[None], p)[:, :3]
            if n is not None:
                r = np.concatenate([np.zeros(3), o[3:]])
                q = np.concatenate([n, np.tile([0, 0, 0, 1.0], (len(n), 1))], 1)
                n = compose(r[None], q)[:, :3]
        local_slots = []
        for m in a.materials:
            if m.name not in slot_of:
                slot_of[m.name] = len(materials)
                materials.append(m)
            local_slots.append(slot_of[m.name])
        vs.append(v)
        ts.append(a.triangles + off)
        if any_n:
            ns.append(n if n is not None else vertex_normals(v, a.triangles))
        if any_uv:
            uvs.append(a.uvs if a.uvs is not None else np.zeros((len(v), 2)))
        tm.append(np.asarray(local_slots, np.int32)[a.triangle_material])
        vb.append(np.full(len(v), b, np.int64))
        tri_off.append(tri_off[-1] + len(a.triangles))
        off += len(v)
    if not vs:
        raise ValueError("merge_bodies: no geometry")
    return dict(
        local_vertices=np.concatenate(vs).astype(np.float32),
        vertex_body=np.concatenate(vb),
        triangles=np.concatenate(ts),
        body_triangle_offsets=np.asarray(tri_off, np.int64),
        normals=(np.concatenate(ns).astype(np.float32) if any_n else None),
        uvs=(np.concatenate(uvs).astype(np.float32) if any_uv else None),
        materials=materials, triangle_material=np.concatenate(tm))
