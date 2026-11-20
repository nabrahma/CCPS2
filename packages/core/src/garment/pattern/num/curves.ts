/**
 * Plane curve segments as svgpathtools defines them (Line, QuadraticBezier, CubicBezier, Arc), with the operations
 * GarmentCode uses: point, derivative, unit tangent, curvature, length and inverse length, crop and split, bounding
 * box, and segment-by-line intersection.
 *
 * Points are `[x, y]` pairs (svgpathtools uses complex numbers); every formula keeps svgpathtools' operation order so
 * results agree with it to rounding. Where svgpathtools approximates numerically and the exact answer is known
 * (the parameter of a cropped Bezier's end point), the exact answer is used; the difference is far below the port's
 * 1e-6 tolerance. Transcendentals come from dmath.
 */
import { acos, cos, log, PI, sin } from '../../../math/dmath';
import { quad } from './quad';
import { polyval, realRootsIn } from './roots';
import { cube, ipow, sq } from './sq';

export type P2 = [number, number];

/** svgpathtools' default tolerances. */
export const LENGTH_ERROR = 1e-12;
export const ILENGTH_S_TOL = 1e-12;
export const ILENGTH_ERROR = 1e-12;
export const ILENGTH_MAXITS = 10000;

const cabs = (x: number, y: number): number => Math.sqrt(x * x + y * y);
const npRadians = (d: number): number => d * (PI / 180);
const npDegrees = (r: number): number => r * (180 / PI);

/** numpy isclose(a, b) with default tolerances. */
export const isclose = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-8 + 1e-5 * Math.abs(b);

export type Segment = Line | QuadraticBezier | CubicBezier | Arc;

abstract class SegBase {
  abstract start: P2;
  abstract end: P2;
  abstract point(t: number): P2;
  abstract derivative(t: number, n?: number): P2;
  abstract length(t0?: number, t1?: number, error?: number): number;
  abstract cropped(t0: number, t1: number): Segment;

  /** svgpathtools inv_arclength for Bezier and Arc segments: bisection on the arc length. */
  ilength(s: number, sTol = ILENGTH_S_TOL, maxits = ILENGTH_MAXITS, error = ILENGTH_ERROR): number {
    const curveLength = this.length(0, 1, error);
    if (!(curveLength > 0)) throw new Error('inv_arclength: curve has zero length');
    if (!(s >= 0 && s <= curveLength)) throw new RangeError('s is not in interval [0, curve.length()].');
    if (s === 0) return 0;
    if (s === curveLength) return 1;
    let tUpper = 1;
    let tLower = 0;
    let sT = 0;
    for (let it = 0; it < maxits; it++) {
      const t = (tLower + tUpper) / 2;
      sT = this.length(0, t, error);
      if (Math.abs(sT - s) < sTol) return t;
      else if (sT < s) tLower = t;
      else tUpper = t;
      if (tUpper === tLower) return t;
    }
    throw new Error(`Maximum iterations reached with s(t) - s = ${sT - s}.`);
  }

  /**
   * Control points held as numpy complex128 (every GarmentCode edge curve) divide by multiplying with the
   * reciprocal, as numpy's complex division does; Python complex values (list_to_c) divide exactly.
   */
  pyComplex = false;

  unitTangent(t: number): P2 {
    const d = this.derivative(t);
    const a = cabs(d[0], d[1]);
    if (a !== 0 && !this.pyComplex) {
      const scl = 1 / a;
      return [d[0] * scl, d[1] * scl];
    }
    if (a === 0) {
      // Limit of the tangent direction where the derivative vanishes: step inside the segment.
      const e = t < 0.5 ? 1e-9 : -1e-9;
      const d2 = this.derivative(t + e);
      const a2 = cabs(d2[0], d2[1]);
      return [d2[0] / a2, d2[1] / a2];
    }
    return [d[0] / a, d[1] / a];
  }

  /** svgpathtools segment_curvature. */
  curvature(t: number): number {
    const dz = this.derivative(t);
    const ddz = this.derivative(t, 2);
    const [dx, dy] = dz;
    const [ddx, ddy] = ddz;
    const num = Math.abs(dx * ddy - dy * ddx);
    const den = cube(Math.sqrt(dx * dx + dy * dy));
    if (den === 0) {
      if (num !== 0) return Infinity;
      const e = t < 0.5 ? 1e-7 : -1e-7;
      return this.curvature(t + e);
    }
    return num / den;
  }
}

