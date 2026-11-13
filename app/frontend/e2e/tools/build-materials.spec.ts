/**
 * Build step (PRD Part 2 F18, M15): the material library.
 *
 * Eleven CC0 PBR materials from Poly Haven and ambientCG (fetched, pinned and
 * checksummed by the asset compiler: the `mat_*` sources) are turned into the
 * era's single diffuse by the core converter (`pbrToEra`: albedo x occlusion x
 * the light from the normal map under a fixed soft top light, x cavity), at
 * 2048 px. The PBR maps are kept at 1024 px for the reference render the SSIM
 * check compares against. Writes `assets/core/materials/<id>/`, the catalog's
 * `materials` list and a CC0 licence row per file, and a review sheet to
 * docs/milestones/M15/.
 *
 * Run with `pnpm build:materials` after the asset compiler has fetched the
 * sources (`python -m ps2cc_assets.fetch mat_...` in tools/asset-compiler).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { boot, MILESTONES } from '../helpers';
import { waitForTestHooks, type TestWindow } from '../skin-helpers';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, '../../../..');
const ASSETS = join(REPO, 'assets', 'core');
const CACHE = join(REPO, 'tools', 'asset-compiler', '.cache', 'extracted');
const OUT = join(MILESTONES, 'M15');

type Kind = 'leather' | 'suede' | 'denim' | 'cotton' | 'canvas' | 'wool' | 'knit' | 'nylon' | 'fur';
interface Def {
  id: string;
  name: string;
  kind: Kind;
  tileMetres: number;
  site: 'Poly Haven' | 'ambientCG';
  asset: string;
  author: string;
}

/** The pack. Tile sizes are the sources' physical sizes (Poly Haven and ambientCG list them), except where noted. */
const DEFS: Def[] = [
  { id: 'leather_smooth', name: 'Smooth leather', kind: 'leather', tileMetres: 0.3, site: 'Poly Haven', asset: 'leather_white', author: 'Rob Tuytel (Poly Haven)' },
  { id: 'leather_worn', name: 'Worn brown leather', kind: 'leather', tileMetres: 0.4, site: 'Poly Haven', asset: 'brown_leather', author: 'Rob Tuytel (Poly Haven)' },
  { id: 'leather_black', name: 'Black leather', kind: 'leather', tileMetres: 0.45, site: 'ambientCG', asset: 'Leather031', author: 'Lennart Demes (ambientCG)' },
  // ambientCG gives no size for this one: 30 cm, like the other fine leathers.
  { id: 'suede', name: 'Suede', kind: 'suede', tileMetres: 0.3, site: 'ambientCG', asset: 'Leather039', author: 'Lennart Demes (ambientCG)' },
  { id: 'denim', name: 'Denim', kind: 'denim', tileMetres: 0.271, site: 'Poly Haven', asset: 'denim_fabric_03', author: 'colormass and Rico Cilliers (Poly Haven)' },
  { id: 'cotton_jersey', name: 'Cotton jersey', kind: 'cotton', tileMetres: 0.264, site: 'Poly Haven', asset: 'cotton_jersey', author: 'colormass and Rico Cilliers (Poly Haven)' },
  { id: 'canvas', name: 'Canvas', kind: 'canvas', tileMetres: 0.4, site: 'ambientCG', asset: 'Fabric062', author: 'Lennart Demes (ambientCG)' },
  { id: 'wool_herringbone', name: 'Herringbone wool', kind: 'wool', tileMetres: 0.27, site: 'Poly Haven', asset: 'poly_wool_herringbone', author: 'colormass and Rico Cilliers (Poly Haven)' },
  { id: 'knit', name: 'Knit', kind: 'knit', tileMetres: 0.267, site: 'Poly Haven', asset: 'knitted_fleece', author: 'colormass and Rico Cilliers (Poly Haven)' },
  // Listed as 40 cm, which makes the grid 7 cm: shrunk to a ripstop's 6 mm grid.
  { id: 'nylon_ripstop', name: 'Nylon ripstop', kind: 'nylon', tileMetres: 0.05, site: 'ambientCG', asset: 'Fabric048', author: 'Lennart Demes (ambientCG)' },
  { id: 'shearling', name: 'Shearling', kind: 'fur', tileMetres: 0.335, site: 'Poly Haven', asset: 'curly_teddy_natural', author: 'colormass and Rico Cilliers (Poly Haven)' },
];

const sourceUrl = (d: Def) => (d.site === 'Poly Haven' ? `https://polyhaven.com/a/${d.asset}` : `https://ambientcg.com/view?id=${d.asset}`);

