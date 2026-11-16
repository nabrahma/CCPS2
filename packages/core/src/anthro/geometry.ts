/**
 * Geometry behind the measurements (PRD Part 3, F24): a least-squares plane
 * through a ring, the cut of the body by a plane, the convex hull a tape
 * measure follows, and geodesic distance on the surface. Float64 throughout,
 * fixed work in a fixed order, and no engine-dependent maths (only sqrt).
 */
import type { BodyTopology } from './topology';

export type Positions = Float64Array | Float32Array;

const sq = (x: number): number => x * x;

export interface CutPlane {
  /** A point on the plane. */
  cx: number;
  cy: number;
  cz: number;
  /** Unit normal. */
  nx: number;
  ny: number;
  nz: number;
}

/** Least-squares plane through some vertices: their centroid, and the direction they spread least along. */
export function fitPlane(pos: Positions, vertices: ArrayLike<number>): CutPlane {
  const n = vertices.length;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < n; i++) {
    const v = vertices[i]! * 3;
    cx += pos[v]!;
    cy += pos[v + 1]!;
    cz += pos[v + 2]!;
  }
  cx /= n;
  cy /= n;
  cz /= n;
  // Covariance (symmetric 3x3).
  const a = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    const v = vertices[i]! * 3;
    const x = pos[v]! - cx;
    const y = pos[v + 1]! - cy;
    const z = pos[v + 2]! - cz;
    a[0]! += x * x;
    a[1]! += x * y;
    a[2]! += x * z;
    a[4]! += y * y;
    a[5]! += y * z;
    a[8]! += z * z;
  }
  a[3] = a[1]!;
  a[6] = a[2]!;
  a[7] = a[5]!;
  const [values, vectors] = symmetricEigen3(a);
  let k = 0;
  if (values[1]! < values[k]!) k = 1;
  if (values[2]! < values[k]!) k = 2;
  let nx = vectors[k]!;
  let ny = vectors[3 + k]!;
  let nz = vectors[6 + k]!;
  // A fixed sign, so the same ring always gives the same normal: the largest component is positive.
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  const az = Math.abs(nz);
  const lead = ay >= ax && ay >= az ? ny : ax >= az ? nx : nz;
  if (lead < 0) {
    nx = -nx;
    ny = -ny;
    nz = -nz;
  }
  return { cx, cy, cz, nx, ny, nz };
}

/** Eigenvalues and eigenvectors (columns of the returned row-major matrix) of a symmetric 3x3 matrix: 12 Jacobi sweeps. */
export function symmetricEigen3(m: number[]): [number[], number[]] {
  const a = m.slice();
  const v = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const pairs: [number, number][] = [
    [0, 1],
    [0, 2],
    [1, 2],
  ];
  for (let sweep = 0; sweep < 12; sweep++) {
    for (const [p, q] of pairs) {
      const apq = a[p * 3 + q]!;
      if (apq === 0) continue;
      const theta = (a[q * 3 + q]! - a[p * 3 + p]!) / (2 * apq);
      const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = a[k * 3 + p]!;
        const akq = a[k * 3 + q]!;
        a[k * 3 + p] = c * akp - s * akq;
        a[k * 3 + q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p * 3 + k]!;
        const aqk = a[q * 3 + k]!;
        a[p * 3 + k] = c * apk - s * aqk;
        a[q * 3 + k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k * 3 + p]!;
        const vkq = v[k * 3 + q]!;
        v[k * 3 + p] = c * vkp - s * vkq;
        v[k * 3 + q] = s * vkp + c * vkq;
      }
    }
  }
  return [[a[0]!, a[4]!, a[8]!], v];
}

/**
 * Cut some triangles of the body with a plane and return the closed loop of
 * the cut whose centre is nearest (rx, ry, rz), as xyz triples, or null when
 * the cut has no closed loop there. A vertex exactly on the plane counts as
 * on its positive side, so every crossed triangle gives exactly one segment.
 */
