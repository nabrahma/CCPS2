# Face and eyes (Part 2, M14)

Close-ups of the face are where a PS2-era character is judged. M14 spends the head's texture and triangles where the camera looks: a head texture laid out for the face, generated eyes, an open mouth that reads as a mouth, photo projection from three views, a scanned face to start from, and skin micro-detail. DECISIONS D-116 to D-123 record the choices.

## The head texture

The exported head texture has its own layout for each body mesh (`assets/core/skin/head/<mesh>.json`, built by `pnpm build:headlayout`):

- The face, scalp and neck are one piece, flattened with as little stretch as possible (ARAP) into the top of the texture, with the face drawn about three times larger than the rest.
- The eye sockets, the mouth interior and the other small pieces sit in a strip along the bottom.

| Mesh | Texels used | Face texel density vs Part 1 |
| --- | --- | --- |
| 8k | 86.9% | ×2.11 |
| 10k | 87.1% | ×2.16 |
| 12k, 16k, 20k, full | 87.3% | ×2.16 |

No triangle folds or overlaps. The skin stack is composited straight into this layout on the GPU, at the head texture's full resolution. The viewport's "export size" preview shows the head at its new density.

## Eyes

The **Face** tab's **Eye colour** list offers an iris library of 12 colours (dark brown to violet grey). The eye texture is generated: radial fibres, a lighter ring round the pupil, a dark limbal ring, sclera veins and a shadow from the lids. The iris, the colour around the pupil, the white of the eye, pupil size, iris detail, veins and lid shadow each have their own control. MakeHuman's eye textures stay in the list.

With Classic (per-vertex) lighting a catch-light is painted into the texture. Per-pixel lighting draws a real highlight instead.

Eyelashes have soft alpha edges (the two-pass alpha of D-109). Brows can be the eyebrow mesh, card brows (M12), or the new **Painted eyebrows** skin layer, the era's usual choice, with thickness, arch and hair density.

## Mouth

- **Low-poly teeth and tongue.** Every teeth set is at most 384 triangles and the tongue 160, together at most 544 (the budget is 600). Each tooth gets its own share: the 16 front teeth get twice what the molars get, and the gums get a third of the total. New characters get teeth and a tongue. Older characters keep what they had.
- **Mouth interior.** This skin layer darkens the inside of the mouth towards the throat. New characters have it.

## Three-photo projection

**Skin → Face photo** takes a front photo, as before. You can now also add a left and a right photo: three-quarter views, about 45°. Each photo gets its own camera, fitted to the face's landmarks. Each texel takes its colour from the photos that see it most squarely. The front photo keeps the eyes and mouth, and the side photos take over towards the ears.

The side photos are colour-matched to the front one, first overall and then gently region by region. Different light in each photo therefore doesn't leave a seam. With only a front photo, projection works exactly as before.

Tested on synthetic stand-in photos (renders from 0° and ±40°):

| Set | Worst eye or mouth landmark | Seam step, p95 (8-bit levels) | Same with a hard switch between photos |
| --- | --- | --- | --- |
| 1 | 2.34 texels | 0.47 | 19.8 |
| 2 | 2.33 texels | 0.67 | 22.3 |
| 3 | 0.86 texels | 1.23 | 28.5 |

The limit is 4 texels at 1024, and the seam step must stay under 3 levels.

## Scanned face

**Skin → Base skin → Scanned face (Lee Perry-Smith, CC BY 3.0)** is a base skin made from the Infinite Realities head scan:

1. The scan is rendered unlit from the front and from 40° either side.
2. The renders go through the three-photo projection onto the neutral MakeHuman head.
3. The result is colour-matched to MakeHuman's young caucasian male skin and laid over it.

The scan is CC BY 3.0, so Help → Credits names it. `pnpm build:scanskin` rebuilds the skin after the asset compiler has fetched the scan (`leeperrysmith_*` in `tools/asset-compiler/sources.json`, pinned to three.js r187).

## Micro-detail

Two skin layers add detail finer than the procedural layers' 1024 px:

- **Skin pores** (on by default for new characters). A pore pattern is overlaid on the skin. It is strongest on the nose, then the cheeks, lighter on the forehead and faint on the body. There are none on the eyelids or lips. Each region has a slider, and **Pore size** scales the pattern.
- **Stubble hairs.** Short dark hairs over the beard area, in the stubble's colour. Use it with the **Stubble / beard shadow** layer for close-ups.

Both patterns are tileable and repeat across the skin at about 1 mm per pore: about 2.3 texels apart in the 2048 body texture's UVs and about 5 in the repacked head texture. They are drawn at the composite's full resolution (and the head texture's) through a 1024 px region map. No CC0 skin-pore texture could be found that may be redistributed (D-122), so PS2CC generates the patterns itself (`packages/core/src/skin/detail.ts`).

## Known limits

- The three-photo projection is tested with synthetic stand-ins, not real photos yet.
- The scanned face is one person's face. It fits MakeHuman's neutral head, and other head shapes stretch it the way any base skin stretches.
- The tongue sits where MakeHuman puts it, high in the mouth, so a wide-open mouth shows a lot of tongue.
