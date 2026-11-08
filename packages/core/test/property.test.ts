/**
 * PRD M1 acceptance: 1,000 random slider sets yield no NaN/Inf and stay
 * within plausible human limits.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { CoreAssets } from '../src/assets';
import { defaultCharacter } from '../src/character/doc';
import { randomizeCharacter } from '../src/character/randomize';
import { ADULT_MIN_AGE } from '../src/character/sliders';
import { normaliseEthnic } from '../src/morph/macros';
import { Morpher } from '../src/morph/morpher';
import { Rng } from '../src/random';
import { assetsAvailable, loadAssets } from './helpers';

const suite = assetsAvailable ? describe : describe.skip;

function bodyBounds(p: Float32Array, n: number) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < n; v++) {
    for (let k = 0; k < 3; k++) {
      const x = p[v * 3 + k]!;
      if (!Number.isFinite(x)) throw new Error(`vertex ${v} is not finite`);
      lo[k] = Math.min(lo[k]!, x);
      hi[k] = Math.max(hi[k]!, x);
    }
  }
  return { width: hi[0]! - lo[0]!, height: hi[1]! - lo[1]!, depth: hi[2]! - lo[2]! };
}

suite('property: random characters', () => {
  let assets: CoreAssets;
  beforeAll(async () => {
    assets = await loadAssets();
  });

  it('1,000 random slider sets over the FULL ranges: finite and human-sized', () => {
    const morpher = new Morpher(assets.base, assets.targets);
    const rng = new Rng(20261107);
    const all = assets.sliders.all;
    const extremes = { minH: Infinity, maxH: 0, maxW: 0, maxD: 0 };
    for (let i = 0; i < 1000; i++) {
      const doc = defaultCharacter();
      for (const s of all) {
        if (rng.next() < 0.35) continue; // leave some sliders at default
        const v = rng.range(s.min, s.max);
        const name = s.id.split('/')[1]!;
        if (s.macro) {
          const key = ({ Gender: 'gender', Age: 'age', Muscle: 'muscle', Weight: 'weight', Height: 'height',
            BodyProportions: 'proportions', BreastSize: 'breastSize', BreastFirmness: 'breastFirmness',
            African: 'african', Asian: 'asian', Caucasian: 'caucasian' } as const)[name as 'Gender'];
          doc.macros[key] = v;
        } else {
          doc.modifiers[s.id] = v;
        }
      }
      doc.macros.age = Math.max(doc.macros.age, ADULT_MIN_AGE);
      normaliseEthnic(doc.macros);
      const weights = assets.modifiers.computeWeights(doc.macros, doc.modifiers);
      for (const w of weights.values()) expect(Number.isFinite(w)).toBe(true);
      morpher.setWeights(weights);
      const b = bodyBounds(morpher.positions, assets.base.bodyVertexCount);
      extremes.minH = Math.min(extremes.minH, b.height);
      extremes.maxH = Math.max(extremes.maxH, b.height);
      extremes.maxW = Math.max(extremes.maxW, b.width);
      extremes.maxD = Math.max(extremes.maxD, b.depth);
      // MakeHuman's FULL ranges allow giants (max height + long legs reaches ~2.6 m); these bounds catch
      // broken maths (explosions, collapse), not taste. The curated test below checks the realistic envelope.
      expect(b.height).toBeGreaterThan(1.1);
      expect(b.height).toBeLessThan(2.8);
      expect(b.width).toBeLessThan(2.8);
      expect(b.depth).toBeLessThan(1.0);
    }
    console.info(`[property] extremes over 1000 characters: ${JSON.stringify(extremes)}`);
  });

  it('randomize within curated safe ranges stays in a tight human envelope', () => {
    const morpher = new Morpher(assets.base, assets.targets);
    for (let seed = 1; seed <= 200; seed++) {
      const doc = randomizeCharacter(defaultCharacter(), assets.sliders, { seed, amount: 1 });
      morpher.setWeights(assets.modifiers.computeWeights(doc.macros, doc.modifiers));
      const b = bodyBounds(morpher.positions, assets.base.bodyVertexCount);
      expect(b.height).toBeGreaterThan(1.3);
      expect(b.height).toBeLessThan(2.2);
    }
  });
});
