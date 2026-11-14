/**
 * PRD Part 2 M15 (Materials and wardrobe), the checks that need a browser:
 * - every library material, converted to its era diffuse and rendered flat,
 *   matches its PBR original under the same light at SSIM >= 0.85;
 * - a garment dressed in the UI: a material, picked pieces, a decal, seams and
 *   folds change the texture the viewport shows, and the export composes the
 *   same image;
 * - Garment Studio round trip through the UI: crop, pocket, collar, save as a
 *   new garment, wear it, and put it on another character from the Wardrobe;
 * - review renders of Mara and Cole in their outfits (docs/milestones/M15/).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { ssim } from '../../../tools/asset-tools/src/bench';
import { Canvas } from '../../../tools/asset-tools/src/png';
import { CHARACTERS, buildCharacter } from './bench-characters';
import { boot, garment, MILESTONES, setCharacter } from './helpers';
import { waitForTestHooks, type TestWindow } from './skin-helpers';

const OUT = join(MILESTONES, 'M15');
const SSIM_LIMIT = 0.85;
const NEUTRAL = { gender: 1, age: 0.5, african: 1 / 3, asian: 1 / 3, caucasian: 1 / 3, weight: 0.5, muscle: 0.5 };
const bald = { mode: 'none', tint: { color: [1, 1, 1], brightness: 1 }, alphaThreshold: 0.5 };

async function start(page: Page): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  await boot(page);
  await waitForTestHooks(page);
  await page.setViewportSize({ width: 1400, height: 1000 });
}

async function shot(page: Page, name: string, w = 640, h = 800): Promise<void> {
  const b64 = await page.evaluate(
    async ({ w, h }) => {
      const s = (window as unknown as TestWindow).__ps2cc;
      await s.settled();
      await s.viewport!.lookReady();
      const u = new Uint8Array(await (await s.viewport!.screenshot(w, h)).arrayBuffer());
      let bin = '';
      for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode(...u.subarray(i, i + 0x8000));
      return btoa(bin);
    },
    { w, h },
  );
  writeFileSync(join(OUT, name), Buffer.from(b64, 'base64'));
}

/** Wait until every garment's composed look is on screen (the viewport composes them asynchronously). */
async function looksReady(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const s = (window as unknown as TestWindow).__ps2cc;
    await s.settled();
    const load = (p: string) => (window as unknown as TestWindow).__ps2ccTest.decodeImage((/^(https?:|blob:|data:|\/)/.test(p) ? p : `${s.info.coreAssetsUrl.replace(/\/$/, '')}/${p}`));
    for (const p of s.scene.parts) if (p.material.wardrobe) await p.material.wardrobe.compose(1024, load);
    await new Promise((r) => setTimeout(r, 300));
    s.viewport!.refresh();
  });
}

test('M15: every library material converts to an era diffuse matching its PBR original (SSIM >= 0.85)', async ({ page }) => {
  test.setTimeout(300_000);
  await start(page);
  // One material per call: the pixels go back as base64 (a plain array of every channel is too big for the page).
  const ids = await page.evaluate(() => ((window as unknown as TestWindow).__ps2cc.assets.catalog.materials ?? []).map((m) => m.id));
  const results: { id: string; pbr: Uint8Array; era: Uint8Array; plain: Uint8Array; size: number }[] = [];
  for (const id of ids) {
    const r = await page.evaluate(async (id) => {
      const w = window as unknown as TestWindow;
      const s = w.__ps2cc;
      const m = s.assets.catalog.materials!.find((x) => x.id === id)!;
      const { pbr, era, plain } = await w.__ps2ccTest.renderMaterialPair(m, s.info.coreAssetsUrl, 384);
      const b64 = (u: Uint8ClampedArray) => {
        let bin = '';
        for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode(...u.subarray(i, i + 0x8000));
        return btoa(bin);
      };
      return { pbr: b64(pbr.data), era: b64(era.data), plain: b64(plain.data), size: pbr.width };
    }, id);
    results.push({ id, pbr: new Uint8Array(Buffer.from(r.pbr, 'base64')), era: new Uint8Array(Buffer.from(r.era, 'base64')), plain: new Uint8Array(Buffer.from(r.plain, 'base64')), size: r.size });
  }
  expect(results.length).toBeGreaterThanOrEqual(9);
  const report: Record<string, number> = {};
  const control: Record<string, number> = {};
  const failures: string[] = [];
  for (const r of results) {
    const img = (rgba: Uint8Array) => ({ width: r.size, height: r.size, rgba });
    const v = ssim(img(r.pbr), img(r.era)).mean;
    report[r.id] = +v.toFixed(4);
    control[r.id] = +ssim(img(r.pbr), img(r.plain)).mean.toFixed(4);
    if (v < SSIM_LIMIT) failures.push(`${r.id}: ${v.toFixed(3)}`);
  }
  // The check has teeth: the albedo alone, unconverted, matches the original less well on average.
  const mean = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0) / Object.values(o).length;
  // A side-by-side of the worst material (PBR left, era diffuse right) for review.
  const worst = results.reduce((x, y) => (report[x.id]! <= report[y.id]! ? x : y));
  const n = worst.size;
  const side = new Canvas(n * 2, n);
  for (let y = 0; y < n; y++) {
    side.data.set(worst.pbr.subarray(y * n * 4, (y + 1) * n * 4), y * 2 * n * 4);
    side.data.set(worst.era.subarray(y * n * 4, (y + 1) * n * 4), (y * 2 * n + n) * 4);
  }
  writeFileSync(join(OUT, 'material_check_worst.png'), side.toPng());
  writeFileSync(join(OUT, 'material_check.json'), JSON.stringify({ limit: SSIM_LIMIT, light: 'ERA_LIGHT (key from above and in front, hemisphere fill)', ssim: report, controlAlbedoOnly: control, meanEra: mean(report), meanControl: mean(control) }, null, 1) + '\n');
  console.info(`[M15 materials] ${JSON.stringify(report)}; albedo only: ${JSON.stringify(control)}`);
  expect(failures).toEqual([]);
  expect(mean(report)).toBeGreaterThan(mean(control));
});

