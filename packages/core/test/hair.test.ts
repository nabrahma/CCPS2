/**
 * PRD M5 acceptance for generated card hair:
 *  - every starter style regenerates deterministically from its seed (hash test);
 *  - no card vertex inside the head/shoulder proxy across 200 random heads;
 *  - the style follows head sliders: head size +20%, cards stay attached (gap change < 3 mm);
 *  - the triangle count is within each style's budget.
 * Plus unit tests for atlas detection, templates and the .ps2hair format.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CoreAssets } from '../src/assets';
import { defaultCharacter, type CharacterDoc } from '../src/character/doc';
import { CharacterEngine } from '../src/character/engine';
import { randomizeCharacter } from '../src/character/randomize';
import {
  atlasTemplate,
  detectRegions,
  hairStyleFile,
  HairGenerator,
  hashHair,
  parseHairStyleFile,
  regionsFor,
  sanitiseStyle,
  STARTER_STYLES,
  starterStyle,
  validateAtlas,
} from '../src/hair';
import { BodySurface } from '../src/proxy/collision';
import { assetsAvailable, loadAssets } from './helpers';

const HASHES = join(__dirname, 'fixtures', 'hair_hashes.json');
const ATLAS = atlasTemplate('strips8');

/** Synthetic RGBA image: opaque where `on(x, y)`. */
function image(w: number, h: number, on: (x: number, y: number) => boolean): Uint8Array {
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rgba[(y * w + x) * 4 + 3] = on(x, y) ? 255 : 0;
  return rgba;
}

describe('hair atlas', () => {
  it('detects vertical strips', () => {
    const w = 256;
    const h = 256;
    // 4 strips 40 px wide with 24 px gaps, from y = 8 to 248.
    const rgba = image(w, h, (x, y) => y >= 8 && y < 248 && x % 64 >= 12 && x % 64 < 52);
    const regions = detectRegions(rgba, w, h);
    expect(regions).toHaveLength(4);
    for (const [i, r] of regions.entries()) {
      expect(r.x * w).toBeCloseTo(i * 64 + 12, 0);
      expect(r.w * w).toBeCloseTo(40, 0);
      expect(r.y * h).toBeCloseTo(8, 0);
      expect(r.h * h).toBeCloseTo(240, 0);
    }
    expect(new Set(regions.map((r) => r.tag)).size).toBeGreaterThan(1);
  });

  it('falls back to a grid when the cells are not strips', () => {
    const w = 256;
    const h = 256;
    // 4 x 2 cells of 48 x 96 px.
    const rgba = image(w, h, (x, y) => x % 64 >= 8 && x % 64 < 56 && y % 128 >= 16 && y % 128 < 112);
    const regions = detectRegions(rgba, w, h);
    expect(regions).toHaveLength(8);
    expect(regions.every((r) => Math.abs(r.h * h - 96) <= 1 && Math.abs(r.w * w - 48) <= 1)).toBe(true);
  });

  it('ships 3 layout templates and finds a region for every tag', () => {
    expect(atlasTemplate('strips4')).toHaveLength(4);
    expect(atlasTemplate('strips8')).toHaveLength(8);
    expect(atlasTemplate('grid4x2')).toHaveLength(8);
    for (const tag of ['clump', 'strand', 'fringe', 'flyaway', 'base'] as const) {
      expect(regionsFor(atlasTemplate('strips4'), tag).length).toBeGreaterThan(0);
    }
    expect(() => validateAtlas({ format: 'ps2cc.atlas/1', texture: 'a.png', regions: [{ x: 0.5, y: 0, w: 0.6, h: 1, tag: 'clump' }] })).toThrow();
    expect(validateAtlas({ format: 'ps2cc.atlas/1', texture: 'a.png', regions: ATLAS }).regions).toHaveLength(8);
  });
});

