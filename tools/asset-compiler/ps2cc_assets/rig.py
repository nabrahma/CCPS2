"""Stage: convert rigs and skin weights.

* ``game_engine``: MPFB2's GameEngine rig (no breast bones), the export skeleton.
  Bone ends are resolved to vertex lists: CUBE -> the joint cube's vertices,
  MEAN -> the listed vertices. The engine takes the mean of the (morphed)
  vertices plus an optional offset, exactly as MPFB's ``Rig.get_best_location_from_strategy``.
* ``default``: MakeHuman's default rig (with face bones), used for baking
  expression blendshapes (F8). Joints are MakeHuman joint vertex lists.
"""

from __future__ import annotations

import json

import numpy as np

from .basemesh import mh_data_dir, mpfb_data_dir
from .binfmt import ContainerWriter, write_json
from .paths import ASSETS_CORE
from .units import blender_to_engine


def _vertex_group(groups: dict, name: str) -> list[int]:
    out: list[int] = []
    for a, b in groups[name]:
        out.extend(range(a, b + 1))
    return out


def _resolve_end(end: dict, groups: dict) -> dict:
    strategy = end["strategy"]
    if strategy == "CUBE":
        verts = _vertex_group(groups, end["cube_name"])
        label = end["cube_name"]
    elif strategy == "MEAN":
        verts = list(end["vertex_indices"])
        label = "mean"
    elif strategy == "VERTEX":
        verts = [int(end["vertex_index"])]
        label = "vertex"
    else:
        raise RuntimeError(f"unsupported bone end strategy {strategy}")
    if not verts:
        raise RuntimeError(f"bone end {end} resolves to no vertices")
    out = {"vertices": verts, "source": label}
    if "offset" in end and any(abs(x) > 0 for x in end["offset"]):
        out["offset"] = blender_to_engine(end["offset"])  # metres
    return out


def _write_weights(name: str, bones: list[str], weights: dict[str, list]) -> None:
    w = ContainerWriter()
    table = []
    verts: list[int] = []
    vals: list[float] = []
    for bone in bones:
        entries = weights.get(bone, [])
        table.append({"bone": bone, "offset": len(verts), "count": len(entries)})
        for v, wt in entries:
            verts.append(int(v))
            vals.append(float(wt))
    w.add("vertex", np.asarray(verts, dtype=np.uint32), "u32")
    w.add("weight", np.asarray(vals, dtype=np.float32), "f32")
    w.write(ASSETS_CORE / "rigs" / f"{name}.weights", {"format": "ps2cc.weights/1", "rig": name, "bones": table})


def convert_game_engine() -> list[str]:
    data = mpfb_data_dir()
    rig = json.loads((data / "rigs" / "standard" / "rig.game_engine.json").read_text(encoding="utf-8"))
    if "bones" in rig:  # newer MPFB format wraps bones
        rig = rig["bones"]
    groups = json.loads((data / "mesh_metadata" / "basemesh_vertex_groups.json").read_text(encoding="utf-8"))

    # Order bones parent-first so the engine can fit them in one pass.
    names = list(rig.keys())
    ordered: list[str] = []
    placed: set[str] = set()
    while len(ordered) < len(names):
        progressed = False
        for n in names:
            if n in placed:
                continue
            parent = rig[n].get("parent") or ""
            if parent == "" or parent in placed:
                ordered.append(n)
                placed.add(n)
                progressed = True
        if not progressed:
            raise RuntimeError("cycle in rig hierarchy")

    bones = []
    for n in ordered:
        b = rig[n]
        bones.append(
            {
                "name": n,
                "parent": b.get("parent") or None,
                "head": _resolve_end(b["head"], groups),
                "tail": _resolve_end(b["tail"], groups),
                "roll": float(b.get("roll", 0.0)),
                "connected": bool(b.get("use_connect", False)),
            }
        )
    write_json(ASSETS_CORE / "rigs" / "game_engine.json", {"format": "ps2cc.rig/1", "name": "game_engine", "bones": bones})

    wdata = json.loads((data / "rigs" / "standard" / "weights.game_engine.json").read_text(encoding="utf-8"))
    _write_weights("game_engine", ordered, wdata["weights"])
    print(f"  rig game_engine: {len(bones)} bones")
    return ["rigs/game_engine.json", "rigs/game_engine.weights.json", "rigs/game_engine.weights.bin"]


def convert_default() -> list[str]:
    d = mh_data_dir() / "rigs"
    skel = json.loads((d / "default.mhskel").read_text(encoding="utf-8"))
    joints = skel["joints"]
    # Breadth-first from the roots, children in file order: Skeleton.getBones() order, parent-first.
    defs = skel["bones"]
    children: dict[str | None, list[str]] = {}
    for name, b in defs.items():
        children.setdefault(b.get("parent"), []).append(name)
    order: list[str] = []
    queue = list(children.get(None, []))
    while queue:
        name = queue.pop(0)
        order.append(name)
        queue.extend(children.get(name, []))
    if len(order) != len(defs):
        raise RuntimeError("default rig: bones not reachable from a root")
    bones = []
    for name in order:
        b = defs[name]
        bones.append(
            {
                "name": name,
                "parent": b.get("parent"),
                "head": {"vertices": joints[b["head"]], "source": b["head"]},
                "tail": {"vertices": joints[b["tail"]], "source": b["tail"]},
                "roll": float(b.get("roll", 0.0)),
                "rotationPlane": b.get("rotation_plane"),
                "connected": False,
            }
        )
    write_json(ASSETS_CORE / "rigs" / "default.json", {"format": "ps2cc.rig/1", "name": "default", "bones": bones})
    wdata = json.loads((d / "default_weights.mhw").read_text(encoding="utf-8"))
    _write_weights("default", [b["name"] for b in bones], wdata["weights"])
    print(f"  rig default: {len(bones)} bones")
    return ["rigs/default.json", "rigs/default.weights.json", "rigs/default.weights.bin"]
