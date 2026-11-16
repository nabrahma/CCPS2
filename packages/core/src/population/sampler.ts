/**
 * Population sampler (PRD Part 3, F23): bodies drawn from Anny's calibrated
 * distributions instead of uniformly from the slider ranges.
 *
 * Anny (NAVER LABS Europe, Apache 2.0) calibrated, per sex, Beta
 * distributions of height, weight, muscle and proportions conditioned on age
 * against WHO statistics. Its phenotype parameters are MakeHuman's macros,
 * with three differences that matter here (DECISIONS D-152):
 *
 * - Age. Anny maps years to its own age parameter and that to the baby,
 *   child, young and old shapes differently from MakeHuman. Here the
 *   character's age is MakeHuman's (what the Age slider shows), and Anny's
 *   mapping is used only to look up the distributions for that many years.
 * - Height. Anny blends straight from the shortest to the tallest shape;
 *   MakeHuman goes through the default shape, so the same slider value gives
 *   a different stature. The sampled height is therefore converted to the
 *   stature Anny's blend gives, and the Height slider is solved to match it.
 * - Proportions. Anny's parameter runs the other way (0 is "ideal").
 *
 * Every draw comes from the seeded `Rng` in a fixed order.
 */
import { BodyEvaluator, type BodySource } from '../anthro/evaluator';
import type { Anthropometer } from '../anthro/measure';
import { beta, dirichletUniform, interpolate } from '../math/distributions';
import { ageFromYears, ageYears, type MacroValues } from '../morph/macros';
import type { Rng } from '../random';

export interface BetaAnchors {
  annyAge: number[];
  alpha: number[];
  beta: number[];
}

export type Phenotype = 'height' | 'weight' | 'muscle' | 'proportions';
export const PHENOTYPES: readonly Phenotype[] = ['height', 'weight', 'muscle', 'proportions'];
export type Sex = 'male' | 'female';

export interface PopulationCalibration {
  format: 'ps2cc.population/1';
  ageMapping: { years: number[]; annyAge: number[] };
  male: Record<Phenotype, BetaAnchors>;
  female: Record<Phenotype, BetaAnchors>;
}

export function validateCalibration(cal: PopulationCalibration): PopulationCalibration {
  if (cal.format !== 'ps2cc.population/1') throw new Error(`population: unknown format ${String(cal.format)}`);
  for (const sex of ['male', 'female'] as const) {
    for (const ph of PHENOTYPES) {
      const d = cal[sex]?.[ph];
      if (!d || d.annyAge.length !== d.alpha.length || d.alpha.length !== d.beta.length || d.alpha.some((v) => !(v > 0)) || d.beta.some((v) => !(v > 0))) {
        throw new Error(`population: bad ${sex} ${ph} distribution`);
      }
    }
  }
  return cal;
}

/** Adults only (PRD Part 1): the youngest and oldest ages the sampler draws. */
export const MIN_YEARS = 18;
export const MAX_YEARS = 80;

/** Anny's age parameter for an age in years. */
export function annyAgeOfYears(cal: PopulationCalibration, years: number): number {
  return interpolate(years, cal.ageMapping.years, cal.ageMapping.annyAge);
}

/** The Beta shape parameters of a phenotype for a sex and an age in years. */
export function betaParameters(cal: PopulationCalibration, sex: Sex, phenotype: Phenotype, years: number): { alpha: number; beta: number } {
  const d = cal[sex][phenotype];
  const a = annyAgeOfYears(cal, years);
  return { alpha: interpolate(a, d.annyAge, d.alpha), beta: interpolate(a, d.annyAge, d.beta) };
}

/**
 * MakeHuman's age value that gives the shape mix Anny uses for its age
 * parameter (young/old above 2/3, child/young below).
 */
export function macroAgeOfAnnyAge(annyAge: number): number {
  if (annyAge >= 2 / 3) return 0.5 + (Math.min(annyAge, 1) - 2 / 3) * 1.5;
  return 0.1875 + ((Math.max(annyAge, 1 / 3) - 1 / 3) * 3) / 3.2;
}

export interface SampleOptions {
  /** Macro values the sampler must leave alone. */
  locked?: ReadonlySet<keyof MacroValues>;
  /** Other slider values of the character (they change stature a little, so the height match includes them). */
  modifiers?: Readonly<Record<string, number>>;
}

export interface SampledPerson {
  /** Age in years, as drawn (or the character's own age when Age is locked). */
  years: number;
  sex: Sex;
  /** The values drawn from Anny's Beta distributions, in Anny's parameters. */
  drawn: Record<Phenotype, number>;
  /** The stature the drawn height stands for, in cm (NaN when Height is locked). */
  statureCm: number;
  macros: MacroValues;
}

