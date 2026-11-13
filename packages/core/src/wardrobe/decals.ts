/**
 * Stamp-on decals (Part 2 F18): zips, buttons, rivets, buckles, straps,
 * pocket flaps and patch pockets, drawn procedurally at any resolution.
 *
 * Each decal is a function of a point in its own frame, in millimetres: x
 * across (to the right), y along (up, or from a zip's start to its end). It
 * returns a colour to lay over the cloth with an alpha, plus a shading factor
 * for the cloth under it (shadows, stitched outlines). Light comes from above,
 * as in the era diffuse.
 */
import type { Decal } from './look';

export interface DecalSample {
  /** Colour over the cloth, 0..1 sRGB, with its coverage. */
  r: number;
  g: number;
  b: number;
  a: number;
  /** Multiplies the cloth (and the colour above): < 1 is shadow or a sewn line. */
  shade: number;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** Coverage of an edge at signed distance d (mm, positive inside) for a texel of `px` mm. */
const cover = (d: number, px: number) => clamp01(d / px + 0.5);

function metal(c: [number, number, number], light: number, s: DecalSample, a: number): void {
  const k = 0.55 + 0.75 * light;
  const spec = Math.max(0, light - 0.7) * 1.6;
  s.r = clamp01(c[0] * k + spec);
  s.g = clamp01(c[1] * k + spec);
  s.b = clamp01(c[2] * k + spec);
  s.a = a;
}

/** Stitched outline of a w x h rectangle centred at 0, inset by `inset` mm: 1 or a darker sewn line. */
function stitchedRect(x: number, y: number, w: number, h: number, inset: number, px: number, spacing: number): number {
  const dx = w / 2 - inset - Math.abs(x);
  const dy = h / 2 - inset - Math.abs(y);
  // Distance to the stitch line (a rectangle path).
  const onX = Math.abs(dx) < Math.abs(dy) && dy > -0.5;
  const d = onX ? Math.abs(dx) : Math.abs(dy);
  if (dx < -0.6 || dy < -0.6) return 1;
  const along = onX ? y : x;
  const dash = ((along / spacing) % 1 + 1) % 1 < 0.62 ? 1 : 0;
  return 1 - 0.45 * dash * cover(0.45 - d, px);
}

/**
 * Sample decal `d` at (x, y) mm in its frame. `px` is one output texel in mm
 * (for anti-aliasing); `length` is a zip's or strap's length in mm.
 */
export function sampleDecal(d: Decal, x: number, y: number, px: number, length: number, out: DecalSample): void {
  out.r = out.g = out.b = out.a = 0;
  out.shade = 1;
  const c = d.colour;
  const W = d.sizeMm;
  switch (d.kind) {
    case 'button': {
      const r = W / 2;
      const rr = Math.hypot(x, y);
      // Drop shadow below.
      const sh = Math.hypot(x, y + r * 0.18);
      out.shade = 1 - 0.45 * clamp01(1 - (sh - r * 0.85) / (r * 0.35));
      const a = cover(r - rr, px);
      if (a <= 0) return;
      const rim = Math.abs(rr - r * 0.8) < r * 0.09 ? 0.18 : 0;
      const dome = 0.45 + 0.4 * clamp01((y / r) * 0.5 + 0.5) + rim;
      let hole = 0;
      for (const [hx, hy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) hole = Math.max(hole, cover(r * 0.11 - Math.hypot(x - hx * r * 0.24, y - hy * r * 0.24), px));
      const k = dome * (1 - 0.75 * hole);
      out.r = clamp01(c[0] * (0.6 + 0.8 * k));
      out.g = clamp01(c[1] * (0.6 + 0.8 * k));
      out.b = clamp01(c[2] * (0.6 + 0.8 * k));
      out.a = a;
      return;
    }
    case 'rivet': {
      const r = W / 2;
      const rr = Math.hypot(x, y);
      out.shade = 1 - 0.4 * clamp01(1 - (Math.hypot(x, y + r * 0.25) - r * 0.8) / (r * 0.5));
      const a = cover(r - rr, px);
      if (a <= 0) return;
      const light = clamp01(1 - Math.hypot(x + r * 0.3, y - r * 0.35) / (r * 1.2));
      metal(c, light, out, a);
      return;
    }
    case 'buckle': {
      const w = W;
      const h = (d.heightMm ?? W * 1.25);
      const t = W * 0.16;
      const ox = w / 2 - Math.abs(x);
      const oy = h / 2 - Math.abs(y);
      const outer = Math.min(ox, oy);
      const inner = Math.min(ox - t, oy - t);
      out.shade = 1 - 0.35 * clamp01(1 - (-Math.min(w / 2 - Math.abs(x), h / 2 - Math.abs(y + t * 0.6))) / (t * 1.2));
      // The frame, and the prong across the middle.
      const frame = cover(outer, px) * (1 - cover(inner, px));
      const prong = cover(t * 0.35 - Math.abs(x), px) * cover(h / 2 - t * 0.5 - Math.abs(y), px);
      const a = Math.max(frame, prong);
      if (a <= 0) return;
      const light = frame >= prong ? clamp01(0.5 + 0.5 * Math.sign(y) * (Math.abs(y) > h / 2 - t ? 1 : 0) + (ox < t ? 0.2 : 0)) : 0.7;
      metal(c, light, out, a);
      return;
    }
    case 'zip': {
      // Tape, then interlocking teeth, then a pull tab at the start (y = 0).
      const half = W / 2;
      const inBand = cover(half - Math.abs(x), px) * cover(y + 0.5, px) * cover(length - y + 0.5, px);
      out.shade = 1 - 0.3 * clamp01(1 - (Math.abs(x) - half) / 2.5) * (Math.abs(x) > half ? 1 : 0) * (y > 0 && y < length ? 1 : 0);
      const tab = cover(W * 0.42 - Math.abs(x), px) * cover(W * 1.9 - Math.abs(y - W * 1.2), px);
      if (tab > 0) {
        const hole = cover(W * 0.16 - Math.hypot(x, y - W * 0.55), px);
        metal(c, clamp01(0.75 - (y - W * 1.2) / (W * 4)), out, tab * (1 - hole));
        if (hole > 0.5) out.shade *= 0.6;
        return;
      }
      if (inBand <= 0) return;
      const pitch = 2.2;
      const row = Math.floor(y / pitch);
      const leftTooth = row % 2 === 0;
      const teeth = Math.abs(x) < half * 0.42 && (x < 0) === leftTooth ? 1 : Math.abs(x) < half * 0.42 ? 0.35 : 0;
      if (teeth > 0.5) {
        const fy = ((y / pitch) % 1 + 1) % 1;
        metal(c, 0.35 + 0.6 * (1 - Math.abs(fy - 0.4) * 2), out, inBand);
      } else {
        // Tape: dark woven band.
        out.r = 0.12;
        out.g = 0.11;
        out.b = 0.1;
        out.a = inBand * 0.9;
      }
      return;
    }
    case 'strap': {
      const half = W / 2;
      const a = cover(half - Math.abs(x), px) * cover(y + 0.5, px) * cover(length - y + 0.5, px);
      out.shade = 1 - 0.4 * clamp01(1 - (Math.abs(x) - half) / 3) * (Math.abs(x) > half ? 1 : 0);
      if (a <= 0) return;
      const edge = Math.abs(Math.abs(x) - (half - 3)) < 0.45 && ((y / 4) % 1 + 1) % 1 < 0.6 ? 0.55 : 1;
      const bevel = 0.8 + 0.25 * clamp01((half - Math.abs(x)) / 2.5) - (x > 0 ? 0.06 : 0);
      out.r = clamp01(c[0] * bevel * edge);
      out.g = clamp01(c[1] * bevel * edge);
      out.b = clamp01(c[2] * bevel * edge);
      out.a = a;
      return;
    }
    case 'pocketFlap':
    case 'pocket': {
      // The pocket is the cloth itself: its outline, stitching and shadows.
      const w = W;
      const h = d.heightMm ?? W;
      const inside = Math.min(w / 2 - Math.abs(x), h / 2 - Math.abs(y));
      let shade = 1;
      if (d.kind === 'pocketFlap') {
        // The flap casts a shadow below its bottom edge, and its edge catches light.
        const below = -(h / 2) - y;
        if (Math.abs(x) < w / 2 && below > 0) shade *= 1 - 0.5 * clamp01(1 - below / 7);
        if (inside > 0 && inside < 1.5 && y > 0) shade *= 1.08;
        if (inside > 0) shade *= 1 - 0.12 * clamp01(1 - (h / 2 + y) / h);
      } else if (inside > 0) {
        // A patch sits proud: lit on top, shadow round the bottom and sides.
        shade *= 1 + 0.06 * clamp01(y / (h / 2));
      } else {
        const out_ = Math.max(Math.abs(x) - w / 2, Math.abs(y) - h / 2, 0);
        if (y < h / 2) shade *= 1 - 0.35 * clamp01(1 - out_ / 4);
      }
      // Sewn edge line.
      if (Math.abs(inside) < 0.6) shade *= 1 - 0.35 * cover(0.6 - Math.abs(inside), px);
      if (inside > 0) shade *= stitchedRect(x, y, w, h, 3.5, px, 4);
      out.shade = shade;
      // A button on the flap.
      if (d.kind === 'pocketFlap') {
        const r = Math.min(w, h) * 0.13;
        const rr = Math.hypot(x, y + h * 0.2);
        const a = cover(r - rr, px);
        if (a > 0) {
          const k = 0.5 + 0.4 * clamp01((y + h * 0.2) / r * 0.5 + 0.5);
          out.r = clamp01(c[0] * (0.6 + 0.8 * k));
          out.g = clamp01(c[1] * (0.6 + 0.8 * k));
          out.b = clamp01(c[2] * (0.6 + 0.8 * k));
          out.a = a;
        }
      }
      return;
    }
  }
}

/** Half-extent of a decal's footprint in mm (a circle enclosing it plus its shadow), and its length for line decals. */
export function decalReachMm(d: Decal, lengthMm: number): number {
  const h = d.heightMm ?? d.sizeMm;
  switch (d.kind) {
    case 'zip':
    case 'strap':
      return Math.hypot(lengthMm, d.sizeMm * 2) + d.sizeMm * 2;
    case 'button':
    case 'rivet':
      return d.sizeMm;
    default:
      return Math.hypot(d.sizeMm, h) / 2 + 10;
  }
}
