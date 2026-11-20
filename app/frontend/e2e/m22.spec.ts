/**
 * PRD Part 3, M22 (pattern programs, F29; Garment Designer Pattern tab, F32) in the app: the Pattern tab builds a
 * program's sewing pattern to the character's measurements and draws it over the viewport; parameters from the
 * design schema change it; a seeded random design repeats; GarmentCode's programs and this project's are both
 * there. The exported SVG opens in the browser with every panel labelled. Review screenshots go to
 * docs/milestones/M22/.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { boot, MILESTONES } from './helpers';
import { waitForTestHooks, type TestWindow } from './skin-helpers';

const OUT = resolve(MILESTONES, 'M22');
mkdirSync(OUT, { recursive: true });

const settled = (page: Page) => page.evaluate(() => (window as unknown as TestWindow).__ps2cc.settled());
const shot = async (page: Page, name: string) => {
  await settled(page);
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(OUT, `${name}.png`) });
};
const built = async (page: Page) => {
  await expect(page.getByTestId('pattern-status')).toContainText('built in', { timeout: 60_000 });
};

test('M22: Pattern tab: programs, parameters, random design, pattern view, SVG export', async ({ page }) => {
  test.setTimeout(300_000);
  await page.addInitScript(() => {
    if (!localStorage.getItem('ps2cc:settings')) localStorage.setItem('ps2cc:settings', JSON.stringify({ firstRunCompleted: true }));
  });
  await boot(page);
  await waitForTestHooks(page);
  await page.evaluate(() => (window as unknown as TestWindow).__ps2ccTest.useUi.getState().openStudio({ kind: 'designer', target: null }));
  await page.getByTestId('designer-tab-pattern').click();
  await expect(page.getByTestId('pattern-designer')).toBeVisible();
  await built(page);
  await expect(page.getByTestId('pattern-status')).toContainText('Every pattern check passes');
  await expect(page.getByTestId('pattern-view')).toBeVisible();
  await expect(page.getByTestId('pattern-view').locator('text=right_ftorso').first()).toBeVisible();
  await shot(page, 'ui_pattern_bomber');

  // A parameter from the schema: a longer jacket changes the pattern.
  const before = await page.getByTestId('pattern-status').innerText();
  await page.getByTestId('pattern-bomber-length').fill('1.4');
  await expect.poll(() => page.getByTestId('pattern-status').innerText()).not.toBe(before);
  await built(page);

  // A seeded random design repeats.
  await page.getByTestId('pattern-seed').fill('2222');
  await page.getByTestId('pattern-random').click();
  await built(page);
  const first = await page.getByTestId('pattern-bomber-width').inputValue();
  await page.getByTestId('pattern-random').click();
  await built(page);
  expect(await page.getByTestId('pattern-bomber-width').inputValue()).toBe(first);

  // Every program builds; GarmentCode's are there too.
  for (const id of ['Coat', 'UtilityVest', 'Hoodie', 'WorkShirt', 'Pants', 'PencilSkirt', 'Shirt']) {
    await page.getByTestId('pattern-program').selectOption(id);
    await built(page);
    if (id === 'WorkShirt' || id === 'Pants' || id === 'Shirt') await shot(page, `ui_pattern_${id.toLowerCase()}`);
  }

  // Export SVG (a download in the browser build) and open it: every panel is labelled.
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('pattern-export-svg').click()]);
  const path = resolve(OUT, 'export_shirt.svg');
  await download.saveAs(path);
  const svg = readFileSync(path, 'utf-8');
  const viewer = await page.context().newPage();
  await viewer.setContent(`<html><body style="margin:0">${svg.replace(/<\?xml[^>]*>/, '').replace(/width="[^"]+cm" height="[^"]+cm"/, 'width="1400"')}</body></html>`);
  const labels = await viewer.locator('g.panel text').allTextContents();
  for (const name of ['right_ftorso', 'right_btorso', 'left_ftorso', 'left_btorso']) expect(labels).toContain(name);
  await viewer.setViewportSize({ width: 1400, height: 900 });
  await viewer.screenshot({ path: resolve(OUT, 'export_shirt_in_browser.png') });
  await viewer.close();

  // .ps2pattern export (a download in the browser build) is the program, design and body.
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByTestId('pattern-export-ps2').click()]);
  const text = readFileSync(await file.path(), 'utf-8');
  const p = JSON.parse(text);
  expect(p.format).toBe('ps2pattern');
  expect(p.program).toBe('Shirt');
  expect(Object.keys(p.pattern.panels).length).toBeGreaterThan(3);
});
