# Milestone status

As of 2026-11-09. The PRD says a milestone is done only when every acceptance test passes **and you accept the build**. You accepted M0–M3 on 2026-11-07, M4 to M8 on 2026-11-08, and M9 and M10 by 2026-11-09. Golden fixtures are generated (`pnpm golden`) and all golden tests pass against MakeHuman's own Python.

| Milestone | State | Acceptance tests |
| --- | --- | --- |
| **M0** Foundations and asset compiler | Accepted | ✅ Asset compiler fetches pinned, checksummed sources and converts them. ✅ Every shipped file has a row in `assets/core/LICENSES.json` (CC0 only). ✅ Lint and type-check pass. ✅ Golden fixtures generated from MakeHuman's own Python (51 characters, 6 proxy sets). Two oracle fixes were needed: exposing the headless human to `skeleton.py`, and rebuilding the macro targets after a reset, as the GUI does. ✅ GitHub CI passes on a clean Windows runner. |
| **M1** Morph engine and sliders | Accepted | ✅ Golden ≤ 1e-4 m on 51 sets: worst vertex 1.7e-5 m, target weights equal. ✅ 1,000 random full-range slider sets: no NaN or Inf, plausible bounds. ✅ Undo (≥ 200 steps, drags merge), presets, randomize, symmetry, search, curated/all. ⏳ 60 fps on a GTX 1060-class GPU: the fps and morph time are shown live in the budget bar; please confirm on your machine (SwiftShader, which is software rendering, gives about 20 fps). |
| **M2** Skeleton and skinning | Accepted | ✅ Joints ≤ 1e-4 m: worst 8.6e-6 m. ✅ Every vertex has 1–4 weights summing to 0.999–1.001. ✅ Rest-pose skinning is the identity. ✅ Viewport pose test (procedural walk). ⏳ Posed screenshots of 4 extreme characters: use the Pose test toggle. |
| **M3** PS2 body, eyes, skins, preview | Accepted | ✅ 8k/10k/12k meshes within ±3% (8,000 / 10,000 / 11,998). ✅ Vertex map is a subset of hm08. ✅ No flipped faces. ✅ Face keeps ≥ 90% (97% / 100% / 100%). ✅ Screenshot set of 6 characters under Flashlight in `docs/milestones/M3/`. |
| **M4** Wardrobe | Accepted | ✅ Slots, several garments at once, z-depth order, tint, brightness, dirt. ✅ Hidden body faces: MakeHuman `delete_verts` for 82 garments, computed by raycasting for 24 more, and none for 10 see-through garments (D-025, D-026; review images in `M4/hidden_faces/`). ✅ **Poke-through property test:** 200 random bodies × 2 garments over all three body tiers, every garment worn at least 3 times; deepest vertex 1.3 mm inside, limit 2 mm. This needed a new garment collision step (D-024). ✅ **Drop a test PNG** on a garment in the real UI, then check the rendered pixel (`e2e/m4.spec.ts`; `M4/drop_texture_applied.png`). ✅ **UV template export** (Inspector → Export UV template, 1024 px over the current texture) with a pixel test against the garment UVs. ✅ Build-time decimation (vertex subset, bindings verified). ✅ Golden fit ≤ 1e-4 m: worst 2.7e-5 m. Review renders: `M4/review_*.png`. Known limits: computed hidden faces hide less on the coarse 8k tier (now the default, D-031), about 3% of the body for a polo shirt against 9% on 12k; the garment collider keeps the cloth outside the rest. Thin slivers of background can show at a few garment edges (halter-neck sides, under short sleeves), where a body triangle is only partly under the cloth. |
| **M5** Hair cards | Accepted | ✅ **Determinism (hash test):** all 8 starter styles regenerate identically from their seed (fresh generators, snapshot hashes in `packages/core/test/fixtures/hair_hashes.json`), and a different seed gives different hair. ✅ **Collision:** no card vertex inside the head/shoulder proxy across 200 random heads (closest approach 1.0 mm outside). ✅ **Follows head sliders:** with the head-scale sliders at their maximum (+17%) and with an exact +20% head scale, card roots stay attached (gap change < 3 mm). ✅ **Budget:** every style is within its own budget, and the card topology is the same on every body. ✅ Route A: re-texture by dropping a PNG on a hair mesh, tint, cutoff and UV template; meshes decimated to 3,500 triangles (2 still over, in TODO_ART). ✅ Route B: atlas editor (auto-detect strips with a grid fallback; move, resize, add, delete and tag regions; 3 templates; `atlas.json` saved beside the PNG), hairline mask (4 presets plus custom sliders), guides with gravity, flow, part, volume, curl, bangs and ponytail, cards with layers, taper and atlas regions by tag, scalp shell, binding and head/neck skinning, `.ps2hair` save and load, cutout and dithered outer layer. Review renders: `M5/contact_sheet.png` and `M5/style_*.png`; UI: `M5/ui_hair_panel.png`, `M5/ui_atlas_editor.png`. **Known limits:** short styles still look a little like an undercut at the sides and nape. The ponytail's tail is thin. The built-in atlas is a repurposed mesh texture (TODO_ART). |
| **M6** Skin stack and photo projection | Accepted | ✅ **Compositing matches the reference** (`e2e/m6.spec.ts`): an 18-layer synthetic stack (every blend mode, masked and not, HSV tone tints) on the GPU is at most 2 levels off the core reference, on 27 of 262,144 values. The real 2048 px composite is at most 1 level off (D-035). ✅ **Head UV remap** (`packages/core/test/skin.test.ts`): on all three tiers every head UV lands inside 0..1 and the packed head islands never overlap. Every PS2 triangle has exactly one material, head and body UVs never overlap in hm08, and the crop carries the composite's texels to the remapped UVs (D-034). ✅ **Projection on 5 photos: eyes and mouth within 4 texels at 1024 px**, checked by re-running landmarks on a render. Worst landmark 2.05 texels; a control photo misregistered on purpose reads 6.1 and fails, as it should (D-041). ⚠️ The 5 photos are stand-ins (renders of 5 other MakeHuman characters) because no photos of yours or CC0 portraits have been supplied yet. Put yours in `docs/milestones/M6/test_photos/` and the same test uses them. ✅ Layer stack (top wins), each layer with opacity, blend mode (normal, multiply, overlay, screen) and region mask (face, body, hands). Layers: tone tint, dark circles, eye bags, stubble, lips, eyeliner/eyeshadow, blush, freckles, dirt, bruises, sweat and your PNG overlays. Exports: skin UV template (2048 px), face region guide, and the head and body textures as the exporter will write them. ✅ Photo projection: MediaPipe Face Landmarker bundled offline (D-037) and a landmark table built from the neutral render (D-038). Piecewise-affine warp on a Delaunay triangulation, visibility and facing weights, feathered face mask, LAB colour match, frontal-pose and uneven-lighting warnings, progress and cancel (D-039, D-040). ✅ PS2 body fix: the mouth and eye corners are now locked (D-042); all tiers rebuilt and re-tested. Review images: `M6/layers_*.png`, `M6/projection_*.png`, `M6/export_head_texture.png`, `M6/export_body_texture.png`, `M6/region_guide.png`, `M6/landmark_table.png`, `M6/ui_skin_panel.png`; reports `M6/compositing_report.json` and `M6/projection_report.json`. **Known limits:** procedural layers are stand-ins, not photo-sourced art. A photo's features are painted at the mesh's positions, so a face shaped very differently from the character loses its own proportions; "Fit face shape to photo" helps (see below). About 40% of the head texture is unused (one uniform scale, D-034). MediaPipe reads MakeHuman renders as tilted about 16° (D-040). |
| **M7** Export and Unity package | Accepted | ✅ **glTF-Validator: 0 errors** (and 0 warnings) on the 10 test characters' GLBs (D-047). ✅ **ufbx loads the 10 exported test characters with no errors or warnings, and every round-trip check passes** (`app/backend/fbx/roundtrip_test.go`, `pnpm test:go`): hierarchy and bone names, bind matrices, positions within 1e-5 m, normals, UVs, weights within 1e-6, materials and texture paths, blendshape names and deltas, Y up / +Z front / metres. ✅ **Property and fuzz tests of the writer pass:** 300 random scenes (random bone trees including gimbal lock, meshes, 1–4 weights, material slots, sparse blendshapes) round-trip through ufbx; two fuzzers (decode + write, and decode + write + ufbx read-back) found one real issue, now rejected at decode (D-043). Output is byte-for-byte deterministic apart from the time stamp. ✅ **Unity batchmode harness** (`pnpm test:unity`, Unity 6000.6.8f1, URP 17.6) imports the same 10 characters: valid Humanoid avatars, PS2 materials with their textures, triangles within the 12k budget, 3–5 renderers, metres with feet at y = 0, facing +Z, rest-pose skinning exact (0.00 mm), and a Humanoid walk retargets without broken limbs (D-046; renders in `M7/unity/` and `M7/unity_retarget_contact_sheet.png`). The first run found that the FBX SDK rejected every file because of the header time (D-043); fixed. ✅ Export panel: Unity project or any folder, T-pose option, GLB option, progress and cancel, over-budget override (`e2e/m7.spec.ts`, `M7/ui_export_panel.png`). Files: `<Name>.fbx`, `<Name>.ps2cc.json`, `Textures/<Name>_Head_D.png`, `_Body_D`, `_Hair_D`, `_Garments_D`, `_Eyes_D`, optional `<Name>.glb`. ✅ Unity package `unity/com.ps2cc.importer`: importer, humanoid map, `PS2/Skin`, `PS2/Cutout`, `PS2/Cloth` and the optional `PS2/LookFullscreen`, prefab with `Animator` and `PS2CharacterInfo`. ⚠️ Fix to M6: the GPU skin compositor piled each new layer stack onto the previous result (D-049); fixed and now tested. **Known limits:** the retarget check uses a walk built from muscle curves, not a Mixamo clip (put clips in `tests/UnityHarness/Assets/Animations` to have them checked too). Blendshapes are written and tested in the format, but none are baked until M8. No LOD exports. |
| **M8** Expressions | Accepted | ✅ **All default blendshapes present on every affected mesh in Unity** (`pnpm test:unity`, Unity 6000.6.8f1): the 15 defaults (`blink_L`, `blink_R`, `jawOpen`, `smile`, `frown`, `browsUp`, `browsDown`, `squint`, `AA`, `EE`, `IH`, `OH`, `OU`, `FV`, `MBP`) are on every head, and every mesh the sidecar says a shape moves has it (36 to 51 shapes per character across head, body, eyes atlas and hair). Applied in Unity, blink moves the eyelids 9.5 to 13.6 mm and the lashes with them (12 to 18 mm); jawOpen 26 to 39 mm. ufbx reads back every shape's name, indices, deltas and normal deltas on the 10 test characters (`pnpm test:go`). ✅ **Blink closes the eyelids fully without lashes intersecting the eyeball (screenshot):** on 6 characters over the three body tiers, zero of about 1,200 to 1,400 view rays reach the eyeball with the lids closed, and the closed blink adds no visible lash crossing (`packages/core/test/expression-scene.test.ts`, D-052, D-053); Unity close-ups in `M8/unity/*_eye_closed.png` and `M8/unity_expressions_contact_sheet.png`. ✅ **jawOpen opens the mouth without tearing:** seams move together exactly (0 mm), no edge outside the parting lips stretches over 3.4x, the chin drops 23 to 26 mm and the lower teeth follow (22 to 27 mm when worn); a few lip triangles fold, as on MakeHuman's own mesh (D-053). ✅ Pose-unit baking ported from MakeHuman and golden-tested against it (worst 6e-7 m, D-050); expression map (`expression_map.json`); transfer to brows, lashes, eyes, teeth, garments and hair (D-051); Expressions panel with a preview slider and a bake checkbox per shape, blendshape count in the budget bar (`e2e/m8.spec.ts`, `M8/ui_expressions_panel.png`, `M8/preview_sheet_*.png`); GLB morph targets (0 validator errors); Unity `PS2Expressions` component to set shapes by name. **Known limits:** the viseme and smile/frown/squint mappings are my reading of the pose units and want your review (TODO_ART). Part-way through a blink a few lash edges dip into the eye surface (also with MakeHuman's own pose); no in-between frames. The open mouth shows MakeHuman's pink mouth-interior texture and, without teeth (MakeHuman's are 7,120 triangles), reads a little like a tongue. |
| **M9** Projects, renders, polish | Accepted by you (clean-VM result not reported to me) | ✅ **Round trip: save -> load gives an identical export.** In the browser build (`e2e/m9.spec.ts`), two characters (card hair, garments with dirt, skin layers, blendshapes, one in a T-pose) give a byte-identical GLB and a byte-identical export message (FBX data, every texture, sidecar) after save, page reload and open. Against the Go backend (`pnpm test:desktop`) the same after save, reload and open from the character browser. Three real causes of difference were fixed (D-055), including GLTFExporter writing images in a random order. Saving is idempotent over 200 random characters (`engine.test.ts`). ✅ **Kill the process mid-edit and recovery restores the last autosave** (`pnpm test:desktop`): edit, autosave, edit again, end the Go process the hard way; on the next start the recovery prompt appears and Restore gives exactly the last autosave, marked unsaved (`M9/ui_recovery_prompt.png`). ⏳ **Installer installs and runs on a clean Windows 11 VM:** the installer is built (`pnpm build:installer`, 136 MB, NSIS 3.11). `pnpm test:installer` passes on the build machine (14 checks: silent install in 25 s, the installed app starts with its assets from the install folder and the UI loads them, uninstall removes the program files and leaves the home folder alone); shortcuts and the uninstall entry were confirmed gone afterwards. The clean-VM run is still to do and needs you (`M9/installer_vm_check.md`). ✅ Character browser with thumbnails, open and duplicate (`M9/ui_character_browser.png`, D-054). ✅ First-run setup: Unity project (validated, version shown) and budget (D-058). ✅ PNG renders 1024 / 2048 / 4096 px, solid or transparent (checked by pixel). ✅ Budget bar: texture memory, bones and blendshapes added. ✅ Shortcuts: Ctrl+O added; the rest were already in place. ✅ Earlier: save/load, autosave every 2 min (10 kept), crash prompt, A/B compare. **Fixes found on the way:** the first-run Start button could miss a click while the folder check moved it; under `wails dev` library and thumbnail images were answered by Vite instead of the backend. |
| **M10** Custom garment import | Accepted | ✅ **A test garment modelled around the exported body fits 50 random bodies without poke-through beyond 2 mm** (`garment-import.test.ts`): a shirt, trousers and a loose skirt shrink-wrapped onto the exported OBJ, on the 8k, 10k and 12k bodies. Deepest vertex 0 mm; 99,100 vertices sampled, 64,019 of them within 3 cm of skin; the same garments without the collider would go 4.3 mm deep, so the check can fail (`M10/garment_import_report.json`). ✅ **Exports to Unity with correct skinning** (`pnpm test:unity`, 13 characters, 0 failures): three characters wearing imported garments are valid Humanoids and retarget a walk with a worst edge stretch of 2.6 to 3.8x (`M10/unity/`). ✅ Base body OBJ export (D-060). ✅ Import of OBJ, GLB and FBX (ufbx), with bounds-checked readers and a fuzz test (D-064). ✅ Auto-bind (D-059), weight transfer (D-062), hidden body faces, decimation to the slot budget (D-063). ✅ Units and up axis corrected and reported; a mesh not on the body is refused with a reason (D-061). ✅ Stored in the library, back after a restart, deletable; a saved character wearing one reloads (`pnpm test:desktop`). ✅ Dropping an OBJ, FBX or GLB on the window opens the import dialog. **Not checked:** a garment modelled by hand in Blender or Maya; the test garments are generated, and the FBX reader was tested on PS2CC's own FBX files. **Found on the way:** a loose skirt tore between the legs (fixed, D-062); a garment in centimetres could be shrunk to the wrong size and accepted (fixed, D-061). |

## After M10: the smaller PRD requirements

All ten milestones are accepted. An audit of the whole PRD against the code then found seven things that no milestone test had covered, built in version 0.11.0. Tests: `packages/core/test/polish.test.ts`, `app/frontend/e2e/polish.spec.ts`; review files in `docs/milestones/Polish/`.

| PRD item | State | Evidence |
| --- | --- | --- |
| **9.2** Help → Credits | Done | Built from the licence manifest. Every CC-BY file that ships is named with its author and source (D-070). |
| **F1** User presets | Done | Saved from File, applied and deleted there, stored as `.ps2preset` (D-071). |
| **F9** Background: black, grey or your image | Done | Checked by pixel; images go through the library's checks (D-072). |
| **F9** Textures shown at export size | Done | A 2048 px checker on a garment that exports at 1016 texels: contrast 31 levels without the limit, 0.6 with it (D-073). |
| **F5** Paintable hairline | Done | Grow and erase brush with mirroring on a map of the scalp; one stroke is one undo step; no root lands on erased scalp over 300 samples (D-074). |
| **F7** Fit face shape to photo (optional) | Done | From noisy synthetic landmarks of a known face it recovers the sliders' direction and cuts the error by more than 60%. Through the real detector on a perspective render: error 7.0% to 4.6%, direction right, but it overshot to the safe limit (D-075). |
| **8.2** Scripted slider sweep | Done, ⏳ for your GPU | Help → Measure slider speed. On the software GPU here a slider change takes 6.6 ms (median) of a frame. The 60 fps figure needs your machine (D-076). |

**Still needing you:** the clean Windows 11 VM install for M9 (`M9/installer_vm_check.md`), Help → Measure slider speed on your GPU for M1, and one garment you modelled by hand.
**Not built, on purpose:** LOD exports, which PRD 9.3 only asks about and no milestone requires, and per-garment textures, since merged garments in one atlas keep the character within the PRD's 5 draw calls (D-044).

## The hair system (0.12.0)

Card hair was rebuilt as a port of Daniel Bystedt's Blender setup *Geometry nodes - hair cards from curves*, at your request. `docs/hair-system.md` maps the node graph to the code. Review renders: `docs/milestones/Hair/` (the three styles made for your reference images) and `docs/milestones/M5/` (all eleven styles).

| Part | State | Evidence |
| --- | --- | --- |
| Reverse engineering | Done | The `.blend` (Blender 5.2, 34 node trees) read with a purpose-written reader: the 396-node card group, its helpers, the interpolation group, the texture scene, the example settings and the card meshes. |
| Cards from curves | Done | `cards-from-curves.ts`, every frame of the node group accounted for (ported, adapted or left out with a reason). Tested on an analytic surface: width, length, alignment to the head, tip twist, root snap, push-out, parting snap and lift (`hair-cards.test.ts`). |
| Groom: guides and interpolated hairs | Done | Hairs fall on their own side of the parting (under 3% cross it); clumping 0.9 brings card tips to under 60% of their unclumped distance from the guides. |
| Soft volume shading | Done | In the app, the export sidecar (`volumeNormals`) and the Unity importer (D-078). |
| Generated card textures | Done | Five colours ship; deterministic; coverage checked per strip (scalp strip over 97% solid, loose-hair strips under 30%). |
| Controls | Done | Card texture picker, Groom and Card build sections, "Frame the face" (`e2e/hair.spec.ts`). |
| M5 acceptance, on the new generator | Passing | Deterministic per seed; inside the 1,500 to 3,500 budget; no vertex inside the head proxy on 200 random heads; roots stay attached under head scaling; same topology on every body. |

**Known limits.** There is no comb: guides come from sliders, so a style is as specific as the sliders allow. The generated textures are plain next to photo-sourced ones. Short styles still show blocky card ends at the temples. A centre parting shows the forehead in a V below it, as real hair does; lower the hairline's Front or raise Frame the face to close it. No vertex colour or second UV set from the scalp (the Blender setup has both).


## M11: Look foundation (0.13.0, Part 2)

The first milestone of `PRD-Part2-Visual-Fidelity.md`. Overview: `docs/look-foundation.md`. Decisions D-083 to D-099. Review images: `docs/milestones/M11/`; the benchmark board: `pnpm bench` (writes `docs/bench/latest/`).

| Acceptance (Part 2 M11) | State | Evidence |
| --- | --- | --- |
| Board renders all three profiles in the app and in Unity | Done | `pnpm bench`: Mara and Cole, 3 profiles x 2 looks x 4 cameras, 48 views in each engine |
| App-to-Unity SSIM at least 0.9 per view | **Not met** | 28 of 48 views pass (all full-body and back views, 0.92 to 0.99); close-ups 0.79 to 0.89, limited by card hair at strand level (D-099). Fixed on the way: export ground height with boots (D-096), alpha-weighted texture shrinking (D-097), the harness's Gamma colour space and forced anisotropy (D-098) |
| Baked AO within 0.03 of a 1,024-ray CPU reference | Passing | Mean absolute error 0.0045 (body, 122 points) and 0.0176 (shirt, 405 points): `e2e/m11-bake.spec.ts`, `bake_report.json` |
| No background texels bleed into seams | Passing | Every texel bilinear filtering and the first mip read next to a UV border is filled (13,680 border samples, 0 empty) |
| 1024 AO bake time logged (target under 20 s) | Logged | 17.1 s for the body and two garments, 64 rays, on this machine's AMD Radeon integrated GPU (`gpu_timing.json`; the PRD's reference GPU is a GTX 1060) |
| Enhanced viewport frame time logged (target 60 fps) | Logged | 60 fps with per-pixel light and self-shadowing, same machine |
| User scores for lighting and mood, and skin, rise | Yours | Score the boards in `docs/bench/scores.json` |

Also in M11: quality profiles with the 16k, 20k and full body tiers; the per-pixel renderer with shadows; four graded looks saved as `.ps2look`; the bake engine feeding the skin stack and garment textures; Unity's PS2 shaders, PS2 Look component and PS2/Grade; expression shapes untangled below the eyes (D-088).

**Known limits.** Close-up parity (above). Gloss is a constant per surface until materials get gloss maps (F17, F18). The thickness map is baked but only the app's preview could use it, and nothing does yet. Flashlight shadows are app-only. Mara and Cole wear the closest library items; their own outfits are M15's.

## M12: Hair v2 and Hair Studio (0.14.0, Part 2)

Overview: `docs/hair-v2.md`. Decisions D-100 to D-114. Review images: `docs/milestones/M12/` (each of the eight styles from the front, side, back, top and three-quarter; Hair Studio; a fur collar; card brows).

| Acceptance (Part 2 M12) | State | Evidence |
| --- | --- | --- |
| Front, side, back and top renders of all eight styles: skin inside the hair silhouette under 1% (ID buffer) | Passing | `e2e/m12.spec.ts`; worst view 0.96% (shoulder-length, front), most under 0.1%; every number in `docs/milestones/M12/coverage.json` |
| The scalp layer's hairline steps by no more than 10% alpha between neighbouring texels | Passing | `test/m12.test.ts`, all eight styles, on the 1024 px neutral surface map |
| A unit test per brush: Comb moves points along the stroke and keeps roots; Puff lifts; Smooth straightens; undo restores exactly | Passing | `test/m12.test.ts` (every brush, plus selection, front-facing only and X symmetry); in the app, a comb stroke is one undo step (`e2e/m12.spec.ts`) |
| Every style deterministic and inside its profile budget | Passing | Hash test for all 13 starter styles; the eight Hair v2 styles in Classic, Enhanced and Hero |
| Atlas baker output deterministic | Passing | `test/m12.test.ts` |
| Unity renders match the app (parity test) | **Not met** | `pnpm bench`: 30 of 48 views at SSIM 0.9 (28 in M11): every full-body and back view (0.97 to 0.99); close-ups 0.80 to 0.96. Colour, light, soft alpha and the hair's mass match; strand-scale detail differs (D-113). Fixed on the way: dark hair's flashlight highlight (D-112) |
| User score for hair rises by at least one point | Yours | Score the boards in `docs/bench/scores.json` |

Also in M12: the 3D strand atlas baker and five strand looks; hair colour as a gradient map; the Creator's length, volume and fringe adjustments; `.ps2hair` version 2; Hair Studio (brushes, parting, lock tool, layer view, and card mode: one curve is one card, D-114); two-pass alpha in the app and Unity (PS2/Cutout's SoftAlpha pass); fur trims on garment edges and card eyebrows.

