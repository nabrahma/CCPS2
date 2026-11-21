/**
 * PRD Part 3, M23 (drape and garment asset, F30, F31; Garment Designer Pattern tab, F32) in the app: the 3D
 * view shows the panels placed around the body; Drape sews and settles them on the character with progress
 * and Cancel, builds the game garment and wears it; Save to Wardrobe makes a library garment that records its
 * program and design and carries its fold bake; opening it again goes to the Pattern tab; Re-drape on this
 * body drapes it again and keeps it on the character. Review screenshots go to docs/milestones/M23/.
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { boot, MILESTONES } from './helpers';
import { waitForTestHooks, type TestWindow } from './skin-helpers';

const OUT = resolve(MILESTONES, 'M23');
mkdirSync(OUT, { recursive: true });

const settled = (page: Page) => page.evaluate(() => (window as unknown as TestWindow).__ps2cc.settled());
const shot = async (page: Page, name: string) => {
  await settled(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: resolve(OUT, `${name}.png`) });
};
const built = async (page: Page) => {
  await expect(page.getByTestId('pattern-status')).toContainText('built in', { timeout: 60_000 });
};
const camera = (page: Page, preset: string) => page.evaluate((p) => (window as unknown as TestWindow).__ps2cc.viewport?.setCameraPreset(p as never), preset);

test('M23: placed panels, Drape with progress and Cancel, Save to Wardrobe, open again, Re-drape', async ({ page }) => {
  test.setTimeout(600_000);
  await page.addInitScript(() => {
    if (!localStorage.getItem('ps2cc:settings')) localStorage.setItem('ps2cc:settings', JSON.stringify({ firstRunCompleted: true }));
  });
  await boot(page);
  await waitForTestHooks(page);
  await page.evaluate(() => (window as unknown as TestWindow).__ps2ccTest.useUi.getState().openStudio({ kind: 'designer', target: null }));
  await page.getByTestId('designer-tab-pattern').click();
  await built(page);

  // The 3D view: panels placed around the body.
  await page.getByTestId('pattern-view-3d').click();
  await expect(page.getByTestId('pattern-view')).toHaveCount(0);
  await shot(page, 'ui_placed_bomber');

  // Drape, cancelled part way.
  await page.getByTestId('pattern-drape').click();
  await expect(page.getByTestId('pattern-drape-progress')).toBeVisible();
  await page.getByTestId('pattern-drape-cancel').click();
  await expect(page.getByTestId('pattern-drape')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('pattern-drape-status')).toHaveCount(0);

  // Drape to the end: the garment is built and worn.
  const t0 = Date.now();
  await page.getByTestId('pattern-drape').click();
  await expect(page.getByTestId('pattern-drape-status')).toContainText('Draped in', { timeout: 120_000 });
  const drapeSeconds = (Date.now() - t0) / 1000;
  console.log(`Bomber draped in the app in ${drapeSeconds.toFixed(1)} s: ${await page.getByTestId('pattern-drape-status').innerText()}`);
  const worn = await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.engine.doc.garments.map((g) => g.asset));
  expect(worn.some((a) => a.startsWith('preview:pattern/'))).toBe(true);
  // Only the drape: no preview left behind by the Shell tab the Designer opened on.
  expect(worn).toHaveLength(1);
  await camera(page, 'full');
  await shot(page, 'ui_draped_bomber');
  await camera(page, 'back');
  await shot(page, 'ui_draped_bomber_back');

  // Save to Wardrobe: a library garment with its program, design and fold texture.
  await page.getByTestId('pattern-name').fill('Test bomber');
  await page.getByTestId('pattern-save-library').click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as TestWindow).__ps2cc.engine.doc.garments.some((g) => g.asset.startsWith('user:garment/'))), { timeout: 30_000 })
    .toBe(true);
  const info = await page.evaluate(async () => {
    const s = (window as unknown as TestWindow).__ps2cc;
    const g = s.engine.doc.garments.find((x) => x.asset.startsWith('user:garment/'))!;
    const proxy = await s.assets.proxy(g.asset);
    return { slot: g.slot, asset: g.asset, gen: proxy.meta.generator, fold: !!proxy.meta.material?.foldTexture, name: proxy.meta.name, look: !!g.look };
  });
  expect(info.gen?.kind).toBe('pattern');
  expect(info.gen?.template).toBe('Bomber');
  expect(info.fold).toBe(true);
  expect(info.look).toBe(true);
  expect(info.name).toBe('Test bomber');
  await camera(page, 'full');
  await shot(page, 'ui_saved_bomber');

  // Opened again from Clothes: the Pattern tab, with its program.
  await page.evaluate((target) => (window as unknown as TestWindow).__ps2ccTest.useUi.getState().openStudio({ kind: 'designer', target }), `garment:${info.slot}:${info.asset}`);
  await expect(page.getByTestId('pattern-designer')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('pattern-program')).toHaveValue('Bomber');
  await expect(page.getByTestId('pattern-name')).toHaveValue('Test bomber');
  await page.evaluate(() => (window as unknown as TestWindow).__ps2ccTest.useUi.getState().closeStudio());

  // Re-drape on this body (another body shape): kept on the character, in place of the bound garment.
  await page.evaluate(async () => {
    const s = (window as unknown as TestWindow).__ps2cc;
    s.engine.update('macros', (d) => void (d.macros = { ...d.macros, weight: 0.85, muscle: 0.3 }));
    await s.settled();
  });
  const kept = await page.evaluate(async (asset) => {
    const s = (window as unknown as TestWindow).__ps2cc;
    const id = await s.redrapeGarment(asset);
    await s.settled();
    return { id, edits: Object.keys(s.engine.doc.garmentEdits ?? {}), worn: s.engine.doc.garments.map((g) => g.asset) };
  }, info.asset);
  expect(kept.id).not.toBeNull();
  expect(kept.edits).toContain(kept.id);
  expect(kept.worn).toContain(kept.id);
  expect(kept.worn).not.toContain(info.asset);
  await shot(page, 'ui_redraped_bomber');
});
