/**
 * BVH queries against brute force, and the garment collider on synthetic
 * geometry (no assets needed).
 */
import { describe, expect, it } from 'vitest';
import { TriangleBVH } from '../src/mesh/bvh';
import { BodySurface, CLEARANCE, GarmentCollider } from '../src/proxy/collision';
import { Rng } from '../src/random';

/** A w x h grid in the XZ plane at y = 0, normals +Y. */
function grid(w: number, h: number, size = 1) {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (let j = 0; j <= h; j++) {
    for (let i = 0; i <= w; i++) {
      positions.push((i / w - 0.5) * size, 0, (j / h - 0.5) * size);
      normals.push(0, 1, 0);
    }
  }
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const a = j * (w + 1) + i;
      indices.push(a, a + w + 1, a + 1, a + 1, a + w + 1, a + w + 2);
    }
  }
  return { positions: Float32Array.from(positions), normals: Float32Array.from(normals), indices: Uint32Array.from(indices) };
}

function randomSoup(rng: Rng, n: number) {
  const positions = new Float32Array(n * 9);
  for (let i = 0; i < positions.length; i++) positions[i] = rng.range(-1, 1);
  return { positions, indices: Uint32Array.from({ length: n * 3 }, (_, i) => i) };
}

describe('TriangleBVH', () => {
  it('closestPoint matches brute force', () => {
    const rng = new Rng(7);
    const { positions, indices } = randomSoup(rng, 300);
    const bvh = new TriangleBVH(positions, indices);
    const single = (t: number) => new TriangleBVH(positions, indices.subarray(t * 3, t * 3 + 3));
    const singles = Array.from({ length: 300 }, (_, t) => single(t));
    for (let q = 0; q < 50; q++) {
      const p = [rng.range(-1.5, 1.5), rng.range(-1.5, 1.5), rng.range(-1.5, 1.5)];
      const hit = bvh.closestPoint(p)!;
      const brute = Math.min(...singles.map((s) => s.closestPoint(p)!.distance));
      expect(hit.distance).toBeCloseTo(brute, 6);
      expect(hit.bary[0] + hit.bary[1] + hit.bary[2]).toBeCloseTo(1, 6);
    }
  });

  it('raycast finds the nearest hit and respects the range', () => {
    const g = grid(4, 4);
    const bvh = new TriangleBVH(g.positions, g.indices);
    const hit = bvh.raycast([0.1, 1, 0.1], [0, -1, 0], 0, 10)!;
    expect(hit.t).toBeCloseTo(1, 6);
    expect(bvh.raycast([0.1, 1, 0.1], [0, -1, 0], 0, 0.5)).toBeNull();
    expect(bvh.raycast([0.1, 1, 0.1], [0, 1, 0], 0, 10)).toBeNull();
    expect(bvh.raycast([2, 1, 0], [0, -1, 0], 0, 10)).toBeNull();
  });

  it('refit follows moved vertices', () => {
    const g = grid(2, 2);
    const bvh = new TriangleBVH(g.positions, g.indices);
    for (let v = 0; v < g.positions.length / 3; v++) g.positions[v * 3 + 1] = 0.5;
    bvh.refit();
    expect(bvh.raycast([0, 1, 0], [0, -1, 0], 0, 10)!.t).toBeCloseTo(0.5, 6);
  });
});

describe('GarmentCollider', () => {
  it('pushes vertices below the skin out to the clearance and spreads the push', () => {
    const body = grid(10, 10);
    const surface = new BodySurface(body.positions, body.normals, body.indices);
    const cloth = grid(10, 10, 0.5);
    // Cloth 5 mm above the skin, with one vertex 4 mm inside it.
    for (let v = 0; v < cloth.positions.length / 3; v++) cloth.positions[v * 3 + 1] = 0.005;
    const centre = 60; // (5, 5) of an 11 x 11 grid
    const garment = Float32Array.from(cloth.positions);
    const collider = new GarmentCollider(surface, garment, cloth.indices);
    expect(collider.anchored).toBe(121);
    garment[centre * 3 + 1] = -0.004;
    const pushed = collider.resolve(garment, body.positions, body.normals);
    expect(pushed).toBeCloseTo(CLEARANCE + 0.004, 6);
    expect(garment[centre * 3 + 1]).toBeCloseTo(CLEARANCE, 6);
    // Neighbours were already clear; vertices far away are untouched.
    expect(garment[(centre + 1) * 3 + 1]).toBeGreaterThanOrEqual(0.005);
    expect(garment[0 * 3 + 1]).toBeCloseTo(0.005, 6);
  });

  it('ignores vertices over a hole in the visible body', () => {
    const body = grid(10, 10, 0.4); // 4 cm cells: the hole edge is within the anchor range
    // Remove the middle 2 x 2 cells (as a hidden-body garment would).
    const keep: number[] = [];
    for (let c = 0; c < body.indices.length / 6; c++) {
      const i = c % 10;
      const j = Math.floor(c / 10);
      if (i >= 4 && i < 6 && j >= 4 && j < 6) continue;
      keep.push(...body.indices.subarray(c * 6, c * 6 + 6));
    }
    const surface = new BodySurface(body.positions, body.normals, Uint32Array.from(keep));
    const garment = Float32Array.from([0, -0.01, 0]); // under the hole
    const collider = new GarmentCollider(surface, garment, new Uint32Array(0));
    expect(collider.anchored).toBe(0);
    expect(collider.resolve(garment, body.positions, body.normals)).toBe(0);
    expect(garment[1]).toBeCloseTo(-0.01, 6);
  });
});
