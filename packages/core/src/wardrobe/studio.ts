/**
 * Garment Studio (Part 2 F18): shape brushes and kitbash tools that edit a
 * garment as it sits on the reference body, then save it as a new library
 * garment through the custom-garment import (M10), which binds, weights and
 * decimates it like any garment modelled around the body.
 *
 * Every edit keeps the cloth outside the skin: after a brush dab or a kitbash
 * step, vertices closer than `MIN_GAP` to the body are pushed out along its
 * normal.
 *
 * New parts (collars, cuffs, pockets) need their own room in the garment's
 * UVs: the first time one is added, the garment's islands are scaled into the
 * lower-left 80% of the UV square, and new parts are packed into the strips
 * that frees (`reserveUvRoom`). The garment's texture is remapped the same way
 * when it is saved.
 */
import type { CoreAssets } from '../assets';
import { computeQuadNormals } from '../mesh/normals';
import { BodySurface } from '../proxy/collision';
import type { RawGarmentMesh, ReferenceBody } from '../proxy/garment-import';
import type { ProxyAsset } from '../proxy/proxy';
import { createImage, sampleBilinear, type RgbaImage } from '../skin/image';

type Vec3 = [number, number, number];

export interface EditMesh {
  /** Geometry vertices on the reference body, metres. */
  positions: Float32Array;
  uvs: Float32Array;
  /** Four per face; a triangle repeats its last vertex. */
  faceVerts: Uint32Array;
  faceUvs: Uint32Array;
  /** True once the UVs were scaled to make room for new parts. */
  uvRoom: boolean;
  /** UV rectangles [u0, v0, u1, v1] of the parts added in the studio, by name. */
  parts: { name: string; rect: [number, number, number, number] }[];
}

/** The scale the original UVs get when room is made for new parts. */
export const UV_ROOM_SCALE = 0.8;
/** Cloth stays at least this far outside the skin after an edit (metres). */
export const MIN_GAP = 0.0015;

export function editMeshFromProxy(proxy: ProxyAsset, body: ReferenceBody): EditMesh {
  return {
    positions: proxy.fit(body.positions),
    uvs: proxy.uvs.slice(),
    faceVerts: proxy.faceVerts.slice(),
    faceUvs: proxy.faceUvs.slice(),
    uvRoom: false,
    parts: [],
  };
}

export function cloneEditMesh(m: EditMesh): EditMesh {
  return { positions: m.positions.slice(), uvs: m.uvs.slice(), faceVerts: m.faceVerts.slice(), faceUvs: m.faceUvs.slice(), uvRoom: m.uvRoom, parts: m.parts.map((p) => ({ name: p.name, rect: [...p.rect] as [number, number, number, number] })) };
}

/** Triangles (geometry vertices) of the faces. */
export function editTriangles(m: EditMesh): Uint32Array {
  const out: number[] = [];
  for (let f = 0; f < m.faceVerts.length / 4; f++) {
    const q = m.faceVerts.subarray(f * 4, f * 4 + 4);
    out.push(q[0]!, q[1]!, q[2]!);
    if (q[3] !== q[2]) out.push(q[0]!, q[2]!, q[3]!);
  }
  return Uint32Array.from(out);
}

export function vertexNormals(positions: Float32Array, tris: Uint32Array): Float32Array {
  const n = new Float32Array(positions.length);
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t]! * 3;
    const b = tris[t + 1]! * 3;
    const c = tris[t + 2]! * 3;
    const e1 = [positions[b]! - positions[a]!, positions[b + 1]! - positions[a + 1]!, positions[b + 2]! - positions[a + 2]!];
    const e2 = [positions[c]! - positions[a]!, positions[c + 1]! - positions[a + 1]!, positions[c + 2]! - positions[a + 2]!];
    const f = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
    for (const v of [a, b, c]) for (let k = 0; k < 3; k++) n[v + k]! += f[k]!;
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i]!, n[i + 1]!, n[i + 2]!) || 1;
    n[i]! /= l;
    n[i + 1]! /= l;
    n[i + 2]! /= l;
  }
  return n;
}

function neighbours(count: number, tris: Uint32Array): number[][] {
  const out: Set<number>[] = Array.from({ length: count }, () => new Set<number>());
  for (let t = 0; t < tris.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const a = tris[t + k]!;
      const b = tris[t + ((k + 1) % 3)]!;
      out[a]!.add(b);
      out[b]!.add(a);
    }
  return out.map((s) => [...s]);
}

