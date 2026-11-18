/**
 * Garment features (PRD Part 3, F28 step 6 and section 5.0): the rim every
 * boundary loop gets, so cloth never looks like paper; boot soles; cap brims;
 * patch pockets. Rims and soles continue the cloth's own surface; brims and
 * pockets are separate pieces laid over it, as in era character art.
 */
import { hypot } from '../../math/dmath';
import { TriangleBVH } from '../../mesh/bvh';
import type { ShellBody } from './body';
import { FIXED, PART, RIM, type WorkMesh } from './mesh';
import { bodyDistance, hull2d } from './shape';
import { add, cross, dot, len as len3, normalize, reject, scale, sub, type Vec3 } from './vec';

/** Every visible edge is at least this deep (5.0). */
export const MIN_RIM_DEPTH = 0.005;

export interface RimResult {
  hem: number;
  /** Depth reached at its shallowest point (metres). */
  minDepth: number;
  /** The rim's inner edge (the garment's open edge now). */
  loop: number[];
  /** The rim's lip, point for point with `loop`. */
  lips: number[];
}

/** Majority hem (constraint) of a loop, ignoring unknown vertices. */
export function loopHem(m: WorkMesh, loop: readonly number[]): number {
  const count = new Map<number, number>();
  for (const v of loop) if (m.hem[v]! >= 0) count.set(m.hem[v]!, (count.get(m.hem[v]!) ?? 0) + 1);
  let best = -1;
  let bestN = 0;
  for (const [h, c] of [...count.entries()].sort((a, b) => a[0] - b[0])) {
    if (c > bestN) {
      best = h;
      bestN = c;
    }
  }
  return best;
}

/**
 * With `countOnly`, the same vertices and triangles without measuring
 * anything (how many triangles the finished garment will have).
 *
 * Turn every open boundary loop inwards: a rounded two-segment profile
 * `depth` deep (towards the body), so a hem reads as cloth with thickness.
 * Where the skin is closer than that, the inner edge stops short of it and
 * the profile rolls outwards for the rest of the depth.
 */
