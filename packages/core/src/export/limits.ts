/**
 * Texture sizes the exporter writes (PRD 6.1), shared with the viewport so a
 * texture is previewed no sharper than Unity will show it (PRD F9).
 */

export const HAIR_TEXTURE_LIMIT = 1024;
export const GARMENT_ATLAS_SIZE = 1024;
export const EYES_ATLAS_SIZE = 512;
/** Edge bleed around each atlas cell, in pixels. */
export const ATLAS_PAD = 4;

/** Side of the square a texture gets in an atlas of n parts (see packAtlas). */
export function atlasCellTexels(parts: number, size: number, pad = ATLAS_PAD): number {
  const grid = Math.ceil(Math.sqrt(Math.max(1, parts)));
  return Math.floor(size / grid) - 2 * pad;
}
