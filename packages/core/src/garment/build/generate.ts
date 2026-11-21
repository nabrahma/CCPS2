/**
 * A pattern program and its design to a library garment (PRD Part 3, F30 and F31): built to the
 * character's measurements, draped on the character's body, remeshed to PS2 resolution with UVs from the
 * pattern and folds baked into a texture, then moved onto the reference body and bound like any garment
 * (M10), so fitting, weights, hidden body faces, looks and export treat it like the others. Other characters
 * wear it by its binding; Re-drape builds it again on their own body.
 */
import type { CoreAssets } from '../../assets';
import { importGarment, referenceBody, type ImportedGarment, type ImportSlot, type ReferenceBody } from '../../proxy/garment-import';
import type { GeneratorInfo } from '../../proxy/proxy';
import type { RgbaImage } from '../../skin/image';
import { bodySurface, bodySurfaceAt, editMeshToRaw, moveToBody, type EditMesh } from '../../wardrobe/studio';
import { newLook, type GarmentLook } from '../../wardrobe/look';
import type { BuiltPattern } from '../pattern/build';
import { buildProgram, patternProgram } from '../pattern/programs/registry';
import type { Design } from '../pattern/programs/base';
import '../pattern/programs/ps2cc-programs';
import type { ShellBody } from '../shell/body';
import type { GarmentClass } from '../shell/build';
import { drapeSteps, type DrapeOptions, type DrapeResult } from '../drape/drape';
import type { ClothKind } from '../drape/materials';
import { bakeFolds, type FoldBake } from './folds';
import { buildCoarse, type CoarseGarment, type DetailProfile } from './coarse';

/** Bump when draping or building changes what the same design and body give. */
export const DRAPE_GENERATOR_VERSION = 1;

export interface ProgramAsset {
  slot: ImportSlot;
  garmentClass: GarmentClass;
  cloth: ClothKind;
  /** Rib panels (bands, cuffs, knitted collars) and their cloth. */
  rib?: { match: RegExp; cloth: ClothKind };
  /** The default look: a library material and tint, and the rib's. */
  material: string;
  tint: [number, number, number];
  ribMaterial?: string;
  category: string;
}

const M = (id: string) => `ps2cc:materials/${id}`;