export function addRims(m: WorkMesh, body: ShellBody, depthOf: (hem: number) => number, countOnly = false): RimResult[] {
  const loops = m.boundaryLoops();
  const N = m.shapeNormals();
  const nb = m.neighbours();
  // The cloth itself, before any rim: a rim turning in must not pass through it (at the side of the neck, the
  // shoulder's cloth is just under the neckline).
  const cloth = new TriangleBVH(Float64Array.from(m.pos), Uint32Array.from(m.tris));
  const clothTris = Uint32Array.from(m.tris);
  const vt: number[][] = Array.from({ length: m.vertexCount }, () => []);
  for (let t = 0; t < m.triangleCount; t++) for (let k = 0; k < 3; k++) vt[m.tris[t * 3 + k]!]!.push(t);
  const seen = new Set<number>();
  const out: RimResult[] = [];
  const strips: Strip[] = [];
  for (const loop of loops) {
    const hem = loopHem(m, loop);
    const want = depthOf(hem);
    const L = loop.length;
    const onLoop = new Set(loop);
    const A: number[] = [];
    const B: number[] = [];
    const cuffs: [Vec3, Vec3][] = [];
    let minDepth = Infinity;
    // Outward directions along the loop, smoothed, and none at sharp corners (where they would cross).
    const raw: Vec3[] = loop.map((v, i) => {
      const p = m.p(v);
      const n: Vec3 = [N[v * 3]!, N[v * 3 + 1]!, N[v * 3 + 2]!];
      const tau = normalize(sub(m.p(loop[(i + 1) % L]!), m.p(loop[(i + L - 1) % L]!)));
      let h = normalize(cross(tau, n));
      // Away from the cloth: opposite to the vertex's inner neighbours.
      let inner: Vec3 = [0, 0, 0];
      let count = 0;
      for (const u of nb[v]!) {
        if (onLoop.has(u)) continue;
        inner = add(inner, m.p(u));
        count++;
      }
      if (count > 0 && dot(h, sub(p, scale(inner, 1 / count))) < 0) h = scale(h, -1);
      const e1 = normalize(sub(p, m.p(loop[(i + L - 1) % L]!)));
      const e2 = normalize(sub(m.p(loop[(i + 1) % L]!), p));
      return dot(e1, e2) < 0.5 ? [0, 0, 0] : h;
    });
    const hs = raw.map((h, i) => normalize(add(add(scale(raw[(i + L - 1) % L]!, 0.25), scale(h, 0.5)), scale(raw[(i + 1) % L]!, 0.25))));
    // The cloth's normal along the loop over two rings of triangles (area-weighted: thin slivers a decimated
    // edge leaves along it do not steer it), smoothed twice: where it turns fast (the side of the neck) the strip would twist.
    let ns: Vec3[] = loop.map((v) => {
      const ring = new Set([v, ...nb[v]!]);
      for (const u of nb[v]!) for (const w of nb[u]!) ring.add(w);
      let s: Vec3 = [0, 0, 0];
      for (const u of ring) for (const t of vt[u]!) if (!seen.has(t)) {
        seen.add(t);
        s = add(s, faceCross(m, t));
      }
      seen.clear();
      return len3(s) > 0 ? normalize(s) : ([N[v * 3]!, N[v * 3 + 1]!, N[v * 3 + 2]!] as Vec3);
    });
    for (let pass = 0; pass < 2; pass++) ns = ns.map((x, i) => normalize(add(add(scale(ns[(i + L - 1) % L]!, 0.25), scale(x, 0.5)), scale(ns[(i + 1) % L]!, 0.25))));
    for (let i = 0; i < L; i++) {
      const v = loop[i]!;
      const p = m.p(v);
      const n = ns[i]!;
      // No lean at a corner (where two hems meet) nor beside it: leaning two ways there, the strips would cross.
      const corner = [raw[(i + L - 1) % L]!, raw[i]!, raw[(i + 1) % L]!].some((x) => len3(x) === 0);
      const h = corner ? ([0, 0, 0] as Vec3) : normalize(reject(hs[i]!, n));
      // Inward as far as the skin allows; the rest of the depth becomes a rolled lip outwards,
      // so tight cloth (gloves, leggings) still has a thick edge.
      // Fixed hems too (a trouser leg's level hem over a high instep): the rim turns in only as far as the skin allows.
      const gap = countOnly ? want : (bodyDistance(body, p, 0.2, want + 0.002)?.d ?? want + 0.01) - 0.0015;
      // Any cloth but the vertex's own triangles: right under a decimated edge the cloth can bend in steeply.
      const self = countOnly ? null : cloth.raycast(p, scale(n, -1), 0.0005, want + 0.01, (hit) => ![0, 1, 2].some((k) => clothTris[hit.triangle * 3 + k] === v));
      const d = want;
      let inward = Math.max(0.0005, Math.min(d, gap, self ? 0.5 * self.t : Infinity));
      let out = d - inward;
      minDepth = Math.min(minDepth, d);
      const seg = m.seg[v]!;
      m.flags[v] = m.flags[v]! | RIM;
      // The profile keeps moving away from the cloth (along h): out to the lip, then in beyond it, never back
      // under it, so neighbouring profiles that twist (the side of the neck) do not cross.
      const profile = (s: number): [Vec3, Vec3] => [
        add(p, add(scale(h, 0.3 * d * s), scale(n, out - 0.25 * inward))),
        add(p, add(scale(h, (0.2 * d + 0.6 * out) * s), scale(n, -inward))),
      ];
      let [pa, pb] = profile(1);
      // Where skin is there (a hood's opening under the chin) the profile leans less, then turns in less.
      if (!countOnly) {
        const clear = (q: Vec3) => (bodyDistance(body, q, 0.05, 0.0015)?.d ?? 1) >= 0.0015;
        for (const [s, k] of [[1, 1], [0.6, 1], [0.35, 1], [0.35, 0.5], [0.35, 0]] as const) {
          inward = Math.max(0.0005, Math.min(d, gap, self ? 0.5 * self.t : Infinity) * k);
          out = d - inward;
          [pa, pb] = profile(s);
          if (clear(pa) && clear(pb)) break;
        }
      }
      const a = m.addVertex(pa, n, seg, RIM | (m.flags[v]! & FIXED), -1, m.ease[v]!);
      const b = m.addVertex(pb, n, seg, RIM | (m.flags[v]! & FIXED), -1, m.ease[v]! - inward);
      m.hem[a] = hem;
      m.hem[b] = hem;
      m.dist[a] = 0;
      m.dist[b] = 0;
      A.push(a);
      B.push(b);
      cuffs.push([add(p, add(scale(h, 0.2 * d), scale(n, 0.55 * d))), add(p, add(scale(h, 0.4 * d), scale(n, 1.05 * d)))]);
    }
    strips.push({ loop, A, B, turned: A.map((a, i) => [m.p(a), m.p(B[i]!)] as [Vec3, Vec3]), cuffs, w: new Float64Array(L) });
    // Panel of the triangle on the inside of each loop edge.
    const edgePanel = panelsOfEdges(m, loop);
    for (let i = 0; i < L; i++) {
      const j = (i + 1) % L;
      const panel = edgePanel[i]!;
      m.addTri(loop[j]!, loop[i]!, A[i]!, panel);
      m.addTri(loop[j]!, A[i]!, A[j]!, panel);
      m.addTri(A[j]!, A[i]!, B[i]!, panel);
      m.addTri(A[j]!, B[i]!, B[j]!, panel);
    }
    out.push({ hem, minDepth, loop: B, lips: A });
  }
  if (!countOnly) cuffWhereCrossing(m, strips);
  return out;
}

