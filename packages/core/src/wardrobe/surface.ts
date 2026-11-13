/**
 * A garment's surface in its own UV space (Part 2 F18): UV islands, seams and
 * hems, and a raster that says, for every texel of the garment texture, which
 * triangle and island it lies on and where that is on the body.
 *
 * Positions are the garment fitted to the reference body (the default
 * character), so everything drawn from them (texel density, folds, seams) is
 * the same whatever shape the character has: like skin paint, garment
 * texture never moves when a slider does.
 */
import type { RenderTopology } from '../scene/render-mesh';

export interface GarmentSurface {
  /** Per render vertex, v up (OBJ / MakeHuman convention). */
  uvs: Float32Array;
  /** Triangles in render vertices. */
  indices: Uint32Array;
  /** Render vertex -> geometry vertex. */
  sourceVertex: Uint32Array;
  /** Per geometry vertex, the garment on the reference body (metres). */
  positions: Float32Array;
}

export function surfaceFromTopology(topo: RenderTopology, positions: Float32Array): GarmentSurface {
  return { uvs: topo.uvs, indices: topo.indices, sourceVertex: topo.sourceVertex, positions };
}

export interface UvIslands {
  /** Island per triangle. */
  ofTriangle: Int32Array;
  count: number;
  /** Per island: UV units per metre, sqrt(UV area / surface area). */
  uvPerMetre: Float64Array;
  uvArea: Float64Array;
  /** Surface area, m^2. */
  area: Float64Array;
  /** Per island: UV bounding box [u0, v0, u1, v1]. */
  bounds: Float64Array;
}

function find(parent: Int32Array, i: number): number {
  while (parent[i] !== i) {
    parent[i] = parent[parent[i]!]!;
    i = parent[i]!;
  }
  return i;
}

/** UV islands: triangles that share a render vertex (a UV coordinate) are in one island. */
export function uvIslands(s: GarmentSurface): UvIslands {
  const T = s.indices.length / 3;
  const parent = new Int32Array(T).map((_, i) => i);
  const first = new Int32Array(s.uvs.length / 2).fill(-1);
  for (let t = 0; t < T; t++)
    for (let k = 0; k < 3; k++) {
      const v = s.indices[t * 3 + k]!;
      if (first[v]! < 0) first[v] = t;
      else {
        const a = find(parent, t);
        const b = find(parent, first[v]!);
        if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
      }
    }
  const id = new Map<number, number>();
  const ofTriangle = new Int32Array(T);
  for (let t = 0; t < T; t++) {
    const r = find(parent, t);
    let i = id.get(r);
    if (i === undefined) id.set(r, (i = id.size));
    ofTriangle[t] = i;
  }
  const count = id.size;
  const uvArea = new Float64Array(count);
  const area = new Float64Array(count);
  const bounds = new Float64Array(count * 4);
  for (let i = 0; i < count; i++) bounds.set([Infinity, Infinity, -Infinity, -Infinity], i * 4);
  for (let t = 0; t < T; t++) {
    const isl = ofTriangle[t]!;
    const [a, b, c] = [s.indices[t * 3]!, s.indices[t * 3 + 1]!, s.indices[t * 3 + 2]!];
    area[isl]! += triangleArea3(s, a, b, c);
    uvArea[isl]! += Math.abs(uvCross(s.uvs, a, b, c)) / 2;
    for (const v of [a, b, c]) {
      const u = s.uvs[v * 2]!;
      const w = s.uvs[v * 2 + 1]!;
      bounds[isl * 4] = Math.min(bounds[isl * 4]!, u);
      bounds[isl * 4 + 1] = Math.min(bounds[isl * 4 + 1]!, w);
      bounds[isl * 4 + 2] = Math.max(bounds[isl * 4 + 2]!, u);
      bounds[isl * 4 + 3] = Math.max(bounds[isl * 4 + 3]!, w);
    }
  }
  // Islands with no area (degenerate UVs) borrow the garment's overall density.
  const total = Math.sqrt(uvArea.reduce((x, y) => x + y, 0) / Math.max(1e-12, area.reduce((x, y) => x + y, 0)));
  const uvPerMetre = new Float64Array(count);
  for (let i = 0; i < count; i++) uvPerMetre[i] = area[i]! > 1e-8 && uvArea[i]! > 1e-10 ? Math.sqrt(uvArea[i]! / area[i]!) : total;
  return { ofTriangle, count, uvPerMetre, uvArea, area, bounds };
}

