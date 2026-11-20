/**
 * Edge factories (port of pygarment/garmentcode/edge_factory.py): circle arcs from points and an angle, a radius
 * or three points; quadratic curves fitted to end tangents (SciPy BFGS, as GarmentCode); straight sequences,
 * side cuts and darts. The SVG-file shapes (`halfs_from_svg`) are not ported (D-171).
 */
import { PI, sin, tan } from '../../math/dmath';
import { CircleEdge, circleFromPointsRadius, CurveEdge, Edge, EdgeSequence, GarmentRuntimeError, GarmentValueError, pySum } from './edge';
import { cdiv, cmul, QuadraticBezier, type P2 } from './num/curves';
import { minimize } from './num/optimize';
import { absToRel2d, closeEnough, norm2, relToAbs2d, vectorAngle, type Vert } from './utils';
import { sq } from './num/sq';

export { circleFromPointsRadius };

/** CircleEdgeFactory.from_points_angle. */
export function circleFromPointsAngle(start: Vert, end: Vert, arcAngle: number, right = true): CircleEdge {
  let toSum = false;
  if (arcAngle > PI) {
    arcAngle = 2 * PI - arcAngle;
    toSum = true;
  }
  const radius = 1 / sin(arcAngle / 2) / 2;
  const h = 1 / tan(arcAngle / 2) / 2;
  let cy = toSum ? radius + h : radius - h;
  cy *= right ? -1 : 1;
  return new CircleEdge(start, end, cy);
}

/** CircleEdgeFactory.from_rad_length. */
export function circleFromRadLength(rad: number, length: number, right = true, start?: Vert): CircleEdge {
  const maxLen = 2 * PI * rad;
  if (length > maxLen) throw new GarmentValueError('CircleEdge::ERROR::Incorrect length for specified radius');
  const largeArc = length > maxLen / 2;
  if (largeArc) length = maxLen - length;
  const wHalf = rad * sin(length / rad / 2);
  const edge = circleFromPointsRadius([-wHalf, 0], [wHalf, 0], rad, largeArc, right);
  if (start) {
    edge.snapTo(start);
    edge.start = start;
  }
  return edge;
}

/** CircleEdgeFactory.from_three_points (complex-number circumcentre, as in GarmentCode). */
export function circleFromThreePoints(start: Vert, end: Vert, pointOnArc: Vert, relative = false): CircleEdge {
  if (relative) pointOnArc = relToAbs2d(start, end, pointOnArc);
  const x: P2 = [start[0]!, start[1]!];
  const y: P2 = [pointOnArc[0]!, pointOnArc[1]!];
  const z: P2 = [end[0]!, end[1]!];
  let w: P2 = [z[0] - x[0], z[1] - x[1]];
  w = cdiv(w, [y[0] - x[0], y[1] - x[1]]);
  const absW = Math.sqrt(w[0] * w[0] + w[1] * w[1]);
  let c = cmul([x[0] - y[0], x[1] - y[1]], [w[0] - sq(absW), w[1]]);
  c = cdiv(c, [0, 2]);
  c = cdiv(c, [w[1], 0]);
  c = [c[0] - x[0], c[1] - x[1]];
  const rad = Math.sqrt(sq(c[0] + x[0]) + sq(c[1] + x[1]));
  const midDist = norm2([pointOnArc[0]! - (start[0]! + end[0]!) / 2, pointOnArc[1]! - (start[1]! + end[1]!) / 2]);
  const angle = vectorAngle([pointOnArc[0]! - start[0]!, pointOnArc[1]! - start[1]!], [end[0]! - start[0]!, end[1]! - start[1]!]);
  return circleFromPointsRadius(start, end, rad, midDist > rad, angle > 0);
}

/** _fit_tangents: squared tangent misfit of the [0,0] -> cp -> [1,0] quadratic. */
function fitTangents(cp: number[], t0: P2 | null, t1: P2 | null): number {
  const curve = new QuadraticBezier([0, 0], [cp[0]!, cp[1]!], [1, 0]);
    curve.pyComplex = true; // list_to_c: Python complex
  let fin = 0;
  if (t0 !== null) {
    const u = curve.unitTangent(0);
    fin += sq(u[0] - t0[0]) + sq(u[1] - t0[1]);
  }
  if (t1 !== null) {
    const u = curve.unitTangent(1);
    fin += sq(u[0] - t1[0]) + sq(u[1] - t1[1]);
  }
  return fin;
}

