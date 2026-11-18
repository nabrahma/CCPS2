/**
 * From a working mesh to garment data: decimation to the slot's budget
 * (F28 step 8) with panel borders kept as seams, the UV unwrap (step 7), and
 * the mesh in the form the garment importer binds (M10).
 */
import { simplifyRenderMeshSync } from '../../mesh/simplify';
import type { RawGarmentMesh } from '../../proxy/garment-import';
import { WorkMesh } from './mesh';
import { lscm, normalisePiece, packPieces, panelBasis } from './uv';
import { add, cross, dot, get3, scale, sub, type Vec3 } from './vec';

interface RenderTopo {
  /** Geometry vertex of each render vertex. */
  geo: number[];
  /** Panel of each render vertex. */
  panel: number[];
  /** Triangles in render vertices. */
  indices: Uint32Array;
}

/** One render vertex per (vertex, panel): panel borders become UV seams. */
function renderTopology(m: WorkMesh): RenderTopo {
  const key = new Map<number, number>();
  const geo: number[] = [];
  const panel: number[] = [];
  const P = m.panels.length;
  const indices = new Uint32Array(m.tris.length);
  for (let t = 0; t < m.triangleCount; t++) {
    const pn = m.panel[t]!;
    for (let k = 0; k < 3; k++) {
      const v = m.tris[t * 3 + k]!;
      const id = v * P + pn;
      let r = key.get(id);
      if (r === undefined) {
        r = geo.length;
        key.set(id, r);
        geo.push(v);
        panel.push(pn);
      }
      indices[t * 3 + k] = r;
    }
  }
  return { geo, panel, indices };
}

/** Area-weighted normal of each panel. */
function panelNormals(m: WorkMesh): Vec3[] {
  const out: Vec3[] = m.panels.map(() => [0, 0, 0]);
  for (let t = 0; t < m.triangleCount; t++) {
    const a = m.p(m.tris[t * 3]!);
    const f = cross(sub(m.p(m.tris[t * 3 + 1]!), a), sub(m.p(m.tris[t * 3 + 2]!), a));
    out[m.panel[t]!] = add(out[m.panel[t]!]!, f);
  }
  return out;
}

/** Planar projection of each render vertex onto its panel's plane (metres). */
function projectUvs(m: WorkMesh, topo: RenderTopo): Float64Array {
  const bases = panelNormals(m).map((n) => panelBasis(n));
  const uv = new Float64Array(topo.geo.length * 2);
  for (let r = 0; r < topo.geo.length; r++) {
    const [u, v] = bases[topo.panel[r]!]!;
    const p = m.p(topo.geo[r]!);
    uv[r * 2] = dot(p, u);
    uv[r * 2 + 1] = dot(p, v);
  }
  return uv;
}

/**
 * Decimate to `target` triangles. Borders may collapse along themselves (hem
 * loops get coarser with the rest), panel seams stay matched, and vertices
 * with any of `lockFlags` stay. Vertices are a subset of the input's.
 */
/** What a decimation kept: per output vertex its input vertex, and the output triangles with their panels. */
export interface DecimationRecord {
  keep: Int32Array;
  tris: Uint32Array;
  panel: Int32Array;
}

/** Apply a recorded decimation (the same vertices and triangles on any body). */
export function replayDecimation(m: WorkMesh, r: DecimationRecord): WorkMesh {
  const out = new WorkMesh();
  out.panels = m.panels.slice();
  for (const v of r.keep) {
    const i = out.addVertex(m.p(v), m.n(v), m.seg[v]!, m.flags[v]!, m.bodyVert[v]!, m.ease[v]!);
    out.hem[i] = m.hem[v]!;
    out.dist[i] = m.dist[v]!;
  }
  for (let t = 0; t < r.tris.length / 3; t++) out.addTri(r.tris[t * 3]!, r.tris[t * 3 + 1]!, r.tris[t * 3 + 2]!, r.panel[t]!);
  return out;
}

/** Decimate a working mesh, recording what it kept (the simplifier must be ready: `simplifierReady`). */
export function decimateWork(m: WorkMesh, target: number, lockFlags = 0): { mesh: WorkMesh; record: DecimationRecord } {
  if (m.triangleCount <= target) {
    const record = { keep: Int32Array.from({ length: m.vertexCount }, (_, i) => i), tris: Uint32Array.from(m.tris), panel: Int32Array.from(m.panel) };
    return { mesh: replayDecimation(m, record), record };
  }
  const topo = renderTopology(m);
  const n = topo.geo.length;
  const positions = new Float32Array(n * 3);
  const normals = new Float32Array(n * 3);
  const N = m.shapeNormals();
  for (let r = 0; r < n; r++) {
    const v = topo.geo[r]!;
    for (let k = 0; k < 3; k++) {
      positions[r * 3 + k] = m.pos[v * 3 + k]!;
      normals[r * 3 + k] = N[v * 3 + k]!;
    }
  }
  const uvs = Float32Array.from(projectUvs(m, topo));
  const lock = new Uint8Array(n);
  for (let r = 0; r < n; r++) lock[r] = m.flags[topo.geo[r]!]! & lockFlags ? 1 : 0;
  const res = simplifyRenderMeshSync({ positions, uvs, normals, indices: topo.indices, targetTriangles: target, lock, flags: [], uvWeight: 0.2, normalWeight: 0.5 });
  // Back to geometry vertices, keeping each kept vertex's attributes.
  const keep: number[] = [];
  const map = new Map<number, number>();
  const vert = (r: number): number => {
    const v = topo.geo[r]!;
    let i = map.get(v);
    if (i === undefined) {
      i = keep.length;
      keep.push(v);
      map.set(v, i);
    }
    return i;
  };
  const tris: number[] = [];
  const panel: number[] = [];
  const idx = res.indices;
  for (let t = 0; t < idx.length; t += 3) {
    const a = vert(idx[t]!);
    const b = vert(idx[t + 1]!);
    const c = vert(idx[t + 2]!);
    if (a === b || b === c || a === c) continue;
    tris.push(a, b, c);
    panel.push(topo.panel[idx[t]!]!);
  }
  const record = { keep: Int32Array.from(keep), tris: Uint32Array.from(tris), panel: Int32Array.from(panel) };
  return { mesh: replayDecimation(m, record), record };
}

