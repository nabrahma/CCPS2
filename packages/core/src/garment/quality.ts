/**
 * Garment quality checks (PRD Part 3, section 5.0): the era look as numbers,
 * for every generated garment and every library garment.
 *
 * - Rim depth: every open edge shows cloth thickness of at least 5 mm (the
 *   span, along the surface normal, of the edge's profile within two edges).
 * - Ease: mean distance from cloth to skin at least the class minimum, and
 *   almost no cloth under half of it (hem rims and parts excluded).
 * - Anatomy show-through: over the torso, the Laplacian energy of the cloth's
 *   radius map is at most 25% of the body's (rays from the torso's axis).
 * - Silhouette: along horizontal slices, no turn sharper than 35 degrees.
 * - Topology: manifold, consistently wound, no self-intersection within a
 *   piece (separate pieces, such as pockets and soles, sit on the cloth).
 *
 * Inputs are render meshes (UV seams split vertices); vertices at the same
 * position are welded first.
 */
import { TriangleBVH } from '../mesh/bvh';
import { acos, DEG, hypot } from '../math/dmath';

export interface MeshInput {
  positions: ArrayLike<number>;
  indices: ArrayLike<number>;
}

export interface BodyInput extends MeshInput {
  normals: ArrayLike<number>;
}

interface Welded {
  P: Float64Array;
  T: Uint32Array;
  n: number;
}

/** Weld render vertices that share a position (exactly). */
export function weld(m: MeshInput): Welded {
  const key = new Map<string, number>();
  const remap: number[] = [];
  const P: number[] = [];
  for (let i = 0; i < m.positions.length / 3; i++) {
    const k = `${m.positions[i * 3]},${m.positions[i * 3 + 1]},${m.positions[i * 3 + 2]}`;
    let id = key.get(k);
    if (id === undefined) {
      id = P.length / 3;
      key.set(k, id);
      P.push(m.positions[i * 3]!, m.positions[i * 3 + 1]!, m.positions[i * 3 + 2]!);
    }
    remap.push(id);
  }
  const T = new Uint32Array(m.indices.length);
  for (let i = 0; i < T.length; i++) T[i] = remap[m.indices[i]!]!;
  return { P: Float64Array.from(P), T, n: P.length / 3 };
}

/**
 * Triangles of the main cloth: the largest piece (pockets, soles and buckles
 * are separate pieces), without the strips along open edges (the rims turn in
 * by design). The checks of the cloth's surface look at these only.
 */
/**
 * Phong tessellation, `levels` times four triangles: each edge midpoint moves
 * to the average of its projections on the tangent planes at the edge's ends
 * (area-weighted vertex normals), so the result is the smooth surface the
 * mesh shades as.
 */
export function phongRefine(P0: ArrayLike<number>, T0: ArrayLike<number>, levels: number): { P: Float64Array; T: Uint32Array } {
  let P = Float64Array.from(P0);
  let T = Uint32Array.from(T0);
  for (let l = 0; l < levels; l++) {
    const n = P.length / 3;
    const N = new Float64Array(n * 3);
    for (let t = 0; t < T.length; t += 3) {
      const a = T[t]! * 3;
      const b = T[t + 1]! * 3;
      const c = T[t + 2]! * 3;
      const ux = P[b]! - P[a]!;
      const uy = P[b + 1]! - P[a + 1]!;
      const uz = P[b + 2]! - P[a + 2]!;
      const vx = P[c]! - P[a]!;
      const vy = P[c + 1]! - P[a + 1]!;
      const vz = P[c + 2]! - P[a + 2]!;
      const fx = uy * vz - uz * vy;
      const fy = uz * vx - ux * vz;
      const fz = ux * vy - uy * vx;
      for (const v of [a, b, c]) {
        N[v] = N[v]! + fx;
        N[v + 1] = N[v + 1]! + fy;
        N[v + 2] = N[v + 2]! + fz;
      }
    }
    for (let v = 0; v < n; v++) {
      const L = hypot(N[v * 3]!, N[v * 3 + 1]!, N[v * 3 + 2]!) || 1;
      N[v * 3] = N[v * 3]! / L;
      N[v * 3 + 1] = N[v * 3 + 1]! / L;
      N[v * 3 + 2] = N[v * 3 + 2]! / L;
    }
    const out: number[] = Array.from(P);
    const mid = new Map<number, number>();
    const midpoint = (a: number, b: number): number => {
      const key = Math.min(a, b) * n + Math.max(a, b);
      const got = mid.get(key);
      if (got !== undefined) return got;
      const m = [(P[a * 3]! + P[b * 3]!) / 2, (P[a * 3 + 1]! + P[b * 3 + 1]!) / 2, (P[a * 3 + 2]! + P[b * 3 + 2]!) / 2];
      const q = [0, 0, 0];
      for (const v of [a, b]) {
        const d = (m[0]! - P[v * 3]!) * N[v * 3]! + (m[1]! - P[v * 3 + 1]!) * N[v * 3 + 1]! + (m[2]! - P[v * 3 + 2]!) * N[v * 3 + 2]!;
        for (let k = 0; k < 3; k++) q[k] = q[k]! + (m[k]! - d * N[v * 3 + k]!) / 2;
      }
      const id = out.length / 3;
      out.push(q[0]!, q[1]!, q[2]!);
      mid.set(key, id);
      return id;
    };
    const tris: number[] = [];
    for (let t = 0; t < T.length; t += 3) {
      const a = T[t]!;
      const b = T[t + 1]!;
      const c = T[t + 2]!;
      const ab = midpoint(a, b);
      const bc = midpoint(b, c);
      const ca = midpoint(c, a);
      tris.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
    }
    P = Float64Array.from(out);
    T = Uint32Array.from(tris);
  }
  return { P, T };
}

