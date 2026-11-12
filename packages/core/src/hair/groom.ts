/**
 * Groom brushes for Hair Studio (PRD F15). The tool set is Blender's curves
 * sculpting set (Add, Delete, Comb, Snake Hook, Grow/Shrink, Pinch, Puff,
 * Smooth, Slide, Density, Selection), with its options: radius, strength,
 * falloff, X symmetry and front-facing only. The algorithms here are PS2CC's
 * own, written from what each tool is documented to do; no Blender code is
 * used (DECISIONS D-104).
 *
 * Brushes work in screen space, like Blender's: a dab is a move of the brush
 * from one screen point to another, and a curve point's weight falls off with
 * its distance on screen from the brush. Curves are in world space on the
 * current body; Hair Studio converts them to and from the authored groom
 * (style.groom.curves) on the neutral head. A stroke never changes its input:
 * every dab returns new curves, so undo is a stroke's starting state.
 *
 * In card mode (D-114) the same brushes work on the hand-placed cards: every
 * curve is one card and carries its settings, and a curve added by Add or
 * Density takes the settings of the nearest card.
 */
import { resample } from './curves';
import type { CardCurve } from './generate';
import type { ScalpRoot } from './scalp';

type Vec3 = [number, number, number];
type Vec2 = [number, number];

export const GROOM_TOOLS = ['comb', 'snakeHook', 'grow', 'shrink', 'pinch', 'puff', 'smooth', 'slide', 'add', 'delete', 'density', 'select'] as const;
export type GroomTool = (typeof GROOM_TOOLS)[number];

export type Falloff = 'smooth' | 'linear' | 'constant';

export interface GroomCurve {
  root: ScalpRoot;
  /** World positions, root first. */
  points: Vec3[];
  /** Lock tool: width and curl of the locks that follow this guide. */
  lockWidth?: number;
  lockCurl?: number;
  /** Selection weight, 0..1 (the Selection brush; tools act on selected curves when any are selected). */
  selected?: number;
  /** Card mode: the card this curve makes. */
  card?: GroomCard;
}

/** A hand-placed card's settings, as Hair Studio edits them (width in metres on the current body). */
export type GroomCard = Omit<CardCurve, 'root' | 'points' | 'culled'>;

/** Points of a drawn or added card curve. */
export const DRAWN_CURVE_POINTS = 12;

/**
 * A curve drawn with the Draw tool: the pointer's path in world space, root
 * first, evenly resampled. Null when the path is too short to be a hair.
 */
export function drawnCurve(path: readonly Vec3[], minLength = 0.004): Vec3[] | null {
  if (path.length < 2) return null;
  let length = 0;
  for (let i = 1; i < path.length; i++) length += dist(path[i - 1]!, path[i]!);
  if (length < minLength) return null;
  return resample(path.map((p) => [p[0], p[1], p[2]] as Vec3), DRAWN_CURVE_POINTS);
}

