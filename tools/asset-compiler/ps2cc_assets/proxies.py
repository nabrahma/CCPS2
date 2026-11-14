"""Stage: convert MHCLO assets (eyes, brows, lashes, teeth, tongue, hair, clothes) and skins.

Every converted asset is written as ``assets/core/proxies/<category>/<name>.{json,bin}``
with its diffuse texture downscaled into ``assets/core/textures/``. Each shipped
file is registered with the licence collector so it lands in ``LICENSES.json``.
"""

from __future__ import annotations

import io
import json
import re
import zlib
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, UnidentifiedImageError

from . import fetch
from .binfmt import ContainerWriter, write_json
from .licenses import LicenseCollector
from .mhclo import UnsupportedProxy, parse_mhclo, parse_mhmat
from .obj import read_obj
from .paths import ASSETS_CORE
from .units import DM_TO_M

# Texture budgets at build time (the app downscales again on export).
TEXTURE_SIZE = {
    "skins": 2048,
    "clothes": 1024,
    "hair": 1024,
    "eyes": 512,
    "eyebrows": 512,
    "eyelashes": 512,
    "teeth": 256,
    "tongue": 256,
}

PROXY_CATEGORIES = ["eyes", "eyebrows", "eyelashes", "teeth", "tongue", "hair", "clothes"]

# Assets that ship content outside the PRD's scope (non-goal: nudity/anatomical detail).
EXCLUDE_PATTERNS = [re.compile(p) for p in (r"genital", r"thong", r"nude", r"naked", r"special_suit", r"(^|_)string_\d",
                                              r"erotic", r"transparent_bra", r"slave")]

# Community assets named after, or made as, other people's characters and works: their designs are not the
# uploader's to license (D-150). Also the annotated UV-guide skin, which is a modelling aid, not a skin.
EXCLUDE_NOT_LICENSABLE = {
    "culturalibre_el_chapulin_colorado", "culturalibre_doc_ock_glasses", "culturalibre_dr_manhattan",
    "culturalibre_tigra_skin", "culturalibre_tigra_white_skin", "culturalibre_tigra_tail",
    "green_tomato_rei_ayanami", "green_tomato_yoko_tsuno", "slayer227_spider-gwen",
    "freezychan_lucoa_quetzalcoatl_horns", "jaldmic_houndoom_horns", "jaldmic_toriel_horns",
    "punkduck_deathnote_t-shirt", "punkduck_kill_bill_shoes", "punkduck_p-ivy_weapon",
    "reizibarrientos_white_walker_skin", "joepal_annotated_skin",
    # Generic "hero" outfits whose look copies a known character's costume.
    "culturalibre_hero-heroine_hood_2", "culturalibre_hero_suit_3", "culturalibre_heroine_suit_7",
}

# Garment slot inference: first matching rule wins; anything unmatched is an accessory.
SLOT_RULES: list[tuple[str, re.Pattern]] = [
    ("accessory", re.compile(r"\b(suitcase|handbag|purse|shopping bag|sling purse)\b")),
    ("shoes", re.compile(r"shoe|boot(?!y)|sneaker|sandal|heel|flats|loafer|balletflat|maryjane|\bt bar\b")),
    # Two-piece swimwear and underwear before the rest: their tops and bottoms are separate garments.
    ("top", re.compile(r"\b(bikini \w*\s?bra|bikini top|bandeau bra|bra)\b")),
    ("bottom", re.compile(r"\b(slip|briefs?|panty|panties|trunks|bikini bottom|bootyshorts|socks?|leg warmer)\b")),
    ("full", re.compile(r"\b(bikini|swimsuit|swimwear|bodysuit|skinsuit|wetsuit|romper|babydoll|baby doll|shapewear|coveralls?|armor|ninja|robe)\b")),
    ("gloves", re.compile(r"glove|mitten|armsleeve")),
    ("hat", re.compile(r"hat|fedora|cap\b|beanie|helmet|hood\b|beret")),
    ("outer", re.compile(r"coat|jacket|sweater|cardigan|hoodie|vest|blazer")),
    ("full", re.compile(r"suit|dress|overall|jumpsuit|gown|robe|casualsuit|worksuit|sportsuit|uniform")),
    ("bottom", re.compile(r"pant|jean|trouser|short|skirt|legging|stocking|pantyhose|tights|sarong")),
    ("top", re.compile(r"shirt|top|tee|blouse|camisole|bodice|tank|polo|halter|bra\b|corset|tunic")),
]