export function cutLoop(pos: Positions, topo: BodyTopology, triangles: ArrayLike<number>, plane: CutPlane, rx: number, ry: number, rz: number): Float64Array | null {
  const { cx, cy, cz, nx, ny, nz } = plane;
  const tris = topo.tris;
  const pointOf = new Map<number, number>(); // edge key -> index into pts
  const pts: number[] = [];
  const linkA: number[] = [];
  const linkB: number[] = [];
  const side = (v: number) => (pos[v * 3]! - cx) * nx + (pos[v * 3 + 1]! - cy) * ny + (pos[v * 3 + 2]! - cz) * nz;
  const crossing = (u: number, w: number, du: number, dw: number): number => {
    const lo = u < w ? u : w;
    const hi = u < w ? w : u;
    const key = lo * 65536 + hi;
    let idx = pointOf.get(key);
    if (idx === undefined) {
      // Interpolate from the lower vertex index, so both triangles sharing the edge get the same point.
      const dl = u < w ? du : dw;
      const dh = u < w ? dw : du;
      const t = dl / (dl - dh);
      idx = pts.length / 3;
      pts.push(pos[lo * 3]! + (pos[hi * 3]! - pos[lo * 3]!) * t, pos[lo * 3 + 1]! + (pos[hi * 3 + 1]! - pos[lo * 3 + 1]!) * t, pos[lo * 3 + 2]! + (pos[hi * 3 + 2]! - pos[lo * 3 + 2]!) * t);
      linkA.push(-1);
      linkB.push(-1);
      pointOf.set(key, idx);
    }
    return idx;
  };
  const join = (p: number, q: number) => {
    if (linkA[p] === -1) linkA[p] = q;
    else if (linkB[p] === -1) linkB[p] = q;
    if (linkA[q] === -1) linkA[q] = p;
    else if (linkB[q] === -1) linkB[q] = p;
  };
  for (let i = 0; i < triangles.length; i++) {
    const t = triangles[i]! * 3;
    const a = tris[t]!;
    const b = tris[t + 1]!;
    const c = tris[t + 2]!;
    const da = side(a);
    const db = side(b);
    const dc = side(c);
    const pa = da >= 0;
    const pb = db >= 0;
    const pc = dc >= 0;
    if (pa === pb && pb === pc) continue;
    let p: number;
    let q: number;
    if (pa !== pb && pa !== pc) {
      p = crossing(a, b, da, db);
      q = crossing(a, c, da, dc);
    } else if (pb !== pa && pb !== pc) {
      p = crossing(b, a, db, da);
      q = crossing(b, c, db, dc);
    } else {
      p = crossing(c, a, dc, da);
      q = crossing(c, b, dc, db);
    }
    join(p, q);
  }
  const count = pts.length / 3;
  const visited = new Uint8Array(count);
  let best: number[] | null = null;
  let bestDist = Infinity;
  for (let s = 0; s < count; s++) {
    if (visited[s] || linkA[s] === -1 || linkB[s] === -1) continue;
    const loop: number[] = [s];
    visited[s] = 1;
    let prev = s;
    let cur = linkA[s]!;
    let closed = false;
    while (cur !== -1) {
      if (cur === s) {
        closed = true;
        break;
      }
      if (visited[cur]) break;
      visited[cur] = 1;
      loop.push(cur);
      const next = linkA[cur] === prev ? linkB[cur]! : linkA[cur]!;
      prev = cur;
      cur = next;
    }
    if (!closed || loop.length < 3) continue;
    let mx = 0;
    let my = 0;
    let mz = 0;
    for (const p of loop) {
      mx += pts[p * 3]!;
      my += pts[p * 3 + 1]!;
      mz += pts[p * 3 + 2]!;
    }
    mx = mx / loop.length - rx;
    my = my / loop.length - ry;
    mz = mz / loop.length - rz;
    const d = mx * mx + my * my + mz * mz;
    if (d < bestDist) {
      bestDist = d;
      best = loop;
    }
  }
  if (!best) return null;
  const out = new Float64Array(best.length * 3);
  best.forEach((p, i) => {
    out[i * 3] = pts[p * 3]!;
    out[i * 3 + 1] = pts[p * 3 + 1]!;
    out[i * 3 + 2] = pts[p * 3 + 2]!;
  });
  return out;
}

