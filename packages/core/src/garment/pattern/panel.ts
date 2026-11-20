/**
 * Panels and components (port of pygarment/garmentcode/base.py, panel.py and component.py).
 *
 * A panel is a closed loop of edges in 2D (cm) with a 3D placement; a component is a tree of panels and
 * components. `assembly()` produces GarmentCode's pattern specification (panels with vertices, edges, curvature,
 * translation and XYZ Euler rotation in degrees, plus stitches), which is what the oracle compares.
 */
import { acos as acosD } from '../../math/dmath';
import { CircleEdge, EdgeSequence, type Edge, type EdgeSpec } from './edge';
import { bbox3, Interface, Stitches, type StitchSpec } from './interface';
import { Rotation, type V3 } from './num/rotation';
import { closeEnough, norm2, type Vert } from './utils';
import { cutIntoEdge } from './operators';
import { intersectSegments, isclose, type CubicBezier, type Line, type QuadraticBezier } from './num/curves';

export interface PanelSpec {
  translation: number[];
  rotation: number[];
  vertices: Vert[];
  edges: EdgeSpec[];
  label?: string;
}

export interface PatternSpec {
  panels: Record<string, PanelSpec>;
  stitches: StitchSpec[];
}

export type InterfaceMap = Record<string, Interface>;

export abstract class BaseComponent {
  name: string;
  verbose = false;
  interfaces: InterfaceMap | Interface[] = {};
  stitchingRules: Stitches = new Stitches();

  constructor(name: string) {
    this.name = name;
  }

  pivot3D(): V3 {
    return [0, 0, 0];
  }

  bbox3D(): [V3, V3] {
    return [
      [0, 0, 0],
      [0, 0, 0],
    ];
  }

  isSelfIntersecting(): boolean {
    return false;
  }

  /** The named interface (interfaces given as a dict); throws like a KeyError when missing. */
  int(key: string): Interface {
    const map = this.interfaces as InterfaceMap;
    const v = map[key];
    if (!v) throw Object.assign(new Error(`KeyError: '${key}'`), { pyType: 'KeyError' });
    return v;
  }

  hasInt(key: string): boolean {
    return !Array.isArray(this.interfaces) && key in this.interfaces;
  }

  abstract translateBy(delta: readonly number[]): this;
  abstract translateTo(t: readonly number[]): this;
  abstract rotateBy(r: Rotation): this;
  abstract assembly(): PatternSpec;
  abstract length(): number;
  abstract mirror(axis?: readonly number[]): this;
  abstract setPanelLabel(label: string, overwrite?: boolean): void;

  placeBelow(comp: BaseComponent, gap = 2): this {
    const other = comp.bbox3D();
    const curr = this.bbox3D();
    this.translateBy([0, other[0][1] - curr[1][1] - gap, 0]);
    return this;
  }

  placeByInterface(selfInt: Interface, outInt: Interface, gap = 2, alignment: 'center' | 'top' | 'bottom' | 'left' | 'right' = 'center', gapDir?: readonly number[]): this {
    const sb = selfInt.bbox3d();
    const ob = outInt.bbox3d();
    const pointOut: V3 = [(ob[1][0] + ob[0][0]) / 2, (ob[1][1] + ob[0][1]) / 2, (ob[1][2] + ob[0][2]) / 2];
    const pointSelf: V3 = [(sb[1][0] + sb[0][0]) / 2, (sb[1][1] + sb[0][1]) / 2, (sb[1][2] + sb[0][2]) / 2];
    if (alignment === 'top') {
      pointOut[1] = ob[1][1];
      pointSelf[1] = sb[1][1];
    } else if (alignment === 'bottom') {
      pointOut[1] = ob[0][1];
      pointSelf[1] = sb[0][1];
    } else if (alignment === 'right') {
      pointOut[0] = ob[0][0];
      pointSelf[0] = sb[0][0];
    } else if (alignment === 'left') {
      pointOut[0] = ob[1][0];
      pointSelf[0] = sb[1][0];
    }
    let dir: number[];
    if (gapDir === undefined) {
      const full = this.bbox3D();
      const center = [(full[0][0] + full[1][0]) / 2, (full[0][1] + full[1][1]) / 2, (full[0][2] + full[1][2]) / 2];
      const mid = [(sb[1][0] + sb[0][0]) / 2, (sb[1][1] + sb[0][1]) / 2, (sb[1][2] + sb[0][2]) / 2];
      dir = [mid[0]! - center[0]!, mid[1]! - center[1]!, mid[2]! - center[2]!];
    } else dir = gapDir.slice();
    const n = norm2(dir);
    const g = dir.map((v) => (gap * v) / n);
    this.translateBy([pointOut[0] - (pointSelf[0] + g[0]!), pointOut[1] - (pointSelf[1] + g[1]!), pointOut[2] - (pointSelf[2] + g[2]!)]);
    return this;
  }
}

