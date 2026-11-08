# PS2CC

**Make PlayStation 2-era characters with sliders and drop them into Unity.**

PS2CC is a Windows desktop character creator with a late-PS2 / early-PS3 look. It is built on the [MakeHuman](http://www.makehumancommunity.org/) character system and adds a PS2-budget body, a PS2 preview, card hair and a one-click export of a Humanoid-ready FBX.

It needs no Blender, no Python and no network connection to run.

![PS2CC: a character in the viewport, with navigation on the left and the wardrobe on the right](docs/milestones/UI/wardrobe.png)

## What it does

- **Body and face:** MakeHuman's morph system, with curated sliders, symmetry, locks, randomize, and undo.
- **PS2-sized meshes:** 8k, 10k and 12k triangle bodies, with a live budget meter for triangles, texture memory, bones and blendshapes.
- **Wardrobe:** CC0 garments reduced to PS2 budgets, which refit to every body shape and hide the skin underneath. Drop a PNG on a garment to retexture it.
- **Your own garments:** export the base body, model around it, then import OBJ, FBX or GLB. PS2CC binds, weights and decimates it for you.
- **Card hair:** generate hair-card styles from your own atlas textures, or use MakeHuman hair meshes.
- **Skin:** layered skin with overlays, and projection of a face photo onto the head.
- **Expressions:** 15 blendshapes, including blinks and visemes, baked at export.
- **PS2 preview:** per-vertex lighting, lighting presets, and low resolution, 16-bit dither and interlace post effects.
- **Unity export:** one FBX per character, with textures. The included Unity package sets up the Humanoid avatar, PS2 URP shaders, materials and a prefab.

## Status

All planned milestones are built and tested, and the project is young. It is Windows only. There are no prebuilt downloads yet, so you build it from source. [docs/milestones/STATUS.md](docs/milestones/STATUS.md) lists what each milestone covers and how it was tested, and [TODO_ART.md](TODO_ART.md) lists the known gaps in art.

Custom garment import has been tested with generated garments, but not yet with a wide range of hand-modelled files. Reports are very welcome.

## Build from source

You need [Git LFS](https://git-lfs.com/), Node 22 with pnpm 11, Go 1.26, the [Wails v2](https://wails.io/) CLI and a 64-bit mingw-w64 compiler. Exact versions are in [TOOLCHAIN.md](TOOLCHAIN.md).

```powershell
git lfs install
git clone https://github.com/nabrahma/CCPS2.git
cd CCPS2
go install github.com/wailsapp/wails/v2/cmd/wails@v2.17.1
pnpm install
pnpm build
.\app\build\bin\PS2CC.exe
```

The compiled character assets come with the clone through Git LFS. `PS2CC.exe` looks for `assets/core` next to itself or in a parent folder; you can also set `PS2CC_ASSETS`. Your characters and library are stored in `Documents\PS2CC\`, and logs in `%LOCALAPPDATA%\PS2CC\logs\`.

If `mingw-w64` is not at `C:\mingw64`, set `PS2CC_CC` to its `gcc.exe`.

## Use it in Unity

PS2CC targets Unity 6 with URP.

1. In Unity, open **Package Manager → Add package from disk** and choose `unity/com.ps2cc.importer/package.json`.
2. In PS2CC, open **Export**, choose your Unity project and click **Export to Unity**.

The character imports as a Humanoid prefab, ready for retargeted animation.

## Make your own garment

1. **Wardrobe → Base body (OBJ)…** saves the body to model around (metres, Y up, facing +Z). Do not move, scale or rotate it.
2. Model the garment around it and unwrap it. Stay outside the skin; a few millimetres is enough.
3. Export only the garment as OBJ, FBX or GLB (not compressed GLB).
4. **Wardrobe → Import garment…**, or drop the file on the window. Its slot sets the triangle budget.
5. Drop a PNG on it to texture it. The Inspector exports a UV template to paint over.

## Development

```powershell
pnpm --filter @ps2cc/app-frontend dev  # the UI in a browser, without the Go backend
pnpm dev                 # the desktop app with hot reload
pnpm lint                # ESLint
pnpm typecheck           # TypeScript
pnpm test                # TypeScript unit, golden and property tests
pnpm test:go             # Go tests, including FBX read-back with ufbx
pnpm test:desktop        # the app against the real Go backend
pnpm test:unity          # batch import of the test characters into Unity
pnpm build:installer     # NSIS installer (needs NSIS 3.11, see TOOLCHAIN.md)
pnpm test:installer      # silent install, start and uninstall of that installer
```

Browser tests: `cd app/frontend; pnpm exec playwright test`.

To rebuild the compiled assets from the original sources, which is only needed if you change the asset pipeline:

```powershell
pnpm build:assets        # downloads pinned MakeHuman data (about 1.2 GB, checksummed)
pnpm golden              # golden fixtures from MakeHuman's own Python
pnpm build:landmarks     # face landmark table for photo projection
pnpm export:testchars    # the exports used by the FBX and Unity tests
```

| Path | What it is |
| --- | --- |
| `packages/core/` | The character engine in TypeScript: morphs, skeleton, garment fitting, hair, skin, export scene. No DOM or Three.js |
| `packages/viewport/` | The Three.js viewport: PS2 shader, post effects, presets, picking |
| `app/` | The Wails desktop app: Go backend (including the FBX writer) and React frontend |
| `unity/com.ps2cc.importer/` | The Unity package |
| `assets/core/` | Compiled character assets (Git LFS) |
| `tools/` | Build-time asset compiler (Python) and mesh tools (Node). Never shipped |
| `tests/UnityHarness/` | Unity project for the batch import test |
| `docs/` | The [product spec](docs/PRD.md) and each milestone's status, reports and screenshots |

Design decisions and the reasons for them are in [DECISIONS.md](DECISIONS.md). See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## Licence

| Part | Licence |
| --- | --- |
| The app, engine and tools | [AGPL-3.0-or-later](LICENSE) |
| `unity/com.ps2cc.importer` | [MIT](unity/com.ps2cc.importer/LICENSE.md), so it can ship inside your games |
| Character assets | CC0-1.0, with a few CC-BY-4.0 files, each listed in [assets/core/LICENSES.json](assets/core/LICENSES.json) |

Characters you create and export are yours; the AGPL covers PS2CC's code, not what you make with it. PS2CC is AGPL because parts of it are ported from MakeHuman and Blender. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Credits

PS2CC stands on the work of the [MakeHuman](http://www.makehumancommunity.org/) community, whose CC0 assets make it possible, and on [Blender](https://www.blender.org/), [ufbx](https://github.com/ufbx/ufbx), [meshoptimizer](https://github.com/zeux/meshoptimizer), [Three.js](https://threejs.org/), [Wails](https://wails.io/) and [MediaPipe](https://developers.google.com/mediapipe).