/** One loop's rim: its lip and inner-edge vertices, their turned-in and cuff positions, and how far each is a cuff. */
interface Strip {
  loop: readonly number[];
  A: number[];
  B: number[];
  turned: [Vec3, Vec3][];
  cuffs: [Vec3, Vec3][];
  w: Float64Array;
}

/**
 * Where a rim still passes through cloth (right under a decimated edge the
 * cloth can curl in, where the turned-in rim goes), that part of the rim
 * loop turns out instead: a cuff over the outside of the hem, `depth` proud
 * of the cloth. Where even that crosses, the cloth folds at the hem itself (a
 * corner where two hems meet): the hem vertices there relax towards their
 * neighbours. A few rounds; positions only.
 */
function cuffWhereCrossing(m: WorkMesh, strips: Strip[]): void {
  const where = new Map<number, [number, number]>();
  const strip = new Set<number>();
  strips.forEach((st, k) => st.A.forEach((a, i) => {
    where.set(a, [k, i]);
    where.set(st.B[i]!, [k, i]);
    where.set(st.loop[i]!, [k, i]);
    strip.add(a);
    strip.add(st.B[i]!);
  }));
  const nb = m.neighbours();
  const T = m.tris;
  const subset = (keep: (t: number) => boolean) => {
    const list: number[] = [];
    for (let t = 0; t < m.triangleCount; t++) if (keep(t)) list.push(T[t * 3]!, T[t * 3 + 1]!, T[t * 3 + 2]!);
    return Uint32Array.from(list);
  };
  // Crossings that involve a rim: any edge through a triangle at a rim, or an edge at a rim through any triangle.
  const nearTris = subset((t) => where.has(T[t * 3]!) || where.has(T[t * 3 + 1]!) || where.has(T[t * 3 + 2]!));
  // After the first round, only what moved can newly cross or stop crossing: edges with a moved end against
  // everything, and every edge against the triangles with a moved corner.
  let changed: Uint8Array | null = null;
  for (let round = 0; round < 16; round++) {
    const hits = new Set<number>();
    const pos = Float64Array.from(m.pos);
    const all = new TriangleBVH(pos, Uint32Array.from(T));
    const ch = changed;
    const movedTris = ch ? subset((t) => ch[T[t * 3]!] === 1 || ch[T[t * 3 + 1]!] === 1 || ch[T[t * 3 + 2]!] === 1) : nearTris;
    const rimBvh = new TriangleBVH(pos, movedTris);
    const cast = (bvh: TriangleBVH, tris: ArrayLike<number>, a: number, b: number) => {
      const pa = m.p(a);
      const e = sub(m.p(b), pa);
      const l = len3(e);
      if (l < 1e-9) return;
      const hit = bvh.raycast(pa, scale(e, 1 / l), l * 1e-4, l * (1 - 1e-4), (h) => {
        const q = [tris[h.triangle * 3]!, tris[h.triangle * 3 + 1]!, tris[h.triangle * 3 + 2]!];
        return !q.includes(a) && !q.includes(b);
      });
      if (!hit) return;
      for (const v of [a, b, tris[hit.triangle * 3]!, tris[hit.triangle * 3 + 1]!, tris[hit.triangle * 3 + 2]!]) if (where.has(v)) hits.add(v);
    };
    for (let t = 0; t < m.triangleCount; t++) {
      for (let k = 0; k < 3; k++) {
        const a = T[t * 3 + k]!;
        const b = T[t * 3 + ((k + 1) % 3)]!;
        if (a > b) continue;
        if (ch ? ch[a] === 1 || ch[b] === 1 : where.has(a) || where.has(b)) cast(all, T, a, b);
        else cast(rimBvh, movedTris, a, b);
      }
    }
    if (!hits.size) return;
    const before = Float64Array.from(m.pos);
    const marks: [number, number][] = [];
    for (const v of hits) marks.push(where.get(v)!);
    marks.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    if (round >= 4) {
      // Still crossing as a cuff: the cloth itself folds at the hem there (where two hems meet at a corner). The hem
      // vertex goes half way to the middle of its neighbours (its rim with it), and the ones beside it.
      const moves = new Map<number, [number, number]>();
      for (const [k, i] of marks) {
        const L = strips[k]!.loop.length;
        for (const j of [(i + L - 1) % L, i, (i + 1) % L]) moves.set(k * 1_000_000 + j, [k, j]);
      }
      for (const [k, i] of [...moves.values()].sort((x, y) => x[0] - y[0] || x[1] - y[1])) {
        const st = strips[k]!;
        const v = st.loop[i]!;
        if (m.flags[v]! & FIXED) continue;
        let c: Vec3 = [0, 0, 0];
        let count = 0;
        for (const u of nb[v]!) {
          if (strip.has(u)) continue;
          c = add(c, m.p(u));
          count++;
        }
        if (!count) continue;
        const delta = scale(sub(scale(c, 1 / count), m.p(v)), 0.5);
        for (const x of [v, st.A[i]!, st.B[i]!]) m.setP(x, add(m.p(x), delta));
        // And the cloth beside it, half way to the middle of its own neighbours (the fold is in the cloth too).
        if (round >= 8) {
          for (const u of nb[v]!) {
            if (strip.has(u) || where.has(u) || m.flags[u]! & FIXED) continue;
            let cu: Vec3 = [0, 0, 0];
            for (const w of nb[u]!) cu = add(cu, m.p(w));
            m.setP(u, add(m.p(u), scale(sub(scale(cu, 1 / nb[u]!.length), m.p(u)), 0.5)));
          }
        }
      }
      changed = movedSince(m, before, hits);
      continue;
    }
    // The whole loop turns out: profiles of both kinds side by side would cross each other.
    for (const [k] of marks) strips[k]!.w.fill(1);
    for (const st of strips) {
      for (let i = 0; i < st.A.length; i++) {
        const w = st.w[i]!;
        if (w === 0) continue;
        const [ta, tb] = st.turned[i]!;
        const [ca, cb] = st.cuffs[i]!;
        m.setP(st.A[i]!, add(scale(ta, 1 - w), scale(ca, w)));
        m.setP(st.B[i]!, add(scale(tb, 1 - w), scale(cb, w)));
      }
    }
    changed = movedSince(m, before, hits);
  }
}

