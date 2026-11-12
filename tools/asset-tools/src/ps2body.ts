/**
 * Build the PS2 body meshes (PRD F2) from the hm08 body.
 *
 * 1. Render mesh: one vertex per (hm08 vertex, UV) pair so hm08 UV seams stay
 *    sharp; quads split along their shorter rest-pose diagonal.
 * 2. Per-region simplification with meshoptimizer `simplifyWithAttributes` (UVs as
 *    attributes): each region (body, hands, back of head) is reduced in turn to its
 *    share of the budget while everything else is locked. The face, eye/mouth rims,
 *    joint edge loops and mesh borders stay locked; only the 8k tier may thin the
 *    face, and never below 92% of its vertices. Tiers built with `fullHead`
 *    (16k and up, PRD Part 2 F13) lock the whole head, so it keeps every hm08
 *    vertex while the body is reduced. `lockLowerFace` (12k and up) keeps the
 *    lips, chin front and mouth interior, which would otherwise count as body.
 * 3. Flip repair: if any output triangle faces against the hm08 surface, its
 *    corners are locked and the simplification is rerun from scratch.
 * 4. Unused vertices are dropped; each output vertex keeps its hm08 index.
 */
import { computeQuadNormals, type BaseMesh } from '@ps2cc/core';
import { MeshoptSimplifier } from 'meshoptimizer';
import { classifyBody, lowerFaceVertices, REGION_ID } from './regions';

export interface Ps2BodyResult {
  id: string;
  targetTriangles: number;
  sourceVertex: Uint32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  vertexRegion: Uint8Array;
  faceRetention: number;
  stagesUsed: string[];
  error: number;
  flippedTriangles: number;
}

interface RenderMesh {
  sourceVertex: number[];
  uvIndex: number[];
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  region: Uint8Array;
  seam: Uint8Array;
}

/** Build the seam-split triangle mesh of the hm08 body (faces of group "body"). */
export function buildRenderMesh(base: BaseMesh): RenderMesh {
  const region = classifyBody(base);
  const key = new Map<number, number>();
  const sourceVertex: number[] = [];
  const uvIndex: number[] = [];
  const tris: number[] = [];
  const bodyFaces = base.facesWhere((g) => g === 'body');
  const P = base.positions;
  const dist2 = (a: number, b: number) =>
    (P[a * 3]! - P[b * 3]!) ** 2 + (P[a * 3 + 1]! - P[b * 3 + 1]!) ** 2 + (P[a * 3 + 2]! - P[b * 3 + 2]!) ** 2;
  const vertexFor = (v: number, t: number): number => {
    const k = v * 65536 + t;
    let id = key.get(k);
    if (id === undefined) {
      id = sourceVertex.length;
      key.set(k, id);
      sourceVertex.push(v);
      uvIndex.push(t);
    }
    return id;
  };
  for (const f of bodyFaces) {
    const v = [0, 1, 2, 3].map((k) => base.faceVerts[f * 4 + k]!);
    const t = [0, 1, 2, 3].map((k) => base.faceUvs[f * 4 + k]!);
    if (v.some((x) => x >= base.bodyVertexCount)) throw new Error(`body face ${f} uses a helper vertex`);
    const r = v.map((x, k) => vertexFor(x, t[k]!));
    // Consistent diagonal rule: the shorter rest-pose diagonal.
    if (dist2(v[0]!, v[2]!) <= dist2(v[1]!, v[3]!)) tris.push(r[0]!, r[1]!, r[2]!, r[0]!, r[2]!, r[3]!);
    else tris.push(r[0]!, r[1]!, r[3]!, r[1]!, r[2]!, r[3]!);
  }
  const n = sourceVertex.length;
  const positions = new Float32Array(n * 3);
  const uvs = new Float32Array(n * 2);
  const reg = new Uint8Array(n);
  const copies = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const v = sourceVertex[i]!;
    positions.set(P.subarray(v * 3, v * 3 + 3), i * 3);
    uvs.set(base.uvs.subarray(uvIndex[i]! * 2, uvIndex[i]! * 2 + 2), i * 2);
    reg[i] = region[v]!;
    copies.set(v, (copies.get(v) ?? 0) + 1);
  }
  const seam = Uint8Array.from(sourceVertex, (v) => ((copies.get(v) ?? 0) > 1 ? 1 : 0));
  return { sourceVertex, uvIndex, positions, uvs, indices: Uint32Array.from(tris), region: reg, seam };
}

const UV_WEIGHT = 0.5;
/** Normals as simplifier attributes discourage folds (thin fingers fold easily otherwise). */
const NORMAL_WEIGHT = 0.35;
const MAX_FLIP_PASSES = 24;

/** Share of the non-face budget per region (PRD F2: strong reduction on body, light on hands/head). */
const BUDGET_SHARE = { body: 0.72, hands: 0.22, head: 0.06 } as const;
/** Minimum fraction of face vertices kept when the face must be reduced (PRD M3: >= 90%). */
const FACE_MIN_RETENTION = 0.92;

