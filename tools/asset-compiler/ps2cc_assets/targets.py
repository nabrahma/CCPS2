"""Stage: build the target registry and pack target deltas.

The registry is a faithful port of MakeHuman ``lib/targets.py``
(``TargetsCrawler.walkTargets`` + ``Component``): each target gets a group key
(the hyphen-separated non-variable name parts) and a set of macro variable
dependencies parsed from its path. Only the deltas of targets referenced by a
modifier group are packed, which is every shape a slider can produce.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field

import numpy as np

from .basemesh import mh_data_dir
from .binfmt import ContainerWriter, write_json
from .paths import ASSETS_CORE
from .units import DM_TO_M

# Port of targets._cat_data: (category, values) in MakeHuman order.
CAT_DATA: list[tuple[str, list[str]]] = [
    ("gender", ["male", "female"]),
    ("age", ["baby", "child", "young", "old"]),
    ("race", ["caucasian", "asian", "african"]),
    ("muscle", ["maxmuscle", "averagemuscle", "minmuscle"]),
    ("weight", ["minweight", "averageweight", "maxweight"]),
    ("height", ["minheight", "averageheight", "maxheight"]),
    ("breastsize", ["mincup", "averagecup", "maxcup"]),
    ("breastfirmness", ["minfirmness", "averagefirmness", "maxfirmness"]),
    ("bodyproportions", ["uncommonproportions", "regularproportions", "idealproportions"]),
]
CATEGORIES = [c for c, _ in CAT_DATA]
VALUE_CAT = {v: c for c, vals in CAT_DATA for v in vals}


@dataclass
class Component:
    key: list[str] = field(default_factory=list)
    data: dict[str, str | None] = field(default_factory=dict)
    path: str | None = None

    def clone(self) -> "Component":
        return Component(key=list(self.key), data=dict(self.data))

    def update(self, part: str) -> None:
        category = VALUE_CAT.get(part)
        if category is not None:
            orig = self.data.get(category)
            if orig is not None and orig != part:
                raise RuntimeError(f"{category} already set")
            self.data[category] = part
        elif part == "target":
            pass
        else:
            self.key.append(part)

    def variables(self) -> list[str]:
        return [v for v in self.data.values() if v is not None]


def crawl(data_dir) -> list[Component]:
    """Walk the data dir exactly like FilesTargetsCrawler.walkTargets."""
    found: list[Component] = []

    def walk(rel: str, base: Component) -> None:
        real = os.path.normpath(os.path.join(data_dir, rel))
        for name in sorted(os.listdir(real)):
            path = os.path.join(real, name)
            if os.path.isfile(path) and not name.lower().endswith(".target"):
                continue
            item = base.clone()
            parts = name.replace("_", "-").replace(".", "-").split("-")
            for idx, part in enumerate(parts):
                if idx == 0 and part == "targets":
                    continue
                item.update(part)
            if os.path.isdir(path):
                walk(os.path.join(rel, name), item)
            else:
                item.path = os.path.relpath(path, data_dir).replace("\\", "/")
                for cat in CATEGORIES:
                    item.data.setdefault(cat, None)
                found.append(item)

    walk("", Component())
    return found


def read_target(path) -> tuple[np.ndarray, np.ndarray]:
    """Port of algos3d.Target._load_text: 'index dx dy dz' lines, '#' comments."""
    idx: list[int] = []
    vec: list[list[float]] = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split()
            idx.append(int(parts[0]))
            vec.append([float(parts[1]), float(parts[2]), float(parts[3])])
    # MakeHuman stores target vectors as float32; keep that rounding step.
    return np.asarray(idx, dtype=np.uint32), np.asarray(vec, dtype=np.float32).reshape(-1, 3)


def referenced_groups(modifier_files: list[dict]) -> set[str]:
    """Every target group a modifier definition can resolve (see modifiers.resolve_groups)."""
    from .modifiers import resolve_groups

    groups: set[str] = set()
    for f in modifier_files:
        groups |= resolve_groups(f["data"])
    return groups


def run(modifier_files: list[dict]) -> dict:
    data_dir = mh_data_dir()
    comps = crawl(str(data_dir))
    wanted = referenced_groups(modifier_files)

    registry = []
    w = ContainerWriter()
    all_idx: list[np.ndarray] = []
    all_vec: list[np.ndarray] = []
    offset = 0
    macro_dependent_non_macro: list[str] = []
    for comp in comps:
        group = "-".join(comp.key)
        if group not in wanted:
            continue
        assert comp.path is not None
        idx, vec = read_target(data_dir / comp.path)
        all_idx.append(idx)
        # MakeHuman applies the float32 vectors in decimetres; we store metres,
        # quantised to int16 with a per-target scale (like MakeHuman's own
        # compiled targets.npz, but with a finer step; see DECISIONS.md D-004).
        metres = vec.astype(np.float64) * DM_TO_M
        max_abs = float(np.abs(metres).max()) if metres.size else 0.0
        scale = max_abs / 32767.0 if max_abs > 0 else 1.0
        quant = np.round(metres / scale).astype(np.int16)
        all_vec.append(quant)
        variables = comp.variables()
        if variables and not group.startswith("macrodetails") and group != "breast":
            macro_dependent_non_macro.append(comp.path)
        registry.append(
            {
                "path": comp.path,
                "group": group,
                "vars": variables,
                "offset": offset,
                "count": int(len(idx)),
                "scale": scale,
            }
        )
        offset += len(idx)

    indices = np.concatenate(all_idx) if all_idx else np.zeros(0, np.uint32)
    deltas = np.concatenate(all_vec) if all_vec else np.zeros((0, 3), np.int16)
    if indices.size and indices.max() >= 19158:
        raise RuntimeError("target references a vertex outside hm08")
    w.add("indices", indices, "u16")
    w.add("deltas", deltas, "i16")
    w.write(
        ASSETS_CORE / "targets" / "targets",
        {
            "format": "ps2cc.targets/1",
            "units": "m",
            "categories": [{"name": c, "values": v} for c, v in CAT_DATA],
            "targets": registry,
        },
    )
    write_json(
        ASSETS_CORE / "targets" / "registry_report.json",
        {"targetCount": len(registry), "deltaCount": int(offset), "macroDependentOutsideMacroGroups": macro_dependent_non_macro},
    )
    print(f"  targets: {len(registry)} targets, {offset} deltas ({(offset * 8) >> 20} MiB)")
    if macro_dependent_non_macro:
        print(f"  note: {len(macro_dependent_non_macro)} non-macro targets depend on macro variables (see registry_report.json)")
    return {"files": ["targets/targets.json", "targets/targets.bin"], "source": "makehuman"}