export class Panel extends BaseComponent {
  label: string;
  translation: number[] = [0, 0, 0];
  rotation: Rotation = Rotation.fromEuler('XYZ', [0, 0, 0]);
  edges: EdgeSequence = new EdgeSequence();

  constructor(name: string, label = '') {
    super(name);
    this.label = label;
  }

  override pivot3D(): V3 {
    return this.pointTo3D([0, 0]);
  }

  length(longestDim = false): number {
    const [lo, hi] = this.bbox();
    const x = Math.abs(hi[0]! - lo[0]!);
    const y = Math.abs(hi[1]! - lo[1]!);
    return longestDim ? Math.max(x, y) : y;
  }

  override isSelfIntersecting(): boolean {
    const curves: (Line | QuadraticBezier | CubicBezier)[] = [];
    for (const e of this.edges.edges) {
      if (e instanceof CircleEdge) for (const s of e.linearize(10).edges) curves.push(s.asCurve() as Line);
      else curves.push(e.asCurve() as Line | QuadraticBezier | CubicBezier);
    }
    for (let i1 = 0; i1 < curves.length; i1++) {
      for (let i2 = i1 + 1; i2 < curves.length; i2++) {
        const hits = intersectSegments(curves[i1]!, curves[i2]!).filter(([a, b]) => {
          const t1 = Math.min(a, b);
          const t2 = Math.max(a, b);
          return !(closeEnough(t1, 0) && closeEnough(t2, 1));
        });
        if (hits.length) return true;
      }
    }
    return false;
  }

  setPanelLabel(label: string, overwrite = true): void {
    if (!this.label || overwrite) this.label = label;
  }

  /** The integer shift the last set_pivot applied to the vertices (not GarmentCode data; attachments use it). */
  pivotShift: [number, number] = [0, 0];

  /** set_pivot: vertices shift by the integer part of the point (as GarmentCode does). */
  setPivot(point: readonly number[], replicatePlacement = false): void {
    const p = point.slice();
    if (replicatePlacement) this.translation = this.pointTo3D(p);
    const ix = Math.trunc(p[0]!);
    const iy = Math.trunc(p[1]!);
    this.pivotShift = [this.pivotShift[0] - ix, this.pivotShift[1] - iy];
    for (const v of this.edges.verts()) {
      v[0] = v[0]! - ix;
      v[1] = v[1]! - iy;
    }
  }

  topCenterPivot(): this {
    const verts = this.edges.verts();
    const tr = [Math.max(...verts.map((v) => v[0]!)), Math.max(...verts.map((v) => v[1]!))];
    const ll = [Math.min(...verts.map((v) => v[0]!)), Math.min(...verts.map((v) => v[1]!))];
    const midX = (tr[0]! + ll[0]!) / 2;
    const midY = (tr[1]! + ll[1]!) / 2;
    const mids: Vert[] = [
      [midX, tr[1]!],
      [midX, ll[1]!],
      [tr[0]!, midY],
      [ll[0]!, midY],
    ];
    const m3 = mids.map((c) => this.pointTo3D(c));
    let top = 0;
    for (let i = 1; i < m3.length; i++) if (m3[i]![1] > m3[top]![1]) top = i;
    this.setPivot(mids[top]!);
    return this;
  }

  translateBy(delta: readonly number[]): this {
    this.translation = [this.translation[0]! + delta[0]!, this.translation[1]! + delta[1]!, this.translation[2]! + delta[2]!];
    this.autonorm();
    return this;
  }

  translateTo(t: readonly number[]): this {
    this.translation = [t[0]!, t[1]!, t[2]!];
    this.autonorm();
    return this;
  }

  rotateBy(r: Rotation): this {
    this.rotation = r.mul(this.rotation);
    this.autonorm();
    return this;
  }

  rotateTo(r: Rotation): this {
    this.rotation = r;
    this.autonorm();
    return this;
  }

  rotateAlign(vector: readonly number[]): this {
    const n0 = norm2(vector);
    const v = [vector[0]! / n0, vector[1]! / n0, vector[2]! / n0];
    const n = this.norm();
    this.rotateBy(vectorAlign3D(n, v));
    return this;
  }

  centerX(): this {
    const c = this.pointTo3D(this.center2D());
    this.translation[0] = this.translation[0]! + -c[0];
    return this;
  }

  autonorm(): void {
    const n = this.norm();
    const t = this.translation;
    if (n[0] * t[0]! + n[1] * t[1]! + n[2] * t[2]! < 0) this.edges.reverse();
  }

