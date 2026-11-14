# The workspace and your data folder (M18)

## The window

The layout follows Character Creator's: a large viewport with one dock beside it. DECISIONS D-140 to D-143 record the choices.

- **Top bar:**
  - File, Edit, View and Help menus; new, open (the character browser) and save;
  - undo and redo, and the character's name (a blue dot means unsaved changes);
  - how the viewport draws: Lit, Unlit, Clay, Wire or UV, the light or look, the PS2 screen and the Post menu;
  - renders, and **Export**.
- **Viewport:**
  - the camera bar at the top left (Full, Bust, Face, 3/4, Profile, Turntable, Pose test);
  - the Character Creator's six steps along the bottom: 01 Create, 02 Hair, 03 Wardrobe, 04 Appearance, 05 Look, 06 Export.
- **Dock** on the right, with four tabs:
  - **Modify:** the parts tree, and under it the controls of whatever is chosen there or in the step strip.
  - **Library:** every preset, hairstyle, garment, outfit, skin and material, as thumbnails under the current look (Ctrl+L).
  - **Studio:** the Asset Studio (Hair, Texture, Garment and Material Studio), with **‹ Creator** to go back.
  - **Settings:** the data folder, slider preferences, auto-bake and help.
- **Status bar:** the triangle budget against the profile's target, triangles by part, texture memory, bones, blendshapes, the bake and the frame rate. When the bake is out of date, **Bake** bakes it; nothing bakes by itself unless you turn on **Settings → Baking → Bake automatically after each change**.
- **Menus** open on a click and stay open until you choose an item, click elsewhere or press Esc. With one open, pointing at another menu's name opens that one.

### The parts tree

The character as an outline:

| Row | What choosing it does |
| --- | --- |
| Body, Head & face | Shows all their sliders |
| A region (Nose, Mouth, Torso, …) | Shows only that region's sliders. A face region also turns the camera to the face. |
| Skin, Hair, Eyes, Eyebrows, Eyelashes, Teeth, Tongue | Opens their controls |
| Each worn garment (and its fur) | Opens its details: tint, grime, materials, studios |
| Look & lighting, Export | Open steps 05 and 06 |
| Favourite sliders | Shows every slider you marked with its heart |

Skin, hair, the face parts and each garment have an eye that hides them in the viewport, so you can work on what is underneath. It changes neither the character nor the export.

Clicking a part in the viewport chooses its row.

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