/** The reference body as a surface to keep cloth outside of. */
export function bodySurface(body: ReferenceBody): BodySurface {
  return new BodySurface(body.positions, body.normals, body.triangles);
}

/** The visible body of a character (base-mesh vertex positions) as a surface. */
export function bodySurfaceAt(assets: CoreAssets, positions: Float32Array): BodySurface {
  const base = assets.base;
  const tris: number[] = [];
  for (const f of base.facesWhere((g) => g === 'body')) {
    const q = base.faceVerts.subarray(f * 4, f * 4 + 4);
    tris.push(q[0]!, q[1]!, q[2]!);
    if (q[3] !== q[2]) tris.push(q[0]!, q[2]!, q[3]!);
  }
  return new BodySurface(positions, computeQuadNormals(positions, base.faceVerts, base.vertexCount), Uint32Array.from(tris));
}

/**
 * A garment edited on one body, moved onto another of the same topology:
 * every vertex follows the skin under it (the closest point on `from`, the
 * same point on `to`), then is kept outside `to`. Used to save a Garment
 * Studio edit made on the current character as a garment for the reference
 * body.
 */
export function moveToBody(m: EditMesh, from: BodySurface, to: BodySurface): EditMesh {
  const out = cloneEditMesh(m);
  const P = out.positions;
  const F = from.positions;
  const T = to.positions;
  const I = from.indices;
  const p = [0, 0, 0];
  for (let v = 0; v < P.length / 3; v++) {
    p[0] = P[v * 3]!;
    p[1] = P[v * 3 + 1]!;
    p[2] = P[v * 3 + 2]!;
    const hit = from.bvh.closestPoint(p, 1);
    if (!hit) continue;
    for (let k = 0; k < 3; k++) {
      const b = I[hit.triangle * 3 + k]! * 3;
      const w = hit.bary[k]!;
      for (let c = 0; c < 3; c++) P[v * 3 + c]! += w * (T[b + c]! - F[b + c]!);
    }
  }
  keepOutside(out, to);
  return out;
}

/** Push vertices that went within MIN_GAP of the skin (or inside it) back out. Returns how many moved. */
export function keepOutside(m: EditMesh, body: BodySurface, only?: Iterable<number>): number {
  const P = m.positions;
  let moved = 0;
  const p = [0, 0, 0];
  const list = only ? [...only] : Array.from({ length: P.length / 3 }, (_, i) => i);
  for (const v of list) {
    p[0] = P[v * 3]!;
    p[1] = P[v * 3 + 1]!;
    p[2] = P[v * 3 + 2]!;
    const hit = body.closest(p, 0.05);
    if (!hit) continue;
    const d = body.signedDistance(p, hit);
    if (d >= MIN_GAP) continue;
    // Out along the body's normal at the closest point.
    const I = body.indices;
    const N = body.normals;
    const nn = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      const vi = I[hit.triangle * 3 + k]! * 3;
      for (let c = 0; c < 3; c++) nn[c]! += hit.bary[k]! * N[vi + c]!;
    }
    const l = Math.hypot(nn[0]!, nn[1]!, nn[2]!) || 1;
    for (let c = 0; c < 3; c++) P[v * 3 + c]! += ((MIN_GAP - d) * nn[c]!) / l;
    moved++;
  }
  return moved;
}

export type ShapeBrush = 'grab' | 'smooth' | 'inflate' | 'crease' | 'flatten';
export const SHAPE_BRUSHES: ShapeBrush[] = ['grab', 'smooth', 'inflate', 'crease', 'flatten'];

export interface BrushDab {
  centre: Vec3;
  radius: number;
  /** 0..1 */
  strength: number;
  /** Grab: how far the stroke moved since the last dab (metres). */
  delta?: Vec3;
  /** Mirror the dab across x = 0. */
  symmetry?: boolean;
}

/** Smooth falloff: 1 at the centre, 0 at the radius. */
const falloff = (d: number, r: number) => (d >= r ? 0 : (1 - (d / r) ** 2) ** 2);

/**
 * One dab of a shape brush. Edits `m` in place and keeps the cloth outside
 * the body; returns the vertices it moved.
 */
