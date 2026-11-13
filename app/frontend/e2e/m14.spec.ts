/**
 * PRD Part 2 M14 (Face and eyes, F19), in the app:
 *  - three-photo projection: eyes and mouth within 4 texels at 1024, and no
 *    visible seam where the views blend (pixel test, with a hard-switch
 *    control that must show one);
 *  - review images: the head texture as exported, generated eyes in Classic
 *    (painted catch-light) and Enhanced, an open mouth with the teeth, tongue
 *    and dark interior, painted brows, the scanned-face skin, and the UI.
 * Until the user supplies photo sets (docs/milestones/M14/test_photos/<set>/
 * front|left|right.(png|jpg)), renders of other MakeHuman characters from the
 * front and 40 degrees either side stand in, as in M6 (D-041).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { boot, MILESTONES, setCharacter } from './helpers';
import { measureFace, waitForTestHooks, type TestWindow } from './skin-helpers';

const OUT = join(MILESTONES, 'M14');
const PHOTO_DIR = join(OUT, 'test_photos');
const LIMIT_TEXELS = 4;
const SIDE_YAW = (40 * Math.PI) / 180;
const bald = { mode: 'none', tint: { color: [1, 1, 1], brightness: 1 }, alphaThreshold: 0.5 };
const TARGET = { gender: 1, age: 0.5, african: 1 / 3, asian: 1 / 3, caucasian: 1 / 3, weight: 0.5, muscle: 0.5 };

interface PhotoSet {
  name: string;
  /** Data URLs or a stand-in character to render. */
  files?: Record<'front' | 'left' | 'right', { data: string; type: string }>;
  synthetic?: { macros: Record<string, number>; skin: string };
}

function photoSets(): { sets: PhotoSet[]; synthetic: boolean } {
  if (existsSync(PHOTO_DIR)) {
    const sets = readdirSync(PHOTO_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => {
        const dir = join(PHOTO_DIR, d.name);
        const pick = (v: string) => readdirSync(dir).find((f) => f.toLowerCase().startsWith(v) && /\.(png|jpe?g)$/i.test(f));
        const files = Object.fromEntries(
          (['front', 'left', 'right'] as const).map((v) => {
            const f = pick(v);
            return [v, f ? { data: readFileSync(join(dir, f)).toString('base64'), type: extname(f).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg' } : null];
          }),
        );
        const set: PhotoSet | null = Object.values(files).every(Boolean) ? { name: d.name, files: files as PhotoSet['files'] } : null;
        return set;
      })
      .filter((x): x is PhotoSet => x !== null);
    if (sets.length) return { sets, synthetic: false };
  }
  return {
    synthetic: true,
    sets: [
      { name: 'synthetic_1_african_female', synthetic: { macros: { gender: 0, age: 0.5, african: 1, asian: 0, caucasian: 0 }, skin: 'african_female' } },
      { name: 'synthetic_2_asian_male_older', synthetic: { macros: { gender: 1, age: 0.85, african: 0, asian: 1, caucasian: 0, weight: 0.6 }, skin: 'old_asian_male' } },
      { name: 'synthetic_3_caucasian_female', synthetic: { macros: { gender: 0, age: 0.45, african: 0, asian: 0, caucasian: 1 }, skin: 'young_caucasian_female' } },
    ],
  };
}

async function start(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await boot(page);
  await waitForTestHooks(page);
}

/** Front, left and right photo URLs for a set (renders of the stand-in from three directions). */
async function photosOf(page: Page, set: PhotoSet): Promise<Record<'front' | 'left' | 'right', string>> {
  if (set.files) {
    return page.evaluate(
      (files) =>
        Object.fromEntries(
          Object.entries(files).map(([k, f]) => [k, URL.createObjectURL(new Blob([Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0))], { type: f.type }))]),
        ) as Record<'front' | 'left' | 'right', string>,
      set.files,
    );
  }
  const syn = set.synthetic!;
  await setCharacter(page, syn.macros, { hair: bald, garments: [], modifiers: {} });
  const skin = await page.evaluate((pat) => (window as unknown as TestWindow).__ps2cc.assets.catalog.skins.find((x) => x.id.endsWith(pat))?.id ?? null, syn.skin);
  expect(skin, `no skin ${syn.skin}`).not.toBeNull();
  return page.evaluate(
    async ({ base, yaw }) => {
      const s = (window as unknown as TestWindow).__ps2cc;
      s.engine.update('photo skin', (d) => void (d.skin = { base: base!, layers: [], photo: null }));
      await s.settled();
      const out: Record<string, string> = {};
      for (const [k, y] of [['front', 0], ['left', yaw], ['right', -yaw]] as const) {
        s.viewport!.setCameraFrame({ targetHeight: 0.925, span: 0.17, yaw: y, pitch: 0 });
        s.viewport!.refresh();
        await new Promise((r) => setTimeout(r, 400));
        out[k] = URL.createObjectURL(await s.viewport!.screenshot(768, 960));
      }
      return out as Record<'front' | 'left' | 'right', string>;
    },
    { base: skin, yaw: SIDE_YAW },
  );
}