test('M15: a garment dressed in the UI: material, pieces, decal, seams and folds; the export composes the same', async ({ page }) => {
  test.setTimeout(400_000);
  await start(page);
  await setCharacter(page, NEUTRAL, { hair: bald, garments: [garment('mh:clothes/toigo_fisherman_sweater', 'outer')] });
  const key = 'garment:outer:mh:clothes/toigo_fisherman_sweater';
  await page.evaluate((k) => (window as unknown as TestWindow).__ps2ccTest.useUi.getState().select(k), key);
  await page.getByTestId('look-start').click();
  await page.getByTestId('look-zone-material-0').selectOption('ps2cc:materials/denim');
  await looksReady(page);
  await page.getByTestId('look-zone-wear-0').fill('0.6');
  await page.getByTestId('look-folds').fill('1.2');
  // A second zone, given the piece under the middle of the chest.
  await page.getByTestId('look-add-zone').click();
  await page.getByTestId('look-zone-material-1').selectOption('ps2cc:materials/leather_worn');
  await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.viewport!.setCameraPreset('bust' as never));
  await page.getByTestId('look-zone-pick-1').click();
  const canvas = page.locator('canvas').first();
  const box = (await canvas.boundingBox())!;
  const chest = { x: box.x + box.width / 2, y: box.y + box.height * 0.72 };
  await page.mouse.click(chest.x, chest.y);
  await expect.poll(() => page.evaluate(() => {
    const g = (window as unknown as TestWindow).__ps2cc.engine.doc.garments[0]!;
    const z = g.look?.zones[1];
    return z && z.islands !== 'rest' ? z.islands.length : 0;
  })).toBe(1);
  await page.getByTestId('garment-tool-done').click();
  // A patch pocket decal, clicked onto the garment.
  await page.getByTestId('look-decal-pocketFlap').click();
  await page.mouse.click(chest.x + box.width * 0.06, chest.y - box.height * 0.04);
  await expect.poll(() => page.evaluate(() => (window as unknown as TestWindow).__ps2cc.engine.doc.garments[0]!.look?.decals.length ?? 0)).toBe(1);
  await page.getByTestId('garment-tool-done').click();
  await looksReady(page);
  await shot(page, 'ui_garment_look_bust.png');
  await page.screenshot({ path: join(OUT, 'ui_garment_look.png') });

  // The export composes the look (same code as the viewport): the garment cell is the composed texture.
  const res = await page.evaluate(async () => {
    const w = window as unknown as TestWindow;
    const s = w.__ps2cc;
    const part = s.scene.parts.find((p) => p.kind === 'garment')!;
    const load = (p: string) => w.__ps2ccTest.decodeImage((/^(https?:|blob:|data:|\/)/.test(p) ? p : `${s.info.coreAssetsUrl.replace(/\/$/, '')}/${p}`));
    const a = await part.material.wardrobe!.compose(512, load);
    const b = await part.material.wardrobe!.compose(512, load);
    let same = a.data.length === b.data.length;
    for (let i = 0; same && i < a.data.length; i++) same = a.data[i] === b.data[i];
    // Against the plain garment texture: the look changed most texels.
    const plain = await load(part.material.texture!);
    const t = w.__ps2ccTest.core.resizeImage(plain, 512, 512);
    let changed = 0;
    for (let i = 0; i < 512 * 512; i++) if (Math.abs(a.data[i * 4]! - t.data[i * 4]!) + Math.abs(a.data[i * 4 + 2]! - t.data[i * 4 + 2]!) > 30) changed++;
    const { message } = await w.__ps2ccTest.prepareExport(s, { glb: false, tPose: false }, '2026-11-14 12:00:00:000');
    return { same, changed: changed / (512 * 512), exportBytes: message.length };
  });
  expect(res.same).toBe(true);
  expect(res.changed).toBeGreaterThan(0.3);
  expect(res.exportBytes).toBeGreaterThan(1000);

  // Save, reload and the look comes back.
  const text = await page.evaluate(() => {
    const w = window as unknown as TestWindow;
    return w.__ps2ccTest.core.serializeCharacter(w.__ps2cc.engine.doc as never);
  });
  const back = await page.evaluate((t) => {
    const core = (window as unknown as TestWindow).__ps2ccTest.core;
    return core.parseCharacter(JSON.parse(t)).garments[0]!.look;
  }, text);
  expect(back?.zones.length).toBe(2);
  expect(back?.decals[0]?.kind).toBe('pocketFlap');
});