/** Length of a closed polyline of xyz triples. */
export function closedLoopLength(loop: Float64Array): number {
  const n = loop.length / 3;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    sum += Math.sqrt(sq(loop[j * 3]! - loop[i * 3]!) + sq(loop[j * 3 + 1]! - loop[i * 3 + 1]!) + sq(loop[j * 3 + 2]! - loop[i * 3 + 2]!));
  }
  return sum;
}

/**
 * Convex hull of a planar loop, as indices into the loop in counter-clockwise
 * order seen from the tip of the plane's normal (Andrew's monotone chain on
 * the loop projected into the plane). A tape measure pulled round the loop
 * follows this hull.
 */
export function convexHull(loop: Float64Array, plane: CutPlane): number[] {
  const { nx, ny, nz } = plane;
  // In-plane axes: u is horizontal where it can be.
  let ux: number;
  let uy: number;
  let uz: number;
  if (Math.abs(ny) > 0.9) {
    // Near-horizontal plane: u along X.
    const d = nx;
    ux = 1 - d * nx;
    uy = -d * ny;
    uz = -d * nz;
  } else {
    // u = normal x up, horizontal.
    ux = -nz;
    uy = 0;
    uz = nx;
  }
  const ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
  ux /= ul;
  uy /= ul;
  uz /= ul;
  const vx = ny * uz - nz * uy;
  const vy = nz * ux - nx * uz;
  const vz = nx * uy - ny * ux;
  const n = loop.length / 3;
  const us = new Float64Array(n);
  const vs = new Float64Array(n);
  const order: number[] = [];
  for (let i = 0; i < n; i++) {
    us[i] = loop[i * 3]! * ux + loop[i * 3 + 1]! * uy + loop[i * 3 + 2]! * uz;
    vs[i] = loop[i * 3]! * vx + loop[i * 3 + 1]! * vy + loop[i * 3 + 2]! * vz;
    order.push(i);
  }
  order.sort((p, q) => us[p]! - us[q]! || vs[p]! - vs[q]! || p - q);
  const cross = (o: number, a: number, b: number) => (us[a]! - us[o]!) * (vs[b]! - vs[o]!) - (vs[a]! - vs[o]!) * (us[b]! - us[o]!);
  const hull: number[] = [];
  for (const i of order) {
    while (hull.length >= 2 && cross(hull[hull.length - 2]!, hull[hull.length - 1]!, i) <= 0) hull.pop();
    hull.push(i);
  }
  const lower = hull.length + 1;
  for (let k = order.length - 2; k >= 0; k--) {
    const i = order[k]!;
    while (hull.length >= lower && cross(hull[hull.length - 2]!, hull[hull.length - 1]!, i) <= 0) hull.pop();
    hull.push(i);
  }
  hull.pop();
  return hull;
}

/** Perimeter of a hull given as indices into a loop. */
export function hullPerimeter(loop: Float64Array, hull: number[]): number {
  let sum = 0;
  for (let k = 0; k < hull.length; k++) sum += dist(loop, hull[k]!, hull[(k + 1) % hull.length]!);
  return sum;
}

function dist(loop: Float64Array, i: number, j: number): number {
  return Math.sqrt(sq(loop[j * 3]! - loop[i * 3]!) + sq(loop[j * 3 + 1]! - loop[i * 3 + 1]!) + sq(loop[j * 3 + 2]! - loop[i * 3 + 2]!));
}

