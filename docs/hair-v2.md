# Hair v2 and Hair Studio (Part 2, M12)

M12 replaces how card hair is built and drawn. Decisions D-100 to D-114 record the details; `docs/hair-system.md` covers the card generator that Hair v2 builds on.

## Three layers

| Layer | What it is | Where it lives |
| --- | --- | --- |
| Scalp layer | Short hair painted into the head texture along the groom's flow, fading softly at the hairline, sideburns and nape | Skin → *Hair on the scalp*, an ordinary skin layer (opacity, mask, on/off) |
| Locks | The hair's mass: wide ribbons (6 to 9 cm), bowed outwards, mostly opaque | Hair → Locks |
| Detail cards | Part 1's cards for the fringe, tips, flyaways and the outer edge, with soft alpha | Hair → Cards |

Hair v2 styles also keep a small cap over the crown under the locks, so no scalp shows between them from above. The cap ends well inside the hairline; the scalp layer draws the hairline itself.

## Styles

Eight Hair v2 styles ship:

- Mara's layered bob and Cole's curtain fringe (the benchmark characters' hair);
- six restyled presets: short messy, side part, bob, shoulder-length, long straight and ponytail.

Buzz, crew, long centre part, bob with fringe and short with sideburns are unchanged Part 1 styles.

`.ps2hair` files are now version 2. They add locks, the scalp layer, the strand look, a combed groom and a drawn parting. Version 1 files still load and look as they did.

## Colour

Hair → Colour picks a preset or sets the colour directly: base colour, darker roots, lighter tips, streaks (with their own colour) and grey.

The atlas is greyscale, rendered from 3D strands, and the colour is a gradient map over it, so one atlas serves every colour. Five strand looks ship: straight fine, straight coarse, wavy, curly and short stubble.

Hair saved before v2 has no colour and keeps its tinted brown card atlas.

## Adjust

Hair → Adjust scales length, volume and fringe on top of the style, which stays as it was made. These are the sliders the Character Creator will expose (M16).

## Hair Studio

Hair → *Open Hair Studio* turns the viewport into a grooming workspace. The left button paints; the right button orbits and the middle button pans.

- **Brushes:** Comb, Snake hook, Grow, Shrink, Pinch, Puff, Smooth, Slide, Add, Delete, Density and Select.
- **Brush settings:** radius, strength, falloff (smooth, linear, constant), X symmetry, front faces only, and Invert for Grow/Shrink and Select.
- **Parting:** draw the parting on the scalp.
- **Locks:** select guides, then set the width and curl of the locks that follow them.
- **Show:** turn the scalp layer, the cap, the locks and the cards on and off. This changes the view only.

The first stroke turns the slider-made guides into a combed groom, stored with the style on the neutral head, so it fits any character. Each stroke is one undo step. *Reset groom* goes back to the guides from the sliders.

### Card mode: one curve is one card

Guides shape the hair in broad strokes: combing one moves every lock and card generated around it. For card-by-card control, as in the "Hair cards from curves" workflow where the artist places every curve, press *Edit cards directly*:

- Every lock and card on screen becomes its own curve, and the brushes now move single cards.
- **Draw** adds a card: press on the scalp where it should grow and drag along the way it should fall. A new card copies the settings of the nearest card; with X symmetry on, its mirror image is added as well.
- **Card settings** change the selected cards (use Select first): make them locks or flat cards, scale their width, set their twist, pick their texture (clump, strand, fringe, flyaway, base, lock), step to the atlas's next strip with that texture, or flip the strip.
- Under *Show*, hide Locks or Cards to brush only the other kind.
- *Back to guides* drops the hand-placed cards; the hair is generated from the guides again.

Hand-placed cards are stored with the style (`groom.cards` in `.ps2hair`), on the neutral head, so they fit every character. On a quality profile with a smaller hair budget than the cards need, some detail cards are left out evenly over the head; Hair Studio says how many, and they come back on a bigger profile.

## Fur trims and card brows

- **Fur trims:** a garment's fur trim grows cards along its collar, cuffs or hem (`fur` in the garment). It exports as its own *Fur* material.
- **Card brows:** these replace the eyebrow mesh with short cards grown on it (`eyebrows.cards`). They follow brow expressions like the mesh did. Since 0.20.0 new characters have painted brows and no brow mesh (D-146), so card brows only grow on characters saved with the mesh.

## In Unity

Hair v2 materials draw twice. The opaque pass keeps texels at or above the cutoff; *SoftAlpha*, a second pass of PS2/Cutout, blends the softer strand tips over it. The importer turns the second pass on only where the sidecar's `softAlpha` asks for it. Hair colour arrives already in the texture.
