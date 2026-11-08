/**
 * Shared simplification core: meshoptimizer `simplifyWithAttributes` on a
 * seam-split render mesh (UVs + normals as attributes), with flip repair.
 * Output vertices are always a subset of the input vertices.
 */
import { MeshoptSimplifier } from 'meshoptimizer';

export interface SimplifyInput {
  positions: Float32Array; // xyz per render vertex
  uvs: Float32Array; // uv per render vertex
  normals: Float32Array; // smooth reference normals per render vertex (for attributes and flip checks)
  indices: Uint32Array;
  /** 1 = vertex may not move/collapse. */
  lock?: Uint8Array;
  targetTriangles: number;
  uvWeight?: number;
  normalWeight?: number;
  maxFlipPasses?: number;
  /** Relative error limit (default 1 = no limit, stop at the triangle target). */
  targetError?: number;
  /** meshoptimizer flags (default: LockBorder). */
  flags?: ('LockBorder' | 'Prune' | 'Permissive')[];
}

export interface SimplifyResult {
  indices: Uint32Array;
  error: number;
  /** Flipped triangles that were not already inconsistent in the input. */
  flipped: number;
  /** Flipped triangles in the input itself (MakeHuman garments often have inconsistent winding). */
  baselineFlipped: number;
  passes: number;
}

export async function simplifyRenderMesh(input: SimplifyInput): Promise<SimplifyResult> {
  await MeshoptSimplifier.ready;
  const n = input.positions.length / 3;
  const uvW = input.uvWeight ?? 0.5;
  const nW = input.normalWeight ?? 0.35;
  const attrs = new Float32Array(n * 5);
  for (let i = 0; i < n; i++) {
    attrs[i * 5] = input.uvs[i * 2]!;
    attrs[i * 5 + 1] = input.uvs[i * 2 + 1]!;
    attrs.set(input.normals.subarray(i * 3, i * 3 + 3), i * 5 + 2);
  }
  const weights = [uvW, uvW, nW, nW, nW];
  const ring = oneRing(input.indices, n);
  const flipLock = new Uint8Array(n);
  // Regions that already face against their own normals in the input are not decimation errors.
  const baseline = flippedAgainst(input.positions, input.normals, input.indices);
  const inconsistent = new Uint8Array(n);
  for (const t of baseline) {
    for (let k = 0; k < 3; k++) {
      const v = input.indices[t * 3 + k]!;
      inconsistent[v] = 1;
      for (const nb of ring[v]!) inconsistent[nb] = 1;
    }
  }
  const isNewFlip = (out: Uint32Array, t: number) =>
    !inconsistent[out[t * 3]!] && !inconsistent[out[t * 3 + 1]!] && !inconsistent[out[t * 3 + 2]!];
  let out = input.indices;
  let error = 0;
  let flipped: number[] = [];
  let pass = 0;
  for (; pass < (input.maxFlipPasses ?? 16); pass++) {
    const lock = new Uint8Array(n);
    for (let i = 0; i < n; i++) lock[i] = (input.lock?.[i] ?? 0) | flipLock[i]!;
    const [res, err] = MeshoptSimplifier.simplifyWithAttributes(
      input.indices,
      input.positions,
      3,
      attrs,
      5,
      weights,
      lock,
      Math.min(input.targetTriangles * 3, input.indices.length),
      input.targetError ?? 1.0,
      input.flags ?? ['LockBorder'],
    );
    out = res;
    error = err;
    flipped = flippedAgainst(input.positions, input.normals, out).filter((t) => isNewFlip(out, t));
    if (flipped.length === 0) break;
    for (const t of flipped) {
      for (let k = 0; k < 3; k++) {
        const v = out[t * 3 + k]!;
        flipLock[v] = 1;
        for (const nb of ring[v]!) flipLock[nb] = 1;
      }
    }
  }
  return { indices: out, error, flipped: flipped.length, baselineFlipped: baseline.length, passes: pass + 1 };
}

/** Triangles whose face normal points against the reference normals at their corners. */
export function flippedAgainst(positions: Float32Array, normals: Float32Array, indices: Uint32Array): number[] {
  const out: number[] = [];
  const P = positions;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]!;
    const b = indices[t + 1]!;
    const c = indices[t + 2]!;
    const ux = P[b * 3]! - P[a * 3]!;
    const uy = P[b * 3 + 1]! - P[a * 3 + 1]!;
    const uz = P[b * 3 + 2]! - P[a * 3 + 2]!;
    const vx = P[c * 3]! - P[a * 3]!;
    const vy = P[c * 3 + 1]! - P[a * 3 + 1]!;
    const vz = P[c * 3 + 2]! - P[a * 3 + 2]!;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    let d = 0;
    for (const v of [a, b, c]) d += nx * normals[v * 3]! + ny * normals[v * 3 + 1]! + nz * normals[v * 3 + 2]!;
    if (d < 0) out.push(t / 3);
  }
  return out;
}

export function oneRing(indices: Uint32Array, n: number): number[][] {
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