# Authors' prefixes on community garments: "dressupdoc_maryjane1" is shoes, not a dress.
AUTHOR_PREFIXES = (
    "aethelraed_", "callharvey3d_", "cortu_", "culturalibre_", "donitz_", "drednicolson_", "dressupdoc_", "elvs_", "ews_",
    "frankyaye_", "freezychan_", "gredal_", "green_tomato_", "grinsegold_", "jaldmic_", "janexx_", "javherre_", "joachip_",
    "joepal_", "jujube_", "kwnet_at_", "learning_", "maciekg_", "madmanny_", "matcreator_", "mindfront_", "mrgreaterthan_",
    "mtknife_", "namuhekam_", "o4saken_", "punkduck_", "rehmanpolanski_", "scailman_", "scsouza_", "slayer227_",
    "sonicteam998_", "spamrakuen_", "thegreatengineer_", "tiomegamanx_", "toigo_", "wdg_", "wojackowl_", "wolgade_",
)

# Single garments whose pack or name says otherwise.
SLOT_OVERRIDE = {
    "mindfront_tactical_vest_female": "outer",
    "mindfront_tactical_vest_male": "outer",
    "elvs_swimwear_micro_shorts": "bottom",
    # The robe's hood pieces, worn with or without the robe.
    "donitz_monk_robe_hood": "hat",
    "donitz_monk_robe_hood_down": "hat",
    "donitz_monk_robe_hood_off": "hat",
}

SOURCES_WITH_PROXIES = [
    "makehuman_system_assets",
    "eyebrows01",
    "eyelashes01",
    "hair01",
    "shirts01",
    "pants01",
    "shoes01",
    "suits01",
    "underwear01",
    "hats01",
    "gloves01",
    "dress01",
    "skirts01",
    # More of MakeHuman's asset packs, CC0 and CC-BY (D-150): hair, garments and accessories.
    "hair02",
    "hair03",
    "shirts02",
    "shirts03",
    "pants02",
    "pants03",
    "shoes02",
    "shoes03",
    "suits02",
    "suits03",
    "suits04",
    "suits05",
    "dress02",
    "dress03",
    "skirts02",
    "hats02",
    "hats03",
    "hats04",
    "underwear02",
    "underwear03",
    "underwear04",
    "glasses01",
    "glasses02",
    "jewelry01",
    "jewelry02",
    "masks01",
    "masks02",
    "bodyparts01",
    "bodyparts02",
    "bodyparts03",
    "bodyparts04",
    "bodyparts05",
    "bodyparts06",
    "equipment01",
    "equipment02",
    "equipment03",
]
SOURCES_WITH_SKINS = ["makehuman_system_assets", "skins01", "skins02", "skins03"]
SOURCES_WITH_EYE_COLOURS = ["makehuman_system_assets", "system_eye_materials01"]

# Packs whose garments are all one slot, whatever their names say ("short_beard" is not shorts).
PACK_SLOT = {
    "hats01": "hat",
    "hats02": "hat",
    "hats03": "hat",
    "hats04": "hat",
    "glasses01": "accessory",
    "glasses02": "accessory",
    "jewelry01": "accessory",
    "jewelry02": "accessory",
    "masks01": "accessory",
    "masks02": "accessory",
    "bodyparts01": "accessory",
    "bodyparts02": "accessory",
    "bodyparts03": "accessory",
    "bodyparts04": "accessory",
    "bodyparts05": "accessory",
    "bodyparts06": "accessory",
    "equipment01": "accessory",
    "equipment02": "accessory",
    "equipment03": "accessory",
}


@dataclass
class PackInfo:
    licence: str
    author: str
    source_url: str


def load_pack_metadata(source_id: str) -> dict[str, PackInfo]:
    root = fetch.source_dir(source_id) / "packs"
    out: dict[str, PackInfo] = {}
    if not root.exists():
        return out
    for f in root.glob("*.json"):
        data = json.loads(f.read_text(encoding="utf-8"))
        for name, info in data.items():
            if not isinstance(info, dict):
                continue
            out[name.lower()] = PackInfo(
                licence=str(info.get("license") or "").strip(),
                author=str(info.get("author") or "").strip(),
                source_url=str(info.get("source") or "").strip(),
            )
    return out


