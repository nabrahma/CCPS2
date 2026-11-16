/**
 * PRD Part 3, M19 (body control) in the app: the measurement readout and
 * units, typed measurements and Fit body (one undo step, saved with the
 * character), Realistic random with locks, the asymmetry sliders and the
 * Crowd Studio. Review screenshots go to docs/milestones/M19/.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { boot, MILESTONES } from './helpers';
import { waitForTestHooks, type TestWindow } from './skin-helpers';

const OUT = resolve(MILESTONES, 'M19');
mkdirSync(OUT, { recursive: true });

type Doc = TestWindow['__ps2cc']['engine']['doc'];
const doc = (page: Page) => page.evaluate(() => structuredClone((window as unknown as TestWindow).__ps2cc.engine.doc) as unknown as Doc);
const settled = (page: Page) => page.evaluate(() => (window as unknown as TestWindow).__ps2cc.settled());
const measure = (page: Page, ids: string[]) =>
  page.evaluate((ids) => {
    const s = (window as unknown as TestWindow).__ps2cc;
    const m = s.assets.anthro.measure(s.engine.positions) as unknown as Record<string, number>;
    return Object.fromEntries(ids.map((id) => [id, m[id]!]));
  }, ids);
const shot = async (page: Page, name: string) => {
  await settled(page);
  await page.waitForTimeout(250);
  await page.screenshot({ path: resolve(OUT, `${name}.png`) });
};

async function bootApp(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (!localStorage.getItem('ps2cc:settings')) localStorage.setItem('ps2cc:settings', JSON.stringify({ firstRunCompleted: true }));
  });
  await boot(page);
  await waitForTestHooks(page);
}

test('M19: measurements, fit to typed measurements, units, undo, save and load', async ({ page }) => {
  test.setTimeout(300_000);
  await bootApp(page);
  await page.getByTestId('cat-body').click();
  const panel = page.getByTestId('measurements');
  await expect(panel).toBeVisible();
  const readout = page.getByTestId('measure-readout');
  await expect(readout.locator('[data-measure="height"]')).toContainText('cm');
  await expect(readout.locator('[data-measure="waist"]')).toContainText('cm');

  // Inches, kept for the next session.
  await page.getByTestId('units-in').check();
  await expect(readout.locator('[data-measure="height"]')).toContainText(' in');
  expect(await page.evaluate(() => localStorage.getItem('ps2cc.units'))).toBe('in');
  await page.getByTestId('units-cm').check();

  // Type targets and fit.
  await page.getByTestId('measure-targets').locator('summary').click();
  await page.getByTestId('measure-target-height').fill('178');
  await page.getByTestId('measure-target-height').press('Enter');
  await page.getByTestId('measure-target-bust').fill('102');
  await page.getByTestId('measure-target-bust').press('Enter');
  await page.getByTestId('measure-target-waist').fill('84');
  await page.getByTestId('measure-target-waist').press('Enter');
  expect((await doc(page)).measurementTargets).toEqual({ height: 178, bust: 102, waist: 84 });
  const before = await doc(page);
  await page.getByTestId('measure-fit').click();
  await expect(page.getByTestId('measure-result')).toContainText('All 3 reached', { timeout: 60_000 });
  const got = await measure(page, ['height', 'bust', 'waist']);
  expect(Math.abs(got.height! - 178)).toBeLessThan(0.5);
  expect(Math.abs(got.bust! - 102)).toBeLessThan(0.5);
  expect(Math.abs(got.waist! - 84)).toBeLessThan(0.5);
  const fitted = await doc(page);
  expect(fitted.macros.gender).toBe(before.macros.gender);
  expect(fitted.macros.age).toBe(before.macros.age);
  await shot(page, 'ui_measurements_fit');

  // One undo step, and redo.
  await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.engine.undo());
  expect((await doc(page)).macros).toEqual(before.macros);
  await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.engine.redo());
  expect((await doc(page)).macros).toEqual(fitted.macros);

  // The targets and the body are saved with the character.
  const back = await page.evaluate(() => {
    const w = window as unknown as TestWindow;
    const core = w.__ps2ccTest.core;
    return core.parseCharacter(JSON.parse(core.serializeCharacter(w.__ps2cc.engine.doc as never)));
  });
  expect(back.measurementTargets).toEqual({ height: 178, bust: 102, waist: 84 });
  expect(back.modifiers).toEqual(fitted.modifiers);

  // An impossible target is shown as out of reach.
  await page.getByTestId('measure-target-height').fill('395');
  await page.getByTestId('measure-target-height').press('Enter');
  await page.getByTestId('measure-fit').click();
  await expect(page.getByTestId('measure-miss-height')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('measure-result')).toContainText('cannot be reached');
  await shot(page, 'ui_measurements_out_of_reach');
  await page.getByTestId('measure-clear').click();
  expect((await doc(page)).measurementTargets).toBeUndefined();
});

test('M19: realistic random bodies and faces, locks, asymmetry sliders', async ({ page }) => {
  test.setTimeout(300_000);
  await bootApp(page);
  await page.getByTestId('cat-body').click();
  // Lock the gender slider, then roll a few people.
  const genderRow = page.locator('.slider-row', { has: page.locator('label', { hasText: /^Gender/ }) });
  await genderRow.getByTitle('Lock for randomize').click();
  const gender = (await doc(page)).macros.gender;
  const heights: number[] = [];
  for (let i = 0; i < 5; i++) {
    await page.getByTestId('realistic-body').click();
    await settled(page);
    const d = await doc(page);
    expect(d.macros.gender).toBe(gender);
    expect(d.macros.age).toBeGreaterThanOrEqual(0.354);
    heights.push((await measure(page, ['height'])).height!);
  }
  expect(new Set(heights.map((h) => h.toFixed(1))).size).toBeGreaterThan(1);
  for (const h of heights) {
    expect(h).toBeGreaterThan(130);
    expect(h).toBeLessThan(215);
  }
  await shot(page, 'ui_realistic_body');

  // The face: asymmetry sliders exist, and realistic random sets them a little.
  await page.getByTestId('cat-face').click();
  await page.getByTestId('sliders-all').check();
  await page.getByTestId('region-face').selectOption('Asymmetry');
  await expect(page.locator('.slider-row', { hasText: 'Eye 1' }).first()).toBeVisible();
  await page.getByTestId('realistic-face').click();
  await settled(page);
  const asym = Object.entries((await doc(page)).modifiers).filter(([k]) => k.startsWith('asym/'));
  expect(asym.length).toBeGreaterThan(10);
  for (const [, v] of asym) expect(Math.abs(v)).toBeLessThanOrEqual(0.18);
  await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.viewport?.setCameraPreset('face'));
  await shot(page, 'ui_asymmetry');
});

test('M19: Crowd Studio makes the same people from a seed, previews one and saves them all', async ({ page }) => {
  test.setTimeout(600_000);
  await bootApp(page);
  await page.evaluate(() => (window as unknown as TestWindow).__ps2ccTest.useUi.getState().openStudio({ kind: 'crowd', target: null }));
  const crowd = page.getByTestId('crowd-studio');
  await expect(crowd).toBeVisible();
  await page.getByTestId('crowd-seed').fill('4242');
  await page.getByTestId('crowd-count').fill('8');
  await page.getByTestId('crowd-prefix').fill('Villager');
  const members = page.getByTestId('crowd-member');
  await expect(members).toHaveCount(8);
  const names = await members.allTextContents();
  // The same seed with more people keeps the first eight.
  await page.getByTestId('crowd-count').fill('12');
  await expect(members).toHaveCount(12);
  expect((await members.allTextContents()).slice(0, 8)).toEqual(names);
  await page.getByTestId('crowd-count').fill('8');
  await members.nth(2).click();
  await settled(page);
  const shown = await doc(page);
  expect(shown.name).toBe('Villager 003');
  expect(shown.garments.length).toBeGreaterThan(0);
  await shot(page, 'ui_crowd');
  // Save all: each one goes to the data folder (local storage in browser mode); the open character comes back.
  const saved = await page.evaluate(() => {
    const w = window as unknown as Window & { __saved?: string[] };
    w.__saved = [];
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k: string, v: string) {
      if (k === 'ps2cc:last') w.__saved!.push((JSON.parse(v) as { name: string }).name);
      return original.call(this, k, v);
    };
    return true;
  });
  expect(saved).toBe(true);
  await page.getByTestId('crowd-save').click();
  await expect(page.getByTestId('crowd-busy')).toHaveCount(0, { timeout: 120_000 });
  const names2 = await page.evaluate(() => (window as unknown as { __saved: string[] }).__saved);
  expect(names2).toEqual(Array.from({ length: 8 }, (_v, i) => `Villager ${String(i + 1).padStart(3, '0')}`));
  writeFileSync(resolve(OUT, 'crowd_report.json'), `${JSON.stringify({ seed: 4242, people: names }, null, 2)}\n`);
});
