# The workspace and your data folder (M18)

## The window

A large viewport with the editor beside it. DECISIONS D-140 to D-143 record the first layout, and D-149 the editor as it is now.

- **Top bar:**
  - File, Edit, View and Help menus; new, open (the character browser) and save;
  - undo and redo, and the character's name (a blue dot means unsaved changes);
  - how the viewport draws: Lit, Unlit, Clay, Wire or UV, the light or look, the PS2 screen and the Post menu;
  - renders, and **Export**.
- **Viewport:** the character, and the camera bar at the top left (Full, Bust, Face, 3/4, Profile, Turntable, Pose test).
- **Editor** on the right: a rail of categories, and the chosen category's panel beside it. See below.
- **Status bar:** the triangle budget against the profile's target, triangles by part, texture memory, bones, blendshapes, the bake and the frame rate. When the bake is out of date, **Bake** bakes it; nothing bakes by itself unless you turn on **Settings → Baking → Bake automatically after each change**.
- **Menus** open on a click and stay open until you choose an item, click elsewhere or press Esc. With one open, pointing at another menu's name opens that one.

### The editor

The rail lists one category for each part of the character, in four groups:

| Group | Categories |
| --- | --- |
| Shape | Body, Face |
| Face | Skin, Eyes, Brows, Lashes, Makeup, Mouth |
| Style | Hair, Clothes |
| Finish | Look, Export |

**Studio** (the Asset Studio) and **Settings** are at the foot of the rail.

Choosing a category shows its panel and nothing else: a title, a line on what is there, and its controls, with the common ones first and the rarer ones folded away. Each category also frames its part:

- Eyes, Brows, Lashes, Makeup and Mouth turn the camera to the face;
- Hair turns it to the bust;
- Body and Clothes show the whole body.

**Mouth** opens the mouth while it is shown, so the teeth and tongue can be seen. This is a preview only: nothing is saved or exported.

Clicking a part in the viewport opens its category. A garment opens in Clothes with its settings unfolded.

- **Body and Face:** a search box and a region menu (All regions, a single region such as Nose or Torso, or Favourite sliders), then Symmetry, Every slider (all of MakeHuman's sliders and their full range) and Randomize.
- **Library grids** (body presets, hairstyles, outfits, garments, skins, materials): a search box, one filter menu and a star for favourites only.
  - Hair filters by Short, Medium, Long, Editable (hair cards), Mesh (MakeHuman) or Yours.
  - Garments filter by slot, and skins by gender and age.
  - Your own entries show **Edit** and **Delete** when the pointer is over them.
- **Clothes:** each worn garment is a row. Click it to open its settings (tint, grime, materials, paint, Garment and Texture Studio). Its eye hides it in the viewport, and × takes it off.
- **Hair** and **Eyes** have an eye button beside their title that hides them in the viewport. Neither eye button changes the character or the export.

## Where your work is kept

Characters, the library (your garments, hairstyles, materials, skins, outfits and presets) and settings live together in one **data folder**, `Documents\PS2CC` unless you choose another.

- **Saving anywhere.** **File → Save as…** saves a character to any folder. From then on, Ctrl+S updates that file. The character browser lists characters you saved or opened elsewhere ("In D:\…") beside those in the data folder.
- **Moving the data folder.** **Settings → Data folder → Change…** (or File → Data folder…).
  - **An empty or new folder:** PS2CC copies everything there, checks every copy against its original, and uses it from the next start (**Restart now**). The old folder is left exactly as it was; delete it yourself once you are happy.
  - **A folder with other files in it:** PS2CC makes a `PS2CC` folder inside it.
  - **A folder that already holds PS2CC data** (from another PC, or a backup): it is used as it is, with nothing copied.
- **Nothing breaks if the folder goes away.** If the data folder is on a drive that is not connected when PS2CC starts, it starts with the default folder and says so. Reconnect the drive and restart, or choose another folder.
- **Going back.** **Use the default folder** returns to `Documents\PS2CC` from the next start.

Where the data folder is, is kept in `%LOCALAPPDATA%\PS2CC\location.json`. The `PS2CC_HOME` environment variable, if set, still overrides it (the tests use it).