function mainCloth(T: Uint32Array, n: number): Uint32Array {
  const parent = new Int32Array(n).map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  for (let t = 0; t < T.length; t += 3) {
    const a = find(T[t]!);
    for (let k = 1; k < 3; k++) {
      const b = find(T[t + k]!);
      if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
    }
  }
  const size = new Map<number, number>();
  for (let t = 0; t < T.length; t += 3) size.set(find(T[t]!), (size.get(find(T[t]!)) ?? 0) + 1);
  let main = -1;
  let best = -1;
  for (const [root, c] of [...size.entries()].sort((x, y) => x[0] - y[0])) if (c > best) [main, best] = [root, c];
  // Vertices within two edges of an open edge.
  const loops = boundaryLoops(T, n);
  const near = new Uint8Array(n);
  const nb: Set<number>[] = Array.from({ length: n }, () => new Set());
  for (let t = 0; t < T.length; t += 3) for (let k = 0; k < 3; k++) {
    nb[T[t + k]!]!.add(T[t + ((k + 1) % 3)]!);
    nb[T[t + k]!]!.add(T[t + ((k + 2) % 3)]!);
  }
  let frontier = loops.flat();
  for (const v of frontier) near[v] = 1;
  for (let h = 0; h < 2; h++) {
    const next: number[] = [];
    for (const v of frontier) for (const u of nb[v]!) if (!near[u]) {
      near[u] = 1;
      next.push(u);
    }
    frontier = next;
  }
  const out: number[] = [];
  for (let t = 0; t < T.length; t += 3) {
    if (find(T[t]!) !== main) continue;
    if (near[T[t]!] || near[T[t + 1]!] || near[T[t + 2]!]) continue;
    out.push(T[t]!, T[t + 1]!, T[t + 2]!);
  }
  return Uint32Array.from(out);
}

const sub = (P: ArrayLike<number>, a: number, b: number): [number, number, number] => [P[a * 3]! - P[b * 3]!, P[a * 3 + 1]! - P[b * 3 + 1]!, P[a * 3 + 2]! - P[b * 3 + 2]!];
const cross = (a: number[], b: number[]): [number, number, number] => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
const norm = (a: number[]): number => Math.sqrt(a[0]! * a[0]! + a[1]! * a[1]! + a[2]! * a[2]!);

export interface TopologyReport {
  /** Edges used by more than two triangles. */
  nonManifoldEdges: number;
  /** Directed edges used twice (inconsistent winding). */
  flippedEdges: number;
  /** Open boundary loops. */
  boundaryLoops: number;
  /** Triangle edges passing through another triangle of the same piece. */
  selfIntersections: number;
  pieces: number;
}

