/**
 * Three-photo projection (PRD Part 2 F19, extending F7): a front photo and
 * optional left and right ones, blended for full-head coverage.
 *
 * Per photo:
 *  1. An affine camera (3D point -> photo pixel) is fitted to the landmarks by
 *     least squares; its rows give the direction the photo was taken from.
 *     It is refitted on the landmarks that face that direction (MediaPipe
 *     guesses the hidden ones).
 *  2. Inside the landmark hull a piecewise-affine warp carries each point from
 *     where the camera puts it to where the photo's landmarks say (as in the
 *     single-photo projection, which a front camera reduces to); outside the
 *     hull the camera alone places it, with the landmarks' corrections fading
 *     out, so the sides of the head and the ears are covered too.
 *  3. A depth buffer along that direction hides what the photo cannot see.
 * A texel is covered as well as the best photo sees it (that is the layer's
 * alpha), and its colour is a blend that favours the photos facing it most
 * squarely: weights go with (facing)^4, the front photo counting three times
 * as much, so it keeps the eyes, nose and mouth while the side photos take
 * over smoothly towards the ears. Each photo's weight ramps out towards the
 * edges of what it can see. Side photos are colour-matched to the front one
 * where they overlap (globally, then their shading through a smooth ratio
 * field), so the blend shows no seam, and the result is matched to the base
 * skin around its border.
 */
import { blurChannel, createImage, dilateRgb, sampleBilinear, type RgbaImage } from '../image';
import { rasterTriangle, type SkinLayout } from '../layout';
import { smoothstep } from '../noise';
import { labStats, labToRgb, labTransfer, rgbToLab } from './colour';
import { delaunay } from './delaunay';
import { LANDMARK_COUNT, landmarkPoint, type LandmarkTable } from './project';
import { PiecewiseAffine } from './warp';

export interface PhotoView {
  photo: RgbaImage;
  /** MediaPipe landmarks of the photo: normalised x, y, z per landmark. */
  landmarks: ArrayLike<number>;
}

export interface MultiProjectInput {
  layout: SkinLayout;
  table: LandmarkTable;
  positions: ArrayLike<number>;
  normals: ArrayLike<number>;
  /** The front photo first, then side photos. */
  views: PhotoView[];
  size?: number;
  baseSkin?: RgbaImage | null;
  /** How sharply the most squarely facing photo wins (default 6). */
  sharpness?: number;
  /** Match the side photos' colour to the front one where they overlap (default true; off only for tests). */
  harmonise?: boolean;
  /** Tests only: each texel takes the one most squarely facing photo (the seam control). */
  hardSwitch?: boolean;
}

export interface ViewFit {
  /** Affine camera: photo pixel (x, y up) = A * point + t; rows [a0 a1 a2 t]. */
  camera: [number[], number[]];
  /** Unit direction towards the camera. */
  direction: [number, number, number];
  /** Landmarks used (facing the camera), and the RMS residual of the camera fit in pixels. */
  used: number;
  residual: number;
  /** Signed angle of the direction around the vertical axis (degrees, + towards the character's left). */
  yaw: number;
}

export interface MultiProjectResult {
  image: RgbaImage;
  views: ViewFit[];
  /** Per texel, the blend weight of each view before normalising (views x size x size), for tests. */
  weights: Float32Array[];
  /** Per texel, how well each view sees it (0..1); the layer's alpha is the best of them. */
  coverage: Float32Array[];
  /** Per texel, each view's own colour (RGB, after colour matching between views), for tests. */
  viewColours: Float32Array[];
  texels: number;
  colourMatched: boolean;
}

type Vec3 = [number, number, number];

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Least-squares affine camera from 3D points to 2D points. */
export function fitAffineCamera(points: Vec3[], pixels: [number, number][]): [number[], number[]] {
  const M = Array.from({ length: 4 }, () => new Float64Array(4));
  const bx = new Float64Array(4);
  const by = new Float64Array(4);
  points.forEach((p, i) => {
    const h = [p[0], p[1], p[2], 1];
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) M[r]![c]! += h[r]! * h[c]!;
      bx[r]! += h[r]! * pixels[i]![0];
      by[r]! += h[r]! * pixels[i]![1];
    }
  });
  return [solve4(M, bx), solve4(M, by)];
}

