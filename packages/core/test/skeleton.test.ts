/** PRD M2: skeleton fitting and skin weights. */
import { beforeAll, describe, expect, it } from 'vitest';
import type { CoreAssets } from '../src/assets';
import { defaultCharacter } from '../src/character/doc';
import { CharacterEngine } from '../src/character/engine';
import { eulerXYZ, invertRigid, mul4, transformPoint, type Mat4 } from '../src/math/mat4';
import { fitSkeleton, poseWorldMatrices, skinningMatrices, vecRollToMat3 } from '../src/skeleton/rig';
import { buildInfluences, MAX_INFLUENCES } from '../src/skeleton/weights';
import { assetsAvailable, loadAssets } from './helpers';

const suite = assetsAvailable ? describe : describe.skip;

describe('vecRollToMat3 (port of Blender)', () => {
  it('maps +Y to the bone direction and is orthonormal', () => {
    for (const dir of [[0, 1, 0], [1, 0, 0], [0, 0, 1], [0.3, -0.9, 0.2], [0, -1, 0]] as [number, number, number][]) {
      const l = Math.hypot(...dir);
      const n = dir.map((x) => x / l) as [number, number, number];
      const m = vecRollToMat3(n, 0.37);
      // Column 1 (Y axis) = direction.
      expect(m[3]).toBeCloseTo(n[0], 9);
      expect(m[4]).toBeCloseTo(n[1], 9);
      expect(m[5]).toBeCloseTo(n[2], 9);
      for (let a = 0; a < 3; a++)
        for (let b = 0; b < 3; b++) {
          let d = 0;
          for (let k = 0; k < 3; k++) d += m[a * 3 + k]! * m[b * 3 + k]!;
          expect(d).toBeCloseTo(a === b ? 1 : 0, 9);
        }
    }
  });
});

suite('GameEngine rig', () => {
  let assets: CoreAssets;
  beforeAll(async () => {
    assets = await loadAssets();
  });

  it('has the 53 Mecanim-compatible bones, parent-first', () => {
    expect(assets.rig.boneCount).toBe(53);
    for (const name of ['pelvis', 'spine_01', 'spine_03', 'neck_01', 'head', 'upperarm_l', 'hand_r', 'thigh_l', 'foot_r']) {
      expect(assets.rig.index.has(name), name).toBe(true);
    }
  });

  it('fits sensibly on extreme bodies', () => {
    const engine = new CharacterEngine(assets);
    const cases = [
      { gender: 1, height: 1, weight: 1, muscle: 0.5, age: 0.5 },
      { gender: 0, height: 0, weight: 0, muscle: 0.3, age: 0.5 },
      { gender: 0.5, height: 0.5, weight: 0.5, muscle: 0.5, age: 1 },
      { gender: 1, height: 0.6, weight: 0.5, muscle: 1, age: 0.6 },
    ];
    for (const c of cases) {
      const doc = defaultCharacter();
      Object.assign(doc.macros, c);
      engine.load(doc);
      const sk = engine.skeleton;
      const head = sk.heads.slice(assets.rig.index.get('head')! * 3, assets.rig.index.get('head')! * 3 + 3);
      const pelvis = sk.heads.slice(assets.rig.index.get('pelvis')! * 3, assets.rig.index.get('pelvis')! * 3 + 3);
      expect(head[1]!).toBeGreaterThan(pelvis[1]!);
      const handL = sk.heads[assets.rig.index.get('hand_l')! * 3]!;
      const handR = sk.heads[assets.rig.index.get('hand_r')! * 3]!;
      // MakeHuman's left side is +X.
      expect(handL).toBeGreaterThan(0.2);
      expect(handR).toBeLessThan(-0.2);
      for (const v of sk.restWorld) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('every vertex has 1-4 influences summing to 1 (0.999-1.001)', () => {
    const table = buildInfluences(assets.weights.sparse);
    let unweightedBody = 0;
    for (let v = 0; v < table.vertexCount; v++) {
      let sum = 0;
      for (let k = 0; k < MAX_INFLUENCES; k++) sum += table.weights[v * MAX_INFLUENCES + k]!;
      expect(sum).toBeGreaterThanOrEqual(0.999);
      expect(sum).toBeLessThanOrEqual(1.001);
      if (v < assets.base.bodyVertexCount && assets.weights.sparse[v]!.length === 0) unweightedBody++;
    }
    expect(unweightedBody).toBe(0);
  });

  it('rest pose skinning is the identity; a posed arm moves only the arm', () => {
    const engine = new CharacterEngine(assets);
    const sk = fitSkeleton(assets.rig, engine.positions);
    const rest = skinningMatrices(sk, poseWorldMatrices(sk, []));
    for (let i = 0; i < assets.rig.boneCount; i++) {
      const m = rest.subarray(i * 16, i * 16 + 16);
      for (let k = 0; k < 16; k++) expect(m[k]!).toBeCloseTo(k % 5 === 0 ? 1 : 0, 9);
    }
    const rot = new Array(assets.rig.boneCount).fill(null);
    rot[assets.rig.index.get('upperarm_l')!] = eulerXYZ(0, 0, 0.8);
    const world = poseWorldMatrices(sk, rot);
    const skin = skinningMatrices(sk, world);
    const footIdx = assets.rig.index.get('foot_l')!;
    const handIdx = assets.rig.index.get('hand_l')!;
    const foot = skin.subarray(footIdx * 16, footIdx * 16 + 16) as Mat4;
    const hand = skin.subarray(handIdx * 16, handIdx * 16 + 16) as Mat4;
    const p: [number, number, number] = [0.5, 1.2, 0];
    expect(transformPoint(foot, p)[1]).toBeCloseTo(1.2, 9);
    expect(Math.abs(transformPoint(hand, p)[1] - 1.2)).toBeGreaterThan(0.01);
    // Rigid transforms invert cleanly.
    const w0 = world.subarray(0, 16) as Mat4;
    const ident = mul4(w0, invertRigid(w0));
    for (let k = 0; k < 16; k++) expect(ident[k]!).toBeCloseTo(k % 5 === 0 ? 1 : 0, 9);
  });
});
