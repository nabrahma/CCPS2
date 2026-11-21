/**
 * Constrained Delaunay triangulation of a simple polygon with interior Steiner points (PRD Part 3, F30
 * discretisation, and the coarse remesh of F31).
 *
 * The boundary is given as a closed ring of points (already sampled along the panel's edges, so seams pair
 * up). Interior points lie on a hexagonal lattice of spacing `h`, kept at least `0.55 h` from the boundary.
 * Points are inserted one by one (Bowyer-Watson, walking to the containing triangle); boundary segments
 * missing from the Delaunay triangulation are recovered by edge flips (Sloan); triangles outside the polygon
 * are dropped. Every step runs in a fixed order with plain IEEE arithmetic, so the result is the same in
 * every JavaScript engine.
 */

export interface Triangulation {
  /** x, y per point: the boundary ring first, in the order given, then the interior points. */
  points: Float64Array;
  /** Counter-clockwise triangles. */
  tris: Uint32Array;
  boundaryCount: number;
}

const SQRT3_2 = 0.8660254037844386;

function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/** > 0 when d is inside the circumcircle of the counter-clockwise triangle abc. */
function inCircle(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): number {
  const adx = ax - dx;
  const ady = ay - dy;
  const bdx = bx - dx;
  const bdy = by - dy;
  const cdx = cx - dx;
  const cdy = cy - dy;
  const ad = adx * adx + ady * ady;
  const bd = bdx * bdx + bdy * bdy;
  const cd = cdx * cdx + cdy * cdy;
  return adx * (bdy * cd - bd * cdy) - ady * (bdx * cd - bd * cdx) + ad * (bdx * cdy - bdy * cdx);
}

/** Signed area of a ring (positive: counter-clockwise). */
export function ringArea(ring: ArrayLike<number>): number {
  const n = ring.length / 2;
  let a = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) a += ring[j * 2]! * ring[i * 2 + 1]! - ring[i * 2]! * ring[j * 2 + 1]!;
  return a / 2;
}

/** Even-odd point in polygon. */
export function insideRing(ring: ArrayLike<number>, x: number, y: number): boolean {
  const n = ring.length / 2;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i * 2]!;
    const yi = ring[i * 2 + 1]!;
    const xj = ring[j * 2]!;
    const yj = ring[j * 2 + 1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Squared distance from a point to the ring's outline. */
export function ringDistance2(ring: ArrayLike<number>, x: number, y: number): number {
  const n = ring.length / 2;
  let best = Infinity;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = ring[j * 2]!;
    const ay = ring[j * 2 + 1]!;
    const ex = ring[i * 2]! - ax;
    const ey = ring[i * 2 + 1]! - ay;
    const l2 = ex * ex + ey * ey;
    let t = l2 > 0 ? ((x - ax) * ex + (y - ay) * ey) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = ax + t * ex - x;
    const dy = ay + t * ey - y;
    const d = dx * dx + dy * dy;
    if (d < best) best = d;
  }
  return best;
}

/** Hexagonal lattice points inside the ring, at least `margin` from its outline (row-major order). */
export function latticePoints(ring: ArrayLike<number>, h: number, margin = 0.55 * h): number[] {
  const n = ring.length / 2;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < n; i++) {
    x0 = Math.min(x0, ring[i * 2]!);
    x1 = Math.max(x1, ring[i * 2]!);
    y0 = Math.min(y0, ring[i * 2 + 1]!);
    y1 = Math.max(y1, ring[i * 2 + 1]!);
  }
  const dy = h * SQRT3_2;
  const out: number[] = [];
  const m2 = margin * margin;
  // Centred in the bounding box, so a panel and its mirror image get mirrored lattices.
  const rows = Math.floor((y1 - y0) / dy);
  const yStart = y0 + ((y1 - y0) - rows * dy) / 2;
  for (let j = 0; j <= rows; j++) {
    const y = yStart + j * dy;
    const shift = j % 2 === 1 ? h / 2 : 0;
    const cols = Math.floor((x1 - x0 - shift) / h);
    const xStart = x0 + shift + ((x1 - x0 - shift) - cols * h) / 2;
    for (let i = 0; i <= cols; i++) {
      const x = xStart + i * h;
      if (!insideRing(ring, x, y)) continue;
      if (ringDistance2(ring, x, y) < m2) continue;
      out.push(x, y);
    }
  }
  return out;
}

/**
 * Triangulate a simple polygon (`ring`, either winding) with the given interior points. The ring's
 * consecutive points are the constrained edges. Output triangles are counter-clockwise in the input
 * coordinates.
 */
