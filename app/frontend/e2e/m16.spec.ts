/**
 * PRD Part 2 M16, the creator experience (F20):
 *
 * - a full character built through the editor's category panels only (no
 *   Asset Studio, no test hook edits), then exported (D-149);
 * - each Asset Studio round trip (open from a panel, edit, save, reuse in
 *   another character): Hair, Texture, Garment and Material Studio;
 * - the library grids: look-matched thumbnails, favourites, search, filters.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { boot, MILESTONES } from './helpers';
import { waitForTestHooks, type TestWindow } from './skin-helpers';

const OUT = resolve(MILESTONES, 'M16');
mkdirSync(OUT, { recursive: true });
const report: Record<string, unknown> = {};
const writeReport = () => writeFileSync(resolve(OUT, 'creator_report.json'), `${JSON.stringify(report, null, 2)}\n`);

type Doc = TestWindow['__ps2cc']['engine']['doc'];
const doc = (page: Page) => page.evaluate(() => structuredClone((window as unknown as TestWindow).__ps2cc.engine.doc) as unknown as Doc);
const settled = (page: Page) => page.evaluate(() => (window as unknown as TestWindow).__ps2cc.settled());
const ui = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as TestWindow).__ps2ccTest.useUi.getState();
    return { tab: s.tab, studio: s.assetStudio, selected: s.selected };
  });
/** A library card in a grid, by entry id. */
const card = (scope: Locator, entry: string) => scope.locator(`[data-entry="${entry}"]`);
const pick = async (scope: Locator, entry: string) => {
  await card(scope, entry).locator('.library-thumb').click();
};
/** Wait until every thumbnail in view of a grid has rendered. */
const thumbsReady = async (scope: Locator, atLeast = 1) => {
  await expect(scope.locator('[data-testid="thumb"][data-state="ready"]').nth(atLeast - 1)).toBeVisible({ timeout: 240_000 });
};

/** Boot with a Unity project set in the app settings (first-run setup), so Export to Unity can run. */
async function bootCreator(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (!localStorage.getItem('ps2cc:settings')) localStorage.setItem('ps2cc:settings', JSON.stringify({ firstRunCompleted: true, unityProject: 'C:/UnityProject' }));
  });
  await boot(page);
  await waitForTestHooks(page);
}

