/**
 * Interfaces and stitching rules (port of pygarment/garmentcode/interface.py and connector.py).
 *
 * An interface is an ordered set of edges, each with the panel it belongs to, a flip flag, a right/wrong side flag
 * and ruffle (gathering) sections. A stitching rule pairs two interfaces and subdivides their edges until both
 * sides have matching length fractions, which is how GarmentCode turns T-junctions into one-to-one stitches.
 */
import { Edge, EdgeSequence, GarmentRuntimeError, pySum } from './edge';
import type { Panel } from './panel';
import { closeEnough, norm2, type Vert } from './utils';
import type { V3 } from './num/rotation';

export interface Ruffle {
  coeff: number;
  sec: [number, number];
}

export class Interface {
  edges: EdgeSequence;
  panel: Panel[];
  rightWrong: boolean[];
  edgesFlipping: boolean[];
  ruffle: Ruffle[];

  constructor(panel: Panel, edges: Edge | EdgeSequence | Edge[], ruffle: number | number[] = 1, rightWrong = false) {
    this.edges = edges instanceof EdgeSequence ? edges : new EdgeSequence(edges);
    const n = this.edges.length;
    this.panel = Array.from({ length: n }, () => panel);
    this.rightWrong = Array.from({ length: n }, () => rightWrong);
    this.edgesFlipping = Array.from({ length: n }, () => false);
    if (Array.isArray(ruffle)) {
      const count = edges instanceof Edge ? 1 : edges instanceof EdgeSequence ? edges.length : edges.length;
      if (ruffle.length !== count) throw new Error("Ruffles and Edges don't match");
      this.ruffle = [];
      let lastCoef: number | null = null;
      let lastStart = 0;
      for (let i = 0; i < ruffle.length; i++) {
        const coef = ruffle[i]!;
        if (coef === lastCoef || lastCoef === null) {
          lastCoef = coef;
          continue;
        }
        this.ruffle.push({ coeff: lastCoef, sec: [lastStart, i] });
        lastStart = i;
        lastCoef = coef;
      }
      this.ruffle.push({ coeff: lastCoef!, sec: [lastStart, ruffle.length] });
    } else this.ruffle = [{ coeff: ruffle, sec: [0, n] }];
  }

  /** Edges shaped for projection onto another panel, with ruffle sections extended (projecting_edges). */
  projectingEdges(onOriented = false): EdgeSequence {
    const projected = onOriented ? this.orientedEdges() : this.edges.copy();
    for (const r of this.ruffle) {
      if (closeEnough(r.coeff, 1, 1e-3)) continue;
      if (r.sec[1] >= projected.length || !projected.slice(r.sec[1] - 1, r.sec[1] + 1).isChained()) {
        projected.slice(r.sec[0], r.sec[1]).extend(1 / r.coeff);
      } else {
        const prevEdge = projected.edges[r.sec[1] - 1]!;
        const nextEdge = projected.edges[r.sec[1]]!;
        const commonV = prevEdge.end === nextEdge.end || prevEdge.end === nextEdge.start ? prevEdge.end : prevEdge.start;
        const copyV: Vert = commonV.slice();
        let copyToEnd = false;
        if (commonV === nextEdge.end) {
          nextEdge.end = copyV;
          copyToEnd = true;
        } else nextEdge.start = copyV;
        projected.slice(r.sec[0], r.sec[1]).extend(1 / r.coeff);
        projected.slice(r.sec[1]).translateBy([commonV[0]! - copyV[0]!, commonV[1]! - copyV[1]!]);
        if (copyToEnd) nextEdge.end = commonV;
        else nextEdge.start = commonV;
      }
    }
    return projected;
  }

  projectingLengths(): number[] {
    const out: number[] = [];
    for (const r of this.ruffle) {
      const es = this.edges.slice(r.sec[0], r.sec[1]).edges;
      if (!closeEnough(r.coeff, 1, 1e-3)) for (const e of es) out.push(e.length() / r.coeff);
      else for (const e of es) out.push(e.length());
    }
    return out;
  }