export interface HullSpan {
  /** Length along the hull round the back (-Z side), between the two side points. */
  back: number;
  /** Half of the left-to-right extent. */
  halfWidth: number;
}

/** The back arc of a torso hull between its leftmost and rightmost points (the side "balance lines"), and its half width. */
export function hullBackSpan(loop: Float64Array, hull: number[]): HullSpan {
  let iMax = 0;
  let iMin = 0;
  for (let k = 1; k < hull.length; k++) {
    if (loop[hull[k]! * 3]! > loop[hull[iMax]! * 3]!) iMax = k;
    if (loop[hull[k]! * 3]! < loop[hull[iMin]! * 3]!) iMin = k;
  }
  const arc = (from: number, to: number) => {
    let len = 0;
    let zsum = 0;
    let n = 0;
    for (let k = from; k !== to; k = (k + 1) % hull.length) {
      const a = hull[k]!;
      const b = hull[(k + 1) % hull.length]!;
      len += dist(loop, a, b);
      zsum += loop[a * 3 + 2]! + loop[b * 3 + 2]!;
      n += 2;
    }
    return { len, z: n ? zsum / n : 0 };
  };
  const one = arc(iMax, iMin);
  const two = arc(iMin, iMax);
  return { back: one.z <= two.z ? one.len : two.len, halfWidth: (loop[hull[iMax]! * 3]! - loop[hull[iMin]! * 3]!) / 2 };
}

/** Volume enclosed by the body surface: the sum of signed tetrahedra from the origin (the surface is closed). */
export function enclosedVolume(pos: Positions, topo: BodyTopology): number {
  const tris = topo.tris;
  let six = 0;
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t]! * 3;
    const b = tris[t + 1]! * 3;
    const c = tris[t + 2]! * 3;
    const ax = pos[a]!;
    const ay = pos[a + 1]!;
    const az = pos[a + 2]!;
    const bx = pos[b]!;
    const by = pos[b + 1]!;
    const bz = pos[b + 2]!;
    six += (ay * bz - az * by) * pos[c]! + (az * bx - ax * bz) * pos[c + 1]! + (ax * by - ay * bx) * pos[c + 2]!;
  }
  return Math.abs(six) / 6;
}

/**
 * Geodesic distance between two fixed vertices, for any body shape. Built
 * once: the search is limited to a corridor of vertices found on the rest
 * mesh (those on a path at most 30% + 3 cm longer than the shortest). Then,
 * per shape: Dijkstra on the vertex graph (quad edges and diagonals), refined
 * by one pass of the fast-marching update over the corridor's triangles in
 * order of distance, which removes most of the zig-zag of an edge path.
 */
export class GeodesicPath {
  private readonly verts: Uint32Array;
  private readonly nbrStart: Uint32Array;
  private readonly nbr: Uint32Array;
  /** Per local vertex: the other two (local) vertices of each triangle around it. */
  private readonly oppStart: Uint32Array;
  private readonly opp: Uint32Array;
  private readonly from: number;
  private readonly to: number;
  private readonly d: Float64Array;
  private readonly heap: Int32Array;
  private readonly heapPos: Int32Array;

