/**
 * Review screenshots (PRD M3 acceptance): 6 characters under the Flashlight
 * preset, written to docs/milestones/M3/ for the user to judge, plus a UI
 * smoke test of the main flows.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { boot, MILESTONES, setCharacter, type Hook } from './helpers';

const OUT = join(MILESTONES, 'M3');

const CHARACTERS: { name: string; macros: Record<string, number>; extra?: Record<string, unknown> }[] = [
  { name: 'adult_male', macros: { gender: 1, age: 0.6, muscle: 0.55, weight: 0.5, height: 0.55 } },
  { name: 'adult_female', macros: { gender: 0, age: 0.6, muscle: 0.45, weight: 0.48, height: 0.45 },
    extra: { skin: { base: 'mh:skins/young_caucasian_female', layers: [], photo: null } } },
  { name: 'older_male', macros: { gender: 1, age: 0.93, muscle: 0.4, weight: 0.62 },
    extra: { skin: { base: 'mh:skins/old_caucasian_male', layers: [], photo: null } } },
  { name: 'heavy_male', macros: { gender: 1, age: 0.7, weight: 0.9, muscle: 0.3, african: 0.8, asian: 0.1, caucasian: 0.1 },
    extra: { skin: { base: 'mh:skins/middleage_african_male', layers: [], photo: null } } },
  { name: 'thin_female', macros: { gender: 0, age: 0.55, weight: 0.15, height: 0.35, asian: 0.8, african: 0.1, caucasian: 0.1 },
    extra: { skin: { base: 'mh:skins/young_asian_female', layers: [], photo: null } } },
  { name: 'muscular_male', macros: { gender: 1, age: 0.6, muscle: 0.95, weight: 0.6, height: 0.7 },
    extra: {
      skin: { base: 'mh:skins/young_caucasian_male', layers: [], photo: null },
      garments: [{ slot: 'full', asset: 'mh:clothes/male_worksuit01', tint: { color: [1, 1, 1], brightness: 1 }, dirt: 0.3, hideBody: true }],
      hair: { mode: 'mesh', asset: 'mh:hair/short02', tint: { color: [1, 1, 1], brightness: 1 }, alphaThreshold: 0.5 },
    } },
];

test('M3 review set: 6 characters under the Flashlight preset', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await boot(page);
  await page.getByLabel('Light').selectOption('flashlight');
  for (const c of CHARACTERS) {
    await setCharacter(page, c.macros, c.extra);
    for (const cam of ['full', 'face'] as const) {
      await page.evaluate((cam) => (window as unknown as { __ps2cc: Hook }).__ps2cc.viewport?.setCameraPreset(cam), cam);
      await page.waitForTimeout(1200); // textures stream in
      await page.getByTestId('viewport').screenshot({ path: join(OUT, `flashlight_${c.name}_${cam}.png`) });
    }
  }
});

test('UI smoke: sliders, undo, tabs and budget', async ({ page }) => {
  await boot(page);
  const value = () => page.evaluate(() => (window as unknown as { __ps2cc: Hook }).__ps2cc.engine.value('macrodetails/Gender'));
  const slider = page.locator('input[type="range"]#macrodetails\\/Gender');
  await slider.fill('0.9');
  await expect.poll(value).toBeCloseTo(0.9, 2);
  await page.keyboard.press('Control+z');
  await expect.poll(value).toBeCloseTo(0.5, 2);
  for (const tab of ['Hair', 'Clothes', 'Skin', 'Eyes', 'Brows', 'Lashes', 'Makeup', 'Mouth', 'Look', 'Export', 'Face', 'Body']) {
    await page.getByRole('tab', { name: tab }).click();
  }
  await page.getByRole('tab', { name: 'Clothes' }).click();
  await page.getByTestId('wardrobe-garments').getByTestId('library-search').fill('casualsuit01');
  const before = await page.evaluate(() => (window as unknown as { __ps2cc: Hook }).__ps2cc.scene.budget().total);
  await page.getByRole('button', { name: /male casualsuit01/i }).first().click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __ps2cc: Hook }).__ps2cc.scene.budget().total))
    .not.toBe(before);
  await page.getByRole('tab', { name: 'Body', exact: true }).click();
  await page.screenshot({ path: join(OUT, 'ui_overview.png') });
});
