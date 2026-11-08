import type { Container, ContainerMeta } from '../io/container';
import { readContainer, type AssetSource } from '../io/source';

export interface FaceGroup {
  name: string;
  start: number;
  count: number;
}

export interface BaseMeshMeta extends ContainerMeta {
  format: 'ps2cc.basemesh/1';
  vertexCount: number;
  uvCount: number;
  faceCount: number;
  bodyVertexCount: number;
  groupNames: string[];
  faceGroups: FaceGroup[];
  /** Inclusive vertex index ranges per vertex group (from MPFB's hm08 metadata). */
  vertexGroups: Record<string, [number, number][]>;
}

/** The hm08 base mesh in metres, Y up, facing +Z. Immutable. */
export class BaseMesh {
  readonly vertexCount: number;
  readonly bodyVertexCount: number;
  readonly faceCount: number;
  /** Rest positions, xyz interleaved (metres). */
  readonly positions: Float32Array;
  readonly uvs: Float32Array;
  /** Quad vertex indices, 4 per face. */
  readonly faceVerts: Uint32Array;
  /** Quad UV indices, 4 per face. */
  readonly faceUvs: Uint32Array;
  readonly faceGroup: Uint16Array;
  readonly meta: BaseMeshMeta;

  constructor(container: Container<BaseMeshMeta>) {
    const m = container.meta;
    this.meta = m;
    this.vertexCount = m.vertexCount;
    this.bodyVertexCount = m.bodyVertexCount;
    this.faceCount = m.faceCount;
    this.positions = container.get('positions', 'f32');
    this.uvs = container.get('uvs', 'f32');
    this.faceVerts = container.get('faceVerts', 'u32');
    this.faceUvs = container.get('faceUvs', 'u32');
    this.faceGroup = container.get('faceGroup', 'u16');
    if (this.positions.length !== this.vertexCount * 3) throw new Error('basemesh: position count mismatch');
    if (this.faceVerts.length !== this.faceCount * 4) throw new Error('basemesh: face count mismatch');
  }

  static async load(source: AssetSource): Promise<BaseMesh> {
    return new BaseMesh(await readContainer<BaseMeshMeta>(source, 'basemesh/hm08'));
  }

  /** All vertex indices of a vertex group, in ascending order. */
  vertexGroup(name: string): number[] {
    const ranges = this.meta.vertexGroups[name];
    if (!ranges) throw new Error(`basemesh: unknown vertex group "${name}"`);
    const out: number[] = [];
    for (const [a, b] of ranges) for (let i = a; i <= b; i++) out.push(i);
    return out;
  }

  /** Indices of faces whose group name matches the predicate. */
  facesWhere(pred: (groupName: string) => boolean): number[] {
    const out: number[] = [];
    for (const g of this.meta.faceGroups) {
      if (pred(g.name)) for (let f = g.start; f < g.start + g.count; f++) out.push(f);
    }
    return out;
  }
}
