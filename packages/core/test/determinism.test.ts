/**
 * PRD Part 3, 0.2 rule 5: every generator's output hash, checked in Node.
 * `app/frontend/e2e/determinism.spec.ts` checks the same golden file in the
 * browser engine. To accept new hashes after a deliberate change:
 * `PS2CC_UPDATE_HASHES=1 pnpm --filter @ps2cc/core exec vitest run test/determinism.test.ts`.
 */
import { createHash } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { generatorHashes } from '../src/determinism';
import { sha256Hex, Sha256 } from '../src/math/sha256';
import { assetsAvailable, loadAssets, readJsonFile } from './helpers';

const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'determinism.json');
const suite = assetsAvailable ? describe : describe.skip;

describe('SHA-256', () => {
  it('matches the platform hash', () => {
    for (const text of ['', 'abc', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'héllo \u{1f600} wörld '.repeat(40)]) {
      const bytes = new TextEncoder().encode(text);
      const want = createHash('sha256').update(bytes).digest('hex');
      expect(sha256Hex(bytes)).toBe(want);
      expect(new Sha256().updateText(text).hex()).toBe(want);
    }
    const floats = Float64Array.from({ length: 1000 }, (_v, i) => Math.sqrt(i));
    expect(new Sha256().updateArray(floats).hex()).toBe(createHash('sha256').update(new Uint8Array(floats.buffer)).digest('hex'));
  });
});

suite('determinism (PRD Part 3, 0.2)', () => {
  it('every generator gives its golden hash', async () => {
    const assets = await loadAssets();
    const hashes = generatorHashes(assets);
    if (process.env.PS2CC_UPDATE_HASHES || !existsSync(GOLDEN)) {
      writeFileSync(GOLDEN, JSON.stringify({ format: 'ps2cc.determinism/1', hashes }, null, 1) + '\n');
      console.warn('[determinism] wrote', GOLDEN);
    }
    const golden = readJsonFile<{ hashes: Record<string, string> }>(GOLDEN).hashes;
    expect(hashes).toEqual(golden);
    // And again in the same process: nothing depends on what ran before.
    expect(generatorHashes(assets)).toEqual(golden);
  }, 300_000);
});
