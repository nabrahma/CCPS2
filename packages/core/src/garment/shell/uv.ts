/**
 * Garment UVs (PRD Part 3, F28 step 7). Seams are where tailors put them:
 * each triangle belongs to a panel (front, back, sleeve halves, leg halves,
 * pockets, soles), and a panel's border is a UV seam. Each panel piece is
 * unwrapped with least squares conformal maps (Levy et al. 2002), solved by
 * conjugate gradient for a fixed number of iterations from a planar
 * projection, then every piece is packed into the unit square at one texel
 * density, upright, so M15's tiled materials line up at true scale.
 */
import { cross, dot, len, normalize, sub, type Vec3 } from './vec';

/** Conjugate gradient iterations of the LSCM solve. */
export const LSCM_ITERATIONS = 400;
/** Empty space around each packed piece (UV units). */
export const PACK_GUTTER = 0.006;

/** Projection basis of a panel: u to the right and v up as seen from outside. */
export function panelBasis(normal: Vec3): [Vec3, Vec3] {
  const n = normalize(normal);
  if (Math.abs(n[1]) > 0.7) {
    // Soles, brims, caps: seen from above or below.
    const u: Vec3 = [1, 0, 0];
    const v: Vec3 = n[1] > 0 ? [0, 0, -1] : [0, 0, 1];
    return [u, v];
  }
  const u = normalize(cross([0, 1, 0], n));
  const v = cross(n, u);
  return [u, v];
}

/**
 * Least squares conformal map of one piece (a disc). `init` (2 per vertex) is
 * the starting guess and fixes the two pinned vertices: the ones furthest
 * apart along the longer side of the guess. Returns UVs in the guess's units.
 */
export function lscm(P: Float64Array, tris: Uint32Array, init: Float64Array, iterations = LSCM_ITERATIONS): Float64Array {
  const n = P.length / 3;
  const T = tris.length / 3;
  if (n < 3 || T === 0) return init.slice();
  // Pins along the longer extent of the guess.
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (let i = 0; i < n; i++) {
    minU = Math.min(minU, init[i * 2]!);
    maxU = Math.max(maxU, init[i * 2]!);
    minV = Math.min(minV, init[i * 2 + 1]!);
    maxV = Math.max(maxV, init[i * 2 + 1]!);
  }
  const axis = maxU - minU >= maxV - minV ? 0 : 1;
  let p0 = 0;
  let p1 = 0;
  for (let i = 1; i < n; i++) {
    if (init[i * 2 + axis]! < init[p0 * 2 + axis]!) p0 = i;
    if (init[i * 2 + axis]! > init[p1 * 2 + axis]!) p1 = i;
  }
  if (p0 === p1) return init.slice();
  // Per triangle: three complex coefficients (a + ib) / dT.
  const ca = new Float64Array(T * 3);
  const cb = new Float64Array(T * 3);
  for (let t = 0; t < T; t++) {
    const i0 = tris[t * 3]!;
    const i1 = tris[t * 3 + 1]!;
    const i2 = tris[t * 3 + 2]!;
    const a: Vec3 = [P[i0 * 3]!, P[i0 * 3 + 1]!, P[i0 * 3 + 2]!];
    const e1 = sub([P[i1 * 3]!, P[i1 * 3 + 1]!, P[i1 * 3 + 2]!], a);
    const e2 = sub([P[i2 * 3]!, P[i2 * 3 + 1]!, P[i2 * 3 + 2]!], a);
    const nrm = cross(e1, e2);
    const area2 = len(nrm);
    if (area2 < 1e-14) continue;
    const x = normalize(e1);
    const y = normalize(cross(nrm, x));
    const q = [0, 0, len(e1), 0, dot(e2, x), dot(e2, y)];
    const d = Math.sqrt(area2);
    // W0 = q2 - q1, W1 = q0 - q2, W2 = q1 - q0
    ca[t * 3] = (q[4]! - q[2]!) / d;
    cb[t * 3] = (q[5]! - q[3]!) / d;
    ca[t * 3 + 1] = (q[0]! - q[4]!) / d;
    cb[t * 3 + 1] = (q[1]! - q[5]!) / d;
    ca[t * 3 + 2] = (q[2]! - q[0]!) / d;
    cb[t * 3 + 2] = (q[3]! - q[1]!) / d;
  }
  const pinned = new Uint8Array(n);
  pinned[p0] = 1;
  pinned[p1] = 1;
  // x = [u..., v...]; residual r = M x (2 rows per triangle); A = M^T M on the free part.
  const applyM = (x: Float64Array, out: Float64Array) => {
    for (let t = 0; t < T; t++) {
      let re = 0;
      let im = 0;
      for (let k = 0; k < 3; k++) {
        const v = tris[t * 3 + k]!;
        const a = ca[t * 3 + k]!;
        const b = cb[t * 3 + k]!;
        const u = x[v]!;
        const w = x[n + v]!;
        re += a * u - b * w;
        im += b * u + a * w;
      }
      out[t * 2] = re;
      out[t * 2 + 1] = im;
    }
  };
  const applyMT = (r: Float64Array, out: Float64Array) => {
    out.fill(0);
    for (let t = 0; t < T; t++) {
      const re = r[t * 2]!;
      const im = r[t * 2 + 1]!;
      for (let k = 0; k < 3; k++) {
        const v = tris[t * 3 + k]!;
        const a = ca[t * 3 + k]!;
        const b = cb[t * 3 + k]!;
        out[v] = out[v]! + a * re + b * im;
        out[n + v] = out[n + v]! + -b * re + a * im;
      }
    }
  };
  const x = new Float64Array(2 * n);
  for (let i = 0; i < n; i++) {
    x[i] = init[i * 2]!;
    x[n + i] = init[i * 2 + 1]!;
  }
  const mask = (g: Float64Array) => {
    for (let i = 0; i < n; i++) {
      if (pinned[i]) {
        g[i] = 0;
        g[n + i] = 0;
      }
    }
  };
  const tmpR = new Float64Array(T * 2);
  const Ax = (v: Float64Array, out: Float64Array) => {
    applyM(v, tmpR);
    applyMT(tmpR, out);
    mask(out);
  };
  // r = -A x0 (the pinned values are part of x and stay fixed).
  const r = new Float64Array(2 * n);
  Ax(x, r);
  for (let i = 0; i < 2 * n; i++) r[i] = -r[i]!;
  const p = r.slice();
  const Ap = new Float64Array(2 * n);
  let rr = 0;
  for (let i = 0; i < 2 * n; i++) rr += r[i]! * r[i]!;
  for (let it = 0; it < iterations && rr > 1e-30; it++) {
    Ax(p, Ap);
    let pAp = 0;
    for (let i = 0; i < 2 * n; i++) pAp += p[i]! * Ap[i]!;
    if (pAp <= 1e-30) break;
    const alpha = rr / pAp;
    for (let i = 0; i < 2 * n; i++) {
      x[i] = x[i]! + alpha * p[i]!;
      r[i] = r[i]! - alpha * Ap[i]!;
    }
    let rr2 = 0;
    for (let i = 0; i < 2 * n; i++) rr2 += r[i]! * r[i]!;
    const beta = rr2 / rr;
    rr = rr2;
    for (let i = 0; i < 2 * n; i++) p[i] = r[i]! + beta * p[i]!;
  }
  const out = new Float64Array(2 * n);
  for (let i = 0; i < n; i++) {
    out[i * 2] = x[i]!;
    out[i * 2 + 1] = x[n + i]!;
  }
  return out;
}