test('M16: a full character built through the category panels only, then exported', async ({ page }) => {
  test.setTimeout(900_000);
  await bootCreator(page);
  const steps: string[] = [];
  const shot = async (name: string) => {
    await settled(page);
    await page.screenshot({ path: resolve(OUT, `ui_${name}.png`) });
    steps.push(name);
  };

  // Body: a base preset and a body slider; Face: a face slider.
  await page.getByTestId('cat-body').click();
  const presets = page.getByTestId('create-presets');
  await thumbsReady(presets, 3);
  await pick(presets, 'body:adult-female');
  expect((await doc(page)).macros.gender).toBe(0);
  const bodyPanel = page.getByRole('tabpanel', { name: 'Body' });
  const bodySlider = bodyPanel.locator('input[type="range"]').first();
  const bodyId = await bodySlider.getAttribute('id');
  await bodySlider.fill('0.62');
  await page.getByTestId('cat-face').click();
  const faceSlider = page.getByRole('tabpanel', { name: 'Face' }).locator('input[type="range"]').first();
  const faceId = await faceSlider.getAttribute('id');
  await faceSlider.fill('0.3');
  const sliderValue = (id: string) => page.evaluate((i) => (window as unknown as TestWindow).__ps2cc.engine.value(i), id);
  expect(await sliderValue(bodyId!)).toBeCloseTo(0.62, 2);
  expect(await sliderValue(faceId!)).toBeCloseTo(0.3, 2);
  await shot('step_01_create');

  // Hair: a style from the library grid, a colour, an adjustment.
  await page.getByTestId('cat-hair').click();
  const styles = page.getByTestId('hair-styles');
  await page.getByTestId('hair-styles').getByTestId('library-search').fill('layered bob');
  await pick(styles, 'hair:starter:mara-bob');
  await page.getByTestId('hair-colour-blonde').click();
  await page.getByTestId('hair-adjust-length').fill('1.1');
  const afterHair = await doc(page);
  expect(afterHair.hair.mode).toBe('cards');
  expect(afterHair.hair.style?.name).toBe('Layered bob (Mara)');
  expect(afterHair.hair.adjust?.length).toBeCloseTo(1.1, 2);
  await thumbsReady(styles);
  await shot('step_02_hair');

  // Clothes: an outfit, then a hat from the garment grid.
  await page.getByTestId('cat-clothes').click();
  const outfits = page.getByTestId('wardrobe-outfits');
  await pick(outfits, 'outfit:utility-vest');
  await settled(page);
  const garments = page.getByTestId('wardrobe-garments');
  await garments.getByTestId('library-filter').selectOption('hat');
  const hat = garments.getByTestId('library-card').first();
  const hatId = (await hat.getAttribute('data-entry'))!.replace(/^garment:/, '');
  await hat.locator('.library-thumb').click();
  const afterWardrobe = await doc(page);
  expect(afterWardrobe.garments.map((g) => g.asset)).toEqual(expect.arrayContaining(['ps2cc:clothes/mara_utility_vest', 'ps2cc:clothes/rollneck_sweater', 'ps2cc:clothes/cargo_trousers', hatId]));
  expect(afterWardrobe.garments.find((g) => g.asset === 'ps2cc:clothes/mara_utility_vest')?.look?.zones.length).toBeGreaterThan(0);
  await thumbsReady(garments);
  await shot('step_03_wardrobe');

  // Skin, Eyes and Makeup: skin, eye colour, makeup and details.
  await page.getByTestId('cat-skin').click();
  const skins = page.getByTestId('appearance-skins');
  await skins.getByTestId('library-search').fill('young caucasian female');
  await pick(skins, 'skin:mh:skins/young_caucasian_female');
  await page.getByTestId('appearance-freckles-on').check();
  await page.getByTestId('appearance-freckles-strength').fill('0.4');
  await page.getByTestId('appearance-darkCircles-on').check();
  await thumbsReady(skins);
  await shot('step_04_skin');
  await page.getByTestId('cat-eyes').click();
  const eye = page.getByTestId('eye-colour');
  const eyeValue = await eye.locator('option').nth(2).getAttribute('value');
  await eye.selectOption(eyeValue!);
  await page.getByTestId('cat-makeup').click();
  await page.getByTestId('appearance-lips-on').check();
  const afterAppearance = await doc(page);
  expect(afterAppearance.skin.base).toBe('mh:skins/young_caucasian_female');
  const kinds = afterAppearance.skin.layers.filter((l) => l.enabled).map((l) => l.kind);
  expect(kinds).toEqual(expect.arrayContaining(['lips', 'freckles', 'darkCircles']));
  expect(afterAppearance.skin.layers.find((l) => l.kind === 'freckles')?.opacity).toBeCloseTo(0.4, 2);
  await shot('step_04_makeup');

  // Look: the Hero profile and the Flashlight interior look.
  await page.getByTestId('cat-look').click();
  await page.getByTestId('look-profile-hero').click();
  const looks = page.getByTestId('look-grid');
  await card(looks, 'look:interiorFlashlight').locator('.library-thumb').click();
  expect((await doc(page)).export.profile).toBe('hero');
  expect(await page.evaluate(() => (window as unknown as TestWindow).__ps2ccTest.useUi.getState().lighting)).toBe('interiorFlashlight');
  await thumbsReady(looks, 2);
  await shot('step_05_look');

  // Export: to the Unity project (in a browser the export message is downloaded).
  await page.getByTestId('cat-export').click();
  await expect(page.getByTestId('export-panel')).toBeVisible();
  const download = page.waitForEvent('download', { timeout: 300_000 });
  await page.getByTestId('export-unity').click();
  const file = await download;
  const bytes = readFileSync(await file.path());
  expect(bytes.subarray(0, 8).toString('latin1')).toBe('PS2CCEX1');
  const header = JSON.parse(bytes.subarray(12, 12 + bytes.readUInt32LE(8)).toString('utf8')) as { meshes: { name: string }[]; textures: { file: string }[] };
  expect(header.meshes.map((m) => m.name)).toEqual(expect.arrayContaining([expect.stringMatching(/_Garments$/), expect.stringMatching(/_Hair$/)]));
  await expect(page.getByTestId('export-result')).toBeVisible();
  await shot('step_06_export');

  // Nothing but the creator was used.
  const state = await ui(page);
  expect(state.studio).toBeNull();
  report.creator = { steps, meshes: header.meshes.map((m) => m.name), textures: header.textures.length, garments: afterWardrobe.garments.map((g) => g.asset), layers: kinds };
  writeReport();
});

