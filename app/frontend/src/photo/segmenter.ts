/**
 * MediaPipe Selfie Multiclass segmenter (PRD Part 3, F33): labels every photo
 * pixel as background, hair, body skin, face skin, clothes or accessories.
 * Bundled in assets/core/vendor/mediapipe (Apache-2.0), run on the CPU so the
 * result does not depend on the GPU. What it finds is stored in the character
 * (the face-skin mask as a PNG, the picked colours), so it never runs again
 * for that photo, on export or anywhere else.
 */
import { ImageSegmenter, FilesetResolver } from '@mediapipe/tasks-vision';
import { canvasToPng } from '../images';

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('could not read the mask'));
    r.readAsDataURL(blob);
  });
}

/** The model's classes, in its order. */
export const SEGMENT_CLASSES = ['background', 'hair', 'body-skin', 'face-skin', 'clothes', 'others'] as const;
const HAIR = 1;
const FACE_SKIN = 3;

/** Masks are stored at most this many pixels on their long side (the projection samples them smoothly). */
const MASK_MAX = 512;

let instance: Promise<ImageSegmenter> | null = null;

function create(coreAssetsUrl: string): Promise<ImageSegmenter> {
  const base = `${coreAssetsUrl.replace(/\/$/, '')}/vendor/mediapipe`;
  return FilesetResolver.forVisionTasks(`${base}/wasm`).then((fileset) =>
    ImageSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: `${base}/selfie_multiclass_256x256.tflite`, delegate: 'CPU' },
      runningMode: 'IMAGE',
      outputCategoryMask: true,
      outputConfidenceMasks: true,
    }),
  );
}

export function segmenter(coreAssetsUrl: string): Promise<ImageSegmenter> {
  instance ??= create(coreAssetsUrl).catch((err: unknown) => {
    instance = null;
    throw err;
  });
  return instance;
}

export interface Segmentation {
  /** Face-skin mask as a PNG data URL (red = face skin, the photo's orientation). */
  mask: string;
  /** Share of the image that is face skin, and hair. */
  faceShare: number;
  hairShare: number;
  /** Median colours (sRGB 0..255) of confident hair and face-skin pixels, or null when there are too few. */
  hair: [number, number, number] | null;
  skin: [number, number, number] | null;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)]!;
}

/** Segment a photo (decoded pixels in `pixels`, the same image as `image`). */
export async function segmentPhoto(coreAssetsUrl: string, image: HTMLImageElement | HTMLCanvasElement, pixels: { width: number; height: number; data: ArrayLike<number> }): Promise<Segmentation> {
  const seg = await segmenter(coreAssetsUrl);
  const result = seg.segment(image);
  try {
    const conf = result.confidenceMasks?.[FACE_SKIN];
    const cat = result.categoryMask;
    if (!conf || !cat) throw new Error('the segmenter returned no masks');
    const w = conf.width;
    const h = conf.height;
    const face = conf.getAsFloat32Array();
    const labels = cat.getAsUint8Array();
    // The mask at most MASK_MAX on its long side.
    const scale = Math.min(1, MASK_MAX / Math.max(w, h));
    const mw = Math.max(1, Math.round(w * scale));
    const mh = Math.max(1, Math.round(h * scale));
    const full = new OffscreenCanvas(w, h);
    const fctx = full.getContext('2d')!;
    const data = fctx.createImageData(w, h);
    let faceN = 0;
    let hairN = 0;
    const hairRgb: number[][] = [[], [], []];
    const skinRgb: number[][] = [[], [], []];
    const px = pixels.data;
    const sx = pixels.width / w;
    const sy = pixels.height / h;
    for (let i = 0; i < w * h; i++) {
      // A firm edge: pixels the model is unsure of (the fringe's ragged edge) count as not face.
      const t = Math.min(1, Math.max(0, (face[i]! - 0.6) / 0.3));
      const c = Math.round(t * t * (3 - 2 * t) * 255);
      data.data[i * 4] = c;
      data.data[i * 4 + 1] = c;
      data.data[i * 4 + 2] = c;
      data.data[i * 4 + 3] = 255;
      const label = labels[i]!;
      if (label === FACE_SKIN) faceN++;
      if (label === HAIR) hairN++;
      // Colours from confident pixels only (every 2nd pixel is plenty).
      if (i % 2 !== 0) continue;
      const x = Math.min(pixels.width - 1, Math.floor((i % w) * sx));
      const y = Math.min(pixels.height - 1, Math.floor(Math.floor(i / w) * sy));
      const j = (y * pixels.width + x) * 4;
      if (label === HAIR) for (let k = 0; k < 3; k++) hairRgb[k]!.push(px[j + k]!);
      else if (label === FACE_SKIN && face[i]! > 0.9) for (let k = 0; k < 3; k++) skinRgb[k]!.push(px[j + k]!);
    }
    fctx.putImageData(data, 0, 0);
    const small = document.createElement('canvas');
    small.width = mw;
    small.height = mh;
    small.getContext('2d')!.drawImage(full, 0, 0, mw, mh);
    const mask = await blobToDataUrl(await canvasToPng(small));
    const pick = (rgb: number[][], minCount: number): [number, number, number] | null =>
      rgb[0]!.length >= minCount ? [median(rgb[0]!), median(rgb[1]!), median(rgb[2]!)] : null;
    return { mask, faceShare: faceN / (w * h), hairShare: hairN / (w * h), hair: pick(hairRgb, 200), skin: pick(skinRgb, 200) };
  } finally {
    result.close();
  }
}