export function triangulate(ring: ArrayLike<number>, interior: ArrayLike<number> = []): Triangulation {
  const nb = ring.length / 2;
  const ni = interior.length / 2;
  const n = nb + ni;
  // Points plus the three corners of a super triangle.
  const P = new Float64Array((n + 3) * 2);
  for (let i = 0; i < nb * 2; i++) P[i] = ring[i]!;
  for (let i = 0; i < ni * 2; i++) P[nb * 2 + i] = interior[i]!;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < n; i++) {
    x0 = Math.min(x0, P[i * 2]!);
    x1 = Math.max(x1, P[i * 2]!);
    y0 = Math.min(y0, P[i * 2 + 1]!);
    y1 = Math.max(y1, P[i * 2 + 1]!);
  }
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const span = Math.max(x1 - x0, y1 - y0, 1e-9) * 20;
  P[n * 2] = cx - span;
  P[n * 2 + 1] = cy - span;
  P[n * 2 + 2] = cx + span;
  P[n * 2 + 3] = cy - span;
  P[n * 2 + 4] = cx;
  P[n * 2 + 5] = cy + span;

  // Triangles: vertices V[3t+k], neighbours N[3t+k] opposite vertex k (-1: none), alive flags.
  let cap = Math.max(16, n * 2 + 16);
  let V = new Int32Array(cap * 3);
  let N = new Int32Array(cap * 3);
  let alive = new Uint8Array(cap);
  let count = 0;
  const free: number[] = [];
  const grow = () => {
    cap *= 2;
    const v2 = new Int32Array(cap * 3);
    v2.set(V);
    V = v2;
    const n2 = new Int32Array(cap * 3);
    n2.set(N);
    N = n2;
    const a2 = new Uint8Array(cap);
    a2.set(alive);
    alive = a2;
  };
  const newTri = (a: number, b: number, c: number): number => {
    let t: number;
    if (free.length) t = free.pop()!;
    else {
      if (count >= cap) grow();
      t = count++;
    }
    V[t * 3] = a;
    V[t * 3 + 1] = b;
    V[t * 3 + 2] = c;
    N[t * 3] = N[t * 3 + 1] = N[t * 3 + 2] = -1;
    alive[t] = 1;
    return t;
  };
  newTri(n, n + 1, n + 2);
  let last = 0;

  const px = (i: number) => P[i * 2]!;
  const py = (i: number) => P[i * 2 + 1]!;

  // Points on an edge (samples along a straight seam) test a hair outside both triangles beside it: within
  // this tolerance (relative to the points' extent) a point counts as on the edge, so inside.
  const eps = 1e-12 * span * span;
  /** Walk from `start` to a triangle containing (x, y) (never straight back), else the best of a full scan. */
  const locate = (x: number, y: number, start: number): number => {
    let t = start;
    let from = -1;
    for (let guard = 0; guard < 4096; guard++) {
      let next = -1;
      for (let k = 0; k < 3; k++) {
        const a = V[t * 3 + ((k + 1) % 3)]!;
        const b = V[t * 3 + ((k + 2) % 3)]!;
        if (orient(px(a), py(a), px(b), py(b), x, y) < -eps) {
          const nt = N[t * 3 + k]!;
          if (nt >= 0 && nt !== from) {
            next = nt;
            break;
          }
        }
      }
      if (next < 0) return t;
      from = t;
      t = next;
    }
    let best = -1;
    let score = -Infinity;
    for (let u = 0; u < count; u++) {
      if (!alive[u]) continue;
      let m = Infinity;
      for (let k = 0; k < 3; k++) {
        const a = V[u * 3 + ((k + 1) % 3)]!;
        const b = V[u * 3 + ((k + 2) % 3)]!;
        m = Math.min(m, orient(px(a), py(a), px(b), py(b), x, y));
      }
      if (m > score) {
        score = m;
        best = u;
      }
    }
    return best;
  };

  // Bowyer-Watson insertion.
  const cavity: number[] = [];
  const inCav = new Map<number, true>();
  const bEdges: number[] = []; // a, b, outside neighbour (or -1), and which slot of it faces the cavity
  for (let p = 0; p < n; p++) {
    const x = px(p);
    const y = py(p);
    const t0 = locate(x, y, alive[last] ? last : firstAlive());
    cavity.length = 0;
    inCav.clear();
    cavity.push(t0);
    inCav.set(t0, true);
    for (let qi = 0; qi < cavity.length; qi++) {
      const t = cavity[qi]!;
      for (let k = 0; k < 3; k++) {
        const nt = N[t * 3 + k]!;
        if (nt < 0 || inCav.has(nt)) continue;
        const a = V[nt * 3]!;
        const b = V[nt * 3 + 1]!;
        const c = V[nt * 3 + 2]!;
        if (inCircle(px(a), py(a), px(b), py(b), px(c), py(c), x, y) > 0) {
          cavity.push(nt);
          inCav.set(nt, true);
        }
      }
    }
    // Floating-point circle tests near collinear points can disagree: drop from the cavity any triangle whose
    // outer edge would make an inverted triangle with the new point (never the one containing it), and keep
    // only what stays connected to that one, until the cavity is star-shaped around the point.
    for (let round = 0; round < 64; round++) {
      let dropped = false;
      for (const t of cavity) {
        if (t === t0 || !inCav.has(t)) continue;
        for (let k = 0; k < 3; k++) {
          const nt = N[t * 3 + k]!;
          if (nt >= 0 && inCav.has(nt)) continue;
          const a = V[t * 3 + ((k + 1) % 3)]!;
          const b = V[t * 3 + ((k + 2) % 3)]!;
          if (orient(px(a), py(a), px(b), py(b), x, y) <= 0) {
            inCav.delete(t);
            dropped = true;
            break;
          }
        }
      }
      if (!dropped) break;
      const keep: number[] = [t0];
      const seen = new Set<number>([t0]);
      for (let qi = 0; qi < keep.length; qi++) {
        const t = keep[qi]!;
        for (let k = 0; k < 3; k++) {
          const nt = N[t * 3 + k]!;
          if (nt >= 0 && inCav.has(nt) && !seen.has(nt)) {
            seen.add(nt);
            keep.push(nt);
          }
        }
      }
      inCav.clear();
      for (const t of keep) inCav.set(t, true);
      cavity.length = 0;
      cavity.push(...keep);
    }
    // Boundary edges of the cavity, each with the triangle outside it.
    bEdges.length = 0;
    for (const t of cavity) {
      for (let k = 0; k < 3; k++) {
        const nt = N[t * 3 + k]!;
        if (nt >= 0 && inCav.has(nt)) continue;
        const a = V[t * 3 + ((k + 1) % 3)]!;
        const b = V[t * 3 + ((k + 2) % 3)]!;
        let slot = -1;
        if (nt >= 0) for (let j = 0; j < 3; j++) if (N[nt * 3 + j] === t) slot = j;
        bEdges.push(a, b, nt, slot);
      }
    }
    for (const t of cavity) {
      alive[t] = 0;
      free.push(t);
    }
    // Fan from p; link to the outside and to each other through shared vertices.
    const startOf = new Map<number, number>(); // edge start vertex -> new triangle
    const made: number[] = [];
    for (let i = 0; i < bEdges.length; i += 4) {
      const a = bEdges[i]!;
      const b = bEdges[i + 1]!;
      const nt = bEdges[i + 2]!;
      const slot = bEdges[i + 3]!;
      const t = newTri(a, b, p);
      N[t * 3 + 2] = nt;
      if (nt >= 0) N[nt * 3 + slot] = t;
      startOf.set(a, t);
      made.push(t);
    }
    for (const t of made) {
      const b = V[t * 3 + 1]!;
      // Opposite vertex a (slot 0) is edge b-p: the triangle starting at b.
      const nb2 = startOf.get(b);
      if (nb2 !== undefined) {
        N[t * 3] = nb2;
        N[nb2 * 3 + 1] = t;
      }
    }
    last = made[0]!;
  }

  function firstAlive(): number {
    for (let t = 0; t < count; t++) if (alive[t]) return t;
    return 0;
  }

  const hasEdge = (a: number, b: number): boolean => {
    // Scan the triangles around a (bounded walk around the fan both ways).
    for (let t = 0; t < count; t++) {
      if (!alive[t]) continue;
      let ha = false;
      let hb = false;
      for (let k = 0; k < 3; k++) {
        const v = V[t * 3 + k]!;
        if (v === a) ha = true;
        else if (v === b) hb = true;
      }
      if (ha && hb) return true;
    }
    return false;
  };

  // Constraint recovery (Sloan 1993): flip edges crossing a missing boundary segment.
  const segCross = (a: number, b: number, c: number, d: number): boolean => {
    if (a === c || a === d || b === c || b === d) return false;
    const o1 = orient(px(a), py(a), px(b), py(b), px(c), py(c));
    const o2 = orient(px(a), py(a), px(b), py(b), px(d), py(d));
    const o3 = orient(px(c), py(c), px(d), py(d), px(a), py(a));
    const o4 = orient(px(c), py(c), px(d), py(d), px(b), py(b));
    return o1 * o2 < 0 && o3 * o4 < 0;
  };
  for (let i = 0; i < nb; i++) {
    const a = i;
    const b = (i + 1) % nb;
    if (hasEdge(a, b)) continue;
    for (let guard = 0; guard < 10000; guard++) {
      // Find a triangle edge crossing (a, b) whose quad is convex, and flip it.
      let flipped = false;
      let crossing = false;
      for (let t = 0; t < count && !flipped; t++) {
        if (!alive[t]) continue;
        for (let k = 0; k < 3; k++) {
          const u = V[t * 3 + ((k + 1) % 3)]!;
          const w = V[t * 3 + ((k + 2) % 3)]!;
          if (!segCross(a, b, u, w)) continue;
          crossing = true;
          const nt = N[t * 3 + k]!;
          if (nt < 0) continue;
          const p0 = V[t * 3 + k]!;
          let j = 0;
          while (N[nt * 3 + j] !== t) j++;
          const q0 = V[nt * 3 + j]!;
          // Convex quad p0-u-q0-w: the diagonal p0-q0 crosses u-w.
          if (!segCross(p0, q0, u, w)) continue;
          flip(t, k, nt, j);
          flipped = true;
          break;
        }
      }
      if (!crossing || !flipped) break;
    }
    if (!hasEdge(a, b)) throw new Error(`triangulate: could not recover boundary edge ${a}-${b}`);
  }

  function flip(t: number, k: number, nt: number, j: number): void {
    // t = (p0, u, w) with p0 = V[t][k]; nt has q0 = V[nt][j] opposite the shared edge u-w.
    const p0 = V[t * 3 + k]!;
    const u = V[t * 3 + ((k + 1) % 3)]!;
    const w = V[t * 3 + ((k + 2) % 3)]!;
    const q0 = V[nt * 3 + j]!;
    // Outside neighbours: of t, across p0-u (opposite w) and w-p0 (opposite u); of nt, across the edges with q0.
    const tOppU = N[t * 3 + ((k + 1) % 3)]!; // across w-p0
    const tOppW = N[t * 3 + ((k + 2) % 3)]!; // across p0-u
    // In nt (q0, w, u) order: find the neighbours across q0-w and u-q0.
    const nOppOf = (v: number) => {
      for (let s = 0; s < 3; s++) if (V[nt * 3 + s] === v) return N[nt * 3 + s]!;
      return -1;
    };
    const nAcrossQW = nOppOf(u); // edge q0-w, opposite u
    const nAcrossUQ = nOppOf(w); // edge u-q0, opposite w
    // New triangles: t = (p0, u, q0), nt = (p0, q0, w).
    V[t * 3] = p0;
    V[t * 3 + 1] = u;
    V[t * 3 + 2] = q0;
    V[nt * 3] = p0;
    V[nt * 3 + 1] = q0;
    V[nt * 3 + 2] = w;
    // t: opposite p0 = edge u-q0; opposite u = edge q0-p0 (nt); opposite q0 = edge p0-u.
    N[t * 3] = nAcrossUQ;
    N[t * 3 + 1] = nt;
    N[t * 3 + 2] = tOppW;
    // nt: opposite p0 = edge q0-w; opposite q0 = edge w-p0; opposite w = edge p0-q0 (t).
    N[nt * 3] = nAcrossQW;
    N[nt * 3 + 1] = tOppU;
    N[nt * 3 + 2] = t;
    const relink = (o: number, from: number, to: number) => {
      if (o < 0) return;
      for (let s = 0; s < 3; s++) if (N[o * 3 + s] === from) N[o * 3 + s] = to;
    };
    relink(nAcrossUQ, nt, t);
    relink(tOppU, t, nt);
  }

  // Keep triangles inside the polygon (no super-triangle corner, centroid inside the ring).
  const out: number[] = [];
  const ringArr = P.subarray(0, nb * 2);
  for (let t = 0; t < count; t++) {
    if (!alive[t]) continue;
    const a = V[t * 3]!;
    const b = V[t * 3 + 1]!;
    const c = V[t * 3 + 2]!;
    if (a >= n || b >= n || c >= n) continue;
    const gx = (px(a) + px(b) + px(c)) / 3;
    const gy = (py(a) + py(b) + py(c)) / 3;
    if (!insideRing(ringArr, gx, gy)) continue;
    if (orient(px(a), py(a), px(b), py(b), px(c), py(c)) <= 0) throw new Error('triangulate: degenerate triangle');
    out.push(a, b, c);
  }
  // A fixed order: by smallest vertex, then the rest (rotation keeps the winding).
  const T = out.length / 3;
  const order = Array.from({ length: T }, (_, i) => i);
  const key = (i: number) => {
    const a = out[i * 3]!;
    const b = out[i * 3 + 1]!;
    const c = out[i * 3 + 2]!;
    return Math.min(a, b, c);
  };
  order.sort((i, j) => key(i) - key(j) || i - j);
  const tris = new Uint32Array(T * 3);
  order.forEach((src, dst) => {
    let a = out[src * 3]!;
    let b = out[src * 3 + 1]!;
    let c = out[src * 3 + 2]!;
    while (a !== Math.min(a, b, c)) [a, b, c] = [b, c, a];
    tris[dst * 3] = a;
    tris[dst * 3 + 1] = b;
    tris[dst * 3 + 2] = c;
  });
  return { points: P.slice(0, n * 2), tris, boundaryCount: nb };
}