def normalise_licence(raw: str) -> str | None:
    r = raw.upper().replace(" ", "")
    if r in ("CC0", "CC01.0", "CC0-1.0"):
        return "CC0-1.0"
    if r in ("CC-BY", "CCBY", "CC-BY4.0", "CCBY4.0", "CC-BY-4.0"):
        return "CC-BY-4.0"
    return None


def infer_slot(name: str, tags: list[str]) -> str:
    name = name.lower()
    for prefix in AUTHOR_PREFIXES:
        if name.startswith(prefix):
            name = name[len(prefix):]
            break
    # Words, not file-name tokens: "bikini02_bra" has no word boundary before "bra" until the "_" goes.
    text = re.sub(r"[_\-]+", " ", " ".join([name, *tags]))
    for slot, rx in SLOT_RULES:
        if rx.search(text):
            return slot
    return "accessory"


def _open_image(src: Path) -> Image.Image:
    """Open a texture. Some community PNGs carry an optional chunk (a colour profile, text) with a bad
    checksum, which Pillow refuses; those chunks are dropped and the image data is read as it is."""
    try:
        return Image.open(src)
    except UnidentifiedImageError:
        data = src.read_bytes()
        if data[:8] != b"\x89PNG\r\n\x1a\n":
            raise
        out, i = bytearray(data[:8]), 8
        while i + 12 <= len(data):
            n = int.from_bytes(data[i:i + 4], "big")
            kind = data[i + 4:i + 8]
            chunk = data[i:i + 12 + n]
            ancillary = bool(kind[0] & 0x20)
            ok = zlib.crc32(data[i + 4:i + 8 + n]) == int.from_bytes(data[i + 8 + n:i + 12 + n], "big")
            if ok or not ancillary:
                out += chunk
            i += 12 + n
            if kind == b"IEND":
                break
        return Image.open(io.BytesIO(bytes(out)))


def save_texture(src: Path, dest_base: Path, max_size: int, keep_alpha: bool) -> tuple[str, tuple[int, int]]:
    """Downscale a texture. Opaque textures become JPEG (q92), alpha textures PNG.

    ``dest_base`` has no extension; returns (file name with extension, size).
    """
    dest_base.parent.mkdir(parents=True, exist_ok=True)
    with _open_image(src) as im:
        im.load()
        has_alpha = im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info)
        if has_alpha and keep_alpha:
            im = im.convert("RGBA")
            # Fully opaque alpha channels are not worth keeping.
            if im.getchannel("A").getextrema()[0] == 255:
                im = im.convert("RGB")
        else:
            im = im.convert("RGB")
        scale = min(1.0, max_size / max(im.size))
        if scale < 1.0:
            size = (max(1, round(im.size[0] * scale)), max(1, round(im.size[1] * scale)))
            im = im.resize(size, Image.Resampling.LANCZOS)
        if im.mode == "RGBA":
            dest = dest_base.with_name(dest_base.name + ".png")
            im.save(dest, format="PNG", optimize=True)
        else:
            dest = dest_base.with_name(dest_base.name + ".jpg")
            im.save(dest, format="JPEG", quality=92, subsampling=0)
        return dest.name, im.size


_BASE_POSITIONS = None


def base_positions() -> np.ndarray:
    """The neutral hm08 base mesh (decimetres), for checks against it."""
    global _BASE_POSITIONS
    if _BASE_POSITIONS is None:
        from .basemesh import mh_data_dir

        _BASE_POSITIONS = read_obj(mh_data_dir() / "3dobjs" / "base.obj").positions
    return _BASE_POSITIONS


