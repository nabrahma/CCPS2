/**
 * Skin layer kinds (PRD F6): defaults, parameter ranges for the UI, and
 * validation of layers read from a document.
 */
import type { BlendMode, RegionMask, SidePhoto, SkinLayer, SkinStack } from '../character/doc';
import { BLEND_MODES } from './blend';
import { isBrowPaint } from './painted-hair';

export type LayerKind = SkinLayer['kind'];

export type ParamSpec =
  | { key: string; label: string; type: 'number'; min: number; max: number; step: number; default: number; group?: string }
  | { key: string; label: string; type: 'color'; default: string; group?: string };

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
/** A parameter shown under a heading in the panel. */
const grouped = (group: string, p: ParamSpec): ParamSpec => ({ ...p, group });

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
    kind: 'brows',
    label: 'Painted eyebrows',
    blend: 'normal',
    opacity: 0.85,
    mask: 'none',
    procedural: true,
    // Shape, then the hair inside it (painted-hair.ts; D-148). The brow brush paints on top of the shape.
    params: [
      color('color', 'Colour', '#2e221a'),
      grouped('Shape', num('thickness', 'Thickness', 0.4, 2, 0.01, 1)),
      grouped('Shape', num('arch', 'Arch height', 0, 2, 0.01, 1)),
      grouped('Shape', num('peak', 'Arch position', 0, 1, 0.01, 0.5)),
      grouped('Shape', num('height', 'Height', -1, 1, 0.01, 0)),
      grouped('Shape', num('start', 'Inner start', -1, 1, 0.01, 0)),
      grouped('Shape', num('tail', 'Tail length', 0.6, 1.3, 0.01, 1)),
      grouped('Shape', num('drop', 'Tail drop', 0, 2, 0.01, 1)),
      grouped('Shape', num('taper', 'Taper', 0, 1, 0.01, 0.7)),
      grouped('Shape', num('softness', 'Edge softness', 0, 1, 0.01, 0.4)),
      grouped('Shape', num('fade', 'Soft inner end', 0, 1, 0.01, 0.45)),
      grouped('Hair', num('density', 'Hair density', 0, 1, 0.01, 0.7)),
      grouped('Hair', num('fill', 'Fill (powder)', 0, 1, 0.01, 0.45)),
      grouped('Hair', num('hairLength', 'Hair length', 0.5, 2, 0.01, 1)),
      grouped('Hair', num('hairWidth', 'Hair thickness', 0.5, 2, 0.01, 1)),
      grouped('Hair', num('lift', 'Brushed up', -1, 1, 0.01, 0)),
      grouped('Hair', num('messy', 'Unruly', 0, 1, 0.01, 0.25)),
      seed,
    ],
  },
  {
    // Painted lashes (D-146): a lash line with short strokes on the face texture, no geometry.
    kind: 'lashes',
    label: 'Painted eyelashes',
    blend: 'normal',
    opacity: 0.9,
    mask: 'none',
    procedural: true,
    params: [
      color('color', 'Colour', '#16100d'),
      grouped('Upper lashes', num('length', 'Length', 0.3, 2, 0.01, 1)),
      grouped('Upper lashes', num('density', 'Density', 0, 1, 0.01, 0.7)),
      grouped('Upper lashes', num('curl', 'Flare outwards', 0, 1, 0.01, 0.5)),
      grouped('Upper lashes', num('outer', 'Outer corner volume', 0, 1, 0.01, 0.5)),
      grouped('Upper lashes', num('clump', 'Clumping', 0, 1, 0.01, 0.3)),
      grouped('Upper lashes', num('thickness', 'Lash line', 0, 2, 0.01, 1)),
      grouped('Upper lashes', num('smudge', 'Smoky shadow', 0, 1, 0.01, 0.15)),
      grouped('Lower lashes', num('lower', 'Lower lashes', 0, 1, 0.01, 0.5)),
      grouped('Lower lashes', num('lowerLength', 'Lower length', 0, 1.5, 0.01, 0.6)),
      seed,
    ],
  },
  {
    // Part 2 F19 micro-detail: a tileable pore pattern (skin/detail.ts) masked per region.
    kind: 'pores',
    label: 'Skin pores (micro-detail)',
    blend: 'overlay',
    opacity: 0.5,
    mask: 'none',
    procedural: true,
    params: [
      num('nose', 'Nose', 0, 1, 0.01, 1),
      num('cheeks', 'Cheeks', 0, 1, 0.01, 0.8),
      num('forehead', 'Forehead', 0, 1, 0.01, 0.55),
      num('body', 'Body', 0, 1, 0.01, 0.25),
      num('scale', 'Pore size', 0.5, 2, 0.01, 1),
    ],
  },
  {
    // Part 2 F19 micro-detail: tileable stubble hairs over the beard area (close-ups of the stubble shadow).
    kind: 'stubbleHair',
    label: 'Stubble hairs (micro-detail)',
    blend: 'multiply',
    opacity: 0.7,
    mask: 'none',
    procedural: true,
    params: [color('color', 'Colour', '#3a2c24'), num('fullness', 'Coverage', 0, 1, 0.01, 1), num('scale', 'Hair size', 0.5, 2, 0.01, 1)],
  },
  {
    kind: 'mouth',
    label: 'Mouth interior',
    blend: 'multiply',
    opacity: 1,
    mask: 'none',
    procedural: true,
    params: [color('color', 'Throat colour', '#2b1215'), num('depth', 'Depth to full dark (cm)', 0.5, 4, 0.1, 1.6)],
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
  {
    kind: 'occlusion',
    label: 'Baked occlusion',
    blend: 'multiply',
    opacity: 0.75,
    mask: 'none',
    procedural: false,
    params: [num('contrast', 'Contrast', 0.5, 2, 0.01, 1)],
  },
  {
    kind: 'cavity',
    label: 'Baked cavity',
    blend: 'multiply',
    opacity: 0.5,
    mask: 'none',
    procedural: false,
    params: [num('contrast', 'Contrast', 0.5, 2, 0.01, 1)],
  },
  {
    kind: 'lightBake',
    label: 'Baked light',
    blend: 'multiply',
    opacity: 1,
    mask: 'none',
    procedural: false,
    params: [num('contrast', 'Contrast', 0.5, 2, 0.01, 1)],
  },
  {
    kind: 'scalpHair',
    label: 'Hair on the scalp',
    blend: 'normal',
    opacity: 0.9,
    mask: 'none',
    procedural: false,
    params: [],
  },
];

