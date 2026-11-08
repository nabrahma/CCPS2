/**
 * Skin weights. Sparse per-bone lists from the asset compiler are turned into
 * a per-vertex top-N table, normalised (PRD 6.2: max 4 influences).
 */
import type { Container, ContainerMeta } from '../io/container';
import { readContainer, type AssetSource } from '../io/source';
import type { RigDefinition } from './rig';

export const MAX_INFLUENCES = 4;

export interface WeightsMeta extends ContainerMeta {
  format: 'ps2cc.weights/1';
  rig: string;
  bones: { bone: string; offset: number; count: number }[];
}

/** Per-vertex influence table: MAX_INFLUENCES bone indices and weights per vertex. */
export interface InfluenceTable {
  vertexCount: number;
  joints: Uint16Array;
  weights: Float32Array;
}

/** Full (untruncated) sparse weights per vertex: list of [bone, weight]. */
export type SparseWeights = [number, number][][];

export class RigWeights {
  readonly sparse: SparseWeights;

  constructor(container: Container<WeightsMeta>, rig: RigDefinition, vertexCount: number) {
    const verts = container.get('vertex', 'u32');
    const vals = container.get('weight', 'f32');
    const sparse: SparseWeights = Array.from({ length: vertexCount }, () => []);
    for (const entry of container.meta.bones) {
      const bone = rig.index.get(entry.bone);
      if (bone === undefined) throw new Error(`weights reference unknown bone ${entry.bone}`);
      for (let k = entry.offset; k < entry.offset + entry.count; k++) {
        const v = verts[k]!;
        if (v >= vertexCount) throw new Error(`weights reference vertex ${v} outside the mesh`);
        sparse[v]!.push([bone, vals[k]!]);
      }
    }
    this.sparse = sparse;
  }

  static async load(source: AssetSource, rig: RigDefinition, vertexCount: number): Promise<RigWeights> {
    return new RigWeights(await readContainer<WeightsMeta>(source, `rigs/${rig.name}.weights`), rig, vertexCount);
  }
}

/**
 * Keep the strongest `max` influences and normalise them to sum 1.
 * Vertices with no influences are bound fully to `fallbackBone`.
 */
export function buildInfluences(sparse: SparseWeights, max = MAX_INFLUENCES, fallbackBone = 0): InfluenceTable {
  const n = sparse.length;
  const joints = new Uint16Array(n * max);
  const weights = new Float32Array(n * max);
  for (let v = 0; v < n; v++) {
    const list = sparse[v]!.filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    const top = list.slice(0, max);
    let sum = 0;
    for (const [, w] of top) sum += w;
    if (top.length === 0 || sum <= 0) {
      joints[v * max] = fallbackBone;
      weights[v * max] = 1;
      continue;
    }
    top.forEach(([b, w], k) => {
      joints[v * max + k] = b;
      weights[v * max + k] = w / sum;
    });
  }
  return { vertexCount: n, joints, weights };
}

/** Pick a subset of vertices from an influence table (e.g. the PS2 body). */
export function selectInfluences(table: InfluenceTable, map: ArrayLike<number>, max = MAX_INFLUENCES): InfluenceTable {
  const n = map.length;
  const joints = new Uint16Array(n * max);
  const weights = new Float32Array(n * max);
  for (let i = 0; i < n; i++) {
    const v = map[i]!;
    joints.set(table.joints.subarray(v * max, v * max + max), i * max);
    weights.set(table.weights.subarray(v * max, v * max + max), i * max);
  }
  return { vertexCount: n, joints, weights };
}
