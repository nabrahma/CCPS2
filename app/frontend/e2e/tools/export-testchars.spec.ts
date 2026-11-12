/**
 * Test characters for M7 (PRD: "ufbx loads 10 exported test characters ...";
 * the Unity harness imports the same 10), and two wearing garments imported
 * from the M10 fixtures (PRD M10: "exports to Unity with correct skinning"). Each is built in the real app
 * (GPU skin composite, PNG textures, GLB checked with glTF-Validator) and its
 * export message is saved to app/backend/fbx/testdata/characters/, which the
 * Go round-trip test reads and `ps2cc-export` turns into export folders.
 * Run with `pnpm export:testchars`.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { fixtureGarment } from '../garment-helpers';
import { boot, garment, setCharacter } from '../helpers';
import { waitForTestHooks, type TestWindow } from '../skin-helpers';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, '../../../backend/fbx/testdata/characters');
const white = { color: [1, 1, 1], brightness: 1 };
const DEFAULTS = { gender: 0.5, age: 0.5, muscle: 0.5, weight: 0.5, height: 0.5, proportions: 0.5, breastSize: 0.5, breastFirmness: 0.5, african: 1 / 3, asian: 1 / 3, caucasian: 1 / 3 };
const bald = { mode: 'none', tint: white, alphaThreshold: 0.5 };
const cards = (style: string) => ({ mode: 'cards', style: style, atlas: null, tint: { color: [0.35, 0.25, 0.18], brightness: 1 }, alphaThreshold: 0.5 });

interface TestChar {
  name: string;
  macros: Record<string, number>;
  extra: Record<string, unknown>;
  hairStyle?: string;
  layers?: string[];
  tPose?: boolean;
  /** M10 fixtures to import and wear: [file, slot]. */
  imported?: [string, string][];
}

// All within the default 12k triangle budget (the Unity harness checks it). Every entry sets its body tier.
const body8 = { bodyMesh: 'ps2_body_8k' };
const CHARS: TestChar[] = [
  { name: 'Default Male', macros: { gender: 1, age: 0.5 }, extra: { ...body8, hair: bald, garments: [] } },
  { name: 'Default Female', macros: { gender: 0, age: 0.5 }, extra: { ...body8, garments: [] }, hairStyle: 'bob' },
  { name: 'Worker', macros: { gender: 1, age: 0.6, muscle: 0.7, weight: 0.6 }, extra: { ...body8, garments: [garment('mh:clothes/male_worksuit01', 'full')] }, hairStyle: 'crew', layers: ['stubble', 'dirt'] },
  { name: 'Office', macros: { gender: 0, age: 0.45 }, extra: { ...body8, hair: bald, garments: [garment('mh:clothes/toigo_turtleneck_halter_top', 'top'), garment('mh:clothes/toigo_wool_pants', 'bottom')] }, layers: ['lips', 'blush'] },
  { name: 'Old Man', macros: { gender: 1, age: 0.95, weight: 0.4 }, extra: { ...body8, hair: bald, garments: [garment('mh:clothes/male_casualsuit01', 'full')] }, layers: ['darkCircles', 'eyeBags'] },
  { name: 'Heavy', macros: { gender: 1, age: 0.55, weight: 1, muscle: 0.2 }, extra: { ...body8, garments: [garment('mh:clothes/male_casualsuit01', 'full')] }, hairStyle: 'buzz' },
  { name: 'Athlete', macros: { gender: 0, age: 0.4, muscle: 1, weight: 0.3, height: 0.8 }, extra: { ...body8, garments: [] }, hairStyle: 'ponytail', layers: ['freckles'] },
  { name: 'Short', macros: { gender: 0, age: 0.6, height: 0, proportions: 0.2 }, extra: { bodyMesh: 'ps2_body_10k', hair: bald, garments: [] }, layers: ['bruises'] },
  { name: 'Tall T-pose', macros: { gender: 1, age: 0.35, height: 1, proportions: 1 }, extra: { ...body8, garments: [garment('mh:clothes/male_worksuit01', 'full')] }, hairStyle: 'buzz', tPose: true },
  { name: 'Mesh Hair', macros: { gender: 0, age: 0.5, african: 1, asian: 0, caucasian: 0 }, extra: { ...body8, hair: { mode: 'mesh', asset: 'mh:hair/bob02', tint: white, alphaThreshold: 0.5 }, garments: [] }, layers: ['eyeliner', 'tone'] },
  { name: 'Custom Shirt', macros: { gender: 1, age: 0.5, muscle: 0.7, weight: 0.7 }, extra: { ...body8, hair: bald, garments: [] }, imported: [['test_shirt', 'top']] },
  { name: 'Custom Trousers', macros: { gender: 0, age: 0.6, weight: 0.8, height: 0.3 }, extra: { ...body8, hair: bald, garments: [] }, imported: [['test_trousers', 'bottom']] },
  { name: 'Custom Skirt', macros: { gender: 0, age: 0.4, height: 0.7 }, extra: { ...body8, hair: bald, garments: [] }, imported: [['test_skirt', 'bottom']] },
];

