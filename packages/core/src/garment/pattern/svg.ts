/**
 * Sewing-pattern SVG export (F29 bonus, M22 acceptance): every panel drawn flat at true size (cm), its seam line
 * with real arcs and Bezier curves, a dashed cutting line with seam allowance (1 cm on seams, 2 cm on hems and
 * openings), stitch pairs numbered and coloured alike on both sides, the panel name and size, the body
 * measurements used and a 10 cm scale bar. The 2D pattern view in the Garment Designer draws the same SVG.
 */
import { Arc, CubicBezier, QuadraticBezier, type P2 } from './num/curves';
import type { PanelSpec, PatternSpec } from './panel';
import { relToAbs2d } from './utils';

export interface SvgOptions {
  /** Seam allowance on stitched edges, cm. */
  allowance?: number;
  /** Allowance on hems and openings (free edges), cm. */
  hemAllowance?: number;
  title?: string;
  /** Body measurements to print (GarmentCode keys, cm). */
  measurements?: Readonly<Record<string, number>>;
  /** Gap between panels, cm. */
  gap?: number;
  /** Width of a layout row before wrapping, cm. */
  rowWidth?: number;
}

/** Distinct stitch colours (dark enough on white). */
const PALETTE = ['#d1495b', '#00798c', '#edae49', '#30638e', '#6a4c93', '#1b998b', '#e36414', '#8a5a44', '#5c946e', '#c05299', '#3d5a80', '#9a031e'];

type Pt = [number, number];

/** Points along one panel edge (pattern coordinates, y up), the edge's start included and its end excluded. */
export function edgePoints(panel: PanelSpec, i: number, perCm = 1): Pt[] {
  const e = panel.edges[i]!;
  const a = panel.vertices[e.endpoints[0]!]!;
  const b = panel.vertices[e.endpoints[1]!]!;
  const s: P2 = [a[0]!, a[1]!];
  const t: P2 = [b[0]!, b[1]!];
  if (!e.curvature) return [s];
  let seg: Arc | QuadraticBezier | CubicBezier;
  if (e.curvature.type === 'circle') {
    const [rad, large, right] = e.curvature.params as [number, number, number];
    seg = new Arc(s, [rad, rad], 0, !!large, !!right, t);
  } else {
    const cps = (e.curvature.params as number[][]).map((c) => relToAbs2d(a, b, c) as P2);
    seg = e.curvature.type === 'quadratic' ? new QuadraticBezier(s, cps[0]!, t) : new CubicBezier(s, cps[0]!, cps[1]!, t);
  }
  const n = Math.max(4, Math.ceil(seg.length() * perCm));
  const out: Pt[] = [];
  for (let k = 0; k < n; k++) out.push(seg.point(k / n));
  return out;
}

/** The panel outline as a closed polygon (pattern coordinates). */
export function panelOutline(panel: PanelSpec, perCm = 1): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < panel.edges.length; i++) out.push(...edgePoints(panel, i, perCm));
  return out;
}

/** The point halfway along a polyline. */
function midOfPolyline(pts: readonly Pt[]): Pt {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.sqrt((pts[i]![0] - pts[i - 1]![0]) * (pts[i]![0] - pts[i - 1]![0]) + (pts[i]![1] - pts[i - 1]![1]) * (pts[i]![1] - pts[i - 1]![1]));
  let left = total / 2;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const l = Math.sqrt((b[0] - a[0]) * (b[0] - a[0]) + (b[1] - a[1]) * (b[1] - a[1]));
    if (l >= left && l > 0) return [a[0] + ((b[0] - a[0]) * left) / l, a[1] + ((b[1] - a[1]) * left) / l];
    left -= l;
  }
  return pts[pts.length - 1]!;
}

/** Layout group of a panel by its name: bodies first, then sleeves, collars and hoods, bands, pockets. */
function groupOf(name: string): number {
  if (/torso|skirt|pant|insert|front$|back$|^wb_/.test(name)) return 0;
  if (/sleeve/.test(name)) return 1;
  if (/collar|hood|lapel/.test(name)) return 2;
  if (/cuff|hem|band|placket|yoke/.test(name)) return 3;
  return 4;
}

function signedArea(poly: readonly Pt[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    s += p[0] * q[1] - q[0] * p[1];
  }
  return s / 2;
}

