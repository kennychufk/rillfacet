"""rillfacet.assets: glTF / OBJ visual meshes and merge_bodies.

    PYTHONPATH=python python -m pytest tests -q
"""

import io
import json
import struct

import numpy as np
import pytest

from rillfacet.assets import load_gltf, load_mesh, load_obj, merge_bodies
from rillfacet.scene_api import Scene


def write_glb(path, nodes, meshes, materials, arrays, images=()):
    """A minimal GLB writer: ``arrays`` are (numpy array, glTF type) put
    into one buffer, one accessor each (index = position in the list);
    ``images`` PNG bytes, embedded as buffer views."""
    blob, views, accessors = b"", [], []
    ctype = {np.dtype(np.float32): 5126, np.dtype(np.uint32): 5125,
             np.dtype(np.uint16): 5123}
    for a, kind in arrays:
        a = np.ascontiguousarray(a)
        blob += b"\0" * (-len(blob) % 4)
        views.append(dict(buffer=0, byteOffset=len(blob), byteLength=a.nbytes))
        accessors.append(dict(bufferView=len(views) - 1,
                              componentType=ctype[a.dtype],
                              count=len(a), type=kind))
        blob += a.tobytes()
    image_docs = []
    for png in images:
        blob += b"\0" * (-len(blob) % 4)
        views.append(dict(buffer=0, byteOffset=len(blob), byteLength=len(png)))
        image_docs.append(dict(bufferView=len(views) - 1, mimeType="image/png"))
        blob += png
    blob += b"\0" * (-len(blob) % 4)
    doc = dict(asset=dict(version="2.0"), scene=0,
               scenes=[dict(nodes=list(range(len(nodes))))], nodes=nodes,
               meshes=meshes, materials=materials, accessors=accessors,
               bufferViews=views, buffers=[dict(byteLength=len(blob))])
    if image_docs:
        doc["images"] = image_docs
        doc["textures"] = [dict(source=i) for i in range(len(image_docs))]
    js = json.dumps(doc).encode()
    js += b" " * (-len(js) % 4)
    total = 12 + 8 + len(js) + 8 + len(blob)
    with open(path, "wb") as f:
        f.write(struct.pack("<4sII", b"glTF", 2, total))
        f.write(struct.pack("<II", len(js), 0x4E4F534A) + js)
        f.write(struct.pack("<II", len(blob), 0x004E4942) + blob)


QUAD_V = np.array([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], np.float32)
QUAD_N = np.tile([0, 0, 1.0], (4, 1)).astype(np.float32)
QUAD_UV = np.array([[0, 1], [1, 1], [1, 0], [0, 0]], np.float32)
QUAD_I = np.array([0, 1, 2, 0, 2, 3], np.uint32)


def test_gltf_nodes_materials_and_y_up(tmp_path):
    p = tmp_path / "a.glb"
    write_glb(p,
              nodes=[dict(mesh=0, translation=[0, 2, 0]),
                     dict(mesh=1, rotation=[0, 0, np.sin(np.pi / 4),
                                            np.cos(np.pi / 4)])],
              meshes=[dict(primitives=[dict(
                          attributes=dict(POSITION=0, NORMAL=1, TEXCOORD_0=2),
                          indices=3, material=0)]),
                      dict(primitives=[dict(attributes=dict(POSITION=0),
                                            indices=3)])],
              materials=[dict(name="URBlue", pbrMetallicRoughness=dict(
                  baseColorFactor=[0.5, 0.25, 1.0, 1.0], metallicFactor=0.2,
                  roughnessFactor=0.7))],
              arrays=[(QUAD_V, "VEC3"), (QUAD_N, "VEC3"), (QUAD_UV, "VEC2"),
                      (QUAD_I, "SCALAR")])
    a = load_gltf(p)
    assert a.vertices.shape == (8, 3) and a.triangles.shape == (4, 3)
    # glTF (x, y, z) -> (x, -z, y), node 0 lifted along glTF +y = z-up +z
    assert np.allclose(a.vertices[1], [1, 0, 2])
    assert np.allclose(a.vertices[3], [0, 0, 3])
    # node 1 rotated 90 deg about glTF z (= z-up -y): x -> glTF y -> z
    assert np.allclose(a.vertices[5], [0, 0, 1], atol=1e-6)
    assert np.allclose(a.normals[:4], [0, -1, 0])     # glTF +z -> -y
    assert a.uvs.shape == (8, 2)
    m0, m1 = a.materials
    assert m0.name == "URBlue" and m0.metallic == pytest.approx(0.2)
    assert m0.roughness == pytest.approx(0.7)
    assert m0.base_color[0] == pytest.approx(0.7354, abs=1e-3)   # linear .5
    assert m1.metallic == 1.0 and m1.roughness == 1.0           # glTF default
    assert list(a.triangle_material) == [0, 0, 1, 1]
    b = load_gltf(p, y_up=False, scale=2.0)
    assert np.allclose(b.vertices[3], [0, 6, 0])