test('export the test characters', async ({ page }) => {
  test.setTimeout(900_000);
  await boot(page);
  await waitForTestHooks(page);
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const report: Record<string, unknown>[] = [];
  for (const [i, c] of CHARS.entries()) {
    // Start every character from the default sliders (setCharacter merges macros).
    await setCharacter(page, { ...DEFAULTS, ...c.macros }, { name: c.name, modifiers: {}, ...c.extra, ...(c.hairStyle ? { hair: cards(c.hairStyle) } : {}) });
    for (const [fixture, slot] of c.imported ?? []) {
      await page.evaluate(
        async ({ file, slot }) => {
          const s = (window as unknown as TestWindow).__ps2cc;
          const g = await s.importGarment(file, { name: file.name, slot: slot as never });
          s.engine.update('wear', (d) => void d.garments.push({ slot: slot as never, asset: g.meta.id, tint: { color: [0.6, 0.65, 0.8], brightness: 1 }, dirt: 0, hideBody: true }));
          await s.settled();
        },
        { file: fixtureGarment(fixture), slot },
      );
    }
    if (c.hairStyle) {
      // Card hair needs the full starter style object.
      await page.evaluate(async (style) => {
        const w = window as unknown as TestWindow;
        w.__ps2cc.engine.update('style', (d) => void (d.hair.style = w.__ps2ccTest.core.starterStyle(style)));
        await w.__ps2cc.settled();
      }, c.hairStyle);
    }
    const res = await page.evaluate(
      async ({ layers, tPose }) => {
        const w = window as unknown as TestWindow;
        const s = w.__ps2cc;
        const { core } = w.__ps2ccTest;
        s.engine.update('layers', (d) => {
          // The test characters keep the settings they were made with before quality profiles (Part 2 F13).
          d.export = { ...d.export, ...core.LEGACY_EXPORT };
          d.skin.layers = (layers ?? []).map((k) => core.newLayer(k as never));
        });
        await s.settled();
        // The GLB is validated here; the saved message leaves it out (the FBX tests do not need it).
        const { scene, message } = await w.__ps2ccTest.prepareExport(s, { glb: false, tPose: Boolean(tPose) }, '2026-11-08 12:00:00:000');
        const glb = await w.__ps2ccTest.buildGlb(scene);
        let bin = '';
        for (let k = 0; k < message.length; k += 0x8000) bin += String.fromCharCode(...message.subarray(k, k + 0x8000));
        return {
          name: scene.name,
          message: btoa(bin),
          meshes: scene.meshes.map((m) => `${m.role}:${m.indices.length / 3}`),
          triangles: scene.meshes.reduce((t, m) => t + m.indices.length / 3, 0),
          budget: s.scene.budget().total,
          glbErrors: glb.errors,
          glbWarnings: glb.warnings,
          glbMessages: glb.messages.slice(0, 5),
        };
      },
      { layers: c.layers, tPose: c.tPose },
    );
    expect(res.glbErrors, `${c.name}: ${res.glbMessages.join('; ')}`).toBe(0);
    expect(res.triangles).toBe(res.budget);
    expect(res.triangles, `${c.name} is over the 12k budget`).toBeLessThanOrEqual(12000);
    const file = join(OUT, `${String(i + 1).padStart(2, '0')}_${res.name.replace(/\W+/g, '_')}.ps2exp`);
    writeFileSync(file, Buffer.from(res.message, 'base64'));
    report.push({ file: file.split(/[\\/]/).pop(), ...res, message: undefined });
    console.log(`${res.name}: ${res.triangles} triangles [${res.meshes.join(', ')}], GLB ${res.glbErrors} errors / ${res.glbWarnings} warnings`);
  }
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  expect(readdirSync(OUT).filter((f) => f.endsWith('.ps2exp'))).toHaveLength(CHARS.length);
});