/** A new character through the sidebar's New button (confirming the discard). */
async function newCharacter(page: Page): Promise<void> {
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'New character' }).click();
  await settled(page);
  expect((await doc(page)).garments).toEqual([]);
}

/** Answer the next prompt with `value`. */
const answer = (page: Page, value: string) => page.once('dialog', (d) => void d.accept(value));

test('M16 round trip: Hair Studio (open from Hair, change the lengths, save, reuse on another character)', async ({ page }) => {
  test.setTimeout(600_000);
  await bootCreator(page);
  await page.getByTestId('cat-hair').click();
  const styles = page.getByTestId('hair-styles');
  await styles.getByTestId('library-search').fill('bob');
  await pick(styles, 'hair:starter:bob');
  await page.getByTestId('open-hair-studio').click();
  await expect(page.getByTestId('studio-rail-hair')).toBeVisible();
  await expect(page.getByTestId('hair-studio')).toBeVisible();
  expect((await ui(page)).studio?.kind).toBe('hair');
  // Edit: longer at the back, shorter at the front.
  // The Length section's sliders (the hairline has a Front slider too).
  await page.locator('#hair-back').first().fill('0.32');
  await page.locator('#hair-front').first().fill('0.08');
  await settled(page);
  await page.screenshot({ path: resolve(OUT, 'ui_hair_studio.png') });
  answer(page, 'Studio bob');
  await page.getByRole('button', { name: 'Save style…' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as TestWindow).__ps2ccTest.core && localStorage.getItem('ps2cc:docs')?.includes('Studio bob'))).toBe(true);
  await page.getByTestId('hair-studio-done').click();
  expect((await ui(page)).studio).toBeNull();
  // Reuse: a new character picks it in Hair.
  await newCharacter(page);
  await page.getByTestId('cat-hair').click();
  const grid = page.getByTestId('hair-styles');
  await grid.getByTestId('library-search').fill('studio bob');
  await expect(card(grid, 'hair:user:hairstyles/Studio bob')).toBeVisible();
  await pick(grid, 'hair:user:hairstyles/Studio bob');
  const d = await doc(page);
  expect(d.hair.mode).toBe('cards');
  expect(d.hair.style?.name).toBe('Studio bob');
  expect(d.hair.style?.length.back).toBeCloseTo(0.32, 3);
  expect(d.hair.style?.length.front).toBeCloseTo(0.08, 3);
  await thumbsReady(grid);
  await page.screenshot({ path: resolve(OUT, 'ui_hair_studio_reused.png') });
  report.hairStudio = { saved: 'Studio bob', back: d.hair.style?.length.back, front: d.hair.style?.length.front };
  writeReport();
});

test('M16 round trip: Texture Studio (open from Skin, add layers, save as a skin, reuse on another character)', async ({ page }) => {
  test.setTimeout(600_000);
  await bootCreator(page);
  await page.getByTestId('cat-skin').click();
  await page.getByTestId('appearance-freckles-on').check();
  await page.getByTestId('open-texture-studio').click();
  const rail = page.getByTestId('studio-rail-texture');
  await expect(rail).toBeVisible();
  // Edit: a dirt layer from the full layer stack.
  await rail.locator('select').filter({ has: page.locator('option', { hasText: 'Dirt / grime' }) }).first().selectOption({ label: 'Dirt / grime' });
  await page.getByTestId('skin-add-layer').click();
  await settled(page);
  const layers = (await doc(page)).skin.layers.map((l) => l.kind);
  expect(layers).toEqual(expect.arrayContaining(['freckles', 'dirt']));
  await page.screenshot({ path: resolve(OUT, 'ui_texture_studio.png') });
  await page.getByTestId('texture-save-name').fill('Freckled grimy skin');
  await page.getByTestId('texture-save').click();
  await expect(rail).toBeHidden({ timeout: 120_000 });
  const saved = await doc(page);
  expect(saved.skin.base).not.toMatch(/^mh:/);
  expect(saved.skin.layers.some((l) => l.kind === 'freckles' || l.kind === 'dirt')).toBe(false);
  // Reuse: a new character picks the saved skin in Skin.
  await newCharacter(page);
  await page.getByTestId('cat-skin').click();
  const skins = page.getByTestId('appearance-skins');
  await expect(card(skins, 'skin:user:skins/Freckled grimy skin')).toBeVisible();
  await pick(skins, 'skin:user:skins/Freckled grimy skin');
  expect((await doc(page)).skin.base).toBe(saved.skin.base);
  await settled(page);
  // The saved skin has the layers baked in: it differs from the plain base skin.
  const diff = await page.evaluate(async () => {
    const t = (window as unknown as TestWindow).__ps2ccTest;
    const s = (window as unknown as TestWindow).__ps2cc;
    const mine = await t.decodeImage(s.engine.doc.skin.base);
    const def = s.newDocument('x').skin.base;
    const plain = await t.decodeImage(`${s.info.coreAssetsUrl}/${s.assets.catalog.skins.find((k) => k.id === def)!.texture}`);
    const a = t.core.resizeImage(mine, 256, 256);
    const b = t.core.resizeImage(plain, 256, 256);
    let sum = 0;
    for (let i = 0; i < a.data.length; i += 4) sum += Math.abs(a.data[i]! - b.data[i]!);
    return sum / (a.data.length / 4) / 255;
  });
  expect(diff).toBeGreaterThan(0.005);
  await thumbsReady(skins);
  await page.screenshot({ path: resolve(OUT, 'ui_texture_studio_reused.png') });
  report.textureStudio = { saved: 'Freckled grimy skin', meanDifferenceFromBase: diff };
  writeReport();
});