export function applyShapeBrush(m: EditMesh, brush: ShapeBrush, dab: BrushDab, body: BodySurface): number[] {
  const dabs = [dab];
  if (dab.symmetry && Math.abs(dab.centre[0]) > dab.radius * 0.25) {
    dabs.push({ ...dab, centre: [-dab.centre[0], dab.centre[1], dab.centre[2]], delta: dab.delta ? [-dab.delta[0], dab.delta[1], dab.delta[2]] : undefined });
  }
  const P = m.positions;
  const tris = editTriangles(m);
  const normals = vertexNormals(P, tris);
  const nb = brush === 'smooth' ? neighbours(P.length / 3, tris) : null;
  const touched = new Set<number>();
  for (const d of dabs) {
    const w = new Map<number, number>();
    for (let v = 0; v < P.length / 3; v++) {
      const dist = Math.hypot(P[v * 3]! - d.centre[0], P[v * 3 + 1]! - d.centre[1], P[v * 3 + 2]! - d.centre[2]);
      const f = falloff(dist, d.radius);
      if (f > 0) w.set(v, f * d.strength);
    }
    if (w.size === 0) continue;
    // Average position and normal under the brush (flatten, crease).
    const c: Vec3 = [0, 0, 0];
    const an: Vec3 = [0, 0, 0];
    let tw = 0;
    for (const [v, f] of w) {
      for (let k = 0; k < 3; k++) {
        c[k]! += P[v * 3 + k]! * f;
        an[k]! += normals[v * 3 + k]! * f;
      }
      tw += f;
    }
    for (let k = 0; k < 3; k++) c[k]! /= tw;
    const al = Math.hypot(...an) || 1;
    for (let k = 0; k < 3; k++) an[k]! /= al;
    const next = new Map<number, Vec3>();
    for (const [v, f] of w) {
      const p: Vec3 = [P[v * 3]!, P[v * 3 + 1]!, P[v * 3 + 2]!];
      const n: Vec3 = [normals[v * 3]!, normals[v * 3 + 1]!, normals[v * 3 + 2]!];
      let q: Vec3 = p;
      switch (brush) {
        case 'grab': {
          const dl = d.delta ?? [0, 0, 0];
          q = [p[0] + dl[0] * f, p[1] + dl[1] * f, p[2] + dl[2] * f];
          break;
        }
        case 'inflate': {
          const s = d.radius * 0.08 * f;
          q = [p[0] + n[0] * s, p[1] + n[1] * s, p[2] + n[2] * s];
          break;
        }
        case 'smooth': {
          const list = nb![v]!;
          if (list.length === 0) break;
          const avg: Vec3 = [0, 0, 0];
          for (const u of list) for (let k = 0; k < 3; k++) avg[k]! += P[u * 3 + k]! / list.length;
          const t = Math.min(1, f);
          q = [p[0] + (avg[0] - p[0]) * t, p[1] + (avg[1] - p[1]) * t, p[2] + (avg[2] - p[2]) * t];
          break;
        }
        case 'flatten': {
          const h = (p[0] - c[0]) * an[0] + (p[1] - c[1]) * an[1] + (p[2] - c[2]) * an[2];
          const t = Math.min(1, f);
          q = [p[0] - an[0] * h * t, p[1] - an[1] * h * t, p[2] - an[2] * h * t];
          break;
        }
        case 'crease': {
          // Pinch towards the dab's centre along the surface and press in: a sharp fold line.
          const toC: Vec3 = [c[0] - p[0], c[1] - p[1], c[2] - p[2]];
          const along = toC[0] * an[0] + toC[1] * an[1] + toC[2] * an[2];
          const tan: Vec3 = [toC[0] - an[0] * along, toC[1] - an[1] * along, toC[2] - an[2] * along];
          const press = d.radius * 0.05 * f;
          q = [p[0] + tan[0] * 0.25 * f - an[0] * press, p[1] + tan[1] * 0.25 * f - an[1] * press, p[2] + tan[2] * 0.25 * f - an[2] * press];
          break;
        }
      }
      next.set(v, q);
    }
    for (const [v, q] of next) {
      P[v * 3] = q[0];
      P[v * 3 + 1] = q[1];
      P[v * 3 + 2] = q[2];
      touched.add(v);
    }
  }
  keepOutside(m, body, touched);
  return [...touched];
}

/**
 * Loosen (or, with a negative amount, tighten) the whole garment: every
 * vertex moves `metres` along its normal, then stays outside the body. Used to
 * wear one garment over another made from the same pattern.
 */
