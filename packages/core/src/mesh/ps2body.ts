/**
 * PS2 body topology (PRD F2): a triangle mesh whose vertices are a subset of
 * hm08 body vertices. Built at compile time by tools/asset-tools; at runtime
 * it is a pure index remap, so morphs, weights and the hm08 UV layout carry
 * over for free.
 */
import type { Container, ContainerMeta } from '../io/container';
import { readContainer, type AssetSource } from '../io/source';

export interface BodyMeshInfo {
  id: 'ps2_body_8k' | 'ps2_body_10k' | 'ps2_body_12k';
  triangles: number;
  vertices: number;
  file: string;
}

export interface Ps2BodyMeta extends ContainerMeta {
  format: 'ps2cc.ps2body/1';
  id: string;
  targetTriangles: number;
  triangleCount: number;
  vertexCount: number;
  /** Region names per region id in `vertexRegion`. */
  regions: string[];
  /** Fraction of original face-region vertices kept. */
  faceRetention: number;
  seed: string;
}

/**
 * One render vertex per (hm08 vertex, UV) pair: hm08 UV seams split vertices.
 * `sourceVertex[i]` is the hm08 vertex for render vertex i.
 */
export class Ps2BodyMesh {
  readonly meta: Ps2BodyMeta;
  readonly sourceVertex: Uint32Array;
  readonly uvs: Float32Array;
  readonly indices: Uint32Array;
  readonly vertexRegion: Uint8Array;

  constructor(c: Container<Ps2BodyMeta>) {
    this.meta = c.meta;
    this.sourceVertex = c.get('sourceVertex', 'u32');
    this.uvs = c.get('uvs', 'f32');
    this.indices = c.get('indices', 'u32');
    this.vertexRegion = c.get('vertexRegion', 'u8');
  }

  static async load(source: AssetSource, id: string): Promise<Ps2BodyMesh> {
    return new Ps2BodyMesh(await readContainer<Ps2BodyMeta>(source, `bodymesh/${id}`));
  }

  get vertexCount(): number {
    return this.sourceVertex.length;
  }

  get triangleCount(): number {
    return this.indices.length / 3;
  }

  /** Gather render positions from morphed hm08 positions. */
  gather(hm08Positions: ArrayLike<number>, out: Float32Array = new Float32Array(this.vertexCount * 3)): Float32Array {
    const src = this.sourceVertex;
    for (let i = 0; i < src.length; i++) {
      const v = src[i]! * 3;
      out[i * 3] = hm08Positions[v]!;
      out[i * 3 + 1] = hm08Positions[v + 1]!;
      out[i * 3 + 2] = hm08Positions[v + 2]!;
    }
    return out;
  }
}
