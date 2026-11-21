/**
 * Folds into the texture (PRD Part 3, F31 step 6): the fine drape's detail baked into the coarse garment's
 * UV layout, the era recipe of simulating at high resolution and painting the result into a low-poly
 * diffuse. Per fine particle: ambient occlusion from the cloth and the body (cosine-weighted rays), and how
 * much more or less a soft key light reaches the fold than the smooth surface around it. Every texel finds
 * its pattern point (the UVs are the pattern) and so its fine triangle, and takes the shade there.
 */
import { cos, sin, TAU } from '../../math/dmath';
import { TriangleBVH } from '../../mesh/bvh';
import { createImage, type RgbaImage } from '../../skin/image';
import type { ShellBody } from '../shell/body';
import { bodyDistance } from '../shell/shape';
import type { DrapeResult } from '../drape/drape';
import { TriangleLocator } from '../drape/locate';
import type { IslandPlacement } from './coarse';

export interface FoldBake {
  /** Greyscale shading (multiplied into the garment's diffuse), rows top first, UV v up. */
  image: RgbaImage;
  /** Standard deviation and mean of the shade over the cloth's texels. */
  deviation: number;
  mean: number;
}

const RAYS = 24;
const AO_DISTANCE = 0.08;
/** The key light of the light bake (Part 2 F16): above, front and left. */
const KEY: [number, number, number] = [-0.45, 0.8, 0.4];

/** Directions of a fixed cosine-weighted hemisphere set around +z (Fibonacci spiral). */
function hemisphere(n: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  const golden = 2.399963229728653;
  for (let i = 0; i < n; i++) {
    const r = Math.sqrt((i + 0.5) / n);
    const a = (i * golden) % TAU;
    out.push([r * cos(a), r * sin(a), Math.sqrt(Math.max(0, 1 - r * r))]);
  }
  return out;
}

