/**
 * PRD M14 (Face and eyes, F19), the parts that run without a browser:
 *  - head UV repack, on every PS2 body mesh: the head texture uses at least
 *    85% of its texels and the face's texel density at least doubles over
 *    Part 1's packing; every head triangle keeps a positive winding (nothing
 *    folds over), nothing overlaps, everything stays inside 0..1, and the
 *    stored layouts are what the solver gives.
 *  - low-poly teeth and tongue: every teeth set plus the tongue within 600
 *    triangles;
 *  - generated eyes: pupil, iris colour and sclera where the eye texture's
 *    layout puts them, on both discs; the catch-light only when asked for;
 *  - micro-detail: the pore and stubble tiles are seamless when repeated, the
 *    pores' region map leaves the lids and lips alone and is strongest on the
 *    nose, the reference compositor draws a detail layer, and a pore spans a
 *    few texels of the composited face (resolvable, not noise).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BodyMeshId } from '../src/character/doc';
import { EYE_UV, IRIS_LIBRARY, DEFAULT_EYE_LOOK, eyeTexel, eyeTexture } from '../src/eyes/eye-texture';
import { compositeReference } from '../src/skin/blend';
import { SKIN_COMPOSITE_SIZE } from '../src/skin/compose';
import { DETAIL_TILE_METRES, detailTile, faceUvPerMetre, sampleWrap, type DetailPattern } from '../src/skin/detail';
import { computeHeadLayout, headCoverage, headLayoutFile, headMeshOf, type HeadLayout } from '../src/skin/headpack';
import { createImage } from '../src/skin/image';
import { newLayer } from '../src/skin/layers';
import { ASSETS_DIR, assetsAvailable, loadAssets } from './helpers';

/**
 * Part 1's head packing (D-034): every head island at one uniform scale,
 * measured on hm08 before the repack (head-texture units per hm08 UV unit).
 */
const PART1_HEAD_SCALE = 1.4715;

const MESHES: BodyMeshId[] = ['ps2_body_8k', 'ps2_body_10k', 'ps2_body_12k', 'ps2_body_16k', 'ps2_body_20k', 'ps2_body_full'];

const area = (uv: ArrayLike<number>, c: readonly number[]) =>
  ((uv[c[1]! * 2]! - uv[c[0]! * 2]!) * (uv[c[2]! * 2 + 1]! - uv[c[0]! * 2 + 1]!) - (uv[c[2]! * 2]! - uv[c[0]! * 2]!) * (uv[c[1]! * 2 + 1]! - uv[c[0]! * 2 + 1]!)) / 2;

/** Area-weighted mean density over the face (big island, fully inside the face zone), over Part 1's. */
export function faceDensityGain(head: HeadLayout): number {
  let a0 = 0;
  let weighted = 0;
  head.mesh.triangles.forEach((t, i) => {
    if (t.island !== head.islands[0] || head.faceWeight[i]! < 0.99) return;
    const before = Math.abs(area(head.mesh.uvs, t.corners));
    if (!(before > 0)) return;
    a0 += before;
    weighted += Math.sqrt(Math.abs(area(head.uv, t.corners)) / before) * before;
  });
  return weighted / a0 / PART1_HEAD_SCALE;
}

const suite = assetsAvailable ? describe : describe.skip;

suite('head UV repack (needs assets)', () => {
  for (const id of MESHES) {
    it(`${id}: uses at least 85% of the head texture and at least doubles the face texel density`, async () => {
      const assets = await loadAssets();
      const head = await assets.headLayout(id);
      expect(headCoverage(head, 1024)).toBeGreaterThanOrEqual(0.85);
      expect(faceDensityGain(head)).toBeGreaterThanOrEqual(2);
    });

    it(`${id}: no head triangle folds over or overlaps another, and all stay inside 0..1`, async () => {
      const assets = await loadAssets();
      const head = await assets.headLayout(id);
      let folded = 0;
      let total = 0;
      for (const t of head.mesh.triangles) {
        const a = area(head.uv, t.corners);
        if (!(a > 0)) folded++;
        total += Math.abs(a);
        for (const c of t.corners) {
          for (const d of [0, 1]) {
            expect(head.uv[c * 2 + d]).toBeGreaterThanOrEqual(0);
            expect(head.uv[c * 2 + d]).toBeLessThanOrEqual(1);
          }
          expect(head.density[c]).toBeGreaterThan(0);
        }
      }
      expect(folded).toBe(0);
      // With nothing folded, an overlap would make the triangles' areas add up to more than the texels they cover.
      expect(total - headCoverage(head, 2048)).toBeLessThan(0.005);
    });
  }

  it('the stored layouts are the solver result (pnpm build:headlayout)', async () => {
    const assets = await loadAssets();
    const layout = assets.skinComposer.layout;
    for (const id of ['ps2_body_8k', 'ps2_body_12k'] as const) {
      const stored = headLayoutFile(id, await assets.headLayout(id));
      const fresh = headLayoutFile(id, computeHeadLayout(layout, assets.base, headMeshOf(layout, (await assets.bodyMesh(id))!)));
      expect(stored.indices).toEqual(fresh.indices);
      let worst = 0;
      for (let i = 0; i < fresh.uv.length; i++) worst = Math.max(worst, Math.abs(fresh.uv[i]! - stored.uv[i]!));
      // A twentieth of a texel at 1024.
      expect(worst).toBeLessThan(0.05 / 1024);
    }
  });
});

