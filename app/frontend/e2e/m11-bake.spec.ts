/**
 * PRD Part 2 M11 acceptance for the bake engine (F16), in the real app:
 * - the GPU bake matches a CPU path-traced reference (1,024 rays per point)
 *   within 0.03 mean absolute error, on surface points of the body and garments;
 * - no background texel can bleed into a seam: along every UV border, the
 *   texels bilinear filtering and the first mip level read are all filled.
 * Bake time is logged (docs/milestones/M11/bake_report.json).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { boot, garment, MILESTONES, setCharacter } from './helpers';
import { waitForTestHooks, type TestWindow } from './skin-helpers';

const OUT = join(MILESTONES, 'M11');

test('bake engine: matches the CPU reference and fills every seam', async ({ page }) => {
  test.setTimeout(900_000);
  await boot(page);
  await waitForTestHooks(page);
  const style = await page.evaluate(() => (window as unknown as TestWindow).__ps2ccTest.core.starterStyle('short-messy'));
  await setCharacter(page, { gender: 1, age: 0.5 }, {
    garments: [garment('mh:clothes/namuhekam_male_polo_shirt', 'top')],
    hair: { mode: 'cards', style, atlas: null, tint: { color: [1, 1, 1], brightness: 1 }, alphaThreshold: 0.5 },
  });
  const report = await page.evaluate(async () => {
    const s = (window as unknown as TestWindow).__ps2cc;
    const core = (window as unknown as TestWindow).__ps2ccTest.core;
    await s.settled();
    // Small maps: the test GPU is SwiftShader (a CPU), the reference GPU is ~100x faster.
    const settings = { ...core.DEFAULT_BAKE, size: 256, rays: 64 };
    const inputs = core.bakeInputs(s.scene, settings);
    const baker = s.viewport!.baker;
    baker.coverage = true;
    const t0 = performance.now();
    const run = await baker.bake(inputs, settings);
    const ms = performance.now() - t0;
    baker.coverage = false;
    const packed = core.packBvh(inputs.occluders);

    // Deterministic surface points: every k-th triangle's centroid.
    const results: Record<string, { points: number; mae: number; worst: number; uncoveredBorderTexels: number; borderSamples: number }> = {};
    for (const target of inputs.targets) {
      const map = run.maps.get(target.key)!.image;
      const S = map.width;
      const sample = (u: number, v: number) => {
        // Bilinear, rows top first.
        const fx = u * S - 0.5;
        const fy = (1 - v) * S - 0.5;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const tx = fx - x0;
        const ty = fy - y0;
        const at = (x: number, y: number) => map.data[(Math.min(S - 1, Math.max(0, y)) * S + Math.min(S - 1, Math.max(0, x))) * 4]! / 255;
        return (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
      };
      const tris = target.indices.length / 3;
      const step = Math.max(1, Math.floor(tris / 400));
      let err = 0;
      let worst = 0;
      let n = 0;
      for (let t = 0; t < tris; t += step) {
        const [a, b, c] = [target.indices[t * 3]!, target.indices[t * 3 + 1]!, target.indices[t * 3 + 2]!];
        const mid = (arr: Float32Array, k: number, dim: number) => (arr[a * dim + k]! + arr[b * dim + k]! + arr[c * dim + k]!) / 3;
        const p = [0, 1, 2].map((k) => mid(target.positions, k, 3));
        let nrm = [0, 1, 2].map((k) => mid(target.normals, k, 3));
        const l = Math.hypot(nrm[0]!, nrm[1]!, nrm[2]!) || 1;
        nrm = nrm.map((x) => x / l);
        const u = mid(target.uvs, 0, 2);
        const v = mid(target.uvs, 1, 2);
        // Skip triangles smaller than about a texel: the map cannot resolve them.
        const ua = [target.uvs[a * 2]!, target.uvs[a * 2 + 1]!];
        const ub = [target.uvs[b * 2]!, target.uvs[b * 2 + 1]!];
        const uc = [target.uvs[c * 2]!, target.uvs[c * 2 + 1]!];
        const area = Math.abs((ub[0]! - ua[0]!) * (uc[1]! - ua[1]!) - (uc[0]! - ua[0]!) * (ub[1]! - ua[1]!)) / 2;
        if (area * S * S < 1.5) continue;
        const ref = core.referenceTexel(packed, inputs.occluders.opacity, p, nrm, settings, 1024, [0.37, 0.61]).ao;
        const gpu = sample(u, v);
        const e = Math.abs(gpu - ref);
        err += e;
        worst = Math.max(worst, e);
        n++;
      }
      // Seams: points along every UV border edge; the 4x4 texels around each (bilinear + first mip) must be filled.
      const cov = run.coverage.get(target.key)!;
      const edges = new Map<string, number>();
      const key = (i: number, j: number) => {
        const ka = `${target.uvs[i * 2]!.toFixed(5)},${target.uvs[i * 2 + 1]!.toFixed(5)}`;
        const kb = `${target.uvs[j * 2]!.toFixed(5)},${target.uvs[j * 2 + 1]!.toFixed(5)}`;
        return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      };
      for (let t = 0; t < tris; t++) for (let k = 0; k < 3; k++) {
        const kk = key(target.indices[t * 3 + k]!, target.indices[t * 3 + ((k + 1) % 3)]!);
        edges.set(kk, (edges.get(kk) ?? 0) + 1);
      }
      let uncovered = 0;
      let samples = 0;
      for (const [kk, count] of edges) {
        if (count !== 1) continue;
        const [pa, pb] = kk.split('|').map((x) => x.split(',').map(Number));
        for (let i = 0; i <= 4; i++) {
          const u = pa![0]! + ((pb![0]! - pa![0]!) * i) / 4;
          const v = pa![1]! + ((pb![1]! - pa![1]!) * i) / 4;
          const x0 = Math.floor(u * S - 0.5);
          const y0 = Math.floor((1 - v) * S - 0.5);
          samples++;
          for (let dy = -1; dy <= 2; dy++) for (let dx = -1; dx <= 2; dx++) {
            const x = x0 + dx;
            const y = y0 + dy;
            if (x < 0 || y < 0 || x >= S || y >= S) continue;
            if (!cov[y * S + x]) uncovered++;
          }
        }
      }
      results[target.key] = { points: n, mae: err / Math.max(1, n), worst, uncoveredBorderTexels: uncovered, borderSamples: samples };
    }
    return { ms, timings: run.timings, settings, results };
  });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'bake_report.json'), JSON.stringify({ generated: 'app/frontend/e2e/m11-bake.spec.ts', gpu: 'SwiftShader (CPU)', ...report }, null, 1) + '\n');
  for (const [key, r] of Object.entries(report.results)) {
    expect(r.points, key).toBeGreaterThan(40);
    expect(r.mae, `${key}: mean absolute error against the 1,024-ray reference`).toBeLessThan(0.03);
    expect(r.uncoveredBorderTexels, `${key}: empty texels next to UV borders`).toBe(0);
  }
});
