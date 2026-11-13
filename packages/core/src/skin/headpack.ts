/**
 * Head UV repack (PRD Part 2 F19, M14). Part 1 packed the four head islands
 * into the head texture at one uniform scale (D-034), which left about 40% of
 * the texture empty and gave the face no more texels than the back of the
 * head. Here the big face/scalp/neck island is re-flattened to fill a
 * rectangle with the face enlarged, and the three small islands (mouth
 * interior, eye sockets) go in a strip below it:
 *
 *  - The big island is turned so the face is upright, then flattened by
 *    as-rigid-as-possible (ARAP) iterations whose target is hm08's own UV
 *    shape scaled per triangle: `faceScale` times on the face, 1 elsewhere,
 *    blended over a few centimetres. Its outer boundary slides along the
 *    rectangle's sides (four boundary vertices pinned to its corners), so the
 *    island fills it. The eye and mouth holes are filled with a fan while
 *    solving, so their rims keep their shape.
 *  - The small islands keep their hm08 shape at one uniform scale, packed
 *    into the strip as large as they fit.
 *
 * A layout is solved for each PS2 body mesh on its own triangles (a coarse
 * triangle would otherwise span a bend of a finer map and turn over), and the
 * head texture is drawn from the same triangles, so the mapping is exact. The
 * layouts depend only on the shipped meshes and take a few seconds each, so
 * `pnpm build:headlayout` stores them in `skin/head/<mesh>.json`.
 */
import type { BaseMesh } from '../mesh/basemesh';
import { faceFeatures, type FaceFeatures } from './features';
import { createImage, dilateRgb, sampleBilinear, type RgbaImage } from './image';
import { rasterTriangle, type SkinLayout } from './layout';

export interface HeadLayoutOptions {
  /** How much larger the face is drawn than the rest of the head, before fitting (target scale ratio). */
  faceScale: number;
  /** Height of the strip for the small islands, as a fraction of the texture. */
  strip: number;
  /** Gutter between islands and at the borders, as a fraction of the texture (8 px at 1024). */
  padding: number;
  /** How much more the face resists distortion than the rest of the head (ARAP energy weight). */
  faceStiffness: number;
  /** ARAP iterations. */
  iterations: number;
}

export const HEAD_LAYOUT_DEFAULTS: HeadLayoutOptions = { faceScale: 3, strip: 0.115, padding: 8 / 1024, faceStiffness: 1, iterations: 40 };

export interface HeadTriangle {
  /** Corner indices into the mesh's UVs (render vertices of a PS2 body mesh). */
  corners: [number, number, number];
  /** hm08 vertices of the corners. */
  verts: [number, number, number];
  island: number;
}

/** The head part of a body mesh. */
export interface HeadMesh {
  /** hm08 UV per corner (u, v pairs; corners off the head are ignored). */
  uvs: ArrayLike<number>;
  triangles: HeadTriangle[];
}

/** A PS2 body mesh: render corners are hm08 corners. */
export interface HeadSourceMesh {
  sourceVertex: ArrayLike<number>;
  uvs: ArrayLike<number>;
  indices: ArrayLike<number>;
}

export interface HeadLayout {
  mesh: HeadMesh;
  /** Head UV per corner (u, v; NaN for corners off the head). */
  uv: Float32Array;
  /** Head-texture units per hm08 UV unit around each corner (0 off the head). */
  density: Float32Array;
  /** Head island ids; the first is the big face/scalp/neck island. */
  islands: number[];
  /** Face weight (0..1) per head triangle (the face zone on the neutral mesh). */
  faceWeight: Float32Array;
  options: HeadLayoutOptions;
}

/** A stored layout (`skin/head/<mesh>.json`, built by `pnpm build:headlayout`). */
export interface HeadLayoutFile {
  format: 'ps2cc.headlayout/1';
  mesh: string;
  options: HeadLayoutOptions;
  /** Corner count of the mesh it was built for. */
  cornerCount: number;
  /** Head corners and their head UVs (u, v pairs). */
  indices: number[];
  uv: number[];
}

export const headLayoutPath = (mesh: string): string => `skin/head/${mesh}.json`;

