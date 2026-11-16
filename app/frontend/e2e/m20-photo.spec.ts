/**
 * PRD Part 3, F33 (M20 acceptance): photo assist v2. The stand-in photos are
 * renders of characters, as in the M6 and M14 tests.
 *
 * - Segmenter masks: a photo with a dark fringe, projected with the face-skin
 *   mask, puts no more dark (hair) texels into the face than the same face
 *   without a fringe; without the mask it does (the control).
 * - Manual points: the 68 points alone (MediaPipe's found points reduced to
 *   the iBUG set) keep the eyes and mouth within 4 texels at 1024.
 * - Colours: the hair and skin colours picked from the photo apply, as one undo step.
 * - The point editor opens from the photo panel and places the face.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { boot, MILESTONES, setCharacter } from './helpers';
import { measureFace, waitForTestHooks, type TestWindow } from './skin-helpers';

const OUT = resolve(MILESTONES, 'M20');
mkdirSync(OUT, { recursive: true });
const LIMIT_TEXELS = 4;
const bald = { mode: 'none', tint: { color: [1, 1, 1], brightness: 1 }, alphaThreshold: 0.5 };
const report: Record<string, unknown> = {};

async function start(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await boot(page);
  await waitForTestHooks(page);
}

/** A front "photo" of a character: rendered twice, keeping the second (things still loading settle). */
async function renderPhoto(page: Page, macros: Record<string, number>, hair: Record<string, unknown>): Promise<string> {
  await setCharacter(page, macros, { hair, garments: [], modifiers: {} });
  return page.evaluate(async () => {
    const w = window as unknown as TestWindow;
    const s = w.__ps2cc;
    const skin = s.assets.catalog.skins.find((x) => x.id.endsWith('young_caucasian_female'))!.id;
    s.engine.update('photo skin', (d) => void (d.skin = { base: skin, layers: [w.__ps2ccTest.core.newLayer('brows'), w.__ps2ccTest.core.newLayer('lashes')], photo: null }));
    await s.settled();
    let url = '';
    for (const pass of [0, 1]) {
      s.viewport!.setCameraFrame({ targetHeight: 0.925, span: 0.19, yaw: 0, pitch: 0 });
      s.viewport!.refresh();
      await new Promise((r) => setTimeout(r, 400));
      await s.settled();
      const shot = await s.viewport!.screenshot(768, 960);
      if (pass === 1) url = URL.createObjectURL(shot);
    }
    return url;
  });
}

/** The target character for the projection (bald, plain skin), then a photo placed on it. */
async function project(page: Page, url: string, useMask: boolean): Promise<{ dark: number; texels: number; faceShare: number }> {
  await setCharacter(page, { gender: 0, age: 0.45 }, { hair: bald, garments: [], modifiers: {}, skin: { base: 'mh:skins/young_caucasian_female', layers: [], photo: null } });
  return page.evaluate(
    async ({ url, useMask }) => {
      const w = window as unknown as TestWindow;
      const s = w.__ps2cc;
      await w.__ps2ccTest.applyPhoto(s, url);
      // Raw photo colours (colour matching would lift the hair's darkness), with or without the mask.
      s.engine.update('mask', (d) => {
        d.skin.photo!.useMask = useMask;
        d.skin.photo!.colourMatch = false;
      });
      await s.settled();
      const layer = s.scene.photoLayer!;
      // Dark texels the photo puts on the face (hair is near black; skin, lips and brows are not).
      let dark = 0;
      let texels = 0;
      for (let i = 0; i < layer.width * layer.height; i++) {
        if (layer.data[i * 4 + 3]! < 128) continue;
        texels++;
        const l = 0.299 * layer.data[i * 4]! + 0.587 * layer.data[i * 4 + 1]! + 0.114 * layer.data[i * 4 + 2]!;
        if (l < 40) dark++;
      }
      return { dark, texels, faceShare: 0 };
    },
    { url, useMask },
  );
}