  constructor(topo: BodyTopology, rest: Positions, a: number, b: number) {
    const da = dijkstraAll(topo, rest, a);
    const db = dijkstraAll(topo, rest, b);
    const limit = da[b]! * 1.3 + 0.03;
    const local = new Int32Array(topo.vertexCount).fill(-1);
    const verts: number[] = [];
    for (let v = 0; v < topo.vertexCount; v++) {
      if (da[v]! + db[v]! <= limit) {
        local[v] = verts.length;
        verts.push(v);
      }
    }
    this.verts = Uint32Array.from(verts);
    const n = verts.length;
    const start = new Uint32Array(n + 1);
    const flat: number[] = [];
    for (let i = 0; i < n; i++) {
      const v = verts[i]!;
      start[i] = flat.length;
      for (let k = topo.nbrStart[v]!; k < topo.nbrStart[v + 1]!; k++) {
        const u = local[topo.nbr[k]!]!;
        if (u >= 0) flat.push(u);
      }
    }
    start[n] = flat.length;
    this.nbrStart = start;
    this.nbr = Uint32Array.from(flat);
    const around: number[][] = Array.from({ length: n }, () => []);
    const fan = topo.fanTris;
    for (let t = 0; t < fan.length; t += 3) {
      const p = local[fan[t]!]!;
      const q = local[fan[t + 1]!]!;
      const r = local[fan[t + 2]!]!;
      if (p < 0 || q < 0 || r < 0) continue;
      around[p]!.push(q, r);
      around[q]!.push(r, p);
      around[r]!.push(p, q);
    }
    const os = new Uint32Array(n + 1);
    const of: number[] = [];
    for (let i = 0; i < n; i++) {
      os[i] = of.length;
      for (const x of around[i]!) of.push(x);
    }
    os[n] = of.length;
    this.oppStart = os;
    this.opp = Uint32Array.from(of);
    this.from = local[a]!;
    this.to = local[b]!;
    this.d = new Float64Array(n);
    this.heap = new Int32Array(n);
    this.heapPos = new Int32Array(n);
  }

  /** The vertices the distance depends on. */
  get vertices(): Uint32Array {
    return this.verts;
  }

  length(pos: Positions): number {
    const d = this.d;
    const verts = this.verts;
    d.fill(Infinity);
    d[this.from] = 0;
    // Dijkstra with a binary heap; ties go to the lower vertex.
    const heap = this.heap;
    const where = this.heapPos;
    where.fill(-1);
    let size = 0;
    const less = (i: number, j: number) => d[i]! < d[j]! || (d[i] === d[j] && i < j);
    const up = (k: number) => {
      const item = heap[k]!;
      while (k > 0) {
        const parent = (k - 1) >> 1;
        if (!less(item, heap[parent]!)) break;
        heap[k] = heap[parent]!;
        where[heap[k]!] = k;
        k = parent;
      }
      heap[k] = item;
      where[item] = k;
    };
    const down = (k: number) => {
      const item = heap[k]!;
      for (;;) {
        let child = 2 * k + 1;
        if (child >= size) break;
        if (child + 1 < size && less(heap[child + 1]!, heap[child]!)) child++;
        if (!less(heap[child]!, item)) break;
        heap[k] = heap[child]!;
        where[heap[k]!] = k;
        k = child;
      }
      heap[k] = item;
      where[item] = k;
    };
    heap[size++] = this.from;
    where[this.from] = 0;
    const order: number[] = [];
    while (size > 0) {
      const v = heap[0]!;
      size--;
      where[v] = -2;
      if (size > 0) {
        heap[0] = heap[size]!;
        down(0);
      }
      order.push(v);
      const pv = verts[v]! * 3;
      for (let k = this.nbrStart[v]!; k < this.nbrStart[v + 1]!; k++) {
        const u = this.nbr[k]!;
        if (where[u] === -2) continue;
        const pu = verts[u]! * 3;
        const nd = d[v]! + Math.sqrt(sq(pos[pu]! - pos[pv]!) + sq(pos[pu + 1]! - pos[pv + 1]!) + sq(pos[pu + 2]! - pos[pv + 2]!));
        if (nd < d[u]!) {
          d[u] = nd;
          if (where[u] === -1) {
            heap[size] = u;
            where[u] = size;
            size++;
          }
          up(where[u]!);
        }
      }
    }
    // One fast-marching pass, nearest first.
    for (const v of order) {
      if (v === this.from) continue;
      const pv = verts[v]! * 3;
      let best = d[v]!;
      for (let k = this.oppStart[v]!; k < this.oppStart[v + 1]!; k += 2) {
        const a = this.opp[k]!;
        const b = this.opp[k + 1]!;
        const ta = d[a]!;
        const tb = d[b]!;
        if (!(ta < best || tb < best)) continue;
        const pa = verts[a]! * 3;
        const pb = verts[b]! * 3;
        const ex = pos[pb]! - pos[pa]!;
        const ey = pos[pb + 1]! - pos[pa + 1]!;
        const ez = pos[pb + 2]! - pos[pa + 2]!;
        const wx = pos[pv]! - pos[pa]!;
        const wy = pos[pv + 1]! - pos[pa + 1]!;
        const wz = pos[pv + 2]! - pos[pa + 2]!;
        const len = Math.sqrt(ex * ex + ey * ey + ez * ez);
        if (len === 0 || ta === Infinity || tb === Infinity) continue;
        const slope = (tb - ta) / len;
        if (!(slope > -1 && slope < 1)) continue;
        const p = (wx * ex + wy * ey + wz * ez) / len;
        const h2 = wx * wx + wy * wy + wz * wz - p * p;
        const h = h2 > 0 ? Math.sqrt(h2) : 0;
        let x = p - (slope * h) / Math.sqrt(1 - slope * slope);
        if (x < 0) x = 0;
        else if (x > len) x = len;
        const t = ta + slope * x + Math.sqrt((p - x) * (p - x) + h * h);
        if (t < best) best = t;
      }
      d[v] = best;
    }
    return d[this.to]!;
  }
}

