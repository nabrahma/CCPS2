/**
 * Panel and edge operators (port of pygarment/garmentcode/operators.py): cutting a shape into a corner or an
 * edge (darts, armholes, necklines, slits), distributing copies of a panel, evening sleeve openings and bending a
 * curve to match end tangents. The optimisation calls are SciPy's (see num/optimize).
 */
import { atan } from '../../math/dmath';
import { CurveEdge, EdgeSequence, GarmentRuntimeError, GarmentValueError, PYG_ILENGTH_S_TOL, type Edge } from './edge';
import { Interface } from './interface';
import { Arc, CubicBezier, intersectSegments, Line, type P2, type Segment } from './num/curves';
import { minimize } from './num/optimize';
import { Rotation } from './num/rotation';
import { sq } from './num/sq';
import type { BaseComponent, Panel } from './panel';
import { closeEnough, cross2, deepcopy, linspace01, norm2, npSign, vectorAngle, type Vert } from './utils';

const dist2 = (a: P2, b: P2): number => norm2([b[0] - a[0], b[1] - a[1]]);

/** _fit_location_corner. */
export function fitLocationCorner(l: number[], diffTarget: readonly number[], c1: Segment, c2: Segment): number {
  const p1 = c1.point(l[0]!);
  const p2 = c2.point(l[1]!);
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  return sq(dx - diffTarget[0]!) + sq(dy - diffTarget[1]!);
}

/** _fit_location_edge. */
export function fitLocationEdge(shift: number[], location: number, widthTarget: number, curve: Segment): number {
  const pc = curve.point(location);
  const p1 = curve.point(location + shift[0]!);
  const p2 = curve.point(location - shift[1]!);
  const reg = sq(dist2(p1, pc) - dist2(p2, pc));
  return sq(dist2(p1, p2) - widthTarget) + reg;
}

/** cut_corner: replace the corner between two edges of a panel with the given shape. */
export function cutCorner(targetShape: EdgeSequence, targetInterface: Interface): [EdgeSequence, Interface] {
  const cornerShape = targetShape.copy();
  const panel = targetInterface.panel[0]!;
  let targetEdges = targetInterface.edges;
  if (targetEdges.edges[0]!.start === targetEdges.at(-1).end) targetEdges.edges.reverse();
  if (cornerShape.edges[0]!.start === cornerShape.at(-1).end) cornerShape.edges.reverse();
  if (cornerShape.edges[0]!.start[1]! > cornerShape.at(-1).end[1]!) {
    cornerShape.reverse();
    cornerShape.snapTo([0, 0]);
  }
  const shortcut = cornerShape.shortcut();
  let curve1 = targetEdges.edges[0]!.asCurve();
  let curve2 = targetEdges.edges[1]!.asCurve();
  let swapped = false;
  if (targetEdges.edges[0]!.start[1]! > targetEdges.at(-1).end[1]!) {
    const t = curve1;
    curve1 = curve2;
    curve2 = t;
    swapped = true;
  }
  const diff = [shortcut[1]![0]! - shortcut[0]![0]!, shortcut[1]![1]! - shortcut[0]![1]!];
  const out = minimize((l) => fitLocationCorner(l, diff, curve1, curve2), [0.5, 0.5], {
    bounds: [
      [0, 1],
      [0, 1],
    ],
  });
  const loc = out.x;
  const point1 = curve1.point(loc[0]!);
  cornerShape.snapTo(point1);
  if (swapped) {
    cornerShape.reverse();
    const t = loc[0]!;
    loc[0] = loc[1]!;
    loc[1] = t;
  }
  const cutEdge1 = targetEdges.edges[0]!.subdivideParam([loc[0]!, 1 - loc[0]!]).edges[0]!;
  const cutEdge2 = targetEdges.edges[1]!.subdivideParam([loc[1]!, 1 - loc[1]!]).edges[1]!;
  cutEdge1.end = cornerShape.edges[0]!.start;
  cutEdge2.start = cornerShape.at(-1).end;
  cornerShape.insert(0, cutEdge1);
  cornerShape.append(cutEdge2);
  panel.edges.pop(targetEdges.edges[0]!);
  panel.edges.substitute(targetEdges.edges[1]!, cornerShape);
  targetEdges = new EdgeSequence(targetEdges.edges);
  const ints = Array.isArray(panel.interfaces) ? panel.interfaces : Object.values(panel.interfaces);
  for (const intr of ints) {
    if (!(intr instanceof Interface)) continue;
    if (intr.edges.contains(targetEdges.edges[0]!)) intr.edges.substitute(targetEdges.edges[0]!, cornerShape.edges[0]!);
    if (intr.edges.contains(targetEdges.edges[1]!)) intr.edges.substitute(targetEdges.edges[1]!, cornerShape.at(-1));
  }
  const newInt = new Interface(panel, cornerShape.slice(1, -1));
  if (Array.isArray(panel.interfaces)) panel.interfaces.push(newInt);
  else panel.interfaces[`int_${Object.keys(panel.interfaces).length}`] = newInt;
  return [cornerShape.slice(1, -1), newInt];
}

