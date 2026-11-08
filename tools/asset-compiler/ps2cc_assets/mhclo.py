"""MHCLO and MHMAT parsing: a port of MakeHuman ``shared/proxy.py:loadTextProxy``
and the parts of ``shared/material.py`` that PS2CC uses."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from .units import DM_TO_M


class UnsupportedProxy(Exception):
    pass


@dataclass
class Mhclo:
    name: str
    uuid: str
    obj_file: str | None
    material_file: str | None
    tags: list[str]
    z_depth: int
    ref_verts: np.ndarray  # (N, 3) uint32
    weights: np.ndarray  # (N, 3) float32
    offsets_m: np.ndarray  # (N, 3) float64, metres (float32-rounded source values * 0.1)
    scale: list[tuple[int, int, float]] | None  # per axis (v1, v2, denominator in metres)
    delete_verts: list[int] = field(default_factory=list)
    license_lines: list[str] = field(default_factory=list)


def parse_mhclo(path: Path) -> Mhclo:
    name = path.stem
    uuid = ""
    obj_file = None
    material_file = None
    tags: list[str] = []
    z_depth = -1
    refs: list[tuple[int, int, int]] = []
    wts: list[tuple[float, float, float]] = []
    offs: list[tuple[float, float, float]] = []
    scale: list = [None, None, None]
    has_scale = False
    delete = np.zeros(19158, dtype=bool)
    lic: list[str] = []
    status = None
    v0 = 0

    with path.open("r", encoding="utf-8", errors="ignore") as fp:
        for line in fp:
            words = line.split()
            if not words:
                continue
            if words[0].startswith("#"):
                lic.append(line.rstrip())
                continue
            key = words[0]
            if key == "name":
                name = " ".join(words[1:])
            elif key == "uuid":
                uuid = " ".join(words[1:])
            elif key == "tag":
                tags.append(" ".join(words[1:]).lower())
            elif key == "z_depth":
                z_depth = int(words[1])
            elif key == "verts":
                status = "verts"
            elif key == "weights":
                status = "weights"  # custom bone weights: not used by PS2CC (we transfer from the body)
            elif key == "delete_verts":
                status = "delete"
            elif key == "obj_file":
                obj_file = words[1]
            elif key == "material":
                material_file = words[1]
            elif key in ("x_scale", "y_scale", "z_scale"):
                axis = {"x_scale": 0, "y_scale": 1, "z_scale": 2}[key]
                scale[axis] = (int(words[1]), int(words[2]), float(words[3]) * DM_TO_M)
                has_scale = True
            elif key.endswith(("shear_x", "shear_y", "shear_z")):
                raise UnsupportedProxy(f"{path.name}: shear transforms are not supported")
            elif key in ("vertexboneweights_file", "uvLayer", "max_pole", "special_pose", "version",
                         "description", "author", "license", "homepage", "basemesh",
                         "backface_culling", "transparent", "author:", "license:"):
                continue
            elif status == "verts":
                if len(words) == 1:
                    refs.append((int(words[0]), 0, 1))
                    wts.append((1.0, 0.0, 0.0))
                    offs.append((0.0, 0.0, 0.0))
                else:
                    refs.append((int(words[0]), int(words[1]), int(words[2])))
                    wts.append((float(words[3]), float(words[4]), float(words[5])))
                    if len(words) > 6:
                        offs.append((float(words[6]), float(words[7]), float(words[8])))
                    else:
                        offs.append((0.0, 0.0, 0.0))
            elif status == "weights":
                continue
            elif status == "delete":
                sequence = False
                for v in words:
                    if v == "-":
                        sequence = True
                        continue
                    v1 = int(v)
                    if sequence:
                        delete[v0 : v1 + 1] = True
                        sequence = False
                    else:
                        delete[v1] = True
                    v0 = v1

    if has_scale and any(s is None for s in scale):
        raise UnsupportedProxy(f"{path.name}: incomplete scale data")
    if z_depth == -1:
        z_depth = 50  # MakeHuman's default
    weights = np.asarray(wts, dtype=np.float32).reshape(-1, 3)
    offsets = np.asarray(offs, dtype=np.float32).reshape(-1, 3).astype(np.float64) * DM_TO_M
    return Mhclo(
        name=name,
        uuid=uuid,
        obj_file=obj_file,
        material_file=material_file,
        tags=tags,
        z_depth=z_depth,
        ref_verts=np.asarray(refs, dtype=np.uint32).reshape(-1, 3),
        weights=weights,
        offsets_m=offsets,
        scale=scale if has_scale else None,
        delete_verts=np.nonzero(delete)[0].tolist(),
        license_lines=lic,
    )


@dataclass
class Mhmat:
    name: str
    diffuse_texture: str | None
    diffuse_color: tuple[float, float, float]
    transparent: bool
    alpha_to_coverage: bool
    backface_cull: bool
    opacity: float


def parse_mhmat(path: Path) -> Mhmat:
    values: dict[str, str] = {}
    with path.open("r", encoding="utf-8", errors="ignore") as fp:
        for line in fp:
            line = line.strip()
            if not line or line.startswith("#") or line.startswith("/"):
                continue
            key, _, rest = line.partition(" ")
            if key in ("tag", "shaderParam", "shaderConfig", "shaderDefine"):
                continue
            values[key] = rest.strip()

    def flag(k: str, default: bool) -> bool:
        v = values.get(k)
        return default if v is None else v.lower() in ("true", "1", "yes")

    color = tuple(float(x) for x in values.get("diffuseColor", "1 1 1").split()[:3])
    return Mhmat(
        name=values.get("name", path.stem),
        diffuse_texture=values.get("diffuseTexture"),
        diffuse_color=color,  # type: ignore[arg-type]
        transparent=flag("transparent", False),
        alpha_to_coverage=flag("alphaToCoverage", False),
        backface_cull=flag("backfaceCull", True),
        opacity=float(values.get("opacity", "1.0")),
    )
