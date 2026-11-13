/**
 * The benchmark board, app half (PRD Part 2 section 4): builds the two
 * benchmark characters, Mara and Cole, from PS2CC's own assets, and for every
 * quality profile renders them under the two benchmark looks from the four
 * benchmark cameras. It also writes:
 * - each view's camera (world space, feet on the origin) for the Unity half;
 * - a parity render of each view (no grain, no bloom, no ground disc), which
 *   the Unity render is compared with (F22);
 * - an export of each character in each profile (.ps2exp for ps2cc-export).
 *
 * Run through `pnpm bench` (scripts/bench.mjs), which does the Unity half,
 * the parity check and the contact sheets.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type Page } from '@playwright/test';
import { boot } from '../helpers';
import { buildCharacter as build, CHARACTERS } from '../bench-characters';
import { waitForTestHooks, type TestWindow } from '../skin-helpers';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, '../../../..');
const RUN = process.env.PS2CC_BENCH_DIR ?? join(REPO, 'docs', 'bench', 'latest');
const SIZE = Number(process.env.PS2CC_BENCH_SIZE ?? 640);
const PROFILES = ['classic', 'enhanced', 'hero'] as const;
const LOOKS = ['interiorFlashlight', 'villageOvercast'] as const;
const CAMERAS = ['threeQuarter', 'full', 'profile', 'back'] as const;

async function useProfile(page: Page, profile: string): Promise<void> {
  await page.evaluate(async (id) => {
    const s = (window as unknown as TestWindow).__ps2cc;
    const core = (window as unknown as TestWindow).__ps2ccTest.core;
    s.engine.update(`profile ${id}`, (d) => {
      d.export = { ...d.export, ...core.profileSettings(id as never) };
      d.bodyMesh = core.bodyMeshFor(id as never);
      core.withBakeLayers(d);
    });
    await s.settled();
    await s.runBake();
    await s.settled();
  }, profile);
}

test('benchmark board: app renders, cameras and exports', async ({ page }) => {
  test.setTimeout(3_600_000);
  mkdirSync(join(RUN, 'app'), { recursive: true });
  mkdirSync(join(RUN, 'parity'), { recursive: true });
  mkdirSync(join(RUN, 'exports'), { recursive: true });
  mkdirSync(join(RUN, 'characters'), { recursive: true });
  await boot(page);
  await waitForTestHooks(page);
  await page.setViewportSize({ width: 1400, height: 1000 });
  // The test GPU is SwiftShader: bake smaller maps than the app (1024 px, 64 rays); PS2CC_BENCH_BAKE=full for the real ones.
  await page.evaluate((full) => {
    const s = (window as unknown as TestWindow).__ps2cc;
    s.bakeOverride = full ? null : { size: 512, rays: 32 };
  }, process.env.PS2CC_BENCH_BAKE === 'full');
  const views: Record<string, unknown>[] = [];
  const timings: Record<string, unknown> = {};
  for (const c of CHARACTERS) {
    await build(page, c);
    for (const profile of PROFILES) {
      await useProfile(page, profile);
      const info = await page.evaluate(() => {
        const s = (window as unknown as TestWindow).__ps2cc;
        return { bake: s.bakeStatus, budget: s.scene.budget(), doc: (window as unknown as TestWindow).__ps2ccTest.core.serializeCharacter(s.engine.doc as never) };
      });
      timings[`${c.id}_${profile}`] = { bakeMs: info.bake.ms, bakeTargets: info.bake.timings, triangles: info.budget.total, target: info.budget.target };
      writeFileSync(join(RUN, 'characters', `${c.id}_${profile}.ps2char`), info.doc);
      for (const look of LOOKS) {
        await page.getByLabel('Light').selectOption(look);
        await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.viewport!.lookReady());
        for (const cam of CAMERAS) {
          const shot = await page.evaluate(
            async ({ cam, size }) => {
              const s = (window as unknown as TestWindow).__ps2cc;
              const vp = s.viewport!;
              vp.setCameraPreset(cam as never);
              const toB64 = async (b: Blob) => {
                const bytes = new Uint8Array(await b.arrayBuffer());
                let bin = '';
                for (let k = 0; k < bytes.length; k += 0x8000) bin += String.fromCharCode(...bytes.subarray(k, k + 0x8000));
                return btoa(bin);
              };
              const board = await toB64(await vp.screenshot(size, size));
              // Parity: the same frame without the noise and glow Unity does not reproduce exactly, and no ground disc.
              const look = vp.look;
              vp.customLook = { ...look, grade: { ...look.grade, grain: 0, bloom: { ...look.grade.bloom, strength: 0 } } };
              vp.groundShadow = false;
              const parity = await toB64(await vp.screenshot(size, size));
              vp.customLook = null;
              vp.groundShadow = true;
              return { board, parity, camera: vp.cameraState() };
            },
            { cam, size: SIZE },
          );
          const name = `${c.id}_${profile}_${look}_${cam}`;
          writeFileSync(join(RUN, 'app', `${name}.png`), Buffer.from(shot.board, 'base64'));
          writeFileSync(join(RUN, 'parity', `${name}.png`), Buffer.from(shot.parity, 'base64'));
          views.push({ name, character: c.id, profile, look, camera: cam, size: SIZE, ...shot.camera });
        }
      }
      // The export Unity imports for this profile.
      const message = await page.evaluate(async (name) => {
        const w = window as unknown as TestWindow;
        // One Unity folder per profile: the export is named after the character.
        w.__ps2cc.engine.update('bench name', (d) => void (d.name = name));
        await w.__ps2cc.settled();
        const { message } = await w.__ps2ccTest.prepareExport(w.__ps2cc, { glb: false, tPose: false }, '2026-11-12 12:00:00:000');
        let bin = '';
        for (let k = 0; k < message.length; k += 0x8000) bin += String.fromCharCode(...message.subarray(k, k + 0x8000));
        return btoa(bin);
      }, `${c.id}_${profile}`);
      writeFileSync(join(RUN, 'exports', `${c.id}_${profile}.ps2exp`), Buffer.from(message, 'base64'));
      await page.evaluate((name) => (window as unknown as TestWindow).__ps2cc.engine.update('bench name', (d) => void (d.name = name)), c.name);
    }
  }
  writeFileSync(join(RUN, 'views.json'), JSON.stringify({ size: SIZE, profiles: PROFILES, looks: LOOKS, cameras: CAMERAS, characters: CHARACTERS.map((c) => c.id), views }, null, 1) + '\n');
  writeFileSync(join(RUN, 'app_report.json'), JSON.stringify(timings, null, 1) + '\n');
});
