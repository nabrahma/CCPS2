import type { BaseMesh } from '../mesh/basemesh';
import type { TargetStore } from './targets';

/**
 * Applies target weights to the base mesh incrementally (PRD F1 performance):
 * only targets whose weight changed are touched, and only on the vertices
 * they move. Positions accumulate in float64 so long slider sessions do not
 * drift; `rebuild()` recomputes from scratch (used on slider release and load).
 */
export class Morpher {
  private readonly accum: Float64Array;
  /** Current morphed positions (float32 for the GPU), metres. */
  readonly positions: Float32Array;
  private weights = new Map<number, number>();
  private dirtyMin = Infinity;
  private dirtyMax = -Infinity;
  /** Number of target applications in the last update (for perf logging). */
  lastTouchedTargets = 0;

  constructor(
    private readonly base: BaseMesh,
    private readonly targets: TargetStore,
  ) {
    this.accum = Float64Array.from(base.positions);
    this.positions = Float32Array.from(base.positions);
  }

  get currentWeights(): ReadonlyMap<number, number> {
    return this.weights;
  }

  /** Move to a new weight set, applying only the differences. */
  setWeights(next: ReadonlyMap<number, number>): void {
    let touched = 0;
    for (const [t, w] of next) {
      const dw = w - (this.weights.get(t) ?? 0);
      if (dw !== 0) {
        this.apply(t, dw);
        touched++;
      }
    }
    for (const [t, w] of this.weights) {
      if (!next.has(t) && w !== 0) {
        this.apply(t, -w);
        touched++;
      }
    }
    this.weights = new Map(next);
    this.lastTouchedTargets = touched;
    this.flush();
  }

  /** Recompute positions from the base mesh (exact; no accumulated error). */
  rebuild(weights: ReadonlyMap<number, number> = this.weights): void {
    this.accum.set(this.base.positions);
    for (const [t, w] of weights) this.targets.accumulate(t, w, this.accum);
    this.weights = new Map(weights);
    this.dirtyMin = 0;
    this.dirtyMax = this.base.vertexCount - 1;
    this.lastTouchedTargets = weights.size;
    this.flush();
  }

  private apply(target: number, dw: number): void {
    this.targets.accumulate(target, dw, this.accum);
    const [lo, hi] = this.targets.vertexRange(target);
    this.dirtyMin = Math.min(this.dirtyMin, lo);
    this.dirtyMax = Math.max(this.dirtyMax, hi);
  }

  private flush(): void {
    if (this.dirtyMax < this.dirtyMin) return;
    const a = this.dirtyMin * 3;
    const b = (this.dirtyMax + 1) * 3;
    for (let i = a; i < b; i++) this.positions[i] = this.accum[i]!;
    this.dirtyMin = Infinity;
    this.dirtyMax = -Infinity;
  }
}
