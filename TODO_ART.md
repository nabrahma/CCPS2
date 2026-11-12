# Art the software cannot make (for you, the user)

PRD rule 2: nothing is faked. Each item below is either a placeholder or a gap that needs your art, photos or a decision.

## Needed now

- [ ] **Four garments are still over the 2,500-triangle PS2 target after decimation** (their dense frills and pieces resist safe reduction): `toigo_stiletto_booties` (4.3k), `culturalibre_hero-heroine_gloves_3` (12.7k), `toigo_dress_with_tiered_skirt` (3.1k), `toigo_tiered_skirt` (2.6k). They are marked "over budget" in the Wardrobe. Options: hide them, or remodel simpler versions (M10 imports your own garments).
- [ ] **Two MakeHuman hair meshes are still over the 3,500-triangle hair budget after decimation:** `culturalibre_hair_06` (6.2k) and `learning_anime_hair` (17.6k). They are marked "over budget" in the Hair tab. Card hair (route B) is the PS2-budget alternative.
- [ ] **Your hair card textures (PNG with alpha).** Card hair now ships with generated card textures in five colours (Hair → Card hair → Card texture), so nothing is needed to start. For your own look, drop a PNG on the hair: vertical strips, roots at the top, are found automatically, and Edit regions… lets you tag each strip (clump, strand, base, fringe, flyaway). A dense strip tagged `base` is used for the layer on the scalp, and its lower end draws the hairline. The generated textures are plain; photo-sourced or hand-painted ones will look closer to your references.
- [ ] **Review the hair renders** in `docs/milestones/Hair/` and say which styles to change. Three styles were made for your reference images: Long, centre part; Bob with fringe; Short with sideburns.
- [ ] **5 front-facing test photos for M6**, your own or properly licensed CC0 portraits (neutral expression, even light, eyes open, straight on). Put them in `docs/milestones/M6/test_photos/` (PNG or JPG) and run `cd app/frontend; pnpm exec playwright test e2e/m6.spec.ts -g "photo projection"`. Until then the acceptance runs on 5 renders of other MakeHuman characters.
- [ ] **Skin overlays (M6):** dark circles, stubble, lips, makeup, freckles, dirt, bruises and sweat are procedural stand-ins drawn from the face shape. For the photo-sourced look, paint PNG overlays (with alpha) over Skin → Export skin UV template; Export face region guide shows where the features are. Then add them with Add image overlay.
- [ ] **Review the M7 Unity renders** in `docs/milestones/M7/` (`unity_retarget_contact_sheet.png`: the 10 test characters retargeted to a walk in Unity), and try an export in your own Unity project (Export → Export to Unity, after adding `unity/com.ps2cc.importer`).
- [ ] **Optional, M7: a real Humanoid animation clip** (Mixamo or a Unity sample) in `tests/UnityHarness/Assets/Animations`, so the harness retargets it onto the 10 test characters too. The harness uses a walk built from muscle curves until then.
- [ ] **Review the M6 images** in `docs/milestones/M6/`: `layers_*.png` (layer looks), `projection_*.png` (the photo, then the projected result with the re-found landmarks), `export_head_texture.png` and `export_body_texture.png`.
- [ ] **Review the M3 screenshots** in `docs/milestones/M3/` (Flashlight preset, 6 characters, plus wireframes of the 8k, 10k and 12k bodies) and judge whether it "feels PS2".

## Needed for later milestones

- [ ] **Review the M8 expressions:** `docs/milestones/M8/preview_sheet_male.png` and `preview_sheet_female.png` (all 15 shapes in the app) and `unity_expressions_contact_sheet.png` (Unity). `blink_L`, `blink_R`, `jawOpen` and `browsUp`/`browsDown` are single MakeHuman pose units; `smile`, `frown`, `squint` and the visemes `AA`, `EE`, `IH`, `OH`, `OU`, `FV`, `MBP` are blends I chose in `packages/core/src/data/expression_map.json` (no MakeHuman `.mhpose` files were available, DECISIONS D-050). `FV` and `MBP` are subtle. Tell me which to change, or edit the weights there.
- [ ] **Optional, M8: PS2-budget teeth and a darker mouth interior.** MakeHuman's teeth are 7,120 triangles, so characters have none by default and an open mouth shows the skin texture's pink mouth interior. A low-poly teeth mesh (a few hundred triangles, CC0, fitted to hm08) would fix both.
- [ ] ~~M8, expressions:~~ any default blendshape (`browsDown`, `FV` and so on) without a good MakeHuman pose-unit mapping will be listed here inst
- [ ] **Cloth textures** for garments you import yourself (M10). The app exports a UV template per garment.
- [ ] **Run Help → Measure slider speed once on your PC** (M1). It reports the frame rate while dragging sliders on your own GPU; the 60 fps target cannot be measured on the software GPU the tests use.
- [ ] **Try one garment modelled by hand** (M10), in Blender or whatever you use, exported as FBX and as OBJ. The automated tests use generated garments, so this is the one path a person has to check.