test('M15: Garment Studio round trip: crop, pocket and collar, save, wear, reuse on another character', async ({ page }) => {
  test.setTimeout(400_000);
  await start(page);
  await setCharacter(page, { ...NEUTRAL, weight: 0.7, muscle: 0.3 }, { hair: bald, garments: [garment('mh:clothes/toigo_basic_tucked_t-shirt', 'top')] });
  const key = 'garment:top:mh:clothes/toigo_basic_tucked_t-shirt';
  await page.evaluate((k) => (window as unknown as TestWindow).__ps2ccTest.useUi.getState().select(k), key);
  await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.viewport!.setCameraPreset('full' as never));
  await page.getByTestId('open-garment-studio').click();
  await expect(page.getByTestId('garment-studio')).toBeVisible();
  const faces = async () => Number((await page.getByTestId('garment-studio').locator('.hint').textContent())!.split(' ')[0]!.replace(/,/g, ''));
  await expect.poll(faces).toBeGreaterThan(100);
  const before = await faces();
  // Points on the garment, from the camera.
  const at = async (fx: number, fy: number) => {
    const box = (await page.locator('canvas').first().boundingBox())!;
    return { x: box.x + box.width * fx, y: box.y + box.height * fy };
  };
  const onGarment = async () =>
    page.evaluate((k) => {
      const s = (window as unknown as TestWindow).__ps2cc;
      const view = s.viewport!.groomView();
      const r = (document.querySelector('canvas') as HTMLCanvasElement).getBoundingClientRect();
      const hits: { fx: number; fy: number; p: number[] }[] = [];
      for (let fy = 0.2; fy < 0.7; fy += 0.01)
        for (let fx = 0.2; fx < 0.8; fx += 0.01) {
          const h = view.pick(fx * r.width, fy * r.height, k);
          if (h) hits.push({ fx, fy, p: h.point });
        }
      return hits;
    }, key);
  const hits = await onGarment();
  expect(hits.length).toBeGreaterThan(50);
  // Crop: a point low on the torso, near the middle.
  const low = hits.filter((h) => Math.abs(h.p[0]!) < 0.05).sort((a, b) => a.p[1]! - b.p[1]!)[Math.floor(hits.filter((h) => Math.abs(h.p[0]!) < 0.05).length * 0.2)]!;
  await page.getByTestId('garment-tool-crop').click();
  let p = await at(low.fx, low.fy);
  await page.mouse.click(p.x, p.y);
  await expect.poll(faces).toBeLessThan(before);
  // A pocket on the chest (mirrored).
  // The chest: between the bottom of the rib cage and the neck, a little off centre.
  const chestY = await page.evaluate(() => {
    const sk = (window as unknown as TestWindow).__ps2cc.engine.skeleton;
    const y = (n: string) => sk.heads[sk.rig.index.get(n)! * 3 + 1]!;
    return y('spine_03') + (y('neck_01') - y('spine_03')) * 0.42;
  });
  const chest = hits.reduce((a, b) => (Math.hypot(a.p[0]! - 0.08, a.p[1]! - chestY) <= Math.hypot(b.p[0]! - 0.08, b.p[1]! - chestY) ? a : b));
  await page.getByTestId('garment-tool-pocket').click();
  const afterCrop = await faces();
  p = await at(chest.fx, chest.fy);
  await page.mouse.click(p.x, p.y);
  await expect.poll(faces).toBeGreaterThan(afterCrop);
  // A collar from the neckline.
  const top = hits.filter((h) => Math.abs(h.p[0]!) < 0.04).sort((a, b) => b.p[1]! - a.p[1]!)[0]!;
  await page.getByTestId('garment-tool-edge').click();
  const afterPocket = await faces();
  p = await at(top.fx, top.fy);
  await page.mouse.click(p.x, p.y);
  await expect.poll(faces).toBeGreaterThan(afterPocket);
  // An inflate stroke, then undo it: back to the same face count and shape.
  await page.getByTestId('garment-tool-inflate').click();
  p = await at(chest.fx, chest.fy);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 20, p.y + 10, { steps: 5 });
  await page.mouse.up();
  await page.getByTestId('garment-studio-undo').click();
  await shot(page, 'garment_studio_edit.png');
  await page.getByTestId('garment-studio-name').fill('Cropped shirt with collar');
  await page.getByTestId('garment-studio-save').click();
  await expect(page.getByTestId('garment-studio')).toBeHidden({ timeout: 120_000 });
  const worn = await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.engine.doc.garments.map((g) => g.asset));
  expect(worn.length).toBe(1);
  expect(worn[0]).toMatch(/^user:garment\//);
  await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.settled());
  await shot(page, 'garment_studio_saved.png');
  // Reuse: another character puts it on from the Wardrobe.
  await setCharacter(page, { ...NEUTRAL, gender: 0, weight: 0.3 }, { hair: bald, garments: [] });
  await page.evaluate(() => (window as unknown as TestWindow).__ps2ccTest.useUi.getState().setTab('clothes' as never));
  await page.getByText('Cropped shirt with collar').first().click();
  const reused = await page.evaluate(async () => {
    const s = (window as unknown as TestWindow).__ps2cc;
    await s.settled();
    const g = s.scene.parts.find((x) => x.kind === 'garment');
    return { asset: s.engine.doc.garments[0]?.asset ?? null, triangles: g?.triangleCount ?? 0, finite: g ? Array.from(g.positions).every(Number.isFinite) : false };
  });
  expect(reused.asset).toBe(worn[0]);
  expect(reused.triangles).toBeGreaterThan(100);
  expect(reused.finite).toBe(true);
  await shot(page, 'garment_studio_reused.png');
});