/** The settings of the card whose root is nearest a point (what a new card in card mode starts with). */
export function nearestCard(curves: readonly GroomCurve[], at: Vec3): GroomCard | undefined {
  let best: GroomCurve | undefined;
  let bd = Infinity;
  for (const c of curves) {
    if (!c.card) continue;
    const d = dist(c.points[0]!, at);
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best?.card ? { ...best.card } : undefined;
}

export interface BrushSettings {
  /** Radius on screen, pixels. */
  radius: number;
  /** 0..1. */
  strength: number;
  falloff: Falloff;
  /** Mirror every dab across the head's middle (X). */
  symmetry: boolean;
  /** Leave curves whose roots face away from the camera alone. */
  frontOnly: boolean;
  /** Grow/Shrink and Selection: the opposite action (Ctrl in Blender). */
  invert?: boolean;
  /** Density brush: wanted spacing between roots, metres. */
  spacing?: number;
}

export const DEFAULT_BRUSH: BrushSettings = { radius: 60, strength: 0.5, falloff: 'smooth', symmetry: true, frontOnly: true, spacing: 0.012 };

/** What a brush needs to know about the view and the head. */
export interface GroomContext {
  /** World to screen pixels, with view depth (larger is further away). */
  project(p: Vec3): { x: number; y: number; depth: number };
  /** Screen pixels at a view depth back to world. */
  unproject(x: number, y: number, depth: number): Vec3;
  /** Camera position. */
  eye: Vec3;
  /** Outward normal of the scalp at a root. */
  rootNormal(root: ScalpRoot): Vec3;
  /** Where a screen point hits the scalp (Add, Density, Slide), or null. */
  pick(x: number, y: number): { root: ScalpRoot; point: Vec3; normal: Vec3 } | null;
  /** The nearest scalp point to a world point, as a root (Slide), or null. */
  attach(p: Vec3): { root: ScalpRoot; point: Vec3; normal: Vec3 } | null;
  /** Mirror a world point across the head's middle (X symmetry). */
  mirror(p: Vec3): Vec3;
}

export interface Dab {
  from: Vec2;
  to: Vec2;
}

/** Brush weight at a distance from its centre, 0..1. */
export function falloff(kind: Falloff, distance: number, radius: number): number {
  if (radius <= 0) return 0;
  const t = distance / radius;
  if (t >= 1) return 0;
  if (kind === 'constant') return 1;
  if (kind === 'linear') return 1 - t;
  const s = 1 - t * t;
  return s * s;
}

/** Apply one dab of a tool; returns the new curves (the input is not changed). */
export function applyDab(curves: readonly GroomCurve[], tool: GroomTool, s: BrushSettings, ctx: GroomContext, dab: Dab): GroomCurve[] {
  let out = dabOnce(curves, tool, s, ctx, dab);
  if (s.symmetry) {
    const m = mirrorDab(ctx, dab);
    if (m) out = dabOnce(out, tool, s, ctx, m);
  }
  return out;
}

/** The same dab across the head's middle: the brush's point on the head mirrored, and its move mirrored. */
function mirrorDab(ctx: GroomContext, dab: Dab): Dab | null {
  const hit = ctx.pick(dab.to[0], dab.to[1]);
  if (!hit) return null;
  const depth = ctx.project(hit.point).depth;
  const a = ctx.unproject(dab.from[0], dab.from[1], depth);
  const b = ctx.unproject(dab.to[0], dab.to[1], depth);
  const ma = ctx.project(ctx.mirror(a));
  const mb = ctx.project(ctx.mirror(b));
  // Too close to the middle: the mirrored dab would act on the same curves twice.
  if (Math.hypot(mb.x - dab.to[0], mb.y - dab.to[1]) < 1) return null;
  return { from: [ma.x, ma.y], to: [mb.x, mb.y] };
}

function dabOnce(curves: readonly GroomCurve[], tool: GroomTool, s: BrushSettings, ctx: GroomContext, dab: Dab): GroomCurve[] {
  const anySelected = curves.some((c) => (c.selected ?? 0) > 0);
  // Selected curves only, when there is a selection (and the brush is not the selection brush itself).
  const mask = (c: GroomCurve) => (tool === 'select' || !anySelected ? 1 : (c.selected ?? 0));
  const faces = (c: GroomCurve) => {
    if (!s.frontOnly) return true;
    const r = c.points[0]!;
    const n = ctx.rootNormal(c.root);
    return dot(n, sub(ctx.eye, r)) > 0;
  };
  const centre = dab.to;
  const pointWeight = (p: Vec3) => {
    const q = ctx.project(p);
    return falloff(s.falloff, Math.hypot(q.x - centre[0], q.y - centre[1]), s.radius);
  };
  const k = Math.min(1, Math.max(0, s.strength));
  switch (tool) {
    case 'comb':
      return curves.map((c) => (faces(c) ? comb(c, ctx, dab, (p) => pointWeight(p) * k * mask(c)) : c));
    case 'snakeHook':
      return curves.map((c) => (faces(c) ? snakeHook(c, ctx, dab, s, k * mask(c)) : c));
    case 'grow':
    case 'shrink': {
      const sign = (tool === 'grow') !== Boolean(s.invert) ? 1 : -1;
      return curves.map((c) => {
        if (!faces(c)) return c;
        const w = maxWeight(c, pointWeight) * k * mask(c);
        return w > 0 ? resize(c, 1 + sign * 0.08 * w) : c;
      });
    }
    case 'pinch':
      return curves.map((c) => (faces(c) ? pinch(c, ctx, centre, (p) => pointWeight(p) * k * mask(c)) : c));
    case 'puff':
      return curves.map((c) => (faces(c) ? puff(c, ctx, (p) => pointWeight(p) * k * mask(c)) : c));
    case 'smooth':
      return curves.map((c) => (faces(c) ? smooth(c, (p) => pointWeight(p) * k * mask(c)) : c));
    case 'slide':
      return curves.map((c) => (faces(c) ? slide(c, ctx, dab, pointWeight(c.points[0]!) * k * mask(c)) : c));
    case 'select':
      return curves.map((c) => {
        if (!faces(c)) return c;
        const w = maxWeight(c, pointWeight) * k;
        if (w <= 0) return c;
        const sel = Math.min(1, Math.max(0, (c.selected ?? 0) + (s.invert ? -w : w)));
        return { ...c, selected: sel };
      });
    case 'delete':
      return curves.filter((c) => !(faces(c) && pointWeight(c.points[0]!) * mask(c) > 1 - k));
    case 'add':
      return addCurve(curves, ctx, centre);
    case 'density':
      return density(curves, ctx, centre, s, faces);
  }
}

function maxWeight(c: GroomCurve, weight: (p: Vec3) => number): number {
  let w = 0;
  for (const p of c.points) w = Math.max(w, weight(p));
  return w;
}

/** World move of a screen move, at a point's depth. */
function worldDelta(ctx: GroomContext, p: Vec3, dab: Dab): Vec3 {
  const q = ctx.project(p);
  const a = ctx.unproject(q.x, q.y, q.depth);
  const b = ctx.unproject(q.x + dab.to[0] - dab.from[0], q.y + dab.to[1] - dab.from[1], q.depth);
  return sub(b, a);
}

/**
 * Comb: points move with the brush, by their weight, the root stays where it
 * is, and every segment keeps its length (follow the leader from the root).
 */
function comb(c: GroomCurve, ctx: GroomContext, dab: Dab, weight: (p: Vec3) => number): GroomCurve {
  const lengths = segmentLengths(c.points);
  const pts = c.points.map((p) => [...p] as Vec3);
  let moved = false;
  for (let i = 1; i < pts.length; i++) {
    const w = weight(c.points[i]!);
    if (w <= 0) continue;
    pts[i] = add(pts[i]!, mul(worldDelta(ctx, c.points[i]!, dab), w));
    moved = true;
  }
  if (!moved) return c;
  return { ...c, points: keepLengths(pts, lengths) };
}

/**
 * Snake hook: the tip goes with the brush and the curve follows it, growing
 * or shortening as it must; the shape between root and tip bends smoothly.
 */
function snakeHook(c: GroomCurve, ctx: GroomContext, dab: Dab, s: BrushSettings, k: number): GroomCurve {
  const tip = c.points[c.points.length - 1]!;
  const q = ctx.project(tip);
  const w = falloff(s.falloff, Math.hypot(q.x - dab.from[0], q.y - dab.from[1]), s.radius) * k;
  if (w <= 0) return c;
  const d = mul(worldDelta(ctx, tip, dab), w);
  const n = c.points.length - 1;
  const pts = c.points.map((p, i) => add(p, mul(d, (i / n) ** 2)));
  pts[0] = [...c.points[0]!];
  return { ...c, points: pts };
}

/** Grow or shrink from the root: the curve is extended along its last direction, or cut back. */
function resize(c: GroomCurve, factor: number): GroomCurve {
  const pts = c.points;
  const lengths = segmentLengths(pts);
  const total = lengths.reduce((a, b) => a + b, 0);
  if (total <= 1e-9) return c;
  const want = Math.max(0.002, total * factor);
  // Walk the curve (extended straight past its tip) to the new length, then space the points evenly.
  const last = pts[pts.length - 1]!;
  const dir = normalise(sub(last, pts[pts.length - 2]!));
  const at = (arc: number): Vec3 => {
    if (arc >= total) return add(last, mul(dir, arc - total));
    let acc = 0;
    for (let i = 0; i < lengths.length; i++) {
      const l = lengths[i]!;
      if (acc + l >= arc) return lerp(pts[i]!, pts[i + 1]!, l > 0 ? (arc - acc) / l : 0);
      acc += l;
    }
    return last;
  };
  const n = pts.length - 1;
  return { ...c, points: pts.map((_, i) => (i === 0 ? [...pts[0]!] as Vec3 : at((want * i) / n))) };
}

/** Pinch: points move towards the brush centre (on the screen plane at their depth). */
function pinch(c: GroomCurve, ctx: GroomContext, centre: Vec2, weight: (p: Vec3) => number): GroomCurve {
  const lengths = segmentLengths(c.points);
  let moved = false;
  const pts = c.points.map((p, i) => {
    if (i === 0) return [...p] as Vec3;
    const w = weight(p) * 0.25;
    if (w <= 0) return [...p] as Vec3;
    const q = ctx.project(p);
    const target = ctx.unproject(centre[0], centre[1], q.depth);
    moved = true;
    return lerp(p, target, w);
  });
  return moved ? { ...c, points: keepLengths(pts, lengths) } : c;
}

/** Puff: points lift away from the scalp along the root's normal, more towards the root (volume). */
function puff(c: GroomCurve, ctx: GroomContext, weight: (p: Vec3) => number): GroomCurve {
  const n = ctx.rootNormal(c.root);
  const lengths = segmentLengths(c.points);
  const total = lengths.reduce((a, b) => a + b, 0);
  let moved = false;
  const pts = c.points.map((p, i) => {
    if (i === 0) return [...p] as Vec3;
    const w = weight(p);
    if (w <= 0) return [...p] as Vec3;
    moved = true;
    // Rotate the hair up off the head: lift grows along it (but less than its own length).
    return add(p, mul(n, w * 0.2 * total * Math.min(1, i / 3)));
  });
  return moved ? { ...c, points: keepLengths(pts, lengths) } : c;
}

/**
 * Smooth: every inner point moves towards the middle of its neighbours (less
 * curvature); the curve then keeps its total length, each segment in its new direction.
 */
function smooth(c: GroomCurve, weight: (p: Vec3) => number): GroomCurve {
  const P = c.points;
  if (P.length < 3) return c;
  const total = segmentLengths(P).reduce((a, b) => a + b, 0);
  let moved = false;
  const pts = P.map((p, i) => {
    if (i === 0 || i === P.length - 1) return [...p] as Vec3;
    const w = weight(p) * 0.5;
    if (w <= 0) return [...p] as Vec3;
    moved = true;
    return lerp(p, mul(add(P[i - 1]!, P[i + 1]!), 0.5), w);
  });
  if (!moved) return c;
  // Rebuild from the root along the smoothed segments' own directions, stretched to the old total length.
  const now = segmentLengths(pts);
  const k = total / Math.max(1e-12, now.reduce((a, b) => a + b, 0));
  const out: Vec3[] = [[...pts[0]!]];
  for (let i = 1; i < pts.length; i++) out.push(add(out[i - 1]!, mul(sub(pts[i]!, pts[i - 1]!), k)));
  return { ...c, points: out };
}

/** Slide: the root moves over the scalp with the brush, the curve keeps its shape. */
function slide(c: GroomCurve, ctx: GroomContext, dab: Dab, w: number): GroomCurve {
  if (w <= 0) return c;
  const r = c.points[0]!;
  const moved = add(r, mul(worldDelta(ctx, r, dab), w));
  const hit = ctx.attach(moved);
  if (!hit) return c;
  const shift = sub(hit.point, r);
  return { ...c, root: hit.root, points: c.points.map((p) => add(p, shift)) };
}

/** Add: a new curve at the brush on the scalp, shaped like the curves around it. */
function addCurve(curves: readonly GroomCurve[], ctx: GroomContext, centre: Vec2): GroomCurve[] {
  const hit = ctx.pick(centre[0], centre[1]);
  if (!hit) return [...curves];
  const shape = interpolatedShape(curves, hit.point, hit.normal);
  const card = nearestCard(curves, hit.point);
  return [...curves, { root: hit.root, points: shape.map((o) => add3(hit.point, o)), ...(card ? { card } : {}) }];
}

/** Density: remove curves closer than the spacing inside the brush, and fill gaps wider than it. */
function density(curves: readonly GroomCurve[], ctx: GroomContext, centre: Vec2, s: BrushSettings, faces: (c: GroomCurve) => boolean): GroomCurve[] {
  const spacing = s.spacing ?? 0.012;
  const inBrush = (p: Vec3) => {
    const q = ctx.project(p);
    return Math.hypot(q.x - centre[0], q.y - centre[1]) < s.radius;
  };
  // Thin out: keep a curve only if no kept one is closer than the spacing.
  const kept: GroomCurve[] = [];
  for (const c of curves) {
    if (inBrush(c.points[0]!) && faces(c) && kept.some((k) => inBrush(k.points[0]!) && dist(k.points[0]!, c.points[0]!) < spacing)) continue;
    kept.push(c);
  }
  // Fill: try a few points in the brush, deterministic, adding where nothing is within the spacing.
  let out = kept;
  const tries = 12;
  for (let i = 0; i < tries; i++) {
    const a = i * 2.399963;
    const r = s.radius * Math.sqrt((i + 0.5) / tries);
    const hit = ctx.pick(centre[0] + r * Math.cos(a), centre[1] + r * Math.sin(a));
    if (!hit) continue;
    if (out.some((c) => dist(c.points[0]!, hit.point) < spacing)) continue;
    const shape = interpolatedShape(out, hit.point, hit.normal);
    const card = nearestCard(out, hit.point);
    out = [...out, { root: hit.root, points: shape.map((o) => add3(hit.point, o)), ...(card ? { card } : {}) }];
  }
  return out;
}

/** Offsets from the root for a new curve at `at`: the nearest curves' shapes, blended by distance. */
function interpolatedShape(curves: readonly GroomCurve[], at: Vec3, normal: Vec3): Vec3[] {
  const near = curves
    .map((c) => ({ c, d: dist(c.points[0]!, at) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 3);
  if (near.length === 0) {
    // Nothing to copy: a short hair straight out of the scalp.
    return Array.from({ length: 8 }, (_, i) => mul(normal, (0.02 * i) / 7));
  }
  const n = near[0]!.c.points.length;
  let total = 0;
  const ws = near.map(({ d }) => {
    const w = 1 / (d * d + 1e-6);
    total += w;
    return w;
  });
  return Array.from({ length: n }, (_, i) => {
    const o: Vec3 = [0, 0, 0];
    near.forEach(({ c }, j) => {
      const pts = c.points;
      const k = Math.min(pts.length - 1, Math.round((i * (pts.length - 1)) / Math.max(1, n - 1)));
      const off = sub(pts[k]!, pts[0]!);
      for (let a = 0; a < 3; a++) o[a]! += (ws[j]! / total) * off[a]!;
    });
    return o;
  });
}

/** Follow the leader: from the root, put each point back at its segment's length from the previous one. */
export function keepLengths(pts: Vec3[], lengths: readonly number[]): Vec3[] {
  const out = pts.map((p) => [...p] as Vec3);
  for (let i = 1; i < out.length; i++) {
    const d = sub(out[i]!, out[i - 1]!);
    const l = Math.hypot(d[0], d[1], d[2]);
    out[i] = l > 1e-12 ? add(out[i - 1]!, mul(d, lengths[i - 1]! / l)) : out[i]!;
  }
  return out;
}

export function segmentLengths(pts: readonly Vec3[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < pts.length; i++) out.push(dist(pts[i]!, pts[i - 1]!));
  return out;
}

/** Total turning of a curve, radians (Smooth lowers it). */
export function curvature(pts: readonly Vec3[]): number {
  let sum = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = normalise(sub(pts[i]!, pts[i - 1]!));
    const b = normalise(sub(pts[i + 1]!, pts[i]!));
    sum += Math.acos(Math.min(1, Math.max(-1, dot(a, b))));
  }
  return sum;
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const add3 = add;
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const dist = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
function normalise(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 1, 0];
}