  projectingFractions(): number[] {
    const l = this.projectingLengths();
    const s = npSum(l);
    return l.map((v) => v / s);
  }

  needsFlipping(i: number): boolean {
    return this.edgesFlipping[i]!;
  }

  orientedEdges(): EdgeSequence {
    const oriented = this.edges.copy();
    for (let i = 0; i < this.edges.length; i++) {
      if (this.needsFlipping(i)) {
        oriented.edges[i]!.reverse();
        oriented.edges[i]!.flipped = true;
      } else oriented.edges[i]!.flipped = false;
    }
    return oriented;
  }

  verts3d(): V3[] {
    const verts: Vert[] = [];
    const panels: Panel[] = [];
    this.edges.edges.forEach((e, k) => {
      const p = this.panel[k]!;
      if (verts.every((v) => e.start !== v)) {
        verts.push(e.start);
        panels.push(p);
      }
      if (verts.every((v) => e.end !== v)) {
        verts.push(e.end);
        panels.push(p);
      }
    });
    return verts.map((v, i) => panels[i]!.pointTo3D(v));
  }

  bbox3d(): [V3, V3] {
    const pts: V3[] = [];
    this.edges.edges.forEach((e, k) => {
      const p = this.panel[k]!;
      for (const v of e.linearize().verts()) pts.push(p.pointTo3D(v));
    });
    return bbox3(pts);
  }

  get length(): number {
    return this.edges.length;
  }

  panelNames(): string[] {
    return this.panel.map((p) => p.name);
  }

  reverse(withEdgeDirReverse = false): this {
    this.edges.edges.reverse();
    this.panel.reverse();
    this.edgesFlipping.reverse();
    if (withEdgeDirReverse) this.edgesFlipping = this.edgesFlipping.map((e) => !e);
    const n = this.edges.length;
    for (const r of this.ruffle) {
      const a = n - r.sec[0];
      const b = n - r.sec[1];
      r.sec[0] = b;
      r.sec[1] = a;
    }
    return this;
  }

  flipEdges(): this {
    this.edgesFlipping = this.edgesFlipping.map((e) => !e);
    return this;
  }

  substitute(orig: number | Edge, newEdges: Edge | EdgeSequence, newPanels: Panel[] | Panel): this {
    let k = orig instanceof Edge ? this.edges.index(orig) : orig;
    if (k < 0) k = this.edges.length + k;
    this.edges.substitute(k, newEdges);
    this.panel.splice(k, 1);
    const flip = this.edgesFlipping.splice(k, 1)[0]!;
    const rw = this.rightWrong.splice(k, 1)[0]!;
    if (Array.isArray(newPanels)) {
      for (let j = 0; j < newPanels.length; j++) {
        this.panel.splice(k + j, 0, newPanels[j]!);
        this.edgesFlipping.splice(k + j, 0, flip);
        this.rightWrong.splice(k + j, 0, rw);
      }
    } else {
      this.panel.splice(k, 0, newPanels);
      this.edgesFlipping.splice(k, 0, flip);
      // GarmentCode inserts at `orig + j` here with j undefined (a NameError); never reached by the programs.
      this.rightWrong.splice(k, 0, rw);
    }
    const insLen = newEdges instanceof Edge ? 1 : newEdges.length;
    if (insLen > 1) {
      for (const it of this.ruffle) {
        if (it.sec[0] > k) it.sec[0] += insLen - 1;
        if (it.sec[1] > k) it.sec[1] += insLen - 1;
      }
    }
    return this;
  }

  setRightWrong(rightWrong: boolean): this {
    this.rightWrong = Array.from({ length: this.edges.length }, () => rightWrong);
    return this;
  }

