# The hair system

PS2CC's card hair is a port of Daniel Bystedt's Blender file *Geometry nodes - hair cards from curves* to TypeScript. This page records what that file does, where each part lives in PS2CC, and where PS2CC departs from it and why.

The `.blend` was read directly (its node trees, modifier settings, card meshes and notes) with a small reader written for the purpose; Blender was not used. Nothing from the file ships: no meshes, textures or node groups. What is ported is the method.

## What the Blender file does

It has three stages, each a scene or a node group.

1. **Groom.** A few hair curves are combed by hand on a growth mesh ("front groom", "back groom").
2. **Interpolate** (`Interpolate hair for haircards`). More curves are scattered on the growth mesh and take their shape from the nearest groomed curve. The file makes two sets: a dense one, and a sparse one that is lifted off the head towards the tips.
3. **Cards** (`Hair cards from curves`, 396 nodes). Every curve becomes one card: a flat strip, mapped to one vertical column of the hair texture, laid along the curve and aligned to the head.

A separate scene, *Haircard texture creation*, grooms strands on flat strips and renders them into the card texture.

## Where each part is in PS2CC

| Blender | PS2CC | Notes |
| --- | --- | --- |
| Hand-combed guide curves | `HairGenerator.guide()` in `hair/generate.ts` | PS2CC has no comb. Guides come from the style's sliders: length, parting, flow, gravity, curl, bangs, ponytail, with collision against the head. |
| `Interpolate Hair Curves` | `HairGenerator.child()` | Nearest guides by root distance, blended. Guides are only shared within a group (each side of the parting, and the fringe), like "Part by Mesh Islands". |
| `Trim Hair Curves` | `child()`, `curves.trim()` | Each hair is cut to its own length. |
| `Clump Hair Curves` | `child()` | Pull towards the nearest guide, shaped along the hair. |
| `Hair Curves Noise` | `child()` | Frizz. |
| "Normal offset" and "Shape" of the sparse set | `child()`, `groom.flyawayLift` | Applied to the cards tagged `flyaway`. |
| `shape_range` | `curves.shapeRange()` | Ported exactly; it shapes every root-to-tip falloff. |
| `Hair cards from curves` | `hair/cards-from-curves.ts` | See the next table. |
| Card source meshes (four flat strips of 9 quads, one texture column each) | The strip built in `cardFromCurve()`; atlas regions by tag | A random column per card, as in the file. |
| *Haircard texture creation* scene and its compositing | `hair/card-texture.ts` | Drawn in 2D instead of rendered in 3D. |
| Scalp cap under the cards | The scalp shell in `generate.ts` | Its hairline falls in the texture's ragged end. |

### `Hair cards from curves`, frame by frame

| Frame in the node group | In `cardFromCurve()` |
| --- | --- |
| Mask curves | Not needed: the hairline mask decides where roots are. |
| Snap curves to parting curve | A root within `partSnap` of the parting line starts on it. |
| Trim Curve, Redistribute Curve Points | `trim()`, `resample()`. |
| Store surface normal; Align tilt to surface normal; `Get curve tilt from normal` | The tilt is measured at the root, between the curve's own normal and the scalp normal, and carried along a minimum-twist frame. Scaled by `alignToSurface`, `rootAlign` and `tipAlign`. |
| Random tip twist; Offset tilt | `tipTwist` (a random angle per curve, growing to the tip) and `offsetTilt`. |
| `Position geo along X for each spline` | The strip is centred on its curve and `downscale` (0.969) of its length. |
| Offset radius | `cards.width`. |
| Subdivide by length | One segment per `segmentLength` of hair, up to `cards.segments` (see below). |
| `Deform X axis of geo along curve` | Width runs along `cross(tangent, normal)`. |
| Snap vertices to parting curve; Lift close to parting curve | Root corners meet on the line; the rest rises by `partLiftHeight` within `partLiftDistance`. |
| Snap root to surface | Blend onto the skin over `rootSnap`. |
| Push outside of surface; `Is inside of surface` | `isInside()`, then out to `surfaceOffset`. |
| Transfer normal from surface | `blendVolumeNormals()` (see below). |
| Transfer colour from surface; Transfer UV from surface | Not ported (see below). |

One detail worth keeping: the node group halves the tilt it computes, with a frame labelled "Mult x 0.5 works for some reason". The reason is that the tilt is applied twice, once by rotating the card's vertices and once inside the sampled curve normal. PS2CC applies it once, at full strength.

The default values in `DEFAULT_CARD_BUILD` are the file's own, from its "Hair cards thick" object.

## Where PS2CC departs from the file

- **No hand grooming.** Guides are generated from the style's parameters. This is the largest difference, and the reason the tool needs no Blender.
- **Guide shapes turn about the head.** A hair that follows a guide from further round the head has the guide's shape turned about the vertical axis by the angle between the two roots. Blender's "Follow Surface Normal" tilts the whole hair, which swings hair that hangs under gravity.
- **Shading normals come from the hair's volume, not the nearest skin.** The file copies the nearest scalp normal to each card vertex. PS2CC's hair hangs below the head, where the nearest skin normal points down, so the normal points straight out from an axis through the skull and neck. The effect is the same: the hair shades as one soft volume.
- **Segments follow a triangle budget.** The file subdivides long cards by 2 or 4 and decimates afterwards. PS2CC gives a card one segment per `segmentLength`, capped, and fits the number of cards to the style's budget. The count depends only on the style, so the mesh has the same topology on every body.
- **One texture, no passes.** The file renders alpha, normal, specular, "random" and "intercept" passes. PS2-era hair has a diffuse texture with alpha and nothing else, so the same information is drawn into that one image.
- **No colour or second UV set from the scalp.** PS2CC's meshes carry neither vertex colours nor a second UV channel. The root-to-tip ramp is in the texture instead.

## Files

| File | Holds |
| --- | --- |
| `packages/core/src/hair/curves.ts` | Resample, trim, minimum-twist frames, `shapeRange` |
| `packages/core/src/hair/cards-from-curves.ts` | One card from one curve; volume normals |
| `packages/core/src/hair/generate.ts` | Guides, interpolated hairs, layers, budget, scalp shell |
| `packages/core/src/hair/card-texture.ts` | The card texture generator |
| `packages/core/src/hair/style.ts` | Style parameters, including `groom` and `build` |
| `tools/asset-tools/src/hair-atlases.ts` | Builds the shipped atlases (`pnpm build:hair`) |
| `packages/core/test/hair-cards.test.ts`, `hair.test.ts` | Tests |
