/**
 * Edges and edge sequences (port of pygarment/garmentcode/edge.py).
 *
 * Vertices are mutable `[x, y]` arrays shared by reference between chained edges, exactly as pygarment shares
 * Python lists: identity (`===`) decides chaining, and in-place updates move every edge that uses the vertex.
 */
import { asin, PI } from '../../math/dmath';
import { Arc, CubicBezier, Line, QuadraticBezier, type P2, type Segment } from './num/curves';
import { absToRel2d, closeEnough, cross2, deepcopy, linspaceNoEnd, matvec2, norm2, pyIndex, pyInsert, pySlice, relToAbs2d, rot2, type Vert } from './utils';
import { sq } from './num/sq';

/** pygarment ILENGTH_S_TOL: tolerance for the curve parameter from arc length. */
export const PYG_ILENGTH_S_TOL = 1e-10;

export interface EdgeCurvature {
  type: 'circle' | 'quadratic' | 'cubic';
  params: unknown[];
}

export interface EdgeSpec {
  endpoints: number[];
  label?: string;
  curvature?: EdgeCurvature;
}

const p2 = (v: readonly number[]): P2 => [v[0]!, v[1]!];

export class Edge {
  start: Vert;
  end: Vert;
  label: string;
  geometricId = 0;
  flipped?: boolean;

  constructor(start?: Vert, end?: Vert, label = '') {
    const s = start ?? [0, 0];
    const e = end ?? [0, 0];
    if (closeEnough(s[0]!, e[0]!) && closeEnough(s[1]!, e[1]!)) throw new GarmentAssertionError('Start and end of an edge should differ');
    this.start = s;
    this.end = e;
    this.label = label;
  }

  length(): number {
    return this.straightLen();
  }

  straightLen(): number {
    return norm2([this.end[0]! - this.start[0]!, this.end[1]! - this.start[1]!]);
  }

  midpoint(): Vert {
    return [(this.start[0]! + this.end[0]!) / 2, (this.start[1]! + this.end[1]!) / 2];
  }

  shortcut(): Vert[] {
    return [this.start.slice(), this.end.slice()];
  }

  asCurve(): Segment {
    return new Line(p2(this.start), p2(this.end));
  }

  linearize(nVertsInside = 0): EdgeSequence {
    if (!nVertsInside) return new EdgeSequence(this);
    const tvals = linspaceNoEnd(nVertsInside + 1).slice(1);
    const curve = this.asCurve();
    return this.toEdgeSequence(tvals.map((t) => curve.point(t) as Vert));
  }

  toEdgeSequence(verts: Vert[]): EdgeSequence {
    const seq = new EdgeSequence(new Edge(this.start, verts[0]));
    for (let i = 1; i < verts.length; i++) seq.append(new Edge(seq.at(-1).end, verts[i]));
    seq.append(new Edge(seq.at(-1).end, this.end));
    return seq;
  }

  reverse(): this {
    const s = this.start;
    this.start = this.end;
    this.end = s;
    return this;
  }

  reflectFeatures(): this {
    return this;
  }

  snapTo(newStart: readonly number[] = [0, 0]): this {
    this.end[0] = this.end[0]! - this.start[0]! + newStart[0]!;
    this.end[1] = this.end[1]! - this.start[1]! + newStart[1]!;
    this.start[0] = newStart[0]!;
    this.start[1] = newStart[1]!;
    return this;
  }

  rotate(angle: number): this {
    const currStart = this.start.slice();
    this.snapTo([0, 0]);
    const r = rot2(angle, this.end);
    this.end[0] = r[0]!;
    this.end[1] = r[1]!;
    this.snapTo(currStart);
    return this;
  }

  subdivideLen(fractions: number[], connectInternalVerts = true): EdgeSequence {
    const e = this.subdivide(fractions, true);
    if (connectInternalVerts) mergeSubdivVertices(e);
    return e;
  }

  subdivideParam(fractions: number[], connectInternalVerts = true): EdgeSequence {
    const e = this.subdivide(fractions, false);
    if (connectInternalVerts) mergeSubdivVertices(e);
    return e;
  }

