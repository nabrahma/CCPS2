/**
 * PRD Part 2 M15 (Materials and wardrobe), the checks that run in Node:
 * - every material in the manifest is CC0 with a source URL;
 * - the PBR-to-era converter (flat texels keep their albedo, lit and occluded ones change);
 * - seams and hems are detected on every library garment;
 * - composing a look is deterministic, and stitches, folds, wear and decals each change it where they should;
 * - Garment Studio's brushes and kitbash tools;
 * - garments edited in Garment Studio still pass the M10 poke-through test (50 bodies, 2 mm);
 * - Mara's vest and Cole's jacket are library garments, the jacket with its fur trim.
 * Writes docs/milestones/M15/wardrobe_report.json.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CoreAssets } from '../src/assets';
import { defaultCharacter, NEUTRAL_TINT, type BodyMeshId, type GarmentSlotName } from '../src/character/doc';
import { CharacterEngine } from '../src/character/engine';
import { randomizeCharacter } from '../src/character/randomize';
import { BodySurface } from '../src/proxy/collision';
import { referenceBody, type ReferenceBody } from '../src/proxy/garment-import';
import { CharacterScene } from '../src/scene/character-scene';
import { createImage } from '../src/skin/image';
import { composeGarment, seamSummary, type GarmentCanvas } from '../src/wardrobe/compose';
import { GarmentLookComposer } from '../src/wardrobe/composer';
import { decodeMask, encodeMask, newLook, sanitiseLook, type GarmentLook } from '../src/wardrobe/look';
import { ERA_LIGHT, eraIrradiance, pbrToEra, tileMips, type CatalogMaterial } from '../src/wardrobe/material';
import {
  addPatch,
  applyShapeBrush,
  betweenShoulders,
  bodySurface,
  cropAtPlane,
  editMeshFromProxy,
  editTriangles,
  extrudeLoop,
  keepOutside,
  MIN_GAP,
  moveToBody,
  openLoops,
  UV_ROOM_SCALE,
  vertexNormals,
  type EditMesh,
} from '../src/wardrobe/studio';
import { ASSETS_DIR, assetsAvailable, loadAssets, REPO_ROOT } from './helpers';

const suite = assetsAvailable ? describe : describe.skip;
const REPORT = join(REPO_ROOT, 'docs', 'milestones', 'M15');
const LIMIT = 0.002;
const BODIES = 50;
const SEED = Number(process.env.PS2CC_SEED ?? 15000);
const BODY_MESHES: BodyMeshId[] = ['ps2_body_8k', 'ps2_body_10k', 'ps2_body_12k'];
const OUTFITS = ['rollneck_sweater', 'mara_utility_vest', 'cole_leather_jacket', 'wristbands', 'cargo_trousers'].map((n) => `ps2cc:clothes/${n}`);
const report: Record<string, unknown> = {};

describe('M15: PBR to era diffuse', () => {
  const size = 32;
  const flatMaps = () => {
    const albedo = createImage(size, size, [180, 120, 60, 255]);
    const normal = createImage(size, size, [128, 128, 255, 255]);
    const arm = createImage(size, size, [255, 160, 0, 255]);
    return { albedo, normal, arm };
  };
  it('keeps a flat, unoccluded texel at its albedo', () => {
    const out = pbrToEra(flatMaps());
    for (let i = 0; i < size * size; i++) {
      expect(Math.abs(out.data[i * 4]! - 180)).toBeLessThanOrEqual(1);
      expect(Math.abs(out.data[i * 4 + 1]! - 120)).toBeLessThanOrEqual(1);
      expect(Math.abs(out.data[i * 4 + 2]! - 60)).toBeLessThanOrEqual(1);
    }
  });
  it('lights texels facing the key, darkens those facing away and occluded ones', () => {
    const facing = flatMaps();
    // Normal tilted up (towards the key): +y in tangent space.
    facing.normal = createImage(size, size, [128, 200, 220, 255]);
    const away = flatMaps();
    away.normal = createImage(size, size, [128, 50, 220, 255]);
    const occluded = flatMaps();
    occluded.arm = createImage(size, size, [60, 160, 0, 255]);
    const v = (m: ReturnType<typeof flatMaps>) => pbrToEra(m).data[(size * 8 + 8) * 4]!;
    expect(v(facing)).toBeGreaterThan(185);
    expect(v(away)).toBeLessThan(170);
    expect(v(occluded)).toBeLessThan(170);
    expect(eraIrradiance([0, 0, 1], 1)).toBeCloseTo(ERA_LIGHT.keyIntensity * ERA_LIGHT.key[2] + ERA_LIGHT.ground + (ERA_LIGHT.sky - ERA_LIGHT.ground) * 0.5, 6);
  });
  it('keeps a tile seamless (a wrapped pattern stays wrapped)', () => {
    const m = flatMaps();
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const nx = Math.round(128 + 60 * Math.sin((x / size) * Math.PI * 2));
        m.normal.data.set([nx, 128, 240, 255], (y * size + x) * 4);
      }
    const out = pbrToEra(m);
    // The left and right columns are neighbours across the wrap: their difference is like any neighbours'.
    let wrap = 0;
    let inside = 0;
    for (let y = 0; y < size; y++) {
      wrap += Math.abs(out.data[(y * size + size - 1) * 4]! - out.data[y * size * 4]!);
      inside += Math.abs(out.data[(y * size + 1) * 4]! - out.data[y * size * 4]!);
    }
    expect(wrap).toBeLessThanOrEqual(inside * 1.5 + size);
  });
});

describe('M15: looks', () => {
  it('sanitises a look read from a file', () => {
    const l = sanitiseLook({ zones: [{ islands: [1, -2, 'x', 3], tint: [2, -1, 0.5], scale: 99 }], seams: { stitches: 9, hemRows: 7 }, decals: [{ kind: 'zip', uv: [0.5, 0.5] }, { kind: 'nope', uv: [0, 0] }], mask: { size: 4, rle: 'evil' } });
    expect(l.zones[0]!.islands).toEqual([1, 3]);
    expect(l.zones[0]!.tint).toEqual([1, 0, 0.5]);
    expect(l.zones[0]!.scale).toBe(10);
    expect(l.seams.stitches).toBe(1);
    expect(l.seams.hemRows).toBe(2);
    expect(l.decals.map((d) => d.kind)).toEqual(['zip']);
    expect(l.decals[0]!.uv2).toBeDefined();
    expect(l.mask).toBeNull();
    expect(sanitiseLook(null).zones.length).toBe(1);
  });
  it('round-trips a painted zone mask', () => {
    const z = new Uint8Array(64 * 64);
    for (let i = 0; i < z.length; i++) z[i] = (i * 7) % 13 < 4 ? 2 : i % 64 < 20 ? 1 : 0;
    expect(Array.from(decodeMask(encodeMask(64, z)))).toEqual(Array.from(z));
  });
});

suite('M15: materials and wardrobe on the library', () => {
  let assets: CoreAssets;
  let ref: ReferenceBody;
  let body: BodySurface;
  let looks: GarmentLookComposer;
  beforeAll(async () => {
    assets = await loadAssets();
    ref = referenceBody(assets);
    body = bodySurface(ref);
    looks = new GarmentLookComposer(assets);
  }, 120_000);

  it('every material in the manifest is CC0 with a source URL, and its files are licensed', () => {
    const mats = assets.catalog.materials ?? [];
    expect(mats.length).toBeGreaterThanOrEqual(9);
    // The PRD's list: leather, denim, cotton, canvas, wool, knit, nylon, suede, fur.
    for (const k of ['leather', 'denim', 'cotton', 'canvas', 'wool', 'knit', 'nylon', 'suede', 'fur']) expect(mats.some((m) => m.kind === k), k).toBe(true);
    const lic = JSON.parse(readFileSync(join(ASSETS_DIR, 'LICENSES.json'), 'utf8')) as { files: { file: string; licence: string; sourceUrl: string }[] };
    const rows = new Map(lic.files.map((r) => [r.file, r]));
    const sources = JSON.parse(readFileSync(join(REPO_ROOT, 'tools', 'asset-compiler', 'sources.json'), 'utf8')) as { sources: { id: string; licence: string; url: string }[] };
    const matSources = sources.sources.filter((s) => s.id.startsWith('mat_'));
    expect(matSources.length).toBeGreaterThan(0);
    for (const s of matSources) expect(s.licence, s.id).toBe('CC0-1.0');
    for (const m of mats) {
      expect(m.source.licence, m.id).toBe('CC0-1.0');
      expect(m.source.url, m.id).toMatch(/^https:\/\/(polyhaven\.com\/a\/|ambientcg\.com\/view\?id=)/);
      for (const f of [m.diffuse, m.pbr.albedo, m.pbr.normal, m.pbr.arm]) {
        const row = rows.get(f);
        expect(row, f).toBeDefined();
        expect(row!.licence, f).toBe('CC0-1.0');
        expect(row!.sourceUrl, f).toBe(m.source.url);
      }
      expect(m.tileMetres).toBeGreaterThan(0.01);
    }
    report.materials = mats.map((m) => ({ id: m.id, kind: m.kind, source: m.source.url, tileMetres: m.tileMetres, gloss: m.gloss }));
  });

  it('detects seams and hems on every library garment', async () => {
    const garments = assets.catalog.proxies.filter((p) => p.category === 'clothes');
    expect(garments.length).toBeGreaterThan(100);
    const rows: { id: string; islands: number; seamMetres: number; hemMetres: number }[] = [];
    const none: string[] = [];
    for (const g of garments) {
      const { surface } = await looks.surface(g.id);
      const s = seamSummary(surface);
      rows.push({ id: g.id, islands: s.islands, seamMetres: +s.seamMetres.toFixed(3), hemMetres: +s.hemMetres.toFixed(3) });
      if (s.segments === 0 || s.seamMetres + s.hemMetres < 0.05) none.push(g.id);
    }
    report.seams = { garments: rows.length, withSeams: rows.filter((r) => r.seamMetres > 0).length, withHems: rows.filter((r) => r.hemMetres > 0).length, none, perGarment: rows };
    expect(none).toEqual([]);
  }, 600_000);

  describe('composing a look', () => {
    let canvas: GarmentCanvas;
    let material: CatalogMaterial;
    const tile = createImage(64, 64);
    beforeAll(async () => {
      canvas = await looks.canvas('mh:clothes/toigo_fisherman_sweater', 256);
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) tile.data.set([150 + ((x ^ y) & 8) * 4, 140, 120, 255], (y * 64 + x) * 4);
      material = { ...assets.catalog.materials![0]!, tileMetres: 0.1 };
    });
    const compose = (look: GarmentLook) => composeGarment(canvas, look, { base: null, material: () => ({ info: material, mips: tileMips(tile) }) });
    const diff = (a: Uint8ClampedArray, b: Uint8ClampedArray, where: (i: number) => boolean) => {
      let changed = 0;
      let n = 0;
      for (let i = 0; i < a.length / 4; i++) {
        if (!where(i)) continue;
        n++;
        if (Math.abs(a[i * 4]! - b[i * 4]!) + Math.abs(a[i * 4 + 1]! - b[i * 4 + 1]!) + Math.abs(a[i * 4 + 2]! - b[i * 4 + 2]!) > 6) changed++;
      }
      return n ? changed / n : 0;
    };
    const plain = () => {
      const l = newLook(material.id);
      l.seams.stitches = 0;
      l.seams.shadow = 0;
      l.folds.strength = 0;
      return l;
    };
    it('is deterministic', () => {
      const l = newLook(material.id);
      l.zones[0]!.wear = 0.5;
      expect(Buffer.from(compose(l).data).equals(Buffer.from(compose(l).data))).toBe(true);
    });
    it('stitches and seam shadows change texels at seams and hems only', () => {
      const a = compose(plain());
      const l = plain();
      l.seams.stitches = 1;
      l.seams.shadow = 1;
      const b = compose(l);
      const near = (i: number) => canvas.seamDistance[i]! < 0.008 && canvas.raster.coverage[i] === 1;
      const far = (i: number) => !(canvas.seamDistance[i]! < 0.02) && canvas.raster.coverage[i] === 1;
      expect(diff(a.data, b.data, near)).toBeGreaterThan(0.3);
      expect(diff(a.data, b.data, far)).toBe(0);
    });
    it('folds gather at the elbows, not the middle of the back', () => {
      const a = compose(plain());
      const l = plain();
      l.folds.strength = 1;
      const b = compose(l);
      const P = canvas.raster.position;
      const elbow = (i: number) => canvas.raster.coverage[i] === 1 && Math.abs(Math.abs(P[i * 3]!) - 0.33) < 0.04 && Math.abs(P[i * 3 + 1]! - 0.32) < 0.05;
      const back = (i: number) => canvas.raster.coverage[i] === 1 && Math.abs(P[i * 3]!) < 0.05 && P[i * 3 + 2]! < -0.05 && P[i * 3 + 1]! > 0.35;
      const atElbow = diff(a.data, b.data, elbow);
      expect(atElbow).toBeGreaterThan(0.2);
      expect(diff(a.data, b.data, back)).toBeLessThan(atElbow / 4);
      report.folds = { elbowTexelsChanged: +atElbow.toFixed(3), upperBackTexelsChanged: +diff(a.data, b.data, back).toFixed(3) };
    });
    it('a decal draws on its piece of cloth, around its point', () => {
      const a = compose(plain());
      const l = plain();
      // The middle of the biggest island.
      let best = 0;
      for (let i = 1; i < canvas.islands.count; i++) if (canvas.islands.area[i]! > canvas.islands.area[best]!) best = i;
      const b4 = canvas.islands.bounds.subarray(best * 4, best * 4 + 4);
      const uv: [number, number] = [(b4[0]! + b4[2]!) / 2, (b4[1]! + b4[3]!) / 2];
      l.decals.push({ id: 'b', kind: 'button', uv, sizeMm: 30, rotation: 0, colour: [0.1, 0.1, 0.1] });
      const b = compose(l);
      const S = canvas.raster.size;
      const cx = uv[0] * S;
      const cy = (1 - uv[1]) * S;
      const r = (0.015 * canvas.islands.uvPerMetre[best]! * S) / 1;
      expect(diff(a.data, b.data, (i) => Math.hypot((i % S) + 0.5 - cx, Math.floor(i / S) + 0.5 - cy) < r * 0.7)).toBeGreaterThan(0.9);
      expect(diff(a.data, b.data, (i) => Math.hypot((i % S) + 0.5 - cx, Math.floor(i / S) + 0.5 - cy) > r * 3)).toBe(0);
    });
    it('wear scuffs edges more than the middle of a piece', () => {
      const a = compose(plain());
      const l = plain();
      l.zones[0]!.wear = 1;
      const b = compose(l);
      const edge = diff(a.data, b.data, (i) => canvas.seamDistance[i]! < 0.004 && canvas.raster.coverage[i] === 1);
      const mid = diff(a.data, b.data, (i) => !(canvas.seamDistance[i]! < 0.02) && canvas.raster.coverage[i] === 1);
      expect(edge).toBeGreaterThan(mid * 1.5);
    });
  });

  describe('Garment Studio', () => {
    let sweater: EditMesh;
    const shoulderX = () => 0.17;
    beforeAll(async () => {
      sweater = editMeshFromProxy(await assets.proxy('mh:clothes/toigo_fisherman_sweater'), ref);
    });
    const fresh = (): EditMesh => ({ ...sweater, positions: sweater.positions.slice(), uvs: sweater.uvs.slice(), faceVerts: sweater.faceVerts.slice(), faceUvs: sweater.faceUvs.slice(), parts: [] });
    /** Closest approach to the skin of vertices `from` on (the edited ones; MakeHuman's own fit sits as close as 0.8 mm). */
    const minGap = (m: EditMesh, from = 0) => {
      let d = Infinity;
      const p = [0, 0, 0];
      for (let v = from; v < m.positions.length / 3; v++) {
        p[0] = m.positions[v * 3]!;
        p[1] = m.positions[v * 3 + 1]!;
        p[2] = m.positions[v * 3 + 2]!;
        const hit = body.closest(p, 0.05);
        if (hit) d = Math.min(d, body.signedDistance(p, hit));
      }
      return d;
    };

    it('crops at a plane, between the shoulders, with a straight new edge', () => {
      const m = fresh();
      const before = m.faceVerts.length / 4;
      const y = 0.2;
      const removed = cropAtPlane(m, { point: [0, y, 0], normal: [0, -1, 0] }, betweenShoulders(shoulderX()));
      expect(removed).toBeGreaterThan(before * 0.1);
      // Nothing of the torso below the plane; the sleeves keep their faces.
      let below = 0;
      for (let v = 0; v < m.positions.length / 3; v++) if (Math.abs(m.positions[v * 3]!) < 0.13 && m.positions[v * 3 + 1]! < y - 1e-6) below++;
      expect(below).toBe(0);
      const hem = openLoops(m).find((l) => l.every((v) => Math.abs(m.positions[v * 3]!) < 0.2) && l.some((v) => Math.abs(m.positions[v * 3 + 1]! - y) < 1e-5))!;
      expect(hem).toBeDefined();
      const onPlane = hem.filter((v) => Math.abs(m.positions[v * 3 + 1]! - y) < 1e-5).length / hem.length;
      expect(onPlane).toBeGreaterThan(0.6);
    });

    it('grows a collar from the neckline in its own UV room, outside the body', () => {
      const m = fresh();
      const loops = openLoops(m);
      const neck = loops.reduce((a, b) => (Math.max(...a.map((v) => m.positions[v * 3 + 1]!)) > Math.max(...b.map((v) => m.positions[v * 3 + 1]!)) ? a : b));
      const faces = m.faceVerts.length / 4;
      const verts = m.positions.length / 3;
      extrudeLoop(m, neck, { height: 0.12, out: 0.03, profile: 'collar', name: 'collar' }, body);
      expect(m.faceVerts.length / 4).toBe(faces + neck.length * 4);
      const part = m.parts.find((p) => p.name === 'collar')!;
      expect(part.rect[0] >= UV_ROOM_SCALE || part.rect[1] >= UV_ROOM_SCALE).toBe(true);
      // The original UVs were scaled into the room's square; the new ones lie in the part's rectangle.
      const newUv = new Set<number>();
      for (let f = faces; f < m.faceUvs.length / 4; f++) for (let k = 0; k < 4; k++) newUv.add(m.faceUvs[f * 4 + k]!);
      for (const t of newUv) {
        expect(m.uvs[t * 2]!).toBeGreaterThanOrEqual(part.rect[0] - 1e-6);
        expect(m.uvs[t * 2]!).toBeLessThanOrEqual(part.rect[2] + 1e-6);
      }
      for (let f = 0; f < faces; f++) for (let k = 0; k < 4; k++) expect(Math.max(m.uvs[m.faceUvs[f * 4 + k]! * 2]!, m.uvs[m.faceUvs[f * 4 + k]! * 2 + 1]!)).toBeLessThanOrEqual(UV_ROOM_SCALE + 1e-6);
      // Pushed out to MIN_GAP along the skin's normal; the closest point may move a little after the push.
      expect(minGap(m, verts)).toBeGreaterThan(MIN_GAP * 0.8);
    });

    it('adds a patch pocket standing off the cloth', () => {
      const m = fresh();
      const faces = m.faceVerts.length / 4;
      addPatch(m, [0.08, 0.42, 0.12], [0, 1, 0], 0.12, 0.14, body);
      expect(m.faceVerts.length / 4).toBe(faces + 16);
      expect(m.parts.length).toBe(1);
    });

    it('brushes: grab follows the stroke, inflate moves out, smooth evens, flatten flattens; the cloth stays outside', () => {
      const centre: [number, number, number] = [0, 0.35, 0.13];
      const nearest = (m: EditMesh) => {
        let best = 0;
        let bd = Infinity;
        for (let v = 0; v < m.positions.length / 3; v++) {
          const d = Math.hypot(m.positions[v * 3]! - centre[0], m.positions[v * 3 + 1]! - centre[1], m.positions[v * 3 + 2]! - centre[2]);
          if (d < bd) [bd, best] = [d, v];
        }
        return best;
      };
      const g = fresh();
      const v = nearest(g);
      const at = [g.positions[v * 3]!, g.positions[v * 3 + 1]!, g.positions[v * 3 + 2]!] as [number, number, number];
      applyShapeBrush(g, 'grab', { centre: at, radius: 0.05, strength: 1, delta: [0, 0.01, 0.02] }, body);
      expect(g.positions[v * 3 + 1]! - at[1]).toBeCloseTo(0.01, 3);
      expect(g.positions[v * 3 + 2]! - at[2]).toBeCloseTo(0.02, 3);

      const inf = fresh();
      const n = vertexNormals(inf.positions, editTriangles(inf));
      const before = [inf.positions[v * 3]!, inf.positions[v * 3 + 1]!, inf.positions[v * 3 + 2]!];
      applyShapeBrush(inf, 'inflate', { centre: at, radius: 0.05, strength: 1 }, body);
      const moved = [0, 1, 2].map((k) => inf.positions[v * 3 + k]! - before[k]!);
      expect(Math.abs(moved[0]! * n[v * 3]! + moved[1]! * n[v * 3 + 1]! + moved[2]! * n[v * 3 + 2]!)).toBeGreaterThan(0.002);

      // Roughen, then smooth: the bumps go down.
      const rough = fresh();
      // Within the brush in 3D (x and y alone would take in the back of the sweater too).
      const near3 = (m: EditMesh, i: number, r: number) => Math.hypot(m.positions[i * 3]! - at[0], m.positions[i * 3 + 1]! - at[1], m.positions[i * 3 + 2]! - at[2]) < r;
      for (let i = 0; i < rough.positions.length / 3; i++) if (near3(rough, i, 0.05)) rough.positions[i * 3 + 2]! += i % 2 ? 0.006 : -0.002;
      keepOutside(rough, body);
      const bumpiness = (m: EditMesh) => {
        const tris = editTriangles(m);
        const nb = new Map<number, Set<number>>();
        for (let t = 0; t < tris.length; t += 3) for (let k = 0; k < 3; k++) (nb.get(tris[t + k]!) ?? nb.set(tris[t + k]!, new Set()).get(tris[t + k]!)!).add(tris[t + ((k + 1) % 3)]!);
        let e = 0;
        for (let i = 0; i < m.positions.length / 3; i++) {
          if (!near3(m, i, 0.04)) continue;
          const list = [...(nb.get(i) ?? [])];
          if (!list.length) continue;
          const avg = [0, 1, 2].map((k) => list.reduce((s, u) => s + m.positions[u * 3 + k]!, 0) / list.length);
          e += Math.hypot(...[0, 1, 2].map((k) => m.positions[i * 3 + k]! - avg[k]!));
        }
        return e;
      };
      const r0 = bumpiness(rough);
      const rest = bumpiness(fresh());
      for (let k = 0; k < 8; k++) applyShapeBrush(rough, 'smooth', { centre: at, radius: 0.06, strength: 1 }, body);
      // More than half the added bumps go (an irregular mesh is never perfectly 'smooth' by this measure).
      expect(bumpiness(rough) - rest).toBeLessThan((r0 - rest) * 0.5);

      const flat = fresh();
      const spread = (m: EditMesh) => {
        const zs: number[] = [];
        for (let i = 0; i < m.positions.length / 3; i++) if (near3(sweater, i, 0.07)) zs.push(m.positions[i * 3 + 2]!);
        const mean = zs.reduce((a, b) => a + b, 0) / zs.length;
        return zs.reduce((a, b) => a + (b - mean) ** 2, 0) / zs.length;
      };
      const s0 = spread(flat);
      for (let k = 0; k < 3; k++) applyShapeBrush(flat, 'flatten', { centre: at, radius: 0.09, strength: 1 }, body);
      expect(spread(flat)).toBeLessThan(s0);

      // Brushed vertices keep their distance from the skin (keepOutside runs on every vertex a dab moved).
      for (const m of [g, inf, rough, flat]) {
        const moved: number[] = [];
        for (let i = 0; i < m.positions.length / 3; i++) if (Math.abs(m.positions[i * 3 + 2]! - sweater.positions[i * 3 + 2]!) + Math.abs(m.positions[i * 3 + 1]! - sweater.positions[i * 3 + 1]!) > 1e-6) moved.push(i);
        expect(moved.length).toBeGreaterThan(0);
        let d = Infinity;
        for (const v of moved) {
          const p = [m.positions[v * 3]!, m.positions[v * 3 + 1]!, m.positions[v * 3 + 2]!];
          const hit = body.closest(p, 0.05);
          if (hit) d = Math.min(d, body.signedDistance(p, hit));
        }
        expect(d).toBeGreaterThan(MIN_GAP * 0.8);
      }
    });

    it('an edit moved to another body and back lands where it was', () => {
      const engine = new CharacterEngine(assets, randomizeCharacter(defaultCharacter(), assets.sliders, { seed: 77, amount: 0.6 }));
      const other = new BodySurface(engine.positions, ref.normals, ref.triangles);
      const m = fresh();
      const there = moveToBody(m, body, other);
      const back = moveToBody(there, other, body);
      let worst = 0;
      for (let i = 0; i < m.positions.length; i++) worst = Math.max(worst, Math.abs(back.positions[i]! - m.positions[i]!));
      expect(worst).toBeLessThan(0.006);
    });
  });

  it('Mara\'s vest and Cole\'s jacket are library garments; the jacket has its shearling fur trim', () => {
    const vest = assets.catalog.proxies.find((p) => p.id === 'ps2cc:clothes/mara_utility_vest');
    const jacket = assets.catalog.proxies.find((p) => p.id === 'ps2cc:clothes/cole_leather_jacket');
    expect(vest?.slot).toBe('outer');
    expect(jacket?.slot).toBe('outer');
    expect(jacket?.defaults?.fur?.enabled).toBe(true);
    expect(jacket?.defaults?.fur?.edges).toEqual(expect.arrayContaining(['collar', 'cuffs']));
    const zones = (id: string) => assets.catalog.proxies.find((p) => p.id === id)!.defaults!.look!.zones.map((z) => z.material);
    expect(zones('ps2cc:clothes/cole_leather_jacket')).toEqual(expect.arrayContaining(['ps2cc:materials/leather_worn', 'ps2cc:materials/shearling']));
    expect(zones('ps2cc:clothes/mara_utility_vest')).toContain('ps2cc:materials/canvas');
    for (const id of OUTFITS) {
      const e = assets.catalog.proxies.find((p) => p.id === id)!;
      expect(e, id).toBeDefined();
      expect(e.triangles).toBeLessThanOrEqual(2500);
      expect(e.tags).toContain('garment-studio');
      // Every zone's pieces exist on the garment.
      for (const z of e.defaults!.look!.zones) if (z.islands !== 'rest') expect(z.islands.length, `${id} ${z.name}`).toBeGreaterThan(0);
    }
  });

  it(`garments edited in Garment Studio fit ${BODIES} random bodies with no vertex more than 2 mm inside`, async () => {
    const engine = new CharacterEngine(assets);
    const scene = new CharacterScene(engine);
    const worst = new Map<string, number>();
    const failures: string[] = [];
    let sampled = 0;
    let nearSkin = 0;
    let deepestRaw = 0;
    const outfit = (i: number): string[] => (i % 2 === 0 ? [OUTFITS[0]!, OUTFITS[1]!, OUTFITS[4]!, OUTFITS[3]!] : [OUTFITS[0]!, OUTFITS[2]!, OUTFITS[4]!]);
    for (let i = 0; i < BODIES; i++) {
      const doc = randomizeCharacter(defaultCharacter(), assets.sliders, { seed: SEED + i, amount: 1 });
      doc.bodyMesh = BODY_MESHES[i % BODY_MESHES.length]!;
      doc.garments = outfit(i).map((id) => ({ slot: assets.proxyInfo(id).slot as GarmentSlotName, asset: id, tint: { ...NEUTRAL_TINT }, dirt: 0, hideBody: true }));
      engine.replaceDoc(doc, 'property');
      await scene.sync();
      scene.update();
      const part = scene.parts.find((p) => p.kind === 'body')!;
      const surface = new BodySurface(part.positions, part.normals, part.indices);
      const p = [0, 0, 0];
      for (const g of scene.parts) {
        if (g.kind !== 'garment') continue;
        let depth = 0;
        for (let v = 0; v < g.positions.length / 3; v++) {
          p[0] = g.positions[v * 3]!;
          p[1] = g.positions[v * 3 + 1]!;
          p[2] = g.positions[v * 3 + 2]!;
          sampled++;
          const hit = surface.closest(p, 0.03);
          if (!hit) continue;
          nearSkin++;
          depth = Math.max(depth, -surface.signedDistance(p, hit));
        }
        worst.set(g.assetId, Math.max(worst.get(g.assetId) ?? 0, depth));
        // The check has teeth: the same garment fitted without the collider.
        const raw = (await assets.proxy(g.assetId)).fit(engine.positions);
        for (let v = 0; v < raw.length / 3; v++) {
          p[0] = raw[v * 3]!;
          p[1] = raw[v * 3 + 1]!;
          p[2] = raw[v * 3 + 2]!;
          const hit = surface.closest(p, 0.03);
          if (hit) deepestRaw = Math.max(deepestRaw, -surface.signedDistance(p, hit));
        }
        if (depth > LIMIT) failures.push(`${g.assetId} on body ${i} (${doc.bodyMesh}): ${(depth * 1000).toFixed(2)} mm`);
      }
    }
    report.pokeThrough = { bodies: BODIES, seed: SEED, limitMm: LIMIT * 1000, sampledVertices: sampled, within3cmOfSkin: nearSkin, deepestWithoutColliderMm: +(deepestRaw * 1000).toFixed(2), worstMm: Object.fromEntries([...worst].map(([k, v]) => [k, +(v * 1000).toFixed(2)])), failures };
    console.info(`[M15 poke-through] ${JSON.stringify((report.pokeThrough as { worstMm: unknown }).worstMm)}`);
    expect(nearSkin).toBeGreaterThan(sampled * 0.3);
    expect(deepestRaw).toBeGreaterThan(LIMIT);
    expect(failures).toEqual([]);
  }, 1_200_000);

  it('writes the report', () => {
    mkdirSync(REPORT, { recursive: true });
    writeFileSync(join(REPORT, 'wardrobe_report.json'), JSON.stringify(report, null, 1) + '\n');
  });
});