export function bakeFolds(drape: DrapeResult, body: ShellBody, islands: readonly IslandPlacement[], size: number): FoldBake {
  const P = drape.positions;
  const N = P.length / 3;
  const tris = drape.tris;
  // Outward normals per rest point (area-weighted, then turned away from the body).
  const nrm = new Float64Array(N * 3);
  for (let t = 0; t < tris.length / 3; t++) {
    const a = tris[t * 3]!;
    const b = tris[t * 3 + 1]!;
    const c = tris[t * 3 + 2]!;
    const ux = P[b * 3]! - P[a * 3]!;
    const uy = P[b * 3 + 1]! - P[a * 3 + 1]!;
    const uz = P[b * 3 + 2]! - P[a * 3 + 2]!;
    const vx = P[c * 3]! - P[a * 3]!;
    const vy = P[c * 3 + 1]! - P[a * 3 + 1]!;
    const vz = P[c * 3 + 2]! - P[a * 3 + 2]!;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) {
      nrm[v * 3] = nrm[v * 3]! + nx;
      nrm[v * 3 + 1] = nrm[v * 3 + 1]! + ny;
      nrm[v * 3 + 2] = nrm[v * 3 + 2]! + nz;
    }
  }
  // Welded points share one normal (the sum over every panel they belong to).
  const sum = new Float64Array(drape.particles * 3);
  for (let i = 0; i < N; i++) for (let k = 0; k < 3; k++) sum[drape.merge[i]! * 3 + k] = sum[drape.merge[i]! * 3 + k]! + nrm[i * 3 + k]!;
  for (let i = 0; i < N; i++) {
    let x = sum[drape.merge[i]! * 3]!;
    let y = sum[drape.merge[i]! * 3 + 1]!;
    let z = sum[drape.merge[i]! * 3 + 2]!;
    const l = Math.sqrt(x * x + y * y + z * z) || 1;
    x /= l;
    y /= l;
    z /= l;
    const r = bodyDistance(body, [P[i * 3]!, P[i * 3 + 1]!, P[i * 3 + 2]!], 0.3);
    const s = r && x * r.n[0] + y * r.n[1] + z * r.n[2] < 0 ? -1 : 1;
    nrm[i * 3] = x * s;
    nrm[i * 3 + 1] = y * s;
    nrm[i * 3 + 2] = z * s;
  }
  // The smooth surface's normal: the normals relaxed over the fine mesh's neighbours.
  const nb: number[][] = Array.from({ length: N }, () => []);
  for (let t = 0; t < tris.length / 3; t++)
    for (let k = 0; k < 3; k++) {
      const a = tris[t * 3 + k]!;
      const b = tris[t * 3 + ((k + 1) % 3)]!;
      nb[a]!.push(b);
      nb[b]!.push(a);
    }
  let smooth = Float64Array.from(nrm);
  for (let pass = 0; pass < 12; pass++) {
    const next = new Float64Array(N * 3);
    for (let i = 0; i < N; i++) {
      let x = smooth[i * 3]!;
      let y = smooth[i * 3 + 1]!;
      let z = smooth[i * 3 + 2]!;
      for (const u of nb[i]!) {
        x += smooth[u * 3]!;
        y += smooth[u * 3 + 1]!;
        z += smooth[u * 3 + 2]!;
      }
      const l = Math.sqrt(x * x + y * y + z * z) || 1;
      next[i * 3] = x / l;
      next[i * 3 + 1] = y / l;
      next[i * 3 + 2] = z / l;
    }
    smooth = next;
  }
  // Occluders: the fine cloth and the body.
  const bodyN = body.bvhPositions.length / 3;
  const occP = new Float64Array((N + bodyN) * 3);
  occP.set(P, 0);
  for (let i = 0; i < bodyN * 3; i++) occP[N * 3 + i] = body.bvhPositions[i]!;
  const occT = new Uint32Array(tris.length + body.bvhTris.length);
  occT.set(tris, 0);
  for (let i = 0; i < body.bvhTris.length; i++) occT[tris.length + i] = body.bvhTris[i]! + N;
  const bvh = new TriangleBVH(occP, occT);
  const dirs = hemisphere(RAYS);
  const kl = Math.sqrt(KEY[0] * KEY[0] + KEY[1] * KEY[1] + KEY[2] * KEY[2]);
  const L: [number, number, number] = [KEY[0] / kl, KEY[1] / kl, KEY[2] / kl];
  const shade = new Float64Array(N);
  const o = [0, 0, 0];
  const d = [0, 0, 0];
  for (let i = 0; i < N; i++) {
    const nx = nrm[i * 3]!;
    const ny = nrm[i * 3 + 1]!;
    const nz = nrm[i * 3 + 2]!;
    // A frame around the normal.
    let tx = ny * 0 - nz * 1;
    let ty = nz * 0 - nx * 0;
    let tz = nx * 1 - ny * 0;
    if (tx * tx + ty * ty + tz * tz < 1e-6) {
      tx = 0;
      ty = nz;
      tz = -ny;
    }
    const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
    tx /= tl;
    ty /= tl;
    tz /= tl;
    const bx = ny * tz - nz * ty;
    const by = nz * tx - nx * tz;
    const bz = nx * ty - ny * tx;
    o[0] = P[i * 3]! + nx * 0.002;
    o[1] = P[i * 3 + 1]! + ny * 0.002;
    o[2] = P[i * 3 + 2]! + nz * 0.002;
    let hit = 0;
    for (const [a, b, c] of dirs) {
      d[0] = tx * a + bx * b + nx * c;
      d[1] = ty * a + by * b + ny * c;
      d[2] = tz * a + bz * b + nz * c;
      if (bvh.raycast(o, d, 0.0005, AO_DISTANCE)) hit++;
    }
    const ao = 1 - hit / RAYS;
    // The fold's light against the smooth surface's.
    const nl = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
    const sl = Math.max(0, smooth[i * 3]! * L[0] + smooth[i * 3 + 1]! * L[1] + smooth[i * 3 + 2]! * L[2]);
    shade[i] = (0.35 + 0.65 * ao) * (1 + 0.5 * (nl - sl));
  }
  // Brightest cloth (95th percentile) maps to white.
  const sorted = Array.from(shade).sort((a, b) => a - b);
  const top = sorted[Math.floor(sorted.length * 0.95)] ?? 1;
  const image = createImage(size, size, [255, 255, 255, 255]);
  const fineByName = new Map(drape.fine.panels.map((p) => [p.name, p]));
  const w = new Float64Array(3);
  let acc = 0;
  let acc2 = 0;
  let count = 0;
  for (const isl of islands) {
    const fp = fineByName.get(isl.panel);
    if (!fp) continue;
    const loc = new TriangleLocator(fp.points, fp.tris);
    // The island's pixels: its pattern points inside (or within the hem allowance of) the panel's outline.
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < fp.count; i++) {
      x0 = Math.min(x0, fp.points[i * 2]!);
      x1 = Math.max(x1, fp.points[i * 2]!);
      y0 = Math.min(y0, fp.points[i * 2 + 1]!);
      y1 = Math.max(y1, fp.points[i * 2 + 1]!);
    }
    const allowance = 1;
    const u0 = (x0 - allowance - isl.minX) * isl.scale + isl.u0;
    const u1 = (x1 + allowance - isl.minX) * isl.scale + isl.u0;
    const v0 = (y0 - allowance - isl.minY) * isl.scale + isl.v0;
    const v1 = (y1 + allowance - isl.minY) * isl.scale + isl.v0;
    const px0 = Math.max(0, Math.floor(u0 * size));
    const px1 = Math.min(size - 1, Math.ceil(u1 * size));
    const py0 = Math.max(0, Math.floor((1 - v1) * size));
    const py1 = Math.min(size - 1, Math.ceil((1 - v0) * size));
    for (let py = py0; py <= py1; py++)
      for (let px = px0; px <= px1; px++) {
        const u = (px + 0.5) / size;
        const v = 1 - (py + 0.5) / size;
        const x = (u - isl.u0) / isl.scale + isl.minX;
        const y = (v - isl.v0) / isl.scale + isl.minY;
        const t = loc.locate(x, y, w);
        if (t < 0) continue;
        let s = 0;
        for (let k = 0; k < 3; k++) s += w[k]! * shade[fp.offset + fp.tris[t * 3 + k]!]!;
        const g = Math.min(1, Math.max(0, s / top));
        const byte = Math.round(255 * g);
        const j = (py * size + px) * 4;
        image.data[j] = byte;
        image.data[j + 1] = byte;
        image.data[j + 2] = byte;
        acc += g;
        acc2 += g * g;
        count++;
      }
  }
  const mean = count ? acc / count : 1;
  return { image, mean, deviation: count ? Math.sqrt(Math.max(0, acc2 / count - mean * mean)) : 0 };
}