/** abs(z)**2 as Python computes it: hypot squared. */
export const absSq = (x: number, y: number): number => sq(Math.sqrt(x * x + y * y));

/** CurveEdgeFactory.curve_from_tangents (BFGS). */
export function curveFromTangents(start: Vert, end: Vert, targetTan0?: readonly number[] | null, targetTan1?: readonly number[] | null, initialGuess?: readonly number[] | null): CurveEdge {
  const norm = (v: readonly number[] | null | undefined): P2 | null => {
    if (v == null) return null;
    const r = absToRel2d(start, end, v, true);
    const n = norm2(r);
    return [r[0]! / n, r[1]! / n];
  };
  const t0 = norm(targetTan0);
  const t1 = norm(targetTan1);
  const out = minimize((cp) => {
    const curve = new QuadraticBezier([0, 0], [cp[0]!, cp[1]!], [1, 0]);
    curve.pyComplex = true; // list_to_c: Python complex
    let fin = 0;
    if (t0 !== null) {
      const u = curve.unitTangent(0);
      fin += absSq(u[0] - t0[0], u[1] - t0[1]);
    }
    if (t1 !== null) {
      const u = curve.unitTangent(1);
      fin += absSq(u[0] - t1[0], u[1] - t1[1]);
    }
    return fin;
  }, initialGuess ? [initialGuess[0]!, initialGuess[1]!] : [0.5, 0]);
  return new CurveEdge(start, end, [out.x.slice()], true);
}

export { fitTangents as _fitTangents };

/** EdgeSeqFactory.from_verts. */
export function fromVerts(verts: Vert[], loop = false): EdgeSequence {
  const seq = new EdgeSequence(new Edge(verts[0], verts[1]));
  for (let i = 2; i < verts.length; i++) seq.append(new Edge(seq.at(-1).end, verts[i]));
  if (loop) seq.append(new Edge(seq.at(-1).end, seq.edges[0]!.start));
  return seq;
}

/** EdgeSeqFactory.from_fractions. */
export function fromFractions(start: Vert, end: Vert, fracIn: number[]): EdgeSequence {
  const frac = fracIn.map(Math.abs);
  const fsum = pySum(frac);
  if (!closeEnough(fsum, 1, 1e-4)) throw new GarmentRuntimeError(`EdgeSequence::ERROR::fraction is incorrect. The sum ${fsum} is not 1`);
  const vx = end[0]! - start[0]!;
  const vy = end[1]! - start[1]!;
  const verts: Vert[] = [start];
  for (let i = 0; i < frac.length - 1; i++) {
    const last = verts[verts.length - 1]!;
    verts.push([last[0]! + frac[i]! * vx, last[1]! + frac[i]! * vy]);
  }
  verts.push(end);
  return fromVerts(verts);
}

/** EdgeSeqFactory.side_with_cut. */
export function sideWithCut(start: Vert = [0, 0], end: Vert = [1, 0], startCut = 0, endCut = 0): EdgeSequence {
  const verts: Vert[] = [start];
  const dx = end[0]! - start[0]!;
  const dy = end[1]! - start[1]!;
  if (startCut > 0) verts.push([start[0]! + startCut * dx, start[1]! + startCut * dy]);
  if (endCut > 0) verts.push([end[0]! - endCut * dx, end[1]! - endCut * dy]);
  verts.push(end);
  return fromVerts(verts);
}

/** EdgeSeqFactory.dart_shape(width, side_len, depth). */
export function dartShape(width: number, sideLen?: number | null, depth?: number | null): EdgeSequence {
  if ((sideLen === undefined || sideLen === null) && (depth === undefined || depth === null)) throw new GarmentValueError('EdgeFactory::ERROR::dart shape is not fully specified. Add dart side length or dart perpendicular');
  let d: number;
  if (depth === undefined || depth === null) {
    if (width / 2 > sideLen!) throw new GarmentValueError(`EdgeFactory::ERROR::Requested dart shape (w=${width}, side=${sideLen}) does not form a valid triangle`);
    d = Math.sqrt(sq(sideLen!) - sq(width / 2));
  } else d = depth;
  return fromVerts([
    [0, 0],
    [width / 2, -d],
    [width, 0],
  ]);
}