export function inflateAll(m: EditMesh, metres: number, body: BodySurface): void {
  const tris = editTriangles(m);
  const n = vertexNormals(m.positions, tris);
  // Normals of an open garment can point in: orient each by the side away from the body.
  const p = [0, 0, 0];
  for (let v = 0; v < m.positions.length / 3; v++) {
    p[0] = m.positions[v * 3]!;
    p[1] = m.positions[v * 3 + 1]!;
    p[2] = m.positions[v * 3 + 2]!;
    let sign = 1;
    const hit = body.closest(p, 0.3);
    if (hit) {
      const away = [p[0] - hit.point[0], p[1] - hit.point[1], p[2] - hit.point[2]];
      if (away[0]! * n[v * 3]! + away[1]! * n[v * 3 + 1]! + away[2]! * n[v * 3 + 2]! < 0) sign = -1;
    }
    for (let k = 0; k < 3; k++) m.positions[v * 3 + k]! += n[v * 3 + k]! * metres * sign;
  }
  keepOutside(m, body);
}

// ------------------------------------------------------------------ kitbash

/** Remove unused vertices and UVs, keeping order. */
function compact(m: EditMesh): void {
  const usedV = new Int32Array(m.positions.length / 3).fill(-1);
  const usedT = new Int32Array(m.uvs.length / 2).fill(-1);
  let nv = 0;
  let nt = 0;
  for (const v of m.faceVerts) if (usedV[v]! < 0) usedV[v] = nv++;
  for (const t of m.faceUvs) if (usedT[t]! < 0) usedT[t] = nt++;
  const P = new Float32Array(nv * 3);
  const U = new Float32Array(nt * 2);
  usedV.forEach((to, from) => {
    if (to >= 0) P.set(m.positions.subarray(from * 3, from * 3 + 3), to * 3);
  });
  usedT.forEach((to, from) => {
    if (to >= 0) U.set(m.uvs.subarray(from * 2, from * 2 + 2), to * 2);
  });
  m.faceVerts = m.faceVerts.map((v) => usedV[v]!);
  m.faceUvs = m.faceUvs.map((t) => usedT[t]!);
  m.positions = P;
  m.uvs = U;
}

export interface Plane {
  point: Vec3;
  /** Unit normal: the side it points to is cut away. */
  normal: Vec3;
}

/**
 * Crop the garment at a plane (a hem, a cropped jacket, a short sleeve):
 * faces wholly beyond the plane go; the vertices of the faces that cross it
 * are moved onto it, so the new edge is straight. A plane is infinite, so a
 * sleeve's would also cut the torso, and a hem's the sleeves: `within` limits
 * the crop to the side its normal points to of one or more planes (outward of
 * the shoulder; between the shoulders).
 * Returns the faces removed.
 */
export function cropAtPlane(m: EditMesh, plane: Plane, within?: Plane | Plane[]): number {
  const sideOf = (pl: Plane, P: Float32Array, v: number) =>
    (P[v * 3]! - pl.point[0]) * pl.normal[0] + (P[v * 3 + 1]! - pl.point[1]) * pl.normal[1] + (P[v * 3 + 2]! - pl.point[2]) * pl.normal[2];
  const limits = within ? (Array.isArray(within) ? within : [within]) : [];
  const cut = (P: Float32Array, v: number) => sideOf(plane, P, v) > 0 && limits.every((w) => sideOf(w, P, v) > 0);
  const keepF: number[] = [];
  const faces = m.faceVerts.length / 4;
  for (let f = 0; f < faces; f++) {
    const q = m.faceVerts.subarray(f * 4, f * 4 + 4);
    if ([...new Set(q)].some((v) => !cut(m.positions, v))) keepF.push(f);
  }
  const removed = faces - keepF.length;
  if (removed === 0) return 0;
  const fv = new Uint32Array(keepF.length * 4);
  const fu = new Uint32Array(keepF.length * 4);
  keepF.forEach((f, i) => {
    fv.set(m.faceVerts.subarray(f * 4, f * 4 + 4), i * 4);
    fu.set(m.faceUvs.subarray(f * 4, f * 4 + 4), i * 4);
  });
  m.faceVerts = fv;
  m.faceUvs = fu;
  compact(m);
  // Snap the crossing faces' outer vertices onto the plane.
  for (let v = 0; v < m.positions.length / 3; v++) {
    if (!cut(m.positions, v)) continue;
    const s = sideOf(plane, m.positions, v);
    for (let k = 0; k < 3; k++) m.positions[v * 3 + k]! -= s * plane.normal[k]!;
  }
  return removed;
}

/** The planes that keep a crop between the shoulders (a hem that must not touch the sleeves). */
export function betweenShoulders(shoulderX: number): Plane[] {
  const x = Math.abs(shoulderX) * 0.8;
  return [
    { point: [x, 0, 0], normal: [-1, 0, 0] },
    { point: [-x, 0, 0], normal: [1, 0, 0] },
  ];
}

