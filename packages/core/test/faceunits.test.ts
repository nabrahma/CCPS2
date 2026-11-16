/**
 * PRD Part 3, F25 (M20 acceptance): the 52 ARKit face units. Left/right
 * pairs mirror each other within 0.5 mm; the blendshapes are made of them
 * (the 52 under their own names, visemes and the names exported before
 * 0.25.0 as recipes); every shape moves the parts bound to the face.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CoreAssets } from '../src/assets';
import { CLASSIC_EXPRESSIONS, DEFAULT_EXPRESSIONS } from '../src/character/doc';
import { CharacterEngine } from '../src/character/engine';
import { ARKIT_UNITS, mirrorUnit, type ArkitUnit, type FaceUnitStore } from '../src/expression/faceunits';
import { EXPRESSION_MAP, expressionDef, presetWeights, visemeNames } from '../src/expression/map';
import { CharacterScene } from '../src/scene/character-scene';
import { legacyCharacter } from './legacy';
import { REPO_ROOT, assetsAvailable, loadAssets } from './helpers';

const suite = assetsAvailable ? describe : describe.skip;

suite('ARKit face units (PRD Part 3, F25)', () => {
  let assets: CoreAssets;
  let units: FaceUnitStore;
  let mirror: Uint32Array;
  const dense = (u: ArkitUnit) => units.blend([[u, 1]], assets.base.vertexCount);
  beforeAll(async () => {
    assets = await loadAssets();
    units = await assets.faceUnits();
    mirror = await assets.mirror();
  });

  it('has all 52 under their ARKit names, and the mirror table is one-to-one', () => {
    expect(ARKIT_UNITS.length).toBe(52);
    for (const u of ARKIT_UNITS) expect(units.vertices(u).length, u).toBeGreaterThan(0);
    const seen = new Uint8Array(mirror.length);
    for (let v = 0; v < mirror.length; v++) {
      expect(mirror[mirror[v]!]).toBe(v);
      seen[mirror[v]!] = 1;
    }
    expect(seen.every((x) => x === 1)).toBe(true);
    // Mirror partners really are mirror images on the base mesh.
    const p = assets.base.positions;
    let worst = 0;
    for (let v = 0; v < mirror.length; v++) {
      const m = mirror[v]! * 3;
      worst = Math.max(worst, Math.abs(p[v * 3]! + p[m]!), Math.abs(p[v * 3 + 1]! - p[m + 1]!), Math.abs(p[v * 3 + 2]! - p[m + 2]!));
    }
    expect(worst).toBeLessThan(1e-6);
  });

  it('left/right pairs mirror each other, and centre units themselves, within 0.5 mm', () => {
    const report: Record<string, number> = {};
    for (const u of ARKIT_UNITS) {
      const other = mirrorUnit(u);
      if (other < u && other !== u) continue;
      const a = dense(u);
      const b = dense(other);
      let worst = 0;
      for (let v = 0; v < mirror.length; v++) {
        const m = mirror[v]! * 3;
        worst = Math.max(worst, Math.abs(a[v * 3]! + b[m]!), Math.abs(a[v * 3 + 1]! - b[m + 1]!), Math.abs(a[v * 3 + 2]! - b[m + 2]!));
      }
      report[other === u ? u : `${u}/${other}`] = +(worst * 1000).toFixed(4);
    }
    mkdirSync(join(REPO_ROOT, 'docs/milestones/M20'), { recursive: true });
    writeFileSync(join(REPO_ROOT, 'docs/milestones/M20/faceunit_symmetry.json'), `${JSON.stringify({ worstMirrorDifferenceMm: report }, null, 1)}\n`);
    // The sculpts were up to 2.2 mm off; the asset compiler makes them symmetric (D-160).
    for (const [k, mm] of Object.entries(report)) expect(mm, `${k}: mm`).toBeLessThanOrEqual(0.5);
  });

  it('every exported name is a valid recipe: the 52, the visemes and the names exported before 0.25.0', () => {
    for (const u of ARKIT_UNITS) expect(expressionDef(u)!.units).toEqual([[u, 1]]);
    expect(visemeNames()).toEqual(['AA', 'EE', 'IH', 'OH', 'OU', 'FV', 'MBP']);
    for (const n of CLASSIC_EXPRESSIONS) expect(expressionDef(n), n).toBeDefined();
    expect(DEFAULT_EXPRESSIONS).toEqual([...ARKIT_UNITS]);
    for (const p of EXPRESSION_MAP.presets) expect(Object.keys(presetWeights(p.name)!).length).toBeGreaterThan(2);
    expect(EXPRESSION_MAP.presets.map((p) => p.name)).toEqual(['smile', 'surprise', 'fear', 'disgust', 'pain', 'scream']);
  });

  it('shapes reach the parts bound to the face: eyes look, lids carry the lashes, the jaw carries the teeth and tongue', async () => {
    const doc = legacyCharacter('Face units');
    const engine = new CharacterEngine(assets, doc);
    const scene = new CharacterScene(engine);
    await scene.sync();
    scene.update();
    await scene.prepareExpressions();
    const moves = (name: string, part: string) => {
      const s = scene.expressionShapes(name)!.get(part);
      if (!s) return 0;
      let m = 0;
      for (let i = 0; i < s.deltas.length; i += 3) m = Math.max(m, Math.hypot(s.deltas[i]!, s.deltas[i + 1]!, s.deltas[i + 2]!));
      return m;
    };
    expect(moves('eyeLookUpLeft', 'eyes')).toBeGreaterThan(0.001);
    expect(moves('eyeBlinkLeft', 'eyelashes')).toBeGreaterThan(0.003);
    expect(moves('jawOpen', 'teeth')).toBeGreaterThan(0.01);
    expect(moves('tongueOut', 'tongue')).toBeGreaterThan(0.01);
    expect(moves('tongueOut', 'body')).toBe(0);
    // A viseme is its recipe: AA = jawOpen 0.55 + stretch 0.15 + lower lip down 0.2 (both sides).
    const aa = scene.expressionShapes('AA')!.get('body')!.deltas;
    const parts = expressionDef('AA')!.units.map(([u, w]) => [scene.expressionShapes(u)!.get('body')!.deltas, w] as const);
    let worst = 0;
    for (let i = 0; i < aa.length; i++) {
      let sum = 0;
      for (const [d, w] of parts) sum += d[i]! * w;
      worst = Math.max(worst, Math.abs(sum - aa[i]!));
    }
    // Up to what the fold smoothing changes below the eyes on the larger jaw shapes.
    expect(worst).toBeLessThan(0.004);
  });
});
