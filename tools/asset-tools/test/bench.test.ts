import { describe, expect, it } from 'vitest';
import { diffImage, regionChanges, ssim, type Image } from '../src/bench';

const img = (w: number, h: number, f: (x: number, y: number) => number): Image => {
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = Math.max(0, Math.min(255, Math.round(f(x, y))));
    rgba.set([v, v, v, 255], (y * w + x) * 4);
  }
  return { width: w, height: h, rgba };
};

describe('benchmark board maths (Part 2 section 4)', () => {
  const pattern = (x: number, y: number) => 128 + 90 * Math.sin(x / 5) * Math.cos(y / 7);

  it('SSIM is 1 for identical images and drops with noise and with structure changes', () => {
    const a = img(64, 64, pattern);
    expect(ssim(a, a).mean).toBeCloseTo(1, 6);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
    const noisy = img(64, 64, (x, y) => pattern(x, y) + 12 * rnd());
    const s = ssim(a, noisy).mean;
    expect(s).toBeLessThan(0.99);
    expect(s).toBeGreaterThan(0.6);
    const flipped = img(64, 64, (x, y) => pattern(63 - x, y));
    expect(ssim(a, flipped).mean).toBeLessThan(s);
    // A small brightness offset hardly matters to SSIM (it compares structure).
    expect(ssim(a, img(64, 64, (x, y) => pattern(x, y) + 4)).mean).toBeGreaterThan(0.97);
  });

  it('regression finds the changed region only', () => {
    const a = img(64, 64, pattern);
    const b = img(64, 64, (x, y) => (x < 16 && y < 16 ? 0 : pattern(x, y)));
    const r = regionChanges(a, b, 4);
    expect(r.cells).toBe(16);
    expect(r.changed).toHaveLength(1);
    expect(r.changed[0]).toMatchObject({ x: 0, y: 0 });
    expect(regionChanges(a, a, 4).changed).toHaveLength(0);
    expect(diffImage(a, a).data.every((v, i) => (i % 4 === 3 ? v === 255 : v === 0))).toBe(true);
  });
});