test('M16 round trip: Garment Studio (open from Clothes, loosen, save, reuse on another character)', async ({ page }) => {
  test.setTimeout(600_000);
  await bootCreator(page);
  await page.getByTestId('cat-clothes').click();
  const garments = page.getByTestId('wardrobe-garments');
  await garments.getByTestId('library-filter').selectOption('top');
  await garments.getByTestId('library-search').fill('basic tucked');
  await pick(garments, 'garment:mh:clothes/toigo_basic_tucked_t-shirt');
  await settled(page);
  // The worn garment's row opens its settings, with Edit in Garment Studio.
  await page.getByTestId('worn-open').first().click();
  await page.getByTestId('open-garment-studio').click();
  await expect(page.getByTestId('studio-rail-garment')).toBeVisible();
  await expect(page.getByTestId('garment-studio')).toBeVisible();
  const faces = async () => Number((await page.getByTestId('garment-studio').locator('.hint').textContent())!.split(' ')[0]!.replace(/,/g, ''));
  await expect.poll(faces).toBeGreaterThan(100);
  // Edit: loosen it twice (no pointer work needed), then save under a new name.
  await page.getByTestId('garment-loosen').click();
  await page.getByTestId('garment-loosen').click();
  await page.screenshot({ path: resolve(OUT, 'ui_garment_studio.png') });
  await page.getByTestId('garment-studio-name').fill('Loose tee');
  await page.getByTestId('garment-studio-save').click();
  await expect(page.getByTestId('garment-studio')).toBeHidden({ timeout: 180_000 });
  const worn = (await doc(page)).garments.map((g) => g.asset);
  expect(worn[0]).toMatch(/^user:garment\//);
  expect((await ui(page)).studio).toBeNull();
  // Reuse: a new character puts it on from Clothes.
  await newCharacter(page);
  await page.getByTestId('cat-clothes').click();
  const grid = page.getByTestId('wardrobe-garments');
  await grid.getByTestId('library-search').fill('loose tee');
  await pick(grid, `garment:${worn[0]}`);
  const reused = await page.evaluate(async () => {
    const s = (window as unknown as TestWindow).__ps2cc;
    await s.settled();
    const g = s.scene.parts.find((x) => x.kind === 'garment');
    return { asset: s.engine.doc.garments[0]?.asset ?? null, triangles: g?.triangleCount ?? 0 };
  });
  expect(reused.asset).toBe(worn[0]);
  expect(reused.triangles).toBeGreaterThan(100);
  await thumbsReady(grid);
  await page.screenshot({ path: resolve(OUT, 'ui_garment_studio_reused.png') });
  report.garmentStudio = { saved: worn[0], triangles: reused.triangles };
  writeReport();
});

/** A photo-like PNG that does not tile (a gradient under a weave), made in the page. */
async function photoPng(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(async () => {
    const c = new OffscreenCanvas(256, 256);
    const g = c.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 256, 256);
    grad.addColorStop(0, '#5a6b8c');
    grad.addColorStop(1, '#22304a');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = 'rgba(255,255,255,0.12)';
    for (let i = 0; i < 256; i += 6) g.fillRect(i, 0, 2, 256);
    const blob = await c.convertToBlob({ type: 'image/png' });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
  });
  return Buffer.from(b64, 'base64');
}

