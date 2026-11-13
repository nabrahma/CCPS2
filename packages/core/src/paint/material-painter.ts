/**
 * Texture Studio through Material Painter (PRD Part 2 F17, D-115).
 *
 * Painting happens in Material Painter, a GPL-3.0 PBR texture painter run
 * as its own program. PS2CC hands it a mesh with its UVs and the texture the
 * character has now, as a locked reference fill layer; the artist paints on
 * layers above it; PS2CC takes the base colour back.
 *
 * - Skin: the mesh is hm08 with its own UVs, so the paint is in hm08 UV space,
 *   which never changes with morphs. It comes back as an image layer of the
 *   skin stack holding only what was painted (texels that differ from the
 *   reference), so the layers under it stay live.
 * - Garments: the garment with its own UVs; the result becomes the garment's
 *   texture.
 *
 * With the reference fill's variation off, Material Painter gives back the
 * reference exactly where nothing was painted (measured: 0 of 262,144 texels
 * differ), so "differs from the reference" is exactly "painted".
 */
import type { CharacterDoc, SkinLayer } from '../character/doc';
import type { BaseMesh } from '../mesh/basemesh';
import { createImage, resizeImage, type RgbaImage } from '../skin/image';
import { newLayer } from '../skin/layers';

/** Document sizes Material Painter accepts. */
export const PAINT_SIZES = [512, 1024, 2048, 4096] as const;

/** Material Painter's document size for a texture: the smallest size it accepts that holds the texture (at most 4096). */
export function paintSize(width: number, height: number): number {
  const n = Math.max(width, height);
  return PAINT_SIZES.find((s) => s >= n) ?? 4096;
}

/** What a paint session is for: the skin, or one worn garment (by slot). */
export type PaintTarget = 'skin' | `garment:${string}`;

/** The skin layer holding Material Painter's paint has an id starting with this (ids survive saving). */
export const PAINTED_LAYER_PREFIX = 'painted-';

/** The skin's painted layer, if it has one. */
export function paintedSkinLayer(doc: Readonly<CharacterDoc>): SkinLayer | undefined {
  return doc.skin.layers.find((l) => l.kind === 'image' && l.id.startsWith(PAINTED_LAYER_PREFIX));
}

/**
 * Put Material Painter's paint into a document as one edit: the skin's painted
 * layer gets the new image (a new layer on top the first time); a garment
 * gets it as its paint texture, over its own texture.
 */
export function applyPaint(doc: CharacterDoc, target: PaintTarget, imageUrl: string): void {
  if (target === 'skin') {
    const layer = paintedSkinLayer(doc);
    if (layer) layer.image = imageUrl;
    else doc.skin.layers.push({ ...newLayer('image', { image: imageUrl }), id: `${PAINTED_LAYER_PREFIX}${Date.now().toString(36)}` });
    return;
  }
  const slot = target.slice('garment:'.length);
  const g = doc.garments.find((x) => x.slot === slot);
  if (!g) throw new Error(`no garment in the ${slot} slot`);
  g.paint = imageUrl;
}

/** Keep a reference's alpha in the painted texture (garments: paint changes colour, not cut-outs). */
export function withAlphaOf(painted: RgbaImage, reference: RgbaImage): RgbaImage {
  const p = painted.width === reference.width && painted.height === reference.height ? painted : resizeImage(painted, reference.width, reference.height);
  const out = { width: p.width, height: p.height, data: new Uint8ClampedArray(p.data) };
  for (let i = 3; i < out.data.length; i += 4) out.data[i] = reference.data[i]!;
  return out;
}

/**
 * A mesh as Wavefront OBJ for Material Painter: positions, one UV per vertex
 * (v up, as OBJ and three.js use), triangles, one material.
 */