/** What each program makes: slot, garment class (section 5.0 ease), cloth and default look. */
export const PROGRAM_ASSETS: Record<string, ProgramAsset> = {
  FittedShirt: { slot: 'top', garmentClass: 'shirt', cloth: 'cotton', material: M('cotton_jersey'), tint: [0.82, 0.82, 0.78], category: 'tops' },
  Shirt: { slot: 'top', garmentClass: 'shirt', cloth: 'cotton', material: M('cotton_jersey'), tint: [0.78, 0.8, 0.84], category: 'tops' },
  Pants: { slot: 'bottom', garmentClass: 'trousers', cloth: 'denim', material: M('denim'), tint: [0.8, 0.82, 0.9], category: 'bottoms' },
  SkirtCircle: { slot: 'bottom', garmentClass: 'trousers', cloth: 'cotton', material: M('cotton_jersey'), tint: [0.55, 0.3, 0.3], category: 'bottoms' },
  AsymmSkirtCircle: { slot: 'bottom', garmentClass: 'trousers', cloth: 'cotton', material: M('cotton_jersey'), tint: [0.4, 0.45, 0.6], category: 'bottoms' },
  GodetSkirt: { slot: 'bottom', garmentClass: 'trousers', cloth: 'cotton', material: M('cotton_jersey'), tint: [0.35, 0.4, 0.35], category: 'bottoms' },
  Skirt2: { slot: 'bottom', garmentClass: 'trousers', cloth: 'cotton', material: M('cotton_jersey'), tint: [0.5, 0.45, 0.4], category: 'bottoms' },
  SkirtManyPanels: { slot: 'bottom', garmentClass: 'trousers', cloth: 'cotton', material: M('cotton_jersey'), tint: [0.3, 0.32, 0.4], category: 'bottoms' },
  PencilSkirt: { slot: 'bottom', garmentClass: 'trousers', cloth: 'wool', material: M('wool_herringbone'), tint: [0.45, 0.45, 0.48], category: 'bottoms' },
  SkirtLevels: { slot: 'bottom', garmentClass: 'trousers', cloth: 'cotton', material: M('cotton_jersey'), tint: [0.6, 0.55, 0.45], category: 'bottoms' },
  StraightWB: { slot: 'accessory', garmentClass: 'trousers', cloth: 'canvas', material: M('canvas'), tint: [0.4, 0.35, 0.3], category: 'accessories' },
  FittedWB: { slot: 'accessory', garmentClass: 'trousers', cloth: 'canvas', material: M('canvas'), tint: [0.4, 0.35, 0.3], category: 'accessories' },
  MetaGarment: { slot: 'full', garmentClass: 'shirt', cloth: 'cotton', material: M('cotton_jersey'), tint: [0.62, 0.6, 0.7], category: 'full' },
  Bomber: { slot: 'outer', garmentClass: 'jacket', cloth: 'nylon', rib: { match: /hem|cuff|collar/, cloth: 'knit' }, material: M('nylon_ripstop'), tint: [0.42, 0.45, 0.36], ribMaterial: M('knit'), category: 'outerwear' },
  Coat: { slot: 'outer', garmentClass: 'coat', cloth: 'wool', material: M('wool_herringbone'), tint: [0.45, 0.4, 0.36], category: 'outerwear' },
  UtilityVest: { slot: 'outer', garmentClass: 'jacket', cloth: 'canvas', rib: { match: /hem/, cloth: 'knit' }, material: M('canvas'), tint: [0.55, 0.5, 0.38], ribMaterial: M('knit'), category: 'outerwear' },
  Hoodie: { slot: 'top', garmentClass: 'sweater', cloth: 'jersey', rib: { match: /hem|cuff/, cloth: 'knit' }, material: M('cotton_jersey'), tint: [0.5, 0.52, 0.56], ribMaterial: M('knit'), category: 'tops' },
  WorkShirt: { slot: 'top', garmentClass: 'shirt', cloth: 'cotton', material: M('canvas'), tint: [0.45, 0.5, 0.6], category: 'tops' },
};

export function programAsset(id: string): ProgramAsset {
  return PROGRAM_ASSETS[id] ?? { slot: 'top', garmentClass: 'shirt', cloth: 'cotton', material: M('cotton_jersey'), tint: [0.8, 0.8, 0.8], category: 'tops' };
}

/** The cloth of a panel of a program. */
export function clothOf(programId: string, panel: string): ClothKind {
  const a = programAsset(programId);
  return a.rib && a.rib.match.test(panel) ? a.rib.cloth : a.cloth;
}

export interface PatternGarmentInput {
  program: string;
  design: Design;
  /** GarmentCode body measurements (cm) the pattern is made to. */
  measurements: Readonly<Record<string, number>>;
  /** The body it is draped on (the character's), and that body's hm08 positions. */
  body: ShellBody;
  bodyPositions: Float32Array;
  profile?: DetailProfile;
  name?: string;
  drape?: DrapeOptions;
  /** A clock (ms) for the timings; generators do not read one themselves. */
  clock?: () => number;
  /** Fold texture size (texels across). */
  foldSize?: number;
}

export interface PatternMesh {
  built: BuiltPattern;
  drape: DrapeResult;
  coarse: CoarseGarment;
  folds: FoldBake;
  asset: ProgramAsset;
  timings: { build: number; drape: number; coarse: number; folds: number };
}