  protected subdivide(fractions: number[], _byLength: boolean): EdgeSequence {
    const frac = fractions.map(Math.abs);
    const fsum = pySum(frac);
    if (!closeEnough(fsum, 1, 1e-4)) throw new GarmentRuntimeError(`Edge Subdivision::ERROR::fraction is incorrect. The sum ${fsum} is not 1`);
    const vx = this.end[0]! - this.start[0]!;
    const vy = this.end[1]! - this.start[1]!;
    const verts: Vert[] = [this.start];
    const seq = new EdgeSequence();
    for (let i = 0; i < frac.length - 1; i++) {
      const last = verts[verts.length - 1]!;
      verts.push([last[0]! + frac[i]! * vx, last[1]! + frac[i]! * vy]);
      seq.append(new Edge(verts[verts.length - 2], verts[verts.length - 1]));
    }
    verts.push(this.end);
    seq.append(new Edge(verts[verts.length - 2], verts[verts.length - 1]));
    return seq;
  }

  assembly(): [Vert[], EdgeSpec] {
    const props: EdgeSpec = { endpoints: [0, 1] };
    if (this.label) props.label = this.label;
    return [[this.start, this.end], props];
  }
}

function mergeSubdivVertices(sub: EdgeSequence): EdgeSequence {
  for (let i = 1; i < sub.length; i++) sub.edges[i]!.start = sub.edges[i - 1]!.end;
  return sub;
}

/** Python's built-in sum (left to right from 0). */
export function pySum(v: readonly number[]): number {
  let s = 0;
  for (const x of v) s += x;
  return s;
}

/** A GarmentCode AssertionError / RuntimeError / ValueError, so failures can be matched with the oracle's. */
export class GarmentAssertionError extends Error {
  readonly pyType = 'AssertionError';
}
export class GarmentRuntimeError extends Error {
  readonly pyType = 'RuntimeError';
}
export class GarmentValueError extends Error {
  readonly pyType = 'ValueError';
}

export class CircleEdge extends Edge {
  controlY: number;

  constructor(start?: Vert, end?: Vert, cy = 0, label = '') {
    super(start ?? [0, 0], end ?? [1, 0], label);
    this.controlY = cy;
  }

  override length(): number {
    return this.relRadius() * this.straightLen() * this.arcAngle();
  }

  override midpoint(): Vert {
    return relToAbs2d(this.start, this.end, [0.5, this.controlY]);
  }

  override reverse(): this {
    super.reverse();
    this.controlY *= -1;
    return this;
  }

  override reflectFeatures(): this {
    this.controlY *= -1;
    return this;
  }

  protected override subdivide(fractions: number[]): EdgeSequence {
    const frac = fractions.map(Math.abs);
    const fsum = pySum(frac);
    if (!closeEnough(fsum, 1, 1e-4)) throw new GarmentRuntimeError(`Edge Subdivision::ERROR::fraction is incorrect. The sum ${fsum} is not 1`);
    const curve = this.asCurve();
    let covered = 0;
    const subcurves: Segment[] = [];
    for (const fr of fractions) {
      subcurves.push(curve.cropped(covered, covered + fr));
      covered += fr;
    }
    const subedges = new EdgeSequence();
    for (const c of subcurves) subedges.append(edgeFromSvgCurve(c));
    subedges.edges[0]!.start = this.start;
    subedges.at(-1).end = this.end;
    return subedges;
  }

  override asCurve(): Arc {
    const [radius, la, sweep] = this.asRadiusFlag();
    return new Arc(p2(this.start), [radius, radius], 0, la, sweep, p2(this.end));
  }

  asRadiusFlag(): [number, boolean, boolean] {
    return [this.relRadius() * this.straightLen(), this.isLargeArc(), this.controlY < 0];
  }

  asRadiusAngle(): [number, number, boolean] {
    return [this.relRadius() * this.straightLen(), this.arcAngle(), this.controlY < 0];
  }

  override linearize(nVertsInside = 9): EdgeSequence {
    const tvals = linspaceNoEnd(nVertsInside + 1).slice(1);
    const curve = this.asCurve();
    return this.toEdgeSequence(tvals.map((t) => curve.point(t) as Vert));
  }

  relRadius(absRadius?: number): number {
    if (absRadius) return absRadius / this.straightLen();
    const a = 1;
    const b = norm2([0.5, this.controlY]);
    const c = norm2([0.5 - 1, this.controlY]);
    const p = (a + b + c) / 2;
    return (a * b * c) / Math.sqrt(p * (p - a) * (p - b) * (p - c)) / 4;
  }

  arcAngle(): number {
    const relRad = this.relRadius();
    let arc = 2 * asin(Math.min(Math.max(1 / relRad / 2, -1), 1));
    if (this.isLargeArc()) arc = 2 * PI - arc;
    return arc;
  }

  isLargeArc(): boolean {
    return Math.abs(this.controlY) > this.relRadius();
  }

