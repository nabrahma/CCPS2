/**
 * Skin stack actions for the UI (PRD F6, F7): apply a face photo, and export
 * the skin UV template, the face region guide and the head/body textures.
 */
import {
  bodyTexture,
  anglesFromMatrix,
  checkPhoto,
  faceFeatures,
  fitFaceToPhoto,
  photoLandmarks,
  DEFAULT_HAIR_COLOUR,
  layerKind,
  newLayer,
  sampleBilinear,
  toneBetween,
  headTexture,
  regionGuide,
  renderUvTemplate,
  type PhotoCheck,
  type RgbaImage,
} from '@ps2cc/core';
import { resolveAssetUrl, type FrontView } from '@ps2cc/viewport';
import { backend } from './backend';
import { canvasToPng, decodeImage, imageToCanvas, imageToPng, loadImageElement } from './images';
import { detectLandmarks } from './photo/landmarker';
import { segmentPhoto, type Segmentation } from './photo/segmenter';
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
  if (!found) throw new NoFaceFound(url);
  const pixels = await decodeImage(url);
  const check = checkPhoto(pixels, found.points, found.matrix ? anglesFromMatrix(found.matrix) : undefined);
  if (cancelled()) return null;
  const seg = await segment(studio, img, pixels);
  if (cancelled()) return null;
  studio.engine.update('Face photo', (d) => {
    d.skin.photo = {
      image: url,
      strength: d.skin.photo?.strength ?? 1,
      colourMatch: d.skin.photo?.colourMatch ?? true,
      landmarks: found.points.map((x) => Math.round(x * 1e6) / 1e6),
      width: found.width,
      height: found.height,
      ...segmentFields(seg, d.skin.photo?.useMask),
    };
  });
  return check;
}

/** MediaPipe found no face: the photo can still be used with face points placed by hand (PRD Part 3, F33). */
export class NoFaceFound extends Error {
  constructor(readonly url: string) {
    super('No face was found in the photo. Place the face points by hand, or use a front-facing photo with the whole face visible.');
  }
}

/** Segment a photo; a failure only loses the mask (the photo still projects as before). */
async function segment(studio: Studio, img: HTMLImageElement, pixels: RgbaImage): Promise<Segmentation | null> {
  try {
    return await segmentPhoto(studio.info.coreAssetsUrl, img, pixels);
  } catch (err) {
    backend.log('warn', `photo segmentation failed: ${String(err)}`);
    return null;
  }
}

function segmentFields(seg: Segmentation | null, useMask: boolean | undefined) {
  if (!seg) return {};
  const picked: { hair?: [number, number, number]; skin?: [number, number, number] } = {};
  if (seg.hair) picked.hair = seg.hair;
  if (seg.skin) picked.skin = seg.skin;
  return { mask: seg.mask, useMask: useMask ?? true, picked };
}

/**
 * Use 68 face points placed by hand (PRD Part 3, F33) for the front photo:
 * x, y per point, 0..1 of the photo, y down.
 */
export async function applyManualPoints(studio: Studio, url: string, points: number[]): Promise<void> {
  const img = await loadImageElement(url);
  const pixels = await decodeImage(url);
  const seg = await segment(studio, img, pixels);
  const landmarks: number[] = [];
  for (let k = 0; k < points.length / 2; k++) landmarks.push(Math.round(points[k * 2]! * 1e6) / 1e6, Math.round(points[k * 2 + 1]! * 1e6) / 1e6, 0);
  studio.engine.update('Face points by hand', (d) => {
    const old = d.skin.photo?.image === url ? d.skin.photo : null;
    d.skin.photo = {
      image: url,
      strength: old?.strength ?? 1,
      colourMatch: old?.colourMatch ?? true,
      landmarks,
      landmarkSet: 'ibug68',
      width: img.naturalWidth,
      height: img.naturalHeight,
      ...(old?.sides ? { sides: old.sides } : {}),
      ...segmentFields(seg, old?.useMask),
    };
  });
  await studio.settled();
}

/**
 * Use the colours picked from the photo (PRD Part 3, F33): the hair's median
 * colour as the card hair's base colour, and the face skin's median colour as
 * a tone tint that takes the whole skin there. One undo step; both stay
 * editable.
 */
