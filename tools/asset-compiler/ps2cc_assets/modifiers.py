"""Stage: copy MakeHuman modifier and slider definitions into the engine format.

The definitions are kept close to MakeHuman's own JSON so the TypeScript port of
``humanmodifier.py`` reads the same structure MakeHuman does.
"""

from __future__ import annotations

import json
from collections import OrderedDict

from .basemesh import mh_data_dir
from .binfmt import write_json
from .paths import ASSETS_CORE

# Load order matches MakeHuman's plugins: 0_modeling_0_modifiers, 0_modeling_1_bodyshapes,
# 0_modeling_a_measurement.
MODIFIER_FILES = ["modeling", "bodyshapes", "measurement"]


def load_modifier_files() -> list[dict]:
    d = mh_data_dir() / "modifiers"
    out = []
    for name in MODIFIER_FILES:
        data = json.loads((d / f"{name}_modifiers.json").read_text(encoding="utf-8"), object_pairs_hook=OrderedDict)
        desc_path = d / f"{name}_modifiers_desc.json"
        desc = json.loads(desc_path.read_text(encoding="utf-8")) if desc_path.exists() else {}
        sliders = json.loads((d / f"{name}_sliders.json").read_text(encoding="utf-8"), object_pairs_hook=OrderedDict)
        out.append({"file": name, "data": data, "descriptions": desc, "sliders": sliders})
    return out


def resolve_groups(groups: list[dict]) -> set[str]:
    """Target group names each modifier resolves through ``targets.getTargetsByGroup``."""
    result: set[str] = set()
    for g in groups:
        group = g["group"].replace("/", "-")
        for m in g["modifiers"]:
            if "macrovar" in m:
                result.add(group)
                continue
            target_name = f"{group}-{m['target']}"
            if "min" in m and "max" in m:
                result.add(f"{target_name}-{m['min']}")
                result.add(f"{target_name}-{m['max']}")
                if "mid" in m:
                    result.add(f"{target_name}-{m['mid']}")
            else:
                result.add(target_name)
    return result


def run(files: list[dict]) -> dict:
    write_json(
        ASSETS_CORE / "modifiers" / "modifiers.json",
        {"format": "ps2cc.modifiers/1", "files": files},
    )
    count = sum(len(g["modifiers"]) for f in files for g in f["data"])
    print(f"  modifiers: {count} modifiers in {sum(len(f['data']) for f in files)} groups")
    return {"files": ["modifiers/modifiers.json"], "source": "makehuman"}
