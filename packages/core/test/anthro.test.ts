/**
 * PRD Part 3, F24 (M19 acceptance): anthropometry and the measurement solve.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { CoreAssets } from '../src/assets';
import { garmentCodeBody, MEASURE_IDS, MEASURES, type MeasureId } from '../src/anthro/definitions';
import { BodyEvaluator } from '../src/anthro/evaluator';
import { closedLoopLength } from '../src/anthro/geometry';
import { RING_NAMES } from '../src/anthro/landmarks';
import { solveMeasurements, solveParameters } from '../src/anthro/solve';
import { DEFAULT_MACROS, type MacroValues } from '../src/morph/macros';
import { samplePerson } from '../src/population/sampler';
import { Rng } from '../src/random';
import { assetsAvailable, loadAssets } from './helpers';

const suite = assetsAvailable ? describe : describe.skip;

/** A random body over the whole adult slider range (wider than the population). */
function randomMacros(rng: Rng): MacroValues {
  const m: MacroValues = { ...DEFAULT_MACROS };
  m.gender = rng.next();
  m.age = rng.range(0.36, 1);
  m.muscle = rng.next();
  m.weight = rng.next();
  m.height = rng.next();
  m.proportions = rng.next();
  m.breastSize = rng.next();
  m.breastFirmness = rng.next();
  const a = rng.next() + 0.01;
  const b = rng.next() + 0.01;
  const c = rng.next() + 0.01;
  m.african = a / (a + b + c);
  m.asian = b / (a + b + c);
  m.caucasian = c / (a + b + c);
  return m;
}

