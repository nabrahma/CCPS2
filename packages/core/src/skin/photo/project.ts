/**
 * Photo to face projection (PRD F7).
 *
 * For each texel of the head islands: take its 3D point on the current head,
 * project it to the front view (orthographic along -Z), find it in the Delaunay
 * triangulation of the landmark vertices' projections, and carry its
 * barycentric position over to the same triangle of the photo's landmarks.
 * Texels hidden from the front (mouth interior, nostrils, under the chin)
 * and texels facing away get no photo; a feather fades the photo out towards
 * the edge of the landmark hull. Optionally the photo's colour is matched to
 * the base skin in LAB over that border band.
 */
import { createImage, dilateRgb, sampleBilinear, type RgbaImage } from '../image';
import { rasterTriangle, type SkinLayout } from '../layout';
import { smoothstep } from '../noise';
import { labStats, labToRgb, labTransfer, rgbToLab } from './colour';
import { delaunay } from './delaunay';
import { PiecewiseAffine } from './warp';

export const LANDMARK_COUNT = 478;

/** Landmark index -> hm08 body vertex, built at compile time (tools/landmarks). */
export interface LandmarkTable {
  format: 'ps2cc.landmarks/1';
  /** hm08 vertex per MediaPipe landmark (the nearest visible one), -1 where none matched (irises). */
  vertices: number[];
  /**
   * Optional exact surface point per landmark, 6 numbers each: three hm08
   * vertices and their barycentric weights (-1 vertices when unmapped). The
   * projection uses these when present; the nearest vertex is up to a few
   * millimetres off the landmark.
   */
  anchors?: number[];
  /** How the table was made (render size, detector version, residuals). */
  source: Record<string, unknown>;
}

export function validateLandmarkTable(raw: unknown): LandmarkTable {
  const t = raw as Partial<LandmarkTable>;
  if (!t || t.format !== 'ps2cc.landmarks/1' || !Array.isArray(t.vertices) || t.vertices.length !== LANDMARK_COUNT)
    throw new Error('invalid landmark table');
  const out: LandmarkTable = { format: t.format, vertices: t.vertices.map((v) => (Number.isInteger(v) ? v : -1)), source: t.source ?? {} };
  if (Array.isArray(t.anchors) && t.anchors.length === LANDMARK_COUNT * 6 && t.anchors.every((x) => Number.isFinite(x))) out.anchors = t.anchors;
  return out;
}

/** Front-view point of landmark i on the current mesh (x, y), or null when unmapped. */
export function landmarkPoint(table: LandmarkTable, i: number, positions: ArrayLike<number>): [number, number, number] | null {
  const a = table.anchors;
  if (a && a[i * 6]! >= 0) {
    const p: [number, number, number] = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      const v = a[i * 6 + k]!;
      const w = a[i * 6 + 3 + k]!;
      p[0] += w * positions[v * 3]!;
      p[1] += w * positions[v * 3 + 1]!;
      p[2] += w * positions[v * 3 + 2]!;
    }
    return p;
  }
  const v = table.vertices[i]!;
  return v >= 0 ? [positions[v * 3]!, positions[v * 3 + 1]!, positions[v * 3 + 2]!] : null;
}

export interface ProjectInput {
  layout: SkinLayout;
  table: LandmarkTable;
  /** Current (morphed) hm08 positions and normals. */
  positions: ArrayLike<number>;
  normals: ArrayLike<number>;
  photo: RgbaImage;
  /** MediaPipe landmarks of the photo: normalised x, y, z per landmark. */
  landmarks: ArrayLike<number>;
  /** Output size (UV space); default 2048, the composite size. */
  size?: number;
  /** Base skin for colour matching (same UV layout); null skips matching. */
  baseSkin?: RgbaImage | null;
  /** Feather width as a fraction of the face width (default 0.12). */
  feather?: number;
}

export interface ProjectResult {
  /** RGBA in hm08 UV space: photo colour, alpha = projection weight. */
  image: RgbaImage;
  matched: number;
  triangles: number;
  /** Texels that received any photo. */
  texels: number;
  colourMatched: boolean;
}