def convert_proxy(category: str, asset_dir: Path, mhclo_path: Path, source_id: str, pack: PackInfo,
                  lic: LicenseCollector) -> dict | None:
    clo = parse_mhclo(mhclo_path)
    if clo.shear_signs:
        # The engine scales by the unsigned span (as MakeHuman does for scale data). A shear box whose
        # reference vertices run the other way on the neutral body would mirror the garment: refuse it.
        pos = base_positions()
        for axis, (v1, v2, span) in enumerate(clo.shear_signs):
            if (pos[v1][axis] - pos[v2][axis]) * span <= 0:
                raise UnsupportedProxy(f"{mhclo_path.name}: shear box on axis {'xyz'[axis]} is mirrored")
    obj_name = clo.obj_file or (mhclo_path.stem + ".obj")
    obj_path = asset_dir / obj_name
    if not obj_path.exists():
        raise UnsupportedProxy(f"{mhclo_path.name}: missing obj {obj_name}")
    mesh = read_obj(obj_path)
    if len(mesh.positions) != len(clo.ref_verts):
        raise UnsupportedProxy(
            f"{mhclo_path.name}: obj has {len(mesh.positions)} verts but mhclo binds {len(clo.ref_verts)}"
        )
    if len(mesh.uvs) == 0:
        raise UnsupportedProxy(f"{mhclo_path.name}: obj has no UVs")

    asset_name = re.sub(r"[^a-z0-9_\-]", "_", mhclo_path.stem.lower())
    asset_id = f"mh:{category}/{asset_name}"
    base = ASSETS_CORE / "proxies" / category / asset_name

    material = None
    texture_rel = None
    mat_path = asset_dir / (clo.material_file or (mhclo_path.stem + ".mhmat"))
    if mat_path.exists():
        mat = parse_mhmat(mat_path)
        material = {
            "diffuseColor": list(mat.diffuse_color),
            "transparent": mat.transparent or mat.alpha_to_coverage,
            "backfaceCull": mat.backface_cull,
            "opacity": mat.opacity,
        }
        if mat.diffuse_texture:
            # MakeHuman resolves textures relative to the .mhmat, falling back to the asset folder.
            tex_src = mat_path.parent / mat.diffuse_texture
            if not tex_src.exists():
                tex_src = asset_dir / Path(mat.diffuse_texture).name
            if tex_src.exists():
                keep_alpha = category in ("hair", "eyebrows", "eyelashes", "clothes")
                fname, size = save_texture(
                    tex_src, ASSETS_CORE / "textures" / category / asset_name, TEXTURE_SIZE[category], keep_alpha
                )
                texture_rel = f"textures/{category}/{fname}"
                material["diffuseTexture"] = texture_rel
                material["textureSize"] = list(size)
                lic.add(texture_rel, asset_id, pack.licence, pack.author, pack.source_url, source_id)

    w = ContainerWriter()
    # Proxy OBJ positions are in decimetres like the base mesh (only used for reference/tests).
    w.add("restPositions", mesh.positions * DM_TO_M, "f32")
    w.add("uvs", mesh.uvs, "f32")
    w.add("faceVerts", mesh.face_verts, "u32")
    w.add("faceUvs", mesh.face_uvs, "u32")
    w.add("refVerts", clo.ref_verts, "u32")
    w.add("refWeights", clo.weights, "f32")
    w.add("refOffsets", clo.offsets_m, "f32")
    if clo.delete_verts:
        w.add("deleteVerts", np.asarray(clo.delete_verts, dtype=np.uint32), "u32")
    meta = {
        "format": "ps2cc.proxy/1",
        "id": asset_id,
        "category": category,
        "name": clo.name,
        "uuid": clo.uuid,
        "tags": clo.tags,
        "zDepth": clo.z_depth,
        "vertexCount": int(len(mesh.positions)),
        "faceCount": int(len(mesh.face_verts)),
        "triangleFaces": int(mesh.is_triangle.sum()) if mesh.is_triangle is not None else 0,
        "scale": [list(s) for s in clo.scale] if clo.scale else None,
        "material": material,
    }
    if category == "clothes":
        meta["slot"] = SLOT_OVERRIDE.get(asset_name) or PACK_SLOT.get(source_id) or infer_slot(asset_name, clo.tags)
    w.write(base, meta)
    for suffix in (".json", ".bin"):
        lic.add(f"proxies/{category}/{asset_name}{suffix}", asset_id, pack.licence, pack.author, pack.source_url, source_id)
    tri_count = int(len(mesh.face_verts) * 2 - (mesh.is_triangle.sum() if mesh.is_triangle is not None else 0))
    return {
        "id": asset_id,
        "category": category,
        "name": clo.name,
        "file": f"proxies/{category}/{asset_name}.json",
        "thumbnail": None,
        "triangles": tri_count,
        "slot": meta.get("slot"),
        "tags": clo.tags,
        "licence": pack.licence,
        "pack": source_id,
        "author": pack.author,
    }