function solve4(M: Float64Array[], b: Float64Array): number[] {
  const a = M.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < 4; c++) {
    let p = c;
    for (let r = c + 1; r < 4; r++) if (Math.abs(a[r]![c]!) > Math.abs(a[p]![c]!)) p = r;
    [a[c], a[p]] = [a[p]!, a[c]!];
    const d = a[c]![c]! || 1e-30;
    for (let r = 0; r < 4; r++) {
      if (r === c) continue;
      const f = a[r]![c]! / d;
      for (let k = c; k < 5; k++) a[r]![k]! -= f * a[c]![k]!;
    }
  }
  return a.map((row, i) => row[4]! / (row[i]! || 1e-30));
}

function landmarkNormal(table: LandmarkTable, i: number, normals: ArrayLike<number>): Vec3 | null {
  const a = table.anchors;
  if (a && a[i * 6]! >= 0) {
    const n: Vec3 = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      const v = a[i * 6 + k]!;
      const w = a[i * 6 + 3 + k]!;
      for (let c = 0; c < 3; c++) n[c]! += w * normals[v * 3 + c]!;
    }
    return norm(n);
  }
  const v = table.vertices[i]!;
  return v >= 0 ? norm([normals[v * 3]!, normals[v * 3 + 1]!, normals[v * 3 + 2]!]) : null;
}

interface PreparedView {
  fit: ViewFit;
  warp: PiecewiseAffine;
  src: Float64Array;
  corr: Float64Array;
  depth: { visible(p: Vec3): boolean };
  faceWidth: number;
  photo: RgbaImage;
}

function prepare(input: MultiProjectInput, view: PhotoView): PreparedView | null {
  const { table, positions, normals, layout } = input;
  const { photo, landmarks } = view;
  const pts: Vec3[] = [];
  const nrm: Vec3[] = [];
  const px: [number, number][] = [];
  for (let i = 0; i < LANDMARK_COUNT; i++) {
    const p = landmarkPoint(table, i, positions);
    const n = landmarkNormal(table, i, normals);
    if (!p || !n || i * 3 + 1 >= landmarks.length) continue;
    pts.push(p);
    nrm.push(n);
    px.push([landmarks[i * 3]! * photo.width, (1 - landmarks[i * 3 + 1]!) * photo.height]);
  }
  if (pts.length < 20) return null;
  let cam = fitAffineCamera(pts, px);
  let dir = norm(cross(cam[0].slice(0, 3) as Vec3, cam[1].slice(0, 3) as Vec3));
  // Refit on the landmarks that face the camera.
  let keep = pts.map((_, i) => dot(nrm[i]!, dir) > 0.3);
  cam = fitAffineCamera(pts.filter((_, i) => keep[i]), px.filter((_, i) => keep[i]));
  dir = norm(cross(cam[0].slice(0, 3) as Vec3, cam[1].slice(0, 3) as Vec3));
  keep = pts.map((_, i) => dot(nrm[i]!, dir) > 0.3);
  const project = (p: Vec3): [number, number] => [
    cam[0][0]! * p[0] + cam[0][1]! * p[1] + cam[0][2]! * p[2] + cam[0][3]!,
    cam[1][0]! * p[0] + cam[1][1]! * p[1] + cam[1][2]! * p[2] + cam[1][3]!,
  ];
  const depth = viewDepth(layout, positions, dir, cam);
  // Matched pairs (camera position -> photo landmark), visible ones only, duplicates dropped.
  const src: number[] = [];
  const dst: number[] = [];
  const seen = new Set<string>();
  let rss = 0;
  pts.forEach((p, i) => {
    if (!keep[i] || !depth.visible(p)) return;
    const s = project(p);
    const key = `${Math.round(s[0] * 10)},${Math.round(s[1] * 10)}`;
    if (seen.has(key)) return;
    seen.add(key);
    src.push(s[0], s[1]);
    dst.push(px[i]![0], px[i]![1]);
    rss += (s[0] - px[i]![0]) ** 2 + (s[1] - px[i]![1]) ** 2;
  });
  const srcA = Float64Array.from(src);
  const dstA = Float64Array.from(dst);
  const all = delaunay(srcA);
  const tris: number[] = [];
  for (let t = 0; t < all.length; t += 3) {
    const [a, b, c] = [all[t]!, all[t + 1]!, all[t + 2]!];
    const area = (dstA[b * 2]! - dstA[a * 2]!) * (dstA[c * 2 + 1]! - dstA[a * 2 + 1]!) - (dstA[c * 2]! - dstA[a * 2]!) * (dstA[b * 2 + 1]! - dstA[a * 2 + 1]!);
    if (area > 0) tris.push(a, b, c);
  }
  let minX = Infinity;
  let maxX = -Infinity;
  for (let i = 0; i < srcA.length; i += 2) {
    minX = Math.min(minX, srcA[i]!);
    maxX = Math.max(maxX, srcA[i]!);
  }
  const corr = new Float64Array(srcA.length);
  for (let i = 0; i < srcA.length; i++) corr[i] = dstA[i]! - srcA[i]!;
  const yaw = (Math.atan2(dir[0], dir[2]) * 180) / Math.PI;
  return {
    fit: { camera: cam, direction: dir, used: srcA.length / 2, residual: Math.sqrt(rss / Math.max(1, srcA.length / 2)), yaw },
    warp: new PiecewiseAffine(srcA, dstA, Uint32Array.from(tris)),
    src: srcA,
    corr,
    depth,
    faceWidth: maxX - minX,
    photo,
  };
}

