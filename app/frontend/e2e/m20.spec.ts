/**
 * PRD Part 3, M20 (face control) in the app: the 52 ARKit face units with
 * presets and their memory cost; Sculpt Studio strokes (one undo step each,
 * symmetric, saved with the character) and a sculpt saved as a slider used on
 * another character. Review screenshots go to docs/milestones/M20/.
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { boot, MILESTONES, setCamera, setCharacter } from './helpers';
import { waitForTestHooks, type TestWindow } from './skin-helpers';

const OUT = resolve(MILESTONES, 'M20');
mkdirSync(OUT, { recursive: true });
const bald = { mode: 'none', tint: { color: [1, 1, 1], brightness: 1 }, alphaThreshold: 0.5 };

type Doc = TestWindow['__ps2cc']['engine']['doc'];
const doc = (page: Page) => page.evaluate(() => structuredClone((window as unknown as TestWindow).__ps2cc.engine.doc) as unknown as Doc);
const settled = (page: Page) => page.evaluate(() => (window as unknown as TestWindow).__ps2cc.settled());
const shot = async (page: Page, name: string) => {
  await settled(page);
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(OUT, `${name}.png`) });
};

/** Where on the page a hm08 vertex is drawn. */
async function screenOf(page: Page, vertex: number): Promise<{ x: number; y: number }> {
  return page.evaluate((v) => {
    const s = (window as unknown as TestWindow).__ps2cc;
    const p = s.engine.positions;
    const q = s.viewport!.groomView().project([p[v * 3]!, p[v * 3 + 1]!, p[v * 3 + 2]!]);
    const r = s.viewport!.canvas.getBoundingClientRect();
    return { x: r.left + q.x, y: r.top + q.y };
  }, vertex);
}

test('M20: ARKit expressions panel with poses and memory cost', async ({ page }) => {
  test.setTimeout(300_000);
  await boot(page);
  await waitForTestHooks(page);
  await setCharacter(page, { gender: 0, age: 0.5 }, { name: 'Faces', hair: bald, garments: [] });
  await page.getByTestId('cat-export').click();
  await page.getByTestId('export-expressions').locator(':scope > summary').click();
  await expect(page.getByTestId('expr-cost')).toContainText('52 baked');
  await expect(page.getByTestId('expr-cost')).toContainText('MB in Unity', { timeout: 60_000 });
  await setCamera(page, 'face');
  for (const pose of ['smile', 'surprise', 'fear', 'disgust', 'pain', 'scream']) {
    await page.getByTestId(`expr-preset-${pose}`).click();
    await expect.poll(() => page.evaluate(() => Object.keys((window as unknown as TestWindow).__ps2cc.scene.expressionPreview).length)).toBeGreaterThan(2);
    await shot(page, `pose_${pose}`);
  }
  await page.getByTestId('expr-reset').click();
  // Tick the visemes too: 59.
  await page.getByTestId('expr-bake-group-visemes').click();
  await expect(page.getByTestId('expr-cost')).toContainText('59 baked');
});

