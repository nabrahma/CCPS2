/**
 * PRD M6 acceptance (F6 skin stack, F7 photo projection) in the real app:
 *  1. GPU compositing matches the core reference compositor, for every blend
 *     mode with masks, and for a real stack on the 2048 px composite.
 *  2. Photo projection on 5 test photos puts the eyes and mouth within 4
 *     texels at 1024 px, checked by re-running landmarks on a render.
 *     Photos come from docs/milestones/M6/test_photos/ when you add some;
 *     otherwise synthetic stand-ins (renders of 5 different MakeHuman
 *     characters, perspective camera) are used and the report says so.
 *  3. The Skin panel: add a layer, drop a face photo, frontal-pose warning.
 * Review images and a JSON report go to docs/milestones/M6/.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { boot, MILESTONES, setCamera, setCharacter } from './helpers';
import { waitForTestHooks, type TestWindow } from './skin-helpers';

const OUT = join(MILESTONES, 'M6');
const PHOTO_DIR = join(OUT, 'test_photos');
/** Eye corners, lids and mouth corners/lips (MediaPipe face mesh indices). */
const CHECK: Record<string, number> = {
  rightEyeOuter: 33,
  rightEyeInner: 133,
  rightEyeTop: 159,
  rightEyeBottom: 145,
  leftEyeInner: 362,
  leftEyeOuter: 263,
  leftEyeTop: 386,
  leftEyeBottom: 374,
  mouthRight: 61,
  mouthLeft: 291,
  upperLip: 0,
  lowerLip: 17,
};
const LIMIT_TEXELS = 4;

const bald = { mode: 'none', tint: { color: [1, 1, 1], brightness: 1 }, alphaThreshold: 0.5 };

async function start(page: Page): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  await boot(page);
  await waitForTestHooks(page);
  await page.getByLabel('Light').selectOption('studio');
}