/**
 * The seam check, on the projected layer (1024): the colour step between
 * neighbouring texels where the photo that leads the blend changes (the line
 * a seam would follow), against steps inside areas one photo covers alone.
 * Recomputed from the document's photos with the core projector, once as the
 * app blends them and once as a hard switch between unmatched photos (the
 * control, which must show its seam).
 */
async function seamCheck(page: Page) {
  return page.evaluate(async () => {
    const w = window as unknown as TestWindow;
    const s = w.__ps2cc;
    const t = w.__ps2ccTest;
    const core = t.core;
    const photo = s.engine.doc.skin.photo!;
    const views = await Promise.all(
      [{ image: photo.image, landmarks: photo.landmarks! }, photo.sides!.left!, photo.sides!.right!].map(async (v) => ({ photo: await t.decodeImage(v.image), landmarks: v.landmarks })),
    );
    const input = {
      layout: s.assets.skinComposer.layout,
      table: (await s.assets.landmarkTable())!,
      positions: s.engine.positions,
      normals: s.engine.normals,
      views,
      size: 1024,
    };
    const soft = core.projectPhotos(input);
    const hard = core.projectPhotos({ ...input, hardSwitch: true, harmonise: false });
    const n = 1024;
    const lead = new Int8Array(n * n).fill(-1);
    const share = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) {
      if (soft.image.data[i * 4 + 3]! < 250) continue;
      let sum = 0;
      let best = 0;
      soft.weights.forEach((x, k) => {
        sum += x[i]!;
        if (x[i]! > soft.weights[best]![i]!) best = k;
      });
      if (sum <= 0) continue;
      lead[i] = best;
      share[i] = soft.weights[best]![i]! / sum;
    }
    const diff = (img: { data: Uint8ClampedArray }, i: number, j: number) => {
      let d = 0;
      for (let c = 0; c < 3; c++) d += Math.abs(img.data[i * 4 + c]! - img.data[j * 4 + c]!);
      return d / 3;
    };
    // A seam is a step none of the photos has: the step between two texels, minus the blend (by the
    // photos' weights there) of each photo's own step (sides, nose and brows have real edges).
    const own = (_k: number, i: number, j: number) => {
      let sw = 0;
      let d = 0;
      soft.viewColours.forEach((c, k) => {
        const wk = soft.weights[k]![i]!;
        if (!(wk > 0) || !(soft.coverage[k]![j]! > 0)) return;
        let dk = 0;
        for (let q = 0; q < 3; q++) dk += Math.abs(c[i * 3 + q]! - c[j * 3 + q]!);
        d += (wk * dk) / 3;
        sw += wk;
      });
      return sw > 0 ? d / sw : 0;
    };
    // Visibility edges (a photo seeing a texel well next to one it cannot see: nostrils, lip corners,
    // eye rims) are where single-photo projection stops too; a seam is a line where photos blend.
    const nearEdge = new Uint8Array(n * n);
    const R = 3;
    for (const cov of soft.coverage) {
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const i = y * n + x;
          if (!(cov[i]! > 0.3)) continue;
          let edge = false;
          for (let dy = -R; dy <= R && !edge; dy++)
            for (let dx = -R; dx <= R && !edge; dx++) {
              const xx = x + dx;
              const yy = y + dy;
              if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
              const j = yy * n + xx;
              if (soft.image.data[j * 4 + 3]! > 0 && cov[j] === 0) edge = true;
            }
          if (edge) nearEdge[i] = 1;
        }
      }
    }
    const marks: number[] = [];
    const seamSoft: number[] = [];
    const seamHard: number[] = [];
    const seamAll: number[] = [];
    const inside: number[] = [];
    for (let y = 0; y < n - 1; y++) {
      for (let x = 0; x < n - 1; x++) {
        const i = y * n + x;
        if (lead[i]! < 0) continue;
        for (const j of [i + 1, i + n]) {
          if (lead[j]! < 0) continue;
          const k = lead[i]!;
          if (!(soft.coverage[k]![j]! > 0)) continue;
          if (lead[j] !== lead[i]) {
            const excess = diff(soft.image, i, j) - own(k, i, j);
            seamAll.push(excess);
            if (nearEdge[i] || nearEdge[j]) continue;
            if (excess > 6) marks.push(i);
            seamSoft.push(excess);
            seamHard.push(diff(hard.image, i, j) - own(k, i, j));
          } else if (share[i]! >= 0.97 && share[j]! >= 0.97) inside.push(diff(soft.image, i, j) - own(k, i, j));
        }
      }
    }
    const p95 = (v: number[]) => {
      const a = [...v].sort((p, q) => p - q);
      return { p95: +(a[Math.floor(a.length * 0.95)] ?? 0).toFixed(2), count: a.length };
    };
    const b64 = async (img: { width: number; height: number; data: Uint8ClampedArray }) => {
      const bytes = new Uint8Array(await (await t.imageToPng(img as Parameters<typeof t.imageToPng>[0])).arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(bin);
    };
    return {
      seam: p95(seamSoft),
      seamIncludingVisibilityEdges: p95(seamAll),
      hardSwitchSeam: p95(seamHard),
      inside: p95(inside),
      views: soft.views.map((v) => ({ yaw: +v.yaw.toFixed(1), used: v.used, residualPx: +v.residual.toFixed(2) })),
      png: await b64(soft.image),
      hardPng: await b64(hard.image),
      leadPng: await b64({
        width: n,
        height: n,
        data: (() => {
          const d = new Uint8ClampedArray(n * n * 4);
          const col = [[255, 255, 255], [80, 160, 255], [80, 255, 120]];
          for (let i = 0; i < n * n; i++) if (lead[i]! >= 0) d.set([...col[lead[i]!]!.map((c) => c * (0.4 + 0.6 * share[i]!)), 255], i * 4);
          for (const i of marks) d.set([255, 0, 0, 255], i * 4);
          return d;
        })(),
      }),
    };
  });
}