export class Line extends SegBase {
  constructor(
    public start: P2,
    public end: P2,
  ) {
    super();
  }
  bpoints(): P2[] {
    return [this.start, this.end];
  }
  point(t: number): P2 {
    const dx = this.end[0] - this.start[0];
    const dy = this.end[1] - this.start[1];
    return [this.start[0] + dx * t, this.start[1] + dy * t];
  }
  derivative(_t: number, n = 1): P2 {
    return n === 1 ? [this.end[0] - this.start[0], this.end[1] - this.start[1]] : [0, 0];
  }
  length(t0 = 0, t1 = 1): number {
    return cabs(this.end[0] - this.start[0], this.end[1] - this.start[1]) * (t1 - t0);
  }
  override ilength(s: number): number {
    const L = this.length();
    if (!(L > 0)) throw new Error('inv_arclength: curve has zero length');
    if (!(s >= 0 && s <= L)) throw new RangeError('s is not in interval [0, curve.length()].');
    if (s === 0) return 0;
    if (s === L) return 1;
    return s / L;
  }
  cropped(t0: number, t1: number): Line {
    return new Line(this.point(t0), this.point(t1));
  }
  split(t: number): [Line, Line] {
    const p = this.point(t);
    return [new Line(this.start, p), new Line(p, this.end)];
  }
  bbox(): [number, number, number, number] {
    return [Math.min(this.start[0], this.end[0]), Math.max(this.start[0], this.end[0]), Math.min(this.start[1], this.end[1]), Math.max(this.start[1], this.end[1])];
  }
}

/** de Casteljau split of control points at t (svgpathtools split_bezier). */
export function splitBezier(bp: readonly P2[], t: number): [P2[], P2[]] {
  const left: P2[] = [];
  const right: P2[] = [];
  let pts = bp.slice();
  while (pts.length > 1) {
    left.push(pts[0]!);
    right.push(pts[pts.length - 1]!);
    const next: P2[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      next.push([(1 - t) * a[0] + t * b[0], (1 - t) * a[1] + t * b[1]]);
    }
    pts = next;
  }
  left.push(pts[0]!);
  right.push(pts[0]!);
  right.reverse();
  return [left, right];
}

/** svgpathtools crop_bezier, with the exact parameter of the end point on the trimmed curve. */
function cropBezier(bp: readonly P2[], t0: number, t1: number): P2[] {
  if (!(t0 < t1)) throw new Error('crop_bezier: t0 must be below t1');
  if (t0 === 0) return splitBezier(bp, t1)[0];
  if (t1 === 1) return splitBezier(bp, t0)[1];
  const trimmed = splitBezier(bp, t0)[1];
  return splitBezier(trimmed, (t1 - t0) / (1 - t0))[0];
}

/** Coefficients of the x or y polynomial of a Bezier (highest power first), svgpathtools bezier2polynomial. */
export function bezierPoly(bp: readonly number[]): number[] {
  if (bp.length === 4) {
    const [p0, p1, p2, p3] = bp as [number, number, number, number];
    return [-p0 + 3 * (p1 - p2) + p3, 3 * (p0 - 2 * p1 + p2), 3 * (p1 - p0), p0];
  }
  if (bp.length === 3) {
    const [p0, p1, p2] = bp as [number, number, number];
    return [p0 - 2 * p1 + p2, 2 * (p1 - p0), p0];
  }
  if (bp.length === 2) return [bp[1]! - bp[0]!, bp[0]!];
  return [bp[0]!];
}

