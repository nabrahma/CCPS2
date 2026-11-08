"""Stage: convert the hm08 base mesh to the engine format."""

from __future__ import annotations

import json

import numpy as np

from . import fetch
from .binfmt import ContainerWriter
from .obj import read_obj
from .paths import ASSETS_CORE
from .units import dm_to_m

BODY_VERTEX_COUNT = 13380  # PRD 3.1: body = vertices 0..13379


def mh_data_dir():
    return fetch.source_dir("makehuman") / "makehuman" / "data"


def mpfb_data_dir():
    return fetch.source_dir("mpfb2") / "src" / "mpfb" / "data"


def run() -> dict:
    src = mh_data_dir() / "3dobjs" / "base.obj"
    mesh = read_obj(src)
    vcount = len(mesh.positions)
    if vcount != 19158:
        raise RuntimeError(f"unexpected hm08 vertex count {vcount} (expected 19158)")
    if mesh.is_triangle is not None and mesh.is_triangle.any():
        raise RuntimeError("hm08 should be quads only")

    groups_path = mpfb_data_dir() / "mesh_metadata" / "basemesh_vertex_groups.json"
    vertex_groups = json.loads(groups_path.read_text(encoding="utf-8"))

    # Face groups as contiguous ranges (OBJ "g" statements come in blocks).
    face_groups: list[dict] = []
    fg = mesh.face_group
    start = 0
    for i in range(1, len(fg) + 1):
        if i == len(fg) or fg[i] != fg[start]:
            face_groups.append({"name": mesh.group_names[fg[start]], "start": int(start), "count": int(i - start)})
            start = i

    w = ContainerWriter()
    w.add("positions", dm_to_m(mesh.positions), "f32")
    w.add("uvs", mesh.uvs, "f32")
    w.add("faceVerts", mesh.face_verts, "u32")
    w.add("faceUvs", mesh.face_uvs, "u32")
    w.add("faceGroup", fg, "u16")
    meta = {
        "format": "ps2cc.basemesh/1",
        "name": "hm08",
        "units": "m",
        "vertexCount": vcount,
        "uvCount": int(len(mesh.uvs)),
        "faceCount": int(len(mesh.face_verts)),
        "bodyVertexCount": BODY_VERTEX_COUNT,
        "groupNames": mesh.group_names,
        "faceGroups": face_groups,
        "vertexGroups": vertex_groups,
        "source": "mh:3dobjs/base.obj",
    }
    w.write(ASSETS_CORE / "basemesh" / "hm08", meta)
    print(f"  basemesh: {vcount} verts, {len(mesh.face_verts)} quads, {len(mesh.group_names)} groups")
    return {"files": ["basemesh/hm08.json", "basemesh/hm08.bin"], "source": "makehuman"}