/** cut_into_edge for one shape (cut_into_edge_single). Returns [new edges, shape edges, base-edge leftovers]. */
export function cutIntoEdgeSingle(targetShapeIn: EdgeSequence, baseEdge: Edge, offset = 0, right = true, tol = 1e-2): [EdgeSequence, EdgeSequence, EdgeSequence] {
  const targetShape = new EdgeSequence(targetShapeIn);
  const newEdges = targetShape.copy().snapTo([0, 0]);
  const shortcut = newEdges.shortcut();
  const targetW = Math.sqrt(sq(shortcut[0]![0]!) + sq(shortcut[0]![1]!) + sq(shortcut[1]![0]!) + sq(shortcut[1]![1]!));
  const edgeLen = baseEdge.length();
  if (offset < targetW / 2 - tol || offset > edgeLen - targetW / 2 + tol) throw new GarmentValueError('Operators-CutingIntoEdge::ERROR::offset value is not within the base_edge length');
  const curve = baseEdge.asCurve();
  const relOffset = curve.ilength(offset, PYG_ILENGTH_S_TOL);
  const out = minimize((s) => fitLocationEdge(s, relOffset, targetW, curve), [0.1, 0.1], { bounds: [[0, 1]] });
  const shift = out.x;
  if (!closeEnough(out.fun, 0, 0.01)) throw new GarmentRuntimeError(`Cut_edge::ERROR::projection on edge finished with fun=${out.fun}`);
  if (relOffset + shift[0]! > 1 + tol || relOffset - shift[1]! < 0 - tol) throw new GarmentRuntimeError('Cut_edge::ERROR::projection is out of edge bounds. Check the offset value');
  const insPoint: Vert = relOffset - shift[1]! > tol ? (curve.point(relOffset - shift[1]!) as Vert) : baseEdge.start;
  const finPoint: Vert = relOffset + shift[0]! < 1 - tol ? (curve.point(relOffset + shift[0]!) as Vert) : baseEdge.end;
  const insertVector = [finPoint[0]! - insPoint[0]!, finPoint[1]! - insPoint[1]!];
  const angle = vectorAngle([shortcut[1]![0]! - shortcut[0]![0]!, shortcut[1]![1]! - shortcut[0]![1]!], insertVector);
  newEdges.rotate(angle);
  newEdges.snapTo(insPoint);
  const vs = newEdges.verts();
  let ax = 0;
  let ay = 0;
  for (const v of vs) {
    ax += v[0]!;
    ay += v[1]!;
  }
  ax /= vs.length;
  ay /= vs.length;
  const s0 = newEdges.edges[0]!.start;
  const rightPosition = npSign(cross2(insertVector, [ax - s0[0]!, ay - s0[1]!])) === -1;
  if ((!right && rightPosition) || (right && !rightPosition)) newEdges.reflect(newEdges.edges[0]!.start, newEdges.at(-1).end);
  const leftovers = new EdgeSequence();
  let startId = 0;
  let endId: number = newEdges.length;
  if (insPoint === baseEdge.start) newEdges.edges[0]!.start = baseEdge.start;
  else {
    const a = relOffset - shift[1]!;
    const startPart = baseEdge.subdivideParam([a, 1 - a]).edges[0]!;
    startPart.end = newEdges.edges[0]!.start;
    newEdges.insert(0, startPart);
    leftovers.append(newEdges.edges[0]!);
    startId = 1;
  }
  if (finPoint === baseEdge.end) newEdges.at(-1).end = baseEdge.end;
  else {
    const b = relOffset + shift[0]!;
    const endPart = baseEdge.subdivideParam([b, 1 - b]).at(-1);
    endPart.start = newEdges.at(-1).end;
    newEdges.append(endPart);
    leftovers.append(newEdges.at(-1));
    endId = -1;
  }
  return [newEdges, newEdges.slice(startId, endId), leftovers];
}

