# Pattern programs (PRD Part 3, F29)

Sewing patterns written as code. A program turns a design (parameters) and a body (measurements) into flat
panels with seams; M23 drapes them and turns them into PS2 garments. Shell garments (F28) are documented in
`garment-generators.md`.

## What is here

`packages/core/src/garment/pattern/`:

| Part | What it is |
| --- | --- |
| `edge.ts`, `edge-factory.ts`, `interface.ts`, `panel.ts`, `operators.ts` | A TypeScript port of GarmentCode's pygarment library (MIT, commit `d4496299`): edges (line, circular arc, quadratic and cubic Bezier), edge sequences, panels with a 3D placement, components, interfaces, stitching rules that subdivide edges until both sides match, and the operators (cut a shape into a corner or an edge, darts, distribute copies, even sleeve openings, bend a curve to end tangents). |
| `programs/*.ts` | GarmentCode's garment programs, ported: fitted and loose shirts with sleeves, armholes, seven necklines and turtle, lapel and hood collars; trousers; circle, asymmetric, two-panel, many-panel, pencil, tiered and godet skirts; straight and fitted waistbands; cuffs; `MetaGarment` (top + waistband + bottoms). |
| `programs/ps2cc.ts`, `programs/ps2cc-programs.ts` | This project's programs: bomber / blouson jacket, coat, utility vest, hoodie, work shirt, and the cargo pocket component (D-175). |
| `num/` | The numerics GarmentCode relies on, ported so results agree to rounding: svgpathtools curves, QUADPACK quadrature, SciPy rotations, BFGS and L-BFGS-B (D-172). |
| `design.ts`, `data/default-design.json` | GarmentCode's design schema (its `default.yaml` as JSON, ranges kept) and its random sampler on our seeded generator. |
| `spec.ts` | The pattern specification (GarmentCode's JSON: panels with vertices, edges, curvature, translation and rotation, plus stitches), validation, canonical bytes and hashes. |
| `svg.ts` | The SVG export and the Designer's 2D pattern view. |
| `ps2pattern.ts` | The `.ps2pattern` file. |

Everything uses `dmath` and fixed operation orders, so the same inputs give the same bytes in Node and in the app
(hashes `pattern:<program>` in `determinism.json`).

## Using it

```ts
import { buildProgram, programDefaultDesign, randomProgramDesign, validateBuilt, patternSvg, garmentCodeBody } from '@ps2cc/core';

const body = garmentCodeBody(assets.anthro.measure(positions)); // GarmentCode's 26 measurement keys (F24)
const design = programDefaultDesign('Bomber');                  // or randomProgramDesign('Bomber', rng, body).design
const built = buildProgram('Bomber', design, body);             // { spec, gathered, seam, attachments, garment }
const issues = validateBuilt(built);                            // [] when every check passes
const svg = patternSvg(built.spec, { title: 'Bomber', measurements: body });
```

Programs: `FittedShirt`, `Shirt`, `Pants`, `SkirtCircle`, `AsymmSkirtCircle`, `GodetSkirt`, `Skirt2`,
`SkirtManyPanels`, `PencilSkirt`, `SkirtLevels`, `StraightWB`, `FittedWB` (GarmentCode) and `Bomber`, `Coat`,
`UtilityVest`, `Hoodie`, `WorkShirt` (this project). Each design is a nested object of `{ v, range, type,
default_prob }` leaves; a program reads its own group (`bomber`, `pants`, and so on) plus `sleeve` and `collar` for
tops.

In the app: Asset Studio, Garment Designer, **Pattern** tab. Pick a program, change parameters (the panel is built
from the schema), press Random design (seeded), and see the pattern made to the current character, drawn over the
viewport. Export SVG saves the drawing; Save .ps2pattern saves what rebuilds it.

## Validation (D-174)

A built pattern validates when:

- every panel is one closed loop;
- no panel self-intersects;
- sewing is manifold under GarmentCode's stitch orientation: no edge is stitched twice, and the free edges form
  closed hem and opening loops;
- every seam that is not gathered has sides within 1% in length (1 mm on short seams);
- every attached panel (pocket, flap, yoke) lies on its host.

`randomProgramDesign` draws like GarmentCode's own sampler: it resamples until the design passes GarmentCode's
known-invalid combinations check, builds, fits the floor length and has no self-intersecting panel.

This project's programs pass every rule on every random design. GarmentCode's programs are structurally sound, but
some of their seams are eased by design (a shirt's front and back side seams can be up to 9% apart, left for the
cloth to absorb), and the fitted waistband folds over on bodies whose waist is wider than their hips. Those are
counted in `docs/milestones/M22/validation.txt`, not changed, because changing them would break the oracle parity.

## The oracle (D-173)

`tools/asset-compiler/garmentcode_oracle.py` runs the pinned GarmentCode as the test oracle. It needs an isolated
environment (never the system Python):

```sh
python -m venv tools/asset-compiler/.cache/venv-garmentcode
tools/asset-compiler/.cache/venv-garmentcode/Scripts/python.exe -m pip install numpy==1.26.4 scipy==1.13.1 svgpathtools==1.6.1 svgwrite==1.4.3 pyyaml==6.0.2
PY=tools/asset-compiler/.cache/venv-garmentcode/Scripts/python.exe
F=packages/core/test/fixtures/garmentcode
PS2CC_WRITE_GC_BODIES=1 pnpm --filter @ps2cc/core exec vitest run test/garment-pattern-bodies.test.ts   # our 12 bodies
$PY -I tools/asset-compiler/garmentcode_oracle.py numerics $F/numerics.json.gz
$PY -I tools/asset-compiler/garmentcode_oracle.py patterns $F/bodies.json $F/patterns.json.gz 200
OPENBLAS_CORETYPE=Nehalem $PY -I tools/asset-compiler/garmentcode_oracle.py patterns $F/bodies.json /tmp/nehalem.json.gz 200
OPENBLAS_CORETYPE=Sandybridge $PY -I tools/asset-compiler/garmentcode_oracle.py patterns $F/bodies.json /tmp/sandy.json.gz 200
$PY -I tools/asset-compiler/garmentcode_oracle.py stability $F/patterns.json.gz /tmp/nehalem.json.gz /tmp/sandy.json.gz
```

The fixtures are committed (Git LFS), so the tests run without Python:

- `garment-pattern-numerics.test.ts`: curves, rotations and the optimisers against svgpathtools and SciPy.
- `garment-pattern-oracle.test.ts`: 200 designs per program against GarmentCode.

GarmentCode does not reproduce itself across BLAS kernels on about a third of its tops, because its sleeve and hood
curves come from an optimisation stopped by rounding noise. The oracle marks those designs unstable. The test
requires:

- the port fails exactly where GarmentCode fails;
- no stable design differs in structure;
- at least 99.8% of stable designs match within 1e-6 relative.

At the time of writing, 2,415 of 2,418 stable designs match. The other three differ only in a sleeve or hood
curve.

## Drape and garment asset (F30, F31)

`packages/core/src/garment/drape/` (the solver) and `packages/core/src/garment/build/` (pattern to PS2 garment).

| Part | What it is |
| --- | --- |
| `triangulate.ts`, `discretise.ts` | Each panel triangulated in 2D (constrained Delaunay, hexagonal lattice inside) at 1.5 cm; both sides of every stitch sampled alike, so seam points pair up. |
| `place.ts` | Where panels start: wrapped round their body part 3 cm out, anchored at the side neck point (tops) or the waist (trousers, skirts); small panels laid against the panel they are sewn to (D-177). |
| `xpbd.ts`, `sdf.ts`, `collide.ts` | The XPBD solver (Small Steps), the body's signed distance field and the colliders (D-176). |
| `drape.ts` | The drape: sew (0.3 s, no gravity or friction), weld closed seams, settle (to 2 s, on to 4 s while moving), polish, measure. `drapeSteps` yields after every frame. |
| `materials.ts` | Cloth presets per M15 material kind: density, stretch, area and bending compliance, friction. |
| `build/coarse.ts` | The game mesh: coarse remesh at the profile's edge (within the slot budget), lifted from the drape, seams welded, outward, pushed to the class's ease, rims, attachments, pattern UVs (D-179). |
| `build/folds.ts` | The fold bake into the garment's UV layout. |
| `build/generate.ts` | Program, design and body to a bound library garment; what each program makes (slot, class, cloth, look). |

How a drape goes:

1. **Sew.** Seam constraints stiffen over 0.3 s from very soft to rigid. No gravity and no friction yet, and heavy damping, so the panels slide into place over the body.
2. **Weld.** Once every seam is within 1 mm (or 0.5 s later), sewn points within 1 cm become one particle; the rest are tried again every 15 frames, and once more after the polish.
3. **Settle.** Gravity, friction from the cloth, light damping, until 2 s; on to 4 s while anything moves faster than 1 mm/s. Trousers and skirts are held at the waist (a floor under their top edge's points).
4. **Polish.** 40 static passes over stretched edges, seams and contacts against the exact body, then every particle cleared by the 2 mm thickness.

Contacts: the body's distance field gives a plane per particle per frame (looked up again when a particle moves far within a frame); the field's normal turns smoothly through creases, where the nearest triangle's would flip.

Then the garment (F31): the coarse mesh at Classic 4 cm, Enhanced 3 cm or Hero 2 cm (longer when the slot's budget needs it), every coarse point where the same pattern point went in the drape, seams welded, pushed out to the class's minimum ease (5.0), 5 smoothing passes, rims, pockets and flaps on top, UVs from the pattern, and the fold bake (occlusion and fold light from the fine drape) as the garment's fold texture, multiplied into whatever look it wears. It is then moved to the reference body and bound like any garment: every character wears it by its binding, and **Re-drape on this body** (Clothes) drapes it again on another character.

### In the Garment Designer (Pattern tab)

- **2D pattern**, **3D** (the panels placed around the body, or the draped garment), **Character**.
- **Drape**: a few seconds, with progress and Cancel; the result is worn as a preview with its numbers (time, seams, stretch, triangles).
- **Save to Wardrobe** or **Keep on this character**; the garment records its program, design, measurements and detail profile. Opened again from Clothes, it comes back to this tab.

### Measuring a drape

`test/m23.test.ts` (D-178): seam gap after welding under 1 mm; no particle deeper than 1 mm in the body; woven cloth's stretch along its threads, area-weighted mean under 3%; the coarse garment open only at hems and openings; texel density within 5% across panels; a fold bake with a shade deviation over 0.015. `node scripts/m23-accept.mjs` runs 50 designs of every program on Mara and Cole (`docs/milestones/M23/drape.txt`).

## `.ps2pattern`

Canonical JSON (sorted keys, shortest round-trip numbers):

```json
{"attachments":[...],"body":{...},"design":{...},"format":"ps2pattern","generator":1,"hash":"…","pattern":{"panels":{...},"stitches":[...]},"program":"Bomber","version":1}
```

`rebuildPs2Pattern` builds again from `program`, `design` and `body`; the bytes must equal the stored `pattern`.
`PATTERN_GENERATOR_VERSION` goes up when a program change alters the patterns it builds.

## Tests

| Test | What it checks |
| --- | --- |
| `test/garment-pattern-numerics.test.ts` | Curves, quadrature, rotations, optimiser paths against the Python oracle |
| `test/garment-pattern-oracle.test.ts` | GarmentCode parity, 200 designs per program (`docs/milestones/M22/oracle.txt`) |
| `test/m22.test.ts` | Validation on random designs: 40 per program by default, 500 with `PS2CC_M22_DESIGNS=500` (`validation.txt`). Also the `.ps2pattern` byte-identical rebuild and SVG labels |
| `app/frontend/e2e/m22.spec.ts` | The Pattern tab, Random design, the pattern view, and the exported SVG opened in the browser |
| `test/garment-drape-solver.test.ts` | The solver: a pinned sheet's energy falls every frame as it settles, a cylinder skirt stays outside a cylinder body; triangulation and seam sampling |
| `test/m23.test.ts`, `scripts/m23-accept.mjs` | Drapes and garments of every program on the benchmark bodies (`docs/milestones/M23/drape.txt`) |
| `app/frontend/e2e/m23.spec.ts` | Placed panels, Drape with progress and Cancel, Save to Wardrobe, opening again, Re-drape |
