/**
 * Measurement solve (PRD Part 3, F24): find slider values that give the
 * measurements the user typed.
 *
 *   minimise  sum_i w_i (m_i(p) - t_i)^2  +  mu sum_j (p_j - p0_j)^2
 *   subject to  lo_j <= p_j <= hi_j
 *
 * p = the height, weight, muscle and proportions macros, MakeHuman's
 * `measure-*` modifiers, and the scale modifiers of torso, hips, legs and
 * arms. Gender and the ethnic blend stay as they are unless unlocked.
 * Projected Levenberg-Marquardt with a fixed number of iterations; the
 * Jacobian is central finite differences (h = 1e-3 slider units). The result
 * is ordinary slider values.
 */
import type { MacroValues } from '../morph/macros';
import { normaliseEthnic } from '../morph/macros';
import type { Modifier } from '../morph/modifiers';
import { levenbergMarquardt } from '../math/linalg';
import { isHiddenModifier } from '../character/sliders';
import { MEASURE_BY_ID, type MeasureId, type Measurements } from './definitions';
import { BodyEvaluator, type BodySource } from './evaluator';
import type { Anthropometer } from './measure';

export interface SolveInput {
  macros: MacroValues;
  modifiers: Readonly<Record<string, number>>;
}

export interface SolveOptions {
  /** Let the solver change gender. */
  unlockGender?: boolean;
  /** Let the solver change the ethnic blend. */
  unlockEthnic?: boolean;
  /** Weight per measurement (default 1). */
  weights?: Partial<Record<MeasureId, number>>;
  iterations?: number;
  /** Pull toward the starting values (default 1e-3). */
  mu?: number;
}

export interface SolveReport {
  macros: MacroValues;
  modifiers: Record<string, number>;
  /** Per target: what was asked, what was reached, the difference, and whether it is within reach. */
  targets: { id: MeasureId; target: number; start: number; reached: number; residual: number; inReach: boolean }[];
  /** Largest absolute difference over the targets. */
  worst: number;
  iterations: number;
  /** Sliders the solve moved, by id. */
  changed: string[];
}

export const SOLVE_ITERATIONS = 25;
export const SOLVE_MU = 1e-3;
const FD_STEP = 1e-3;
/** A target counts as reached within this many of its unit (cm, kg). */
export const REACH_TOLERANCE = 1;

const SOLVE_MACROS: (keyof MacroValues)[] = ['height', 'weight', 'muscle', 'proportions'];
const SCALE_MODIFIER = /^(torso\/torso-scale-|hip\/hip-scale-|armslegs\/(l|r)-(upperarm|lowerarm|upperleg|lowerleg)-scale-|armslegs\/(lowerlegs|upperlegs)-height|neck\/neck-scale-)/;

interface Param {
  id: string;
  macro: keyof MacroValues | null;
  modifier: Modifier | null;
  /** The right-side partner, moved together with a left-side modifier. */
  partner: Modifier | null;
  lo: number;
  hi: number;
}

/** The sliders the solve may move, in a fixed order. */
export function solveParameters(source: BodySource, opts: SolveOptions = {}): Param[] {
  const out: Param[] = [];
  for (const key of SOLVE_MACROS) out.push({ id: `macro:${key}`, macro: key, modifier: null, partner: null, lo: 0, hi: 1 });
  if (opts.unlockGender) out.push({ id: 'macro:gender', macro: 'gender', modifier: null, partner: null, lo: 0, hi: 1 });
  if (opts.unlockEthnic) {
    out.push({ id: 'macro:african', macro: 'african', modifier: null, partner: null, lo: 0, hi: 1 });
    out.push({ id: 'macro:asian', macro: 'asian', modifier: null, partner: null, lo: 0, hi: 1 });
  }
  for (const m of source.modifiers.universals) {
    if (isHiddenModifier(m.fullName)) continue;
    if (m.groupName !== 'measure' && !SCALE_MODIFIER.test(m.fullName)) continue;
    if (m.symmetrySide === 'r' && m.symmetricOpposite && source.modifiers.byName.has(m.symmetricOpposite)) continue;
    const partner = m.symmetrySide === 'l' && m.symmetricOpposite ? (source.modifiers.byName.get(m.symmetricOpposite) ?? null) : null;
    out.push({ id: m.fullName, macro: null, modifier: m, partner, lo: m.min, hi: m.max });
  }
  return out;
}

function apply(params: Param[], p: ArrayLike<number>, start: SolveInput): { macros: MacroValues; modifiers: Record<string, number> } {
  const macros = { ...start.macros };
  const modifiers: Record<string, number> = { ...start.modifiers };
  let ethnic = false;
  params.forEach((param, j) => {
    const v = p[j]!;
    if (param.macro) {
      macros[param.macro] = v;
      if (param.macro === 'african' || param.macro === 'asian') ethnic = true;
    } else {
      modifiers[param.modifier!.fullName] = v;
      if (param.partner) modifiers[param.partner.fullName] = v;
    }
  });
  if (ethnic) {
    const rest = Math.max(0, 1 - macros.african - macros.asian);
    macros.caucasian = rest;
    normaliseEthnic(macros);
  }
  return { macros, modifiers };
}

/**
 * Solve for the given targets (cm, kg). Targets that are not solvable
 * measurements are ignored.
 */
