"""PS2CC asset compiler entry point.

Usage:  python -I tools/asset-compiler/compile.py <stage> [...]
Stages: fetch, core (base mesh + targets + modifiers + rigs + face pose units), rigs, expressions, proxies, vendor (MediaPipe), licenses, golden, golden-expressions, all
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ps2cc_assets import basemesh, expressions, fetch, modifiers, proxies, rig, targets, vendor  # noqa: E402
from ps2cc_assets.binfmt import write_json  # noqa: E402
from ps2cc_assets.licenses import LicenseCollector  # noqa: E402
from ps2cc_assets.paths import ASSETS_CORE  # noqa: E402

COMPILER_VERSION = 1


def stage_core(lic: LicenseCollector) -> None:
    lic.add_data(basemesh.run()["files"], "mh:basemesh/hm08", "makehuman")
    files = modifiers.load_modifier_files()
    lic.add_data(modifiers.run(files)["files"], "mh:modifiers", "makehuman")
    lic.add_data(targets.run(files)["files"], "mh:targets", "makehuman")
    stage_rigs(lic)
    stage_expressions(lic)


def stage_rigs(lic: LicenseCollector) -> None:
    lic.add_data(rig.convert_game_engine(), "mpfb:rigs/game_engine", "mpfb2")
    lic.add_data(rig.convert_default(), "mh:rigs/default", "makehuman")


def stage_expressions(lic: LicenseCollector) -> None:
    lic.add_data(expressions.convert_face_poseunits(), "mh:poseunits/face", "makehuman")


def restore_rows(lic: LicenseCollector) -> None:
    """Keep licence rows of stages that are not re-run this time."""
    import json

    path = ASSETS_CORE / "LICENSES.json"
    if path.exists():
        for row in json.loads(path.read_text("utf-8"))["files"]:
            row.pop("sha256", None)
            row.pop("bytes", None)
            lic.rows[row["file"]] = row


def main(argv: list[str]) -> int:
    stages = argv or ["all"]
    if "all" in stages:
        stages = ["fetch", "core", "proxies", "vendor", "licenses"]
    t0 = time.monotonic()
    lic = LicenseCollector()
    restore_rows(lic)
    for stage in stages:
        print(f"[{stage}]", flush=True)
        if stage == "fetch":
            fetch.run()
        elif stage == "core":
            stage_core(lic)
        elif stage == "rigs":
            stage_rigs(lic)
        elif stage == "expressions":
            stage_expressions(lic)
        elif stage == "proxies":
            proxies.run(lic)
        elif stage == "vendor":
            vendor.run(lic)
        elif stage == "licenses":
            pass
        elif stage == "golden":
            from golden import generate

            generate.run()
            continue
        elif stage == "golden-expressions":
            from golden import generate

            generate.run_expressions()
            continue
        else:
            print(f"unknown stage {stage}", file=sys.stderr)
            return 2
        if stage != "fetch":
            lic.write()
    write_json(ASSETS_CORE / "manifest.json", {"format": "ps2cc.manifest/1", "compilerVersion": COMPILER_VERSION})
    print(f"done in {time.monotonic() - t0:.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
