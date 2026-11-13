/** Types and helpers for the skin and photo e2e tests (M6). */
import { expect, type Page } from '@playwright/test';
import type { Studio } from '../src/state/studio';
import type { TestHooks } from '../src/testHooks';

export interface TestWindow {
  __ps2cc: Studio;
  __ps2ccTest: TestHooks;
}

/** Wait until the e2e-only helpers (window.__ps2ccTest) are loaded. */
export async function waitForTestHooks(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean((window as unknown as Partial<TestWindow>).__ps2ccTest), undefined, { timeout: 60_000 });
  await expect(page.getByTestId('budget')).toBeVisible();
}

/** MediaPipe landmarks checked for eye and mouth alignment (PRD M6, Part 2 M14). */
export const FACE_CHECK: Record<string, number> = {
  rightEyeOuter: 33,
  rightEyeInner: 133,
  rightEyeTop: 159,
  rightEyeBottom: 145,
  leftEyeInner: 362,
  leftEyeOuter: 263,
  leftEyeTop: 386,
  leftEyeBottom: 374,
  mouthRight: 61,
  mouthLeft: 291,
  upperLip: 0,
  lowerLip: 17,
};

/**
 * How far the projected face's eyes and mouth are from where the photo's
 * landmarks were placed, in texels at 1024 (the M6 check, D-041): the body
 * alone, unlit and front-on, landmarks found again on the render and compared
 * with their anchors on the head, converted to texels with each feature's
 * own scale. Returns the errors and the render (PNG, base64).
 */
export async function measureFace(page: Page): Promise<{ errors: Record<string, number>; png: string } | { error: string }> {
  return page.evaluate(async (check) => {
    const w = window as unknown as TestWindow;
    const s = w.__ps2cc;
    const t = w.__ps2ccTest;
    await s.settled();
    const view = t.faceView(s);
    const size = 1024;
    const render = s.viewport!.renderFront(view, size, (key) => key === 'body', 'unlit');
    const canvas = t.imageToCanvas(render);
    const found = await t.detectLandmarks(s.info.coreAssetsUrl, canvas);
    if (!found) return { error: 'no face found in the render of the projected character' };
    const table = (await s.assets.landmarkTable())!;
    const pos = s.engine.positions;
    const base = s.assets.base;
    const toPx = (x: number, y: number): [number, number] => [((x - view.cx + view.half) / (2 * view.half)) * size, ((view.cy + view.half - y) / (2 * view.half)) * size];
    const faceUv = new Map<number, [number, number]>();
    const inFace = (u: number, v: number) => u > 0.63 && v > 0.145;
    for (const f of base.facesWhere((g) => g === 'body'))
      for (let k = 0; k < 4; k++) {
        const tuv = base.faceUvs[f * 4 + k]!;
        const u = base.uvs[tuv * 2]!;
        const v = base.uvs[tuv * 2 + 1]!;
        if (inFace(u, v)) faceUv.set(base.faceVerts[f * 4 + k]!, [u, v]);
      }
    const anchor = (i: number) => {
      let x = 0;
      let y = 0;
      let u = 0;
      let v = 0;
      for (let k = 0; k < 3; k++) {
        const vert = table.anchors![i * 6 + k]!;
        const wt = table.anchors![i * 6 + 3 + k]!;
        x += wt * pos[vert * 3]!;
        y += wt * pos[vert * 3 + 1]!;
        const uv = faceUv.get(vert) ?? [NaN, NaN];
        u += wt * uv[0];
        v += wt * uv[1];
      }
      return { px: toPx(x, y), uv: [u, v] as [number, number] };
    };
    const scaleOf = (a: number, b: number) => {
      const A = anchor(a);
      const B = anchor(b);
      return (Math.hypot(A.uv[0] - B.uv[0], A.uv[1] - B.uv[1]) * 1024) / Math.hypot(A.px[0] - B.px[0], A.px[1] - B.px[1]);
    };
    const scales = { rightEye: scaleOf(33, 133), leftEye: scaleOf(362, 263), mouth: scaleOf(61, 291) };
    const errors: Record<string, number> = {};
    for (const [name, i] of Object.entries(check)) {
      const a = anchor(i);
      const scale = name.startsWith('right') ? scales.rightEye : name.startsWith('left') ? scales.leftEye : scales.mouth;
      errors[name] = Math.hypot(found.points[i * 3]! * size - a.px[0], found.points[i * 3 + 1]! * size - a.px[1]) * scale;
    }
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#3f3';
    for (const i of Object.values(check)) ctx.fillRect(found.points[i * 3]! * size - 2, found.points[i * 3 + 1]! * size - 2, 4, 4);
    const bytes = new Uint8Array(await (await t.canvasToPng(canvas)).arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { errors, png: btoa(bin) };
  }, FACE_CHECK);
}
