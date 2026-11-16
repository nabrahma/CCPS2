# Body control: measurements, realistic people and crowds

PRD Part 3, M19 (F23 and F24). Everything here produces ordinary slider values, so a character stays editable with the sliders afterwards.

## Measurements

The Body tab shows the body's height, weight, BMI, chest, waist and hips at the top of **Measurements**. **All measurements** lists every one, grouped. Choose centimetres or inches; the choice is kept between sessions.

Measurements are taken on the rest shape, the way a tailor would:

- **Circumferences** follow a tape measure: the body is cut through and the tape is pulled round the cut, so it bridges hollows. Chest, underbust and hips are measured level with the floor, through the bust points and the fullest part of the seat. Limb values are the mean of left and right.
- **Lengths** such as nape to waist follow the skin. Arm length is shoulder to elbow to wrist. Inseam, waist to hip and the like are heights above the floor or another level.
- **Weight** is the body's volume at 985 kg per cubic metre.

Hover a measurement to see how it is taken. The rings come from MakeHuman's own measuring tool, so they match its measure sliders.

## Set measurements and Fit body

Open **Set measurements**, type the values you want (leave the rest empty), then press **Fit body**. The fit moves height, weight, muscle and proportions, MakeHuman's measure sliders and the torso, hip, neck, arm and leg scales. It leaves gender, age and the ethnic blend alone, unless you tick **Let gender change**.

- The fit is one step of undo (Ctrl+Z).
- A value the body cannot reach together with the others is shown in red, with the closest value it could give.
- The values you typed are saved with the character, so they are there when you open it again.

## Realistic

**Realistic** on the Body tab draws a person from real-population statistics (from Anny, calibrated on WHO data): an adult from 18 to 80, with height, weight, muscle and proportions spread as they are in people. On average men are 177 cm and women 161 cm, and a stock skin is not changed. On the Face tab it varies the face a little around the average and adds a small difference between left and right, since no real face is a mirror image.

Locked sliders keep their values; lock Gender, for example, to roll only women or only men. **Randomize** is still there for the old, wilder spread.

## Asymmetry, feet and chin

The Face tab's **Asymmetry** region (with **Every slider** on) has 27 left/right sliders for brows, cheeks, ears, eyes, jaw, mouth, nose, temples and the top of the head; the body has two more for the chest and trunk. Each moves one side only. The Arms and legs region gains foot length, width, height and position and lower-leg length per side, and the face gains a triangular chin. All are MakeHuman targets that had no slider before.

## Crowd Studio

In the Asset Studio, **Crowd Studio** makes many different people from one seed, for NPCs:

- **How many**, **Seed** and **Names** ("Villager 001", "Villager 002" and so on).
- **Face and detail variety**: how far faces and details stray from the average.
- Hairstyles and outfits are picked from the library (untick to keep the template's), and each person gets the stock skin for their age, heritage and sex.

The same seed always makes the same people, and person 7 is the same whether you make 10 or 100. Click a person to see them in the viewport (an unsaved character). **Save all** saves every one as a character; **Save and export all** also exports each to the Unity project, then reopens the character you had.

## For developers

- `packages/core/src/anthro`: landmarks, the measurements (`definitions.ts`, `measure.ts`), the float64 body evaluator and the fit (`solve.ts`).
- `packages/core/src/population`: the sampler and the crowd generator.
- `packages/core/src/math`: `dmath.ts` (engine-independent sin, cos, exp, log and the rest), `distributions.ts`, `linalg.ts`, `sha256.ts`. Generators must use these; a lint rule enforces it (PRD Part 3, 0.2).
- Build data: the `anthro` and `population` stages of the asset compiler; `pnpm golden:anny` writes the Anny parity fixture.
- Decisions: D-152 to D-158.
