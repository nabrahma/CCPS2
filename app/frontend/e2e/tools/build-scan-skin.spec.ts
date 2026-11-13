/**
 * Build step (PRD Part 2 F19, M14): the scanned-face base skin.
 *
 * The Infinite Realities head scan (Lee Perry-Smith, CC BY 3.0; fetched and
 * pinned by the asset compiler: leeperrysmith_glb / _col / _licence) is
 * rendered unlit from the front and 40 degrees either side, and the renders go
 * through the three-photo projection onto the neutral MakeHuman head, like a
 * user's photos would. The projected face, colour-matched to MakeHuman's
 * young caucasian male skin, is composited over that skin and written as a
 * base skin texture, with its catalog entry and a CC BY 3.0 licence row (so
 * Help -> Credits names the scan). Review images go to docs/milestones/M14/.
 *
 * Run with `pnpm build:scanskin` (after `python tools/asset-compiler/compile.py`
 * has fetched the scan, or the fetch step of it).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { boot, MILESTONES, setCharacter } from '../helpers';
import { waitForTestHooks, type TestWindow } from '../skin-helpers';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, '../../../..');
const ASSETS = join(REPO, 'assets', 'core');
const CACHE = join(REPO, 'tools', 'asset-compiler', '.cache', 'extracted');
const GLB = join(CACHE, 'leeperrysmith_glb', 'LeePerrySmith.glb');
const COL = join(CACHE, 'leeperrysmith_col', 'Map-COL.jpg');
const LICENCE = join(CACHE, 'leeperrysmith_licence', 'LeePerrySmith_License.txt');
const SKIN_ID = 'ps2cc:skins/scan_lee';
const SKIN_FILE = 'textures/skins/ps2cc_scan_lee.jpg';
const BASE_SKIN = 'mh:skins/young_caucasian_male';
const OUT = join(MILESTONES, 'M14');
const SIDE_YAW = 40;

test('build the scanned-face base skin', async ({ page }) => {
  test.skip(!existsSync(GLB) || !existsSync(COL) || !existsSync(LICENCE), 'the head scan is not fetched (asset compiler sources leeperrysmith_*)');
  test.setTimeout(600_000);
  mkdirSync(OUT, { recursive: true });
  const licence = readFileSync(LICENCE, 'utf8');
  expect(licence).toContain('Creative Commons Attribution 3.0');
  await boot(page);
  await waitForTestHooks(page);
  const bald = { mode: 'none', tint: { color: [1, 1, 1], brightness: 1 }, alphaThreshold: 0.5 };
  await setCharacter(page, { gender: 1, age: 0.5, african: 1 / 3, asian: 1 / 3, caucasian: 1 / 3, weight: 0.5, muscle: 0.5 }, {
    hair: bald,
    garments: [],
    modifiers: {},
    skin: { base: BASE_SKIN, layers: [], photo: null },
  });
  const result = await page.evaluate(
    async ({ glb, col, sideYaw }) => {
      const w = window as unknown as TestWindow;
      const s = w.__ps2cc;
      const t = w.__ps2ccTest;
      const bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const glbBuf = bytes(glb).buffer;
      const colBlob = new Blob([bytes(col)], { type: 'image/jpeg' });
      const loadImage = (url: string) =>
        new Promise<HTMLImageElement>((res, rej) => {
          const img = new Image();
          img.onload = () => res(img);
          img.onerror = rej;
          img.src = url;
        });
      // Which way the scan faces: the turn at which MediaPipe finds a face most squarely.
      let facing: number | null = null;
      let best = Infinity;
      const tried: string[] = [];
      for (const f of [0, 180, 90, -90]) {
        const [url] = await t.renderScanViews(glbBuf, colBlob, { yaws: [0], facing: f });
        tried.push(url!);
        const found = await t.detectLandmarks(s.info.coreAssetsUrl, await loadImage(url!));
        if (!found) continue;
        const nose = found.points[1 * 3]!;
        const off = Math.abs(nose - 0.5);
        if (off < best) [best, facing] = [off, f];
      }
      const b64 = async (blob: Blob) => {
        const u = new Uint8Array(await blob.arrayBuffer());
        let bin = '';
        for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode(...u.subarray(i, i + 0x8000));
        return btoa(bin);
      };
      if (facing === null) return { error: 'no face found in any render of the scan', tried: await Promise.all(tried.map(async (u) => b64(await (await fetch(u)).blob()))) };
      const [front, left, right] = await t.renderScanViews(glbBuf, colBlob, { yaws: [0, sideYaw, -sideYaw], facing });
      // The plain base skin (no layers yet), to put the projected face on.
      const base = await t.currentSkin(s);
      await t.applyPhoto(s, front!);
      await t.applySidePhoto(s, 'left', left!);
      await t.applySidePhoto(s, 'right', right!);
      await s.settled();
      const layer = s.scene.photoLayer;
      if (!layer) return { error: 'the projection made no layer' };
      // The projected face over the base skin, as one texture.
      const n = layer.width;
      const out = new Uint8ClampedArray(n * n * 4);
      const tmp = [0, 0, 0, 0];
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const i = (y * n + x) * 4;
          t.core.sampleBilinear(base, (x + 0.5) / n, 1 - (y + 0.5) / n, tmp);
          const a = layer.data[i + 3]! / 255;
          for (let c = 0; c < 3; c++) out[i + c] = Math.round(tmp[c]! * (1 - a) + layer.data[i + c]! * a);
          out[i + 3] = 255;
        }
      const canvas = t.imageToCanvas({ width: n, height: n, data: out });
      const jpg = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), 'image/jpeg', 0.92));
      const views = await Promise.all([front, left, right].map(async (u) => b64(await (await fetch(u!)).blob())));
      return { jpg: await b64(jpg), views, facing };
    },
    { glb: readFileSync(GLB).toString('base64'), col: readFileSync(COL).toString('base64'), sideYaw: SIDE_YAW },
  );
  if ('tried' in result && result.tried) result.tried.forEach((b, i) => writeFileSync(join(OUT, `scan_try_${i}.png`), Buffer.from(b, 'base64')));
  expect('error' in result ? result.error : null).toBeNull();
  const ok = result as { jpg: string; views: string[]; facing: number };
  const file = join(ASSETS, SKIN_FILE);
  writeFileSync(file, Buffer.from(ok.jpg, 'base64'));
  ['front', 'left', 'right'].forEach((v, i) => writeFileSync(join(OUT, `scan_render_${v}.png`), Buffer.from(ok.views[i]!, 'base64')));

  // Catalog: a base skin like MakeHuman's.
  const catalogPath = join(ASSETS, 'catalog.json');
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as { skins: Record<string, unknown>[] };
  const entry = {
    id: SKIN_ID,
    category: 'skins',
    name: 'Scanned face (Lee Perry-Smith, CC BY 3.0)',
    texture: SKIN_FILE,
    textureSize: [2048, 2048],
    tags: ['scan', 'male', 'caucasian'],
    licence: 'CC-BY-3.0',
  };
  catalog.skins = [...catalog.skins.filter((x) => x.id !== SKIN_ID), entry];
  writeFileSync(catalogPath, JSON.stringify(catalog, null, 1) + '\n');

  // Licence row: the scan's credit, and the MakeHuman skin under it.
  const licPath = join(ASSETS, 'LICENSES.json');
  const lic = JSON.parse(readFileSync(licPath, 'utf8')) as { policy: string; files: Record<string, unknown>[] };
  const row = {
    file: SKIN_FILE,
    asset: SKIN_ID,
    licence: 'CC-BY-3.0',
    author: '"Infinite, 3D Head Scan" by Lee Perry-Smith (Infinite Realities, based on a work at www.triplegangers.com), projected onto MakeHuman\'s young caucasian male skin (CC0) by PS2CC',
    sourceUrl: 'https://github.com/mrdoob/three.js/tree/r187/examples/models/gltf/LeePerrySmith',
    upstream: 'infinite-realities',
    attributionRequired: true,
    sha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
    bytes: statSync(file).size,
  };
  lic.files = [...lic.files.filter((r) => r.file !== SKIN_FILE), row].sort((a, b) => (String(a.file) < String(b.file) ? -1 : 1));
  lic.policy = 'Art and data: only CC0-1.0, CC-BY-4.0 and CC-BY-3.0 (with attribution). Bundled runtime software: Apache-2.0 with its notice (vendor/).';
  writeFileSync(licPath, JSON.stringify(lic, null, 1) + '\n');
  console.log(`scanned-face skin written (scan facing ${ok.facing} degrees)`);
});