export function topologyReport(m: MeshInput): TopologyReport {
  const { P, T, n } = weld(m);
  const und = new Map<number, number>();
  const dir = new Map<number, number>();
  for (let t = 0; t < T.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = T[t + k]!;
      const b = T[t + ((k + 1) % 3)]!;
      if (a === b) continue;
      const u = Math.min(a, b) * n + Math.max(a, b);
      und.set(u, (und.get(u) ?? 0) + 1);
      const d = a * n + b;
      dir.set(d, (dir.get(d) ?? 0) + 1);
    }
  }
  let nonManifoldEdges = 0;
  for (const c of und.values()) if (c > 2) nonManifoldEdges++;
  let flippedEdges = 0;
  for (const c of dir.values()) if (c > 1) flippedEdges++;
  const loops = boundaryLoops(T, n);
  // Pieces (connected by shared vertices).
  const parent = new Int32Array(n).map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  for (let t = 0; t < T.length; t += 3) {
    const a = find(T[t]!);
    for (let k = 1; k < 3; k++) {
      const b = find(T[t + k]!);
      if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
    }
  }
  const pieceOf = new Int32Array(T.length / 3);
  const roots = new Set<number>();
  for (let t = 0; t < T.length / 3; t++) {
    pieceOf[t] = find(T[t * 3]!);
    roots.add(pieceOf[t]!);
  }
  // Self-intersection: an edge that passes through a non-adjacent triangle of its own piece.
  const bvh = new TriangleBVH(P, T);
  let selfIntersections = 0;
  const seen = new Set<number>();
  for (let t = 0; t < T.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = T[t + k]!;
      const b = T[t + ((k + 1) % 3)]!;
      const u = Math.min(a, b) * n + Math.max(a, b);
      if (seen.has(u)) continue;
      seen.add(u);
      const d = sub(P, b, a);
      const l = norm(d);
      if (l < 1e-9) continue;
      const piece = pieceOf[t / 3]!;
      const hit = bvh.raycast([P[a * 3]!, P[a * 3 + 1]!, P[a * 3 + 2]!], [d[0] / l, d[1] / l, d[2] / l], l * 1e-4, l * (1 - 1e-4), (h) => {
        const q = [T[h.triangle * 3]!, T[h.triangle * 3 + 1]!, T[h.triangle * 3 + 2]!];
        return pieceOf[h.triangle]! === piece && !q.includes(a) && !q.includes(b);
      });
      if (hit) selfIntersections++;
    }
  }
  return { nonManifoldEdges, flippedEdges, boundaryLoops: loops.length, selfIntersections, pieces: roots.size };
}

/** Boundary loops of a welded triangle mesh (vertex lists). */
function boundaryLoops(T: Uint32Array, n: number): number[][] {
  const half = new Set<number>();
  for (let t = 0; t < T.length; t += 3) for (let k = 0; k < 3; k++) half.add(T[t + k]! * n + T[t + ((k + 1) % 3)]!);
  const next = new Map<number, number[]>();
  for (const h of half) {
    const a = Math.floor(h / n);
    const b = h - a * n;
    if (!half.has(b * n + a)) next.set(a, [...(next.get(a) ?? []), b]);
  }
  const used = new Set<number>();
  const loops: number[][] = [];
  for (const s of [...next.keys()].sort((x, y) => x - y)) {
    for (const first of next.get(s)!) {
      if (used.has(s * n + first)) continue;
      used.add(s * n + first);
      const loop = [s];
      let cur = first;
      let guard = 0;
      while (cur !== s && guard++ < n) {
        loop.push(cur);
        const c = (next.get(cur) ?? []).find((x) => !used.has(cur * n + x));
        if (c === undefined) break;
        used.add(cur * n + c);
        cur = c;
      }
      if (loop.length >= 3) loops.push(loop);
    }
  }
  return loops;
}

export interface RimReport {
  loops: number;
  /** Shallowest edge profile over all loops (metres); Infinity with no open edges. */
  minDepth: number;
}

/**
 * Rim depth per boundary vertex: how far the edge's profile spans along the
 * cloth's normal within two edges of the boundary (a paper-thin hem spans
 * nothing, a rimmed hem its depth). The normal is the mean normal of the
 * triangles three to five edges away.
 */
