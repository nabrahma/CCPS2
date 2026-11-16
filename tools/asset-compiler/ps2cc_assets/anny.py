"""Stage: data taken from Anny (NAVER LABS Europe) for PRD Part 3, F23.

Anny is built on the same hm08 mesh and the same MakeHuman targets as PS2CC
(its copy is MPFB2's). Three things come from it:

* ``extras_modifier_file`` - sliders for the MakeHuman targets that no
  MakeHuman slider uses and that MPFB2 and Anny expose: the 31 left/right
  asymmetry pairs, the foot and lower-leg scales, and the triangular chin.
  The targets themselves are MakeHuman's own files (CC0).
* ``calibration`` - Anny's population calibration (Beta distributions of
  height, weight, muscle and proportions conditioned on age, and its age
  mapping), read from ``shape_calibration/*.pth`` into JSON. The tensors are
  read with a restricted unpickler: no PyTorch, and no code from the file runs.
* ``parity`` - the oracle for the parity check: Anny's phenotype blending
  (``models/phenotype.py`` and ``models/full_model.py``), transcribed to
  NumPy, evaluated for 50 seeded phenotype sets. Anny itself needs PyTorch,
  which the asset compiler does not use, so the transcription stands in for
  it; it reads Anny's own target files.

Anny's ``smplx``/``smpl`` topology is never fetched or read.
"""

from __future__ import annotations

import gzip
import io
import json
import pickle
import random
import zipfile
from collections import OrderedDict
from pathlib import Path

import numpy as np

from . import fetch
from .basemesh import BODY_VERTEX_COUNT, mh_data_dir
from .binfmt import write_json
from .paths import ASSETS_CORE, FIXTURES_DIR
from .units import DM_TO_M

VERTEX_COUNT = 19158


def anny_data_dir() -> Path:
    return fetch.source_dir("anny") / "src" / "anny" / "data"


# --------------------------------------------------------------------------- extra sliders

ASYM_FACE = ["brown", "cheek", "ear", "eye", "jaw", "mouth", "nose", "temple", "top"]
ASYM_LABEL = {
    "brown": "Brow", "cheek": "Cheek", "ear": "Ear", "eye": "Eye", "jaw": "Jaw", "mouth": "Mouth",
    "nose": "Nose", "temple": "Temple", "top": "Top of head", "breast": "Chest", "trunk": "Trunk",
}


def extras_modifier_file() -> dict:
    """Modifier and slider definitions, in MakeHuman's own JSON shape, for targets MakeHuman ships but has no slider for."""
    tdir = mh_data_dir() / "targets"
    pairs: list[str] = sorted({p.name[: -len("-l.target")] for p in (tdir / "asym").glob("*-l.target")})
    for name in pairs:
        if not (tdir / "asym" / f"{name}-r.target").exists():
            raise RuntimeError(f"asymmetry target {name} has no right side")
    asym = [OrderedDict(target=name, min="l", max="r") for name in pairs]
    feet = []
    for side in ("l", "r"):
        for axis in ("depth", "horiz", "vert"):
            feet.append(OrderedDict(target=f"{side}-foot-scale-{axis}", min="decr", max="incr"))
        feet.append(OrderedDict(target=f"{side}-foot-trans", min="down", max="up"))
        feet.append(OrderedDict(target=f"{side}-lowerleg-scale-vert", min="decr", max="incr"))
    data = [
        OrderedDict(group="asym", modifiers=asym),
        OrderedDict(group="armslegs", modifiers=feet),
        OrderedDict(group="chin", modifiers=[OrderedDict(target="chin-triangle")]),
    ]

    def asym_entry(name: str) -> dict:
        _, part, number = name.split("-")
        return {"mod": f"asym/{name}-l|r", "label": f"{ASYM_LABEL[part]} {number}"}

    face = [asym_entry(n) for n in pairs if n.split("-")[1] in ASYM_FACE]
    body = [asym_entry(n) for n in pairs if n.split("-")[1] not in ASYM_FACE]
    if len(face) + len(body) != len(pairs):
        raise RuntimeError("asymmetry targets not all placed")
    axis_label = {"depth": "length", "horiz": "width", "vert": "height"}
    feet_sliders = []
    legs_sliders = []
    for side, side_label in (("l", "Left"), ("r", "Right")):
        for axis in ("depth", "horiz", "vert"):
            feet_sliders.append({"mod": f"armslegs/{side}-foot-scale-{axis}-decr|incr", "label": f"{side_label} foot {axis_label[axis]}"})
        feet_sliders.append({"mod": f"armslegs/{side}-foot-trans-down|up", "label": f"{side_label} foot down/up"})
        legs_sliders.append({"mod": f"armslegs/{side}-lowerleg-scale-vert-decr|incr", "label": f"{side_label} lower leg length"})
    sliders = OrderedDict(
        [
            ("Face", {"modifiers": OrderedDict([("asymmetry", face), ("chin", [{"mod": "chin/chin-triangle", "label": "Triangular chin"}])])}),
            ("Torso", {"modifiers": OrderedDict([("asymmetry", body)])}),
            ("Arms and Legs", {"modifiers": OrderedDict([("feet", feet_sliders), ("legs", legs_sliders)])}),
        ]
    )
    descriptions = {f"asym/{n}-l|r": "Moves one side only: left of centre for the left side, right of centre for the right." for n in pairs}
    return {"file": "extras", "data": data, "descriptions": descriptions, "sliders": sliders}