  override assembly(): [Vert[], EdgeSpec] {
    const [ends, props] = super.assembly();
    const [rad, large, right] = this.asRadiusFlag();
    props.curvature = { type: 'circle', params: [rad, large ? 1 : 0, right ? 1 : 0] };
    return [ends, props];
  }
}

export class CurveEdge extends Edge {
  controlPoints: Vert[];

  constructor(start?: Vert, end?: Vert, controlPoints: Vert[] = [], relative = true, label = '') {
    super(start ?? [0, 0], end ?? [0, 0], label);
    this.controlPoints = controlPoints;
    if (this.controlPoints.length > 2) throw new Error('CurveEdge::ERROR::Up to 2 control points (cubic Bezier) are supported');
    if (!relative) this.controlPoints = this.controlPoints.map((c) => absToRel2d(this.start, this.end, c));
  }

  override length(): number {
    return this.asCurve().length();
  }

  override midpoint(): Vert {
    const curve = this.asCurve();
    const t = curve.ilength(curve.length() / 2, PYG_ILENGTH_S_TOL);
    return curve.point(t) as Vert;
  }

  protected override subdivide(fractions: number[], byLength: boolean): EdgeSequence {
    const curve = this.asCurve();
    let covered = 0;
    let prevT = 0;
    const clen = curve.length();
    const subcurves: Segment[] = [];
    for (const fr of fractions) {
      covered += fr;
      if (byLength) {
        const nextT = curve.ilength(clen * covered, PYG_ILENGTH_S_TOL);
        subcurves.push(curve.cropped(prevT, nextT));
        prevT = nextT;
      } else subcurves.push(curve.cropped(covered - fr, covered));
    }
    const subedges = new EdgeSequence();
    for (const c of subcurves) subedges.append(edgeFromSvgCurve(c));
    subedges.edges[0]!.start = this.start;
    subedges.at(-1).end = this.end;
    return subedges;
  }

  override reverse(): this {
    super.reverse();
    if (this.controlPoints.length === 2) {
      const a = this.controlPoints[0]!;
      this.controlPoints[0] = this.controlPoints[1]!;
      this.controlPoints[1] = a;
    }
    for (const p of this.controlPoints) {
      p[0] = 1 - p[0]!;
      p[1] = -p[1]!;
    }
    return this;
  }

  override reflectFeatures(): this {
    for (const p of this.controlPoints) p[1] = -p[1]!;
    return this;
  }

  override asCurve(absolute = true): QuadraticBezier | CubicBezier {
    let nodes: P2[];
    if (absolute) {
      const cp = this.controlPoints.map((c) => p2(relToAbs2d(this.start, this.end, c)));
      nodes = [p2(this.start), ...cp, p2(this.end)];
    } else nodes = [[0, 0], ...this.controlPoints.map(p2), [1, 0]];
    return this.controlPoints.length < 2 ? new QuadraticBezier(nodes[0]!, nodes[1]!, nodes[2]!) : new CubicBezier(nodes[0]!, nodes[1]!, nodes[2]!, nodes[3]!);
  }

  override linearize(nVertsInside = 9): EdgeSequence {
    const tvalsInit = linspaceNoEnd(nVertsInside + 1).slice(1);
    const curve = this.asCurve(false);
    const L = curve.length();
    const tvals = tvalsInit.map((t) => curve.ilength(t * L, PYG_ILENGTH_S_TOL));
    return this.toEdgeSequence(tvals.map((t) => relToAbs2d(this.start, this.end, curve.point(t))));
  }

  override assembly(): [Vert[], EdgeSpec] {
    const [ends, props] = super.assembly();
    props.curvature = { type: this.controlPoints.length === 1 ? 'quadratic' : 'cubic', params: this.controlPoints };
    return [ends, props];
  }
}

/** EdgeFactory.from_svg_curve. */
export function edgeFromSvgCurve(seg: Segment): Edge {
  const start: Vert = [seg.start[0], seg.start[1]];
  const end: Vert = [seg.end[0], seg.end[1]];
  if (seg instanceof Line) return new Edge(start, end);
  if (seg instanceof Arc) return circleFromPointsRadius(start, end, seg.radius[0], seg.largeArc, seg.sweep);
  const cp: Vert[] = seg instanceof QuadraticBezier ? [[seg.control[0], seg.control[1]]] : [[seg.control1[0], seg.control1[1]], [seg.control2[0], seg.control2[1]]];
  return new CurveEdge(start, end, cp, false);
}