describe('hair styles', () => {
  it('has the 8 starter styles from the PRD', () => {
    expect(STARTER_STYLES.map((s) => s.id)).toEqual(['buzz', 'crew', 'short-messy', 'side-part', 'bob', 'shoulder-straight', 'long-straight', 'ponytail']);
  });

  it('round-trips .ps2hair and clamps bad values', () => {
    const s = starterStyle('bob');
    expect(parseHairStyleFile(JSON.parse(JSON.stringify(hairStyleFile(s))))).toEqual(s);
    const bad = sanitiseStyle({ guides: -5, cards: { segments: 999 }, length: { front: 'x' } });
    expect(bad.guides).toBe(0);
    expect(bad.cards.segments).toBe(16);
    expect(Number.isFinite(bad.length.front)).toBe(true);
    expect(() => parseHairStyleFile({ format: 'nope' })).toThrow();
  });
});

const suite = assetsAvailable ? describe : describe.skip;

suite('generated card hair (needs assets)', () => {
  let assets: CoreAssets;
  let gen: HairGenerator;
  beforeAll(async () => {
    assets = await loadAssets();
    gen = new HairGenerator(assets.base, assets.rig, assets.weights.sparse);
  });

  it('every starter style regenerates deterministically from its seed (hash test)', () => {
    const engine = new CharacterEngine(assets);
    const fresh = new HairGenerator(assets.base, assets.rig, assets.weights.sparse);
    const hashes: Record<string, string> = {};
    for (const { id } of STARTER_STYLES) {
      const a = hashHair(gen.generate(starterStyle(id), ATLAS, engine.positions, engine.skeleton));
      const b = hashHair(fresh.generate(starterStyle(id), ATLAS, engine.positions, engine.skeleton));
      expect(a, id).toBe(b);
      // A different seed gives different hair.
      const other = { ...starterStyle(id), seed: starterStyle(id).seed + 1 };
      expect(hashHair(gen.generate(other, ATLAS, engine.positions, engine.skeleton)), id).not.toBe(a);
      hashes[id] = a;
    }
    // Snapshot: the hashes are also stable across runs and machines. Regenerate deliberately with PS2CC_UPDATE_HASHES=1.
    if (!existsSync(HASHES) || process.env.PS2CC_UPDATE_HASHES) writeFileSync(HASHES, JSON.stringify(hashes, null, 2) + '\n');
    expect(hashes).toEqual(JSON.parse(readFileSync(HASHES, 'utf8')));
  });

  it('triangle count is within each style budget, and card topology never depends on the body', () => {
    const engine = new CharacterEngine(assets);
    for (const { id } of STARTER_STYLES) {
      const style = starterStyle(id);
      const a = gen.generate(style, ATLAS, engine.positions, engine.skeleton);
      expect(a.triangleCount, id).toBeGreaterThanOrEqual(style.budget[0]);
      expect(a.triangleCount, id).toBeLessThanOrEqual(style.budget[1]);
      expect(a.triangleCount, id).toBeLessThanOrEqual(3500);
      const other = new CharacterEngine(assets, randomizeCharacter(defaultCharacter(), assets.sliders, { seed: 99, amount: 1 }));
      const b = gen.generate(style, ATLAS, other.positions, other.skeleton);
      expect(b.indices, id).toEqual(a.indices);
    }
  });

  it('no card vertex inside the head/shoulder proxy across 200 random heads', () => {
    let worst = -Infinity;
    for (let i = 0; i < 200; i++) {
      const doc: CharacterDoc = randomizeCharacter(defaultCharacter(), assets.sliders, { seed: 7000 + i, amount: 1 });
      const engine = new CharacterEngine(assets, doc);
      const { id } = STARTER_STYLES[i % STARTER_STYLES.length]!;
      const hair = gen.generate(starterStyle(id), ATLAS, engine.positions, engine.skeleton);
      expect(hair.positions.every(Number.isFinite), `${id} on head ${i}`).toBe(true);
      for (let v = 0; v < hair.positions.length / 3; v++) {
        const d = hair.proxy.depth(hair.positions.subarray(v * 3, v * 3 + 3));
        worst = Math.max(worst, d);
        if (d > 1e-6) throw new Error(`${id} on head ${i}: vertex ${v} is ${(d * 1000).toFixed(2)} mm inside the proxy`);
      }
    }
    console.info(`[hair] closest approach to the proxy over 200 heads: ${(-worst * 1000).toFixed(2)} mm outside`);
  }, 300_000);

  it('follows head sliders: head size +20%, cards stay attached (gap change < 3 mm)', () => {
    const engine = new CharacterEngine(assets);
    const headBone = assets.rig.index.get('head')!;
    // "Attached" means close to the skin: measure against the whole body surface, not just the scalp region.
    const bodyTris: number[] = [];
    for (const f of assets.base.facesWhere((g) => g === 'body')) {
      const q = [0, 1, 2, 3].map((k) => assets.base.faceVerts[f * 4 + k]!);
      bodyTris.push(q[0]!, q[1]!, q[2]!, q[0]!, q[2]!, q[3]!);
    }
    const tris = Uint32Array.from(bodyTris);
    const surface = (P: Float32Array) => new BodySurface(P, engine.normals, tris);
    const size = (P: Float32Array) => Math.hypot(...[0, 1, 2].map((k) => spread(P, gen.scalp.vertices, k)));
    const SCALE = ['head/head-scale-depth-decr|incr', 'head/head-scale-horiz-decr|incr', 'head/head-scale-vert-decr|incr'];
    for (const { id } of STARTER_STYLES) {
      const hair = gen.generate(starterStyle(id), ATLAS, engine.positions, engine.skeleton);
      const rest = Float32Array.from(engine.positions);
      const before = rootGaps(hair.positions, hair.roots, surface(rest));
      const check = (P: Float32Array, label: string, minGrowth: number) => {
        const grown = size(P) / size(rest);
        expect(grown, `${label}: head growth`).toBeGreaterThan(minGrowth);
        const after = rootGaps(hair.binding.fit(P), hair.roots, surface(P));
        let worst = 0;
        for (let i = 0; i < before.length; i++) worst = Math.max(worst, Math.abs(after[i]! - before[i]!));
        expect(worst, `${id}, ${label} (+${((grown - 1) * 100).toFixed(0)}%): worst root gap change in m`).toBeLessThan(0.003);
      };
      // 1. The real sliders, dragged to their maximum (MakeHuman's head-scale targets give +17%).
      for (const m of SCALE) engine.setValue(m, 1, { mergeKey: 'head-size' });
      check(Float32Array.from(engine.positions), 'head-scale sliders at max', 1.15);
      for (const m of SCALE) engine.setValue(m, 0);
      engine.endInteraction();
      // 2. +20% exactly: scale the head about its centre, blended by each vertex's head weight.
      const c = hair.proxy.cranium.centre;
      const scaled = Float32Array.from(rest);
      assets.weights.sparse.forEach((list, v) => {
        const w = list.find(([b]) => b === headBone)?.[1] ?? 0;
        if (w === 0) return;
        const f = 1 + 0.2 * Math.min(1, w / 0.6); // the full 20% wherever the head bone dominates
        for (let k = 0; k < 3; k++) scaled[v * 3 + k] = c[k]! + (rest[v * 3 + k]! - c[k]!) * f;
      });
      check(scaled, 'head scaled by 20%', 1.19);
    }
  });
});

function spread(P: Float32Array, verts: Uint32Array, k: number): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of verts) {
    lo = Math.min(lo, P[v * 3 + k]!);
    hi = Math.max(hi, P[v * 3 + k]!);
  }
  return hi - lo;
}

/** Distance from each card root vertex to the scalp surface. */
function rootGaps(P: Float32Array, roots: Uint32Array, surface: BodySurface): number[] {
  return [...roots].map((r) => surface.bvh.closestPoint(P.subarray(r * 3, r * 3 + 3))!.distance);
}
