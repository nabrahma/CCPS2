/**
 * Benchmark board analysis (PRD Part 2 section 4): run by scripts/bench.mjs
 * after the app and Unity renders exist in a run folder.
 *
 * - Parity (F22): SSIM of each Unity render against the app's parity render
 *   of the same view (luma, 8x8 windows), with a diff image; passes at 0.9.
 * - Contact sheets: one board per character, every profile x look x camera,
 *   with the user's private reference images (refs/<character>/*.png, git-ignored) beside them.
 * - Regression: each app render against the last accepted board
 *   (docs/bench/accepted), on a 16x16 grid; regions that moved beyond the
 *   threshold are listed, so later work cannot quietly break earlier wins.
 * - A score template for the user (docs/bench/scores.json collects them).
 *
 *   tsx src/bench.ts <run folder>
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Canvas, decodePng } from './png';

export interface Image {
  width: number;
  height: number;
  rgba: Uint8Array | Uint8ClampedArray;
}

export const PARITY_SSIM = 0.9;
export const REGRESSION_THRESHOLD = 0.08;
export const SCORE_CRITERIA = ['silhouette', 'hair', 'face', 'eyes', 'skin', 'clothing', 'lighting and mood', 'overall'] as const;

function luma(img: Image): Float32Array {
  const out = new Float32Array(img.width * img.height);
  for (let i = 0; i < out.length; i++) out[i] = 0.299 * img.rgba[i * 4]! + 0.587 * img.rgba[i * 4 + 1]! + 0.114 * img.rgba[i * 4 + 2]!;
  return out;
}

/** Mean SSIM over 8x8 windows (stride 4) of the luma; also the per-window map. */
export function ssim(a: Image, b: Image, win = 8, stride = 4): { mean: number; map: Float32Array; cols: number; rows: number } {
  if (a.width !== b.width || a.height !== b.height) throw new Error(`size mismatch ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  const A = luma(a);
  const B = luma(b);
  const w = a.width;
  const C1 = (0.01 * 255) ** 2;
  const C2 = (0.03 * 255) ** 2;
  const cols = Math.floor((a.width - win) / stride) + 1;
  const rows = Math.floor((a.height - win) / stride) + 1;
  const map = new Float32Array(cols * rows);
  let sum = 0;
  const n = win * win;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let ma = 0, mb = 0;
      for (let y = 0; y < win; y++) for (let x = 0; x < win; x++) {
        const i = (r * stride + y) * w + c * stride + x;
        ma += A[i]!;
        mb += B[i]!;
      }
      ma /= n;
      mb /= n;
      let va = 0, vb = 0, cov = 0;
      for (let y = 0; y < win; y++) for (let x = 0; x < win; x++) {
        const i = (r * stride + y) * w + c * stride + x;
        const da = A[i]! - ma;
        const db = B[i]! - mb;
        va += da * da;
        vb += db * db;
        cov += da * db;
      }
      va /= n - 1;
      vb /= n - 1;
      cov /= n - 1;
      const s = ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
      map[r * cols + c] = s;
      sum += s;
    }
  }
  return { mean: sum / map.length, map, cols, rows };
}

/** |a - b| per pixel, scaled x4, as an image. */
export function diffImage(a: Image, b: Image): Canvas {
  const c = new Canvas(a.width, a.height);
  for (let i = 0; i < a.width * a.height; i++) {
    for (let k = 0; k < 3; k++) c.data[i * 4 + k] = Math.min(255, Math.abs(a.rgba[i * 4 + k]! - b.rgba[i * 4 + k]!) * 4);
    c.data[i * 4 + 3] = 255;
  }
  return c;
}

/** Mean absolute difference (0..1) per cell of a grid; cells above the threshold changed. */
export function regionChanges(a: Image, b: Image, grid = 16, threshold = REGRESSION_THRESHOLD): { cells: number; changed: { x: number; y: number; diff: number }[] } {
  const changed: { x: number; y: number; diff: number }[] = [];
  const cw = a.width / grid;
  const ch = a.height / grid;
  for (let gy = 0; gy < grid; gy++) {
    for (let gx = 0; gx < grid; gx++) {
      let s = 0;
      let n = 0;
      for (let y = Math.floor(gy * ch); y < Math.floor((gy + 1) * ch); y++) {
        for (let x = Math.floor(gx * cw); x < Math.floor((gx + 1) * cw); x++) {
          const i = (y * a.width + x) * 4;
          s += (Math.abs(a.rgba[i]! - b.rgba[i]!) + Math.abs(a.rgba[i + 1]! - b.rgba[i + 1]!) + Math.abs(a.rgba[i + 2]! - b.rgba[i + 2]!)) / (3 * 255);
          n++;
        }
      }
      const d = s / Math.max(1, n);
      if (d > threshold) changed.push({ x: gx, y: gy, diff: +d.toFixed(4) });
    }
  }
  return { cells: grid * grid, changed };
}

/** Box-filtered resize into a canvas at (dx, dy). */
function drawScaled(dst: Canvas, src: Image, dx: number, dy: number, w: number, h: number): void {
  const sx = src.width / w;
  const sy = src.height / h;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      const y0 = Math.floor(y * sy);
      const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
      const acc = [0, 0, 0];
      let n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
        const i = (yy * src.width + xx) * 4;
        acc[0]! += src.rgba[i]!;
        acc[1]! += src.rgba[i + 1]!;
        acc[2]! += src.rgba[i + 2]!;
        n++;
      }
      const o = ((dy + y) * dst.width + dx + x) * 4;
      if (dx + x < 0 || dx + x >= dst.width || dy + y < 0 || dy + y >= dst.height) continue;
      dst.data[o] = acc[0]! / n;
      dst.data[o + 1] = acc[1]! / n;
      dst.data[o + 2] = acc[2]! / n;
      dst.data[o + 3] = 255;
    }
  }
}

// A 5x7 bitmap font for labels (upper case, digits, a few signs).
const FONT: Record<string, string> = {
  A: '0111010001100011111110001100011000110001', B: '1111010001100011111010001100011000111110', C: '0111010001100001000010000100001000101110',
  D: '1111010001100011000110001100011000111110', E: '1111110000100001111010000100001000011111', F: '1111110000100001111010000100001000010000',
  G: '0111010001100001011110001100011000101111', H: '1000110001100011111110001100011000110001', I: '0111000100001000010000100001000010001110',
  J: '0011100010000100001000010100101001001100', K: '1000110010101001100010100100101000110001', L: '1000010000100001000010000100001000011111',
  M: '1000111011101011010110001100011000110001', N: '1000111001101011001110001100011000110001', O: '0111010001100011000110001100011000101110',
  P: '1111010001100011111010000100001000010000', Q: '0111010001100011000110101100101001001101', R: '1111010001100011111010100100101000110001',
  S: '0111110000100000111000001000010000111110', T: '1111100100001000010000100001000010000100', U: '1000110001100011000110001100011000101110',
  V: '1000110001100011000110001010100101000100', W: '1000110001100011010110101101011010101010', X: '1000110001010100010001010100011000110001',
  Y: '1000110001010100010000100001000010000100', Z: '1111100001000100010001000100001000011111',
  '0': '0111010001100111010111001100011000101110', '1': '0010001100001000010000100001000010001110', '2': '0111010001000010001000100010001000011111',
  '3': '1111100010001000001000001000011000101110', '4': '0001000110010101001011111000100001000010', '5': '1111110000111100000100001000011000101110',
  '6': '0011001000100001111010001100011000101110', '7': '1111100001000100010001000010000100001000', '8': '0111010001100010111010001100011000101110',
  '9': '0111010001100010111100001000010001001100', '.': '0000000000000000000000000000000110001100', ':': '0000001100011000000000110001100000000000',
  '-': '0000000000000001111100000000000000000000', '/': '0000100001000100010001000100001000000000', ' ': '0000000000000000000000000000000000000000',
};

/** Draw upper-case text, `scale` pixels per font pixel. */
export function drawText(c: Canvas, text: string, x: number, y: number, colour: [number, number, number] = [235, 235, 235], scale = 2): void {
  let cx = x;
  for (const ch of text.toUpperCase()) {
    const g = FONT[ch] ?? FONT[' ']!;
    for (let r = 0; r < 8; r++) for (let k = 0; k < 5; k++) {
      if (g[r * 5 + k] !== '1') continue;
      for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) c.plot(cx + k * scale + sx, y + r * scale + sy, colour);
    }
    cx += 6 * scale;
  }
}

function load(file: string): Image {
  const d = decodePng(readFileSync(file));
  return { width: d.width, height: d.height, rgba: d.rgba };
}

interface ViewInfo {
  name: string;
  character: string;
  profile: string;
  look: string;
  camera: string;
}

interface Views {
  size: number;
  profiles: string[];
  looks: string[];
  cameras: string[];
  characters: string[];
  views: ViewInfo[];
}

/** The board for one character: rows profile x look, columns the cameras, references on the right. */
function board(run: string, views: Views, character: string, refsDir: string | null): Canvas {
  const cell = 256;
  const pad = 8;
  const label = 26;
  const rows = views.profiles.length * views.looks.length;
  const refs = refsDir && existsSync(refsDir) ? readdirSync(refsDir).filter((f) => f.toLowerCase().endsWith('.png')).slice(0, rows) : [];
  const cols = views.cameras.length + (refs.length ? 1 : 0);
  const c = new Canvas(pad + cols * (cell + pad) + 150, label * 2 + pad + rows * (cell + pad));
  c.data.fill(18);
  for (let i = 3; i < c.data.length; i += 4) c.data[i] = 255;
  drawText(c, `${character} benchmark board`, pad, 8, [255, 255, 255], 3);
  views.cameras.forEach((cam, k) => drawText(c, cam, 150 + pad + k * (cell + pad), label + 4, [200, 200, 200]));
  if (refs.length) drawText(c, 'references', 150 + pad + views.cameras.length * (cell + pad), label + 4, [200, 200, 200]);
  let row = 0;
  for (const profile of views.profiles) {
    for (const look of views.looks) {
      const y = label * 2 + pad + row * (cell + pad);
      drawText(c, profile, pad, y + 8, [255, 200, 120]);
      drawText(c, look.replace(/([A-Z])/g, ' $1'), pad, y + 30, [180, 180, 180]);
      views.cameras.forEach((cam, k) => {
        const file = join(run, 'app', `${character}_${profile}_${look}_${cam}.png`);
        if (existsSync(file)) drawScaled(c, load(file), 150 + pad + k * (cell + pad), y, cell, cell);
      });
      const ref = refs[row];
      if (ref) drawScaled(c, load(join(refsDir!, ref)), 150 + pad + views.cameras.length * (cell + pad), y, cell, cell);
      row++;
    }
  }
  return c;
}

export function analyse(run: string, repo: string): Record<string, unknown> {
  const views = JSON.parse(readFileSync(join(run, 'views.json'), 'utf8')) as Views;
  // Parity.
  const parity: Record<string, { ssim: number; pass: boolean } | { missing: true }> = {};
  const unityDir = join(run, 'unity');
  const hasUnity = existsSync(unityDir) && readdirSync(unityDir).some((f) => f.endsWith('.png'));
  if (hasUnity) {
    mkdirSync(join(run, 'diff'), { recursive: true });
    for (const v of views.views) {
      const u = join(unityDir, `${v.name}.png`);
      const a = join(run, 'parity', `${v.name}.png`);
      if (!existsSync(u) || !existsSync(a)) {
        parity[v.name] = { missing: true };
        continue;
      }
      const ai = load(a);
      const ui = load(u);
      const s = ssim(ai, ui);
      parity[v.name] = { ssim: +s.mean.toFixed(4), pass: s.mean >= PARITY_SSIM };
      writeFileSync(join(run, 'diff', `${v.name}.png`), diffImage(ai, ui).toPng());
    }
  }
  // Boards.
  for (const ch of views.characters) writeFileSync(join(run, `board_${ch}.png`), board(run, views, ch, join(repo, 'refs', ch)).toPng());
  // Regression against the accepted board.
  const accepted = join(repo, 'docs', 'bench', 'accepted', 'app');
  const regression: Record<string, { changedCells: number; cells: number; worst: number }> = {};
  if (existsSync(accepted)) {
    for (const v of views.views) {
      const a = join(accepted, `${v.name}.png`);
      const b = join(run, 'app', `${v.name}.png`);
      if (!existsSync(a) || !existsSync(b)) continue;
      const ai = load(a);
      const bi = load(b);
      if (ai.width !== bi.width) continue;
      const r = regionChanges(ai, bi);
      if (r.changed.length) regression[v.name] = { changedCells: r.changed.length, cells: r.cells, worst: Math.max(...r.changed.map((c) => c.diff)) };
    }
  }
  const parityValues = Object.values(parity).filter((p): p is { ssim: number; pass: boolean } => 'ssim' in p);
  const report = {
    generated: 'tools/asset-tools/src/bench.ts',
    run: basename(run),
    parity: hasUnity
      ? { threshold: PARITY_SSIM, views: parityValues.length, failing: Object.entries(parity).filter(([, p]) => !('ssim' in p) || !p.pass).map(([k]) => k), min: Math.min(...parityValues.map((p) => p.ssim)), byView: parity }
      : 'no Unity renders in this run',
    regression: existsSync(accepted) ? { threshold: REGRESSION_THRESHOLD, changedViews: Object.keys(regression).length, byView: regression } : 'no accepted board yet (docs/bench/accepted)',
  };
  writeFileSync(join(run, 'bench_report.json'), JSON.stringify(report, null, 1) + '\n');
  const template = {
    board: basename(run),
    date: new Date().toISOString().slice(0, 10),
    milestone: 'M11',
    scores: Object.fromEntries(views.characters.map((ch) => [ch, Object.fromEntries(SCORE_CRITERIA.map((k) => [k, null]))])),
    notes: '',
  };
  writeFileSync(join(run, 'score_template.json'), JSON.stringify(template, null, 1) + '\n');
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const run = resolve(process.argv[2] ?? '');
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const r = analyse(run, repo) as { parity: unknown; regression: unknown };
  console.info(JSON.stringify({ parity: typeof r.parity === 'string' ? r.parity : (r.parity as { min: number; failing: string[] }).failing.length + ' failing, min SSIM ' + (r.parity as { min: number }).min, regression: r.regression }, null, 1).slice(0, 2000));
}
