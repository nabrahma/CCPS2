/**
 * The 52 ARKit face units (PRD Part 3, F25): Mika Suominen's faceunits01
 * targets on hm08 (CC0), named like Apple's ARKit blendshapes, which Unity's
 * lip-sync and facial-capture tools expect. Built by the asset compiler's
 * `faceunits` stage into `expressions/faceunits.{json,bin}`.
 *
 * A face unit is an additive target, like a modifier's: the same deltas on
 * every body. They also move the helper geometry (eyes, lashes, teeth and
 * tongue), so every part bound to the base mesh follows through its binding.
 */
import type { Container, ContainerMeta } from '../io/container';
import { readContainer, type AssetSource } from '../io/source';

export const ARKIT_UNITS = [
  'browDownLeft',
  'browDownRight',
  'browInnerUp',
  'browOuterUpLeft',
  'browOuterUpRight',
  'cheekPuff',
  'cheekSquintLeft',
  'cheekSquintRight',
  'eyeBlinkLeft',
  'eyeBlinkRight',
  'eyeLookDownLeft',
  'eyeLookDownRight',
  'eyeLookInLeft',
  'eyeLookInRight',
  'eyeLookOutLeft',
  'eyeLookOutRight',
  'eyeLookUpLeft',
  'eyeLookUpRight',
  'eyeSquintLeft',
  'eyeSquintRight',
  'eyeWideLeft',
  'eyeWideRight',
  'jawForward',
  'jawLeft',
  'jawOpen',
  'jawRight',
  'mouthClose',
  'mouthDimpleLeft',
  'mouthDimpleRight',
  'mouthFrownLeft',
  'mouthFrownRight',
  'mouthFunnel',
  'mouthLeft',
  'mouthLowerDownLeft',
  'mouthLowerDownRight',
  'mouthPressLeft',
  'mouthPressRight',
  'mouthPucker',
  'mouthRight',
  'mouthRollLower',
  'mouthRollUpper',
  'mouthShrugLower',
  'mouthShrugUpper',
  'mouthSmileLeft',
  'mouthSmileRight',
  'mouthStretchLeft',
  'mouthStretchRight',
  'mouthUpperUpLeft',
  'mouthUpperUpRight',
  'noseSneerLeft',
  'noseSneerRight',
  'tongueOut',
] as const;
export type ArkitUnit = (typeof ARKIT_UNITS)[number];

export function isArkitUnit(name: string): name is ArkitUnit {
  return (ARKIT_UNITS as readonly string[]).includes(name);
}

/**
 * The other side's unit: Left and Right swap. In ARKit (and here) Left is the
 * character's own left, +x. jawLeft/jawRight and mouthLeft/mouthRight pair
 * the same way.
 */
export function mirrorUnit(name: ArkitUnit): ArkitUnit {
  if (name.endsWith('Left')) return `${name.slice(0, -4)}Right` as ArkitUnit;
  if (name.endsWith('Right')) return `${name.slice(0, -5)}Left` as ArkitUnit;
  return name;
}

export interface FaceUnitEntry {
  name: ArkitUnit;
  offset: number;
  count: number;
  /** delta (m) = int16 * scale. */
  scale: number;
}

export interface FaceUnitsMeta extends ContainerMeta {
  format: 'ps2cc.faceunits/1';
  faceUnits: FaceUnitEntry[];
}

export class FaceUnitStore {
  readonly entries: ReadonlyMap<ArkitUnit, FaceUnitEntry>;
  private readonly indices: Uint16Array;
  private readonly deltas: Int16Array;

  constructor(container: Container<FaceUnitsMeta>) {
    if (container.meta.format !== 'ps2cc.faceunits/1') throw new Error(`faceunits: unknown format ${String(container.meta.format)}`);
    this.entries = new Map(container.meta.faceUnits.map((u) => [u.name, u]));
    for (const name of ARKIT_UNITS) if (!this.entries.has(name)) throw new Error(`faceunits: ${name} is missing`);
    this.indices = container.get('indices', 'u16');
    this.deltas = container.get('deltas', 'i16');
  }

  static async load(source: AssetSource): Promise<FaceUnitStore> {
    return new FaceUnitStore(await readContainer<FaceUnitsMeta>(source, 'expressions/faceunits'));
  }

  /** Vertex indices a unit moves (a view). */
  vertices(name: ArkitUnit): Uint16Array {
    const e = this.entries.get(name)!;
    return this.indices.subarray(e.offset, e.offset + e.count);
  }

  /** Add weight x unit into `out` (xyz per hm08 vertex, metres). */
  accumulate(name: ArkitUnit, weight: number, out: Float32Array | Float64Array): void {
    if (weight === 0) return;
    const e = this.entries.get(name)!;
    const s = e.scale * weight;
    const idx = this.indices;
    const d = this.deltas;
    for (let i = e.offset; i < e.offset + e.count; i++) {
      const v = idx[i]! * 3;
      const j = i * 3;
      out[v] = out[v]! + d[j]! * s;
      out[v + 1] = out[v + 1]! + d[j + 1]! * s;
      out[v + 2] = out[v + 2]! + d[j + 2]! * s;
    }
  }

  /** A blend of units as one dense delta (xyz per hm08 vertex). */
  blend(units: readonly (readonly [string, number])[], vertexCount: number, out = new Float32Array(vertexCount * 3)): Float32Array {
    out.fill(0);
    for (const [name, w] of units) {
      if (!isArkitUnit(name)) throw new Error(`faceunits: unknown unit ${name}`);
      this.accumulate(name, w, out);
    }
    return out;
  }
}
