# Face control: ARKit expressions, sculpting and photo assist

PRD Part 3, M20 (F25, F27, F33). The GNM face model (F26) is not part of this release: its weights could not be checked for commercial use (gate G0, DECISIONS D-159), so the measured face space, "Make plausible" and the photo shape fit to GNM wait for that.

## Expressions: the 52 ARKit face units

Characters now export the 52 ARKit face units as blendshapes, under the names Apple's ARKit uses: `eyeBlinkLeft`, `jawOpen`, `mouthSmileRight`, `tongueOut` and the rest. ARKit face capture and lip-sync tools in Unity drive them without remapping. Left and Right are the character's own sides, as in ARKit.

The units are Mika Suominen's faceunits01 shapes (CC0), shipped by Anny. They were sculpted on MakeHuman's own mesh and are made exactly symmetric when the app is built.

- **Export → Expressions (blendshapes)** lists them by group: brows, eyes, cheeks and nose, jaw, mouth, tongue. Tick what the export bakes; all 52 are ticked for a new character. The panel shows about how much memory the chosen shapes take in Unity.
- **Visemes** for lip-sync (`AA`, `EE`, `IH`, `OH`, `OU`, `FV`, `MBP`) are fixed mixes of the units. Tick them to export them too.
- **Names from before 0.25** (`blink_L`, `smile`, `browsUp` and so on) still exist, made from the units, so a character saved earlier exports the same names and an existing Unity project keeps working.
- **Poses**: Smile, Surprise, Fear, Disgust, Pain and Scream preview a mix of the units in the viewport.
- Eyes, lashes, teeth, tongue, clothes and hair move with the shapes. Blinks close the eye fully on every body shape (checked by ray tests).

In Unity, `PS2Expressions` sets a shape by name on every mesh that has it. Names match without regard to case, `PS2Expressions.ARKit` lists the 52 names, and `SetMany` applies a whole face-capture frame.

## Sculpt Studio

Open it from **Face → Sculpt the face…**, **Body → Sculpt the body…**, or the Asset Studio. Left drag sculpts; the right mouse button turns the view.

| Brush | What it does |
| --- | --- |
| Grab | Drags the surface along with the pointer |
| Smooth | Evens out bumps and creases |
| Inflate | Pushes the surface out (hold Alt to push it in) |
| Pinch | Pulls the surface together towards the brush centre |
| Flatten | Presses the surface towards a flat plane |
| Crease | Cuts a soft fold |
| Mask | Protects an area from the other brushes (Alt removes mask) |

- Brushes reach only what faces you, so a stroke on the cheek does not reach the ear behind it.
- **X symmetry** mirrors every stroke across the middle of the body. **Make symmetric** evens out a sculpt made without it.
- Each stroke is one undo step. The sculpt is saved inside the character and added after every slider, so you can still change sliders under it.
- Clothes, hair, the eyes and the skeleton follow the sculpt.
- **Save as slider** turns the sculpt into a slider in the library (a `.ps2target` file). It appears under **Your sliders** on the Face or Body tab of every character and goes from −1 to 1.

The body measurements and Fit body (M19) measure a sculpted body as it is. Fit body moves the sliders only, so it does not undo a sculpt.

## Photo assist

Face photos are in **Skin → Edit in Texture Studio**.

- **Leave hair and background out** (on by default). When a photo is placed, MediaPipe's Selfie Multiclass segmenter finds the face skin. Only that is projected: a fringe, glasses or the background are left to the base skin, with the usual soft edge. Colour matching also uses face skin only. The thumbnail shows what was found (white). The segmenter is small (16 MB), runs offline on the CPU, and its result is saved in the character, so it never runs again for that photo.
- **Use photo colours** sets the card hair's colour to the median colour of the hair in the photo, and adds a tone tint that takes the skin to the photo's face colour. Both stay editable, and it is one undo step.
- **Face points…** opens the 68-point editor: the points of the jaw, brows, nose, eyes and lips (the iBUG convention). It opens by itself when no face is found in a photo (a drawing, a dark or partly hidden face). Drag a point to move it; with **Mirror** on, its partner on the other side follows. Drag empty space to move all the points, and use the wheel to scale them. **Use these points** places the face with them.
- **Fit face shape to photo** is unchanged (the face sliders, not GNM).

## For developers

- Face units: `packages/core/src/expression/faceunits.ts`, the recipes in `packages/core/src/data/expression_map.json`, built by the asset compiler's `faceunits` stage (with the hm08 mirror table).
- Sculpt: `packages/core/src/sculpt` (the layer, user targets and brushes); the engine adds it through `Morpher.setOverlay`.
- Photo: the segmenter in `app/frontend/src/photo/segmenter.ts`; masks and hand-placed points in `packages/core/src/skin/photo` (`manual.ts`).
- Decisions: D-159 to D-163.