/** Depth buffer of the body seen along `dir`, in the camera's own image plane. */
function viewDepth(layout: SkinLayout, positions: ArrayLike<number>, dir: Vec3, cam: [number[], number[]]) {
  const e1 = norm([cam[0][0]! - dot(cam[0].slice(0, 3) as Vec3, dir) * dir[0], cam[0][1]! - dot(cam[0].slice(0, 3) as Vec3, dir) * dir[1], cam[0][2]! - dot(cam[0].slice(0, 3) as Vec3, dir) * dir[2]]);
  const e2 = cross(dir, e1);
  // Only the head matters: a box around the head's points in the view plane.
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  const heads = layout.trianglesOf((i) => i.kind === 'head');
  for (const t of heads) {
    for (const v of t.verts) {
      const p: Vec3 = [positions[v * 3]!, positions[v * 3 + 1]!, positions[v * 3 + 2]!];
      const a = dot(p, e1);
      const b = dot(p, e2);
      x0 = Math.min(x0, a);
      x1 = Math.max(x1, a);
      y0 = Math.min(y0, b);
      y1 = Math.max(y1, b);
    }
  }
  const res = 512;
  const margin = 0.1 * Math.max(x1 - x0, y1 - y0);
  const bx = x0 - margin;
  const by = y0 - margin;
  const span = Math.max(x1 - x0, y1 - y0) + 2 * margin;
  const zbuf = new Float32Array(res * res).fill(-Infinity);
  const toPx = (a: number) => ((a - bx) / span) * res;
  const toPy = (b: number) => (1 - (b - by) / span) * res;
  for (const tri of layout.triangles) {
    const P = tri.verts.map((v) => [positions[v * 3]!, positions[v * 3 + 1]!, positions[v * 3 + 2]!] as Vec3);
    const xs = P.map((p) => toPx(dot(p, e1)));
    const ys = P.map((p) => toPy(dot(p, e2)));
    if (Math.max(...xs) < 0 || Math.min(...xs) > res || Math.max(...ys) < 0 || Math.min(...ys) > res) continue;
    const zs = P.map((p) => dot(p, dir));
    rasterTriangle(res, xs, ys, (texel, b0, b1, b2) => {
      const z = b0 * zs[0]! + b1 * zs[1]! + b2 * zs[2]!;
      if (z > zbuf[texel]!) zbuf[texel] = z;
    });
  }
  const tolerance = 0.003;
  return {
    visible(p: Vec3): boolean {
      const px = Math.floor(toPx(dot(p, e1)));
      const py = Math.floor(toPy(dot(p, e2)));
      if (px < 0 || py < 0 || px >= res || py >= res) return false;
      return dot(p, dir) >= zbuf[py * res + px]! - tolerance;
    },
  };
}

