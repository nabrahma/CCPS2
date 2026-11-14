/**
 * Painted eyebrows and eyelashes (D-146, D-148): hair drawn on the face
 * texture as the era's games had it, with no geometry.
 *
 * Brows are measured in units of the eye opening's half width W, in "brow
 * space": s along the brow (0 above the eye centre, outwards positive), h
 * height above the eye centre. Their outline comes from the shape settings
 * (inner start, arch, tail...) plus what the user painted on top with the
 * brow brush; inside it, hairs grow the way real brows do: upright at the
 * inner end, the lower rows leaning up and out and the upper rows down and
 * out so they meet along the middle, and lying flat along the tail.
 *
 * Lashes grow from the eye's real rim (the face island's seam with the eye
 * socket): a lash line, a fringe of curved lashes heaviest at the outer
 * corner, optionally clumped, a soft smoky shadow, and lower lashes.
 *
 * Strokes are in each eye's flat frame seen from the front: X outwards from
 * the eye centre, Y up, metres.
 */
import type { SkinLayer } from '../character/doc';
import { Rng } from '../random';
import type { Opening } from './features';
import { numParam } from './layers';
import { smoothstep, valueNoise } from './noise';
import type { Stroke } from './strokes';

// ---------------------------------------------------------------------------
// The brow brush: a grid over brow space per side that adds to or takes from
// the brow's outline.

/** The brush grid's extent in brow space (eye half widths) and its cells. */
export const BROW_GRID = { s0: -3, s1: 3.2, h0: 0, h1: 3.2, cols: 100, rows: 52 } as const;
const CELLS = BROW_GRID.cols * BROW_GRID.rows;
/** Hex digits in a painted brow: one per cell, the character's left brow then the right. */
export const BROW_PAINT_LENGTH = 2 * CELLS;

export function isBrowPaint(s: unknown): s is string {
  return typeof s === 'string' && s.length === BROW_PAINT_LENGTH && /^[0-9a-f]+$/.test(s);
}

/** Painted values per cell, -1 (erased) .. 0 (as shaped) .. 1 (added); left brow then right. */
export function decodeBrowPaint(hex: string | undefined): Float32Array {
  const out = new Float32Array(2 * CELLS);
  if (!isBrowPaint(hex)) return out;
  for (let i = 0; i < out.length; i++) out[i] = Math.max(-1, (parseInt(hex[i]!, 16) - 8) / 7);
  return out;
}

export function encodeBrowPaint(values: Float32Array): string {
  let hex = '';
  for (let i = 0; i < 2 * CELLS; i++) hex += Math.round(Math.max(0, Math.min(15, 8 + 7 * (values[i] ?? 0)))).toString(16);
  return hex;
}

/** True when nothing is painted (every cell as shaped). */
export function browPaintEmpty(values: Float32Array): boolean {
  for (let i = 0; i < values.length; i++) if (Math.abs(values[i]!) > 0.07) return false;
  return true;
}

