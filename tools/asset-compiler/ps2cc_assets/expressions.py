"""Stage: convert MakeHuman's face pose units (PRD F8) for blendshape baking.

``face-poseunits.bvh`` holds one frame per unit pose (named in
``face-poseunits.json``) on the default rig's face bones. MakeHuman reads it
with ``bvh.load(..., allowTranslation="none")``: the file is Z-up, so it is
converted to Y-up while reading (``BVHJoint.calculateFrames``), and each frame
is a per-bone rotation in world axes that ``Skeleton.setPose`` turns into a
local rotation about the bone's rest frame. Applied through the hierarchy
that is the world rotation about the bone's head, so only the rotation is
stored here: a unit quaternion ``[w, x, y, z]`` per posed bone and unit.

Output ``expressions/face_poseunits.json``.
"""

from __future__ import annotations

import json
import math

import numpy as np

from .basemesh import mh_data_dir
from .binfmt import write_json
from .paths import ASSETS_CORE

# Rotations below this angle (radians) count as rest, as in animation.isRest (matrix
# elements within 1e-5 of the identity). The "Rest" frame itself has rotations of ~1e-7.
REST_ANGLE = 1e-5


class _Joint:
    def __init__(self, name: str, parent: "_Joint | None") -> None:
        self.name = name
        self.parent = parent
        self.offset = np.zeros(3)
        self.channels: list[str] = []
        self.end = False


def _parse(text: str):
    tokens = text.split()
    pos = 0

    def take() -> str:
        nonlocal pos
        pos += 1
        return tokens[pos - 1]

    def expect(word: str) -> None:
        got = take()
        if got != word:
            raise RuntimeError(f"BVH: expected {word}, got {got}")

    joints: list[_Joint] = []

    def read_joint(j: _Joint) -> None:
        expect("{")
        expect("OFFSET")
        j.offset = np.array([float(take()), float(take()), float(take())])
        if j.end:
            expect("}")
            return
        expect("CHANNELS")
        j.channels = [take() for _ in range(int(take()))]
        joints.append(j)
        while True:
            word = take()
            if word == "}":
                return
            if word == "JOINT":
                read_joint(_Joint(take(), j))
            elif word == "End":
                expect("Site")
                e = _Joint("End effector", j)
                e.end = True
                read_joint(e)
            else:
                raise RuntimeError(f"BVH: unexpected {word}")

    expect("HIERARCHY")
    expect("ROOT")
    read_joint(_Joint(take(), None))
    expect("MOTION")
    expect("Frames:")
    frames = int(take())
    expect("Frame")
    expect("Time:")
    take()
    width = sum(len(j.channels) for j in joints)
    values = np.array([float(t) for t in tokens[pos:]], dtype=np.float64)
    if len(values) != frames * width:
        raise RuntimeError(f"BVH: {len(values)} values for {frames} frames of {width} channels")
    return joints, values.reshape(frames, width)


def _axis_matrix(axis: str, angle: float) -> np.ndarray:
    c, s = math.cos(angle), math.sin(angle)
    if axis == "x":
        return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])
    if axis == "y":
        return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def _joint_rotation(channels: list[str], row: np.ndarray, z_up: bool) -> np.ndarray:
    """BVHJoint.calculateFrames for one frame (rotation only).

    MakeHuman builds the axis order and angle list while walking the channels,
    then calls ``euler_matrix(a[2], a[1], a[0], axes="s" + order)``: with static
    axes that rotates about order[0] by a[2] first, then order[1] by a[1], then
    order[2] by a[0].
    """
    order = ""
    angles: list[float] = []
    for ch, v in zip(channels, row):
        a = math.radians(v)
        if ch == "Xrotation":
            order = "x" + order
            angles.append(a)
        elif ch == "Yrotation":
            order = ("z" if z_up else "y") + order
            angles.append(-a if z_up else a)
        elif ch == "Zrotation":
            order = ("y" if z_up else "z") + order
            angles.append(a)
    if len(angles) < 3:
        return np.identity(3)
    first, second, third = (_axis_matrix(order[i], angles[2 - i]) for i in range(3))
    return third @ second @ first