test('GPU compositing matches the reference compositor', async ({ page }) => {
  await start(page);
  // (a) Synthetic stack: random images, every blend mode, masked and not, plus a tone adjustment.
  const synthetic = await page.evaluate(() => {
    const w = window as unknown as TestWindow;
    const { core } = w.__ps2ccTest;
    const size = 256;
    let seed = 12345;
    const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
    const img = (alpha: boolean) => {
      const im = core.createImage(size, size);
      for (let i = 0; i < size * size; i++) im.data.set([rnd() * 256, rnd() * 256, rnd() * 256, alpha ? rnd() * 256 : 255], i * 4);
      return im;
    };
    const base = img(false);
    const masks = img(true);
    const layers: Parameters<typeof core.compositeReference>[1][number][] = [];
    for (const blend of core.BLEND_MODES)
      for (const mask of ['none', 'face', 'body', 'hands'] as const) layers.push({ source: { kind: 'pixels', image: img(true) }, blend, opacity: 0.3 + 0.7 * rnd(), mask });
    layers.push({ source: { kind: 'adjust', hsv: { hue: 25, saturation: 1.3, value: 0.85 } }, blend: 'normal', opacity: 0.7, mask: 'face' });
    layers.push({ source: { kind: 'adjust', hsv: { hue: -40, saturation: 0.6, value: 1.2 } }, blend: 'overlay', opacity: 1, mask: 'none' });
    const resolved = layers.map((l, i) => ({ key: `l${i}`, label: `l${i}`, ...l }));
    const vp = w.__ps2cc.viewport!;
    vp.skinCompositor.compositePixels(size, base, resolved, masks);
    const gpu = vp.skinCompositor.readPixels()!;
    const cpu = core.compositeReference(base, layers, masks, size);
    let max = 0;
    let off = 0;
    for (let i = 0; i < cpu.data.length; i++) {
      const d = Math.abs(cpu.data[i]! - gpu.data[i]!);
      max = Math.max(max, d);
      if (d > 0) off++;
    }
    return { max, off, values: cpu.data.length, layers: layers.length };
  });
  console.log(`synthetic stack (${synthetic.layers} layers): max diff ${synthetic.max}, ${synthetic.off} of ${synthetic.values} values differ`);
  // float32 on the GPU against float64 here: a rounding can flip by one level per pass.
  expect(synthetic.max).toBeLessThanOrEqual(2);
  expect(synthetic.off / synthetic.values).toBeLessThan(0.01);

  // (b) A real stack on the default character: the viewport's 2048 px composite against the reference.
  await setCharacter(page, { gender: 1 }, { hair: bald, garments: [] });
  const real = await page.evaluate(async () => {
    const w = window as unknown as TestWindow;
    const s = w.__ps2cc;
    const { core } = w.__ps2ccTest;
    const L = core.newLayer;
    s.engine.update('e2e layers', (d) => {
      d.skin.layers = [
        L('stubble'),
        L('darkCircles'),
        { ...L('dirt'), mask: 'body' },
        { ...L('tone'), params: { hue: 8, saturation: 1.15, value: 0.95 } },
        { ...L('lips'), blend: 'overlay' },
        { ...L('freckles'), blend: 'screen', mask: 'face' },
      ];
    });
    await s.settled();
    const gpu = s.viewport!.skinComposite()!;
    const skin = s.scene.parts.find((p) => p.kind === 'body')!.material.skin!;
    const base = await w.__ps2ccTest.decodeImage(`${s.info.coreAssetsUrl}/${skin.base}`);
    const layers = skin.layers.map((l) => ({
      source: l.source.kind === 'adjust' || l.source.kind === 'detail' ? l.source : { kind: 'pixels' as const, image: (l.source as { image: Parameters<typeof core.compositeReference>[0] }).image },
      blend: l.blend,
      opacity: l.opacity,
      mask: l.mask,
    }));
    const cpu = core.compositeReference(base, layers, skin.masks, skin.size);
    let max = 0;
    let over1 = 0;
    let sum = 0;
    for (let i = 0; i < cpu.data.length; i++) {
      const d = Math.abs(cpu.data[i]! - gpu.data[i]!);
      max = Math.max(max, d);
      sum += d;
      if (d > 1) over1++;
    }
    return { max, over1, mean: sum / cpu.data.length, values: cpu.data.length, size: gpu.width, passes: s.viewport!.skinCompositor.lastStats };
  });
  console.log(`real stack at ${real.size} px: max diff ${real.max}, mean ${real.mean.toFixed(4)}, ${real.over1} values off by more than 1; GPU ${JSON.stringify(real.passes)}`);
  expect(real.size).toBe(2048);
  // Layers are 1024 px and filtered up: GPU bilinear weights are 8-bit, so allow a level or two at a few texels.
  expect(real.max).toBeLessThanOrEqual(3);
  expect(real.over1 / real.values).toBeLessThan(0.001);
  // (c) Sequential composites: each new stack must replace the previous result, not pile onto it.
  const sequential = await page.evaluate(async () => {
    const w = window as unknown as TestWindow;
    const s = w.__ps2cc;
    const { core } = w.__ps2ccTest;
    const worst: number[] = [];
    for (const layers of [['dirt'], ['lips', 'blush'], ['freckles'], ['freckles'], ['stubble', 'tone']]) {
      s.engine.update('seq', (d) => void (d.skin.layers = layers.map((k) => core.newLayer(k as never))));
      await s.settled();
      const gpu = s.viewport!.skinComposite()!;
      const skin = s.scene.parts.find((p) => p.kind === 'body')!.material.skin!;
      const base = await w.__ps2ccTest.decodeImage(`${s.info.coreAssetsUrl}/${skin.base}`);
      const cl = skin.layers.map((l) => ({
        source: l.source.kind === 'adjust' || l.source.kind === 'detail' ? l.source : { kind: 'pixels' as const, image: (l.source as { image: Parameters<typeof core.compositeReference>[0] }).image },
        blend: l.blend,
        opacity: l.opacity,
        mask: l.mask,
      }));
      const cpu = core.compositeReference(base, cl, skin.masks, skin.size);
      let d = 0;
      for (let i = 0; i < cpu.data.length; i += 13) d = Math.max(d, Math.abs(cpu.data[i]! - gpu.data[i]!));
      worst.push(d);
    }
    return worst;
  });
  console.log(`sequential composites, max diff per stack: ${sequential.join(', ')}`);
  for (const d of sequential) expect(d).toBeLessThanOrEqual(3);
  writeFileSync(join(OUT, 'compositing_report.json'), JSON.stringify({ synthetic, real, sequential }, null, 2) + '\n');
});