  /** Interface.from_multiple: concatenation keeping per-edge panels, flags and ruffle sections. */
  static fromMultiple(...ints: Interface[]): Interface {
    const nw = Object.create(Interface.prototype) as Interface;
    nw.edges = new EdgeSequence();
    nw.edgesFlipping = [];
    nw.panel = [];
    nw.ruffle = [];
    nw.rightWrong = [];
    for (const elem of ints) {
      const shift = nw.edges.length;
      for (const r of elem.ruffle) nw.ruffle.push({ coeff: r.coeff, sec: [r.sec[0] + shift, r.sec[1] + shift] });
      nw.edges.append(elem.edges);
      nw.panel.push(...elem.panel);
      nw.rightWrong.push(...elem.rightWrong);
      nw.edgesFlipping.push(...elem.edgesFlipping);
    }
    return nw;
  }
}

/** numpy sum of a short float array (pairwise summation equals left-to-right below 8 items). */
export function npSum(v: readonly number[]): number {
  if (v.length < 8) return pySum(v);
  // numpy's pairwise summation: blocks of 8 partial sums, unrolled.
  return pairwise(v, 0, v.length);
}

function pairwise(a: readonly number[], lo: number, n: number): number {
  if (n < 8) {
    let s = 0;
    for (let i = lo; i < lo + n; i++) s += a[i]!;
    return s;
  }
  if (n <= 128) {
    const r = [a[lo]!, a[lo + 1]!, a[lo + 2]!, a[lo + 3]!, a[lo + 4]!, a[lo + 5]!, a[lo + 6]!, a[lo + 7]!];
    let i = 8;
    for (; i < n - (n % 8); i += 8) for (let k = 0; k < 8; k++) r[k] = r[k]! + a[lo + i + k]!;
    let res = r[0]! + r[1]! + (r[2]! + r[3]!) + (r[4]! + r[5]! + (r[6]! + r[7]!));
    for (; i < n; i++) res += a[lo + i]!;
    return res;
  }
  let n2 = Math.floor(n / 2);
  n2 -= n2 % 8;
  return pairwise(a, lo, n2) + pairwise(a, lo + n2, n - n2);
}

export function bbox3(pts: readonly V3[]): [V3, V3] {
  const lo: V3 = [Infinity, Infinity, Infinity];
  const hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) {
    for (let k = 0; k < 3; k++) {
      if (p[k]! < lo[k]!) lo[k] = p[k]!;
      if (p[k]! > hi[k]!) hi[k] = p[k]!;
    }
  }
  return [lo, hi];
}

/** _is_order_matching. */
export function isOrderMatching(panelS: Panel, vertS: Vert, panel1: Panel, vert1: Vert, panel2: Panel, vert2: Vert): boolean {
  const s = panelS.pointTo3D(vertS);
  const a = panel1.pointTo3D(vert1);
  const b = panel2.pointTo3D(vert2);
  return norm2([a[0] - s[0], a[1] - s[1], a[2] - s[2]]) < norm2([b[0] - s[0], b[1] - s[1], b[2] - s[2]]);
}

// ------------------------------------------------------------------ stitching

export type StitchSide = { panel: string; edge: number };
export type StitchSpec = [StitchSide, StitchSide] | [StitchSide, StitchSide, 'right_wrong'];

/** numpy allclose with rtol 1e-5. */
function allclose(a: readonly number[], b: readonly number[], atol: number): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!(Math.abs(a[i]! - b[i]!) <= atol + 1e-5 * Math.abs(b[i]!))) return false;
  return true;
}

export class StitchingRule {
  /** Set when the program gathers this seam on purpose through a design parameter (not GarmentCode data). */
  intendedGather = false;

  constructor(
    public int1: Interface,
    public int2: Interface,
  ) {
    if (!this.isMatching()) this.matchInterfaces();
  }

  isMatching(tol = 0.05): boolean {
    return this.int1.length === this.int2.length && allclose(this.int1.projectingFractions(), this.int2.projectingFractions(), tol);
  }

