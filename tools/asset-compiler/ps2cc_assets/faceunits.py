"""Stage: the 52 ARKit face units and the hm08 mirror table (PRD Part 3, F25 and F27).

* ``expressions/faceunits``: Mika Suominen's faceunits01 targets (CC0), as
  shipped in Anny's repository: 52 MakeHuman targets on hm08, named like
  Apple's ARKit blendshapes. Packed like the modifier targets: per unit a
  list of vertex indices and int16 deltas with a per-unit scale, in metres.
  Made exactly symmetric first (D-160): a Left/Right pair becomes the mean
  of the left unit and the mirror image of the right one (and the right is
  the mirror image of that), a centre unit the mean of itself and its mirror
  image. The sculpts differ from their mirror images by up to 2.2 mm.
* ``basemesh/hm08_mirror``: for every hm08 vertex, the vertex at its mirror
  image across x = 0 (nearest mirrored vertex), checked to be one-to-one and
  against MPFB's own ``hm08.mirror``. Sculpt symmetry and the left/right
  checks of the face units use it.
"""

from __future__ import annotations

import numpy as np

from . import fetch
from .basemesh import mh_data_dir, mpfb_data_dir
from .binfmt import ContainerWriter
from .obj import read_obj
from .paths import ASSETS_CORE
from .units import DM_TO_M

# Apple ARKit's 52 blendshape locations, in ARKit's documentation order.
ARKIT = [
    "browDownLeft", "browDownRight", "browInnerUp", "browOuterUpLeft", "browOuterUpRight",
    "cheekPuff", "cheekSquintLeft", "cheekSquintRight",
    "eyeBlinkLeft", "eyeBlinkRight", "eyeLookDownLeft", "eyeLookDownRight", "eyeLookInLeft", "eyeLookInRight",
    "eyeLookOutLeft", "eyeLookOutRight", "eyeLookUpLeft", "eyeLookUpRight", "eyeSquintLeft", "eyeSquintRight",
    "eyeWideLeft", "eyeWideRight",
    "jawForward", "jawLeft", "jawOpen", "jawRight",
    "mouthClose", "mouthDimpleLeft", "mouthDimpleRight", "mouthFrownLeft", "mouthFrownRight", "mouthFunnel",
    "mouthLeft", "mouthLowerDownLeft", "mouthLowerDownRight", "mouthPressLeft", "mouthPressRight", "mouthPucker",
    "mouthRight", "mouthRollLower", "mouthRollUpper", "mouthShrugLower", "mouthShrugUpper", "mouthSmileLeft",
    "mouthSmileRight", "mouthStretchLeft", "mouthStretchRight", "mouthUpperUpLeft", "mouthUpperUpRight",
    "noseSneerLeft", "noseSneerRight",
    "tongueOut",
]
VERTEX_COUNT = 19158


def faceunit_dir():
    return fetch.source_dir("anny") / "src" / "anny" / "data" / "faceunits01" / "targets" / "faceunits"