test('photo assist v2: the segmenter keeps a fringe out of the face texture; photo colours apply', async ({ page }) => {
  test.setTimeout(600_000);
  await start(page);
  const face = { gender: 0, age: 0.45 };
  const plain = await renderPhoto(page, face, bald);
  const black = { base: [0.04, 0.035, 0.035], rootDarken: 0.1, tipLighten: 0, streaks: 0, streakColour: [0, 0, 0], grey: 0 };
  const fringe = await page.evaluate((colour) => {
    const core = (window as unknown as TestWindow).__ps2ccTest.core;
    return { mode: 'cards', style: core.starterStyle('bob-fringe'), atlas: null, colour, tint: { color: [1, 1, 1], brightness: 1 }, alphaThreshold: 0.5 };
  }, black);
  const withFringe = await renderPhoto(page, face, fringe);
  const seg = await page.evaluate(async (url) => {
    const w = window as unknown as TestWindow;
    const img = new Image();
    img.src = url;
    await img.decode();
    const pixels = await w.__ps2ccTest.decodeImage(url);
    const r = await w.__ps2ccTest.segmentPhoto(w.__ps2cc.info.coreAssetsUrl, img, pixels);
    return { faceShare: r.faceShare, hairShare: r.hairShare, hair: r.hair, skin: r.skin, mask: r.mask };
  }, withFringe);
  writeFileSync(resolve(OUT, 'photo_fringe_mask.png'), Buffer.from(seg.mask.split(',')[1]!, 'base64'));
  expect(seg.hairShare).toBeGreaterThan(0.02);
  expect(seg.faceShare).toBeGreaterThan(0.05);
  expect(seg.hair).not.toBeNull();
  expect(Math.max(...seg.hair!)).toBeLessThan(80);

  const baseline = await project(page, plain, true);
  const masked = await project(page, withFringe, true);
  await page.screenshot({ path: resolve(OUT, 'photo_fringe_masked.png') });
  const unmasked = await project(page, withFringe, false);
  await page.screenshot({ path: resolve(OUT, 'photo_fringe_unmasked.png') });
  report.fringe = { segmentation: { faceShare: seg.faceShare, hairShare: seg.hairShare, hair: seg.hair, skin: seg.skin }, baseline, masked, unmasked };
  console.log(JSON.stringify(report.fringe));
  // The control shows the fringe; with the mask, no more dark texels than the face without a fringe.
  expect(unmasked.dark).toBeGreaterThan(baseline.dark + 500);
  expect(masked.dark).toBeLessThanOrEqual(baseline.dark * 1.05 + 50);

  // Colours from the photo: one undo step, card hair colour and a tone layer.
  await project(page, withFringe, true);
  const before = await page.evaluate(() => JSON.stringify((window as unknown as TestWindow).__ps2cc.engine.doc));
  const applied = await page.evaluate(async () => {
    const w = window as unknown as TestWindow;
    return w.__ps2ccTest.applyPhotoColours(w.__ps2cc);
  });
  expect(applied.hair).toBe(true);
  expect(applied.skin).toBe(true);
  const doc = await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.engine.doc);
  expect(Math.max(...doc.hair.colour!.base)).toBeLessThan(0.3);
  expect(doc.skin.layers.some((l) => l.kind === 'tone' && l.enabled)).toBe(true);
  await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.engine.undo());
  expect(await page.evaluate(() => JSON.stringify((window as unknown as TestWindow).__ps2cc.engine.doc))).toBe(before);
  writeFileSync(resolve(OUT, 'photo_assist_report.json'), `${JSON.stringify(report, null, 2)}\n`);
});

test('photo assist v2: 68 face points placed by hand keep eyes and mouth within 4 texels; the point editor', async ({ page }) => {
  test.setTimeout(600_000);
  await start(page);
  const photo = await renderPhoto(page, { gender: 1, age: 0.5 }, bald);
  // The target: another face, so the points have to do the work.
  await setCharacter(page, { gender: 0, age: 0.45 }, { hair: bald, garments: [], modifiers: {}, skin: { base: 'mh:skins/young_caucasian_female', layers: [], photo: null } });
  const points = await page.evaluate(async (url) => {
    const w = window as unknown as TestWindow;
    const img = new Image();
    img.src = url;
    await img.decode();
    const found = await w.__ps2ccTest.detectLandmarks(w.__ps2cc.info.coreAssetsUrl, img);
    const pts = w.__ps2ccTest.core.ibugFromMediapipe(found!.points);
    return pts;
  }, photo);
  // The user's path when no face is found: points by hand on a character with no photo yet.
  await page.evaluate(async ({ url, pts }) => {
    const w = window as unknown as TestWindow;
    await w.__ps2ccTest.applyManualPoints(w.__ps2cc, url, pts);
  }, { url: photo, pts: points });
  const doc = await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.engine.doc.skin.photo);
  expect(doc?.landmarkSet).toBe('ibug68');
  expect(doc?.landmarks?.length).toBe(204);
  const m = await measureFace(page);
  if ('error' in m) throw new Error(m.error);
  const worst = Math.max(...Object.values(m.errors));
  report.manual = { errors: m.errors, worstTexels: worst };
  console.log(JSON.stringify(report.manual));
  writeFileSync(resolve(OUT, 'photo_manual_points.png'), Buffer.from(m.png, 'base64'));
  expect(worst).toBeLessThanOrEqual(LIMIT_TEXELS);
  // For comparison: the same photo with every MediaPipe landmark.
  await page.evaluate(async (url) => {
    const w = window as unknown as TestWindow;
    await w.__ps2ccTest.applyPhoto(w.__ps2cc, url);
  }, photo);
  const full = await measureFace(page);
  if ('error' in full) throw new Error(full.error);
  report.fullLandmarks = { worstTexels: Math.max(...Object.values(full.errors)) };
  console.log('full landmarks', JSON.stringify(report.fullLandmarks));

  // The editor: opens from the photo panel with the points, and places the face again.
  // Face photos are in Texture Studio.
  await page.getByTestId('cat-skin').click();
  await page.getByTestId('open-texture-studio').click();
  await page.getByTestId('photo-points').click();
  await expect(page.getByTestId('point-editor')).toBeVisible();
  await expect(page.getByTestId('point-stage').locator('circle')).toHaveCount(68);
  await page.screenshot({ path: resolve(OUT, 'ui_point_editor.png') });
  await page.getByTestId('point-editor-apply').click();
  await expect(page.getByTestId('point-editor')).toBeHidden({ timeout: 60_000 });
  writeFileSync(resolve(OUT, 'photo_manual_report.json'), `${JSON.stringify(report, null, 2)}\n`);
});