/** Vertices whose position differs from `before`, and `also` (where a crossing was: it may stay). */
function movedSince(m: WorkMesh, before: Float64Array, also: Iterable<number>): Uint8Array {
  const out = new Uint8Array(m.vertexCount);
  for (const v of also) out[v] = 1;
  for (let v = 0; v < m.vertexCount; v++) {
    if (m.pos[v * 3] !== before[v * 3] || m.pos[v * 3 + 1] !== before[v * 3 + 1] || m.pos[v * 3 + 2] !== before[v * 3 + 2]) out[v] = 1;
  }
  return out;
}

/** For each edge (loop[i], loop[i+1]) of a boundary loop, the panel of the triangle that has it. */
export function panelsOfEdges(m: WorkMesh, loop: readonly number[]): number[] {
  const N = m.vertexCount;
  const owner = new Map<number, number>();
  for (let t = 0; t < m.triangleCount; t++) {
    for (let k = 0; k < 3; k++) owner.set(m.tris[t * 3 + k]! * N + m.tris[t * 3 + ((k + 1) % 3)]!, m.panel[t]!);
  }
  return loop.map((v, i) => owner.get(v * N + loop[(i + 1) % loop.length]!) ?? 0);
}

/** Ear clipping of a simple polygon given in 2D; returns triangles (indices into the polygon) wound like the polygon. */
export function earClip(xs: number[], ys: number[]): number[] {
  const n = xs.length;
  const idx = Array.from({ length: n }, (_, i) => i);
  let area = 0;
  for (let i = 0; i < n; i++) area += xs[i]! * ys[(i + 1) % n]! - xs[(i + 1) % n]! * ys[i]!;
  const ccw = area > 0;
  const cr = (a: number, b: number, c: number) => (xs[b]! - xs[a]!) * (ys[c]! - ys[a]!) - (ys[b]! - ys[a]!) * (xs[c]! - xs[a]!);
  const inside = (p: number, a: number, b: number, c: number) => {
    const d1 = cr(a, b, p);
    const d2 = cr(b, c, p);
    const d3 = cr(c, a, p);
    return ccw ? d1 > 0 && d2 > 0 && d3 > 0 : d1 < 0 && d2 < 0 && d3 < 0;
  };
  const out: number[] = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < n * n) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const a = idx[(i + idx.length - 1) % idx.length]!;
      const b = idx[i]!;
      const c = idx[(i + 1) % idx.length]!;
      const convex = ccw ? cr(a, b, c) > 0 : cr(a, b, c) < 0;
      if (!convex) continue;
      if (idx.some((p) => p !== a && p !== b && p !== c && inside(p, a, b, c))) continue;
      out.push(a, b, c);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  // Whatever is left (degenerate input) becomes a fan.
  for (let i = 1; i + 1 < idx.length; i++) out.push(idx[0]!, idx[i]!, idx[i + 1]!);
  return out;
}

