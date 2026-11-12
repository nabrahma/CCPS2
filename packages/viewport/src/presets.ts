/**
 * Looks, cameras and post toggles (PRD F9; Part 2 F14). A look (lights,
 * ambient, fog and grade) comes from @ps2cc/core, shared with the exporter and
 * the Unity package; the post toggles here are the user's PS2 effects on top.
 */
import { LOOKS, type Look, type LookId } from '@ps2cc/core';

export type LightingPresetId = LookId;
export type CameraPresetId = 'full' | 'bust' | 'face' | 'threeQuarter' | 'profile' | 'back';
export type ShadingMode = 'ps2' | 'unlit' | 'clay' | 'wire' | 'uv';

/** The looks the viewport offers, by id (Part 1's lighting presets are the first four). */
export const LIGHTING_PRESETS: Record<LightingPresetId, Look> = LOOKS;

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
  back: { label: 'Back', targetHeight: 0.55, span: 1.2, yaw: Math.PI, pitch: 0.06 },
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
  /** Depth of field for renders (F14): blur away from the focus distance (metres; 0 = the camera target). */
  dof: { enabled: boolean; focus: number; aperture: number };
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
  dof: { enabled: false, focus: 0, aperture: 0.5 },
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
  dof: { enabled: false, focus: 0, aperture: 0.5 },
};
