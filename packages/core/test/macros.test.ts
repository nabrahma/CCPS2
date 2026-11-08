import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ageFromYears,
  ageYears,
  DEFAULT_MACROS,
  macroFactors,
  normaliseEthnic,
  setEthnic,
  type MacroValues,
} from '../src/morph/macros';

describe('macroFactors (port of human.py _set*Vals)', () => {
  it('default character', () => {
    const f = macroFactors(DEFAULT_MACROS);
    expect(f.male).toBe(0.5);
    expect(f.female).toBe(0.5);
    expect(f.young).toBe(1);
    expect(f.old).toBe(0);
    expect(f.averageweight).toBe(1);
    expect(f.averagemuscle).toBe(1);
    expect(f.averageheight).toBe(1);
    expect(f.regularproportions).toBe(1);
  });

  it('age piecewise curve matches MakeHuman', () => {
    // age 0.1875 = 10 years: pure child.
    let f = macroFactors({ ...DEFAULT_MACROS, age: 0.1875 });
    expect(f.baby).toBeCloseTo(Math.max(0, 1 - 0.1875 * 5.333), 12);
    expect(f.child).toBeCloseTo(Math.min(1, 5.333 * 0.1875) - 0, 12);
    expect(f.young).toBe(0);
    // age 0.75: halfway young/old.
    f = macroFactors({ ...DEFAULT_MACROS, age: 0.75 });
    expect(f.old).toBeCloseTo(0.5, 12);
    expect(f.young).toBeCloseTo(0.5, 12);
  });

  it('weight average uses 1-(max+min) but height uses 1-max(max,min)', () => {
    const f = macroFactors({ ...DEFAULT_MACROS, weight: 0.9, height: 0.9 });
    expect(f.maxweight).toBeCloseTo(0.8, 12);
    expect(f.averageweight).toBeCloseTo(0.2, 12);
    expect(f.maxheight).toBeCloseTo(0.8, 12);
    expect(f.averageheight).toBeCloseTo(0.2, 12);
  });

  it('factors are finite and non-negative for any macro values', () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 8, maxLength: 8 }), (v) => {
        const m: MacroValues = {
          ...DEFAULT_MACROS,
          gender: v[0]!,
          age: v[1]!,
          muscle: v[2]!,
          weight: v[3]!,
          height: v[4]!,
          proportions: v[5]!,
          breastSize: v[6]!,
          breastFirmness: v[7]!,
        };
        for (const x of Object.values(macroFactors(m))) {
          expect(Number.isFinite(x)).toBe(true);
          expect(x).toBeGreaterThanOrEqual(-1e-12);
        }
      }),
    );
  });
});

describe('ethnic normalisation (port of _setEthnicVals)', () => {
  it('setting one value rescales the others proportionally', () => {
    const m = setEthnic({ ...DEFAULT_MACROS }, 'african', 0.5);
    expect(m.african).toBe(0.5);
    expect(m.asian).toBeCloseTo(0.25, 12);
    expect(m.caucasian).toBeCloseTo(0.25, 12);
  });

  it('setting one to 1 zeroes the others, and back from zero', () => {
    let m = setEthnic({ ...DEFAULT_MACROS }, 'asian', 1);
    expect(m).toMatchObject({ asian: 1, african: 0, caucasian: 0 });
    m = setEthnic(m, 'asian', 0.4);
    // Others were both 0: MakeHuman bumps them to 0.01 and renormalises.
    expect(m.african).toBeCloseTo(0.3, 12);
    expect(m.caucasian).toBeCloseTo(0.3, 12);
  });

  it('always sums to 1', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('african', 'asian', 'caucasian' as const),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (key, a, b, v) => {
          const start: MacroValues = { ...DEFAULT_MACROS, african: a, asian: b, caucasian: 1 - a };
          normaliseEthnic(start);
          const m = setEthnic(start, key as 'african', v);
          expect(m.african + m.asian + m.caucasian).toBeCloseTo(1, 9);
        },
      ),
    );
  });
});

describe('age years', () => {
  it('round-trips', () => {
    for (const y of [1, 10, 18, 25, 40, 90]) expect(ageYears(ageFromYears(y))).toBeCloseTo(y, 9);
    expect(ageFromYears(25)).toBe(0.5);
  });
});
