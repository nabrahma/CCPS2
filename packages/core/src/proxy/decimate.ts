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

/**
 * Triangle caps per slot, inside the PRD's 500..2,500 range (hair meshes: the
 * 3,500 hair budget; teeth and tongue: Part 2 F19's 600 together).
 */
export const SLOT_BUDGET: Record<string, number> = {
  teeth: 420,
  tongue: 160,
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

/**
 * Teeth (Part 2 F19): the gums plus 32 small separate teeth. One global
 * simplification spends the budget by absolute error, so it keeps the large
 * gums and crushes every tooth into a spike. Instead each piece gets its own
 * budget: the gums a share, the 16 front-most teeth (the ones an open mouth
 * shows) twice what the molars get. Borders must collapse (Permissive) to get
 * that low; a few slivers may face inwards, and teeth are drawn double-sided.
 */
async function simplifyTeeth(
  base: { positions: Float32Array; uvs: Float32Array; normals: Float32Array; indices: Uint32Array; targetTriangles: number },
  sourceVertex: ArrayLike<number>,
): Promise<{ indices: Uint32Array; flipped: number }> {
  const { positions, indices, targetTriangles } = base;
  const n = sourceVertex.length;
  const parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) x = parent[x] = parent[parent[x]!]!;
    return x;
  };
  const join = (a: number, b: number) => {
    parent[find(a)] = find(b);
  };
  // Pieces: connected through triangles and through UV seams (render vertices of one source vertex).
  const bySource = new Map<number, number>();
  for (let v = 0; v < n; v++) {
    const s = sourceVertex[v]!;
    const first = bySource.get(s);
    if (first === undefined) bySource.set(s, v);
    else join(v, first);
  }
  for (let t = 0; t < indices.length; t += 3) {
    join(indices[t]!, indices[t + 1]!);
    join(indices[t + 2]!, indices[t + 1]!);
  }
  const groups = new Map<number, number[]>();
  for (let t = 0; t < indices.length; t += 3) {
    const root = find(indices[t]!);
    let g = groups.get(root);
    if (!g) groups.set(root, (g = []));
    g.push(indices[t]!, indices[t + 1]!, indices[t + 2]!);
  }
  const pieces = [...groups.values()].map((idx) => {
    let front = -Infinity;
    for (const v of idx) front = Math.max(front, positions[v * 3 + 2]!);
    return { idx, front };
  });
  pieces.sort((a, b) => b.idx.length - a.idx.length);
  const gums = pieces.shift()!;
  pieces.sort((a, b) => b.front - a.front);
  // Budget: front teeth 2 shares, back teeth 1, gums a third of the whole.
  const FRONT = 16;
  const shares = pieces.reduce((sum, _, i) => sum + (i < FRONT ? 2 : 1), 0);
  const gumBudget = Math.round(targetTriangles / 3);
  const share = (targetTriangles - gumBudget) / Math.max(1, shares);
  const out: number[] = [];
  let flipped = 0;
  for (const [i, piece] of [gums, ...pieces].entries()) {
    const target = i === 0 ? gumBudget : Math.max(4, Math.floor(share * (i <= FRONT ? 2 : 1)));
    const r = await simplifyRenderMesh({ ...base, indices: Uint32Array.from(piece.idx), targetTriangles: target, flags: ['Permissive'], uvWeight: 0.5, normalWeight: 0.1, maxFlipPasses: 1 });
    for (const v of r.indices) out.push(v);
    flipped += r.flipped;
  }
  return { indices: Uint32Array.from(out), flipped };
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
    let r = slot === 'teeth' ? await simplifyTeeth(base, topo.sourceVertex) : await simplifyRenderMesh(base);
    // Garments made of many small open pieces (laces, bows, frills) cannot reach the budget with
    // locked borders. Retry letting borders collapse; if that is still not enough, first prune only
    // tiny disconnected bits (< 1.5% of the garment size), then simplify what is left.
    const tooMany = () => slot !== 'teeth' && r.indices.length / 3 > target * 1.03;
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
