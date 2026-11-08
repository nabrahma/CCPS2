/**
 * Texture atlases for merged material groups (PRD 6.1/6.2: garments merged
 * into one SkinnedMeshRenderer, eyes + brows + lashes into another, at most 5
 * draw calls). Each part's texture is resampled into a square grid cell with a
 * padded border, and its UVs are mapped into the cell's inner area.
 */
import { blitResampled, createImage, type RgbaImage } from '../skin/image';

export interface AtlasCell {
  /** Inner area in UV (u0, v0, u1, v1); part UVs 0..1 map onto it. */
  uv: [number, number, number, number];
}

export interface Atlas {
  image: RgbaImage;
  cells: AtlasCell[];
}

/** Pack images into a size x size atlas (grid of ceil(sqrt(n)) cells, `pad` pixels of edge bleed per cell). */
export function packAtlas(images: RgbaImage[], size: number, pad = 4): Atlas {
  const n = Math.max(1, images.length);
  const grid = Math.ceil(Math.sqrt(n));
  const cell = Math.floor(size / grid);
  const out = createImage(size, size, [255, 255, 255, 255]);
  const cells: AtlasCell[] = [];
  images.forEach((img, i) => {
    const cx = (i % grid) * cell;
    const cy = Math.floor(i / grid) * cell;
    const inner = cell - 2 * pad;
    // Bleed: draw the image over the whole cell (edges clamp), the inner area holds the exact mapping.
    blitResampled(img, -pad * (img.width / inner), -pad * (img.height / inner), img.width * (cell / inner), img.height * (cell / inner), out, cx, cy, cell, cell);
    const u0 = (cx + pad) / size;
    const u1 = (cx + pad + inner) / size;
    // Image rows run down from v = 1.
    const v1 = 1 - (cy + pad) / size;
    const v0 = 1 - (cy + pad + inner) / size;
    cells.push({ uv: [u0, v0, u1, v1] });
  });
  return { image: out, cells };
}

/** Map a part UV (clamped to 0..1) into its atlas cell. */
export function atlasUv(cell: AtlasCell, u: number, v: number): [number, number] {
  const cu = Math.min(1, Math.max(0, u));
  const cv = Math.min(1, Math.max(0, v));
  return [cell.uv[0] + cu * (cell.uv[2] - cell.uv[0]), cell.uv[1] + cv * (cell.uv[3] - cell.uv[1])];
}