/** Edge-graph distances from one vertex to every body vertex (used once per path, on the rest mesh). */
function dijkstraAll(topo: BodyTopology, pos: Positions, source: number): Float64Array {
  const n = topo.vertexCount;
  const d = new Float64Array(n).fill(Infinity);
  const done = new Uint8Array(n);
  d[source] = 0;
  // A simple binary heap of [distance, vertex] pairs with lazy deletion.
  const hd: number[] = [0];
  const hv: number[] = [source];
  const push = (dist0: number, v: number) => {
    let k = hd.length;
    hd.push(dist0);
    hv.push(v);
    while (k > 0) {
      const parent = (k - 1) >> 1;
      if (hd[parent]! < dist0 || (hd[parent] === dist0 && hv[parent]! <= v)) break;
      hd[k] = hd[parent]!;
      hv[k] = hv[parent]!;
      k = parent;
    }
    hd[k] = dist0;
    hv[k] = v;
  };
  const pop = (): [number, number] => {
    const top: [number, number] = [hd[0]!, hv[0]!];
    const ld = hd.pop()!;
    const lv = hv.pop()!;
    const size = hd.length;
    if (size > 0) {
      let k = 0;
      for (;;) {
        let child = 2 * k + 1;
        if (child >= size) break;
        if (child + 1 < size && (hd[child + 1]! < hd[child]! || (hd[child + 1] === hd[child] && hv[child + 1]! < hv[child]!))) child++;
        if (ld < hd[child]! || (ld === hd[child] && lv <= hv[child]!)) break;
        hd[k] = hd[child]!;
        hv[k] = hv[child]!;
        k = child;
      }
      hd[k] = ld;
      hv[k] = lv;
    }
    return top;
  };
  while (hd.length > 0) {
    const v = pop()[1];
    if (done[v]) continue;
    done[v] = 1;
    for (let k = topo.nbrStart[v]!; k < topo.nbrStart[v + 1]!; k++) {
      const u = topo.nbr[k]!;
      if (done[u]) continue;
      const nd = d[v]! + Math.sqrt(sq(pos[u * 3]! - pos[v * 3]!) + sq(pos[u * 3 + 1]! - pos[v * 3 + 1]!) + sq(pos[u * 3 + 2]! - pos[v * 3 + 2]!));
      if (nd < d[u]!) {
        d[u] = nd;
        push(nd, u);
      }
    }
  }
  return d;
}
