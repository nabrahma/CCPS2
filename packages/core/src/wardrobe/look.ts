/**
 * How a garment is dressed (Part 2 F18): material zones, seams and stitches,
 * folds and decals. Stored on the worn garment (`GarmentSlot.look`) and, as
 * the garment's defaults, in a library garment's document.
 */

export interface MaterialZone {
  /** Stable id (for the UI and the mask). */
  id: string;
  name: string;
  /** UV islands this zone covers; 'rest' takes every island no other zone names. */
  islands: number[] | 'rest';
  /** A library material id, or null for the garment's own texture. */
  material: string | null;
  /** Multiplies the material's colour (0..1 sRGB). */
  tint: [number, number, number];
  /** Tile size relative to the material's real size (1 = true scale). */
  scale: number;
  /** Degrees, turns the weave on the garment. */
  rotation: number;
  /** Scuffed and faded edges, 0..1. */
  wear: number;
}

export interface SeamStyle {
  /** Stitch opacity, 0 = no stitches. */
  stitches: number;
  /** Thread colour; null = a lighter shade of the cloth under it. */
  thread: [number, number, number] | null;
  /** Darkening along seams and hems, 0..1. */
  shadow: number;
  /** Distance between stitches, millimetres. */
  spacingMm: number;
  /** Rows of stitching along hems and openings. */
  hemRows: 1 | 2;
}

export type FoldSite = 'elbows' | 'armpits' | 'waist' | 'crotch' | 'knees';
export const FOLD_SITES: FoldSite[] = ['elbows', 'armpits', 'waist', 'crotch', 'knees'];

export interface FoldSettings {
  /** Overall fold strength, 0..1.5. */
  strength: number;
  /** Per site, 0..2 (1 = as measured from the garment's looseness there). */
  sites: Record<FoldSite, number>;
  /** Varies the fold pattern. */
  seed: number;
}

export type DecalKind = 'zip' | 'button' | 'rivet' | 'buckle' | 'strap' | 'pocketFlap' | 'pocket';
export const DECAL_KINDS: DecalKind[] = ['zip', 'button', 'rivet', 'buckle', 'strap', 'pocketFlap', 'pocket'];
/** Zips and straps run between two points; the rest sit at one. */
export const LINE_DECALS: ReadonlySet<DecalKind> = new Set<DecalKind>(['zip', 'strap']);

export interface Decal {
  id: string;
  kind: DecalKind;
  /** Garment UV (v up) of the centre, or of the start of a zip or strap. */
  uv: [number, number];
  /** Zips and straps: the end. */
  uv2?: [number, number];
  /** Width (mm): a button's diameter, a pocket's width, a zip's or strap's width. */
  sizeMm: number;
  /** Pockets and flaps: height (mm). */
  heightMm?: number;
  /** Degrees. */
  rotation: number;
  /** Metal or leather colour (0..1 sRGB). */
  colour: [number, number, number];
}

/** Zone indices painted over the garment's UVs, run-length encoded (0 = no zone painted). */
export interface ZoneMask {
  size: number;
  /** "count:zone,count:zone,..." row by row, row 0 = v 1. */
  rle: string;
}

export interface GarmentLook {
  zones: MaterialZone[];
  mask: ZoneMask | null;
  seams: SeamStyle;
  folds: FoldSettings;
  decals: Decal[];
}

export const DEFAULT_SEAMS: SeamStyle = { stitches: 0.8, thread: null, shadow: 0.6, spacingMm: 4, hemRows: 2 };
export const DEFAULT_FOLDS: FoldSettings = { strength: 0.8, sites: { elbows: 1, armpits: 1, waist: 1, crotch: 1, knees: 1 }, seed: 1 };

export const DECAL_DEFAULTS: Record<DecalKind, { sizeMm: number; heightMm?: number; colour: [number, number, number] }> = {
  zip: { sizeMm: 10, colour: [0.72, 0.7, 0.66] },
  button: { sizeMm: 16, colour: [0.25, 0.2, 0.16] },
  rivet: { sizeMm: 8, colour: [0.7, 0.6, 0.42] },
  buckle: { sizeMm: 40, colour: [0.7, 0.7, 0.68] },
  strap: { sizeMm: 30, colour: [0.22, 0.16, 0.12] },
  pocketFlap: { sizeMm: 120, heightMm: 50, colour: [0.25, 0.2, 0.16] },
  pocket: { sizeMm: 130, heightMm: 150, colour: [0.25, 0.2, 0.16] },
};

/** A garment dressed in one material, with seams and folds on. */
export function newLook(material: string | null = null): GarmentLook {
  return {
    zones: [{ id: 'z1', name: 'Garment', islands: 'rest', material, tint: [1, 1, 1], scale: 1, rotation: 0, wear: 0 }],
    mask: null,
    seams: { ...DEFAULT_SEAMS },
    folds: { ...DEFAULT_FOLDS, sites: { ...DEFAULT_FOLDS.sites } },
    decals: [],
  };
}

const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const rgb = (v: unknown, d: [number, number, number]): [number, number, number] =>
  Array.isArray(v) && v.length === 3 && v.every((c) => typeof c === 'number' && Number.isFinite(c)) ? (v.map((c: number) => Math.min(1, Math.max(0, c))) as [number, number, number]) : d;
