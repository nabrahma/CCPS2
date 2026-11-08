"""Minimal Wavefront OBJ reader for MakeHuman meshes (base mesh and MHCLO proxies)."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np


@dataclass
class ObjMesh:
    positions: np.ndarray  # (V, 3) float64, file units
    uvs: np.ndarray  # (T, 2) float64
    # Faces are stored as quads; triangles repeat their last vertex (MakeHuman convention).
    face_verts: np.ndarray  # (F, 4) int
    face_uvs: np.ndarray  # (F, 4) int, -1 when the file has no UVs
    face_group: np.ndarray  # (F,) int index into group_names
    face_material: np.ndarray  # (F,) int index into material_names
    group_names: list[str] = field(default_factory=list)
    material_names: list[str] = field(default_factory=list)
    is_triangle: np.ndarray | None = None  # (F,) bool


def read_obj(path: Path) -> ObjMesh:
    positions: list[list[float]] = []
    uvs: list[list[float]] = []
    fv: list[list[int]] = []
    ft: list[list[int]] = []
    fg: list[int] = []
    fm: list[int] = []
    tri: list[bool] = []
    groups: dict[str, int] = {}
    materials: dict[str, int] = {}
    cur_group = 0
    cur_mat = 0

    def group_index(name: str) -> int:
        if name not in groups:
            groups[name] = len(groups)
        return groups[name]

    def mat_index(name: str) -> int:
        if name not in materials:
            materials[name] = len(materials)
        return materials[name]

    cur_group = group_index("default")
    cur_mat = mat_index("default")

    with path.open("r", encoding="utf-8", errors="replace") as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            tag, _, rest = line.partition(" ")
            if tag == "v":
                positions.append([float(x) for x in rest.split()[:3]])
            elif tag == "vt":
                uvs.append([float(x) for x in rest.split()[:2]])
            elif tag == "f":
                corners = rest.split()
                vi: list[int] = []
                ti: list[int] = []
                for c in corners:
                    parts = c.split("/")
                    vi.append(_resolve(int(parts[0]), len(positions)))
                    ti.append(_resolve(int(parts[1]), len(uvs)) if len(parts) > 1 and parts[1] else -1)
                if len(vi) == 3:
                    vi.append(vi[2])
                    ti.append(ti[2])
                    tri.append(True)
                elif len(vi) == 4:
                    tri.append(False)
                else:
                    raise ValueError(f"{path}: n-gons with {len(vi)} corners are not supported")
                fv.append(vi)
                ft.append(ti)
                fg.append(cur_group)
                fm.append(cur_mat)
            elif tag == "g":
                cur_group = group_index(rest.strip() or "default")
            elif tag == "usemtl":
                cur_mat = mat_index(rest.strip())

    return ObjMesh(
        positions=np.asarray(positions, dtype=np.float64).reshape(-1, 3),
        uvs=np.asarray(uvs, dtype=np.float64).reshape(-1, 2),
        face_verts=np.asarray(fv, dtype=np.int64).reshape(-1, 4),
        face_uvs=np.asarray(ft, dtype=np.int64).reshape(-1, 4),
        face_group=np.asarray(fg, dtype=np.int64),
        face_material=np.asarray(fm, dtype=np.int64),
        group_names=list(groups.keys()),
        material_names=list(materials.keys()),
        is_triangle=np.asarray(tri, dtype=bool),
    )


def _resolve(index: int, count: int) -> int:
    """OBJ indices are 1-based; negative indices count from the end."""
    return index - 1 if index > 0 else count + index
