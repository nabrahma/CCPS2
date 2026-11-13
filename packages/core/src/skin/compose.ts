/**
 * Resolves a document's skin stack (PRD F6) into what a compositor needs:
 * the base texture, the region masks, and each enabled layer as pixels (procedural layers,
 * the projected photo), an image URL (user overlays) or an HSV adjustment
 * (tone tint), bottom first. Procedural layers are cached per
 * (kind, parameters), so only the layer whose settings changed is redrawn.
 */
import type { SkinLayer, SkinStack } from '../character/doc';
import type { BaseMesh } from '../mesh/basemesh';
import { computeQuadNormals } from '../mesh/normals';
import type { RigDefinition } from '../skeleton/rig';
import type { SparseWeights } from '../skeleton/weights';
import type { DetailSource, HsvAdjust } from './blend';
import { DETAIL_TILE_METRES, detailTile, faceUvPerMetre } from './detail';
import { faceFeatures, type FaceFeatures } from './features';
import type { RgbaImage } from './image';
import { BAKED_LAYER_CHANNEL, colorParam, numParam } from './layers';
import { SkinLayout, type SurfaceMap } from './layout';
import { generateLayer, isProcedural } from './procedural';

/** Composite resolution (PRD F6: "a WebGL render target at 2048 px"). */
export const SKIN_COMPOSITE_SIZE = 2048;
/** Procedural layers are generated at this size and filtered up to the composite. */
export const PROCEDURAL_SIZE = 1024;
/** Region masks resolution. */
export const MASK_SIZE = 1024;

export type ResolvedSource = { kind: 'url'; url: string } | { kind: 'pixels'; image: RgbaImage } | { kind: 'adjust'; hsv: HsvAdjust } | DetailSource;

export interface ResolvedSkinLayer {
  /** Changes whenever this layer's pixels change (texture cache key). */
  key: string;
  /** The document layer it comes from (none for the photo). */
  layerId?: string;
  label: string;
  blend: SkinLayer['blend'];
  opacity: number;
  mask: SkinLayer['mask'];
  source: ResolvedSource;
}

export interface ResolvedSkin {
  /** Changes whenever the composite must be redone. */
  signature: string;
  size: number;
  /** Base skin texture (path relative to assets/core, or a URL). */
  base: string | null;
  masks: RgbaImage;
  layers: ResolvedSkinLayer[];
}

export class SkinComposer {
  readonly layout: SkinLayout;
  readonly features: FaceFeatures;
  private neutralMap: SurfaceMap | null = null;
  private maskImage: RgbaImage | null = null;
  private readonly cache = new Map<string, RgbaImage>();

  constructor(readonly base: BaseMesh, rig: RigDefinition, weights: SparseWeights) {
    this.layout = SkinLayout.build(base, rig, weights);
    this.features = faceFeatures(base, this.layout);
  }

  /** Neutral-surface map the procedural layers are drawn from (built once). */
  get surface(): SurfaceMap {
    if (!this.neutralMap) {
      const b = this.base;
      const normals = computeQuadNormals(b.positions, b.faceVerts, b.vertexCount);
      this.neutralMap = this.layout.surfaceMap(PROCEDURAL_SIZE, b.positions, normals);
    }
    return this.neutralMap;
  }

  get masks(): RgbaImage {
    this.maskImage ??= this.layout.regionMasks(MASK_SIZE);
    return this.maskImage;
  }

  /** One channel of a baked map as a grey layer, with a contrast curve (cached by key). */
  bakedChannel(image: RgbaImage, channel: number, contrast: number, key: string): RgbaImage {
    let img = this.cache.get(key);
    if (!img) {
      img = bakedChannelImage(image, channel, contrast);
      this.cache.set(key, img);
      while (this.cache.size > 24) this.cache.delete(this.cache.keys().next().value!);
    }
    return img;
  }

  private mouthIslandId: number | null = null;
  private uvPerMetre: number | null = null;

  /** The mouth interior's UV island: the small head island on the midline (the other two are the eye sockets). */
  get mouthIsland(): number {
    if (this.mouthIslandId === null) {
      const small = this.layout.islands.filter((i) => i.kind === 'head').sort((a, b) => b.faces.length - a.faces.length).slice(1);
      const pos = this.base.positions;
      const meanAbsX = (faces: number[]) => {
        let sx = 0;
        for (const f of faces) for (let k = 0; k < 4; k++) sx += pos[this.base.faceVerts[f * 4 + k]! * 3]!;
        return Math.abs(sx / (faces.length * 4));
      };
      this.mouthIslandId = small.reduce((a, b) => (meanAbsX(a.faces) < meanAbsX(b.faces) ? a : b)).id;
    }
    return this.mouthIslandId;
  }

