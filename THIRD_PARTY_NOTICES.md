# Third-party notices

PS2CC as a whole is licensed under [AGPL-3.0-or-later](LICENSE). The Unity package in `unity/com.ps2cc.importer` is licensed separately under [MIT](unity/com.ps2cc.importer/LICENSE.md).

## Code ported from copyleft projects

These parts follow the logic of the projects below closely, which is why PS2CC uses the AGPL. Comments in the source name the functions they follow.

| Project | Licence | Used in |
| --- | --- | --- |
| [MakeHuman](https://github.com/makehumancommunity/makehuman) | AGPL-3.0 | `packages/core/src/morph` (modifiers, macros), `packages/core/src/proxy/proxy.ts` (MHCLO fitting and weight transfer), `packages/core/src/skeleton`, `packages/core/src/expression` (pose units) |
| [Blender](https://www.blender.org/) `io_scene_fbx` | GPL-2.0-or-later | `app/backend/fbx` (binary FBX 7.4 writer), bone roll conversion in `packages/core/src/skeleton` |
| [MPFB](https://github.com/makehumancommunity/mpfb2) | GPL-3.0 | Rig and weight file formats, and fitting conventions |

## Methods ported from other work

| Work | Author | Used in |
| --- | --- | --- |
| [Anny](https://github.com/naver/anny) (Apache-2.0) | NAVER LABS Europe | The population sampler and the parity check follow its phenotype blending and shape distributions (`packages/core/src/population`, `tools/asset-compiler/ps2cc_assets/anny.py`). Its population calibration is shipped as `assets/core/population/calibration.json` under Apache-2.0: Anny, Copyright (C) 2025 NAVER Corporation. Its SMPL-X topology is never fetched or used. |
| [GarmentCode](https://github.com/maria-korosteleva/GarmentCode) (MIT) | Maria Korosteleva | Its body-measurement keys are produced by `packages/core/src/anthro` (`garmentCodeBody`). Its bundled SMPL-derived bodies are not used. |
| fdlibm | Sun Microsystems | The polynomial kernels of `packages/core/src/math/dmath.ts` (freely usable with this notice: "Developed at SunPro, a Sun Microsystems, Inc. business. Permission to use, copy, modify, and distribute this software is freely granted, provided that this notice is preserved."). |
| Cheng, "Generating Beta Variates with Nonintegral Shape Parameters", CACM 1978 | R. C. H. Cheng | `packages/core/src/math/distributions.ts` |
| *Geometry nodes - hair cards from curves* (a Blender file) | Daniel Bystedt | The card hair system follows its method: `packages/core/src/hair` ([docs/hair-system.md](docs/hair-system.md)). No content of the file is included in this repository or in PS2CC. Its hair node groups build on Blender's bundled hair nodes (GPL). |

Unmodified MakeHuman code is run at development time to generate test fixtures (`tools/asset-compiler/golden`). It is downloaded and not included in this repository.

## Character assets

Most files in `assets/core` come from MakeHuman's [asset packs](https://static.makehumancommunity.org/assets/assetpacks/index.html), under CC0-1.0 or CC-BY-4.0. [assets/core/LICENSES.json](assets/core/LICENSES.json) lists the source, licence and attribution of every file, and Help → Credits in the app shows the same list.

The CC-BY-4.0 hair, garments and accessories are by Elvaerwyn, punkduck, Mindfront, culturalibre, JALdMIC, MaciekG, grinsegold, DressUpDoc, DredNicolson, callharvey3d, MTKnife, Joel Palmius, janexx, madmanny, Mathias_Gredal, scailman, scsouza, sonicteam998, TioMegamanX, WojackOWL and EWS, shared through the MakeHuman community asset repository ([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)). PS2CC converted them to its proxy format, reduced their textures and decimated their meshes to PS2 budgets; the decimated files are marked "decimated by PS2CC" in LICENSES.json.

The material library, `assets/core/materials/`, is made from CC0 materials from [Poly Haven](https://polyhaven.com) (Rob Tuytel; colormass and Rico Cilliers) and [ambientCG](https://ambientcg.com) (Lennart Demes). PS2CC converted them to era diffuses and resized their maps; each file's source page is in LICENSES.json. CC0 asks for no credit; it is given anyway.

The scanned-face base skin, `assets/core/textures/skins/ps2cc_scan_lee.jpg`, is made from "Infinite, 3D Head Scan" by Lee Perry-Smith (Infinite Realities, based on a work at www.triplegangers.com), licensed under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). It was taken from the [three.js repository](https://github.com/mrdoob/three.js/tree/r187/examples/models/gltf/LeePerrySmith) (r187). PS2CC rendered the scan from three directions, projected the renders onto MakeHuman's neutral head, colour-matched the result to MakeHuman's young caucasian male skin (CC0) and composited it over that skin.

## Bundled and linked software

| Project | Licence | Where |
| --- | --- | --- |
| [ufbx](https://github.com/ufbx/ufbx) | MIT or public domain | `app/backend/fbx/ufbx` (with its `LICENSE`) |
| [MediaPipe Tasks Vision](https://github.com/google-ai-edge/mediapipe) | Apache-2.0 | `assets/core/vendor/mediapipe` (with its `NOTICE.txt`) |
| [meshoptimizer](https://github.com/zeux/meshoptimizer) | MIT | npm dependency, in the app bundle |
| [Three.js](https://github.com/mrdoob/three.js) | MIT | npm dependency, in the app bundle |
| [React](https://github.com/facebook/react) | MIT | npm dependency, in the app bundle |
| [Zustand](https://github.com/pmndrs/zustand) | MIT | npm dependency, in the app bundle |
| [Wails](https://github.com/wailsapp/wails) | MIT | Go dependency |

## Programs PS2CC works with (not included)

| Program | Licence | How |
| --- | --- | --- |
| [Material Painter](https://github.com/alla2001/material-painter) | GPL-3.0-or-later | Texture Studio (M13, D-115). The user installs it; PS2CC starts it and talks to its local agent-control server. No Material Painter code or assets are in this repository or in PS2CC. |

Build-time tools (NSIS, mingw-w64, Playwright and others) are listed in [TOOLCHAIN.md](TOOLCHAIN.md) and are not distributed with PS2CC.