function uvCross(uv: Float32Array, a: number, b: number, c: number): number {
  return (uv[b * 2]! - uv[a * 2]!) * (uv[c * 2 + 1]! - uv[a * 2 + 1]!) - (uv[c * 2]! - uv[a * 2]!) * (uv[b * 2 + 1]! - uv[a * 2 + 1]!);
}

function triangleArea3(s: GarmentSurface, a: number, b: number, c: number): number {
  const P = s.positions;
  const A = s.sourceVertex[a]! * 3;
  const B = s.sourceVertex[b]! * 3;
  const C = s.sourceVertex[c]! * 3;
  const e1 = [P[B]! - P[A]!, P[B + 1]! - P[A + 1]!, P[B + 2]! - P[A + 2]!];
  const e2 = [P[C]! - P[A]!, P[C + 1]! - P[A + 1]!, P[C + 2]! - P[A + 2]!];
  return 0.5 * Math.hypot(e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!);
}

/**
 * One side of a seam or a hem, as a segment in UV space. `inward` is the unit
 * UV direction into the cloth on this side. `dir3` is the edge's unit
 * direction on the body, used to space stitches evenly along a whole seam.
 */
export interface SeamSegment {
  kind: 'seam' | 'hem';
  island: number;
  a: [number, number];
  b: [number, number];
  inward: [number, number];
  dir3: [number, number, number];
  /** Edge length on the body, metres. */
  length: number;
}

/**
 * Seams and hems from the mesh. An edge used by two triangles whose UVs
 * differ across it is a seam: two pieces of cloth sewn together (a UV island
 * border inside the garment). An edge used by one triangle is a hem or an
 * opening (collar, cuffs, bottom edge).
 */
export function garmentSeams(s: GarmentSurface, islands: UvIslands): SeamSegment[] {
  const uses = new Map<number, { t: number; ra: number; rb: number }[]>();
  const T = s.indices.length / 3;
  const nGeo = s.positions.length / 3;
  for (let t = 0; t < T; t++)
    for (let k = 0; k < 3; k++) {
      const ra = s.indices[t * 3 + k]!;
      const rb = s.indices[t * 3 + ((k + 1) % 3)]!;
      const ga = s.sourceVertex[ra]!;
      const gb = s.sourceVertex[rb]!;
      if (ga === gb) continue;
      const key = ga < gb ? ga * nGeo + gb : gb * nGeo + ga;
      const list = uses.get(key);
      const entry = ga < gb ? { t, ra, rb } : { t, ra: rb, rb: ra };
      if (list) list.push(entry);
      else uses.set(key, [entry]);
    }
  const out: SeamSegment[] = [];
  const P = s.positions;
  for (const list of uses.values()) {
    let kind: 'seam' | 'hem';
    if (list.length === 1) kind = 'hem';
    else {
      const same = list.every((e) => e.ra === list[0]!.ra && e.rb === list[0]!.rb);
      if (same) continue; // inside one piece of cloth
      kind = 'seam';
    }
    for (const e of list) {
      const a: [number, number] = [s.uvs[e.ra * 2]!, s.uvs[e.ra * 2 + 1]!];
      const b: [number, number] = [s.uvs[e.rb * 2]!, s.uvs[e.rb * 2 + 1]!];
      const du = b[0] - a[0];
      const dv = b[1] - a[1];
      const len = Math.hypot(du, dv);
      if (len < 1e-9) continue;
      // The triangle's third vertex says which side the cloth is on.
      let third = -1;
      for (let k = 0; k < 3; k++) {
        const r = s.indices[e.t * 3 + k]!;
        if (r !== e.ra && r !== e.rb) third = r;
      }
      if (third < 0) continue;
      let nu = -dv / len;
      let nv = du / len;
      const cu = s.uvs[third * 2]! - a[0];
      const cv = s.uvs[third * 2 + 1]! - a[1];
      if (nu * cu + nv * cv < 0) {
        nu = -nu;
        nv = -nv;
      }
      const ga = s.sourceVertex[e.ra]! * 3;
      const gb = s.sourceVertex[e.rb]! * 3;
      const d3: [number, number, number] = [P[gb]! - P[ga]!, P[gb + 1]! - P[ga + 1]!, P[gb + 2]! - P[ga + 2]!];
      const l3 = Math.hypot(...d3) || 1;
      out.push({ kind, island: islands.ofTriangle[e.t]!, a, b, inward: [nu, nv], dir3: [d3[0] / l3, d3[1] / l3, d3[2] / l3], length: l3 });
    }
  }
  return out;
}