/**
 * A boot sole: a slab under the boot whose outline is the convex footprint of
 * the boot's upper (its vertices of `segments` within 1 cm of the floor),
 * `welt` wider, from the ground to `top` with a small bevel, closed top and
 * bottom. The upper's flattened underside rests on it. Panel 'sole'.
 */
export function addSoleSlab(m: WorkMesh, segments: readonly number[], top: number, ground: number, weltIn: number, seg: number, points = 28, simple = false): boolean {
  let welt = weltIn;
  const xs: number[] = [];
  const zs: number[] = [];
  for (let v = 0; v < m.vertexCount; v++) {
    if (!segments.includes(m.seg[v]!) || m.pos[v * 3 + 1]! > top + 0.012) continue;
    xs.push(m.pos[v * 3]!);
    zs.push(m.pos[v * 3 + 2]!);
  }
  if (xs.length < 3) return false;
  const h = hull2d(xs, zs);
  const hx = h.map((i) => xs[i]!);
  const hz = h.map((i) => zs[i]!);
  // Resample the hull evenly by length, starting at its first point (deterministic).
  const K = hx.length;
  const seglen = hx.map((_, i) => hypot(hx[(i + 1) % K]! - hx[i]!, hz[(i + 1) % K]! - hz[i]!));
  const total = seglen.reduce((x, y) => x + y, 0);
  const ox: number[] = [];
  const oz: number[] = [];
  let i = 0;
  let acc = 0;
  for (let k = 0; k < points; k++) {
    const target = (k / points) * total;
    while (acc + seglen[i]! < target && i < K - 1) {
      acc += seglen[i]!;
      i++;
    }
    const f = seglen[i]! > 0 ? (target - acc) / seglen[i]! : 0;
    ox.push(hx[i]! + (hx[(i + 1) % K]! - hx[i]!) * f);
    oz.push(hz[i]! + (hz[(i + 1) % K]! - hz[i]!) * f);
  }
  // Outward normals of the (counter-clockwise) outline.
  const nx: number[] = [];
  const nz: number[] = [];
  for (let k = 0; k < points; k++) {
    const px = ox[(k + points - 1) % points]!;
    const pz = oz[(k + points - 1) % points]!;
    const qx = ox[(k + 1) % points]!;
    const qz = oz[(k + 1) % points]!;
    let ex = qz - pz;
    let ez = -(qx - px);
    const l = hypot(ex, ez) || 1;
    ex /= l;
    ez /= l;
    nx.push(ex);
    nz.push(ez);
  }
  // A chord of the resampled outline cuts inside the hull by at most its sag: grow by that much.
  let sag = 0;
  for (let k = 0; k < points; k++) {
    const ax = ox[k]!;
    const az = oz[k]!;
    const bx = ox[(k + 1) % points]!;
    const bz = oz[(k + 1) % points]!;
    const lx = bx - ax;
    const lz = bz - az;
    const l2 = lx * lx + lz * lz;
    for (let i = 0; i < hx.length; i++) {
      const t = ((hx[i]! - ax) * lx + (hz[i]! - az) * lz) / Math.max(1e-12, l2);
      if (t <= 0 || t >= 1) continue;
      const d = Math.abs((hx[i]! - ax) * lz - (hz[i]! - az) * lx) / Math.sqrt(Math.max(1e-12, l2));
      sag = Math.max(sag, d);
    }
  }
  welt += Math.min(0.01, sag);
  // Make the normals point away from the centre.
  let cx = 0;
  let cz = 0;
  for (let k = 0; k < points; k++) {
    cx += ox[k]!;
    cz += oz[k]!;
  }
  cx /= points;
  cz /= points;
  const flip = (ox[0]! - cx) * nx[0]! + (oz[0]! - cz) * nz[0]! < 0 ? -1 : 1;
  const panel = m.panelId('sole');
  const ring = (y: number, out: number): number[] =>
    ox.map((x, k) => m.addVertex([x + flip * nx[k]! * out, y, oz[k]! + flip * nz[k]! * out], [flip * nx[k]!, 0, flip * nz[k]!], seg, PART | FIXED));
  // The top edge rises a little over the upper's foot (a welt lip), so no gap shows between them.
  const lip = Math.max(0.001, welt - 0.002);
  const rings = simple
    ? [ring(top + 0.007, lip), ring(top, welt), ring(ground, welt)]
    : [ring(top + 0.007, lip), ring(top, welt), ring(ground + 0.004, welt), ring(ground, welt - 0.002)];
  // Which way the outline runs: its signed area (three points of it can lie on one straight side).
  let up = 0;
  for (let k = 0; k < points; k++) up += oz[k]! * ox[(k + 1) % points]! - ox[k]! * oz[(k + 1) % points]!;
  for (let r = 0; r + 1 < rings.length; r++) {
    const A = rings[r]!;
    const B = rings[r + 1]!;
    for (let k = 0; k < points; k++) {
      const j = (k + 1) % points;
      // Side walls face outwards whichever way the outline runs.
      if (up > 0) {
        m.addTri(A[k]!, B[k]!, B[j]!, panel);
        m.addTri(A[k]!, B[j]!, A[j]!, panel);
      } else {
        m.addTri(A[k]!, B[j]!, B[k]!, panel);
        m.addTri(A[k]!, A[j]!, B[j]!, panel);
      }
    }
  }
  // Caps: fans around a centre vertex (the outline is convex), the same triangles on every body.
  addFanCap(m, rings[rings.length - 1]!, panel, -1, seg);
  addFanCap(m, rings[0]!, panel, 1, seg);
  return true;
}

