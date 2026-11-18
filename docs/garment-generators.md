# Garment generators

PRD Part 3, F28 (shell garments and accessories) and F32 (Garment Designer, Shell tab). Code: `packages/core/src/garment/shell/`, the checks in `packages/core/src/garment/quality.ts`, the Designer in `app/frontend/src/components/studio/GarmentDesigner.tsx`.

A generated garment is a template plus parameters. It is made on the reference body, bound like an imported garment (M10), and saved like one: in the library, or kept on one character (D-151). Its file records the template, the parameters and the generator version (`meta.generator`). That is what lets the garment be generated again on each character's own body and opened in Garment Designer again.

## The look

The target is the clothing on the user's reference characters (`PS2 Character/`, not in the repository). Measured from their GLBs:

- One closed clothing mesh, with skin only where it shows. About 3,300 triangles a character.
- Hems step out about 1 cm, so an edge reads as cloth with thickness.
- Trouser legs hang straight below the knee. Tops hang plumb from the chest. Soles are chunky.
- Folds, seams and shading live in the texture, not the geometry.

## Templates

| Group | Templates | How they are made |
|---|---|---|
| Tops | T-shirt, long-sleeve, roll-neck, tank, utility vest | shell |
| Bottoms | leggings, straight, flared and cargo trousers, shorts | shell, legs lofted below the knee |
| Hands and feet | gloves, socks, work boots, sneakers | rings |
| Headwear | beanie, cap (with brim), hood | shell over the skull's ellipsoid |
| Accessories | belt, wristband, holster band, strap, satchel | swept bands and boxes |

Every parameter has a schema (slider, switch or choice, with range, step and unit). The Designer builds its panel from it.

## The shell pipeline

`runShell` in `build.ts`, in order:

1. **Cut.** The body tier (12k, or the full body for hats and accessories) is cut by the template's constraints (hems, necklines, cuffs, openings). Level hems are exact cuts.
2. **Panels.** Each triangle gets a panel from where it is on the body (front, back, sleeves, legs). Stray bits join their neighbour.
3. **Ease.** The ease comes from the garment class, with bands (cuffs, waistband, roll-neck) held fixed, then diffused so it changes gradually.
4. **Offset.** The surface moves out along the normal by the ease. Where other skin faces it (inner arm, inner thigh), it goes at most 0.45 of the gap. Cloth stays on its own side of the body's middle, so the two inner thighs never cross at the crotch.
5. **Shape.** The garment is smoothed, then:
   - **Hull.** Each slice is blended towards its convex hull, so cloth bridges hollows. The seat is fully bridged, the cleft included.
   - **Radius map.** Over the torso and legs, the cloth's radius from the part's axis is low-passed at the scale anatomy shows at, and held over a floor (skin plus the minimum ease). Then two more steps:
     - Where the floor holds the cloth out (a bust, a belly, a seat), the deficit is spread so the cloth rounds over with a wide cap.
     - Tops are rounded further, so a top stands off a flat back and hangs straight, as the reference characters' do.
     - Cloth that landed on the bridge over a narrow hollow is relaxed over the target surface.
   - **Hoods.** The head goes onto an ellipsoid that holds the ears. A smoothed copy is projected first, then relaxed over the ellipsoid, because the ear and its canal would fold onto one patch.
6. **Clearance.** Every vertex keeps at least 1.5 mm from the skin. Distance is measured against the full body and every rendered tier (8k, 10k, 12k), so whichever tier is exported, the cloth is clear.
7. **Decimation** to the slot's budget, with meshoptimizer. The target is found by counting first: lofts, rims and parts are added without measuring anything, until the total fits. Then the garment is finished once.
8. **Finish:**
   - Legs and sleeves are lofted as straight tubes.
   - Triangles are made clear (corners, centres and edge midpoints).
   - **Rims.** Every open edge gets a two-segment rim at least 5 mm deep. Normally it turns in. Where skin is close, it rolls out. If a rim still crosses cloth, its loop flares out instead. Where the cloth itself folds at a corner, the corner relaxes.
   - Brims, soles and pockets are added.
9. **UVs** by LSCM per panel, packed at one texel density. Panel edges are the seams Garment Studio and the texture tools find.

Boots, socks and gloves are built from rings instead. Each ring is the convex outline of a slice of the foot or hand, grown by the ease. Ring points lie along one set of directions, so bands do not twist. The points are spaced evenly round an ellipse the size of the outline, so long feet get points at the toe. Chords are pushed out until they hold every corner of the outline.

- **Gloves** are a mitt with the thumb as its own closed tube. They overlap as separate pieces, as on period models.
- **Socks** are boot rings without a sole.

## Per-body generation

The reference run records the garment's topology: the cut field, the kept triangles, the panels, the decimation record and the brim arc. A character's scene generates the garment again on its own body (`shellBodyAt`, `replayShell`) with that topology, so vertex and triangle counts are identical on every body. This happens once the shape settles. During a slider drag the garment follows by its binding. A settled generated garment skips the scene's garment collider, because it is already clear of the skin.

## Determinism

Generators use `core/math/dmath` only (the lint rule bans `Math.sin`, `Math.hypot`, `**` and the like in `src/garment`), with fixed iteration counts and fixed orders. Every template's mesh and UVs are hashed in `determinism.ts`. Node and Chromium must give the golden hashes. Generating twice gives the same bytes.

## The checks (PRD 5.0)

In `quality.ts`, run by `test/m21.test.ts` on the default male and female bodies and on random bodies:

| Check | Measure | Pass |
|---|---|---|
| Rim depth | span along the normal within two edges of each open edge | ≥ 5 mm on the reference body, ≥ 4.5 mm fitted |
| Ease | area-weighted distance to the skin, away from open edges | mean ≥ the class minimum, under half of it on ≤ 5% |
| Show-through | band-passed radius maps of cloth (smooth surface through its vertices) and body over the torso; cloth energy ÷ the larger of the body's and the default body's | ≤ 25% (tight classes exempt) |
| Silhouette | corner turns along horizontal slices of the main cloth, corners merged within 1.2 cm | 95% ≤ 35°, none over 60° |
| Poke-through | garment vertices inside the visible skin and the whole body | ≤ 2 mm |
| Topology | manifold, consistent winding, no self-intersections within a piece, in budget | exact |

`PS2CC_M21_BODIES` sets the number of random bodies (default 200). `PS2CC_M21_ONLY=9,17` runs single bodies. Results go to `docs/milestones/M21/` (`generation.txt`, `quality.txt`, `random-bodies.txt`).

## Garment Designer (Shell tab)

Asset Studio → Garment Designer:

- Pick a template, set its parameters, or press **Random design** (seeded: the same seed gives the same design).
- The preview is worn by the character as you go.
- Round **hem handles** in the viewport drag the hem lengths: top and trouser length, sleeves, rise, sock and boot height, glove cuffs.
- **Save to Wardrobe** makes a library garment. **Keep on this character** stores it in the character only.
- A worn generated garment shows **Edit in Garment Designer** in Clothes.

The Pattern tab arrives with the pattern generator and drape solver (M22, M23).