# --------------------------------------------------------------------------- calibration

_STORAGE_DTYPES = {"DoubleStorage": np.float64, "FloatStorage": np.float32, "LongStorage": np.int64}


def read_pth(path: Path) -> dict:
    """Read a PyTorch state dict of plain tensors without PyTorch. Only the names a tensor needs are allowed."""
    zf = zipfile.ZipFile(path)
    pkl = next(n for n in zf.namelist() if n.endswith("data.pkl"))
    root = pkl[: -len("data.pkl")]

    def rebuild(storage, offset, size, stride, *rest):
        count = int(np.prod(size)) if len(size) else 1
        return np.array(storage[offset : offset + count], dtype=np.float64).reshape(size)

    class Restricted(pickle.Unpickler):
        def find_class(self, module, name):
            if module == "collections" and name == "OrderedDict":
                return OrderedDict
            if module == "torch._utils" and name == "_rebuild_tensor_v2":
                return rebuild
            if module == "torch" and name in _STORAGE_DTYPES:
                return name
            raise pickle.UnpicklingError(f"{path.name}: {module}.{name} is not allowed")

        def persistent_load(self, pid):
            kind, typ, key, _location, _count = pid
            if kind != "storage":
                raise pickle.UnpicklingError(f"{path.name}: unexpected persistent id {kind}")
            return np.frombuffer(zf.read(f"{root}data/{key}"), dtype=_STORAGE_DTYPES[typ])

    return Restricted(io.BytesIO(zf.read(pkl))).load()


def calibration() -> dict:
    d = anny_data_dir() / "shape_calibration"
    out: dict = {
        "format": "ps2cc.population/1",
        "source": "Anny shape_calibration (boys.pth, girls.pth), Apache-2.0",
        "note": "Beta(alpha, beta) of each phenotype in [0, 1], linear in Anny's age parameter between anchors and constant outside them. ageMapping converts years to Anny's age parameter.",
    }
    for key, name in (("male", "boys"), ("female", "girls")):
        state = read_pth(d / f"{name}.pth")
        mapping = {
            "years": [float(v) for v in state["morphological_age_mapping"]["morphological_age_anchors"]],
            "annyAge": [float(v) for v in state["morphological_age_mapping"]["anny_age_anchors"]],
        }
        if "ageMapping" in out and out["ageMapping"] != mapping:
            raise RuntimeError("boys and girls age mappings differ")
        out["ageMapping"] = mapping
        out[key] = {}
        for phen in ("height", "weight", "muscle", "proportions"):
            dist = state[f"conditional_{phen}_distribution"]
            alpha = [float(v) for v in dist["alpha_anchors"]]
            beta = [float(v) for v in dist["beta_anchors"]]
            age = [float(v) for v in dist["age_anchors"]]
            if not (len(age) == len(alpha) == len(beta)) or min(alpha + beta) <= 0 or age != sorted(age):
                raise RuntimeError(f"{name}.pth: bad {phen} distribution")
            out[key][phen] = {"annyAge": age, "alpha": alpha, "beta": beta}
    write_json(ASSETS_CORE / "population" / "calibration.json", out)
    print("  population: calibration.json (2 genders x 4 phenotypes)")
    return {"files": ["population/calibration.json"], "source": "anny"}


# --------------------------------------------------------------------------- parity oracle

# models/model_data.py PHENOTYPE_VARIATIONS, in Anny's order.
VARIATIONS = OrderedDict(
    race=["african", "asian", "caucasian"],
    gender=["male", "female"],
    age=["newborn", "baby", "child", "young", "old"],
    muscle=["minmuscle", "averagemuscle", "maxmuscle"],
    weight=["minweight", "averageweight", "maxweight"],
    height=["minheight", "maxheight"],
    proportions=["idealproportions", "uncommonproportions"],
    cupsize=["mincup", "averagecup", "maxcup"],
    firmness=["minfirmness", "averagefirmness", "maxfirmness"],
)
PHENOTYPES = ["gender", "age", "muscle", "weight", "height", "proportions", "cupsize", "firmness", "african", "asian", "caucasian"]