/** Open edge loops of the garment (geometry vertices, in order). */
export function openLoops(m: EditMesh): number[][] {
  const tris = editTriangles(m);
  const count = new Map<number, number>();
  const n = m.positions.length / 3;
  const key = (a: number, b: number) => (a < b ? a * n + b : b * n + a);
  const dirEdge = new Map<number, number>();
  for (let t = 0; t < tris.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const a = tris[t + k]!;
      const b = tris[t + ((k + 1) % 3)]!;
      count.set(key(a, b), (count.get(key(a, b)) ?? 0) + 1);
      dirEdge.set(a * n + b, 1);
    }
  // Boundary edges, oriented as the faces have them, so loops run one way.
  const next = new Map<number, number>();
  for (const [k, c] of count) {
    if (c !== 1) continue;
    const a = Math.floor(k / n);
    const b = k % n;
    if (dirEdge.has(a * n + b)) next.set(a, b);
    else next.set(b, a);
  }
  const used = new Set<number>();
  const loops: number[][] = [];
  for (const start of [...next.keys()].sort((x, y) => x - y)) {
    if (used.has(start)) continue;
    const loop: number[] = [];
    let cur: number | undefined = start;
    while (cur !== undefined && !used.has(cur)) {
      used.add(cur);
      loop.push(cur);
      cur = next.get(cur);
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

export function loopCentre(m: EditMesh, loop: readonly number[]): Vec3 {
  const c: Vec3 = [0, 0, 0];
  for (const v of loop) for (let k = 0; k < 3; k++) c[k]! += m.positions[v * 3 + k]! / loop.length;
  return c;
}

function loopLen(m: EditMesh, loop: readonly number[]): number {
  let l = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]! * 3;
    const b = loop[(i + 1) % loop.length]! * 3;
    l += Math.hypot(m.positions[b]! - m.positions[a]!, m.positions[b + 1]! - m.positions[a + 1]!, m.positions[b + 2]! - m.positions[a + 2]!);
  }
  return l;
}

/**
 * Make room in UV space for new parts: scale every existing UV into the
 * lower-left UV_ROOM_SCALE square. Done once per garment.
 */
export function reserveUvRoom(m: EditMesh): void {
  if (m.uvRoom) return;
  for (let i = 0; i < m.uvs.length; i++) m.uvs[i]! *= UV_ROOM_SCALE;
  m.uvRoom = true;
}

/** UV units per metre of the garment's own cloth (after the room was made). */
function garmentUvPerMetre(m: EditMesh): number {
  let uvA = 0;
  let a3 = 0;
  for (let f = 0; f < m.faceVerts.length / 4; f++) {
    const q = m.faceVerts.subarray(f * 4, f * 4 + 4);
    const t = m.faceUvs.subarray(f * 4, f * 4 + 4);
    for (const [i, j, k] of q[3] === q[2] ? [[0, 1, 2]] : [[0, 1, 2], [0, 2, 3]]) {
      const P = m.positions;
      const e1 = [0, 1, 2].map((c) => P[q[j!]! * 3 + c]! - P[q[i!]! * 3 + c]!);
      const e2 = [0, 1, 2].map((c) => P[q[k!]! * 3 + c]! - P[q[i!]! * 3 + c]!);
      a3 += 0.5 * Math.hypot(e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!);
      const U = m.uvs;
      uvA += 0.5 * Math.abs((U[t[j!]! * 2]! - U[t[i!]! * 2]!) * (U[t[k!]! * 2 + 1]! - U[t[i!]! * 2 + 1]!) - (U[t[k!]! * 2]! - U[t[i!]! * 2]!) * (U[t[j!]! * 2 + 1]! - U[t[i!]! * 2 + 1]!));
    }
  }
  return Math.sqrt(uvA / Math.max(1e-9, a3));
}

/**
 * A free rectangle of the given size (UV units) in the strips the room left:
 * the right strip (u > UV_ROOM_SCALE) first, then the top one. The long side
 * goes along the strip; returns the rectangle and whether it was turned. The
 * part is scaled down if it does not fit.
 */
function placeRect(m: EditMesh, w: number, h: number): { rect: [number, number, number, number]; turned: boolean; scale: number } {
  const gap = 0.006;
  const strips: { x0: number; y0: number; x1: number; y1: number; vertical: boolean }[] = [
    { x0: UV_ROOM_SCALE + gap, y0: gap, x1: 1 - gap, y1: 1 - gap, vertical: true },
    { x0: gap, y0: UV_ROOM_SCALE + gap, x1: UV_ROOM_SCALE - gap, y1: 1 - gap, vertical: false },
  ];
  const overlaps = (r: [number, number, number, number]) => m.parts.some((p) => r[0] < p.rect[2] + gap && r[2] + gap > p.rect[0] && r[1] < p.rect[3] + gap && r[3] + gap > p.rect[1]);
  for (let scale = 1; scale > 0.05; scale *= 0.8) {
    for (const s of strips) {
      const long = Math.max(w, h) * scale;
      const short = Math.min(w, h) * scale;
      const turned = s.vertical ? w > h : h > w;
      const rw = s.vertical ? short : long;
      const rh = s.vertical ? long : short;
      if (rw > s.x1 - s.x0 || rh > s.y1 - s.y0) continue;
      // Scan the strip for a free spot.
      const step = 0.01;
      for (let y = s.y0; y + rh <= s.y1 + 1e-9; y += step)
        for (let x = s.x0; x + rw <= s.x1 + 1e-9; x += step) {
          const r: [number, number, number, number] = [x, y, x + rw, y + rh];
          if (!overlaps(r)) return { rect: r, turned, scale };
        }
    }
  }
  throw new Error('no UV room left for another part');
}

/**
 * Append a grid of (cols + 1) x (rows + 1) vertices as quads. `vertexOf(i, j)`
 * returns an existing vertex index (to stitch the grid to the garment) or a
 * new position. UVs fill `rect` (turned 90 degrees if asked).
 */
function appendGrid(
  m: EditMesh,
  cols: number,
  rows: number,
  vertexOf: (i: number, j: number) => number | Vec3,
  rect: [number, number, number, number],
  turned: boolean,
  closed: boolean,
): void {
  const v0 = m.positions.length / 3;
  const t0 = m.uvs.length / 2;
  const newPos: number[] = [];
  const idx: number[][] = [];
  const ringCols = closed ? cols : cols + 1;
  for (let j = 0; j <= rows; j++) {
    idx.push([]);
    for (let i = 0; i < ringCols; i++) {
      const r = vertexOf(i, j);
      if (typeof r === 'number') idx[j]!.push(r);
      else {
        idx[j]!.push(v0 + newPos.length / 3);
        newPos.push(r[0], r[1], r[2]);
      }
    }
  }
  const uv: number[] = [];
  for (let j = 0; j <= rows; j++)
    for (let i = 0; i <= cols; i++) {
      const a = i / cols;
      const b = j / rows;
      const [s, t] = turned ? [b, a] : [a, b];
      uv.push(rect[0] + s * (rect[2] - rect[0]), rect[1] + t * (rect[3] - rect[1]));
    }
  const fv: number[] = [];
  const fu: number[] = [];
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const i1 = closed ? (i + 1) % cols : i + 1;
      fv.push(idx[j]![i]!, idx[j]![i1]!, idx[j + 1]![i1]!, idx[j + 1]![i]!);
      const u = (jj: number, ii: number) => t0 + jj * (cols + 1) + ii;
      fu.push(u(j, i), u(j, i + 1), u(j + 1, i + 1), u(j + 1, i));
    }
  const P = new Float32Array(m.positions.length + newPos.length);
  P.set(m.positions);
  P.set(newPos, m.positions.length);
  const U = new Float32Array(m.uvs.length + uv.length);
  U.set(m.uvs);
  U.set(uv, m.uvs.length);
  m.positions = P;
  m.uvs = U;
  m.faceVerts = Uint32Array.from([...m.faceVerts, ...fv]);
  m.faceUvs = Uint32Array.from([...m.faceUvs, ...fu]);
}

