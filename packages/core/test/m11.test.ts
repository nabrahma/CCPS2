/**
 * PRD Part 2 M11 (look foundation), core side: quality profiles (F13), looks
 * and LUTs (F14), and the bake engine's CPU reference (F16).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { CoreAssets } from '../src/assets';
import {
  BAKE_LIGHT,
  bakeInputs,
  cosineDirection,
  DEFAULT_BAKE,
  firstHit,
  lightOcclusion,
  packBvh,
  referenceTexel,
  samplePoint,
  transmittance,
  vertexCavity,
} from '../src/bake/bake';
import { CHARACTER_SCHEMA, defaultCharacter, parseCharacter, serializeCharacter } from '../src/character/doc';
import { CharacterEngine } from '../src/character/engine';
import { starterStyle } from '../src/hair';
import { LOOK_IDS, LOOKS, LookError, parseLook, serializeLook } from '../src/look/look';
import { applyLut, gradeColour, gradeLut, IDENTITY_GRADE, parseCube, SHIPPED_GRADES, writeCube } from '../src/look/lut';
import {
  LEGACY_EXPORT,
  profileOverrides,
  profileSettings,
  QUALITY_PROFILE_IDS,
  QUALITY_PROFILES,
  sanitiseExport,
  scaledHairBudget,
} from '../src/quality/profiles';
import { CharacterScene } from '../src/scene/character-scene';
import { loadAssets } from './helpers';

describe('quality profiles (F13)', () => {
  it('new characters start Enhanced; each profile sets every budget', () => {
    const doc = defaultCharacter('P');
    expect(doc.export).toMatchObject(profileSettings('enhanced'));
    expect(doc.bodyMesh).toBe('ps2_body_12k');
    for (const id of QUALITY_PROFILE_IDS) {
      const p = QUALITY_PROFILES[id];
      expect(p.triangleBudget).toBeLessThan(p.hardMax);
      expect(p.hairBudget).toBeLessThan(p.triangleBudget);
      expect(defaultCharacter('x', id).export.profile).toBe(id);
    }
    expect(QUALITY_PROFILES.classic).toMatchObject({ triangleBudget: 12000, hairBudget: 3500, headTexture: 512, lighting: 'vertex' });
    expect(QUALITY_PROFILES.enhanced).toMatchObject({ triangleBudget: 20000, hairBudget: 6000, headTexture: 1024, garmentAtlas: 2048, lighting: 'pixel' });
    expect(QUALITY_PROFILES.hero).toMatchObject({ triangleBudget: 30000, hairBudget: 9000, headTexture: 2048, shadows: 'self' });
  });

  it('a document from before profiles keeps the settings it was made with', () => {
    const old = { schema: CHARACTER_SCHEMA, name: 'Old', export: { triangleBudget: 10000, hardMax: 15000, headTexture: 512, bodyTexture: 1024, writeGlb: false, tPose: false } };
    const doc = parseCharacter(old);
    expect(doc.export).toMatchObject({ ...LEGACY_EXPORT, triangleBudget: 10000, headTexture: 512 });
    expect(doc.export.bakeAO).toBe(false);
    // And it round-trips byte for byte.
    const text = serializeCharacter(doc);
    expect(serializeCharacter(parseCharacter(JSON.parse(text)))).toBe(text);
  });

  it('reports overrides and clamps nonsense', () => {
    const ex = { ...defaultCharacter().export };
    expect(profileOverrides(ex)).toEqual([]);
    ex.headTexture = 512;
    ex.shadows = 'self';
    expect(profileOverrides(ex).sort()).toEqual(['headTexture', 'shadows']);
    const bad = sanitiseExport({ profile: 'ultra' as never, headTexture: 333 as never, triangleBudget: 99999, hardMax: 20000, lighting: 'raytraced' as never }, ex);
    expect(bad).toMatchObject({ profile: 'classic', headTexture: 1024, triangleBudget: 20000, lighting: 'vertex' });
  });

  it('scales a style budget to the profile hair budget', () => {
    expect(scaledHairBudget([1500, 3500], 3500)).toEqual([1500, 3500]);
    expect(scaledHairBudget([1500, 3500], 7000)).toEqual([3000, 7000]);
  });
});

describe('looks and LUTs (F14)', () => {
  it('every shipped look round-trips through .ps2look', () => {
    for (const id of LOOK_IDS) {
      const text = serializeLook(LOOKS[id]);
      expect(parseLook(JSON.parse(text))).toEqual(LOOKS[id]);
      expect(serializeLook(parseLook(JSON.parse(text)))).toBe(text);
    }
    expect(() => parseLook({ format: 'something/1' })).toThrow(LookError);
    // Missing fields get neutral values, out-of-range numbers are clamped.
    const partial = parseLook({ format: 'ps2cc.look/1', lights: { sky: [0.2, 0.2, 0.2] }, grade: { grain: 7, tonemap: 'filmic' } });
    expect(partial.lights.ground).toEqual([0.2, 0.2, 0.2]);
    expect(partial.grade.grain).toBe(1);
    expect(partial.grade.tonemap).toBe('filmic');
  });

  it('the identity grade is the identity, and .cube files round-trip', () => {
    const lut = gradeLut(IDENTITY_GRADE, 17);
    for (const c of [[0, 0, 0], [1, 1, 1], [0.2, 0.5, 0.9], [0.73, 0.11, 0.4]] as [number, number, number][]) {
      const out = applyLut(lut, c);
      for (let k = 0; k < 3; k++) expect(out[k]).toBeCloseTo(c[k]!, 5);
    }
    const back = parseCube(writeCube(lut));
    expect(back.size).toBe(17);
    for (let i = 0; i < lut.data.length; i++) expect(back.data[i]).toBeCloseTo(lut.data[i]!, 5);
    expect(() => parseCube('LUT_3D_SIZE 2\n0 0 0\n')).toThrow();
  });

  it('the shipped grades do what their looks say', () => {
    const sat = (c: number[]) => Math.max(...c) - Math.min(...c);
    const red: [number, number, number] = [0.8, 0.3, 0.25];
    const foggy = gradeColour(red, SHIPPED_GRADES.foggyTown!.controls);
    expect(sat(foggy)).toBeLessThan(sat(red) * 0.7); // desaturated
    expect(gradeColour([0, 0, 0], SHIPPED_GRADES.foggyTown!.controls)[2]).toBeGreaterThan(0.03); // lifted, cold blacks
    const village = gradeColour([0.5, 0.5, 0.5], SHIPPED_GRADES.villageOvercast!.controls);
    expect(village[1]).toBeGreaterThan(village[2]); // green-brown, not blue
    const interior = gradeColour([0.05, 0.05, 0.05], SHIPPED_GRADES.interiorFlashlight!.controls);
    expect(interior[2]).toBeGreaterThan(interior[0]); // teal shadows
  });
});

describe('bake engine CPU reference (F16)', () => {
  // A floor (two triangles, 2 m square at y = 0) and an optional ceiling.
  const quad = (y: number, flip = false) => {
    const p = [-1, y, -1, 1, y, -1, 1, y, 1, -1, y, 1];
    return { p, i: flip ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3] };
  };
  const occ = (parts: { p: number[]; i: number[]; opacity: number }[]) => {
    const positions: number[] = [];
    const indices: number[] = [];
    const opacity: number[] = [];
    for (const part of parts) {
      const v0 = positions.length / 3;
      positions.push(...part.p);
      indices.push(...part.i.map((x) => x + v0));
      for (let t = 0; t < part.i.length / 3; t++) opacity.push(part.opacity);
    }
    return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices), opacity: Float32Array.from(opacity) };
  };
  const settings = { ...DEFAULT_BAKE, aoDistance: 1 };

  it('open sky is unoccluded; a ceiling occludes; hair cards let light through', () => {
    const floor = quad(0);
    const open = occ([{ ...floor, opacity: 1 }]);
    const o = packBvh(open);
    expect(referenceTexel(o, open.opacity, [0, 0, 0], [0, 1, 0], settings, 64).ao).toBeCloseTo(1, 5);
    // A ceiling 10 cm up covers almost the whole hemisphere within 1 m.
    const shut = occ([{ ...floor, opacity: 1 }, { ...quad(0.1), opacity: 1 }]);
    const s = packBvh(shut);
    expect(referenceTexel(s, shut.opacity, [0, 0, 0], [0, 1, 0], settings, 256).ao).toBeLessThan(0.05);
    // The same ceiling as a 60% card passes 40% of the light.
    const card = occ([{ ...floor, opacity: 1 }, { ...quad(0.1), opacity: 0.6 }]);
    const c = packBvh(card);
    const ao = referenceTexel(c, card.opacity, [0, 0, 0], [0, 1, 0], settings, 256).ao;
    expect(ao).toBeGreaterThan(0.38);
    expect(ao).toBeLessThan(0.46);
    // Off the quad's diagonal (a ray along a shared edge meets both triangles).
    expect(transmittance(c, card.opacity, [0.3, 0.01, -0.2], [0, 1, 0], 1e-4, 1)).toBeCloseTo(0.4, 5);
  });

  it('thickness is the distance to the far side', () => {
    const slab = occ([{ ...quad(0), opacity: 1 }, { ...quad(-0.03, true), opacity: 1 }]);
    const s = packBvh(slab);
    expect(firstHit(s, slab.opacity, [0, -0.001, 0], [0, -1, 0], 1e-4, 0.06)).toBeCloseTo(0.029, 4);
    const t = referenceTexel(s, slab.opacity, [0, 0, 0], [0, 1, 0], settings, 128).thickness;
    // Straight down is 3 cm; cosine-weighted rays average a little more (slant), capped at 6 cm.
    expect(t).toBeGreaterThan(0.5);
    expect(t).toBeLessThan(0.9);
  });

  it('samples cover the hemisphere evenly (cosine-weighted mean height 2/3)', () => {
    let y = 0;
    const n = 1024;
    for (let i = 0; i < n; i++) y += cosineDirection([0, 1, 0], samplePoint(i, n, [0.3, 0.7]))[1];
    expect(y / n).toBeCloseTo(2 / 3, 2);
    expect(lightOcclusion(1, 1, 0.5)).toBeCloseTo(1, 6);
    expect(lightOcclusion(0.5, 0, 1)).toBeCloseTo((BAKE_LIGHT.sky * 0.5) / (BAKE_LIGHT.sky + BAKE_LIGHT.key), 6);
  });

  it('cavity marks creases, not bumps', () => {
    // A V-shaped crease along x: the middle row sits lower than its neighbours.
    const positions = Float32Array.from([-1, 0.1, -1, 0, 0, -1, 1, 0.1, -1, -1, 0.1, 1, 0, 0, 1, 1, 0.1, 1]);
    const normals = Float32Array.from(new Array(6).fill([0, 1, 0]).flat());
    const indices = Uint32Array.from([0, 3, 4, 0, 4, 1, 1, 4, 5, 1, 5, 2]);
    const crease = vertexCavity(positions, normals, indices, 6, 60);
    expect(crease[1]).toBeGreaterThan(0);
    const bump = vertexCavity(positions.map((v, i) => (i % 3 === 1 ? -v : v)), normals, indices, 6, 60);
    expect(bump[1]).toBe(0);
  });
});

describe('with the shipped assets', () => {
  let assets: CoreAssets;
  beforeAll(async () => {
    assets = await loadAssets();
  });

  it('hair follows the profile hair budget', async () => {
    const triangles = async (profile: 'classic' | 'hero') => {
      const doc = defaultCharacter('H', profile);
      doc.hair = { mode: 'cards', style: starterStyle('long-straight'), atlas: null, tint: { color: [1, 1, 1], brightness: 1 }, alphaThreshold: 0.5 };
      const scene = new CharacterScene(new CharacterEngine(assets, doc));
      await scene.sync();
      return scene.budget().hair;
    };
    const classic = await triangles('classic');
    const hero = await triangles('hero');
    expect(classic).toBeLessThanOrEqual(3500);
    expect(hero).toBeLessThanOrEqual(9000);
    expect(hero).toBeGreaterThan(classic * 1.8);
  });

  it('bake inputs: the full-density body and each garment, everything as occluders', async () => {
    const doc = defaultCharacter('B');
    doc.garments = [{ slot: 'top', asset: 'mh:clothes/namuhekam_male_polo_shirt', tint: { color: [1, 1, 1], brightness: 1 }, dirt: 0, hideBody: true }];
    doc.hair = { mode: 'cards', style: starterStyle('short-messy'), atlas: null, tint: { color: [1, 1, 1], brightness: 1 }, alphaThreshold: 0.5 };
    const scene = new CharacterScene(new CharacterEngine(assets, doc));
    await scene.sync();
    const inputs = bakeInputs(scene, { ...DEFAULT_BAKE, size: 256 });
    expect(inputs.targets.map((t) => t.key)).toEqual(['body', scene.parts.find((p) => p.kind === 'garment')!.key]);
    const body = inputs.targets[0]!;
    // Full density: every hm08 body quad, split into two triangles.
    expect(body.indices.length / 3).toBe(26756);
    const hair = scene.parts.find((p) => p.kind === 'hair')!;
    expect([...inputs.occluders.opacity].filter((o) => Math.abs(o - 0.45) < 1e-6).length).toBe(hair.indices.length / 3);
    // The scalp under short hair is darker than the open cheek.
    const packed = packBvh(inputs.occluders);
    let top = 0;
    for (let i = 0; i < body.positions.length / 3; i++) if (body.positions[i * 3 + 1]! > body.positions[top * 3 + 1]!) top = i;
    const topY = body.positions[top * 3 + 1]!;
    let cheek = 0;
    let best = Infinity;
    for (let i = 0; i < body.positions.length / 3; i++) {
      const d = Math.abs(body.positions[i * 3]! - 0.045) + Math.abs(body.positions[i * 3 + 1]! - (topY - 0.15));
      if (body.normals[i * 3 + 2]! > 0.6 && d < best) {
        best = d;
        cheek = i;
      }
    }
    const at = (i: number) => referenceTexel(packed, inputs.occluders.opacity, body.positions.subarray(i * 3, i * 3 + 3), body.normals.subarray(i * 3, i * 3 + 3), DEFAULT_BAKE, 128).ao;
    expect(at(top)).toBeLessThan(0.8);
    expect(at(cheek)).toBeGreaterThan(0.8);
  });
});
