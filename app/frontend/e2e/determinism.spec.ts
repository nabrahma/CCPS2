/**
 * PRD Part 3, 0.2 rule 5: every generator gives the same bytes in the
 * browser engine as in Node. The golden hashes are the ones
 * packages/core/test/determinism.test.ts checks.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { boot, MILESTONES } from './helpers';
import { waitForTestHooks, type TestWindow } from './skin-helpers';

const GOLDEN = resolve(MILESTONES, '../../packages/core/test/fixtures/determinism.json');

test('Part 3 generators give the same hashes in the browser as in Node', async ({ page }) => {
  test.setTimeout(300_000);
  await boot(page);
  await waitForTestHooks(page);
  const hashes = await page.evaluate(async () => {
    const w = window as unknown as TestWindow;
    return w.__ps2ccTest.core.generatorHashes(w.__ps2cc.engine.assets);
  });
  const golden = (JSON.parse(readFileSync(GOLDEN, 'utf8')) as { hashes: Record<string, string> }).hashes;
  expect(hashes).toEqual(golden);
});
