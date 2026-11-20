/**
 * Design parameters (GarmentCode's design_params/default.yaml as JSON, with its value ranges) and random designs.
 *
 * `randomizeDesign` is GarmentCode's DesignSampler.randomize with our seeded Rng in place of Python's `random`:
 * each leaf keeps its default with probability `default_prob`, otherwise takes a uniform value in its range
 * (excluding the default when a default probability is given). `randomProgramDesign` repeats sampling, as
 * GarmentCode's pattern_sampler does, until the design passes the known-invalid combinations check, builds,
 * fits within the body's floor length and has no self-intersecting panel.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Rng } from '../../random';
import DEFAULT_DESIGN_JSON from './data/default-design.json';
import { closeEnough, deepcopy } from './utils';

export type DesignLeaf = { v: unknown; range: unknown[]; type: string; default_prob?: number };
export type DesignTree = { [key: string]: DesignTree | DesignLeaf };

/** GarmentCode's default design (every parameter at its default value). */
export function defaultDesign(): any {
  return deepcopy((DEFAULT_DESIGN_JSON as { design: any }).design);
}

const isLeaf = (n: unknown): n is DesignLeaf => typeof n === 'object' && n !== null && 'v' in n;

/** DesignSampler.randomize. */
export function randomizeDesign(base: any, rng: Rng): any {
  const out = deepcopy(base);
  const walk = (node: any, orig: any): void => {
    for (const key of Object.keys(node)) {
      if (isLeaf(node[key])) randomizeValue(node[key], orig[key], rng);
      else walk(node[key], orig[key]);
    }
  };
  walk(out, base);
  return out;
}

function randomizeValue(leaf: any, orig: any, rng: Rng): void {
  const range: unknown[] = leaf.range;
  const pType: string = leaf.type;
  const defProb: number | undefined = leaf.default_prob;
  const defValue = orig.v;
  if (defProb !== undefined && rng.next() < defProb) {
    leaf.v = defValue;
    return;
  }
  let nv: unknown;
  if (pType.includes('select') || pType === 'bool' || pType.includes('file')) {
    if (pType === 'select_null' && !range.includes(null)) range.push(null);
    if (defProb !== undefined) {
      const i = range.findIndex((r) => r === defValue);
      if (i < 0) throw Object.assign(new Error('ValueError: list.remove(x): x not in list'), { pyType: 'ValueError' });
      range.splice(i, 1);
    }
    nv = rng.pick(range);
  } else if (pType === 'int') {
    const [a, b] = range as [number, number];
    do nv = rng.int(a, b);
    while (defProb !== undefined && nv === defValue);
  } else if (pType === 'float') {
    const [a, b] = range as [number, number];
    do nv = rng.range(a, b);
    while (defProb !== undefined && closeEnough(nv as number, defValue as number));
  }
  leaf.v = nv;
}

/** pattern_sampler.assert_param_combinations: known-invalid combinations (throws). */
export function assertParamCombinations(design: any, filterBelts = true): void {
  const upper = design.meta.upper.v;
  const lower = design.meta.bottom.v;
  const belt = design.meta.wb.v;
  if (upper) return;
  if (!lower) {
    if (filterBelts || !belt) throw Object.assign(new Error('ERROR::IncorrectParams::Empty pattern or singular belt'), { pyType: 'IncorrectElementConfiguration' });
    return;
  }
  if (lower === 'Pants' || lower === 'PencilSkirt') return;
  if (lower === 'Skirt2' || (lower === 'GodetSkirt' && design['godet-skirt'].base.v === 'Skirt2') || (lower === 'SkirtLevels' && design['levels-skirt'].base.v === 'Skirt2')) {
    if (design.skirt.ruffle.v > 1 && (!belt || design.waistband.waist.v > 1)) throw Object.assign(new Error('ERROR::IncorrectParams::Skirt2 ruffles + belt'), { pyType: 'IncorrectElementConfiguration' });
  }
  const flare = ['SkirtCircle', 'AsymmSkirtCircle', 'SkirtManyPanels'];
  if (flare.includes(lower) || (lower === 'SkirtLevels' && flare.includes(design['levels-skirt'].base.v))) {
    if (!belt || design.waistband.waist.v > 1 || design.waistband.width.v <= 0.25) {
      const lp = design[lower === 'SkirtLevels' ? 'levels-skirt' : 'flare-skirt'].length.v;
      if (lp > 0.5 || design['flare-skirt'].suns.v > 0.75) throw Object.assign(new Error('ERROR::IncorrectParams::Flare skirts + belt'), { pyType: 'IncorrectElementConfiguration' });
    }
  }
}

/** Walk the leaves of a design (path, leaf). */
export function designLeaves(design: any, path: string[] = []): [string[], DesignLeaf][] {
  const out: [string[], DesignLeaf][] = [];
  for (const key of Object.keys(design)) {
    const n = design[key];
    if (isLeaf(n)) out.push([[...path, key], n]);
    else if (n && typeof n === 'object') out.push(...designLeaves(n, [...path, key]));
  }
  return out;
}

export function getLeaf(design: any, path: readonly string[]): DesignLeaf | undefined {
  let n = design;
  for (const k of path) {
    if (!n || typeof n !== 'object') return undefined;
    n = n[k];
  }
  return isLeaf(n) ? n : undefined;
}

/** A design with only the given values changed (path -> value); unknown paths are ignored. */
export function withValues(design: any, values: Readonly<Record<string, unknown>>): any {
  const out = deepcopy(design);
  for (const [p, v] of Object.entries(values)) {
    const leaf = getLeaf(out, p.split('.'));
    if (leaf) leaf.v = v;
  }
  return out;
}