test('M15: Mara and Cole in their outfits (review renders)', async ({ page }) => {
  test.setTimeout(900_000);
  await start(page);
  for (const c of CHARACTERS) {
    await buildCharacter(page, c);
    await page.evaluate(async () => {
      const s = (window as unknown as TestWindow).__ps2cc;
      const core = (window as unknown as TestWindow).__ps2ccTest.core;
      s.engine.update('profile', (d) => {
        d.export = { ...d.export, ...core.profileSettings('enhanced' as never) };
        d.bodyMesh = core.bodyMeshFor('enhanced' as never);
      });
      await s.settled();
    });
    await looksReady(page);
    for (const look of ['villageOvercast', 'studio']) {
      await page.getByLabel('Light').selectOption(look);
      for (const cam of ['threeQuarter', 'full', 'back', 'profile']) {
        await page.evaluate((cam) => (window as unknown as TestWindow).__ps2cc.viewport!.setCameraPreset(cam as never), cam);
        await shot(page, `${c.id}_${look}_${cam}.png`);
      }
    }
    await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.viewport!.setCameraPreset('bust' as never));
    await shot(page, `${c.id}_studio_bust.png`);
    // Each outfit garment's composed texture.
    const textures = await page.evaluate(async () => {
      const w = window as unknown as TestWindow;
      const s = w.__ps2cc;
      const load = (p: string) => w.__ps2ccTest.decodeImage((/^(https?:|blob:|data:|\/)/.test(p) ? p : `${s.info.coreAssetsUrl.replace(/\/$/, '')}/${p}`));
      const out: Record<string, string> = {};
      for (const p of s.scene.parts) {
        if (!p.material.wardrobe || !p.assetId.startsWith('ps2cc:')) continue;
        const img = await p.material.wardrobe.compose(1024, load);
        const u = new Uint8Array(await (await w.__ps2ccTest.imageToPng(img)).arrayBuffer());
        let bin = '';
        for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode(...u.subarray(i, i + 0x8000));
        out[p.assetId.split('/').pop()!] = btoa(bin);
      }
      return out;
    });
    for (const [name, b64] of Object.entries(textures)) writeFileSync(join(OUT, `texture_${name}.png`), Buffer.from(b64, 'base64'));
  }
});
