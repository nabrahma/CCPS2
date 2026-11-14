/**
 * The smaller PRD requirements finished after M10, in the real UI: credits
 * (9.2), user presets (F1), viewport background and export-size preview (F9),
 * painting the hairline (F5), fitting the face to a photo (F7) and the
 * scripted slider sweep (8.2). Screenshots and the sweep report go to
 * docs/milestones/Polish/.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { boot, garment, MILESTONES, pixelAt, setCamera, setCharacter } from './helpers';
import { waitForTestHooks, type TestWindow } from './skin-helpers';

const OUT = join(MILESTONES, 'Polish');
const bald = { mode: 'none', tint: { color: [1, 1, 1], brightness: 1 }, alphaThreshold: 0.5 };

async function start(page: Page): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  await boot(page);
  await waitForTestHooks(page);
}

const menu = (page: Page, name: string) => page.locator('.menu-button', { hasText: name }).click();

/** Standard deviation of a square of canvas pixels through a viewport screenshot. */
async function detail(page: Page, doExportSize: boolean): Promise<number> {
  return page.evaluate(async (exportSize) => {
    const s = (window as unknown as TestWindow).__ps2cc;
    const vp = s.viewport!;
    vp.exportSizePreview = exportSize;
    const blob = await vp.screenshot(512, 512);
    vp.exportSizePreview = true;
    const bmp = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const { data } = ctx.getImageData(206, 206, 100, 100);
    let sum = 0;
    let sq = 0;
    for (let i = 0; i < data.length; i += 4) {
      sum += data[i + 1]!;
      sq += data[i + 1]! ** 2;
    }
    const n = data.length / 4;
    return Math.sqrt(sq / n - (sum / n) ** 2);
  }, doExportSize);
}

test('Help → Credits names the assets that require it', async ({ page }) => {
  await start(page);
  await menu(page, 'Help');
  await page.getByTestId('menu-credits').click();
  const dialog = page.getByTestId('credits');
  await expect(dialog.getByTestId('credits-attribution')).toContainText('culturalibre');
  await expect(dialog.getByTestId('credits-attribution')).toContainText('CC-BY-4.0');
  await expect(dialog.getByTestId('credits-attribution')).toContainText('mh:clothes/culturalibre_heroine_boots_4');
  await expect(dialog).toContainText('Blender');
  await page.getByTestId('credits').screenshot({ path: join(OUT, 'credits.png') });
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
});

test('user presets: save, apply, delete', async ({ page }) => {
  await start(page);
  await setCharacter(page, { gender: 0.2, weight: 0.7 }, { modifiers: { 'nose/nose-scale-horiz-decr|incr': 0.45 } });
  page.once('dialog', (d) => void d.accept('Stocky'));
  await menu(page, 'File');
  await page.getByTestId('menu-save-preset').click();
  await expect(page.getByText('Saved preset Stocky')).toBeVisible();

  await setCharacter(page, { gender: 0.9, weight: 0.4 }, { modifiers: {} });
  await menu(page, 'File');
  await page.locator('.menu-row button', { hasText: 'Stocky' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as TestWindow).__ps2cc.engine.value('nose/nose-scale-horiz-decr|incr')))
    .toBeCloseTo(0.45, 5);
  const macros = await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.engine.doc.macros);
  expect(macros.gender).toBeCloseTo(0.2, 5);
  expect(macros.weight).toBeCloseTo(0.7, 5);

  page.once('dialog', (d) => void d.accept());
  await menu(page, 'File');
  await page.getByRole('button', { name: 'Delete preset Stocky' }).click();
  await expect(page.locator('.menu-row', { hasText: 'Stocky' })).toHaveCount(0);
});

