/**
 * Head texture split on export (PRD F6): the head gets its own material and
 * texture so the face keeps its detail, and the body uses a second texture.
 *
 * The PRD says to remap head UVs affinely from the head region's bounding box
 * to 0..1. In hm08 the head is four separate UV islands (face/scalp/neck,
 * mouth interior, two eye-socket patches) spread across the layout, so one
 * box would be almost the whole texture. Instead each head island keeps its
 * own affine map (one uniform scale for all, plus a per-island offset) and the
 * islands are packed into the head texture; the head texture is the
 * composited skin cropped island by island to match (DECISIONS D-034).
 */
import type { Ps2BodyMesh } from '../mesh/ps2body';
import { blitResampled, createImage, dilateRgb, resizeImage, sharpen, type RgbaImage } from './image';
import type { SkinLayout } from './layout';

export interface PackedIsland {
  island: number;
  /** Source rectangle in hm08 UV (u0, v0, u1, v1), already grown by the gutter. */
  src: [number, number, number, number];
  /** Destination rectangle in head-texture UV. */
  dst: [number, number, number, number];
}

export interface HeadPacking {
  /** Destination units per source UV unit (the same for every island). */
  scale: number;
  /** Gutter around each island, in head-texture pixels at `size`. */
  padding: number;
  size: number;
  islands: PackedIsland[];
}

/**
 * Pack the head islands into the unit square with the largest uniform scale
 * that fits (shelf packing, tallest first), leaving `padding` pixels between
 * islands and at the borders.
 */
export function packHead(layout: SkinLayout, size = 1024, padding = 8): HeadPacking {
  const heads = layout.islands.filter((i) => i.kind === 'head');
  if (heads.length === 0) throw new Error('skin layout has no head islands');
  const pad = padding / size;
  const order = [...heads].sort((a, b) => b.box[3] - b.box[1] - (a.box[3] - a.box[1]) || a.id - b.id);
  const place = (s: number): PackedIsland[] | null => {
    const out: PackedIsland[] = [];
    let x = pad;
    let y = pad;
    let rowH = 0;
    for (const isl of order) {
      const w = (isl.box[2] - isl.box[0]) * s;
      const h = (isl.box[3] - isl.box[1]) * s;
      if (x + w + pad > 1 + 1e-9) {
        x = pad;
        y += rowH + pad;
        rowH = 0;
      }
      if (x + w + pad > 1 + 1e-9 || y + h + pad > 1 + 1e-9) return null;
      // Grow both rectangles by half the gutter so the crop carries a seam margin.
      const g = pad / 2;
      const gs = g / s;
      out.push({
        island: isl.id,
        src: [isl.box[0] - gs, isl.box[1] - gs, isl.box[2] + gs, isl.box[3] + gs],
        // Destination v grows upwards: rows are placed from the top of the texture (v = 1) down.
        dst: [x - g, 1 - (y + h) - g, x + w + g, 1 - y + g],
      });
      x += w + pad;
      rowH = Math.max(rowH, h);
    }
    return out;
  };
  let lo = 0;
  let hi = 8;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (place(mid)) lo = mid;
    else hi = mid;
  }
  const islands = place(lo)!;
  return { scale: lo, padding, size, islands: islands.sort((a, b) => a.island - b.island) };
}

/** Remap a head UV from hm08 space into the head texture. */
export function remapHeadUv(packed: PackedIsland, scale: number, u: number, v: number): [number, number] {
  const cu = packed.src[0] + (packed.src[2] - packed.src[0]) / 2;
  const cv = packed.src[1] + (packed.src[3] - packed.src[1]) / 2;
  const du = packed.dst[0] + (packed.dst[2] - packed.dst[0]) / 2;
  const dv = packed.dst[1] + (packed.dst[3] - packed.dst[1]) / 2;
  return [du + (u - cu) * scale, dv + (v - cv) * scale];
}

/**
 * The head texture: each head island's rectangle of the composited skin,
 * resampled into its packed place. Texels between islands are filled by
 * dilation so mipmaps do not bleed in black.
 */
