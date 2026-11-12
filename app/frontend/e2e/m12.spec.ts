/**
 * PRD M12 (Hair v2 and Hair Studio) in the app:
 *  - coverage: in front, side, back and top renders of all eight Hair v2
 *    styles, skin pixels inside the hair silhouette are under 1% (ID buffer);
 *    review renders of each style go to docs/milestones/M12/;
 *  - Hair Studio: a comb stroke becomes an authored groom in one undo step;
 *    the parting tool, the lock tool and the layer view;
 *  - Hair Studio's card mode (D-114): the hair becomes hand-placed cards, one
 *    curve per card; brushes, Draw and the card settings work on them;
 *  - fur trims and card brows grow, render and export;
 *  - Hair v2 exports: the gradient-mapped texture and Unity's soft pass flag.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { boot, garment, MILESTONES, setCharacter } from './helpers';
import { waitForTestHooks, type TestWindow } from './skin-helpers';

const OUT = join(MILESTONES, 'M12');

/** Head views of the coverage test. */
const VIEWS: Record<string, { targetHeight: number; span: number; yaw: number; pitch: number }> = {
  front: { targetHeight: 0.915, span: 0.2, yaw: 0, pitch: 0 },
  side: { targetHeight: 0.915, span: 0.2, yaw: Math.PI / 2, pitch: 0 },
  back: { targetHeight: 0.915, span: 0.2, yaw: Math.PI, pitch: 0 },
  top: { targetHeight: 0.93, span: 0.2, yaw: 0, pitch: 1.45 },
};

/** Who wears each style in the review, and in which colour. */
const WEARERS: Record<string, { female: boolean; colour: string }> = {
  'mara-bob': { female: true, colour: 'blonde' },
  'cole-curtain': { female: false, colour: 'darkBrown' },
  'short-messy': { female: false, colour: 'brown' },
  'side-part': { female: false, colour: 'black' },
  bob: { female: true, colour: 'auburn' },
  'shoulder-straight': { female: true, colour: 'lightBrown' },
  'long-straight': { female: true, colour: 'darkBrown' },
  ponytail: { female: true, colour: 'brown' },
};

async function wearStyle(page: Page, id: string): Promise<void> {
  const w = WEARERS[id]!;
  await setCharacter(page, { gender: w.female ? 0 : 1, age: 0.5 }, { garments: [] });
  await page.evaluate(
    async ({ id, colour }) => {
      const win = window as unknown as TestWindow;
      const s = win.__ps2cc;
      const core = win.__ps2ccTest.core;
      s.engine.update('e2e style', (d) => {
        d.hair = { mode: 'cards', style: core.starterStyle(id), atlas: null, colour: structuredClone(core.HAIR_COLOUR_PRESETS[colour]!.colour), tint: { color: [1, 1, 1], brightness: 1 }, alphaThreshold: 0.5 };
        core.withScalpLayer(d as never);
      });
      await s.settled();
      await s.viewport!.skinSettled();
    },
    { id, colour: w.colour },
  );
}

/** Share of skin among the pixels inside the hair silhouette (hair, and whatever it encloses). */
async function skinInSilhouette(page: Page, frame: (typeof VIEWS)[string]): Promise<{ skin: number; silhouette: number }> {
  return page.evaluate(async (frame) => {
    const s = (window as unknown as TestWindow).__ps2cc;
    s.viewport!.setCameraFrame(frame);
    await new Promise((r) => setTimeout(r, 200));
    const id = s.viewport!.renderIds(256, 256);
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
    return { skin, silhouette };
  }, frame);
}

