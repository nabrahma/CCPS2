/**
 * PRD M8 in the real UI: the Expressions panel previews each blendshape with a
 * slider (viewport only), the bake list is stored in the document and shown in
 * the budget bar, and the export carries the baked shapes. Also renders every
 * blendshape in the viewport for review (docs/milestones/M8/preview_sheet.png).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { MILESTONES, boot, setCamera, setCharacter } from './helpers';
import { waitForTestHooks, type TestWindow } from './skin-helpers';

const OUT = join(MILESTONES, 'M8');
const bald = { mode: 'none', tint: { color: [1, 1, 1], brightness: 1 }, alphaThreshold: 0.5 };

async function viewportPng(page: Page, w: number, h: number): Promise<string> {
  return page.evaluate(
    async ({ w, h }) => {
      const s = (window as unknown as TestWindow).__ps2cc;
      await s.settled();
      const blob = await s.viewport!.screenshot(w, h);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(bin);
    },
    { w, h },
  );
}

/** Pixels (of an w x h viewport render) that differ by more than 24 levels between two renders. */
async function changedPixels(page: Page, a: string, b: string): Promise<number> {
  return page.evaluate(
    async ({ a, b }) => {
      const load = async (b64: string) => {
        const img = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/png' }));
        const c = new OffscreenCanvas(img.width, img.height);
        const g = c.getContext('2d')!;
        g.drawImage(img, 0, 0);
        return g.getImageData(0, 0, img.width, img.height).data;
      };
      const [x, y] = await Promise.all([load(a), load(b)]);
      let n = 0;
      for (let i = 0; i < x.length; i += 4) if (Math.abs(x[i]! - y[i]!) + Math.abs(x[i + 1]! - y[i + 1]!) + Math.abs(x[i + 2]! - y[i + 2]!) > 24) n++;
      return n;
    },
    { a, b },
  );
}

test('Expressions panel: preview sliders, bake list, export with blendshapes', async ({ page }) => {
  test.setTimeout(600_000);
  mkdirSync(OUT, { recursive: true });
  await boot(page);
  await waitForTestHooks(page);
  await setCharacter(page, { gender: 1, age: 0.5 }, { name: 'Expr Test', hair: bald, garments: [] });
  // Expressions are baked at export: 06 Export, Expressions (Part 2 F20).
  await page.getByTestId('step-export').click();
  await page.getByTestId('export-expressions').locator(':scope > summary').click();
  await expect(page.getByTestId('expressions-panel')).toBeVisible();
  await expect(page.getByTestId('budget-blendshapes')).toHaveText('Blendshapes 15');
  await setCamera(page, 'face');
  await page.waitForTimeout(500);
  const neutral = await viewportPng(page, 480, 600);

  // Blink preview through the slider: the viewport changes, the document does not.
  const before = await page.evaluate(() => JSON.stringify((window as unknown as TestWindow).__ps2cc.engine.doc));
  await page.getByTestId('expr-slider-blink_L').fill('1');
  // The weight is recorded at once; the shapes apply once the face rig has loaded.
  await expect.poll(() => page.evaluate(() => (window as unknown as TestWindow).__ps2cc.scene.parts.some((p) => p.preview)), { timeout: 60_000 }).toBe(true);
  expect(await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.scene.expressionPreview.blink_L)).toBe(1);
  const blink = await viewportPng(page, 480, 600);
  const changed = await changedPixels(page, neutral, blink);
  console.log(`blink_L preview changed ${changed} pixels`);
  expect(changed).toBeGreaterThan(150);
  expect(await page.evaluate(() => JSON.stringify((window as unknown as TestWindow).__ps2cc.engine.doc))).toBe(before);
  await page.getByTestId('expr-slider-blink_R').fill('1');
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(OUT, 'ui_expressions_panel.png') });

  // Neutral face again.
  await page.getByTestId('expr-reset').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as TestWindow).__ps2cc.scene.parts.some((p) => p.preview))).toBe(false);
  expect(await changedPixels(page, neutral, await viewportPng(page, 480, 600))).toBeLessThan(20);

  // The bake list: unticking a shape drops it from the document, the budget bar and the export.
  await page.getByTestId('expr-bake-MBP').uncheck();
  await expect(page.getByTestId('budget-blendshapes')).toHaveText('Blendshapes 14');
  const ex = await page.evaluate(async () => {
    const w = window as unknown as TestWindow;
    const { scene } = await w.__ps2ccTest.prepareExport(w.__ps2cc, { glb: true, tPose: false }, '2026-11-08 12:00:00:000');
    return {
      meshes: scene.meshes.map((m) => ({ name: m.name, role: m.role, shapes: m.shapes.map((s) => s.name) })),
      sidecar: scene.sidecar.blendshapes as string[],
    };
  });
  const head = ex.meshes.find((m) => m.role === 'head')!;
  expect(head.shapes).toHaveLength(14);
  expect(head.shapes).not.toContain('MBP');
  expect(ex.sidecar).toEqual(head.shapes);
  const eyes = ex.meshes.find((m) => m.role === 'eyes')!;
  expect(eyes.shapes).toEqual(expect.arrayContaining(['blink_L', 'blink_R', 'browsUp']));
  await page.getByTestId('expr-bake-MBP').check();
  await expect(page.getByTestId('budget-blendshapes')).toHaveText('Blendshapes 15');
});

