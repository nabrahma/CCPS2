# Character Creator, Asset Studio and library (Part 2, M16)

PS2CC is now two experiences in one app (PRD Part 2 F20). The **Character Creator** is the default view: you pick, slide, dress and export, one category at a time. The **Asset Studio** holds the deep editors: Hair, Texture, Garment and Material Studio. Whatever you save in a studio goes into your library, and the creator's steps pick from it. DECISIONS D-132 to D-138 record the choices.

## The Character Creator

The editor's rail on the right lists one category per part of the character, and its panel shows that part's controls only (D-149; see [workspace.md](workspace.md)). Most panels offer an "Edit in … Studio" button for the rest.

| Step | What you do there | Studio |
| --- | --- | --- |
| Body | Pick a body preset, then shape the body with the sliders. Save your sliders as a preset. | none |
| Face | Shape the head and face with the sliders. | none |
| Skin | Pick a skin, and details (freckles, stubble, dark circles, eye bags, grime, bruises, sweat, pores, stubble hairs). | Texture Studio |
| Eyes | Eye colour from the iris library, its colours, pupil, veins and lid shadow; the eyeball model. | none |
| Brows, Lashes | Painted brows and lashes: a preset, colour, their shape and hair, and the brow brush. | none |
| Makeup | Lips, eyeliner and eyeshadow, blush. | Texture Studio |
| Mouth | Teeth and tongue (the mouth opens to show them). | none |
| Hair | Pick a hairstyle (editable hair cards, your saved ones, MakeHuman meshes or bald), a colour and its length, volume and fringe. | Hair Studio |
| Clothes | Put on an outfit or single garments, open a worn garment's settings, dress it in a material, save what you wear as an outfit, import your own garments. | Garment Studio (in a worn garment's settings), Material Studio |
| Look | Choose the quality profile (Classic, Enhanced, Hero), the look, from thumbnails of your character under each one, and the lighting model, shadows and PS2 screen. | none |
| Export | Export to Unity or a folder; choose which expressions to bake as blendshapes. | none |

Picking anything is one undo step. The viewport toolbar still has every view option, and clicking a part of the character opens its category.

## The library

Every grid in the creator is the library: body presets in Body, hairstyles in Hair, outfits, garments and materials in Clothes, skins in Skin. Each grid has a search box, one filter menu and a favourites star. The built-in MakeHuman assets are shown by plain names ("Blunt bob", "Young African female") worked out from what they are, since their own names and tags are file names and often wrong (D-149).

- **Thumbnails** show each asset on a stand-in of your character's sex and quality profile, under the look the viewport shows. Change the look and they render again. They render when they scroll into view and are kept until the look changes.
- **Favourites:** star an entry. The Favourites switch shows only starred ones, and starred entries come first everywhere.
- **Tags:** every entry has its own tags (slot, kind, built-in or yours, MakeHuman's tags). In the library browser, **Tag…** adds your own, and a tag it already has is removed. Click a tag to filter by it.
- **Search** matches every word against names and tags.
- **Edit in Studio** opens the entry in its studio. **Delete** removes your own entries.

Favourites and your tags are kept in the app's settings.

Two outfits ship with the app: the benchmark outfits, **Utility vest and roll-neck** (Mara's) and **Cropped leather jacket** (Cole's). Putting an outfit on replaces what the character wears.

## The Asset Studio

Open a studio from a panel, a library entry, or **Studio** at the foot of the rail. While a studio is open, its tab row lists the four studios, shows the open one's editor, and **‹ Back** takes you back.

### Hair Studio

Hair Studio has every hairstyle setting: type (bald, hair meshes, card hair), style, colour, locks, card texture, length, flow, cards, groom, card build, and the hairline and scalp. Its groom brushes are over the viewport, and **Groom brushes** turns them on and off. **Save style…** adds the style to Hair. **Done** returns to the creator.

### Texture Studio

Texture Studio paints the skin or a worn garment; choose which at the top.

- **The skin:** every layer with its settings, face photos (front and sides), painting in Material Painter, and your own painted layers. **Save as new skin** saves the skin as it looks now, base and layers together, to your skins in Skin, and switches to it.
- **A garment:** tint, grime, the garment's materials, seams, folds and decals, and Material Painter. **Save as new garment** saves the garment as it looks now, in one texture, as a new Wardrobe garment with the same shape, and wears it.

### Garment Studio

This is M15's Garment Studio, now inside the Asset Studio: brushes and kitbash tools over the viewport, and the garment to edit chosen in the right column. **Save as new garment** adds the garment to Clothes.

### Material Studio

Material Studio makes a garment material:

- **Start from** a library material (its PBR maps), or from **your images**: a colour map, plus normal, roughness, occlusion or height maps if you have them. One photo of the cloth is enough: its relief comes from its brightness.
- **Adjust** hue, saturation, brightness, contrast, relief and occlusion. **Make seamless** cross-fades the edges of an image that does not tile, and the preview warns while a seam still shows.
- Set the **kind**, the **tile size** (one tile's size on the body, in cm) and the **name**.

The preview is the converted era diffuse, two tiles by two. If the studio was opened with a garment worn, that garment wears the material while you edit. **Close without saving** puts the garment's own material back. **Save to library** converts the material at 1024 px with the library's own converter and dresses the garment in it. The material then appears in Clothes and in every garment's look editor.

## Saved files

These are in `Documents\PS2CC\Library`:

| Kind | Folder | Files |
| --- | --- | --- |
| Hairstyles | `hairstyles/` | `<name>.ps2hair` |
| Body presets | `presets/` | `<name>.ps2preset` |
| Outfits | `outfits/` | `<name>.ps2outfit` |
| Skins | `skins/` | `<name>.png` |
| Garments | `garments/` | `<id>.json` and `<id>.bin`, texture in `garment-textures/` |
| Materials | `materials/` | `<name>.ps2mat` and `<name>_diffuse.png` |

A character that uses one of your own assets references it by its library id, as garments already did. A character opened on another machine without the asset falls back: a missing garment is reported and left off, and a missing material leaves the garment's own texture.

## Known limits

- Thumbnails render one at a time in a second, hidden viewport. On a slow GPU the first screen of a grid takes a few seconds, and a look change renders them again.
- Looks have no library grid. The Look panel shows your character under each look instead.
- Saving a skin bakes its layers in: the saved skin cannot be taken apart again, though you can keep the character it came from.
- Material Studio's preview is converted at 512 px; the saved material at 1024 px.