/** Build, drape, remesh and bake (no binding): what the Designer shows after Drape and what tests check. */
export function drapeProgram(input: PatternGarmentInput): PatternMesh | null {
  const steps = drapeProgramSteps(input);
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

/** The same, one drape frame at a time (the stage and progress yielded between frames). */
export function* drapeProgramSteps(input: PatternGarmentInput): Generator<{ progress: number; stage: string }, PatternMesh | null> {
  const clock = input.clock ?? (() => 0);
  const t0 = clock();
  const built = buildProgram(input.program, input.design, input.measurements);
  const t1 = clock();
  const asset = programAsset(input.program);
  const steps = drapeSteps(built, input.body, (panel) => clothOf(input.program, panel), { clock, ...input.drape });
  let drape: DrapeResult;
  for (;;) {
    const r = steps.next();
    if (r.done) {
      drape = r.value;
      break;
    }
    yield { progress: r.value.progress * 0.9, stage: r.value.time < 0.3 ? 'Sewing' : 'Settling' };
  }
  const t2 = clock();
  if (drape.cancelled) return null;
  yield { progress: 0.92, stage: 'Building the game mesh' };
  const coarse = buildCoarse(built, drape, input.body, { slot: asset.slot, garmentClass: asset.garmentClass, profile: input.profile ?? 'classic' });
  const t3 = clock();
  yield { progress: 0.96, stage: 'Baking the folds' };
  const folds = bakeFolds(drape, input.body, coarse.islands, input.foldSize ?? 512);
  const t4 = clock();
  return { built, drape, coarse, folds, asset, timings: { build: t1 - t0, drape: t2 - t1, coarse: t3 - t2, folds: t4 - t3 } };
}

/** The default look of a program's garment: its material, the rib panels in knit. */
export function programLook(programId: string, coarse: CoarseGarment): GarmentLook {
  const a = programAsset(programId);
  const look = newLook(a.material);
  look.zones[0]!.tint = [...a.tint];
  look.folds.strength = 0;
  if (a.rib && a.ribMaterial) {
    const ribs = coarse.islands.map((isl, i) => (a.rib!.match.test(isl.panel) ? i : -1)).filter((i) => i >= 0);
    if (ribs.length) look.zones.push({ id: 'z2', name: 'Rib', islands: ribs, material: a.ribMaterial, tint: [a.tint[0] * 0.8, a.tint[1] * 0.8, a.tint[2] * 0.8], scale: 1, rotation: 0, wear: 0 });
  }
  return look;
}

const refBodies = new WeakMap<CoreAssets, ReferenceBody>();

export interface PatternGarment extends PatternMesh {
  garment: ImportedGarment;
}

/** The whole pipeline: a garment bound to the reference body, recording how it was made. */
export async function generatePatternGarment(assets: CoreAssets, input: PatternGarmentInput): Promise<PatternGarment | null> {
  const mesh = drapeProgram(input);
  return mesh ? bindPatternGarment(assets, mesh, input) : null;
}

/** A draped and built design moved from the body it was draped on to the reference body and bound (M10). */
export async function bindPatternGarment(assets: CoreAssets, mesh: PatternMesh, input: PatternGarmentInput): Promise<PatternGarment> {
  const program = patternProgram(input.program);
  let ref = refBodies.get(assets);
  if (!ref) refBodies.set(assets, (ref = referenceBody(assets)));
  const raw = mesh.coarse.raw;
  const edit: EditMesh = { positions: raw.positions, uvs: raw.uvs, faceVerts: raw.faceVerts, faceUvs: raw.faceUvs, uvRoom: false, parts: [] };
  const moved = moveToBody(edit, bodySurfaceAt(assets, input.bodyPositions), bodySurface(ref));
  const garment = await importGarment(editMeshToRaw(moved), { name: input.name ?? program.label, slot: mesh.asset.slot, body: ref, coverageGap: 0.03 });
  const generator: GeneratorInfo = {
    kind: 'pattern',
    template: input.program,
    params: {},
    version: DRAPE_GENERATOR_VERSION,
    pattern: { design: JSON.parse(JSON.stringify(input.design)), body: { ...input.measurements }, profile: input.profile ?? 'classic' },
  };
  garment.meta.generator = generator;
  garment.meta.tags = ['generated', 'pattern', mesh.asset.category];
  garment.meta.defaults = { look: programLook(input.program, mesh.coarse) };
  return { ...mesh, garment };
}

/** The fold bake as a texture image for saving (the caller stores it and sets `material.foldTexture`). */
export function foldImage(m: PatternMesh): RgbaImage {
  return m.folds.image;
}
