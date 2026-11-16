"""Stage: bundle third-party runtime files that the app loads from assets/core.

MediaPipe Face Landmarker (PRD F7: "bundle the WASM and .task model locally,
no CDN"): the pinned model comes from the fetch cache and the WASM runtime
from the pinned npm package @mediapipe/tasks-vision in app/frontend.
"""

from __future__ import annotations

import json
import shutil

from .fetch import source_dir
from .licenses import LicenseCollector
from .paths import ASSETS_CORE, REPO_ROOT

OUT = ASSETS_CORE / "vendor" / "mediapipe"
PACKAGE = REPO_ROOT / "app" / "frontend" / "node_modules" / "@mediapipe" / "tasks-vision"
WASM_FILES = ("vision_wasm_internal.js", "vision_wasm_internal.wasm")
HOMEPAGE = "https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker"


def run(lic: LicenseCollector) -> None:
    pkg = json.loads((PACKAGE / "package.json").read_text("utf-8"))
    if pkg.get("license") != "Apache-2.0":
        raise RuntimeError(f"@mediapipe/tasks-vision licence changed to {pkg.get('license')}")
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "wasm").mkdir(exist_ok=True)
    files: list[tuple[str, str]] = []
    model = source_dir("mediapipe_face_landmarker") / "face_landmarker.task"
    shutil.copyfile(model, OUT / "face_landmarker.task")
    files.append(("vendor/mediapipe/face_landmarker.task", "mediapipe_face_landmarker"))
    # PRD Part 3, F33: the Selfie Multiclass segmenter (hair, face skin, background ...).
    seg = source_dir("mediapipe_selfie_multiclass") / "selfie_multiclass_256x256.tflite"
    if seg.stat().st_size > 50 * 1024 * 1024:
        raise RuntimeError("the segmenter is over the 50 MB limit for bundled models (PRD Part 3, 0.1)")
    shutil.copyfile(seg, OUT / "selfie_multiclass_256x256.tflite")
    files.append(("vendor/mediapipe/selfie_multiclass_256x256.tflite", "mediapipe_selfie_multiclass"))
    for name in WASM_FILES:
        shutil.copyfile(PACKAGE / "wasm" / name, OUT / "wasm" / name)
        files.append((f"vendor/mediapipe/wasm/{name}", "npm:@mediapipe/tasks-vision@" + pkg["version"]))
    notice = (
        "MediaPipe Tasks Vision (Face Landmarker, Image Segmenter)\n"
        f"WASM runtime: npm @mediapipe/tasks-vision {pkg['version']}\n"
        "Models: face_landmarker.task (float16, version 1); selfie_multiclass_256x256.tflite (float32, version 1)\n"
        "Copyright Google LLC. Licensed under the Apache License, Version 2.0:\n"
        "https://www.apache.org/licenses/LICENSE-2.0\n"
        f"Source: {HOMEPAGE}\n"
    )
    (OUT / "NOTICE.txt").write_text(notice, encoding="utf-8")
    files.append(("vendor/mediapipe/NOTICE.txt", "ps2cc"))
    for rel, upstream in files:
        lic.add(rel, "vendor:mediapipe/face_landmarker", "Apache-2.0", "Google LLC", HOMEPAGE, upstream)
    print(f"  vendored {len(files)} MediaPipe files -> {OUT}")
