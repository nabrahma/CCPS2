/**
 * PRD M10 acceptance: a garment modelled around the exported body fits 50
 * random bodies without poke-through beyond 2 mm in sampled checks, and skins
 * with the body. Writes the test garments as OBJ to tests/fixtures/garments
 * (used by the Go reader tests, the UI tests and the Unity export) and a report
 * to docs/milestones/M10/.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CoreAssets } from '../src/assets';
import { defaultCharacter, NEUTRAL_TINT, type BodyMeshId, type CharacterDoc } from '../src/character/doc';
import { CharacterEngine } from '../src/character/engine';
import { randomizeCharacter } from '../src/character/randomize';
import { TriangleBVH } from '../src/mesh/bvh';
import { BodySurface } from '../src/proxy/collision';
import { SLOT_BUDGET } from '../src/proxy/decimate';
import { baseBodyObj, GarmentImportError, importGarment, referenceBody, type ImportedGarment, type ImportSlot, type RawGarmentMesh, type ReferenceBody } from '../src/proxy/garment-import';
import { CharacterScene } from '../src/scene/character-scene';
import { buildInfluences, selectInfluences } from '../src/skeleton/weights';
import { skinPositions } from '../src/skeleton/skinning';
import { assetsAvailable, loadAssets, REPO_ROOT } from './helpers';
import { meshToObj, parseBodyObj, testShirt, testSkirt, testTrousers, type FixtureJoints, type ObjBody } from './garment-fixture';

const suite = assetsAvailable ? describe : describe.skip;
const LIMIT = 0.002;
const BODIES = 50;
const SEED = Number(process.env.PS2CC_SEED ?? 9000);
const BODY_MESHES: BodyMeshId[] = ['ps2_body_8k', 'ps2_body_10k', 'ps2_body_12k'];
const REPORT_DIR = join(REPO_ROOT, 'docs', 'milestones', 'M10');
const FIXTURE_DIR = join(REPO_ROOT, 'tests', 'fixtures', 'garments');

type Name = 'shirt' | 'trousers' | 'skirt';
const SLOTS: Record<Name, ImportSlot> = { shirt: 'top', trousers: 'bottom', skirt: 'bottom' };

suite('M10: custom garment import', () => {
  let assets: CoreAssets;
  let body: ReferenceBody;
  let obj: ObjBody;
  const raw = {} as Record<Name, RawGarmentMesh>;
  const imported = {} as Record<Name, ImportedGarment>;

  const wear = (doc: CharacterDoc, names: Name[]) => {
    doc.garments = names.map((n) => ({ slot: SLOTS[n], asset: imported[n].meta.id, tint: { ...NEUTRAL_TINT }, dirt: 0, hideBody: true }));
  };

  beforeAll(async () => {
    assets = await loadAssets();
    body = referenceBody(assets);
    const text = baseBodyObj(assets);
    obj = parseBodyObj(text);
    const skeleton = new CharacterEngine(assets, defaultCharacter()).skeleton;
    const joints: FixtureJoints = {
      head: (bone) => {
        const i = assets.rig.bones.findIndex((b) => b.name === bone);
        return [skeleton.heads[i * 3]!, skeleton.heads[i * 3 + 1]!, skeleton.heads[i * 3 + 2]!];
      },
    };
    raw.shirt = testShirt(obj, joints);
    raw.trousers = testTrousers(obj, joints);
    raw.skirt = testSkirt(obj, joints);
    mkdirSync(FIXTURE_DIR, { recursive: true });
    for (const name of Object.keys(raw) as Name[]) {
      writeFileSync(join(FIXTURE_DIR, `test_${name}.obj`), meshToObj(raw[name], `test_${name}`));
      imported[name] = await importGarment(raw[name], { name: `Test ${name}`, slot: SLOTS[name], body });
      const g = imported[name];
      assets.addUserProxy(
        { id: g.meta.id, category: 'clothes', name: g.meta.name, file: `user/${g.meta.id}`, triangles: g.report.triangles, slot: SLOTS[name], tags: ['user'], licence: 'user' },
        () => Promise.resolve(g.proxy),
      );
    }
  }, 300_000);

  it('exports the base body as an OBJ of the reference body', () => {
    expect(obj.positions.length).toBe(assets.base.bodyVertexCount * 3);
    expect(obj.triangles.length).toBe(body.triangles.length);
    for (let i = 0; i < obj.positions.length; i++) expect(Math.abs(obj.positions[i]! - body.positions[i]!)).toBeLessThan(1e-6);
    let top = -Infinity;
    let bottom = Infinity;
    for (let i = 1; i < obj.positions.length; i += 3) {
      top = Math.max(top, obj.positions[i]!);
      bottom = Math.min(bottom, obj.positions[i]!);
    }
    expect(top - bottom).toBeGreaterThan(1.4);
    expect(top - bottom).toBeLessThan(2.1);
  });

  it('decimates to the slot budget and reproduces the mesh on the reference body', () => {
    for (const name of Object.keys(imported) as Name[]) {
      const { proxy, report, meta } = imported[name];
      expect(report.originalTriangles, name).toBeGreaterThan(SLOT_BUDGET[SLOTS[name]]!);
      expect(report.triangles, name).toBeLessThanOrEqual(SLOT_BUDGET[SLOTS[name]]! * 1.03);
      expect(report.correction, name).toBe('');
      expect(meta.category).toBe('clothes');
      // Scale references give exactly 1 on the reference body.
      for (const s of proxy.scaleFactors(body.positions)) expect(s).toBeCloseTo(1, 6);
      const fitted = proxy.fit(body.positions);
      let worst = 0;
      for (let i = 0; i < fitted.length; i++) worst = Math.max(worst, Math.abs(fitted[i]! - proxy.restPositions[i]!));
      expect(worst, `${name} fit error on the reference body`).toBeLessThan(1e-5);
    }
  });

  it('transfers weights that sum to 1 onto every vertex', () => {
    for (const name of Object.keys(imported) as Name[]) {
      for (const w of imported[name].proxy.transferWeights(assets.weights.sparse)) {
        expect(w.length, name).toBeGreaterThan(0);
        const sum = w.reduce((s, [, x]) => s + x, 0);
        expect(sum, name).toBeGreaterThan(0.99);
        expect(sum, name).toBeLessThan(1.01);
      }
    }
  });

  it('computes hidden body faces under an opaque garment', async () => {
    expect(imported.shirt.report.coveredBodyVertices).toBeGreaterThan(200);
    const engine = new CharacterEngine(assets);
    const scene = new CharacterScene(engine);
    await scene.sync();
    const bare = scene.parts.find((p) => p.kind === 'body')!.indices.length;
    const doc = defaultCharacter();
    wear(doc, ['shirt']);
    engine.replaceDoc(doc, 'test');
    await scene.sync();
    expect(scene.parts.find((p) => p.kind === 'body')!.indices.length).toBeLessThan(bare);
  });

  it('corrects centimetres and Z-up, and refuses a mesh that is not on the body', async () => {
    const scaled = raw.skirt.positions.map((v) => v * 100);
    const cm = await importGarment({ ...raw.skirt, positions: scaled }, { name: 'cm', slot: 'bottom', body });
    expect(cm.report.correction).toContain('centimetres');
    const zUp = new Float32Array(raw.skirt.positions.length);
    for (let i = 0; i < zUp.length; i += 3) {
      zUp[i] = raw.skirt.positions[i]!;
      zUp[i + 1] = -raw.skirt.positions[i + 2]!;
      zUp[i + 2] = raw.skirt.positions[i + 1]!;
    }
    const z = await importGarment({ ...raw.skirt, positions: zUp }, { name: 'z', slot: 'bottom', body });
    expect(z.report.correction).toContain('Z-up');
    const far = raw.skirt.positions.map((v, i) => (i % 3 === 0 ? v + 3 : v));
    await expect(importGarment({ ...raw.skirt, positions: far }, { name: 'far', slot: 'bottom', body })).rejects.toBeInstanceOf(GarmentImportError);
    await expect(importGarment({ ...raw.skirt, faceVerts: new Uint32Array(0), faceUvs: new Uint32Array(0) }, { name: 'empty', slot: 'bottom', body })).rejects.toBeInstanceOf(GarmentImportError);
  });

  it('welds vertices that a file split at UV seams', async () => {
    // Each face gets its own four vertices, as an unindexed GLB would store them.
    const m = raw.skirt;
    const n = m.faceVerts.length;
    const positions = new Float32Array(n * 3);
    const faceVerts = new Uint32Array(n);
    for (let c = 0; c < n; c++) {
      positions.set(m.positions.subarray(m.faceVerts[c]! * 3, m.faceVerts[c]! * 3 + 3), c * 3);
      faceVerts[c] = c;
    }
    const split = await importGarment({ ...m, positions, faceVerts }, { name: 'split', slot: 'bottom', body });
    const whole = imported.skirt;
    expect(Math.abs(split.report.originalTriangles - whole.report.originalTriangles)).toBe(0);
    expect(split.report.vertices).toBeLessThan(whole.report.vertices * 1.15);
  });

  it(`fits ${BODIES} random bodies with no vertex more than 2 mm inside`, async () => {
    const engine = new CharacterEngine(assets);
    const scene = new CharacterScene(engine);
    const worst: Record<Name, { depth: number; body: number }> = { shirt: { depth: 0, body: -1 }, trousers: { depth: 0, body: -1 }, skirt: { depth: 0, body: -1 } };
    // The check must have teeth: vertices near the skin, and what they would do without the collider.
    let nearSkin = 0;
    let closest = Infinity;
    let deepestUnresolved = 0;
    const failures: string[] = [];
    let sampled = 0;
    const nameOf = (assetId: string | undefined) => (Object.keys(imported) as Name[]).find((n) => imported[n].meta.id === assetId)!;
    for (let i = 0; i < BODIES; i++) {
      const doc = randomizeCharacter(defaultCharacter(), assets.sliders, { seed: SEED + i, amount: 1 });
      doc.bodyMesh = BODY_MESHES[i % BODY_MESHES.length]!;
      // The two bottoms overlap, so they take turns.
      wear(doc, i % 2 === 0 ? ['shirt', 'trousers'] : ['shirt', 'skirt']);
      engine.replaceDoc(doc, 'property');
      await scene.sync();
      scene.update();
      const part = scene.parts.find((p) => p.kind === 'body')!;
      const surface = new BodySurface(part.positions, part.normals, part.indices);
      for (const g of scene.parts) {
        if (g.kind !== 'garment') continue;
        expect(g.positions.every(Number.isFinite), g.assetId).toBe(true);
        let depth = 0;
        const P = g.positions;
        const p = [0, 0, 0];
        for (let v = 0; v < P.length / 3; v++) {
          p[0] = P[v * 3]!;
          p[1] = P[v * 3 + 1]!;
          p[2] = P[v * 3 + 2]!;
          const hit = surface.closest(p, 0.03);
          if (hit) {
            const d = surface.signedDistance(p, hit);
            depth = Math.max(depth, -d);
            closest = Math.min(closest, d);
            nearSkin++;
          }
          sampled++;
        }
        const raw_ = imported[nameOf(g.assetId)].proxy.fit(engine.positions);
        for (let v = 0; v < raw_.length / 3; v++) {
          p[0] = raw_[v * 3]!;
          p[1] = raw_[v * 3 + 1]!;
          p[2] = raw_[v * 3 + 2]!;
          const hit = surface.closest(p, 0.03);
          if (hit) deepestUnresolved = Math.max(deepestUnresolved, -surface.signedDistance(p, hit));
        }
        const name = nameOf(g.assetId);
        if (depth > worst[name].depth) worst[name] = { depth, body: i };
        if (depth > LIMIT) failures.push(`${name} on body ${i} (${doc.bodyMesh}): ${(depth * 1000).toFixed(2)} mm`);
      }
    }
    console.info(`[M10 poke-through] ${JSON.stringify(worst)} (${sampled} vertices sampled, ${nearSkin} within 3 cm of skin, closest ${(closest * 1000).toFixed(2)} mm, ${(deepestUnresolved * 1000).toFixed(1)} mm deep without the collider)`);
    expect(nearSkin).toBeGreaterThan(sampled * 0.5);
    expect(deepestUnresolved).toBeGreaterThan(LIMIT);
    mkdirSync(REPORT_DIR, { recursive: true });
    const summary = (Object.keys(imported) as Name[]).map((n) => ({ garment: n, ...imported[n].report, worstDepthMm: worst[n].depth * 1000 }));
    writeFileSync(join(REPORT_DIR, 'garment_import_report.json'), JSON.stringify({ bodies: BODIES, seed: SEED, limitMm: LIMIT * 1000, sampledVertices: sampled, verticesWithin3cmOfSkin: nearSkin, closestToSkinMm: closest * 1000, deepestWithoutColliderMm: deepestUnresolved * 1000, failures, garments: summary }, null, 1) + '\n');
    expect(failures).toEqual([]);
  }, 900_000);

  it('skins with the body: a raised arm and a swung leg keep the cloth on the limb', async () => {
    const engine = new CharacterEngine(assets);
    const scene = new CharacterScene(engine);
    const doc = defaultCharacter();
    wear(doc, ['shirt', 'trousers']);
    engine.replaceDoc(doc, 'skinning');
    await scene.sync();
    scene.update();
    const sk = engine.skeleton;
    const rig = assets.rig;
    const n = rig.bones.length;
    const moved = new Set<number>();
    const skin = new Float64Array(n * 16);
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    for (let b = 0; b < n; b++) skin.set(identity, b * 16);
    const rotate = (bone: string, axis: 0 | 2, angle: number) => {
      const root = rig.bones.findIndex((x) => x.name === bone);
      const h = [sk.heads[root * 3]!, sk.heads[root * 3 + 1]!, sk.heads[root * 3 + 2]!];
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      // Column-major rotation about the bone head.
      const r = axis === 2 ? [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0] : [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0];
      const m = new Float64Array([...r, 0, 0, 0, 0]);
      m[12] = h[0]! - (m[0]! * h[0]! + m[4]! * h[1]! + m[8]! * h[2]!);
      m[13] = h[1]! - (m[1]! * h[0]! + m[5]! * h[1]! + m[9]! * h[2]!);
      m[14] = h[2]! - (m[2]! * h[0]! + m[6]! * h[1]! + m[10]! * h[2]!);
      m[15] = 1;
      for (let b = 0; b < n; b++) {
        let a = b;
        while (a !== -1 && a !== root) a = rig.parents[a]!;
        if (a === root) {
          skin.set(m, b * 16);
          moved.add(b);
        }
      }
    };
    rotate('upperarm_l', 2, 0.7);
    rotate('thigh_r', 0, -0.7);

    const bodyInf = selectInfluences(buildInfluences(assets.weights.sparse), Uint32Array.from({ length: assets.base.vertexCount }, (_, i) => i));
    const posedBody = skinPositions(engine.positions, bodyInf, skin);
    const bvh = new TriangleBVH(posedBody, body.triangles);
    const restBvh = body.bvh;
    let bodyStretch = 0;
    for (let t = 0; t < body.triangles.length; t += 3) {
      for (let k = 0; k < 3; k++) {
        const a = body.triangles[t + k]! * 3;
        const b = body.triangles[t + ((k + 1) % 3)]! * 3;
        const len = (P: Float32Array) => Math.hypot(P[a]! - P[b]!, P[a + 1]! - P[b + 1]!, P[a + 2]! - P[b + 2]!);
        if (len(engine.positions) > 1e-4) bodyStretch = Math.max(bodyStretch, len(posedBody) / len(engine.positions));
      }
    }
    console.info(`[M10 skinning] body: longest edge ${bodyStretch.toFixed(2)}x rest`);
    for (const name of ['shirt', 'trousers', 'skirt'] as Name[]) {
      const g = imported[name];
      const inf = selectInfluences(buildInfluences(g.proxy.transferWeights(assets.weights.sparse)), Uint32Array.from({ length: g.proxy.vertexCount }, (_, i) => i));
      const rest = g.proxy.fit(engine.positions);
      const posed = skinPositions(rest, inf, skin);
      let followed = 0;
      let stretch = 0;
      const tris = g.proxy.triangles();
      for (let t = 0; t < tris.length; t += 3) {
        for (let k = 0; k < 3; k++) {
          const a = tris[t + k]! * 3;
          const b = tris[t + ((k + 1) % 3)]! * 3;
          const len = (P: Float32Array) => Math.hypot(P[a]! - P[b]!, P[a + 1]! - P[b + 1]!, P[a + 2]! - P[b + 2]!);
          if (len(rest) > 1e-4) stretch = Math.max(stretch, len(posed) / len(rest));
        }
      }
      const n3 = g.proxy.vertexCount;
      let drift = 0;
      for (let v = 0; v < n3; v++) {
        const at = (P: Float32Array, B: typeof bvh) => {
          const p = [P[v * 3]!, P[v * 3 + 1]!, P[v * 3 + 2]!];
          const hit = B.closestPoint(p)!;
          return Math.hypot(p[0]! - hit.point[0], p[1]! - hit.point[1], p[2]! - hit.point[2]);
        };
        const d = Math.abs(at(posed, bvh) - at(rest, restBvh));
        if (d < 0.01) followed++;
        drift = Math.max(drift, d);
      }
      console.info(`[M10 skinning] ${name}: longest edge ${stretch.toFixed(2)}x rest, ${((100 * followed) / n3).toFixed(1)}% of vertices within 1 cm of their gap, worst ${(drift * 1000).toFixed(1)} mm`);
      expect(moved.size).toBeGreaterThan(0);
      // Linear blend skinning stretches the crease of a swung leg on the body itself.
      expect(stretch, `${name}: skin tears`).toBeLessThanOrEqual(bodyStretch * 1.05);
      if (name === 'skirt') continue; // loose cloth is meant to leave the leg it was nearest to
      expect(followed / n3, `${name}: cloth leaves the limb`).toBeGreaterThan(0.97);
    }
  }, 120_000);
});