const uv = (v: unknown): [number, number] | null =>
  Array.isArray(v) && v.length === 2 && v.every((c) => typeof c === 'number' && Number.isFinite(c)) ? [v[0] as number, v[1] as number] : null;
const str = (v: unknown, d: string, max = 80) => (typeof v === 'string' ? v.slice(0, max) : d);

/** A look read from a file: every field checked and clamped. */
export function sanitiseLook(raw: unknown): GarmentLook {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const zones = (Array.isArray(r.zones) ? r.zones : []).slice(0, 16).map((z: unknown, i): MaterialZone => {
    const o = (z && typeof z === 'object' ? z : {}) as Record<string, unknown>;
    const islands = o.islands === 'rest' ? 'rest' : Array.isArray(o.islands) ? o.islands.filter((x) => Number.isInteger(x) && x >= 0 && x < 100000).slice(0, 4096) : [];
    return {
      id: str(o.id, `z${i + 1}`, 24),
      name: str(o.name, `Zone ${i + 1}`),
      islands,
      material: typeof o.material === 'string' ? o.material.slice(0, 200) : null,
      tint: rgb(o.tint, [1, 1, 1]),
      scale: num(o.scale, 0.1, 10, 1),
      rotation: num(o.rotation, -360, 360, 0),
      wear: num(o.wear, 0, 1, 0),
    };
  });
  const s = (r.seams && typeof r.seams === 'object' ? r.seams : {}) as Record<string, unknown>;
  const f = (r.folds && typeof r.folds === 'object' ? r.folds : {}) as Record<string, unknown>;
  const fs = (f.sites && typeof f.sites === 'object' ? f.sites : {}) as Record<string, unknown>;
  const decals = (Array.isArray(r.decals) ? r.decals : []).slice(0, 64).flatMap((d: unknown, i): Decal[] => {
    const o = (d && typeof d === 'object' ? d : {}) as Record<string, unknown>;
    const kind = DECAL_KINDS.includes(o.kind as DecalKind) ? (o.kind as DecalKind) : null;
    const at = uv(o.uv);
    if (!kind || !at) return [];
    const def = DECAL_DEFAULTS[kind];
    const end = uv(o.uv2);
    return [
      {
        id: str(o.id, `d${i + 1}`, 24),
        kind,
        uv: at,
        ...(LINE_DECALS.has(kind) ? { uv2: end ?? [at[0], at[1] - 0.1] } : {}),
        sizeMm: num(o.sizeMm, 2, 600, def.sizeMm),
        ...(def.heightMm !== undefined ? { heightMm: num(o.heightMm, 2, 600, def.heightMm) } : {}),
        rotation: num(o.rotation, -360, 360, 0),
        colour: rgb(o.colour, def.colour),
      },
    ];
  });
  const m = r.mask && typeof r.mask === 'object' ? (r.mask as Record<string, unknown>) : null;
  const mask = m && Number.isInteger(m.size) && (m.size as number) >= 16 && (m.size as number) <= 1024 && typeof m.rle === 'string' && /^[0-9:,]*$/.test(m.rle) ? { size: m.size as number, rle: m.rle } : null;
  return {
    zones: zones.length ? zones : newLook().zones,
    mask,
    seams: {
      stitches: num(s.stitches, 0, 1, DEFAULT_SEAMS.stitches),
      thread: s.thread === null || s.thread === undefined ? null : rgb(s.thread, [0.8, 0.75, 0.65]),
      shadow: num(s.shadow, 0, 1, DEFAULT_SEAMS.shadow),
      spacingMm: num(s.spacingMm, 2, 12, DEFAULT_SEAMS.spacingMm),
      hemRows: s.hemRows === 1 ? 1 : 2,
    },
    folds: {
      strength: num(f.strength, 0, 1.5, DEFAULT_FOLDS.strength),
      sites: Object.fromEntries(FOLD_SITES.map((k) => [k, num(fs[k], 0, 2, 1)])) as Record<FoldSite, number>,
      seed: Math.round(num(f.seed, 0, 1e6, 1)),
    },
    decals,
  };
}

/** Run-length encode zone indices (row 0 = v 1). */
export function encodeMask(size: number, zones: Uint8Array): ZoneMask {
  const parts: string[] = [];
  let run = 0;
  let cur = zones[0] ?? 0;
  for (let i = 0; i < zones.length; i++) {
    if (zones[i] === cur) run++;
    else {
      parts.push(`${run}:${cur}`);
      cur = zones[i]!;
      run = 1;
    }
  }
  if (run) parts.push(`${run}:${cur}`);
  return { size, rle: parts.join(',') };
}

export function decodeMask(mask: ZoneMask): Uint8Array {
  const out = new Uint8Array(mask.size * mask.size);
  let i = 0;
  for (const part of mask.rle.split(',')) {
    if (!part) continue;
    const [n, z] = part.split(':').map(Number) as [number, number];
    out.fill(Math.min(255, z), i, Math.min(out.length, i + n));
    i += n;
    if (i >= out.length) break;
  }
  return out;
}

/** A stable key for caching the composed texture. */
export function lookKey(look: GarmentLook): string {
  return JSON.stringify(look);
}
