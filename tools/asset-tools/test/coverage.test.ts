import { describe, expect, it } from 'vitest';
import { alphaSampler, computeCoveredVertices, MAX_GAP } from '@ps2cc/core';
import { Canvas, decodePng } from '../src/png';

/** n x n quad grid in the XZ plane (1 m square), normals +Y. */
function bodyGrid(n: number) {
  const positions: number[] = [];
  const normals: number[] = [];
  const quads: number[] = [];
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      positions.push(i / n - 0.5, 0, j / n - 0.5);
      normals.push(0, 1, 0);
    }
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i;
      quads.push(a, a + 1, a + n + 2, a + n + 1);
    }
  }
  return { positions, normals, quads, at: (i: number, j: number) => j * (n + 1) + i };
}

/** A cloth rectangle at height y over x in [x0, x1], all z, as two triangles with UVs. */
function cloth(y: number, x0: number, x1: number) {
  return {
    garmentPositions: [x0, y, -1, x1, y, -1, x1, y, 1, x0, y, 1],
    garmentIndices: [0, 1, 2, 0, 2, 3],
    garmentUvs: [0, 0, 1, 0, 1, 1, 0, 1],
  };
}

describe('decodePng', () => {
  it('round-trips the review-image encoder', () => {
    const c = new Canvas(7, 5, [10, 20, 30]);
    c.plot(3, 2, [250, 0, 0]);
    const img = decodePng(c.toPng());
    expect([img.width, img.height]).toEqual([7, 5]);
    expect(Array.from(img.rgba.subarray(0, 4))).toEqual([10, 20, 30, 255]);
    expect(Array.from(img.rgba.subarray((2 * 7 + 3) * 4, (2 * 7 + 3) * 4 + 4))).toEqual([250, 0, 0, 255]);
  });

  it('rejects files that are not PNGs', () => {
    expect(() => decodePng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow('not a PNG');
  });
});

describe('computeCoveredVertices', () => {
  const g = bodyGrid(20);
  const body = { bodyPositions: g.positions, bodyNormals: g.normals, bodyQuads: g.quads };

  it('hides what opaque cloth covers, eroded by one ring at the cloth edge', () => {
    // Cloth 1 cm above the right half (x >= 0) of the grid, reaching past its outer edge.
    const covered = new Set(computeCoveredVertices({ ...body, ...cloth(0.01, 0, 2) }));
    expect(covered.has(g.at(15, 10))).toBe(true);
    // Left half is bare; the cloth edge column and the ring next to it are not hidden.
    expect(covered.has(g.at(5, 10))).toBe(false);
    expect(covered.has(g.at(10, 10))).toBe(false);
    expect(covered.has(g.at(11, 10))).toBe(false);
    expect(covered.has(g.at(12, 10))).toBe(true);
  });

  it('hides nothing when the cloth is too far from the skin', () => {
    expect(computeCoveredVertices({ ...body, ...cloth(MAX_GAP + 0.02, -2, 2) })).toHaveLength(0);
  });

  it('sees through transparent texels (fishnet holes)', () => {
    // Alpha 0 everywhere except a thin grid of strands.
    const w = 64;
    const rgba = new Uint8Array(w * w * 4);
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) rgba[(y * w + x) * 4 + 3] = x % 16 === 0 || y % 16 === 0 ? 255 : 0;
    const covered = computeCoveredVertices({ ...body, ...cloth(0.01, -2, 2), alphaAt: alphaSampler(w, w, rgba) });
    expect(covered).toHaveLength(0);
    const solid = computeCoveredVertices({ ...body, ...cloth(0.01, -2, 2), alphaAt: () => 1 });
    expect(solid.length).toBeGreaterThan(300);
  });
});