export class QuadraticBezier extends SegBase {
  constructor(
    public start: P2,
    public control: P2,
    public end: P2,
  ) {
    super();
  }
  bpoints(): P2[] {
    return [this.start, this.control, this.end];
  }
  point(t: number): P2 {
    const tc = 1 - t;
    const a = tc * tc;
    const b = 2 * tc * t;
    const c = t * t;
    return [a * this.start[0] + b * this.control[0] + c * this.end[0], a * this.start[1] + b * this.control[1] + c * this.end[1]];
  }
  derivative(t: number, n = 1): P2 {
    const [p0, p1, p2] = [this.start, this.control, this.end];
    if (n === 1) {
      return [2 * ((p1[0] - p0[0]) * (1 - t) + (p2[0] - p1[0]) * t), 2 * ((p1[1] - p0[1]) * (1 - t) + (p2[1] - p1[1]) * t)];
    }
    if (n === 2) return [2 * (p2[0] - 2 * p1[0] + p0[0]), 2 * (p2[1] - 2 * p1[1] + p0[1])];
    return [0, 0];
  }
  length(t0 = 0, t1 = 1): number {
    const ax = this.start[0] - 2 * this.control[0] + this.end[0];
    const ay = this.start[1] - 2 * this.control[1] + this.end[1];
    const bx = 2 * (this.control[0] - this.start[0]);
    const by = 2 * (this.control[1] - this.start[1]);
    const aDotB = ax * bx + ay * by;
    const absA = cabs(ax, ay);
    const absB = cabs(bx, by);
    if (absA < 1e-12) return absB * (t1 - t0);
    const c2 = 4 * (sq(ax) + sq(ay));
    const c1 = 4 * aDotB;
    const c0 = sq(bx) + sq(by);
    const beta = c1 / (2 * c2);
    const gamma = c0 / c2 - sq(beta);
    const dq1 = Math.sqrt(c2 * sq(t1) + c1 * t1 + c0);
    const dq0 = Math.sqrt(c2 * sq(t0) + c1 * t0 + c0);
    const sc2 = Math.sqrt(c2);
    const logarand = (sc2 * (t1 + beta) + dq1) / (sc2 * (t0 + beta) + dq0);
    let s = (t1 + beta) * dq1 - (t0 + beta) * dq0 + gamma * sc2 * log(logarand);
    s /= 2;
    if (s !== s) {
      const tstar = absB / (2 * absA);
      if (t1 < tstar) return absA * (sq(t0) - sq(t1)) - absB * (t0 - t1);
      if (tstar < t0) return absA * (sq(t1) - sq(t0)) - absB * (t1 - t0);
      return absA * (sq(t1) + sq(t0)) - absB * (t1 + t0) + sq(absB) / (2 * absA);
    }
    return s;
  }
  cropped(t0: number, t1: number): QuadraticBezier {
    const p = cropBezier(this.bpoints(), t0, t1);
    return new QuadraticBezier(p[0]!, p[1]!, p[2]!);
  }
  split(t: number): [QuadraticBezier, QuadraticBezier] {
    const [a, b] = splitBezier(this.bpoints(), t);
    return [new QuadraticBezier(a[0]!, a[1]!, a[2]!), new QuadraticBezier(b[0]!, b[1]!, b[2]!)];
  }
  bbox(): [number, number, number, number] {
    return bezierBBox(this.bpoints());
  }
}

export class CubicBezier extends SegBase {
  private cachedLength: number | undefined;
  constructor(
    public start: P2,
    public control1: P2,
    public control2: P2,
    public end: P2,
  ) {
    super();
  }
  bpoints(): P2[] {
    return [this.start, this.control1, this.control2, this.end];
  }
  point(t: number): P2 {
    const s = this.start;
    const c1 = this.control1;
    const c2 = this.control2;
    const e = this.end;
    const f = (k: 0 | 1): number => s[k] + t * (3 * (c1[k] - s[k]) + t * (3 * (s[k] + c2[k]) - 6 * c1[k] + t * (-s[k] + 3 * (c1[k] - c2[k]) + e[k])));
    return [f(0), f(1)];
  }
  derivative(t: number, n = 1): P2 {
    const p = this.bpoints();
    const f = (k: 0 | 1): number => {
      if (n === 1) return 3 * (p[1]![k] - p[0]![k]) * sq(1 - t) + 6 * (p[2]![k] - p[1]![k]) * (1 - t) * t + 3 * (p[3]![k] - p[2]![k]) * sq(t);
      if (n === 2) return 6 * ((1 - t) * (p[2]![k] - 2 * p[1]![k] + p[0]![k]) + t * (p[3]![k] - 2 * p[2]![k] + p[1]![k]));
      if (n === 3) return 6 * (p[3]![k] - 3 * (p[2]![k] - p[1]![k]) - p[0]![k]);
      return 0;
    };
    return [f(0), f(1)];
  }
  length(t0 = 0, t1 = 1, error = LENGTH_ERROR): number {
    const full = t0 === 0 && t1 === 1;
    if (full && this.cachedLength !== undefined) return this.cachedLength;
    const s = quad(
      (tau) => {
        const d = this.derivative(tau);
        return cabs(d[0], d[1]);
      },
      t0,
      t1,
      error,
      1.49e-8,
      1000,
    );
    if (full) this.cachedLength = s;
    return s;
  }
  cropped(t0: number, t1: number): CubicBezier {
    const p = cropBezier(this.bpoints(), t0, t1);
    return new CubicBezier(p[0]!, p[1]!, p[2]!, p[3]!);
  }
  split(t: number): [CubicBezier, CubicBezier] {
    const [a, b] = splitBezier(this.bpoints(), t);
    return [new CubicBezier(a[0]!, a[1]!, a[2]!, a[3]!), new CubicBezier(b[0]!, b[1]!, b[2]!, b[3]!)];
  }
  bbox(): [number, number, number, number] {
    return bezierBBox(this.bpoints());
  }
}