export async function applyPhotoColours(studio: Studio): Promise<{ hair: boolean; skin: boolean }> {
  const picked = studio.engine.doc.skin.photo?.picked;
  if (!picked) throw new Error('This photo has no picked colours: place it again to find them.');
  let tone: { hue: number; saturation: number; value: number } | null = null;
  const skin = picked.skin;
  if (skin) {
    // The base skin's colour over the face, before any layer.
    const base = studio.scene.baseSkinTexture();
    if (base) {
      const img = await decodeImage(resolveAssetUrl(studio.info.coreAssetsUrl, base));
      const size = 256;
      const masks = studio.assets.skinComposer.layout.regionMasks(size);
      const tmp = [0, 0, 0, 0];
      const rgb: number[][] = [[], [], []];
      for (let t = 0; t < size * size; t++) {
        if (masks.data[t * 4]! < 250) continue;
        // Texel rows run up the UV square, as in the projection.
        sampleBilinear(img, ((t % size) + 0.5) / size, 1 - (Math.floor(t / size) + 0.5) / size, tmp);
        for (let k = 0; k < 3; k++) rgb[k]!.push(tmp[k]!);
      }
      if (rgb[0]!.length > 100) {
        const med = rgb.map((c) => c.sort((a, b) => a - b)[Math.floor(c.length / 2)]!) as [number, number, number];
        tone = toneBetween(med, skin);
      }
    }
  }
  const hair = picked.hair;
  studio.engine.update('Colours from photo', (d) => {
    if (hair) d.hair.colour = { ...(d.hair.colour ?? DEFAULT_HAIR_COLOUR), base: [hair[0] / 255, hair[1] / 255, hair[2] / 255] };
    if (tone) {
      let layer = d.skin.layers.find((l) => l.kind === 'tone');
      if (!layer) {
        layer = newLayer('tone');
        d.skin.layers.unshift(layer);
      }
      layer.enabled = true;
      layer.opacity = layerKind('tone').opacity;
      layer.params = { ...layer.params, hue: tone.hue, saturation: tone.saturation, value: tone.value };
    }
  });
  await studio.settled();
  return { hair: Boolean(hair), skin: tone !== null };
}

/**
 * A side photo for the three-photo projection (Part 2 F19): its landmarks are
 * found and it is blended with the front photo, which must be placed first.
 * Three-quarter views (about 30 to 50 degrees) work best: MediaPipe does not
 * find faces in full profile.
 */
export async function applySidePhoto(studio: Studio, side: 'left' | 'right', url: string): Promise<void> {
  if (!studio.engine.doc.skin.photo) throw new Error('Place a front photo first.');
  const img = await loadImageElement(url);
  const found = await detectLandmarks(studio.info.coreAssetsUrl, img);
  if (!found) throw new Error('No face was found in the side photo. Use a three-quarter view (about 45 degrees) with both eyes visible.');
  const seg = await segment(studio, img, await decodeImage(url));
  studio.engine.update(`${side === 'left' ? 'Left' : 'Right'} side photo`, (d) => {
    if (!d.skin.photo) return;
    d.skin.photo.sides = {
      ...(d.skin.photo.sides ?? {}),
      [side]: { image: url, landmarks: found.points.map((x) => Math.round(x * 1e6) / 1e6), width: found.width, height: found.height, ...(seg ? { mask: seg.mask } : {}) },
    };
  });
  await studio.settled();
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
    // No face found: offer to place the points by hand.
    if (err instanceof NoFaceFound) useUi.getState().openPointEditor({ image: url, reason: 'no-face' });
    else useUi.getState().error('Could not use the photo', err);
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
    landmarks: photoLandmarks(photo)!,
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

/**
 * The skin composited straight into the head texture's layout (Part 2 F19),
 * at the composite's size; resampled from the composite when the viewport
 * cannot draw it.
 */
export async function currentHeadSkin(studio: Studio, composite?: RgbaImage): Promise<RgbaImage> {
  await studio.settled();
  const head = await studio.viewport?.headComposite();
  if (head) return head;
  const layout = await studio.assets.headLayout(studio.engine.doc.bodyMesh);
  return headTexture(composite ?? (await currentSkin(studio)), layout, SKIN_TEMPLATE_SIZE);
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
  const headSkin = await currentHeadSkin(studio, composite);
  const head = headSkin.width === doc.export.headTexture ? headSkin : resize(headSkin, doc.export.headTexture);
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
