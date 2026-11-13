/**
 * Head texture split on export (PRD F6): the head gets its own material and
 * texture so the face keeps its detail, and the body uses a second texture.
 *
 * Part 1 packed the four head islands at one uniform scale (D-034). Part 2
 * (M14, F19) re-flattens them with the face enlarged to fill the head
 * texture (`headpack.ts`), solved for each PS2 body mesh on its own
 * triangles.
 */
import type { Ps2BodyMesh } from '../mesh/ps2body';
import type { HeadLayout } from './headpack';
import { resizeImage, sharpen, type RgbaImage } from './image';
import type { SkinLayout } from './layout';

/** The body texture: the whole composite downscaled (box filter) with a mild sharpen. */
export function bodyTexture(composite: RgbaImage, size = 1024): RgbaImage {
  return sharpen(resizeImage(composite, size, size));
}

/** The PS2 body split into the head and body materials. */
export interface SplitBody {
  /** Triangle indices (into the PS2 body's render vertices) of each material. */
  headIndices: Uint32Array;
  bodyIndices: Uint32Array;
  /** Per render vertex: UV in its material's texture (head vertices remapped into the head texture). */
  uvs: Float32Array;
  /** Per render vertex: head-texture units per hm08 UV unit on the head material, 0 on the body. */
  headDensity: Float32Array;
}

/**
 * Assign every PS2 body triangle to the head or the body material by the UV
 * island of its corners, and give head corners their head UVs (`head` is
 * this mesh's layout). Throws if a triangle spans two islands (simplification
 * keeps UV seams, D-007).
 */
export function splitBody(mesh: Pick<Ps2BodyMesh, 'sourceVertex' | 'uvs' | 'indices'>, layout: SkinLayout, head: HeadLayout): SplitBody {
  const nv = mesh.sourceVertex.length;
  const vertexIslands: number[][] = [];
  for (let i = 0; i < nv; i++) vertexIslands.push(layout.islandsOfCorner(mesh.sourceVertex[i]!, mesh.uvs[i * 2]!, mesh.uvs[i * 2 + 1]!));
  const islandOfVertex = new Int32Array(nv).fill(-1);
  const headTris: number[] = [];
  const bodyTris: number[] = [];
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const corners = [mesh.indices[t]!, mesh.indices[t + 1]!, mesh.indices[t + 2]!];
    const shared = vertexIslands[corners[0]!]!.filter((i) => corners.every((c) => vertexIslands[c]!.includes(i)));
    if (shared.length === 0) throw new Error(`PS2 body triangle ${t / 3} spans several UV islands`);
    const island = shared[0]!;
    for (const c of corners) {
      if (islandOfVertex[c] !== -1 && islandOfVertex[c] !== island) throw new Error(`render vertex ${c} is used by two UV islands`);
      islandOfVertex[c] = island;
    }
    (layout.islands[island]!.kind === 'head' ? headTris : bodyTris).push(...corners);
  }
  const uvs = new Float32Array(mesh.uvs);
  const headDensity = new Float32Array(nv);
  for (let i = 0; i < nv; i++) {
    const island = islandOfVertex[i]!;
    if (island < 0 || layout.islands[island]!.kind !== 'head') continue;
    if (Number.isNaN(head.uv[i * 2])) throw new Error(`head render vertex ${i} has no head UV: the head layout is for another mesh`);
    uvs[i * 2] = head.uv[i * 2]!;
    uvs[i * 2 + 1] = head.uv[i * 2 + 1]!;
    headDensity[i] = head.density[i]!;
  }
  return { headIndices: Uint32Array.from(headTris), bodyIndices: Uint32Array.from(bodyTris), uvs, headDensity };
}
