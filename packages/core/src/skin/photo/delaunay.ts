/**
 * Delaunay triangulation (Bowyer-Watson) for a few hundred 2D points: the
 * matched face landmarks of the photo projection (PRD F7 step 4).
 * Triangles come out counter-clockwise (in a y-up frame).
 */

export function delaunay(xy: ArrayLike<number>): Uint32Array {
  const n = xy.length / 2;
  if (n < 3) return new Uint32Array(0);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, xy[i * 2]!);
    maxX = Math.max(maxX, xy[i * 2]!);
    minY = Math.min(minY, xy[i * 2 + 1]!);
    maxY = Math.max(maxY, xy[i * 2 + 1]!);
  }
  // Work in a normalised frame for stable circumcircle tests.
  const scale = Math.max(maxX - minX, maxY - minY) || 1;
  const px = new Float64Array(n + 3);
  const py = new Float64Array(n + 3);
  for (let i = 0; i < n; i++) {
    px[i] = (xy[i * 2]! - minX) / scale;
    py[i] = (xy[i * 2 + 1]! - minY) / scale;
  }
  // Super triangle well outside the unit square.
  px[n] = -10;
  py[n] = -10;
  px[n + 1] = 20;
  py[n + 1] = -10;
  px[n + 2] = 0.5;
  py[n + 2] = 20;
  interface Tri {
    a: number;
    b: number;
    c: number;
    cx: number;
    cy: number;
    r2: number;
  }
  const make = (a: number, b: number, c: number): Tri => {
    // Keep counter-clockwise order.
    const cross = (px[b]! - px[a]!) * (py[c]! - py[a]!) - (py[b]! - py[a]!) * (px[c]! - px[a]!);
    if (cross < 0) [b, c] = [c, b];
    const ax = px[a]!;
    const ay = py[a]!;
    const bx = px[b]!;
    const by = py[b]!;
    const cxp = px[c]!;
    const cyp = py[c]!;
    const d = 2 * (ax * (by - cyp) + bx * (cyp - ay) + cxp * (ay - by));
    const a2 = ax * ax + ay * ay;
    const b2 = bx * bx + by * by;
    const c2 = cxp * cxp + cyp * cyp;
    const ux = (a2 * (by - cyp) + b2 * (cyp - ay) + c2 * (ay - by)) / d;
    const uy = (a2 * (cxp - bx) + b2 * (ax - cxp) + c2 * (bx - ax)) / d;
    return { a, b, c, cx: ux, cy: uy, r2: (ax - ux) ** 2 + (ay - uy) ** 2 };
  };
  let tris: Tri[] = [make(n, n + 1, n + 2)];
  for (let i = 0; i < n; i++) {
    const x = px[i]!;
    const y = py[i]!;
    const bad: Tri[] = [];
    const keep: Tri[] = [];
    for (const t of tris) ((x - t.cx) ** 2 + (y - t.cy) ** 2 < t.r2 * (1 + 1e-12) ? bad : keep).push(t);
    // Boundary of the cavity: edges of bad triangles not shared with another bad triangle.
    const edges = new Map<string, [number, number]>();
    for (const t of bad) {
      for (const [u, v] of [
        [t.a, t.b],
        [t.b, t.c],
        [t.c, t.a],
      ] as [number, number][]) {
        const key = u < v ? `${u},${v}` : `${v},${u}`;
        if (edges.has(key)) edges.delete(key);
        else edges.set(key, [u, v]);
      }
    }
    for (const [u, v] of edges.values()) keep.push(make(u, v, i));
    tris = keep;
  }
  const out: number[] = [];
  for (const t of tris) if (t.a < n && t.b < n && t.c < n) out.push(t.a, t.b, t.c);
  return Uint32Array.from(out);
}

/** Edges used by exactly one triangle (the convex hull of a Delaunay triangulation). */
export function boundaryEdges(tris: ArrayLike<number>): [number, number][] {
  const count = new Map<string, [number, number, number]>();
  for (let t = 0; t < tris.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const u = tris[t + k]!;
      const v = tris[t + ((k + 1) % 3)]!;
      const key = u < v ? `${u},${v}` : `${v},${u}`;
      const e = count.get(key);
      if (e) e[2]++;
      else count.set(key, [u, v, 1]);
    }
  }
  return [...count.values()].filter((e) => e[2] === 1).map(([u, v]) => [u, v]);
}