/** The head triangles of a PS2 body mesh, by the UV island of their corners. */
export function headMeshOf(layout: SkinLayout, mesh: HeadSourceMesh): HeadMesh {
  const triangles: HeadTriangle[] = [];
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const corners = [mesh.indices[t]!, mesh.indices[t + 1]!, mesh.indices[t + 2]!] as [number, number, number];
    const islands = corners.map((c) => layout.islandsOfCorner(mesh.sourceVertex[c]!, mesh.uvs[c * 2]!, mesh.uvs[c * 2 + 1]!));
    const island = islands[0]!.find((i) => islands.every((l) => l.includes(i)));
    if (island === undefined || layout.islands[island]!.kind !== 'head') continue;
    triangles.push({ corners, verts: corners.map((c) => mesh.sourceVertex[c]!) as [number, number, number], island });
  }
  return { uvs: mesh.uvs, triangles };
}

/**
 * How much a point belongs to the face (1 inside, 0 outside, smooth between):
 * an ellipse in front of the ears from the chin to the upper forehead and
 * cheek to cheek, measured on the neutral mesh from the eye and mouth
 * openings.
 */
export function faceZone(f: FaceFeatures): (p: ArrayLike<number>) => number {
  const eyeY = (f.eyes[0].centre[1] + f.eyes[1].centre[1]) / 2;
  const em = eyeY - f.mouth.centre[1];
  const top = eyeY + FACE_TOP * em;
  const bottom = f.mouth.centre[1] - FACE_BOTTOM * em;
  const cy = (top + bottom) / 2;
  const ry = (top - bottom) / 2;
  const rx = FACE_HALF_WIDTH * f.eyeSpacing;
  const zFront = f.noseTip[2] - 0.075;
  const smooth = (e0: number, e1: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  return (p) => {
    const e = (p[0]! / rx) ** 2 + ((p[1]! - cy) / ry) ** 2;
    return (1 - smooth(1, FACE_FALLOFF, e)) * smooth(zFront - 0.02, zFront, p[2]!);
  };
}

/** The face: from FACE_BOTTOM eye-to-mouth distances below the mouth (the chin) to FACE_TOP above the eyes (the upper forehead), FACE_HALF_WIDTH eye spacings either side (the cheeks). */
const FACE_TOP = 0.9;
const FACE_BOTTOM = 0.8;
const FACE_HALF_WIDTH = 1.05;
/** The face weight falls to 0 at this squared elliptical radius. */
const FACE_FALLOFF = 1.6;

function faceWeights(layout: SkinLayout, base: BaseMesh, mesh: HeadMesh): Float32Array {
  const zone = faceZone(faceFeatures(base, layout));
  const pos = base.positions;
  return Float32Array.from(mesh.triangles, (t) => zone([0, 1, 2].map((k) => (pos[t.verts[0] * 3 + k]! + pos[t.verts[1] * 3 + k]! + pos[t.verts[2] * 3 + k]!) / 3)));
}

function headIslands(layout: SkinLayout): number[] {
  const heads = layout.islands.filter((i) => i.kind === 'head').sort((a, b) => b.faces.length - a.faces.length);
  if (heads.length < 2) throw new Error('skin layout has too few head islands');
  return heads.map((i) => i.id);
}

/** Flatten and pack a mesh's head islands (a few seconds; the app loads the stored result instead). */
export function computeHeadLayout(layout: SkinLayout, base: BaseMesh, mesh: HeadMesh, options: Partial<HeadLayoutOptions> = {}): HeadLayout {
  const opt = { ...HEAD_LAYOUT_DEFAULTS, ...options };
  const islands = headIslands(layout);
  const [big, ...small] = islands as [number, ...number[]];
  const faceWeight = faceWeights(layout, base, mesh);
  const out = new Float32Array(mesh.uvs.length).fill(NaN);
  const pad = opt.padding;
  // The big island fills [pad, 1 - pad] x [strip + pad / 2, 1 - pad]; the small ones the strip under it.
  const rect: [number, number, number, number] = [pad, opt.strip + pad / 2, 1 - pad, 1 - pad];
  const bigTris = mesh.triangles.map((t, i) => ({ t, i })).filter((x) => x.t.island === big);
  flattenBig(
    bigTris.map((x) => x.t.corners),
    bigTris.map((x) => 1 + (opt.faceScale - 1) * faceWeight[x.i]!),
    bigTris.map((x) => 1 + (opt.faceStiffness - 1) * faceWeight[x.i]!),
    mesh.uvs,
    base.positions,
    bigTris.map((x) => x.t.verts),
    rect,
    opt.iterations,
    out,
  );
  const boxes = small.map((id) => {
    const corners = new Set<number>();
    for (const t of mesh.triangles) if (t.island === id) for (const c of t.corners) corners.add(c);
    return { box: layout.islands[id]!.box, corners };
  });
  packSmall(boxes, mesh.uvs, [pad, pad, 1 - pad, opt.strip - pad / 2], pad, out);
  return finish(mesh, out, islands, faceWeight, opt);
}

/** A layout from its stored file; computed instead when there is none or it is for another mesh. */
export function headLayoutFrom(layout: SkinLayout, base: BaseMesh, mesh: HeadMesh, file: HeadLayoutFile | null): HeadLayout {
  if (!file || file.format !== 'ps2cc.headlayout/1' || file.cornerCount !== mesh.uvs.length / 2) return computeHeadLayout(layout, base, mesh);
  const out = new Float32Array(mesh.uvs.length).fill(NaN);
  file.indices.forEach((c, i) => {
    out[c * 2] = file.uv[i * 2]!;
    out[c * 2 + 1] = file.uv[i * 2 + 1]!;
  });
  for (const t of mesh.triangles) {
    for (const c of t.corners) if (Number.isNaN(out[c * 2])) throw new Error(`${file.mesh}: the stored head layout misses corners; rebuild it (pnpm build:headlayout)`);
  }
  return finish(mesh, out, headIslands(layout), faceWeights(layout, base, mesh), file.options);
}

/** The file to store a layout in. */
export function headLayoutFile(id: string, head: HeadLayout): HeadLayoutFile {
  const indices = new Set<number>();
  for (const t of head.mesh.triangles) for (const c of t.corners) indices.add(c);
  const sorted = [...indices].sort((a, b) => a - b);
  return {
    format: 'ps2cc.headlayout/1',
    mesh: id,
    options: head.options,
    cornerCount: head.uv.length / 2,
    indices: sorted,
    uv: sorted.flatMap((c) => [round7(head.uv[c * 2]!), round7(head.uv[c * 2 + 1]!)]),
  };
}

const round7 = (x: number) => Math.round(x * 1e7) / 1e7;

function finish(mesh: HeadMesh, out: Float32Array, islands: number[], faceWeight: Float32Array, options: HeadLayoutOptions): HeadLayout {
  const buv = mesh.uvs;
  // Density per corner: area-weighted mean of sqrt(area ratio) over its triangles.
  const density = new Float32Array(buv.length / 2);
  const weight = new Float32Array(buv.length / 2);
  for (const t of mesh.triangles) {
    const a0 = Math.abs(triArea(buv, t.corners));
    const a1 = Math.abs(triArea(out, t.corners));
    if (!(a0 > 0)) continue;
    const d = Math.sqrt(a1 / a0);
    for (const c of t.corners) {
      density[c] = density[c]! + d * a0;
      weight[c] = weight[c]! + a0;
    }
  }
  for (let i = 0; i < density.length; i++) density[i] = weight[i]! > 0 ? density[i]! / weight[i]! : 0;
  return { mesh, uv: out, density, islands, faceWeight, options };
}

function triArea(uv: ArrayLike<number>, c: readonly number[]): number {
  const [a, b, d] = c as [number, number, number];
  return ((uv[b * 2]! - uv[a * 2]!) * (uv[d * 2 + 1]! - uv[a * 2 + 1]!) - (uv[d * 2]! - uv[a * 2]!) * (uv[b * 2 + 1]! - uv[a * 2 + 1]!)) / 2;
}

/**
 * ARAP flattening of the big island into `rect` with per-triangle target
 * scales; writes the new UVs into `out` (by hm08 UV index).
 */
function flattenBig(
  tris: [number, number, number][],
  scales: number[],
  stiffness: number[],
  buv: ArrayLike<number>,
  pos: ArrayLike<number>,
  verts: [number, number, number][],
  rect: [number, number, number, number],
  iterations: number,
  out: Float32Array,
): void {
  // Local vertex numbering.
  const local = new Map<number, number>();
  const ids: number[] = [];
  for (const t of tris) for (const c of t) if (!local.has(c)) local.set(c, ids.push(c) - 1);
  const n0 = ids.length;
  const T = tris.map((t) => t.map((c) => local.get(c)!) as [number, number, number]);

  // Boundary loops (edges used by one triangle), oriented like the triangles.
  const edgeCount = new Map<string, [number, number]>();
  for (const [a, b, c] of T) {
    for (const [p, q] of [[a, b], [b, c], [c, a]] as [number, number][]) {
      const k = p < q ? `${p}_${q}` : `${q}_${p}`;
      if (edgeCount.has(k)) edgeCount.delete(k);
      else edgeCount.set(k, [p, q]);
    }
  }
  const next = new Map<number, number>();
  for (const [p, q] of edgeCount.values()) next.set(p, q);
  const loops: number[][] = [];
  const seen = new Set<number>();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const loop: number[] = [];
    let v = start;
    while (!seen.has(v)) {
      seen.add(v);
      loop.push(v);
      v = next.get(v)!;
    }
    loops.push(loop);
  }

  // Turn the island so the face is upright: the UV direction in which height (y) grows, averaged over the face.
  let gx = 0;
  let gy = 0;
  tris.forEach((t, i) => {
    const [a, b, c] = t;
    const u0 = buv[a * 2]!, v0 = buv[a * 2 + 1]!;
    const e1 = [buv[b * 2]! - u0, buv[b * 2 + 1]! - v0];
    const e2 = [buv[c * 2]! - u0, buv[c * 2 + 1]! - v0];
    const det = e1[0]! * e2[1]! - e2[0]! * e1[1]!;
    if (Math.abs(det) < 1e-12) return;
    const [va, vb, vc] = verts[i]!;
    const d1 = pos[vb * 3 + 1]! - pos[va * 3 + 1]!;
    const d2 = pos[vc * 3 + 1]! - pos[va * 3 + 1]!;
    const w = scales[i]! - 1 + 1e-3;
    gx += w * ((d1 * e2[1]! - d2 * e1[1]!) / det);
    gy += w * ((e1[0]! * d2 - e2[0]! * d1) / det);
  });
  const ang = Math.PI / 2 - Math.atan2(gy, gx);
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  // One extra (virtual) vertex per hole, at its centre.
  const X = new Float64Array((n0 + loops.length) * 2);
  for (let i = 0; i < n0; i++) {
    const u = buv[ids[i]! * 2]!;
    const v = buv[ids[i]! * 2 + 1]!;
    X[i * 2] = ca * u - sa * v;
    X[i * 2 + 1] = sa * u + ca * v;
  }
  const loopArea = (l: number[]) => {
    let s = 0;
    for (let i = 0; i < l.length; i++) {
      const a = l[i]!;
      const b = l[(i + 1) % l.length]!;
      s += X[a * 2]! * X[b * 2 + 1]! - X[b * 2]! * X[a * 2 + 1]!;
    }
    return s / 2;
  };
  const outer = loops.reduce((a, b) => (Math.abs(loopArea(a)) > Math.abs(loopArea(b)) ? a : b));

  // Fill the holes (eye and mouth openings) with a fan while solving, so their rims keep their shape.
  const scaleOf = [...scales];
  const stiffOf = [...stiffness];
  const touching = new Map<number, number[]>();
  T.forEach((t, i) => t.forEach((v) => (touching.get(v) ?? touching.set(v, []).get(v)!).push(i)));
  let n = n0;
  for (const loop of loops) {
    if (loop === outer) continue;
    const c = n++;
    let mean = 0;
    let count = 0;
    for (const v of loop) {
      X[c * 2]! += X[v * 2]! / loop.length;
      X[c * 2 + 1]! += X[v * 2 + 1]! / loop.length;
      for (const t of touching.get(v) ?? []) {
        mean += scales[t]!;
        count++;
      }
    }
    for (let i = 0; i < loop.length; i++) {
      // The island is on the left of p -> q, so the hole's fan runs q -> p.
      T.push([loop[(i + 1) % loop.length]!, loop[i]!, c]);
      scaleOf.push(mean / Math.max(1, count));
      stiffOf.push(1);
    }
  }
  if (loopArea(outer) < 0) outer.reverse();

  // Corners: the boundary vertices furthest towards each corner of the bounding box.
  let lo = [Infinity, Infinity];
  let hi = [-Infinity, -Infinity];
  for (const v of outer) {
    lo = [Math.min(lo[0]!, X[v * 2]!), Math.min(lo[1]!, X[v * 2 + 1]!)];
    hi = [Math.max(hi[0]!, X[v * 2]!), Math.max(hi[1]!, X[v * 2 + 1]!)];
  }
  const nx = (v: number) => (X[v * 2]! - lo[0]!) / (hi[0]! - lo[0]!);
  const ny = (v: number) => (X[v * 2 + 1]! - lo[1]!) / (hi[1]! - lo[1]!);
  const pick = (f: (v: number) => number) => outer.reduce((a, b) => (f(b) > f(a) ? b : a));
  const cornerVerts = [pick((v) => -nx(v) - ny(v)), pick((v) => nx(v) - ny(v)), pick((v) => nx(v) + ny(v)), pick((v) => -nx(v) + ny(v))]; // BL, BR, TR, TL
  const at = cornerVerts.map((v) => outer.indexOf(v));
  const startAt = at[0]!;
  const order = at.map((i) => (i - startAt + outer.length) % outer.length);
  if (!(order[0]! < order[1]! && order[1]! < order[2]! && order[2]! < order[3]!)) throw new Error('head island corners are not in order around its boundary');
  const ring = [...outer.slice(startAt), ...outer.slice(0, startAt)];

  // Sides: 0 bottom (y fixed), 1 right (x fixed), 2 top (y fixed), 3 left (x fixed).
  const [x0, y0, x1, y1] = rect;
  const corner: [number, number][] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const fixX = new Int8Array(n);
  const fixY = new Int8Array(n);
  const sideOf = new Int8Array(n).fill(-1);
  const U = new Float64Array(n * 2);
  for (let s = 0; s < 4; s++) {
    const a = order[s]!;
    const b = s === 3 ? ring.length : order[s + 1]!;
    // Arc length along the side's boundary (initial placement).
    const lens = [0];
    for (let i = a + 1; i <= b; i++) {
      const p = ring[i - 1]!;
      const q = ring[i % ring.length]!;
      lens.push(lens[lens.length - 1]! + Math.hypot(X[q * 2]! - X[p * 2]!, X[q * 2 + 1]! - X[p * 2 + 1]!));
    }
    const total = lens[lens.length - 1]!;
    const [ax, ay] = corner[s]!;
    const [bx, by] = corner[(s + 1) % 4]!;
    for (let i = a; i < b; i++) {
      const v = ring[i]!;
      const t = lens[i - a]! / total;
      U[v * 2] = ax + (bx - ax) * t;
      U[v * 2 + 1] = ay + (by - ay) * t;
      if (i === a) {
        fixX[v] = 1;
        fixY[v] = 1;
      } else if (s % 2 === 0) fixY[v] = 1;
      else fixX[v] = 1;
      if (i !== a) sideOf[v] = s;
    }
  }

  // Ears: a triangle made of three consecutive boundary vertices would have all three corners on
  // one side (zero area). Its middle vertex stays on the side and the other two slide along a line
  // just inside it (set once the scale is known).
  const ears: { p: number; r: number; t: number }[] = [];
  T.forEach(([a, b, c], t) => {
    for (const [p, q, r] of [[a, b, c], [b, c, a], [c, a, b]] as [number, number, number][]) {
      if (next.get(p) === q && next.get(q) === r) ears.push({ p, r, t });
    }
  });

  // Cotangent weights of the rest shape (clamped positive), per triangle edge.
  const cot = new Float64Array(T.length * 3);
  const restArea = new Float64Array(T.length);
  T.forEach(([a, b, c], t) => {
    const p = [a, b, c];
    for (let k = 0; k < 3; k++) {
      // Edge k joins p[k] and p[k+1]; the angle opposite it is at p[k+2].
      const i = p[k]!;
      const j = p[(k + 1) % 3]!;
      const o = p[(k + 2) % 3]!;
      const ux = X[i * 2]! - X[o * 2]!, uy = X[i * 2 + 1]! - X[o * 2 + 1]!;
      const vx = X[j * 2]! - X[o * 2]!, vy = X[j * 2 + 1]! - X[o * 2 + 1]!;
      const cr = Math.abs(ux * vy - uy * vx);
      cot[t * 3 + k] = stiffOf[t]! * Math.max(1e-2, (ux * vx + uy * vy) / Math.max(cr, 1e-18));
    }
    restArea[t] = Math.abs((X[b * 2]! - X[a * 2]!) * (X[c * 2 + 1]! - X[a * 2 + 1]!) - (X[c * 2]! - X[a * 2]!) * (X[b * 2 + 1]! - X[a * 2 + 1]!)) / 2;
  });

  // Overall scale so the target areas add up to the rectangle (holes included at the face scale).
  let target = 0;
  T.forEach((_, t) => (target += scaleOf[t]! ** 2 * restArea[t]!));
  const s = Math.sqrt(((x1 - x0) * (y1 - y0)) / target);

  // Lift the ears' outer corners off the side by up to half the ear's target height (at most EAR_LIFT).
  const lift = new Float64Array(n);
  for (const { p, r, t } of ears) {
    const base = Math.hypot(X[p * 2]! - X[r * 2]!, X[p * 2 + 1]! - X[r * 2 + 1]!);
    const height = base > 0 ? (2 * restArea[t]!) / base : 0;
    const d = Math.min(EAR_LIFT, 0.5 * s * scaleOf[t]! * height);
    for (const w of [p, r]) if (sideOf[w]! >= 0) lift[w] = Math.max(lift[w]!, d);
  }
  for (let v = 0; v < n; v++) {
    if (!lift[v]) continue;
    const side = sideOf[v]!;
    if (side === 0) U[v * 2 + 1] = y0 + lift[v]!;
    else if (side === 1) U[v * 2] = x1 - lift[v]!;
    else if (side === 2) U[v * 2 + 1] = y1 - lift[v]!;
    else U[v * 2] = x0 + lift[v]!;
  }

  // Sparse Laplacian (CSR) with the summed edge weights.
  const rows: Map<number, number>[] = Array.from({ length: n }, () => new Map());
  T.forEach((tri, t) => {
    for (let k = 0; k < 3; k++) {
      const i = tri[k]!;
      const j = tri[(k + 1) % 3]!;
      const w = cot[t * 3 + k]!;
      rows[i]!.set(j, (rows[i]!.get(j) ?? 0) - w);
      rows[j]!.set(i, (rows[j]!.get(i) ?? 0) - w);
      rows[i]!.set(i, (rows[i]!.get(i) ?? 0) + w);
      rows[j]!.set(j, (rows[j]!.get(j) ?? 0) + w);
    }
  });
  const rowStart = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) rowStart[i + 1] = rowStart[i]! + rows[i]!.size;
  const col = new Int32Array(rowStart[n]!);
  const val = new Float64Array(rowStart[n]!);
  rows.forEach((r, i) => {
    let k = rowStart[i]!;
    for (const [j, w] of r) {
      col[k] = j;
      val[k++] = w;
    }
  });

  // Initial interior: harmonic (Tutte-like) with the outer boundary fixed.
  const fixAll = new Int8Array(n);
  for (const v of outer) fixAll[v] = 1;
  const zero = new Float64Array(n);
  for (const d of [0, 1]) solve(rowStart, col, val, fixAll, zero, U, d, 2000);

  // ARAP local/global iterations.
  const rhs = new Float64Array(n * 2);
  for (let it = 0; it < iterations; it++) {
    rhs.fill(0);
    T.forEach((tri, t) => {
      // Best rotation of the current triangle onto the rest one (2x2 Procrustes).
      let s00 = 0, s01 = 0, s10 = 0, s11 = 0;
      for (let k = 0; k < 3; k++) {
        const i = tri[k]!;
        const j = tri[(k + 1) % 3]!;
        const w = cot[t * 3 + k]!;
        const ex = U[i * 2]! - U[j * 2]!, ey = U[i * 2 + 1]! - U[j * 2 + 1]!;
        const fx = X[i * 2]! - X[j * 2]!, fy = X[i * 2 + 1]! - X[j * 2 + 1]!;
        s00 += w * ex * fx;
        s01 += w * ex * fy;
        s10 += w * ey * fx;
        s11 += w * ey * fy;
      }
      const theta = Math.atan2(s10 - s01, s00 + s11);
      const k0 = s * scaleOf[t]!;
      const r00 = k0 * Math.cos(theta), r01 = -k0 * Math.sin(theta), r10 = k0 * Math.sin(theta), r11 = k0 * Math.cos(theta);
      for (let k = 0; k < 3; k++) {
        const i = tri[k]!;
        const j = tri[(k + 1) % 3]!;
        const w = cot[t * 3 + k]!;
        const fx = X[i * 2]! - X[j * 2]!, fy = X[i * 2 + 1]! - X[j * 2 + 1]!;
        const bx = w * (r00 * fx + r01 * fy);
        const by = w * (r10 * fx + r11 * fy);
        rhs[i * 2]! += bx;
        rhs[i * 2 + 1]! += by;
        rhs[j * 2]! -= bx;
        rhs[j * 2 + 1]! -= by;
      }
    });
    solve(rowStart, col, val, fixX, rhs, U, 0, 400);
    solve(rowStart, col, val, fixY, rhs, U, 1, 400);
  }
  untangle(T, U, fixX, fixY);
  for (let i = 0; i < n0; i++) {
    out[ids[i]! * 2] = U[i * 2]!;
    out[ids[i]! * 2 + 1] = U[i * 2 + 1]!;
  }
}

