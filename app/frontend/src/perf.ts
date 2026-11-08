/**
 * Slider sweep (PRD F1 and 8.2): drags real sliders for a few seconds through
 * the same path a mouse drag takes, and times every frame. Run from
 * Help → Measure slider speed, so it measures the user's own GPU.
 */
import type { Studio } from './state/studio';

export interface SweepReport {
  frames: number;
  fps: number;
  /** Time between frames. */
  frameMs: { p50: number; p95: number; max: number };
  /** Time to apply one slider change: morphs, fitted parts and normals. */
  updateMs: { p50: number; p95: number; max: number };
  triangles: number;
  gpu: string;
  /** The PRD's target. */
  meets60fps: boolean;
}

const SWEPT = ['macrodetails-universal/Weight', 'macrodetails-universal/Muscle', 'head/head-scale-horiz-decr|incr', 'nose/nose-scale-horiz-decr|incr'];

function quantiles(values: number[]): { p50: number; p95: number; max: number } {
  const s = [...values].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0;
  const round = (v: number) => Math.round(v * 100) / 100;
  return { p50: round(at(0.5)), p95: round(at(0.95)), max: round(s[s.length - 1] ?? 0) };
}

function gpuName(canvas: HTMLCanvasElement): string {
  const gl = canvas.getContext('webgl2');
  const info = gl?.getExtension('WEBGL_debug_renderer_info');
  return gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'unknown';
}

/**
 * Sweep for `frames` frames, then put the sliders back through undo, so the
 * character is exactly as it was. Afterwards a redo step is left behind, which
 * is harmless.
 */
export async function runSliderSweep(studio: Studio, frames = 240): Promise<SweepReport> {
  const engine = studio.engine;
  const vp = studio.viewport;
  if (!vp) throw new Error('the viewport is not ready');
  const ids = SWEPT.filter((id) => studio.assets.sliders.byId.has(id));
  if (ids.length === 0) throw new Error('none of the swept sliders exist');
  const nextFrame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));

  const start = ids.map((id) => engine.value(id));
  const intervals: number[] = [];
  const updates: number[] = [];
  let last = await nextFrame();
  const first = last;
  for (let f = 0; f < frames; f++) {
    const id = ids[Math.floor((f / frames) * ids.length)]!;
    const def = studio.assets.sliders.byId.get(id)!;
    const mid = (def.safeMin + def.safeMax) / 2;
    const value = mid + ((def.safeMax - def.safeMin) / 2) * Math.sin((f / 30) * Math.PI);
    const t0 = performance.now();
    engine.setValue(id, value, { mergeKey: 'slider-sweep' });
    updates.push(performance.now() - t0);
    const now = await nextFrame();
    intervals.push(now - last);
    last = now;
  }
  engine.endInteraction();
  if (ids.some((id, i) => Math.abs(engine.value(id) - start[i]!) > 1e-12)) engine.undo();

  const fps = (frames * 1000) / (last - first);
  return {
    frames,
    fps: Math.round(fps * 10) / 10,
    frameMs: quantiles(intervals),
    updateMs: quantiles(updates),
    triangles: studio.scene.budget().total,
    gpu: gpuName(vp.canvas),
    meets60fps: fps >= 58, // a 60 Hz display reports just under 60
  };
}