interface PhotoSource {
  name: string;
  /** base64 image file, or a character to render as a synthetic stand-in. */
  file?: { data: string; type: string };
  synthetic?: { macros: Record<string, number>; skin: string; modifiers?: Record<string, number> };
}

function photoSources(): { sources: PhotoSource[]; synthetic: boolean } {
  if (existsSync(PHOTO_DIR)) {
    const files = readdirSync(PHOTO_DIR).filter((f) => /\.(png|jpe?g)$/i.test(f)).sort();
    if (files.length > 0) {
      return {
        synthetic: false,
        sources: files.map((f) => ({
          name: f,
          file: { data: readFileSync(join(PHOTO_DIR, f)).toString('base64'), type: extname(f).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg' },
        })),
      };
    }
  }
  return {
    synthetic: true,
    sources: [
      { name: 'synthetic_1_african_female', synthetic: { macros: { gender: 0, age: 0.5, african: 1, asian: 0, caucasian: 0 }, skin: 'african_female' } },
      { name: 'synthetic_2_asian_male_older', synthetic: { macros: { gender: 1, age: 0.85, african: 0, asian: 1, caucasian: 0, weight: 0.6 }, skin: 'old_asian_male' } },
      { name: 'synthetic_3_caucasian_female', synthetic: { macros: { gender: 0, age: 0.45, african: 0, asian: 0, caucasian: 1 }, skin: 'young_caucasian_female' } },
      { name: 'synthetic_4_heavy_male', synthetic: { macros: { gender: 1, age: 0.6, weight: 0.95, muscle: 0.3 }, skin: 'middleage_caucasian_male' } },
      { name: 'synthetic_5_african_male', synthetic: { macros: { gender: 1, age: 0.4, african: 1, asian: 0, caucasian: 0, muscle: 0.8 }, skin: 'young_african_male' } },
    ],
  };
}

/** Put a photo on the default character and measure eye/mouth alignment on a front render. */
async function projectAndMeasure(page: Page, url: string, shiftX = 0) {
  return page.evaluate(
    async ({ url, check, shiftX }) => {
      const w = window as unknown as TestWindow;
      const s = w.__ps2cc;
      const t = w.__ps2ccTest;
      const photoCheck = await t.applyPhoto(s, url);
      if (shiftX) {
        // Control: misregister the photo landmarks on purpose.
        s.engine.update('shift', (d) => void (d.skin.photo!.landmarks = d.skin.photo!.landmarks!.map((x, i) => (i % 3 === 0 ? x + shiftX : x))));
      }
      await s.settled();
      const view = t.faceView(s);
      const size = 1024;
      // Only the painted skin: the body alone (no eyeballs, brows or lashes), unlit, so the
      // landmarks follow the projected photo rather than the mesh's eye and mouth openings.
      const render = s.viewport!.renderFront(view, size, (key) => key === 'body', 'unlit');
      const canvas = t.imageToCanvas(render);
      const found = await t.detectLandmarks(s.info.coreAssetsUrl, canvas);
      if (!found) return { error: 'no face found in the render of the projected character' };
      // Error in texels at 1024: how far the re-found landmark is from where the photo's landmark
      // was placed (its anchor on the current head), in render pixels, converted to texels with the
      // feature's own scale (UV distance / pixel distance between its two corners). No ray casts,
      // so landmarks that fall just inside the eye opening or on a UV seam are measured the same way.
      const table = (await s.assets.landmarkTable())!;
      const pos = s.engine.positions;
      const base = s.assets.base;
      const toPx = (x: number, y: number): [number, number] => [((x - view.cx + view.half) / (2 * view.half)) * size, ((view.cy + view.half - y) / (2 * view.half)) * size];
      // UV on the main face island for each anchor vertex (rim vertices also have eye/mouth-island UVs).
      const faceUv = new Map<number, [number, number]>();
      const inFace = (u: number, v: number) => u > 0.63 && v > 0.145;
      for (const f of base.facesWhere((g) => g === 'body'))
        for (let k = 0; k < 4; k++) {
          const tuv = base.faceUvs[f * 4 + k]!;
          const u = base.uvs[tuv * 2]!;
          const v = base.uvs[tuv * 2 + 1]!;
          if (inFace(u, v)) faceUv.set(base.faceVerts[f * 4 + k]!, [u, v]);
        }
      const anchor = (i: number) => {
        let x = 0;
        let y = 0;
        let u = 0;
        let v = 0;
        for (let k = 0; k < 3; k++) {
          const vert = table.anchors![i * 6 + k]!;
          const wt = table.anchors![i * 6 + 3 + k]!;
          x += wt * pos[vert * 3]!;
          y += wt * pos[vert * 3 + 1]!;
          const uv = faceUv.get(vert) ?? [NaN, NaN];
          u += wt * uv[0];
          v += wt * uv[1];
        }
        return { px: toPx(x, y), uv: [u, v] as [number, number] };
      };
      const scaleOf = (a: number, b: number) => {
        const A = anchor(a);
        const B = anchor(b);
        return (Math.hypot(A.uv[0] - B.uv[0], A.uv[1] - B.uv[1]) * 1024) / Math.hypot(A.px[0] - B.px[0], A.px[1] - B.px[1]);
      };
      const scales = { rightEye: scaleOf(33, 133), leftEye: scaleOf(362, 263), mouth: scaleOf(61, 291) };
      const errors: Record<string, number> = {};
      for (const [name, i] of Object.entries(check)) {
        const a = anchor(i);
        const scale = name.startsWith('right') ? scales.rightEye : name.startsWith('left') ? scales.leftEye : scales.mouth;
        errors[name] = Math.hypot(found.points[i * 3]! * size - a.px[0], found.points[i * 3 + 1]! * size - a.px[1]) * scale;
      }
      // Review strip: photo | front render with the re-found landmarks.
      const photoImg = await t.decodeImage(url);
      const strip = document.createElement('canvas');
      strip.width = size * 2;
      strip.height = size;
      const ctx = strip.getContext('2d')!;
      const pc = t.imageToCanvas(photoImg);
      const k = Math.min(size / pc.width, size / pc.height);
      ctx.fillStyle = '#202024';
      ctx.fillRect(0, 0, size * 2, size);
      ctx.drawImage(pc, (size - pc.width * k) / 2, (size - pc.height * k) / 2, pc.width * k, pc.height * k);
      ctx.drawImage(canvas, size, 0);
      ctx.fillStyle = '#3f3';
      for (const i of Object.values(check)) ctx.fillRect(size + found.points[i * 3]! * size - 2, found.points[i * 3 + 1]! * size - 2, 4, 4);
      const png = await t.canvasToPng(strip);
      const bytes = new Uint8Array(await png.arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { errors, check: photoCheck, png: btoa(bin) };
    },
    { url, check: CHECK, shiftX },
  );
}

test('photo projection: eyes and mouth within 4 texels at 1024 px on 5 photos', async ({ page }) => {
  test.setTimeout(600_000);
  await start(page);
  const { sources, synthetic } = photoSources();
  const report: Record<string, unknown>[] = [];
  for (const src of sources.slice(0, Math.max(5, sources.length))) {
    let url: string;
    if (src.file) {
      url = await page.evaluate(({ data, type }) => URL.createObjectURL(new Blob([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], { type })), src.file);
    } else {
      // Synthetic stand-in: another character, rendered with the perspective face camera.
      const syn = src.synthetic!;
      await setCharacter(page, syn.macros, { hair: bald, garments: [], modifiers: syn.modifiers ?? {} });
      const skin = await page.evaluate((pat) => (window as unknown as TestWindow).__ps2cc.assets.catalog.skins.find((x) => x.id.endsWith(pat))?.id ?? null, syn.skin);
      expect(skin, `no skin ${syn.skin}`).not.toBeNull();
      await page.evaluate(async (base) => {
        const s = (window as unknown as TestWindow).__ps2cc;
        s.engine.update('photo skin', (d) => void (d.skin = { base: base!, layers: [], photo: null }));
        await s.settled();
      }, skin);
      await setCamera(page, 'face');
      await page.waitForTimeout(800);
      url = await page.evaluate(async () => URL.createObjectURL(await (window as unknown as TestWindow).__ps2cc.viewport!.screenshot(768, 960)));
    }
    // The character the photo goes on: the default adult male, bald.
    await setCharacter(page, { gender: 1, age: 0.5, african: 1 / 3, asian: 1 / 3, caucasian: 1 / 3, weight: 0.5, muscle: 0.5 }, {
      hair: bald,
      garments: [],
      modifiers: {},
      skin: { base: 'mh:skins/young_caucasian_male', layers: [], photo: null },
    });
    const res = await projectAndMeasure(page, url);
    expect('error' in res ? res.error : null).toBeNull();
    const ok = res as Exclude<typeof res, { error: string }>;
    writeFileSync(join(OUT, `projection_${src.name.replace(/\.\w+$/, '')}.png`), Buffer.from(ok.png, 'base64'));
    const worst = Math.max(...Object.values(ok.errors));
    console.log(`${src.name}: worst ${worst.toFixed(2)} texels`, JSON.stringify(Object.fromEntries(Object.entries(ok.errors).map(([k, v]) => [k, +v.toFixed(2)]))));
    report.push({ photo: src.name, worstTexels: +worst.toFixed(3), errors: ok.errors, yaw: ok.check?.yaw, pitch: ok.check?.pitch, warnings: ok.check?.warnings });
    expect(worst, `${src.name}: eye/mouth misalignment`).toBeLessThanOrEqual(LIMIT_TEXELS);
  }
  // Control: the same check catches a misregistered photo (landmarks shifted by 4% of the width).
  // (The target character still wears the last photo.)
  const control = await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.engine.doc.skin.photo?.image ?? null);
  let controlWorst: number | null = null;
  if (control) {
    const res = await projectAndMeasure(page, control, 0.04);
    if (!('error' in res)) {
      controlWorst = Math.max(...Object.values(res.errors));
      writeFileSync(join(OUT, 'projection_control_misregistered.png'), Buffer.from(res.png, 'base64'));
    }
  }
  console.log(`control (misregistered by 4%): worst ${controlWorst?.toFixed(2)} texels`);
  expect(controlWorst, 'the alignment check must catch a misregistered photo').toBeGreaterThan(LIMIT_TEXELS);
  writeFileSync(
    join(OUT, 'projection_report.json'),
    JSON.stringify({ limitTexels: LIMIT_TEXELS, syntheticPhotos: synthetic, photos: report, controlMisregisteredWorstTexels: controlWorst }, null, 2) + '\n',
  );
});

test('Skin panel: add a layer, drop a face photo, frontal-pose warning', async ({ page }) => {
  await start(page);
  await setCharacter(page, { gender: 1 }, { hair: bald, garments: [], skin: { base: 'mh:skins/young_caucasian_male', layers: [], photo: null } });
  await page.getByRole('tab', { name: /skin/i }).click();
  await page.getByLabel('Add', { exact: true }).selectOption('stubble');
  await page.getByTestId('skin-add-layer').click();
  await expect(page.getByTestId('skin-layers').locator('li')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => (window as unknown as TestWindow).__ps2cc.engine.doc.skin.layers[0]?.kind ?? null)).toBe('stubble');
  await expect
    .poll(() => page.evaluate(async () => {
      const s = (window as unknown as TestWindow).__ps2cc;
      await s.settled();
      return s.viewport!.skinComposite() !== null;
    }))
    .toBe(true);

  // A turned head (three-quarter camera) must warn.
  await setCamera(page, 'threeQuarter');
  await page.waitForTimeout(600);
  const turned = await page.evaluate(async () => {
    const blob = await (window as unknown as TestWindow).__ps2cc.viewport!.screenshot(640, 800);
    let bin = '';
    const bytes = new Uint8Array(await blob.arrayBuffer());
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  });
  await setCamera(page, 'face');
  await page.waitForTimeout(600);
  const frontal = await page.evaluate(async () => {
    const blob = await (window as unknown as TestWindow).__ps2cc.viewport!.screenshot(640, 800);
    let bin = '';
    const bytes = new Uint8Array(await blob.arrayBuffer());
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  });
  const drop = async (b64: string, name: string) => {
    const box = (await page.getByTestId('viewport').boundingBox())!;
    await page.evaluate(
      ({ b64, name, x, y }) => {
        const file = new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], name, { type: 'image/png' });
        const dt = new DataTransfer();
        dt.items.add(file);
        const target = document.elementFromPoint(x, y)!;
        target.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true }));
        target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true }));
      },
      { b64, name, x: box.x + 30, y: box.y + 30 },
    );
    await page.getByRole('button', { name: 'Face photo' }).click();
  };
  await drop(frontal, 'frontal.png');
  await expect(page.getByTestId('photo-check')).toBeVisible({ timeout: 60_000 });
  // Straight-on: no "turned" warning. (MediaPipe reads MakeHuman renders as tilted by about 17°; see projection_report.json.)
  await expect(page.getByTestId('photo-check')).not.toContainText('turned');
  await expect.poll(() => page.evaluate(() => (window as unknown as TestWindow).__ps2cc.engine.doc.skin.photo?.landmarks?.length ?? 0)).toBe(478 * 3);
  await page.evaluate(() => (window as unknown as TestWindow).__ps2cc.settled());
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, 'ui_skin_panel.png') });
  await drop(turned, 'turned.png');
  await expect(page.getByTestId('photo-check').locator('.warning-text').first()).toContainText('turned', { timeout: 60_000 });
});

