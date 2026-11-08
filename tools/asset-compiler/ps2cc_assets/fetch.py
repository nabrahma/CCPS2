"""Stage 1: download pinned upstream sources and verify their checksums.

Downloads go to ``tools/asset-compiler/.cache/downloads`` (git-ignored) and are
extracted to ``.cache/extracted/<id>``. The first successful download of a
source records its SHA-256 in ``sources.lock.json``; every later run verifies
against that value and fails loudly on a mismatch (upstream changed or a
download was corrupted).
"""

from __future__ import annotations

import hashlib
import json
import shutil
import sys
import tarfile
import time
import urllib.request
import zipfile
from pathlib import Path

from .paths import CACHE_DIR, COMPILER_DIR

SOURCES_FILE = COMPILER_DIR / "sources.json"
LOCK_FILE = COMPILER_DIR / "sources.lock.json"
DOWNLOAD_DIR = CACHE_DIR / "downloads"
EXTRACT_DIR = CACHE_DIR / "extracted"

USER_AGENT = "ps2cc-asset-compiler/0.1"
CHUNK = 1 << 20


def load_sources() -> list[dict]:
    return json.loads(SOURCES_FILE.read_text(encoding="utf-8"))["sources"]


def load_lock() -> dict[str, dict]:
    if LOCK_FILE.exists():
        return json.loads(LOCK_FILE.read_text(encoding="utf-8"))
    return {}


def save_lock(lock: dict[str, dict]) -> None:
    LOCK_FILE.write_text(json.dumps(lock, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(CHUNK), b""):
            h.update(block)
    return h.hexdigest()


def archive_name(src: dict) -> str:
    if src["kind"] == "file":
        # A single file (e.g. a model); keep its extension.
        return src["id"] + Path(src["url"].rsplit("/", 1)[-1]).suffix
    return f"{src['id']}.tar.gz" if src["kind"] == "github-tarball" else f"{src['id']}.zip"


def _download(url: str, dest: Path, retries: int = 3) -> None:
    tmp = dest.with_suffix(dest.suffix + ".part")
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=120) as resp, tmp.open("wb") as out:
                total = int(resp.headers.get("Content-Length") or 0)
                done = 0
                last = time.monotonic()
                while block := resp.read(CHUNK):
                    out.write(block)
                    done += len(block)
                    if time.monotonic() - last > 5:
                        pct = f"{100 * done / total:.0f}%" if total else f"{done >> 20} MiB"
                        print(f"    ... {dest.name}: {pct}", flush=True)
                        last = time.monotonic()
            tmp.replace(dest)
            return
        except OSError as exc:  # URLError and socket errors are OSError subclasses
            print(f"    attempt {attempt} failed: {exc}", flush=True)
            if attempt == retries:
                raise
            time.sleep(2 * attempt)


def fetch_source(src: dict, lock: dict[str, dict]) -> Path:
    """Ensure the archive for ``src`` is downloaded and verified. Returns its path."""
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
    dest = DOWNLOAD_DIR / archive_name(src)
    expected = lock.get(src["id"], {}).get("sha256")

    if dest.exists() and expected and sha256_file(dest) == expected:
        print(f"  [ok]   {src['id']} (cached)")
        return dest

    urls = [src["url"]] + ([src["mirror"]] if src.get("mirror") else [])
    last_error: Exception | None = None
    for url in urls:
        print(f"  [get]  {src['id']} <- {url}", flush=True)
        try:
            _download(url, dest)
            break
        except OSError as exc:
            last_error = exc
    else:
        raise RuntimeError(f"could not download {src['id']}: {last_error}")

    digest = sha256_file(dest)
    if expected and digest != expected:
        raise RuntimeError(
            f"checksum mismatch for {src['id']}: expected {expected}, got {digest}. "
            "Upstream changed; review the new content before updating sources.lock.json."
        )
    if not expected:
        lock[src["id"]] = {"sha256": digest, "size": dest.stat().st_size, "url": src["url"]}
        save_lock(lock)
        print(f"  [lock] {src['id']} sha256={digest[:16]}...")
    return dest


def _safe_members_zip(zf: zipfile.ZipFile, root: Path):
    for info in zf.infolist():
        target = (root / info.filename).resolve()
        if not str(target).startswith(str(root.resolve())):
            raise RuntimeError(f"unsafe path in archive: {info.filename}")
        yield info


def extract(src: dict, archive: Path) -> Path:
    out = EXTRACT_DIR / src["id"]
    marker = out / ".ps2cc-extracted"
    digest = load_lock()[src["id"]]["sha256"]
    if marker.exists() and marker.read_text().strip() == digest:
        return out
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    if src["kind"] == "file":
        shutil.copyfile(archive, out / src["url"].rsplit("/", 1)[-1])
    elif archive.suffix == ".zip":
        with zipfile.ZipFile(archive) as zf:
            for info in _safe_members_zip(zf, out):
                zf.extract(info, out)
    else:
        with tarfile.open(archive, "r:gz") as tf:
            # GitHub tarballs wrap everything in "<repo>-<sha>/": strip that
            # prefix while extracting (renaming afterwards trips over Windows
            # file locks held by antivirus scanners).
            members = []
            for member in tf.getmembers():
                parts = member.name.split("/", 1)
                if len(parts) < 2 or not parts[1]:
                    continue
                member.name = parts[1]
                members.append(member)
            tf.extractall(out, members=members, filter="data")
    marker.write_text(digest)
    print(f"  [unz]  {src['id']} -> {out}")
    return out


def source_dir(source_id: str) -> Path:
    path = EXTRACT_DIR / source_id
    if not (path / ".ps2cc-extracted").exists():
        raise RuntimeError(f"source '{source_id}' is not fetched; run `pnpm build:assets` (fetch stage)")
    return path


def run(only: list[str] | None = None) -> None:
    lock = load_lock()
    for src in load_sources():
        if only and src["id"] not in only:
            continue
        archive = fetch_source(src, lock)
        extract(src, archive)


if __name__ == "__main__":
    run(sys.argv[1:] or None)
