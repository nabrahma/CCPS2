/**
 * PRD M5 review renders: the 8 starter card hairstyles on the built-in atlas,
 * written to docs/milestones/M5/ for the user to judge.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { boot, MILESTONES, pointOn, setCamera, setCharacter } from './helpers';

const OUT = join(MILESTONES, 'M5');
const STYLES = (JSON.parse(readFileSync(resolve(MILESTONES, '../../packages/core/src/data/hair_styles.json'), 'utf8')) as {
  styles: { id: string; style: Record<string, unknown> }[];
}).styles;
const ONLY = process.env.PS2CC_STYLES?.split(',');

test('M5 review set: starter card hairstyles', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await boot(page);
  await page.getByLabel('Light').selectOption('studio');
  for (const s of STYLES.filter((x) => !ONLY || ONLY.includes(x.id))) {
    const female = ['bob', 'shoulder-straight', 'long-straight', 'ponytail'].includes(s.id);
    await setCharacter(page, { gender: female ? 0 : 1, age: 0.55 }, {
      hair: { mode: 'cards', style: s.style, atlas: null, tint: { color: [0.55, 0.42, 0.32], brightness: 1 }, alphaThreshold: 0.5 },
      garments: [{ slot: 'top', asset: 'mh:clothes/namuhekam_male_polo_shirt', tint: { color: [1, 1, 1], brightness: 1 }, dirt: 0, hideBody: true }],
    });
    for (const cam of ['threeQuarter', 'profile'] as const) {
      await setCamera(page, cam);
      await page.waitForTimeout(900);
      await page.getByTestId('viewport').screenshot({ path: join(OUT, `style_${s.id}_${cam}.png`) });
    }
  }
});

test('card hair in the UI: pick a style, drop an atlas PNG, edit and use it', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await boot(page);
  await setCharacter(page, { gender: 0, age: 0.55 }, {
    garments: [{ slot: 'top', asset: 'mh:clothes/skalldyrssuppe_tube_top_funky_colors', tint: { color: [1, 1, 1], brightness: 1 }, dirt: 0, hideBody: true }],
  });
  await page.getByRole('tab', { name: 'Hair' }).click();
  await page.getByRole('tab', { name: 'Card hair' }).click();
  await expect(page.getByTestId('hair-budget')).toContainText('triangles');
  await page.getByLabel('Style').selectOption('starter:bob');
  await expect(page.getByLabel('Style')).toContainText('Bob');
  await setCamera(page, 'threeQuarter');
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(OUT, 'ui_hair_panel.png') });

  // Drop a 4-strip atlas (alpha strips on transparent) on the hair: the atlas editor opens with 4 regions.
  const at = await pointOn(page, 'hair');
  await page.evaluate(async ({ x, y }) => {
    const c = new OffscreenCanvas(256, 256);
    const ctx = c.getContext('2d')!;
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = ['#6b4a2e', '#7a5634', '#5d3f27', '#866041'][i]!;
      ctx.fillRect(i * 64 + 10, 8, 44, 240);
    }
    const file = new File([await c.convertToBlob({ type: 'image/png' })], 'my_strips.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const target = document.elementFromPoint(x, y)!;
    target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true }));
  }, at);
  const dialog = page.getByRole('dialog', { name: /Hair card atlas/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.atlas-box')).toHaveCount(4);
  await dialog.locator('.atlas-box').first().click();
  await dialog.getByLabel('Tag').selectOption('fringe');
  await page.screenshot({ path: join(OUT, 'ui_atlas_editor.png') });
  await dialog.getByRole('button', { name: 'Save and use' }).click();
  await expect(dialog).toBeHidden();
  const atlas = await page.evaluate(() => (window as unknown as { __ps2cc: { engine: { doc: { hair: { atlas: { texture: string; regions: { tag: string }[] } | null } } } } }).__ps2cc.engine.doc.hair.atlas);
  expect(atlas?.regions).toHaveLength(4);
  expect(atlas?.regions[0]?.tag).toBe('fringe');
  expect(atlas?.texture).toMatch(/^blob:/);
});
