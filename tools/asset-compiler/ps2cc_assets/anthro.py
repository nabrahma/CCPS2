"""Stage: body landmarks for anthropometry (PRD Part 3, F24).

Writes ``assets/core/anthro/landmarks.json``: named vertex sets on hm08.

* Rings and the limb length points come from MakeHuman's own measuring tool
  (``plugins/0_modeling_a_measurement.py``, the ``Ruler`` class), read from
  the pinned source. Anny's waist ring is the same list.
* The head ring and the remaining points (crown, nose tip, crotch, armpits,
  bust and seat points, heels) are found on the default mesh by fixed
  geometric rules below, so the file can always be rebuilt.
* Left-side points get their right-side partner from MPFB's mirror table.

Left is +X (the character's own left), Y is up, the character faces +Z.
"""

from __future__ import annotations

import re

import numpy as np

from .basemesh import BODY_VERTEX_COUNT, mh_data_dir, mpfb_data_dir
from .binfmt import write_json
from .obj import read_obj
from .paths import ASSETS_CORE
from .units import dm_to_m

RING_NAMES = {
    "neck-circ": "neck",
    "bust-circ": "bust",
    "underbust-circ": "underbust",
    "waist-circ": "waist",
    "hips-circ": "hips",
    "thigh-circ": "thigh",
    "knee-circ": "knee",
    "calf-circ": "calf",
    "ankle-circ": "ankle",
    "upperarm-circ": "upperArm",
    "wrist-circ": "wrist",
}


def read_ruler() -> dict[str, list[int]]:
    src = (mh_data_dir().parent / "plugins" / "0_modeling_a_measurement.py").read_text(encoding="utf-8")
    out: dict[str, list[int]] = {}
    for m in re.finditer(r"Measures\['measure/measure-([a-z\-]+)-decr\|incr'\]\s*=\s*\[([0-9,\s]+)\]", src):
        out[m.group(1)] = [int(x) for x in m.group(2).replace(" ", "").split(",") if x]
    if len(out) != 20:
        raise RuntimeError(f"expected 20 MakeHuman measures, found {len(out)}")
    return out


def read_mirror() -> np.ndarray:
    mirror = np.arange(19158, dtype=np.int64)
    for line in (mpfb_data_dir() / "mesh_metadata" / "hm08.mirror").read_text(encoding="utf-8").splitlines():
        parts = line.split()
        if len(parts) >= 2:
            mirror[int(parts[0])] = int(parts[1])
    return mirror


def find_armpit(pos: np.ndarray, quads: np.ndarray, used: np.ndarray, body: int, shoulder_y: float) -> int:
    """The bottom of the underarm as a tailor sees it from the back: the top of the gap between arm and chest.

    The left half of the body is drawn as a silhouette at 1 mm per pixel; the highest row that still has a gap
    between the chest and the arm is the level, and the nearest body vertex to the top of the gap is the landmark.
    """
    from PIL import Image, ImageDraw

    x0, x1, y0, y1, scale = 0.05, 0.40, 0.25, shoulder_y, 1000.0
    width, height = int((x1 - x0) * scale), int((y1 - y0) * scale)
    img = Image.new("1", (width, height), 0)
    draw = ImageDraw.Draw(img)
    for q in quads:
        pts = pos[q]
        if pts[:, 0].max() < x0 or pts[:, 0].min() > x1 or pts[:, 1].max() < y0 or pts[:, 1].min() > y1:
            continue
        draw.polygon([((px - x0) * scale, (y1 - py) * scale) for px, py, _pz in pts], fill=1, outline=1)
    grid = np.asarray(img, dtype=bool)
    for row in range(height):
        line = grid[row]
        cols = np.nonzero(line)[0]
        if len(cols) == 0:
            continue
        inside = np.nonzero(~line[cols[0] : cols[-1]])[0]
        if len(inside) >= 2:
            gx = x0 + (cols[0] + inside.mean()) / scale
            gy = y1 - row / scale
            cand = np.nonzero(used & (np.arange(len(pos)) < body) & (pos[:, 0] > 0))[0]
            d = (pos[cand, 0] - gx) ** 2 + (pos[cand, 1] - gy) ** 2
            return int(cand[np.argsort(d, kind="stable")[0]])
    raise RuntimeError("no gap between the arm and the chest")


def unique_in_order(items: list[int]) -> list[int]:
    seen: set[int] = set()
    out = []
    for v in items:
        if v not in seen:
            seen.add(v)
            out.append(v)
    return out