/** Which triangle each texel of a size x size garment texture lies on, and where. */
export interface SurfaceRaster {
  size: number;
  /** Triangle per texel, -1 where no cloth. */
  triangle: Int32Array;
  /** Island per texel, -1 where no cloth. */
  island: Int32Array;
  /** Body position per texel (reference body), metres. */
  position: Float32Array;
  /** Surface normal per texel (unit). */
  normal: Float32Array;
  /** Texels inside a triangle (1) or filled in a gutter from a neighbour (2). */
  coverage: Uint8Array;
}

/**
 * Rasterise the garment's triangles into its texture (row 0 = v 1, texel
 * centres), then grow every island a few texels into the gutter so bilinear
 * filtering and mips never pull in background at an island's edge.
 */
export function rasterSurface(s: GarmentSurface, islands: UvIslands, size: number, gutter = 4): SurfaceRaster {
  const n = size * size;
  const triangle = new Int32Array(n).fill(-1);
  const island = new Int32Array(n).fill(-1);
  const position = new Float32Array(n * 3);
  const normal = new Float32Array(n * 3);
  const coverage = new Uint8Array(n);
  const P = s.positions;
  const T = s.indices.length / 3;
  for (let t = 0; t < T; t++) {
    const r = [s.indices[t * 3]!, s.indices[t * 3 + 1]!, s.indices[t * 3 + 2]!];
    const x = r.map((v) => s.uvs[v * 2]! * size - 0.5);
    const y = r.map((v) => (1 - s.uvs[v * 2 + 1]!) * size - 0.5);
    const det = (x[1]! - x[0]!) * (y[2]! - y[0]!) - (x[2]! - x[0]!) * (y[1]! - y[0]!);
    if (Math.abs(det) < 1e-12) continue;
    const g = r.map((v) => s.sourceVertex[v]! * 3);
    const e1 = [0, 1, 2].map((k) => P[g[1]! + k]! - P[g[0]! + k]!);
    const e2 = [0, 1, 2].map((k) => P[g[2]! + k]! - P[g[0]! + k]!);
    let fn = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
    const fl = Math.hypot(fn[0]!, fn[1]!, fn[2]!) || 1;
    fn = fn.map((c) => c / fl);
    const x0 = Math.max(0, Math.floor(Math.min(...x)));
    const x1 = Math.min(size - 1, Math.ceil(Math.max(...x)));
    const y0 = Math.max(0, Math.floor(Math.min(...y)));
    const y1 = Math.min(size - 1, Math.ceil(Math.max(...y)));
    const isl = islands.ofTriangle[t]!;
    for (let py = y0; py <= y1; py++)
      for (let px = x0; px <= x1; px++) {
        const w1 = ((px - x[0]!) * (y[2]! - y[0]!) - (x[2]! - x[0]!) * (py - y[0]!)) / det;
        const w2 = ((x[1]! - x[0]!) * (py - y[0]!) - (px - x[0]!) * (y[1]! - y[0]!)) / det;
        const w0 = 1 - w1 - w2;
        if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
        const i = py * size + px;
        triangle[i] = t;
        island[i] = isl;
        coverage[i] = 1;
        for (let k = 0; k < 3; k++) {
          position[i * 3 + k] = P[g[0]! + k]! * w0 + P[g[1]! + k]! * w1 + P[g[2]! + k]! * w2;
          normal[i * 3 + k] = fn[k]!;
        }
      }
  }
  // Gutter: copy the nearest covered neighbour outwards, a ring at a time.
  for (let pass = 0; pass < gutter; pass++) {
    const add: number[] = [];
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        if (coverage[i]) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]] as const) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
          const j = yy * size + xx;
          if (coverage[j]) {
            add.push(i, j);
            break;
          }
        }
      }
    for (let k = 0; k < add.length; k += 2) {
      const i = add[k]!;
      const j = add[k + 1]!;
      triangle[i] = triangle[j]!;
      island[i] = island[j]!;
      coverage[i] = 2;
      for (let c = 0; c < 3; c++) {
        position[i * 3 + c] = position[j * 3 + c]!;
        normal[i * 3 + c] = normal[j * 3 + c]!;
      }
    }
  }
  return { size, triangle, island, position, normal, coverage };
}
