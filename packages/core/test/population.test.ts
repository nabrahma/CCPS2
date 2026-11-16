/**
 * PRD Part 3, F23 (M19 acceptance): the population sampler, realistic random
 * and the crowd generator.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { CoreAssets } from '../src/assets';
import { BodyEvaluator } from '../src/anthro/evaluator';
import { defaultCharacter, parseCharacter, serializeCharacter } from '../src/character/doc';
import { BUILTIN_OUTFITS } from '../src/character/outfit';
import { randomizeRealistic } from '../src/character/randomize';
import { ADULT_MIN_AGE } from '../src/character/sliders';
import { ageYears, DEFAULT_MACROS } from '../src/morph/macros';
import { crowdMemberSeed, generateCrowd } from '../src/population/crowd';
import { annyAgeOfYears, betaParameters, heightForStature, MAX_YEARS, MIN_YEARS, PHENOTYPES, samplePerson, statureCm, type SampledPerson } from '../src/population/sampler';
import { Rng } from '../src/random';
import { assetsAvailable, loadAssets } from './helpers';
import { betaCdf, ksPValue, ksStatistic } from './stats';

const suite = assetsAvailable ? describe : describe.skip;

suite('population sampler (PRD Part 3, F23)', () => {
  let assets: CoreAssets;
  let people: SampledPerson[];
  beforeAll(async () => {
    assets = await loadAssets();
    const rng = new Rng(20261115);
    people = [];
    for (let i = 0; i < 10_000; i++) people.push(samplePerson(assets, assets.anthro, assets.population, rng, DEFAULT_MACROS));
  }, 600_000);

  it('the calibration is Anny’s: years map to its age parameter, and adults share one height distribution per sex', () => {
    const cal = assets.population;
    expect(annyAgeOfYears(cal, 18)).toBeCloseTo(0.77, 12);
    expect(annyAgeOfYears(cal, 64)).toBeCloseTo(0.83, 12);
    expect(annyAgeOfYears(cal, 41)).toBeCloseTo(0.8, 12);
    const m = betaParameters(cal, 'male', 'height', 30);
    expect(m.alpha).toBeCloseTo(16.4956, 3);
    expect(m.beta).toBeCloseTo(25.6562, 3);
    expect(betaParameters(cal, 'male', 'height', 70)).toEqual(m);
    const f = betaParameters(cal, 'female', 'weight', 18);
    expect(f.alpha).toBeCloseTo(0.8814, 3);
    expect(f.beta).toBeCloseTo(0.6262, 3);
  });

  it('10,000 sampled adults: each phenotype passes a Kolmogorov-Smirnov test against its Beta distribution (p > 0.01)', () => {
    for (const ph of PHENOTYPES) {
      // Probability integral transform: each draw through its own CDF (its age and sex) must be uniform.
      const us = people.map((p) => {
        const { alpha, beta } = betaParameters(assets.population, p.sex, ph, p.years);
        return betaCdf(p.drawn[ph], alpha, beta);
      });
      const pValue = ksPValue(ksStatistic(us, (u) => Math.min(1, Math.max(0, u))), us.length);
      console.info(`[population] ${ph}: KS p = ${pValue.toFixed(3)}`);
      expect(pValue, ph).toBeGreaterThan(0.01);
    }
  });

  it('none is under 18, ages are spread evenly over 18 to 80, and the sexes are about even', () => {
    for (const p of people) {
      expect(p.years).toBeGreaterThanOrEqual(MIN_YEARS);
      expect(p.years).toBeLessThanOrEqual(MAX_YEARS);
      expect(p.macros.age).toBeGreaterThanOrEqual(ADULT_MIN_AGE);
      expect(ageYears(p.macros.age)).toBeCloseTo(p.years, 9);
    }
    const ages = people.map((p) => (p.years - MIN_YEARS) / (MAX_YEARS - MIN_YEARS));
    expect(ksPValue(ksStatistic(ages, (u) => Math.min(1, Math.max(0, u))), ages.length)).toBeGreaterThan(0.01);
    const men = people.filter((p) => p.sex === 'male').length;
    expect(men).toBeGreaterThan(4800);
    expect(men).toBeLessThan(5200);
    for (const p of people) {
      expect(p.sex === 'male' ? p.macros.gender >= 0.85 : p.macros.gender <= 0.15).toBe(true);
      expect(p.macros.african + p.macros.asian + p.macros.caucasian).toBeCloseTo(1, 12);
    }
  });

  it('statures are those of real adults, and the Height slider gives the stature that was drawn', () => {
    const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    const sd = (xs: number[]) => Math.sqrt(mean(xs.map((x) => (x - mean(xs)) ** 2)));
    const men = people.filter((p) => p.sex === 'male').map((p) => p.statureCm);
    const women = people.filter((p) => p.sex === 'female').map((p) => p.statureCm);
    console.info(`[population] stature: men ${mean(men).toFixed(1)} cm (sd ${sd(men).toFixed(1)}), women ${mean(women).toFixed(1)} cm (sd ${sd(women).toFixed(1)})`);
    expect(mean(men)).toBeGreaterThan(170);
    expect(mean(men)).toBeLessThan(182);
    expect(mean(women)).toBeGreaterThan(156);
    expect(mean(women)).toBeLessThan(168);
    expect(sd(men)).toBeGreaterThan(5);
    expect(sd(men)).toBeLessThan(11);
    // The body really has that stature (checked on a sample; unless the slider hit an end of its range).
    const full = new BodyEvaluator(assets);
    let clamped = 0;
    for (const p of people.slice(0, 300)) {
      const got = assets.anthro.measure(full.evaluate(p.macros), ['height']).height;
      if (p.macros.height === 0 || p.macros.height === 1) clamped++;
      else expect(Math.abs(got - p.statureCm)).toBeLessThan(0.05);
    }
    expect(clamped).toBeLessThan(15);
    const h = heightForStature(assets, assets.anthro, { ...DEFAULT_MACROS, gender: 1 }, {}, 180);
    expect(statureCm(assets, assets.anthro, { ...DEFAULT_MACROS, gender: 1, height: h })).toBeCloseTo(180, 6);
  });

  it('a seed gives the same person, and a locked value is kept without changing the others', () => {
    const a = samplePerson(assets, assets.anthro, assets.population, new Rng(9), DEFAULT_MACROS);
    const b = samplePerson(assets, assets.anthro, assets.population, new Rng(9), DEFAULT_MACROS);
    expect(a).toEqual(b);
    const base = { ...DEFAULT_MACROS, weight: 0.9 };
    const c = samplePerson(assets, assets.anthro, assets.population, new Rng(9), base, { locked: new Set(['weight'] as const) });
    expect(c.macros.weight).toBe(0.9);
    expect(c.macros.muscle).toBe(a.macros.muscle);
    expect(c.years).toBe(a.years);
    expect(c.sex).toBe(a.sex);
  });

  it('realistic random replaces the body, keeps locks, adds a little asymmetry and stays adult', () => {
    const doc = defaultCharacter('R');
    doc.modifiers['measure/measure-waist-circ-decr|incr'] = 0.4;
    const locked = new Set(['macrodetails/Gender', 'measure/measure-waist-circ-decr|incr']);
    const one = randomizeRealistic(doc, assets.sliders, assets, assets.anthro, assets.population, { seed: 31, locked });
    const two = randomizeRealistic(doc, assets.sliders, assets, assets.anthro, assets.population, { seed: 31, locked });
    expect(serializeCharacter(one.doc)).toBe(serializeCharacter(two.doc));
    expect(one.doc.macros.gender).toBe(doc.macros.gender);
    expect(one.doc.modifiers['measure/measure-waist-circ-decr|incr']).toBe(0.4);
    expect(one.doc.macros.age).toBeGreaterThanOrEqual(ADULT_MIN_AGE);
    const asym = Object.entries(one.doc.modifiers).filter(([k]) => k.startsWith('asym/'));
    expect(asym.length).toBeGreaterThan(10);
    for (const [, v] of asym) expect(Math.abs(v)).toBeLessThanOrEqual(0.18);
    for (const [k, v] of Object.entries(one.doc.modifiers)) {
      const s = assets.sliders.byId.get(k)!;
      expect(v, k).toBeGreaterThanOrEqual(s.min);
      expect(v, k).toBeLessThanOrEqual(s.max);
    }
    // Face only: the body's main values stay.
    const face = randomizeRealistic(doc, assets.sliders, assets, assets.anthro, assets.population, { seed: 31, tab: 'face' });
    expect(face.person).toBeNull();
    expect(face.doc.macros).toEqual(doc.macros);
    expect(face.doc.modifiers['measure/measure-waist-circ-decr|incr']).toBe(0.4);
    // It loads back as it was saved.
    expect(serializeCharacter(parseCharacter(JSON.parse(serializeCharacter(one.doc))))).toBe(serializeCharacter(one.doc));
  });

  it('a crowd is N different adults from one seed, the same every time, whatever N is', () => {
    const opts = { seed: 77, count: 12, namePrefix: 'Villager', outfits: BUILTIN_OUTFITS, skins: assets.catalog.skins.map((s) => s.id) };
    const a = generateCrowd(assets.sliders, assets, assets.anthro, assets.population, opts);
    const b = generateCrowd(assets.sliders, assets, assets.anthro, assets.population, { ...opts, count: 20 });
    expect(a.length).toBe(12);
    expect(a.map((m) => serializeCharacter(m.doc))).toEqual(b.slice(0, 12).map((m) => serializeCharacter(m.doc)));
    expect(new Set(a.map((m) => JSON.stringify(m.doc.macros))).size).toBe(12);
    expect(a[0]!.doc.name).toBe('Villager 001');
    expect(a[3]!.seed).toBe(crowdMemberSeed(77, 3));
    for (const m of a) {
      expect(m.doc.macros.age).toBeGreaterThanOrEqual(ADULT_MIN_AGE);
      expect(m.doc.garments.length).toBeGreaterThan(0);
      expect(m.doc.skin.base).toMatch(/^mh:skins\/(young|middleage|old)_(african|asian|caucasian)_(male|female)$/);
      expect(m.doc.skin.base.endsWith(`_${m.person.sex}`)).toBe(true);
    }
    // Changing the outfit pool does not change the bodies.
    const c = generateCrowd(assets.sliders, assets, assets.anthro, assets.population, { ...opts, outfits: [] });
    expect(c.map((m) => m.doc.macros)).toEqual(a.map((m) => m.doc.macros));
  });
});