test('M16 round trip: Material Studio (from Clothes: a library material adjusted, a photo made seamless; saved, reused on another character)', async ({ page }) => {
  test.setTimeout(600_000);
  await bootCreator(page);
  await page.getByTestId('cat-clothes').click();
  const garments = page.getByTestId('wardrobe-garments');
  await garments.getByTestId('library-filter').selectOption('top');
  await garments.getByTestId('library-search').fill('basic tucked');
  await pick(garments, 'garment:mh:clothes/toigo_basic_tucked_t-shirt');
  await settled(page);
  const key = 'garment:top:mh:clothes/toigo_basic_tucked_t-shirt';

  // 1. From a library material: denim, turned and resized.
  await page.getByTestId('open-material-studio').click();
  await expect(page.getByTestId('material-studio')).toBeVisible();
  await page.getByTestId('material-from').selectOption('ps2cc:materials/denim');
  await expect(page.getByTestId('material-preview')).not.toHaveAttribute('data-seam', '', { timeout: 120_000 });
  await page.getByTestId('material-hue').fill('-120');
  await page.getByTestId('material-tile').fill('20');
  await page.getByTestId('material-name').fill('Green denim');
  // The garment wears the draft while editing.
  await expect.poll(async () => (await doc(page)).garments[0]?.look?.zones[0]?.material ?? '', { timeout: 60_000 }).toMatch(/~draft/);
  await page.waitForTimeout(600);
  await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.viewport!.texturesSettled());
  await page.screenshot({ path: resolve(OUT, 'ui_material_studio.png') });
  await page.getByTestId('material-save').click();
  await expect(page.getByTestId('material-studio')).toBeHidden({ timeout: 120_000 });
  expect((await doc(page)).garments[0]?.look?.zones[0]?.material).toBe('user:materials/Green denim');

  // 2. From a photo that does not tile: the preview's seam shows, Make seamless hides it.
  await page.getByTestId('open-material-studio').click();
  await page.getByTestId('material-image-albedo').setInputFiles({ name: 'blue cloth.png', mimeType: 'image/png', buffer: await photoPng(page) });
  const seam = async () => Number((await page.getByTestId('material-preview').getAttribute('data-seam')) || 'NaN');
  await expect.poll(seam, { timeout: 120_000 }).toBeGreaterThan(0.03);
  const raw = await seam();
  await page.getByTestId('material-seamless').fill('0.25');
  await expect.poll(seam, { timeout: 120_000 }).toBeLessThan(raw / 4);
  const fixed = await seam();
  await page.getByTestId('material-name').fill('Blue cloth');
  await page.getByTestId('material-save').click();
  await expect(page.getByTestId('material-studio')).toBeHidden({ timeout: 120_000 });
  expect((await doc(page)).garments[0]?.look?.zones[0]?.material).toBe('user:materials/Blue cloth');

  // Reuse: a new character wears a top and picks Green denim in Clothes.
  await newCharacter(page);
  await page.getByTestId('cat-clothes').click();
  await page.getByTestId('wardrobe-garments').getByTestId('library-filter').selectOption('top');
  await page.getByTestId('wardrobe-garments').getByTestId('library-search').fill('basic tucked');
  await pick(page.getByTestId('wardrobe-garments'), 'garment:mh:clothes/toigo_basic_tucked_t-shirt');
  const mats = page.getByTestId('wardrobe-materials');
  await expect(card(mats, 'material:user:materials/Green denim')).toBeVisible();
  await pick(mats, 'material:user:materials/Green denim');
  const g = (await doc(page)).garments.find((x) => `garment:${x.slot}:${x.asset}` === key);
  expect(g?.look?.zones[0]?.material).toBe('user:materials/Green denim');
  await settled(page);
  await thumbsReady(mats);
  await page.screenshot({ path: resolve(OUT, 'ui_material_studio_reused.png') });
  report.materialStudio = { saved: ['Green denim', 'Blue cloth'], photoSeam: { raw, seamless: fixed } };
  writeReport();
});

