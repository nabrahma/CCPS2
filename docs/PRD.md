# PS2 Character Creator: Product Requirements Document

Nov 7, 2026 · @Nabaskar

## 1. Overview

Build **PS2CC**, a standalone Windows desktop app that creates PS2-era game characters with sliders and exports them to Unity as rigged, Humanoid-ready FBX. It is an internal tool for one user (a game developer making Fears to Fathom-style horror games). It is not a product for sale.

**The look target.** Late PS2 / early PS3 era realism: about 10k to 15k triangles per character, with most of the geometry and texture detail spent on the face. Photo-sourced, low-resolution textures (512 to 1024 px) carry the character: dark circles, stubble, makeup and dirt are painted into the texture, not modelled. Hair is alpha cards. Lighting is simple (vertex or per-pixel Lambert), and there are no PBR maps. This is **not** a PS1 look, so no affine texture wobble and no vertex snapping by default.

**The core idea.** The app does not invent human anatomy. It ports the MakeHuman character system (CC0 base mesh, about 1,258 morph targets bundled into about 249 modifiers, rigs, weights, clothes, hair, skins) into a TypeScript engine. On top of that it adds the PS2-specific parts: a low-poly body mesh, texture layering, a hair card generator, photo-to-face projection, and Unity export.

**Fixed decisions (do not revisit without asking the user):**