interface Stage {
  name: string;
  /** Regions this stage may simplify. */
  regions: number[];
  /** Triangle count the stage aims for within those regions. */
  regionTarget: number;
}

export async function buildPs2Body(base: BaseMesh, id: string, targetTriangles: number, opts: { fullHead?: boolean; lockLowerFace?: boolean } = {}): Promise<Ps2BodyResult> {
  await MeshoptSimplifier.ready;
  const rm = buildRenderMesh(base);
  const n = rm.sourceVertex.length;
  const R = REGION_ID;
  // Vertices locked because an earlier pass produced a flipped triangle around them.
  const flipLock = new Uint8Array(n);
  const lowerFace = opts.lockLowerFace ? lowerFaceVertices(base) : new Set<number>();
  // UV seams: meshoptimizer never collapses across a seam and keeps it watertight on its own; we
  // hard-lock seam vertices only where texture detail matters most (head, face, hands). DECISIONS.md D-007.
  const always = (i: number) =>
    (rm.seam[i] === 1 && rm.region[i] !== R.body) ||
    rm.region[i] === R.opening ||
    rm.region[i] === R.loop ||
    (opts.fullHead === true && rm.region[i] === R.head) ||
    lowerFace.has(rm.sourceVertex[i]!) ||
    flipLock[i] === 1;
  const sourceOf = Uint32Array.from(rm.sourceVertex);
  const neighbours = oneRing(rm.indices, n);
  // Attributes: UV + rest-pose hm08 vertex normal.
  const hmNormals = cachedNormals(base);
  const attrs = new Float32Array(n * 5);
  for (let i = 0; i < n; i++) {
    attrs[i * 5] = rm.uvs[i * 2]!;
    attrs[i * 5 + 1] = rm.uvs[i * 2 + 1]!;
    attrs.set(hmNormals.subarray(sourceOf[i]! * 3, sourceOf[i]! * 3 + 3), i * 5 + 2);
  }
  const weights = [UV_WEIGHT, UV_WEIGHT, NORMAL_WEIGHT, NORMAL_WEIGHT, NORMAL_WEIGHT];
  const regionTris = (idx: Uint32Array, regions: number[]) => {
    let c = 0;
    for (let t = 0; t < idx.length; t += 3) if (regions.includes(rm.region[idx[t]!]!)) c++;
    return c;
  };

  // Budget: the face (with eye/mouth rims and joint loops) is fixed; the rest is shared out.
  const fixedRegions = opts.fullHead ? [R.face, R.opening, R.loop, R.head] : [R.face, R.opening, R.loop];
  let faceTris = regionTris(rm.indices, fixedRegions);
  const faceOnlyTris = regionTris(rm.indices, [R.face]);
  const maxFaceCut = Math.floor(faceOnlyTris * (1 - FACE_MIN_RETENTION));
  const minRest = targetTriangles * 0.33; // never starve the body below a third of the budget
  let faceCut = 0;
  if (targetTriangles - faceTris < minRest) {
    faceCut = Math.min(maxFaceCut, Math.ceil(minRest - (targetTriangles - faceTris)));
    faceTris -= faceCut;
  }
  const rest = Math.max(0, targetTriangles - faceTris);
  const share = opts.fullHead ? { body: BUDGET_SHARE.body / (1 - BUDGET_SHARE.head), hands: BUDGET_SHARE.hands / (1 - BUDGET_SHARE.head) } : BUDGET_SHARE;
  const stages: Stage[] = [
    { name: 'body', regions: [R.body], regionTarget: Math.round(rest * share.body) },
    { name: 'hands', regions: [R.hands], regionTarget: Math.round(rest * share.hands) },
  ];
  if (!opts.fullHead) stages.push({ name: 'head', regions: [R.head], regionTarget: Math.round(rest * BUDGET_SHARE.head) });
  if (faceCut > 0) stages.push({ name: 'face-light', regions: [R.face], regionTarget: faceOnlyTris - faceCut });
  // Balance: whatever is left over (locks, flip repair) comes off body/hands/head together.
  stages.push({ name: 'balance', regions: opts.fullHead ? [R.body, R.hands] : [R.body, R.hands, R.head], regionTarget: -1 });

  let indices = rm.indices;
  let error = 0;
  let used: string[] = [];
  for (let pass = 0; pass < MAX_FLIP_PASSES; pass++) {
    indices = rm.indices;
    error = 0;
    used = [];
    for (const stage of stages) {
      const total = indices.length / 3;
      const current = regionTris(indices, stage.regions);
      const targetTotal = stage.regionTarget < 0 ? targetTriangles : total - Math.max(0, current - stage.regionTarget);
      if (total <= targetTotal) continue;
      const lock = new Uint8Array(n);
      for (let i = 0; i < n; i++) lock[i] = always(i) || !stage.regions.includes(rm.region[i]!) ? 1 : 0;
      const [out, err] = MeshoptSimplifier.simplifyWithAttributes(
        indices, rm.positions, 3, attrs, 5, weights, lock, targetTotal * 3, 1.0, ['LockBorder'],
      );
      indices = out;
      error = Math.max(error, err);
      used.push(stage.name);
    }
    const flipped = flippedTriangles(base, sourceOf, indices);
    if (process.env.PS2CC_DEBUG) {
      console.info(`  [${id}] pass ${pass}: ${indices.length / 3} tris, ${flipped.length} flipped`);
    }
    if (flipped.length === 0) break;
    // Flipped triangles usually consist of locked vertices that an unlocked neighbour collapsed into,
    // so lock each corner's original one-ring as well, then retry from scratch.
    for (const t of flipped) {
      for (let k = 0; k < 3; k++) {
        const v = indices[t * 3 + k]!;
        flipLock[v] = 1;
        for (const nb of neighbours[v]!) flipLock[nb] = 1;
      }
    }
  }
  // Compact: keep used render vertices only.
  const remap = new Int32Array(n).fill(-1);
  const keep: number[] = [];
  for (const i of indices) {
    if (remap[i] === -1) {
      remap[i] = keep.length;
      keep.push(i);
    }
  }
  const outIndices = Uint32Array.from(indices, (i) => remap[i]!);
  const sourceVertex = Uint32Array.from(keep, (i) => rm.sourceVertex[i]!);
  const uvs = new Float32Array(keep.length * 2);
  keep.forEach((i, k) => uvs.set(rm.uvs.subarray(i * 2, i * 2 + 2), k * 2));
  const vertexRegion = Uint8Array.from(keep, (i) => rm.region[i]!);

  // Face retention: fraction of original face-region hm08 vertices still present.
  const faceOrig = new Set<number>();
  const faceKept = new Set<number>();
  rm.sourceVertex.forEach((v, i) => {
    if (rm.region[i] === R.face || rm.region[i] === R.opening) faceOrig.add(v);
  });
  for (const v of sourceVertex) if (faceOrig.has(v)) faceKept.add(v);

  const flipped = countFlipped(base, sourceVertex, outIndices);
  return {
    id,
    targetTriangles,
    sourceVertex,
    uvs,
    indices: outIndices,
    vertexRegion,
    faceRetention: faceKept.size / faceOrig.size,
    stagesUsed: used,
    error,
    flippedTriangles: flipped,
  };
}