export function solveMeasurements(
  source: BodySource,
  anthro: Anthropometer,
  start: SolveInput,
  targets: Partial<Record<MeasureId, number>>,
  opts: SolveOptions = {},
): SolveReport {
  const ids = (Object.keys(targets) as MeasureId[]).filter((id) => MEASURE_BY_ID.get(id)?.target && Number.isFinite(targets[id]));
  ids.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const params = solveParameters(source, opts);
  const n = params.length;
  const p0 = new Float64Array(n);
  params.forEach((param, j) => {
    p0[j] = param.macro ? start.macros[param.macro] : (start.modifiers[param.modifier!.fullName] ?? param.modifier!.defaultValue);
    p0[j] = Math.min(param.hi, Math.max(param.lo, p0[j]!));
  });
  const evaluator = new BodyEvaluator(source, anthro.vertexSet(ids));
  const measureAt = (p: ArrayLike<number>, out: Float64Array = evaluator.positions): Measurements => {
    const s = apply(params, p, start);
    evaluator.evaluateWeights(evaluator.weights(s.macros, s.modifiers), out);
    return anthro.measure(out, ids);
  };
  const startMeasures = measureAt(p0);
  if (ids.length === 0) {
    return { macros: { ...start.macros }, modifiers: { ...start.modifiers }, targets: [], worst: 0, iterations: 0, changed: [] };
  }
  const mu = opts.mu ?? SOLVE_MU;
  const sqrtMu = Math.sqrt(mu);
  const w = ids.map((id) => Math.sqrt(opts.weights?.[id] ?? 1));
  const m = ids.length + n;
  const scratch = new Float64Array(evaluator.positions.length);
  const probe = new Float64Array(n);
  const basePositions = new Float64Array(evaluator.positions.length);
  const dead = new Uint8Array(n);
  let firstJacobian = true;
  const problem = {
    n,
    m,
    lower: params.map((q) => q.lo),
    upper: params.map((q) => q.hi),
    residuals(p: Float64Array, out: Float64Array) {
      const got = measureAt(p);
      ids.forEach((id, i) => (out[i] = w[i]! * (got[id] - targets[id]!)));
      for (let j = 0; j < n; j++) out[ids.length + j] = sqrtMu * (p[j]! - p0[j]!);
    },
    jacobian(p: Float64Array, out: Float64Array) {
      out.fill(0);
      // The shape at p once; each probe then only applies the targets whose weight it changes.
      const at = apply(params, p, start);
      const baseWeights = evaluator.weights(at.macros, at.modifiers);
      evaluator.evaluateWeights(baseWeights, basePositions);
      const diff = (next: ReadonlyMap<number, number>) => {
        for (const [t, wt] of next) {
          const dw = wt - (baseWeights.get(t) ?? 0);
          if (dw !== 0) evaluator.accumulate(t, dw, scratch);
        }
      };
      const probeMeasures = (j: number, value: number): Measurements => {
        const param = params[j]!;
        scratch.set(basePositions);
        if (param.modifier) {
          // A modifier's targets are its own: only they change.
          diff(source.modifiers.modifierWeights(param.modifier, at.macros, value));
          if (param.partner) diff(source.modifiers.modifierWeights(param.partner, at.macros, value));
        } else {
          probe.set(p);
          probe[j] = value;
          const s = apply(params, probe, start);
          const next = evaluator.weights(s.macros, s.modifiers);
          diff(next);
          for (const [t, wt] of baseWeights) if (!next.has(t)) evaluator.accumulate(t, -wt, scratch);
        }
        return anthro.measure(scratch, ids);
      };
      for (let j = 0; j < n; j++) {
        out[(ids.length + j) * n + j] = sqrtMu;
        if (dead[j]) continue;
        const hiV = Math.min(params[j]!.hi, p[j]! + FD_STEP);
        const loV = Math.max(params[j]!.lo, p[j]! - FD_STEP);
        const span = hiV - loV;
        if (!(span > 0)) continue;
        const up = probeMeasures(j, hiV);
        const down = probeMeasures(j, loV);
        let any = false;
        for (let i = 0; i < ids.length; i++) {
          const d = (w[i]! * (up[ids[i]!] - down[ids[i]!])) / span;
          out[i * n + j] = d;
          if (d !== 0) any = true;
        }
        // A slider that moves none of the targeted measurements is left out of later iterations.
        if (!any && firstJacobian) dead[j] = 1;
      }
      firstJacobian = false;
    },
  };
  const result = levenbergMarquardt(problem, p0, opts.iterations ?? SOLVE_ITERATIONS);
  const solved = apply(params, result.p, start);
  const reached = measureAt(result.p);
  // Drop values that sit on a slider's default, as the engine does.
  const changed: string[] = [];
  params.forEach((param, j) => {
    if (Math.abs(result.p[j]! - p0[j]!) > 1e-9) changed.push(param.id);
    if (!param.modifier) return;
    for (const mod of [param.modifier, param.partner]) {
      if (mod && Math.abs(solved.modifiers[mod.fullName]! - mod.defaultValue) < 1e-9) delete solved.modifiers[mod.fullName];
    }
  });
  const report = ids.map((id) => {
    const residual = reached[id] - targets[id]!;
    return { id, target: targets[id]!, start: startMeasures[id], reached: reached[id], residual, inReach: Math.abs(residual) <= REACH_TOLERANCE };
  });
  return {
    macros: solved.macros,
    modifiers: solved.modifiers,
    targets: report,
    worst: report.reduce((s, r) => Math.max(s, Math.abs(r.residual)), 0),
    iterations: result.iterations,
    changed,
  };
}
