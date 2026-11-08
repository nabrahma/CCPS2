"""Run unmodified MakeHuman 1.x core modules headless, as the golden-test oracle.

Only modules that need a GUI, logging files or version-control metadata are
stubbed; the anatomy code under test (human.py, humanmodifier.py, targets.py,
algos3d.py, proxy.py, skeleton.py) is imported unchanged from the pinned
MakeHuman checkout in the asset-compiler cache.
"""

from __future__ import annotations

import sys
import types
from pathlib import Path

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE.parent))

from ps2cc_assets import fetch  # noqa: E402

MH_ROOT = fetch.source_dir("makehuman") / "makehuman"


def _stub_modules() -> None:
    log = types.ModuleType("log")
    for name in ("debug", "message", "notice", "warning", "error", "info"):
        setattr(log, name, lambda *a, **k: None)

    class _Logger:
        def __getattr__(self, _name):
            return lambda *a, **k: None

    log.getLogger = lambda *a, **k: _Logger()  # type: ignore[attr-defined]
    log.logger = _Logger()  # type: ignore[attr-defined]
    for lvl, val in (("DEBUG", 10), ("INFO", 20), ("WARNING", 30), ("ERROR", 40), ("CRITICAL", 50), ("MESSAGE", 25), ("NOTICE", 22)):
        setattr(log, lvl, val)
    sys.modules["log"] = log

    progress = types.ModuleType("progress")

    class Progress:
        def __init__(self, *a, **k):
            pass

        def __call__(self, *a, **k):
            return self

        def step(self, *a, **k):
            return self

        def firststep(self, *a, **k):
            return self

        def finish(self, *a, **k):
            return self

    progress.Progress = Progress  # type: ignore[attr-defined]
    sys.modules["progress"] = progress

    profiler = types.ModuleType("profiler")
    profiler.active = lambda: False  # type: ignore[attr-defined]
    profiler.accum = lambda *a, **k: (lambda f: f)  # type: ignore[attr-defined]
    sys.modules["profiler"] = profiler

    mhversion = types.ModuleType("mhversion")

    class MHVersion:
        currentBranch = "golden"
        currentShortCommit = "a8bc2d5"

    mhversion.MHVersion = MHVersion  # type: ignore[attr-defined]
    sys.modules["mhversion"] = mhversion

    # Image loading needs Qt; the oracle never loads textures.
    image = types.ModuleType("image")
    sys.modules["image"] = image


def boot():
    """Import MakeHuman's core modules and return (human, humanmodifier, module dict)."""
    for sub in ("", "lib", "apps", "shared", "core"):
        p = str(MH_ROOT / sub) if sub else str(MH_ROOT)
        if p not in sys.path:
            sys.path.append(p)
    _stub_modules()

    import getpath

    root = str(MH_ROOT)

    def get_sys_path(sub_path=""):
        import os

        return getpath.formatPath(os.path.join(root, sub_path) if sub_path else root)

    getpath.getSysPath = get_sys_path
    getpath.getPath = lambda sub_path="": get_sys_path(sub_path)  # never touch the user's home

    from core import G

    G.app = None

    import files3d
    import human as mh_human
    import humanmodifier

    base = files3d.loadMesh(getpath.getSysDataPath("3dobjs/base.obj"), maxFaces=5)
    h = mh_human.Human(base)
    for name in ("modeling", "bodyshapes", "measurement"):
        humanmodifier.loadModifiers(getpath.getSysDataPath(f"modifiers/{name}_modifiers.json"), h)
    h.applyAllTargets()
    # skeleton.py reads the human through the app object (G.app.selectedHuman) when fitting
    # joints; the oracle has no app, so expose just that attribute.
    G.app = types.SimpleNamespace(selectedHuman=h)
    _numpy1_copy_semantics()
    return h, humanmodifier


def _numpy1_copy_semantics() -> None:
    """transformations.py calls numpy.array(..., copy=False), which NumPy 2 rejects
    whenever a copy is needed. Give that module NumPy 1's meaning ("copy only if
    needed", i.e. numpy.asarray); nothing else changes."""
    import numpy
    import transformations

    shim = types.ModuleType("numpy")
    shim.__dict__.update(numpy.__dict__)

    def array(obj, dtype=None, copy=True, **kw):
        if copy is False:
            return numpy.asarray(obj, dtype=dtype)
        return numpy.array(obj, dtype=dtype, copy=copy, **kw)

    shim.array = array  # type: ignore[attr-defined]
    transformations.numpy = shim  # type: ignore[attr-defined]