**Known limits.** In guide mode, locks and cards are regenerated from the guides; card mode (D-114) places them one by one instead, and a quality profile with a smaller budget leaves some hand-placed detail cards out. Fur trims grow on whole edge loops (collar, cuffs, hem) picked by the nearest joint; a garment whose collar is not an open edge gets none. Five Part 1 styles (buzz, crew, long centre part, bob with fringe, short with sideburns) are unchanged and have no locks.

## M13: Texture Studio (0.15.0, Part 2)

Overview: `docs/texture-studio.md`. Decision D-115: painting happens in [Material Painter](https://github.com/alla2001/material-painter) (GPL-3.0, v0.1.6), run as its own program and driven through its local agent server. It replaces spike S1 (TextureCraft) and the in-house painter. Review images: `docs/milestones/M13/`, showing the skin and a T-shirt painted in Material Painter, and each back in PS2CC.

| Acceptance (Part 2 M13) | State | Evidence |
| --- | --- | --- |
| Run S1 and record the decision | Replaced | The user chose Material Painter instead (D-115) |
| Paint survives morphing: 20 random slider changes leave every painted texel unchanged | Passing | `test/m13.test.ts`: the mesh's UVs and the painted layer's input to the compositor are unchanged after 20 random slider changes |
| Compositing still matches the reference implementation | Passing | The existing compositor tests; the painted layer over the reference gives Material Painter's texture back texel for texel (`test/m13.test.ts`) |
| One undo step per stroke | Passing (import) | Strokes undo inside Material Painter; bringing paint back is one undo step in PS2CC (`test/m13.test.ts`, `pnpm test:painter`) |
| A stroke across a UV seam leaves no gap or doubled edge | Material Painter's | Material Painter paints in 3D and projects across seams; not retested here |
| Projecting a checker from the camera reprojects within 1 texel | Material Painter's | Its projection and stencils; not retested here |
| Stroke-to-pixel latency under 30 ms at 2048 | Material Painter's | Strokes are drawn in Material Painter's own viewport; not measured here |

The round trip with the real Material Painter is tested end to end:
- **Go live test** (`PS2CC_MP_LIVE=1 go test -run TestLive ./backend/materialpainter/`): an unpainted round trip is exact, a painted triangle comes back, and paint survives reopening the project.
- **`pnpm test:painter`** (desktop app):
  - skin: one painted UV island comes back as one layer holding just that island;
  - a reopened session sends a reference identical to the first;
  - garment: the T-shirt's paint becomes its paint texture.

**Known limits.**
- Painting is in Material Painter's own window, not in PS2CC's viewport.
- Material Painter must be installed separately and its agent control turned on once.
- The hair atlas and the eyes are not paint targets yet: the eyes come with M14.
- Skin paint is kept as the colour Material Painter exported, so a stroke with partial opacity holds its mix with the skin as it was. A later change to the base skin shows through only where nothing was painted.

## M14: Face and eyes (0.16.0, Part 2)

Overview: `docs/face-and-eyes.md`. Decisions D-116 to D-123. Review images: `docs/milestones/M14/`.

What M14 adds:
- the head UV repack (per body mesh);
- generated eyes with a 12-colour iris library;
- painted brows and soft-edged lashes;
- low-poly teeth and tongue, and a mouth interior layer;
- three-photo projection;
- a scanned-face base skin (Lee Perry-Smith, CC BY 3.0);
- micro-detail layers: pores, and stubble hairs.

| Acceptance (Part 2 M14) | State | Evidence |
| --- | --- | --- |
| The head texture uses at least 85% of its texels | Passing | `test/m14.test.ts`, every body mesh: 86.9% (8k) to 87.3% (12k and up); no triangle folds or overlaps |
| Face texel density at least doubles | Passing | `test/m14.test.ts`: x2.11 (8k) to x2.16 over Part 1's packing |
| Teeth and tongue at most 600 triangles together | Passing | `test/m14.test.ts`: every teeth set plus the tongue, at most 544 (teeth 378 to 384, tongue 160) |
| Three-photo projection: eyes and mouth within 4 texels at 1024 | Passing (synthetic photos) | `e2e/m14.spec.ts`: worst landmark 2.34, 2.33 and 0.86 texels on three stand-in sets (front and ±40°) |
| No visible seam where views blend (pixel test) | Passing (synthetic photos) | `e2e/m14.spec.ts`: 95th-percentile step across a change of leading photo 0.47 to 1.23 levels (limit 3); a hard switch between photos measures 19.8 to 28.5. `docs/milestones/M14/three_photo_report.json` |
| The head-scan transfer is credited in Help → Credits | Passing | `e2e/m14.spec.ts` (credits names Lee Perry-Smith, CC-BY-3.0 and the skin), `credits_head_scan.png` |
| User scores for face and eyes rise | Needs your review | `eyes_*.png`, `mouth_open*.png`, `brows_painted.png`, `scan_face_*.png`, `detail_*.png`, `three_photo_*.png` |

Also tested:
- the generated eyes (pupil, iris colour and sclera on both discs; the catch-light only with Classic lighting);
- the micro-detail tiles repeat without a seam;
- the pores leave the lids and lips alone and are strongest on the nose;
- the reference compositor draws a detail layer (`test/m14.test.ts`).

**Known limits.**
- The three-photo projection has been tested with synthetic stand-in photos, not real ones.
- The scanned face is one person's face, fitted to the neutral head.
- The tongue sits high in the mouth, where MakeHuman puts it.
- Micro-detail tiles follow hm08's UVs, so stubble hairs stop at the face island's edge under the jaw. The stubble shadow carries on past it.

## M15: Materials and wardrobe (0.17.0, Part 2)

Overview: `docs/materials-and-wardrobe.md`. Decisions D-124 to D-131. Review images: `docs/milestones/M15/`.

What M15 adds:
- a CC0 material library: 11 materials from Poly Haven and ambientCG, converted to era diffuses;
- garment looks: material zones (picked pieces or painted), seams and stitches found from the mesh, fold stamps and procedural decals;
- Garment Studio: shape brushes and kitbash tools, with saving as a new library garment;
- the benchmark outfits, made with Garment Studio's tools; Mara and Cole wear them on the board.

| Acceptance (Part 2 M15) | State | Evidence |
| --- | --- | --- |
| Every material in the manifest is CC0 with a source URL | Passing | `test/m15.test.ts`: 11 materials covering the nine kinds the PRD lists. All 44 files have a CC0 row naming the material's Poly Haven or ambientCG page, and every `mat_*` source is CC0 |
| A converted material rendered flat matches the PBR original under the same light at SSIM >= 0.85 | Passing | `e2e/m15.spec.ts`: 0.926 (knit) to 0.995 (smooth leather). Control: the plain albedo, unconverted, averages 0.931 against the converted materials' 0.968. `material_check.json` |
| Seams are detected on every library garment | Passing | `test/m15.test.ts`: all 121 garments (116 MakeHuman, 5 made in Garment Studio) have seams; 106 also have hems |
| Edited garments still pass the M10 poke-through test (50 bodies, 2 mm) | Passing | `test/m15.test.ts`: the five Garment Studio garments on 50 random bodies (8k, 10k and 12k). No vertex inside the skin; 130,900 vertices sampled, 62,901 within 3 cm of skin. Without the collider they go 4.37 mm deep, so the check can fail. `wardrobe_report.json` |
| Mara's vest and Cole's jacket exist as library garments with fur trim | Passing | `ps2cc:clothes/mara_utility_vest` and `ps2cc:clothes/cole_leather_jacket` are in the Wardrobe. The jacket has a shearling collar and fur trim on the collar and cuffs. Mara's benchmark outfit has no fur (PRD section 4), so her vest has none |
| User score for clothing rises | Needs your review | `mara_*.png`, `cole_*.png`, `texture_*.png`. The benchmark board was not re-run |

Also tested:
- the converter keeps a flat texel at its albedo and keeps tiles seamless;
- composing a look is deterministic; stitches and seam shadows change only seams and hems; folds gather at the elbows (47% of texels there change, none on the upper back); a decal stays round its point; wear scuffs edges more than the middle;
- each brush and kitbash tool, and moving an edit to another body and back (within 6 mm);
- in the browser (`e2e/m15.spec.ts`), a garment dressed through the Inspector, composed the same twice and exported, its look surviving save and load;
- a Garment Studio round trip: crop, pocket, collar and an undone stroke, saved, worn, then put on another character from the Wardrobe.

**Found on the way.**
- The new garments changed the pairs the M4 poke-through test draws. One new pair puts MakeHuman's `toigo_flats` shoe 3.2 mm inside an 8k body. That test now draws MakeHuman's garments only, as accepted in M4, and the shoe is listed in TODO_ART.
- Cole's tall boots showed through the cargo trousers, so the board gives him ankle boots.

**Known limits.**
- Gloss is still one value per surface.
- A decal stops at the edge of its piece of cloth.
- Garment Studio has its own Undo; saving is one undo step in the app.
- Cropped hems follow the garment's triangles, so they are a little jagged on coarse garments.
- MakeHuman's fisherman sweater leaves a small gap under each arm where skin shows. The roll-neck, the vest and the jacket are made from it and keep the gap.

## M16: Creator experience (0.18.0, Part 2)

Overview: `docs/creator-and-studio.md`. Decisions D-132 to D-138. Review images: `docs/milestones/M16/`.

What M16 adds:
- the Character Creator: six steps in the left rail (01 Create, 02 Hair, 03 Wardrobe, 04 Appearance, 05 Look, 06 Export), each with the simple controls;
- the Asset Studio: Hair, Texture, Garment and Material Studio, opened with "Edit in … Studio" from the steps, the Inspector or the library. What a studio saves joins the library;
- Material Studio (new): materials from a library material or your own images, made seamless, adjusted and saved to the library;
- Texture Studio saves skins and textured garments;
- outfits: two built in (the benchmark outfits), and your own saved from 03 Wardrobe;
- the library browser: large thumbnails rendered under the current look, with favourites, tags and search.

| Acceptance (Part 2 M16) | State | Evidence |
| --- | --- | --- |
| An end-to-end test builds a full character through the six creator steps only | Passing | `e2e/m16.spec.ts`: a body preset and two sliders, a hairstyle with colour and length, an outfit and a hat, skin, eye colour, lips, freckles and dark circles, the Hero profile and the Flashlight interior look, then Export to Unity. The Inspector and the Asset Studio are never opened. Screenshots `ui_step_0*.png` |
| Each studio round trip (open, edit, save, reuse in another character) passes an end-to-end test | Passing | `e2e/m16.spec.ts`, one test per studio, each opened from a creator step and its result reused by a new character: Hair Studio (lengths changed, saved as a style, picked in 02 Hair); Texture Studio (layers added, saved as a skin, picked in 04 Appearance); Garment Studio (loosened, saved as a garment, worn from 03 Wardrobe); Material Studio (denim turned green and resized, and a photo made seamless, both saved; the green denim dresses another character's T-shirt). `ui_*_studio*.png` |
| You rebuild Mara from presets in under 15 minutes (timed by you) | Needs your time | The presets: Adult female body, Layered bob (Mara) and Blonde in 02 Hair, the Utility vest and roll-neck outfit, young caucasian female skin with freckles, dark circles and grime, Enhanced or Hero, Interior flashlight |

Also tested:
- the library browser: a thumbnail changes with the look the same way the viewport does; favourites and your tags survive a reload; search finds by name and tag; every category lists entries (5 bodies, 49 hairstyles, 121 garments, 2 outfits, 53 skins, 11 materials);
- Material Studio's seam measure: a photo that does not tile scores 0.105, made seamless 0;
- in Node (`test/m16.test.ts`): outfits saved, read with checks and put on; the converter from a photo alone or with maps (with flat maps it matches the library converter within one level); the seamless blend; the `.ps2mat` format; library search, tags and favourites;
- in Go: saving, listing and deleting materials (the document and its diffuse together) and outfits, and the favourites and tags in settings.

**Test runs:** lint and typecheck; unit tests (core 231, viewport 3, tools 25); Go tests; the full browser suite, 49 tests: 47 passed on the first run, and the two that failed (an import's name lost its file extension in the browser build; a test selector matched nested sections) pass after their fixes; the desktop test.

**Changed for you:** Part 1's seven tabs are gone. Body and face sliders are in 01 Create, the skin's full layer stack and photos are in Texture Studio, every hair setting is in Hair Studio, and the expressions to bake are in 06 Export. The older browser tests now go through the new steps.

**Known limits.**
- Thumbnails render one at a time in a hidden viewport, so the first screen of a grid takes a few seconds (under the tests' software renderer, up to a minute). They render again when the look changes.
- Saving a skin bakes its layers into it.
- Material Studio previews at 512 px and saves at 1024 px.

## M17: Generative assist (not built)

You decided against it (D-139): PS2CC ships no AI model. Part 2 ends at M16.

## M18: Workspace and data folder (0.19.0)

You asked for two things after Part 2: to keep your work in any folder without anything breaking, and a Character Creator-style interface, cleaner. Guide: `docs/workspace.md`. Decisions D-140 to D-143. Screenshots: `docs/milestones/UI/`.

**Data folder and saving.**
- Characters, the library and settings can move to any folder or drive (Settings → Data folder). Everything is copied and every copy checked (SHA-256) before the switch at the next start; the old folder is left as it was.
- A folder that already holds PS2CC data is used as it is.
- A data folder on a drive that is not connected falls back to the default with a message, so the app still starts.
- Ctrl+S now saves over the file you opened or saved with Save as…, wherever it is. Before, it saved a second copy in the data folder.
- The character browser lists characters kept elsewhere.

**Workspace.**
- A top bar, the viewport with a camera bar and the six creator steps along its bottom, a dock (Modify, Library, Studio, Settings) and a status bar with the budget.
- Modify is a parts tree over the controls: choosing a body or face region shows only its sliders and turns the camera; skin, hair, eyes, brows, lashes, teeth, tongue and each garment open their controls, each with an eye that hides it in the viewport only. Favourite sliders (the heart on each slider) have their own row.
- Theme: neutral dark greys, one blue accent, flat panels, no serif headline.

Tested:
- Go:
  - planning a move (empty folder, busy folder, existing data, and refused targets);
  - copying with checks, without the session files;
  - the pointer file, and falling back when the folder is missing;
  - saving over a file elsewhere, and listing it;
  - a move that copies, rewrites recent files and leaves the old folder alone;
  - PS2CC_HOME preventing a move.
- Browser (`e2e/ui-layout.spec.ts`):
  - steps and dock tabs;
  - a region showing only its sliders;
  - a hearted slider in Favourite sliders;
  - a garment's row opening its details;
  - its eye hiding it in the viewport while the character keeps it;
  - the smallest window (1280×720) with nothing overflowing or overlapping.
- Every older browser test runs on the new layout: the full browser suite passes (49 tests), and so does the desktop test against the real backend.