export function projectPhoto(input: ProjectInput): ProjectResult {
  const { layout, table, positions, normals, photo, landmarks } = input;
  const size = input.size ?? 2048;
  // 1. Matched pairs (duplicates within 0.1 mm dropped: Delaunay needs distinct points).
  const src: number[] = [];
  const dst: number[] = [];
  const used = new Set<string>();
  for (let i = 0; i < LANDMARK_COUNT; i++) {
    const p = landmarkPoint(table, i, positions);
    if (!p || i * 3 + 1 >= landmarks.length) continue;
    const key = `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)}`;
    if (used.has(key)) continue;
    used.add(key);
    src.push(p[0], p[1]);
    // Photo pixels, flipped to y up so both frames have the same handedness.
    dst.push(landmarks[i * 3]! * photo.width, (1 - landmarks[i * 3 + 1]!) * photo.height);
  }
  const srcA = Float64Array.from(src);
  const dstA = Float64Array.from(dst);
  // 2. Triangulate; drop triangles that fold over in the photo.
  const all = delaunay(srcA);
  const keep: number[] = [];
  for (let t = 0; t < all.length; t += 3) {
    const [a, b, c] = [all[t]!, all[t + 1]!, all[t + 2]!];
    const area = (dstA[b * 2]! - dstA[a * 2]!) * (dstA[c * 2 + 1]! - dstA[a * 2 + 1]!) - (dstA[c * 2]! - dstA[a * 2]!) * (dstA[b * 2 + 1]! - dstA[a * 2 + 1]!);
    if (area > 0) keep.push(a, b, c);
  }
  const warp = new PiecewiseAffine(srcA, dstA, Uint32Array.from(keep));
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < srcA.length; i += 2) {
    minX = Math.min(minX, srcA[i]!);
    maxX = Math.max(maxX, srcA[i]!);
    minY = Math.min(minY, srcA[i + 1]!);
    maxY = Math.max(maxY, srcA[i + 1]!);
  }
  const faceWidth = maxX - minX;
  const feather = (input.feather ?? 0.12) * faceWidth;
  // 3. Front visibility: a depth buffer of the head over the landmark box.
  const depth = frontDepth(layout, positions, minX, maxX, minY, maxY, 512);
  // 4. Warp every head texel.
  const map = layout.surfaceMap(size, positions, normals, (i) => i.kind === 'head');
  const image = createImage(size, size);
  const weight = new Float32Array(size * size);
  const colour = new Float32Array(size * size * 3);
  const q = [0, 0];
  const tmp = [0, 0, 0, 0];
  let texels = 0;
  for (let t = 0; t < size * size; t++) {
    if (!map.coverage[t]) continue;
    const x = map.position[t * 3]!;
    const y = map.position[t * 3 + 1]!;
    const z = map.position[t * 3 + 2]!;
    const facing = smoothstep(0.15, 0.5, map.normal[t * 3 + 2]!);
    if (facing <= 0 || !depth.visible(x, y, z)) continue;
    if (!warp.map(x, y, q)) continue;
    const edge = smoothstep(0, feather, warp.distanceToHull(x, y));
    const w = facing * edge;
    if (w <= 0) continue;
    sampleBilinear(photo, q[0]! / photo.width, q[1]! / photo.height, tmp);
    weight[t] = w;
    colour[t * 3] = tmp[0]!;
    colour[t * 3 + 1] = tmp[1]!;
    colour[t * 3 + 2] = tmp[2]!;
    texels++;
  }
  // 5. Colour match over the feather band (photo border) against the base skin.
  let colourMatched = false;
  if (input.baseSkin) {
    const photoLab: number[] = [];
    const skinLab: number[] = [];
    const wts: number[] = [];
    for (let t = 0; t < size * size; t++) {
      const w = weight[t]!;
      if (w <= 0.05 || w >= 0.95) continue;
      const px = t % size;
      const py = Math.floor(t / size);
      sampleBilinear(input.baseSkin, (px + 0.5) / size, 1 - (py + 0.5) / size, tmp);
      skinLab.push(...rgbToLab(tmp[0]!, tmp[1]!, tmp[2]!));
      photoLab.push(...rgbToLab(colour[t * 3]!, colour[t * 3 + 1]!, colour[t * 3 + 2]!));
      wts.push(1);
    }
    if (wts.length >= 64) {
      const transfer = labTransfer(labStats(photoLab, wts), labStats(skinLab, wts));
      for (let t = 0; t < size * size; t++) {
        if (weight[t]! <= 0) continue;
        const [r, g, b] = labToRgb(...transfer(rgbToLab(colour[t * 3]!, colour[t * 3 + 1]!, colour[t * 3 + 2]!)));
        colour[t * 3] = r;
        colour[t * 3 + 1] = g;
        colour[t * 3 + 2] = b;
      }
      colourMatched = true;
    }
  }
  const covered = new Uint8Array(size * size);
  for (let t = 0; t < size * size; t++) {
    if (weight[t]! <= 0) continue;
    image.data[t * 4] = colour[t * 3]!;
    image.data[t * 4 + 1] = colour[t * 3 + 1]!;
    image.data[t * 4 + 2] = colour[t * 3 + 2]!;
    image.data[t * 4 + 3] = Math.round(weight[t]! * 255);
    covered[t] = 1;
  }
  dilateRgb(image, covered, 3);
  return { image, matched: srcA.length / 2, triangles: keep.length / 3, texels, colourMatched };
}

/** Depth buffer of the body seen from the front (+Z towards the viewer), over a box in x and y. */
function frontDepth(layout: SkinLayout, positions: ArrayLike<number>, x0: number, x1: number, y0: number, y1: number, res: number) {
  const margin = 0.1 * Math.max(x1 - x0, y1 - y0);
  const bx = x0 - margin;
  const by = y0 - margin;
  const span = Math.max(x1 - x0, y1 - y0) + 2 * margin;
  const zbuf = new Float32Array(res * res).fill(-Infinity);
  const toPx = (x: number) => ((x - bx) / span) * res;
  const toPy = (y: number) => (1 - (y - by) / span) * res;
  for (const tri of layout.triangles) {
    const [a, b, c] = tri.verts;
    const xs = [toPx(positions[a * 3]!), toPx(positions[b * 3]!), toPx(positions[c * 3]!)];
    const ys = [toPy(positions[a * 3 + 1]!), toPy(positions[b * 3 + 1]!), toPy(positions[c * 3 + 1]!)];
    if (Math.max(...xs) < 0 || Math.min(...xs) > res || Math.max(...ys) < 0 || Math.min(...ys) > res) continue;
    const za = positions[a * 3 + 2]!;
    const zb = positions[b * 3 + 2]!;
    const zc = positions[c * 3 + 2]!;
    rasterTriangle(res, xs, ys, (texel, b0, b1, b2) => {
      const z = b0 * za + b1 * zb + b2 * zc;
      if (z > zbuf[texel]!) zbuf[texel] = z;
    });
  }
  // A point is visible when nothing at its pixel lies more than a few millimetres in front of it.
  const tolerance = 0.003;
  return {
    visible(x: number, y: number, z: number): boolean {
      const px = Math.floor(toPx(x));
      const py = Math.floor(toPy(y));
      if (px < 0 || py < 0 || px >= res || py >= res) return false;
      return z >= zbuf[py * res + px]! - tolerance;
    },
  };
}
