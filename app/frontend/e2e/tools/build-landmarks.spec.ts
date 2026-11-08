/**
 * Build step (PRD F7 step 3): the MediaPipe landmark -> hm08 vertex table.
 *
 * "Render the neutral head front-on, run MediaPipe on the render, then map each
 * landmark to the nearest visible vertex." The render is the default character
 * on the full-face 12k body, orthographic along -Z (the projection's front
 * view), with the default skin, eyes, brows and lashes. Each landmark pixel is
 * ray-cast onto the body; the nearest hm08 body vertex to the hit point is the
 * table entry. The 10 iris landmarks (468-477) lie on the eyeballs, not the
 * skin, and stay unmapped (-1).
 *
 * Writes assets/core/skin/landmarks.json (+ its licence row) and a review image
 * in docs/milestones/M6/. Run with `pnpm build:landmarks`.
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { boot, MILESTONES, setCharacter } from '../helpers';
import type { TestWindow } from '../skin-helpers';

const here = dirname(fileURLToPath(import.meta.url));
const ASSETS = resolve(here, '../../../../assets/core');
const OUT = join(ASSETS, 'skin', 'landmarks.json');
const RENDER = 1024;

test('build the landmark -> vertex table', async ({ page }) => {
  await boot(page);
  await page.waitForFunction(() => Boolean((window as unknown as TestWindow).__ps2ccTest), undefined, { timeout: 60_000 });
  await setCharacter(page, {}, { bodyMesh: 'ps2_body_12k', garments: [], hair: { mode: 'none', tint: { color: [1, 1, 1], brightness: 1 }, alphaThreshold: 0.5 } });
  const result = await page.evaluate(async (size) => {
    const w = window as unknown as TestWindow;
    const s = w.__ps2cc;
    const t = w.__ps2ccTest;
    await s.settled();
    const view = t.faceView(s);
    const render = s.viewport!.renderFront(view, size);
    const canvas = t.imageToCanvas(render);
    const found = await t.detectLandmarks(s.info.coreAssetsUrl, canvas);
    if (!found) return null;
    const pos = s.engine.positions;
    const nrm = s.engine.normals;
    const nBody = s.assets.base.bodyVertexCount;
    const vertices: number[] = [];
    const anchors: number[] = [];
    const residuals: number[] = [];
    const anchorResiduals: number[] = [];
    const sourceVertex = s.scene.bodySourceVertices!;
    const toPx = (x: number, y: number) => [((x - view.cx + view.half) / (2 * view.half)) * size, ((view.cy + view.half - y) / (2 * view.half)) * size];
    for (let i = 0; i < 478; i++) {
      if (i >= 468) {
        vertices.push(-1);
        anchors.push(-1, -1, -1, 0, 0, 0);
        continue;
      }
      const px = found.points[i * 3]! * size;
      const py = found.points[i * 3 + 1]! * size;
      const hit = s.viewport!.frontHit(view, size, px, py, 'body');
      if (!hit) {
        vertices.push(-1);
        anchors.push(-1, -1, -1, 0, 0, 0);
        continue;
      }
      // Exact surface point: the hit triangle's hm08 vertices and barycentric weights.
      const hv = hit.corners.map((c) => sourceVertex[c]!);
      anchors.push(...hv, ...hit.bary.map((b) => Math.round(b * 1e6) / 1e6));
      const ax = hv.reduce((sum, v, k) => sum + hit.bary[k]! * pos[v * 3]!, 0);
      const ay = hv.reduce((sum, v, k) => sum + hit.bary[k]! * pos[v * 3 + 1]!, 0);
      const [apx, apy] = toPx(ax, ay);
      anchorResiduals.push(Math.hypot(apx! - px, apy! - py));
      let best = -1;
      let bestD = 0.006 ** 2;
      for (let v = 0; v < nBody; v++) {
        if (nrm[v * 3 + 2]! < -0.2) continue; // facing away: not the visible side
        const d = (pos[v * 3]! - hit.point[0]) ** 2 + (pos[v * 3 + 1]! - hit.point[1]) ** 2 + (pos[v * 3 + 2]! - hit.point[2]) ** 2;
        if (d < bestD) [bestD, best] = [d, v];
      }
      vertices.push(best);
      if (best >= 0) {
        const [qx, qy] = toPx(pos[best * 3]!, pos[best * 3 + 1]!);
        residuals.push(Math.hypot(qx! - px, qy! - py));
      }
    }
    // Review image: the render with landmarks (green) and their mapped vertices (red).
    const ctx = canvas.getContext('2d')!;
    for (let i = 0; i < 478; i++) {
      const px = found.points[i * 3]! * size;
      const py = found.points[i * 3 + 1]! * size;
      ctx.fillStyle = '#3f3';
      ctx.fillRect(px - 1.5, py - 1.5, 3, 3);
      const v = vertices[i]!;
      if (v < 0) continue;
      const [qx, qy] = toPx(pos[v * 3]!, pos[v * 3 + 1]!);
      ctx.fillStyle = '#f33';
      ctx.fillRect(qx! - 1, qy! - 1, 2, 2);
    }
    const png = await t.canvasToPng(canvas);
    const bytes = new Uint8Array(await png.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    residuals.sort((a, b) => a - b);
    anchorResiduals.sort((a, b) => a - b);
    return {
      vertices,
      anchors,
      anchorMax: anchorResiduals[anchorResiduals.length - 1] ?? 0,
      view,
      png: btoa(bin),
      residualMedian: residuals[Math.floor(residuals.length / 2)] ?? 0,
      residualMax: residuals[residuals.length - 1] ?? 0,
    };
  }, RENDER);
  expect(result, 'MediaPipe found no face in the neutral render').not.toBeNull();
  const r = result!;
  const mapped = r.vertices.filter((v) => v >= 0).length;
  // All 468 face-mesh landmarks should land on skin; irises stay unmapped.
  expect(mapped).toBeGreaterThan(450);
  const pixelsPerMm = RENDER / (2 * r.view.half) / 1000;
  const table = {
    format: 'ps2cc.landmarks/1',
    vertices: r.vertices,
    anchors: r.anchors,
    source: {
      method:
        'MediaPipe Face Landmarker on an orthographic front render of the default character (12k body, default skin); vertices: nearest hm08 body vertex to the ray hit; anchors: the hit point as hm08 vertices + barycentric weights',
      detector: 'face_landmarker.task float16/1, @mediapipe/tasks-vision 1.2.2',
      render: { size: RENDER, view: r.view },
      mapped,
      residualMedianMm: +(r.residualMedian / pixelsPerMm).toFixed(3),
      residualMaxMm: +(r.residualMax / pixelsPerMm).toFixed(3),
      anchorResidualMaxMm: +(r.anchorMax / pixelsPerMm).toFixed(4),
    },
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(table, null, 1) + '\n');
  registerLicence('skin/landmarks.json');
  mkdirSync(join(MILESTONES, 'M6'), { recursive: true });
  writeFileSync(join(MILESTONES, 'M6', 'landmark_table.png'), Buffer.from(r.png, 'base64'));
  console.log(
    `landmark table: ${mapped} mapped; nearest vertex off by median ${table.source.residualMedianMm} mm, max ${table.source.residualMaxMm} mm; surface anchors max ${table.source.anchorResidualMaxMm} mm`,
  );
  expect(table.source.anchorResidualMaxMm).toBeLessThan(0.05);
});

/** Add or refresh the licence row of a generated file (PRD rule 5). */
function registerLicence(file: string): void {
  const path = join(ASSETS, 'LICENSES.json');
  const doc = JSON.parse(readFileSync(path, 'utf8')) as { files: Record<string, unknown>[] };
  const abs = join(ASSETS, file);
  const row = {
    file,
    asset: 'ps2cc:skin/landmarks',
    licence: 'CC0-1.0',
    author: 'PS2CC (generated from the MakeHuman hm08 mesh with MediaPipe Face Landmarker)',
    sourceUrl: '',
    upstream: 'ps2cc',
    attributionRequired: false,
    sha256: createHash('sha256').update(readFileSync(abs)).digest('hex'),
    bytes: statSync(abs).size,
  };
  doc.files = [...doc.files.filter((r) => r.file !== file), row].sort((a, b) => ((a.file as string) < (b.file as string) ? -1 : 1));
  writeFileSync(path, JSON.stringify(doc, null, 1) + '\n');
}