export type ExtrudeProfile = 'band' | 'roll' | 'collar' | 'cuff';

export interface ExtrudeOptions {
  /** How far the new band reaches (metres). */
  height: number;
  /** How far it stands off the garment at its far edge (metres). */
  out: number;
  profile: ExtrudeProfile;
  rows?: number;
  name?: string;
}

/**
 * Extrude an open edge loop into a band: a standing band ('band', carrying
 * on the way the cloth goes), a roll neck ('roll', up and turned down), a shirt or shearling collar
 * ('collar', up then folded down and out over the shoulders), or a turned-back
 * cuff ('cuff', back over the sleeve). The band gets its own UV island.
 */
export function extrudeLoop(m: EditMesh, loop: readonly number[], o: ExtrudeOptions, body: BodySurface): void {
  reserveUvRoom(m);
  const rows = o.rows ?? (o.profile === 'collar' || o.profile === 'roll' ? 4 : 2);
  const tris = editTriangles(m);
  const normals = vertexNormals(m.positions, tris);
  const P = m.positions;
  // Direction out of the boundary along the cloth: away from each loop vertex's inner neighbours.
  const inner = new Map<number, Vec3>();
  const onLoop = new Set(loop);
  for (let t = 0; t < tris.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const a = tris[t + k]!;
      if (!onLoop.has(a)) continue;
      for (const b of [tris[t + ((k + 1) % 3)]!, tris[t + ((k + 2) % 3)]!]) {
        if (onLoop.has(b)) continue;
        const d = inner.get(a) ?? [0, 0, 0];
        for (let c = 0; c < 3; c++) d[c]! += P[a * 3 + c]! - P[b * 3 + c]!;
        inner.set(a, d);
      }
    }
  const centre = loopCentre(m, loop);
  const frames = loop.map((v) => {
    const p: Vec3 = [P[v * 3]!, P[v * 3 + 1]!, P[v * 3 + 2]!];
    let dir = inner.get(v) ?? [p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]];
    let n: Vec3 = [normals[v * 3]!, normals[v * 3 + 1]!, normals[v * 3 + 2]!];
    // The garment's normal at an edge can point any way: use the direction away from the loop's middle, across the cloth.
    const radial: Vec3 = [p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]];
    if (n[0] * radial[0] + n[1] * radial[1] + n[2] * radial[2] < 0) n = [-n[0], -n[1], -n[2]];
    const dl = Math.hypot(...dir) || 1;
    dir = [dir[0] / dl, dir[1] / dl, dir[2] / dl];
    return { p, dir, n };
  });
  const cols = loop.length;
  const h = o.height;
  const at = (i: number, j: number): number | Vec3 => {
    if (j === 0) return loop[i % cols]!;
    const { p, dir, n } = frames[i % cols]!;
    const t = j / rows;
    let a: number; // along the cloth direction
    let b: number; // out from the body
    if (o.profile === 'band') {
      a = h * t;
      b = o.out * t;
    } else if (o.profile === 'roll') {
      // Roll neck: up for most of the height, then turned down over itself.
      const up = Math.min(t, 0.6) / 0.6;
      const fold = Math.max(0, t - 0.6) / 0.4;
      a = h * 0.6 * up - h * 0.4 * fold * 0.9;
      b = o.out * (0.5 * up + 0.5 * fold) + 0.006 * fold;
    } else if (o.profile === 'cuff') {
      // Back over the sleeve: against the cloth direction, standing off it.
      a = -h * t;
      b = o.out * (0.6 + 0.4 * t);
    } else {
      // Collar: up for the first third, then folded down and out.
      const up = Math.min(t, 0.34) / 0.34;
      const fold = Math.max(0, t - 0.34) / 0.66;
      a = h * 0.34 * up - h * 0.66 * fold * 0.85;
      b = o.out * (0.25 * up + 0.75 * fold) + 0.004 * fold;
    }
    return [p[0] + dir[0] * a + n[0] * b, p[1] + dir[1] * a + n[1] * b, p[2] + dir[2] * a + n[2] * b];
  };
  const upm = garmentUvPerMetre(m);
  const place = placeRect(m, loopLen(m, loop) * upm, h * (o.profile === 'collar' ? 1 : 1) * upm);
  m.parts.push({ name: o.name ?? o.profile, rect: place.rect });
  const before = m.positions.length / 3;
  appendGrid(m, cols, rows, at, place.rect, place.turned, true);
  const added = Array.from({ length: m.positions.length / 3 - before }, (_, i) => before + i);
  keepOutside(m, body, added);
}

