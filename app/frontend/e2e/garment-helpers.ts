/** Test garments for the app: packages/core/test/garment-import.test.ts writes them as OBJ. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { GarmentFile } from '../src/backend';
import { MILESTONES } from './helpers';

export const GARMENT_FIXTURES = resolve(MILESTONES, '../../tests/fixtures/garments');

const base64 = (a: Float32Array | Uint32Array) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('base64');

/** What the backend's ReadGarment returns for one of the fixtures (they hold only v, vt and quads). */
export function fixtureGarment(name: string, shift = 0): GarmentFile {
  const pos: number[] = [];
  const uvs: number[] = [];
  const verts: number[] = [];
  const corners: number[] = [];
  for (const line of readFileSync(resolve(GARMENT_FIXTURES, `${name}.obj`), 'utf8').split('\n')) {
    const p = line.split(' ');
    if (p[0] === 'v') pos.push(Number(p[1]) + shift, Number(p[2]), Number(p[3]));
    else if (p[0] === 'vt') uvs.push(Number(p[1]), Number(p[2]));
    else if (p[0] === 'f') {
      for (const c of p.slice(1)) {
        const [v, t] = c.split('/');
        verts.push(Number(v) - 1);
        corners.push(Number(t) - 1);
      }
    }
  }
  return { name, positions: base64(Float32Array.from(pos)), uvs: base64(Float32Array.from(uvs)), faceVerts: base64(Uint32Array.from(verts)), faceUvs: base64(Uint32Array.from(corners)), hasUvs: true, triangles: verts.length / 2 };
}
