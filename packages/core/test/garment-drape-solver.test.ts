/**
 * PRD Part 3, M23: the drape solver's unit tests (F30), and its building blocks.
 * - A pinned sheet settles with its energy (kinetic, gravitational, elastic) falling every frame.
 * - A cylinder skirt sewn round a cylinder body stays outside it on every frame.
 * - Triangulation keeps every boundary segment, winds every triangle the same way and covers the polygon.
 * - Both sides of a stitch get the same samples; the same inputs give the same bytes.
 */
import { describe, expect, it } from 'vitest';
import { CylinderCollider } from '../src/garment/drape/collide';
import { discretise } from '../src/garment/drape/discretise';
import { latticePoints, ringArea, triangulate } from '../src/garment/drape/triangulate';
import { Cloth, DEFAULT_SETTINGS } from '../src/garment/drape/xpbd';
import { CLOTH_PRESETS } from '../src/garment/drape/materials';
import type { PatternSpec } from '../src/garment/pattern/spec';

function rectRing(w: number, h: number, n: number, m: number): number[] {
  const r: number[] = [];
  for (let i = 0; i < n; i++) r.push((w * i) / n, 0);
  for (let i = 0; i < m; i++) r.push(w, (h * i) / m);
  for (let i = 0; i < n; i++) r.push(w - (w * i) / n, h);
  for (let i = 0; i < m; i++) r.push(0, h - (h * i) / m);
  return r;
}

