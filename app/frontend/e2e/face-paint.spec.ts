/**
 * Painted eyebrows and eyelashes (D-146): new characters have them on the
 * skin and no brow or lash geometry; the Brows and Lashes panels turn them
 * on and off and set them; a character saved with the old meshes switches with one click.
 * Writes review images to docs/milestones/Face/.
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { boot, MILESTONES, setCharacter } from './helpers';
import { waitForTestHooks, type TestWindow } from './skin-helpers';

const OUT = resolve(MILESTONES, 'Face');

const frame = async (page: Page, name: string, f: { targetHeight: number; span: number; yaw: number; pitch: number }) => {
  await page.evaluate(async (f) => {
    const s = (window as unknown as TestWindow).__ps2cc;
    await s.settled();
    s.viewport!.setCameraFrame(f);
  }, f);
  await page.waitForTimeout(700);
  await page.getByTestId('viewport').screenshot({ path: resolve(OUT, `${name}.png`) });
};

const layer = (page: Page, kind: string) =>
  page.evaluate((kind) => (window as unknown as TestWindow).__ps2cc.engine.doc.skin.layers.find((l) => l.kind === kind) ?? null, kind);

test('painted brows and lashes: no geometry, each in its own panel, old meshes switch in one click', async ({ page }) => {
  test.setTimeout(300_000);
  mkdirSync(OUT, { recursive: true });
  await boot(page);
  await waitForTestHooks(page);

  // A new character: brows and lashes are skin layers, not parts.
  const keys = await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.scene.parts.map((p) => p.key));
  expect(keys).not.toContain('eyebrows');
  expect(keys).not.toContain('eyelashes');
  expect((await layer(page, 'brows'))?.enabled).toBe(true);
  expect((await layer(page, 'lashes'))?.enabled).toBe(true);
  await page.getByLabel('Light').selectOption('studio');
  await frame(page, 'painted_front', { targetHeight: 0.92, span: 0.2, yaw: 0, pitch: 0 });
  await frame(page, 'painted_threeQuarter', { targetHeight: 0.92, span: 0.2, yaw: Math.PI / 4, pitch: 0.02 });
  await frame(page, 'painted_eye', { targetHeight: 0.935, span: 0.075, yaw: 0.2, pitch: 0 });

  // Brows and Lashes each have their own place in the editor, with their settings.
  await page.getByTestId('cat-brows').click();
  await expect(page.getByRole('tabpanel', { name: 'Brows' })).toBeVisible();
  await expect(page.getByTestId('face-brows-on')).toBeChecked();
  await page.getByTestId('face-brows-thickness').fill('1.6');
  expect((await layer(page, 'brows'))?.params.thickness).toBe(1.6);
  await page.getByTestId('cat-lashes').click();
  await expect(page.getByRole('tabpanel', { name: 'Lashes' })).toBeVisible();
  await page.getByTestId('face-lashes-length').fill('1.5');
  expect((await layer(page, 'lashes'))?.params.length).toBe(1.5);
  await frame(page, 'painted_thick_long', { targetHeight: 0.92, span: 0.2, yaw: 0, pitch: 0 });
  await page.getByTestId('face-lashes-on').uncheck();
  expect((await layer(page, 'lashes'))?.enabled).toBe(false);
  await expect(page.getByTestId('face-lashes-length')).toBeHidden();
  await page.getByTestId('face-lashes-on').check();
  expect((await layer(page, 'lashes'))?.enabled).toBe(true);

  // A character saved with MakeHuman's brow and lash meshes keeps them until you switch.
  await setCharacter(page, {}, {
    eyebrows: { asset: 'mh:eyebrows/eyebrow001', tint: { color: [1, 1, 1], brightness: 1 }, opacity: 1 },
    eyelashes: { asset: 'mh:eyelashes/eyelashes01', opacity: 1 },
    skin: { base: 'mh:skins/young_caucasian_male', layers: [], photo: null },
  });
  expect(await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.scene.parts.some((p) => p.key === 'eyebrows'))).toBe(true);
  await frame(page, 'old_meshes_front', { targetHeight: 0.92, span: 0.2, yaw: 0, pitch: 0 });
  await page.getByTestId('face-lashes-to-painted').click();
  await page.getByTestId('cat-brows').click();
  await page.getByTestId('face-brows-to-painted').click();
  await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.settled());
  const after = await page.evaluate(() => {
    const s = (window as unknown as TestWindow).__ps2cc;
    return { brows: s.engine.doc.eyebrows.asset, lashes: s.engine.doc.eyelashes.asset, parts: s.scene.parts.map((p) => p.key) };
  });
  expect(after.brows).toBeNull();
  expect(after.lashes).toBeNull();
  expect(after.parts).not.toContain('eyebrows');
  expect(after.parts).not.toContain('eyelashes');
  expect((await layer(page, 'brows'))?.enabled).toBe(true);
  expect((await layer(page, 'lashes'))?.enabled).toBe(true);
  await expect(page.getByTestId('face-brows-to-painted')).toBeHidden();
  // One undo puts the brow mesh back.
  await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.engine.undo());
  expect(await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.engine.doc.eyebrows.asset)).toBe('mh:eyebrows/eyebrow001');
  await page.getByTestId('face-brows').scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await page.screenshot({ path: resolve(OUT, 'ui_appearance_brows.png') });
});

test('brow and lash presets, the brow brush, and a dark smoky look', async ({ page }) => {
  test.setTimeout(300_000);
  mkdirSync(OUT, { recursive: true });
  await boot(page);
  await waitForTestHooks(page);
  await page.getByLabel('Light').selectOption('studio');
  await page.getByTestId('cat-brows').click();

  // Presets set the shape and hair settings and keep the colour.
  await page.getByTestId('face-brows-color').fill('#1c1411');
  await page.getByTestId('face-brows-preset').selectOption('soft');
  let brows = await layer(page, 'brows');
  expect(brows?.params.fill).toBe(0.7);
  expect(brows?.params.color).toBe('#1c1411');
  await page.getByTestId('cat-lashes').click();
  await page.getByTestId('face-lashes-preset').selectOption('smoky');
  await page.getByTestId('cat-brows').click();
  expect((await layer(page, 'lashes'))?.params.smudge).toBe(0.65);
  await frame(page, 'preset_soft_smoky_front', { targetHeight: 0.92, span: 0.2, yaw: 0, pitch: 0 });
  await frame(page, 'preset_soft_smoky_eye', { targetHeight: 0.935, span: 0.075, yaw: 0.2, pitch: 0 });

  // The brush: erase the tails, on both brows at once; one stroke is one undo step.
  const canvas = page.getByTestId('brow-brush');
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  await page.getByTestId('brow-brush-erase').click();
  await page.mouse.move(box.x + box.width * 0.93, box.y + box.height * 0.2);
  await page.mouse.down();
  for (let i = 0; i <= 10; i++) await page.mouse.move(box.x + box.width * (0.93 - 0.01 * i), box.y + box.height * (0.2 + 0.04 * i));
  await page.mouse.up();
  await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.settled());
  brows = await layer(page, 'brows');
  expect(typeof brows?.paint).toBe('string');
  await page.screenshot({ path: resolve(OUT, 'ui_brow_brush.png') });
  await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.engine.undo());
  expect((await layer(page, 'brows'))?.paint).toBeUndefined();
  // Grow a fuller inner end instead, then clear it with the button.
  await page.getByTestId('brow-brush-add').click();
  await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.35, { steps: 6 });
  await page.mouse.up();
  expect(typeof (await layer(page, 'brows'))?.paint).toBe('string');
  await frame(page, 'brush_fuller_inner_end', { targetHeight: 0.92, span: 0.2, yaw: 0, pitch: 0 });
  await page.getByTestId('brow-brush-clear').click();
  expect((await layer(page, 'brows'))?.paint).toBeUndefined();

  // A dark, smoky look in the spirit of the era's horror faces: pale skin, dark full brows,
  // full smoky lashes over eyeshadow and dark circles. Everything is painted on the skin.
  await page.evaluate(async () => {
    const s = (window as unknown as TestWindow).__ps2cc;
    const doc = structuredClone(s.engine.doc);
    Object.assign(doc.macros, { gender: 0, age: 0.45, caucasian: 1, african: 0, asian: 0 });
    doc.skin.base = 'mh:skins/young_caucasian_female';
    const l = (kind: string) => doc.skin.layers.find((x) => x.kind === kind)!;
    l('brows').params = { ...l('brows').params, color: '#17110f', thickness: 1.15, arch: 0.6, softness: 0.85, fill: 0.75, density: 0.9 };
    l('lashes').params = { ...l('lashes').params, color: '#0d0909', length: 1.4, density: 1, clump: 0.6, smudge: 0.8, outer: 0.8, lower: 0.8 };
    const add = (kind: string, opacity: number, blend: string, params: Record<string, number | string>) =>
      doc.skin.layers.push({ id: `${kind}-look`, kind, enabled: true, opacity, blend, mask: 'none', params } as (typeof doc.skin.layers)[number]);
    add('tone', 1, 'normal', { hue: 0, saturation: 0.55, value: 1.08 });
    add('darkCircles', 0.6, 'multiply', { color: '#6e5560', size: 1.3 });
    add('eyeliner', 0.75, 'normal', { color: '#1a1212', thickness: 0.6, shadowColor: '#3d2a2c', shadow: 0.75 });
    add('lips', 0.5, 'multiply', { color: '#7a4a52', size: 1 });
    s.engine.replaceDoc(doc, 'e2e');
    await s.settled();
  });
  await frame(page, 'look_smoky_front', { targetHeight: 0.92, span: 0.2, yaw: 0, pitch: 0 });
  await frame(page, 'look_smoky_eye', { targetHeight: 0.935, span: 0.075, yaw: 0.2, pitch: 0 });
  await frame(page, 'look_smoky_threeQuarter', { targetHeight: 0.92, span: 0.2, yaw: Math.PI / 4, pitch: 0.02 });
});
