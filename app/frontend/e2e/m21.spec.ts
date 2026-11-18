/**
 * PRD Part 3, M21 (shell garments, F28; Garment Designer Shell tab, F32) in
 * the app: the Designer's live preview worn by the character, templates,
 * parameters, a seeded random design, a hem handle dragged in the viewport,
 * Save to Wardrobe (a library garment that records its template and
 * parameters), opening it in the Designer again, and keeping a design on the
 * character only. Review screenshots go to docs/milestones/M21/.
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { boot, MILESTONES } from './helpers';
import { waitForTestHooks, type TestWindow } from './skin-helpers';

const OUT = resolve(MILESTONES, 'M21');
mkdirSync(OUT, { recursive: true });

type Doc = TestWindow['__ps2cc']['engine']['doc'];
const doc = (page: Page) => page.evaluate(() => structuredClone((window as unknown as TestWindow).__ps2cc.engine.doc) as unknown as Doc);
const settled = (page: Page) => page.evaluate(() => (window as unknown as TestWindow).__ps2cc.settled());
const shot = async (page: Page, name: string) => {
  await settled(page);
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(OUT, `${name}.png`) });
};
const openDesigner = (page: Page, target: string | null) =>
  page.evaluate((target) => (window as unknown as TestWindow).__ps2ccTest.useUi.getState().openStudio({ kind: 'designer', target }), target);
const generated = async (page: Page) => {
  await expect(page.getByTestId('designer-status')).toContainText('Generated in', { timeout: 60_000 });
};

async function bootApp(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (!localStorage.getItem('ps2cc:settings')) localStorage.setItem('ps2cc:settings', JSON.stringify({ firstRunCompleted: true }));
  });
  await boot(page);
  await waitForTestHooks(page);
}

test('M21: Garment Designer: preview, parameters, random design, hem handle, save, open again, keep on the character', async ({ page }) => {
  test.setTimeout(300_000);
  await bootApp(page);
  await openDesigner(page, null);
  await expect(page.getByTestId('garment-designer')).toBeVisible();
  await generated(page);
  // The preview is worn, in the template's slot.
  let d = await doc(page);
  const preview = d.garments.find((g) => g.asset.startsWith('preview:designer/'));
  expect(preview?.slot).toBe('top');
  await shot(page, 'ui_designer_tshirt');

  // Another template: the preview changes to it (still one preview).
  await page.getByTestId('designer-template').selectOption('straighttrousers');
  await expect.poll(async () => (await doc(page)).garments.filter((g) => g.asset.startsWith('preview:designer/')).map((g) => g.slot)).toEqual(['bottom']);
  await generated(page);

  // A parameter: shorter legs.
  await page.getByTestId('designer-length').fill('60');
  await expect(page.getByTestId('designer-length')).toHaveValue('60');
  await generated(page);

  // A hem handle in the viewport: dragging the hem down makes the legs longer.
  const handle = page.getByTestId('hem-handle-length');
  await expect(handle).toBeVisible({ timeout: 30_000 });
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 40, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => Number(await page.getByTestId('designer-length').inputValue())).toBeGreaterThan(60);
  await generated(page);
  await shot(page, 'ui_designer_handles');

  // A seeded random design: the same seed, the same design.
  await page.getByTestId('designer-seed').fill('2121');
  await page.getByTestId('designer-random').click();
  const first = await page.getByTestId('designer-length').inputValue();
  await page.getByTestId('designer-random').click();
  expect(await page.getByTestId('designer-length').inputValue()).toBe(first);
  await generated(page);

  // Save to Wardrobe: a library garment, worn in place of the preview, with its template and parameters.
  await page.getByTestId('designer-name').fill('Test trousers');
  await page.getByTestId('designer-save').click();
  await expect(page.getByTestId('garment-designer')).toHaveCount(0, { timeout: 60_000 });
  d = await doc(page);
  expect(d.garments.some((g) => g.asset.startsWith('preview:'))).toBe(false);
  const saved = d.garments.find((g) => g.slot === 'bottom')!;
  expect(saved.asset.startsWith('user:garment/')).toBe(true);
  const meta = await page.evaluate(async (id) => {
    const s = (window as unknown as TestWindow).__ps2cc;
    const p = await s.assets.proxy(id);
    return { name: p.meta.name, generator: p.meta.generator, tags: s.assets.proxyInfo(id).tags };
  }, saved.asset);
  expect(meta.name).toBe('Test trousers');
  expect(meta.generator?.template).toBe('straighttrousers');
  expect(meta.tags).toContain('generated');
  await shot(page, 'ui_designer_saved');

  // Opened again: the Designer comes back with its template and parameters.
  await openDesigner(page, `garment:bottom:${saved.asset}`);
  await expect(page.getByTestId('designer-template')).toHaveValue('straighttrousers');
  await expect(page.getByTestId('designer-name')).toHaveValue('Test trousers');
  await generated(page);
  await page.getByTestId('designer-template').selectOption('beanie');
  await generated(page);
  // Kept on this character only: a garment edit that remembers it was designed.
  await page.getByTestId('designer-keep').click();
  await expect(page.getByTestId('garment-designer')).toHaveCount(0, { timeout: 60_000 });
  d = await doc(page);
  const kept = d.garments.find((g) => g.slot === 'hat')!;
  expect(kept.asset.startsWith('edit:')).toBe(true);
  expect(d.garmentEdits?.[kept.asset]?.base).toBe('shell:beanie');
  await shot(page, 'ui_designer_kept');
});