  /** Pixels of a procedural layer (cached by kind and parameters). */
  layerImage(layer: SkinLayer): RgbaImage {
    const key = proceduralKey(layer);
    let img = this.cache.get(key);
    if (!img) {
      img = generateLayer(layer, {
        map: this.surface,
        features: this.features,
        islandKinds: this.layout.islands.map((i) => i.kind),
        faceIsland: this.layout.islands.filter((i) => i.kind === 'head').sort((a, b) => b.faces.length - a.faces.length)[0]!.id,
        mouthIsland: this.mouthIsland,
      });
      this.cache.set(key, img);
      // Keep the cache small: drop the oldest entries.
      while (this.cache.size > 24) this.cache.delete(this.cache.keys().next().value!);
    }
    return img;
  }

  /**
   * Resolve a skin stack. `texture(ref)` maps an asset id or library id to a
   * URL/path (null when unknown, and then the layer is skipped); `photo` is
   * the projected face layer, if any, with a key that changes with its pixels.
   */
  resolve(
    skin: SkinStack,
    texture: (ref: string) => string | null,
    photo: { image: RgbaImage; key: string } | null,
    baked: { image: RgbaImage; key: string } | null = null,
    scalp: { image: RgbaImage; key: string } | null = null,
  ): ResolvedSkin {
    const layers: ResolvedSkinLayer[] = [];
    if (photo && skin.photo && skin.photo.strength > 0) {
      layers.push({ key: `photo:${photo.key}`, label: 'Photo', blend: 'normal', opacity: skin.photo.strength, mask: 'none', source: { kind: 'pixels', image: photo.image } });
    }
    for (const l of skin.layers) {
      if (!l.enabled || l.opacity <= 0) continue;
      let source: ResolvedSource;
      let key: string;
      if (l.kind === 'tone') {
        const hsv = { hue: numParam(l, 'hue'), saturation: numParam(l, 'saturation'), value: numParam(l, 'value') };
        source = { kind: 'adjust', hsv };
        key = `tone:${hsv.hue},${hsv.saturation},${hsv.value}`;
      } else if (l.kind === 'image') {
        const url = l.image ? texture(l.image) : null;
        if (!url) continue;
        source = { kind: 'url', url };
        key = `url:${url}`;
      } else if (l.kind === 'pores' || l.kind === 'stubbleHair') {
        // Micro-detail: the tile at full resolution, through the region map.
        this.uvPerMetre ??= faceUvPerMetre(this.layout);
        const tile = detailTile(l.kind, l.kind === 'stubbleHair' ? colorParam(l, 'color') : undefined);
        const repeat = 1 / (this.uvPerMetre * DETAIL_TILE_METRES[l.kind] * numParam(l, 'scale'));
        source = { kind: 'detail', tile, weight: this.layerImage(l), repeat };
        key = `detail:${proceduralKey(l)}`;
      } else if (isProcedural(l.kind)) {
        source = { kind: 'pixels', image: this.layerImage(l) };
        key = proceduralKey(l);
      } else if (l.kind === 'scalpHair') {
        // Drawn from the hairstyle by the scene (hair/scalp-layer.ts); skipped without card hair.
        if (!scalp) continue;
        key = `scalp:${scalp.key}`;
        source = { kind: 'pixels', image: scalp.image };
      } else if (BAKED_LAYER_CHANNEL[l.kind] !== undefined) {
        // Baked maps arrive from the bake engine; until then the layer is skipped.
        if (!baked) continue;
        const contrast = numParam(l, 'contrast');
        key = `bake:${baked.key}:${l.kind}:${contrast}`;
        source = { kind: 'pixels', image: this.bakedChannel(baked.image, BAKED_LAYER_CHANNEL[l.kind]!, contrast, key) };
      } else continue;
      layers.push({ key, layerId: l.id, label: l.kind, blend: l.blend, opacity: l.opacity, mask: l.mask, source });
    }
    const base = texture(skin.base);
    const signature = JSON.stringify([base, layers.map((l) => [l.key, l.blend, l.opacity, l.mask])]);
    return { signature, size: SKIN_COMPOSITE_SIZE, base, masks: this.masks, layers };
  }
}

function bakedChannelImage(src: RgbaImage, channel: number, contrast: number): RgbaImage {
  const data = new Uint8ClampedArray(src.data.length);
  for (let i = 0; i < src.data.length; i += 4) {
    const v = Math.round(255 * Math.pow(src.data[i + channel]! / 255, contrast));
    data[i] = data[i + 1] = data[i + 2] = v;
    data[i + 3] = 255;
  }
  return { width: src.width, height: src.height, data };
}

function proceduralKey(layer: SkinLayer): string {
  const params = Object.keys(layer.params)
    .sort()
    .map((k) => `${k}=${layer.params[k]}`)
    .join(',');
  return `${layer.kind}:${params}`;
}
