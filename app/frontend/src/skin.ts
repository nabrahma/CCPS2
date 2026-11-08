/**
 * Skin stack actions for the UI (PRD F6, F7): apply a face photo, and export
 * the skin UV template, the face region guide and the head/body textures.
 */
import {
  bodyTexture,
  anglesFromMatrix,
  checkPhoto,
  cropHeadTexture,
  faceFeatures,
  fitFaceToPhoto,
  packHead,
  regionGuide,
  renderUvTemplate,
  type PhotoCheck,
  type RgbaImage,
} from '@ps2cc/core';
import { resolveAssetUrl, type FrontView } from '@ps2cc/viewport';
import { backend } from './backend';
import { canvasToPng, decodeImage, imageToCanvas, imageToPng, loadImageElement } from './images';
import { detectLandmarks } from './photo/landmarker';
import type { Studio } from './state/studio';
import { useUi } from './state/ui';

export const SKIN_TEMPLATE_SIZE = 2048;

/**
 * Find the face in a photo and put it on the character (PRD F7). Returns the
 * frontal-pose and lighting check; throws when no face is found.
 * `cancelled()` is polled between steps so the user can abandon a slow detection.
 */
export async function applyPhoto(studio: Studio, url: string, cancelled: () => boolean = () => false): Promise<PhotoCheck | null> {
  const img = await loadImageElement(url);
  const found = await detectLandmarks(studio.info.coreAssetsUrl, img);
  if (cancelled()) return null;
  if (!found) throw new Error('No face was found in the photo. Use a front-facing photo with the whole face visible.');
  const pixels = await decodeImage(url);
  const check = checkPhoto(pixels, found.points, found.matrix ? anglesFromMatrix(found.matrix) : undefined);
  if (cancelled()) return null;
  studio.engine.update('Face photo', (d) => {
    d.skin.photo = {
      image: url,
      strength: d.skin.photo?.strength ?? 1,
      colourMatch: d.skin.photo?.colourMatch ?? true,
      landmarks: found.points.map((x) => Math.round(x * 1e6) / 1e6),
      width: found.width,
      height: found.height,
    };
  });
  return check;
}

let photoRun = 0;

/**
 * Place a photo with progress in the UI (Skin panel status). A newer call or
 * cancelPhoto() abandons a running one.
 */
export async function placePhoto(studio: Studio, url: string): Promise<void> {
  const run = ++photoRun;
  const stale = () => run !== photoRun;
  useUi.getState().setPhoto({ image: url, busy: 'Finding the face…', check: null });
  try {
    const check = await applyPhoto(studio, url, stale);
    if (stale() || !check) return;
    useUi.getState().setPhoto({ image: url, busy: 'Projecting onto the head…', check });
    await studio.settled();
    if (stale()) return;
    useUi.getState().setPhoto({ image: url, busy: null, check });
  } catch (err) {
    if (stale()) return;
    useUi.getState().setPhoto(null);
    useUi.getState().error('Could not use the photo', err);
  }
}

/** Abandon a running photo placement (and drop the photo if it was already applied). */
export function cancelPhoto(studio: Studio): void {
  const status = useUi.getState().photo;
  photoRun++;
  useUi.getState().setPhoto(null);
  if (status && studio.engine.doc.skin.photo?.image === status.image) studio.engine.update('Remove face photo', (d) => void (d.skin.photo = null));
}

/**
 * Optional "Fit face shape to photo" (PRD F7 step 6): move the face sliders
 * towards the photo's proportions, as one undo step. The projection follows
 * by itself because it depends on the head's shape.
 */
export async function fitFaceShape(studio: Studio): Promise<{ before: number; after: number }> {
  const engine = studio.engine;
  const photo = engine.doc.skin.photo;
  if (!photo?.landmarks || !photo.width || !photo.height) throw new Error('Place a face photo first.');
  const table = await studio.assets.landmarkTable();
  if (!table) throw new Error('The landmark table is missing from this build.');
  const fit = fitFaceToPhoto({
    assets: studio.assets,
    macros: engine.doc.macros,
    modifiers: engine.doc.modifiers,
    table,
    landmarks: photo.landmarks,
    width: photo.width,
    height: photo.height,
  });
  engine.update('Fit face to photo', (d) => void Object.assign(d.modifiers, fit.modifiers));
  await studio.settled();
  return { before: fit.errorBefore, after: fit.errorAfter };
}