/** The painted value at a point of brow space, read bilinearly. */
export function browPaintAt(values: Float32Array, side: 0 | 1, s: number, h: number): number {
  const g = BROW_GRID;
  const x = ((s - g.s0) / (g.s1 - g.s0)) * g.cols - 0.5;
  const y = ((h - g.h0) / (g.h1 - g.h0)) * g.rows - 0.5;
  if (x < -1 || y < -1 || x > g.cols || y > g.rows) return 0;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const at = (c: number, r: number) => (c < 0 || r < 0 || c >= g.cols || r >= g.rows ? 0 : values[side * CELLS + r * g.cols + c]!);
  return (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
}

/** Paint a soft round dab into the grid (both brows mirrored, or one side). */
export function paintBrowDab(values: Float32Array, side: 0 | 1 | 'both', s: number, h: number, radius: number, amount: number): void {
  const g = BROW_GRID;
  const cw = (g.s1 - g.s0) / g.cols;
  const ch = (g.h1 - g.h0) / g.rows;
  const sides: (0 | 1)[] = side === 'both' ? [0, 1] : [side];
  for (const sd of sides) {
    for (let r = 0; r < g.rows; r++) {
      const ch0 = g.h0 + (r + 0.5) * ch;
      if (Math.abs(ch0 - h) > radius) continue;
      for (let c = 0; c < g.cols; c++) {
        const cs = g.s0 + (c + 0.5) * cw;
        const d = Math.hypot(cs - s, ch0 - h) / radius;
        if (d >= 1) continue;
        const i = sd * CELLS + r * g.cols + c;
        const fall = 1 - smoothstep(0.35, 1, d);
        values[i] = Math.max(-1, Math.min(1, values[i]! + amount * fall));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Brow shape.

export interface BrowShape {
  /** Inner end, arch peak and tail end along the brow. */
  headS: number;
  peak: number;
  tailEnd: number;
  /** Height of the inner end, the arch's rise over it and the tail's drop below the peak. */
  base: number;
  rise: number;
  drop: number;
  thick: number;
  taper: number;
  soft: number;
  messy: number;
  fade: number;
  seed: number;
  paint: Float32Array | null;
}

export function browShape(layer: SkinLayer): BrowShape {
  const p = (key: string) => numParam(layer, key);
  const headS = -2.1 + 0.45 * p('start');
  const peak = -0.1 + 1.6 * p('peak');
  const values = decodeBrowPaint(layer.paint);
  return {
    headS,
    peak,
    tailEnd: peak + 1.7 * p('tail'),
    base: 1.32 + 0.35 * p('height'),
    rise: 0.3 * p('arch'),
    drop: 0.2 * p('drop'),
    thick: p('thickness'),
    taper: p('taper'),
    soft: p('softness'),
    messy: p('messy'),
    fade: p('fade'),
    seed: p('seed'),
    paint: browPaintEmpty(values) ? null : values,
  };
}

/** Height of the brow's middle line at s. */
export function browCentre(b: BrowShape, s: number): number {
  if (s < b.peak) {
    const t = Math.min(1, Math.max(0, (s - b.headS) / Math.max(0.1, b.peak - b.headS)));
    return b.base + b.rise * (1 - (1 - t) * (1 - t));
  }
  const t = Math.min(1.3, (s - b.peak) / Math.max(0.1, b.tailEnd - b.peak));
  return b.base + b.rise - (b.rise + b.drop) * t * t;
}

/** Half the brow's height at s: fuller at the inner end, tapering along the tail. */
export function browHalf(b: BrowShape, s: number): number {
  if (s < b.peak) return b.thick * (0.3 - 0.07 * smoothstep(b.headS, b.peak, s));
  return b.thick * 0.23 * (1 - 0.85 * b.taper * smoothstep(b.peak, b.tailEnd, s));
}

/** How much of the brow is at (s, h) on one side (0 the character's left): 0 bare .. 1 brow. */
export function browCoverage(b: BrowShape, side: 0 | 1, s: number, h: number): number {
  let v = 0;
  if (s > b.headS - 0.8 && s < b.tailEnd + 0.4) {
    const half = browHalf(b, s);
    // Ragged edges: the outline wanders by a fraction of the brow's height.
    const wander = (valueNoise(s * 2.6, h * 2.6, side * 6 - 3, b.seed + 5) - 0.5) * (0.15 + 0.6 * b.messy);
    const u = (h - browCentre(b, s)) / half + wander;
    // The lower edge is crisper than the upper one, which thins into single hairs.
    const body = u > 0 ? 1 - smoothstep(0.6 - 0.3 * b.soft, 1.15 + 0.35 * b.soft, u) : 1 - smoothstep(0.85 - 0.35 * b.soft, 1 + 0.25 * b.soft, -u);
    // The inner end is rounded: its top and bottom corners start a little further out.
    const ends =
      smoothstep(b.headS - 0.1 - 0.3 * b.soft, b.headS + 0.25 + 0.3 * b.soft, s - 0.3 * Math.min(1.5, u * u)) * (1 - smoothstep(b.tailEnd - 0.45, b.tailEnd + 0.05, s));
    // The inner end is lighter, as real brows are.
    const head = 1 - 0.6 * b.fade * (1 - smoothstep(b.headS, b.headS + 1.2, s));
    v = body * ends * head;
  }
  if (b.paint) v += browPaintAt(b.paint, side, s, h);
  return Math.min(1, Math.max(0, v));
}

/**
 * The brow's hairs on one side, in that eye's frame. Hair count follows the
 * density and the brow's area; each hair is a few millimetres long and about
 * a tenth of a millimetre wide.
 */
export function browStrokes(layer: SkinLayer, b: BrowShape, eye: Opening, side: 0 | 1, k: number): Stroke[] {
  const density = numParam(layer, 'density');
  const hairLength = numParam(layer, 'hairLength');
  const hairWidth = numParam(layer, 'hairWidth');
  const lift = numParam(layer, 'lift');
  const W = eye.halfWidth;
  const rng = new Rng(Math.round(b.seed) * 7919 + side * 104729 + 17);
  const g = BROW_GRID;
  const s0 = b.paint ? g.s0 : b.headS - 0.8;
  const s1 = b.paint ? g.s1 : b.tailEnd + 0.4;
  const h0 = b.paint ? g.h0 : 0.2;
  const h1 = b.paint ? g.h1 : 3.2;
  // Hairs per square half-width (W is about 14 mm, so 200 is about one hair per square millimetre).
  const rate = 40 + 260 * density;
  const candidates = Math.min(30000, Math.round(rate * (s1 - s0) * (h1 - h0)));
  const out: Stroke[] = [];
  for (let i = 0; i < candidates; i++) {
    const s = rng.range(s0, s1);
    const h = rng.range(h0, h1);
    const c = browCoverage(b, side, s, h);
    const r1 = rng.next();
    if (c <= 0 || r1 > Math.pow(c, 1.2)) continue;
    const half = browHalf(b, s);
    const u = Math.max(-1.5, Math.min(1.5, (h - browCentre(b, s)) / half));
    const tangent = Math.atan2(browCentre(b, s + 0.05) - browCentre(b, s - 0.05), 0.1);
    const head = 1 - smoothstep(b.headS + 0.2, b.headS + 1.0, s);
    const tail = smoothstep(b.peak, b.tailEnd, s);
    // The lower rows lean up and out, the upper rows down and out, meeting along the middle.
    const bodyAngle = (0.42 - 0.62 * smoothstep(-0.7, 0.7, u)) * (1 - 0.75 * tail);
    const headAngle = 1.25 + 0.15 * u;
    const angle = tangent + bodyAngle + (headAngle - bodyAngle) * head + 0.35 * lift * (1 - 0.5 * tail) + rng.gauss() * (0.06 + 0.22 * b.messy);
    // Hairs bend towards the run of the brow.
    const bend = (tangent - angle) * 0.3 + rng.gauss() * 0.1 * b.messy;
    const len = k * 0.0058 * hairLength * (0.75 + 0.5 * rng.next()) * (1 - 0.3 * head) * (1 - 0.25 * tail);
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    const x0 = s * W - ca * len * 0.3;
    const y0 = h * W - sa * len * 0.3;
    const x1 = x0 + ca * len * 0.5;
    const y1 = y0 + sa * len * 0.5;
    const w0 = k * 0.00018 * hairWidth * (0.8 + 0.4 * rng.next());
    out.push({
      x0,
      y0,
      x1,
      y1,
      x2: x1 + Math.cos(angle + bend) * len * 0.5,
      y2: y1 + Math.sin(angle + bend) * len * 0.5,
      w0,
      w1: 0.4 * w0,
      a: 0.9 * (0.75 + 0.25 * rng.next()),
      fade: 0.5,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Lashes.

/** An eye rim as radius by angle round its centre, seen from the front (sorted by angle). */
export interface RimProfile {
  angles: number[];
  radii: number[];
}

export function rimProfile(e: Opening): RimProfile {
  if (!e.rim || e.rim.length < 3) {
    // No rim measured: the opening's ellipse.
    const angles: number[] = [];
    const radii: number[] = [];
    for (let i = 0; i < 32; i++) {
      const t = -Math.PI + (i / 32) * 2 * Math.PI;
      angles.push(t);
      radii.push(Math.hypot(e.halfWidth * Math.cos(t), e.halfHeight * Math.sin(t)));
    }
    return { angles, radii };
  }
  const pts = e.rim.map((v) => ({ a: Math.atan2(v[1] - e.centre[1], v[0] - e.centre[0]), r: Math.hypot(v[0] - e.centre[0], v[1] - e.centre[1]) }));
  pts.sort((x, y) => x.a - y.a);
  return { angles: pts.map((x) => x.a), radii: pts.map((x) => x.r) };
}

/** The rim's radius at an angle (world frame, seen from the front), linear between its points. */
export function rimRadius(rim: RimProfile, th: number): number {
  const { angles, radii } = rim;
  const n = angles.length;
  let hi = 0;
  while (hi < n && angles[hi]! < th) hi++;
  const lo = (hi - 1 + n) % n;
  const h = hi % n;
  let a0 = angles[lo]!;
  let a1 = angles[h]!;
  if (hi === 0) a0 -= 2 * Math.PI;
  if (hi === n) a1 += 2 * Math.PI;
  const t = a1 > a0 ? (th - a0) / (a1 - a0) : 0;
  return radii[lo]! + (radii[h]! - radii[lo]!) * t;
}

/** The lashes of one eye, in its frame (X outwards). */
export function lashStrokes(layer: SkinLayer, eye: Opening, rim: RimProfile, k: number): Stroke[] {
  const p = (key: string) => numParam(layer, key);
  const length = p('length');
  const density = p('density');
  const curl = p('curl');
  const outer = p('outer');
  const clump = p('clump');
  const lower = p('lower');
  const lowerLength = p('lowerLength');
  const thickness = p('thickness');
  const sign = Math.sign(eye.centre[0]) || 1;
  const rng = new Rng(Math.round(p('seed')) * 6151 + (sign > 0 ? 0 : 7) + 3);
  // The rim in the eye's frame at angle a (0 the outer corner, pi the inner one).
  const rimAt = (a: number, out: number): [number, number] => {
    const world = sign > 0 ? a : Math.PI - a;
    const r = rimRadius(rim, Math.atan2(Math.sin(world), Math.cos(world))) + out;
    return [r * Math.cos(a), r * Math.sin(a)];
  };
  const normalAt = (a: number): number => {
    const [ax, ay] = rimAt(a - 0.03, 0);
    const [bx, by] = rimAt(a + 0.03, 0);
    // Perpendicular to the rim, pointing away from the eye.
    let nx = by - ay;
    let ny = -(bx - ax);
    const [px, py] = rimAt(a, 0);
    if (nx * px + ny * py < 0) {
      nx = -nx;
      ny = -ny;
    }
    return Math.atan2(ny, nx);
  };

  const out: Stroke[] = [];
  // Upper lashes: u runs along the lid from the inner corner (0) to the outer one (1).
  const upper: { u: number; stroke: Stroke }[] = [];
  const count = Math.round(40 + 110 * density);
  const extra = Math.round(count * 0.4 * outer);
  for (let i = 0; i < count + extra; i++) {
    const u = i < count ? 0.1 + 0.89 * ((i + rng.next()) / count) : 0.6 + 0.4 * rng.next();
    const a = Math.PI * (1 - u);
    const [rx, ry] = rimAt(a, 0.00025 * k);
    // Lashes sweep towards the outer corner, more so further out and with more flare.
    const n = normalAt(a);
    const angle = n * (1 - curl * (0.15 + 0.45 * u)) + rng.gauss() * 0.08;
    const bend = -(0.15 + 0.35 * curl) + rng.gauss() * 0.06;
    const profile = (0.45 + 0.55 * smoothstep(0.05, 0.6, u)) * (1 + 0.45 * outer * smoothstep(0.55, 0.95, u)) * (1 - 0.35 * smoothstep(0.93, 1, u));
    const len = length * 0.0031 * k * profile * (0.8 + 0.4 * rng.next());
    const x1 = rx + Math.cos(angle) * len * 0.5;
    const y1 = ry + Math.sin(angle) * len * 0.5;
    const w0 = k * 0.0003 * (0.7 + 0.3 * thickness) * (0.8 + 0.4 * rng.next());
    upper.push({
      u,
      stroke: {
        x0: rx,
        y0: ry,
        x1,
        y1,
        x2: x1 + Math.cos(angle + bend) * len * 0.5,
        y2: y1 + Math.sin(angle + bend) * len * 0.5,
        w0,
        w1: 0.15 * w0,
        a: 0.95,
        fade: 0.3,
      },
    });
  }
  // Clumps: neighbouring lashes' tips drawn together into spikes.
  if (clump > 0) {
    const groups = Math.round(16 + 10 * density);
    const tips = new Map<number, { x: number; y: number; n: number }>();
    const group = (u: number) => Math.min(groups - 1, Math.floor(((u - 0.1) / 0.9) * groups));
    for (const { u, stroke } of upper) {
      const g = group(u);
      const t = tips.get(g) ?? { x: 0, y: 0, n: 0 };
      t.x += stroke.x2;
      t.y += stroke.y2;
      t.n++;
      tips.set(g, t);
    }
    for (const { u, stroke } of upper) {
      const t = tips.get(group(u))!;
      const pull = clump * 0.75;
      const dx = (t.x / t.n - stroke.x2) * pull;
      const dy = (t.y / t.n - stroke.y2) * pull;
      stroke.x2 += dx;
      stroke.y2 += dy;
      stroke.x1 += dx * 0.35;
      stroke.y1 += dy * 0.35;
    }
  }
  for (const l of upper) out.push(l.stroke);
  // Lower lashes: fewer, shorter and finer, pointing down and a little outwards.
  const lowerCount = Math.round((15 + 45 * density) * lower);
  for (let i = 0; i < lowerCount && lowerLength > 0; i++) {
    const u = 0.25 + 0.72 * ((i + rng.next()) / lowerCount);
    const a = -Math.PI * (1 - u);
    const [rx, ry] = rimAt(a, 0.0002 * k);
    const angle = normalAt(a) * (1 - 0.25 * curl * u) + rng.gauss() * 0.1;
    const len = lowerLength * 0.0022 * k * (0.5 + 0.5 * smoothstep(0.2, 0.8, u)) * (0.7 + 0.6 * rng.next());
    const x1 = rx + Math.cos(angle) * len * 0.5;
    const y1 = ry + Math.sin(angle) * len * 0.5;
    const w0 = k * 0.00018 * (0.8 + 0.4 * rng.next());
    out.push({
      x0: rx,
      y0: ry,
      x1,
      y1,
      x2: x1 + Math.cos(angle + 0.1) * len * 0.5,
      y2: y1 + Math.sin(angle + 0.1) * len * 0.5,
      w0,
      w1: 0.2 * w0,
      a: 0.55 + 0.3 * lower,
      fade: 0.5,
    });
  }
  return out;
}