/** Close a convex loop with a fan around its centre, facing up (+1) or down (-1). */
export function addFanCap(m: WorkMesh, ring: readonly number[], panel: number, facing: 1 | -1, seg = -1): void {
  let c: Vec3 = [0, 0, 0];
  for (const v of ring) c = add(c, m.p(v));
  c = scale(c, 1 / ring.length);
  const centre = m.addVertex(c, [0, facing, 0], seg, PART | FIXED);
  const K = ring.length;
  for (let k = 0; k < K; k++) {
    const a = ring[k]!;
    const b = ring[(k + 1) % K]!;
    const ny = cross(sub(m.p(a), c), sub(m.p(b), c))[1];
    if (ny * facing >= 0) m.addTri(centre, a, b, panel);
    else m.addTri(centre, b, a, panel);
  }
}

/** Closest-point queries on the garment's own surface (pockets, brims). */
export function surfaceOf(m: WorkMesh): { bvh: TriangleBVH; pos: Float64Array; nrm: Float64Array; tris: Uint32Array } {
  const pos = Float64Array.from(m.pos);
  const tris = Uint32Array.from(m.tris);
  return { bvh: new TriangleBVH(pos, tris), pos, nrm: m.shapeNormals(), tris };
}

function closestOn(s: ReturnType<typeof surfaceOf>, p: Vec3): { q: Vec3; n: Vec3 } | null {
  const hit = s.bvh.closestPoint(p, 0.2);
  if (!hit) return null;
  const T = s.tris;
  const [wa, wb, wc] = hit.bary;
  const a = T[hit.triangle * 3]!;
  const b = T[hit.triangle * 3 + 1]!;
  const c = T[hit.triangle * 3 + 2]!;
  const N = s.nrm;
  const n = normalize([N[a * 3]! * wa + N[b * 3]! * wb + N[c * 3]! * wc, N[a * 3 + 1]! * wa + N[b * 3 + 1]! * wb + N[c * 3 + 1]! * wc, N[a * 3 + 2]! * wa + N[b * 3 + 2]! * wb + N[c * 3 + 2]! * wc]);
  return { q: [hit.point[0], hit.point[1], hit.point[2]], n };
}

