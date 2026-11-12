/**
 * Hair lab (development tool, `pnpm exec playwright test -c playwright.tools.config.ts hair-lab`):
 * renders hairstyles from a JSON file given in PS2CC_HAIR_LAB (a list of
 * { id, style, colour, female }) from the front, side, back and top of the
 * head and from three-quarter, and prints the share of skin inside the hair's
 * silhouette from an ID render (the M12 coverage measure). Images go to
 * PS2CC_HAIR_LAB_OUT. Nothing here is a test of record; e2e/m12.spec.ts is.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from '@playwright/test';
import { boot, setCharacter } from '../helpers';
import { waitForTestHooks, type TestWindow } from '../skin-helpers';

interface LabEntry {
  id: string;
  style: Record<string, unknown>;
  colour?: Record<string, unknown>;
  female?: boolean;
  garments?: unknown[];
}

export const HEAD_VIEWS: Record<string, { targetHeight: number; span: number; yaw: number; pitch: number }> = {
  front: { targetHeight: 0.915, span: 0.2, yaw: 0, pitch: 0 },
  side: { targetHeight: 0.915, span: 0.2, yaw: Math.PI / 2, pitch: 0 },
  back: { targetHeight: 0.915, span: 0.2, yaw: Math.PI, pitch: 0 },
  top: { targetHeight: 0.93, span: 0.2, yaw: 0, pitch: 1.45 },
  threeQuarter: { targetHeight: 0.9, span: 0.24, yaw: Math.PI / 5, pitch: 0.05 },
};

test('hair lab', async ({ page }) => {
  test.setTimeout(1_200_000);
  const entries = JSON.parse(readFileSync(process.env.PS2CC_HAIR_LAB!, 'utf8')) as LabEntry[];
  const out = process.env.PS2CC_HAIR_LAB_OUT!;
  mkdirSync(out, { recursive: true });
  await boot(page);
  await waitForTestHooks(page);
  await page.getByLabel('Light').selectOption('studio');
  const report: Record<string, unknown> = {};
  for (const e of entries) {
    await setCharacter(page, { gender: e.female ? 0 : 1, age: 0.5 }, {
      hair: { mode: 'cards', style: e.style, atlas: null, colour: e.colour ?? { base: [0.3, 0.2, 0.13] }, tint: { color: [1, 1, 1], brightness: 1 }, alphaThreshold: 0.5 },
      garments: e.garments ?? [],
    });
    const info = await page.evaluate(async () => {
      const s = (window as unknown as TestWindow).__ps2cc;
      s.engine.update('lab scalp layer', (d) => void (window as unknown as TestWindow).__ps2ccTest.core.withScalpLayer(d as never));
      await s.settled();
      const hair = s.scene.parts.find((p) => p.kind === 'hair')!;
      const gen = (s.scene as unknown as { cards: { hair: { locks: number; cards: number; lockTriangles: number; shellTriangles: number } } | null }).cards?.hair;
      return { triangles: hair.triangleCount, hairBudget: s.engine.doc.export.hairBudget, locks: gen?.locks, cards: gen?.cards, lockTriangles: gen?.lockTriangles, shellTriangles: gen?.shellTriangles };
    });
    const views: Record<string, number> = {};
    for (const [view, frame] of Object.entries(HEAD_VIEWS)) {
      const r = await page.evaluate(async (frame) => {
        const s = (window as unknown as TestWindow).__ps2cc;
        s.viewport!.setCameraFrame(frame);
        await new Promise((res) => setTimeout(res, 300));
        const id = s.viewport!.renderIds(256, 256);
        // Hair silhouette: hair pixels plus whatever they enclose (not reachable from the border without crossing hair).
        const W = id.width;
        const H = id.height;
        const kind = (i: number) => id.data[i * 4]!;
        const outside = new Uint8Array(W * H);
        const stack: number[] = [];
        for (let x = 0; x < W; x++) stack.push(x, (H - 1) * W + x);
        for (let y = 0; y < H; y++) stack.push(y * W, y * W + W - 1);
        while (stack.length) {
          const i = stack.pop()!;
          if (outside[i] || kind(i) === 1) continue;
          outside[i] = 1;
          const x = i % W;
          const y = (i / W) | 0;
          if (x > 0) stack.push(i - 1);
          if (x < W - 1) stack.push(i + 1);
          if (y > 0) stack.push(i - W);
          if (y < H - 1) stack.push(i + W);
        }
        let silhouette = 0;
        let skin = 0;
        for (let i = 0; i < W * H; i++) {
          if (outside[i]) continue;
          silhouette++;
          if (kind(i) === 2) skin++;
        }
        return { silhouette, skin };
      }, frame);
      views[view] = r.silhouette ? r.skin / r.silhouette : 0;
      await page.waitForTimeout(400);
      await page.getByTestId('viewport').screenshot({ path: join(out, `${e.id}_${view}.png`) });
    }
    if (process.env.PS2CC_HAIR_LAB_LAYERS) {
      // Each layer alone, from the top and three-quarter.
      for (const [name, layers] of [['locks', { shell: false, locks: true, cards: false }], ['cards', { shell: false, locks: false, cards: true }]] as const) {
        for (const view of ['top', 'threeQuarter']) {
          await page.evaluate(
            ({ frame, layers }) => {
              const s = (window as unknown as TestWindow).__ps2cc;
              s.viewport!.setHairLayers(layers);
              s.viewport!.setCameraFrame(frame);
            },
            { frame: HEAD_VIEWS[view]!, layers },
          );
          await page.waitForTimeout(500);
          await page.getByTestId('viewport').screenshot({ path: join(out, `${e.id}_${view}_${name}.png`) });
        }
      }
      await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.viewport!.setHairLayers({ shell: true, locks: true, cards: true }));
    }
    report[e.id] = { ...info, skinInSilhouette: views };
    console.log(e.id, JSON.stringify(report[e.id]));
  }
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
});
