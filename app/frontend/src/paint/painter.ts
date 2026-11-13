/**
 * Texture Studio through Material Painter (PRD Part 2 F17, D-115): send a
 * target (the skin, or a worn garment) to Material Painter with the texture to
 * paint over, and take the paint back as one undo step.
 *
 * - Skin: the reference is the skin composited without its painted layer
 *   (everything under the paint), on hm08 with its UVs; what comes back is
 *   only the painted texels, as the skin's painted layer.
 * - Garment: the reference is the garment's own texture (without earlier
 *   paint), on the garment with its UVs; what comes back is the whole painted
 *   texture with the garment's alpha, as its paint texture.
 */
import {
  applyPaint,
  opaque,
  paintedLayer,
  paintedSkinLayer,
  paintSize,
  meshObj,
  resizeImage,
  skinObj,
  withAlphaOf,
  type PaintTarget,
  type RgbaImage,
} from '@ps2cc/core';
import { backend, libraryUrl } from '../backend';
import { imageToPng } from '../images';
import type { Studio } from '../state/studio';

/** The scene part of a worn garment, by slot. */
function garmentPart(studio: Studio, slot: string) {
  const part = studio.scene.parts.find((p) => p.key.startsWith(`garment:${slot}:`));
  if (!part) throw new Error(`no garment in the ${slot} slot`);
  return part;
}

/** The garment's own texture (its override, else the asset's), without any paint. */
async function garmentTexture(studio: Studio, slot: string): Promise<string> {
  const g = studio.engine.doc.garments.find((x) => x.slot === slot);
  if (!g) throw new Error(`no garment in the ${slot} slot`);
  const path = g.texture ?? (await studio.engine.assets.proxy(g.asset)).meta.material?.diffuseTexture ?? null;
  if (!path) throw new Error('this garment has no texture to paint over');
  return path;
}

function square(img: RgbaImage): RgbaImage {
  const n = paintSize(img.width, img.height);
  return img.width === n && img.height === n ? img : resizeImage(img, n, n);
}

/** Send a target to Material Painter (starting it if needed). */
export async function openInPainter(studio: Studio, target: PaintTarget): Promise<void> {
  const vp = studio.viewport;
  if (!vp) throw new Error('the viewport is not ready');
  await studio.settled();
  const doc = studio.engine.doc;
  let obj: string;
  let reference: RgbaImage;
  if (target === 'skin') {
    const layer = paintedSkinLayer(doc);
    const skin = await vp.skinCompositeWithout(layer ? [layer.id] : []);
    if (!skin) throw new Error('the skin has no texture to paint over');
    reference = opaque(square(skin));
    obj = skinObj(studio.engine.assets.base, studio.engine.positions);
  } else {
    const slot = target.slice('garment:'.length);
    const part = garmentPart(studio, slot);
    reference = square(await vp.texturePixels(await garmentTexture(studio, slot)));
    obj = meshObj(slot, part.positions, part.uvs, part.indices);
  }
  await backend.painterOpen(doc.name, target, obj, await imageToPng(opaque(reference)), reference.width);
}

/** Take the paint back from Material Painter into the document (one undo step). Returns how many texels were painted. */
export async function bringPaintBack(studio: Studio, target: PaintTarget): Promise<number> {
  const doc = studio.engine.doc;
  const res = await backend.painterCollect(doc.name, target);
  const [painted, reference] = await Promise.all([decodeBase64Png(res.painted), decodeBase64Png(res.reference)]);
  const info = await backend.info();
  const name = `${doc.name || 'character'}_${target.replace(':', '_')}_painted.png`.replace(/[^\w.-]/g, '_');
  let image: RgbaImage;
  let texels: number;
  let kind: string;
  if (target === 'skin') {
    ({ image, texels } = paintedLayer(reference, painted));
    kind = 'overlays';
  } else {
    texels = paintedLayer(reference, painted).texels;
    // The garment's own alpha (its texture may be a cut-out); the reference was sent opaque.
    const slot = target.slice('garment:'.length);
    const own = square(await studio.viewport!.texturePixels(await garmentTexture(studio, slot)));
    image = withAlphaOf(painted, own);
    kind = 'garment-textures';
  }
  if (texels === 0) return 0;
  const item = await backend.importFile(kind, new File([await imageToPng(image)], name, { type: 'image/png' }));
  const url = libraryUrl(info, item.file);
  studio.engine.update(target === 'skin' ? 'Paint the skin in Material Painter' : 'Paint the garment in Material Painter', (d) => applyPaint(d, target, url));
  return texels;
}

async function decodeBase64Png(b64: string): Promise<RgbaImage> {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2D canvas is not available');
    ctx.drawImage(bitmap, 0, 0);
    return { width: bitmap.width, height: bitmap.height, data: new Uint8ClampedArray(ctx.getImageData(0, 0, bitmap.width, bitmap.height).data) };
  } finally {
    bitmap.close();
  }
}

/** What a backend error means for the UI. */
export function painterProblem(err: unknown): { code: 'not-found' | 'agents-off' | 'no-answer' | 'not-running' | null; message: string } {
  const text = err instanceof Error ? err.message : String(err);
  const m = /material-painter:([a-z-]+): (.*)/.exec(text);
  if (!m) return { code: null, message: text };
  const code = m[1] as 'not-found' | 'agents-off' | 'no-answer' | 'not-running';
  return { code, message: m[2]! };
}