test('coverage: under 1% skin inside the hair silhouette, eight styles, four views; review renders', async ({ page }) => {
  test.setTimeout(1_800_000);
  mkdirSync(OUT, { recursive: true });
  await boot(page);
  await waitForTestHooks(page);
  await page.getByLabel('Light').selectOption('studio');
  const report: Record<string, Record<string, number> & { triangles: number }> = {};
  for (const id of Object.keys(WEARERS)) {
    await wearStyle(page, id);
    const triangles = await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.scene.parts.find((p) => p.kind === 'hair')!.triangleCount);
    const row: Record<string, number> = {};
    for (const [view, frame] of Object.entries(VIEWS)) {
      const r = await skinInSilhouette(page, frame);
      expect(r.silhouette, `${id} ${view}: hair in view`).toBeGreaterThan(1000);
      row[view] = r.skin / r.silhouette;
      await page.waitForTimeout(500);
      await page.getByTestId('viewport').screenshot({ path: join(OUT, `${id}_${view}.png`) });
    }
    await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.viewport!.setCameraFrame({ targetHeight: 0.9, span: 0.26, yaw: Math.PI / 5, pitch: 0.05 }));
    await page.waitForTimeout(500);
    await page.getByTestId('viewport').screenshot({ path: join(OUT, `${id}_threeQuarter.png`) });
    report[id] = { ...row, triangles } as never;
    console.log(id, JSON.stringify(report[id]));
  }
  writeFileSync(join(OUT, 'coverage.json'), JSON.stringify(report, null, 2) + '\n');
  for (const [id, row] of Object.entries(report)) {
    for (const view of Object.keys(VIEWS)) expect(row[view]!, `${id} ${view}: skin inside the hair silhouette`).toBeLessThan(0.01);
  }
});

test('Hair Studio: a comb stroke is one undo step; parting, lock tool and layer view', async ({ page }) => {
  test.setTimeout(600_000);
  await boot(page);
  await waitForTestHooks(page);
  await wearStyle(page, 'mara-bob');
  await page.getByRole('tab', { name: 'Hair', exact: true }).click();
  await page.getByTestId('open-hair-studio').click();
  await expect(page.getByTestId('hair-studio')).toBeVisible();
  await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.viewport!.setCameraFrame({ targetHeight: 0.915, span: 0.22, yaw: 0, pitch: 0.35 }));
  await page.waitForTimeout(400);
  const curves = () => page.evaluate(() => (window as unknown as TestWindow).__ps2cc.engine.doc.hair.style!.groom.curves ?? null);
  expect(await curves()).toBeNull();

  // A comb stroke across the side of the head.
  const box = (await page.getByTestId('viewport').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height * 0.42;
  await page.getByTestId('groom-tool-comb').click();
  await page.mouse.move(cx + 120, cy);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(cx + 120 + i * 8, cy + i * 4);
  await page.mouse.up();
  await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.settled());
  const combed = await curves();
  expect(combed, 'the stroke made an authored groom').not.toBeNull();
  expect(combed!.length).toBeGreaterThan(10);
  await page.getByTestId('viewport').screenshot({ path: join(OUT, 'studio_comb.png') });
  // One undo step: back to the guides from the sliders.
  await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.engine.undo());
  expect(await curves()).toBeNull();
  await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.engine.redo());
  expect(await curves()).toEqual(combed);

  // Parting: drawn over the top of the head, stored on the neutral head.
  await page.getByTestId('groom-parting').click();
  await page.mouse.move(cx - 20, box.y + box.height * 0.26);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(cx - 20, box.y + box.height * (0.26 + i * 0.012));
  await page.mouse.up();
  const line = await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.engine.doc.hair.style!.part.line ?? null);
  expect(line, 'parting line').not.toBeNull();
  expect(line!.length).toBeGreaterThanOrEqual(6);

  // Lock tool: select some guides, give them wider locks.
  await page.getByTestId('groom-tool-select').click();
  await page.mouse.move(cx + 100, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 110, cy + 10);
  await page.mouse.up();
  await page.getByTestId('lock-width').fill('2');
  await page.getByTestId('lock-apply').click();
  const widths = await page.evaluate(() => ((window as unknown as TestWindow).__ps2cc.engine.doc.hair.style!.groom.curves ?? []).filter((c) => c.lockWidth === 2).length);
  expect(widths).toBeGreaterThan(0);

  // Layer view: hiding locks and cards leaves fewer hair pixels in an ID render; showing them brings them back.
  const hairPixels = () =>
    page.evaluate(() => {
      const id = (window as unknown as TestWindow).__ps2cc.viewport!.renderIds(128, 128);
      let n = 0;
      for (let i = 0; i < 128 * 128; i++) if (id.data[i * 4] === 1) n++;
      return n;
    });
  const all = await hairPixels();
  await page.getByTestId('hair-layer-locks').uncheck();
  await page.getByTestId('hair-layer-cards').uncheck();
  expect(await hairPixels()).toBeLessThan(all * 0.6);
  await page.getByTestId('hair-layer-locks').check();
  await page.getByTestId('hair-layer-cards').check();
  expect(await hairPixels()).toBe(all);
  await page.screenshot({ path: join(OUT, 'ui_hair_studio.png') });
  await page.getByTestId('hair-studio-done').click();
  await expect(page.getByTestId('hair-studio')).toHaveCount(0);
});