def build() -> dict:
    mesh = read_obj(mh_data_dir() / "3dobjs" / "base.obj")
    pos = dm_to_m(mesh.positions)
    quads = np.asarray(mesh.face_verts, dtype=np.int64)
    body = BODY_VERTEX_COUNT
    body_quads = quads[(quads < body).all(axis=1)]
    used = np.zeros(len(pos), dtype=bool)
    used[body_quads.reshape(-1)] = True
    ruler = read_ruler()
    mirror = read_mirror()
    idx = np.arange(len(pos))
    x, y, z = pos[:, 0], pos[:, 1], pos[:, 2]

    def pick(mask: np.ndarray, key: np.ndarray, largest: bool = True) -> int:
        cand = idx[mask & used & (idx < body)]
        if len(cand) == 0:
            raise RuntimeError("landmark rule matched no vertex")
        order = np.argsort(key[cand], kind="stable")
        return int(cand[order[-1] if largest else order[0]])

    rings = {name: unique_in_order(ruler[key]) for key, name in RING_NAMES.items()}

    nape = ruler["napetowaist-dist"][0]
    crown = pick(np.abs(x) < 0.02, y)
    head = (y > y[nape] + 0.03) & used
    nose_tip = pick(head & (np.abs(x) < 0.004), z)
    # Head circumference: the tape goes round the brow ridge and the back of the skull. The ring is the loop of
    # vertices nearest the plane through the point above the brows and the rearmost point of the skull.
    brow = pick(head & (np.abs(x) < 0.004) & (y > y[nose_tip] + 0.035) & (y < y[nose_tip] + 0.075) & (z > 0), z)
    occiput = pick(head & (np.abs(x) < 0.004) & (y > y[nose_tip]) , z, largest=False)
    p0 = np.array([0.0, y[brow], z[brow]])
    p1 = np.array([0.0, y[occiput], z[occiput]])
    along = p1 - p0
    normal = np.array([0.0, -along[2], along[1]])
    normal /= np.linalg.norm(normal)
    dist = (pos - p0) @ normal
    head_ring_mask = head & (np.abs(dist) < 0.006) & (y > y[nose_tip] + 0.02) & (idx < body)
    # Leave the ears out: the tape passes above them, and they stand off the skull.
    head_ring_mask &= ~((np.abs(x) > 0.07) & (z < 0.03) & (z > -0.06) & (y < y[brow] - 0.005))
    centre = pos[head_ring_mask].mean(axis=0)
    ang = np.arctan2(pos[head_ring_mask][:, 2] - centre[2], pos[head_ring_mask][:, 0] - centre[0])
    rings["head"] = [int(v) for v in idx[head_ring_mask][np.argsort(ang, kind="stable")]]

    shoulder_l = ruler["upperarm-length"][0]
    neck_side_l = ruler["shoulder-dist"][0]
    elbow_l = ruler["upperarm-length"][1]
    wrist_l = ruler["lowerarm-length"][1]
    torso = (y > -0.25) & (y < y[nape])
    crotch = pick((np.abs(x) < 0.0015) & (y > -0.2) & (y < 0.05), y, largest=False)
    armpit_l = find_armpit(pos, body_quads, used, body, float(y[shoulder_l]))
    bust_l = pick(torso & (x > 0.05) & (x < 0.14) & (y > 0.33) & (y < 0.44) & (z > 0), z)
    seat_l = pick(torso & (x > 0.04) & (x < 0.14) & (y > -0.09) & (y < 0.07) & (z < 0), z, largest=False)
    sole_y = y[:body][used[:body]].min()
    heel_l = pick((x > 0) & (y < sole_y + 0.03), z, largest=False)
    waist_ring = np.asarray(rings["waist"])
    front = waist_ring[z[waist_ring] > z[waist_ring].mean()]
    waist_front_l = int(front[np.argmin(np.abs(x[front] - x[bust_l]))])
    waist_back = ruler["napetowaist-dist"][1]
    hip_front = ruler["waisttohip-dist"][1]

    def both(left: int) -> dict:
        right = int(mirror[left])
        if right == left or abs(x[right] + x[left]) > 2e-3:
            raise RuntimeError(f"vertex {left} has no mirror partner")
        return {"l": int(left), "r": right}

    points = {
        "crown": crown,
        "nape": int(nape),
        "noseTip": nose_tip,
        "brow": brow,
        "occiput": occiput,
        "crotch": crotch,
        "waistBack": int(waist_back),
        "waistFront": int(ruler["waisttohip-dist"][0]),
        "hipFront": int(hip_front),
    }
    pairs = {
        "shoulderTip": both(shoulder_l),
        "neckSide": both(neck_side_l),
        "armpit": both(armpit_l),
        "elbow": both(elbow_l),
        "wrist": both(wrist_l),
        "bustPoint": both(bust_l),
        "seatPoint": both(seat_l),
        "waistFrontUnderBust": both(waist_front_l),
        "kneeTop": both(ruler["upperleg-height"][1]),
        "ankle": both(ruler["lowerleg-height"][1]),
        "heel": both(heel_l),
    }
    # Rings on a limb are MakeHuman's left-side loops; the right side is their mirror image.
    side_rings = ["thigh", "knee", "calf", "ankle", "upperArm", "wrist"]
    ring_out = {}
    for name, verts in rings.items():
        entry: dict = {"vertices": verts}
        if name in side_rings:
            entry["side"] = "l"
            entry["mirror"] = [int(mirror[v]) for v in verts]
        ring_out[name] = entry
        if max(verts) >= body:
            raise RuntimeError(f"ring {name} leaves the body")
    return {
        "format": "ps2cc.anthro-landmarks/1",
        "source": "MakeHuman Ruler (0_modeling_a_measurement.py) for the rings and limb points; fixed geometric rules on the default mesh for the rest (tools/asset-compiler/ps2cc_assets/anthro.py)",
        "axes": "metres, Y up, facing +Z, the character's left is +X",
        "rings": ring_out,
        "points": points,
        "pairs": pairs,
    }


def run() -> dict:
    data = build()
    write_json(ASSETS_CORE / "anthro" / "landmarks.json", data)
    print(f"  anthro: {len(data['rings'])} rings, {len(data['points'])} points, {len(data['pairs'])} paired points")
    return {"files": ["anthro/landmarks.json"], "source": "makehuman"}
