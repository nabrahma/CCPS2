/**
 * Macro variables, ported exactly from MakeHuman 1.x `apps/human.py`
 * (`_setGenderVals`, `_setAgeVals`, `_setWeightVals`, `_setMuscleVals`,
 * `_setHeightVals`, `_setBreastSizeVals`, `_setBreastFirmnessVals`,
 * `_setBodyProportionVals`, `_setEthnicVals`). Keep the formulas identical,
 * including their quirks (e.g. weight's average uses 1-(max+min) but height
 * uses 1-max(max,min)); golden tests compare against MakeHuman itself.
 */

export interface MacroValues {
  gender: number; // 0 female .. 1 male
  age: number; // 0 = 1 year, 0.1875 = 10, 0.5 = 25, 1 = 90
  muscle: number;
  weight: number;
  height: number;
  proportions: number;
  breastSize: number;
  breastFirmness: number;
  african: number;
  asian: number;
  caucasian: number;
}

export const DEFAULT_MACROS: Readonly<MacroValues> = Object.freeze({
  gender: 0.5,
  age: 0.5,
  muscle: 0.5,
  weight: 0.5,
  height: 0.5,
  proportions: 0.5,
  breastSize: 0.5,
  breastFirmness: 0.5,
  african: 1 / 3,
  asian: 1 / 3,
  caucasian: 1 / 3,
});

export type EthnicKey = 'african' | 'asian' | 'caucasian';
export const ETHNIC_KEYS: readonly EthnicKey[] = ['african', 'asian', 'caucasian'];

const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);

/**
 * Per-value factors used by target weights (MakeHuman's `<value>Val`
 * attributes, e.g. `femaleVal`, `youngVal`, `maxweightVal`).
 */
export function macroFactors(m: MacroValues): Record<string, number> {
  const f: Record<string, number> = {};
  // _setGenderVals
  f.male = m.gender;
  f.female = 1 - m.gender;
  // _setAgeVals (new system A8)
  if (m.age < 0.5) {
    f.old = 0.0;
    f.baby = Math.max(0.0, 1 - m.age * 5.333);
    f.young = Math.max(0.0, (m.age - 0.1875) * 3.2);
    f.child = Math.max(0.0, Math.min(1.0, 5.333 * m.age) - f.young);
  } else {
    f.child = 0.0;
    f.baby = 0.0;
    f.old = Math.max(0.0, m.age * 2 - 1);
    f.young = 1 - f.old;
  }
  // _setWeightVals
  f.maxweight = Math.max(0.0, m.weight * 2 - 1);
  f.minweight = Math.max(0.0, 1 - m.weight * 2);
  f.averageweight = 1 - (f.maxweight + f.minweight);
  // _setMuscleVals
  f.maxmuscle = Math.max(0.0, m.muscle * 2 - 1);
  f.minmuscle = Math.max(0.0, 1 - m.muscle * 2);
  f.averagemuscle = 1 - (f.maxmuscle + f.minmuscle);
  // _setHeightVals
  f.maxheight = Math.max(0.0, m.height * 2 - 1);
  f.minheight = Math.max(0.0, 1 - m.height * 2);
  f.averageheight = f.maxheight > f.minheight ? 1 - f.maxheight : 1 - f.minheight;
  // _setBreastSizeVals
  f.maxcup = Math.max(0.0, m.breastSize * 2 - 1);
  f.mincup = Math.max(0.0, 1 - m.breastSize * 2);
  f.averagecup = f.maxcup > f.mincup ? 1 - f.maxcup : 1 - f.mincup;
  // _setBreastFirmnessVals
  f.maxfirmness = Math.max(0.0, m.breastFirmness * 2 - 1);
  f.minfirmness = Math.max(0.0, 1 - m.breastFirmness * 2);
  f.averagefirmness = f.maxfirmness > f.minfirmness ? 1 - f.maxfirmness : 1 - f.minfirmness;
  // _setBodyProportionVals
  f.idealproportions = Math.max(0.0, m.proportions * 2 - 1);
  f.uncommonproportions = Math.max(0.0, 1 - m.proportions * 2);
  f.regularproportions =
    f.idealproportions > f.uncommonproportions ? 1 - f.idealproportions : 1 - f.uncommonproportions;
  // Ethnic values are used directly.
  f.african = m.african;
  f.asian = m.asian;
  f.caucasian = m.caucasian;
  return f;
}

/**
 * Port of `Human.setAfrican/setAsian/setCaucasian(value, sync=True)` followed by
 * `_setEthnicVals(exclude)`: sets one ethnic value and renormalises the other
 * two so the three sum to 1. Returns a new object.
 */
export function setEthnic(m: MacroValues, key: EthnicKey, value: number): MacroValues {
  const out = { ...m, [key]: clamp01(value) };
  normaliseEthnic(out, key);
  return out;
}

function closeTo(value: number, limit: number, epsilon = 0.001): boolean {
  return Math.abs(value - limit) <= epsilon;
}

/** In-place port of `Human._setEthnicVals(exclude)`. */
export function normaliseEthnic(m: MacroValues, exclude?: EthnicKey): void {
  const ethnics: EthnicKey[] = ETHNIC_KEYS.filter((e) => e !== exclude);
  let remaining = 1.0;
  if (exclude) remaining = 1.0 - m[exclude];
  const otherTotal = ethnics.reduce((s, e) => s + m[e], 0);
  if (otherTotal === 0.0) {
    if (ethnics.length === 3 || (exclude && m[exclude] === 0)) {
      for (const e of ethnics) m[e] = 1.0 / 3;
      if (exclude) m[exclude] = 1.0 / 3;
    } else if (exclude && closeTo(m[exclude], 1.0)) {
      for (const e of ethnics) m[e] = 0.0;
      m[exclude] = 1;
    } else {
      for (const e of ethnics) m[e] = 0.01;
      normaliseEthnic(m, exclude);
    }
  } else {
    for (const e of ethnics) m[e] = remaining * (m[e] / otherTotal);
  }
}

/** Approximate age in years (port of `Human.getAgeYears`, MIN 1 / MID 25 / MAX 90). */
export function ageYears(age: number): number {
  const MIN = 1;
  const MID = 25;
  const MAX = 90;
  return age < 0.5 ? MIN + (MID - MIN) * 2 * age : MID + (MAX - MID) * 2 * (age - 0.5);
}

/** Inverse of ageYears. */
export function ageFromYears(years: number): number {
  const MIN = 1;
  const MID = 25;
  const MAX = 90;
  const y = Math.min(Math.max(years, MIN), MAX);
  return y < MID ? (y - MIN) / ((MID - MIN) * 2) : (y - MID) / ((MAX - MID) * 2) + 0.5;
}

export function clampMacros(m: MacroValues): MacroValues {
  const out: MacroValues = { ...m };
  for (const k of Object.keys(out) as (keyof MacroValues)[]) out[k] = clamp01(out[k]);
  return out;
}
