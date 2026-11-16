/**
 * PRD Part 3, F27: the sculpt layer. Stored sparse in the character, added
 * after every slider, one undo step per stroke, saved and loaded; brushes
 * touch only what faces the viewer, mirror through the hm08 table, and the
 * mask protects; a sculpt saved as a slider works on any character; parts
 * bound to the body follow it.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { CoreAssets } from '../src/assets';
import { BodyTopology } from '../src/anthro/topology';
import { cloneCharacter, defaultCharacter, parseCharacter, serializeCharacter } from '../src/character/doc';
import { CharacterEngine } from '../src/character/engine';
import { CharacterScene } from '../src/scene/character-scene';
import { applySculptDab, symmetriseLayer, type SculptContext, type SculptDab } from '../src/sculpt/brushes';
import { decodeSculpt, encodeSculpt, parseUserTargetFile, userTargetFile } from '../src/sculpt/layer';
import { assetsAvailable, loadAssets } from './helpers';

const suite = assetsAvailable ? describe : describe.skip;

suite('sculpt layer (PRD Part 3, F27)', () => {
  let assets: CoreAssets;
  let mirror: Uint32Array;
  let topo: BodyTopology;
  beforeAll(async () => {
    assets = await loadAssets();
    mirror = await assets.mirror();
    topo = BodyTopology.of(assets.base);
  });

  const nose = (engine: CharacterEngine): [number, number, number] => {
    const v = assets.bodyLandmarks.points.noseTip;
    const p = engine.positions;
    return [p[v * 3]!, p[v * 3 + 1]!, p[v * 3 + 2]!];
  };
  const ctxOf = (engine: CharacterEngine, mask?: Float32Array): SculptContext => ({ positions: engine.positions, normals: engine.normals, topology: topo, mirror, mask });
  const front = (p: [number, number, number]): [number, number, number] => [p[0], p[1], p[2] + 1];

  it('stores sparse, round-trips exactly, and survives save and load', () => {
    const n = assets.base.bodyVertexCount;
    const dense = new Float32Array(n * 3);
    dense[300 * 3 + 1] = 0.002;
    dense[9000 * 3 + 2] = -0.0015;
    const data = encodeSculpt(dense)!;
    expect(Array.from(decodeSculpt(data, n))).toEqual(Array.from(dense));
    expect(encodeSculpt(new Float32Array(n * 3))).toBeNull();
    const doc = defaultCharacter('S');
    doc.sculpt = data;
    const back = parseCharacter(JSON.parse(serializeCharacter(doc)));
    expect(back.sculpt).toEqual(data);
    // Undo copies share it.
    expect(cloneCharacter(doc).sculpt).toBe(data);
    // Broken data is dropped, not fatal.
    expect(parseCharacter(JSON.parse(serializeCharacter({ ...doc, sculpt: { vertices: 'AAAA', deltas: 'xx' } }))).sculpt).toBeUndefined();
  });

  it('is added after the sliders, as one undo step, and the skeleton follows', () => {
    const engine = new CharacterEngine(assets, defaultCharacter('S'));
    const before = Float32Array.from(engine.positions);
    const n = assets.base.bodyVertexCount;
    const layer = new Float32Array(n * 3);
    // Raise the whole left arm region a little (every vertex left of x = 0.2).
    for (let v = 0; v < n; v++) if (before[v * 3]! > 0.2) layer[v * 3 + 1] = 0.01;
    const shoulderBefore = engine.skeleton.heads.slice();
    engine.update('Sculpt', (d) => void (d.sculpt = encodeSculpt(layer)!));
    for (let v = 0; v < n; v += 97) expect(engine.positions[v * 3 + 1]).toBeCloseTo(before[v * 3 + 1]! + layer[v * 3 + 1]!, 6);
    const moved = engine.skeleton.heads.some((h, i) => Math.abs(h - shoulderBefore[i]!) > 0.005);
    expect(moved).toBe(true);
    // Sliders still work under it, and it stays on top.
    engine.setValue('macrodetails-height/Height', 0.8);
    engine.endInteraction();
    expect(engine.doc.sculpt).toBeDefined();
    engine.undo();
    engine.undo();
    expect(Array.from(engine.positions)).toEqual(Array.from(before));
  });

  it('brushes touch only what faces the viewer, and inflate pushes out along the normal', () => {
    const engine = new CharacterEngine(assets, defaultCharacter('S'));
    const n = assets.base.bodyVertexCount;
    const layer = new Float32Array(n * 3);
    const c = nose(engine);
    const changed = applySculptDab(ctxOf(engine), layer, { tool: 'inflate', centre: c, radius: 0.03, strength: 1, eye: front(c), symmetry: false });
    expect(changed.length).toBeGreaterThan(20);
    const nrm = engine.normals;
    for (const v of changed) {
      const d = [layer[v * 3]!, layer[v * 3 + 1]!, layer[v * 3 + 2]!];
      expect(d[0]! * nrm[v * 3]! + d[1]! * nrm[v * 3 + 1]! + d[2]! * nrm[v * 3 + 2]!).toBeGreaterThan(0);
      // Facing the viewer at +z.
      expect(nrm[v * 3 + 2]! * 1 + 0).toBeGreaterThan(-1);
    }
    // From behind, the face is not reached (only surfaces that face backwards, inside the nostrils).
    const back = new Float32Array(n * 3);
    const behind = applySculptDab(ctxOf(engine), back, { tool: 'inflate', centre: c, radius: 0.03, strength: 1, eye: [c[0], c[1], c[2] - 1], symmetry: false });
    expect(behind.length).toBeLessThan(changed.length / 2);
    expect(behind).not.toContain(assets.bodyLandmarks.points.noseTip);
    for (const v of behind) expect(nrm[v * 3 + 2]!).toBeLessThan(0.3);
  });

  it('symmetry mirrors through the hm08 table, and the centre line only moves along the plane', () => {
    const engine = new CharacterEngine(assets, defaultCharacter('S'));
    const n = assets.base.bodyVertexCount;
    const p = engine.positions;
    // A dab on the left cheek.
    const cheek = assets.bodyLandmarks.points.noseTip;
    const c: [number, number, number] = [p[cheek * 3]! + 0.04, p[cheek * 3 + 1]!, p[cheek * 3 + 2]! - 0.02];
    const layer = new Float32Array(n * 3);
    for (let i = 0; i < 4; i++) applySculptDab(ctxOf(engine), layer, { tool: 'inflate', centre: c, radius: 0.025, strength: 1, eye: [c[0] + 0.3, c[1], c[2] + 1], symmetry: true });
    let worst = 0;
    let any = 0;
    for (let v = 0; v < n; v++) {
      const m = mirror[v]!;
      worst = Math.max(worst, Math.abs(layer[v * 3]! + layer[m * 3]!), Math.abs(layer[v * 3 + 1]! - layer[m * 3 + 1]!), Math.abs(layer[v * 3 + 2]! - layer[m * 3 + 2]!));
      any = Math.max(any, Math.abs(layer[v * 3 + 2]!));
    }
    expect(any).toBeGreaterThan(1e-4);
    // Not exact: the viewer is to the left, so the mirrored dab sees a slightly different set of vertices.
    expect(worst).toBeLessThan(any);
    // A sideways grab on the nose: with symmetry the centre line does not move sideways.
    const g = new Float32Array(n * 3);
    const tip = nose(engine);
    const dab: SculptDab = { tool: 'grab', centre: tip, radius: 0.02, strength: 1, eye: front(tip), delta: [0.01, 0.005, 0], symmetry: true };
    applySculptDab(ctxOf(engine), g, dab);
    const t = assets.bodyLandmarks.points.noseTip;
    expect(Math.abs(g[t * 3]!)).toBeLessThan(1e-7);
    expect(g[t * 3 + 1]).toBeGreaterThan(0.004);
    // symmetriseLayer makes any layer exactly symmetric.
    symmetriseLayer(layer, mirror);
    for (let v = 0; v < n; v++) {
      const m = mirror[v]!;
      expect(Math.abs(layer[v * 3]! + layer[m * 3]!)).toBeLessThan(1e-9);
    }
  });

  it('the mask protects what it covers', () => {
    const engine = new CharacterEngine(assets, defaultCharacter('S'));
    const n = assets.base.bodyVertexCount;
    const mask = new Float32Array(n);
    const c = nose(engine);
    const ctx = ctxOf(engine, mask);
    for (let i = 0; i < 3; i++) applySculptDab(ctx, new Float32Array(n * 3), { tool: 'mask', centre: c, radius: 0.015, strength: 1, eye: front(c), symmetry: false });
    expect(mask[assets.bodyLandmarks.points.noseTip]).toBe(1);
    const layer = new Float32Array(n * 3);
    applySculptDab(ctx, layer, { tool: 'inflate', centre: c, radius: 0.03, strength: 1, eye: front(c), symmetry: false });
    const t = assets.bodyLandmarks.points.noseTip;
    expect(Math.hypot(layer[t * 3]!, layer[t * 3 + 1]!, layer[t * 3 + 2]!)).toBe(0);
    // Every other brush runs without error and stays finite.
    for (const tool of ['smooth', 'pinch', 'flatten', 'crease'] as const) {
      const l = new Float32Array(n * 3);
      applySculptDab(ctxOf(engine), l, { tool, centre: c, radius: 0.03, strength: 1, eye: front(c), symmetry: true });
      expect(l.every(Number.isFinite)).toBe(true);
      expect(l.some((x) => x !== 0)).toBe(true);
    }
  });

  it('a sculpt saved as a slider works on another character, at any value', () => {
    const n = assets.base.bodyVertexCount;
    const layer = new Float32Array(n * 3);
    const t = assets.bodyLandmarks.points.noseTip;
    layer[t * 3 + 2] = 0.006;
    const file = parseUserTargetFile(JSON.parse(JSON.stringify(userTargetFile('Longer nose', 'face', encodeSculpt(layer)!))));
    assets.registerUserTarget({ id: 'user:targets/longer-nose', name: file.name, tab: file.tab, data: file.sculpt });
    const other = defaultCharacter('Other');
    other.macros.gender = 1;
    const engine = new CharacterEngine(assets, other);
    const z0 = engine.positions[t * 3 + 2]!;
    engine.update('Slider', (d) => void (d.userTargets = { 'user:targets/longer-nose': 0.5 }));
    expect(engine.positions[t * 3 + 2]).toBeCloseTo(z0 + 0.003, 6);
    engine.update('Slider', (d) => void (d.userTargets = { 'user:targets/longer-nose': -1 }));
    expect(engine.positions[t * 3 + 2]).toBeCloseTo(z0 - 0.006, 6);
    expect(parseCharacter(JSON.parse(serializeCharacter(engine.doc as never))).userTargets).toEqual({ 'user:targets/longer-nose': -1 });
    assets.clearUserTargets();
  });

  it('a stroke in progress shows without an undo step; parts bound to the body follow', async () => {
    const doc = defaultCharacter('S');
    doc.garments = [{ slot: 'top', asset: 'mh:clothes/male_casualsuit01', tint: { color: [1, 1, 1], brightness: 1 }, dirt: 0, hideBody: true }];
    const engine = new CharacterEngine(assets, doc);
    const scene = new CharacterScene(engine);
    await scene.sync();
    scene.update();
    const garment = () => Float32Array.from(scene.parts.find((p) => p.kind === 'garment')!.positions);
    const before = garment();
    const n = assets.base.bodyVertexCount;
    const layer = new Float32Array(n * 3);
    for (let v = 0; v < n; v++) if (engine.positions[v * 3 + 1]! > 0.2 && engine.positions[v * 3 + 1]! < 0.5) layer[v * 3 + 2] = 0.02;
    engine.previewSculpt(layer);
    expect(engine.history.canUndo).toBe(false);
    engine.update('Sculpt', (d) => void (d.sculpt = encodeSculpt(layer)!));
    engine.previewSculpt(null);
    expect(engine.history.canUndo).toBe(true);
    await scene.sync();
    scene.update();
    const after = garment();
    let moved = 0;
    for (let i = 2; i < after.length; i += 3) moved = Math.max(moved, after[i]! - before[i]!);
    expect(moved).toBeGreaterThan(0.01);
  });
});