test('Hair Studio card mode: one curve is one card; comb, draw, card settings, back to guides', async ({ page }) => {
  test.setTimeout(600_000);
  await boot(page);
  await waitForTestHooks(page);
  await wearStyle(page, 'mara-bob');
  await page.getByRole('tab', { name: 'Hair', exact: true }).click();
  await page.getByTestId('open-hair-studio').click();
  await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.viewport!.setCameraFrame({ targetHeight: 0.915, span: 0.22, yaw: 0, pitch: 0.35 }));
  await page.waitForTimeout(400);
  const state = () =>
    page.evaluate(() => {
      const s = (window as unknown as TestWindow).__ps2cc;
      const hair = s.scene.cardHair!;
      return { cards: s.engine.doc.hair.style!.groom.cards ?? null, meshCards: hair.locks + hair.cards };
    });

  // Edit cards directly: every lock and card on screen becomes its own curve.
  const meshBefore = (await state()).meshCards;
  await page.getByTestId('groom-to-cards').click();
  await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.settled());
  const converted = await state();
  expect(converted.cards).not.toBeNull();
  expect(converted.cards!.length).toBe(meshBefore);
  expect(converted.meshCards).toBe(meshBefore);
  await expect(page.getByTestId('groom-tool-draw')).toBeVisible();

  // A comb stroke moves cards and keeps every one of them; it is one undo step.
  const box = (await page.getByTestId('viewport').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height * 0.42;
  await page.getByTestId('groom-tool-comb').click();
  await page.mouse.move(cx + 120, cy);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(cx + 120 + i * 8, cy + i * 4);
  await page.mouse.up();
  await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.settled());
  const combed = await state();
  expect(combed.cards!.length).toBe(converted.cards!.length);
  expect(JSON.stringify(combed.cards)).not.toBe(JSON.stringify(converted.cards));
  await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.engine.undo());
  expect((await state()).cards).toEqual(converted.cards);
  await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.engine.redo());

  // Draw: a new card from a scalp root near the crown, dragged down the side of the head; exactly one more card.
  await page.getByTestId('groom-symmetry').uncheck();
  await page.getByTestId('groom-tool-draw').click();
  // Where the parting test draws: on top of the head, under the hair.
  const start = { x: cx + 25, y: box.y + box.height * 0.3 };
  const onHead = await page.evaluate(({ x, y }) => Boolean((window as unknown as TestWindow).__ps2cc.viewport!.groomView().pick(x, y)), { x: start.x - box.x, y: start.y - box.y });
  expect(onHead, 'the draw starts on the head').toBe(true);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(start.x + i * 6, start.y + i * 9);
  await page.mouse.up();
  await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.settled());
  const drawn = await state();
  expect(drawn.cards!.length, 'Draw added one card').toBe(combed.cards!.length + 1);
  expect(drawn.meshCards).toBe(combed.meshCards + 1);

  // Card settings: select some cards, scale their width, step their texture strip.
  await page.getByTestId('groom-tool-select').click();
  await page.mouse.move(cx + 100, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 110, cy + 10);
  await page.mouse.up();
  const selected = Number((await page.getByTestId('card-selected').textContent())!.match(/\d+/)![0]);
  expect(selected).toBeGreaterThan(0);
  await page.getByTestId('card-width-apply').click();
  await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.settled());
  const widened = await state();
  const changed = widened.cards!.filter((c, i) => Math.abs(c.width / drawn.cards![i]!.width - 1.25) < 1e-3).length;
  expect(changed).toBe(selected);
  await page.getByTestId('card-next-strip').click();
  const stepped = await state();
  expect(stepped.cards!.filter((c, i) => c.region === widened.cards![i]!.region + 1).length).toBe(selected);
  await page.getByTestId('viewport').screenshot({ path: join(OUT, 'studio_cards.png') });
  await page.screenshot({ path: join(OUT, 'ui_hair_studio_cards.png') });

  // Back to guides: the hand-placed cards go, the generated hair comes back.
  await page.getByTestId('groom-cards-off').click();
  await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.settled());
  expect((await state()).cards).toBeNull();
  await expect(page.getByTestId('groom-to-cards')).toBeVisible();
});