export function cropHeadTexture(composite: RgbaImage, packing: HeadPacking, size = packing.size): RgbaImage {
  const out = createImage(size, size, [0, 0, 0, 255]);
  const covered = new Uint8Array(size * size);
  for (const p of packing.islands) {
    const [su0, sv0, su1, sv1] = p.src;
    const [du0, dv0, du1, dv1] = p.dst;
    const sx = su0 * composite.width;
    const sy = (1 - sv1) * composite.height;
    const dx = du0 * size;
    const dy = (1 - dv1) * size;
    const dw = (du1 - du0) * size;
    const dh = (dv1 - dv0) * size;
    blitResampled(composite, sx, sy, (su1 - su0) * composite.width, (sv1 - sv0) * composite.height, out, dx, dy, dw, dh);
    for (let y = Math.max(0, Math.floor(dy)); y < Math.min(size, Math.ceil(dy + dh)); y++)
      for (let x = Math.max(0, Math.floor(dx)); x < Math.min(size, Math.ceil(dx + dw)); x++) covered[y * size + x] = 1;
  }
  dilateRgb(out, covered, 4);
  return out;
}

/** The body texture: the whole composite downscaled (box filter) with a mild sharpen. */
export function bodyTexture(composite: RgbaImage, size = 1024): RgbaImage {
  return sharpen(resizeImage(composite, size, size));
}

/** The PS2 body split into the head and body materials. */
export interface SplitBody {
  /** Triangle indices (into the PS2 body's render vertices) of each material. */
  headIndices: Uint32Array;
  bodyIndices: Uint32Array;
  /** Per render vertex: UV in its material's texture (head vertices remapped into the head texture). */
  uvs: Float32Array;
  /** Per render vertex: 1 if it belongs to the head material. */
  isHead: Uint8Array;
}

/**
 * Assign every PS2 body triangle to the head or the body material by the UV
 * island of its corners, and remap head UVs into the head texture. Throws if
 * a triangle spans two islands (simplification keeps UV seams, D-007).
 */
export function splitBody(mesh: Pick<Ps2BodyMesh, 'sourceVertex' | 'uvs' | 'indices'>, layout: SkinLayout, packing: HeadPacking): SplitBody {
  const nv = mesh.sourceVertex.length;
  const vertexIslands: number[][] = [];
  for (let i = 0; i < nv; i++) vertexIslands.push(layout.islandsOfCorner(mesh.sourceVertex[i]!, mesh.uvs[i * 2]!, mesh.uvs[i * 2 + 1]!));
  const islandOfVertex = new Int32Array(nv).fill(-1);
  const head: number[] = [];
  const body: number[] = [];
  const packedOf = new Map(packing.islands.map((p) => [p.island, p]));
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const corners = [mesh.indices[t]!, mesh.indices[t + 1]!, mesh.indices[t + 2]!];
    const shared = vertexIslands[corners[0]!]!.filter((i) => corners.every((c) => vertexIslands[c]!.includes(i)));
    if (shared.length === 0) throw new Error(`PS2 body triangle ${t / 3} spans several UV islands`);
    const island = shared[0]!;
    for (const c of corners) {
      if (islandOfVertex[c] !== -1 && islandOfVertex[c] !== island) throw new Error(`render vertex ${c} is used by two UV islands`);
      islandOfVertex[c] = island;
    }
    (layout.islands[island]!.kind === 'head' ? head : body).push(...corners);
  }
  const uvs = new Float32Array(mesh.uvs);
  const isHead = new Uint8Array(nv);
  for (let i = 0; i < nv; i++) {
    const p = packedOf.get(islandOfVertex[i]!);
    if (!p) continue;
    const [u, v] = remapHeadUv(p, packing.scale, mesh.uvs[i * 2]!, mesh.uvs[i * 2 + 1]!);
    uvs[i * 2] = u;
    uvs[i * 2 + 1] = v;
    isHead[i] = 1;
  }
  return { headIndices: Uint32Array.from(head), bodyIndices: Uint32Array.from(body), uvs, isHead };
}