export function rimReport(m: MeshInput): RimReport {
  const { P, T, n } = weld(m);
  const loops = boundaryLoops(T, n);
  if (!loops.length) return { loops: 0, minDepth: Infinity };
  const nb: Set<number>[] = Array.from({ length: n }, () => new Set());
  const vt: number[][] = Array.from({ length: n }, () => []);
  for (let t = 0; t < T.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      nb[T[t + k]!]!.add(T[t + ((k + 1) % 3)]!);
      nb[T[t + k]!]!.add(T[t + ((k + 2) % 3)]!);
      vt[T[t + k]!]!.push(t / 3);
    }
  }
  let minDepth = Infinity;
  for (const loop of loops) {
    for (const b of loop) {
      // Rings by hop distance.
      const hop = new Map<number, number>([[b, 0]]);
      let frontier = [b];
      for (let h = 1; h <= 5; h++) {
        const nextF: number[] = [];
        for (const v of frontier) for (const u of nb[v]!) if (!hop.has(u)) {
          hop.set(u, h);
          nextF.push(u);
        }
        frontier = nextF;
      }
      let nx = 0;
      let ny = 0;
      let nz = 0;
      for (const [v, h] of hop) {
        if (h < 3) continue;
        for (const t of vt[v]!) {
          const f = cross(sub(P, T[t * 3 + 1]!, T[t * 3]!), sub(P, T[t * 3 + 2]!, T[t * 3]!));
          nx += f[0];
          ny += f[1];
          nz += f[2];
        }
      }
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= l;
      ny /= l;
      nz /= l;
      let lo = 0;
      let hi = 0;
      for (const [v, h] of hop) {
        if (h > 2) continue;
        const d = (P[v * 3]! - P[b * 3]!) * nx + (P[v * 3 + 1]! - P[b * 3 + 1]!) * ny + (P[v * 3 + 2]! - P[b * 3 + 2]!) * nz;
        lo = Math.min(lo, d);
        hi = Math.max(hi, d);
      }
      minDepth = Math.min(minDepth, hi - lo);
    }
  }
  return { loops: loops.length, minDepth };
}

export interface EaseReport {
  /** Area-weighted mean distance from cloth to skin (metres). */
  mean: number;
  /** Share of the cloth's area closer to the skin than half the class minimum. */
  underHalf: number;
  samples: number;
}

/**
 * Cloth-to-skin distance at the garment's vertices (area weighted), skipping
 * vertices within two edges of an open edge (hem rims turn in by design) and
 * those farther than `maxGap` (brims, bags). `keep` filters further.
 */
export function easeReport(m: MeshInput, body: BodyInput, minEase: number, keep: (p: [number, number, number]) => boolean = () => true, maxGap = 0.12): EaseReport {
  const { P, T, n } = weld(m);
  const loops = boundaryLoops(T, n);
  const near = new Uint8Array(n);
  const nb: Set<number>[] = Array.from({ length: n }, () => new Set());
  for (let t = 0; t < T.length; t += 3) for (let k = 0; k < 3; k++) {
    nb[T[t + k]!]!.add(T[t + ((k + 1) % 3)]!);
    nb[T[t + k]!]!.add(T[t + ((k + 2) % 3)]!);
  }
  let frontier = loops.flat();
  for (const v of frontier) near[v] = 1;
  for (let h = 0; h < 2; h++) {
    const nextF: number[] = [];
    for (const v of frontier) for (const u of nb[v]!) if (!near[u]) {
      near[u] = 1;
      nextF.push(u);
    }
    frontier = nextF;
  }
  const area = new Float64Array(n);
  for (let t = 0; t < T.length; t += 3) {
    const a = norm(cross(sub(P, T[t + 1]!, T[t]!), sub(P, T[t + 2]!, T[t]!))) / 6;
    for (let k = 0; k < 3; k++) area[T[t + k]!] = area[T[t + k]!]! + a;
  }
  const bvh = new TriangleBVH(body.positions, body.indices);
  let sum = 0;
  let wsum = 0;
  let under = 0;
  let samples = 0;
  for (let v = 0; v < n; v++) {
    if (near[v]) continue;
    const p: [number, number, number] = [P[v * 3]!, P[v * 3 + 1]!, P[v * 3 + 2]!];
    if (!keep(p)) continue;
    const hit = bvh.closestPoint(p, maxGap);
    if (!hit) continue;
    const w = area[v]!;
    sum += hit.distance * w;
    wsum += w;
    if (hit.distance < minEase / 2) under += w;
    samples++;
  }
  return { mean: wsum > 0 ? sum / wsum : 0, underHalf: wsum > 0 ? under / wsum : 0, samples };
}

