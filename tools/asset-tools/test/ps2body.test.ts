/** PRD M3 acceptance checks for the PS2 body meshes. */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { BaseMesh, Ps2BodyMesh } from '@ps2cc/core';
import { NodeAssetSource } from '@ps2cc/core/node';
import { buildRenderMesh, countFlipped } from '../src/ps2body';
import { REGION_ID } from '../src/regions';

const here = dirname(fileURLToPath(import.meta.url));
const ASSETS = resolve(here, '../../../assets/core');
const built = existsSync(join(ASSETS, 'bodymesh', 'ps2_body_12k.json'));
const suite = built ? describe : describe.skip;

const TARGETS = { ps2_body_8k: 8000, ps2_body_10k: 10000, ps2_body_12k: 12000 } as const;

suite('PS2 body meshes', () => {
  let base: BaseMesh;
  const source = new NodeAssetSource(ASSETS);
  beforeAll(async () => {
    base = await BaseMesh.load(source);
  });

  it('quad triangulation flips nothing', () => {
    const rm = buildRenderMesh(base);
    expect(countFlipped(base, Uint32Array.from(rm.sourceVertex), rm.indices)).toBe(0);
  });

  for (const [id, target] of Object.entries(TARGETS)) {
    describe(id, () => {
      let mesh: Ps2BodyMesh;
      beforeAll(async () => {
        mesh = await Ps2BodyMesh.load(source, id);
      });

      it('triangle count within 3% of target', () => {
        expect(Math.abs(mesh.triangleCount - target) / target).toBeLessThanOrEqual(0.03);
      });

      it('every vertex maps to exactly one hm08 body vertex', () => {
        for (const v of mesh.sourceVertex) {
          expect(v).toBeLessThan(base.bodyVertexCount);
        }
        // Render vertices are unique (hm08 vertex, uv) pairs.
        const seen = new Set<string>();
        for (let i = 0; i < mesh.vertexCount; i++) {
          const k = `${mesh.sourceVertex[i]}:${mesh.uvs[i * 2]}:${mesh.uvs[i * 2 + 1]}`;
          expect(seen.has(k)).toBe(false);
          seen.add(k);
        }
      });

      it('indices are valid and no triangle is degenerate', () => {
        for (let t = 0; t < mesh.indices.length; t += 3) {
          const a = mesh.indices[t]!;
          const b = mesh.indices[t + 1]!;
          const c = mesh.indices[t + 2]!;
          expect(Math.max(a, b, c)).toBeLessThan(mesh.vertexCount);
          expect(a !== b && b !== c && a !== c).toBe(true);
        }
      });

      it('face region keeps at least 90% of its vertices', () => {
        expect(mesh.meta.faceRetention).toBeGreaterThanOrEqual(0.9);
        const faceVerts = [...mesh.vertexRegion].filter((r) => r === REGION_ID.face).length;
        expect(faceVerts).toBeGreaterThan(500);
      });

      it('no flipped faces relative to the hm08 surface', () => {
        expect(countFlipped(base, mesh.sourceVertex, mesh.indices)).toBe(0);
      });
    });
  }
});