- Platform: Windows 10/11 x64 only.
- Engine target: Unity only (Unity 6 LTS, URP assumed; see Open questions).
- Both male and female characters from the first milestone that has a body (MakeHuman's continuous gender macro covers both).
- Standalone, all-in-one app with no outside software at runtime: no Blender, no Python, no FBX SDK. Where an open-source tool already solves a problem (Blender's FBX exporter, MakeHuman's fitting), port that logic into PS2CC.
- Runs fully offline. No network calls at runtime.

**Rules for the building agent:**

1. Work one milestone at a time (section 8). A milestone is done only when every acceptance test in it passes and the user has a build to try.
2. Never fake an asset. If something needs art you cannot source under CC0 or a compatible licence, leave a clearly named placeholder and add it to `TODO_ART.md` for the user.
3. Port MakeHuman behaviour exactly, and prove it with golden tests against MakeHuman's own Python output (section 8). Correctness beats speed.
4. Pin every dependency version. Record every non-obvious technical choice in `DECISIONS.md` with the reason.
5. Every asset that ships gets a row in a generated licence manifest (`assets/LICENSES.json`).
6. When something in this PRD turns out to be wrong (a file format detail, a library limit), fix it in code, note it in `DECISIONS.md`, and tell the user. Do not silently work around it.

## 2. Goals, non-goals and what the user supplies

The user's job at the end is art direction: dropping in textures and judging the result. Everything else is the software's job.

**Goals (v1):**

- Create a male or female character in minutes with body and face sliders, and see changes live at 60 fps.
- Output a Unity-ready character: Humanoid avatar, skinned mesh, blendshapes for blink, jaw and basic expressions, materials set up with PS2-style URP shaders.
- Hit a triangle budget the user picks (default 12k, hard max 15k) with the face kept dense.
- Drag-and-drop textures for skin, face overlays, garments and hair cards, with UV templates exported so the user can paint textures that fit.
- A built-in hair card system: re-texture existing hair meshes, or generate new card hairstyles from parameters, using the user's own hair card atlas.
- Optional photo-to-face projection: drop a front photo and it becomes the face texture.
- Save, load, duplicate and randomize characters, and render PNG portraits like the user's reference images.

**Non-goals (v1):** Unreal export, macOS/Linux, cloth simulation, strand hair, PBR texture sets, animation authoring, a marketplace, multiplayer or cloud sync, nudity or anatomical detail beyond what underwear-level garments cover.

**Left to the user (the only manual work):**

| What | Why the software cannot do it | How the app helps |
| --- | --- | --- |
| Cloth textures | Needs art and taste; CC0 cloth textures that fit specific garments rarely exist | Exports a UV template PNG per garment; drop a PNG on the garment to apply it |
| Hair card atlas textures | User said they will supply these | Atlas editor detects strips; templates for common layouts |
| Face and skin photos for the photo-real look | Must be the user's own or properly licensed; never ripped from games | Photo projection, colour matching, overlay layers |
| Garment or hairstyle shapes not in the CC0 libraries | New meshes need modelling | Exports the base body as OBJ for modelling; imports and auto-fits the garment |
| Final taste judgement | Agents cannot reliably judge "feels like PS2" | Every milestone ships a build plus screenshots for review |

## 3. Open-source inventory

MakeHuman's assets do the heavy lifting, and they are CC0: [all core assets are CC0, while MPFB code is GPL and MakeHuman code is AGPL](https://static.makehumancommunity.org/about/license.html). Since 2020, [targets, proxies and the base mesh count as CC0 graphical assets](https://static.makehumancommunity.org/oldsite/faq/what_changed_regarding_the_license_in_2020.html). The agent may ship assets freely. For code, read MakeHuman/MPFB source as the behavioural reference and write a clean TypeScript implementation; copying AGPL/GPL code is acceptable for this internal tool but must be noted in `DECISIONS.md`.

### 3.1 Character data (all CC0, from MakeHuman)

| Asset | What it gives us | Key facts for the agent | Source |
| --- | --- | --- | --- |
| Base mesh hm08 | One topology for every human; all targets and clothes are built on it | Quads only. Body = vertices 0 to 13379; helper geometry (tongue, joints, eyes, eyelashes, teeth, tights, skirt, hair, ground) runs to 19157. Helpers are hidden but must be morphed too | [Basemesh](https://static.makehumancommunity.org/about/concepts/basemesh.html) |
| Targets (.target) | Every slider shape | About 1,258 targets bundled into about 249 modifiers (`data/modifiers/*.json`). ASCII lines of `vertexIndex dx dy dz`, or compiled `.npz` | [makehuman.js notes](https://awesome.ecosyste.ms/projects/github.com%2Fmarkandre13%2Fmakehuman.js) |
| Macro modifiers | Gender, age, muscle, weight, height, proportions, ethnic blend | Macros interpolate between several macro targets; this maths must be ported exactly from MakeHuman `humanmodifier.py` | [Technical notes](https://static.makehumancommunity.org/oldsite/uncategorized/technical_notes_on_makehuman.html) |
| Rigs + weights | Skeleton and skinning | Rig JSON places each bone head/tail from joint-cube vertex indices (e.g. MEAN strategy); weights JSON per bone. Use **GameEngine (without breasts)**, which the MPFB docs say is 100% Mecanim compatible | [MPFB rigging](https://static.makehumancommunity.org/mpfb/developer/rigging_and_posing.html), [MPFB rig choice](https://static.makehumancommunity.org/mpfb/docs/characters/rig.html) |
| MHCLO assets | Clothes, hair, eyebrows, eyelashes, eyes, teeth, tongue, alternative topologies | Every proxy vertex = barycentric point on 3 base-mesh vertices + offset scaled by x/y/z scale reference pairs. Weights transfer from those 3 vertices | [File formats](https://static.makehumancommunity.org/oldsite/documentation/file_formats_and_extensions.html), [Clothes, hair, bodyparts](https://static.makehumancommunity.org/mpfb/docs/assets/concept_clothes_hair_bodyparts.html) |
| Asset packs | System assets, skins, clothes, hair, extra targets | CC0 packs include system assets, natural male/female skins, beards, and extra cheek/nose/ear/arm/hand targets. Some packs are CC-BY: allow them only with attribution in the manifest | [Asset packs](https://static.makehumancommunity.org/assets/assetpacks/index.html) |
| Expressions | Facial expressions for blendshape baking | 60 face pose units (`face-poseunits.bvh`) and 32 expressions (`.mhpose`) on the default rig's face bones | [makehuman.js notes](https://awesome.ecosyste.ms/projects/github.com%2Fmarkandre13%2Fmakehuman.js) |

MakeHuman's own low-poly proxies are too sparse for this look ([proxy741 has 741 vertices, female1605 has 1605](https://static.makehumancommunity.org/about/concepts/alternative_topologies.html)), so the app builds its own PS2 body mesh (section 5.2).

### 3.2 Reference implementations (read, test against, do not depend on at runtime)

| Project | Use it for | Licence / status |
| --- | --- | --- |
| [makehuman (1.x, Python 3)](https://github.com/makehumancommunity/makehuman) | The behavioural oracle: generate golden outputs for tests | AGPL; standalone dev has effectively ceased, still runs |
| [makehuman-core / mhcore](https://pypi.org/project/makehuman-mcp/) | Headless Python wrapper around unmodified MakeHuman; easy way to script golden outputs (set modifiers, export OBJ/FBX) | AGPL; early (0.1.x, one maintainer), so verify against MakeHuman itself |
| [MPFB2](https://static.makehumancommunity.org/mpfb/docs/index.html) | Rig JSON format, weights, MHCLO fitting, current asset conventions | GPL; actively maintained Blender extension |
| [makehuman.js](https://awesome.ecosyste.ms/projects/github.com%2Fmarkandre13%2Fmakehuman.js) | Proof that morphs, modifiers, proxies and posing work in TypeScript; read its structure | TypeScript, small project |
| [makehuman-js](https://awesome.ecosyste.ms/projects/github.com%2Fmakehuman-js%2Fmakehuman-js) | Older browser port; second reference | AGPL, alpha |
| [makehuman2](https://github.com/makehumancommunity/makehuman2) | New standalone in development; watch only | Status "test" |

### 3.3 Libraries (runtime and build)

| Library | Role | Notes |
| --- | --- | --- |
| [Wails v2](https://docs-preview.wails.io/blog/wails-v3-beta/) | Desktop shell: Go backend + WebView2 frontend | Use v2 (stable). v3 is still beta, so do not use it |
| React + TypeScript + Vite | UI | Pin versions |
| Three.js | Viewport, skinning, morph preview, GLTFExporter | Pin one release; no WebGPU-only features |
| [meshoptimizer (JS/WASM)](https://github.com/zeux/meshoptimizer/releases) | Building the PS2 body mesh and decimating garments | `simplifyWithAttributes` supports per-vertex locks; still experimental, so run it at build time only and commit the outputs |
| [MediaPipe Face Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js) | Photo-to-face projection | `@mediapipe/tasks-vision`, Apache 2.0, 478 landmarks; bundle the WASM and `.task` model locally (no CDN) |
| Blender's FBX exporter (`io_scene_fbx`), source only | Reference for PS2CC's own binary FBX 7.4 writer in Go (Unity's Humanoid setup works from FBX) | Port the needed parts (`encode_bin.py`, `export_fbx_bin.py`); not a runtime dependency; GPL is fine for an internal tool ([binary exporter origin](https://lists.blender.org/pipermail/bf-extensions-cvs/2014-March/004497.html)) |
| [ufbx](https://github.com/ufbx/ufbx) | Reading FBX: round-trip tests of the writer, and importing user garments made as FBX | MIT or Unlicense; single C file built into the Go backend via cgo; fuzzed and well tested |
| [glTFast](https://docs.unity3d.com/Packages/com.unity.cloud.gltfast@latest) / [UnityGLTF](https://awesome.ecosyste.ms/projects/github.com%2FKhronosGroup%2FUnityGLTF) | Secondary GLB import path in Unity | Both import skinned meshes and blend shapes |
| Khronos glTF-Validator | Export tests | npm package |
| Vitest, fast-check, Playwright | Unit, property-based and screenshot tests |  |

### 3.4 Shader and hair references (ideas only, do not copy paid code)

- Free vertex-lighting system for URP: [Volutedberet VertexLighting](https://github.com/Volutedberet/VertexLighting).
- Feature lists of paid retro URP packs show the expected knobs (colour depth, dithering, outlines, VHS/CRT post): [Retro Shaders Pro](https://danielilett.itch.io/psx-shaders-pro-for-unity-urp/devlog/998452/version-14-brings-hull-outlines-and-texel-aligned-shading), [Borzblade PSX/PS2 toolkit](https://borzblade.itch.io/psx-shader).
- Hair cards from curves (method reference): [Bystedt's free geometry nodes setup](https://www.cgchannel.com/?p=156171) deforms cards along curves and aligns their twist to the scalp. PS2CC reimplements this idea in TypeScript.

## 4. System architecture

The app splits into an offline asset compiler that runs once on the developer machine, a pure TypeScript character engine, a React UI, a Go backend for files and processes, and a Unity package. The engine has no DOM or Wails dependency, so all its maths runs in Node tests.

&#91;embedded content: PS2CC architecture · build time, desktop app, export\]

The core engine is the only place character maths lives; the UI, viewport and exporter all read from it.

### 4.1 Components

| Component | Language | Responsibility |
| --- | --- | --- |
| `tools/asset-compiler` | Python 3.11 (build time only, developer machine) | Fetch MakeHuman data and asset packs (pinned versions, checksums); convert targets, modifiers, rigs, weights, MHCLO assets and materials into the app's compact format; build the PS2 body meshes; decimate garments; downscale textures; write `LICENSES.json`; dump golden test data from MakeHuman Python. Never shipped |
| `packages/core` | TypeScript | Character engine: modifiers and macros, morph application, skeleton fitting, MHCLO fitting, hair card generation, texture layer compositing, export scene building. Deterministic and unit tested |
| `packages/viewport` | TypeScript + Three.js | Renders the engine's output: PS2 preview shaders, post effects, lighting presets, picking, screenshots |
| `app/frontend` | React + TypeScript | Panels, sliders, library browser, drag-and-drop, undo/redo, dialogs |
| `app/backend` | Go (Wails v2) | Library folder management, file import and validation, thumbnails, project save/load, autosave, logs |
| `app/backend/fbx` | Go (+ ufbx via cgo for reading) | Native binary FBX 7.4 writer ported from Blender's exporter; FBX/OBJ reading for user garments; round-trip tests |
| `unity/com.ps2cc.importer` | C# (Unity package) | Asset postprocessor: Humanoid avatar, materials with PS2 URP shaders, texture import settings, prefab creation |

### 4.2 Data flow

1. **Build time:** asset compiler → `assets/core/` (committed via Git LFS) + golden test fixtures.
2. **App start:** Go backend serves `assets/core/` and the user library to the frontend; engine loads the base mesh, modifiers, rig and the selected PS2 body mesh.
3. **Editing:** a slider changes a modifier value → the engine adds `Δvalue × targetDelta` to only the affected vertices (incremental, sparse) → recomputes normals, joint positions and fitted assets (garments, hair, eyes) → viewport updates the GPU buffers.
4. **Export:** engine builds an export scene (PS2 body mesh + fitted assets, GameEngine skeleton in rest pose, baked blendshapes, composited textures) → the Go backend's native writer produces the FBX, and Three.js GLTFExporter produces the optional GLB → FBX + textures + `character.ps2cc.json` sidecar land in the chosen Unity `Assets/` folder → the Unity package finishes setup on import.

### 4.3 Engine data model (TypeScript, simplified)

```ts
interface CharacterDoc {           // saved as .ps2char (JSON, versioned)
  schema: 1;
  id: string; name: string;
  macros: { gender: number; age: number; muscle: number; weight: number;
            height: number; proportions: number; african: number; asian: number; caucasian: number };
  modifiers: Record<string, number>;   // modifier id -> value, only non-default ones
  bodyMesh: 'ps2_body_8k' | 'ps2_body_10k' | 'ps2_body_12k';
  skin: SkinStack;                     // base skin + ordered overlay layers
  eyes: AssetRef; eyebrows: AssetRef; eyelashes: AssetRef; teeth?: AssetRef;
  garments: GarmentSlot[];             // asset + texture override + tint + hide-body flag
  hair: HairSpec;                      // mesh asset OR generated card style + atlas
  expressionsToBake: string[];         // blendshape names for export
  export: ExportSettings;              // tri budget, texture sizes, paths
}
```

All positions are in metres, Y up, character facing +Z in the engine; the exporter converts to Unity conventions. Every asset is referenced by a stable ID (`mh:clothes/male_casualsuit01`, `user:garment/my_jacket`), never by file path, so libraries can move.

### 4.4 On-disk layout

```text
%USERPROFILE%\Documents\PS2CC\
  Library\
    skins\  overlays\  garments\  garment-textures\  hair-atlases\  hairstyles\  photos\
  Characters\
    <name>\<name>.ps2char   textures\   renders\   exports\
  settings.json   (default Unity project, budgets)
```

Imported files are copied into the library (never referenced in place), converted to PNG, size-checked and given a thumbnail.

## 5. Feature specifications

Each feature below lists what it must do and the rules that keep it from breaking. IDs (F1, F2...) are referenced by the milestones.

### F1. Body and face sliders

- Load all MakeHuman modifiers and macros. Show them grouped the way MakeHuman groups them (Main, Gender, Face, Torso, Arms and legs, plus face sub-groups: forehead, eyebrows, eyes, nose, mouth, ears, chin, cheek, head shape, neck).
- Main panel: gender, age, muscle, weight, height, proportions, and the three ethnic-blend macros (which always sum to 1, exactly as MakeHuman normalises them).
- Every slider: label, numeric field, reset-to-default, search box over all sliders, left/right symmetry toggle for paired modifiers (on by default).
- **Curated PS2 view** (default): about 40 sliders that matter most for game characters, defined in `curated_sliders.json`, each with a safe range. **All sliders** view: the full set, MakeHuman ranges.
- Undo/redo for every change (command stack, at least 200 steps); slider drags merge into one undo step.
- Presets: "Adult male", "Adult female", "Older male", "Older female", "Teen-looking adult" (all characters are adults), plus user presets.
- Randomize: all, or per group, within the curated safe ranges, with per-slider locks.
- **Performance:** a slider drag must update the viewport at 60 fps or better on a GTX 1060-class GPU. Apply morphs incrementally (only targets whose weight changed, sparse deltas), never by re-summing all 1,258 targets.

### F2. PS2 body mesh (the low-poly topology)

- At build time, the asset compiler creates three body meshes from the hm08 body (vertices 0 to 13379): about 8k, 10k and 12k triangles. Use meshoptimizer `simplifyWithAttributes` with UVs as attributes and these region rules:
  - Face (eyes, eyelids, nose, mouth, ears' front): locked or near-full density.
  - Rest of head and neck, hands: light reduction.
  - Torso, arms, legs, feet: strong reduction. Keep edge loops at elbows, knees, shoulders and hips where possible.
  - Lock UV seams, mesh borders and vertices near eye and mouth openings.
- Simplification keeps a subset of the original vertices, so each PS2 body vertex maps to exactly one hm08 vertex. That gives free morph transfer, free weight transfer and the hm08 UV layout, so every MakeHuman skin still fits. Store the mapping (`ps2Vertex -> hm08Vertex`) and the new index buffer.
- Triangulate the remaining quads with a consistent diagonal choice; verify no flipped normals.
- Commit generated meshes and a wireframe screenshot of each to the repo; do not re-simplify at runtime.

### F3. Eyes, eyebrows, eyelashes, teeth

- Use MakeHuman's low-poly eye asset, eyebrow and eyelash alpha cards, and optional teeth/tongue, all fitted via MHCLO.
- Eye colour = texture choice + tint. Eyebrows and lashes = alpha cutout, tintable, with a density/opacity slider.
- Hide the mouth interior meshes by default (no budget spent on teeth unless the user enables them).

### F4. Wardrobe (garments)

- Library of MakeHuman CC0 garments, each pre-decimated at build time to a PS2 budget (target 500 to 2,500 triangles per garment) with the same subset-of-vertices method, so MHCLO bindings stay valid.
- Garment slots: top, bottom, outer, shoes, hat, gloves, accessory. Several can be worn; draw order by MHCLO `z_depth`.
- Fitting: implement MHCLO maths exactly: position = w1·r1 + w2·r2 + w3·r3 + (s1·d1, s2·d2, s3·d3), with s from the x/y/z scale vertex pairs. Refit whenever the body changes.
- **Hide body under garment:** apply each garment's delete-vertices data if present, otherwise compute it (raycast inward from body vertices; hide faces fully covered). Hidden faces are removed from export, which saves triangles.
- **Texture drag-and-drop:** drop a PNG/JPG on a garment (viewport or slot card) to replace its diffuse. Also: tint, brightness, a dirt/grime overlay layer, and "Export UV template" (PNG at 1024 px: UV wireframe over the current texture).
- **Custom garments (later milestone, F12):** import OBJ/FBX/GLB modelled around the exported base body; auto-bind each vertex to the nearest body triangle (barycentric + normal offset, MakeClothes-style), transfer weights, compute hidden body faces, decimate to budget.

### F5. Hair card system

Two routes, both ending in alpha-card meshes that follow head morphs and are skinned to the head and neck bones.

**Route A: existing hair meshes.** MakeHuman CC0 hairstyles are MHCLO meshes with alpha textures. The user can drop their own texture on them (same UV layout; the app exports the UV template), tint them, and decimate them to budget.

**Route B: generated card hair (the main feature).**

1. **Atlas.** The user drops a hair card atlas PNG with alpha. The atlas editor auto-detects card regions by scanning alpha coverage (vertical strips, then a grid fallback), shows them as boxes and lets the user adjust, add or delete them, then tag each region: `clump`, `strand`, `fringe`, `flyaway`, `base`. Save as `atlas.json` beside the PNG. Ship 3 built-in layout templates (4 strips, 8 strips, 4×2 grid).
2. **Scalp.** Use MakeHuman's `helper-hair` geometry (it exists for fitting hair) as the scalp surface, plus a user-paintable hairline mask (front, temples, nape) with presets.
3. **Guides.** Generate guide strands from scalp sample points with parameters: length (front, sides, back, top separately), part position and side, fall/gravity, volume (lift from scalp), flow direction field, curl amplitude and frequency, bangs on/off and length, randomness seed. Strands collide against a head-and-shoulders proxy (spheres/capsules fitted to the current body) so they never pass through the face or neck.
4. **Cards.** Sweep cards along guides: segments per card, width taper, twist aligned to the scalp normal (as in Bystedt's method), layer count (inner → outer), cards per layer. Each card gets UVs mapped to an atlas region chosen by tag and layer (base layer uses `base`, outer uses `clump`, edges use `flyaway`).
5. **Scalp shell.** Optional base layer: an offset copy of the scalp region with the user's hair texture, for buzz cuts, fades and short hair like the reference images. A buzz cut can be shell-only with a few hairline cards.
6. **Binding.** Bind every card vertex to the head like an MHCLO asset (nearest base triangle, barycentric + offset), so cards follow head-shape sliders. Skin card vertices to head (and neck for long hair) using the bound triangle's weights.
7. **Budget.** Show live triangle count; target 1,500 to 3,500 triangles for hair.
8. **Styles.** Save the parameter set as a hairstyle (`.ps2hair`) and ship 8 starter styles: buzz, crew cut, short messy, side part, bob, shoulder-length straight, long straight, ponytail.
9. **Shading.** Alpha cutout with a threshold slider, double-sided, sorted inner to outer by index order. Optional dithered transparency for the outer layer.

### F6. Skin and face texture stack

- Base skin: MakeHuman CC0 skins (natural male and female sets), at their source resolution, downscaled on export.
- Layer stack (top wins), each layer with opacity, blend mode (normal, multiply, overlay, screen) and an optional region mask (face, body, hands): tone tint (hue, saturation, value), dark circles, eye bags, stubble/beard shadow, lips colour, eyeliner/eyeshadow, blush, freckles, dirt, bruises (cosmetic), sweat sheen, and user PNG overlays.
- Overlays are authored in hm08 UV space; ship a UV template and a face region guide so the user can paint new overlays.
- Compositing happens in a WebGL render target at 2048 px, then downscales on export (bilinear plus a mild sharpen) to the chosen sizes.
- **Head texture split on export:** the head gets its own material and texture (default 1024, or 512) so the face keeps its detail. Find the head UV region in hm08, remap head UVs affinely from that region's bounding box to 0–1, and crop the composited texture to match. Body uses a second texture (default 1024).

### F7. Photo to face projection

1. User drops a front-facing photo (neutral expression, even light, eyes open).
2. MediaPipe Face Landmarker finds 478 landmarks in the photo.
3. A precomputed table maps landmarks to hm08 vertices. Build it at build time automatically: render the neutral head front-on, run MediaPipe on the render, then map each landmark to the nearest visible vertex.
4. Warp the photo into face UV space: for each face texel, take its 3D point on the current head, project it to the front view, and map it through a piecewise-affine warp on the Delaunay triangulation of matched landmarks to photo coordinates.
5. Blend into the base skin with a feathered face mask, and match colour (mean and standard deviation in LAB) between the photo border and the skin.
6. Optional "Fit face shape to photo": a small optimiser adjusts face modifiers (eye spacing, nose width, jaw width and similar) to reduce landmark error. Ship this only after the projection itself is solid.
7. Show a warning if the face is not frontal (yaw or pitch over 10°) or lighting is very uneven.

### F8. Expressions and blendshapes

- Bake blendshapes at export by posing MakeHuman's default rig face bones with its face pose units and expressions, capturing the mesh delta from rest, and attaching it to the PS2 mesh. The exported skeleton (GameEngine) stays face-bone-free; faces animate by blendshapes.
- Default set: `blink_L`, `blink_R`, `jawOpen`, `smile`, `frown`, `browsUp`, `browsDown`, `squint`, and visemes `AA`, `EE`, `IH`, `OH`, `OU`, `FV`, `MBP`. Map each to MakeHuman pose units in `expression_map.json`; where no good mapping exists, flag it in `TODO_ART.md` instead of inventing one.
- Eyebrows, eyelashes and the hair shell must receive the same blendshapes (transfer through their MHCLO binding) so blinking moves the lashes.
- Preview each blendshape with a slider in the Expressions panel.

### F9. PS2 preview in the viewport

- Shading modes: **PS2 Lit** (per-vertex Lambert + ambient, one key light, optional rim; the default), Unlit (texture only), Clay, Wireframe overlay, UV checker.
- Textures shown at their export size with bilinear filtering, so what you see is what Unity gets.
- Post stack (toggle each): render at 640×448 and upscale, 16-bit colour with ordered dither, film grain, VHS chroma bleed, interlace lines, vignette. PS1 effects (affine UVs, vertex snapping) exist only as off-by-default toggles.
- Lighting presets: Studio, Flashlight (spot from camera, dark room, matching the reference images), Overcast exterior, Night street. Background: black, grey, or a user image.
- Camera presets: full body, bust, face close-up, three-quarter, profile. Turntable toggle.

### F10. Projects, renders and library

- Save/load `.ps2char`; autosave every 2 minutes to `Characters/<name>/autosave/` keeping 10 versions; crash recovery prompt on start.
- Duplicate character, character browser with thumbnails.
- Render PNG at 1024–4096 px from any camera preset, with transparent or solid background.
- Library: drag files onto the app window from Explorer; the app detects type by drop target (or asks), copies, converts and thumbnails them, and rejects files over 8192 px or unsupported formats with a clear message.

### F11. Validation and budget meter

Always-visible budget bar: triangles by part (body, head, hair, garments, eyes and brows), texture memory, bone count, blendshape count. It turns amber at 90% of the budget and red above. Export is blocked above the hard max (15k triangles) unless the user overrides it.

## 6. Export and Unity integration

The primary output is an FBX that Unity imports as a valid Humanoid with no manual steps. PS2CC writes that FBX itself with a native Go writer ported from Blender's open-source FBX exporter, so no other software is involved. FBX is primary because Unity's Humanoid avatar setup works from FBX and has no built-in equivalent for glTF; GLB is offered as a secondary output.

### 6.1 What one export produces

```text
<UnityProject>/Assets/PS2CC/<CharacterName>/
  <CharacterName>.fbx            skinned mesh(es), GameEngine skeleton, blendshapes
  <CharacterName>.ps2cc.json     sidecar: materials, texture roles, budgets, source settings
  Textures/
    <Name>_Head_D.png            1024 or 512
    <Name>_Body_D.png            1024 or 512
    <Name>_Hair_D.png            user atlas, alpha kept
    <Name>_<Garment>_D.png       per garment, or one packed atlas (option)
    <Name>_Eyes_D.png
  <CharacterName>.glb            optional secondary output
```

### 6.2 Mesh and skeleton rules

- One `SkinnedMeshRenderer` per material group: Head, Body, Hair, Garments (merged), Eyes + brows + lashes. Draw calls stay at 5 or fewer.
- Skeleton: MakeHuman **GameEngine rig without breasts**, fitted to the current body via its joint-cube rules, exported in rest pose. The rest pose is MakeHuman's A-pose; Unity's avatar configure step can enforce a T-pose, so also provide an optional "Export in T-pose" that rotates arm bones and re-bakes the mesh.
- Maximum 4 bone influences per vertex, normalised (Unity's default limit).
- Units: metres, character about 1.6–1.9 m tall, feet on the origin, facing Unity's +Z.
- Bone names: keep MakeHuman GameEngine names; the Unity importer maps them to Humanoid bones from a checked-in table (`humanoid_map.json`).
- Blendshapes on every mesh they affect, same names everywhere.
- Hidden body faces under garments are removed. Unused vertices are stripped.

### 6.3 Native FBX writer

1. The engine builds an `ExportScene` (meshes, skeleton, skin weights, bind pose, blendshapes, materials, texture file names) and sends it to the Go backend as one compact binary message.
2. `app/backend/fbx` writes **binary FBX 7.4**, ported from Blender's `io_scene_fbx`: `encode_bin.py` for the binary node encoding (typed properties, zlib-compressed arrays, header and footer) and `export_fbx_bin.py` for the object graph. Port only what a skinned character needs:
   - `GlobalSettings`: Y up, front axis, unit scale, matching what Blender writes for Unity.
   - `Model` nodes: a root, `LimbNode` bones with local transforms, and one `Mesh` model per material group.
   - `Geometry`: vertices, polygon vertex indices, normals, UVs and material indices as layer elements.
   - `Deformer` Skin + `SubDeformer` Cluster per bone (indexes, weights, Transform, TransformLink) and a `Pose` BindPose.
   - `Deformer` BlendShape + `SubDeformer` BlendShapeChannel + `Geometry` Shape for each blendshape (sparse indexes and deltas).
   - `Material`, `Texture` and `Video` nodes with relative texture paths, and the `Connections` table (OO and OP links).
3. Go tests read every written file back with ufbx and compare it to the `ExportScene`: hierarchy and bone names, vertex positions (≤ 1e-5 m), normals, UVs, weights (≤ 1e-6), bind matrices, blendshape names and deltas.
4. Three.js GLTFExporter writes the optional GLB, checked with glTF-Validator (fail the export on errors).
5. Copy outputs into the Unity project folder from settings (or a folder the user chooses).

Writer rules: deterministic output (same character, same bytes apart from the creation timestamp), property-based tests with random meshes, skeletons and blendshapes that must always produce files ufbx loads without errors, and a fuzz test of the writer's inputs. Every change to the writer re-runs the Unity harness (section 6.4).

### 6.4 Unity package `com.ps2cc.importer`

Installed through Unity Package Manager from a local folder or git URL. Target Unity 6 LTS with URP (see Open questions).

- **AssetPostprocessor** for any FBX that has a matching `.ps2cc.json`:
  - `animationType = Human`, build the avatar from `humanoid_map.json`, and assert `avatar.isValid && avatar.isHuman` (log an error with the missing bones otherwise).
  - Import blendshapes, keep exported normals, set the scale factor to 1.
  - Create materials from the sidecar with the PS2 shaders below, and assign textures by role.
  - Texture import: max size per sidecar, bilinear filter, mipmaps on (off for UI renders), compression "High Quality", alpha is transparency for hair, brows and lashes.
  - Create a prefab `<CharacterName>.prefab` with an `Animator` (Humanoid) and a small `PS2CharacterInfo` component (budgets, source settings).
- **Shaders (URP, hand-written HLSL or Shader Graph):**
  - `PS2/Skin`: vertex-lit Lambert + ambient + optional rim, baked texture lighting friendly, optional colour-depth reduction.
  - `PS2/Cutout`: same lighting, alpha clip with threshold, double-sided, for hair cards, brows and lashes.
  - `PS2/Cloth`: same as Skin with a dirt mask slot.
  - All respond to URP main light and ambient; no PBR inputs; work in Forward and Forward+.
- **Optional post-processing volume** (`PS2 Look` renderer feature): low internal resolution, dither, grain, VHS bleed, matching the app's preview toggles.
- **Editor test** (batchmode): `Unity -batchmode -projectPath tests/UnityHarness -executeMethod PS2CC.Tests.ImportAll -quit` imports every test export and fails on any invalid avatar, missing material, triangle count above budget, or missing blendshape.

## 7. UX and UI layout

One window, dark theme, built for 1920×1080 and usable at 1366×768. The viewport is always visible and takes at least 55% of the width.

```text
+---------------------------------------------------------------------------+
| PS2CC   File  Edit  View  Export        [Character: Mara v3]   [Export >] |
+------------+----------------------------------------------+---------------+
| TABS       |                                              | INSPECTOR /   |
|  Body      |                                              | LIBRARY       |
|  Face      |               3D VIEWPORT                    |  (context:    |
|  Skin      |      orbit / pan / zoom, click-to-select     |   slots,      |
|  Hair      |      PS2 Lit | Unlit | Clay | Wire | UV      |   thumbnails, |
|  Wardrobe  |      Light: Flashlight v   Post: [x] grain   |   drop zones) |
|  Express.  |      Cam: Face | Bust | Full | 3/4 | Side    |               |
|  Export    |                                              |               |
| (sliders)  |                                              |               |
+------------+----------------------------------------------+---------------+
| Budget: Body 7.9k | Hair 2.4k | Garments 1.6k | Eyes 0.4k = 12.3k / 15k   |
+---------------------------------------------------------------------------+
```

- **Left:** tab list plus the slider panel for the active tab. Curated or All toggle, search box at the top.
- **Right:** context inspector. Clicking a garment, the hair or the face in the viewport selects it and shows its slots, texture drop zone, tint and layer list.
- **Drop anywhere:** dragging a file over the window highlights valid targets (garment under the cursor, skin layer list, hair atlas slot). Dropping on empty space opens "What is this file?" with type choices.
- **Shortcuts:** Ctrl+Z / Ctrl+Y, Ctrl+S, F (frame selection), 1–5 camera presets, W wireframe, P toggle PS2 post, R randomize focused group, Ctrl+E export.
- **Compare:** hold Tab to see the last saved state (A/B).
- **Feedback:** every long task (export, photo projection, hair regeneration) shows progress and can be cancelled; errors show plain-language messages with a "Copy details" button for logs.
- Logs go to `%LOCALAPPDATA%\PS2CC\logs\` with daily rotation.

## 8. Milestones, tests and working rules

Build in ten milestones, strictly in order. Each one ends with a runnable Windows build, screenshots in `docs/milestones/Mx/`, a short changelog, and every acceptance test green in CI. Do not start the next milestone until the user says the current one is accepted.

### 8.1 Milestones

**M0. Foundations and asset compiler**

- Repo scaffold (pnpm workspace + Go module), Wails v2 app that opens a window with an empty Three.js viewport, CI on GitHub Actions (Windows runner) with lint, type-check and tests.
- Asset compiler fetches pinned MakeHuman data and the CC0 asset packs, verifies checksums, converts to app format, writes `LICENSES.json`.
- Golden fixtures: script MakeHuman Python (or mhcore) to output morphed vertex positions for the default character plus 50 random modifier sets (fixed seeds), joint positions for the GameEngine rig, and fitted vertex positions for 5 garments and 3 hairstyles.
- *Accept:* `pnpm build:assets` runs from a clean clone; every shipped file appears in `LICENSES.json` with source URL and licence; no non-CC0/CC-BY asset ships.

**M1. Morph engine and sliders (F1)**

- Load hm08 + modifiers + macros; sliders panel (curated + all), undo/redo, presets, randomize.
- *Accept:* for all 51 golden sets, max vertex error against MakeHuman ≤ 1e-4 m; property test with 1,000 random slider sets yields no NaN/Inf and bounds within plausible human limits; slider drag ≥ 60 fps (measured, logged) on the reference GPU.

**M2. Skeleton and skinning**

- Fit the GameEngine rig from joint cubes; load weights; viewport pose test with a built-in idle/walk clip (or a procedural arm swing); 4-influence limit.
- *Accept:* joint positions match golden fixtures ≤ 1e-4 m; no vertex has weight sum outside 0.999–1.001; visual check screenshots in A-pose and posed for 4 extreme characters (tall heavy male, short thin female, old, muscular).

**M3. PS2 body, eyes, skins, preview shader (F2, F3, F9)**

- Generate the 8k/10k/12k body meshes at build time; eyes, brows, lashes; base skins; PS2 Lit shader, lighting presets, post toggles, camera presets.
- *Accept:* triangle counts within ±3% of targets; vertex map is a subset of hm08 (test); no flipped faces after triangulation; face region keeps ≥ 90% of its original vertices; screenshot set of 6 characters under the Flashlight preset for the user to review.

**M4. Wardrobe (F4)**

- MHCLO fitting, garment decimation, hidden body faces, slots, texture drag-and-drop, tint, dirt layer, UV template export.
- *Accept:* fitted garment vertices match golden fixtures ≤ 1e-4 m; property test: across 200 random bodies no garment vertex sits more than 2 mm inside the body surface (sampled); drop a test PNG and see it applied; exported UV template matches the garment UVs (pixel test).

**M5. Hair card system (F5)**

- Route A re-texture; Route B atlas editor, scalp mask, guides with collision, card sweep, shell, binding, 8 starter styles.
- *Accept:* every starter style regenerates deterministically from its seed (hash test); no card vertex inside the head/shoulder proxy across 200 random heads; style follows head sliders (change head size by 20%, cards stay attached, max gap < 3 mm); triangle count within the style's budget.

**M6. Skin stack and photo projection (F6, F7)**

- Layer stack, overlays, masks, compositing, head texture split; photo projection with colour match and frontal-pose warnings.
- *Accept:* compositing order and blend modes match a reference implementation in tests; head UV remap keeps all head UVs inside 0–1 with no overlap with body; projection on 5 test photos (user-supplied or CC0 portraits) produces aligned eyes/mouth within 4 texels at 1024 px, checked by re-running landmarks on a render.

**M7. Export and Unity package (section 6)**

- GLB export and validator, native FBX writer with ufbx read-back tests, Unity importer, URP shaders, prefab.
- *Accept:* glTF-Validator reports 0 errors; ufbx loads 10 exported test characters with no errors or warnings and every round-trip check in 6.3 passes; property and fuzz tests of the writer pass; the Unity batchmode harness (run on the user's machine or a self-hosted runner with their Unity install) imports the same 10 characters with valid Humanoid avatars, correct materials, triangle counts ≤ budget, and a Mixamo or Unity sample Humanoid animation retargets without broken limbs (screenshot check).

**M8. Expressions (F8)**

- Pose-unit baking, expression map, transfer to brows/lashes/hair, preview sliders, export.
- *Accept:* all default blendshapes present on every affected mesh in Unity; blink closes the eyelids fully without lashes intersecting the eyeball (screenshot); jawOpen opens the mouth without tearing.

**M9. Projects, renders, polish (F10, F11)**

- Save/load, autosave, crash recovery, character browser, PNG renders, budget meter, shortcuts, installer (Wails NSIS) and first-run setup (Unity project path).
- *Accept:* round-trip test: save → load gives identical export (byte-identical GLB excluding timestamps); installer installs and runs on a clean Windows 11 VM; kill the process mid-edit and recovery restores the last autosave.

**M10. Custom garment import (F4 custom, called F12 above)**

- Export base body OBJ; import user garment; auto-bind; weight transfer; hidden faces; decimation.
- *Accept:* a test garment modelled around the exported body fits 50 random bodies without poke-through beyond 2 mm in sampled checks, and exports to Unity with correct skinning.

### 8.2 Test layers

| Layer | Tooling | What it proves |
| --- | --- | --- |
| Unit | Vitest (TS), `go test` | Parsers, maths, binding, compositing, file handling |
| Golden | Fixtures from MakeHuman Python | The engine matches MakeHuman numerically |
| Property-based | fast-check, Go `testing/quick` or rapid | Random sliders, hair params, garments and export scenes never produce NaN, inversion, poke-through or unreadable files |
| Fuzz | Go native fuzzing | The FBX writer and file importers never crash or write invalid files |
| Screenshot | Playwright on the built frontend (WebGL via SwiftShader), pixel diff with tolerance | Presets look the same between commits; generates review images for the user |
| Export | glTF-Validator, ufbx read-back in `go test` | Files are structurally valid and match the engine's data |
| Unity | Batchmode harness project | Humanoid, materials, budgets, blendshapes work in the real engine |
| Performance | Scripted slider sweep with frame timing | 60 fps target is kept |

### 8.3 Agent working rules

- Keep `packages/core` free of DOM, Three.js and Wails imports.
- One pull request per milestone section; never merge with red CI.
- Store large binaries with Git LFS; never commit downloaded caches outside `assets/core/`.
- Pin Node, pnpm, Go, Wails, Three.js, meshoptimizer, ufbx, the C toolchain for cgo (mingw-w64) and the Unity test version in `TOOLCHAIN.md`.
- When MakeHuman behaviour and this PRD disagree, MakeHuman wins for anatomy and fitting; this PRD wins for product behaviour. Log the case in `DECISIONS.md`.
- Ask the user before changing any Fixed decision in section 1, adding a paid dependency, or adding any network call.

## 9. Risks, licences, open questions and sources

### 9.1 Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Macro maths ported wrong | Bodies look subtly off; garments misfit | Golden tests against MakeHuman Python on 51 fixed sets before any UI work |
| meshoptimizer attribute simplification is experimental | Different output between versions | Run at build time only, pin the version, commit outputs and screenshots |
| GameEngine rig deviates from Unity Humanoid in an edge case | Retargeted animations look wrong | Batchmode harness plus a retarget screenshot test in M7; T-pose export option |
| Hand-written FBX writer has subtle errors (axes, bind pose, blendshape layout) | Characters import broken, rotated or unskinned in Unity | Follow Blender's exporter structure closely, ufbx round-trip tests, property and fuzz tests, Unity harness on every writer change |
| cgo build for ufbx complicates the Windows toolchain | Build friction | Pin mingw-w64 in `TOOLCHAIN.md`; CI builds on a Windows runner from a clean image |
| MakeHuman skins look "CG" rather than photo-sourced PS2 | Look falls short of the references | Photo projection (F7) and overlays; user supplies photos (section 2) |
| Hair alpha sorting artefacts in Unity | Hair looks noisy | Cutout by default, inner-to-outer index order, optional dithered outer layer |
| Upstream asset URLs move | Asset build breaks | Mirror fetched archives in Git LFS with checksums |
| WebView2 WebGL performance on low-end GPUs | Laggy sliders | Incremental sparse morphs, cap viewport resolution, measured fps test |

### 9.2 Licence notes

- Shipped character data: CC0 MakeHuman assets, plus CC-BY packs only where attribution is recorded in `LICENSES.json` and shown in Help → Credits.
- Code: an internal tool that is not distributed, so AGPL/GPL references are not a problem. If the user ever wants to sell or share PS2CC, re-check every borrowed code path (clean-room port or open-source the app) before release.
- User textures and photos stay in the user's library and are never bundled into the app.

### 9.3 Open questions for the user

- [x] Unity version and render pipeline: Unity 6 LTS + URP is assumed. Confirm, or name Built-in or HDRP.
- [ ] Blender: not needed. PS2CC writes FBX itself with a native writer ported from Blender's exporter (decided 7 Nov 2026).
- [x] Default triangle budget: 12k target / 15k max. Should LOD versions (for example 6k and 3k) be exported too?
- [x] Texture defaults: head 1024 + body 1024, or head 512 + body 512 for a stricter PS2 feel?
- [x] Name for the app (PS2CC is a working title).

### 9.4 Sources

- [MakeHuman and MPFB licence](https://static.makehumancommunity.org/about/license.html)
- [MakeHuman 2020 licence clarification](https://static.makehumancommunity.org/oldsite/faq/what_changed_regarding_the_license_in_2020.html)
- [MakeHuman asset packs](https://static.makehumancommunity.org/assets/assetpacks/index.html)
- [Basemesh vertex ranges](https://static.makehumancommunity.org/about/concepts/basemesh.html)
- [MakeHuman file formats (MHCLO, proxy, MHMAT)](https://static.makehumancommunity.org/oldsite/documentation/file_formats_and_extensions.html)
- [MakeHuman technical notes (targets, modifiers, weights)](https://static.makehumancommunity.org/oldsite/uncategorized/technical_notes_on_makehuman.html)
- [Proxy meshes and alternative topologies](https://static.makehumancommunity.org/about/concepts/alternative_topologies.html)
- [MPFB rig choices](https://static.makehumancommunity.org/mpfb/docs/characters/rig.html)
- [MPFB rig and weight file format](https://static.makehumancommunity.org/mpfb/developer/rigging_and_posing.html)
- [MPFB clothes, hair and body parts as MHCLO](https://static.makehumancommunity.org/mpfb/docs/assets/concept_clothes_hair_bodyparts.html)
- [makehuman.js (TypeScript port)](https://awesome.ecosyste.ms/projects/github.com%2Fmarkandre13%2Fmakehuman.js)
- [makehuman-js (browser library)](https://awesome.ecosyste.ms/projects/github.com%2Fmakehuman-js%2Fmakehuman-js)
- [makehuman-core / mhcore](https://pypi.org/project/makehuman-mcp/)
- [makehuman2](https://github.com/makehumancommunity/makehuman2)
- [meshoptimizer releases](https://github.com/zeux/meshoptimizer/releases)
- [MediaPipe Face Landmarker for web](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js)
- [Wails v3 beta announcement (v2 remains stable)](https://docs-preview.wails.io/blog/wails-v3-beta/)
- [UnityGLTF and glTFast overview](https://awesome.ecosyste.ms/projects/github.com%2FKhronosGroup%2FUnityGLTF)
- [Why FBX is needed for Unity Humanoid](https://sites.google.com/view/mocapfusion/tutorials/hdrp/hdrp-normals) (background)
- [Unity: preparing Humanoid assets](https://docs.unity3d.com/ru/current/Manual/UsingHumanoidChars.html)
- [Bystedt's hair cards from curves](https://www.cgchannel.com/?p=156171)
- [Volutedberet VertexLighting for URP](https://volutedberet.itch.io/vertex-lighting-unity)

* [ufbx (FBX reader, MIT or Unlicense)](https://github.com/ufbx/ufbx)
* [Blender's binary FBX 7.4 exporter, original commit (encode\_bin.py, export\_fbx\_bin.py)](https://lists.blender.org/pipermail/bf-extensions-cvs/2014-March/004497.html)