test('viewport background: black, grey and your own image', async ({ page }) => {
  await start(page);
  const box = (await page.getByTestId('viewport').boundingBox())!;
  const corner = { x: box.x + box.width * 0.2, y: box.y + box.height * 0.5 };
  await page.getByText('Post…').click();

  await page.getByTestId('background').selectOption('grey');
  await expect.poll(async () => (await pixelAt(page, corner.x, corner.y))[0]!).toBeGreaterThan(100);
  await page.getByTestId('background').selectOption('black');
  await expect.poll(async () => (await pixelAt(page, corner.x, corner.y))[0]!).toBeLessThan(6);

  const png = await page.evaluate(async () => {
    const c = new OffscreenCanvas(64, 64);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#00d0ff';
    ctx.fillRect(0, 0, 64, 64);
    const buf = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
    return btoa(String.fromCharCode(...buf));
  });
  await page.getByTestId('background-file').setInputFiles({ name: 'room.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect
    .poll(async () => {
      const [r, g, b] = await pixelAt(page, corner.x, corner.y);
      return b! > 180 && g! > 140 && r! < 60;
    }, { timeout: 15_000 })
    .toBe(true);
  await expect(page.getByTestId('background')).toHaveValue('image');
  await page.getByTestId('viewport').screenshot({ path: join(OUT, 'background_image.png') });
});

test('a texture finer than its export is shown as the export will look', async ({ page }) => {
  await start(page);
  await page.getByLabel('Light').selectOption('studio');
  await setCharacter(page, { gender: 1 }, { hair: bald, garments: [garment('mh:clothes/male_worksuit01', 'full')] });
  // A fine 2048 px noise: it is far beyond the garment's 1016 texels on export.
  const url = await page.evaluate(async () => {
    const c = new OffscreenCanvas(2048, 2048);
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(2048, 2048);
    for (let y = 0; y < 2048; y++) {
      for (let x = 0; x < 2048; x++) {
        const v = (x + y) % 2 ? 255 : 0;
        const o = (y * 2048 + x) * 4;
        img.data[o] = img.data[o + 1] = img.data[o + 2] = v;
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return URL.createObjectURL(await c.convertToBlob({ type: 'image/png' }));
  });
  await page.evaluate(async (u) => {
    const s = (window as unknown as TestWindow).__ps2cc;
    s.engine.update('fine', (d) => {
      d.garments[0]!.texture = u;
      // A 1024 px garment atlas (Classic's): the test texture is twice what export keeps.
      d.export.garmentAtlas = 1024;
    });
    await s.settled();
  }, url);
  // Right up against the cloth, where the mip chain alone would still show the full texture.
  await page.evaluate(() => {
    const s = (window as unknown as TestWindow).__ps2cc;
    const vp = s.viewport!;
    // The front-most vertex of the cloth on the chest, a little off the centre line.
    const part = s.scene.parts.find((p) => p.kind === 'garment')!;
    let best = -1;
    for (let v = 0; v < part.positions.length / 3; v++) {
      const [x, y, z] = [part.positions[v * 3]!, part.positions[v * 3 + 1]!, part.positions[v * 3 + 2]!];
      if (Math.abs(x - 0.08) < 0.05 && y + s.scene.groundOffset > 1.1 && y + s.scene.groundOffset < 1.3 && (best < 0 || z > part.positions[best * 3 + 2]!)) best = v;
    }
    const [x, y, z] = [part.positions[best * 3]!, part.positions[best * 3 + 1]! + s.scene.groundOffset, part.positions[best * 3 + 2]!];
    const controls = (vp as unknown as { controls: { target: { set(a: number, b: number, c: number): void }; update(): void } }).controls;
    vp.camera.fov = 1;
    vp.camera.updateProjectionMatrix();
    vp.camera.position.set(x, y, z + 1.5);
    controls.target.set(x, y, z);
    controls.update();
  });
  await page.waitForTimeout(1500);
  const full = await detail(page, false);
  const limited = await detail(page, true);
  expect(full, 'the fine checker must be visible without the limit').toBeGreaterThan(10);
  expect(limited).toBeLessThan(full * 0.5);
  writeFileSync(join(OUT, 'export_size_preview.json'), `${JSON.stringify({ stddevFullTexture: full, stddevExportSize: limited }, null, 2)}\n`);
});

test('painting the hairline changes the hair, in one undo step', async ({ page }) => {
  await start(page);
  await setCharacter(page, {}, {});
  await page.getByRole('tab', { name: 'Hair', exact: true }).click();
  await page.getByTestId('open-hair-studio').click();
  await page.getByRole('tab', { name: 'Card hair' }).click();
  await page.locator('#hairline').selectOption('painted');
  const canvas = page.getByTestId('hairline-paint');
  await expect(canvas).toBeVisible();
  await canvas.scrollIntoViewIfNeeded();
  const read = () =>
    page.evaluate(async () => {
      const s = (window as unknown as TestWindow).__ps2cc;
      await s.settled();
      return { painted: s.engine.doc.hair.style!.hairline.painted!, tris: s.scene.parts.find((p) => p.kind === 'hair')?.triangleCount ?? 0, undo: s.engine.history.undoLabel };
    });
  const before = await read();
  expect(before.tris).toBeGreaterThan(0);

  await page.getByTestId('hairline-erase').click();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.55, { steps: 12 });
  await page.mouse.up();

  await expect.poll(async () => (await read()).painted).not.toBe(before.painted);
  const after = await read();
  expect(after.undo).toBe('Paint hairline');
  await canvas.screenshot({ path: join(OUT, 'hairline_paint.png') });

  await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.engine.undo());
  await expect.poll(async () => (await read()).painted).toBe(before.painted);
  await expect(canvas).toBeVisible();
});

test('fit face shape to photo lowers the landmark error', async ({ page }) => {
  test.setTimeout(300_000);
  await start(page);
  await page.getByLabel('Light').selectOption('studio');
  // The "photo": a character with a clearly different face, rendered from the front.
  await setCharacter(page, { gender: 1, age: 0.5 }, {
    hair: bald,
    garments: [],
    modifiers: { 'eyes/l-eye-trans-in|out': 0.4, 'eyes/r-eye-trans-in|out': 0.4, 'nose/nose-scale-horiz-decr|incr': 0.5, 'mouth/mouth-scale-horiz-decr|incr': -0.35 },
    skin: { base: 'mh:skins/young_caucasian_male', layers: [], photo: null },
  });
  await setCamera(page, 'face');
  await page.waitForTimeout(800);
  const url = await page.evaluate(async () => URL.createObjectURL(await (window as unknown as TestWindow).__ps2cc.viewport!.screenshot(768, 960)));

  await setCharacter(page, { gender: 1, age: 0.5 }, { hair: bald, garments: [], modifiers: {}, skin: { base: 'mh:skins/young_caucasian_male', layers: [], photo: null } });
  await page.getByTestId('cat-skin').click();
  await page.getByTestId('open-texture-studio').click();
  await page.evaluate(async (u) => {
    await (window as unknown as TestWindow).__ps2ccTest.placePhoto((window as unknown as TestWindow).__ps2cc, u);
  }, url);
  await page.getByTestId('fit-face').click();
  const toast = page.getByText(/Face fitted: landmark error/);
  await expect(toast).toBeVisible({ timeout: 120_000 });
  const m = /error ([\d.]+)% → ([\d.]+)%/.exec((await toast.textContent())!)!;
  const [before, after] = [Number(m[1]), Number(m[2])];
  expect(after).toBeLessThan(before);

  const state = await page.evaluate(() => {
    const s = (window as unknown as TestWindow).__ps2cc;
    return { eyes: s.engine.value('eyes/l-eye-trans-in|out'), nose: s.engine.value('nose/nose-scale-horiz-decr|incr'), undo: s.engine.history.undoLabel };
  });
  expect(state.undo).toBe('Fit face to photo');
  expect(state.eyes, 'the eyes are wider apart in the photo').toBeGreaterThan(0);
  expect(state.nose, 'the nose is wider in the photo').toBeGreaterThan(0);
  writeFileSync(join(OUT, 'face_fit.json'), `${JSON.stringify({ errorBeforePercent: before, errorAfterPercent: after, ...state }, null, 2)}\n`);
  await page.getByTestId('viewport').screenshot({ path: join(OUT, 'face_fit.png') });
});

test('slider sweep: measured, and the character is put back', async ({ page }) => {
  test.setTimeout(180_000);
  await start(page);
  await setCharacter(page, {}, { garments: [garment('mh:clothes/male_worksuit01', 'full')] });
  const before = await page.evaluate(() => JSON.stringify((window as unknown as TestWindow).__ps2cc.engine.doc));
  const report = await page.evaluate(async () => {
    const w = window as unknown as TestWindow;
    return w.__ps2ccTest.runSliderSweep(w.__ps2cc, 240);
  });
  writeFileSync(join(OUT, 'slider_sweep.json'), `${JSON.stringify(report, null, 2)}\n`);
  const after = await page.evaluate(() => JSON.stringify((window as unknown as TestWindow).__ps2cc.engine.doc));
  expect(after).toBe(before);
  expect(report.frames).toBe(240);
  expect(report.fps).toBeGreaterThan(0);
  // A software GPU cannot reach 60 fps, so CI checks the CPU part: one change must leave room in a 16.7 ms frame.
  expect(report.updateMs.p50).toBeLessThan(16);
});