/**
 * Roll a sleeve or a trouser leg: crop at the plane, then turn the new edge
 * back as a cuff of `height` (metres).
 */
export function rollAtPlane(m: EditMesh, plane: Plane, height: number, body: BodySurface, within?: Plane | Plane[]): void {
  cropAtPlane(m, plane, within);
  // The loop the crop made: the open loop whose middle is nearest the plane's point.
  const loops = openLoops(m);
  let best: number[] | null = null;
  let bd = Infinity;
  for (const l of loops) {
    const c = loopCentre(m, l);
    const d = Math.hypot(c[0] - plane.point[0], c[1] - plane.point[1], c[2] - plane.point[2]);
    if (d < bd) [bd, best] = [d, l];
  }
  if (best) extrudeLoop(m, best, { height, out: 0.005, profile: 'cuff', name: 'cuff' }, body);
}

/**
 * Add a patch pocket of w x h metres centred at `centre` (on the garment), its
 * top edge towards `up`: a grid laid on the cloth, standing 3 mm proud, with
 * its own UV island.
 */
export function addPatch(m: EditMesh, centre: Vec3, up: Vec3, w: number, h: number, body: BodySurface, name = 'pocket'): void {
  reserveUvRoom(m);
  const tris = editTriangles(m);
  const normals = vertexNormals(m.positions, tris);
  // Surface normal near the centre: nearest vertices' normals.
  const P = m.positions;
  const n: Vec3 = [0, 0, 0];
  for (let v = 0; v < P.length / 3; v++) {
    const d = Math.hypot(P[v * 3]! - centre[0], P[v * 3 + 1]! - centre[1], P[v * 3 + 2]! - centre[2]);
    const f = falloff(d, Math.max(w, h));
    for (let k = 0; k < 3; k++) n[k]! += normals[v * 3 + k]! * f;
  }
  let nl = Math.hypot(...n);
  if (nl < 1e-9) {
    n[0] = 0;
    n[1] = 0;
    n[2] = 1;
    nl = 1;
  }
  for (let k = 0; k < 3; k++) n[k]! /= nl;
  const along = up[0] * n[0] + up[1] * n[1] + up[2] * n[2];
  let ay: Vec3 = [up[0] - n[0] * along, up[1] - n[1] * along, up[2] - n[2] * along];
  const yl = Math.hypot(...ay) || 1;
  ay = [ay[0] / yl, ay[1] / yl, ay[2] / yl];
  const ax: Vec3 = [ay[1] * n[2] - ay[2] * n[1], ay[2] * n[0] - ay[0] * n[2], ay[0] * n[1] - ay[1] * n[0]];
  const cols = 4;
  const rows = 4;
  // Project each grid point onto the garment (closest vertex position along the normal), then 3 mm out.
  const cloth = new BodySurface(P, normals, tris);
  const at = (i: number, j: number): Vec3 => {
    const sx = (i / cols - 0.5) * w;
    const sy = (j / rows - 0.5) * h;
    const q: Vec3 = [centre[0] + ax[0] * sx + ay[0] * sy, centre[1] + ax[1] * sx + ay[1] * sy, centre[2] + ax[2] * sx + ay[2] * sy];
    const hit = cloth.bvh.closestPoint(q, 0.1);
    const base = hit ? hit.point : q;
    return [base[0] + n[0] * 0.003, base[1] + n[1] * 0.003, base[2] + n[2] * 0.003];
  };
  const upm = garmentUvPerMetre(m);
  const place = placeRect(m, w * upm, h * upm);
  m.parts.push({ name, rect: place.rect });
  const before = m.positions.length / 3;
  appendGrid(m, cols, rows, at, place.rect, place.turned, false);
  keepOutside(m, body, Array.from({ length: m.positions.length / 3 - before }, (_, i) => before + i));
}

