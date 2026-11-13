/**
 * MHCLO proxy assets (eyes, brows, lashes, teeth, hair meshes, garments).
 *
 * Fitting is a port of MakeHuman `shared/proxy.py`:
 *   position = w1*r1 + w2*r2 + w3*r3 + S * offset
 * with S = diag(|a[n]-b[n]| / den[n]) from the x/y/z scale reference pairs
 * (`TMatrix.getMatrix`), or identity when the asset has none.
 * Skin weights transfer through the same three reference vertices
 * (`Proxy.getVertexWeights`, threshold 1e-4).
 */
import type { Container, ContainerMeta } from '../io/container';
import { readContainer, type AssetSource } from '../io/source';
import type { SparseWeights } from '../skeleton/weights';
import type { FurTrim } from '../hair/surface-cards';
import type { GarmentLook } from '../wardrobe/look';

/** How a library garment is dressed when it is put on (Part 2 F18): its look, fur trim and tint. */
export interface GarmentDefaults {
  look?: GarmentLook;
  fur?: FurTrim;
  tint?: [number, number, number];
}

export interface ProxyMaterial {
  diffuseColor: [number, number, number];
  transparent: boolean;
  backfaceCull: boolean;
  opacity: number;
  diffuseTexture?: string;
  textureSize?: [number, number];
}

export interface ProxyMeta extends ContainerMeta {
  format: 'ps2cc.proxy/1';
  id: string;
  category: 'eyes' | 'eyebrows' | 'eyelashes' | 'teeth' | 'tongue' | 'hair' | 'clothes';
  name: string;
  uuid: string;
  tags: string[];
  zDepth: number;
  vertexCount: number;
  faceCount: number;
  /** [v1, v2, denominator_m] per axis, or null. */
  scale: [number, number, number][] | null;
  material: ProxyMaterial | null;
  slot?: string;
  /** Present on build-time decimated garments: original vertex count. */
  decimatedFrom?: number;
  originalTriangles?: number;
  /** Where hidden body faces come from: MakeHuman delete_verts, or computed at build time. */
  hiddenFaces?: 'makehuman' | 'computed' | 'none';
  /** Garments made in Garment Studio: how they are dressed when put on. */
  defaults?: GarmentDefaults;
}

const WEIGHT_THRESHOLD = 1e-4;

export class ProxyAsset {
  readonly meta: ProxyMeta;
  readonly vertexCount: number;
  readonly uvs: Float32Array;
  readonly faceVerts: Uint32Array;
  readonly faceUvs: Uint32Array;
  readonly refVerts: Uint32Array;
  readonly refWeights: Float32Array;
  readonly refOffsets: Float32Array;
  /** Base-mesh vertices this garment hides (MHCLO delete_verts): a face goes if ANY vertex is listed. */
  readonly deleteVerts: Uint32Array;
  /** Base-mesh vertices computed as covered (build time): a face goes if ALL its vertices are listed. */
  readonly coveredVerts: Uint32Array;
  readonly restPositions: Float32Array;
  /** Imported garments: skin weights stored per vertex on the GameEngine rig (CSR), instead of derived from the binding. */
  private readonly skinOffsets: Uint32Array;
  private readonly skinBones: Uint16Array;
  private readonly skinValues: Float32Array;

  constructor(container: Container<ProxyMeta>) {
    this.meta = container.meta;
    this.vertexCount = container.meta.vertexCount;
    this.uvs = container.get('uvs', 'f32');
    this.faceVerts = container.get('faceVerts', 'u32');
    this.faceUvs = container.get('faceUvs', 'u32');
    this.refVerts = container.get('refVerts', 'u32');
    this.refWeights = container.get('refWeights', 'f32');
    this.refOffsets = container.get('refOffsets', 'f32');
    this.deleteVerts = container.optional('deleteVerts', 'u32');
    this.coveredVerts = container.optional('coveredVerts', 'u32');
    this.restPositions = container.get('restPositions', 'f32');
    this.skinOffsets = container.optional('skinOffsets', 'u32');
    this.skinBones = container.optional('skinBones', 'u16');
    this.skinValues = container.optional('skinValues', 'f32');
    if (this.refVerts.length !== this.vertexCount * 3) throw new Error(`${this.meta.id}: binding size mismatch`);
  }