/**
 * ARAP can turn over a few sliver triangles (hm08 has some about a texel
 * across). Move the free corners of any turned-over triangle towards the
 * mean of their neighbours until none is left.
 */
function untangle(T: [number, number, number][], U: Float64Array, fixX: Int8Array, fixY: Int8Array): number {
  const n = fixX.length;
  const ring: Set<number>[] = Array.from({ length: n }, () => new Set());
  for (const [a, b, c] of T) {
    ring[a]!.add(b).add(c);
    ring[b]!.add(a).add(c);
    ring[c]!.add(a).add(b);
  }
  const signed = (P: Float64Array, [a, b, c]: [number, number, number]) =>
    (P[b * 2]! - P[a * 2]!) * (P[c * 2 + 1]! - P[a * 2 + 1]!) - (P[c * 2]! - P[a * 2]!) * (P[b * 2 + 1]! - P[a * 2 + 1]!);
  let bad: Set<number>;
  for (let pass = 0; pass < 500; pass++) {
    bad = new Set<number>();
    for (const t of T) if (signed(U, t) <= 0) for (const v of t) for (const w of [v, ...ring[v]!]) bad.add(w);
    if (bad.size === 0) return 0;
    for (const v of bad) {
      let sx = 0;
      let sy = 0;
      for (const w of ring[v]!) {
        sx += U[w * 2]!;
        sy += U[w * 2 + 1]!;
      }
      const k = ring[v]!.size;
      if (!fixX[v]) U[v * 2] = sx / k;
      if (!fixY[v]) U[v * 2 + 1] = sy / k;
    }
  }
  let left = 0;
  for (const t of T) if (signed(U, t) <= 0) left++;
  return left;
}

