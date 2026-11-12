/**
 * M11 timings on this machine's GPU (Part 2 M11 acceptance: "1024 AO bake
 * time logged (target under 20 s on the reference GPU); Enhanced viewport
 * frame time logged (target 60 fps)"). The screenshot tests use SwiftShader;
 * this one asks Chromium for the real GPU. Writes docs/milestones/M11/gpu_timing.json.
 *
 *   pnpm --filter @ps2cc/app-frontend exec playwright test -c playwright.tools.config.ts gpu-timing
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from '@playwright/test';
import { boot, garment, setCharacter } from '../helpers';
import { waitForTestHooks, type TestWindow } from '../skin-helpers';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, '../../../../docs/milestones/M11');

test.use({ launchOptions: { args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] } });

test('GPU timings: 1024 px bake and the Enhanced viewport', async ({ page }) => {
  test.setTimeout(900_000);
  await boot(page);
  await waitForTestHooks(page);
  const style = await page.evaluate(() => (window as unknown as TestWindow).__ps2ccTest.core.starterStyle('short-messy'));
  await setCharacter(page, { gender: 1, age: 0.5 }, {
    garments: [garment('mh:clothes/namuhekam_male_polo_shirt', 'top'), garment('mh:clothes/cortu_cargo_pants', 'bottom')],
    hair: { mode: 'cards', style, atlas: null, tint: { color: [1, 1, 1], brightness: 1 }, alphaThreshold: 0.5 },
  });
  const result = await page.evaluate(async () => {
    const s = (window as unknown as TestWindow).__ps2cc;
    const gl = s.viewport!.renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    // The app's own bake: 1024 px, 64 rays.
    s.bakeOverride = null;
    const t0 = performance.now();
    await s.runBake();
    const bakeMs = performance.now() - t0;
    const status = s.bakeStatus;
    // Frame time with the default (Enhanced) profile, per-pixel light, shadows, the studio portrait look.
    s.viewport!.lighting = 'studioPortrait';
    s.viewport!.shadowMode = 'self';
    await new Promise((r) => setTimeout(r, 3000));
    const samples: number[] = [];
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 600));
      samples.push(s.viewport!.stats.fps);
    }
    return { gpu, bakeMs: Math.round(bakeMs), bakeTargets: status.timings, state: status.state, fps: samples, frameMs: s.viewport!.stats.frameMs, triangles: s.scene.budget().total };
  });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'gpu_timing.json'), JSON.stringify({ generated: 'app/frontend/e2e/tools/gpu-timing.spec.ts', date: new Date().toISOString().slice(0, 10), ...result }, null, 1) + '\n');
  console.log(JSON.stringify(result));
});
