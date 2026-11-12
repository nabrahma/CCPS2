/**
 * PRD 6.1/6.2 export rules on the engine side (the FBX itself is tested in Go
 * with ufbx, app/backend/fbx): at most 5 meshes (draw calls), at most 4
 * normalised influences, metres with the feet on the origin, facing +Z, hidden
 * body faces removed, no unused vertices, head UVs inside 0..1, triangle count
 * equal to the budget meter, T-pose arms horizontal, and the message layout.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { CoreAssets } from '../src/assets';
import type { CharacterDoc } from '../src/character/doc';
import { legacyCharacter as defaultCharacter } from './legacy';
import { CharacterEngine } from '../src/character/engine';
import { buildExportScene, encodeExportMessage, exportName, EXPORT_MAGIC, type ExportScene } from '../src/export';
import { CharacterScene } from '../src/scene/character-scene';
import { createImage } from '../src/skin/image';
import { starterStyle } from '../src/hair';
import { assetsAvailable, loadAssets } from './helpers';

const skin = createImage(2048, 2048, [200, 160, 140, 255]);
const loadImage = async () => createImage(64, 64, [180, 180, 180, 200]);

async function exportOf(assets: CoreAssets, doc: CharacterDoc, tPose = false): Promise<{ scene: CharacterScene; ex: ExportScene }> {
  const engine = new CharacterEngine(assets, doc);
  const scene = new CharacterScene(engine);
  await scene.sync();
  const ex = await buildExportScene(scene, { loadImage, skin, tPose, appVersion: 'test' });
  return { scene, ex };
}

function dressed(): CharacterDoc {
  const doc = defaultCharacter('Test Guy');
  doc.garments = [
    { slot: 'top', asset: 'mh:clothes/namuhekam_male_polo_shirt', tint: { color: [0.8, 0.2, 0.2], brightness: 1 }, dirt: 0.4, hideBody: true },
    { slot: 'bottom', asset: 'mh:clothes/cortu_cargo_pants', tint: { color: [1, 1, 1], brightness: 1 }, dirt: 0, hideBody: true },
  ];
  doc.hair = { mode: 'cards', style: starterStyle('short-messy'), atlas: null, tint: { color: [1, 1, 1], brightness: 1 }, alphaThreshold: 0.5 };
  return doc;
}

describe.skipIf(!assetsAvailable)('export scene', () => {
  let assets: CoreAssets;
  beforeAll(async () => {
    assets = await loadAssets();
  });

  it('follows the mesh, skeleton and material rules', async () => {
    const { scene, ex } = await exportOf(assets, dressed());
    expect(ex.name).toBe('Test Guy');
    expect(ex.meshes.map((m) => m.role)).toEqual(['head', 'body', 'hair', 'garments', 'eyes']);
    expect(ex.meshes.length).toBeLessThanOrEqual(5);
    expect(ex.materials).toHaveLength(ex.meshes.length);
    expect(ex.bones).toHaveLength(53);
    expect(ex.bones.some((b) => /breast/i.test(b.name))).toBe(false);
    let minY = Infinity;
    let maxY = -Infinity;
    for (const m of ex.meshes) {
      const n = m.positions.length / 3;
      // Every vertex is used.
      const used = new Uint8Array(n);
      for (const i of m.indices) used[i] = 1;
      expect(used.every((u) => u === 1), m.name).toBe(true);
      // Influences: at most 4, normalised, valid bones.
      for (let v = 0; v < n; v++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) {
          sum += m.weights[v * 4 + k]!;
          expect(m.joints[v * 4 + k]!).toBeLessThan(53);
        }
        expect(Math.abs(sum - 1)).toBeLessThan(1e-5);
      }
      if (m.role === 'body') for (let i = 1; i < m.positions.length; i += 3) minY = Math.min(minY, m.positions[i]!);
      for (let i = 1; i < m.positions.length; i += 3) maxY = Math.max(maxY, m.positions[i]!);
      for (const x of m.uvs) {
        expect(x).toBeGreaterThanOrEqual(-1e-6);
        expect(x).toBeLessThanOrEqual(1 + 1e-6);
      }
    }
    // Metres, feet on the origin, a plausible height.
    expect(Math.abs(minY)).toBeLessThan(1e-6);
    expect(maxY).toBeGreaterThan(1.5);
    expect(maxY).toBeLessThan(2.0);
    // Facing +Z: the head's front (nose) is in front of the head bone.
    const head = ex.bones.find((b) => b.name === 'head')!;
    const headMesh = ex.meshes.find((m) => m.role === 'head')!;
    let maxZ = -Infinity;
    for (let i = 2; i < headMesh.positions.length; i += 3) maxZ = Math.max(maxZ, headMesh.positions[i]!);
    expect(maxZ).toBeGreaterThan(head.bindGlobal[14]! + 0.05);
    // Feet bones lift with the mesh.
    const foot = ex.bones.find((b) => b.name === 'foot_l')!;
    expect(foot.bindGlobal[13]).toBeGreaterThan(0);
    expect(foot.bindGlobal[13]).toBeLessThan(0.2);
    // The triangle count is the budget meter's (hidden faces are already gone).
    const total = ex.meshes.reduce((s, m) => s + m.indices.length / 3, 0);
    expect(total).toBe(scene.budget().total);
    expect(ex.sidecar.budget).toMatchObject({ triangles: total, target: 12000, hardMax: 15000 });
    // Textures: one per material, head at the head size.
    expect(ex.textures.map((t) => t.file)).toEqual(ex.materials.map((m) => m.texture));
    expect(ex.textures[0]!.image.width).toBe(1024);
  });

  it('removes body faces under garments', async () => {
    const bare = await exportOf(assets, defaultCharacter('Bare'));
    const { ex } = await exportOf(assets, dressed());
    const tris = (e: ExportScene, role: string) => e.meshes.find((m) => m.role === role)!.indices.length / 3;
    expect(tris(ex, 'body')).toBeLessThan(tris(bare.ex, 'body') - 300);
    expect(bare.ex.meshes.map((m) => m.role)).toEqual(['head', 'body', 'eyes']);
  });

  it('T-pose: upper arms horizontal, hands raised to shoulder height', async () => {
    const a = await exportOf(assets, defaultCharacter('Pose'));
    const t = await exportOf(assets, defaultCharacter('Pose'), true);
    const pos = (e: ExportScene, name: string) => e.bones.find((b) => b.name === name)!.bindGlobal;
    for (const side of ['l', 'r']) {
      const s = pos(t.ex, `upperarm_${side}`);
      const e = pos(t.ex, `lowerarm_${side}`);
      const d = [e[12]! - s[12]!, e[13]! - s[13]!, e[14]! - s[14]!];
      expect(Math.abs(d[1]!) / Math.hypot(...d)).toBeLessThan(0.02);
      // The A-pose hand is well below the shoulder; the T-pose hand is level with it.
      expect(pos(a.ex, `hand_${side}`)[13]!).toBeLessThan(pos(a.ex, `upperarm_${side}`)[13]! - 0.2);
      expect(Math.abs(pos(t.ex, `hand_${side}`)[13]! - s[13]!)).toBeLessThan(0.08);
    }
    // The body mesh followed: its highest hand-height vertex rose.
    const maxX = (e: ExportScene) => Math.max(...e.meshes.find((m) => m.role === 'body')!.positions.filter((_, i) => i % 3 === 0));
    expect(maxX(t.ex)).toBeGreaterThan(maxX(a.ex) + 0.1);
  });

  it('encodes the binary message the Go backend reads', async () => {
    const { ex } = await exportOf(assets, defaultCharacter('Msg'));
    const pngs = ex.textures.map(() => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const msg = encodeExportMessage(ex, pngs, '2026-11-08 12:00:00:000');
    expect(new TextDecoder().decode(msg.subarray(0, 8))).toBe(EXPORT_MAGIC);
    const len = new DataView(msg.buffer).getUint32(8, true);
    const header = JSON.parse(new TextDecoder().decode(msg.subarray(12, 12 + len))) as Record<string, unknown>;
    expect(Object.keys(header).sort()).toEqual(['bones', 'creationTime', 'format', 'materials', 'meshes', 'name', 'sidecar', 'textures']);
    const mesh = (header.meshes as { positions: { offset: number; length: number } }[])[0]!;
    expect(mesh.positions.offset % 8).toBe(0);
    const start = Math.ceil((12 + len) / 8) * 8;
    const first = new Float32Array(msg.slice(start + mesh.positions.offset, start + mesh.positions.offset + 12).buffer);
    expect(Array.from(first)).toEqual(Array.from(ex.meshes[0]!.positions.subarray(0, 3)));
  });

  it('makes names safe for files, FBX and Unity', () => {
    expect(exportName('Bob / "the" <Ghost>')).toBe('Bob _ _the_ _Ghost_');
    expect(exportName('   ')).toBe('Character');
  });
});
