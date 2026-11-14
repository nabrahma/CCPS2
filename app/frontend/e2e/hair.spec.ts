/**
 * The card hair system (docs/hair-system.md) in the real app: the styles made
 * for the reference images, rendered for review to docs/milestones/Hair/, and
 * the Hair panel's texture picker, groom and card build controls.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { boot, MILESTONES, setCamera, setCharacter } from './helpers';
import { waitForTestHooks, type TestWindow } from './skin-helpers';

const OUT = join(MILESTONES, 'Hair');
const STYLES = (JSON.parse(readFileSync(resolve(MILESTONES, '../../packages/core/src/data/hair_styles.json'), 'utf8')) as {
  styles: { id: string; style: Record<string, unknown> }[];
}).styles;
const style = (id: string) => STYLES.find((s) => s.id === id)!.style;
const white = { color: [1, 1, 1], brightness: 1 };
const shirt = [{ slot: 'top', asset: 'mh:clothes/namuhekam_male_polo_shirt', tint: { color: [0.25, 0.25, 0.27], brightness: 1 }, dirt: 0, hideBody: true }];

async function wear(page: Page, id: string, colour: string, female: boolean): Promise<void> {
  const atlas = await page.evaluate(
    (c) => (window as unknown as TestWindow).__ps2cc.assets.catalog.hairAtlases!.find((a) => a.id === `ps2cc:atlas/cards_${c}`)!.atlas,
    colour,
  );
  await setCharacter(page, { gender: female ? 0 : 1, age: 0.5 }, { hair: { mode: 'cards', style: style(id), atlas, tint: white, alphaThreshold: 0.5 }, garments: shirt });
}

test('hair review: the styles made for the reference images', async ({ page }) => {
  test.setTimeout(300_000);
  mkdirSync(OUT, { recursive: true });
  await boot(page);
  await waitForTestHooks(page);
  await page.getByLabel('Light').selectOption('studio');
  const looks: [string, string, boolean][] = [
    ['long-centre-part', 'black', true],
    ['bob-fringe', 'auburn', true],
    ['short-sideburns', 'brown', false],
  ];
  for (const [id, colour, female] of looks) {
    await wear(page, id, colour, female);
    const info = await page.evaluate(async () => {
      const s = (window as unknown as TestWindow).__ps2cc;
      await s.settled();
      const hair = s.scene.parts.find((p) => p.kind === 'hair')!;
      return { triangles: hair.triangleCount, total: s.scene.budget().total, volume: Boolean(hair.material.volumeNormals), hairBudget: s.engine.doc.export.hairBudget };
    });
    // Each is inside the hair budget (the style's 1,500 to 3,500, scaled to the profile's hair budget) and uses the soft volume shading.
    const f = info.hairBudget / 3500;
    expect(info.triangles, id).toBeGreaterThanOrEqual(Math.round(1500 * f));
    expect(info.triangles, id).toBeLessThanOrEqual(info.hairBudget);
    expect(info.volume, id).toBe(true);
    for (const cam of ['bust', 'threeQuarter', 'profile'] as const) {
      await setCamera(page, cam);
      await page.waitForTimeout(900);
      await page.getByTestId('viewport').screenshot({ path: join(OUT, `${id}_${cam}.png`) });
    }
  }
  await page.getByRole('tab', { name: 'Hair', exact: true }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, 'ui_hair_panel.png') });
});

test('hair panel: card texture picker, groom and card build controls', async ({ page }) => {
  await boot(page);
  await waitForTestHooks(page);
  await wear(page, 'long-centre-part', 'brown', true);
  // Every hair setting is in Hair Studio (Part 2 F20).
  await page.getByRole('tab', { name: 'Hair', exact: true }).click();
  await page.getByTestId('open-hair-studio').click();
  const doc = () => page.evaluate(() => (window as unknown as TestWindow).__ps2cc.engine.doc.hair);
  const hairPositions = () =>
    page.evaluate(async () => {
      const s = (window as unknown as TestWindow).__ps2cc;
      await s.settled();
      const p = s.scene.parts.find((x) => x.kind === 'hair')!;
      let sum = 0;
      for (let i = 0; i < p.positions.length; i += 7) sum += p.positions[i]! * (1 + (i % 13));
      return { sum, volume: Boolean(p.material.volumeNormals), texture: p.material.texture };
    });

  // Texture: another built-in colour, then back to the default (stored as "no atlas of its own").
  await page.getByTestId('hair-atlas').selectOption('ps2cc:atlas/cards_black');
  await expect.poll(async () => (await doc()).atlas?.texture).toBe('textures/hair/cards_black.png');
  expect((await hairPositions()).texture).toBe('textures/hair/cards_black.png');
  await page.getByTestId('hair-atlas').selectOption('ps2cc:atlas/cards_brown');
  await expect.poll(async () => (await doc()).atlas ?? null).toBeNull();
  expect((await hairPositions()).texture).toBe('textures/hair/cards_brown.png');

  // The groom and card build sections are there, and their settings change the hair.
  for (const label of ['Guides', 'Clump', 'Frizz', 'Random tip twist', 'Root snap', 'Soft shading', 'Parting lift']) {
    await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
  }
  const before = await hairPositions();
  expect(before.volume).toBe(true);
  const set = (fn: string) =>
    page.evaluate((body) => {
      const s = (window as unknown as TestWindow).__ps2cc;
      s.engine.update('e2e hair', new Function('d', body) as (d: unknown) => void);
    }, fn);
  await set('d.hair.style.groom.clump = 0.95; d.hair.style.groom.clumpShape = 0.3;');
  const clumped = await hairPositions();
  expect(clumped.sum).not.toBe(before.sum);
  await set('d.hair.style.build.normalFromSurface = 0;');
  expect((await hairPositions()).volume).toBe(false);
  // One undo step each.
  await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.engine.undo());
  expect((await hairPositions()).volume).toBe(true);
});