def _anchors(label: str) -> np.ndarray:
    n = len(VARIATIONS[label])
    return np.linspace(-1 / 3, 1.0, n) if label == "age" else np.linspace(0.0, 1.0, n)


def _interp_coefficients(value: float, anchors: np.ndarray) -> np.ndarray:
    """utils/interpolation.py linear_interpolation_coefficients, extrapolate=False, for one value."""
    n = len(anchors)
    value = min(max(value, anchors[0]), anchors[-1])
    idx = int(np.searchsorted(anchors, value, side="left"))
    idx = min(max(idx, 1), n - 1)
    lo, hi = anchors[idx - 1], anchors[idx]
    alpha = (value - lo) / (hi - lo)
    out = np.zeros(n)
    out[idx - 1] = 1.0 - alpha
    out[idx] = alpha
    return out


def variation_weights(p: dict) -> dict[str, float]:
    """models/phenotype.py phenotype_blendshape_weights: the weight of every variation (e.g. 'young': 0.4)."""
    w: dict[str, float] = {}
    for label in ("age", "gender", "muscle", "weight", "height", "proportions", "cupsize", "firmness"):
        coeffs = _interp_coefficients(p[label], _anchors(label))
        for key, c in zip(VARIATIONS[label], coeffs):
            w[key] = float(c)
    total = p["african"] + p["asian"] + p["caucasian"]
    for key in VARIATIONS["race"]:
        w[key] = p[key] / total if total > 0 else 1 / 3
    return w


def blendshape_paths(root: Path, gz: bool) -> list[tuple[tuple[str, ...], Path]]:
    """models/full_model.py load_macrodetails: (components, file) of every phenotype blend shape (newborn left out)."""
    ext = ".target.gz" if gz else ".target"
    macro = root / "macrodetails"
    out: list[tuple[tuple[str, ...], Path]] = []
    ages = [a for a in VARIATIONS["age"] if a != "newborn"]
    for gender in VARIATIONS["gender"]:
        for age in ages:
            for muscle in VARIATIONS["muscle"]:
                for weight in VARIATIONS["weight"]:
                    out.append(((gender, age, muscle, weight), macro / f"universal-{gender}-{age}-{muscle}-{weight}{ext}"))
    for race in VARIATIONS["race"]:
        for gender in VARIATIONS["gender"]:
            for age in ages:
                out.append(((race, gender, age), macro / f"{race}-{gender}-{age}{ext}"))
    for gender in VARIATIONS["gender"]:
        for age in ages:
            for muscle in VARIATIONS["muscle"]:
                for weight in VARIATIONS["weight"]:
                    for height in VARIATIONS["height"]:
                        out.append(((gender, age, muscle, weight, height), macro / "height" / f"{gender}-{age}-{muscle}-{weight}-{height}{ext}"))
    for gender in VARIATIONS["gender"]:
        for age in ages:
            if age == "baby":
                continue
            for muscle in VARIATIONS["muscle"]:
                for weight in VARIATIONS["weight"]:
                    for prop in VARIATIONS["proportions"]:
                        out.append(((gender, age, muscle, weight, prop), macro / "proportions" / f"{gender}-{age}-{muscle}-{weight}-{prop}{ext}"))
    for age in ages:
        for muscle in VARIATIONS["muscle"]:
            for weight in VARIATIONS["weight"]:
                for cup in VARIATIONS["cupsize"]:
                    for firm in VARIATIONS["firmness"]:
                        path = root / "breast" / f"female-{age}-{muscle}-{weight}-{cup}-{firm}{ext}"
                        if path.exists():
                            out.append((("female", age, muscle, weight, cup, firm), path))
    return out


def read_target_dense(path: Path) -> np.ndarray:
    """Target deltas as a dense (19158, 3) float64 array, in decimetres."""
    opener = gzip.open if path.suffix == ".gz" else open
    out = np.zeros((VERTEX_COUNT, 3))
    with opener(path, "rt", encoding="utf-8") as f:
        for line in f:
            parts = line.split()
            if not parts or parts[0].startswith("#"):
                continue
            out[int(parts[0])] = [float(parts[1]), float(parts[2]), float(parts[3])]
    return out


def read_base(path: Path) -> np.ndarray:
    verts = [[float(x) for x in line.split()[1:4]] for line in path.read_text(encoding="utf-8").splitlines() if line.startswith("v ")]
    return np.asarray(verts, dtype=np.float64)