/** cut_into_edge: one shape, or several chained shapes cut at their relative offsets. */
export function cutIntoEdge(targetShape: EdgeSequence | EdgeSequence[], baseEdge: Edge, offset = 0, right = true, flipTarget = false, tol = 1e-2): [EdgeSequence, EdgeSequence, EdgeSequence] {
  if (targetShape instanceof EdgeSequence) return cutIntoEdgeSingle(targetShape, baseEdge, offset, right, tol);
  let shapes = targetShape;
  const ys = (ss: EdgeSequence[]): number[] => ss.flatMap((e) => e.shortcut().map((p) => p[1]!));
  const all = ys(shapes);
  const medianY = (Math.max(...all) + Math.min(...all)) / 2;
  if (flipTarget) {
    shapes = shapes.map((s) => s.copy());
    shapes = shapes.map((s) => s.reflect([0, medianY], [1, medianY]));
    shapes = shapes.map((s) => s.reverse());
  }
  const relOffsets = shapes.map((s) => {
    const sc = s.shortcut();
    return (sc[0]![1]! + sc[1]![1]!) / 2 - medianY;
  });
  const per = relOffsets.map((r) => offset + r);
  const sorted = per.map((o, i) => [o, i] as const).sort((a, b) => b[0] - a[0]);
  let projEdge = baseEdge;
  const intEdges = new EdgeSequence(baseEdge);
  const newIn = new EdgeSequence();
  const allNew = new EdgeSequence(baseEdge);
  for (const [off, i] of sorted) {
    const [ne, ins, ni] = cutIntoEdge(shapes[i]!, projEdge, off, right, false, tol);
    allNew.substitute(projEdge, ne);
    intEdges.substitute(projEdge, ni);
    newIn.append(ins);
    projEdge = ne.edges[0]!;
  }
  return [allNew, newIn, intEdges];
}

/** distribute_Y: copies of a panel rotated around the Y axis. */
export function distributeY(component: Panel, nCopies: number, oddCopyShift = 0, nameTag = 'panel'): Panel[] {
  const copies: Panel[] = [component];
  component.name = `${nameTag}_0`;
  const delta = Rotation.fromEuler('XYZ', [0, 360 / nCopies, 0], true);
  for (let i = 0; i < nCopies - 1; i++) {
    const nc = deepcopy(copies[copies.length - 1]!);
    nc.name = `${nameTag}_${i + 1}`;
    nc.rotateBy(delta);
    nc.translateTo(delta.apply(nc.translation));
    copies.push(nc);
  }
  if (oddCopyShift) {
    for (let i = 0; i < nCopies; i++) {
      if (!(i % 2)) {
        const n = copies[i]!.norm();
        copies[i]!.translateBy([n[0] * oddCopyShift, n[1] * oddCopyShift, n[2] * oddCopyShift]);
      }
    }
  }
  return copies;
}

/** distribute_horisontally: copies along the panel's horizontal direction. */
export function distributeHorizontally(component: Panel, nCopies: number, stride = 20, nameTag = 'panel'): BaseComponent[] {
  const copies: Panel[] = [component];
  component.name = `${nameTag}_0`;
  const zDir = component.rotation.apply([0, 0, 1]);
  const t = [zDir[1] * 0 - zDir[2] * 1, zDir[2] * 0 - zDir[0] * 0, zDir[0] * 1 - zDir[1] * 0];
  const n = norm2(t);
  const delta = [(t[0]! / n) * stride, (t[1]! / n) * stride, (t[2]! / n) * stride];
  for (let i = 0; i < nCopies - 1; i++) {
    const nc = deepcopy(copies[copies.length - 1]!);
    nc.name = `${nameTag}_${i + 1}`;
    nc.translateBy(delta);
    copies.push(nc);
  }
  return copies;
}