export interface PatchOptions {
  /** Centre on (or near) the garment. */
  centre: Vec3;
  /** Up direction of the patch on the garment. */
  up: Vec3;
  width: number;
  height: number;
  /** How far the patch stands off the cloth. */
  thickness: number;
  /** Optional flap over the top (share of the height). */
  flap?: number;
  name: string;
}

/**
 * A patch pocket: a 4 x 4 grid conformed to the garment's surface, standing
 * `thickness` off it, with side walls that tuck just under the cloth, so it
 * reads as a solid piece. A flap is a second, slightly wider and thicker
 * patch over the top.
 */
export function addPatch(m: WorkMesh, s: ReturnType<typeof surfaceOf>, o: PatchOptions): boolean {
  const at = closestOn(s, o.centre);
  if (!at) return false;
  const panel = m.panelId(o.name);
  const build = (centre: Vec3, w: number, h: number, thick: number): void => {
    const n = at.n;
    const right = normalize(cross(o.up, n));
    const up = normalize(cross(n, right));
    const G = 3;
    const top: number[][] = [];
    const base: number[][] = [];
    for (let j = 0; j <= G; j++) {
      const trow: number[] = [];
      const brow: number[] = [];
      for (let i = 0; i <= G; i++) {
        const p = add(centre, add(scale(right, (i / G - 0.5) * w), scale(up, (j / G - 0.5) * h)));
        const hit = closestOn(s, p) ?? { q: p, n };
        trow.push(m.addVertex(add(hit.q, scale(hit.n, thick)), hit.n, -1, PART | FIXED));
        brow.push(m.addVertex(add(hit.q, scale(hit.n, 0.0004)), hit.n, -1, PART | FIXED));
      }
      top.push(trow);
      base.push(brow);
    }
    for (let j = 0; j < G; j++) {
      for (let i = 0; i < G; i++) {
        m.addTri(top[j]![i]!, top[j]![i + 1]!, top[j + 1]![i + 1]!, panel);
        m.addTri(top[j]![i]!, top[j + 1]![i + 1]!, top[j + 1]![i]!, panel);
        // The underside (facing the cloth) closes the pocket: a solid piece, no open edge.
        m.addTri(base[j]![i]!, base[j + 1]![i + 1]!, base[j]![i + 1]!, panel);
        m.addTri(base[j]![i]!, base[j + 1]![i]!, base[j + 1]![i + 1]!, panel);
      }
    }
    // Side walls around the border (outward facing).
    const border: [number, number][] = [];
    for (let i = 0; i < G; i++) border.push([0, i]);
    for (let j = 0; j < G; j++) border.push([j, G]);
    for (let i = G; i > 0; i--) border.push([G, i]);
    for (let j = G; j > 0; j--) border.push([j, 0]);
    for (let k = 0; k < border.length; k++) {
      const [j0, i0] = border[k]!;
      const [j1, i1] = border[(k + 1) % border.length]!;
      const a = top[j0]![i0]!;
      const b = top[j1]![i1]!;
      const a2 = base[j0]![i0]!;
      const b2 = base[j1]![i1]!;
      m.addTri(b, a, a2, panel);
      m.addTri(b, a2, b2, panel);
    }
  };
  build(at.q, o.width, o.height, o.thickness);
  if (o.flap) {
    const n = at.n;
    const right = normalize(cross(o.up, n));
    const up = normalize(cross(n, right));
    const fh = o.height * o.flap;
    build(add(at.q, scale(up, o.height / 2 - fh / 2 + 0.004)), o.width + 0.006, fh, o.thickness + 0.003);
  }
  return true;
}