/**
 * Anatomy show-through: radius maps of the cloth and of the body from the
 * torso's (or a leg's) axis (`axisAt(y)` gives x and z) on a grid of
 * `angles` around and rows about `rowHeight` apart between y0 and y1. Each map is band-passed (a `fine`-cell box blur minus a
 * `blur`-cell one): what is left is the shape at the scale anatomy shows at
 * (muscle, the navel, nipples, shoulder blades, the spine's groove), without
 * the broad shape and without a low-poly mesh's facets. The result is the
 * cloth's energy over the body's (the PRD's Laplacian energy at that scale).
 * The cloth is measured on the smooth surface through its vertices (Phong
 * tessellation), so its facets do not count: on a large body a low-poly
 * garment's facets are as large as anatomy.
 */
export function showThrough(
  m: MeshInput,
  body: BodyInput,
  y0: number,
  y1: number,
  axisAt: (y: number) => [number, number],
  angles = 64,
  rowHeight = 0.006,
  blur = 4,
  fine = 1,
  dump?: (maps: { rg: Float64Array; rb: Float64Array; dg: Float64Array; db: Float64Array; angles: number; rows: number }) => void,
): { ratio: number; cells: number; cloth: number; body: number } {
  const rows = Math.max(2 * blur + 3, Math.round((y1 - y0) / rowHeight));
  const g = weld(m);
  // The cloth as the smooth surface its vertices and normals describe (as smooth shading shows it), not its
  // flat facets: a facet's flatness is the low-poly look, not anatomy.
  const smooth = phongRefine(g.P, mainCloth(g.T, g.n), 2);
  const gb = new TriangleBVH(smooth.P, smooth.T);
  const bb = new TriangleBVH(body.positions, body.indices);
  const rg = new Float64Array(angles * rows).fill(NaN);
  const rb = new Float64Array(angles * rows).fill(NaN);
  for (let j = 0; j < rows; j++) {
    const y = y0 + ((y1 - y0) * (j + 0.5)) / rows;
    const [cx, cz] = axisAt(y);
    for (let i = 0; i < angles; i++) {
      // Directions from a fixed table (no transcendental calls).
      const [dx, dz] = unitCircle(angles, i);
      const d = [dx, 0, dz];
      const o = [cx, y, cz];
      const hb = bb.raycast(o, d, 0, 0.6);
      const hg = gb.raycast(o, d, 0, 0.7);
      if (hb && hg) {
        rb[j * angles + i] = hb.t;
        rg[j * angles + i] = hg.t;
      }
    }
  }
  /** Box blur of a radius map, `w` cells each way (around in angle, clamped in height). */
  const box = (r: Float64Array, w: number): Float64Array => {
    const out = new Float64Array(r.length).fill(NaN);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < angles; i++) {
        if (!Number.isFinite(r[j * angles + i]!)) continue;
        // Only where the whole window is measured (no edge effects at the top, the bottom or a gap).
        let s = 0;
        let full = true;
        for (let dj = -w; dj <= w && full; dj++) {
          const jj = j + dj;
          if (jj < 0 || jj >= rows) {
            full = false;
            break;
          }
          for (let di = -w; di <= w; di++) {
            const v = r[jj * angles + ((i + di + angles) % angles)]!;
            if (!Number.isFinite(v)) {
              full = false;
              break;
            }
            s += v;
          }
        }
        if (full) out[j * angles + i] = s / ((2 * w + 1) * (2 * w + 1));
      }
    }
    return out;
  };
  // Band-pass: finer than the broad shape, coarser than a low-poly facet.
  const detail = (r: Float64Array): Float64Array => {
    const a = box(r, fine);
    const b = box(r, blur);
    return a.map((x, i) => x - b[i]!);
  };
  const dg = detail(rg);
  const db = detail(rb);
  if (dump) dump({ rg, rb, dg, db, angles, rows });
  let eg = 0;
  let eb = 0;
  let cells = 0;
  for (let i = 0; i < dg.length; i++) {
    if (!Number.isFinite(dg[i]!) || !Number.isFinite(db[i]!)) continue;
    eg += dg[i]! * dg[i]!;
    eb += db[i]! * db[i]!;
    cells++;
  }
  // Mean energies per cell (m^2), so maps of different sizes compare.
  return { ratio: eb > 0 ? eg / eb : 0, cells, cloth: cells ? eg / cells : 0, body: cells ? eb / cells : 0 };
}