def convert_skin(skin_dir: Path, source_id: str, pack: PackInfo, lic: LicenseCollector) -> dict | None:
    mats = sorted(skin_dir.glob("*.mhmat"))
    if not mats:
        return None
    mat = parse_mhmat(mats[0])
    if not mat.diffuse_texture:
        return None
    tex_src = skin_dir / Path(mat.diffuse_texture).name
    if not tex_src.exists():
        return None
    name = re.sub(r"[^a-z0-9_\-]", "_", skin_dir.name.lower())
    asset_id = f"mh:skins/{name}"
    fname, size = save_texture(tex_src, ASSETS_CORE / "textures" / "skins" / name, TEXTURE_SIZE["skins"], keep_alpha=False)
    rel = f"textures/skins/{fname}"
    lic.add(rel, asset_id, pack.licence, pack.author, pack.source_url, source_id)
    tags = [t for t in ("young", "middleage", "old", "male", "female", "african", "asian", "caucasian") if t in name]
    return {"id": asset_id, "category": "skins", "name": mat.name, "texture": rel, "textureSize": list(size), "tags": tags,
            "licence": pack.licence, "pack": source_id, "author": pack.author}


EYE_AUTHOR_PREFIXES = ("bobby_03_", "mindfront_", "nyloseth_", "spamrakuen_sr_", "wojackowl_")


def eye_colour_name(stem: str) -> str:
    """"bobby_03_diffuse_amber_eyes" -> "amber"; "wojackowl_blue_eyes_toon" -> "blue toon"."""
    name = stem.lower()
    for prefix in EYE_AUTHOR_PREFIXES:
        if name.startswith(prefix):
            name = name[len(prefix):]
    name = re.sub(r"^diffuse_", "", name)
    name = re.sub(r"_eyes?(_|$)", r"\1", name)
    name = re.sub(r"_0*(\d+)$", r" \1", name)
    return name.replace("_", " ").replace("-", " ").strip()


def convert_eye_colours(lic: LicenseCollector) -> list[dict]:
    """Eye colour textures (PRD F3: eye colour = texture choice + tint): MakeHuman's own and the eye material pack."""
    out = []
    for source_id in SOURCES_WITH_EYE_COLOURS:
        root = fetch.source_dir(source_id) / "eyes" / "materials"
        meta = load_pack_metadata(source_id)
        system = source_id == "makehuman_system_assets"
        for mat_path in sorted(root.rglob("*.mhmat")):
            if system:
                info = PackInfo("CC0-1.0", "MakeHuman team", "https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html")
            else:
                found = meta.get(mat_path.stem.lower()) or meta.get(mat_path.parent.name.lower())
                licence = normalise_licence(found.licence) if found else None
                if not found or not licence:
                    continue
                info = PackInfo(licence, found.author, found.source_url)
            mat = parse_mhmat(mat_path)
            if not mat.diffuse_texture:
                continue
            src = mat_path.parent / mat.diffuse_texture
            if not src.exists():
                src = mat_path.parent / Path(mat.diffuse_texture).name
            if not src.exists():
                continue
            name = re.sub(r"[^a-z0-9_\-]", "_", mat_path.stem.lower())
            fname, size = save_texture(src, ASSETS_CORE / "textures" / "eyes" / f"colour_{name}", TEXTURE_SIZE["eyes"], keep_alpha=False)
            rel = f"textures/eyes/{fname}"
            asset_id = f"mh:eyecolour/{name}"
            lic.add(rel, asset_id, info.licence, info.author, info.source_url, source_id)
            out.append({"id": asset_id, "name": name.replace("_", " ") if system else eye_colour_name(mat_path.stem), "texture": rel})
    return out


