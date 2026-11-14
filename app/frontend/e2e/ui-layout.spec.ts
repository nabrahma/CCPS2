/**
 * The workspace (M18, D-149): the top bar, the viewport with its camera bar,
 * the editor (a rail of categories and the chosen one's panel) and the status
 * bar; and that nothing overflows or overlaps at the smallest window. Writes
 * review screenshots to docs/milestones/UI/.
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

const camera = (page: Page) => page.evaluate(() => (window as unknown as TestWindow).__ps2ccTest.useUi.getState().camera);

test('workspace: one category at a time, each with only its own controls, framing its part', async ({ page }) => {
  await boot(page);
  await waitForTestHooks(page);
  await shot(page, 'body');

  // Every category opens its own panel, one selected at a time.
  for (const name of ['Body', 'Face', 'Skin', 'Eyes', 'Brows', 'Lashes', 'Makeup', 'Mouth', 'Hair', 'Clothes', 'Look', 'Export']) {
    await page.getByRole('tab', { name, exact: true }).click();
    await expect(page.getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel', { name, exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { selected: true })).toHaveCount(1);
  }

  // Eyes, brows and lashes are separate places, and each shows only its part.
  await page.getByRole('tab', { name: 'Eyes', exact: true }).click();
  await expect(page.getByTestId('eye-colour')).toBeVisible();
  await expect(page.getByTestId('face-brows')).toHaveCount(0);
  await expect(page.getByTestId('appearance-skins')).toHaveCount(0);
  expect(await camera(page)).toBe('face');
  await shot(page, 'eyes');
  await page.getByRole('tab', { name: 'Brows', exact: true }).click();
  await expect(page.getByTestId('face-brows')).toBeVisible();
  await expect(page.getByTestId('face-lashes')).toHaveCount(0);
  await shot(page, 'brows');
  await page.getByRole('tab', { name: 'Lashes', exact: true }).click();
  await expect(page.getByTestId('face-lashes')).toBeVisible();

  // Mouth opens the mouth (a preview only), so the teeth and tongue can be seen.
  await page.getByRole('tab', { name: 'Mouth', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as TestWindow).__ps2cc.scene.expressionPreview.jawOpen ?? 0), { timeout: 120_000 }).toBeGreaterThan(0.3);
  await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.settled());
  await shot(page, 'mouth');
  await page.getByRole('tab', { name: 'Hair', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as TestWindow).__ps2cc.scene.expressionPreview.jawOpen ?? 0)).toBe(0);
  expect(await camera(page)).toBe('bust');

  // Body and Face: a region menu shows one region's sliders.
  await page.getByRole('tab', { name: 'Face', exact: true }).click();
  await page.getByTestId('region-face').selectOption('Nose');
  const groups = await page.getByRole('tabpanel', { name: 'Face' }).locator('.slider-group summary span').allTextContents();
  expect(groups).toEqual(['Nose']);
  await shot(page, 'face_region');

  // A heart puts a slider in Favourite sliders.
  await page.getByTestId('slider-favourite').first().click();
  await page.getByTestId('region-face').selectOption('\u2665');
  await expect(page.getByRole('tabpanel', { name: 'Face' }).locator('.slider-row')).toHaveCount(1);

  // A worn garment is a row in Clothes: it opens its settings, and its eye hides it in the viewport only.
  await setCharacter(page, {}, { garments: [garment('mh:clothes/male_worksuit01', 'full')] });
  await page.getByRole('tab', { name: 'Clothes', exact: true }).click();
  const row = page.locator('[data-part^="garment:full"]');
  await row.getByTestId('worn-open').click();
  await expect(row.locator('.garment-inspector')).toBeVisible();
  await shot(page, 'clothes_open');
  await row.locator('.icon.vis').click();
  expect(await page.evaluate(() => [...(window as unknown as TestWindow).__ps2cc.viewport!.hiddenParts])).toEqual(['garment:full:mh:clothes/male_worksuit01']);
  expect(await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.engine.doc.garments.length)).toBe(1);
  await row.locator('.icon.vis').click();
  expect(await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.viewport!.hiddenParts.size)).toBe(0);

  // Clicking a part in the viewport opens its category.
  await page.getByRole('tab', { name: 'Look', exact: true }).click();
  await page.evaluate(() => (window as unknown as TestWindow).__ps2ccTest.useUi.getState().select('garment:full:mh:clothes/male_worksuit01'));
  await expect(page.getByRole('tab', { name: 'Clothes', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(row.locator('.garment-inspector')).toBeVisible();
  await page.evaluate(() => (window as unknown as TestWindow).__ps2ccTest.useUi.getState().select('eyes'));
  await expect(page.getByRole('tab', { name: 'Eyes', exact: true })).toHaveAttribute('aria-selected', 'true');

  // The library grids: a search, one plain filter and a favourites star; no tag chips.
  await page.getByRole('tab', { name: 'Hair', exact: true }).click();
  const styles = page.getByTestId('hair-styles');
  await styles.getByTestId('library-filter').selectOption('mesh');
  await expect(styles.locator('[data-entry="hair:mesh:mh:hair/toigo_blunt_bob"] .library-name')).toHaveText('Blunt bob');
  await styles.getByTestId('library-filter').selectOption('long');
  const names = await styles.locator('.library-name').allTextContents();
  expect(names).toEqual(expect.arrayContaining(['Ponytail', 'Long straight']));
  expect(names).not.toContain('Blunt bob');
  await expect(page.locator('[data-testid^="library-tag-"]')).toHaveCount(0);
  await shot(page, 'hair');

  // The rail's foot: the Asset Studio and Settings.
  await page.getByTestId('open-asset-studio').click();
  await expect(page.getByTestId('studio-launcher')).toBeVisible();
  await page.getByTestId('dock-settings').click();
  await expect(page.getByTestId('data-folder')).toBeVisible();
  await expect(page.getByRole('tab', { selected: true })).toHaveCount(1);
  await shot(page, 'settings');

  // The Export button goes to Export.
  await page.getByRole('button', { name: 'Open export settings' }).click();
  await expect(page.getByRole('tab', { name: 'Export', exact: true })).toHaveAttribute('aria-selected', 'true');
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
  // The camera bar is inside the viewport; every category of the rail and its panel fit beside it.
  const [cam, stage, dock, rail] = [await box('.vp-camera'), await box('.stage'), await box('.dock'), await box('.cat-rail')];
  expect(cam.x).toBeGreaterThanOrEqual(stage.x);
  expect(cam.x + cam.width).toBeLessThanOrEqual(dock.x);
  for (const c of await page.locator('.cat-rail .cat').all()) {
    const r = (await c.boundingBox())!;
    expect(r.y + r.height).toBeLessThanOrEqual(rail.y + rail.height + 1);
  }
  const panel = await box('.cat-panel');
  expect(panel.x + panel.width).toBeLessThanOrEqual(1280);
});

test('menus stay open on the way to an item; Esc and a click elsewhere close them', async ({ page }) => {
  await boot(page);
  await waitForTestHooks(page);
  const file = page.getByRole('button', { name: 'File', exact: true });
  await file.click();
  const item = page.locator('.menu-popup').getByRole('button', { name: 'New character', exact: true });
  await expect(item).toBeVisible();
  // Through the gap under the button, out over the viewport and back: still open.
  const b = (await file.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height + 4, { steps: 4 });
  const vp = (await page.getByTestId('viewport').boundingBox())!;
  await page.mouse.move(vp.x + vp.width / 2, vp.y + vp.height / 2, { steps: 6 });
  await page.waitForTimeout(200);
  await expect(item).toBeVisible();
  // Choosing an item runs it and closes the menu.
  await setCharacter(page, { gender: 0.2 });
  page.once('dialog', (d) => void d.accept());
  await item.click();
  await expect(item).toBeHidden();
  expect(await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.engine.doc.macros.gender)).not.toBe(0.2);
  // Hovering another menu name while one is open switches to it.
  await file.click();
  await page.getByRole('button', { name: 'Help', exact: true }).hover();
  await expect(page.getByTestId('menu-credits')).toBeVisible();
  await expect(item).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('menu-credits')).toBeHidden();
  await file.click();
  await page.mouse.click(vp.x + vp.width / 2, vp.y + vp.height / 2);
  await expect(item).toBeHidden();
});

test('baking is your choice: changes mark the bake out of date, Bake bakes, auto-bake is a setting', async ({ page }) => {
  await boot(page);
  await waitForTestHooks(page);
  const status = page.getByTestId('bake-status');
  // A new character has the occlusion bake on (Enhanced), and nothing bakes by itself.
  await expect(status).toHaveText('Not baked');
  await page.waitForTimeout(2500);
  await expect(status).toHaveText('Not baked');
  await page.getByTestId('bake-now').click();
  await expect(status).toHaveText(/Baked in/, { timeout: 120_000 });
  await expect(page.getByTestId('bake-now')).toBeHidden();
  // A change makes it out of date, and it stays so until you bake.
  await setCharacter(page, { gender: 0.3 });
  await expect(status).toHaveText('Bake out of date');
  await page.waitForTimeout(2500);
  await expect(status).toHaveText('Bake out of date');
  // Export → Bake now.
  await page.getByRole('tab', { name: 'Export' }).click();
  await page.getByTestId('export-bake-now').click();
  await expect(status).toHaveText(/Baked in/, { timeout: 120_000 });
  await expect(page.getByTestId('export-bake-now')).toHaveText('Baked');
  // Auto-bake, from Settings, is saved and bakes after a change.
  await page.getByTestId('dock-settings').click();
  const auto = page.getByTestId('settings-auto-bake');
  await expect(auto).not.toBeChecked();
  await auto.check();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ps2cc:settings') ?? '{}').autoBake)).toBe(true);
  await setCharacter(page, { gender: 0.7 });
  await expect(status).toHaveText(/Baked in/, { timeout: 120_000 });
  await auto.uncheck();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ps2cc:settings') ?? '{}').autoBake)).toBe(false);
  await setCharacter(page, { gender: 0.4 });
  await expect(status).toHaveText('Bake out of date');
});