/** CircleEdgeFactory.from_points_radius. */
export function circleFromPointsRadius(start: Vert, end: Vert, radius: number, largeArc = false, right = true): CircleEdge {
  const strDist = norm2([end[0]! - start[0]!, end[1]! - start[1]!]);
  const centerR = closeEnough(sq(radius), sq(strDist) / 4, 1e-3) ? 0 : Math.sqrt(sq(radius) - sq(strDist) / 4);
  let cy = largeArc ? radius + centerR : radius - centerR;
  cy = cy / strDist;
  cy *= right ? -1 : 1;
  return new CircleEdge(start, end, cy);
}

type SeqItem = Edge | EdgeSequence | (Edge | EdgeSequence)[];

export class EdgeSequence {
  edges: Edge[] = [];

  constructor(...args: SeqItem[]) {
    for (const a of args) this.append(a);
  }

  /** Python indexing with negative indices. */
  at(i: number): Edge {
    return this.edges[pyIndex(this.edges.length, i)]!;
  }

  /** Python slicing: a new sequence of the same edge objects. */
  slice(start?: number, stop?: number): EdgeSequence {
    const [a, b] = pySlice(this.edges.length, start, stop);
    return new EdgeSequence(this.edges.slice(a, Math.max(a, b)));
  }

  index(e: Edge): number {
    const i = this.edges.indexOf(e);
    if (i < 0) throw new Error('StopIteration: edge not in sequence');
    return i;
  }

  get length(): number {
    return this.edges.length;
  }

  contains(e: Edge): boolean {
    return this.edges.includes(e);
  }

  totalLength(): number {
    return pySum(this.edges.map((e) => e.length()));
  }

  isLoop(): boolean {
    return this.edges[0]!.start === this.at(-1).end && this.edges.length > 1;
  }

  isChained(): boolean {
    if (this.edges.length < 2) return false;
    for (let i = 1; i < this.edges.length; i++) if (this.edges[i]!.start !== this.edges[i - 1]!.end) return false;
    return true;
  }

  fractions(): number[] {
    const total = pySum(this.edges.map((e) => e.length()));
    return this.edges.map((e) => e.length() / total);
  }

  lengths(): number[] {
    return this.edges.map((e) => e.length());
  }

  verts(): Vert[] {
    const verts: Vert[] = [this.edges[0]!.start];
    for (const e of this.edges) {
      if (e.start !== verts[verts.length - 1]) verts.push(e.start);
      verts.push(e.end);
    }
    if (verts[0] === verts[verts.length - 1]) verts.pop();
    return verts;
  }

  shortcut(): Vert[] {
    return [this.edges[0]!.start.slice(), this.at(-1).end.slice()];
  }

  /** Bounding box of the linearised edges and the vertices on it (EdgeSequence.bbox). */
  bbox(): [number[], Vert[]] {
    const lin = new EdgeSequence(this.edges.map((e) => e.linearize()));
    const verts = lin.verts();
    const mi = [Math.min(...verts.map((v) => v[0]!)), Math.min(...verts.map((v) => v[1]!))];
    const ma = [Math.max(...verts.map((v) => v[0]!)), Math.max(...verts.map((v) => v[1]!))];
    const xs = [mi[0]!, ma[0]!];
    const ys = [mi[1]!, ma[1]!];
    let bPoints: Vert[] = [];
    for (const v of verts) if (xs.includes(v[0]!) || ys.includes(v[1]!)) bPoints.push(v);
    if (bPoints.length === 2) {
      if (!bPoints.some((a) => a[0] === mi[0] && a[1] === mi[1])) bPoints = [bPoints[0]!, mi, bPoints[1]!];
      else bPoints = [bPoints[0]!, [mi[0]!, ma[1]!], bPoints[1]!];
    }
    return [[mi[0]!, ma[0]!, mi[1]!, ma[1]!], bPoints];
  }

  append(item: SeqItem): this {
    if (item instanceof Edge) this.edges.push(item);
    else if (Array.isArray(item)) for (const e of item) this.append(e);
    else if (item instanceof EdgeSequence) this.edges.push(...item.edges);
    else throw new Error('EdgeSequence::ERROR::Trying to add object of incompatible type');
    return this;
  }

  insert(i: number, item: Edge | EdgeSequence | Edge[]): this {
    if (item instanceof Edge) pyInsert(this.edges, i, item);
    else {
      const list = item instanceof EdgeSequence ? item.edges.slice() : item;
      for (let j = 0; j < list.length; j++) pyInsert(this.edges, i + j, list[j]!);
    }
    return this;
  }

  pop(i: number | Edge): this {
    const k = i instanceof Edge ? this.index(i) : pyIndex(this.edges.length, i);
    this.edges.splice(k, 1);
    return this;
  }