export function projectPhotos(input: MultiProjectInput): MultiProjectResult {
  const size = input.size ?? 2048;
  const sharp = input.sharpness ?? 4;
  const prepared = input.views.map((v) => prepare(input, v));
  const map = input.layout.surfaceMap(size, input.positions, input.normals, (i) => i.kind === 'head');
  const n = size * size;
  const weights = prepared.map(() => new Float32Array(n));
  const coverage = prepared.map(() => new Float32Array(n));
  const colours = prepared.map(() => new Float32Array(n * 3));
  const q = [0, 0];
  const tmp = [0, 0, 0, 0];
  const p: Vec3 = [0, 0, 0];
  prepared.forEach((v, k) => {
    if (!v) return;
    const cam = v.fit.camera;
    const feather = 0.12 * v.faceWidth;
    const reach = 0.35 * v.faceWidth;
    // What this photo sees, softened over a few texels so a photo's weight ramps out towards an
    // occlusion edge (the nose hiding the far cheek) instead of stopping there.
    const seen = new Float32Array(n);
    for (let t = 0; t < n; t++) {
      if (!map.coverage[t]) continue;
      p[0] = map.position[t * 3]!;
      p[1] = map.position[t * 3 + 1]!;
      p[2] = map.position[t * 3 + 2]!;
      const facing = map.normal[t * 3]! * v.fit.direction[0] + map.normal[t * 3 + 1]! * v.fit.direction[1] + map.normal[t * 3 + 2]! * v.fit.direction[2];
      if (facing > 0.1 && v.depth.visible(p)) seen[t] = 1;
    }
    const soft = blurChannel(seen, size, size, Math.max(2, size / 128), 2);
    for (let t = 0; t < n; t++) {
      if (!seen[t]) continue;
      p[0] = map.position[t * 3]!;
      p[1] = map.position[t * 3 + 1]!;
      p[2] = map.position[t * 3 + 2]!;
      const facing = map.normal[t * 3]! * v.fit.direction[0] + map.normal[t * 3 + 1]! * v.fit.direction[1] + map.normal[t * 3 + 2]! * v.fit.direction[2];
      const sx = cam[0][0]! * p[0] + cam[0][1]! * p[1] + cam[0][2]! * p[2] + cam[0][3]!;
      const sy = cam[1][0]! * p[0] + cam[1][1]! * p[1] + cam[1][2]! * p[2] + cam[1][3]!;
      let hull: number;
      const d = v.warp.distanceToHull(sx, sy);
      if (!v.warp.map(sx, sy, q)) {
        // Outside the landmarks: the camera, with the landmarks' corrections fading out.
        const [cx, cy] = idw(v.src, v.corr, sx, sy);
        const fade = Math.exp(-d / (0.5 * reach));
        q[0] = sx + cx * fade;
        q[1] = sy + cy * fade;
        hull = 1 - smoothstep(0, reach, d) * 0.4;
      } else {
        // Inside, the warp, handing over to the outside's correction near the hull so the two meet without a step.
        const [cx, cy] = idw(v.src, v.corr, sx, sy);
        const k2 = smoothstep(0, feather, d);
        q[0] = sx + cx + (q[0]! - sx - cx) * k2;
        q[1] = sy + cy + (q[1]! - sy - cy) * k2;
        hull = 1;
      }
      const u = q[0]! / v.photo.width;
      const vv = q[1]! / v.photo.height;
      if (u < 0 || u > 1 || vv < 0 || vv > 1) continue;
      const border = smoothstep(0, 0.02, Math.min(u, 1 - u, vv, 1 - vv));
      // Coverage: whether this photo sees the texel well; the blend weight then favours the squarest view.
      const cov = smoothstep(0.1, 0.4, facing) * hull * border;
      if (cov <= 0) continue;
      sampleBilinear(v.photo, u, vv, tmp);
      coverage[k]![t] = cov;
      // The softened visibility shapes only the blend, not the coverage (the eye and lip rims keep their photo).
      // The front photo leads unless a side photo faces the surface clearly more squarely (eyes and mouth stay front).
      const bias = k === 0 ? FRONT_BIAS : 1;
      weights[k]![t] = cov * bias * smoothstep(0.5, 1, soft[t]!) * (((facing - 0.1) / 0.9) ** sharp + 1e-6) + 1e-9 * cov;
      colours[k]![t * 3] = tmp[0]!;
      colours[k]![t * 3 + 1] = tmp[1]!;
      colours[k]![t * 3 + 2] = tmp[2]!;
    }
  });
  // Side photos take the front photo's colour where they overlap.
  for (let k = 1; k < prepared.length; k++) {
    if (!prepared[k] || !prepared[0] || input.harmonise === false) continue;
    const a: number[] = [];
    const b: number[] = [];
    const wts: number[] = [];
    for (let t = 0; t < n; t += 2) {
      if (weights[0]![t]! < 0.02 || weights[k]![t]! < 0.02) continue;
      a.push(...rgbToLab(colours[k]![t * 3]!, colours[k]![t * 3 + 1]!, colours[k]![t * 3 + 2]!));
      b.push(...rgbToLab(colours[0]![t * 3]!, colours[0]![t * 3 + 1]!, colours[0]![t * 3 + 2]!));
      wts.push(1);
    }
    if (wts.length < 64) continue;
    const transfer = labTransfer(labStats(a, wts), labStats(b, wts));
    for (let t = 0; t < n; t++) {
      if (weights[k]![t]! <= 0) continue;
      const [r, g, bb] = labToRgb(...transfer(rgbToLab(colours[k]![t * 3]!, colours[k]![t * 3 + 1]!, colours[k]![t * 3 + 2]!)));
      colours[k]![t * 3] = r;
      colours[k]![t * 3 + 1] = g;
      colours[k]![t * 3 + 2] = bb;
    }
  }
  // Then the shading: a smooth per-channel ratio field (the front photo over the side one, both blurred,
  // where both see the face; spread outwards from there) takes out light that differs across the face,
  // while the side photo keeps its own detail.
  if (input.harmonise !== false && prepared[0]) {
    const radius = Math.max(4, size / 32);
    for (let k = 1; k < prepared.length; k++) {
      if (!prepared[k]) continue;
      const both = new Float32Array(n);
      for (let t = 0; t < n; t++) if (coverage[0]![t]! > 0.5 && coverage[k]![t]! > 0.5) both[t] = 1;
      const wBoth = blurChannel(both, size, size, radius, 3);
      const ratio: Float32Array[] = [];
      for (let c = 0; c < 3; c++) {
        const a = new Float32Array(n);
        const b = new Float32Array(n);
        for (let t = 0; t < n; t++) {
          if (!both[t]) continue;
          a[t] = colours[0]![t * 3 + c]!;
          b[t] = colours[k]![t * 3 + c]!;
        }
        const A = blurChannel(a, size, size, radius, 3);
        const B = blurChannel(b, size, size, radius, 3);
        // Spread the ratio where there is no overlap nearby (wider blur, normalised), falling back to 1.
        const r = new Float32Array(n);
        for (let t = 0; t < n; t++) r[t] = wBoth[t]! > 0.05 && B[t]! > 1 ? Math.min(2, Math.max(0.5, A[t]! / B[t]!)) : 0;
        const known = new Float32Array(n);
        for (let t = 0; t < n; t++) known[t] = r[t]! > 0 ? 1 : 0;
        const rWide = blurChannel(r, size, size, radius * 3, 2);
        const kWide = blurChannel(known, size, size, radius * 3, 2);
        for (let t = 0; t < n; t++) {
          if (r[t]! > 0) continue;
          const f = kWide[t]! > 1e-3 ? rWide[t]! / kWide[t]! : 1;
          // Far from any overlap the correction fades to none.
          r[t] = 1 + (f - 1) * Math.min(1, kWide[t]! * 4);
        }
        ratio.push(r);
      }
      for (let t = 0; t < n; t++) {
        if (!(coverage[k]![t]! > 0)) continue;
        for (let c = 0; c < 3; c++) colours[k]![t * 3 + c] = Math.min(255, colours[k]![t * 3 + c]! * ratio[c]![t]!);
      }
    }
  }
  // Blend.
  const colour = new Float32Array(n * 3);
  const alpha = new Float32Array(n);
  let texels = 0;
  for (let t = 0; t < n; t++) {
    let sw = 0;
    let r = 0;
    let g = 0;
    let b = 0;
    let cov = 0;
    let best = -1;
    for (let k = 0; k < prepared.length; k++) {
      cov = Math.max(cov, coverage[k]![t]!);
      if (best < 0 || weights[k]![t]! > weights[best]![t]!) best = k;
    }
    if (cov <= 0) continue;
    for (let k = 0; k < prepared.length; k++) {
      const w = input.hardSwitch ? (k === best ? 1 : 0) : weights[k]![t]!;
      if (w <= 0) continue;
      sw += w;
      r += w * colours[k]![t * 3]!;
      g += w * colours[k]![t * 3 + 1]!;
      b += w * colours[k]![t * 3 + 2]!;
    }
    if (sw <= 0) continue;
    colour[t * 3] = r / sw;
    colour[t * 3 + 1] = g / sw;
    colour[t * 3 + 2] = b / sw;
    alpha[t] = cov;
    texels++;
  }
  // The whole result matched to the base skin around its border.
  let colourMatched = false;
  if (input.baseSkin) {
    const pl: number[] = [];
    const sl: number[] = [];
    const wts: number[] = [];
    for (let t = 0; t < n; t++) {
      const a = alpha[t]!;
      if (a <= 0.05 || a >= 0.95) continue;
      const px = t % size;
      const py = Math.floor(t / size);
      sampleBilinear(input.baseSkin, (px + 0.5) / size, 1 - (py + 0.5) / size, tmp);
      sl.push(...rgbToLab(tmp[0]!, tmp[1]!, tmp[2]!));
      pl.push(...rgbToLab(colour[t * 3]!, colour[t * 3 + 1]!, colour[t * 3 + 2]!));
      wts.push(1);
    }
    if (wts.length >= 64) {
      const transfer = labTransfer(labStats(pl, wts), labStats(sl, wts));
      for (let t = 0; t < n; t++) {
        if (alpha[t]! <= 0) continue;
        const [r, g, b] = labToRgb(...transfer(rgbToLab(colour[t * 3]!, colour[t * 3 + 1]!, colour[t * 3 + 2]!)));
        colour[t * 3] = r;
        colour[t * 3 + 1] = g;
        colour[t * 3 + 2] = b;
      }
      colourMatched = true;
    }
  }
  const image = createImage(size, size);
  const covered = new Uint8Array(n);
  for (let t = 0; t < n; t++) {
    if (alpha[t]! <= 0) continue;
    image.data[t * 4] = colour[t * 3]!;
    image.data[t * 4 + 1] = colour[t * 3 + 1]!;
    image.data[t * 4 + 2] = colour[t * 3 + 2]!;
    image.data[t * 4 + 3] = Math.round(alpha[t]! * 255);
    covered[t] = 1;
  }
  dilateRgb(image, covered, 3);
  return { image, views: prepared.map((v) => v?.fit ?? null).filter((v): v is ViewFit => v !== null), weights, coverage, viewColours: colours, texels, colourMatched };
}

/** How much more the front photo counts than a side photo facing a texel as squarely. */
const FRONT_BIAS = 3;

/** Inverse-distance-weighted correction at a point from the landmarks' corrections (nearest 8). */
function idw(src: Float64Array, corr: Float64Array, x: number, y: number): [number, number] {
  const best: { d: number; i: number }[] = [];
  for (let i = 0; i < src.length / 2; i++) {
    const d = Math.hypot(src[i * 2]! - x, src[i * 2 + 1]! - y);
    if (best.length < 8 || d < best[best.length - 1]!.d) {
      best.push({ d, i });
      best.sort((a, b) => a.d - b.d);
      if (best.length > 8) best.pop();
    }
  }
  let sw = 0;
  let cx = 0;
  let cy = 0;
  for (const { d, i } of best) {
    const w = 1 / Math.max(1e-6, d * d);
    sw += w;
    cx += w * corr[i * 2]!;
    cy += w * corr[i * 2 + 1]!;
  }
  return sw > 0 ? [cx / sw, cy / sw] : [0, 0];
}