/** A square front view around the current head (eyes to chin, with margin), in character space. */
export function faceView(studio: Studio): FrontView {
  const composer = studio.assets.skinComposer;
  const f = faceFeatures(studio.assets.base, composer.layout, studio.engine.positions);
  const cy = (f.eyes[0].centre[1] + f.chin[1]) / 2 + 0.012;
  const half = Math.max(0.1, (f.headTop[1] - f.chin[1]) * 0.62);
  return { cx: 0, cy, half };
}

/** The composited skin, or the plain base skin when there are no layers. */
export async function currentSkin(studio: Studio): Promise<RgbaImage> {
  await studio.settled();
  const composite = studio.viewport?.skinComposite();
  if (composite) return composite;
  const base = studio.scene.baseSkinTexture();
  if (!base) throw new Error('the character has no skin texture');
  return decodeImage(resolveAssetUrl(studio.info.coreAssetsUrl, base));
}

/** Skin UV template: the hm08 body UV wireframe over the current skin, 2048 px (the composite size). */
export async function exportSkinUvTemplate(studio: Studio): Promise<string> {
  const size = SKIN_TEMPLATE_SIZE;
  const base = studio.assets.base;
  const skin = await currentSkin(studio);
  const background = skin.width === size ? skin.data : resize(skin, size).data;
  const faces = base.facesWhere((g) => g === 'body');
  const faceUvs = new Uint32Array(faces.length * 4);
  faces.forEach((f, i) => faceUvs.set(base.faceUvs.subarray(f * 4, f * 4 + 4), i * 4));
  const pixels = renderUvTemplate(base.uvs, faceUvs, { size, background, line: [255, 64, 160, 255] });
  return backend.saveImageAs('skin_uv_template.png', await imageToPng({ width: size, height: size, data: pixels }));
}

/** Face region guide: regions, feature outlines and labels, 2048 px. */
export async function exportRegionGuide(studio: Studio): Promise<string> {
  const { image, labels } = regionGuide(studio.assets.skinComposer, SKIN_TEMPLATE_SIZE);
  const canvas = imageToCanvas(image);
  const ctx = canvas.getContext('2d')!;
  ctx.font = 'bold 22px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.lineWidth = 4;
  for (const l of labels) {
    const x = l.u * canvas.width;
    const y = (1 - l.v) * canvas.height;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(l.text, x, y);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(l.text, x, y);
  }
  ctx.textAlign = 'left';
  ctx.font = '20px system-ui, sans-serif';
  const legend = [
    ['#c47860', 'Face mask (head islands: exported as the head texture)'],
    ['#6e6e76', 'Body mask'],
    ['#5680ba', 'Hands mask'],
    ['#ff5a6e', 'Lips'],
    ['#b48cff', 'Under-eye'],
    ['#ffd25a', 'Beard area'],
  ];
  legend.forEach(([colour, text], i) => {
    ctx.fillStyle = colour!;
    ctx.fillRect(24, 1460 + i * 30, 22, 22);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text!, 56, 1478 + i * 30);
  });
  return backend.saveImageAs('skin_region_guide.png', await canvasToPng(canvas));
}

/**
 * Head and body textures as the exporter will write them (PRD F6 head split):
 * the head islands cropped from the composite into their own texture, and the
 * whole composite downscaled with a mild sharpen for the body.
 */
export async function exportSkinTextures(studio: Studio): Promise<string[]> {
  const doc = studio.engine.doc;
  const skin = await currentSkin(studio);
  const composite = skin.width === SKIN_TEMPLATE_SIZE ? skin : resize(skin, SKIN_TEMPLATE_SIZE);
  const packing = packHead(studio.assets.skinComposer.layout, doc.export.headTexture);
  const head = cropHeadTexture(composite, packing, doc.export.headTexture);
  const body = bodyTexture(composite, doc.export.bodyTexture);
  const name = doc.name || 'Character';
  return [
    await backend.saveTexture(name, `${name}_head`, await imageToPng(head)),
    await backend.saveTexture(name, `${name}_body`, await imageToPng(body)),
  ];
}

function resize(img: RgbaImage, size: number): RgbaImage {
  const canvas = imageToCanvas(img);
  const out = document.createElement('canvas');
  out.width = size;
  out.height = size;
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, size, size);
  return { width: size, height: size, data: new Uint8ClampedArray(ctx.getImageData(0, 0, size, size).data) };
}