test('three-photo projection: eyes and mouth within 4 texels at 1024, no seam where views blend', async ({ page }) => {
  test.setTimeout(900_000);
  mkdirSync(OUT, { recursive: true });
  await start(page);
  const { sets, synthetic } = photoSets();
  const report: Record<string, unknown>[] = [];
  for (const set of sets) {
    const urls = await photosOf(page, set);
    await setCharacter(page, TARGET, { hair: bald, garments: [], modifiers: {}, skin: { base: 'mh:skins/young_caucasian_male', layers: [], photo: null } });
    await page.evaluate(
      async (u) => {
        const w = window as unknown as TestWindow;
        const s = w.__ps2cc;
        await w.__ps2ccTest.applyPhoto(s, u.front);
        await w.__ps2ccTest.applySidePhoto(s, 'left', u.left);
        await w.__ps2ccTest.applySidePhoto(s, 'right', u.right);
        await s.settled();
      },
      urls,
    );
    const m = await measureFace(page);
    expect('error' in m ? m.error : null).toBeNull();
    const ok = m as { errors: Record<string, number>; png: string };
    const worst = Math.max(...Object.values(ok.errors));
    const seam = await seamCheck(page);
    writeFileSync(join(OUT, `three_photo_${set.name}_front.png`), Buffer.from(ok.png, 'base64'));
    writeFileSync(join(OUT, `three_photo_${set.name}_layer.png`), Buffer.from(seam.png, 'base64'));
    writeFileSync(join(OUT, `three_photo_${set.name}_layer_hard_switch.png`), Buffer.from(seam.hardPng, 'base64'));
    writeFileSync(join(OUT, `three_photo_${set.name}_lead.png`), Buffer.from(seam.leadPng, 'base64'));
    // Three-quarter look at the result, with the head's sides from the side photos.
    await page.evaluate(async () => {
      const s = (window as unknown as TestWindow).__ps2cc;
      s.viewport!.setCameraFrame({ targetHeight: 0.92, span: 0.22, yaw: Math.PI / 4, pitch: 0.02 });
      s.viewport!.refresh();
      await s.settled();
    });
    await page.waitForTimeout(400);
    const shot = await page.evaluate(async () => {
      const blob = await (window as unknown as TestWindow).__ps2cc.viewport!.screenshot(600, 750);
      const u = new Uint8Array(await blob.arrayBuffer());
      let bin = '';
      for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode(...u.subarray(i, i + 0x8000));
      return btoa(bin);
    });
    writeFileSync(join(OUT, `three_photo_${set.name}_threeQuarter.png`), Buffer.from(shot, 'base64'));
    const row = {
      set: set.name,
      worstTexels: +worst.toFixed(3),
      errors: Object.fromEntries(Object.entries(ok.errors).map(([k, v]) => [k, +v.toFixed(2)])),
      seamStep: seam.seam,
      seamStepIncludingVisibilityEdges: seam.seamIncludingVisibilityEdges,
      hardSwitchSeamStep: seam.hardSwitchSeam,
      insideStep: seam.inside,
      views: seam.views,
    };
    console.log(JSON.stringify(row));
    report.push(row);
    expect(worst, `${set.name}: eye/mouth misalignment`).toBeLessThanOrEqual(LIMIT_TEXELS);
    // No seam: where the leading photo changes, the blend adds no step the photos do not have
    // beyond 3 levels (95th percentile; about the smallest step an 8-bit gradient shows).
    const limit = 3;
    expect(seam.seam.count, `${set.name}: the photos should meet somewhere`).toBeGreaterThan(50);
    expect(seam.seam.p95, `${set.name}: seam where the views blend`).toBeLessThanOrEqual(limit);
    // The control (a hard switch between unmatched photos) must fail the same check.
    expect(seam.hardSwitchSeam.p95, `${set.name}: the hard-switch control should show a seam`).toBeGreaterThan(limit);
  }
  writeFileSync(join(OUT, 'three_photo_report.json'), JSON.stringify({ limitTexels: LIMIT_TEXELS, syntheticPhotos: synthetic, sideYawDegrees: 40, sets: report }, null, 2) + '\n');
});

