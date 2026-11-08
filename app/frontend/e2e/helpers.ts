/** Shared Playwright helpers: boot the app and drive it through the `window.__ps2cc` test hook. */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
export const MILESTONES = resolve(here, '../../../docs/milestones');

export interface Hook {
  engine: {
    replaceDoc(doc: unknown, label?: string): void;
    doc: Record<string, unknown> & { macros: Record<string, number>; garments: { asset: string; texture?: string | null }[] };
    value(id: string): number;
  };
  settled(): Promise<void>;
  viewport: { setCameraPreset(id: string): void; partAt(x: number, y: number): string | null; stats: { fps: number } } | null;
  scene: { budget(): { total: number } };
}

/** Load the app. First-run setup is marked done unless `firstRun` (the M9 setup test). */
export async function boot(page: Page, opts: { firstRun?: boolean } = {}): Promise<void> {
  if (!opts.firstRun) {
    await page.addInitScript(() => {
      if (!localStorage.getItem('ps2cc:settings')) localStorage.setItem('ps2cc:settings', JSON.stringify({ firstRunCompleted: true }));
    });
  }
  await page.goto('/?e2e');
  await page.waitForFunction(() => Boolean((window as unknown as { __ps2cc?: unknown }).__ps2cc), undefined, { timeout: 120_000 });
  await expect(page.getByTestId('budget')).toBeVisible();
}

/** Replace the character: macros are merged, other top-level fields replaced. */
export async function setCharacter(page: Page, macros: Record<string, number>, extra: Record<string, unknown> = {}): Promise<void> {
  await page.evaluate(
    async ({ macros, extra }) => {
      const s = (window as unknown as { __ps2cc: Hook }).__ps2cc;
      const doc = structuredClone(s.engine.doc);
      Object.assign(doc.macros, macros);
      Object.assign(doc, extra);
      s.engine.replaceDoc(doc, 'e2e');
      await s.settled();
    },
    { macros, extra },
  );
}

export async function setCamera(page: Page, preset: string): Promise<void> {
  await page.evaluate((p) => (window as unknown as { __ps2cc: Hook }).__ps2cc.viewport?.setCameraPreset(p), preset);
}

export function garment(asset: string, slot: string, extra: Record<string, unknown> = {}) {
  return { slot, asset, tint: { color: [1, 1, 1], brightness: 1 }, dirt: 0, hideBody: true, ...extra };
}

/** RGBA of the on-screen pixel at client coordinates (from a real screenshot, so post effects count). */
export async function pixelAt(page: Page, x: number, y: number): Promise<number[]> {
  const png = await page.screenshot({ clip: { x: Math.round(x) - 1, y: Math.round(y) - 1, width: 3, height: 3 } });
  return page.evaluate(async (b64) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const canvas = new OffscreenCanvas(3, 3);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    const d = ctx.getImageData(0, 0, 3, 3).data;
    // Average the 3x3 block to smooth out dither.
    const out = [0, 0, 0, 0];
    for (let i = 0; i < 9; i++) for (let k = 0; k < 4; k++) out[k]! += d[i * 4 + k]! / 9;
    return out;
  }, png.toString('base64'));
}

/** A client point where the viewport reports the given part (scans the canvas). */
export async function pointOn(page: Page, prefix: string): Promise<{ x: number; y: number }> {
  const box = (await page.getByTestId('viewport').boundingBox())!;
  const p = await page.evaluate(
    ({ box, prefix }) => {
      const vp = (window as unknown as { __ps2cc: Hook }).__ps2cc.viewport!;
      // Search outwards from the centre so the point is well inside the part.
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height * 0.42;
      for (let r = 0; r < Math.min(box.width, box.height) / 2; r += 6) {
        for (let a = 0; a < 16; a++) {
          // Whole pixels (drag events carry integer coordinates), with the part all around.
          const x = Math.round(cx + r * Math.cos((a / 16) * Math.PI * 2));
          const y = Math.round(cy + r * Math.sin((a / 16) * Math.PI * 2));
          const around = [[0, 0], [-8, 0], [8, 0], [0, -8], [0, 8]];
          if (around.every(([dx, dy]) => vp.partAt(x + dx!, y + dy!)?.startsWith(prefix))) return { x, y };
        }
      }
      return null;
    },
    { box, prefix },
  );
  if (!p) throw new Error(`no ${prefix} part on screen`);
  return p;
}
