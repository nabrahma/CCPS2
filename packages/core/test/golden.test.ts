/**
 * Golden tests (PRD M1/M2/M4 acceptance): the engine must reproduce MakeHuman's
 * own output for the default character and 50 random modifier sets.
 * Fixtures are produced by `pnpm golden` (tools/asset-compiler/golden).
 */
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CoreAssets } from '../src/assets';
import { DEFAULT_MACROS, type MacroValues } from '../src/morph/macros';
import { Morpher } from '../src/morph/morpher';
import { fitSkeleton } from '../src/skeleton/rig';
import { assetsAvailable, GOLDEN_DIR, goldenAvailable, loadAssets, maxAbsDiff, readFloat32, readJsonFile } from './helpers';

interface MorphSet {
  index: number;
  seed: number;
  positions: string;
  modifiers: Record<string, number>;
  macros: Record<string, number>;
  targetWeights: Record<string, number>;
}

const POSITION_TOLERANCE_M = 1e-4;
const JOINT_TOLERANCE_M = 1e-4;

const suite = assetsAvailable && goldenAvailable ? describe : describe.skip;
if (!goldenAvailable) {
  console.warn('[golden] fixtures missing: run `pnpm golden` to generate them from MakeHuman');
}

function macrosOf(set: MorphSet): MacroValues {
  const m = set.macros;
  return {
    ...DEFAULT_MACROS,
    gender: m.gender!,
    age: m.age!,
    muscle: m.muscle!,
    weight: m.weight!,
    height: m.height!,
    proportions: m.proportions!,
    breastSize: m.breastSize!,
    breastFirmness: m.breastFirmness!,
    african: m.african!,
    asian: m.asian!,
    caucasian: m.caucasian!,
  };
}

function modifierValues(assets: CoreAssets, set: MorphSet): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(set.modifiers)) {
    const m = assets.modifiers.byName.get(k);
    if (!m) throw new Error(`fixture references unknown modifier ${k}`);
    if (!m.isMacro) out[k] = v;
  }
  return out;
}

suite('golden: MakeHuman morphs', () => {
  let assets: CoreAssets;
  let sets: MorphSet[];
  beforeAll(async () => {
    assets = await loadAssets();
    sets = readJsonFile<{ sets: MorphSet[] }>(join(GOLDEN_DIR, 'morph.json')).sets;
  });

  it('has the default character plus 50 random sets', () => {
    expect(sets.length).toBe(51);
  });

  it('target weights match MakeHuman for every set', () => {
    for (const set of sets) {
      const weights = assets.modifiers.computeWeights(macrosOf(set), modifierValues(assets, set));
      const byPath = new Map<string, number>();
      for (const [t, w] of weights) byPath.set(assets.targets.entries[t]!.path, w);
      const expected = Object.entries(set.targetWeights);
      for (const [path, w] of expected) {
        expect(byPath.get(path), `set ${set.index}: ${path}`).toBeCloseTo(w, 9);
      }
      expect(byPath.size, `set ${set.index}: active target count`).toBe(expected.length);
    }
  });

  it(`vertex positions match MakeHuman within ${POSITION_TOLERANCE_M} m`, () => {
    const morpher = new Morpher(assets.base, assets.targets);
    let worst = 0;
    for (const set of sets) {
      morpher.rebuild(assets.modifiers.computeWeights(macrosOf(set), modifierValues(assets, set)));
      const expected = readFloat32(join(GOLDEN_DIR, set.positions));
      const { max, index } = maxAbsDiff(morpher.positions, expected);
      worst = Math.max(worst, max);
      expect(max, `set ${set.index}: worst vertex ${Math.floor(index / 3)}`).toBeLessThanOrEqual(POSITION_TOLERANCE_M);
    }
    console.info(`[golden] max vertex error over ${sets.length} sets: ${worst.toExponential(3)} m`);
  });

  it(`GameEngine joints match within ${JOINT_TOLERANCE_M} m`, () => {
    const joints = readJsonFile<{ sets: { index: number; gameEngine: Record<string, { head: number[]; tail: number[] }> }[] }>(
      join(GOLDEN_DIR, 'joints.json'),
    ).sets;
    const morpher = new Morpher(assets.base, assets.targets);
    let worst = 0;
    for (const js of joints) {
      const set = sets[js.index]!;
      morpher.rebuild(assets.modifiers.computeWeights(macrosOf(set), modifierValues(assets, set)));
      const sk = fitSkeleton(assets.rig, morpher.positions);
      assets.rig.bones.forEach((b, i) => {
        const exp = js.gameEngine[b.name]!;
        for (let k = 0; k < 3; k++) {
          worst = Math.max(worst, Math.abs(sk.heads[i * 3 + k]! - exp.head[k]!), Math.abs(sk.tails[i * 3 + k]! - exp.tail[k]!));
        }
      });
    }
    console.info(`[golden] max joint error: ${worst.toExponential(3)} m`);
    expect(worst).toBeLessThanOrEqual(JOINT_TOLERANCE_M);
  });
});

suite('golden: MHCLO proxy fitting', () => {
  it('fitted garment, hair and face-part vertices match MakeHuman within 1e-4 m', async () => {
    const assets = await loadAssets();
    const sets = readJsonFile<{ sets: MorphSet[] }>(join(GOLDEN_DIR, 'morph.json')).sets;
    const proxySets = readJsonFile<{ sets: { index: number; proxies: Record<string, { file: string }> }[] }>(
      join(GOLDEN_DIR, 'proxies.json'),
    ).sets;
    const morpher = new Morpher(assets.base, assets.targets);
    let worst = 0;
    for (const ps of proxySets) {
      const set = sets[ps.index]!;
      morpher.rebuild(assets.modifiers.computeWeights(macrosOf(set), modifierValues(assets, set)));
      for (const [id, info] of Object.entries(ps.proxies)) {
        if (!assets.hasProxy(id)) throw new Error(`golden proxy ${id} was not compiled`);
        const proxy = await assets.proxy(id, { full: true });
        const fitted = proxy.fit(morpher.positions);
        const { max } = maxAbsDiff(fitted, readFloat32(join(GOLDEN_DIR, info.file)));
        worst = Math.max(worst, max);
        expect(max, `set ${ps.index} ${id}`).toBeLessThanOrEqual(1e-4);
      }
    }
    console.info(`[golden] max proxy vertex error: ${worst.toExponential(3)} m`);
  });
});
