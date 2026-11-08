/**
 * PRD F8 / M8: expression blendshapes are baked by posing MakeHuman's default
 * rig with its face pose units. Golden test against MakeHuman's own posing
 * (Skeleton.setPose + skinMesh on the oracle, fixtures from
 * `pnpm golden:expressions`), plus checks of the expression map.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FaceRig, skinDeltas } from '../src/expression/facerig';
import { EXPRESSION_MAP, validateExpressionMap } from '../src/expression/map';
import { DEFAULT_EXPRESSIONS } from '../src/character/doc';
import { GOLDEN_DIR, assetsAvailable, loadAssets, readFloat32, readJsonFile } from './helpers';

interface ExprGolden {
  sets: {
    index: number;
    units: Record<string, Record<string, number[]>>;
    cases: Record<string, { blend: Record<string, number>; file: string; count: number; bones: Record<string, number[]> }>;
  }[];
}

const haveGolden = existsSync(join(GOLDEN_DIR, 'expressions.json'));
const suite = assetsAvailable && haveGolden ? describe : describe.skip;
/** PRD golden tolerance is 1e-4 m; MakeHuman computes in float32 decimetres. */
const TOLERANCE_M = 1e-5;

function readSparse(file: string, count: number): { idx: Uint32Array; delta: Float32Array } {
  const buf = readFileSync(join(GOLDEN_DIR, file));
  const bytes = new Uint8Array(buf.byteLength);
  bytes.set(buf);
  return { idx: new Uint32Array(bytes.buffer, 0, count), delta: new Float32Array(bytes.buffer, count * 4, count * 3) };
}

suite('golden: face pose units on the default rig', () => {
  it('every unit pose gives MakeHuman\'s bone skinning matrices', async () => {
    const assets = await loadAssets();
    const { rig, units } = await assets.faceAssets();
    const golden = readJsonFile<ExprGolden>(join(GOLDEN_DIR, 'expressions.json'));
    const set0 = golden.sets.find((s) => s.index === 0)!;
    const positions = readFloat32(join(GOLDEN_DIR, 'morph_00.bin'));
    const heads = rig.heads(positions);
    let worst = 0;
    expect(Object.keys(set0.units)).toHaveLength(units.names.length - 1);
    for (const [unit, expected] of Object.entries(set0.units)) {
      const skin = rig.skinMatrices(heads, units.blend([[unit, 1]]));
      rig.rig.bones.forEach((b, i) => {
        const exp = expected[b.name];
        for (let k = 0; k < 16; k++) {
          const want = exp ? exp[k]! : k % 5 === 0 ? 1 : 0;
          worst = Math.max(worst, Math.abs(skin[i * 16 + k]! - want));
        }
      });
    }
    console.info(`[golden] face pose unit matrices: worst element error ${worst.toExponential(3)}`);
    expect(worst).toBeLessThanOrEqual(TOLERANCE_M);
  });

  it(`blended poses deform the base mesh like MakeHuman within ${TOLERANCE_M} m`, async () => {
    const assets = await loadAssets();
    const { rig, units } = await assets.faceAssets();
    const golden = readJsonFile<ExprGolden>(join(GOLDEN_DIR, 'expressions.json'));
    let worst = 0;
    for (const set of golden.sets) {
      const positions = readFloat32(join(GOLDEN_DIR, `morph_${String(set.index).padStart(2, '0')}.bin`));
      const heads = rig.heads(positions);
      for (const [name, c] of Object.entries(set.cases)) {
        const skin = rig.skinMatrices(heads, units.blend(Object.entries(c.blend)));
        const ours = skinDeltas(positions, rig.weights, skin, FaceRig.moving(skin));
        const want = new Float32Array(ours.length);
        const { idx, delta } = readSparse(c.file, c.count);
        idx.forEach((v, i) => want.set(delta.subarray(i * 3, i * 3 + 3), v * 3));
        let max = 0;
        let at = -1;
        for (let k = 0; k < ours.length; k++) {
          const d = Math.abs(ours[k]! - want[k]!);
          if (d > max) [max, at] = [d, Math.floor(k / 3)];
        }
        worst = Math.max(worst, max);
        expect(max, `set ${set.index} ${name}: vertex ${at}`).toBeLessThanOrEqual(TOLERANCE_M);
        // The pose really moves the face (millimetres, not noise).
        let largest = 0;
        for (let k = 0; k < delta.length; k++) largest = Math.max(largest, Math.abs(delta[k]!));
        expect(largest, `${name} moves`).toBeGreaterThan(1e-3);
      }
    }
    console.info(`[golden] expression vertex deltas: worst error ${worst.toExponential(3)} m`);
  });
});

describe('expression map', () => {
  it('covers the PRD default set with valid pose units', async () => {
    const names = EXPRESSION_MAP.expressions.map((e) => e.name);
    for (const n of DEFAULT_EXPRESSIONS) expect(names).toContain(n);
    if (!assetsAvailable) return;
    const { units } = await (await loadAssets()).faceAssets();
    expect(validateExpressionMap(EXPRESSION_MAP, units)).toEqual([]);
  });
});
