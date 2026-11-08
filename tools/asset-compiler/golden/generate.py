"""Generate golden fixtures from the MakeHuman oracle (PRD 8.1, M0).

Outputs (``packages/core/test/fixtures/golden/``):

* ``morph.json``           - per set: seed, modifier values, macro values, target weights
* ``morph_<NN>.bin``       - per set: float32 vertex positions in metres (19158 x 3)
* ``joints.json``          - per set: GameEngine joint heads/tails (MPFB strategy maths on the
                             oracle mesh) and MakeHuman default-rig joints (skeleton.py)
* ``proxies.json`` + ``proxy_<NN>_<asset>.bin`` - fitted vertex positions (proxy.py getCoords)
* ``expressions.json`` + ``expr_<NN>_<case>.bin`` - face pose units on the default rig (PRD F8):
                             per unit, the skinning matrix of every posed bone (bone.matPoseVerts),
                             and for a few blends the base-mesh deltas of MakeHuman's own posing
                             (Skeleton.setPose + skinMesh, minus the same skinning at rest)

Set 0 is the default character; sets 1..50 use fixed seeds.
"""

from __future__ import annotations

import json
import random
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

import mh_headless  # noqa: E402

from ps2cc_assets import fetch  # noqa: E402
from ps2cc_assets.paths import ASSETS_CORE, FIXTURES_DIR  # noqa: E402

OUT = FIXTURES_DIR / "golden"
RANDOM_SETS = 50
DM_TO_M = 0.1

GOLDEN_PROXIES = [
    ("clothes", "male_casualsuit01"),
    ("clothes", "female_casualsuit01"),
    ("clothes", "male_worksuit01"),
    ("clothes", "shoes01"),
    ("clothes", "fedora01"),
    ("hair", "bob01"),
    ("hair", "short02"),
    ("hair", "ponytail01"),
    ("eyebrows", "eyebrow001"),
    ("eyelashes", "eyelashes01"),
    ("eyes", "low-poly"),
]
# Proxy fitting is checked on a subset of sets to keep fixtures small.
PROXY_SETS = [0, 1, 2, 3, 7, 13]


def randomize(h, rng: random.Random) -> None:
    """Set a random but plausible character through MakeHuman's own API."""
    mods = h.modifiers
    macros = [m for m in mods if m.isMacro()]
    others = [m for m in mods if not m.isMacro()]
    for m in macros:
        if m.fullName.startswith("macrodetails/") and m.name in ("African", "Asian", "Caucasian"):
            continue
        m.setValue(rng.uniform(0.0, 1.0))
    # Ethnic blend goes through MakeHuman's normalisation.
    for name in rng.sample(["African", "Asian", "Caucasian"], 3):
        h.getModifier(f"macrodetails/{name}").setValue(rng.uniform(0.0, 1.0))
    for m in rng.sample(others, k=min(len(others), rng.randint(15, 60))):
        lo, hi = m.getMin(), m.getMax()
        m.setValue(rng.uniform(lo, hi))
    h.applyAllTargets()


def snapshot(h) -> dict:
    values = {}
    for m in h.modifiers:
        v = float(m.getValue())
        if abs(v - float(m.getDefaultValue())) > 1e-12 or m.isMacro():
            values[m.fullName] = v
    weights = {k: float(v) for k, v in h.targetsDetailStack.items()}
    data_root = str(mh_headless.MH_ROOT / "data").replace("\\", "/")
    rel = {}
    for path, w in weights.items():
        p = path.replace("\\", "/")
        idx = p.lower().find("/data/")
        rel[p[idx + len("/data/"):] if idx >= 0 else p] = w
    macros = {
        "gender": h.getGender(), "age": h.getAge(), "muscle": h.getMuscle(), "weight": h.getWeight(),
        "height": h.getHeight(), "proportions": h.getBodyProportions(), "african": h.getAfrican(),
        "asian": h.getAsian(), "caucasian": h.getCaucasian(), "breastSize": h.getBreastSize(),
        "breastFirmness": h.getBreastFirmness(),
    }
    _ = data_root
    return {"modifiers": values, "macros": {k: float(v) for k, v in macros.items()}, "targetWeights": rel}