function bezierBBox(bp: readonly P2[]): [number, number, number, number] {
  const range = (k: 0 | 1): [number, number] => {
    const c = bezierPoly(bp.map((p) => p[k]));
    const ts = [0, 1, ...realRootsIn(c.slice(0, -1).map((a, i) => a * (c.length - 1 - i)), 0, 1)];
    const vals = ts.map((t) => polyval(c, t));
    return [Math.min(...vals), Math.max(...vals)];
  };
  const [x0, x1] = range(0);
  const [y0, y1] = range(1);
  return [x0, x1, y0, y1];
}

/**
 * svgpathtools Arc with a circular or elliptic radius and a rotation in degrees. The centre and angles come from the
 * SVG implementation notes (F.6.5), with svgpathtools' radius autoscaling and clipping.
 */
export class Arc extends SegBase {
  radius: P2;
  readonly largeArc: boolean;
  readonly sweep: boolean;
  readonly phi: number;
  readonly rot: P2;
  center: P2 = [0, 0];
  theta = 0;
  delta = 0;
  private cachedLength: number | undefined;

  constructor(
    public start: P2,
    radius: P2,
    public rotation: number,
    largeArc: boolean,
    sweep: boolean,
    public end: P2,
    public autoscaleRadius = true,
  ) {
    super();
    this.radius = [Math.abs(radius[0]), Math.abs(radius[1])];
    this.largeArc = largeArc;
    this.sweep = sweep;
    this.phi = npRadians(rotation);
    this.rot = [cos(this.phi), sin(this.phi)];
    this.parameterize();
  }

  private parameterize(): void {
    let rx = this.radius[0];
    let ry = this.radius[1];
    let rxSqd = rx * rx;
    let rySqd = ry * ry;
    // zp1 = (1 / rot) * (start - end) / 2, complex arithmetic as Python does it.
    const [rr, ri] = this.rot;
    const inv = cdiv([1, 0], [rr, ri]);
    const d: P2 = [this.start[0] - this.end[0], this.start[1] - this.end[1]];
    const m = cmul(inv, d);
    const x1p = m[0] / 2;
    const y1p = m[1] / 2;
    const x1pSqd = x1p * x1p;
    const y1pSqd = y1p * y1p;
    const radiusCheck = x1pSqd / rxSqd + y1pSqd / rySqd;
    if (radiusCheck > 1) {
      if (!this.autoscaleRadius) throw new Error('No such elliptic arc exists.');
      rx *= Math.sqrt(radiusCheck);
      ry *= Math.sqrt(radiusCheck);
      this.radius = [rx, ry];
      rxSqd = rx * rx;
      rySqd = ry * ry;
    }
    const tmp = rxSqd * y1pSqd + rySqd * x1pSqd;
    const radicand = (rxSqd * rySqd - tmp) / tmp;
    const radical = isclose(radicand, 0) ? 0 : Math.sqrt(radicand);
    const sign = this.largeArc === this.sweep ? -radical : radical;
    const cp: P2 = [sign * ((rx * y1p) / ry), sign * -((ry * x1p) / rx)];
    const c = cmul(this.rot, cp);
    this.center = [c[0] + (this.start[0] + this.end[0]) / 2, c[1] + (this.start[1] + this.end[1]) / 2];
    const clip = (v: number): number => (v < -1 ? -1 : v > 1 ? 1 : v);
    const u1: P2 = [clip((x1p - cp[0]) / rx), clip((y1p - cp[1]) / ry)];
    const u2: P2 = [clip((-x1p - cp[0]) / rx), clip((-y1p - cp[1]) / ry)];
    if (u1[1] > 0) this.theta = npDegrees(acos(u1[0]));
    else if (u1[1] < 0) this.theta = -npDegrees(acos(u1[0]));
    else this.theta = u1[0] > 0 ? 0 : 180;
    const detUv = u1[0] * u2[1] - u1[1] * u2[0];
    const acosand = clip(u1[0] * u2[0] + u1[1] * u2[1]);
    if (detUv > 0) this.delta = npDegrees(acos(acosand));
    else if (detUv < 0) this.delta = -npDegrees(acos(acosand));
    else this.delta = u1[0] * u2[0] + u1[1] * u2[1] > 0 ? 0 : 180;
    if (!this.sweep && this.delta >= 0) this.delta -= 360;
    else if (this.largeArc && this.delta <= 0) this.delta += 360;
  }