/** The fetched maps of a material: albedo, normal (GL), and ARM or separate AO / roughness / height. */
function sourceFiles(d: Def): Record<string, string | null> {
  if (d.site === 'Poly Haven') {
    const dir = (m: string) => join(CACHE, `mat_${d.asset}_${m}`);
    const one = (m: string) => {
      const p = dir(m);
      if (!existsSync(p)) return null;
      const f = readdirSync(p).find((x) => x.endsWith('.jpg'));
      return f ? join(p, f) : null;
    };
    return { albedo: one('albedo'), normal: one('normal'), arm: one('arm'), ao: null, rough: null, height: null };
  }
  const dir = join(CACHE, `mat_${d.asset.toLowerCase()}`);
  const f = (suffix: string) => {
    const p = join(dir, `${d.asset}_2K-JPG_${suffix}.jpg`);
    return existsSync(p) ? p : null;
  };
  return { albedo: f('Color'), normal: f('NormalGL'), arm: null, ao: f('AmbientOcclusion'), rough: f('Roughness'), height: f('Displacement') };
}

const b64 = (p: string | null) => (p ? readFileSync(p).toString('base64') : null);

test('build the material library', async ({ page }) => {
  const missing = DEFS.filter((d) => {
    const f = sourceFiles(d);
    return !f.albedo || !f.normal || (!f.arm && !f.rough);
  });
  test.skip(missing.length > 0, `material sources not fetched: ${missing.map((d) => d.asset).join(', ')}`);
  test.setTimeout(900_000);
  mkdirSync(OUT, { recursive: true });
  await boot(page);
  await waitForTestHooks(page);
  const catalogEntries: Record<string, unknown>[] = [];
  const licenceRows: Record<string, unknown>[] = [];
  const sheet: { id: string; albedo: string; era: string }[] = [];
  for (const d of DEFS) {
    const files = sourceFiles(d);
    const res = await page.evaluate(
      async (input) => {
        const w = window as unknown as TestWindow;
        const t = w.__ps2ccTest;
        const core = t.core;
        const decode = async (b: string | null, size?: number) => {
          if (!b) return null;
          const bytes = Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
          const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
          const W = size ?? bmp.width;
          const H = size ?? bmp.height;
          const c = new OffscreenCanvas(W, H);
          const ctx = c.getContext('2d')!;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(bmp, 0, 0, W, H);
          const px = ctx.getImageData(0, 0, W, H);
          return { width: W, height: H, data: new Uint8ClampedArray(px.data) } as { width: number; height: number; data: Uint8ClampedArray<ArrayBuffer> };
        };
        const toJpg = async (img: { width: number; height: number; data: Uint8ClampedArray<ArrayBuffer> }, size: number) => {
          const c = new OffscreenCanvas(img.width, img.height);
          c.getContext('2d')!.putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
          let out = c;
          if (size !== img.width) {
            out = new OffscreenCanvas(size, size);
            const ctx = out.getContext('2d')!;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(c, 0, 0, size, size);
          }
          const blob = await out.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
          const u = new Uint8Array(await blob.arrayBuffer());
          let bin = '';
          for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode(...u.subarray(i, i + 0x8000));
          return btoa(bin);
        };
        // A few sources are up to 2% off square (denim 2048 x 2045, herringbone 2048 x 2091); stretched square, they still tile.
        const first = (await decode(input.albedo))!;
        const S = Math.max(first.width, first.height);
        if (Math.abs(first.width - first.height) > S * 0.03) return { error: `albedo is ${first.width}x${first.height}, expected square` };
        const albedo = first.width === first.height ? first : (await decode(input.albedo, S))!;
        const normal = (await decode(input.normal, S))!;
        let arm = await decode(input.arm, S);
        let aoSource = 'map';
        if (!arm) {
          let ao = await decode(input.ao, S);
          if (!ao && input.height) {
            ao = core.aoFromHeight((await decode(input.height, S))!);
            aoSource = 'height';
          }
          if (!ao) aoSource = 'none';
          arm = core.packArm(S, S, ao, await decode(input.rough, S));
        }
        const era = core.pbrToEra({ albedo, normal, arm });
        const roughness = core.channelMean(arm, 1);
        const swatch = [0, 1, 2].map((c) => Math.round(core.channelMean(era, c) * 1000) / 1000);
        return {
          size: S,
          roughness,
          swatch,
          aoSource,
          era: await toJpg(era, 2048),
          albedo: await toJpg(albedo, 1024),
          normal: await toJpg(normal, 1024),
          arm: await toJpg(arm, 1024),
          eraSmall: await toJpg(era, 256),
          albedoSmall: await toJpg(albedo, 256),
        };
      },
      { albedo: b64(files.albedo!), normal: b64(files.normal!), arm: b64(files.arm ?? null), ao: b64(files.ao ?? null), rough: b64(files.rough ?? null), height: b64(files.height ?? null) },
    );
    expect('error' in res ? res.error : null, d.id).toBeNull();
    const r = res as Exclude<typeof res, { error: string }>;
    const dir = join(ASSETS, 'materials', d.id);
    mkdirSync(dir, { recursive: true });
    const rel = (m: string) => `materials/${d.id}/${d.id}_${m}.jpg`;
    const written: Record<string, string> = {};
    for (const m of ['diffuse', 'albedo', 'normal', 'arm'] as const) {
      const data = m === 'diffuse' ? r.era : r[m];
      writeFileSync(join(ASSETS, rel(m)), Buffer.from(data, 'base64'));
      written[m] = rel(m);
    }
    const id = `ps2cc:materials/${d.id}`;
    const roughness = Math.round(r.roughness * 1000) / 1000;
    const gloss = Math.round(Math.max(0.02, Math.min(0.6, (1 - roughness) ** 2 * 0.9)) * 100) / 100;
    catalogEntries.push({
      id,
      name: d.name,
      kind: d.kind,
      diffuse: written.diffuse,
      diffuseSize: 2048,
      pbr: { albedo: written.albedo, normal: written.normal, arm: written.arm, size: 1024 },
      tileMetres: d.tileMetres,
      roughness,
      gloss,
      swatch: r.swatch,
      source: { site: d.site, asset: d.asset, url: sourceUrl(d), licence: 'CC0-1.0', author: d.author },
    });
    for (const m of ['diffuse', 'albedo', 'normal', 'arm'] as const) {
      const file = written[m]!;
      const abs = join(ASSETS, file);
      licenceRows.push({
        file,
        asset: id,
        licence: 'CC0-1.0',
        author: m === 'diffuse' ? `${d.author}, converted to an era diffuse by PS2CC` : `${d.author}${m === 'arm' && d.site === 'ambientCG' ? ', packed by PS2CC' : ', resized by PS2CC'}`,
        sourceUrl: sourceUrl(d),
        upstream: d.site === 'Poly Haven' ? 'polyhaven' : 'ambientcg',
        attributionRequired: false,
        sha256: createHash('sha256').update(readFileSync(abs)).digest('hex'),
        bytes: statSync(abs).size,
      });
    }
    sheet.push({ id: d.id, albedo: r.albedoSmall, era: r.eraSmall });
    console.log(`${d.id}: ${r.size}px source, roughness ${roughness}, gloss ${gloss}, occlusion from ${r.aoSource}`);
  }

  const catalogPath = join(ASSETS, 'catalog.json');
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as Record<string, unknown>;
  catalog.materials = catalogEntries;
  writeFileSync(catalogPath, JSON.stringify(catalog, null, 1) + '\n');

  const licPath = join(ASSETS, 'LICENSES.json');
  const lic = JSON.parse(readFileSync(licPath, 'utf8')) as { files: Record<string, unknown>[] };
  const files = new Set(licenceRows.map((r) => r.file));
  lic.files = [...lic.files.filter((r) => !files.has(r.file as string)), ...licenceRows].sort((a, b) => (String(a.file) < String(b.file) ? -1 : 1));
  writeFileSync(licPath, JSON.stringify(lic, null, 1) + '\n');

  // Review sheet: each material's albedo above its era diffuse.
  const png = await page.evaluate(async (items) => {
    const T = 192;
    const c = new OffscreenCanvas(items.length * (T + 8) + 8, T * 2 + 56);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#141416';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.font = '12px sans-serif';
    for (let i = 0; i < items.length; i++) {
      const it = items[i]!;
      const x = 8 + i * (T + 8);
      for (const [k, src] of [[0, it.albedo], [1, it.era]] as const) {
        const bytes = Uint8Array.from(atob(src), (ch) => ch.charCodeAt(0));
        const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
        ctx.drawImage(bmp, x, 20 + k * (T + 8), T, T);
      }
      ctx.fillStyle = '#ddd';
      ctx.fillText(it.id, x, 14);
      ctx.fillText(i === 0 ? 'top: PBR albedo, bottom: era diffuse' : '', x, T * 2 + 48);
    }
    const blob = await c.convertToBlob({ type: 'image/png' });
    const u = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode(...u.subarray(i, i + 0x8000));
    return btoa(bin);
  }, sheet);
  writeFileSync(join(OUT, 'materials_sheet.png'), Buffer.from(png, 'base64'));
});