const heightModels = new WeakMap<Anthropometer, BodyEvaluator>();

/** Stature in cm of a body with the given sliders. */
export function statureCm(source: BodySource, anthro: Anthropometer, macros: MacroValues, modifiers: Readonly<Record<string, number>> = {}): number {
  let ev = heightModels.get(anthro);
  if (!ev) {
    ev = new BodyEvaluator(source, anthro.vertexSet(['height']));
    heightModels.set(anthro, ev);
  }
  return anthro.measure(ev.evaluate(macros, modifiers), ['height']).height;
}

/**
 * Draw one adult from the population. `base` supplies the values of locked
 * macros. The same `rng` state always gives the same person.
 */
export function samplePerson(
  source: BodySource,
  anthro: Anthropometer,
  cal: PopulationCalibration,
  rng: Rng,
  base: MacroValues,
  opts: SampleOptions = {},
): SampledPerson {
  const locked = opts.locked ?? new Set<keyof MacroValues>();
  const modifiers = opts.modifiers ?? {};
  // Fixed draw order, whatever is locked, so a lock never shifts the other values.
  const drawnYears = rng.range(MIN_YEARS, MAX_YEARS);
  const sexDraw = rng.next();
  const genderSpread = rng.range(0, 0.15);
  const years = locked.has('age') ? Math.min(MAX_YEARS + 10, Math.max(MIN_YEARS, ageYears(base.age))) : drawnYears;
  const sex: Sex = locked.has('gender') ? (base.gender >= 0.5 ? 'male' : 'female') : sexDraw < 0.5 ? 'male' : 'female';
  const drawn = {} as Record<Phenotype, number>;
  for (const ph of PHENOTYPES) {
    const { alpha, beta: b } = betaParameters(cal, sex, ph, years);
    drawn[ph] = beta(rng, alpha, b);
  }
  const ethnic = dirichletUniform(rng, 3);
  const cup = rng.range(0.2, 0.8);
  const firmness = rng.range(0.3, 0.9);

  const macros: MacroValues = { ...base };
  if (!locked.has('age')) macros.age = ageFromYears(years);
  if (!locked.has('gender')) macros.gender = sex === 'male' ? 1 - genderSpread : genderSpread;
  if (!locked.has('weight')) macros.weight = drawn.weight;
  if (!locked.has('muscle')) macros.muscle = drawn.muscle;
  if (!locked.has('proportions')) macros.proportions = 1 - drawn.proportions;
  if (!locked.has('african') && !locked.has('asian') && !locked.has('caucasian')) {
    macros.african = ethnic[0]!;
    macros.asian = ethnic[1]!;
    macros.caucasian = ethnic[2]!;
  }
  if (!locked.has('breastSize')) macros.breastSize = cup;
  if (!locked.has('breastFirmness')) macros.breastFirmness = firmness;

  let stature = NaN;
  if (!locked.has('height')) {
    // The stature Anny's blend gives for the drawn height: a straight line from its shortest to its tallest shape,
    // at the shape mix Anny uses for this age.
    const reference: MacroValues = { ...macros, age: macroAgeOfAnnyAge(annyAgeOfYears(cal, years)) };
    const shortest = statureCm(source, anthro, { ...reference, height: 0 }, modifiers);
    const tallest = statureCm(source, anthro, { ...reference, height: 1 }, modifiers);
    stature = shortest + (tallest - shortest) * drawn.height;
    macros.height = heightForStature(source, anthro, macros, modifiers, stature);
  }
  return { years, sex, drawn, statureCm: stature, macros };
}

/** The Height slider value that gives a stature, for the other sliders as given (clamped to the slider's range). */
export function heightForStature(source: BodySource, anthro: Anthropometer, macros: MacroValues, modifiers: Readonly<Record<string, number>>, cm: number): number {
  // Stature is linear in the slider on each side of the middle (the targets add linearly).
  const lo = statureCm(source, anthro, { ...macros, height: 0 }, modifiers);
  const mid = statureCm(source, anthro, { ...macros, height: 0.5 }, modifiers);
  const hi = statureCm(source, anthro, { ...macros, height: 1 }, modifiers);
  let h: number;
  if (cm <= mid) h = mid > lo ? 0.5 * ((cm - lo) / (mid - lo)) : 0.5;
  else h = hi > mid ? 0.5 + 0.5 * ((cm - mid) / (hi - mid)) : 0.5;
  return Math.min(1, Math.max(0, h));
}
