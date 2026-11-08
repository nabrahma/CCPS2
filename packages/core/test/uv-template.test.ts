/**
 * PRD M4 acceptance: the exported UV template matches the garment UVs
 * (pixel test). Every UV edge is drawn, and nothing else is.
 */
import { describe, expect, it } from 'vitest';
import { pixelOf, renderUvTemplate, UV_TEMPLATE_LINE, uvEdges, uvToImage } from '../src/proxy/uv-template';
import { assetsAvailable, loadAssets } from './helpers';

const SIZE = 1024;
const isLine = (img: Uint8ClampedArray, x: number, y: number) =>
  x >= 0 && y >= 0 && x < SIZE && y < SIZE && UV_TEMPLATE_LINE.every((c, k) => img[(y * SIZE + x) * 4 + k] === c);

/** Independent reference: every pixel an edge passes through (dense sampling), as y * SIZE + x. */
function referencePixels(uvs: ArrayLike<number>, faceUvs: ArrayLike<number>): Set<number> {
  const ref = new Set<number>();
  for (const [a, b] of uvEdges(faceUvs)) {
    const [x0, y0] = uvToImage(uvs[a * 2]!, uvs[a * 2 + 1]!, SIZE);
    const [x1, y1] = uvToImage(uvs[b * 2]!, uvs[b * 2 + 1]!, SIZE);
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 8) + 1;
    for (let i = 0; i <= n; i++) {
      const fx = x0 + ((x1 - x0) * i) / n;
      const fy = y0 + ((y1 - y0) * i) / n;
      if (fx >= 0 && fy >= 0 && fx <= SIZE && fy <= SIZE) ref.add(pixelOf(fy, SIZE) * SIZE + pixelOf(fx, SIZE));
    }
  }
  return ref;
}

function checkTemplate(uvs: ArrayLike<number>, faceUvs: ArrayLike<number>): { linePixels: number } {
  const img = renderUvTemplate(uvs, faceUvs, { size: SIZE });
  const ref = referencePixels(uvs, faceUvs);
  const lineNear = (x: number, y: number) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (isLine(img, x + dx, y + dy)) return true;
    return false;
  };
  // 1. Every edge's endpoints are on the wireframe, and its midpoint within a pixel of it.
  for (const [a, b] of uvEdges(faceUvs)) {
    const p0 = uvToImage(uvs[a * 2]!, uvs[a * 2 + 1]!, SIZE);
    const p1 = uvToImage(uvs[b * 2]!, uvs[b * 2 + 1]!, SIZE);
    for (const t of [0, 0.5, 1]) {
      const fx = p0[0] + (p1[0] - p0[0]) * t;
      const fy = p0[1] + (p1[1] - p0[1]) * t;
      if (fx < 0 || fy < 0 || fx > SIZE || fy > SIZE) continue;
      const x = pixelOf(fx, SIZE);
      const y = pixelOf(fy, SIZE);
      expect(t === 0.5 ? lineNear(x, y) : isLine(img, x, y), `edge ${a}-${b} at t=${t}`).toBe(true);
    }
  }
  // 2. Every wireframe pixel lies on (or within one pixel of) a real UV edge.
  let linePixels = 0;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (!isLine(img, x, y)) continue;
      linePixels++;
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1 && !near; dx++) near = ref.has((y + dy) * SIZE + x + dx);
      if (!near) throw new Error(`stray wireframe pixel at ${x},${y}`);
    }
  }
  return { linePixels };
}

describe('UV template', () => {
  it('draws a single quad exactly where its UVs are', () => {
    const uvs = [0.25, 0.25, 0.75, 0.25, 0.75, 0.75, 0.25, 0.75];
    const { linePixels } = checkTemplate(uvs, [0, 1, 2, 3]);
    expect(linePixels).toBeGreaterThan(4 * 500);
    const img = renderUvTemplate(uvs, [0, 1, 2, 3], { size: SIZE });
    // v up: UV (0.25, 0.75) is near the top-left of the image.
    expect(isLine(img, 256, 256)).toBe(true);
    expect(isLine(img, 512, 512)).toBe(false);
  });

  it('draws over a background texture without changing other pixels', () => {
    const bg = new Uint8ClampedArray(16 * 16 * 4).fill(200);
    const img = renderUvTemplate([0, 0, 1, 0, 1, 1], [0, 1, 2, 2], { size: 16, background: bg });
    expect(Array.from(img.subarray(0, 4))).toEqual([200, 200, 200, 200]); // top-left: not on an edge
    expect(Array.from(img.subarray((15 * 16 + 8) * 4, (15 * 16 + 8) * 4 + 4))).toEqual(UV_TEMPLATE_LINE); // bottom edge v = 0
  });

  (assetsAvailable ? it : it.skip)('matches the UVs of real garments and hair', async () => {
    const assets = await loadAssets();
    for (const id of ['mh:clothes/male_casualsuit01', 'mh:clothes/toigo_flats', 'mh:hair/short02']) {
      const proxy = await assets.proxy(id);
      const { linePixels } = checkTemplate(proxy.uvs, proxy.faceUvs);
      expect(linePixels, id).toBeGreaterThan(1000);
    }
  }, 120_000);
});