def game_engine_joints(coord_m: np.ndarray) -> dict:
    rig = json.loads((ASSETS_CORE / "rigs" / "game_engine.json").read_text("utf-8"))
    out = {}
    for b in rig["bones"]:
        ends = []
        for end in (b["head"], b["tail"]):
            p = coord_m[np.asarray(end["vertices"])].astype(np.float64).mean(axis=0)
            if "offset" in end:
                p = p + np.asarray(end["offset"])
            ends.append(p.tolist())
        out[b["name"]] = {"head": ends[0], "tail": ends[1]}
    return out


def default_rig_joints(h, skeleton_mod) -> dict:
    import getpath

    skel = skeleton_mod.load(getpath.getSysDataPath("rigs/default.mhskel"), h.meshData)
    skel.updateJoints(h.meshData)
    out = {}
    for bone in skel.getBones():
        out[bone.name] = {
            "head": (np.asarray(bone.headPos, dtype=np.float64) * DM_TO_M).tolist(),
            "tail": (np.asarray(bone.tailPos, dtype=np.float64) * DM_TO_M).tolist(),
        }
    return out


def proxy_path(category: str, name: str) -> Path:
    root = fetch.source_dir("makehuman_system_assets")
    return root / category / name / f"{name}.mhclo"


# Unit-pose blends checked as mesh deltas (names from face-poseunits.json; weights as in .mhpose files).
EXPRESSION_CASES = {
    "jawdrop": {"JawDrop": 1.0},
    "lidclosed": {"LeftUpperLidClosed": 1.0},
    "mix3": {"JawDrop": 0.6, "LipsKiss": 0.5, "MouthLeftPullUp": 0.3},
    "brows": {"LeftInnerBrowUp": 0.8, "LeftOuterBrowUp": 0.8, "RightBrowDown": 1.0},
    "smile": {"MouthLeftPullUp": 1.0, "MouthRightPullUp": 1.0, "LeftCheekUp": 0.5, "RightCheekUp": 0.5},
}
EXPRESSION_SETS = [0, 7, 13]


def set_character(h, i: int) -> None:
    """Golden set i, exactly as run() builds it."""
    h.resetMeshValues()
    h.updateMacroModifiers()
    h.applyAllTargets()
    if i > 0:
        randomize(h, random.Random(1000 + i))


def expression_golden(h, i: int) -> dict:
    """MakeHuman's face posing (2_posing_expression.py) on the default rig of set i."""
    from collections import OrderedDict

    import animation
    import bvh
    import getpath
    import skeleton as mh_skeleton

    skel = mh_skeleton.load(getpath.getSysDataPath("rigs/default.mhskel"), h.meshData)
    skel.updateJoints(h.meshData)
    weights = skel.getVertexWeights().data
    base_bvh = bvh.load(getpath.getSysDataPath("poseunits/face-poseunits.bvh"), allowTranslation="none")
    track = base_bvh.createAnimationTrack(skel, name="Expression-Face-PoseUnits")
    meta = json.load(open(getpath.getSysDataPath("poseunits/face-poseunits.json"), "r", encoding="utf-8"), object_pairs_hook=OrderedDict)
    names = meta["framemapping"]
    units = animation.PoseUnit(track.name, track._data, names)
    bones = skel.getBones()

    coords = np.ones((h.meshData.coord.shape[0], 4), dtype=np.float32)
    coords[:, :3] = h.meshData.coord[:, :3]
    skel.setToRestPose()
    skel.update()
    rest = skel.skinMesh(coords, weights)

    def pose(blend: dict):
        data = units.getBlendedPose(list(blend.keys()), list(blend.values()), only_data=True)
        skel.setPose(data)

    def matrices() -> dict:
        out = {}
        for b in bones:
            m = np.asarray(b.matPoseVerts, dtype=np.float64)
            if np.abs(m - np.identity(4)).max() > 1e-5:  # float32 noise of setPose is ~1e-7
                m = m.copy()
                m[:3, 3] *= DM_TO_M
                out[b.name] = m.T.reshape(16).tolist()  # column-major, metres
        return out

    unit_mats = {}
    if i == 0:
        for name in names[1:]:
            pose({name: 1.0})
            unit_mats[name] = matrices()
    cases = {}
    for case, blend in EXPRESSION_CASES.items():
        pose(blend)
        delta = (skel.skinMesh(coords, weights) - rest) * DM_TO_M
        idx = np.nonzero(np.abs(delta).max(axis=1) > 1e-6)[0].astype(np.uint32)  # 1 um
        fname = f"expr_{i:02d}_{case}.bin"
        with open(OUT / fname, "wb") as f:
            f.write(idx.tobytes())
            f.write(delta[idx].astype(np.float32).tobytes())
        cases[case] = {"blend": blend, "file": fname, "count": int(len(idx)), "bones": matrices()}
    skel.setToRestPose()
    return {"index": i, "units": unit_mats, "cases": cases}


