/**
 * Lofted parts (PRD Part 3, F28 step 5): shapes the body does not have.
 * A loft continues an open loop of the shell as a tube of rings down to a
 * level hem: trouser legs below the knee hang straight from the knee instead
 * of following the calf (5.0, straight hanging lines), skirts flare from the
 * hips. Each ring is the starting loop scaled about a straight axis, so the
 * tube's vertex count matches the loop and joins it exactly.
 */
import type { ShellBody } from './body';
import { FIXED, LOFT, type WorkMesh } from './mesh';
import { add, dot, len, lerp, normalize, scale, sub, type Vec3 } from './vec';

/** The loop vertex positions' centroid. */
export function loopCentre(m: WorkMesh, loop: readonly number[]): Vec3 {
  let c: Vec3 = [0, 0, 0];
  for (const v of loop) c = add(c, m.p(v));
  return scale(c, 1 / loop.length);
}

/** Mean height of a loop. */
export function loopY(m: WorkMesh, loop: readonly number[]): number {
  let y = 0;
  for (const v of loop) y += m.pos[v * 3 + 1]!;
  return y / loop.length;
}

/**
 * Smallest radial scale of a loop's shape (about `centre`, in the horizontal
 * plane) that holds the given body points with `ease` to spare. Each point is
 * compared with the loop's radius in its own direction (the loop is treated
 * as star-shaped around its centre, which holds for limb and hip rings).
 */
export function scaleToHold(m: WorkMesh, loop: readonly number[], centre: Vec3, points: Vec3[], ease: number, axisAt: (y: number) => Vec3): number {
  // Loop radius by angle: sample the polygon in the horizontal plane.
  const xs = loop.map((v) => m.pos[v * 3]! - centre[0]);
  const zs = loop.map((v) => m.pos[v * 3 + 2]! - centre[2]);
  const radiusAt = (dx: number, dz: number): number => {
    let best = 0;
    const k = xs.length;
    for (let i = 0; i < k; i++) {
      const ax = xs[i]!;
      const az = zs[i]!;
      const bx = xs[(i + 1) % k]!;
      const bz = zs[(i + 1) % k]!;
      const ex = bx - ax;
      const ez = bz - az;
      const den = dx * ez - dz * ex;
      if (Math.abs(den) < 1e-15) continue;
      const t = (ax * ez - az * ex) / den;
      const s = (ax * dz - az * dx) / den;
      if (t > 0 && s >= -1e-9 && s <= 1 + 1e-9) best = Math.max(best, t);
    }
    return best;
  };
  let need = 1;
  for (const p of points) {
    const a = axisAt(p[1]);
    const dx = p[0] - a[0];
    const dz = p[2] - a[2];
    const r = Math.sqrt(dx * dx + dz * dz);
    if (r < 1e-6) continue;
    const rr = radiusAt(dx / r, dz / r);
    if (rr <= 1e-6) continue;
    need = Math.max(need, (r + ease) / rr);
  }
  return need;
}

export interface TubeOptions {
  /** Centre of the hem ring (its height is the hem level). */
  hemCentre: Vec3;
  /** Positions of the rings along the tube (0 = the loop, 1 = the hem), ascending, ending at 1. */
  ts: number[];
  /** Radial scale of the ring at t (1 = the loop's own size). */
  radial: (t: number) => number;
  /** Panel of a triangle from its centre. */
  panelOf: (centre: Vec3) => number;
  seg: number;
  /** Ease recorded on the new vertices (for the checks and rims). */
  ease: number;
  /** Hem (constraint index) the last ring is. */
  hem: number;
  /** Vertices around the tube (the loop is resampled to this many, joined by a zipper strip). 0 keeps the loop's own. */
  around?: number;
}

/** Points evenly spaced along a closed loop by length, starting at its first vertex. */
export function resampleLoop(m: WorkMesh, loop: readonly number[], count: number): { points: Vec3[]; normals: Vec3[]; params: number[] } {
  const L = loop.length;
  const P = loop.map((v) => m.p(v));
  const N = loop.map((v) => m.n(v));
  const seg = P.map((p, i) => len(sub(P[(i + 1) % L]!, p)));
  const total = seg.reduce((x, y) => x + y, 0);
  const points: Vec3[] = [];
  const normals: Vec3[] = [];
  let i = 0;
  let acc = 0;
  for (let k = 0; k < count; k++) {
    const target = (k / count) * total;
    while (i < L - 1 && acc + seg[i]! < target) {
      acc += seg[i]!;
      i++;
    }
    const f = seg[i]! > 0 ? (target - acc) / seg[i]! : 0;
    points.push(lerp(P[i]!, P[(i + 1) % L]!, f));
    normals.push(normalize(lerp(N[i]!, N[(i + 1) % L]!, f)));
  }
  const params: number[] = [];
  acc = 0;
  for (let k = 0; k < L; k++) {
    params.push(acc / total);
    acc += seg[k]!;
  }
  return { points, normals, params };
}

