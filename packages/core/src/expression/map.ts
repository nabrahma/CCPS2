/**
 * The expression map (PRD F8): which face pose units make each exported
 * blendshape. Authored data in `data/expression_map.json`.
 */
import mapJson from '../data/expression_map.json';
import type { FacePoseUnits } from './poseunits';

export type ExpressionGroup = 'eyes' | 'brows' | 'mouth' | 'visemes';

export interface ExpressionDef {
  name: string;
  label: string;
  group: ExpressionGroup;
  /** Unit pose name and weight, blended in this order. */
  units: [string, number][];
  /** Blinks: raise this unit's weight per character until the eye closes (expression/blink.ts). */
  calibrate?: { unit: string; eye: 'L' | 'R'; max: number; step: number };
}

export interface ExpressionMap {
  format: 'ps2cc.expressionmap/1';
  expressions: ExpressionDef[];
}

export const EXPRESSION_MAP = mapJson as unknown as ExpressionMap;

/** Every expression the map defines, in panel order. */
export function expressionNames(map: ExpressionMap = EXPRESSION_MAP): string[] {
  return map.expressions.map((e) => e.name);
}

export function expressionDef(name: string, map: ExpressionMap = EXPRESSION_MAP): ExpressionDef | undefined {
  return map.expressions.find((e) => e.name === name);
}

/** Check the map against the pose units; returns the problems found (empty when valid). */
export function validateExpressionMap(map: ExpressionMap, units: FacePoseUnits): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  if (map.format !== 'ps2cc.expressionmap/1') problems.push(`unsupported format ${String(map.format)}`);
  for (const e of map.expressions) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(e.name)) problems.push(`bad blendshape name ${e.name}`);
    if (seen.has(e.name)) problems.push(`duplicate blendshape ${e.name}`);
    seen.add(e.name);
    if (e.units.length === 0) problems.push(`${e.name} uses no pose units`);
    for (const [u, w] of e.units) {
      if (!units.has(u)) problems.push(`${e.name}: unknown pose unit ${u}`);
      if (!(w > 0 && w <= 1.5)) problems.push(`${e.name}: weight ${w} of ${u} is outside (0, 1.5]`);
    }
    const c = e.calibrate;
    if (c) {
      if (!e.units.some(([u]) => u === c.unit)) problems.push(`${e.name}: calibrated unit ${c.unit} is not in its units`);
      if (c.eye !== 'L' && c.eye !== 'R') problems.push(`${e.name}: calibrate.eye must be L or R`);
      if (!(c.max >= 1 && c.max <= 2) || !(c.step > 0 && c.step <= 0.5)) problems.push(`${e.name}: calibrate range out of bounds`);
    }
  }
  return problems;
}
