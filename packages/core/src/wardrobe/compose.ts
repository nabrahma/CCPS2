/**
 * The garment texture (Part 2 F18): material zones tiled at their real size,
 * worn edges, seam shadows and stitches, decals and folds, composed into the
 * one diffuse the garment exports with. Pure TypeScript: the viewport and the
 * exporter compose the same image.
 */
import { createImage, sampleBilinear, type RgbaImage } from '../skin/image';
import { sampleWrap } from '../skin/detail';
import { fbm, smoothstep } from '../skin/noise';
import { sampleDecal, decalReachMm, type DecalSample } from './decals';
import { foldShade, type FoldFrame } from './folds';
import { decodeMask, LINE_DECALS, type GarmentLook, type MaterialZone } from './look';
import { mipFor, type CatalogMaterial } from './material';
import { garmentSeams, rasterSurface, uvIslands, type GarmentSurface, type SeamSegment, type SurfaceRaster, type UvIslands } from './surface';

export interface GarmentCanvas {
  surface: GarmentSurface;
  islands: UvIslands;
  seams: SeamSegment[];
  raster: SurfaceRaster;
  /** Garment-to-skin distance per triangle (metres), for folds. */
  gapOfTriangle: Float32Array;
  frames: FoldFrame[];
  /** Per texel: distance to the nearest seam or hem on the same island (metres, Infinity if none within the band). */
  seamDistance: Float32Array;
  /** Per texel: 1 seam, 2 hem, 0 none. */
  seamKind: Uint8Array;
  /** Per texel: position along the nearest seam (metres), for spacing stitches. */
  seamAlong: Float32Array;
}

/** Distance from a seam within which seams shade, stitch and wear the cloth. */
const SEAM_BAND = 0.02;

/**
 * Everything about a garment's texture that does not depend on its look:
 * islands, seams, the raster and the seam distance field. `gap` is the
 * garment-to-skin distance per geometry vertex (null: treat as loose).
 */
export function prepareGarment(surface: GarmentSurface, size: number, frames: FoldFrame[], gap: Float32Array | null): GarmentCanvas {
  const islands = uvIslands(surface);
  const seams = garmentSeams(surface, islands);
  const raster = rasterSurface(surface, islands, size);
  const T = surface.indices.length / 3;
  const gapOfTriangle = new Float32Array(T).fill(0.02);
  if (gap)
    for (let t = 0; t < T; t++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += gap[surface.sourceVertex[surface.indices[t * 3 + k]!]!]!;
      gapOfTriangle[t] = s / 3;
    }
  const n = size * size;
  const seamDistance = new Float32Array(n).fill(Infinity);
  const seamKind = new Uint8Array(n);
  const seamAlong = new Float32Array(n);
  for (const seg of seams) {
    const upm = islands.uvPerMetre[seg.island]!;
    const bandUv = SEAM_BAND * upm;
    const du = seg.b[0] - seg.a[0];
    const dv = seg.b[1] - seg.a[1];
    const len2 = du * du + dv * dv;
    const x0 = Math.max(0, Math.floor((Math.min(seg.a[0], seg.b[0]) - bandUv) * size));
    const x1 = Math.min(size - 1, Math.ceil((Math.max(seg.a[0], seg.b[0]) + bandUv) * size));
    const y0 = Math.max(0, Math.floor((1 - Math.max(seg.a[1], seg.b[1]) - bandUv) * size));
    const y1 = Math.min(size - 1, Math.ceil((1 - Math.min(seg.a[1], seg.b[1]) + bandUv) * size));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = y * size + x;
        if (raster.island[i] !== seg.island) continue;
        const u = (x + 0.5) / size - seg.a[0];
        const v = 1 - (y + 0.5) / size - seg.a[1];
        // Only the cloth side of the edge.
        if (u * seg.inward[0] + v * seg.inward[1] < -0.5 / size) continue;
        const t = Math.max(0, Math.min(1, (u * du + v * dv) / len2));
        const d = Math.hypot(u - t * du, v - t * dv) / upm;
        if (d < seamDistance[i]!) {
          seamDistance[i] = d;
          seamKind[i] = seg.kind === 'seam' ? 1 : 2;
          const p = raster.position;
          seamAlong[i] = p[i * 3]! * seg.dir3[0] + p[i * 3 + 1]! * seg.dir3[1] + p[i * 3 + 2]! * seg.dir3[2];
        }
      }
  }
  return { surface, islands, seams, raster, gapOfTriangle, frames, seamDistance, seamKind, seamAlong };
}

export interface MaterialSource {
  info: CatalogMaterial;
  /** Mip chain of the era diffuse (tileMips). */
  mips: RgbaImage[];
}

