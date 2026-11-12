/**
 * PRD Part 2 M11 (look foundation) in the real app: quality profiles, the
 * per-pixel renderer with shadows, the looks with their grades, written to
 * docs/milestones/M11/ for review.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { boot, garment, MILESTONES, setCamera, setCharacter } from './helpers';
import { waitForTestHooks, type TestWindow } from './skin-helpers';

const OUT = join(MILESTONES, 'M11');

const outfit = [
  garment('mh:clothes/namuhekam_male_polo_shirt', 'top', { tint: { color: [0.32, 0.3, 0.27], brightness: 1 } }),
  garment('mh:clothes/cortu_cargo_pants', 'bottom', { tint: { color: [0.35, 0.33, 0.28], brightness: 1 } }),
];

async function useProfile(page: Page, profile: 'classic' | 'enhanced' | 'hero'): Promise<void> {
  await page.evaluate(async (id) => {
    const s = (window as unknown as TestWindow).__ps2cc;
    const core = (window as unknown as TestWindow).__ps2ccTest.core;
    s.engine.update(`profile ${id}`, (d) => {
      d.export = { ...d.export, ...core.profileSettings(id) };
      d.bodyMesh = core.bodyMeshFor(id);
      core.withBakeLayers(d);
    });
    await s.settled();
    // The test GPU is a CPU: bake smaller maps with fewer rays than the app does.
    s.bakeOverride = { size: 512, rays: 32 };
    await s.runBake();
    await s.settled();
  }, profile);
}

async function useLook(page: Page, look: string): Promise<void> {
  await page.getByLabel('Light').selectOption(look);
  await page.evaluate(async () => {
    const s = (window as unknown as TestWindow).__ps2cc;
    await s.viewport!.lookReady();
  });
  await page.waitForTimeout(700);
}

test('M11 review: looks and quality profiles', async ({ page }) => {
  test.setTimeout(1_200_000);
  mkdirSync(OUT, { recursive: true });
  await boot(page);
  await waitForTestHooks(page);
  const style = await page.evaluate(() => (window as unknown as TestWindow).__ps2ccTest.core.starterStyle('short-messy'));
  await setCharacter(page, { gender: 1, age: 0.5 }, {
    garments: outfit,
    hair: { mode: 'cards', style, atlas: null, tint: { color: [1, 1, 1], brightness: 1 }, alphaThreshold: 0.5 },
  });
  for (const profile of ['classic', 'enhanced', 'hero'] as const) {
    await useProfile(page, profile);
    for (const look of ['studio', 'studioPortrait', 'foggyTown', 'villageOvercast', 'interiorFlashlight']) {
      await useLook(page, look);
      for (const cam of ['threeQuarter', 'full']) {
        await setCamera(page, cam);
        await page.waitForTimeout(500);
        await page.getByTestId('viewport').screenshot({ path: join(OUT, `look_${look}_${profile}_${cam}.png`) });
      }
    }
  }
  await page.getByTestId('budget').screenshot({ path: join(OUT, 'ui_budget_hero.png') });
  // The bake on and off, Enhanced, side by side for review.
  await useProfile(page, 'enhanced');
  await useLook(page, 'studioPortrait');
  for (const cam of ['bust', 'back']) {
    await setCamera(page, cam);
    await page.waitForTimeout(500);
    await page.getByTestId('viewport').screenshot({ path: join(OUT, `bake_on_${cam}.png`) });
  }
  expect(await page.getByTestId('bake-status').textContent()).toMatch(/Baked in/);
  await page.evaluate(async () => {
    const s = (window as unknown as TestWindow).__ps2cc;
    s.engine.update('no bake', (d) => {
      d.export.bakeAO = false;
    });
    await s.settled();
    await s.runBake();
    await s.settled();
  });
  for (const cam of ['bust', 'back']) {
    await setCamera(page, cam);
    await page.waitForTimeout(500);
    await page.getByTestId('viewport').screenshot({ path: join(OUT, `bake_off_${cam}.png`) });
  }
});

test('quality profiles: the Export panel sets every budget at once, and overrides show', async ({ page }) => {
  await boot(page);
  await waitForTestHooks(page);
  const ex = () => page.evaluate(() => (window as unknown as TestWindow).__ps2cc.engine.doc.export);
  // New characters start Enhanced (Part 2 principle 2).
  expect(await ex()).toMatchObject({ profile: 'enhanced', triangleBudget: 20000, hairBudget: 6000, lighting: 'pixel', bakeAO: true });
  expect(await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.engine.doc.bodyMesh)).toBe('ps2_body_12k');
  await page.getByRole('tab', { name: 'Export' }).click();
  await page.getByTestId('export-profile').selectOption('hero');
  expect(await ex()).toMatchObject({ profile: 'hero', triangleBudget: 30000, headTexture: 2048, shadows: 'self' });
  expect(await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.engine.doc.bodyMesh)).toBe('ps2_body_16k');
  await expect(page.getByTestId('profile-reset')).toHaveCount(0);
  await page.locator('#export-headTexture').selectOption('1024');
  await expect(page.getByTestId('profile-description')).toContainText('head texture');
  await page.getByTestId('profile-reset').click();
  expect((await ex()).headTexture).toBe(2048);
  await page.getByTestId('export-profile').selectOption('classic');
  expect(await ex()).toMatchObject({ profile: 'classic', triangleBudget: 12000, headTexture: 512, lighting: 'vertex', bakeLight: true });
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: join(OUT, 'ui_export_profiles.png') });
  // One undo step per profile change.
  await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.engine.undo());
  expect((await ex()).profile).toBe('hero');
});
