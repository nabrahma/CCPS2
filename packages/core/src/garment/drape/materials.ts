/**
 * Cloth presets for the drape (F30): each M15 material kind maps to areal density, compliance and friction.
 * Woven cloth barely stretches (near-zero stretch compliance); knits stretch. Bending stiffness sets how
 * the cloth folds: leather and canvas in broad folds, jersey in small ones.
 */
import type { MaterialKind } from '../../wardrobe/material';
import type { ClothMaterial } from './xpbd';

export type ClothKind = 'leather' | 'suede' | 'denim' | 'canvas' | 'cotton' | 'jersey' | 'knit' | 'wool' | 'nylon' | 'shearling';

export interface ClothPreset extends ClothMaterial {
  kind: ClothKind;
  label: string;
  /** Woven (stretch strain held under 3%) or knitted. */
  woven: boolean;
}

const preset = (kind: ClothKind, label: string, woven: boolean, density: number, stretch: number, area: number, bend: number, friction: number): ClothPreset => ({ kind, label, woven, density, stretch, area, bend, friction });

/** Stretch compliance of woven cloth: effectively inextensible at the solver's substep. */
const WOVEN = 1e-7;

export const CLOTH_PRESETS: Record<ClothKind, ClothPreset> = {
  leather: preset('leather', 'Leather', true, 0.9, WOVEN, 1e-9, 4e-4, 0.6),
  suede: preset('suede', 'Suede', true, 0.7, WOVEN, 1e-9, 2.5e-4, 0.7),
  denim: preset('denim', 'Denim', true, 0.42, WOVEN, 1e-9, 8e-5, 0.5),
  canvas: preset('canvas', 'Canvas', true, 0.36, WOVEN, 1e-9, 1e-4, 0.5),
  cotton: preset('cotton', 'Cotton', true, 0.16, WOVEN, 1e-9, 1.5e-5, 0.4),
  jersey: preset('jersey', 'Cotton jersey', false, 0.2, 2e-3, 2e-7, 6e-6, 0.45),
  knit: preset('knit', 'Knit', false, 0.32, 4e-3, 4e-7, 2e-5, 0.5),
  wool: preset('wool', 'Wool', true, 0.45, WOVEN, 1e-9, 9e-5, 0.55),
  nylon: preset('nylon', 'Nylon', true, 0.18, WOVEN, 1e-9, 2e-5, 0.3),
  shearling: preset('shearling', 'Shearling', true, 1.2, WOVEN, 1e-9, 6e-4, 0.7),
};

/** The cloth of an M15 material kind (fur trim drapes as shearling). */
export function clothOfMaterial(kind: MaterialKind): ClothPreset {
  if (kind === 'fur') return CLOTH_PRESETS.shearling;
  return CLOTH_PRESETS[kind];
}
