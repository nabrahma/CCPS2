/**
 * MediaPipe Face Landmarker (PRD F7 step 2): 478 landmarks per face. The WASM
 * runtime and the model are bundled in assets/core/vendor/mediapipe and
 * served by the app, so it works offline (no CDN).
 */
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

export interface Landmarks {
  /** x, y (0..1 of the image width and height) and z per landmark. */
  points: number[];
  width: number;
  height: number;
  /** Facial transformation matrix (4x4 column-major), for the head pose. */
  matrix: number[] | null;
}

let instance: Promise<FaceLandmarker> | null = null;

function create(coreAssetsUrl: string): Promise<FaceLandmarker> {
  const base = `${coreAssetsUrl.replace(/\/$/, '')}/vendor/mediapipe`;
  return FilesetResolver.forVisionTasks(`${base}/wasm`).then((fileset) =>
    FaceLandmarker.createFromOptions(fileset, {
      // CPU: deterministic and independent of the GPU driver; one photo takes well under a second.
      baseOptions: { modelAssetPath: `${base}/face_landmarker.task`, delegate: 'CPU' },
      runningMode: 'IMAGE',
      numFaces: 1,
      minFaceDetectionConfidence: 0.3,
      minFacePresenceConfidence: 0.3,
      outputFacialTransformationMatrixes: true,
    }),
  );
}

/** The shared landmarker (created on first use). */
export function faceLandmarker(coreAssetsUrl: string): Promise<FaceLandmarker> {
  instance ??= create(coreAssetsUrl).catch((err: unknown) => {
    instance = null;
    throw err;
  });
  return instance;
}

/** Landmarks of the most prominent face, or null when no face is found. */
export async function detectLandmarks(
  coreAssetsUrl: string,
  image: HTMLImageElement | HTMLCanvasElement | ImageBitmap | ImageData,
): Promise<Landmarks | null> {
  const lm = await faceLandmarker(coreAssetsUrl);
  const result = lm.detect(image);
  const face = result.faceLandmarks[0];
  if (!face || face.length < 478) return null;
  const points: number[] = [];
  for (const p of face) points.push(p.x, p.y, p.z);
  const width = 'naturalWidth' in image ? image.naturalWidth : image.width;
  const height = 'naturalHeight' in image ? image.naturalHeight : image.height;
  const m = result.facialTransformationMatrixes?.[0]?.data;
  return { points, width, height, matrix: m && m.length === 16 ? Array.from(m) : null };
}
