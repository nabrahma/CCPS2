/**
 * Connectivity of the body part of hm08 (the closed skin surface, without the
 * helper geometry), built once per base mesh: triangles, the vertex graph and
 * neighbourhood queries used by the measurements (PRD Part 3, F24).
 */
import type { BaseMesh } from '../mesh/basemesh';

const cache = new WeakMap<BaseMesh, BodyTopology>();

export class BodyTopology {
  /** Number of body vertices (they are vertices 0..vertexCount-1 of hm08). */
  readonly vertexCount: number;
  /** Body quads, 4 vertex indices each. */
  readonly quads: Uint32Array;
  /** Two triangles per quad, (0,1,2) and (0,2,3): a closed 2-manifold. */
  readonly tris: Uint32Array;
  /** All four triangles of each quad (both diagonals), for distance updates that should not favour one diagonal. */
  readonly fanTris: Uint32Array;
  /** Vertex graph in compressed-row form: quad edges plus both diagonals, neighbours ascending. */
  readonly nbrStart: Uint32Array;
  readonly nbr: Uint32Array;
  /** Triangles (indices into `tris`) around each vertex. */
  readonly vertTriStart: Uint32Array;
  readonly vertTri: Uint32Array;

  static of(base: BaseMesh): BodyTopology {
    let t = cache.get(base);
    if (!t) {
      t = new BodyTopology(base);
      cache.set(base, t);
    }
    return t;
  }

  private constructor(base: BaseMesh) {
    const n = base.bodyVertexCount;
    this.vertexCount = n;
    const faces = base.facesWhere((g) => g === 'body');
    const quads = new Uint32Array(faces.length * 4);
    faces.forEach((f, i) => {
      for (let k = 0; k < 4; k++) {
        const v = base.faceVerts[f * 4 + k]!;
        if (v >= n) throw new Error('anthro: a body face uses a helper vertex');
        quads[i * 4 + k] = v;
      }
    });
    this.quads = quads;
    const q = faces.length;
    const tris = new Uint32Array(q * 6);
    const fan = new Uint32Array(q * 12);
    for (let i = 0; i < q; i++) {
      const a = quads[i * 4]!;
      const b = quads[i * 4 + 1]!;
      const c = quads[i * 4 + 2]!;
      const d = quads[i * 4 + 3]!;
      tris.set([a, b, c, a, c, d], i * 6);
      fan.set([a, b, c, a, c, d, a, b, d, b, c, d], i * 12);
    }
    this.tris = tris;
    this.fanTris = fan;

    const sets: number[][] = Array.from({ length: n }, () => []);
    const link = (u: number, v: number) => {
      sets[u]!.push(v);
      sets[v]!.push(u);
    };
    for (let i = 0; i < q; i++) {
      const a = quads[i * 4]!;
      const b = quads[i * 4 + 1]!;
      const c = quads[i * 4 + 2]!;
      const d = quads[i * 4 + 3]!;
      link(a, b);
      link(b, c);
      link(c, d);
      link(d, a);
      link(a, c);
      link(b, d);
    }
    const start = new Uint32Array(n + 1);
    const flat: number[] = [];
    for (let v = 0; v < n; v++) {
      const list = Array.from(new Set(sets[v]!)).sort((x, y) => x - y);
      start[v] = flat.length;
      for (const u of list) flat.push(u);
    }
    start[n] = flat.length;
    this.nbrStart = start;
    this.nbr = Uint32Array.from(flat);

    const count = new Uint32Array(n + 1);
    for (let i = 0; i < tris.length; i++) count[tris[i]! + 1] = count[tris[i]! + 1]! + 1;
    for (let v = 0; v < n; v++) count[v + 1] = count[v + 1]! + count[v]!;
    const fill = count.slice(0, n);
    const vt = new Uint32Array(tris.length);
    for (let t = 0; t < tris.length / 3; t++) {
      for (let k = 0; k < 3; k++) {
        const v = tris[t * 3 + k]!;
        vt[fill[v]!] = t;
        fill[v] = fill[v]! + 1;
      }
    }
    this.vertTriStart = count;
    this.vertTri = vt;
  }

  /** Vertices within `hops` graph steps of the given ones (including them), ascending. */
  verticesNear(vertices: ArrayLike<number>, hops: number): Uint32Array {
    const seen = new Uint8Array(this.vertexCount);
    let frontier: number[] = [];
    for (let i = 0; i < vertices.length; i++) {
      const v = vertices[i]!;
      if (!seen[v]) {
        seen[v] = 1;
        frontier.push(v);
      }
    }
    for (let h = 0; h < hops; h++) {
      const next: number[] = [];
      for (const v of frontier) {
        for (let k = this.nbrStart[v]!; k < this.nbrStart[v + 1]!; k++) {
          const u = this.nbr[k]!;
          if (!seen[u]) {
            seen[u] = 1;
            next.push(u);
          }
        }
      }
      frontier = next;
    }
    const out: number[] = [];
    for (let v = 0; v < this.vertexCount; v++) if (seen[v]) out.push(v);
    return Uint32Array.from(out);
  }

  /** Triangles (indices into `tris`) with at least one of the given vertices, ascending. */
  trianglesTouching(vertices: ArrayLike<number>): Uint32Array {
    const seen = new Uint8Array(this.tris.length / 3);
    for (let i = 0; i < vertices.length; i++) {
      const v = vertices[i]!;
      for (let k = this.vertTriStart[v]!; k < this.vertTriStart[v + 1]!; k++) seen[this.vertTri[k]!] = 1;
    }
    const out: number[] = [];
    for (let t = 0; t < seen.length; t++) if (seen[t]) out.push(t);
    return Uint32Array.from(out);
  }
}