/** even_armhole_openings: rebalance front and back sleeve openings (front assumed longer). */
export function evenArmholeOpenings(frontOpening: EdgeSequence, backOpening: EdgeSequence, tol = 1e-2): [EdgeSequence, EdgeSequence] {
  const cfront = frontOpening.copy();
  const cback = backOpening.copy();
  cback.reflect([0, 0], [1, 0]).reverse().snapTo(cfront.at(-1).end);
  const s0 = cfront.edges[0]!.start;
  const s1 = cback.at(-1).end;
  const slopeVec = [s1[0]! - s0[0]!, s1[1]! - s0[1]!];
  const perp = [-slopeVec[1]!, slopeVec[0]!];
  const mid = [(s0[0]! + s1[0]!) / 2, (s0[1]! + s1[1]!) / 2];
  const inter = new Line([mid[0]! - 20 * perp[0]!, mid[1]! - 20 * perp[1]!], [mid[0]! + 20 * perp[0]!, mid[1]! + 20 * perp[1]!]);
  const target = cfront.at(-1).asCurve();
  const hits = target instanceof Arc ? [] : intersectSegments(target, inter).sort((a, b) => a[0] - b[0]);
  if (hits.length >= 1 && !(closeEnough(hits[0]![0], 0, tol) || closeEnough(hits[0]![0], 1, tol))) {
    const t = hits[0]![0];
    const subdiv = frontOpening.at(-1).subdivideParam([t, 1 - t]);
    frontOpening.substitute(-1, subdiv.edges[0]!);
    subdiv.edges[1]!.start = subdiv.edges[1]!.start.slice();
    subdiv.edges[1]!.end = subdiv.edges[1]!.end.slice();
    subdiv.pop(0);
    subdiv.reflect([0, 0], [1, 0]).reverse().snapTo(backOpening.at(-1).end);
    subdiv.edges[0]!.start = backOpening.at(-1).end;
    backOpening.append(subdiv.edges[0]!);
  }
  const slopeAngle = atan(-slopeVec[0]! / slopeVec[1]!);
  frontOpening.rotate(-slopeAngle);
  backOpening.rotate(slopeAngle);
  return [frontOpening, backOpening];
}

/** _max_curvature over n evenly spaced parameters. */
function maxCurvature(curve: CubicBezier, n: number): number {
  let m = -Infinity;
  for (const t of linspace01(n)) m = Math.max(m, curve.curvature(t));
  return m;
}

/** _bend_extend_2_tangent. */
export function bendExtend2Tangent(shift: number[], cp: Vert[], targetLen: number, direction: number[], t0: P2, t1: P2, n: number): number {
  const c: P2[] = [
    [cp[0]![0]!, cp[0]![1]!],
    [cp[1]![0]! + shift[0]!, cp[1]![1]! + shift[1]!],
    [cp[2]![0]! + shift[2]!, cp[2]![1]! + shift[3]!],
    [cp[3]![0]! + direction[0]! * shift[4]!, cp[3]![1]! + direction[1]! * shift[4]!],
  ];
  const curve = new CubicBezier(c[0]!, c[1]!, c[2]!, c[3]!);
  const lengthDiff = sq(curve.length() - targetLen);
  const u0 = curve.unitTangent(0);
  const u1 = curve.unitTangent(1);
  const tan0 = sq(norm2([u0[0] - t0[0], u0[1] - t0[1]]));
  const tan1 = sq(norm2([u1[0] - t1[0], u1[1] - t1[1]]));
  const curvatureReg = sq(maxCurvature(curve, n));
  const endReg = 0.001 * sq(shift[shift.length - 1]!);
  return lengthDiff + tan0 + tan1 + curvatureReg + endReg;
}

/** curve_match_tangents (L-BFGS-B). Returns the control points, or a CurveEdge. */
export function curveMatchTangents(curve: CubicBezier, targetTan0: readonly number[], targetTan1: readonly number[], targetLen?: number | null): Vert[] {
  const cps = curve.bpoints().map((p) => [p[0], p[1]]);
  let direction = [cps[3]![0]! - cps[0]![0]!, cps[3]![1]! - cps[0]![1]!];
  const dn = norm2(direction);
  direction = [direction[0]! / dn, direction[1]! / dn];
  const n0 = norm2(targetTan0);
  const n1 = norm2(targetTan1);
  const t0: P2 = [targetTan0[0]! / n0, targetTan0[1]! / n0];
  const t1: P2 = [targetTan1[0]! / n1, targetTan1[1]! / n1];
  const L = targetLen ?? curve.length();
  const out = minimize((s) => bendExtend2Tangent(s, cps, L, direction, t0, t1, 70), [0, 0, 0, 0, 0], { method: 'L-BFGS-B' });
  const s = out.x;
  return [cps[0]!.slice(), [cps[1]![0]! + s[0]!, cps[1]![1]! + s[1]!], [cps[2]![0]! + s[2]!, cps[2]![1]! + s[3]!], [cps[3]![0]! + direction[0]! * s[4]!, cps[3]![1]! + direction[1]! * s[4]!]];
}

export function curveMatchTangentsEdge(curve: CubicBezier, targetTan0: readonly number[], targetTan1: readonly number[], targetLen?: number | null): CurveEdge {
  const fin = curveMatchTangents(curve, targetTan0, targetTan1, targetLen);
  return new CurveEdge(fin[0], fin[3], [fin[1]!, fin[2]!], false);
}