const LOOKS: { name: string; macros: Record<string, number>; camera: string; layers: [string, Record<string, unknown>?][] }[] = [
  { name: 'tired_stubble', macros: { gender: 1, age: 0.6 }, camera: 'face', layers: [['stubble'], ['darkCircles'], ['eyeBags']] },
  { name: 'makeup', macros: { gender: 0, age: 0.45 }, camera: 'face', layers: [['lips', { opacity: 0.7 }], ['eyeliner', { params: { color: '#1c1615', thickness: 1.2, shadowColor: '#6b4c5e', shadow: 0.6 } }], ['blush']] },
  { name: 'freckles_sweat', macros: { gender: 0, age: 0.4 }, camera: 'face', layers: [['freckles'], ['sweat']] },
  { name: 'dirt_bruises', macros: { gender: 1, age: 0.5, muscle: 0.7 }, camera: 'full', layers: [['dirt', { mask: 'body' }], ['bruises', { params: { color: '#5a3a5c', rim: '#a49a5a', count: 6, size: 1.2, seed: 3 } }]] },
  { name: 'tone_tint', macros: { gender: 1, age: 0.5 }, camera: 'bust', layers: [['tone', { params: { hue: 12, saturation: 1.35, value: 0.8 } }]] },
];

test('M6 review set: layer looks, head/body textures, region guide', async ({ page }) => {
  await start(page);
  for (const look of LOOKS) {
    await setCharacter(page, look.macros, { hair: bald, garments: [], skin: { base: 'mh:skins/young_caucasian_male', layers: [], photo: null } });
    await page.evaluate(async (layers) => {
      const w = window as unknown as TestWindow;
      const s = w.__ps2cc;
      s.engine.update('review layers', (d) => void (d.skin.layers = layers.map(([kind, extra]) => ({ ...w.__ps2ccTest.core.newLayer(kind as never), ...(extra ?? {}) }))));
      await s.settled();
    }, look.layers);
    await setCamera(page, look.camera);
    await page.waitForTimeout(800);
    await page.getByTestId('viewport').screenshot({ path: join(OUT, `layers_${look.name}.png`) });
  }
  // The textures the exporter will write for the last look, and the face region guide.
  const files = await page.evaluate(async () => {
    const w = window as unknown as TestWindow;
    const s = w.__ps2cc;
    const t = w.__ps2ccTest;
    const { core } = t;
    s.engine.update('review layers', (d) => void (d.skin.layers = [core.newLayer('stubble'), core.newLayer('darkCircles')]));
    await s.settled();
    const comp = await t.currentSkin(s);
    const head = await t.currentHeadSkin(s, comp);
    const out: Record<string, string> = {};
    const b64 = async (img: Parameters<typeof t.imageToPng>[0]) => {
      const bytes = new Uint8Array(await (await t.imageToPng(img)).arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(bin);
    };
    out['export_head_texture.png'] = await b64(core.resizeImage(head, 1024, 1024));
    out['export_body_texture.png'] = await b64(core.bodyTexture(comp, 1024));
    out['region_guide.png'] = await b64(core.regionGuide(s.assets.skinComposer, 1024).image);
    return out;
  });
  for (const [name, data] of Object.entries(files)) writeFileSync(join(OUT, name), Buffer.from(data, 'base64'));
});