  mirror(axis: readonly number[] = [0, 1]): this {
    if (!closeEnough(axis[0]!, 0, 1e-4)) throw new Error(`${this.name}::ERROR::Mirrowing over arbitrary axis is not implemented`);
    this.edges.reflect([0, 0], [0, 1]);
    this.translation[0] = this.translation[0]! * -1;
    const e = this.rotation.asEuler('XYZ');
    e[1] *= -1;
    e[2] *= -1;
    this.rotateTo(Rotation.fromEuler('XYZ', e));
    this.autonorm();
    return this;
  }

  /** add_dart: cut the dart into the edge, stitch its sides, update the given sequences. */
  addDart(dartShape: EdgeSequence, edge: Edge, offset: number, right = true, edgeSeq?: EdgeSequence, intEdgeSeq?: EdgeSequence): [EdgeSequence, EdgeSequence] {
    const cut = cutIntoEdge(dartShape, edge, offset, right);
    const dartEdges = cut[1];
    let edgesNew = cut[0];
    let intNew = cut[2];
    this.stitchingRules.append([new Interface(this, dartEdges.edges[0]!), new Interface(this, dartEdges.edges[1]!)]);
    if (edgeSeq) {
      edgeSeq.substitute(edge, edgesNew);
      edgesNew = edgeSeq;
    }
    if (intEdgeSeq) {
      intEdgeSeq.substitute(edge, intNew);
      intNew = intEdgeSeq;
    }
    return [edgesNew, intNew];
  }

  assembly(): PatternSpec {
    this.setPivot(this.edges.edges[0]!.start, true);
    const vertices: Vert[] = [this.edges.edges[0]!.start];
    const edges: EdgeSpec[] = [];
    for (const e of this.edges.edges) {
      const [vs, spec] = e.assembly();
      let shift: number;
      const last = vertices[vertices.length - 1]!;
      if (last[0] === vs[0]![0] && last[1] === vs[0]![1] && last.length === vs[0]!.length) {
        shift = vertices.length - 1;
        vertices.push(...vs.slice(1));
      } else {
        shift = vertices.length;
        vertices.push(...vs);
      }
      spec.endpoints = spec.endpoints.map((id) => id + shift);
      e.geometricId = edges.length;
      edges.push(spec);
    }
    const first = vertices[0]!;
    const lastV = vertices[vertices.length - 1]!;
    if (lastV[0] === first[0] && lastV[1] === first[1]) {
      vertices.pop();
      edges[edges.length - 1]!.endpoints[edges[edges.length - 1]!.endpoints.length - 1] = 0;
    }
    const ps: PanelSpec = { translation: this.translation.slice(), rotation: this.rotation.asEuler('XYZ', true), vertices, edges };
    if (this.label) ps.label = this.label;
    return { panels: { [this.name]: ps }, stitches: this.stitchingRules.assembly() };
  }

  center2D(nInside = 3): number[] {
    const lin = new EdgeSequence(this.edges.edges.map((e) => e.linearize(nInside)));
    const verts = lin.verts();
    return [npMean(verts.map((v) => v[0]!)), npMean(verts.map((v) => v[1]!))];
  }

  pointTo3D(p: readonly number[]): V3 {
    const r = this.rotation.apply([p[0]!, p[1]!, p.length > 2 ? p[2]! : 0]);
    return [r[0] + this.translation[0]!, r[1] + this.translation[1]!, r[2] + this.translation[2]!];
  }

  /** Normal of the panel from the vertices on its 2D bounding box, weighted, then cleaned of tiny components. */
  norm(): V3 {
    const [, b2] = this.edges.bbox();
    const b3 = b2.map((v) => this.pointTo3D(v));
    const c = [npMean(b3.map((v) => v[0])), npMean(b3.map((v) => v[1])), npMean(b3.map((v) => v[2]))];
    const norms: V3[] = [];
    for (let i = 0; i < b3.length; i++) {
      const a = b3[i]!;
      const b = b3[(i + 1) % b3.length]!;
      const u = [a[0] - c[0]!, a[1] - c[1]!, a[2] - c[2]!];
      const w = [b[0] - c[0]!, b[1] - c[1]!, b[2] - c[2]!];
      const n: V3 = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
      const l = norm2(n);
      norms.push([n[0] / l, n[1] / l, n[2] / l]);
    }
    let avg: V3 = [0, 0, 0];
    for (const n of norms) avg = [avg[0] + n[0], avg[1] + n[1], avg[2] + n[2]];
    avg = [avg[0] / norms.length, avg[1] / norms.length, avg[2] / norms.length];
    if (closeEnough(norm2(avg), 0)) avg = norms[0]!;
    const l = norm2(avg);
    const out: V3 = [avg[0] / l, avg[1] / l, avg[2] / l];
    for (let i = 0; i < 3; i++) if (isclose(out[i]!, 0)) out[i] = 0;
    return out;
  }