  static async load(source: AssetSource, file: string): Promise<ProxyAsset> {
    return new ProxyAsset(await readContainer<ProxyMeta>(source, file.replace(/\.json$/, '')));
  }

  get id(): string {
    return this.meta.id;
  }

  /** Port of TMatrix.getMatrix for scale data: per-axis scale factors. */
  scaleFactors(base: ArrayLike<number>): [number, number, number] {
    const s = this.meta.scale;
    if (!s) return [1, 1, 1];
    const out: [number, number, number] = [1, 1, 1];
    for (let n = 0; n < 3; n++) {
      const [v1, v2, den] = s[n]!;
      out[n] = Math.abs(base[v1 * 3 + n]! - base[v2 * 3 + n]!) / den;
    }
    return out;
  }

  /** Fitted positions for the given base-mesh positions (port of Proxy.getCoords). */
  fit(base: ArrayLike<number>, out: Float32Array = new Float32Array(this.vertexCount * 3)): Float32Array {
    const [sx, sy, sz] = this.scaleFactors(base);
    const r = this.refVerts;
    const w = this.refWeights;
    const o = this.refOffsets;
    for (let i = 0; i < this.vertexCount; i++) {
      const a = r[i * 3]! * 3;
      const b = r[i * 3 + 1]! * 3;
      const c = r[i * 3 + 2]! * 3;
      const wa = w[i * 3]!;
      const wb = w[i * 3 + 1]!;
      const wc = w[i * 3 + 2]!;
      out[i * 3] = base[a]! * wa + base[b]! * wb + base[c]! * wc + sx * o[i * 3]!;
      out[i * 3 + 1] = base[a + 1]! * wa + base[b + 1]! * wb + base[c + 1]! * wc + sy * o[i * 3 + 1]!;
      out[i * 3 + 2] = base[a + 2]! * wa + base[b + 2]! * wb + base[c + 2]! * wc + sz * o[i * 3 + 2]!;
    }
    return out;
  }

  /** Transfer base-mesh bone weights to proxy vertices (port of Proxy.getVertexWeights). */
  transferWeights(base: SparseWeights): SparseWeights {
    if (this.skinOffsets.length) {
      return Array.from({ length: this.vertexCount }, (_, v) => {
        const entry: [number, number][] = [];
        for (let i = this.skinOffsets[v]!; i < this.skinOffsets[v + 1]!; i++) entry.push([this.skinBones[i]!, this.skinValues[i]!]);
        return entry;
      });
    }
    const out: SparseWeights = Array.from({ length: this.vertexCount }, () => []);
    for (let i = 0; i < this.vertexCount; i++) {
      const acc = new Map<number, number>();
      for (let k = 0; k < 3; k++) {
        const wk = this.refWeights[i * 3 + k]!;
        if (wk === 0) continue;
        for (const [bone, bw] of base[this.refVerts[i * 3 + k]!] ?? []) {
          const pw = wk * bw;
          if (pw > WEIGHT_THRESHOLD) acc.set(bone, (acc.get(bone) ?? 0) + pw);
        }
      }
      out[i] = [...acc.entries()];
    }
    return out;
  }

  /** Triangle indices (quads split along the 0-2 diagonal; MakeHuman triangles have v3 == v2). */
  triangles(): Uint32Array {
    const tris: number[] = [];
    const f = this.faceVerts;
    for (let q = 0; q < f.length / 4; q++) {
      const a = f[q * 4]!;
      const b = f[q * 4 + 1]!;
      const c = f[q * 4 + 2]!;
      const d = f[q * 4 + 3]!;
      tris.push(a, b, c);
      if (d !== c) tris.push(a, c, d);
    }
    return Uint32Array.from(tris);
  }
}
