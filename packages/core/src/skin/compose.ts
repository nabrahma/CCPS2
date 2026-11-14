/**
 * Resolves a document's skin stack (PRD F6) into what a compositor needs:
 * the base texture, the region masks, and each enabled layer as pixels (procedural layers,
 * the projected photo), an image URL (user overlays) or an HSV adjustment
 * (tone tint), bottom first. Procedural layers are cached per
 * (kind, parameters), so only the layer whose settings changed is redrawn.
 */
import type { SkinLayer, SkinStack } from '../character/doc';
import type { BaseMesh } from '../mesh/basemesh';
import { hashSeed } from '../random';
import { computeQuadNormals } from '../mesh/normals';
import type { RigDefinition } from '../skeleton/rig';
import type { SparseWeights } from '../skeleton/weights';
import type { DetailSource, HsvAdjust } from './blend';
import { DETAIL_TILE_METRES, detailTile, faceUvPerMetre } from './detail';
import { faceFeatures, type FaceFeatures } from './features';
import type { RgbaImage } from './image';
import { BAKED_LAYER_CHANNEL, colorParam, numParam } from './layers';
import { SkinLayout, type SurfaceMap, type TexelWindow } from './layout';
import { generateLayer, isProcedural } from './procedural';

/** Composite resolution (PRD F6: "a WebGL render target at 2048 px"). */
export const SKIN_COMPOSITE_SIZE = 2048;
/** Procedural layers are generated at this size and filtered up to the composite. */
export const PROCEDURAL_SIZE = 1024;
/** Region masks resolution. */
export const MASK_SIZE = 1024;
/**
 * Painted eyebrows and eyelashes are drawn at the composite's own size, in a window around
 * the eyes only: at 1024 px a brow is about 30 x 5 texels, too few for hair strokes.
 */
const EYE_DETAIL_KINDS: ReadonlySet<SkinLayer['kind']> = new Set(['brows', 'lashes']);

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
  private eyeMap: SurfaceMap | null = null;
  /** The full-size brow and lash images, few (16 MB each). */
  private readonly eyeCache = new Map<string, RgbaImage>();
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

  /** The neutral surface around the eyes and brows at the composite's size (painted brows and lashes). */
  get eyeSurface(): SurfaceMap {
    if (!this.eyeMap) {
      const b = this.base;
      const normals = computeQuadNormals(b.positions, b.faceVerts, b.vertexCount);
      const face = this.faceIslandId;
      this.eyeMap = this.layout.surfaceMap(SKIN_COMPOSITE_SIZE, b.positions, normals, (i) => i.id === face, this.eyeWindow(SKIN_COMPOSITE_SIZE));
    }
    return this.eyeMap;
  }

  /** Texels of the face island around both eyes and brows, with a margin. */
  private eyeWindow(size: number): TexelWindow {
    const f = this.features;
    const pos = this.base.positions;
    const uv = this.base.uvs;
    const [l, r] = f.eyes;
    const hw = Math.max(l.halfWidth, r.halfWidth);
    const xMax = Math.max(Math.abs(l.centre[0]), Math.abs(r.centre[0])) + 3.6 * hw;
    const yLo = Math.min(l.centre[1], r.centre[1]) - 1.8 * hw;
    const yHi = Math.max(l.centre[1], r.centre[1]) + 3.6 * hw;
    const zLo = Math.min(l.centre[2], r.centre[2]) - 4 * hw;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const face = this.faceIslandId;
    for (const t of this.layout.trianglesOf((i) => i.id === face)) {
      const inside = t.verts.some((v) => Math.abs(pos[v * 3]!) <= xMax && pos[v * 3 + 1]! >= yLo && pos[v * 3 + 1]! <= yHi && pos[v * 3 + 2]! >= zLo);
      if (!inside) continue;
      for (const i of t.uvs) {
        const x = uv[i * 2]! * size;
        const y = (1 - uv[i * 2 + 1]!) * size;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    }
    const pad = 8;
    const ax = Math.max(0, Math.floor(x0) - pad);
    const ay = Math.max(0, Math.floor(y0) - pad);
    return { x0: ax, y0: ay, width: Math.min(size, Math.ceil(x1) + pad) - ax, height: Math.min(size, Math.ceil(y1) + pad) - ay };
  }

  private get faceIslandId(): number {
    return this.layout.islands.filter((i) => i.kind === 'head').sort((a, b) => b.faces.length - a.faces.length)[0]!.id;
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
    if (EYE_DETAIL_KINDS.has(layer.kind)) {
      let img = this.eyeCache.get(key);
      if (!img) {
        img = generateLayer(layer, {
          map: this.eyeSurface,
          features: this.features,
          islandKinds: this.layout.islands.map((i) => i.kind),
          faceIsland: this.faceIslandId,
          mouthIsland: this.mouthIsland,
        });
        this.eyeCache.set(key, img);
        while (this.eyeCache.size > 4) this.eyeCache.delete(this.eyeCache.keys().next().value!);
      }
      return img;
    }
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
  return `${layer.kind}:${params}${layer.paint ? `:paint=${hashSeed(layer.paint)}` : ''}`;
}