/** The edited garment as a mesh for the custom-garment import. */
export function editMeshToRaw(m: EditMesh): RawGarmentMesh {
  return { positions: m.positions.slice(), uvs: m.uvs.slice(), faceVerts: m.faceVerts.slice(), faceUvs: m.faceUvs.slice(), hasUvs: true };
}

/**
 * The garment's texture in the edited UV layout: the original scaled into the
 * room's square (if room was made), and each new part filled with the
 * original's mean colour.
 */
export function remapTexture(original: RgbaImage | null, m: EditMesh, size = 1024): RgbaImage {
  const out = createImage(size, size, [200, 200, 200, 255]);
  if (!original) return out;
  const mean = [0, 0, 0, 0];
  let n = 0;
  for (let i = 0; i < original.width * original.height; i++) {
    if (original.data[i * 4 + 3]! < 128) continue;
    for (let c = 0; c < 4; c++) mean[c]! += original.data[i * 4 + c]!;
    n++;
  }
  for (let c = 0; c < 4; c++) mean[c] = n ? mean[c]! / n : 200;
  const s = m.uvRoom ? UV_ROOM_SCALE : 1;
  const tmp = [0, 0, 0, 0];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const v = 1 - (y + 0.5) / size;
      const i = (y * size + x) * 4;
      if (u <= s && v <= s) {
        sampleBilinear(original, u / s, v / s, tmp);
        for (let c = 0; c < 4; c++) out.data[i + c] = Math.round(tmp[c]!);
      } else for (let c = 0; c < 3; c++) out.data[i + c] = Math.round(mean[c]!);
    }
  return out;
}

