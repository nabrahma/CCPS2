/**
 * Writes the bodies the GarmentCode oracle builds its patterns on (`fixtures/garmentcode/bodies.json`): our own
 * neutral, male and female defaults and 9 adults drawn from the population sampler (M19), measured with the F24
 * measurements and keyed as GarmentCode's body files (`garmentCodeBody`). GarmentCode's SMPL-derived bodies are
 * never used. Runs only with PS2CC_WRITE_GC_BODIES=1; the oracle reads the file it writes.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { garmentCodeBody } from '../src/anthro/definitions';
import { BodyEvaluator } from '../src/anthro/evaluator';
import { DEFAULT_MACROS, type MacroValues } from '../src/morph/macros';
import { samplePerson } from '../src/population/sampler';
import { Rng } from '../src/random';
import { assetsAvailable, loadAssets } from './helpers';

const run = assetsAvailable && process.env.PS2CC_WRITE_GC_BODIES === '1' ? describe : describe.skip;

run('GarmentCode oracle bodies', () => {
  it('measures and writes the bodies', async () => {
    const assets = await loadAssets();
    const ev = new BodyEvaluator(assets);
    const bodies: { name: string; measurements: Record<string, number> }[] = [];
    const add = (name: string, macros: MacroValues): void => {
      const m = assets.anthro.measure(ev.evaluate(macros));
      const gc = garmentCodeBody(m);
      for (const [k, v] of Object.entries(gc)) gc[k] = Math.round(v * 1e6) / 1e6;
      bodies.push({ name, measurements: gc });
    };
    add('neutral', DEFAULT_MACROS);
    add('male', { ...DEFAULT_MACROS, gender: 1 });
    add('female', { ...DEFAULT_MACROS, gender: 0 });
    const rng = new Rng(22);
    for (let i = 0; i < 9; i++) add(`sampled_${i}`, samplePerson(assets, assets.anthro, assets.population, rng, DEFAULT_MACROS).macros);
    writeFileSync(join(__dirname, 'fixtures/garmentcode/bodies.json'), `${JSON.stringify({ bodies }, null, 1)}\n`);
    expect(bodies.length).toBe(12);
  });
});