/** Original-mesh neighbours of every render vertex. */
function oneRing(indices: Uint32Array, n: number): number[][] {
  const ring: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
  for (let t = 0; t < indices.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = indices[t + k]!;
      ring[a]!.add(indices[t + ((k + 1) % 3)]!);
      ring[a]!.add(indices[t + ((k + 2) % 3)]!);
    }
  }
  return ring.map((s) => [...s]);
}

/** Triangles whose normal disagrees with the hm08 surface normal at their corners. */
export function countFlipped(base: BaseMesh, sourceVertex: Uint32Array, indices: Uint32Array): number {
  return flippedTriangles(base, sourceVertex, indices).length;
}

/** Indices (triangle numbers) of triangles facing against the hm08 surface. */
export function flippedTriangles(base: BaseMesh, sourceVertex: Uint32Array, indices: Uint32Array): number[] {
  const normals = cachedNormals(base);
  const P = base.positions;
  const flipped: number[] = [];
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [sourceVertex[indices[t]!]!, sourceVertex[indices[t + 1]!]!, sourceVertex[indices[t + 2]!]!];
    const ux = P[b * 3]! - P[a * 3]!;
    const uy = P[b * 3 + 1]! - P[a * 3 + 1]!;
    const uz = P[b * 3 + 2]! - P[a * 3 + 2]!;
    const vx = P[c * 3]! - P[a * 3]!;
    const vy = P[c * 3 + 1]! - P[a * 3 + 1]!;
    const vz = P[c * 3 + 2]! - P[a * 3 + 2]!;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    let ax = 0;
    let ay = 0;
    let az = 0;
    for (const v of [a, b, c]) {
      ax += normals[v * 3]!;
      ay += normals[v * 3 + 1]!;
      az += normals[v * 3 + 2]!;
    }
    if (nx * ax + ny * ay + nz * az < 0) flipped.push(t / 3);
  }
  return flipped;
}

const normalCache = new WeakMap<BaseMesh, Float32Array>();
function cachedNormals(base: BaseMesh): Float32Array {
  let n = normalCache.get(base);
  if (!n) {
    n = computeQuadNormals(base.positions, base.faceVerts, base.vertexCount);
    normalCache.set(base, n);
  }
  return n;
}