const circles = new Map<number, [number, number][]>();
/** Points on the unit circle at i/k turns, built by repeated rotation from cos and sin of 1/k turn by bisection (deterministic). */
function unitCircle(k: number, i: number): [number, number] {
  let table = circles.get(k);
  if (!table) {
    // cos/sin of the step by halving from known angles: computed with the dmath-free half-angle recurrence.
    const step = halfAngles(k);
    table = [];
    let c = 1;
    let s = 0;
    for (let j = 0; j < k; j++) {
      table.push([s, c]);
      const nc = c * step[0] - s * step[1];
      const ns = s * step[0] + c * step[1];
      c = nc;
      s = ns;
    }
    circles.set(k, table);
  }
  return table[i % k]!;
}

/** cos and sin of 2*pi/k for k = 2^a * 3^b (24, 32, 48, 64, 96 ...), from exact values and half angles. */
function halfAngles(k: number): [number, number] {
  let c: number;
  let s: number;
  let n: number;
  if (k % 3 === 0) {
    c = -0.5; // 120 degrees
    s = Math.sqrt(3) / 2;
    n = 3;
  } else {
    c = -1;
    s = 0;
    n = 2;
  }
  while (n < k) {
    // Half angle: cos(x/2) = sqrt((1 + cos x) / 2), sin(x/2) = sin x / (2 cos(x/2)), in the first half turn.
    const ch = Math.sqrt((1 + c) / 2);
    s = n === 2 ? 1 : s / (2 * ch);
    c = ch;
    n *= 2;
  }
  if (n !== k) throw new Error(`unitCircle: ${k} angles are not supported`);
  return [c, s];
}

/**
 * Silhouette smoothness: the main cloth cut by horizontal planes between y0
 * and y1 (`rows` of them). Along each cut around one of the `axes` (the
 * torso's, the legs'), corners at least `merge` apart (1.2 cm), and the turn
 * at each (degrees): the sharpest, and the 95th percentile. A smooth low-poly
 * garment turns a little at each facet edge; a kink or a bump turns sharply.
 */
export function silhouetteTurn(
  m: MeshInput,
  y0: number,
  y1: number,
  axes: ((y: number) => [number, number])[] = [],
  rows = 16,
  minLength = 0.25,
  merge = 0.012,
): { maxDegrees: number; p95: number; corners: number; at: number; where: [number, number, number] | null } {
  const { P, T, n } = weld(m);
  const M = mainCloth(T, n);
  let worst = 0;
  let at = NaN;
  let where: [number, number, number] | null = null;
  const all: number[] = [];
  for (let r = 0; r < rows; r++) {
    const y = y0 + ((y1 - y0) * (r + 0.5)) / rows;
    const chains = sliceChains(P, M, y);
    const centres = axes.map((f) => f(y));
    for (const chain of chains) {
      if (centres.length && !centres.some((c) => inside(chain.points, c[0], c[1]))) continue;
      if (polyLength(chain.points, chain.closed) < minLength) continue;
      // Corners closer than `merge` count as one (cuts through near-vertices, sub-centimetre jitter).
      const pts: [number, number][] = [];
      for (const q of chain.points) {
        const last = pts[pts.length - 1];
        if (!last || hypot(q[0] - last[0], q[1] - last[1]) >= merge) pts.push(q);
      }
      if (chain.closed && pts.length > 2 && hypot(pts[0]![0] - pts[pts.length - 1]![0], pts[0]![1] - pts[pts.length - 1]![1]) < merge) pts.pop();
      const k = pts.length;
      if (k < 4) continue;
      for (let i = 0; i < k; i++) {
        if (!chain.closed && (i === 0 || i === k - 1)) continue;
        const a = pts[(i + k - 1) % k]!;
        const b = pts[i]!;
        const c = pts[(i + 1) % k]!;
        const ux = b[0] - a[0];
        const uz = b[1] - a[1];
        const vx = c[0] - b[0];
        const vz = c[1] - b[1];
        const lu = hypot(ux, uz);
        const lv = hypot(vx, vz);
        if (lu < 1e-9 || lv < 1e-9) continue;
        const cos = Math.max(-1, Math.min(1, (ux * vx + uz * vz) / (lu * lv)));
        const deg = acos(cos) / DEG;
        all.push(deg);
        if (deg > worst) {
          worst = deg;
          at = y;
          where = [b[0], y, b[1]];
        }
      }
    }
  }
  all.sort((x, y) => x - y);
  const p95 = all.length ? all[Math.min(all.length - 1, Math.floor(all.length * 0.95))]! : 0;
  return { maxDegrees: worst, p95, corners: all.length, at, where };
}

