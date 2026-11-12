/**
 * The painted hairline (PRD F5 step 2: "a user-paintable hairline mask").
 *
 * The mask is a bitmap over the head's polar angles, one bit per 3 x 3 degrees
 * (about 5 mm on a head): columns are azimuth from -180 to 180 degrees (0 is
 * the front), rows are the polar angle from the crown down to 180 degrees.
 * Reading it bilinearly and cutting at one half turns the staircase into a
 * smooth hairline. It is stored as hex, so it travels inside a `.ps2hair`.
 */

export const PAINT_COLS = 120;
export const PAINT_ROWS = 60;
const CELL_DEG = 3;
const HEX_LENGTH = Math.ceil((PAINT_COLS * PAINT_ROWS) / 8) * 2;

export function isPaintString(s: unknown): s is string {
  return typeof s === 'string' && s.length === HEX_LENGTH && /^[0-9a-f]+$/.test(s);
}

/** One byte per cell (0 or 1), row by row. */
export function decodePaint(hex: string): Uint8Array {
  const out = new Uint8Array(PAINT_COLS * PAINT_ROWS);
  for (let i = 0; i < out.length; i++) {
    const nibble = parseInt(hex[i >> 2]!, 16);
    out[i] = (nibble >> (3 - (i & 3))) & 1;
  }
  return out;
}

export function encodePaint(cells: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < HEX_LENGTH; i++) {
    let nibble = 0;
    for (let b = 0; b < 4; b++) nibble = (nibble << 1) | (cells[i * 4 + b] ?? 0);
    hex += nibble.toString(16);
  }
  return hex;
}

let lastHex = '';
let lastCells: Uint8Array | null = null;

/** Decoding once per mask matters: a style samples thousands of candidate roots. */
function cached(hex: string): Uint8Array {
  if (hex !== lastHex || !lastCells) {
    lastCells = decodePaint(hex);
    lastHex = hex;
  }
  return lastCells;
}

/** Does the painted mask grow hair at these angles (radians)? */
export function paintAllows(hex: string, theta: number, phi: number): boolean {
  return paintCoverage(hex, theta, phi) >= 0.5;
}

/** The painted mask read bilinearly at these angles (radians): 0 bare .. 1 hair. */
export function paintCoverage(hex: string, theta: number, phi: number): number {
  const cells = cached(hex);
  const x = ((phi * 180) / Math.PI + 180) / CELL_DEG - 0.5;
  const y = (theta * 180) / Math.PI / CELL_DEG - 0.5;
  const x0 = Math.floor(x);
  const fx = x - x0;
  const y0 = Math.max(0, Math.min(PAINT_ROWS - 1, Math.floor(y)));
  const y1 = Math.min(PAINT_ROWS - 1, y0 + 1);
  const fy = Math.max(0, Math.min(1, y - y0));
  const at = (c: number, r: number) => cells[r * PAINT_COLS + ((c % PAINT_COLS) + PAINT_COLS) % PAINT_COLS]!;
  const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
  const bottom = at(x0, y1) * (1 - fx) + at(x0 + 1, y1) * fx;
  return top * (1 - fy) + bottom * fy;
}

/** Fill a mask from "hair grows at these angles (radians)". */
export function rasterPaint(allows: (theta: number, phi: number) => boolean): Uint8Array {
  const cells = new Uint8Array(PAINT_COLS * PAINT_ROWS);
  for (let r = 0; r < PAINT_ROWS; r++) {
    const theta = (((r + 0.5) * CELL_DEG) * Math.PI) / 180;
    for (let c = 0; c < PAINT_COLS; c++) {
      const phi = (((c + 0.5) * CELL_DEG - 180) * Math.PI) / 180;
      cells[r * PAINT_COLS + c] = allows(theta, phi) ? 1 : 0;
    }
  }
  return cells;
}

/**
 * Paint a round brush in place at (theta, phi, radians). The radius is an
 * angle on the head, so the brush keeps its size wherever it is used.
 */
export function paintStroke(cells: Uint8Array, theta: number, phi: number, radius: number, on: boolean, mirror = false): void {
  dab(cells, theta, phi, radius, on);
  if (mirror) dab(cells, theta, -phi, radius, on);
}

function dab(cells: Uint8Array, theta: number, phi: number, radius: number, on: boolean): void {
  const cosR = Math.cos(radius);
  const [st, ct] = [Math.sin(theta), Math.cos(theta)];
  for (let r = 0; r < PAINT_ROWS; r++) {
    const t = (((r + 0.5) * CELL_DEG) * Math.PI) / 180;
    for (let c = 0; c < PAINT_COLS; c++) {
      const p = (((c + 0.5) * CELL_DEG - 180) * Math.PI) / 180;
      if (ct * Math.cos(t) + st * Math.sin(t) * Math.cos(p - phi) >= cosR) cells[r * PAINT_COLS + c] = on ? 1 : 0;
    }
  }
}
