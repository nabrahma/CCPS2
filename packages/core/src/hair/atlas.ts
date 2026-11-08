/**
 * Hair card atlases (PRD F5 step 1): a PNG with alpha plus a list of tagged
 * card regions. Regions are found by scanning alpha coverage (vertical strips
 * first, then a grid fallback); the user can adjust, add, delete and re-tag
 * them in the atlas editor. Saved as `atlas.json` beside the PNG.
 *
 * Region coordinates are fractions of the image (0..1), origin top-left,
 * y down. Hair roots are at the top of each region.
 */

export const ATLAS_TAGS = ['clump', 'strand', 'fringe', 'flyaway', 'base'] as const;
export type AtlasTag = (typeof ATLAS_TAGS)[number];

export interface AtlasRegion {
  x: number;
  y: number;
  w: number;
  h: number;
  tag: AtlasTag;
}

export interface AtlasSpec {
  format: 'ps2cc.atlas/1';
  /** Texture path (relative to assets/core) or library URL. */
  texture: string;
  regions: AtlasRegion[];
}

export type AtlasTemplateId = 'strips4' | 'strips8' | 'grid4x2';

/** The 3 built-in layout templates (PRD F5). */
export function atlasTemplate(id: AtlasTemplateId): AtlasRegion[] {
  if (id === 'grid4x2') {
    const tags: AtlasTag[] = ['clump', 'clump', 'strand', 'strand', 'base', 'fringe', 'flyaway', 'strand'];
    return tags.map((tag, i) => ({ x: (i % 4) / 4, y: Math.floor(i / 4) / 2, w: 1 / 4, h: 1 / 2, tag }));
  }
  const n = id === 'strips4' ? 4 : 8;
  const tags: AtlasTag[] =
    n === 4 ? ['clump', 'strand', 'base', 'flyaway'] : ['clump', 'clump', 'strand', 'strand', 'base', 'fringe', 'flyaway', 'strand'];
  return tags.map((tag, i) => ({ x: i / n, y: 0, w: 1 / n, h: 1, tag }));
}

export interface DetectOptions {
  /** Alpha (0..255) above which a pixel counts as hair. */
  alphaThreshold?: number;
  /** Fraction of a column's (or row's) pixels that must be hair for it to count. */
  minCoverage?: number;
}

/**
 * Find card regions in an RGBA image: vertical strips when the columns
 * separate cleanly, otherwise a grid of cells (rows of bands, then columns).
 * Regions come back auto-tagged (see autoTag).
 */
export function detectRegions(rgba: ArrayLike<number>, width: number, height: number, opts: DetectOptions = {}): AtlasRegion[] {
  const threshold = opts.alphaThreshold ?? 24;
  const minCoverage = opts.minCoverage ?? 0.08;
  const on = (x: number, y: number) => rgba[(y * width + x) * 4 + 3]! > threshold;

  const columnRuns = (y0: number, y1: number) => {
    const cov = new Float64Array(width);
    for (let x = 0; x < width; x++) {
      let c = 0;
      for (let y = y0; y < y1; y++) if (on(x, y)) c++;
      cov[x] = c / Math.max(1, y1 - y0);
    }
    return runs(cov, minCoverage, Math.max(2, Math.round(width * 0.02)), Math.round(width * 0.006));
  };
  const rowRuns = (x0: number, x1: number) => {
    const cov = new Float64Array(height);
    for (let y = 0; y < height; y++) {
      let c = 0;
      for (let x = x0; x < x1; x++) if (on(x, y)) c++;
      cov[y] = c / Math.max(1, x1 - x0);
    }
    return runs(cov, minCoverage, Math.max(2, Math.round(height * 0.02)), Math.round(height * 0.006));
  };

  // 1. Vertical strips: column runs over the whole height, each trimmed to its own rows.
  const strips: AtlasRegion[] = [];
  let gridLike = false;
  for (const [x0, x1] of columnRuns(0, height)) {
    const rows = rowRuns(x0, x1);
    if (rows.length === 0) continue;
    // Several separate vertical runs in one column band means cells stacked in a grid.
    if (rows.length > 1) gridLike = true;
    const y0 = rows[0]![0];
    const y1 = rows[rows.length - 1]![1];
    strips.push({ x: x0 / width, y: y0 / height, w: (x1 - x0) / width, h: (y1 - y0) / height, tag: 'strand' });
  }
  const stripLike = !gridLike && strips.length > 0 && strips.every((r) => (r.h * height) / (r.w * width) >= 1.3);
  if (stripLike) return autoTag(strips, rgba, width, height, threshold);

  // 2. Grid fallback: horizontal bands, then columns inside each band.
  const cells: AtlasRegion[] = [];
  for (const [y0, y1] of rowRuns(0, width)) {
    for (const [x0, x1] of columnRuns(y0, y1)) {
      cells.push({ x: x0 / width, y: y0 / height, w: (x1 - x0) / width, h: (y1 - y0) / height, tag: 'strand' });
    }
  }
  return autoTag(cells, rgba, width, height, threshold);
}

