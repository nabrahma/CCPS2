"""Unit and axis conventions.

MakeHuman works in decimetres, Y up, character facing +Z. The PS2CC engine works
in metres with the same axes (PRD 4.3), so the only conversion is a 0.1 scale.

MPFB stores rig data in Blender space (metres, Z up, character facing -Y):
blender = (x, -z, y) in engine axes.
"""

from __future__ import annotations

import numpy as np

DM_TO_M = 0.1


def blender_to_engine(v) -> list[float]:
    x, y, z = v
    return [float(x), float(z), float(-y)]


def dm_to_m(arr: np.ndarray) -> np.ndarray:
    return np.asarray(arr, dtype=np.float64) * DM_TO_M
