/**
 * The workspace (M18): the top bar, the viewport with its camera bar and the
 * six creator steps, the dock (Modify with the parts tree, Library, Studio,
 * Settings) and the status bar; and that nothing overflows or overlaps at the
 * smallest window. Writes review screenshots to docs/milestones/UI/.
 */
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { boot, garment, MILESTONES, setCharacter } from './helpers';
import { waitForTestHooks, type TestWindow } from './skin-helpers';

/** After the hover and selection transitions have finished. */
const shot = async (page: Page, name: string) => {
  await page.waitForTimeout(250);
  await page.screenshot({ path: resolve(MILESTONES, `UI/${name}.png`) });
};

test('workspace: steps, parts tree, dock tabs and headline', async ({ page }) => {
  await boot(page);
  await waitForTestHooks(page);
  await shot(page, 'body');

  // The steps open their controls in the dock, one active at a time.
  await page.getByRole('tab', { name: 'Hair', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Hair', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: 'Create' })).toHaveAttribute('aria-selected', 'false');
  await expect(page.getByRole('tabpanel', { name: 'Hair' })).toBeVisible();

  // The parts tree: a face region shows its sliders only, and the step strip follows.
  await page.getByRole('button', { name: 'Expand Head & face' }).click();
  await page.getByTestId('tree-group-Nose').locator('.tree-label').click();
  await expect(page.getByRole('tab', { name: 'Create' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('create-group')).toHaveText(/Nose/);
  const groups = await page.getByRole('tabpanel', { name: 'Face' }).locator('.slider-group summary span').allTextContents();
  expect(groups).toEqual(['Nose']);
  await shot(page, 'tree_region');

  // A heart puts a slider in Favourite sliders.
  await page.getByTestId('slider-favourite').first().click();
  await page.getByTestId('tree-favourites').locator('.tree-label').click();
  await expect(page.getByRole('tabpanel', { name: 'Favourite sliders' }).locator('.slider-row')).toHaveCount(1);

  // A worn garment is a row of the tree: it opens its details, and its eye hides it in the viewport only.
  await setCharacter(page, {}, { garments: [garment('mh:clothes/male_worksuit01', 'full')] });
  const row = page.locator('[data-testid^="tree-part-garment:full"]');
  await row.locator('.tree-label').click();
  await expect(page.locator('.inspector-title')).toHaveText(/worksuit/i);
  await shot(page, 'inspector');
  await row.locator('.tree-eye').click();
  expect(await page.evaluate(() => [...(window as unknown as TestWindow).__ps2cc.viewport!.hiddenParts])).toEqual(['garment:full:mh:clothes/male_worksuit01']);
  expect(await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.engine.doc.garments.length)).toBe(1);
  await row.locator('.tree-eye').click();
  expect(await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.viewport!.hiddenParts.size)).toBe(0);

  // Choosing a step returns from the details.
  await page.getByRole('tab', { name: 'Wardrobe' }).click();
  await expect(page.locator('.inspector')).toHaveCount(0);
  await shot(page, 'wardrobe');

  // The dock's other tabs.
  await page.getByTestId('open-library').click();
  await expect(page.getByTestId('library-browser')).toBeVisible();
  await page.getByTestId('open-asset-studio').click();
  await expect(page.getByTestId('studio-launcher')).toBeVisible();
  await page.getByTestId('dock-settings').click();
  await expect(page.getByTestId('data-folder')).toBeVisible();
  await shot(page, 'settings');

  // The Export button goes to 06 Export.
  await page.getByRole('button', { name: 'Open export settings' }).click();
  await expect(page.getByRole('tab', { name: 'Export' })).toHaveAttribute('aria-selected', 'true');
  await shot(page, 'export');

  // The name field is in the top bar; a dot shows unsaved changes.
  const name = page.getByLabel('Character name');
  await name.fill('Jack Mercer');
  await name.press('Enter');
  await expect(page.locator('.name-cursor')).toHaveClass(/dirty/);

  // The File menu opens over the viewport.
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await expect(page.getByTestId('menu-characters')).toBeVisible();
  await shot(page, 'menu');
});

test('smallest window: every panel fits and no toolbar covers another', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await boot(page);
  await waitForTestHooks(page);
  await shot(page, 'small_window');
  const overflow = await page.evaluate(() => ({ x: document.documentElement.scrollWidth - window.innerWidth, y: document.documentElement.scrollHeight - window.innerHeight }));
  expect(overflow).toEqual({ x: 0, y: 0 });
  const box = async (sel: string) => (await page.locator(sel).first().boundingBox())!;
  // Every top bar control is inside the window, on one row.
  const items = await page.locator('.topbar > *').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ right: r.right, top: r.top, bottom: r.bottom })));
  for (const r of items) {
    expect(r.right).toBeLessThanOrEqual(1280);
    expect(r.bottom).toBeLessThanOrEqual(42);
  }
  // The camera bar and the step strip do not overlap, and the strip is inside the viewport.
  const [cam, steps, stage, dock] = [await box('.vp-camera'), await box('.step-strip'), await box('.stage'), await box('.dock')];
  expect(cam.y + cam.height).toBeLessThan(steps.y);
  expect(steps.x).toBeGreaterThanOrEqual(stage.x);
  expect(steps.x + steps.width).toBeLessThanOrEqual(dock.x);
  expect(steps.height).toBeLessThan(44);
});