  point(t: number): P2 {
    const angle = ((this.theta + t * this.delta) * PI) / 180;
    const [cosphi, sinphi] = this.rot;
    const [rx, ry] = this.radius;
    const ca = cos(angle);
    const sa = sin(angle);
    return [rx * cosphi * ca - ry * sinphi * sa + this.center[0], rx * sinphi * ca + ry * cosphi * sa + this.center[1]];
  }

  derivative(t: number, n = 1): P2 {
    const angle = npRadians(this.theta + t * this.delta);
    const phi = npRadians(this.rotation);
    const [rx, ry] = this.radius;
    const k = ipow((this.delta * PI) / 180, n);
    const cp = cos(phi);
    const sp = sin(phi);
    const ca = cos(angle);
    const sa = sin(angle);
    const m = n % 4;
    let re: number;
    let im: number;
    if (m === 0) return [rx * cp * ca - ry * sp * sa, rx * sp * ca + ry * cp * sa];
    if (m === 1) {
      re = -rx * cp * sa - ry * sp * ca;
      im = -rx * sp * sa + ry * cp * ca;
    } else if (m === 2) {
      re = -rx * cp * ca + ry * sp * sa;
      im = -rx * sp * ca - ry * cp * sa;
    } else {
      re = rx * cp * sa + ry * sp * ca;
      im = rx * sp * sa - ry * cp * ca;
    }
    return [k * re, k * im];
  }

  length(t0 = 0, t1 = 1, error = LENGTH_ERROR): number {
    const full = t0 === 0 && t1 === 1;
    if (full && this.cachedLength !== undefined) return this.cachedLength;
    const s = quad(
      (tau) => {
        const d = this.derivative(tau);
        return cabs(d[0], d[1]);
      },
      t0,
      t1,
      error,
      1.49e-8,
      1000,
    );
    if (full) this.cachedLength = s;
    return s;
  }

  cropped(t0: number, t1: number): Arc {
    const large = Math.abs(this.delta * (t1 - t0)) <= 180 ? false : true;
    return new Arc(this.point(t0), this.radius, this.rotation, large, this.sweep, this.point(t1), this.autoscaleRadius);
  }

  split(t: number): [Arc, Arc] {
    return [this.cropped(0, t), this.cropped(t, 1)];
  }
}

