/**
 * Computed hidden body faces (PRD F4) for garments that ship without
 * MakeHuman delete_verts data: "raycast from body vertices; hide faces fully
 * covered".
 *
 * A body vertex counts as covered when every ray of a small cone around its
 * normal (the normal plus six rays tilted by CONE_DEG) hits an opaque part of
 * the garment within MAX_GAP. Rays start slightly under the skin so cloth
 * that touches or dips into it still counts. Texture alpha is sampled at the
 * hit, so fishnets and lace cover nothing through their holes. The covered set
 * is then eroded by one ring of the body mesh as a safety margin. At runtime a
 * body face is hidden only when all of its vertices are covered (stricter than
 * MakeHuman's any-vertex rule for its hand-made lists). Used at build time for
 * the CC0 garments and at import time for the user's own (PRD F4).
 */
import { TriangleBVH } from '../mesh/bvh';

export const MAX_GAP = 0.04;
export const CONE_DEG = 30;
const START_UNDER_SKIN = 0.002;
/** Texture alpha (0..1) at or above which cloth counts as opaque. */
export const OPAQUE_ALPHA = 0.9;

export interface CoverageInput {
  /** hm08 positions and smooth normals (metres). */
  bodyPositions: ArrayLike<number>;
  bodyNormals: ArrayLike<number>;
  /** Body quads (4 vertex indices each) that may be hidden. */
  bodyQuads: ArrayLike<number>;
  /** Garment triangles on the same body, with per-vertex UVs. */
  garmentPositions: ArrayLike<number>;
  garmentIndices: ArrayLike<number>;
  garmentUvs: ArrayLike<number>;
  /** Alpha 0..1 at a UV (v up); omitted = fully opaque. */
  alphaAt?: (u: number, v: number) => number;
}

/** hm08 vertices hidden under the garment, sorted ascending. */
export function computeCoveredVertices(input: CoverageInput): Uint32Array {
  const { bodyPositions: P, bodyNormals: N, bodyQuads: Q, garmentUvs: UV, alphaAt } = input;
  const bvh = new TriangleBVH(input.garmentPositions, input.garmentIndices);
  const I = input.garmentIndices;
  const opaque = alphaAt
    ? (hit: { triangle: number; u: number; v: number }) => {
        const a = I[hit.triangle * 3]!;
        const b = I[hit.triangle * 3 + 1]!;
        const c = I[hit.triangle * 3 + 2]!;
        const w = 1 - hit.u - hit.v;
        const u = w * UV[a * 2]! + hit.u * UV[b * 2]! + hit.v * UV[c * 2]!;
        const v = w * UV[a * 2 + 1]! + hit.u * UV[b * 2 + 1]! + hit.v * UV[c * 2 + 1]!;
        return alphaAt(u, v) >= OPAQUE_ALPHA;
      }
    : undefined;

  const neighbours = new Map<number, Set<number>>();
  const link = (a: number, b: number) => {
    if (a === b) return;
    let s = neighbours.get(a);
    if (!s) neighbours.set(a, (s = new Set()));
    s.add(b);
  };
  for (let q = 0; q < Q.length; q += 4) {
    for (let k = 0; k < 4; k++) {
      link(Q[q + k]!, Q[q + ((k + 1) % 4)]!);
      link(Q[q + ((k + 1) % 4)]!, Q[q + k]!);
    }
  }

  const cos = Math.cos((CONE_DEG * Math.PI) / 180);
  const sin = Math.sin((CONE_DEG * Math.PI) / 180);
  const covered = new Set<number>();
  const origin = [0, 0, 0];
  const dir = [0, 0, 0];
  for (const v of neighbours.keys()) {
    const n = [N[v * 3]!, N[v * 3 + 1]!, N[v * 3 + 2]!];
    const [t1, t2] = tangents(n);
    for (let k = 0; k < 3; k++) origin[k] = P[v * 3 + k]! - n[k]! * START_UNDER_SKIN;
    let all = true;
    for (let r = 0; r <= 6 && all; r++) {
      if (r === 0) {
        dir[0] = n[0]!;
        dir[1] = n[1]!;
        dir[2] = n[2]!;
      } else {
        const a = ((r - 1) / 6) * Math.PI * 2;
        for (let k = 0; k < 3; k++) dir[k] = cos * n[k]! + sin * (Math.cos(a) * t1[k]! + Math.sin(a) * t2[k]!);
      }
      all = bvh.raycast(origin, dir, 0, MAX_GAP + START_UNDER_SKIN, opaque) !== null;
    }
    if (all) covered.add(v);
  }
  // Erode by one ring: keep only vertices whose whole neighbourhood is covered.
  const out: number[] = [];
  for (const v of covered) if ([...neighbours.get(v)!].every((u) => covered.has(u))) out.push(v);
  return Uint32Array.from(out.sort((a, b) => a - b));
}

function tangents(n: number[]): [number[], number[]] {
  const a = Math.abs(n[0]!) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const t1 = cross(n, a);
  const l = Math.hypot(t1[0]!, t1[1]!, t1[2]!);
  for (let k = 0; k < 3; k++) t1[k] = t1[k]! / l;
  return [t1, cross(n, t1)];
}

function cross(a: number[], b: number[]): number[] {
  return [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
}

/** Nearest-texel alpha lookup for an RGBA image (UV v up, rows top to bottom). */
export function alphaSampler(width: number, height: number, rgba: Uint8Array): (u: number, v: number) => number {
  return (u, v) => {
    const wrap = (t: number) => (t < 0 || t > 1 ? t - Math.floor(t) : t);
    const x = Math.min(width - 1, Math.floor(wrap(u) * width));
    const y = Math.min(height - 1, Math.floor((1 - wrap(v)) * height));
    return rgba[(y * width + x) * 4 + 3]! / 255;
  };
}