/** Most an ear's outer corners are lifted off the rectangle's side (head-texture units: 12 texels at 1024). */
const EAR_LIFT = 12 / 1024;

/** Conjugate gradients on the free unknowns of coordinate `d` (Dirichlet values are the current ones). */
function solve(rowStart: Int32Array, col: Int32Array, val: Float64Array, fixed: Int8Array, rhs: Float64Array, U: Float64Array, d: number, maxIter: number): void {
  const n = fixed.length;
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = U[i * 2 + d]!;
  // b = rhs - A_free,fixed * x_fixed on free rows.
  const b = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (fixed[i]) continue;
    let s = rhs[i * 2 + d]!;
    for (let k = rowStart[i]!; k < rowStart[i + 1]!; k++) if (fixed[col[k]!]) s -= val[k]! * x[col[k]!]!;
    b[i] = s;
  }
  const mul = (p: Float64Array, out: Float64Array) => {
    for (let i = 0; i < n; i++) {
      if (fixed[i]) {
        out[i] = 0;
        continue;
      }
      let s = 0;
      for (let k = rowStart[i]!; k < rowStart[i + 1]!; k++) if (!fixed[col[k]!]) s += val[k]! * p[col[k]!]!;
      out[i] = s;
    }
  };
  // Jacobi-preconditioned CG.
  const diag = new Float64Array(n);
  for (let i = 0; i < n; i++) for (let k = rowStart[i]!; k < rowStart[i + 1]!; k++) if (col[k] === i) diag[i] = val[k]!;
  const xf = new Float64Array(n);
  for (let i = 0; i < n; i++) xf[i] = fixed[i] ? 0 : x[i]!;
  const Ax = new Float64Array(n);
  mul(xf, Ax);
  const r = new Float64Array(n);
  const z = new Float64Array(n);
  const p = new Float64Array(n);
  const Ap = new Float64Array(n);
  let bn = 0;
  for (let i = 0; i < n; i++) {
    if (fixed[i]) continue;
    r[i] = b[i]! - Ax[i]!;
    z[i] = r[i]! / diag[i]!;
    p[i] = z[i]!;
    bn += b[i]! * b[i]!;
  }
  let rz = 0;
  for (let i = 0; i < n; i++) rz += r[i]! * z[i]!;
  const tol = 1e-20 * Math.max(bn, 1e-30);
  for (let it = 0; it < maxIter; it++) {
    mul(p, Ap);
    let pAp = 0;
    for (let i = 0; i < n; i++) pAp += p[i]! * Ap[i]!;
    if (!(pAp > 0)) break;
    const alpha = rz / pAp;
    let rr = 0;
    for (let i = 0; i < n; i++) {
      if (fixed[i]) continue;
      xf[i]! += alpha * p[i]!;
      r[i]! -= alpha * Ap[i]!;
      rr += r[i]! * r[i]!;
    }
    if (rr < tol) break;
    let rz2 = 0;
    for (let i = 0; i < n; i++) {
      if (fixed[i]) continue;
      z[i] = r[i]! / diag[i]!;
      rz2 += r[i]! * z[i]!;
    }
    const beta = rz2 / rz;
    rz = rz2;
    for (let i = 0; i < n; i++) if (!fixed[i]) p[i] = z[i]! + beta * p[i]!;
  }
  for (let i = 0; i < n; i++) if (!fixed[i]) U[i * 2 + d] = xf[i]!;
}

