/**
 * The working triangle mesh of a garment generator: positions, a reference
 * normal and body part per vertex, and a panel (piece of cloth) per triangle.
 * Arrays grow as parts are added; every operation runs in a fixed order.
 */
import { SEG } from './body';
import { cross, get3, len, normalize, sub, type Vec3 } from './vec';

/** Vertex flags. */
export const RIM = 1;
export const BAND = 2;
export const LOFT = 4;
export const PART = 8;
/** Generated parts that keep their own shape (pockets, soles, brims): no smoothing or clearance moves them. */
export const FIXED = 16;

export class WorkMesh {
  pos: number[] = [];
  /** Outward reference normal (the body's, for vertices cut from it). */
  nrm: number[] = [];
  /** Body part (SEGMENTS index) per vertex, -1 for none. */
  seg: number[] = [];
  /** Shell body vertex this vertex came from, -1 for generated ones. */
  bodyVert: number[] = [];
  flags: number[] = [];
  /** Ease of each vertex (metres), for vertices offset from the body. */
  ease: number[] = [];
  /** The hem or opening (constraint index) nearest a cut vertex, -1 for none. */
  hem: number[] = [];
  /** Distance inside the cut (metres; 0 on the hem), for bands measured from a hem. */
  dist: number[] = [];
  tris: number[] = [];
  /** Panel per triangle (index into `panels`). */
  panel: number[] = [];
  panels: string[] = [];

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  get triangleCount(): number {
    return this.tris.length / 3;
  }

  addVertex(p: Vec3, n: Vec3, seg = -1, flags = 0, bodyVert = -1, ease = 0): number {
    const i = this.vertexCount;
    this.pos.push(p[0], p[1], p[2]);
    this.nrm.push(n[0], n[1], n[2]);
    this.seg.push(seg);
    this.bodyVert.push(bodyVert);
    this.flags.push(flags);
    this.ease.push(ease);
    this.hem.push(-1);
    this.dist.push(1);
    return i;
  }

  panelId(name: string): number {
    let i = this.panels.indexOf(name);
    if (i < 0) {
      i = this.panels.length;
      this.panels.push(name);
    }
    return i;
  }

  addTri(a: number, b: number, c: number, panel: number): void {
    if (a === b || b === c || a === c) return;
    this.tris.push(a, b, c);
    this.panel.push(panel);
  }

  p(i: number): Vec3 {
    return get3(this.pos, i);
  }

  n(i: number): Vec3 {
    return get3(this.nrm, i);
  }

  setP(i: number, v: Vec3): void {
    this.pos[i * 3] = v[0];
    this.pos[i * 3 + 1] = v[1];
    this.pos[i * 3 + 2] = v[2];
  }

  setN(i: number, v: Vec3): void {
    this.nrm[i * 3] = v[0];
    this.nrm[i * 3 + 1] = v[1];
    this.nrm[i * 3 + 2] = v[2];
  }

