# Contributing to PS2CC

Thanks for helping. Bug reports, tests with your own garments and Unity projects, and code are all welcome.

## Before you start

For anything larger than a small fix, please open an issue first so we can agree on the approach. [DECISIONS.md](DECISIONS.md) records why things are the way they are, and [docs/PRD.md](docs/PRD.md) is the product spec.

## Setup

Follow **Build from source** in the [README](README.md). Exact tool versions are in [TOOLCHAIN.md](TOOLCHAIN.md). Git LFS is required: the assets and test data are stored in it.

## Before you open a pull request

Run what your change touches:

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm test:go
cd app/frontend; pnpm exec playwright test
```

If you change the export or FBX code, also run `pnpm test:unity` (needs Unity 6), or say in the pull request that you could not.

## Ground rules

- **Assets must be CC0 or CC-BY.** Never add anything ripped from a game, and never add photos of people without the right to share them. Every shipped asset needs an entry in `assets/core/LICENSES.json`. If art is missing, add it to [TODO_ART.md](TODO_ART.md) rather than faking it.
- **No network calls at runtime.** PS2CC works fully offline.
- **No nudity or explicit content** beyond the plain base body. Genital and similar assets are excluded on purpose.
- **Keep to the version pins.** Dependencies are pinned, and a change needs a reason in `TOOLCHAIN.md` or `DECISIONS.md`.
- **Add tests with behaviour changes.** Mesh and fitting code is compared against MakeHuman's own output where possible.
- Files use LF line endings (`.gitattributes` enforces this).
- Record significant design choices in `DECISIONS.md`.

## Licence of contributions

By contributing, you agree that your contribution is licensed under the licence of the part it changes: AGPL-3.0-or-later for the project, and MIT for `unity/com.ps2cc.importer`. Do not port code into the Unity package from MakeHuman, Blender or other copyleft projects, since it needs to stay MIT.
