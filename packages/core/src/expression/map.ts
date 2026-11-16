/**
 * The expression map (PRD F8, rebuilt by PRD Part 3 F25): which face units
 * make each exported blendshape. Authored data in `data/expression_map.json`.
 *
 * - The 52 ARKit units, each exported under its own name.
 * - Visemes: fixed recipes of units.
 * - Classic: the names exported before 0.25.0 (blink_L, smile, ...), kept as
 *   recipes so existing Unity projects keep working.
 * - Presets: preview poses (smile, fear, ...) on the units; not exported.
 */
import mapJson from '../data/expression_map.json';
import { ARKIT_UNITS, isArkitUnit } from './faceunits';

export type ExpressionGroup = 'brows' | 'eyes' | 'cheeks' | 'jaw' | 'mouth' | 'tongue' | 'visemes' | 'classic';

export interface ExpressionDef {
  name: string;
  label: string;
  group: ExpressionGroup;
  /** Face unit and weight. */
  units: [string, number][];
  /** Blinks: raise this unit's weight per character until the eye closes (expression/blink.ts). */
  calibrate?: { unit: string; eye: 'L' | 'R'; max: number; step: number };
}

export interface ExpressionPreset {
  name: string;
  label: string;
  /** Face unit weights. */
  weights: Record<string, number>;
}

export interface ExpressionMap {
  format: 'ps2cc.expressionmap/2';
  expressions: ExpressionDef[];
  presets: ExpressionPreset[];
}

export const EXPRESSION_MAP = mapJson as unknown as ExpressionMap;

/** Every expression the map defines, in panel order. */
export function expressionNames(map: ExpressionMap = EXPRESSION_MAP): string[] {
  return map.expressions.map((e) => e.name);
}

export function expressionDef(name: string, map: ExpressionMap = EXPRESSION_MAP): ExpressionDef | undefined {
  return map.expressions.find((e) => e.name === name);
}

/** The blendshapes a new character exports: the 52 ARKit units. */
export const ARKIT_EXPRESSIONS: readonly string[] = ARKIT_UNITS;

/** Visemes by name, as face-unit recipes. */
export function visemeNames(map: ExpressionMap = EXPRESSION_MAP): string[] {
  return map.expressions.filter((e) => e.group === 'visemes').map((e) => e.name);
}

/** The preview weights of a preset as blendshape weights (each ARKit unit is a blendshape of its own name). */
export function presetWeights(name: string, map: ExpressionMap = EXPRESSION_MAP): Record<string, number> | null {
  const p = map.presets.find((x) => x.name === name);
  return p ? { ...p.weights } : null;
}

/** Check the map; returns the problems found (empty when valid). */
export function validateExpressionMap(map: ExpressionMap): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  if (map.format !== 'ps2cc.expressionmap/2') problems.push(`unsupported format ${String(map.format)}`);
  for (const e of map.expressions) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(e.name)) problems.push(`bad blendshape name ${e.name}`);
    if (seen.has(e.name)) problems.push(`duplicate blendshape ${e.name}`);
    seen.add(e.name);
    if (e.units.length === 0) problems.push(`${e.name} uses no face units`);
    for (const [u, w] of e.units) {
      if (!isArkitUnit(u)) problems.push(`${e.name}: unknown face unit ${u}`);
      if (!(w > 0 && w <= 1.5)) problems.push(`${e.name}: weight ${w} of ${u} is outside (0, 1.5]`);
    }
    const c = e.calibrate;
    if (c) {
      if (!e.units.some(([u]) => u === c.unit)) problems.push(`${e.name}: calibrated unit ${c.unit} is not in its units`);
      if (c.eye !== 'L' && c.eye !== 'R') problems.push(`${e.name}: calibrate.eye must be L or R`);
      if (!(c.max >= 1 && c.max <= 2) || !(c.step > 0 && c.step <= 0.5)) problems.push(`${e.name}: calibrate range out of bounds`);
    }
  }
  for (const u of ARKIT_UNITS) {
    const e = map.expressions.find((x) => x.name === u);
    if (!e || e.units.length !== 1 || e.units[0]![0] !== u || e.units[0]![1] !== 1) problems.push(`${u} must be exported as itself`);
  }
  for (const p of map.presets ?? []) {
    for (const [u, w] of Object.entries(p.weights)) {
      if (!isArkitUnit(u)) problems.push(`preset ${p.name}: unknown face unit ${u}`);
      if (!(w > 0 && w <= 1)) problems.push(`preset ${p.name}: weight ${w} of ${u} is outside (0, 1]`);
    }
  }
  return problems;
}