export interface LayerPreset {
  id: string;
  label: string;
  /** Values for the kind's number parameters; the rest go back to their defaults. Colours are kept. */
  params: Record<string, number>;
}

/** Starting points for the painted brows and lashes (D-148). */
export const LAYER_PRESETS: Partial<Record<LayerKind, readonly LayerPreset[]>> = {
  brows: [
    { id: 'natural', label: 'Natural', params: {} },
    {
      id: 'soft',
      label: 'Soft and full',
      params: { thickness: 1.3, arch: 0.75, peak: 0.55, taper: 0.55, softness: 0.8, fade: 0.6, density: 0.85, fill: 0.7, hairLength: 1.1, messy: 0.3 },
    },
    { id: 'groomed', label: 'Groomed arch', params: { thickness: 0.85, arch: 1.5, peak: 0.6, drop: 1.2, taper: 0.85, softness: 0.2, fade: 0.35, density: 0.75, fill: 0.5, messy: 0.08 } },
    { id: 'straight', label: 'Straight', params: { thickness: 1.1, arch: 0.25, peak: 0.6, drop: 0.5, taper: 0.6, softness: 0.4, density: 0.75, fill: 0.5 } },
    { id: 'thin', label: 'Thin, pencilled', params: { thickness: 0.5, arch: 1.3, peak: 0.6, taper: 0.9, softness: 0.15, fade: 0.2, density: 0.45, fill: 0.8, hairLength: 0.7, messy: 0.05 } },
    { id: 'bushy', label: 'Bushy', params: { thickness: 1.6, arch: 0.8, taper: 0.4, softness: 0.6, fade: 0.3, density: 1, fill: 0.4, hairLength: 1.45, hairWidth: 1.2, lift: 0.3, messy: 0.75 } },
    { id: 'sparse', label: 'Sparse, fair', params: { thickness: 0.9, softness: 0.7, fade: 0.8, density: 0.3, fill: 0.15, hairLength: 0.9, hairWidth: 0.8, messy: 0.35 } },
  ],
  lashes: [
    { id: 'natural', label: 'Natural', params: {} },
    { id: 'smoky', label: 'Full and smoky', params: { length: 1.3, density: 0.95, curl: 0.6, outer: 0.8, clump: 0.55, thickness: 1.5, smudge: 0.65, lower: 0.75, lowerLength: 0.8 } },
    { id: 'winged', label: 'Winged', params: { length: 1.2, density: 0.85, curl: 0.9, outer: 1, clump: 0.3, thickness: 1.6, smudge: 0.3, lower: 0.4, lowerLength: 0.5 } },
    { id: 'clumped', label: 'Long and clumped', params: { length: 1.7, density: 0.8, curl: 0.55, outer: 0.6, clump: 0.9, thickness: 1.2, smudge: 0.2, lower: 0.6, lowerLength: 1 } },
    { id: 'sparse', label: 'Sparse', params: { length: 0.8, density: 0.3, curl: 0.4, outer: 0.3, clump: 0.1, thickness: 0.6, smudge: 0, lower: 0.3, lowerLength: 0.4 } },
  ],
};

/** A layer's parameters with a preset applied: its values, the defaults elsewhere, the colours and seed kept. */
export function presetParams(layer: SkinLayer, preset: LayerPreset): SkinLayer['params'] {
  const out: SkinLayer['params'] = {};
  for (const p of layerKind(layer.kind).params) {
    if (p.type === 'color' || p.key === 'seed') out[p.key] = layerParam(layer, p.key);
    else out[p.key] = preset.params[p.key] ?? p.default;
  }
  return out;
}

/** Layer kinds the bake engine fills in, and which channel of its map each uses (r occlusion, g cavity, a light). */
export const BAKED_LAYER_CHANNEL: Partial<Record<LayerKind, 0 | 1 | 3>> = { occlusion: 0, cavity: 1, lightBake: 3 };

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
  if (spec.kind === 'brows' && isBrowPaint(r.paint)) layer.paint = r.paint;
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
    const side = (s: unknown): SidePhoto | null => {
      const v = s as Partial<SidePhoto> | null | undefined;
      if (!v || typeof v.image !== 'string' || !v.image || !Array.isArray(v.landmarks) || v.landmarks.length % 3 !== 0) return null;
      if (!v.landmarks.every((x) => typeof x === 'number' && Number.isFinite(x))) return null;
      return { image: v.image, landmarks: v.landmarks, width: Number(v.width) || 0, height: Number(v.height) || 0 };
    };
    if (p.sides && typeof p.sides === 'object') {
      const left = side(p.sides.left);
      const right = side(p.sides.right);
      if (left || right) photo.sides = { left, right };
    }
  }
  return { base: typeof raw?.base === 'string' && raw.base ? raw.base : fallbackBase, layers, photo };
}