/**
 * A cap's brim: a curved plate in front of the hem's front arc, `length`
 * long at its centre, tilted down by `droop`, `thickness` thick.
 */
/** The front arc of a cap's hem: loop vertices facing +Z within 80 degrees, from the right to the left. */
export function brimArc(m: WorkMesh, loop: number[]): number[] {
  let c: Vec3 = [0, 0, 0];
  for (const v of loop) c = add(c, m.p(v));
  c = scale(c, 1 / loop.length);
  return loop
    .map((v) => ({ v, d: normalize([m.pos[v * 3]! - c[0], 0, m.pos[v * 3 + 2]! - c[2]]) }))
    .filter((e) => e.d[2] > 0.17)
    .sort((a, b) => a.d[0] - b.d[0] || a.v - b.v)
    .map((e) => e.v);
}

export function addBrim(m: WorkMesh, loop: number[], length: number, droop: number, thickness: number, arc = brimArc(m, loop)): void {
  const panel = m.panelId('brim');
  let c: Vec3 = [0, 0, 0];
  for (const v of loop) c = add(c, m.p(v));
  c = scale(c, 1 / loop.length);
  const front = arc.map((v) => ({ v, d: normalize([m.pos[v * 3]! - c[0], 0, m.pos[v * 3 + 2]! - c[2]]) }));
  if (front.length < 3) return;
  const K = front.length;
  const inner: number[] = [];
  const outer: number[] = [];
  const innerB: number[] = [];
  const outerB: number[] = [];
  for (let k = 0; k < K; k++) {
    const { v, d } = front[k]!;
    const p = m.p(v);
    // Longest at the centre, round at the sides.
    const reach = length * Math.sqrt(Math.max(0, d[2]));
    const o = add(add(p, scale(d, reach)), [0, -droop * reach, 0]);
    const up: Vec3 = normalize(add([0, 1, 0], scale(d, droop)));
    inner.push(m.addVertex(add(p, scale(up, thickness / 2)), up, -1, PART | FIXED));
    outer.push(m.addVertex(add(o, scale(up, thickness / 2)), up, -1, PART | FIXED));
    innerB.push(m.addVertex(add(p, scale(up, -thickness / 2)), scale(up, -1), -1, PART | FIXED));
    outerB.push(m.addVertex(add(o, scale(up, -thickness / 2)), scale(up, -1), -1, PART | FIXED));
  }
  for (let k = 0; k + 1 < K; k++) {
    // Top (facing up), bottom (facing down) and the outer edge.
    m.addTri(inner[k]!, outer[k]!, outer[k + 1]!, panel);
    m.addTri(inner[k]!, outer[k + 1]!, inner[k + 1]!, panel);
    m.addTri(innerB[k]!, outerB[k + 1]!, outerB[k]!, panel);
    m.addTri(innerB[k]!, innerB[k + 1]!, outerB[k + 1]!, panel);
    m.addTri(outer[k]!, outerB[k]!, outerB[k + 1]!, panel);
    m.addTri(outer[k]!, outerB[k + 1]!, outer[k + 1]!, panel);
  }
}

/** Twice the area of a triangle along its normal. */
function faceCross(m: WorkMesh, t: number): Vec3 {
  const a = m.p(m.tris[t * 3]!);
  return cross(sub(m.p(m.tris[t * 3 + 1]!), a), sub(m.p(m.tris[t * 3 + 2]!), a));
}
