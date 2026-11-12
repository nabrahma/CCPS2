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
import { boot, garment, setCharacter } from '../helpers';
import { waitForTestHooks, type TestWindow } from '../skin-helpers';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, '../../../..');
const RUN = process.env.PS2CC_BENCH_DIR ?? join(REPO, 'docs', 'bench', 'latest');
const SIZE = Number(process.env.PS2CC_BENCH_SIZE ?? 640);
const PROFILES = ['classic', 'enhanced', 'hero'] as const;
const LOOKS = ['interiorFlashlight', 'villageOvercast'] as const;
const CAMERAS = ['threeQuarter', 'full', 'profile', 'back'] as const;
const DEFAULTS = { gender: 0.5, age: 0.5, muscle: 0.5, weight: 0.5, height: 0.5, proportions: 0.5, breastSize: 0.5, breastFirmness: 0.5, african: 1 / 3, asian: 1 / 3, caucasian: 1 / 3 };
const tint = (r: number, g: number, b: number) => ({ color: [r, g, b], brightness: 1 });

/**
 * The benchmark characters (section 4). Part 2 builds their outfits in later
 * milestones; this first pass uses what the library has now.
 */
const CHARACTERS = [
  {
    id: 'mara',
    name: 'Mara',
    macros: { ...DEFAULTS, gender: 0, age: 0.38, muscle: 0.55, weight: 0.42, height: 0.48 },
    garments: [
      garment('mh:clothes/toigo_turtleneck_halter_top', 'top', { tint: tint(0.36, 0.38, 0.34), dirt: 0.35 }),
      garment('mh:clothes/cortu_cargo_pants', 'bottom', { tint: tint(0.42, 0.38, 0.3), dirt: 0.4 }),
      garment('mh:clothes/toigo_ankle_boots_female', 'shoes', { tint: tint(0.35, 0.3, 0.26) }),
      garment('mh:clothes/toigo_gloves_short', 'gloves', { tint: tint(0.25, 0.24, 0.23) }),
    ],
    skin: 'mh:skins/young_caucasian_female',
    // Short layered bob with a fringe.
    hair: { style: 'bob-fringe', atlas: 'blonde', length: { front: 0.15, sides: 0.16, back: 0.13, top: 0.15 } },
    layers: [
      ['freckles', { density: 0.35 }],
      ['darkCircles', {}],
      ['dirt', { amount: 0.25 }],
    ],
  },
  {
    id: 'cole',
    name: 'Cole',
    macros: { ...DEFAULTS, gender: 1, age: 0.55, muscle: 0.62, weight: 0.5, height: 0.6 },
    garments: [
      garment('mh:clothes/toigo_fisherman_sweater', 'outer', { tint: tint(0.2, 0.19, 0.18) }),
      garment('mh:clothes/cortu_cargo_pants', 'bottom', { tint: tint(0.3, 0.3, 0.26), dirt: 0.3 }),
      garment('mh:clothes/culturalibre_male_boots', 'shoes', { tint: tint(0.3, 0.24, 0.19) }),
      garment('mh:clothes/learning_mma_fighting_gloves', 'gloves', { tint: tint(0.18, 0.17, 0.16) }),
    ],
    skin: 'mh:skins/young_caucasian_male',
    // Centre-parted curtain fringe, chin-length side locks, short nape.
    hair: { style: 'long-centre-part', atlas: 'brown', length: { front: 0.17, sides: 0.17, back: 0.08, top: 0.15 } },
    layers: [
      ['stubble', { density: 0.35 }],
      ['eyeBags', {}],
    ],
  },
] as const;

async function build(page: Page, c: (typeof CHARACTERS)[number]): Promise<void> {
  await setCharacter(page, c.macros, { name: c.name, modifiers: {}, garments: c.garments });
  await page.evaluate(
    async (c: (typeof CHARACTERS)[number]) => {
      const w = window as unknown as TestWindow;
      const s = w.__ps2cc;
      const { core } = w.__ps2ccTest;
      const atlas = s.assets.catalog.hairAtlases!.find((a) => a.id === `ps2cc:atlas/cards_${c.hair.atlas}`)!.atlas;
      s.engine.update('benchmark', (d) => {
        d.skin = { base: c.skin, layers: [], photo: null };
        const style = core.starterStyle(c.hair.style);
        style.length = { ...c.hair.length };
        d.hair = { mode: 'cards', style, atlas, tint: { color: [1, 1, 1], brightness: 1 }, alphaThreshold: 0.5 };
        for (const [kind, params] of c.layers) {
          const layer = core.newLayer(kind as never);
          Object.assign(layer.params, params);
          d.skin.layers.push(layer);
        }
      });
      await s.settled();
    },
    c,
  );
}

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