test('fur trims and card brows grow on the garment and the brows, and export', async ({ page }) => {
  test.setTimeout(600_000);
  mkdirSync(OUT, { recursive: true });
  await boot(page);
  await waitForTestHooks(page);
  await setCharacter(page, { gender: 1, age: 0.5 }, { garments: [garment('mh:clothes/male_worksuit01', 'full', { fur: { enabled: true, edges: ['collar', 'cuffs'], length: 0.03, density: 160, lift: 0.6, colour: [0.82, 0.76, 0.64] } })] });
  await page.evaluate(async () => {
    const s = (window as unknown as TestWindow).__ps2cc;
    s.engine.update('e2e brows', (d) => void (d.eyebrows = { ...d.eyebrows, cards: { count: 130, length: 0.009 } }));
    await s.settled();
  });
  const parts = await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.scene.parts.map((p) => ({ key: p.key, kind: p.kind, tris: p.triangleCount })));
  const fur = parts.filter((p) => p.kind === 'fur');
  expect(fur.length).toBe(1);
  expect(fur[0]!.tris).toBeGreaterThan(100);
  expect(parts.some((p) => p.key === 'browCards' && p.tris === 130 * 2)).toBe(true);
  expect(parts.some((p) => p.key === 'eyebrows'), 'the brow mesh is replaced').toBe(false);
  await page.getByLabel('Light').selectOption('studio');
  await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.viewport!.setCameraFrame({ targetHeight: 0.82, span: 0.34, yaw: Math.PI / 6, pitch: 0.05 }));
  await page.waitForTimeout(600);
  await page.getByTestId('viewport').screenshot({ path: join(OUT, 'fur_collar.png') });
  await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.viewport!.setCameraFrame({ targetHeight: 0.93, span: 0.1, yaw: 0.3, pitch: 0 }));
  await page.waitForTimeout(600);
  await page.getByTestId('viewport').screenshot({ path: join(OUT, 'card_brows.png') });
  const exported = await page.evaluate(async () => {
    const w = window as unknown as TestWindow;
    const { scene } = await w.__ps2ccTest.prepareExport(w.__ps2cc, { glb: false, tPose: false });
    const side = scene.sidecar as { materials: { role: string; softAlpha?: boolean }[] };
    return { meshes: scene.meshes.map((m) => [m.name, m.indices.length / 3]), fur: side.materials.find((m) => m.role === 'fur') ?? null };
  });
  expect(exported.fur).toMatchObject({ role: 'fur', softAlpha: true });
  expect(exported.meshes.some(([name]) => String(name).endsWith('_Fur'))).toBe(true);
});

test('Hair v2 export: the gradient-mapped hair texture and the soft pass flag', async ({ page }) => {
  test.setTimeout(300_000);
  await boot(page);
  await waitForTestHooks(page);
  await wearStyle(page, 'mara-bob');
  const out = await page.evaluate(async () => {
    const w = window as unknown as TestWindow;
    const { scene } = await w.__ps2ccTest.prepareExport(w.__ps2cc, { glb: false, tPose: false });
    const side = scene.sidecar as { materials: { role: string; softAlpha?: boolean; texture: string }[] };
    const hair = side.materials.find((m) => m.role === 'hair')!;
    const tex = scene.textures.find((t) => t.file === hair.texture)!.image;
    // Mean colour of the opaque texels.
    const sum = [0, 0, 0];
    let n = 0;
    for (let i = 0; i < tex.width * tex.height; i++) {
      if (tex.data[i * 4 + 3]! < 200) continue;
      for (let k = 0; k < 3; k++) sum[k]! += tex.data[i * 4 + k]!;
      n++;
    }
    return { softAlpha: hair.softAlpha ?? false, mean: sum.map((v) => v / n), size: tex.width };
  });
  expect(out.softAlpha).toBe(true);
  expect(out.size).toBe(1024);
  // Blonde: warm, red above blue, and well away from grey.
  expect(out.mean[0]!).toBeGreaterThan(out.mean[2]! + 30);
});
