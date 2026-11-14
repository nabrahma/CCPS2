/**
 * Hair strokes drawn into a skin layer (painted brows and lashes, D-146 and
 * D-148): each stroke is a tapered, slightly bent line from a root to a tip,
 * in metres on a flat frame (seen from the front). The field answers "how much
 * of this texel do the strokes cover", filtered over the texel so a hair
 * finer than a texel draws as a faint line, not a jagged one.
 */

export interface Stroke {
  /** Root, bend and tip (metres). */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Width at the root and at the tip (metres). */
  w0: number;
  w1: number;
  /** Opacity at the root; it fades by `fade` towards the tip. */
  a: number;
  fade: number;
}

const OFFSET = 32768;
const cellKey = (cx: number, cy: number) => (cx + OFFSET) * 65536 + (cy + OFFSET);

export class StrokeField {
  private readonly cells = new Map<number, number[]>();

  /**
   * @param strokes the strokes
   * @param texel the texel size the field is drawn at (metres)
   * @param cell lookup cell size (metres), about a stroke's length
   */
  constructor(
    readonly strokes: readonly Stroke[],
    private readonly texel: number,
    private readonly cell = 0.003,
  ) {
    strokes.forEach((s, i) => {
      const pad = Math.max(s.w0, s.w1) + texel;
      const x0 = Math.floor((Math.min(s.x0, s.x1, s.x2) - pad) / cell);
      const x1 = Math.floor((Math.max(s.x0, s.x1, s.x2) + pad) / cell);
      const y0 = Math.floor((Math.min(s.y0, s.y1, s.y2) - pad) / cell);
      const y1 = Math.floor((Math.max(s.y0, s.y1, s.y2) + pad) / cell);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cy = y0; cy <= y1; cy++) {
          const k = cellKey(cx, cy);
          let list = this.cells.get(k);
          if (!list) this.cells.set(k, (list = []));
          list.push(i);
        }
      }
    });
  }

  /** Coverage (0..1) at a point: the strokes over one another, each filtered over a texel. */
  coverage(x: number, y: number): number {
    const list = this.cells.get(cellKey(Math.floor(x / this.cell), Math.floor(y / this.cell)));
    if (!list) return 0;
    const texel = this.texel;
    let keep = 1;
    for (const i of list) {
      const s = this.strokes[i]!;
      const a = segment(x, y, s.x0, s.y0, s.x1, s.y1);
      const b = segment(x, y, s.x1, s.y1, s.x2, s.y2);
      const d = Math.min(a.d, b.d);
      const t = a.d <= b.d ? 0.5 * a.t : 0.5 + 0.5 * b.t;
      const half = 0.5 * (s.w0 + (s.w1 - s.w0) * t);
      const reach = Math.max(half, 0.5 * texel);
      const cover = (reach + 0.5 * texel - d) / texel;
      if (cover <= 0) continue;
      // A hair finer than a texel covers that fraction of it.
      const c = Math.min(1, cover) * Math.min(1, half / (0.5 * texel));
      keep *= 1 - s.a * (1 - s.fade * t * t) * c;
    }
    return 1 - keep;
  }
}

function segment(px: number, py: number, ax: number, ay: number, bx: number, by: number): { d: number; t: number } {
  const vx = bx - ax;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy;
  let t = len2 > 0 ? ((px - ax) * vx + (py - ay) * vy) / len2 : 0;
  t = Math.min(1, Math.max(0, t));
  const dx = ax + vx * t - px;
  const dy = ay + vy * t - py;
  return { d: Math.hypot(dx, dy), t };
}
