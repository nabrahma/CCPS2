/**
 * The dotted line along the face zone's edge (fixed with D-147): on a real
 * GPU, a close-up of the side of the head has no stray purple or yellow
 * texels. The screenshot suite runs on SwiftShader, which did not show the
 * fault, so this check asks Chromium for the real GPU.
 *
 *   pnpm --filter @ps2cc/app-frontend exec playwright test -c playwright.tools.config.ts face-seam
 */
import { expect, test } from '@playwright/test';
import { boot } from '../helpers';
import { waitForTestHooks, type TestWindow } from '../skin-helpers';

test.use({ viewport: { width: 1600, height: 1000 }, launchOptions: { args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] } });

test('no dotted line along the face zone on a real GPU', async ({ page }) => {
  test.setTimeout(300_000);
  await boot(page);
  await waitForTestHooks(page);
  let worst = 0;
  for (const [x, z, tx] of [
    [0.25, 0.1, 0.06],
    [-0.25, 0.1, -0.06],
    [0.45, 0.12, 0],
  ] as const) {
    await page.evaluate(
      async ([x, z, tx]) => {
        const s = (window as unknown as TestWindow).__ps2cc;
        await s.settled();
        const vp = s.viewport!;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const c = (vp as any).controls;
        vp.camera.position.set(x, 1.6, z);
        c.target.set(tx, 1.6, 0.05);
        c.update();
      },
      [x, z, tx] as const,
    );
    await page.waitForTimeout(900);
    const b64 = (await page.getByTestId('viewport').screenshot()).toString('base64');
    const odd = await page.evaluate(async (b64) => {
      const img = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/png' }));
      const c = new OffscreenCanvas(img.width, img.height);
      const g = c.getContext('2d')!;
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, img.width, img.height).data;
      let n = 0;
      // Skip the camera bar at the top and the step strip at the bottom.
      for (let y = 60; y < img.height - 120; y++) {
        for (let x = 0; x < img.width; x++) {
          const i = (y * img.width + x) * 4;
          const r = d[i]!;
          const gr = d[i + 1]!;
          const b = d[i + 2]!;
          if ((b > r + 15 && b > gr) || (r > 200 && gr > 180 && b < 120)) n++;
        }
      }
      return n;
    }, b64);
    worst = Math.max(worst, odd);
  }
  expect(worst, 'stray purple or yellow pixels on the side of the head').toBe(0);
});
