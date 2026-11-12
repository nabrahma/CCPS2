/**
 * The card system grown on other surfaces (PRD F15, "reuse for fur and
 * brows"): fur trims along a garment's edge loops (collars, cuffs, hems) and
 * card eyebrows on the brow region. Both make short cards from roots on a
 * surface, each card a narrow strip bending out of the surface, textured from
 * a strand atlas region and coloured by a gradient map like the hair.
 *
 * Deterministic: roots come from the topology and a seed only, so the card
 * count and topology never depend on the body shape.
 */
import { Rng } from '../random';
import type { AtlasRegion, AtlasTag } from './atlas';
import { regionsFor } from './atlas';
import { HAIR_LAYER_CARD } from './generate';

type Vec3 = [number, number, number];

export interface SurfaceCardRoot {
  /** Root position and the outward surface normal there. */
  p: Vec3;
  n: Vec3;
  /** Direction the hair grows in (along the surface, roughly). */
  dir: Vec3;
  length: number;
  width: number;
  /** How far the card bends out of the surface (0..1). */
  lift: number;
  /** A number in [0, 1) that is this card's own. */
  random: number;
}

export interface SurfaceCards {
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  layer: Float32Array;
  hairLayer: Uint8Array;
  triangleCount: number;
}

/** One strip per root: `segments` quads from the root out, the width tangent to the surface. */
export function buildSurfaceCards(roots: readonly SurfaceCardRoot[], atlas: readonly AtlasRegion[], tag: AtlasTag, segments: number, seed: number): SurfaceCards {
  const regions = regionsFor(atlas, tag);
  if (regions.length === 0) throw new Error('surface cards: the atlas has no regions');
  const S = Math.max(1, segments);
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const rng = new Rng(seed >>> 0 || 1);
  for (const r of roots) {
    const region = regions[Math.floor(r.random * regions.length) % regions.length]!;
    const flip = rng.next() < 0.5;
    const n = normalise(r.n);
    // The growth direction along the surface, then out of it towards the tip.
    let d = sub(r.dir, mul(n, dot(r.dir, n)));
    if (Math.hypot(...d) < 1e-6) d = perpendicular(n);
    d = normalise(d);
    const side = normalise(cross(d, n));
    const first = pos.length / 3;
    for (let j = 0; j <= S; j++) {
      const s = j / S;
      const out = r.lift * s * s;
      const centre = add(r.p, add(mul(d, r.length * s * Math.sqrt(1 - out * out * 0.5)), mul(n, r.length * out * 0.7 + 0.0008)));
      const half = (r.width / 2) * (1 - 0.35 * s);
      for (const k of [-1, 1]) {
        const p = add(centre, mul(side, k * half));
        pos.push(p[0], p[1], p[2]);
        const left = k < 0;
        uv.push(left !== flip ? region.x : region.x + region.w, 1 - (region.y + region.h * s));
      }
    }
    for (let j = 0; j < S; j++) {
      const a = first + j * 2;
      idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
  }
  const count = pos.length / 3;
  return {
    positions: Float32Array.from(pos),
    uvs: Float32Array.from(uv),
    indices: Uint32Array.from(idx),
    layer: new Float32Array(count).fill(1),
    hairLayer: new Uint8Array(count).fill(HAIR_LAYER_CARD),
    triangleCount: idx.length / 3,
  };
}

// ---------------------------------------------------------------- fur trims

export const FUR_EDGES = ['collar', 'cuffs', 'hem'] as const;
export type FurEdge = (typeof FUR_EDGES)[number];

/** Fur trim settings of a garment. Lengths in metres; density in cards per metre of edge. */
export interface FurTrim {
  enabled: boolean;
  edges: FurEdge[];
  length: number;
  density: number;
  /** 0..1 how far the fur stands out from the garment. */
  lift: number;
  /** Fur colour (sRGB 0..1), through the hair gradient map. */
  colour: [number, number, number];
}

/** A shearling trim: cream, short, dense. */
export const DEFAULT_FUR: FurTrim = { enabled: false, edges: ['collar', 'cuffs'], length: 0.03, density: 160, lift: 0.6, colour: [0.82, 0.76, 0.64] };

export function sanitiseFur(raw: unknown): FurTrim {
  const r = (raw ?? {}) as Partial<FurTrim>;
  const num = (v: unknown, d: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  const edges = Array.isArray(r.edges) ? FUR_EDGES.filter((e) => r.edges!.includes(e)) : [...DEFAULT_FUR.edges];
  return {
    enabled: Boolean(r.enabled),
    edges,
    length: num(r.length, DEFAULT_FUR.length, 0.005, 0.12),
    density: num(r.density, DEFAULT_FUR.density, 20, 400),
    lift: num(r.lift, DEFAULT_FUR.lift, 0, 1),
    colour: Array.isArray(r.colour) && r.colour.length === 3 ? [num(r.colour[0], 0.8, 0, 1), num(r.colour[1], 0.75, 0, 1), num(r.colour[2], 0.65, 0, 1)] : [...DEFAULT_FUR.colour],
  };
}

/**
 * Open edge loops of a triangle mesh (edges used by one triangle), as vertex
 * index chains. Loops shorter than three vertices are dropped.
 */
export function boundaryLoops(indices: ArrayLike<number>): number[][] {
  const count = new Map<string, number>();
  const key = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  for (let t = 0; t < indices.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = indices[t + k]!;
      const b = indices[t + ((k + 1) % 3)]!;
      count.set(key(a, b), (count.get(key(a, b)) ?? 0) + 1);
    }
  }
  const next = new Map<number, number[]>();
  for (const [k, c] of count) {
    if (c !== 1) continue;
    const [a, b] = k.split(':').map(Number) as [number, number];
    (next.get(a) ?? next.set(a, []).get(a)!).push(b);
    (next.get(b) ?? next.set(b, []).get(b)!).push(a);
  }
  const used = new Set<number>();
  const loops: number[][] = [];
  for (const start of [...next.keys()].sort((x, y) => x - y)) {
    if (used.has(start)) continue;
    const loop = [start];
    used.add(start);
    let prev = -1;
    let cur = start;
    for (;;) {
      const options = (next.get(cur) ?? []).filter((v) => v !== prev && !used.has(v));
      if (options.length === 0) break;
      const v = Math.min(...options);
      loop.push(v);
      used.add(v);
      prev = cur;
      cur = v;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

/**
 * Which edge a loop is: the collar if its middle is nearest the neck, a cuff
 * if nearest a wrist (or ankle), the hem otherwise (by joint distance).
 */
export function classifyLoop(positions: ArrayLike<number>, loop: readonly number[], joints: { neck: Vec3; wrists: Vec3[]; ankles: Vec3[] }): FurEdge {
  const c: Vec3 = [0, 0, 0];
  for (const v of loop) for (let k = 0; k < 3; k++) c[k]! += positions[v * 3 + k]! / loop.length;
  const dn = dist(c, joints.neck);
  const dw = Math.min(...[...joints.wrists, ...joints.ankles].map((j) => dist(c, j)));
  if (dn < 0.12 && dn <= dw) return 'collar';
  if (dw < 0.12) return 'cuffs';
  return 'hem';
}

/**
 * Fur roots along the chosen edge loops, evenly spaced by `density`, growing
 * out of the garment (along its normal) and away from the loop's middle.
 * `normals` are per-vertex garment normals.
 */
export function loopLength(positions: ArrayLike<number>, loop: readonly number[]): number {
  let len = 0;
  for (let i = 0; i < loop.length; i++) len += dist(vec(positions, loop[i]!), vec(positions, loop[(i + 1) % loop.length]!));
  return len;
}

/**
 * Fur roots along edge loops, `counts[i]` evenly spaced round loop i (the
 * counts are fixed when the fur is made, so its topology never depends on the
 * body), growing out of the garment (along its normal) and away from the
 * loop's middle. `normals` are per-vertex garment normals.
 */
export function furRoots(positions: ArrayLike<number>, normals: ArrayLike<number>, loops: readonly number[][], counts: readonly number[], fur: FurTrim, seed: number): SurfaceCardRoot[] {
  const rng = new Rng((seed * 2654435761) >>> 0 || 7);
  const out: SurfaceCardRoot[] = [];
  loops.forEach((loop, li) => {
    const count = counts[li] ?? 0;
    if (count <= 0) return;
    const ring = [...loop, loop[0]!];
    const centre: Vec3 = [0, 0, 0];
    for (const v of loop) for (let k = 0; k < 3; k++) centre[k]! += positions[v * 3 + k]! / loop.length;
    const total = loopLength(positions, loop);
    const spacing = total / count;
    let edge = 0;
    let edgeStart = 0;
    for (let c = 0; c < count; c++) {
      const s = (c + 0.5) * spacing;
      while (edge < loop.length - 1 && edgeStart + dist(vec(positions, ring[edge]!), vec(positions, ring[edge + 1]!)) < s) {
        edgeStart += dist(vec(positions, ring[edge]!), vec(positions, ring[edge + 1]!));
        edge++;
      }
      const a = vec(positions, ring[edge]!);
      const b = vec(positions, ring[edge + 1]!);
      const len = dist(a, b);
      const t = len > 0 ? Math.min(1, Math.max(0, (s - edgeStart) / len)) : 0;
      const p = lerp(a, b, t);
      const n = normalise(lerp(vec(normals, ring[edge]!), vec(normals, ring[edge + 1]!), t));
      // Out of the garment, and away from the opening's middle (fur flares out of a cuff or collar).
      const away = normalise(sub(p, centre));
      out.push({
        p: add(p, mul(n, 0.0015)),
        n,
        dir: normalise(add(mul(away, 0.6), mul(n, 0.4))),
        length: fur.length * rng.range(0.75, 1.2),
        width: spacing * 2.4,
        lift: fur.lift * rng.range(0.7, 1.1),
        random: rng.next(),
      });
    }
  });
  return out;
}

// ---------------------------------------------------------------- card brows

/** Card eyebrow settings: how many cards and how long. */
export interface CardBrows {
  count: number;
  length: number;
}

export const DEFAULT_CARD_BROWS: CardBrows = { count: 130, length: 0.009 };

export function sanitiseCardBrows(raw: unknown): CardBrows {
  const r = (raw ?? {}) as Partial<CardBrows>;
  const num = (v: unknown, d: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  return { count: Math.round(num(r.count, DEFAULT_CARD_BROWS.count, 10, 300)), length: num(r.length, DEFAULT_CARD_BROWS.length, 0.003, 0.03) };
}

/**
 * Brow hair roots on the eyebrow mesh's triangles (area-weighted, seeded),
 * growing from the inner end of the brow to the outer, a little upward near
 * the middle of the face, as brow hair grows.
 */
export function browRoots(positions: ArrayLike<number>, indices: ArrayLike<number>, centreX: number, brows: CardBrows, seed: number): SurfaceCardRoot[] {
  const tris = indices.length / 3;
  const cdf = new Float64Array(tris);
  let total = 0;
  for (let t = 0; t < tris; t++) {
    const a = vec(positions, indices[t * 3]!);
    const b = vec(positions, indices[t * 3 + 1]!);
    const c = vec(positions, indices[t * 3 + 2]!);
    total += Math.hypot(...cross(sub(b, a), sub(c, a))) / 2;
    cdf[t] = total;
  }
  const rng = new Rng((seed * 40503 + 17) >>> 0 || 3);
  const out: SurfaceCardRoot[] = [];
  if (total <= 0) return out;
  // The brow's inner and outer x on each side, to know how far along it a root is.
  let maxX = 0;
  for (let v = 0; v < positions.length / 3; v++) maxX = Math.max(maxX, Math.abs(positions[v * 3]! - centreX));
  for (let i = 0; i < brows.count; i++) {
    const x = rng.next() * total;
    let lo = 0;
    let hi = tris - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid]! < x) lo = mid + 1;
      else hi = mid;
    }
    const t = lo;
    let u = rng.next();
    let w = rng.next();
    if (u + w > 1) {
      u = 1 - u;
      w = 1 - w;
    }
    const a = vec(positions, indices[t * 3]!);
    const b = vec(positions, indices[t * 3 + 1]!);
    const c = vec(positions, indices[t * 3 + 2]!);
    const p = add(add(mul(a, 1 - u - w), mul(b, u)), mul(c, w));
    let n = normalise(cross(sub(b, a), sub(c, a)));
    if (n[2] < 0) n = mul(n, -1);
    const side = p[0] >= centreX ? 1 : -1;
    const along = Math.min(1, Math.abs(p[0] - centreX) / Math.max(1e-6, maxX));
    // Inner hairs point up, the rest outwards and slightly down at the tail.
    const up = 0.9 * (1 - smooth(0.1, 0.45, along)) - 0.15 * smooth(0.7, 1, along);
    // Fine hairs lying close to the skin.
    out.push({ p, n, dir: normalise([side * (0.3 + along), up, 0]), length: brows.length * rng.range(0.7, 1.15), width: 0.0015, lift: 0.05, random: rng.next() });
  }
  return out;
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

const vec = (P: ArrayLike<number>, v: number): Vec3 => [P[v * 3]!, P[v * 3 + 1]!, P[v * 3 + 2]!];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const dist = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
function normalise(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 1, 0];
}
function perpendicular(n: Vec3): Vec3 {
  return Math.abs(n[1]) < 0.9 ? normalise(cross(n, [0, 1, 0])) : normalise(cross(n, [1, 0, 0]));
}
