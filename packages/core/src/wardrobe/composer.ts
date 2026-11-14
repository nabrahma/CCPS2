/**
 * Composes worn garments' textures from their looks (Part 2 F18), caching
 * what does not change between edits: each garment's surface on the
 * reference body (islands, seams, raster, looseness) per texture size, and
 * the materials' mip chains.
 */
import type { CoreAssets } from '../assets';
import { CharacterEngine } from '../character/engine';
import { defaultCharacter } from '../character/doc';
import { BodySurface } from '../proxy/collision';
import { buildRenderTopology } from '../scene/render-mesh';
import type { RgbaImage } from '../skin/image';
import { composeGarment, prepareGarment, type GarmentCanvas, type MaterialSource } from './compose';
import { foldFrames, type FoldFrame } from './folds';
import type { GarmentLook } from './look';
import { tileMips } from './material';
import { surfaceFromTopology, type GarmentSurface } from './surface';

export type ImageLoader = (path: string) => Promise<RgbaImage>;

interface Reference {
  positions: Float32Array;
  body: BodySurface;
  frames: FoldFrame[];
}

export class GarmentLookComposer {
  private reference: Reference | null = null;
  private canvases = new Map<string, Promise<GarmentCanvas>>();
  private surfaces = new Map<string, Promise<{ surface: GarmentSurface; gap: Float32Array }>>();
  private mats = new Map<string, Promise<MaterialSource | null>>();

  constructor(private readonly assets: CoreAssets) {}

  /** The default character's body, its joints' fold sites, and a surface to measure looseness against. */
  private ref(): Reference {
    if (this.reference) return this.reference;
    const engine = new CharacterEngine(this.assets, defaultCharacter());
    const sk = engine.skeleton;
    const joint = (name: string): [number, number, number] => {
      const i = sk.rig.index.get(name);
      return i === undefined ? [0, -10, 0] : [sk.heads[i * 3]!, sk.heads[i * 3 + 1]!, sk.heads[i * 3 + 2]!];
    };
    const base = this.assets.base;
    const faces = base.facesWhere((g) => g === 'body');
    const tris: number[] = [];
    for (const f of faces) {
      const q = base.faceVerts.subarray(f * 4, f * 4 + 4);
      tris.push(q[0]!, q[1]!, q[2]!);
      if (q[3] !== q[2]) tris.push(q[0]!, q[2]!, q[3]!);
    }
    const positions = engine.positions.slice();
    const normals = new Float32Array(positions.length);
    for (let t = 0; t < tris.length; t += 3) {
      const [a, b, c] = [tris[t]! * 3, tris[t + 1]! * 3, tris[t + 2]! * 3];
      const e1 = [positions[b]! - positions[a]!, positions[b + 1]! - positions[a + 1]!, positions[b + 2]! - positions[a + 2]!];
      const e2 = [positions[c]! - positions[a]!, positions[c + 1]! - positions[a + 1]!, positions[c + 2]! - positions[a + 2]!];
      const n = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
      for (const v of [a, b, c]) for (let k = 0; k < 3; k++) normals[v + k]! += n[k]!;
    }
    for (let i = 0; i < normals.length; i += 3) {
      const l = Math.hypot(normals[i]!, normals[i + 1]!, normals[i + 2]!) || 1;
      for (let k = 0; k < 3; k++) normals[i + k]! /= l;
    }
    this.reference = { positions, body: new BodySurface(positions, normals, Uint32Array.from(tris)), frames: foldFrames({ joint }) };
    return this.reference;
  }

  /** A garment's surface on the reference body and its distance from the skin per vertex. */
  surface(assetId: string): Promise<{ surface: GarmentSurface; gap: Float32Array }> {
    let p = this.surfaces.get(assetId);
    if (!p) {
      p = this.assets.proxy(assetId).then((proxy) => {
        const ref = this.ref();
        const topo = buildRenderTopology(proxy.faceVerts, proxy.faceUvs, proxy.uvs);
        const pos = proxy.fit(ref.positions);
        const gap = new Float32Array(pos.length / 3);
        const q = [0, 0, 0];
        for (let v = 0; v < gap.length; v++) {
          q[0] = pos[v * 3]!;
          q[1] = pos[v * 3 + 1]!;
          q[2] = pos[v * 3 + 2]!;
          const hit = ref.body.closest(q, 0.1);
          gap[v] = hit ? Math.max(0, ref.body.signedDistance(q, hit)) : 0.1;
        }
        return { surface: surfaceFromTopology(topo, pos), gap };
      });
      p.catch(() => this.surfaces.delete(assetId));
      this.surfaces.set(assetId, p);
    }
    return p;
  }

  canvas(assetId: string, size: number): Promise<GarmentCanvas> {
    const key = `${assetId}|${size}`;
    let p = this.canvases.get(key);
    if (!p) {
      p = this.surface(assetId).then(({ surface, gap }) => prepareGarment(surface, size, this.ref().frames, gap));
      p.catch(() => this.canvases.delete(key));
      this.canvases.set(key, p);
      // A few sizes of a few garments at most.
      while (this.canvases.size > 12) this.canvases.delete(this.canvases.keys().next().value!);
    }
    return p;
  }

  private material(id: string, load: ImageLoader): Promise<MaterialSource | null> {
    let p = this.mats.get(id);
    if (!p) {
      const info = this.assets.catalog.materials?.find((m) => m.id === id);
      p = info ? load(info.diffuse).then((img) => ({ info, mips: tileMips(img) })) : Promise.resolve(null);
      p.catch(() => this.mats.delete(id));
      this.mats.set(id, p);
    }
    return p;
  }

  /** Drop a material's cached tile (a user material saved again under the same id). */
  forgetMaterial(id: string): void {
    this.mats.delete(id);
  }

  /** The garment's texture at `size`, dressed by `look` over its own texture `base` (a path or library URL). */
  async compose(assetId: string, look: GarmentLook, base: string | null, size: number, load: ImageLoader): Promise<RgbaImage> {
    const ids = [...new Set(look.zones.map((z) => z.material).filter((m): m is string => !!m))];
    const [canvas, baseImg, ...mats] = await Promise.all([this.canvas(assetId, size), base ? load(base) : Promise.resolve(null), ...ids.map((id) => this.material(id, load))]);
    const byId = new Map(ids.map((id, i) => [id, mats[i] ?? null]));
    return composeGarment(canvas, look, { base: baseImg, material: (id) => byId.get(id) ?? null });
  }
}