  matchInterfaces(): void {
    const frac1 = this.int1.projectingFractions();
    const frac2 = this.int2.projectingFractions();
    const minFrac = Math.min(Math.min(...frac1), Math.min(...frac2));
    this.matchToFractions(this.int1, frac2, Math.min(1e-2, minFrac / 2));
    this.matchToFractions(this.int2, frac1, Math.min(1e-2, minFrac / 2));
  }

  private matchToFractions(inter: Interface, toAdd: number[], tol: number): void {
    let addId = 0;
    let inId = 0;
    let coveredInit = 0;
    let coveredAdded = 0;
    let curr = inter.projectingFractions();
    while (inId < inter.edges.length && addId < toAdd.length) {
      const nextInit = Math.min(coveredInit + curr[inId]!, 1);
      const nextAdded = Math.min(coveredAdded + toAdd[addId]!, 1);
      if (closeEnough(nextInit, nextAdded, tol)) {
        inId += 1;
        addId += 1;
        coveredInit = nextInit;
        coveredAdded = nextAdded;
      } else if (nextInit < nextAdded) {
        inId += 1;
        coveredInit = nextInit;
      } else {
        const inFrac = curr[inId]!;
        const newVLoc = inFrac - (nextInit - nextAdded);
        let splitFrac = newVLoc / inFrac;
        const baseEdge = inter.edges.edges[inId]!;
        const flip = inter.needsFlipping(inId);
        if (flip) splitFrac = 1 - splitFrac;
        const subdiv = baseEdge.subdivideLen([splitFrac, 1 - splitFrac]);
        inter.panel[inId]!.edges.substitute(baseEdge, subdiv);
        if (flip) subdiv.edges.reverse();
        const p = inter.panel[inId]!;
        inter.substitute(
          baseEdge,
          subdiv,
          subdiv.edges.map(() => p),
        );
        curr = inter.projectingFractions();
        coveredInit += curr[inId]!;
        coveredAdded = nextAdded;
        inId += 1;
        addId += 1;
      }
    }
    if (addId !== toAdd.length) throw new GarmentRuntimeError(`StitchingRule::ERROR::Projection on ${inter.panelNames()} failed`);
  }

  assembly(): StitchSpec[] {
    const out: StitchSpec[] = [];
    const n = Math.min(this.int1.edges.length, this.int2.edges.length);
    for (let i = 0; i < n; i++) {
      const s: StitchSpec = [
        { panel: this.int1.panel[i]!.name, edge: this.int1.edges.edges[i]!.geometricId },
        { panel: this.int2.panel[i]!.name, edge: this.int2.edges.edges[i]!.geometricId },
      ];
      const st: StitchSpec = this.int1.rightWrong[i] || this.int2.rightWrong[i] ? [s[0], s[1], 'right_wrong'] : s;
      // Not part of GarmentCode's specification: whether either side gathers (a ruffle coefficient other than 1).
      Object.defineProperty(st, 'gathered', { value: this.intendedGather || !closeEnough(ruffleAt(this.int1, i), 1, 1e-3) || !closeEnough(ruffleAt(this.int2, i), 1, 1e-3), enumerable: false });
      Object.defineProperty(st, 'rule', { value: this, enumerable: false });
      out.push(st);
    }
    return out;
  }
}

/** The ruffle coefficient of the interface section holding edge i. */
function ruffleAt(int: Interface, i: number): number {
  for (const r of int.ruffle) if (i >= r.sec[0] && i < r.sec[1]) return r.coeff;
  return 1;
}

export class Stitches {
  rules: StitchingRule[];
  constructor(...rules: [Interface, Interface][]) {
    this.rules = rules.map(([a, b]) => new StitchingRule(a, b));
  }
  append(pair: [Interface, Interface]): StitchingRule {
    const r = new StitchingRule(pair[0], pair[1]);
    this.rules.push(r);
    return r;
  }
  assembly(): StitchSpec[] {
    const out: StitchSpec[] = [];
    for (const r of this.rules) out.push(...r.assembly());
    return out;
  }
}
