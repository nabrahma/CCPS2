/**
 * Skin layer kinds (PRD F6): defaults, parameter ranges for the UI, and
 * validation of layers read from a document.
 */
import type { BlendMode, RegionMask, SkinLayer, SkinStack } from '../character/doc';
import { BLEND_MODES } from './blend';

export type LayerKind = SkinLayer['kind'];

export type ParamSpec =
  | { key: string; label: string; type: 'number'; min: number; max: number; step: number; default: number }
  | { key: string; label: string; type: 'color'; default: string };

export interface LayerKindSpec {
  kind: LayerKind;
  label: string;
  blend: BlendMode;
  opacity: number;
  mask: RegionMask;
  params: ParamSpec[];
  /** Procedural layers are generated from the neutral surface; others are images or adjustments. */
  procedural: boolean;
}

const color = (key: string, label: string, value: string): ParamSpec => ({ key, label, type: 'color', default: value });
const num = (key: string, label: string, min: number, max: number, step: number, value: number): ParamSpec => ({
  key,
  label,
  type: 'number',
  min,
  max,
  step,
  default: value,
});
const seed = num('seed', 'Seed', 1, 9999, 1, 1);

export const LAYER_KINDS: readonly LayerKindSpec[] = [
  {
    kind: 'tone',
    label: 'Tone tint',
    blend: 'normal',
    opacity: 1,
    mask: 'none',
    procedural: false,
    params: [num('hue', 'Hue shift (°)', -45, 45, 1, 0), num('saturation', 'Saturation', 0, 2, 0.01, 1), num('value', 'Brightness', 0.5, 1.5, 0.01, 1)],
  },
  {
    kind: 'darkCircles',
    label: 'Dark circles',
    blend: 'multiply',
    opacity: 0.45,
    mask: 'none',
    procedural: true,
    params: [color('color', 'Colour', '#8c6f78'), num('size', 'Size', 0.5, 2, 0.01, 1)],
  },
  {
    kind: 'eyeBags',
    label: 'Eye bags',
    blend: 'multiply',
    opacity: 0.5,
    mask: 'none',
    procedural: true,
    params: [color('color', 'Colour', '#9a8078'), num('size', 'Size', 0.5, 2, 0.01, 1)],
  },
  {
    kind: 'stubble',
    label: 'Stubble / beard shadow',
    blend: 'multiply',
    opacity: 0.6,
    mask: 'none',
    procedural: true,
    params: [
      color('color', 'Colour', '#6a5a50'),
      num('density', 'Density', 0, 1, 0.01, 0.45),
      num('fullness', 'Coverage', 0, 1, 0.01, 1),
      num('shadow', 'Shadow', 0, 1, 0.01, 0.6),
      seed,
    ],
  },
  {
    kind: 'lips',
    label: 'Lip colour',
    blend: 'multiply',
    opacity: 0.6,
    mask: 'none',
    procedural: true,
    params: [color('color', 'Colour', '#b4545e'), num('size', 'Size', 0.7, 1.4, 0.01, 1)],
  },
  {
    kind: 'eyeliner',
    label: 'Eyeliner / eyeshadow',
    blend: 'normal',
    opacity: 0.8,
    mask: 'none',
    procedural: true,
    params: [
      color('color', 'Liner colour', '#1c1615'),
      num('thickness', 'Liner thickness', 0, 3, 0.01, 1),
      color('shadowColor', 'Shadow colour', '#6b4c5e'),
      num('shadow', 'Eyeshadow', 0, 1, 0.01, 0),
    ],
  },
  {
    kind: 'blush',
    label: 'Blush',
    blend: 'multiply',
    opacity: 0.35,
    mask: 'none',
    procedural: true,
    params: [color('color', 'Colour', '#d8747a'), num('size', 'Size', 0.5, 2, 0.01, 1)],
  },
  {
    kind: 'freckles',
    label: 'Freckles',
    blend: 'multiply',
    opacity: 0.7,
    mask: 'none',
    procedural: true,
    params: [color('color', 'Colour', '#8b5a3c'), num('density', 'Density', 0, 1, 0.01, 0.5), num('size', 'Size', 0.5, 2, 0.01, 1), seed],
  },
  {
    kind: 'dirt',
    label: 'Dirt / grime',
    blend: 'multiply',
    opacity: 0.45,
    mask: 'none',
    procedural: true,
    params: [color('color', 'Colour', '#6b5a45'), num('amount', 'Amount', 0, 1, 0.01, 0.4), num('scale', 'Scale', 0.3, 3, 0.01, 1), seed],
  },
  {
    kind: 'bruises',
    label: 'Bruises (cosmetic)',
    blend: 'multiply',
    opacity: 0.7,
    mask: 'none',
    procedural: true,
    params: [color('color', 'Centre colour', '#5a3a5c'), color('rim', 'Rim colour', '#a49a5a'), num('count', 'Count', 1, 12, 1, 3), num('size', 'Size', 0.5, 2, 0.01, 1), seed],
  },
  {
    kind: 'sweat',
    label: 'Sweat sheen',
    blend: 'screen',
    opacity: 0.35,
    mask: 'none',
    procedural: true,
    params: [color('color', 'Colour', '#ffffff'), num('amount', 'Amount', 0, 1, 0.01, 0.5), seed],
  },
  {
    kind: 'image',
    label: 'Image overlay',
    blend: 'normal',
    opacity: 1,
    mask: 'none',
    procedural: false,
    params: [],
  },
];

