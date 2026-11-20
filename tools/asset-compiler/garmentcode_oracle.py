"""GarmentCode oracle for the TypeScript port (PRD Part 3, F29).

Runs the pinned GarmentCode / pygarment (MIT, `sources.json` id `garmentcode`) at build time and records what it
produces, so `packages/core/test/garment-pattern-*.test.ts` can check the port against it.

Usage (in the isolated environment, see docs/garment-patterns.md):
    tools/asset-compiler/.cache/venv-garmentcode/Scripts/python.exe -I tools/asset-compiler/garmentcode_oracle.py numerics OUT.json.gz
    tools/asset-compiler/.cache/venv-garmentcode/Scripts/python.exe -I tools/asset-compiler/garmentcode_oracle.py patterns BODIES.json OUT.json.gz [N]

    tools/asset-compiler/.cache/venv-garmentcode/Scripts/python.exe -I tools/asset-compiler/garmentcode_oracle.py stability OUT.json.gz OTHER.json.gz [MORE.json.gz ...]

`numerics` records svgpathtools curves, SciPy rotations and the optimiser calls GarmentCode makes, on random inputs.
`patterns` samples N designs per program with GarmentCode's own DesignSampler (seeded), builds each on the given
bodies (our own measured bodies, never GarmentCode's SMPL-derived ones) and records the assembled pattern or the
error raised. Only the image writer (cairosvg), matplotlib and psutil are stubbed: they draw pictures and report
system information and play no part in the patterns.
"""

from __future__ import annotations

import gzip
import json
import math
import os
import random
import sys
import traceback
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GC = ROOT / "tools" / "asset-compiler" / ".cache" / "extracted" / "garmentcode"

for _name in ("cairosvg", "matplotlib", "matplotlib.pyplot", "psutil"):
    sys.modules[_name] = types.ModuleType(_name)
sys.path.insert(0, str(GC))

import warnings  # noqa: E402

warnings.filterwarnings("ignore")

import numpy as np  # noqa: E402
import svgpathtools as svgpath  # noqa: E402
from scipy.spatial.transform import Rotation as R  # noqa: E402

CWD = os.getcwd()
os.chdir(GC)
import pygarment as pyg  # noqa: E402
from pygarment.garmentcode import edge_factory as ef  # noqa: E402
from pygarment.garmentcode import operators as ops  # noqa: E402

PROGRAMS = {
    # upper garments
    "FittedShirt": {"upper": "FittedShirt", "bottom": None, "wb": None},
    "Shirt": {"upper": "Shirt", "bottom": None, "wb": None},
    # bottoms (the waistband is sampled with them)
    "Pants": {"upper": None, "bottom": "Pants"},
    "SkirtCircle": {"upper": None, "bottom": "SkirtCircle"},
    "AsymmSkirtCircle": {"upper": None, "bottom": "AsymmSkirtCircle"},
    "GodetSkirt": {"upper": None, "bottom": "GodetSkirt"},
    "Skirt2": {"upper": None, "bottom": "Skirt2"},
    "SkirtManyPanels": {"upper": None, "bottom": "SkirtManyPanels"},
    "PencilSkirt": {"upper": None, "bottom": "PencilSkirt"},
    "SkirtLevels": {"upper": None, "bottom": "SkirtLevels"},
    # waistbands alone
    "StraightWB": {"upper": None, "bottom": None, "wb": "StraightWB"},
    "FittedWB": {"upper": None, "bottom": None, "wb": "FittedWB"},
    # whole garments, every meta choice sampled
    "MetaGarment": {},
}


def c2l(z):
    return [float(z.real), float(z.imag)]


def write(out: str, data) -> None:
    raw = json.dumps(data, separators=(",", ":"), allow_nan=True).encode("utf-8")
    with gzip.GzipFile(out, "wb", mtime=0) as f:
        f.write(raw)
    print(f"wrote {out} ({len(raw) / 1e6:.1f} MB raw)")


# ------------------------------------------------------------------ numerics


