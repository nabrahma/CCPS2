import type { Container, ContainerMeta } from '../io/container';
import { readContainer, type AssetSource } from '../io/source';

export interface TargetEntry {
  /** Path relative to MakeHuman's data dir, e.g. "targets/nose/nose-trans-up.target". */
  path: string;
  /** Group key, e.g. "nose-trans-up" or "macrodetails-height". */
  group: string;
  /** Macro variable values this target depends on, e.g. ["female", "young", "caucasian"]. */
  vars: string[];
  offset: number;
  count: number;
  /** Dequantisation scale: delta_m = int16 * scale. */
  scale: number;
}

export interface TargetsMeta extends ContainerMeta {
  format: 'ps2cc.targets/1';
  categories: { name: string; values: string[] }[];
  targets: TargetEntry[];
}

/** All morph targets, sparse: per target a list of vertex indices and int16 deltas. */
export class TargetStore {
  readonly entries: readonly TargetEntry[];
  readonly byPath: ReadonlyMap<string, number>;
  readonly byGroup: ReadonlyMap<string, readonly number[]>;
  private readonly indices: Uint16Array;
  private readonly deltas: Int16Array;

  constructor(container: Container<TargetsMeta>) {
    this.entries = container.meta.targets;
    this.indices = container.get('indices', 'u16');
    this.deltas = container.get('deltas', 'i16');
    const byPath = new Map<string, number>();
    const byGroup = new Map<string, number[]>();
    this.entries.forEach((t, i) => {
      byPath.set(t.path, i);
      const list = byGroup.get(t.group);
      if (list) list.push(i);
      else byGroup.set(t.group, [i]);
    });
    this.byPath = byPath;
    this.byGroup = byGroup;
    this.ranges = new Uint32Array(this.entries.length * 2);
    this.entries.forEach((t, i) => {
      let lo = 0xffffffff;
      let hi = 0;
      for (let k = t.offset; k < t.offset + t.count; k++) {
        const v = this.indices[k]!;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      this.ranges[i * 2] = t.count ? lo : 0;
      this.ranges[i * 2 + 1] = t.count ? hi : 0;
    });
  }

  /** [min, max] vertex index a target touches. */
  private readonly ranges: Uint32Array;

  vertexRange(target: number): [number, number] {
    return [this.ranges[target * 2]!, this.ranges[target * 2 + 1]!];
  }

  static async load(source: AssetSource): Promise<TargetStore> {
    return new TargetStore(await readContainer<TargetsMeta>(source, 'targets/targets'));
  }

  get size(): number {
    return this.entries.length;
  }

  /** Add `weight * target` into `out` (xyz interleaved). */
  accumulate(target: number, weight: number, out: Float64Array | Float32Array): void {
    if (weight === 0) return;
    const t = this.entries[target]!;
    const s = t.scale * weight;
    const idx = this.indices;
    const d = this.deltas;
    const end = t.offset + t.count;
    for (let i = t.offset; i < end; i++) {
      const v = idx[i]! * 3;
      const j = i * 3;
      out[v] = out[v]! + d[j]! * s;
      out[v + 1] = out[v + 1]! + d[j + 1]! * s;
      out[v + 2] = out[v + 2]! + d[j + 2]! * s;
    }
  }

  /** Vertex indices touched by a target (a view, do not modify). */
  vertices(target: number): Uint16Array {
    const t = this.entries[target]!;
    return this.indices.subarray(t.offset, t.offset + t.count);
  }
}