test('review: every blendshape rendered in the viewport', async ({ page }) => {
  test.setTimeout(600_000);
  mkdirSync(OUT, { recursive: true });
  await boot(page);
  await waitForTestHooks(page);
  for (const [label, macros, extra] of [
    ['male', { gender: 1, age: 0.5 }, { hair: bald }],
    ['female', { gender: 0, age: 0.45 }, { hair: { mode: 'mesh', asset: 'mh:hair/bob02', tint: { color: [1, 1, 1], brightness: 1 }, alphaThreshold: 0.5 } }],
  ] as const) {
    await setCharacter(page, macros, { name: `Review ${label}`, garments: [], ...extra });
    await setCamera(page, 'face');
    await page.waitForTimeout(500);
    const sheet = await page.evaluate(async () => {
      const w = window as unknown as TestWindow;
      const s = w.__ps2cc;
      const names = ['neutral', ...w.__ps2ccTest.core.EXPRESSION_MAP.expressions.map((e) => e.name)];
      const W = 240;
      const H = 300;
      const cols = 4;
      const rows = Math.ceil(names.length / cols);
      const canvas = new OffscreenCanvas(cols * W, rows * (H + 22));
      const g = canvas.getContext('2d')!;
      g.fillStyle = '#202024';
      g.fillRect(0, 0, canvas.width, canvas.height);
      for (const [i, n] of names.entries()) {
        await s.scene.setExpressionPreview(n === 'neutral' ? {} : { [n]: 1 });
        s.viewport!.refresh();
        await s.settled();
        const blob = await s.viewport!.screenshot(W, H);
        const img = await createImageBitmap(blob);
        const x = (i % cols) * W;
        const y = Math.floor(i / cols) * (H + 22);
        g.drawImage(img, x, y);
        g.fillStyle = '#e8e8e8';
        g.font = '15px sans-serif';
        const cal = s.scene.expressionCalibration(n);
        g.fillText(cal ? `${n} (lid x${cal.weight.toFixed(2)})` : n, x + 8, y + H + 16);
      }
      await s.scene.setExpressionPreview({});
      s.viewport!.refresh();
      const out = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
      let bin = '';
      for (let i = 0; i < out.length; i += 0x8000) bin += String.fromCharCode(...out.subarray(i, i + 0x8000));
      return btoa(bin);
    });
    writeFileSync(join(OUT, `preview_sheet_${label}.png`), Buffer.from(sheet, 'base64'));
  }
});