/** Offset outline: each edge pushed out by its own allowance, consecutive pieces joined straight. */
function allowanceOutline(panel: PanelSpec, allowanceOf: (edge: number) => number): Pt[] {
  const ccw = signedArea(panelOutline(panel)) > 0;
  const out: Pt[] = [];
  for (let i = 0; i < panel.edges.length; i++) {
    const pts = edgePoints(panel, i, 2);
    const e = panel.edges[i]!;
    const end = panel.vertices[e.endpoints[1]!]!;
    pts.push([end[0]!, end[1]!]);
    const d = allowanceOf(i);
    for (let k = 0; k < pts.length; k++) {
      const p = pts[Math.max(0, k - 1)]!;
      const q = pts[Math.min(pts.length - 1, k + 1)]!;
      let nx = q[1] - p[1];
      let ny = -(q[0] - p[0]);
      const l = Math.sqrt(nx * nx + ny * ny) || 1;
      nx /= l;
      ny /= l;
      if (!ccw) {
        nx = -nx;
        ny = -ny;
      }
      out.push([pts[k]![0] + nx * d, pts[k]![1] + ny * d]);
    }
  }
  return out;
}

function bbox(pts: readonly Pt[]): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return [x0, y0, x1, y1];
}

const f2 = (v: number): string => (Math.round(v * 100) / 100).toString();
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** SVG path data of a panel's seam line, y flipped (SVG y runs down), shifted by (dx, dy). */
function seamPath(panel: PanelSpec, dx: number, dy: number): string {
  const X = (x: number): string => f2(x + dx);
  const Y = (y: number): string => f2(-y + dy);
  const v0 = panel.vertices[panel.edges[0]!.endpoints[0]!]!;
  let d = `M${X(v0[0]!)} ${Y(v0[1]!)}`;
  for (const e of panel.edges) {
    const a = panel.vertices[e.endpoints[0]!]!;
    const b = panel.vertices[e.endpoints[1]!]!;
    if (!e.curvature) d += ` L${X(b[0]!)} ${Y(b[1]!)}`;
    else if (e.curvature.type === 'circle') {
      const [rad, large, right] = e.curvature.params as [number, number, number];
      // y is flipped, so the sweep direction flips too.
      d += ` A${f2(rad)} ${f2(rad)} 0 ${large ? 1 : 0} ${right ? 0 : 1} ${X(b[0]!)} ${Y(b[1]!)}`;
    } else {
      const cps = (e.curvature.params as number[][]).map((c) => relToAbs2d(a, b, c));
      d += e.curvature.type === 'quadratic' ? ` Q${X(cps[0]![0]!)} ${Y(cps[0]![1]!)} ${X(b[0]!)} ${Y(b[1]!)}` : ` C${X(cps[0]![0]!)} ${Y(cps[0]![1]!)} ${X(cps[1]![0]!)} ${Y(cps[1]![1]!)} ${X(b[0]!)} ${Y(b[1]!)}`;
    }
  }
  return `${d} Z`;
}

export interface PanelPlacement {
  name: string;
  /** Shift applied to pattern coordinates (x + dx, -y + dy) in the drawing. */
  dx: number;
  dy: number;
  /** Size of the seam outline, cm. */
  width: number;
  height: number;
}

/** Flat layout: front panels (placed at z >= 0) first, each group left to right, wrapped into rows. */
export function layoutPattern(spec: PatternSpec, opts: SvgOptions = {}): { placements: PanelPlacement[]; width: number; height: number } {
  const gap = opts.gap ?? 6;
  const rowWidth = opts.rowWidth ?? 260;
  const margin = (opts.hemAllowance ?? 2) + 1;
  const names = Object.keys(spec.panels).sort((a, b) => {
    const pa = spec.panels[a]!.translation;
    const pb = spec.panels[b]!.translation;
    const fa = pa[2]! >= 0 ? 0 : 1;
    const fb = pb[2]! >= 0 ? 0 : 1;
    return groupOf(a) - groupOf(b) || fa - fb || pa[0]! - pb[0]! || (a < b ? -1 : 1);
  });
  const placements: PanelPlacement[] = [];
  let x = gap;
  let y = gap + 6;
  let rowH = 0;
  let maxW = 0;
  for (const name of names) {
    const [x0, y0, x1, y1] = bbox(panelOutline(spec.panels[name]!));
    const w = x1 - x0;
    const h = y1 - y0;
    if (x > gap && x + w + 2 * margin > rowWidth) {
      x = gap;
      y += rowH + gap + 6;
      rowH = 0;
    }
    placements.push({ name, dx: x + margin - x0, dy: y + margin + y1, width: w, height: h });
    x += w + 2 * margin + gap;
    rowH = Math.max(rowH, h + 2 * margin + 6);
    maxW = Math.max(maxW, x);
  }
  return { placements, width: Math.max(maxW, 60), height: y + rowH + gap };
}