/** Diagnostics for tests: called with the cut at each new sharpest turn. */
/** Point in polygon (even-odd), the polygon closed by its last edge. */
function inside(p: [number, number][], x: number, z: number): boolean {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const a = p[i]!;
    const b = p[j]!;
    if (a[1] > z !== b[1] > z && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

function polyLength(p: [number, number][], closed: boolean): number {
  let l = 0;
  for (let i = 0; i + 1 < p.length; i++) l += hypot(p[i + 1]![0] - p[i]![0], p[i + 1]![1] - p[i]![1]);
  if (closed && p.length > 1) l += hypot(p[0]![0] - p[p.length - 1]![0], p[0]![1] - p[p.length - 1]![1]);
  return l;
}

/** Cut a mesh with the plane y: polylines in (x, z), closed or open. */
function sliceChains(P: Float64Array, T: Uint32Array, y: number): { points: [number, number][]; closed: boolean }[] {
  // Each crossing edge gives a point; a triangle links its two crossing edges.
  const pointOf = new Map<number, [number, number]>();
  const links = new Map<number, number[]>();
  const n = P.length / 3;
  const edge = (a: number, b: number) => Math.min(a, b) * n + Math.max(a, b);
  for (let t = 0; t < T.length; t += 3) {
    const crossing: number[] = [];
    for (let k = 0; k < 3; k++) {
      const a = T[t + k]!;
      const b = T[t + ((k + 1) % 3)]!;
      const ya = P[a * 3 + 1]! - y;
      const yb = P[b * 3 + 1]! - y;
      if ((ya < 0) === (yb < 0)) continue;
      const e = edge(a, b);
      if (!pointOf.has(e)) {
        const f = ya / (ya - yb);
        pointOf.set(e, [P[a * 3]! + (P[b * 3]! - P[a * 3]!) * f, P[a * 3 + 2]! + (P[b * 3 + 2]! - P[a * 3 + 2]!) * f]);
      }
      crossing.push(e);
    }
    if (crossing.length === 2) {
      const [e1, e2] = crossing as [number, number];
      links.set(e1, [...(links.get(e1) ?? []), e2]);
      links.set(e2, [...(links.get(e2) ?? []), e1]);
    }
  }
  const used = new Set<number>();
  const chains: { points: [number, number][]; closed: boolean }[] = [];
  const starts = [...links.keys()].sort((a, b) => (links.get(a)!.length - links.get(b)!.length) || a - b);
  for (const s of starts) {
    if (used.has(s)) continue;
    const order = [s];
    used.add(s);
    let cur = s;
    for (;;) {
      const nextE = (links.get(cur) ?? []).find((e) => !used.has(e));
      if (nextE === undefined) break;
      used.add(nextE);
      order.push(nextE);
      cur = nextE;
    }
    const closed = order.length > 2 && (links.get(cur) ?? []).includes(s);
    chains.push({ points: order.map((e) => pointOf.get(e)!), closed });
  }
  return chains;
}

type Surface = { closest(p: ArrayLike<number>, max: number): unknown; signedDistance(p: ArrayLike<number>, hit: never): number };

/**
 * Deepest garment vertex inside the visible body (metres, 0 = none), as M4
 * measures poke-through. With `whole` (the closed body, hidden faces
 * included), a vertex counts only if it is inside that too: a scrap of skin
 * left visible inside a garment (between the toes, under a sock) has nothing
 * behind it, and cloth behind it is not in the body.
 */
export function pokeThroughDepth(garment: MeshInput, surface: Surface, whole?: Surface): number {
  let depth = 0;
  const P = garment.positions;
  const p = [0, 0, 0];
  for (let v = 0; v < P.length / 3; v++) {
    p[0] = P[v * 3]!;
    p[1] = P[v * 3 + 1]!;
    p[2] = P[v * 3 + 2]!;
    const hit = surface.closest(p, 0.03);
    if (!hit) continue;
    let d = -surface.signedDistance(p, hit as never);
    if (d > 0 && whole) {
      const w = whole.closest(p, 0.1);
      d = w ? Math.min(d, -whole.signedDistance(p, w as never)) : 0;
    }
    depth = Math.max(depth, d);
  }
  return depth;
}