  bbox(): [number[], number[]] {
    const lin = new EdgeSequence(this.edges.edges.map((e) => e.linearize()));
    const v = lin.verts();
    return [
      [Math.min(...v.map((p) => p[0]!)), Math.min(...v.map((p) => p[1]!))],
      [Math.max(...v.map((p) => p[0]!)), Math.max(...v.map((p) => p[1]!))],
    ];
  }

  override bbox3D(): [V3, V3] {
    const lin = new EdgeSequence(this.edges.edges.map((e) => e.linearize()));
    return bbox3(lin.verts().map((v) => this.pointTo3D(v)));
  }
}

/** numpy mean along axis 0 (a sequential sum: pairwise summation only applies along the contiguous axis). */
function npMean(v: readonly number[]): number {
  let s = 0;
  for (const x of v) s += x;
  return s / v.length;
}

/** vector_align_3D: the rotation taking v1 onto v2. */
export function vectorAlign3D(v1: readonly number[], v2: readonly number[]): Rotation {
  let c = (v1[0]! * v2[0]! + v1[1]! * v2[1]! + v1[2]! * v2[2]!) / (norm2(v1) * norm2(v2));
  c = Math.max(Math.min(c, 1), -1);
  const angle = acosD(c);
  const cr = [v1[1]! * v2[2]! - v1[2]! * v2[1]!, v1[2]! * v2[0]! - v1[0]! * v2[2]!, v1[0]! * v2[1]! - v1[1]! * v2[0]!];
  const n = norm2(cr);
  return Rotation.fromRotvec(cr.map((v) => (v / n) * angle));
}


export class Component extends BaseComponent {
  subs: BaseComponent[] = [];

  setPanelLabel(label: string, overwrite = true): void {
    for (const s of this.subcomponents()) s.setPanelLabel(label, overwrite);
  }

  override pivot3D(): V3 {
    const [mins, maxes] = this.bbox3D();
    return [(mins[0] + maxes[0]) / 2, maxes[1], (mins[2] + maxes[2]) / 2];
  }

  length(): number {
    const subs = this.subcomponents();
    let s = 0;
    for (const c of subs) s += c.length();
    return subs.length ? s : 0;
  }

  translateBy(delta: readonly number[]): this {
    for (const s of this.subcomponents()) s.translateBy(delta);
    return this;
  }

  translateTo(t: readonly number[]): this {
    const pivot = this.pivot3D();
    for (const s of this.subcomponents()) {
      const sp = s.pivot3D();
      s.translateTo([t[0]! + (sp[0] - pivot[0]), t[1]! + (sp[1] - pivot[1]), t[2]! + (sp[2] - pivot[2])]);
    }
    return this;
  }

  rotateBy(r: Rotation): this {
    const pivot = this.pivot3D();
    for (const s of this.subcomponents()) {
      const sp = s.pivot3D();
      const rel = [sp[0] - pivot[0], sp[1] - pivot[1], sp[2] - pivot[2]];
      const rr = r.apply(rel);
      s.rotateBy(r);
      s.translateBy([rr[0] - rel[0]!, rr[1] - rel[1]!, rr[2] - rel[2]!]);
    }
    return this;
  }

  mirror(axis: readonly number[] = [0, 1]): this {
    for (const s of this.subcomponents()) s.mirror(axis);
    return this;
  }

  assembly(): PatternSpec {
    const out: PatternSpec = { panels: {}, stitches: [] };
    const subs = this.subcomponents();
    if (!subs.length) return out;
    for (const s of subs) {
      const raw = s.assembly();
      out.panels = { ...out.panels, ...raw.panels };
      out.stitches.push(...raw.stitches);
    }
    out.stitches.push(...this.stitchingRules.assembly());
    return out;
  }

  override bbox3D(): [V3, V3] {
    const subs = this.subcomponents();
    if (!subs.length)
      return [
        [Infinity, Infinity, Infinity],
        [-Infinity, -Infinity, -Infinity],
      ];
    const bbs = subs.map((s) => s.bbox3D());
    return bbox3(bbs.flatMap((b) => [b[0], b[1]]));
  }

  override isSelfIntersecting(): boolean {
    return this.subcomponents().some((s) => s.isSelfIntersecting());
  }

  /**
   * Unique subcomponents: attributes holding components, then `subs`. GarmentCode collects them through a Python
   * set, whose order varies between runs; here the order is fixed (attribute order, then subs). Only the order of
   * panels and stitches in the output depends on it.
   */
  subcomponents(): BaseComponent[] {
    const out: BaseComponent[] = [];
    for (const key of Object.keys(this)) {
      const v = (this as unknown as Record<string, unknown>)[key];
      if (v instanceof BaseComponent && !out.includes(v)) out.push(v);
    }
    for (const s of this.subs) if (!out.includes(s)) out.push(s);
    return out;
  }
}

