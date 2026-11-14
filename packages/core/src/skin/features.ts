/**
 * Facial feature anchors on the neutral hm08 mesh, measured from the mesh
 * itself rather than typed-in coordinates:
 *  - eye openings: the seam between the face island and each eye-socket island;
 *  - the lip line: the seam between the face island and the mouth interior;
 *  - nose tip: the front-most head vertex on the midline;
 *  - chin, head top and neck: MakeHuman joint cubes.
 * Procedural layers (dark circles, lips, stubble...) are placed relative to them.
 */
import type { BaseMesh } from '../mesh/basemesh';
import type { SkinLayout } from './layout';

import type { Vec3 } from '../math/mat4';

export type { Vec3 };

export interface Opening {
  centre: Vec3;
  /** Half extents of the opening in x and y (metres). */
  halfWidth: number;
  halfHeight: number;
  /** The rim (the face island's seam with the opening's island), in order round the centre. */
  rim?: Vec3[];
}

export interface FaceFeatures {
  /** Eyes, character's left (+x) first. */
  eyes: [Opening, Opening];
  mouth: Opening;
  noseTip: Vec3;
  chin: Vec3;
  headTop: Vec3;
  neck: Vec3;
  /** Distance between the eye centres (scale for shapes). */
  eyeSpacing: number;
}

export function jointCentre(base: BaseMesh, name: string, positions: ArrayLike<number> = base.positions): Vec3 {
  const verts = base.vertexGroup(name);
  const p: Vec3 = [0, 0, 0];
  for (const v of verts) for (let k = 0; k < 3; k++) p[k] = p[k]! + positions[v * 3 + k]! / verts.length;
  return p;
}

export function faceFeatures(base: BaseMesh, layout: SkinLayout, positions: ArrayLike<number> = base.positions): FaceFeatures {
  const heads = layout.islands.filter((i) => i.kind === 'head').sort((a, b) => b.faces.length - a.faces.length);
  if (heads.length < 4) throw new Error(`expected 4 head UV islands (face, mouth, 2 eyes), found ${heads.length}`);
  const vertsOf = (id: number) => {
    const s = new Set<number>();
    for (const f of layout.islands[id]!.faces) for (let k = 0; k < 4; k++) s.add(base.faceVerts[f * 4 + k]!);
    return s;
  };
  const face = vertsOf(heads[0]!.id);
  const openings = heads.slice(1, 4).map((isl) => {
    const seam = [...vertsOf(isl.id)].filter((v) => face.has(v));
    const lo: Vec3 = [Infinity, Infinity, Infinity];
    const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
    const c: Vec3 = [0, 0, 0];
    for (const v of seam) {
      for (let k = 0; k < 3; k++) {
        const x = positions[v * 3 + k]!;
        lo[k] = Math.min(lo[k]!, x);
        hi[k] = Math.max(hi[k]!, x);
        c[k] = c[k]! + x / seam.length;
      }
    }
    const rim = seam.map((v): Vec3 => [positions[v * 3]!, positions[v * 3 + 1]!, positions[v * 3 + 2]!]);
    rim.sort((a, b) => Math.atan2(a[1] - c[1], a[0] - c[0]) - Math.atan2(b[1] - c[1], b[0] - c[0]));
    return { centre: c, halfWidth: (hi[0] - lo[0]) / 2, halfHeight: (hi[1] - lo[1]) / 2, rim } satisfies Opening;
  });
  const mouth = openings.reduce((a, b) => (Math.abs(a.centre[0]) < Math.abs(b.centre[0]) ? a : b));
  const eyes = openings.filter((o) => o !== mouth).sort((a, b) => b.centre[0] - a.centre[0]) as [Opening, Opening];
  // Nose tip: front-most midline vertex between the eyes and the mouth.
  let noseTip: Vec3 = [0, 0, -Infinity];
  for (const v of face) {
    const x = positions[v * 3]!;
    const y = positions[v * 3 + 1]!;
    const z = positions[v * 3 + 2]!;
    if (Math.abs(x) < 0.004 && y > mouth.centre[1] && y < eyes[0].centre[1] && z > noseTip[2]) noseTip = [x, y, z];
  }
  return {
    eyes,
    mouth,
    noseTip,
    chin: jointCentre(base, 'joint-jaw', positions),
    headTop: jointCentre(base, 'joint-head-2', positions),
    neck: jointCentre(base, 'joint-neck', positions),
    eyeSpacing: eyes[0].centre[0] - eyes[1].centre[0],
  };
}
