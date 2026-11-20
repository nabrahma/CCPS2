/**
 * The pattern programs a user can pick (F29, F32 Pattern tab): GarmentCode's garments as ported, and this
 * project's own programs. Each program is a GarmentCode design (one schema, design_params/default.yaml) with the
 * garment-type choices fixed; the project's own programs add their own design groups.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Rng } from '../../../random';
import { assertParamCombinations, defaultDesign, randomizeDesign } from '../design';
import { buildMetaGarment, type BuiltPattern } from '../build';
import type { Component } from '../panel';
import { bodyParameters, type Design } from './base';

export type ProgramOrigin = 'garmentcode' | 'ps2cc';

export interface PatternProgram {
  id: string;
  label: string;
  origin: ProgramOrigin;
  /** Garment-type choices this program fixes (GarmentCode design.meta). */
  meta: { upper?: string | null; bottom?: string | null; wb?: string | null };
  /** Design groups the program reads (shown in the parameter panel). */
  groups: string[];
  /** Build the program's garment (default: GarmentCode's MetaGarment). */
  build?: (name: string, design: Design, measurements: Readonly<Record<string, number>>) => BuiltPattern;
  /** The program's own default design (default: GarmentCode's defaults with `meta`). */
  defaultDesign?: () => Design;
  /** Values the program fixes after sampling. */
  fix?: (d: Design) => void;
}

const UPPER_GROUPS = ['shirt', 'collar', 'sleeve', 'left'];

export const GARMENTCODE_PROGRAMS: PatternProgram[] = [
  { id: 'FittedShirt', label: 'Fitted shirt (bodice)', origin: 'garmentcode', meta: { upper: 'FittedShirt', bottom: null, wb: null }, groups: UPPER_GROUPS },
  { id: 'Shirt', label: 'Shirt / T-shirt', origin: 'garmentcode', meta: { upper: 'Shirt', bottom: null, wb: null }, groups: UPPER_GROUPS },
  { id: 'Pants', label: 'Trousers', origin: 'garmentcode', meta: { upper: null, bottom: 'Pants' }, groups: ['pants', 'waistband'] },
  { id: 'SkirtCircle', label: 'Circle skirt', origin: 'garmentcode', meta: { upper: null, bottom: 'SkirtCircle' }, groups: ['flare-skirt', 'waistband'] },
  { id: 'AsymmSkirtCircle', label: 'Asymmetric circle skirt', origin: 'garmentcode', meta: { upper: null, bottom: 'AsymmSkirtCircle' }, groups: ['flare-skirt', 'waistband'] },
  { id: 'GodetSkirt', label: 'Godet skirt', origin: 'garmentcode', meta: { upper: null, bottom: 'GodetSkirt' }, groups: ['godet-skirt', 'skirt', 'pencil-skirt', 'waistband'] },
  { id: 'Skirt2', label: 'Two-panel skirt', origin: 'garmentcode', meta: { upper: null, bottom: 'Skirt2' }, groups: ['skirt', 'waistband'] },
  { id: 'SkirtManyPanels', label: 'Panelled skirt', origin: 'garmentcode', meta: { upper: null, bottom: 'SkirtManyPanels' }, groups: ['flare-skirt', 'waistband'] },
  { id: 'PencilSkirt', label: 'Pencil skirt', origin: 'garmentcode', meta: { upper: null, bottom: 'PencilSkirt' }, groups: ['pencil-skirt', 'waistband'] },
  { id: 'SkirtLevels', label: 'Tiered skirt', origin: 'garmentcode', meta: { upper: null, bottom: 'SkirtLevels' }, groups: ['levels-skirt', 'skirt', 'flare-skirt', 'pencil-skirt', 'waistband'] },
  { id: 'StraightWB', label: 'Straight waistband', origin: 'garmentcode', meta: { upper: null, bottom: null, wb: 'StraightWB' }, groups: ['waistband'] },
  { id: 'FittedWB', label: 'Fitted waistband (yoke)', origin: 'garmentcode', meta: { upper: null, bottom: null, wb: 'FittedWB' }, groups: ['waistband'] },
];

const REGISTRY = new Map<string, PatternProgram>(GARMENTCODE_PROGRAMS.map((p) => [p.id, p]));

export function registerProgram(p: PatternProgram): void {
  REGISTRY.set(p.id, p);
}

export function patternPrograms(): PatternProgram[] {
  return [...REGISTRY.values()];
}

export function patternProgram(id: string): PatternProgram {
  const p = REGISTRY.get(id);
  if (!p) throw new Error(`unknown pattern program '${id}'`);
  return p;
}

/** The program's default design: GarmentCode's defaults with the program's garment choices. */
export function programDefaultDesign(id: string): Design {
  const p = patternProgram(id);
  if (p.defaultDesign) return p.defaultDesign();
  const d = defaultDesign();
  applyMeta(d, p);
  return d;
}

function applyMeta(d: any, p: PatternProgram): void {
  for (const [k, v] of Object.entries(p.meta)) d.meta[k].v = v;
}

export function buildProgram(id: string, design: Design, measurements: Readonly<Record<string, number>>, name = id): BuiltPattern {
  const p = patternProgram(id);
  return p.build ? p.build(name, design, measurements) : buildMetaGarment(name, design, measurements);
}

/**
 * A random design of the program, drawn the way GarmentCode's pattern_sampler draws (resampling until the
 * design passes the known-invalid combinations check, builds, fits the floor length and has no self-intersecting
 * panel), at most `tries` draws. Returns the design and the number of draws it took.
 */
export function randomProgramDesign(id: string, rng: Rng, measurements: Readonly<Record<string, number>>, tries = 100): { design: Design; draws: number } {
  const p = patternProgram(id);
  const base = p.defaultDesign ? p.defaultDesign() : defaultDesign();
  let last: Design = base;
  for (let k = 1; k <= tries; k++) {
    const d = randomizeDesign(base, rng);
    applyMeta(d, p);
    p.fix?.(d);
    last = d;
    try {
      if (p.meta.upper || p.meta.bottom) assertParamCombinations(d);
      const built = buildProgram(id, d, measurements);
      const g = built.garment as Component & { assertTotalLength?: () => void };
      g.assertTotalLength?.();
      if (built.garment.isSelfIntersecting()) continue;
      return { design: d, draws: k };
    } catch {
      continue;
    }
  }
  return { design: last, draws: tries };
}

export { bodyParameters };
