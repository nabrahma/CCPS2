# The look foundation (Part 2, M11)

M11 is the first milestone of `PRD-Part2-Visual-Fidelity.md`. It changes how every character is lit, shaded and baked, in the app and in Unity, and adds the benchmark board that judges the rest of Part 2. Decisions D-083 to D-095 record the details.

## Quality profiles (F13)

Export → Quality profile sets every budget at once. Each value stays editable below it, and the panel lists what you changed, with "Reset to profile".

|  | Classic | Enhanced (default) | Hero |
| --- | --- | --- | --- |
| Triangles (target / hard max) | 12k / 15k | 20k / 24k | 30k / 36k |
| Card hair | 3.5k | 6k | 9k |
| Body tier | 8k | 12k | 16k, full head |
| Head / body texture | 512 / 512 | 1024 / 1024 | 2048 / 1024 |
| Hair / garment atlas | 512 / 1024 | 1024 / 2048 | 1024 / 2048 |
| Light in Unity | Per vertex | Per pixel | Per pixel |
| Shadows | Off | On the ground (cast) | On the character too |
| Baked into the diffuse | Occlusion and light | Occlusion | Occlusion |

New body tiers: 16k and 20k keep every head vertex, and `Full MakeHuman body` is unreduced (26,756 triangles). A bigger hair budget makes denser hair, not just room for it. Characters saved before profiles keep their old settings.

## Renderer and looks (F14)

- **Per pixel** (Enhanced, Hero): wrap diffuse on skin with a warm terminator, a small highlight from each surface's gloss, a strand highlight on hair, and fog.
- **Per vertex** (Classic): Part 1's model. Under Part 1's four lighting presets it renders exactly as before.
- **Shadows**: shadow maps for the key light and the flashlight; hair casts strand-shaped shadows. Enhanced shows the character's shadow on a ground disc; Hero also shadows the character itself (hair on forehead, arms on torso).
- **Looks**: the Light menu adds Foggy town, Village overcast, Interior flashlight and Studio portrait. A look is lights, ambient, fog and a grade (exposure, filmic curve, LUT, bloom, grain, vignette, chromatic aberration).
- **Look files**: Post… → Save look… writes a `.ps2look`, and Load look… reads one.
- **Overrides**: Post… also overrides the shading model and shadows for the viewport only.

## Bake engine (F16)

A GPU ray tracer inside the app. For the body and each garment it bakes four maps:

- **Occlusion**: hair darkens the scalp and forehead, collars darken the neck.
- **Cavity**: creases, from the curvature of the full-density mesh.
- **Thickness**: for translucency later.
- **Light**: Classic's baked sky and key light.

Bakes rerun about a second after the character stops changing. The status shows under the viewport ("Baking 40%", "Baked in 3.2 s"). Export waits for the current bake.

The body's maps arrive as skin layers (Skin → Baked occlusion, Baked cavity, Baked light), so their strength, contrast and mask are yours to change. Garments get theirs multiplied into their texture at export.

The bake is checked against a CPU path tracer at 1,024 rays per point (mean error under 0.03; measured 0.005 on the body and 0.018 on a shirt). It is also checked so that no seam can pick up background texels (`docs/milestones/M11/bake_report.json`).

## Unity (F22)

- **Shaders**: the PS2 shaders now have the same two lighting models, chosen per character by the profile in the export's sidecar.
- **Lights**: add a **PS2 Look** component to the scene and give it a `.ps2look` (and its `.cube`). The shaders then take every light from it, so the character matches the app.
- **Shadows**: URP's main light is turned to the look's key so its shadow map matches.
- **Grade**: `PS2/Grade` runs the grade in a Full Screen Pass renderer feature.
- **Without a PS2 Look**: the shaders use URP's main light and ambient, as before.

Not in Unity yet: flashlight shadows (app only), and bloom, which in Unity is URP's own. The Unity project must use Linear colour space.

**Parity today:** 28 of the 48 benchmark views reach the 0.9 SSIM target. Every full-body and back view passes (0.92 to 0.99). The close-ups score 0.79 to 0.89. Skin, clothes, light, shadow and grade match. The difference is card hair at strand level, where nearly flat overlapping cards resolve differently in the two engines. M12 redraws hair in both engines, and hair parity is checked again there (D-099).

## Benchmark board

`pnpm bench` builds Mara and Cole from the current library and renders them in every profile, under the two benchmark looks, from four cameras, in the app and in Unity. It then:

- compares each view between the two (SSIM, passing at 0.9);
- writes one board per character to `docs/bench/latest/`, with your references beside the renders;
- flags regions that changed since the last accepted board.

See `docs/bench/README.md`.
