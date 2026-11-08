"""PS2CC binary container ("PSCB").

A compiled asset is a pair of files:

* ``<name>.json`` - metadata plus a ``buffers`` table: ``{name: {offset, dtype, count}}``
* ``<name>.bin``  - raw little-endian arrays, each aligned to 16 bytes

The TypeScript loader (``packages/core/src/io/container.ts``) reads the same layout,
so keep the two in sync. All float data is float32, all indices are uint32 unless a
buffer says otherwise.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

ALIGN = 16
DTYPES = {"f32": np.float32, "u32": np.uint32, "u16": np.uint16, "i16": np.int16, "i32": np.int32, "u8": np.uint8}


class ContainerWriter:
    def __init__(self) -> None:
        self._chunks: list[bytes] = []
        self._size = 0
        self.buffers: dict[str, dict] = {}

    def add(self, name: str, array: np.ndarray, dtype: str) -> None:
        if name in self.buffers:
            raise ValueError(f"duplicate buffer {name}")
        arr = np.ascontiguousarray(array, dtype=DTYPES[dtype]).reshape(-1)
        if dtype.startswith("f") and not np.all(np.isfinite(arr)):
            raise ValueError(f"buffer {name} contains NaN/Inf")
        pad = (-self._size) % ALIGN
        if pad:
            self._chunks.append(b"\0" * pad)
            self._size += pad
        self.buffers[name] = {"offset": self._size, "dtype": dtype, "count": int(arr.size)}
        data = arr.astype(arr.dtype.newbyteorder("<"), copy=False).tobytes()
        self._chunks.append(data)
        self._size += len(data)

    def write(self, base: Path, meta: dict) -> None:
        """Write ``<base>.json`` and ``<base>.bin`` (extensions are appended, never replaced)."""
        base.parent.mkdir(parents=True, exist_ok=True)
        bin_path = base.parent / (base.name + ".bin")
        json_path = base.parent / (base.name + ".json")
        with bin_path.open("wb") as f:
            for chunk in self._chunks:
                f.write(chunk)
        doc = dict(meta)
        doc["binary"] = bin_path.name
        doc["byteLength"] = self._size
        doc["buffers"] = self.buffers
        write_json(json_path, doc)


def write_json(path: Path, data, compact: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if compact:
        text = json.dumps(data, separators=(",", ":"), sort_keys=False)
    else:
        text = json.dumps(data, indent=1, sort_keys=False)
    path.write_text(text + "\n", encoding="utf-8")