export function meshObj(name: string, positions: ArrayLike<number>, uvs: ArrayLike<number>, indices: ArrayLike<number>): string {
  const safe = name.replace(/[^\w-]/g, '_') || 'mesh';
  const lines = [`# PS2CC: ${safe} for painting in Material Painter`, `o ${safe}`];
  const n = positions.length / 3;
  for (let v = 0; v < n; v++) lines.push(`v ${fmt(positions[v * 3]!)} ${fmt(positions[v * 3 + 1]!)} ${fmt(positions[v * 3 + 2]!)}`);
  for (let v = 0; v < n; v++) lines.push(`vt ${fmt(uvs[v * 2]!)} ${fmt(uvs[v * 2 + 1]!)}`);
  lines.push(`usemtl ${safe}`);
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const a = indices[t]! + 1;
    const b = indices[t + 1]! + 1;
    const c = indices[t + 2]! + 1;
    lines.push(`f ${a}/${a} ${b}/${b} ${c}/${c}`);
  }
  return lines.join('\n') + '\n';
}

/**
 * The skin's mesh for painting: hm08's body faces (no eyes, teeth or helpers)
 * at the character's current shape, with hm08's UVs, so the paint lands in the
 * space the skin stack composites in.
 */
export function skinObj(base: BaseMesh, positions: ArrayLike<number>): string {
  const faces = base.facesWhere((g) => g === 'body');
  const lines = ['# PS2CC: skin for painting in Material Painter (hm08 UVs)', 'o skin'];
  let vertices = 0;
  for (const f of faces) for (let k = 0; k < 4; k++) vertices = Math.max(vertices, base.faceVerts[f * 4 + k]! + 1);
  for (let v = 0; v < vertices; v++) lines.push(`v ${fmt(positions[v * 3]!)} ${fmt(positions[v * 3 + 1]!)} ${fmt(positions[v * 3 + 2]!)}`);
  for (let t = 0; t < base.uvs.length / 2; t++) lines.push(`vt ${fmt(base.uvs[t * 2]!)} ${fmt(base.uvs[t * 2 + 1]!)}`);
  lines.push('usemtl skin');
  for (const f of faces) {
    const corner = (k: number) => `${base.faceVerts[f * 4 + k]! + 1}/${base.faceUvs[f * 4 + k]! + 1}`;
    lines.push(base.faceVerts[f * 4 + 3] === base.faceVerts[f * 4 + 2] ? `f ${corner(0)} ${corner(1)} ${corner(2)}` : `f ${corner(0)} ${corner(1)} ${corner(2)} ${corner(3)}`);
  }
  return lines.join('\n') + '\n';
}

/**
 * What was painted: Material Painter's base colour where it differs from the
 * reference it was given (opaque), nothing elsewhere. Composited over the
 * reference with normal blending, it gives the painted texture back exactly.
 * The painted image is resized to the reference first if their sizes differ.
 */
export function paintedLayer(reference: RgbaImage, painted: RgbaImage): { image: RgbaImage; texels: number } {
  const p = painted.width === reference.width && painted.height === reference.height ? painted : resizeImage(painted, reference.width, reference.height);
  const out = createImage(reference.width, reference.height, [0, 0, 0, 0]);
  const r = reference.data;
  const s = p.data;
  const o = out.data;
  let texels = 0;
  for (let i = 0; i < r.length; i += 4) {
    if (r[i] === s[i] && r[i + 1] === s[i + 1] && r[i + 2] === s[i + 2]) continue;
    o[i] = s[i]!;
    o[i + 1] = s[i + 1]!;
    o[i + 2] = s[i + 2]!;
    o[i + 3] = 255;
    texels++;
  }
  return { image: out, texels };
}

/** An image made opaque (Material Painter's reference fill: the alpha would otherwise be read as opacity). */
export function opaque(img: RgbaImage): RgbaImage {
  const out = { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
  for (let i = 3; i < out.data.length; i += 4) out.data[i] = 255;
  return out;
}

const fmt = (v: number) => (Math.abs(v) < 5e-7 ? '0' : v.toFixed(6));
