/**
 * The app's layout: navigation, the right column's two views, the headline name,
 * and that nothing overflows at the smallest window. Writes review screenshots
 * to docs/milestones/UI/.
 */
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { boot, garment, MILESTONES, setCharacter } from './helpers';
import { waitForTestHooks } from './skin-helpers';

/** After the hover and selection transitions have finished. */
const shot = async (page: Page, name: string) => {
  await page.waitForTimeout(250);
  await page.screenshot({ path: resolve(MILESTONES, `UI/${name}.png`) });
};

test('navigation, right column and headline', async ({ page }) => {
  await boot(page);
  await waitForTestHooks(page);
  await shot(page, 'body');

  // Sections open in the right column, one active at a time.
  await page.getByRole('tab', { name: 'Hair', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Hair', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: 'Body' })).toHaveAttribute('aria-selected', 'false');
  await expect(page.getByRole('tabpanel', { name: 'Hair' })).toBeVisible();

  // Inspect and back: the section's panel is kept.
  await page.getByRole('tab', { name: 'Wardrobe' }).click();
  await page.getByPlaceholder('Filter garments…').fill('worksuit');
  await page.getByRole('button', { name: 'Inspect' }).click();
  await expect(page.getByText('Click any part of the character')).toBeVisible();
  await page.getByRole('button', { name: 'Controls' }).click();
  await expect(page.getByPlaceholder('Filter garments…')).toHaveValue('worksuit');

  // Choosing a worn garment opens its details; choosing a section returns.
  await setCharacter(page, {}, { garments: [garment('mh:clothes/male_worksuit01', 'full')] });
  await page.locator('.worn-item').first().click();
  await expect(page.locator('.inspector-title')).toHaveText(/worksuit/i);
  await shot(page, 'inspector');
  await page.getByRole('tab', { name: 'Wardrobe' }).click();
  await expect(page.locator('.inspector')).toHaveCount(0);
  await page.getByPlaceholder('Filter garments…').fill('');
  await shot(page, 'wardrobe');

  // The orange button goes to Export.
  await page.getByRole('button', { name: 'Open export settings' }).click();
  await expect(page.getByRole('tab', { name: 'Export' })).toHaveAttribute('aria-selected', 'true');
  await shot(page, 'export');

  // The headline is the name field; the cursor shows unsaved changes.
  const name = page.getByLabel('Character name');
  await name.fill('Jack Mercer');
  await name.press('Enter');
  await expect(page.locator('.name-cursor')).toHaveClass(/dirty/);

  // Collapsing the sidebar leaves icons, and they still work.
  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(page.getByTestId('budget')).toBeHidden();
  await page.getByRole('tab', { name: 'Face' }).click();
  await expect(page.getByRole('tabpanel', { name: 'Face' })).toBeVisible();
  await shot(page, 'collapsed');
  await page.getByRole('button', { name: 'Expand sidebar' }).click();
  await expect(page.getByTestId('budget')).toBeVisible();

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
  const box = (sel: string) => page.locator(sel).first().boundingBox();
  const [top, foot, fab] = [await box('.vp-toolbar.top'), await box('.vp-foot'), await box('.fab')];
  expect(top!.y + top!.height, 'top toolbar above the headline').toBeLessThan(foot!.y);
  expect(foot!.x + foot!.width, 'the action button clears the bottom row').toBeLessThanOrEqual(fab!.x);
  // The bottom toolbar stays on one row, below the character's feet.
  expect((await page.locator('.vp-row').boundingBox())!.height).toBeLessThan(40);
});
