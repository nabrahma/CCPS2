# Third-party notices

PS2CC as a whole is licensed under [AGPL-3.0-or-later](LICENSE). The Unity package in `unity/com.ps2cc.importer` is licensed separately under [MIT](unity/com.ps2cc.importer/LICENSE.md).

## Code ported from copyleft projects

These parts follow the logic of the projects below closely, which is why PS2CC uses the AGPL. Comments in the source name the functions they follow.

| Project | Licence | Used in |
| --- | --- | --- |
| [MakeHuman](https://github.com/makehumancommunity/makehuman) | AGPL-3.0 | `packages/core/src/morph` (modifiers, macros), `packages/core/src/proxy/proxy.ts` (MHCLO fitting and weight transfer), `packages/core/src/skeleton`, `packages/core/src/expression` (pose units) |
| [Blender](https://www.blender.org/) `io_scene_fbx` | GPL-2.0-or-later | `app/backend/fbx` (binary FBX 7.4 writer), bone roll conversion in `packages/core/src/skeleton` |
| [MPFB](https://github.com/makehumancommunity/mpfb2) | GPL-3.0 | Rig and weight file formats, and fitting conventions |

Unmodified MakeHuman code is run at development time to generate test fixtures (`tools/asset-compiler/golden`). It is downloaded and not included in this repository.

## Character assets

The files in `assets/core` come from MakeHuman's asset packs: CC0-1.0, with a few under CC-BY-4.0. [assets/core/LICENSES.json](assets/core/LICENSES.json) lists the source, licence and attribution of every file.

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

Build-time tools (NSIS, mingw-w64, Playwright and others) are listed in [TOOLCHAIN.md](TOOLCHAIN.md) and are not distributed with PS2CC.
