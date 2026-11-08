"""Smoke check: boot the MakeHuman oracle and print basic facts."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import mh_headless  # noqa: E402

h, hm = mh_headless.boot()
print("modifiers:", len(h.modifiers))
print("verts:", h.meshData.coord.shape, h.meshData.coord.dtype)
print("detail stack:", len(h.targetsDetailStack))
print("height cm:", h.getHeightCm())