export interface ComposeSources {
  /** The garment's own texture (zones with no material), or null for plain white. */
  base: RgbaImage | null;
  material: (id: string) => MaterialSource | null;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Zone per island: named islands go to their zone (later zones win), the rest to the 'rest' zone. */
function zoneOfIslands(zones: readonly MaterialZone[], count: number): Int32Array {
  const out = new Int32Array(count).fill(-1);
  const rest = zones.findIndex((z) => z.islands === 'rest');
  if (rest >= 0) out.fill(rest);
  zones.forEach((z, zi) => {
    if (z.islands === 'rest') return;
    for (const i of z.islands) if (i >= 0 && i < count) out[i] = zi;
  });
  return out;
}

/** Compose the garment's diffuse at the canvas's size. */
export function composeGarment(canvas: GarmentCanvas, look: GarmentLook, src: ComposeSources): RgbaImage {
  const { raster, islands } = canvas;
  const size = raster.size;
  const n = size * size;
  const out = createImage(size, size);
  const col = new Float32Array(n * 3);
  const zoneOf = zoneOfIslands(look.zones, islands.count);
  const mask = look.mask ? decodeMask(look.mask) : null;
  const ms = look.mask?.size ?? 0;
  const tmp = [0, 0, 0, 0];
  // The mip of each zone's material per island, chosen by how many texels one tile spans there.
  const mipCache = new Map<number, RgbaImage | null>();
  const mats = look.zones.map((z) => (z.material ? src.material(z.material) : null));
  const medianUpm = [...islands.uvPerMetre].sort((a, b) => a - b)[Math.floor(islands.count / 2)] ?? 1;
  const pxMm = 1000 / (medianUpm * size);
  for (let i = 0; i < n; i++) {
    const x = i % size;
    const y = (i - x) / size;
    const u = (x + 0.5) / size;
    const v = 1 - (y + 0.5) / size;
    const isl = raster.island[i]!;
    let zi = isl >= 0 ? zoneOf[isl]! : -1;
    if (mask && isl >= 0) {
      const m = mask[Math.min(ms - 1, Math.floor((y / size) * ms)) * ms + Math.min(ms - 1, Math.floor((x / size) * ms))]!;
      if (m > 0 && m <= look.zones.length) zi = m - 1;
    }
    const zone = zi >= 0 ? look.zones[zi]! : null;
    const mat = zi >= 0 ? mats[zi] : null;
    let alpha = 255;
    if (src.base) {
      sampleBilinear(src.base, u, v, tmp);
      alpha = tmp[3]!;
    } else tmp[0] = tmp[1] = tmp[2] = 255;
    if (zone && mat && isl >= 0) {
      const upm = islands.uvPerMetre[isl]!;
      const tileUv = mat.info.tileMetres * zone.scale * upm;
      const key = zi * 100000 + isl;
      let mip = mipCache.get(key);
      if (mip === undefined) mipCache.set(key, (mip = mipFor(mat.mips, tileUv * size)));
      const a = (zone.rotation * Math.PI) / 180;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const tu = (u * ca - v * sa) / tileUv;
      const tv = (u * sa + v * ca) / tileUv;
      sampleWrap(mip!, tu, tv, tmp);
    }
    const tint = zone?.tint ?? [1, 1, 1];
    let r = (tmp[0]! / 255) * tint[0];
    let g = (tmp[1]! / 255) * tint[1];
    let b = (tmp[2]! / 255) * tint[2];
    const d = canvas.seamDistance[i]!;
    // Worn edges: scuffed lighter and greyer along seams and hems, and a little all over.
    if (zone && zone.wear > 0 && isl >= 0) {
      const p = raster.position;
      const px = p[i * 3]!;
      const py = p[i * 3 + 1]!;
      const pz = p[i * 3 + 2]!;
      const edge = Number.isFinite(d) ? Math.exp(-d / 0.006) : 0;
      let scuff = zone.wear * 0.25 * smoothstep(0.6, 0.9, fbm(px * 9, py * 9, pz * 9, 77));
      if (edge > 0.02) scuff += zone.wear * edge * 1.2 * smoothstep(0.3, 0.75, fbm(px * 60, py * 60, pz * 60, 31));
      scuff = clamp01(scuff);
      const lum = 0.3 * r + 0.59 * g + 0.11 * b;
      const worn = Math.min(1, lum * 1.25 + 0.06);
      r += (worn - r) * scuff;
      g += (worn - g) * scuff;
      b += (worn - b) * scuff;
    }
    // Seams: a shadowed valley with a lit ridge beside it; hems: the turned edge.
    const s = look.seams;
    if (Number.isFinite(d) && isl >= 0) {
      const kind = canvas.seamKind[i]!;
      let shade: number;
      if (kind === 1) shade = 1 - s.shadow * 0.4 * Math.exp(-d / 0.0025) + s.shadow * 0.08 * Math.exp(-(((d - 0.006) / 0.002) ** 2));
      else shade = 1 - s.shadow * 0.3 * Math.exp(-d / 0.0018) + s.shadow * 0.06 * Math.exp(-(((d - 0.003) / 0.0015) ** 2));
      r *= shade;
      g *= shade;
      b *= shade;
      if (s.stitches > 0) {
        const rows = kind === 1 ? [0.0035] : s.hemRows === 2 ? [0.005, 0.011] : [0.006];
        const tw = Math.max(0.0008, (pxMm / 1000) * 0.9);
        let cov = 0;
        for (const off of rows) cov = Math.max(cov, clamp01((tw / 2 - Math.abs(d - off)) / (pxMm / 1000) + 0.5));
        const along = canvas.seamAlong[i]! / (s.spacingMm / 1000);
        const on = ((along % 1) + 1) % 1 < 0.62 ? 1 : 0;
        const k = cov * on * s.stitches;
        if (k > 0) {
          const lum = 0.3 * r + 0.59 * g + 0.11 * b;
          const thread = s.thread ?? (lum < 0.45 ? [r + (1 - r) * 0.35, g + (1 - g) * 0.33, b + (1 - b) * 0.3] : [r * 0.6, g * 0.58, b * 0.55]);
          r += (thread[0]! - r) * k;
          g += (thread[1]! - g) * k;
          b += (thread[2]! - b) * k;
        }
      }
    }
    col[i * 3] = r;
    col[i * 3 + 1] = g;
    col[i * 3 + 2] = b;
    out.data[i * 4 + 3] = alpha;
  }
  // Decals, each in its own frame on the island under its centre.
  const ds: DecalSample = { r: 0, g: 0, b: 0, a: 0, shade: 1 };
  for (const dec of look.decals) {
    const cx = Math.min(size - 1, Math.max(0, Math.floor(dec.uv[0] * size)));
    const cy = Math.min(size - 1, Math.max(0, Math.floor((1 - dec.uv[1]) * size)));
    const isl = raster.island[cy * size + cx]!;
    // A decal off the cloth has nothing to sit on.
    if (isl < 0) continue;
    const upm = islands.uvPerMetre[isl]!;
    const mmToUv = upm / 1000;
    let ax: [number, number];
    let ay: [number, number];
    let lengthMm = 0;
    if (LINE_DECALS.has(dec.kind) && dec.uv2) {
      const du = dec.uv2[0] - dec.uv[0];
      const dv = dec.uv2[1] - dec.uv[1];
      const l = Math.hypot(du, dv) || 1e-6;
      ay = [du / l, dv / l];
      ax = [ay[1], -ay[0]];
      lengthMm = l / mmToUv;
    } else {
      const a = (dec.rotation * Math.PI) / 180;
      ax = [Math.cos(a), Math.sin(a)];
      ay = [-Math.sin(a), Math.cos(a)];
    }
    const reach = decalReachMm(dec, lengthMm) * mmToUv;
    const midU = LINE_DECALS.has(dec.kind) && dec.uv2 ? (dec.uv[0] + dec.uv2[0]) / 2 : dec.uv[0];
    const midV = LINE_DECALS.has(dec.kind) && dec.uv2 ? (dec.uv[1] + dec.uv2[1]) / 2 : dec.uv[1];
    const x0 = Math.max(0, Math.floor((midU - reach) * size));
    const x1 = Math.min(size - 1, Math.ceil((midU + reach) * size));
    const y0 = Math.max(0, Math.floor((1 - midV - reach) * size));
    const y1 = Math.min(size - 1, Math.ceil((1 - midV + reach) * size));
    const px = 1000 / (upm * size);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = y * size + x;
        if (raster.island[i] !== isl) continue;
        const du = (x + 0.5) / size - dec.uv[0];
        const dv = 1 - (y + 0.5) / size - dec.uv[1];
        const lx = (du * ax[0] + dv * ax[1]) / mmToUv;
        const ly = (du * ay[0] + dv * ay[1]) / mmToUv;
        sampleDecal(dec, lx, ly, px, lengthMm, ds);
        if (ds.a <= 0 && ds.shade === 1) continue;
        for (let c = 0; c < 3; c++) {
          const under = col[i * 3 + c]! * ds.shade;
          const over = c === 0 ? ds.r : c === 1 ? ds.g : ds.b;
          col[i * 3 + c] = under + (over * Math.min(1, 0.3 + ds.shade * 0.7) - under) * ds.a;
        }
      }
  }
  // Folds over everything painted.
  const fold = look.folds;
  const P = raster.position;
  const pt = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    let k = 1;
    const tri = raster.triangle[i]!;
    if (tri >= 0 && fold.strength > 0) {
      pt[0] = P[i * 3]!;
      pt[1] = P[i * 3 + 1]!;
      pt[2] = P[i * 3 + 2]!;
      k = foldShade(pt, canvas.gapOfTriangle[tri]!, canvas.frames, fold);
    }
    for (let c = 0; c < 3; c++) out.data[i * 4 + c] = Math.round(255 * clamp01(col[i * 3 + c]! * k));
  }
  return out;
}

/** Seams and hems of a garment, measured on the body (for the UI and the seam test). */
export function seamSummary(surface: GarmentSurface): { islands: number; seamMetres: number; hemMetres: number; segments: number } {
  const islands = uvIslands(surface);
  const seams = garmentSeams(surface, islands);
  let seamMetres = 0;
  let hemMetres = 0;
  for (const s of seams) {
    if (s.kind === 'seam') seamMetres += s.length / 2;
    else hemMetres += s.length;
  }
  return { islands: islands.count, seamMetres, hemMetres, segments: seams.length };
}