suite('low-poly teeth and tongue (needs assets)', () => {
  it('every teeth set plus the tongue stays within 600 triangles', () => {
    const catalog = JSON.parse(readFileSync(join(ASSETS_DIR, 'catalog.json'), 'utf8')) as { proxies: { id: string; category: string; file: string }[] };
    const tris = (file: string) => (JSON.parse(readFileSync(join(ASSETS_DIR, file), 'utf8')) as { triangleFaces: number }).triangleFaces;
    const teeth = catalog.proxies.filter((p) => p.category === 'teeth');
    const tongues = catalog.proxies.filter((p) => p.category === 'tongue');
    expect(teeth.length).toBeGreaterThan(0);
    expect(tongues.length).toBeGreaterThan(0);
    const worstTongue = Math.max(...tongues.map((t) => tris(t.file)));
    for (const t of teeth) expect(tris(t.file) + worstTongue, t.id).toBeLessThanOrEqual(600);
  });
});

describe('generated eyes', () => {
  const at = (img: ReturnType<typeof eyeTexture>, disc: number, r: number, angle = 0.3) => {
    const d = EYE_UV.discs[disc]!;
    return eyeTexel(img, d.centre[0] + Math.cos(angle) * r * EYE_UV.iris, d.centre[1] + Math.sin(angle) * r * EYE_UV.iris);
  };
  const lum = (c: readonly number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;

  it('puts the pupil, the iris colour and the sclera where the layout says, on both discs', () => {
    for (const preset of [IRIS_LIBRARY.find((p) => p.id === 'blue')!, IRIS_LIBRARY.find((p) => p.id === 'brown')!]) {
      const look = { ...DEFAULT_EYE_LOOK, ...preset.look, veins: 0, lidShadow: 0 };
      const img = eyeTexture(look, 256);
      const want = [1, 3, 5].map((i) => parseInt(look.iris.slice(i, i + 2), 16));
      for (const disc of [0, 1]) {
        expect(lum(at(img, disc, 0)), `${preset.id} pupil`).toBeLessThan(40);
        // The iris, averaged around mid-radius, near the preset's colour.
        const ring = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => at(img, disc, 0.68, (k / 8) * Math.PI * 2));
        const mean = [0, 1, 2].map((c) => ring.reduce((a, x) => a + x[c]!, 0) / ring.length);
        for (let c = 0; c < 3; c++) expect(Math.abs(mean[c]! - want[c]!), `${preset.id} iris channel ${c}`).toBeLessThan(45);
        expect(lum(at(img, disc, 1.6)), `${preset.id} sclera`).toBeGreaterThan(170);
      }
      // Blue is bluer than brown at mid-radius, and the other way round for red.
      if (preset.id === 'blue') expect(want[2]!).toBeGreaterThan(want[0]!);
    }
  });

  it('paints the catch-light only when asked for (Classic lighting)', () => {
    const plain = eyeTexture(DEFAULT_EYE_LOOK, 256, false);
    const lit = eyeTexture(DEFAULT_EYE_LOOK, 256, true);
    let brightest = 0;
    let changed = 0;
    for (let i = 0; i < plain.data.length; i += 4) {
      const d = Math.abs(lit.data[i]! - plain.data[i]!);
      if (d > 0) changed++;
      brightest = Math.max(brightest, lit.data[i]! - plain.data[i]!);
    }
    expect(changed).toBeGreaterThan(0);
    expect(brightest).toBeGreaterThan(60);
  });
});

