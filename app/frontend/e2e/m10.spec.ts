/**
 * PRD M10 in the app: export the base body, import a garment through the
 * dialog, wear it, delete it. The 50-body fit is in
 * packages/core/test/garment-import.test.ts, reading real files and storing
 * them in `pnpm test:desktop`, the Unity check in `pnpm test:unity`.
 */
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { fixtureGarment } from './garment-helpers';
import { boot, MILESTONES } from './helpers';
import { waitForTestHooks, type TestWindow } from './skin-helpers';

test('imports a garment through the dialog, wears it and deletes it', async ({ page }) => {
  await boot(page);
  await waitForTestHooks(page);
  await page.getByRole('tab', { name: 'Clothes' }).click();
  // Importing and the base body are folded under Your own garments.
  await page.locator('summary', { hasText: 'Your own garments' }).click();

  // The base body downloads as OBJ in the browser build (the desktop app asks where to save it).
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('garment-export-body').click()]);
  expect(download.suggestedFilename()).toBe('ps2cc_base_body.obj');
  const obj = readFileSync(await download.path(), 'utf8');
  expect(obj.split('\n').filter((l) => l.startsWith('v ')).length).toBe(13380);

  const bodyBefore = await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.scene.parts.find((p) => p.kind === 'body')!.indices.length);
  const open = (mesh: ReturnType<typeof fixtureGarment>) => page.evaluate((m) => (window as unknown as TestWindow).__ps2ccTest.useUi.getState().openGarmentImport({ mesh: m }), mesh);

  await open(fixtureGarment('test_shirt'));
  const dialog = page.getByTestId('garment-import-dialog');
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('garment-import-status')).toContainText('10,944 triangles');
  await page.getByTestId('garment-import-name').fill('Field shirt');
  await page.getByTestId('garment-import-slot').selectOption('top');
  await page.getByTestId('garment-import-run').click();
  const report = page.getByTestId('garment-import-report');
  await expect(report).toBeVisible();
  await expect(report).toContainText('1,800 after fitting to the budget');
  await page.screenshot({ path: resolve(MILESTONES, 'M10/ui_import_report.png') });

  await page.getByTestId('garment-import-wear').click();
  await expect(dialog).toBeHidden();
  await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.settled());
  const worn = await page.evaluate(() => {
    const s = (window as unknown as TestWindow).__ps2cc;
    const garment = s.scene.parts.find((p) => p.kind === 'garment')!;
    return { label: garment.label, triangles: garment.triangleCount, body: s.scene.parts.find((p) => p.kind === 'body')!.indices.length, garments: s.scene.budget().garments };
  });
  expect(worn.label).toBe('Field shirt');
  expect(worn.triangles).toBeLessThanOrEqual(1854);
  expect(worn.garments).toBe(worn.triangles);
  expect(worn.body, 'the body under the shirt is hidden').toBeLessThan(bodyBefore);
  const row = page.locator('.asset-row').filter({ hasText: 'Field shirt' });
  await expect(row).toBeVisible();
  await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.viewport?.setCameraPreset('full'));
  await page.screenshot({ path: resolve(MILESTONES, 'M10/ui_wearing_imported.png') });

  // A mesh that is not on the body is refused with a reason, and the dialog stays usable.
  await open(fixtureGarment('test_skirt', 3));
  await page.getByTestId('garment-import-run').click();
  await expect(page.getByTestId('garment-import-problem')).toContainText('does not sit on the PS2CC base body');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();

  await row.getByTestId('garment-delete').click();
  await expect(row).toBeHidden();
  await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.settled());
  expect(await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.engine.doc.garments.length)).toBe(0);
  expect(await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.scene.parts.find((p) => p.kind === 'body')!.indices.length)).toBe(bodyBefore);
});
