# PS2CC

**Make PlayStation 2-era characters with sliders and drop them into Unity.**

PS2CC is a Windows desktop character creator with a late-PS2 / early-PS3 look. It is built on the [MakeHuman](http://www.makehumancommunity.org/) character system and adds a PS2-budget body, a PS2 preview, card hair and a one-click export of a Humanoid-ready FBX.

It needs no Blender, no Python and no network connection to run.

![PS2CC: a face in the viewport, and the Brows panel of the editor with its brow brush](docs/milestones/UI/brows.png)

## What it does

- **Workspace:** a big viewport and an editor with one category per part of the character (Body, Face, Skin, Eyes, Brows, Lashes, Makeup, Mouth, Hair, Clothes, Look, Export). Each category shows only its own controls and frames its part in the viewport. A status bar shows the budget. Save characters anywhere and move your data folder to any drive. See [docs/workspace.md](docs/workspace.md).
- **Character Creator:** the simple controls for each part, and a library of presets, hairstyles, garments, outfits, skins and materials shown as thumbnails under your look, with favourites, a filter and search. The deep editors are in the **Asset Studio**: Hair, Texture, Garment and Material Studio, whose saved work joins the library. See [docs/creator-and-studio.md](docs/creator-and-studio.md).
- **Body and face:** MakeHuman's morph system, with curated sliders, symmetry, locks, randomize, undo, and your own presets.
- **Quality profiles:** Classic, Enhanced and Hero set every budget at once (12k to 30k triangles, 512 to 2048 textures), with bodies from 8k triangles to the full MakeHuman mesh and a live budget meter for triangles, texture memory, bones and blendshapes.
- **Wardrobe:** over 500 garments and accessories from MakeHuman's CC0 and CC-BY asset packs (tops, trousers, dresses, suits, shoes, hats, helmets, glasses, jewellery, masks, beards, horns, tails, wings and weapons), reduced to PS2 budgets. They refit to every body shape and hide the skin underneath. Drop a PNG on a garment to retexture it.
- **Materials:** dress garments in a library of CC0 leathers, denims, knits and other cloth, converted to the era's single diffuse, or make your own from a photo in Material Studio. Seams, stitches and folds are drawn automatically, and you can add zips, buttons, buckles, straps and pockets.
- **Garment Studio:** reshape a garment, crop it, roll its sleeves, grow a collar or cuffs, add pockets, and save it as a new garment that fits every body. See [docs/materials-and-wardrobe.md](docs/materials-and-wardrobe.md).
- **Your own garments:** export the base body, model around it, then import OBJ, FBX or GLB. PS2CC binds, weights and decimates it for you.
- **Card hair:** three layers: short hair painted on the scalp, wide locks for the mass, and soft-edged detail cards. Any colour from strand atlases rendered in 3D. Comb the guides in Hair Studio with Blender-style brushes, draw the parting, and shape locks. The same cards grow fur trims on garments. Or use one of 70 MakeHuman hair meshes. See [docs/hair-v2.md](docs/hair-v2.md) and [docs/hair-system.md](docs/hair-system.md).
- **Texture Studio:** paint the skin or a garment in [Material Painter](https://github.com/alla2001/material-painter) (free, installed separately) and bring the paint back in one click. Skin paint stays put whatever the body's shape. See [docs/texture-studio.md](docs/texture-studio.md).
- **Skin:** 66 base skins, natural and fantasy or horror (zombie, alien, orc, elf), then layered skin with overlays, pores and stubble micro-detail, projection of a face photo (or a front and two side photos) onto the head, and an optional fit of the face's shape to the photo. A scanned face is included as a base skin.
- **Face and eyes:** a head texture laid out to give the face twice the detail, generated eyes from an iris library, brows and lashes painted on the skin hair by hair (no cut-out strips), with presets, detailed settings and a brow brush, and low-poly teeth, tongue and mouth interior. See [docs/face-and-eyes.md](docs/face-and-eyes.md).
- **Expressions:** 15 blendshapes, including blinks and visemes, baked at export.
- **PS2 preview:** per-vertex or per-pixel lighting with shadows, graded looks (fog, filmic curve, LUT, bloom, grain), low resolution, 16-bit dither and interlace effects, and textures shown at their export size. Looks save as `.ps2look` files for Unity.
- **Baking:** a GPU ray tracer bakes occlusion, cavity and thickness from the whole character into its textures, the way the era's games baked shading. See [docs/look-foundation.md](docs/look-foundation.md).
- **Unity export:** one FBX per character, with textures. The included Unity package sets up the Humanoid avatar, PS2 URP shaders that light the same way as the app, materials and a prefab. A PS2 Look component applies a saved look in your scene.

## Screenshots

All taken in the app.

| <img src="docs/milestones/M15/cole_villageOvercast_full.png" alt="A man in a leather jacket and cargo trousers, full body"> | <img src="docs/milestones/M15/mara_villageOvercast_full.png" alt="A woman in a utility vest and trousers, full body"> |
| :-: | :-: |
| Cole: a leather jacket and cargo trousers | Mara: a utility vest over a roll-neck |

| <img src="docs/milestones/M11/look_interiorFlashlight_hero_threeQuarter.png" alt="A man lit by a flashlight in the dark"> | <img src="docs/milestones/M11/look_foggyTown_hero_threeQuarter.png" alt="The same man in grey fog"> | <img src="docs/milestones/M11/look_villageOvercast_hero_threeQuarter.png" alt="The same man under an overcast sky"> |
| :-: | :-: | :-: |
| Interior flashlight | Foggy town | Village overcast |

| <img src="docs/milestones/M11/bake_off_bust.png" alt="A bust without the bake"> | <img src="docs/milestones/M11/bake_on_bust.png" alt="The same bust with occlusion and cavity baked in"> |
| :-: | :-: |
| Before the bake | After: occlusion, cavity and thickness baked into the textures |

| <img src="docs/milestones/Face/look_smoky_front.png" alt="A pale face with dark brows and smoky eyes, front"> | <img src="docs/milestones/Face/look_smoky_threeQuarter.png" alt="The same face from three-quarters"> | <img src="docs/milestones/Face/painted_eye.png" alt="A close-up of a brown eye, brow and lashes"> |
| :-: | :-: | :-: |
| Brows and lashes painted hair by hair | A smoky eye and thick brows | Up close |

| <img src="docs/milestones/Hair/bob-fringe_threeQuarter.png" alt="A red bob with a fringe"> | <img src="docs/milestones/M12/ponytail_threeQuarter.png" alt="A ponytail"> | <img src="docs/milestones/M12/short-messy_threeQuarter.png" alt="Short messy hair"> |
| :-: | :-: | :-: |
| Card hair: a bob with a fringe | A ponytail | Short and messy |

| <img src="docs/milestones/UI/mouth.png" alt="The Mouth panel, with the mouth open to show the teeth and tongue"> | <img src="docs/milestones/M12/ui_hair_studio.png" alt="Hair Studio with a bob being combed"> | <img src="docs/milestones/M16/ui_garment_studio.png" alt="Garment Studio with a T-shirt"> |
| :-: | :-: | :-: |
| Each part has its own panel; Mouth opens the mouth | Hair Studio: comb the guides with brushes | Garment Studio: reshape, crop and save garments |

## Status

All planned milestones are built and tested, and the project is young. It is Windows only. [docs/milestones/STATUS.md](docs/milestones/STATUS.md) lists what each milestone covers and how it was tested, and [TODO_ART.md](TODO_ART.md) lists the known gaps in art.

Custom garment import has been tested with generated garments, but not yet with a wide range of hand-modelled files. Reports are very welcome.

## Download

Get the installer from [Releases](https://github.com/nabrahma/CCPS2/releases/latest): `PS2CC-<version>-windows-x64-setup.exe` (Windows 10 or 11, 64-bit). It installs the app and its character assets, about 330 MB, and adds Start menu and desktop shortcuts. The installer is not code-signed, so Windows SmartScreen may warn you: choose **More info → Run anyway**. For Unity, also download `com.ps2cc.importer.zip` (see [Use it in Unity](#use-it-in-unity)).

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

The compiled character assets come with the clone through Git LFS. `PS2CC.exe` looks for `assets/core` next to itself or in a parent folder; you can also set `PS2CC_ASSETS`. Your characters and library are stored in `Documents\PS2CC\` unless you move them (**Settings → Data folder**, see [docs/workspace.md](docs/workspace.md)), and logs in `%LOCALAPPDATA%\PS2CC\logs\`.

If `mingw-w64` is not at `C:\mingw64`, set `PS2CC_CC` to its `gcc.exe`.

## Use it in Unity

PS2CC targets Unity 6 with URP.

1. Unzip `com.ps2cc.importer.zip` from the release (or use `unity/com.ps2cc.importer` in a clone). In Unity, open **Package Manager → Add package from disk** and choose its `package.json`.
2. In PS2CC, open **Export**, choose your Unity project and click **Export to Unity**.

The character imports as a Humanoid prefab, ready for retargeted animation.

## Make your own garment

1. **Clothes → Your own garments → Base body (OBJ)…** saves the body to model around (metres, Y up, facing +Z). Do not move, scale or rotate it.
2. Model the garment around it and unwrap it. Stay outside the skin; a few millimetres is enough.
3. Export only the garment as OBJ, FBX or GLB (not compressed GLB).
4. **Clothes → Your own garments → Import garment…**, or drop the file on the window. Its slot sets the triangle budget.
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
| Character assets | CC0-1.0 and CC-BY-4.0 (credited in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and Help → Credits), and one CC-BY-3.0 head scan, each file listed in [assets/core/LICENSES.json](assets/core/LICENSES.json) |

Characters you create and export are yours; the AGPL covers PS2CC's code, not what you make with it. PS2CC is AGPL because parts of it are ported from MakeHuman and Blender. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Credits

PS2CC stands on the work of the [MakeHuman](http://www.makehumancommunity.org/) community, whose CC0 assets make it possible, on the Infinite Realities head scan of Lee Perry-Smith (CC BY 3.0), on the CC0 materials of [Poly Haven](https://polyhaven.com) and [ambientCG](https://ambientcg.com), and on [Blender](https://www.blender.org/), [ufbx](https://github.com/ufbx/ufbx), [meshoptimizer](https://github.com/zeux/meshoptimizer), [Three.js](https://threejs.org/), [Wails](https://wails.io/) and [MediaPipe](https://developers.google.com/mediapipe).