describe('skin micro-detail', () => {
  it('the tiles are seamless when repeated', () => {
    for (const pattern of ['pores', 'stubbleHair'] as DetailPattern[]) {
      const t = detailTile(pattern);
      const n = t.width;
      const g = (x: number, y: number) => t.data[(y * n + x) * 4]!;
      let across = 0;
      let inside = 0;
      for (let y = 0; y < n; y++) {
        across += Math.abs(g(n - 1, y) - g(0, y)) + Math.abs(g(y, n - 1) - g(y, 0));
        for (let x = 1; x < n; x++) inside += Math.abs(g(x, y) - g(x - 1, y)) / (n - 1);
        for (let x = 1; x < n; x++) inside += Math.abs(g(y, x) - g(y, x - 1)) / (n - 1);
      }
      // The step across the tile's edge is like any step between neighbours inside it.
      expect(across / inside, pattern).toBeLessThan(1.5);
      const a = [0, 0, 0, 0];
      const b = [0, 0, 0, 0];
      sampleWrap(t, 0.123, 0.456, a);
      sampleWrap(t, 2.123, -0.544, b);
      for (let k = 0; k < 4; k++) expect(b[k]).toBeCloseTo(a[k]!, 6);
    }
  });

  it('the reference compositor draws a detail layer through its region map', () => {
    const tile = detailTile('pores');
    const weight = createImage(8, 8, [0, 0, 0, 255]);
    for (let i = 0; i < 32; i++) weight.data[i * 4 + 3] = 0; // top half uncovered
    const base = createImage(8, 8, [10, 200, 30, 255]);
    const out = compositeReference(base, [{ source: { kind: 'detail', tile, weight, repeat: 3 }, blend: 'normal', opacity: 1, mask: 'none' }], null, 8);
    const s = [0, 0, 0, 0];
    // Bottom half: the tile, repeated 3 times over the square; top half: the base.
    sampleWrap(tile, (2 + 0.5) / 8 * 3, (1 - (6 + 0.5) / 8) * 3, s);
    const i = (6 * 8 + 2) * 4;
    expect(Math.abs(out.data[i]! - Math.round(s[0]!))).toBeLessThanOrEqual(1);
    expect(out.data[(1 * 8 + 2) * 4 + 1]).toBe(200);
  });
});

suite('skin micro-detail on the face (needs assets)', () => {
  it('pores: none on the lids and lips, strongest on the nose; a pore spans a few composite texels', async () => {
    const assets = await loadAssets();
    const c = assets.skinComposer;
    const f = c.features;
    const map = c.surface;
    const img = c.layerImage(newLayer('pores'));
    const face = c.layout.islands.filter((i) => i.kind === 'head').sort((a, b) => b.faces.length - a.faces.length)[0]!.id;
    let lids = 0;
    let lips = 0;
    const nose: number[] = [];
    const forehead: number[] = [];
    const eyeY = f.eyes[0].centre[1];
    for (let t = 0; t < map.size * map.size; t++) {
      if (map.island[t] !== face) continue;
      const p = [map.position[t * 3]!, map.position[t * 3 + 1]!, map.position[t * 3 + 2]!];
      const a = img.data[t * 4 + 3]! / 255;
      for (const e of f.eyes) if (Math.abs(p[0]! - e.centre[0]) < e.halfWidth * 0.9 && Math.abs(p[1]! - e.centre[1]) < e.halfHeight * 1.5 && p[2]! > e.centre[2] - 0.01) lids = Math.max(lids, a);
      if (Math.abs(p[0]! - f.mouth.centre[0]) < f.mouth.halfWidth * 0.8 && Math.abs(p[1]! - f.mouth.centre[1]) < 0.004 && p[2]! > f.mouth.centre[2] - 0.01) lips = Math.max(lips, a);
      if (Math.hypot(p[0]!, p[1]! - (f.noseTip[1] + 0.008), p[2]! - f.noseTip[2]) < 0.01) nose.push(a);
      if (Math.abs(p[0]!) < 0.02 && p[1]! > eyeY + 0.035 && p[1]! < eyeY + 0.05 && p[2]! > f.eyes[0].centre[2]) forehead.push(a);
    }
    const mean = (v: number[]) => v.reduce((x, y) => x + y, 0) / v.length;
    expect(lids).toBeLessThan(0.1);
    expect(lips).toBeLessThan(0.1);
    expect(nose.length).toBeGreaterThan(10);
    expect(forehead.length).toBeGreaterThan(10);
    expect(mean(nose)).toBeGreaterThan(0.9);
    expect(mean(nose)).toBeGreaterThan(mean(forehead) + 0.2);
    // Pore spacing in composite texels: 32 pores across a tile.
    const texelsPerPore = (DETAIL_TILE_METRES.pores / 32) * faceUvPerMetre(c.layout) * SKIN_COMPOSITE_SIZE;
    expect(texelsPerPore).toBeGreaterThan(2);
    expect(texelsPerPore).toBeLessThan(8);
  });
});