/** Python complex multiplication. */
export function cmul(a: P2, b: P2): P2 {
  return [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
}

/** Python's complex division (Smith's algorithm, as CPython implements it). */
export function cdiv(a: P2, b: P2): P2 {
  const absBr = Math.abs(b[0]);
  const absBi = Math.abs(b[1]);
  if (absBr >= absBi) {
    if (absBr === 0) return [NaN, NaN];
    const ratio = b[1] / b[0];
    const denom = b[0] + b[1] * ratio;
    return [(a[0] + a[1] * ratio) / denom, (a[1] - a[0] * ratio) / denom];
  }
  const ratio = b[0] / b[1];
  const denom = b[0] * ratio + b[1];
  return [(a[0] * ratio + a[1]) / denom, (a[1] * ratio - a[0]) / denom];
}

/** Real roots of a Bezier's polynomial in [0, 1] (svgpathtools polyroots01). */
function bezierRoots01(c: number[]): number[] {
  return realRootsIn(c, 0, 1);
}

/**
 * Intersections (t on segment, t on line) of a Bezier or line with a line, as svgpathtools'
 * bezier_by_line_intersections: rotate the plane so the line lies on the x axis, then take real roots of y.
 */
export function intersectWithLine(seg: Line | QuadraticBezier | CubicBezier, line: Line): [number, number][] {
  const l0 = line.start;
  const l1 = line.end;
  const ex = l1[0] - l0[0];
  const ey = l1[1] - l0[1];
  const lineLength = cabs(ex, ey);
  // rotation = |e| / e  (complex), applied as multiplication
  const rot = cdiv([lineLength, 0], [ex, ey]);
  const tb = seg.bpoints().map((z) => cmul(rot, [z[0] - l0[0], z[1] - l0[1]]));
  if (seg instanceof Line) {
    // Line-line: svgpathtools solves the 2x2 system directly.
    return lineLine(seg, line);
  }
  const ys = bezierRoots01(bezierPoly(tb.map((p) => p[1])));
  const xs = bezierPoly(tb.map((p) => p[0]));
  const out: [number, number][] = [];
  for (const t of ys) {
    const xval = polyval(xs, t);
    if (xval >= 0 && xval <= lineLength) out.push([t, xval / lineLength]);
  }
  return out;
}

function lineLine(a: Line, o: Line): [number, number][] {
  const A = [a.start[0], a.end[0]];
  const B = [a.start[1], a.end[1]];
  const C = [o.start[0], o.end[0]];
  const D = [o.start[1], o.end[1]];
  const denom = (A[1]! - A[0]!) * (D[0]! - D[1]!) - (B[1]! - B[0]!) * (C[0]! - C[1]!);
  if (isclose(denom, 0)) return [];
  const t1 = (C[0]! * (B[0]! - D[1]!) - C[1]! * (B[0]! - D[0]!) - A[0]! * (D[0]! - D[1]!)) / denom;
  const t2 = -(A[1]! * (B[0]! - D[0]!) - A[0]! * (B[1]! - D[0]!) - C[0]! * (B[0]! - B[1]!)) / denom;
  return t1 >= 0 && t1 <= 1 && t2 >= 0 && t2 <= 1 ? [[t1, t2]] : [];
}

/** svgpathtools' control-point bounding-box rejection test used before segment intersections. */
function bpointsDisjoint(a: readonly P2[], b: readonly P2[]): boolean {
  for (const k of [0, 1] as const) {
    const ob = b.map((p) => p[k]);
    const sb = a.map((p) => p[k]);
    if (Math.min(...ob) > Math.max(...sb)) return true;
    if (Math.max(...ob) < Math.min(...sb)) return true;
  }
  return false;
}

/**
 * Intersections between two non-arc segments as parameter pairs. Line cases follow svgpathtools exactly; two curves
 * are intersected by recursive subdivision of their control hulls to 1e-12 in parameter.
 */
export function intersectSegments(a: Line | QuadraticBezier | CubicBezier, b: Line | QuadraticBezier | CubicBezier): [number, number][] {
  if (bpointsDisjoint(a.bpoints(), b.bpoints())) return [];
  if (b instanceof Line) return a instanceof Line ? lineLine(a, b) : intersectWithLine(a, b);
  if (a instanceof Line) return intersectWithLine(b, a).map(([t2, t1]) => [t1, t2]);
  const out: [number, number][] = [];
  const recurse = (pa: P2[], a0: number, a1: number, pb: P2[], b0: number, b1: number, depth: number): void => {
    if (bpointsDisjoint(pa, pb)) return;
    if (depth > 48 || (a1 - a0 < 1e-12 && b1 - b0 < 1e-12)) {
      const t1 = (a0 + a1) / 2;
      const t2 = (b0 + b1) / 2;
      if (!out.some(([u, v]) => Math.abs(u - t1) < 1e-8 && Math.abs(v - t2) < 1e-8)) out.push([t1, t2]);
      return;
    }
    const [la, ra] = splitBezier(pa, 0.5);
    const [lb, rb] = splitBezier(pb, 0.5);
    const am = (a0 + a1) / 2;
    const bm = (b0 + b1) / 2;
    recurse(la, a0, am, lb, b0, bm, depth + 1);
    recurse(la, a0, am, rb, bm, b1, depth + 1);
    recurse(ra, am, a1, lb, b0, bm, depth + 1);
    recurse(ra, am, a1, rb, bm, b1, depth + 1);
  };
  recurse(a.bpoints(), 0, 1, b.bpoints(), 0, 1, 0);
  return out;
}