test('M20: Sculpt Studio strokes, undo, symmetry, save as slider, reuse on another character', async ({ page }) => {
  test.setTimeout(600_000);
  await boot(page);
  await waitForTestHooks(page);
  await setCharacter(page, { gender: 1, age: 0.5 }, { name: 'Sculpted', hair: bald, garments: [] });
  await page.getByTestId('cat-face').click();
  await page.getByTestId('open-sculpt-face').click();
  await expect(page.getByTestId('sculpt-studio')).toBeVisible();
  await setCamera(page, 'face');
  await settled(page);
  const lm = await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.assets.bodyLandmarks.points);
  await shot(page, 'sculpt_before');

  // A grab stroke pulls the nose tip forward and down a little (dragging down on screen).
  const nose = await screenOf(page, lm.noseTip);
  await page.getByTestId('sculpt-tool-grab').click();
  await page.mouse.move(nose.x, nose.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(nose.x, nose.y + i * 3);
  await page.mouse.up();
  await settled(page);
  let d = await doc(page);
  expect(d.sculpt).toBeDefined();
  const moved = await page.evaluate((v) => {
    const s = (window as unknown as TestWindow).__ps2cc;
    const layer = s.engine.sculptLayer();
    return [layer[v * 3]!, layer[v * 3 + 1]!, layer[v * 3 + 2]!];
  }, lm.noseTip);
  expect(moved[1]!).toBeLessThan(-0.002);
  // Symmetry: the centre line moved straight down.
  expect(Math.abs(moved[0]!)).toBeLessThan(1e-5);

  // Inflate the left cheek: with symmetry, the right cheek gets the same.
  const cheekV = await page.evaluate((nt) => {
    const s = (window as unknown as TestWindow).__ps2cc;
    const p = s.engine.positions;
    // A visible vertex on the left cheek: 4 cm to the left of the nose, 1 cm higher, front-most.
    let best = -1;
    let bz = -Infinity;
    for (let v = 0; v < s.assets.base.bodyVertexCount; v++) {
      if (Math.abs(p[v * 3]! - p[nt * 3]! - 0.04) < 0.004 && Math.abs(p[v * 3 + 1]! - p[nt * 3 + 1]! - 0.01) < 0.006 && p[v * 3 + 2]! > bz) {
        bz = p[v * 3 + 2]!;
        best = v;
      }
    }
    return best;
  }, lm.noseTip);
  const cheek = await screenOf(page, cheekV);
  await page.getByTestId('sculpt-tool-inflate').click();
  await page.mouse.move(cheek.x, cheek.y);
  await page.mouse.down();
  for (let i = 0; i < 6; i++) await page.mouse.move(cheek.x + (i % 2), cheek.y + 1);
  await page.mouse.up();
  await settled(page);
  const sym = await page.evaluate(async (v) => {
    const s = (window as unknown as TestWindow).__ps2cc;
    const mirror = await s.assets.mirror();
    const layer = s.engine.sculptLayer();
    const m = mirror[v]!;
    return { left: layer[v * 3 + 2]!, right: layer[m * 3 + 2]! };
  }, cheekV);
  expect(sym.left).toBeGreaterThan(0.0002);
  expect(Math.abs(sym.left - sym.right)).toBeLessThan(sym.left * 0.35);
  await shot(page, 'sculpt_after');

  // Two strokes, two undo steps.
  await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.engine.undo());
  d = await doc(page);
  expect(d.sculpt).toBeDefined();
  await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.engine.redo());

  // Saved with the character.
  const back = await page.evaluate(() => {
    const w = window as unknown as TestWindow;
    const core = w.__ps2ccTest.core;
    return core.parseCharacter(JSON.parse(core.serializeCharacter(w.__ps2cc.engine.doc as never))).sculpt ?? null;
  });
  expect(back).toEqual((await doc(page)).sculpt);

  // Save as slider: the sculpt becomes "Your sliders" at 1, and works on another character.
  await page.getByTestId('sculpt-save').locator('summary').click();
  await page.getByTestId('sculpt-name').fill('Strong nose');
  await page.getByTestId('sculpt-save-slider').click();
  await expect.poll(async () => Object.keys((await doc(page)).userTargets ?? {}).length).toBe(1);
  d = await doc(page);
  expect(d.sculpt).toBeUndefined();
  const id = Object.keys(d.userTargets!)[0]!;
  await page.getByTestId('studio-back').click();
  await page.getByTestId('cat-face').click();
  await expect(page.getByTestId('user-sliders-face')).toBeVisible();
  await shot(page, 'ui_your_sliders');
  // Another character, then the slider at 0.5.
  await setCharacter(page, { gender: 0, age: 0.6 }, { name: 'Other', userTargets: {}, sculpt: undefined });
  const before = await page.evaluate((v) => (window as unknown as TestWindow).__ps2cc.engine.positions[v * 3 + 1]!, lm.noseTip);
  await page.evaluate((target) => (window as unknown as TestWindow).__ps2cc.engine.update('slider', (x) => void (x.userTargets = { [target]: 0.5 })), id);
  const after = await page.evaluate((v) => (window as unknown as TestWindow).__ps2cc.engine.positions[v * 3 + 1]!, lm.noseTip);
  expect(after - before).toBeCloseTo(moved[1]! * 0.5, 4);
});