export function layerKind(kind: LayerKind): LayerKindSpec {
  const spec = LAYER_KINDS.find((k) => k.kind === kind);
  if (!spec) throw new Error(`unknown skin layer kind ${kind}`);
  return spec;
}

let counter = 0;

/** A new layer of a kind with its default settings. */
export function newLayer(kind: LayerKind, extra: Partial<SkinLayer> = {}): SkinLayer {
  const spec = layerKind(kind);
  counter = (counter + 1) % 1e6;
  const params: Record<string, number | string> = {};
  for (const p of spec.params) params[p.key] = p.default;
  return {
    id: `${kind}-${Date.now().toString(36)}-${counter}`,
    kind,
    enabled: true,
    opacity: spec.opacity,
    blend: spec.blend,
    mask: spec.mask,
    params,
    ...extra,
  };
}

/** Parameter value with the kind's default and range applied. */
export function layerParam(layer: SkinLayer, key: string): number | string {
  const spec = layerKind(layer.kind).params.find((p) => p.key === key);
  if (!spec) throw new Error(`layer ${layer.kind} has no parameter ${key}`);
  const v = layer.params[key];
  if (spec.type === 'color') return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : spec.default;
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(spec.max, Math.max(spec.min, v)) : spec.default;
}

export function numParam(layer: SkinLayer, key: string): number {
  return layerParam(layer, key) as number;
}

/** '#rrggbb' to 0..255 RGB. */
export function parseColor(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`invalid colour ${hex}`);
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
}

export function colorParam(layer: SkinLayer, key: string): [number, number, number] {
  return parseColor(layerParam(layer, key) as string);
}

const MASKS: readonly RegionMask[] = ['none', 'face', 'body', 'hands'];

/** Validate a layer read from a document: unknown kinds are dropped, values clamped, params limited to the kind's. */
export function sanitiseLayer(raw: unknown): SkinLayer | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<SkinLayer>;
  const spec = LAYER_KINDS.find((k) => k.kind === r.kind);
  if (!spec) return null;
  if (spec.kind === 'image' && (typeof r.image !== 'string' || r.image === '')) return null;
  const layer: SkinLayer = {
    id: typeof r.id === 'string' && r.id ? r.id : newLayer(spec.kind).id,
    kind: spec.kind,
    enabled: r.enabled !== false,
    opacity: typeof r.opacity === 'number' && Number.isFinite(r.opacity) ? Math.min(1, Math.max(0, r.opacity)) : spec.opacity,
    blend: BLEND_MODES.includes(r.blend as BlendMode) ? (r.blend as BlendMode) : spec.blend,
    mask: MASKS.includes(r.mask as RegionMask) ? (r.mask as RegionMask) : spec.mask,
    params: {},
  };
  if (spec.kind === 'image') layer.image = r.image;
  for (const p of spec.params) layer.params[p.key] = layerParam({ ...layer, params: (r.params ?? {}) as SkinLayer['params'] }, p.key);
  return layer;
}

/** Validate a skin stack: layers sanitised, photo settings clamped. */
export function sanitiseSkin(raw: Partial<SkinStack> | undefined, fallbackBase: string): SkinStack {
  const layers = Array.isArray(raw?.layers) ? raw.layers.map(sanitiseLayer).filter((l): l is SkinLayer => l !== null) : [];
  // Ids must be unique (the UI and caches key on them).
  const seen = new Set<string>();
  for (const l of layers) {
    if (seen.has(l.id)) l.id = newLayer(l.kind).id;
    seen.add(l.id);
  }
  const p = raw?.photo;
  let photo: SkinStack['photo'] = null;
  if (p && typeof p === 'object' && typeof p.image === 'string' && p.image) {
    photo = {
      image: p.image,
      strength: typeof p.strength === 'number' && Number.isFinite(p.strength) ? Math.min(1, Math.max(0, p.strength)) : 1,
      colourMatch: p.colourMatch !== false,
    };
    if (Array.isArray(p.landmarks) && p.landmarks.length % 3 === 0 && p.landmarks.every((x) => typeof x === 'number' && Number.isFinite(x)))
      photo.landmarks = p.landmarks;
    if (typeof p.width === 'number' && typeof p.height === 'number' && p.width > 0 && p.height > 0) {
      photo.width = p.width;
      photo.height = p.height;
    }
  }
  return { base: typeof raw?.base === 'string' && raw.base ? raw.base : fallbackBase, layers, photo };
}
