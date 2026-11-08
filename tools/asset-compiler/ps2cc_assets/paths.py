"""Well-known paths used by every compiler stage."""

from pathlib import Path

COMPILER_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = COMPILER_DIR.parent.parent
CACHE_DIR = COMPILER_DIR / ".cache"
ASSETS_CORE = REPO_ROOT / "assets" / "core"
FIXTURES_DIR = REPO_ROOT / "packages" / "core" / "test" / "fixtures"