  /** Vertex neighbours over triangle edges, ascending. */
  neighbours(): number[][] {
    const sets: Set<number>[] = Array.from({ length: this.vertexCount }, () => new Set<number>());
    const t = this.tris;
    for (let i = 0; i < t.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const a = t[i + k]!;
        const b = t[i + ((k + 1) % 3)]!;
        sets[a]!.add(b);
        sets[b]!.add(a);
      }
    }
    return sets.map((s) => [...s].sort((a, b) => a - b));
  }

  /**
   * Open boundary loops, each ordered along the boundary half-edges (the cloth
   * is on the left walking along a loop seen from outside). Deterministic: loops
   * start at their smallest vertex, and are listed by that vertex.
   */
  boundaryLoops(): number[][] {
    const t = this.tris;
    const half = new Set<number>();
    const N = this.vertexCount;
    for (let i = 0; i < t.length; i += 3) for (let k = 0; k < 3; k++) half.add(t[i + k]! * N + t[i + ((k + 1) % 3)]!);
    const next = new Map<number, number[]>();
    for (const h of half) {
      const a = Math.floor(h / N);
      const b = h - a * N;
      if (!half.has(b * N + a)) {
        const list = next.get(a);
        if (list) list.push(b);
        else next.set(a, [b]);
      }
    }
    for (const list of next.values()) list.sort((x, y) => x - y);
    const starts = [...next.keys()].sort((x, y) => x - y);
    const used = new Set<number>();
    const loops: number[][] = [];
    for (const s of starts) {
      const outs = next.get(s)!;
      for (const first of outs) {
        if (used.has(s * N + first)) continue;
        const loop = [s];
        used.add(s * N + first);
        let cur = first;
        let guard = 0;
        while (cur !== s && guard++ < N) {
          loop.push(cur);
          const cand = (next.get(cur) ?? []).find((x) => !used.has(cur * N + x));
          if (cand === undefined) break;
          used.add(cur * N + cand);
          cur = cand;
        }
        if (loop.length >= 3) loops.push(loop);
      }
    }
    return loops;
  }

  /** Connected components of the triangles: component id per triangle and the count. */
  components(): { of: Int32Array; count: number } {
    const T = this.triangleCount;
    const parent = new Int32Array(this.vertexCount).map((_, i) => i);
    const find = (i: number): number => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]!]!;
        i = parent[i]!;
      }
      return i;
    };
    for (let i = 0; i < T; i++) {
      const a = find(this.tris[i * 3]!);
      for (let k = 1; k < 3; k++) {
        const b = find(this.tris[i * 3 + k]!);
        if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
      }
    }
    const id = new Map<number, number>();
    const of = new Int32Array(T);
    for (let i = 0; i < T; i++) {
      const r = find(this.tris[i * 3]!);
      let c = id.get(r);
      if (c === undefined) id.set(r, (c = id.size));
      of[i] = c;
    }
    return { of, count: id.size };
  }

  triangleArea(t: number): number {
    const a = this.p(this.tris[t * 3]!);
    const b = this.p(this.tris[t * 3 + 1]!);
    const c = this.p(this.tris[t * 3 + 2]!);
    return 0.5 * len(cross(sub(b, a), sub(c, a)));
  }

  /** Drop triangles (keep[t] false) and then vertices nothing uses; returns the old -> new vertex map. */
  filter(keep: (t: number) => boolean): Int32Array {
    const tris: number[] = [];
    const panel: number[] = [];
    for (let t = 0; t < this.triangleCount; t++) {
      if (!keep(t)) continue;
      tris.push(this.tris[t * 3]!, this.tris[t * 3 + 1]!, this.tris[t * 3 + 2]!);
      panel.push(this.panel[t]!);
    }
    this.tris = tris;
    this.panel = panel;
    return this.compact();
  }

  /** Remove unused vertices; returns old -> new (-1 for removed). */
  compact(): Int32Array {
    const map = new Int32Array(this.vertexCount).fill(-1);
    for (const v of this.tris) map[v] = 0;
    const out = new WorkMesh();
    out.panels = this.panels;
    for (let v = 0; v < this.vertexCount; v++) {
      if (map[v]! < 0) continue;
      map[v] = out.addVertex(this.p(v), this.n(v), this.seg[v]!, this.flags[v]!, this.bodyVert[v]!, this.ease[v]!);
      out.hem[map[v]!] = this.hem[v]!;
      out.dist[map[v]!] = this.dist[v]!;
    }
    this.pos = out.pos;
    this.nrm = out.nrm;
    this.seg = out.seg;
    this.bodyVert = out.bodyVert;
    this.flags = out.flags;
    this.ease = out.ease;
    this.hem = out.hem;
    this.dist = out.dist;
    for (let i = 0; i < this.tris.length; i++) this.tris[i] = map[this.tris[i]!]!;
    return map;
  }

  /** Keep only components with at least `share` of the largest component's area. */
  dropFragments(share: number): void {
    const { of, count } = this.components();
    if (count <= 1) return;
    const area = new Float64Array(count);
    for (let t = 0; t < this.triangleCount; t++) area[of[t]!]! += this.triangleArea(t);
    let max = 0;
    for (const a of area) max = Math.max(max, a);
    this.filter((t) => area[of[t]!]! >= share * max);
  }

  /** Face normals averaged per vertex (area weighted), from the current positions. */
  shapeNormals(): Float64Array {
    const out = new Float64Array(this.pos.length);
    const t = this.tris;
    for (let i = 0; i < t.length; i += 3) {
      const a = this.p(t[i]!);
      const b = this.p(t[i + 1]!);
      const c = this.p(t[i + 2]!);
      const f = cross(sub(b, a), sub(c, a));
      for (let k = 0; k < 3; k++) {
        const v = t[i + k]!;
        out[v * 3] = out[v * 3]! + f[0];
        out[v * 3 + 1] = out[v * 3 + 1]! + f[1];
        out[v * 3 + 2] = out[v * 3 + 2]! + f[2];
      }
    }
    for (let v = 0; v < this.vertexCount; v++) {
      const n = normalize([out[v * 3]!, out[v * 3 + 1]!, out[v * 3 + 2]!]);
      out[v * 3] = n[0];
      out[v * 3 + 1] = n[1];
      out[v * 3 + 2] = n[2];
    }
    return out;
  }

  /** Append another mesh (its panels are merged by name); returns the vertex offset. */
  append(other: WorkMesh): number {
    const off = this.vertexCount;
    for (let v = 0; v < other.vertexCount; v++) {
      const i = this.addVertex(other.p(v), other.n(v), other.seg[v]!, other.flags[v]!, other.bodyVert[v]!, other.ease[v]!);
      this.hem[i] = other.hem[v]!;
      this.dist[i] = other.dist[v]!;
    }
    for (let t = 0; t < other.triangleCount; t++) {
      this.addTri(other.tris[t * 3]! + off, other.tris[t * 3 + 1]! + off, other.tris[t * 3 + 2]! + off, this.panelId(other.panels[other.panel[t]!]!));
    }
    return off;
  }
}

/** True for limb segments on the character's left. */
export function isLeft(seg: number): boolean {
  return seg >= SEG.upperarm_l && seg % 2 === SEG.upperarm_l % 2;
}