export interface Unwrapped {
  /** UV per render vertex (v up), in the unit square. */
  uvs: Float64Array;
  /** Geometry vertex per render vertex. */
  geo: number[];
  /** Triangles in render vertices. */
  indices: Uint32Array;
  /** UV units per metre (one density for every piece). */
  density: number;
  pieces: number;
}

/** Unwrap every panel piece (LSCM from its planar projection) and pack them at one density. */
export function unwrap(m: WorkMesh): Unwrapped {
  const topo = renderTopology(m);
  const init = projectUvs(m, topo);
  const n = topo.geo.length;
  // Pieces: connected render-vertex components (a panel can have several, e.g. both soles).
  const parent = new Int32Array(n).map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const I = topo.indices;
  for (let t = 0; t < I.length; t += 3) {
    const a = find(I[t]!);
    for (let k = 1; k < 3; k++) {
      const b = find(I[t + k]!);
      if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
    }
  }
  const pieceOf = new Map<number, number>();
  const pieceVerts: number[][] = [];
  for (let r = 0; r < n; r++) {
    const root = find(r);
    let p = pieceOf.get(root);
    if (p === undefined) {
      p = pieceVerts.length;
      pieceOf.set(root, p);
      pieceVerts.push([]);
    }
    pieceVerts[p]!.push(r);
  }
  const pieceTris: number[][] = pieceVerts.map(() => []);
  for (let t = 0; t < I.length; t += 3) pieceTris[pieceOf.get(find(I[t]!))!]!.push(I[t]!, I[t + 1]!, I[t + 2]!);
  const uvs = new Float64Array(n * 2);
  const pieces: Float64Array[] = [];
  pieceVerts.forEach((verts, p) => {
    const local = new Map<number, number>();
    verts.forEach((r, i) => local.set(r, i));
    const P = new Float64Array(verts.length * 3);
    const guess = new Float64Array(verts.length * 2);
    verts.forEach((r, i) => {
      const q = get3(m.pos, topo.geo[r]!);
      P.set(q, i * 3);
      guess[i * 2] = init[r * 2]!;
      guess[i * 2 + 1] = init[r * 2 + 1]!;
    });
    const tris = Uint32Array.from(pieceTris[p]!.map((r) => local.get(r)!));
    let area = 0;
    for (let t = 0; t < tris.length; t += 3) {
      const a = get3(P, tris[t]!);
      area += 0.5 * Math.sqrt(dot(cross(sub(get3(P, tris[t + 1]!), a), sub(get3(P, tris[t + 2]!), a)), cross(sub(get3(P, tris[t + 1]!), a), sub(get3(P, tris[t + 2]!), a))));
    }
    const uv = lscm(P, tris, guess);
    normalisePiece(uv, tris, area);
    pieces.push(uv);
    verts.forEach((r, i) => {
      uvs[r * 2] = uv[i * 2]!;
      uvs[r * 2 + 1] = uv[i * 2 + 1]!;
    });
  });
  const density = packPieces(pieces);
  pieceVerts.forEach((verts, p) => {
    const uv = pieces[p]!;
    verts.forEach((r, i) => {
      uvs[r * 2] = uv[i * 2]!;
      uvs[r * 2 + 1] = uv[i * 2 + 1]!;
    });
  });
  return { uvs, geo: topo.geo, indices: I, density, pieces: pieces.length };
}

/** The mesh as the garment importer reads it: positions, UVs, and faces as quads with the last vertex repeated. */
export function toRawGarment(m: WorkMesh, u: Unwrapped): RawGarmentMesh {
  const positions = Float32Array.from(m.pos);
  const uvs = Float32Array.from(u.uvs);
  const T = u.indices.length / 3;
  const faceVerts = new Uint32Array(T * 4);
  const faceUvs = new Uint32Array(T * 4);
  for (let t = 0; t < T; t++) {
    for (let k = 0; k < 3; k++) {
      faceVerts[t * 4 + k] = u.geo[u.indices[t * 3 + k]!]!;
      faceUvs[t * 4 + k] = u.indices[t * 3 + k]!;
    }
    faceVerts[t * 4 + 3] = faceVerts[t * 4 + 2]!;
    faceUvs[t * 4 + 3] = faceUvs[t * 4 + 2]!;
  }
  return { positions, uvs, faceVerts, faceUvs, hasUvs: true };
}

/** Centre of a triangle of the working mesh. */
export function triCentre(m: WorkMesh, t: number): Vec3 {
  return scale(add(add(m.p(m.tris[t * 3]!), m.p(m.tris[t * 3 + 1]!)), m.p(m.tris[t * 3 + 2]!)), 1 / 3);
}