/** Pack the small islands into `area` at the largest uniform scale (one row, left to right). */
function packSmall(
  boxes: { box: [number, number, number, number]; corners: Iterable<number> }[],
  buv: ArrayLike<number>,
  area: [number, number, number, number],
  pad: number,
  out: Float32Array,
): void {
  const [ax0, ay0, ax1, ay1] = area;
  const fits = (s: number) => {
    let x = ax0;
    for (const b of boxes) {
      if ((b.box[3] - b.box[1]) * s > ay1 - ay0) return false;
      x += (b.box[2] - b.box[0]) * s + pad;
    }
    return x - pad <= ax1;
  };
  let lo = 0;
  let hi = 16;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  const s = lo;
  // Spread the spare width evenly between the islands.
  const used = boxes.reduce((w, b) => w + (b.box[2] - b.box[0]) * s, 0);
  const gap = (ax1 - ax0 - used) / Math.max(1, boxes.length - 1);
  let x = ax0;
  for (const b of boxes) {
    const oy = ay0 + (ay1 - ay0 - (b.box[3] - b.box[1]) * s) / 2;
    for (const c of b.corners) {
      out[c * 2] = x + (buv[c * 2]! - b.box[0]) * s;
      out[c * 2 + 1] = oy + (buv[c * 2 + 1]! - b.box[1]) * s;
    }
    x += (b.box[2] - b.box[0]) * s + gap;
  }
}