class Blender:
    """Anny's blend: template + sum over blend shapes of (product of its variation weights) x shape."""

    def __init__(self, root: Path, gz: bool, base: np.ndarray) -> None:
        self.base = base
        self.shapes = [(comp, read_target_dense(path), path) for comp, path in blendshape_paths(root, gz)]

    def quantised(self) -> "Blender":
        """The same blend with every shape rounded as PS2CC stores targets (int16 steps of max/32767 metres, D-004)."""
        other = Blender.__new__(Blender)
        other.base = self.base
        other.shapes = []
        for comp, shape, path in self.shapes:
            metres = np.asarray(shape, dtype=np.float32).astype(np.float64) * DM_TO_M
            max_abs = float(np.abs(metres).max())
            scale = max_abs / 32767.0 if max_abs > 0 else 1.0
            other.shapes.append((comp, np.round(metres / scale).astype(np.int16).astype(np.float64) * scale / DM_TO_M, path))
        return other

    def vertices(self, p: dict) -> np.ndarray:
        w = variation_weights(p)
        out = self.base.copy()
        for comp, shape, _path in self.shapes:
            c = 1.0
            for key in comp:
                c *= w[key]
            if c != 0.0:
                out += c * shape
        return out


def parity_sets() -> list[dict]:
    """50 seeded phenotype sets, child to old (PS2CC is adults only, and 18 to 25 mixes the child shapes in).

    The first 25 keep height and proportions at an end of their range, where
    Anny's two-anchor blend and MakeHuman's three-value one give the same
    weights, so those sets also have exact MakeHuman macro values.
    """
    sets = []
    for i in range(50):
        rng = random.Random(1900 + i)
        p = {k: rng.uniform(0.0, 1.0) for k in PHENOTYPES}
        p["age"] = rng.uniform(1 / 3, 1.0)
        if i < 25:
            p["height"] = float(rng.randint(0, 1))
            p["proportions"] = float(rng.randint(0, 1))
        sets.append(p)
    return sets


def parity() -> None:
    """Write the parity fixture: per set, Anny's blend on MakeHuman's target files (the model check) and its
    distance from the same blend on Anny's own files (the data check)."""
    out_dir = FIXTURES_DIR / "anny"
    out_dir.mkdir(parents=True, exist_ok=True)
    mh_targets = mh_data_dir() / "targets"
    an_targets = anny_data_dir() / "mpfb2" / "targets"
    base_mh = read_base(mh_data_dir() / "3dobjs" / "base.obj")
    base_an = read_base(anny_data_dir() / "mpfb2" / "3dobjs" / "base.obj")
    base_diff = float(np.abs(base_mh - base_an).max())
    on_mh = Blender(mh_targets, False, base_mh)
    on_anny = Blender(an_targets, True, base_an)
    stored = on_mh.quantised()
    body = BODY_VERTEX_COUNT

    differing = []
    for (comp, a, path_a), (_c, m, path_m) in zip(on_anny.shapes, on_mh.shapes):
        d = np.abs(a - m).max(axis=1)
        if d[:body].max() > 1e-6:
            differing.append({
                "target": "targets/" + path_m.relative_to(mh_targets).as_posix(),
                "maxBodyDifferenceM": float(d[:body].max() * DM_TO_M),
                "bodyVertices": int((d[:body] > 1e-6).sum()),
            })

    sets = []
    for i, p in enumerate(parity_sets()):
        v_mh = on_mh.vertices(p)[:body] * DM_TO_M
        v_an = on_anny.vertices(p)[:body] * DM_TO_M
        name = f"parity_{i:02d}.bin"
        v_mh.astype("<f4").tofile(out_dir / name)
        weights = variation_weights(p)
        sets.append({
            "index": i,
            "phenotype": p,
            "variationWeights": weights,
            "positions": name,
            "heightM": float(v_mh[:, 1].max() - v_mh[:, 1].min()),
            "annyDataMaxDifferenceM": float(np.abs(v_mh - v_an).max()),
            "storageMaxDifferenceM": float(np.abs(v_mh - stored.vertices(p)[:body] * DM_TO_M).max()),
        })
    write_json(out_dir / "parity.json", {
        "format": "ps2cc.anny-parity/1",
        "oracle": "NumPy transcription of Anny phenotype blending (models/phenotype.py, models/full_model.py) at naver/anny@" + _pin("anny"),
        "bodyVertexCount": body,
        "baseMeshMaxDifferenceDm": base_diff,
        "blendShapes": len(on_mh.shapes),
        "differingTargets": differing,
        "sets": sets,
    })
    worst = max(s["annyDataMaxDifferenceM"] for s in sets)
    print(f"  anny parity: {len(sets)} sets, {len(on_mh.shapes)} blend shapes, base mesh difference {base_diff} dm")
    print(f"  anny parity: {len(differing)} of Anny's phenotype targets differ from MakeHuman's on the body; worst set differs by {worst * 1000:.1f} mm")


def _pin(source_id: str) -> str:
    sources = json.loads((Path(__file__).resolve().parent.parent / "sources.json").read_text("utf-8"))["sources"]
    return next(s["pin"] for s in sources if s["id"] == source_id)