export interface UvPiece {
  /** UV (2 per piece vertex), any units: scaled to metres by `normalisePiece`. */
  uv: Float64Array;
  /** Surface area of the piece (m^2). */
  area: number;
}

/** Scale a piece's UVs so their area equals its surface area (UV units = metres), and face it outwards. */
export function normalisePiece(uv: Float64Array, tris: Uint32Array, area: number): void {
  let signed = 0;
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t]!;
    const b = tris[t + 1]!;
    const c = tris[t + 2]!;
    signed += (uv[b * 2]! - uv[a * 2]!) * (uv[c * 2 + 1]! - uv[a * 2 + 1]!) - (uv[c * 2]! - uv[a * 2]!) * (uv[b * 2 + 1]! - uv[a * 2 + 1]!);
  }
  const uvArea = Math.abs(signed) / 2;
  if (uvArea < 1e-14) return;
  const s = Math.sqrt(area / uvArea);
  // Mirror if the map came out flipped, about the piece's own centre.
  const flip = signed < 0;
  let cu = 0;
  for (let i = 0; i < uv.length / 2; i++) cu += uv[i * 2]!;
  cu /= uv.length / 2;
  for (let i = 0; i < uv.length / 2; i++) {
    uv[i * 2] = (flip ? cu - (uv[i * 2]! - cu) : uv[i * 2]!) * s;
    uv[i * 2 + 1] = uv[i * 2 + 1]! * s;
  }
}

/**
 * Pack pieces (UVs in metres) into the unit square at one density, in shelves
 * (tallest first), upright. Finds the largest density that fits by bisection.
 * Returns the density (UV units per metre); UVs are rewritten in place.
 */
export function packPieces(pieces: Float64Array[], gutter = PACK_GUTTER): number {
  const boxes = pieces.map((uv) => {
    let u0 = Infinity;
    let v0 = Infinity;
    let u1 = -Infinity;
    let v1 = -Infinity;
    for (let i = 0; i < uv.length / 2; i++) {
      u0 = Math.min(u0, uv[i * 2]!);
      v0 = Math.min(v0, uv[i * 2 + 1]!);
      u1 = Math.max(u1, uv[i * 2]!);
      v1 = Math.max(v1, uv[i * 2 + 1]!);
    }
    return { u0, v0, w: u1 - u0, h: v1 - v0 };
  });
  const order = boxes.map((_, i) => i).sort((a, b) => boxes[b]!.h - boxes[a]!.h || boxes[b]!.w - boxes[a]!.w || a - b);
  const place = (k: number): { x: number; y: number }[] | null => {
    const at: { x: number; y: number }[] = new Array(pieces.length);
    let x = gutter;
    let y = gutter;
    let rowH = 0;
    for (const i of order) {
      const w = boxes[i]!.w * k;
      const h = boxes[i]!.h * k;
      if (w + 2 * gutter > 1 || h + 2 * gutter > 1) return null;
      if (x + w + gutter > 1) {
        x = gutter;
        y += rowH + gutter;
        rowH = 0;
      }
      if (y + h + gutter > 1) return null;
      at[i] = { x, y };
      x += w + gutter;
      rowH = Math.max(rowH, h);
    }
    return at;
  };
  let lo = 0;
  let hi = 64;
  for (let it = 0; it < 40; it++) {
    const mid = (lo + hi) / 2;
    if (place(mid)) lo = mid;
    else hi = mid;
  }
  const at = place(lo)!;
  pieces.forEach((uv, i) => {
    const b = boxes[i]!;
    for (let j = 0; j < uv.length / 2; j++) {
      uv[j * 2] = at[i]!.x + (uv[j * 2]! - b.u0) * lo;
      uv[j * 2 + 1] = at[i]!.y + (uv[j * 2 + 1]! - b.v0) * lo;
    }
  });
  return lo;
}