def read_target(path) -> tuple[np.ndarray, np.ndarray]:
    idx: list[int] = []
    vec: list[list[float]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        parts = line.split()
        if not parts or parts[0].startswith("#"):
            continue
        idx.append(int(parts[0]))
        vec.append([float(parts[1]), float(parts[2]), float(parts[3])])
    order = np.argsort(np.asarray(idx), kind="stable")
    return np.asarray(idx, dtype=np.int64)[order], np.asarray(vec, dtype=np.float32).reshape(-1, 3)[order]


def mirror_name(name: str) -> str:
    if name.endswith("Left"):
        return name[:-4] + "Right"
    if name.endswith("Right"):
        return name[:-5] + "Left"
    return name


def mirrored(delta: np.ndarray, mirror: np.ndarray) -> np.ndarray:
    """The mirror image of a dense delta: vertex v gets its partner's delta with x negated."""
    out = delta[mirror].copy()
    out[:, 0] = -out[:, 0]
    return out


def build_faceunits(mirror: np.ndarray) -> list[str]:
    d = faceunit_dir()
    found = sorted(p.stem for p in d.glob("*.target"))
    if sorted(ARKIT) != found:
        raise RuntimeError(f"faceunits01 does not have exactly the 52 ARKit units: {sorted(set(found) ^ set(ARKIT))}")
    raw: dict[str, np.ndarray] = {}
    for name in ARKIT:
        idx, vec = read_target(d / f"{name}.target")
        if idx.size and (idx.min() < 0 or idx.max() >= VERTEX_COUNT):
            raise RuntimeError(f"{name}: vertex index outside hm08")
        if len(np.unique(idx)) != len(idx):
            raise RuntimeError(f"{name}: a vertex is listed twice")
        dense = np.zeros((VERTEX_COUNT, 3))
        dense[idx] = vec.astype(np.float64) * DM_TO_M
        raw[name] = dense
    sym: dict[str, np.ndarray] = {}
    worst = 0.0
    for name in ARKIT:
        other = mirror_name(name)
        if name.endswith("Left") or other == name:
            mean = 0.5 * (raw[name] + mirrored(raw[other], mirror))
            worst = max(worst, float(np.abs(raw[name] - mirrored(raw[other], mirror)).max()))
            sym[name] = mean
            if other != name:
                sym[other] = mirrored(mean, mirror)
    w = ContainerWriter()
    units = []
    all_idx, all_vec = [], []
    offset = 0
    for name in ARKIT:
        dense = sym[name]
        idx = np.nonzero(np.abs(dense).max(axis=1) > 0)[0]
        metres = dense[idx]
        max_abs = float(np.abs(metres).max()) if metres.size else 0.0
        scale = max_abs / 32767.0 if max_abs > 0 else 1.0
        all_idx.append(idx)
        all_vec.append(np.round(metres / scale).astype(np.int16))
        units.append({"name": name, "offset": offset, "count": int(len(idx)), "scale": scale, "maxM": max_abs})
        offset += len(idx)
    w.add("indices", np.concatenate(all_idx), "u16")
    w.add("deltas", np.concatenate(all_vec), "i16")
    w.write(ASSETS_CORE / "expressions" / "faceunits", {
        "format": "ps2cc.faceunits/1",
        "units": "m",
        "source": "faceunits01 by Mika Suominen (CC0-1.0), from Anny (naver/anny data/faceunits01); made exactly symmetric",
        "largestMirrorDifferenceBeforeM": worst,
        "faceUnits": units,
    })
    print(f"  face units: {len(units)} ARKit units, {offset} deltas; largest left/right mismatch before symmetrising {worst * 1000:.2f} mm")
    return ["expressions/faceunits.json", "expressions/faceunits.bin"]


def build_mirror() -> tuple[list[str], np.ndarray]:
    mesh = read_obj(mh_data_dir() / "3dobjs" / "base.obj")
    pos = np.asarray(mesh.positions, dtype=np.float64)
    if len(pos) != VERTEX_COUNT:
        raise RuntimeError("unexpected hm08 vertex count")
    # Nearest mirrored vertex, by sorting on a coarse grid then exact distances (no SciPy).
    mirrored = pos * np.array([-1.0, 1.0, 1.0])
    cell = 0.05  # decimetres
    keys = {}
    q = np.floor(pos / cell).astype(np.int64)
    for i, k in enumerate(map(tuple, q)):
        keys.setdefault(k, []).append(i)
    out = np.full(VERTEX_COUNT, -1, dtype=np.int64)
    dist = np.zeros(VERTEX_COUNT)
    for i in range(VERTEX_COUNT):
        c = np.floor(mirrored[i] / cell).astype(np.int64)
        best, bd = -1, np.inf
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    for j in keys.get((c[0] + dx, c[1] + dy, c[2] + dz), ()):
                        dd = float(np.sum((pos[j] - mirrored[i]) ** 2))
                        if dd < bd or (dd == bd and j < best):
                            best, bd = j, dd
        if best < 0:
            raise RuntimeError(f"vertex {i} has no mirror partner within {cell} dm")
        out[i] = best
        dist[i] = np.sqrt(bd)
    if len(np.unique(out)) != VERTEX_COUNT or not np.all(out[out] == np.arange(VERTEX_COUNT)):
        raise RuntimeError("the hm08 mirror table is not one-to-one")
    # MPFB's table must agree.
    mpfb = np.arange(VERTEX_COUNT)
    for line in (mpfb_data_dir() / "mesh_metadata" / "hm08.mirror").read_text(encoding="utf-8").splitlines():
        p = line.split()
        if len(p) >= 2:
            mpfb[int(p[0])] = int(p[1])
    disagree = int(np.sum(mpfb != out))
    w = ContainerWriter()
    w.add("mirror", out, "u32")
    w.write(ASSETS_CORE / "basemesh" / "hm08_mirror", {
        "format": "ps2cc.mirror/1",
        "note": "For every hm08 vertex, the vertex at its mirror image across x = 0 (nearest mirrored vertex on the base mesh); one-to-one.",
        "maxDistanceM": float(dist.max() * DM_TO_M),
        "disagreesWithMpfb": disagree,
    })
    print(f"  mirror: one-to-one, worst mismatch {dist.max() * DM_TO_M * 1000:.3f} mm, {disagree} differ from MPFB's table")
    if disagree:
        raise RuntimeError(f"{disagree} vertices differ from MPFB's hm08.mirror")
    return ["basemesh/hm08_mirror.json", "basemesh/hm08_mirror.bin"], out