/**
 * Starting tags (the user can change them): the densest region is the
 * `base`, the widest are `clump`, the narrowest `flyaway`, the shortest
 * `fringe` (with 5 or more regions), the rest `strand`.
 */
export function autoTag(regions: AtlasRegion[], rgba: ArrayLike<number>, width: number, height: number, threshold = 24): AtlasRegion[] {
  const out = regions.map((r) => ({ ...r }));
  if (out.length === 0) return out;
  if (out.length === 1) {
    out[0]!.tag = 'clump';
    return out;
  }
  const density = out.map((r) => {
    let on = 0;
    let all = 0;
    const x0 = Math.floor(r.x * width);
    const y0 = Math.floor(r.y * height);
    const x1 = Math.ceil((r.x + r.w) * width);
    const y1 = Math.ceil((r.y + r.h) * height);
    for (let y = y0; y < y1; y += 2) {
      for (let x = x0; x < x1; x += 2) {
        all++;
        if (rgba[(y * width + x) * 4 + 3]! > threshold) on++;
      }
    }
    return on / Math.max(1, all);
  });
  const byWidth = out.map((_, i) => i).sort((a, b) => out[b]!.w - out[a]!.w);
  const taken = new Set<number>();
  const assign = (i: number | undefined, tag: AtlasTag) => {
    if (i === undefined || taken.has(i)) return;
    out[i]!.tag = tag;
    taken.add(i);
  };
  assign(density.indexOf(Math.max(...density)), 'base');
  assign(byWidth.find((i) => !taken.has(i)), 'clump');
  if (out.length >= 3) assign([...byWidth].reverse().find((i) => !taken.has(i)), 'flyaway');
  if (out.length >= 5) {
    const byHeight = out.map((_, i) => i).sort((a, b) => out[a]!.h - out[b]!.h);
    assign(byHeight.find((i) => !taken.has(i)), 'fringe');
  }
  if (out.length >= 6) assign(byWidth.find((i) => !taken.has(i)), 'clump');
  for (let i = 0; i < out.length; i++) if (!taken.has(i)) out[i]!.tag = 'strand';
  return out;
}

/** Regions for a tag, falling back to related tags so every atlas works with every style. */
export function regionsFor(atlas: readonly AtlasRegion[], tag: AtlasTag): AtlasRegion[] {
  const fallback: Record<AtlasTag, AtlasTag[]> = {
    clump: ['clump', 'strand', 'base', 'fringe', 'flyaway'],
    strand: ['strand', 'clump', 'flyaway', 'fringe', 'base'],
    fringe: ['fringe', 'strand', 'clump', 'flyaway', 'base'],
    flyaway: ['flyaway', 'strand', 'clump', 'fringe', 'base'],
    base: ['base', 'clump', 'strand', 'fringe', 'flyaway'],
  };
  for (const t of fallback[tag]) {
    const hits = atlas.filter((r) => r.tag === t);
    if (hits.length) return hits;
  }
  return [];
}

/** Check an atlas from disk or an import; throws with a readable message. */
export function validateAtlas(raw: unknown): AtlasSpec {
  const a = raw as Partial<AtlasSpec>;
  if (!a || a.format !== 'ps2cc.atlas/1') throw new Error('not a PS2CC atlas (format ps2cc.atlas/1)');
  if (typeof a.texture !== 'string' || !a.texture) throw new Error('atlas has no texture');
  if (!Array.isArray(a.regions) || a.regions.length === 0) throw new Error('atlas has no regions');
  for (const r of a.regions) {
    const ok = [r.x, r.y, r.w, r.h].every((v) => typeof v === 'number' && Number.isFinite(v)) && r.w > 0 && r.h > 0 &&
      r.x >= 0 && r.y >= 0 && r.x + r.w <= 1.0001 && r.y + r.h <= 1.0001 && (ATLAS_TAGS as readonly string[]).includes(r.tag);
    if (!ok) throw new Error(`bad atlas region ${JSON.stringify(r)}`);
  }
  return a as AtlasSpec;
}

/** Runs of indices whose coverage is at least `min`, joining gaps up to `gap` and dropping runs shorter than `minLength`. */
function runs(cov: Float64Array, min: number, minLength: number, gap: number): [number, number][] {
  const raw: [number, number][] = [];
  let start = -1;
  for (let i = 0; i <= cov.length; i++) {
    const hit = i < cov.length && cov[i]! >= min;
    if (hit && start < 0) start = i;
    if (!hit && start >= 0) {
      raw.push([start, i]);
      start = -1;
    }
  }
  const merged: [number, number][] = [];
  for (const r of raw) {
    const last = merged[merged.length - 1];
    if (last && r[0] - last[1] <= gap) last[1] = r[1];
    else merged.push([r[0], r[1]]);
  }
  return merged.filter(([a, b]) => b - a >= minLength);
}
