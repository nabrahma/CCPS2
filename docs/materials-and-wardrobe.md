# Materials and wardrobe (Part 2, M15)

Era garments got their silhouette from geometry (collars, cuffs, pockets, straps) and their detail from one painted diffuse: weave, grain, seams, stitches, folds, wear. M15 gives PS2CC both. You get a library of CC0 materials converted to that one diffuse, material zones, automatic seams and stitches, fold stamps and decals, plus Garment Studio for reshaping garments. The benchmark outfits are made with these tools. DECISIONS D-124 to D-131 record the choices.

## Material library

Eleven CC0 materials, downloaded at 2K from [Poly Haven](https://polyhaven.com) and [ambientCG](https://ambientcg.com). The asset compiler pins them by checksum.

| Material | Kind | Source |
| --- | --- | --- |
| Smooth leather | leather | Poly Haven, Leather White |
| Worn brown leather | leather | Poly Haven, Brown Leather |
| Black leather | leather | ambientCG, Leather 031 |
| Suede | suede | ambientCG, Leather 039 |
| Denim | denim | Poly Haven, Denim Fabric 03 |
| Cotton jersey | cotton | Poly Haven, Cotton Jersey |
| Canvas | canvas | ambientCG, Fabric 062 |
| Herringbone wool | wool | Poly Haven, Poly Wool Herringbone |
| Knit | knit | Poly Haven, Knitted Fleece |
| Nylon ripstop | nylon | ambientCG, Fabric 048 |
| Shearling | fur | Poly Haven, Curly Teddy Natural |

Each material is converted once, at build time (`pnpm build:materials`), into an **era diffuse**. The converter bakes the albedo, the normal map's light and the occlusion into one tileable texture under a fixed soft top light, with a little cavity darkening. Each tile is then laid on garments at its real size: 30 cm of leather is 30 cm on the jacket, whatever the garment's UVs.

Rendered flat under the same light, every converted material matches its PBR original at SSIM 0.926 to 0.995; the PRD's limit is 0.85. A control renders the plain albedo, unconverted, the same way and averages 0.931, against 0.968 for the converted materials. The difference is largest where the relief carries the look: the ripstop grid (0.69 unconverted, 0.95 converted), shearling and knit. Report: `docs/milestones/M15/material_check.json`.

## Dressing a garment

Click a garment, then **Use materials** in the Inspector:

- **Zones.** Each zone has a material (or the garment's own texture), a colour, a scale, a rotation and **Wear**, which scuffs and fades the edges. **Pick pieces** puts the pieces of the garment you click into a zone. **Paint** paints a zone across pieces, for example a leather yoke on a cloth jacket.
- **Seams and stitches.** Found from the mesh: where two pieces meet is a seam, and an open edge is a hem. Each gets a shadow, stitching and edge wear. You set the stitch strength, shadow, spacing, single or double hem stitching, and the thread colour (by default a shade of the cloth).
- **Folds.** Creases at the elbows, under the arms, at the waist, crotch and knees. They are deeper where the cloth stands off the skin, and gather on the inside of the bend. There is a strength per site and a variation.
- **Decals.** Zips and straps (drag from one end to the other), and buttons, rivets, buckles, pocket flaps and patch pockets (click to place). Each has a size, a rotation and a colour.

The viewport and the export compose the same texture. Everything is measured on the garment as it sits on the default body, so the texture never moves when a slider does. Sending the garment to Material Painter (Texture Studio) sends it dressed, and the paint brought back replaces the look.

## Garment Studio

**Inspector → Edit in Garment Studio** reshapes the garment you clicked, on your character:

- **Brushes:** Grab, Smooth, Inflate, Crease and Flatten, with radius, strength and X symmetry.
- **Crop:** click where the garment should end. On a sleeve or leg it cuts across the limb; on the torso it cuts straight across, between the shoulders.
- **Roll up:** crop a sleeve or leg and turn the edge back into a cuff.
- **Collar / cuff:** click near an open edge to grow a folded collar, a roll neck, a band or a turned-back cuff from it.
- **Pocket:** a patch pocket where you click.
- **Loosen all / Tighten all:** to wear one garment over another.

The cloth is kept at least 1.5 mm off the skin after every change. **Save as new garment** adds the garment to the Wardrobe and puts it on in place of the original. Saving moves it onto the default body and imports it like a garment modelled around it (binding, weights, decimation, hidden faces), so it fits every body shape. On 50 random bodies no vertex of the five outfit garments below goes inside the skin (the limit is 2 mm); without the collider the same garments go 4.4 mm deep.

## The benchmark outfits

`pnpm build:outfits` builds them with Garment Studio's own code from MakeHuman's CC0 garments. They ship in the Wardrobe already dressed:

| Garment | Made from | Studio steps | Look |
| --- | --- | --- | --- |
| Roll-neck sweater | Fisherman sweater | roll neck | knit |
| Utility vest (Mara) | Fisherman sweater | sleeves cropped, loosened 9 mm, neck band, two chest pockets | canvas, ripstop band, zip, pocket flaps |
| Cropped leather jacket (Cole) | Fisherman sweater | cropped at the waist, loosened 1 cm, folded collar | worn leather, shearling collar, fur trim on collar and cuffs, zip, pocket flaps |
| Wristbands | Medium gloves | cropped to the wrist | knit |
| Cargo trousers | Cargo pants | a patch pocket on each thigh | canvas, pocket flaps |

Mara and Cole wear them on the benchmark board. Cole's tall boots are now ankle boots, because the tall ones showed through the trousers at the knee.

## Known limits

- **Gloss** is still one value per surface. All garments export as one merged material, so leather does not shine more than cotton yet.
- **Decals** are drawn on the piece of cloth under their point. A zip that crosses a seam stops at it.
- **Garment Studio** edits are undone in the studio (Undo), not in the app's history. Saving is one undo step.
- **Crop edges** follow the garment's triangles, so a cropped hem on a coarse garment is a little jagged.
- **Kitbashed parts** get their own room in the texture: the garment's original pieces are scaled to 80% of it.
- **Under the arms:** MakeHuman's fisherman sweater leaves a small gap where skin shows. The roll-neck, the vest and the jacket are made from it and keep the gap.
