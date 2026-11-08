/**
 * PRD M4 acceptance in the real UI: drop a test PNG on a garment and see it
 * applied; review renders of computed hidden faces and garment collision,
 * written to docs/milestones/M4/.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { boot, garment, MILESTONES, pixelAt, pointOn, setCamera, setCharacter, type Hook } from './helpers';

const OUT = join(MILESTONES, 'M4');

test('drop a PNG on a garment: it is applied', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await boot(page);
  await page.getByLabel('Light').selectOption('studio');
  await setCharacter(page, { gender: 1, age: 0.6 }, { garments: [garment('mh:clothes/male_worksuit01', 'full')] });
  await setCamera(page, 'bust');
  await page.waitForTimeout(1200);
  const at = await pointOn(page, 'garment:');
  const before = await pixelAt(page, at.x, at.y);

  // A solid green 64 x 64 PNG, dropped like a file from Explorer.
  await page.evaluate(async ({ x, y }) => {
    const canvas = new OffscreenCanvas(64, 64);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#00ff00';
    ctx.fillRect(0, 0, 64, 64);
    const file = new File([await canvas.convertToBlob({ type: 'image/png' })], 'test_green.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const target = document.elementFromPoint(x, y)!;
    target.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true }));
  }, at);

  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __ps2cc: Hook }).__ps2cc.engine.doc.garments[0]?.texture ?? null))
    .toMatch(/^blob:/);
  await expect(page.getByText('Applied test_green.png to the garment')).toBeVisible();
  await expect
    .poll(async () => {
      const [r, g, b] = await pixelAt(page, at.x, at.y);
      return g! > r! + 40 && g! > b! + 40;
    }, { timeout: 15_000 })
    .toBe(true);
  const [r, g, b] = before;
  expect(g! > r! + 40 && g! > b! + 40, `garment was already green before the drop: ${before}`).toBe(false);
  await page.getByTestId('viewport').screenshot({ path: join(OUT, 'drop_texture_applied.png') });
});

const REVIEW: { name: string; macros: Record<string, number>; garments: ReturnType<typeof garment>[]; camera: string }[] = [
  // Computed hidden faces (no MakeHuman delete_verts).
  { name: 'computed_polo_cargo_flats', macros: { gender: 1, age: 0.6, weight: 0.6 }, camera: 'full',
    garments: [garment('mh:clothes/namuhekam_male_polo_shirt', 'top'), garment('mh:clothes/cortu_cargo_pants', 'bottom'), garment('mh:clothes/toigo_flats', 'shoes')] },
  // Garment collision: the suit collar is pushed out of the neck most of all.
  { name: 'collision_casualsuit_collar', macros: { gender: 1, age: 0.7, weight: 0.85, muscle: 0.7 }, camera: 'bust',
    garments: [garment('mh:clothes/male_casualsuit01', 'full')] },
  { name: 'collision_halter_top_heavy', macros: { gender: 0, age: 0.6, weight: 0.9, breastSize: 0.9 }, camera: 'bust',
    garments: [garment('mh:clothes/toigo_turtleneck_halter_top', 'top'), garment('mh:clothes/toigo_wool_pants', 'bottom')] },
  // Fishnets must not hide skin.
  { name: 'fishnet_keeps_skin', macros: { gender: 0, age: 0.55 }, camera: 'full',
    garments: [garment('mh:clothes/skalldyrssuppe_tube_top_funky_colors', 'top'), garment('mh:clothes/frankyaye_mini_skirt_01', 'bottom'),
      garment('mh:clothes/v0rt3x_stockings_black_fishnet_medium', 'bottom')] },
];

test('M4 review set: hidden faces and garment collision', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await boot(page);
  await page.getByLabel('Light').selectOption('studio');
  for (const r of REVIEW) {
    await setCharacter(page, r.macros, { garments: r.garments });
    await setCamera(page, r.camera);
    await page.waitForTimeout(1500);
    await page.getByTestId('viewport').screenshot({ path: join(OUT, `review_${r.name}.png`) });
  }
});
