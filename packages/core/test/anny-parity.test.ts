/**
 * PRD Part 3, F23 step 1 (M19 acceptance): parity with Anny.
 *
 * The fixture (`pnpm golden:anny`) holds 50 seeded phenotype sets and, for
 * each, the body Anny's phenotype blending gives on MakeHuman's target files.
 * Here the same blend is rebuilt on PS2CC's packed targets and morph engine.
 * The PRD asks for 1e-5 m; the result is 1.3e-5 m, and all of it is the
 * 16-bit storage of targets (D-004: steps of up to 22 micrometres for the
 * tallest shapes). The test shows that: the engine is within a micrometre of
 * the oracle's own blend of targets rounded the same way. The first 25 sets sit where
 * Anny's parameters have exact MakeHuman macro values, and for those the
 * engine's own macro maths must give the same target weights.
 *
 * Anny's own copies of 22 of these targets differ from MakeHuman's
 * (`differingTargets` in the fixture, DECISIONS D-152); PS2CC keeps
 * MakeHuman's.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CoreAssets } from '../src/assets';
import { BodyEvaluator } from '../src/anthro/evaluator';
import { DEFAULT_MACROS, type MacroValues } from '../src/morph/macros';
import { Morpher } from '../src/morph/morpher';
import { macroAgeOfAnnyAge } from '../src/population/sampler';
import { assetsAvailable, loadAssets, readFloat32, readJsonFile } from './helpers';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'anny');
const available = assetsAvailable && existsSync(join(DIR, 'parity.json'));
const suite = available ? describe : describe.skip;

interface ParitySet {
  index: number;
  phenotype: Record<string, number>;
  variationWeights: Record<string, number>;
  positions: string;
  heightM: number;
  annyDataMaxDifferenceM: number;
  storageMaxDifferenceM: number;
}
interface ParityFile {
  bodyVertexCount: number;
  baseMeshMaxDifferenceDm: number;
  blendShapes: number;
  differingTargets: { target: string; maxBodyDifferenceM: number }[];
  sets: ParitySet[];
}

/** The PRD's bound is 1e-5 m; 16-bit target storage adds up to 0.5e-5 m on top (DECISIONS D-152). */
const TOLERANCE_M = 1.5e-5;

/** Anny's blend as PS2CC target weights: each phenotype target weighs the product of its variations' weights. */
function annyWeights(assets: CoreAssets, w: Record<string, number>): Map<number, number> {
  const out = new Map<number, number>();
  assets.targets.entries.forEach((t, i) => {
    if (!t.group.startsWith('macrodetails') && t.group !== 'breast') return;
    let c = 1;
    for (const v of t.vars) c *= w[v] ?? 0;
    if (c !== 0) out.set(i, c);
  });
  return out;
}

/** The MakeHuman macro values with the same target weights (exists when height and proportions are at an end of their range). */
function macrosOf(p: Record<string, number>): MacroValues {
  const total = p.african! + p.asian! + p.caucasian!;
  return {
    ...DEFAULT_MACROS,
    gender: 1 - p.gender!,
    age: macroAgeOfAnnyAge(p.age!),
    muscle: p.muscle!,
    weight: p.weight!,
    height: p.height!,
    proportions: 1 - p.proportions!,
    breastSize: p.cupsize!,
    breastFirmness: p.firmness!,
    african: p.african! / total,
    asian: p.asian! / total,
    caucasian: p.caucasian! / total,
  };
}

suite('Anny parity (PRD Part 3, F23)', () => {
  let assets: CoreAssets;
  let file: ParityFile;
  beforeAll(async () => {
    assets = await loadAssets();
    file = readJsonFile<ParityFile>(join(DIR, 'parity.json'));
  });

  it('is the same base mesh, with 50 sets', () => {
    expect(file.baseMeshMaxDifferenceDm).toBe(0);
    expect(file.sets.length).toBe(50);
    expect(file.bodyVertexCount).toBe(assets.base.bodyVertexCount);
  });

  it('PS2CC packs every blend shape Anny uses', () => {
    const count = assets.targets.entries.filter((t) => t.group.startsWith('macrodetails') || t.group === 'breast').length;
    expect(count).toBe(file.blendShapes);
  });

  it('the morph engine gives Anny’s body on all 50 sets, to the precision targets are stored at', () => {
    const morpher = new Morpher(assets.base, assets.targets);
    const evaluator = new BodyEvaluator(assets);
    let worst = 0;
    let worst64 = 0;
    for (const set of file.sets) {
      const expected = readFloat32(join(DIR, set.positions));
      const weights = annyWeights(assets, set.variationWeights);
      morpher.rebuild(weights);
      const exact = evaluator.evaluateWeights(weights);
      let setWorst = 0;
      for (let i = 0; i < expected.length; i++) {
        setWorst = Math.max(setWorst, Math.abs(morpher.positions[i]! - expected[i]!));
        worst64 = Math.max(worst64, Math.abs(exact[i]! - expected[i]!));
      }
      // Nothing but the storage step: the oracle's blend of equally rounded targets differs by the same amount.
      expect(setWorst, `set ${set.index}`).toBeLessThanOrEqual(set.storageMaxDifferenceM + 1e-6);
      worst = Math.max(worst, setWorst);
    }
    console.info(`[anny parity] worst vertex error: engine ${worst.toExponential(2)} m, float64 evaluator ${worst64.toExponential(2)} m`);
    expect(worst).toBeLessThanOrEqual(TOLERANCE_M);
    expect(worst64).toBeLessThanOrEqual(TOLERANCE_M);
  });

  it('where Anny’s parameters have exact macro values, the macro maths gives the same weights', () => {
    for (const set of file.sets.slice(0, 25)) {
      const fromMacros = assets.modifiers.computeWeights(macrosOf(set.phenotype), {});
      const fromAnny = annyWeights(assets, set.variationWeights);
      for (const [t, w] of fromAnny) {
        if (Math.abs(w) < 1e-12) continue;
        expect(fromMacros.get(t) ?? 0, `set ${set.index}: ${assets.targets.entries[t]!.path}`).toBeCloseTo(w, 9);
      }
      for (const [t, w] of fromMacros) {
        const e = assets.targets.entries[t]!;
        if (!e.group.startsWith('macrodetails') && e.group !== 'breast') continue;
        expect(fromAnny.get(t) ?? 0, `set ${set.index}: ${e.path}`).toBeCloseTo(w, 9);
      }
    }
  });

  it('records where Anny’s own target files differ from MakeHuman’s', () => {
    // 18 child max-height targets, 2 old min-height ones, one breast target and asian-female-young.
    expect(file.differingTargets.length).toBe(22);
    const child = file.differingTargets.filter((d) => d.target.includes('-child-') && d.target.endsWith('maxheight.target'));
    expect(child.length).toBe(18);
  });
});