  substitute(orig: number | Edge, nw: Edge | EdgeSequence | Edge[]): this {
    let k = orig instanceof Edge ? this.index(orig) : orig;
    if (k < 0) k = this.edges.length + k;
    this.pop(k);
    this.insert(k, nw);
    return this;
  }

  reverse(): this {
    this.edges.reverse();
    for (const e of this.edges) e.reverse();
    return this;
  }

  translateBy(shift: readonly number[]): this {
    for (const v of this.verts()) {
      v[0] = v[0]! + shift[0]!;
      v[1] = v[1]! + shift[1]!;
    }
    return this;
  }

  snapTo(newOrigin: readonly number[] = [0, 0]): this {
    const start = this.edges[0]!.start.slice();
    this.translateBy([newOrigin[0]! - start[0]!, newOrigin[1]! - start[1]!]);
    return this;
  }

  closeLoop(): this {
    if (!this.isLoop()) this.append(new Edge(this.at(-1).end, this.edges[0]!.start));
    return this;
  }

  rotate(angle: number): this {
    const currStart = this.edges[0]!.start.slice();
    this.snapTo([0, 0]);
    for (const v of this.verts()) {
      const r = rot2(angle, v);
      v[0] = r[0]!;
      v[1] = r[1]!;
    }
    this.snapTo(currStart);
    return this;
  }

  /** Extend or shrink along the line from the first start to the last end (start fixed). */
  extend(factor: number): this {
    const chained: EdgeSequence = this.isChained() ? this : this.chainedOrder();
    if (chained !== this && chained.isLoop()) return this;
    let tx = chained.at(-1).end[0]! - chained.edges[0]!.start[0]!;
    let ty = chained.at(-1).end[1]! - chained.edges[0]!.start[1]!;
    const tn = norm2([tx, ty]);
    tx /= tn;
    ty /= tn;
    const vs = this.verts();
    const coords = vs.map((v) => [v[0]!, v[1]!]);
    const fixed = coords[0]!;
    const proj = coords.map((v) => {
      const d = (v[0]! - fixed[0]!) * tx + (v[1]! - fixed[1]!) * ty;
      return [d * tx, d * ty];
    });
    for (let i = 0; i < vs.length; i++) {
      vs[i]![0] = coords[i]![0]! - (1 - factor) * proj[i]![0]!;
      vs[i]![1] = coords[i]![1]! - (1 - factor) * proj[i]![1]!;
    }
    return this;
  }

  reflect(v0: readonly number[], v1: readonly number[]): this {
    let vx = v1[0]! - v0[0]!;
    let vy = v1[1]! - v0[1]!;
    const n = norm2([vx, vy]);
    vx /= n;
    vy /= n;
    const r00 = 1 - 2 * sq(vy);
    const r01 = 2 * vx * vy;
    const r10 = 2 * vx * vy;
    const r11 = -1 + 2 * sq(vy);
    const a0 = v0[0]!;
    const a1 = v0[1]!;
    for (const v of this.verts()) {
      const dx = v[0]! - a0;
      const dy = v[1]! - a1;
      const m = matvec2(r00, r01, r10, r11, dx, dy);
      v[0] = m[0]! + a0;
      v[1] = m[1]! + a1;
    }
    for (const e of this.edges) e.reflectFeatures();
    return this;
  }

  propagateLabel(label: string): void {
    for (const e of this.edges) e.label = label;
  }

  /** Deep copy keeping chained vertices shared (EdgeSequence.copy). */
  copy(): EdgeSequence {
    const nw = deepcopy(this as EdgeSequence);
    for (let i = 1; i < nw.edges.length; i++) if (this.edges[i]!.start === this.edges[i - 1]!.end) nw.edges[i]!.start = nw.edges[i - 1]!.end;
    if (this.isLoop()) nw.at(-1).end = nw.edges[0]!.start;
    return nw;
  }

  chainedOrder(): EdgeSequence {
    const chained = this.copy();
    for (let i = 0; i < chained.length; i++) {
      if (i > 0 && chained.edges[i]!.end === chained.edges[i - 1]!.end) chained.edges[i]!.reverse();
      else if (i + 1 < chained.length && (chained.edges[i]!.start === chained.edges[i + 1]!.start || chained.edges[i]!.start === chained.edges[i + 1]!.end)) chained.edges[i]!.reverse();
    }
    return chained;
  }
}

/** Shared by operators: 2D cross of two difference vectors. */
export const crossOf = cross2;