/** The whole pattern as an SVG document (units: cm). */
export function patternSvg(spec: PatternSpec, opts: SvgOptions = {}): string {
  const allowance = opts.allowance ?? 1;
  const hem = opts.hemAllowance ?? 2;
  const stitchOf = new Map<string, number>();
  spec.stitches.forEach((s, i) => {
    stitchOf.set(`${s[0].panel}#${s[0].edge}`, i);
    stitchOf.set(`${s[1].panel}#${s[1].edge}`, i);
  });
  const { placements, width, height: h0 } = layoutPattern(spec, opts);
  const measLines = opts.measurements ? Object.entries(opts.measurements).map(([k, v]) => `${k} ${v.toFixed(1)}`) : [];
  const footer = 14 + Math.ceil(measLines.length / 4) * 4;
  const height = h0 + footer;
  const parts: string[] = [];
  parts.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${f2(width)}cm" height="${f2(height)}cm" viewBox="0 0 ${f2(width)} ${f2(height)}" font-family="Segoe UI, Helvetica, Arial, sans-serif">`);
  parts.push(`<title>${esc(opts.title ?? 'Sewing pattern')}</title>`);
  parts.push(`<rect x="0" y="0" width="${f2(width)}" height="${f2(height)}" fill="#ffffff"/>`);
  if (opts.title) parts.push(`<text x="6" y="5" font-size="3" font-weight="600" fill="#222">${esc(opts.title)}</text>`);
  for (const pl of placements) {
    const panel = spec.panels[pl.name]!;
    const cut = allowanceOutline(panel, (i) => (stitchOf.has(`${pl.name}#${i}`) ? allowance : hem));
    const cutD = cut.map((p, k) => `${k ? 'L' : 'M'}${f2(p[0] + pl.dx)} ${f2(-p[1] + pl.dy)}`).join(' ') + ' Z';
    parts.push(`<g class="panel" data-panel="${esc(pl.name)}">`);
    parts.push(`<path d="${cutD}" fill="none" stroke="#666" stroke-width="0.12" stroke-dasharray="0.8 0.5"/>`);
    parts.push(`<path d="${seamPath(panel, pl.dx, pl.dy)}" fill="#f3e3e7" stroke="#333" stroke-width="0.2"/>`);
    panel.edges.forEach((e, i) => {
      const st = stitchOf.get(`${pl.name}#${i}`);
      if (st === undefined) return;
      const pts = edgePoints(panel, i, 2);
      const end = panel.vertices[e.endpoints[1]!]!;
      pts.push([end[0]!, end[1]!]);
      const color = PALETTE[st % PALETTE.length]!;
      parts.push(`<polyline points="${pts.map((p) => `${f2(p[0] + pl.dx)},${f2(-p[1] + pl.dy)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="0.45" stroke-linecap="round"/>`);
      const mid = midOfPolyline(pts);
      parts.push(`<text x="${f2(mid[0] + pl.dx)}" y="${f2(-mid[1] + pl.dy)}" font-size="1.8" fill="${color}" text-anchor="middle" dominant-baseline="middle" stroke="#fff" stroke-width="0.35" paint-order="stroke">${st + 1}</text>`);
    });
    const o = panelOutline(panel);
    const [x0, y0, x1, y1] = bbox(o);
    const cx = (x0 + x1) / 2 + pl.dx;
    const cy = -(y0 + y1) / 2 + pl.dy;
    parts.push(`<text x="${f2(cx)}" y="${f2(cy)}" font-size="2.4" font-weight="600" fill="#111" text-anchor="middle">${esc(pl.name)}</text>`);
    parts.push(`<text x="${f2(cx)}" y="${f2(cy + 3)}" font-size="1.8" fill="#444" text-anchor="middle">${f2(pl.width)} × ${f2(pl.height)} cm</text>`);
    parts.push(`</g>`);
  }
  // Scale bar and legend.
  const by = height - footer + 4;
  parts.push(`<g class="legend"><line x1="6" y1="${f2(by)}" x2="16" y2="${f2(by)}" stroke="#111" stroke-width="0.4"/><text x="17" y="${f2(by + 0.7)}" font-size="2" fill="#111">10 cm</text>`);
  parts.push(`<text x="30" y="${f2(by + 0.7)}" font-size="1.8" fill="#444">Solid: seam line. Dashed: cutting line (${allowance} cm seam allowance, ${hem} cm on hems and openings). Matching colours and numbers are sewn together.</text>`);
  measLines.forEach((line, i) => {
    parts.push(`<text x="${f2(6 + (i % 4) * 45)}" y="${f2(by + 5 + Math.floor(i / 4) * 3)}" font-size="1.7" fill="#555">${esc(line)}</text>`);
  });
  parts.push(`</g></svg>`);
  return parts.join('\n');
}