/**
 * Continue `loop` (an open boundary loop, assumed level) as a tube down to the
 * hem: rings are the loop's shape, scaled radially, around the straight line
 * from the loop's centre to the hem centre. Returns the hem loop.
 */
export function loftTube(m: WorkMesh, loop: number[], o: TubeOptions): number[] {
  const c0 = loopCentre(m, loop);
  let shape = loop.map((v) => sub(m.p(v), c0));
  let normals = loop.map((v) => m.n(v));
  let prev = loop;
  let ts = o.ts;
  if (o.around && o.around !== loop.length) {
    // A first ring of `around` points, a little below the loop, joined to it by a zipper strip.
    const r = resampleLoop(m, loop, o.around);
    shape = r.points.map((p) => sub(p, c0));
    normals = r.normals;
    const t0 = Math.min(0.05, ts[0]! / 2);
    const c = lerp(c0, o.hemCentre, t0);
    const s = o.radial(t0);
    const ring = shape.map((d, i) => m.addVertex([c[0] + d[0] * s, c[1], c[2] + d[2] * s], normals[i]!, o.seg, LOFT, -1, o.ease));
    // The zipper walks both loops by index, so its triangles depend on the counts only (the same on every body).
    const loopT = loop.map((_, k) => k / loop.length);
    const ringT = ring.map((_, k) => k / ring.length);
    let i = 0;
    let j = 0;
    const L = loop.length;
    const M = ring.length;
    while (i < L || j < M) {
      const nextLoop = i < L ? (i + 1 < L ? loopT[i + 1]! : 1) : Infinity;
      const nextRing = j < M ? (j + 1 < M ? ringT[j + 1]! : 1) : Infinity;
      const a = loop[i % L]!;
      const b2 = ring[j % M]!;
      if (nextLoop <= nextRing) {
        const b = loop[(i + 1) % L]!;
        const centre = scale(add(add(m.p(a), m.p(b)), m.p(b2)), 1 / 3);
        m.addTri(b, a, b2, o.panelOf(centre));
        i++;
      } else {
        const c2 = ring[(j + 1) % M]!;
        const centre = scale(add(add(m.p(a), m.p(b2)), m.p(c2)), 1 / 3);
        m.addTri(a, b2, c2, o.panelOf(centre));
        j++;
      }
    }
    prev = ring;
    ts = ts.filter((t) => t > t0);
  }
  for (const t of ts) {
    const c = lerp(c0, o.hemCentre, t);
    const s = o.radial(t);
    const ring = shape.map((d, i) => m.addVertex(add(c, [d[0] * s, d[1], d[2] * s]), normals[i]!, o.seg, LOFT, -1, o.ease));
    // Level rings: the loop's own heights would tilt with it, so every ring sits at its centre's height.
    for (const v of ring) m.pos[v * 3 + 1] = c[1];
    const L = prev.length;
    for (let i = 0; i < L; i++) {
      const a = prev[i]!;
      const b = prev[(i + 1) % L]!;
      const a2 = ring[i]!;
      const b2 = ring[(i + 1) % L]!;
      const centre = scale(add(add(m.p(a), m.p(b)), add(m.p(a2), m.p(b2))), 0.25);
      const panel = o.panelOf(centre);
      // The loop runs with the cloth on its left (seen from outside): the tube continues on the right.
      m.addTri(b, a, a2, panel);
      m.addTri(b, a2, b2, panel);
    }
    prev = ring;
  }
  for (const v of prev) {
    m.hem[v] = o.hem;
    m.dist[v] = 0;
    // A level hem stays level: nothing (clearance, smoothing) moves it.
    m.flags[v] = m.flags[v]! | FIXED;
  }
  return prev;
}

/**
 * Scale vertices radially (in the horizontal plane) about an axis, by a
 * factor that depends on height: used to widen the thigh into a straight
 * trouser tube, and sleeves towards the cuff.
 */
export function scaleRadially(m: WorkMesh, verts: readonly number[], axisAt: (p: Vec3) => Vec3, factor: (p: Vec3) => number, axisDir: Vec3 = [0, 1, 0]): void {
  const d = normalize(axisDir);
  for (const v of verts) {
    const p = m.p(v);
    const a = axisAt(p);
    const off = sub(p, a);
    const along = scale(d, dot(off, d));
    const radial = sub(off, along);
    const f = factor(p);
    m.setP(v, add(add(a, along), scale(radial, f)));
  }
}

/** Body points of the given parts between two heights (reference body). */
export function bodyPointsBetween(body: ShellBody, segments: readonly number[], y0: number, y1: number): Vec3[] {
  const out: Vec3[] = [];
  const P = body.positions;
  for (let v = 0; v < P.length / 3; v++) {
    if (!segments.includes(body.segment[v]!)) continue;
    const y = P[v * 3 + 1]!;
    if (y < Math.min(y0, y1) || y > Math.max(y0, y1)) continue;
    out.push([P[v * 3]!, y, P[v * 3 + 2]!]);
  }
  return out;
}
