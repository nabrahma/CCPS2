/**
 * Garment decimation (PRD F4): a garment is reduced to a PS2 budget with the
 * subset-of-vertices method, so its MHCLO binding stays valid (each kept vertex
 * keeps its 3 reference vertices, weights and offset). It runs once per
 * garment: at build time for the CC0 library, at import time for the user's own.
 */
import { computeTriangleNormals } from '../mesh/normals';
import { simplifyRenderMesh } from '../mesh/simplify';
import { buildRenderTopology, gather3 } from '../scene/render-mesh';
import type { ProxyAsset } from './proxy';

/** Triangle caps per slot, inside the PRD's 500..2,500 range (hair meshes: the 3,500 hair budget). */
export const SLOT_BUDGET: Record<string, number> = {
  hair: 3500,
  full: 2500,
  outer: 2200,
  top: 1800,
  bottom: 1600,
  shoes: 900,
  hat: 700,
  gloves: 700,
  accessory: 500,
};

export interface DecimatedProxy {
  restPositions: Float32Array;
  uvs: number[];
  /** Quads with the last vertex repeated (MakeHuman's triangle form). */
  faceVerts: number[];
  faceUvs: number[];
  refVerts: Uint32Array;
  refWeights: Float32Array;
  refOffsets: Float32Array;
  /** Source vertex of each kept vertex. */
  kept: number[];
  triangles: number;
  originalTriangles: number;
  flipped: number;
}

export async function decimateProxy(proxy: ProxyAsset, slot: string): Promise<DecimatedProxy> {
  const topo = buildRenderTopology(proxy.faceVerts, proxy.faceUvs, proxy.uvs);
  const originalTriangles = topo.indices.length / 3;
  const target = Math.min(originalTriangles, SLOT_BUDGET[slot] ?? SLOT_BUDGET.accessory!);
  const smooth = computeTriangleNormals(proxy.restPositions, topo.sourceIndices, proxy.vertexCount);
  const positions = gather3(proxy.restPositions, topo.sourceVertex, new Float32Array(topo.sourceVertex.length * 3));
  const normals = gather3(smooth, topo.sourceVertex, new Float32Array(topo.sourceVertex.length * 3));
  let indices = topo.indices;
  let flipped = 0;
  if (target < originalTriangles) {
    const base = { positions, uvs: topo.uvs, normals, indices, targetTriangles: target };
    let r = await simplifyRenderMesh(base);
    // Garments made of many small open pieces (laces, bows, frills) cannot reach the budget with
    // locked borders. Retry letting borders collapse; if that is still not enough, first prune only
    // tiny disconnected bits (< 1.5% of the garment size), then simplify what is left.
    const tooMany = () => r.indices.length / 3 > target * 1.03;
    if (tooMany()) r = await simplifyRenderMesh({ ...base, flags: [] });
    if (tooMany()) {
      const pruned = await simplifyRenderMesh({ ...base, flags: ['Prune'], targetError: 0.015 });
      r = await simplifyRenderMesh({ ...base, indices: pruned.indices, flags: [] });
    }
    if (r.indices.length / 3 < Math.min(originalTriangles, 150)) {
      throw new Error(`decimation of ${proxy.id} collapsed to ${r.indices.length / 3} triangles`);
    }
    indices = r.indices;
    flipped = r.flipped;
  }

  // Map render vertices back to proxy vertices and UV entries, keeping only what is used.
  const usedVert = new Map<number, number>();
  const usedUv = new Map<string, number>();
  const uvs: number[] = [];
  const faceVerts: number[] = [];
  const faceUvs: number[] = [];
  const uvOf = (rv: number): number => {
    const key = `${topo.uvs[rv * 2]},${topo.uvs[rv * 2 + 1]}`;
    let id = usedUv.get(key);
    if (id === undefined) {
      id = uvs.length / 2;
      usedUv.set(key, id);
      uvs.push(topo.uvs[rv * 2]!, topo.uvs[rv * 2 + 1]!);
    }
    return id;
  };
  const vertOf = (rv: number): number => {
    const src = topo.sourceVertex[rv]!;
    let id = usedVert.get(src);
    if (id === undefined) {
      id = usedVert.size;
      usedVert.set(src, id);
    }
    return id;
  };
  for (let t = 0; t < indices.length; t += 3) {
    const tri = [indices[t]!, indices[t + 1]!, indices[t + 2]!];
    // MakeHuman stores triangles as quads with the last vertex repeated.
    const v = tri.map(vertOf);
    const u = tri.map(uvOf);
    faceVerts.push(v[0]!, v[1]!, v[2]!, v[2]!);
    faceUvs.push(u[0]!, u[1]!, u[2]!, u[2]!);
  }
  const kept = [...usedVert.keys()];
  const sel3 = (arr: ArrayLike<number>) => {
    const out = new Float32Array(kept.length * 3);
    kept.forEach((src, i) => {
      out[i * 3] = arr[src * 3]!;
      out[i * 3 + 1] = arr[src * 3 + 1]!;
      out[i * 3 + 2] = arr[src * 3 + 2]!;
    });
    return out;
  };
  const refVerts = new Uint32Array(kept.length * 3);
  kept.forEach((src, i) => refVerts.set(proxy.refVerts.subarray(src * 3, src * 3 + 3), i * 3));
  return {
    restPositions: sel3(proxy.restPositions),
    uvs,
    faceVerts,
    faceUvs,
    refVerts,
    refWeights: sel3(proxy.refWeights),
    refOffsets: sel3(proxy.refOffsets),
    kept,
    triangles: faceVerts.length / 4,
    originalTriangles,
    flipped,
  };
}