def numerics(out: str) -> None:
    rng = np.random.default_rng(22)
    curves = []
    for i in range(240):
        kind = ["cubic", "quad", "arc"][i % 3]
        s = complex(*rng.uniform(-30, 30, 2))
        e = complex(*rng.uniform(-30, 30, 2))
        if kind == "cubic":
            seg = svgpath.CubicBezier(s, complex(*rng.uniform(-40, 40, 2)), complex(*rng.uniform(-40, 40, 2)), e)
            spec = [c2l(p) for p in seg.bpoints()]
        elif kind == "quad":
            seg = svgpath.QuadraticBezier(s, complex(*rng.uniform(-40, 40, 2)), e)
            spec = [c2l(p) for p in seg.bpoints()]
        else:
            r = abs(e - s) / 2 * rng.uniform(1.0, 3.0)
            la, sw = bool(rng.integers(2)), bool(rng.integers(2))
            seg = svgpath.Arc(s, complex(r, r), 0, la, sw, e)
            spec = [c2l(s), [r, r], int(la), int(sw), c2l(e)]
        ts = [0.0, 1.0] + [float(t) for t in rng.uniform(0, 1, 3)]
        L = seg.length()
        fr = float(rng.uniform(0.05, 0.95))
        t0, t1 = sorted(float(t) for t in rng.uniform(0, 1, 2))
        crop = seg.cropped(t0, t1)
        rec = {
            "kind": kind,
            "spec": spec,
            "ts": ts,
            "points": [c2l(seg.point(t)) for t in ts],
            "length": float(L),
            "partial": float(seg.length(0, ts[2])),
            "frac": fr,
            "ilength": float(seg.ilength(L * fr, s_tol=1e-10)),
            "crop": [t0, t1],
            "cropStart": c2l(crop.start),
            "cropEnd": c2l(crop.end),
            "cropLength": float(crop.length()),
            "tangents": [c2l(seg.unit_tangent(t)) for t in ts[2:]],
            "curvatures": [float(seg.curvature(t)) for t in ts[2:]],
        }
        if kind == "arc":
            rec["radius"] = c2l(crop.radius)
            rec["largeArc"] = bool(crop.large_arc)
        else:
            rec["cropBpoints"] = [c2l(p) for p in crop.bpoints()]
        curves.append(rec)

    rotations = []
    for i in range(120):
        eul = [float(a) for a in rng.uniform(-180, 180, 3)]
        if i % 6 == 0:
            eul[1] = [90.0, -90.0][i % 12 // 6]
        r1 = R.from_euler("XYZ", eul, degrees=True)
        eul2 = [float(a) for a in rng.uniform(-180, 180, 3)]
        r2 = R.from_euler("XYZ", eul2, degrees=True)
        v = [float(a) for a in rng.uniform(-5, 5, 3)]
        rv = [float(a) for a in rng.uniform(-2, 2, 3)]
        if i % 5 == 0:
            rv = [float(a) * 1e-4 for a in rv]
        rotations.append(
            {
                "euler": eul,
                "euler2": eul2,
                "quat": r1.as_quat().tolist(),
                "asEuler": r1.as_euler("XYZ", degrees=True).tolist(),
                "composed": (r2 * r1).as_quat().tolist(),
                "composedEuler": (r2 * r1).as_euler("XYZ", degrees=True).tolist(),
                "v": v,
                "applied": r1.apply(v).tolist(),
                "rotvec": rv,
                "rotvecQuat": R.from_rotvec(rv).as_quat().tolist(),
            }
        )

    from scipy.optimize import minimize
    from pygarment.garmentcode.utils import c_to_np, list_to_c
    from pygarment.pattern.utils import abs_to_rel_2d

    optim = []
    # BFGS: CurveEdgeFactory.curve_from_tangents (the bodice back, pants and skirts call it).
    for i in range(60):
        start = [float(a) for a in rng.uniform(-20, 20, 2)]
        end = [float(a) for a in rng.uniform(-20, 20, 2)]
        t0 = [float(a) for a in rng.uniform(-1, 1, 2)] if i % 3 != 1 else None
        t1 = [float(a) for a in rng.uniform(-1, 1, 2)] if i % 3 != 0 else None
        guess = [float(a) for a in rng.uniform(-0.2, 1, 2)] if i % 2 else None
        e = pyg.CurveEdgeFactory.curve_from_tangents(start, end, target_tan0=None if t0 is None else np.array(t0), target_tan1=None if t1 is None else np.array(t1), initial_guess=guess)
        # The same call again with a callback, for the first iterates.
        rt0 = None if t0 is None else abs_to_rel_2d(start, end, np.array(t0), as_vector=True)
        rt1 = None if t1 is None else abs_to_rel_2d(start, end, np.array(t1), as_vector=True)
        if rt0 is not None:
            rt0 /= np.linalg.norm(rt0)
        if rt1 is not None:
            rt1 /= np.linalg.norm(rt1)
        its = []
        minimize(ef._fit_tangents, [0.5, 0] if guess is None else guess, args=(rt0, rt1), callback=lambda x: its.append(x.tolist()))
        optim.append({"op": "curve_from_tangents", "start": start, "end": end, "tan0": t0, "tan1": t1, "guess": guess, "cp": [list(map(float, c)) for c in e.control_points], "iterates": its[:4]})
    # L-BFGS-B: curve_match_tangents (sleeves, hood).
    for i in range(40):
        cps = [[float(a) for a in rng.uniform(-20, 20, 2)] for _ in range(4)]
        tan0 = [float(a) for a in rng.uniform(-1, 1, 2)]
        tan1 = [float(a) for a in rng.uniform(-1, 1, 2)]
        curve = svgpath.CubicBezier(*[complex(*c) for c in cps])
        tl = float(curve.length() * rng.uniform(0.9, 1.2)) if i % 2 else None
        res = ops.curve_match_tangents(curve, np.array(tan0), np.array(tan1), target_len=tl)
        ccps = c_to_np(curve.bpoints())
        direction = ccps[-1] - ccps[0]
        direction /= np.linalg.norm(direction)
        nt0 = np.array(tan0) / np.linalg.norm(tan0)
        nt1 = np.array(tan1) / np.linalg.norm(tan1)
        its = []
        minimize(ops._bend_extend_2_tangent, [0, 0, 0, 0, 0], args=(ccps, curve.length() if tl is None else tl, direction, list_to_c(nt0), list_to_c(nt1), 70), method="L-BFGS-B", callback=lambda x: its.append(x.tolist()))
        optim.append({"op": "curve_match_tangents", "cps": cps, "tan0": tan0, "tan1": tan1, "targetLen": tl, "result": [list(map(float, c)) for c in res], "iterates": its[:4]})
    # L-BFGS-B with bounds: the cut_corner and cut_into_edge objectives.

    for i in range(40):
        a = [float(v) for v in rng.uniform(-10, 10, 2)]
        b = [float(v) for v in rng.uniform(-10, 10, 2)]
        c = [float(v) for v in rng.uniform(-10, 10, 2)]
        c1 = svgpath.Line(complex(*a), complex(*b))
        c2 = svgpath.Line(complex(*b), complex(*c))
        target = [float(v) for v in rng.uniform(-6, 6, 2)]
        o = minimize(ops._fit_location_corner, [0.5, 0.5], args=(np.array(target), c1, c2), bounds=[(0, 1), (0, 1)])
        optim.append({"op": "fit_location_corner", "a": a, "b": b, "c": c, "target": target, "x": o.x.tolist(), "fun": float(o.fun), "nit": int(o.nit)})
    for i in range(40):
        cps = [[float(v) for v in rng.uniform(-20, 20, 2)] for _ in range(4)]
        curve = svgpath.CubicBezier(*[complex(*p) for p in cps]) if i % 2 else svgpath.Line(complex(*cps[0]), complex(*cps[3]))
        loc = float(rng.uniform(0.2, 0.8))
        w = float(curve.length() * rng.uniform(0.05, 0.3))
        o = minimize(ops._fit_location_edge, [0.1, 0.1], args=(loc, w, curve), bounds=[(0, 1)])
        optim.append({"op": "fit_location_edge", "cps": cps, "line": not (i % 2), "loc": loc, "width": w, "x": o.x.tolist(), "fun": float(o.fun), "nit": int(o.nit)})
    write(out, {"curves": curves, "rotations": rotations, "optim": optim})


# ------------------------------------------------------------------ patterns


def jsonable(v):
    if isinstance(v, dict):
        return {k: jsonable(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [jsonable(x) for x in v]
    if isinstance(v, np.ndarray):
        return [jsonable(x) for x in v.tolist()]
    if isinstance(v, (np.floating,)):
        return float(v)
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.bool_,)):
        return bool(v)
    return v


def patterns(bodies_path: str, out: str, n: int) -> None:
    from assets.bodies.body_params import BodyParameters
    from assets.garment_programs.meta_garment import MetaGarment

    with open(bodies_path, "r", encoding="utf-8") as f:
        bodies = json.load(f)["bodies"]
    sampler = pyg.DesignSampler("./assets/design_params/default.yaml")
    records = {}
    for prog, meta in PROGRAMS.items():
        recs = []
        for i in range(n):
            random.seed(f"{prog}-{i}")
            design = sampler.randomize()
            for key, val in meta.items():
                design["meta"][key]["v"] = val
            body_rec = bodies[i % len(bodies)]
            body = BodyParameters.__new__(BodyParameters)
            body.params = {}
            body.load_from_dict(dict(body_rec["measurements"]))
            rec = {"body": body_rec["name"], "design": jsonable(design)}
            try:
                piece = MetaGarment(f"{prog}_{i}", body, design)
                spec = piece.assembly().pattern
                rec["pattern"] = jsonable(spec)
            except BaseException as e:  # noqa: BLE001 - record any failure, the port must fail the same way
                rec["error"] = type(e).__name__
                rec["message"] = str(e)[:300]
                rec["trace"] = traceback.format_exc().splitlines()[-3:]
            recs.append(rec)
        ok = sum(1 for r in recs if "pattern" in r)
        print(f"{prog}: {ok}/{n} built")
        records[prog] = recs
    write(out, {"programs": records})


# ------------------------------------------------------------------ stability


def _numbers(spec):
    """Every number of a pattern, keyed by panel and position, for comparing two oracle runs."""
    out = {}
    for name, p in spec["panels"].items():
        out[(name, "t")] = list(p["translation"])
        r = R.from_euler("XYZ", p["rotation"], degrees=True).as_matrix().ravel().tolist()
        out[(name, "r")] = r
        out[(name, "v")] = [c for v in p["vertices"] for c in v]
        cur = []
        for e in p["edges"]:
            if "curvature" in e:
                prm = e["curvature"]["params"]
                cur += [c for q in prm for c in (q if isinstance(q, list) else [q])]
        out[(name, "c")] = cur
    return out


def _deviation(a, b):
    """Largest difference between two patterns in cm (inf when their structure differs)."""
    if set(a["panels"]) != set(b["panels"]):
        return math.inf
    na, nb = _numbers(a), _numbers(b)
    dev = 0.0
    for k, va in na.items():
        vb = nb[k]
        if len(va) != len(vb):
            return math.inf
        for x, y in zip(va, vb):
            dev = max(dev, abs(x - y) * (100.0 if k[1] == "r" else 1.0))
    sa = sorted(json.dumps(s, sort_keys=True) for s in a["stitches"])
    sb = sorted(json.dumps(s, sort_keys=True) for s in b["stitches"])
    return dev if sa == sb else math.inf


def stability(default_path: str, other_paths: list) -> None:
    """Mark each record of the default run stable (GarmentCode gives the same pattern, within 1e-6 relative, on
    every other BLAS kernel it was run on) or unstable, with GarmentCode's own largest deviation in cm."""
    with gzip.open(default_path, "rb") as f:
        a = json.loads(f.read())
    others = []
    for p in other_paths:
        with gzip.open(p, "rb") as f:
            others.append(json.loads(f.read()))
    for prog, recs in a["programs"].items():
        unstable = 0
        for i, ra in enumerate(recs):
            stable, worst = True, 0.0
            for b in others:
                rb = b["programs"][prog][i]
                if ("pattern" in ra) != ("pattern" in rb):
                    stable, worst = False, math.inf
                elif "pattern" in ra:
                    dev = _deviation(ra["pattern"], rb["pattern"])
                    scale = max([1.0] + [abs(c) for p in ra["pattern"]["panels"].values() for v in p["vertices"] for c in v])
                    if dev > 1e-6 * scale:
                        stable = False
                    worst = max(worst, dev)
            ra["stable"] = stable
            ra["selfDeviation"] = None if math.isinf(worst) else worst
            unstable += 0 if stable else 1
        print(f"{prog}: {unstable}/{len(recs)} differ between BLAS kernels")
    write(default_path, a)


if __name__ == "__main__":
    cmd = sys.argv[1]
    paths = [os.path.join(CWD, a) for a in sys.argv[2:4]]
    if cmd == "numerics":
        numerics(paths[0])
    elif cmd == "patterns":
        patterns(paths[0], paths[1], int(sys.argv[4]) if len(sys.argv) > 4 else 200)
    elif cmd == "stability":
        stability(paths[0], [os.path.join(CWD, a) for a in sys.argv[3:]])
    else:
        raise SystemExit(__doc__)
