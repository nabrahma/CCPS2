# Toolchain (pinned)

| Tool | Version | Notes |
| --- | --- | --- |
| Windows | 10/11 x64 | Only supported platform (PRD Fixed decision) |
| Node.js | 22.22.0 | `engines` in the root `package.json` |
| pnpm | 11.22.0 | `packageManager` in `package.json`. Supply-chain policies are on (minimum release age); `allowBuilds` permits only esbuild's install script |
| TypeScript | 5.9.3 | Not 7.x, see DECISIONS D-016 |
| Vite / Vitest | 8.3.6 / 5.1.0 | |
| React | 19.3.1 | |
| Three.js | 0.187.0 | WebGL2 only, no WebGPU features |
| meshoptimizer | 1.3.0 | `tools/asset-tools` at build time (outputs are committed), and in the app once per imported garment (D-063) |
| fast-check | 4.10.2 | |
| Playwright | 1.65.0 | `pnpm exec playwright install chromium`; WebGL through SwiftShader |
| Go | 1.26.4 | `app/go.mod` |
| Wails | v2.17.1 | `go install github.com/wailsapp/wails/v2/cmd/wails@v2.17.1` (not v3) |
| WebView2 | Evergreen runtime | Ships with Windows 11 |
| Python | 3.12.5 | Asset compiler only, see DECISIONS D-002 |
| numpy / Pillow | 2.2.6 / 10.4.0 | `tools/asset-compiler/requirements.txt` |
| C toolchain for cgo | mingw-w64 x86_64, GCC 16.1 (WinLibs UCRT, posix-seh, r3) at `C:\mingw64` | For ufbx: `pnpm test:go`, `pnpm build` and `pnpm build:installer` set `CC` (override with `PS2CC_CC`, see `scripts/cgo-env.mjs`). A plain `wails build` needs no C compiler but cannot read FBX (D-064). The old 32-bit MinGW.org 6.3 can stay on the PATH (DECISIONS D-018, D-048) |
| ufbx | v0.23.1, commit `26a482ae66871d7de36eb722aa060bce95bce274` | Vendored in `app/backend/fbx/ufbx`; SHA-256 `ufbx.c` 4a956c26…7e1d, `ufbx.h` f787be52…95dc, `LICENSE` 0dd48eba…5391 (MIT or public domain) |
| Unity | 6000.6.8f1 with URP 17.6.0 (built in) | Batchmode harness `tests/UnityHarness` (`pnpm test:unity`, set `PS2CC_UNITY` to use another editor). The package needs Unity 6 and URP 17 |
| NSIS | 3.11, portable zip `nsis-3.11.zip` from SourceForge (zlib licence), SHA-256 `c7d27f780ddb6cffb4730138cd1591e841f4b7edb155856901cdf5f214394fa1` (recorded on first download; NSIS publishes no SHA-256), unpacked to `tools/.toolcache/nsis-3.11` | Build time only, for the installer (`pnpm build:installer`). A normal NSIS install or `PS2CC_MAKENSIS` also works |
| glTF-Validator | `gltf-validator` 2.0.0-dev.3.10 (npm, Apache-2.0) | Checks every GLB before it is written |
| MediaPipe Tasks Vision | `@mediapipe/tasks-vision` 1.2.2, `face_landmarker.task` float16/1 | Bundled in `assets/core/vendor/mediapipe` (M6) |
| Git LFS | 3.5.1 | `assets/core/**` binaries, fixtures and docs images |

## Upstream data

Pinned by URL plus commit in `tools/asset-compiler/sources.json` and by SHA-256 in `tools/asset-compiler/sources.lock.json`. A changed upstream archive fails the build until someone reviews it.
