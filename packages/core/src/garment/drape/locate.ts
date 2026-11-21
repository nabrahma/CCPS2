/**
 * Point location in a 2D triangle mesh (a panel's triangulation in pattern coordinates): the triangle under
 * a point and its barycentric weights, through a uniform grid of triangle boxes. A point outside every
 * triangle (a curved edge's chord) gets the nearest triangle, with the weights of its nearest point.
 */
export class TriangleLocator {
  private readonly x0: number;
  private readonly y0: number;
  private readonly cell: number;
  private readonly nx: number;
  private readonly ny: number;
  private readonly cells: Int32Array[];

  constructor(
    private readonly P: ArrayLike<number>,
    private readonly tris: ArrayLike<number>,
  ) {
    const n = P.length / 2;
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
    const T = tris.length / 3;
    const area = Math.max(1e-12, (x1 - x0) * (y1 - y0));
    this.cell = Math.max(1e-9, Math.sqrt(area / Math.max(1, T)) * 1.5);
    this.x0 = x0;
    this.y0 = y0;
    this.nx = Math.max(1, Math.ceil((x1 - x0) / this.cell) + 1);
    this.ny = Math.max(1, Math.ceil((y1 - y0) / this.cell) + 1);
    const lists: number[][] = Array.from({ length: this.nx * this.ny }, () => []);
    for (let t = 0; t < T; t++) {
      let a0 = Infinity;
      let b0 = Infinity;
      let a1 = -Infinity;
      let b1 = -Infinity;
      for (let k = 0; k < 3; k++) {
        const v = tris[t * 3 + k]!;
        a0 = Math.min(a0, P[v * 2]!);
        a1 = Math.max(a1, P[v * 2]!);
        b0 = Math.min(b0, P[v * 2 + 1]!);
        b1 = Math.max(b1, P[v * 2 + 1]!);
      }
      const i0 = this.ix(a0);
      const i1 = this.ix(a1);
      const j0 = this.iy(b0);
      const j1 = this.iy(b1);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) lists[i * this.ny + j]!.push(t);
    }
    this.cells = lists.map((l) => Int32Array.from(l));
  }

  private ix(x: number): number {
    return Math.min(this.nx - 1, Math.max(0, Math.floor((x - this.x0) / this.cell)));
  }

  private iy(y: number): number {
    return Math.min(this.ny - 1, Math.max(0, Math.floor((y - this.y0) / this.cell)));
  }

  private bary(t: number, x: number, y: number, out: Float64Array): void {
    const P = this.P;
    const a = this.tris[t * 3]!;
    const b = this.tris[t * 3 + 1]!;
    const c = this.tris[t * 3 + 2]!;
    const ax = P[a * 2]!;
    const ay = P[a * 2 + 1]!;
    const v0x = P[b * 2]! - ax;
    const v0y = P[b * 2 + 1]! - ay;
    const v1x = P[c * 2]! - ax;
    const v1y = P[c * 2 + 1]! - ay;
    const v2x = x - ax;
    const v2y = y - ay;
    const den = v0x * v1y - v1x * v0y;
    const u = den !== 0 ? (v2x * v1y - v1x * v2y) / den : 0;
    const v = den !== 0 ? (v0x * v2y - v2x * v0y) / den : 0;
    out[0] = 1 - u - v;
    out[1] = u;
    out[2] = v;
  }

  /** The triangle under (x, y) (or nearest), with its barycentric weights in `out` (all in [0, 1]). */
  locate(x: number, y: number, out: Float64Array): number {
    const list = this.cells[this.ix(x) * this.ny + this.iy(y)]!;
    for (const t of list) {
      this.bary(t, x, y, out);
      if (out[0]! >= -1e-9 && out[1]! >= -1e-9 && out[2]! >= -1e-9) {
        clampBary(out);
        return t;
      }
    }
    // Outside: the nearest triangle over a growing ring of cells.
    let best = -1;
    let bd = Infinity;
    const tmp = new Float64Array(3);
    const ci = this.ix(x);
    const cj = this.iy(y);
    for (let r = 0; r < Math.max(this.nx, this.ny); r++) {
      for (let i = ci - r; i <= ci + r; i++)
        for (let j = cj - r; j <= cj + r; j++) {
          if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) continue;
          if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r) continue;
          for (const t of this.cells[i * this.ny + j]!) {
            const d = this.nearest(t, x, y, tmp);
            if (d < bd) {
              bd = d;
              best = t;
              out[0] = tmp[0]!;
              out[1] = tmp[1]!;
              out[2] = tmp[2]!;
            }
          }
        }
      if (best >= 0 && bd <= (r * this.cell) * (r * this.cell)) break;
    }
    return best;
  }

  /** Squared distance to triangle t and the weights of its nearest point. */
  private nearest(t: number, x: number, y: number, out: Float64Array): number {
    this.bary(t, x, y, out);
    if (out[0]! >= 0 && out[1]! >= 0 && out[2]! >= 0) return 0;
    const P = this.P;
    const v = [this.tris[t * 3]!, this.tris[t * 3 + 1]!, this.tris[t * 3 + 2]!];
    let bd = Infinity;
    for (let k = 0; k < 3; k++) {
      const a = v[k]!;
      const b = v[(k + 1) % 3]!;
      const ax = P[a * 2]!;
      const ay = P[a * 2 + 1]!;
      const ex = P[b * 2]! - ax;
      const ey = P[b * 2 + 1]! - ay;
      const l2 = ex * ex + ey * ey;
      let s = l2 > 0 ? ((x - ax) * ex + (y - ay) * ey) / l2 : 0;
      s = s < 0 ? 0 : s > 1 ? 1 : s;
      const dx = ax + s * ex - x;
      const dy = ay + s * ey - y;
      const d = dx * dx + dy * dy;
      if (d < bd) {
        bd = d;
        out[k] = 1 - s;
        out[(k + 1) % 3] = s;
        out[(k + 2) % 3] = 0;
      }
    }
    return bd;
  }
}

function clampBary(w: Float64Array): void {
  let s = 0;
  for (let k = 0; k < 3; k++) {
    w[k] = Math.max(0, w[k]!);
    s += w[k]!;
  }
  for (let k = 0; k < 3; k++) w[k] = w[k]! / s;
}