def test_gltf_embedded_texture(tmp_path):
    Image = pytest.importorskip("PIL.Image")
    img = np.zeros((4, 8, 3), np.uint8)
    img[:, :4] = (255, 0, 0)
    buf = io.BytesIO()
    Image.fromarray(img).save(buf, format="PNG")
    p = tmp_path / "t.glb"
    write_glb(p, nodes=[dict(mesh=0)],
              meshes=[dict(primitives=[dict(
                  attributes=dict(POSITION=0, TEXCOORD_0=1), indices=2,
                  material=0)])],
              materials=[dict(name="tex", pbrMetallicRoughness=dict(
                  baseColorTexture=dict(index=0)))],
              arrays=[(QUAD_V, "VEC3"), (QUAD_UV, "VEC2"), (QUAD_I, "SCALAR")],
              images=[buf.getvalue()])
    a = load_mesh(p)
    tex = a.materials[0].base_color_texture
    assert tex.shape == (4, 8, 3) and tuple(tex[0, 0]) == (255, 0, 0)
    assert a.normals is None


def test_obj_with_mtl(tmp_path):
    (tmp_path / "m.mtl").write_text("newmtl red\nKd 1 0 0\nnewmtl blue\nKd 0 0 1\n")
    (tmp_path / "m.obj").write_text(
        "mtllib m.mtl\n"
        "v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nvt 0 0\nvt 1 0\nvt 1 1\nvt 0 1\n"
        "usemtl red\nf 1/1 2/2 3/3 4/4\n"
        "usemtl blue\nf -4/-4 -2/-2 -1/-1\n")
    a = load_obj(tmp_path / "m.obj")
    assert a.triangles.shape == (3, 3)
    assert [m.name for m in a.materials] == ["red", "blue"]
    assert np.allclose(a.materials[1].base_color, (0, 0, 1))
    assert list(a.triangle_material) == [0, 0, 1]
    assert np.allclose(a.uvs[0], [0, 1])                # flipped to top-left
    assert a.normals is None


def test_merge_bodies_into_a_rigid_mesh(tmp_path):
    (tmp_path / "a.obj").write_text("v 0 0 0\nv 1 0 0\nv 0 1 0\n"
                                    "usemtl grey\nf 1 2 3\n")
    (tmp_path / "b.obj").write_text("v 0 0 0\nv 1 0 0\nv 0 1 0\nv 0 0 1\n"
                                    "usemtl blue\nf 1 2 3\nusemtl grey\nf 1 2 4\n")
    a, b = load_obj(tmp_path / "a.obj"), load_obj(tmp_path / "b.obj")
    origin = np.array([0, 0, 1.0, 0, 0, np.sin(np.pi / 4), np.cos(np.pi / 4)])
    kw = merge_bodies([a, None, b], origins=[None, None, origin])
    assert list(kw["body_triangle_offsets"]) == [0, 1, 1, 3]
    assert [m.name for m in kw["materials"]] == ["grey", "blue"]
    assert list(kw["triangle_material"]) == [0, 1, 0]
    assert list(kw["vertex_body"]) == [0, 0, 0, 2, 2, 2, 2]
    # b's (1, 0, 0) rotated 90 deg about z, lifted 1
    assert np.allclose(kw["local_vertices"][4], [0, 1, 1], atol=1e-6)
    sc = Scene()
    m = sc.rigid_mesh("robot", **kw, instances=2)
    assert m.material_index("blue") == 1
    assert m.material_base_color.shape == (2, 2, 3)