def run(lic: LicenseCollector) -> dict:
    catalog: list[dict] = []
    skipped: list[dict] = []

    def pack_for(meta: dict[str, PackInfo], source_id: str, name: str) -> PackInfo | None:
        info = meta.get(name.lower())
        if info is None and source_id == "makehuman_system_assets":
            # System assets are CC0 by the pack page, even when an entry is missing in the json.
            info = PackInfo("CC0", "MakeHuman team", "https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html")
        return info

    for source_id in SOURCES_WITH_PROXIES:
        root = fetch.source_dir(source_id)
        meta = load_pack_metadata(source_id)
        for category in PROXY_CATEGORIES:
            cat_dir = root / category
            if not cat_dir.exists():
                continue
            for asset_dir in sorted(p for p in cat_dir.iterdir() if p.is_dir()):
                if asset_dir.name.lower() in EXCLUDE_NOT_LICENSABLE:
                    skipped.append({"asset": f"{source_id}/{category}/{asset_dir.name}", "reason": "another work's character or design"})
                    continue
                if any(rx.search(asset_dir.name.lower()) for rx in EXCLUDE_PATTERNS):
                    skipped.append({"asset": f"{source_id}/{category}/{asset_dir.name}", "reason": "excluded by content policy"})
                    continue
                for mhclo_path in sorted(asset_dir.glob("*.mhclo")):
                    info = pack_for(meta, source_id, mhclo_path.stem) or pack_for(meta, source_id, asset_dir.name)
                    licence = normalise_licence(info.licence) if info else None
                    if info is None or licence is None:
                        skipped.append({"asset": str(mhclo_path.name), "reason": f"licence not CC0/CC-BY ({info.licence if info else 'unknown'})"})
                        continue
                    info = PackInfo(licence, info.author, info.source_url)
                    try:
                        entry = convert_proxy(category, asset_dir, mhclo_path, source_id, info, lic)
                    except (UnsupportedProxy, OSError, SyntaxError, ValueError) as exc:
                        skipped.append({"asset": f"{source_id}/{mhclo_path.name}", "reason": f"{type(exc).__name__}: {exc}"})
                        continue
                    if entry:
                        if any(e["id"] == entry["id"] for e in catalog):
                            skipped.append({"asset": entry["id"], "reason": "duplicate id"})
                            continue
                        catalog.append(entry)

    skins: list[dict] = []
    for source_id in SOURCES_WITH_SKINS:
        root = fetch.source_dir(source_id) / "skins"
        if not root.exists():
            continue
        meta = load_pack_metadata(source_id)
        for skin_dir in sorted(p for p in root.iterdir() if p.is_dir()):
            if skin_dir.name.lower() in EXCLUDE_NOT_LICENSABLE:
                skipped.append({"asset": f"skins/{skin_dir.name}", "reason": "another work's character or design"})
                continue
            if any(rx.search(skin_dir.name.lower()) for rx in EXCLUDE_PATTERNS) or skin_dir.name == "toon01":
                skipped.append({"asset": f"skins/{skin_dir.name}", "reason": "excluded by content policy"})
                continue
            info = pack_for(meta, source_id, skin_dir.name)
            licence = normalise_licence(info.licence) if info else None
            if info is None or licence is None:
                skipped.append({"asset": f"skins/{skin_dir.name}", "reason": "licence not CC0/CC-BY"})
                continue
            entry = convert_skin(skin_dir, source_id, PackInfo(licence, info.author, info.source_url), lic)
            if entry:
                skins.append(entry)

    eye_colours = convert_eye_colours(lic)
    doc = {"format": "ps2cc.catalog/1", "proxies": catalog, "skins": skins, "eyeColours": eye_colours}
    # Keep what later build steps add across re-runs: body meshes, hair atlases and the material library
    # (tools/asset-tools and the build tools), and PS2CC's own garments and skins (ids not "mh:").
    previous = ASSETS_CORE / "catalog.json"
    if previous.exists():
        old = json.loads(previous.read_text(encoding="utf-8"))
        for key, value in old.items():
            if key not in doc:
                doc[key] = value
        doc["proxies"] += [p for p in old.get("proxies", []) if not p["id"].startswith("mh:")]
        doc["skins"] += [s for s in old.get("skins", []) if not s["id"].startswith("mh:")]
    write_json(previous, doc)
    write_json(ASSETS_CORE / "catalog_skipped.json", skipped)
    by_cat: dict[str, int] = {}
    for e in catalog:
        by_cat[e["category"]] = by_cat.get(e["category"], 0) + 1
    print(f"  proxies: {by_cat}; skins: {len(skins)}; skipped: {len(skipped)}")
    return {"files": ["catalog.json"]}