describe('M23: drape solver (PRD Part 3, F30)', () => {
  it('a pinned sheet settles, its energy falling every frame', () => {
    const W = 0.4;
    const n = 20;
    const ring = rectRing(W, W, n, n);
    const tri = triangulate(ring, latticePoints(ring, W / n));
    const N = tri.points.length / 2;
    // Hanging straight down from its top edge.
    const pos = new Float64Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = tri.points[i * 2]!;
      pos[i * 3 + 1] = 1 - (W - tri.points[i * 2 + 1]!);
    }
    const pinned = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (tri.points[i * 2 + 1]! > W - 1e-9) pinned[i] = 1;
    for (const kind of ['cotton', 'denim', 'jersey', 'leather'] as const) {
      const cloth = new Cloth({ positions: pos, rest2d: tri.points, tris: tri.tris, triMaterial: new Uint8Array(tri.tris.length / 3), materials: [CLOTH_PRESETS[kind]], seams: new Uint32Array(), pinned }, { ...DEFAULT_SETTINGS, seamRamp: 0 });
      // Let it take its weight, then swing it 30 degrees about the pinned edge and let go.
      for (let f = 0; f < 60; f++) cloth.frame(null);
      const s = 0.5;
      const c = 0.8660254037844386;
      for (let i = 0; i < N; i++) {
        if (pinned[i]) continue;
        const y = cloth.x[i * 3 + 1]! - 1;
        const z = cloth.x[i * 3 + 2]!;
        cloth.x[i * 3 + 1] = 1 + y * c - z * s;
        cloth.x[i * 3 + 2] = y * s + z * c;
      }
      cloth.v.fill(0);
      cloth.frameStart.set(cloth.x);
      // Energy that settling removes: motion over each frame, height, and bending. (Stretch is held by the
      // constraints; its residual is the solver's tolerance, not stored energy.)
      const energy = () => {
        const e = cloth.energy();
        return e.kinetic + e.gravity + e.bending;
      };
      const start = energy();
      let prev = start;
      const rises: number[] = [];
      for (let f = 0; f < 480; f++) {
        cloth.frame(null);
        const e = energy();
        if (e > prev) rises.push(f);
        prev = e;
      }
      expect(rises, kind).toEqual([]);
      expect(prev, kind).toBeLessThan(start);
      // At rest: no particle moved more than a millimetre over the last frame.
      let moved = 0;
      for (let i = 0; i < N; i++) moved = Math.max(moved, Math.hypot(cloth.x[i * 3]! - cloth.frameStart[i * 3]!, cloth.x[i * 3 + 1]! - cloth.frameStart[i * 3 + 1]!, cloth.x[i * 3 + 2]! - cloth.frameStart[i * 3 + 2]!));
      expect(moved, kind).toBeLessThan(0.001);
    }
  });

  it('a cylinder skirt on a cylinder body stays outside it', () => {
    const R = 0.15;
    const Rs = 0.165;
    const L = 2 * Math.PI * Rs;
    const H = 0.4;
    const nAround = 60;
    const nDown = 16;
    const ring = rectRing(L, H, nAround, nDown);
    const tri = triangulate(ring, latticePoints(ring, L / nAround));
    const N = tri.points.length / 2;
    const pos = new Float64Array(N * 3);
    for (let i = 0; i < N; i++) {
      const a = (tri.points[i * 2]! / L) * 2 * Math.PI;
      pos[i * 3] = Rs * Math.sin(a);
      pos[i * 3 + 1] = tri.points[i * 2 + 1]!;
      pos[i * 3 + 2] = Rs * Math.cos(a);
    }
    // The side seam: the left edge (x = 0) to the right (x = L), point for point.
    const seams: number[] = [];
    for (let j = 0; j <= nDown; j++) {
      const left = j === 0 ? 0 : 2 * nAround + 2 * nDown - j;
      const right = nAround + j;
      seams.push(Math.min(left, right), Math.max(left, right));
    }
    const cloth = new Cloth({ positions: pos, rest2d: tri.points, tris: tri.tris, triMaterial: new Uint8Array(tri.tris.length / 3), materials: [CLOTH_PRESETS.cotton], seams: Uint32Array.from(seams) }, DEFAULT_SETTINGS);
    const body = new CylinderCollider(0, 0, R);
    let inside = 0;
    for (let f = 0; f < 120; f++) {
      cloth.frame(body);
      for (let i = 0; i < N; i++) inside = Math.max(inside, R + DEFAULT_SETTINGS.thickness - Math.hypot(cloth.x[i * 3]!, cloth.x[i * 3 + 2]!));
    }
    // Never inside the body, and within half a millimetre of the collision thickness.
    expect(inside).toBeLessThan(0.0005);
  });

  it('triangulates a polygon with its boundary kept', () => {
    // An L shape with a notch: concave corners.
    const ring = [0, 0, 0.3, 0, 0.3, 0.1, 0.12, 0.1, 0.12, 0.3, 0.06, 0.25, 0, 0.3];
    const dense: number[] = [];
    const n = ring.length / 2;
    for (let i = 0; i < n; i++) {
      const ax = ring[i * 2]!;
      const ay = ring[i * 2 + 1]!;
      const bx = ring[((i + 1) % n) * 2]!;
      const by = ring[((i + 1) % n) * 2 + 1]!;
      const k = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 0.015));
      for (let j = 0; j < k; j++) dense.push(ax + ((bx - ax) * j) / k, ay + ((by - ay) * j) / k);
    }
    const t = triangulate(dense, latticePoints(dense, 0.015));
    const P = t.points;
    let area = 0;
    const edges = new Set<string>();
    for (let i = 0; i < t.tris.length / 3; i++) {
      const [a, b, c] = [t.tris[i * 3]!, t.tris[i * 3 + 1]!, t.tris[i * 3 + 2]!];
      const ar = ((P[b * 2]! - P[a * 2]!) * (P[c * 2 + 1]! - P[a * 2 + 1]!) - (P[b * 2 + 1]! - P[a * 2 + 1]!) * (P[c * 2]! - P[a * 2]!)) / 2;
      expect(ar).toBeGreaterThan(0);
      area += ar;
      for (const [u, v] of [
        [a, b],
        [b, c],
        [c, a],
      ]) edges.add(`${Math.min(u!, v!)}-${Math.max(u!, v!)}`);
    }
    expect(area).toBeCloseTo(ringArea(dense), 9);
    const nb = dense.length / 2;
    for (let i = 0; i < nb; i++) expect(edges.has(`${Math.min(i, (i + 1) % nb)}-${Math.max(i, (i + 1) % nb)}`)).toBe(true);
  });

  it('samples both sides of a stitch alike, the same every time', () => {
    const panel = (x: number, w: number) => ({ translation: [x, 0, 0], rotation: [0, 0, 0], vertices: [[0, 0], [w, 0], [w, 40], [0, 40]], edges: [{ endpoints: [0, 1] }, { endpoints: [1, 2] }, { endpoints: [2, 3], curvature: { type: 'quadratic' as const, params: [[0.5, 0.2]] } }, { endpoints: [3, 0] }] });
    const spec: PatternSpec = { panels: { a: panel(0, 20), b: panel(30, 23) }, stitches: [[{ panel: 'a', edge: 1 }, { panel: 'b', edge: 3 }]] };
    const d = discretise(spec, 1.5);
    const A = d.panels[0]!;
    const B = d.panels[1]!;
    expect(A.edgeSamples[1]!.length).toBe(B.edgeSamples[3]!.length);
    expect(d.seams.length / 2).toBe(A.edgeSamples[1]!.length);
    const again = discretise(spec, 1.5);
    expect(Array.from(again.panels[1]!.points)).toEqual(Array.from(B.points));
    expect(Array.from(again.panels[1]!.tris)).toEqual(Array.from(B.tris));
  });
});
