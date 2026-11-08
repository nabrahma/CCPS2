/** Lighting and camera presets (PRD F9). */

export type LightingPresetId = 'studio' | 'flashlight' | 'overcast' | 'night';
export type CameraPresetId = 'full' | 'bust' | 'face' | 'threeQuarter' | 'profile';
export type ShadingMode = 'ps2' | 'unlit' | 'clay' | 'wire' | 'uv';

export interface LightingPreset {
  id: LightingPresetId;
  label: string;
  ambient: [number, number, number];
  key: { direction: [number, number, number]; color: [number, number, number] } | null;
  /** Spot light from the camera (flashlight). */
  spot: { color: [number, number, number]; cosOuter: number; cosInner: number; range: number } | null;
  rim: { color: [number, number, number]; strength: number };
  background: [number, number, number];
}

export const LIGHTING_PRESETS: Record<LightingPresetId, LightingPreset> = {
  studio: {
    id: 'studio',
    label: 'Studio',
    ambient: [0.36, 0.35, 0.36],
    key: { direction: [-0.45, 0.55, 0.7], color: [1.0, 0.96, 0.9] },
    spot: null,
    rim: { color: [0.6, 0.65, 0.75], strength: 0.25 },
    background: [0.011, 0.011, 0.011], // the app's panel colour, #1b1b1b
  },
  flashlight: {
    id: 'flashlight',
    label: 'Flashlight',
    ambient: [0.035, 0.038, 0.05],
    key: null,
    spot: { color: [1.45, 1.38, 1.22], cosOuter: Math.cos((26 * Math.PI) / 180), cosInner: Math.cos((12 * Math.PI) / 180), range: 9 },
    rim: { color: [0.25, 0.28, 0.4], strength: 0.08 },
    background: [0.0, 0.0, 0.0],
  },
  overcast: {
    id: 'overcast',
    label: 'Overcast exterior',
    ambient: [0.5, 0.53, 0.58],
    key: { direction: [0.1, 1.0, 0.25], color: [0.55, 0.57, 0.6] },
    spot: null,
    rim: { color: [0.5, 0.52, 0.55], strength: 0.12 },
    background: [0.52, 0.55, 0.58],
  },
  night: {
    id: 'night',
    label: 'Night street',
    ambient: [0.05, 0.06, 0.1],
    key: { direction: [0.6, 0.9, 0.35], color: [1.05, 0.62, 0.28] },
    spot: null,
    rim: { color: [0.25, 0.35, 0.7], strength: 0.3 },
    background: [0.02, 0.025, 0.045],
  },
};

export interface CameraFrame {
  /** Point the camera looks at, as a fraction of character height. */
  targetHeight: number;
  /** Vertical extent to fit in view, as a fraction of character height. */
  span: number;
  /** Horizontal angle in radians (0 = front). */
  yaw: number;
  pitch: number;
}

export const CAMERA_PRESETS: Record<CameraPresetId, CameraFrame & { label: string }> = {
  full: { label: 'Full body', targetHeight: 0.49, span: 1.24, yaw: 0, pitch: 0.04 },
  bust: { label: 'Bust', targetHeight: 0.84, span: 0.38, yaw: 0, pitch: 0.02 },
  face: { label: 'Face close-up', targetHeight: 0.925, span: 0.17, yaw: 0, pitch: 0 },
  threeQuarter: { label: 'Three-quarter', targetHeight: 0.86, span: 0.34, yaw: Math.PI / 5, pitch: 0.03 },
  profile: { label: 'Profile', targetHeight: 0.9, span: 0.22, yaw: Math.PI / 2, pitch: 0 },
};

export interface PostSettings {
  lowRes: boolean; // render at 640x448 and upscale
  dither16: boolean; // 16-bit colour with ordered dither
  grain: number; // 0..1
  vhs: number; // chroma bleed 0..1
  interlace: boolean;
  vignette: number; // 0..1
  /** PS1 effects, off by default (PRD F9). */
  affine: boolean;
  vertexSnap: boolean;
}

export const DEFAULT_POST: PostSettings = {
  lowRes: false,
  dither16: false,
  grain: 0,
  vhs: 0,
  interlace: false,
  vignette: 0,
  affine: false,
  vertexSnap: false,
};

export const PS2_POST: PostSettings = {
  lowRes: true,
  dither16: true,
  grain: 0.35,
  vhs: 0.25,
  interlace: true,
  vignette: 0.45,
  affine: false,
  vertexSnap: false,
};