test('M16: library grids: look-matched thumbnails, favourites that persist, search and a plain filter', async ({ page }) => {
  test.setTimeout(600_000);
  await bootCreator(page);
  await page.getByTestId('cat-clothes').click();
  const grid = page.getByTestId('wardrobe-garments');
  await grid.getByTestId('library-search').fill('cargo');
  const entry = 'garment:ps2cc:clothes/cargo_trousers';
  await expect(card(grid, entry)).toBeVisible();
  await thumbsReady(grid);

  // Look-matched: the same thumbnail under two looks follows the looks' brightness, as the viewport does.
  const brightness = (src: string) =>
    page.evaluate(async (u) => {
      const t = (window as unknown as TestWindow).__ps2ccTest;
      const img = await t.decodeImage(u);
      let s = 0;
      for (let i = 0; i < img.data.length; i += 4) s += 0.2126 * img.data[i]! + 0.7152 * img.data[i + 1]! + 0.0722 * img.data[i + 2]!;
      return s / (img.data.length / 4) / 255;
    }, src);
  const thumbSrc = async () => (await card(grid, entry).locator('img').getAttribute('src')) ?? '';
  const viewportBrightness = async () => {
    const url = await page.evaluate(async () => {
      const s = (window as unknown as TestWindow).__ps2cc;
      await s.settled();
      // The viewport takes the look on its next frame; wait for it and its LUT.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      await s.viewport!.lookReady();
      return URL.createObjectURL(await s.viewport!.screenshot(160, 200));
    });
    return brightness(url);
  };
  const studioSrc = await thumbSrc();
  const studioThumb = await brightness(studioSrc);
  const studioView = await viewportBrightness();
  await page.evaluate(() => (window as unknown as TestWindow).__ps2ccTest.useUi.getState().setView({ lighting: 'night' as never }));
  await expect.poll(thumbSrc, { timeout: 240_000 }).not.toBe(studioSrc);
  await expect(card(grid, entry).getByTestId('thumb')).toHaveAttribute('data-state', 'ready', { timeout: 240_000 });
  const nightThumb = await brightness(await thumbSrc());
  const nightView = await viewportBrightness();
  // The thumbnail changes with the look, the same way the viewport does (background included).
  expect(Math.abs(nightThumb - studioThumb)).toBeGreaterThan(0.01);
  expect(Math.sign(nightThumb - studioThumb)).toBe(Math.sign(nightView - studioView));
  await page.screenshot({ path: resolve(OUT, 'ui_library_night.png') });
  await page.evaluate(() => (window as unknown as TestWindow).__ps2ccTest.useUi.getState().setView({ lighting: 'studio' as never }));

  // A favourite, kept in the settings; the star shows favourites only.
  await card(grid, entry).getByTestId('library-star').click();
  await grid.getByTestId('library-search').fill('');
  await grid.getByTestId('library-favourites').click();
  await expect(grid.getByTestId('library-card')).toHaveCount(1);
  await expect(card(grid, entry)).toBeVisible();
  await grid.getByTestId('library-favourites').click();
  // The filter: bottoms only.
  await grid.getByTestId('library-filter').selectOption('bottom');
  await expect(card(grid, entry)).toBeVisible();
  const bottoms = await grid.getByTestId('library-card').count();
  await grid.getByTestId('library-filter').selectOption('hat');
  await expect(card(grid, entry)).toHaveCount(0);
  expect(bottoms).toBeGreaterThan(0);
  await grid.getByTestId('library-filter').selectOption('');
  await thumbsReady(grid);
  await page.screenshot({ path: resolve(OUT, 'ui_library_browser.png') });

  // After a reload the favourite is still there.
  await page.reload();
  await page.waitForFunction(() => Boolean((window as unknown as { __ps2cc?: unknown }).__ps2cc), undefined, { timeout: 120_000 });
  await page.getByTestId('cat-clothes').click();
  const after = page.getByTestId('wardrobe-garments');
  await after.getByTestId('library-favourites').click();
  await expect(card(after, entry)).toBeVisible();
  await expect(card(after, entry).getByTestId('library-star')).toHaveAttribute('aria-pressed', 'true');
  // Every grid lists entries.
  const counts: Record<string, number> = {};
  for (const [cat, id] of [
    ['body', 'create-presets'],
    ['hair', 'hair-styles'],
    ['clothes', 'wardrobe-garments'],
    ['clothes', 'wardrobe-outfits'],
    ['skin', 'appearance-skins'],
    ['clothes', 'wardrobe-materials'],
  ] as const) {
    await page.getByTestId(`cat-${cat}`).click();
    const g2 = page.getByTestId(id);
    await expect(g2.getByTestId('library-card').first()).toBeVisible();
    counts[id] = await g2.getByTestId('library-card').count();
  }
  report.library = { thumbBrightness: { studio: studioThumb, night: nightThumb }, viewportBrightness: { studio: studioView, night: nightView }, entries: counts };
  writeReport();
});