suite('anthropometry (PRD Part 3, F24)', () => {
  let assets: CoreAssets;
  let full: BodyEvaluator;
  beforeAll(async () => {
    assets = await loadAssets();
    full = new BodyEvaluator(assets);
  });

  it('measures the default body plausibly', () => {
    const m = assets.anthro.measure(full.evaluate(DEFAULT_MACROS));
    console.info('[anthro] default body:', MEASURE_IDS.map((id) => `${id} ${m[id].toFixed(1)}`).join(', '));
    for (const id of MEASURE_IDS) expect(Number.isFinite(m[id]), id).toBe(true);
    expect(m.height).toBeGreaterThan(160);
    expect(m.height).toBeLessThan(175);
    expect(m.waist).toBeGreaterThan(60);
    expect(m.waist).toBeLessThan(95);
    expect(m.bust).toBeGreaterThan(m.underbust);
    expect(m.hips).toBeGreaterThan(m.waist);
    expect(m.thigh).toBeGreaterThan(m.knee);
    expect(m.calf).toBeGreaterThan(m.ankle);
    expect(m.upperArm).toBeGreaterThan(m.wrist);
    expect(m.head).toBeGreaterThan(50);
    expect(m.head).toBeLessThan(62);
    expect(m.bmi).toBeGreaterThan(17);
    expect(m.bmi).toBeLessThan(27);
    expect(m.armPoseAngle).toBeGreaterThan(35);
    expect(m.armPoseAngle).toBeLessThan(65);
    expect(m.inseam).toBeGreaterThan(70);
    expect(m.inseam).toBeLessThan(85);
    expect(assets.anthro.lastFallbacks).toBe(0);
    // Every GarmentCode body key has a value.
    const body = garmentCodeBody(m);
    expect(Object.keys(body).length).toBe(26);
    for (const [k, v] of Object.entries(body)) expect(Number.isFinite(v), k).toBe(true);
    expect(MEASURES.map((d) => d.id)).toEqual([...MEASURE_IDS]);
  });

  it('a tape measure never reads more than the skin: hull perimeter <= cut length, and close to it on convex rings', () => {
    const pos = full.evaluate(DEFAULT_MACROS);
    for (const name of RING_NAMES) {
      const cut = assets.anthro.cutRing(pos, name);
      expect(cut.loop, name).not.toBeNull();
      const skin = closedLoopLength(cut.loop!);
      expect(cut.perimeter, name).toBeLessThanOrEqual(skin + 1e-12);
      expect(cut.perimeter, name).toBeGreaterThan(skin * 0.8);
    }
    // MakeHuman's own ruler sums the ring's edges; ours should be near it for the waist.
    const ring = assets.bodyLandmarks.rings.waist.vertices;
    let edges = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]! * 3;
      const b = ring[(i + 1) % ring.length]! * 3;
      edges += Math.hypot(pos[a]! - pos[b]!, pos[a + 1]! - pos[b + 1]!, pos[a + 2]! - pos[b + 2]!);
    }
    expect(Math.abs(assets.anthro.measure(pos, ['waist']).waist - edges * 100)).toBeLessThan(2.5);
  });

  it('on 200 random bodies: height within 2 mm of the vertex extent, every ring one closed loop, all values finite', () => {
    const rng = new Rng(2400);
    let worstHeight = 0;
    for (let i = 0; i < 200; i++) {
      const pos = full.evaluate(randomMacros(rng));
      let lo = Infinity;
      let hi = -Infinity;
      for (let v = 0; v < assets.base.bodyVertexCount; v++) {
        lo = Math.min(lo, pos[v * 3 + 1]!);
        hi = Math.max(hi, pos[v * 3 + 1]!);
      }
      const m = assets.anthro.measure(pos);
      worstHeight = Math.max(worstHeight, Math.abs(m.height - (hi - lo) * 100));
      expect(assets.anthro.lastFallbacks, `body ${i}: rings cut locally`).toBe(0);
      for (const name of RING_NAMES) {
        for (const side of assets.bodyLandmarks.rings[name].mirror ? (['l', 'r'] as const) : (['l'] as const)) {
          const cut = assets.anthro.cutRing(pos, name, side);
          expect(cut.loop, `body ${i}: ${name} ${side}`).not.toBeNull();
          expect(cut.hull.length, `body ${i}: ${name} ${side}`).toBeGreaterThanOrEqual(8);
        }
      }
      for (const id of MEASURE_IDS) expect(Number.isFinite(m[id]), `body ${i}: ${id}`).toBe(true);
    }
    expect(worstHeight).toBeLessThan(0.2);
  });

  it('measuring only some values, on only the vertices they need, gives the same numbers', () => {
    const macros = randomMacros(new Rng(77));
    const all = assets.anthro.measure(full.evaluate(macros));
    const ids: MeasureId[] = ['height', 'bust', 'waist', 'hips', 'thigh', 'armLength', 'waistLine', 'inseam', 'shoulderWidth', 'neckWidth', 'hipInclination'];
    const part = new BodyEvaluator(assets, assets.anthro.vertexSet(ids));
    const some = assets.anthro.measure(part.evaluate(macros), ids);
    for (const id of ids) expect(some[id], id).toBe(all[id]);
    expect(Number.isNaN(some.calf)).toBe(true);
    expect(assets.anthro.vertexSet(['mass'])).toBeNull();
    expect(part.vertices!.length).toBeLessThan(assets.base.bodyVertexCount / 2);
  });

  it('left and right limb rings agree on a symmetric body', () => {
    const pos = full.evaluate(randomMacros(new Rng(5)));
    for (const name of ['thigh', 'knee', 'calf', 'ankle', 'upperArm', 'wrist'] as const) {
      expect(assets.anthro.cutRing(pos, name, 'l').perimeter).toBeCloseTo(assets.anthro.cutRing(pos, name, 'r').perimeter, 3);
    }
  });

  it('the solve reaches typed targets and leaves gender and age alone', () => {
    const start = { macros: { ...DEFAULT_MACROS, gender: 1 }, modifiers: {} };
    const report = solveMeasurements(assets, assets.anthro, start, { height: 178, bust: 102, waist: 84 });
    console.info('[anthro] 178/102/84:', report.targets.map((t) => `${t.id} ${t.start.toFixed(1)} -> ${t.reached.toFixed(2)} (${t.target})`).join(', '), `changed ${report.changed.length} sliders`);
    for (const t of report.targets) expect(Math.abs(t.residual), t.id).toBeLessThan(0.5);
    expect(report.macros.gender).toBe(1);
    expect(report.macros.age).toBe(DEFAULT_MACROS.age);
    expect(report.macros.african).toBe(DEFAULT_MACROS.african);
    // The result is ordinary slider values inside their ranges.
    const params = solveParameters(assets);
    for (const p of params) {
      if (!p.modifier) continue;
      const v = report.modifiers[p.modifier.fullName] ?? p.modifier.defaultValue;
      expect(v).toBeGreaterThanOrEqual(p.lo);
      expect(v).toBeLessThanOrEqual(p.hi);
      if (p.partner) expect(report.modifiers[p.partner.fullName] ?? p.partner.defaultValue).toBe(v);
    }
    // Applying the sliders gives the reported measurements.
    const check = assets.anthro.measure(full.evaluate(report.macros, report.modifiers), ['height', 'bust', 'waist']);
    for (const t of report.targets) expect(check[t.id]).toBeCloseTo(t.reached, 9);
  });

  it('a target out of reach is reported, not hidden', () => {
    const report = solveMeasurements(assets, assets.anthro, { macros: { ...DEFAULT_MACROS }, modifiers: {} }, { height: 290, waist: 20 });
    for (const t of report.targets) expect(t.inReach).toBe(false);
    expect(report.worst).toBeGreaterThan(5);
  });

  it('is deterministic: the same solve twice gives identical sliders', () => {
    const start = { macros: { ...DEFAULT_MACROS, gender: 0.1 }, modifiers: { 'measure/measure-neck-height-decr|incr': 0.2 } };
    const a = solveMeasurements(assets, assets.anthro, start, { hips: 101, thigh: 58, mass: 63 });
    const b = solveMeasurements(assets, assets.anthro, start, { hips: 101, thigh: 58, mass: 63 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it(
    'on 500 feasible targets from the population sampler, reaches every target within 1 cm (95th percentile) in 25 iterations',
    () => {
      const rng = new Rng(1900);
      const ids: MeasureId[] = ['height', 'bust', 'waist', 'hips'];
      const worst: number[] = [];
      const t0 = Date.now();
      for (let i = 0; i < 500; i++) {
        const person = samplePerson(assets, assets.anthro, assets.population, rng, DEFAULT_MACROS);
        const truth = assets.anthro.measure(full.evaluate(person.macros), ids);
        const targets = Object.fromEntries(ids.map((id) => [id, truth[id]])) as Record<MeasureId, number>;
        // Start from this person's gender, age and ethnic blend (they stay locked), and the default body otherwise.
        const start = { macros: { ...person.macros, height: 0.5, weight: 0.5, muscle: 0.5, proportions: 0.5 }, modifiers: {} };
        const report = solveMeasurements(assets, assets.anthro, start, targets);
        expect(report.iterations).toBe(25);
        worst.push(report.worst);
      }
      worst.sort((a, b) => a - b);
      const p95 = worst[Math.floor(0.95 * worst.length)]!;
      console.info(`[anthro] 500 solves in ${((Date.now() - t0) / 1000).toFixed(1)} s: worst residual median ${worst[250]!.toFixed(3)} cm, 95th percentile ${p95.toFixed(3)} cm, max ${worst[499]!.toFixed(3)} cm`);
      expect(p95).toBeLessThan(1);
    },
    1_200_000,
  );
});