/**
 * The head texture: every head triangle drawn at its head UVs, filled from
 * the composite at its hm08 UVs. The gutters are filled by dilation so
 * mipmaps do not bleed in black.
 */
export function headTexture(composite: RgbaImage, head: HeadLayout, size: number): RgbaImage {
  const out = createImage(size, size, [0, 0, 0, 255]);
  const covered = new Uint8Array(size * size);
  const tmp = [0, 0, 0, 0];
  const buv = head.mesh.uvs;
  for (const t of head.mesh.triangles) {
    const [a, b, c] = t.corners;
    const xs = t.corners.map((k) => head.uv[k * 2]! * size);
    const ys = t.corners.map((k) => (1 - head.uv[k * 2 + 1]!) * size);
    rasterTriangle(size, xs, ys, (texel, b0, b1, b2) => {
      sampleBilinear(composite, b0 * buv[a * 2]! + b1 * buv[b * 2]! + b2 * buv[c * 2]!, b0 * buv[a * 2 + 1]! + b1 * buv[b * 2 + 1]! + b2 * buv[c * 2 + 1]!, tmp);
      out.data[texel * 4] = tmp[0]!;
      out.data[texel * 4 + 1] = tmp[1]!;
      out.data[texel * 4 + 2] = tmp[2]!;
      covered[texel] = 1;
    });
  }
  dilateRgb(out, covered, Math.max(4, Math.round(size / 128)));
  return out;
}

/** Fraction of the head texture's texels that a head triangle covers. */
export function headCoverage(head: HeadLayout, size: number): number {
  const covered = new Uint8Array(size * size);
  for (const t of head.mesh.triangles) {
    const xs = t.corners.map((k) => head.uv[k * 2]! * size);
    const ys = t.corners.map((k) => (1 - head.uv[k * 2 + 1]!) * size);
    rasterTriangle(size, xs, ys, (texel) => (covered[texel] = 1));
  }
  let used = 0;
  for (let i = 0; i < covered.length; i++) used += covered[i]!;
  return used / covered.length;
}