def run_expressions(h=None) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    if h is None:
        h, _hm = mh_headless.boot()
    sets = []
    for i in EXPRESSION_SETS:
        set_character(h, i)
        sets.append(expression_golden(h, i))
        print(f"  expression golden set {i:02d}", flush=True)
    meta = {
        "oracle": "makehuman@a8bc2d54ff0ac92e78ff71431b1023eda42bf482 (headless, unmodified core)",
        "units": "m",
        "binary": "u32 vertex indices, then float32 xyz deltas, for `count` vertices",
    }
    (OUT / "expressions.json").write_text(json.dumps({**meta, "sets": sets}) + "\n", encoding="utf-8")


def run() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    h, _hm = mh_headless.boot()
    import proxy as mh_proxy
    import skeleton as mh_skeleton

    morph_sets = []
    joint_sets = []
    proxy_sets = []
    loaded_proxies = {}
    for category, name in GOLDEN_PROXIES:
        p = proxy_path(category, name)
        ptype = {"clothes": "Clothes", "hair": "Hair", "eyebrows": "Eyebrows", "eyelashes": "Eyelashes", "eyes": "Eyes"}[category]
        loaded_proxies[(category, name)] = mh_proxy.loadTextProxy(h, str(p), ptype)

    for i in range(RANDOM_SETS + 1):
        # As in the GUI: resetMeshValues() empties the target stack, and the modifier task view's
        # reset handler (guimodifier.py) rebuilds the macro targets from the default macro values.
        h.resetMeshValues()
        h.updateMacroModifiers()
        h.applyAllTargets()
        seed = 0 if i == 0 else 1000 + i
        if i > 0:
            randomize(h, random.Random(seed))
        snap = snapshot(h)
        coord_m = h.meshData.coord.astype(np.float64) * DM_TO_M
        bin_name = f"morph_{i:02d}.bin"
        coord_m.astype(np.float32).tofile(OUT / bin_name)
        morph_sets.append({"index": i, "seed": seed, "positions": bin_name, **snap})

        joint_sets.append({
            "index": i,
            "gameEngine": game_engine_joints(coord_m),
            "default": default_rig_joints(h, mh_skeleton),
        })

        if i in PROXY_SETS:
            fitted = {}
            for (category, name), pxy in loaded_proxies.items():
                coords = pxy.getCoords().astype(np.float64) * DM_TO_M
                fname = f"proxy_{i:02d}_{category}_{name}.bin"
                coords.astype(np.float32).tofile(OUT / fname)
                fitted[f"mh:{category}/{name}"] = {"file": fname, "vertexCount": int(len(coords))}
            proxy_sets.append({"index": i, "proxies": fitted})
        print(f"  golden set {i:02d}: {len(snap['targetWeights'])} active targets", flush=True)

    meta = {
        "oracle": "makehuman@a8bc2d54ff0ac92e78ff71431b1023eda42bf482 (headless, unmodified core)",
        "units": "m",
        "vertexCount": int(h.meshData.coord.shape[0]),
    }
    (OUT / "morph.json").write_text(json.dumps({**meta, "sets": morph_sets}, indent=1) + "\n", encoding="utf-8")
    (OUT / "joints.json").write_text(json.dumps({**meta, "sets": joint_sets}) + "\n", encoding="utf-8")
    (OUT / "proxies.json").write_text(json.dumps({**meta, "sets": proxy_sets}, indent=1) + "\n", encoding="utf-8")
    print(f"  wrote {len(morph_sets)} morph sets, {len(proxy_sets)} proxy sets to {OUT}")
    run_expressions(h)


if __name__ == "__main__":
    if sys.argv[1:] == ["expressions"]:
        run_expressions()
    else:
        run()
