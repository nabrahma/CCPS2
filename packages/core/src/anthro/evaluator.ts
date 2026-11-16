/**
 * Body shapes in float64 for the generators (PRD Part 3, 0.2 rule 1): base
 * mesh plus weighted targets, computed from scratch in a fixed order, so the
 * result depends only on the slider values and never on how they were reached.
 *
 * An evaluator can be limited to some body vertices (the ones a set of
 * measurements reads); the measurement solver uses that, because it evaluates
 * thousands of shapes.
 */
import type { BaseMesh } from '../mesh/basemesh';
import type { MacroValues } from '../morph/macros';
import type { ModifierSet } from '../morph/modifiers';
import type { TargetStore } from '../morph/targets';

interface SubTarget {
  /** Vertex indices (ascending as stored in the target), limited to the evaluator's vertices. */
  idx: Uint32Array;
  /** Deltas in metres, xyz per index. */
  delta: Float64Array;
}

export interface BodySource {
  base: BaseMesh;
  targets: TargetStore;
  modifiers: ModifierSet;
}

export class BodyEvaluator {
  /** Body positions in metres (xyz per body vertex). Entries outside the evaluator's vertices stay at the rest shape. */
  readonly positions: Float64Array;
  private readonly rest: Float64Array;
  private readonly keep: Uint8Array | null;
  private readonly sub = new Map<number, SubTarget>();
  private readonly bodyVertexCount: number;

  constructor(
    private readonly source: BodySource,
    /** Body vertices to evaluate, or null for all of them. */
    readonly vertices: Uint32Array | null = null,
  ) {
    const n = source.base.bodyVertexCount;
    this.bodyVertexCount = n;
    this.rest = new Float64Array(n * 3);
    for (let i = 0; i < n * 3; i++) this.rest[i] = source.base.positions[i]!;
    this.positions = Float64Array.from(this.rest);
    if (vertices) {
      this.keep = new Uint8Array(n);
      for (let i = 0; i < vertices.length; i++) this.keep[vertices[i]!] = 1;
    } else {
      this.keep = null;
    }
  }

  private subTarget(target: number): SubTarget {
    let s = this.sub.get(target);
    if (!s) {
      const verts = this.source.targets.vertices(target);
      const d16 = this.source.targets.deltas(target);
      const scale = this.source.targets.entries[target]!.scale;
      const idx: number[] = [];
      const delta: number[] = [];
      for (let i = 0; i < verts.length; i++) {
        const v = verts[i]!;
        if (v >= this.bodyVertexCount || (this.keep && !this.keep[v])) continue;
        idx.push(v);
        delta.push(d16[i * 3]! * scale, d16[i * 3 + 1]! * scale, d16[i * 3 + 2]! * scale);
      }
      s = { idx: Uint32Array.from(idx), delta: Float64Array.from(delta) };
      this.sub.set(target, s);
    }
    return s;
  }

  /** Target weights of a character, as the engine computes them. */
  weights(macros: MacroValues, modifiers: Readonly<Record<string, number>>): Map<number, number> {
    return this.source.modifiers.computeWeights(macros, modifiers);
  }

  /** Add `weight` times a target into `out` (default: this evaluator's positions). */
  accumulate(target: number, weight: number, out: Float64Array = this.positions): void {
    if (weight === 0) return;
    const s = this.subTarget(target);
    const idx = s.idx;
    const d = s.delta;
    for (let i = 0; i < idx.length; i++) {
      const v = idx[i]! * 3;
      const j = i * 3;
      out[v] = out[v]! + d[j]! * weight;
      out[v + 1] = out[v + 1]! + d[j + 1]! * weight;
      out[v + 2] = out[v + 2]! + d[j + 2]! * weight;
    }
  }

  /** Positions for a weight set, from scratch, into `out` (default: this evaluator's positions). */
  evaluateWeights(weights: ReadonlyMap<number, number>, out: Float64Array = this.positions): Float64Array {
    out.set(this.rest);
    for (const [t, w] of weights) this.accumulate(t, w, out);
    return out;
  }

  /** Positions for a character's sliders, from scratch. */
  evaluate(macros: MacroValues, modifiers: Readonly<Record<string, number>> = {}): Float64Array {
    return this.evaluateWeights(this.weights(macros, modifiers));
  }
}