test('M14 review images: head texture, eyes, mouth, brows, scanned face, UI', async ({ page }) => {
  test.setTimeout(600_000);
  mkdirSync(OUT, { recursive: true });
  await start(page);
  const shot = async (name: string, frame: { targetHeight: number; span: number; yaw: number; pitch: number }, w = 640, h = 480) => {
    const b64 = await page.evaluate(
      async ({ frame, w, h }) => {
        const s = (window as unknown as TestWindow).__ps2cc;
        s.viewport!.setCameraFrame(frame);
        s.viewport!.refresh();
        await s.settled();
        await new Promise((r) => setTimeout(r, 300));
        const u = new Uint8Array(await (await s.viewport!.screenshot(w, h)).arrayBuffer());
        let bin = '';
        for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode(...u.subarray(i, i + 0x8000));
        return btoa(bin);
      },
      { frame, w, h },
    );
    writeFileSync(join(OUT, name), Buffer.from(b64, 'base64'));
  };
  const eyes = { targetHeight: 0.935, span: 0.07, yaw: 0.25, pitch: 0 };
  const face = { targetHeight: 0.925, span: 0.17, yaw: 0.3, pitch: 0 };
  const fresh = await page.evaluate(() => {
    const s = (window as unknown as TestWindow).__ps2cc;
    return JSON.parse(JSON.stringify(s.newDocument('M14 review')));
  });
  await setCharacter(page, {}, { ...fresh, hair: bald });

  // Eyes: Enhanced (real highlight) and Classic (painted catch-light).
  await shot('eyes_enhanced.png', eyes);
  await page.evaluate(async () => {
    const s = (window as unknown as TestWindow).__ps2cc;
    s.engine.update('classic', (d) => void (d.export.lighting = 'vertex'));
    await s.settled();
  });
  await shot('eyes_classic_catchlight.png', eyes);
  await page.evaluate(async () => {
    const s = (window as unknown as TestWindow).__ps2cc;
    const lib = (window as unknown as TestWindow).__ps2ccTest.core.IRIS_LIBRARY;
    s.engine.update('enhanced, blue', (d) => {
      d.export.lighting = 'pixel';
      d.eyes = { ...d.eyes, look: { ...d.eyes.look!, ...lib.find((p) => p.id === 'blue')!.look, pupil: 0.4 } };
    });
    await s.settled();
  });
  await shot('eyes_blue.png', eyes);

  // Open mouth: teeth, tongue and the dark interior.
  await page.evaluate(async () => {
    const s = (window as unknown as TestWindow).__ps2cc;
    await s.scene.setExpressionPreview({ jawOpen: 1 });
    s.viewport!.refresh();
    await s.settled();
  });
  await shot('mouth_open.png', { targetHeight: 0.905, span: 0.1, yaw: 0.15, pitch: 0.05 });
  await page.evaluate(async () => {
    const s = (window as unknown as TestWindow).__ps2cc;
    s.engine.update('no mouth interior', (d) => void (d.skin.layers = d.skin.layers.filter((l) => l.kind !== 'mouth')));
    await s.settled();
  });
  await shot('mouth_open_without_interior_layer.png', { targetHeight: 0.905, span: 0.1, yaw: 0.15, pitch: 0.05 });
  await page.evaluate(async () => {
    const s = (window as unknown as TestWindow).__ps2cc;
    await s.scene.setExpressionPreview({});
    s.viewport!.refresh();
  });

  // Micro-detail: pores (a default layer) on and off, close up on the nose and cheek; then stubble hairs.
  const close = { targetHeight: 0.915, span: 0.075, yaw: 0.45, pitch: 0.02 };
  await shot('detail_pores_on.png', close);
  await page.evaluate(async () => {
    const s = (window as unknown as TestWindow).__ps2cc;
    s.engine.update('pores off', (d) => void d.skin.layers.forEach((l) => l.kind === 'pores' && (l.enabled = false)));
    await s.settled();
  });
  await shot('detail_pores_off.png', close);
  await page.evaluate(async () => {
    const w = window as unknown as TestWindow;
    const s = w.__ps2cc;
    s.engine.update('stubble hairs', (d) => {
      d.skin.layers.forEach((l) => l.kind === 'pores' && (l.enabled = true));
      d.skin.layers.push(w.__ps2ccTest.core.newLayer('stubble'), w.__ps2ccTest.core.newLayer('stubbleHair'));
    });
    await s.settled();
  });
  await shot('detail_stubble_hairs.png', { targetHeight: 0.895, span: 0.09, yaw: 0.5, pitch: 0 });
  await page.evaluate(async () => {
    const s = (window as unknown as TestWindow).__ps2cc;
    s.engine.update('no stubble', (d) => void (d.skin.layers = d.skin.layers.filter((l) => l.kind !== 'stubble' && l.kind !== 'stubbleHair')));
    await s.settled();
  });

  // Painted brows instead of brow geometry.
  await page.evaluate(async () => {
    const w = window as unknown as TestWindow;
    const s = w.__ps2cc;
    s.engine.update('painted brows', (d) => {
      d.eyebrows = { ...d.eyebrows, asset: null };
      d.skin.layers.push(w.__ps2ccTest.core.newLayer('brows'));
    });
    await s.settled();
  });
  await shot('brows_painted.png', face);

  // The scanned face as the base skin.
  await page.evaluate(async () => {
    const s = (window as unknown as TestWindow).__ps2cc;
    // The scan brings its own brows: no painted brows over them (and no brow mesh).
    s.engine.update('scan skin', (d) => {
      d.skin.base = 'ps2cc:skins/scan_lee';
      d.skin.layers = d.skin.layers.filter((l) => l.kind !== 'brows');
    });
    await s.settled();
  });
  await shot('scan_face_front.png', { targetHeight: 0.92, span: 0.2, yaw: 0, pitch: 0 }, 480, 600);
  await shot('scan_face_threeQuarter.png', { targetHeight: 0.92, span: 0.22, yaw: Math.PI / 4, pitch: 0.02 }, 480, 600);

  // The head texture as exported, and the layout's numbers on every body mesh.
  const head = await page.evaluate(async () => {
    const w = window as unknown as TestWindow;
    const s = w.__ps2cc;
    const t = w.__ps2ccTest;
    const img = await t.currentHeadSkin(s);
    const small = t.core.resizeImage(img, 1024, 1024);
    const bytes = new Uint8Array(await (await t.imageToPng(small)).arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const stats: Record<string, unknown> = {};
    for (const id of ['ps2_body_8k', 'ps2_body_10k', 'ps2_body_12k', 'ps2_body_16k', 'ps2_body_20k', 'ps2_body_full'] as const) {
      const h = await s.assets.headLayout(id);
      const area = (uv: ArrayLike<number>, c: readonly number[]) =>
        Math.abs((uv[c[1]! * 2]! - uv[c[0]! * 2]!) * (uv[c[2]! * 2 + 1]! - uv[c[0]! * 2 + 1]!) - (uv[c[2]! * 2]! - uv[c[0]! * 2]!) * (uv[c[1]! * 2 + 1]! - uv[c[0]! * 2 + 1]!)) / 2;
      let a0 = 0;
      let wsum = 0;
      h.mesh.triangles.forEach((tr, i) => {
        if (tr.island !== h.islands[0] || h.faceWeight[i]! < 0.99) return;
        const b = area(h.mesh.uvs, tr.corners);
        if (!(b > 0)) return;
        a0 += b;
        wsum += Math.sqrt(area(h.uv, tr.corners) / b) * b;
      });
      stats[id] = { texelsUsed: +t.core.headCoverage(h, 1024).toFixed(4), faceDensityGain: +(wsum / a0 / 1.4715).toFixed(3) };
    }
    return { png: btoa(bin), stats };
  });
  writeFileSync(join(OUT, 'export_head_texture.png'), Buffer.from(head.png, 'base64'));
  writeFileSync(join(OUT, 'head_layout_report.json'), JSON.stringify({ part1HeadScale: 1.4715, meshes: head.stats }, null, 2) + '\n');

  // The UI: the Eyes controls.
  await page.getByRole('tab', { name: /appearance|face|head/i }).first().click().catch(() => undefined);
  const eyeControls = page.getByTestId('eye-colour');
  if (await eyeControls.count()) {
    await eyeControls.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(OUT, 'ui_eyes.png') });
  }
});

test('M14: Help → Credits names the head scan the scanned-face skin comes from', async ({ page }) => {
  await start(page);
  await page.locator('.menu-button', { hasText: 'Help' }).click();
  await page.getByTestId('menu-credits').click();
  const list = page.getByTestId('credits').getByTestId('credits-attribution');
  await expect(list).toContainText('Lee Perry-Smith');
  await expect(list).toContainText('CC-BY-3.0');
  await expect(list).toContainText('ps2cc:skins/scan_lee');
  await page.getByTestId('credits').screenshot({ path: join(OUT, 'credits_head_scan.png') });
});