def _quaternion(m: np.ndarray) -> list[float]:
    """Unit quaternion [w, x, y, z] of a rotation matrix, w >= 0."""
    t = np.trace(m)
    if t > 0:
        s = math.sqrt(t + 1.0) * 2
        q = [0.25 * s, (m[2, 1] - m[1, 2]) / s, (m[0, 2] - m[2, 0]) / s, (m[1, 0] - m[0, 1]) / s]
    elif m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]:
        s = math.sqrt(1.0 + m[0, 0] - m[1, 1] - m[2, 2]) * 2
        q = [(m[2, 1] - m[1, 2]) / s, 0.25 * s, (m[0, 1] + m[1, 0]) / s, (m[0, 2] + m[2, 0]) / s]
    elif m[1, 1] > m[2, 2]:
        s = math.sqrt(1.0 + m[1, 1] - m[0, 0] - m[2, 2]) * 2
        q = [(m[0, 2] - m[2, 0]) / s, (m[0, 1] + m[1, 0]) / s, 0.25 * s, (m[1, 2] + m[2, 1]) / s]
    else:
        s = math.sqrt(1.0 + m[2, 2] - m[0, 0] - m[1, 1]) * 2
        q = [(m[1, 0] - m[0, 1]) / s, (m[0, 2] + m[2, 0]) / s, (m[1, 2] + m[2, 1]) / s, 0.25 * s]
    q = np.array(q)
    q /= np.linalg.norm(q)
    if q[0] < 0:
        q = -q
    return [round(float(x), 9) for x in q]


def _is_z_up(joints: list[_Joint]) -> bool:
    """bvh._autoGuessCoordinateSystem: the longest axis of the head joint's offset is up."""
    for name in ("head", "spine03", "spine02", "spine01"):
        j = next((j for j in joints if j.name == name), None)
        if j is not None:
            return int(np.argmax(np.abs(j.offset))) == 2
    raise RuntimeError("BVH: no reference joint to guess the up axis")


def convert_face_poseunits() -> list[str]:
    d = mh_data_dir() / "poseunits"
    meta = json.loads((d / "face-poseunits.json").read_text(encoding="utf-8"))
    names: list[str] = meta["framemapping"]
    joints, values = _parse((d / "face-poseunits.bvh").read_text(encoding="utf-8"))
    if len(names) != len(values):
        raise RuntimeError(f"face pose units: {len(values)} frames but {len(names)} names")
    z_up = _is_z_up(joints)

    rig = json.loads((ASSETS_CORE / "rigs" / "default.json").read_text(encoding="utf-8"))
    rig_bones = {b["name"] for b in rig["bones"]}

    units = []
    for f, name in enumerate(names):
        col = 0
        bones: dict[str, list[float]] = {}
        for j in joints:
            n = len(j.channels)
            m = _joint_rotation(j.channels, values[f, col : col + n], z_up)
            col += n
            angle = math.acos(max(-1.0, min(1.0, (np.trace(m) - 1) / 2)))
            if angle <= REST_ANGLE:
                continue
            if j.name not in rig_bones:
                raise RuntimeError(f"pose unit {name} poses {j.name}, which the default rig does not have")
            bones[j.name] = _quaternion(m)
        units.append({"name": name, "bones": bones})
    if units[0]["bones"]:
        raise RuntimeError("the first face pose unit should be the rest pose")

    out = {
        "format": "ps2cc.poseunits/1",
        "name": meta.get("name", "face pose units"),
        "rig": "default",
        "license": meta.get("license", "CC0"),
        "copyright": meta.get("copyright", ""),
        "note": "World-space rotation about each bone's head per unit pose, quaternion [w, x, y, z], engine axes (Y up).",
        "units": units,
    }
    write_json(ASSETS_CORE / "expressions" / "face_poseunits.json", out)
    posed = sorted({b for u in units for b in u["bones"]})
    print(f"  face pose units: {len(units)} units on {len(posed)} bones")
    return ["expressions/face_poseunits.json"]
