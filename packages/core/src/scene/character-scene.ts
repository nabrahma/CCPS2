/**
 * CharacterScene: assembles everything a character is made of (PS2 body,
 * eyes, brows, lashes, teeth, garments, hair) from the engine's morphed base
 * mesh. The viewport renders it; the exporters (M7) will read the same data.
 * Pure TypeScript: no DOM, no Three.js.
 */
import { wantsScalpLayer, type CharacterDoc, type GarmentSlot, type SidePhoto, type Tint } from '../character/doc';
import { hashSeed } from '../random';
import type { CharacterEngine } from '../character/engine';
import { computeQuadNormals, computeTriangleNormals } from '../mesh/normals';
import type { FaceAssets } from '../assets';
import { FaceRig, normaliseWeights, skinDeltas } from '../expression/facerig';
import { expressionDef, type ExpressionDef } from '../expression/map';
import { closureSteps, eyeVisibility, eyeballOf } from '../expression/blink';
import { addDelta, difference, transferBound } from '../expression/transfer';
import { mergeUntangleMeshes, untangleDeltas, untangleMesh, untangleMeshFromTriangles, type UntangleMesh } from '../expression/untangle';
import type { Ps2BodyMesh } from '../mesh/ps2body';
import { atlasTemplate, type AtlasRegion, type AtlasSpec } from '../hair/atlas';
import { adjustStyle, sanitiseStyle, styleForBudget, type HairStyleParams } from '../hair/style';
import { DEFAULT_HAIR_COLOUR, type HairColour } from '../hair/strand-atlas';
import { drawScalpLayer } from '../hair/scalp-layer';
import { HairBinding } from '../hair/binding';
import { boundaryLoops, browRoots, buildSurfaceCards, classifyLoop, furRoots, loopLength, type CardBrows, type FurTrim } from '../hair/surface-cards';
import { HairGenerator, type GeneratedHair } from '../hair/generate';
import { BodySurface, GarmentCollider } from '../proxy/collision';
import type { ProxyAsset } from '../proxy/proxy';
import { buildInfluences, selectInfluences, type InfluenceTable, type SparseWeights } from '../skeleton/weights';
import { buildRenderTopology, gather3, type RenderTopology } from './render-mesh';
import type { ResolvedSkin } from '../skin/compose';
import type { RgbaImage } from '../skin/image';
import { projectPhoto, type LandmarkTable } from '../skin/photo/project';
import { projectPhotos, type PhotoView } from '../skin/photo/multiview';
import { splitBody } from '../skin/headsplit';
import type { EyeLook } from '../eyes/eye-texture';
import type { HeadLayout } from '../skin/headpack';
import { blendVolumeNormals } from '../hair/cards-from-curves';
import { atlasCellTexels } from '../export/limits';

export type PartKind = 'body' | 'eyes' | 'eyebrows' | 'eyelashes' | 'teeth' | 'garment' | 'hair' | 'fur';

export interface PartMaterial {
  /** Path of the diffuse texture relative to assets/core, or a library URL. */
  texture: string | null;
  tint: Tint;
  alphaCutout: boolean;
  alphaThreshold: number;
  doubleSided: boolean;
  /** Optional dirt overlay amount (garments). */
  dirt: number;
  /** Card hair: dithered transparency on the outer layer (uses ScenePart.layer). */
  ditherOuter?: boolean;
  /**
   * Hair v2 (PRD F15): `texture` is a greyscale strand atlas, coloured through
   * this gradient map (colourizeHair) by the viewport and the exporter alike.
   */
  gradient?: { colour: HairColour; regions: AtlasRegion[] };
  /**
   * Hair v2 two-pass alpha (PRD F14/F15): texels at or above `alphaThreshold`
   * are drawn opaque with depth, softer ones blended over them without depth.
   */
  softAlpha?: boolean;
  /**
   * Card hair: the normals describe the hair's volume, not each card's faces, so
   * both sides of a card are lit by the same normal instead of each by its own.
   */
  volumeNormals?: boolean;
  /** Body only: the skin layer stack to composite (PRD F6); null means just `texture`. */
  skin?: ResolvedSkin | null;
  /**
   * Eyes, Part 2 F19: a generated eye texture (eyeTexture) instead of `texture`,
   * with the catch-light painted in when lighting is per vertex (Classic).
   */
  eye?: { look: EyeLook; catchLight: boolean };
}

export interface SceneOptions {
  /**
   * Decode an image (a library URL or a path under assets/core) to RGBA. Needed
   * for photo projection (the photo and, for colour matching, the base skin).
   * The app passes a browser decoder; without one, photos are ignored.
   */
  loadImage?: (url: string) => Promise<RgbaImage>;
}

/** Projected photo state: decoded inputs and the last projection. */
interface PhotoState {
  spec: string;
  photo: RgbaImage;
  baseSkin: RgbaImage | null;
  /** Side photos (Part 2 F19), with their landmarks. */
  sides: PhotoView[];
  table: LandmarkTable;
  layer: RgbaImage | null;
  /** Bumped per projection (texture cache key). */
  key: number;
  /** Head landmark vertex positions the layer was projected for. */
  projectedFor: Float32Array | null;
}

export interface ScenePart {
  key: string;
  kind: PartKind;
  assetId: string;
  label: string;
  zDepth: number;
  material: PartMaterial;
  /** Render topology (fixed until the part is reloaded). */
  uvs: Float32Array;
  indices: Uint32Array;
  /** Updated in place on every geometry change. */
  positions: Float32Array;
  normals: Float32Array;
  /** Bumped whenever positions/normals/indices change. */
  version: number;
  triangleCount: number;
  /** Card hair only: 0 (shell, innermost) .. 1 (outermost layer) per vertex. */
  layer?: Float32Array;
  /** Card hair only: 0 shell, 1 lock, 2 detail card, per vertex (Hair Studio's layer view, ID renders). */
  hairLayer?: Uint8Array;
  /**
   * Expression preview (PRD F8 sliders): positions and normals with the
   * previewed blendshapes applied. The viewport draws these when set; the
   * exporters always read the neutral `positions`.
   */
  preview?: { positions: Float32Array; normals: Float32Array };
}

/** One blendshape on one part: deltas per render vertex (metres) and normal deltas. */
export interface PartShape {
  deltas: Float32Array;
  normals: Float32Array;
}

export interface Budget {
  body: number;
  head: number;
  hair: number;
  garments: number;
  eyesAndBrows: number;
  total: number;
  target: number;
  hardMax: number;
  state: 'ok' | 'warn' | 'over';
  exportBlocked: boolean;
  /**
   * Texture memory of the export in Unity (PRD F11): RGBA8 with mipmaps for
   * the head and body textures, hair (at most 1024 px), the garment atlas
   * (1024 px) and the eyes atlas (512 px). An upper bound: Unity may compress.
   */
  textureBytes: number;
}

/** Bytes of a square RGBA8 texture with a full mip chain. */
const texBytes = (size: number) => Math.round(size * size * 4 * (4 / 3));

interface ProxyPart {
  part: ScenePart;
  proxy: ProxyAsset;
  topo: RenderTopology;
  fitted: Float32Array;
  smooth: Float32Array;
  /** Garments only: keeps the cloth outside the visible skin. */
  collider: GarmentCollider | null;
}

const NEUTRAL: Tint = { color: [1, 1, 1], brightness: 1 };
/** PS2 body triangles hidden by delete_verts need at least this many listed corners (see applyHiddenBody). */
const DELETE_MAJORITY = 2;

export class CharacterScene {
  private body: { part: ScenePart; mesh: Ps2BodyMesh | null; head: HeadLayout | null; fullIndices: Uint32Array; headTriangles: number } | null = null;
  private bodyMeshId: string | null = null;
  private proxies = new Map<string, ProxyPart>();
  private syncedFor: string | null = null;
  private lastGeometryVersion = -1;
  /** Vertical offset that puts the feet on y = 0. */
  groundOffset = 0;
  private hairGen: HairGenerator | null = null;
  /** Generated card hair with the style and atlas it was made from (the document may already be newer). */
  private cards: {
    part: ScenePart;
    hair: GeneratedHair;
    style: HairStyleParams;
    regions: AtlasRegion[];
    signature: string;
    generatedFor: number;
  } | null = null;

  private photo: PhotoState | null = null;
  private skinSynced: string | null = null;
  /** The body's baked map from the bake engine (F16), for the baked skin layers. */
  private bakedBody: { image: RgbaImage; key: string } | null = null;

  private face: FaceAssets | null = null;
  /** Baked shapes per expression name, for the current geometry and parts. */
  private shapeCache = new Map<string, Map<string, PartShape>>();
  /** Default-rig weights per proxy part (eyes, brows, lashes, teeth). */
  private faceWeightCache = new Map<string, SparseWeights>();
  private previewWeights: Record<string, number> = {};
  /** Calibrated weight of a blink's closing unit, per expression (see expression/blink.ts). */
  private calibration = new Map<string, { version: number; weight: number; visibleRays: number }>();

  constructor(
    readonly engine: CharacterEngine,
    private readonly options: SceneOptions = {},
  ) {}

  /** hm08 vertex of each body render vertex (the PS2 body's vertex map, or the full-density fallback's). */
  get bodySourceVertices(): Uint32Array | null {
    if (!this.body) return null;
    return this.body.mesh ? this.body.mesh.sourceVertex : this.bodyFallbackMap;
  }

  get parts(): ScenePart[] {
    const list: ScenePart[] = [];
    if (this.body) list.push(this.body.part);
    // Card brows replace the eyebrow mesh they grow on.
    const browCards = this.surfaceCards.has(BROW_CARDS);
    for (const [key, p] of this.proxies) if (!(browCards && key === 'eyebrows')) list.push(p.part);
    if (this.cards) list.push(this.cards.part);
    for (const s of this.surfaceCards.values()) list.push(s.part);
    return list.sort((a, b) => a.zDepth - b.zDepth);
  }

  /**
   * Hair v2 (PRD F15): the card system grown on other surfaces. Fur trims along
   * garment edges (key `fur:<garment key>`) and card brows on the eyebrow mesh.
   */
  private readonly surfaceCards = new Map<string, SurfaceCardPart>();
  private bodyTrianglesCache: Uint32Array | null = null;

  /** Every body triangle of hm08 (fur and brows bind to the nearest one). */
  private bodyTriangles(): Uint32Array {
    if (!this.bodyTrianglesCache) {
      const b = this.engine.assets.base;
      const tris: number[] = [];
      for (const f of b.facesWhere((g) => g === 'body')) {
        const q = [0, 1, 2, 3].map((k) => b.faceVerts[f * 4 + k]!);
        tris.push(q[0]!, q[1]!, q[2]!);
        if (q[3] !== q[2]) tris.push(q[0]!, q[2]!, q[3]!);
      }
      this.bodyTrianglesCache = Uint32Array.from(tris);
    }
    return this.bodyTrianglesCache;
  }

  /** The built-in strand atlas of a preset. */
  private strandAtlas(preset: string): AtlasSpec | null {
    const all = this.engine.assets.catalog.hairAtlases ?? [];
    return (all.find((a) => a.strands === preset) ?? all.find((a) => a.strands))?.atlas ?? null;
  }

  /** Create or drop fur trims and card brows to match the document; geometry follows in update(). */
  private syncSurfaceCards(doc: Readonly<CharacterDoc>): void {
    const wanted = new Map<string, { kind: 'fur' | 'brows'; source: string; settings: FurTrim | CardBrows; colour: HairColour; signature: string }>();
    for (const g of doc.garments) {
      if (!g.fur?.enabled || g.fur.edges.length === 0) continue;
      const source = garmentKey(g);
      if (!this.proxies.has(source)) continue;
      const colour: HairColour = { base: g.fur.colour, rootDarken: 0.25, tipLighten: 0.25, streaks: 0, streakColour: g.fur.colour, grey: 0 };
      wanted.set(`fur:${source}`, { kind: 'fur', source, settings: g.fur, colour, signature: JSON.stringify(g.fur) });
    }
    const brows = doc.eyebrows.cards;
    if (brows && this.proxies.has('eyebrows')) {
      const hairColour = doc.hair.colour;
      const base: [number, number, number] = hairColour ? [hairColour.base[0] * 0.8, hairColour.base[1] * 0.8, hairColour.base[2] * 0.8] : [0.24, 0.17, 0.12];
      const colour: HairColour = { base, rootDarken: 0.2, tipLighten: 0.1, streaks: 0, streakColour: base, grey: 0 };
      wanted.set(BROW_CARDS, { kind: 'brows', source: 'eyebrows', settings: brows, colour, signature: JSON.stringify([brows, this.proxies.get('eyebrows')!.proxy.id]) });
    }
    for (const key of [...this.surfaceCards.keys()]) {
      if (!wanted.has(key)) {
        this.surfaceCards.delete(key);
        this.influenceCache.delete(key);
      }
    }
    for (const [key, w] of wanted) {
      const atlas = this.strandAtlas(w.kind === 'fur' ? 'curly' : 'straightFine');
      if (!atlas) continue;
      const existing = this.surfaceCards.get(key);
      const material: PartMaterial = {
        texture: atlas.texture,
        tint: w.kind === 'brows' ? (doc.eyebrows.tint ?? NEUTRAL) : NEUTRAL,
        alphaCutout: true,
        alphaThreshold: 0.5,
        doubleSided: true,
        dirt: 0,
        gradient: { colour: w.colour, regions: atlas.regions },
        softAlpha: true,
      };
      if (existing && existing.signature === w.signature) {
        existing.part.material = material;
        continue;
      }
      const pp = this.proxies.get(w.source)!;
      let loops: number[][] = [];
      let counts: number[] = [];
      if (w.kind === 'fur') {
        const fur = w.settings as FurTrim;
        // Edge loops on the garment's own topology (UV seams are not edges); the counts are fixed here.
        const sk = this.engine.skeleton;
        const joint = (name: string): [number, number, number] => {
          const i = sk.rig.index.get(name);
          return i === undefined ? [0, -10, 0] : [sk.heads[i * 3]!, sk.heads[i * 3 + 1]!, sk.heads[i * 3 + 2]!];
        };
        const joints = { neck: joint('neck_01'), wrists: [joint('hand_l'), joint('hand_r')], ankles: [joint('foot_l'), joint('foot_r')] };
        pp.proxy.fit(this.engine.positions, pp.fitted);
        loops = boundaryLoops(pp.topo.sourceIndices).filter((l) => fur.edges.includes(classifyLoop(pp.fitted, l, joints)));
        counts = loops.map((l) => Math.max(3, Math.round(loopLength(pp.fitted, l) * fur.density)));
      }
      const part: ScenePart = {
        key,
        kind: w.kind === 'fur' ? 'fur' : 'eyebrows',
        assetId: w.kind === 'fur' ? 'ps2cc:fur/cards' : 'ps2cc:eyebrows/cards',
        label: w.kind === 'fur' ? `Fur trim: ${pp.part.label}` : 'Card eyebrows',
        zDepth: w.kind === 'fur' ? pp.part.zDepth + 1 : pp.part.zDepth,
        material,
        uvs: new Float32Array(0),
        indices: new Uint32Array(0),
        positions: new Float32Array(0),
        normals: new Float32Array(0),
        version: 0,
        triangleCount: 0,
      };
      this.surfaceCards.set(key, { part, kind: w.kind, source: w.source, settings: w.settings, loops, counts, seed: hashSeed(key), signature: w.signature, binding: null, generatedFor: -1 });
      this.influenceCache.delete(key);
    }
  }

  /** Grow the fur and brow cards on the current garment and eyebrow geometry. */
  private updateSurfaceCards(): void {
    for (const [key, s] of this.surfaceCards) {
      const pp = this.proxies.get(s.source);
      if (!pp) continue;
      const atlasRegions = s.part.material.gradient?.regions ?? [];
      const roots =
        s.kind === 'fur'
          ? furRoots(pp.fitted, pp.smooth, s.loops, s.counts, s.settings as FurTrim, s.seed)
          : browRoots(pp.fitted, pp.topo.sourceIndices, 0, s.settings as CardBrows, s.seed);
      const cards = buildSurfaceCards(roots, atlasRegions, s.kind === 'fur' ? 'clump' : 'strand', s.kind === 'fur' ? 2 : 1, s.seed);
      const p = s.part;
      if (p.positions.length !== cards.positions.length) {
        p.uvs = cards.uvs;
        p.indices = cards.indices;
        p.positions = cards.positions;
        p.normals = new Float32Array(cards.positions.length);
        p.layer = cards.layer;
        p.hairLayer = cards.hairLayer;
        p.triangleCount = cards.triangleCount;
      } else p.positions.set(cards.positions);
      computeTriangleNormals(p.positions, p.indices, p.positions.length / 3, p.normals);
      // Skin weights and expressions come from the body triangle under each vertex, bound once the shape settles.
      if (!this.engine.interacting || !s.binding) {
        s.binding = new HairBinding(this.engine.positions, this.bodyTriangles(), p.positions);
        s.generatedFor = this.engine.geometryVersion;
        this.influenceCache.delete(key);
      }
      p.version++;
    }
  }

  /** Load/unload parts to match the current document. Safe to call often. */
  async sync(): Promise<void> {
    const doc = this.engine.doc;
    const wanted = wantedProxies(doc, (id) => this.engine.assets.hasProxy(id)).map((w) => ({
      ...w,
      material: { ...w.material, texture: this.engine.assets.textureFor(w.material.texture) },
    }));
    const cardHair =
      doc.hair.mode === 'cards' ? { style: doc.hair.style, atlas: doc.hair.atlas ?? null, hairBudget: doc.export.hairBudget, v2: Boolean(doc.hair.colour), adjust: doc.hair.adjust ?? null } : null;
    const signature = JSON.stringify({
      body: doc.bodyMesh,
      wanted,
      hide: doc.garments.map((g) => [g.asset, g.hideBody]),
      surfaceCards: [doc.garments.map((g) => g.fur ?? null), doc.eyebrows.cards ?? null, doc.eyebrows.tint ?? null],
      cardHair,
      hairLook: [doc.hair.tint, doc.hair.alphaThreshold, doc.hair.ditherOuter, doc.hair.colour ?? null],
    });
    if (signature === this.syncedFor) {
      await this.syncSkin(doc);
      return;
    }

    if (this.bodyMeshId !== doc.bodyMesh || !this.body) await this.loadBody(doc);
    // Drop parts no longer wanted.
    for (const key of [...this.proxies.keys()]) if (!wanted.some((w) => w.key === key)) this.proxies.delete(key);
    // Load new parts.
    for (const w of wanted) {
      const existing = this.proxies.get(w.key);
      if (existing && existing.proxy.id === w.assetId) {
        existing.part.material = { ...w.material, texture: w.material.texture ?? existing.proxy.meta.material?.diffuseTexture ?? null };
        continue;
      }
      const proxy = await this.engine.assets.proxy(w.assetId);
      const topo = buildRenderTopology(proxy.faceVerts, proxy.faceUvs, proxy.uvs);
      const n = topo.sourceVertex.length;
      const part: ScenePart = {
        key: w.key,
        kind: w.kind,
        assetId: w.assetId,
        label: proxy.meta.name,
        zDepth: proxy.meta.zDepth,
        material: { ...w.material, texture: w.material.texture ?? proxy.meta.material?.diffuseTexture ?? null },
        uvs: topo.uvs,
        indices: topo.indices,
        positions: new Float32Array(n * 3),
        normals: new Float32Array(n * 3),
        version: 0,
        triangleCount: topo.indices.length / 3,
      };
      this.influenceCache.delete(w.key);
      this.proxies.set(w.key, {
        part,
        proxy,
        topo,
        fitted: new Float32Array(proxy.vertexCount * 3),
        smooth: new Float32Array(proxy.vertexCount * 3),
        collider: null,
      });
    }
    this.applyHiddenBody(doc);
    this.anchoredFor = -1;
    this.syncCardHair(doc, cardHair === null ? null : JSON.stringify(cardHair));
    this.syncSurfaceCards(doc);
    for (const k of [...this.influenceCache.keys()]) if (k !== 'body' && k !== 'hair' && !this.proxies.has(k) && !this.surfaceCards.has(k)) this.influenceCache.delete(k);
    for (const k of [...this.faceWeightCache.keys()]) if (!this.proxies.has(k)) this.faceWeightCache.delete(k);
    this.shapeCache.clear();
    this.syncedFor = signature;
    this.lastGeometryVersion = -1;
    this.update();
    this.skinSynced = null;
    await this.syncSkin(doc);
  }

  /** Refit all parts to the engine's current geometry (call on every geometry change). */
  update(): void {
    if (this.lastGeometryVersion === this.engine.geometryVersion) return;
    this.lastGeometryVersion = this.engine.geometryVersion;
    this.shapeCache.clear();
    const base = this.engine.positions;
    const baseNormals = this.engine.normals;
    // Feet on the ground: lowest body vertex.
    let minY = Infinity;
    for (let v = 0; v < this.engine.assets.base.bodyVertexCount; v++) minY = Math.min(minY, base[v * 3 + 1]!);
    this.groundOffset = -minY;
    if (this.body) {
      const p = this.body.part;
      const map = this.body.mesh ? this.body.mesh.sourceVertex : this.bodyFallbackMap!;
      gather3(base, map, p.positions);
      gather3(baseNormals, map, p.normals);
      p.version++;
    }
    for (const pp of this.proxies.values()) pp.proxy.fit(base, pp.fitted);
    // Re-anchor garments once the shape settles; during a drag the old anchors follow the body.
    if (this.anchoredFor !== this.engine.geometryVersion && (!this.engine.interacting || this.anchoredFor === -1)) this.anchorGarments();
    for (const pp of this.proxies.values()) {
      if (pp.collider && this.body) pp.collider.resolve(pp.fitted, this.body.part.positions, this.body.part.normals);
      computeTriangleNormals(pp.fitted, pp.topo.sourceIndices, pp.proxy.vertexCount, pp.smooth);
      gather3(pp.fitted, pp.topo.sourceVertex, pp.part.positions);
      gather3(pp.smooth, pp.topo.sourceVertex, pp.part.normals);
      pp.part.version++;
    }
    this.updateCardHair();
    this.updateSurfaceCards();
    this.applyPreview();
    // The photo follows head-shape changes once the shape settles.
    if (this.photo && !this.engine.interacting && this.reprojectPhoto(false)) this.applySkin(this.engine.doc);
  }

  /** Path or URL of the base skin texture (catalog skins by id; user skins are library URLs). */
  baseSkinTexture(doc: Readonly<CharacterDoc> = this.engine.doc): string | null {
    const assets = this.engine.assets;
    const skin = assets.skin(doc.skin.base);
    if (skin) return skin.texture;
    if (/^(\/|blob:|data:|https?:)/.test(doc.skin.base)) return doc.skin.base;
    return assets.catalog.skins[0]?.texture ?? null;
  }

  /** The projected photo layer, if any (RGBA in hm08 UV space). */
  get photoLayer(): RgbaImage | null {
    return this.photo?.layer ?? null;
  }

  /** Load photo inputs when the skin settings change, then resolve the layer stack. */
  private async syncSkin(doc: Readonly<CharacterDoc>): Promise<void> {
    if (!this.body) return;
    const signature = JSON.stringify([doc.skin, this.baseSkinTexture(doc), this.bakedBody?.key ?? null, this.scalpKey(doc)]);
    if (signature === this.skinSynced) return;
    const p = doc.skin.photo;
    const load = this.options.loadImage;
    if (p && p.landmarks && load) {
      const base = this.baseSkinTexture(doc);
      const sides = [p.sides?.left ?? null, p.sides?.right ?? null].filter((x): x is SidePhoto => x !== null);
      const spec = JSON.stringify([p.image, p.landmarks, p.colourMatch, base, sides]);
      if (this.photo?.spec !== spec) {
        const table = await this.engine.assets.landmarkTable();
        if (!table) throw new Error('the face landmark table is missing from assets/core (run pnpm build:landmarks)');
        const [photo, baseSkin, ...sidePhotos] = await Promise.all([
          load(p.image),
          p.colourMatch && base ? load(base) : Promise.resolve(null),
          ...sides.map((s) => load(s.image)),
        ]);
        this.photo = {
          spec,
          photo: photo!,
          baseSkin,
          sides: sides.map((s, i) => ({ photo: sidePhotos[i]!, landmarks: s.landmarks })),
          table,
          layer: null,
          key: (this.photo?.key ?? 0) + 1,
          projectedFor: null,
        };
        this.reprojectPhoto(true);
      }
    } else {
      this.photo = null;
    }
    this.skinSynced = signature;
    this.applySkin(doc);
  }

  /**
   * Project the photo onto the current head (PRD F7). Skipped unless forced or
   * the landmark vertices moved by more than 0.1 mm since the last projection.
   * Returns true when the layer changed.
   */
  private reprojectPhoto(force: boolean): boolean {
    const ph = this.photo;
    const lm = this.engine.doc.skin.photo?.landmarks;
    if (!ph || !lm) return false;
    const pos = this.engine.positions;
    const verts = ph.table.vertices.filter((v) => v >= 0);
    const now = new Float32Array(verts.length * 3);
    verts.forEach((v, i) => now.set([pos[v * 3]!, pos[v * 3 + 1]!, pos[v * 3 + 2]!], i * 3));
    if (!force && ph.projectedFor) {
      let moved = 0;
      for (let i = 0; i < now.length; i++) moved = Math.max(moved, Math.abs(now[i]! - ph.projectedFor[i]!));
      if (moved < 1e-4) return false;
    }
    // With side photos, the three-photo projection (Part 2 F19); the front photo alone keeps F7's.
    const result = ph.sides.length
      ? projectPhotos({
          layout: this.engine.assets.skinComposer.layout,
          table: ph.table,
          positions: pos,
          normals: this.engine.normals,
          views: [{ photo: ph.photo, landmarks: lm }, ...ph.sides],
          baseSkin: ph.baseSkin,
        })
      : projectPhoto({
          layout: this.engine.assets.skinComposer.layout,
          table: ph.table,
          positions: pos,
          normals: this.engine.normals,
          photo: ph.photo,
          landmarks: lm,
          baseSkin: ph.baseSkin,
        });
    ph.layer = result.image;
    ph.key++;
    ph.projectedFor = now;
    return true;
  }

  /** Put the base texture and the resolved layer stack on the body material. */
  private applySkin(doc: Readonly<CharacterDoc>): void {
    if (!this.body) return;
    const material = this.body.part.material;
    const base = this.baseSkinTexture(doc);
    material.texture = base;
    const photo = this.photo?.layer && (doc.skin.photo?.strength ?? 0) > 0 ? { image: this.photo.layer, key: String(this.photo.key) } : null;
    const hasLayers = photo !== null || doc.skin.layers.some((l) => l.enabled && l.opacity > 0);
    material.skin = hasLayers
      ? this.engine.assets.skinComposer.resolve(doc.skin, (ref) => (ref === doc.skin.base ? base : this.engine.assets.textureFor(ref)), photo, this.bakedBody, this.scalpImage(doc))
      : null;
  }

  /** The style card hair is generated from: sanitised, with the Character Creator's adjustments. */
  private effectiveStyle(doc: Readonly<CharacterDoc>): HairStyleParams {
    return adjustStyle(sanitiseStyle(doc.hair.style), doc.hair.adjust);
  }

  /** What the scalp layer's pixels depend on (null without one). */
  private scalpKey(doc: Readonly<CharacterDoc>): string | null {
    if (!wantsScalpLayer(doc as CharacterDoc) || this.scalpHidden) return null;
    const s = this.effectiveStyle(doc);
    return JSON.stringify([s.seed, s.hairline, s.part, s.flowBack, s.frame, s.gravity, s.bangs, s.ponytail, s.groom.curves ?? null, s.groom.cards ?? null, s.scalpLayer, doc.hair.colour]);
  }

  private scalpCache: { key: string; image: RgbaImage } | null = null;

  /** Short hair painted on the scalp (Hair v2, PRD F15), drawn on the neutral surface; cached by what it depends on. */
  private scalpImage(doc: Readonly<CharacterDoc>): { image: RgbaImage; key: string } | null {
    const key = this.scalpKey(doc);
    if (key === null) return null;
    if (this.scalpCache?.key !== key) {
      const style = this.effectiveStyle(doc);
      const field = this.hairGenerator().scalpField(style);
      const image = drawScalpLayer(this.engine.assets.skinComposer.surface, field, style.scalpLayer, doc.hair.colour ?? DEFAULT_HAIR_COLOUR, style.seed);
      this.scalpCache = { key, image };
    }
    return { image: this.scalpCache.image, key: String(hashSeed(key)) };
  }

  /**
   * Give the body its baked map (r occlusion, g cavity, b thickness, a light;
   * rows top first, hm08 UV space) for the baked skin layers; null removes it.
   * `key` must change whenever the pixels do.
   */
  async setBakedBody(baked: { image: RgbaImage; key: string } | null): Promise<void> {
    this.bakedBody = baked;
    await this.syncSkin(this.engine.doc);
  }

  get bakedBodyKey(): string | null {
    return this.bakedBody?.key ?? null;
  }

  /**
   * Skin influences (max 4, normalised) per render vertex of a part: the body
   * picks hm08 weights through its vertex map, proxies transfer them through
   * their MHCLO binding (port of Proxy.getVertexWeights).
   */
  /**
   * Texels across this part's whole texture once exported (PRD F9: previews
   * are no sharper than the export). `head` applies to head vertices, which
   * get their own texture: its size, scaled per vertex by the head layout's
   * density (bodyHeadDensity).
   */
  exportTexels(part: ScenePart): { texels: number; head: number } {
    const doc = this.engine.doc;
    const count = (...kinds: PartKind[]) => this.parts.filter((p) => kinds.includes(p.kind)).length;
    switch (part.kind) {
      case 'body':
        return { texels: doc.export.bodyTexture, head: doc.export.headTexture };
      case 'hair':
        return { texels: doc.export.hairTexture, head: doc.export.hairTexture };
      case 'garment': {
        const t = atlasCellTexels(count('garment'), doc.export.garmentAtlas);
        return { texels: t, head: t };
      }
      default: {
        const t = atlasCellTexels(count('eyes', 'eyebrows', 'eyelashes', 'teeth'), doc.export.eyesAtlas);
        return { texels: t, head: t };
      }
    }
  }

  private headDensityCache: { indices: Uint32Array; density: Float32Array } | null = null;

  /** The head texture's layout for the body mesh shown (Part 2 F19), or null before it is loaded. */
  get bodyHeadLayout(): HeadLayout | null {
    return this.body?.head ?? null;
  }

  /**
   * Per render vertex of the body: head-texture units per hm08 UV unit on the
   * head material (Part 2 F19 head layout), 0 on the body. Null before the PS2
   * body is loaded.
   */
  bodyHeadDensity(): Float32Array | null {
    const body = this.body;
    if (!body?.mesh || !body.head) return null;
    if (this.headDensityCache?.indices !== body.fullIndices) {
      const split = splitBody({ sourceVertex: this.bodySourceVertices!, uvs: body.part.uvs, indices: body.fullIndices }, this.engine.assets.skinComposer.layout, body.head);
      this.headDensityCache = { indices: body.fullIndices, density: split.headDensity };
    }
    return this.headDensityCache.density;
  }

  influences(key: string): InfluenceTable | null {
    const cached = this.influenceCache.get(key);
    if (cached) return cached;
    const sparse = this.engine.assets.weights.sparse;
    let table: InfluenceTable | null = null;
    if (key === 'body' && this.body) {
      this.bodyInfluences ??= buildInfluences(sparse);
      table = selectInfluences(this.bodyInfluences, this.body.mesh ? this.body.mesh.sourceVertex : this.bodyFallbackMap!);
    } else if (key === 'hair' && this.cards) {
      table = buildInfluences(this.hairGenerator().skinWeights(this.cards.hair));
    } else if (this.surfaceCards.get(key)?.binding) {
      const s = this.surfaceCards.get(key)!;
      const rig = this.engine.assets.rig;
      const all = new Set<number>(rig.bones.map((_, i) => i));
      const fallback = rig.index.get(s.kind === 'brows' ? 'head' : 'spine_03') ?? 0;
      table = buildInfluences(s.binding!.weights(sparse, all, fallback));
    } else {
      const pp = this.proxies.get(key);
      if (pp) table = selectInfluences(buildInfluences(pp.proxy.transferWeights(sparse)), pp.topo.sourceVertex);
    }
    if (table) this.influenceCache.set(key, table);
    return table;
  }

  // ------------------------------------------------------------ expressions (PRD F8)

  /** Load the face rig and pose units (once). Needed before expressionShapes(). */
  async prepareExpressions(): Promise<void> {
    this.face ??= await this.engine.assets.faceAssets();
  }

  get expressionsReady(): boolean {
    return this.face !== null;
  }

  /**
   * A blendshape baked for the current character: the default rig posed with
   * the expression's pose units, as deltas per render vertex of every part
   * (parts it does not move get zero deltas). Null until prepareExpressions()
   * has finished, or when the map has no such expression.
   */
  expressionShapes(name: string): Map<string, PartShape> | null {
    const cached = this.shapeCache.get(name);
    if (cached) return cached;
    const face = this.face;
    const def = expressionDef(name);
    if (!face || !def) return null;
    const engine = this.engine;
    const base = engine.positions;
    const rig = face.rig;
    const skin = rig.skinMatrices(rig.heads(base), face.units.blend(this.unitsFor(def, face)));
    const moving = FaceRig.moving(skin);
    const delta = skinDeltas(base, rig.weights, skin, moving);
    const b = engine.assets.base;
    // Below the eyes, smooth out any fold the rig makes (expression/untangle.ts); the lids are left alone.
    this.untangle ??= untangleMesh(b.faceVerts, b.facesWhere((g) => g === 'body'), b.vertexCount);
    const eyeY = this.eyeHeight(base);
    // Together with the body tier's own, larger triangles (in base vertex ids, so UV seams stay shut).
    // The lips part on purpose: the tier's mouth and eye openings and the ring around them keep their deltas.
    let mesh = this.untangle;
    let keep: Uint8Array | null = null;
    if (this.body?.mesh) {
      if (this.tierUntangle?.indices !== this.body.part.indices) {
        const tierMesh = this.body.mesh;
        const map = tierMesh.sourceVertex;
        const idx = this.body.part.indices;
        const tier = untangleMeshFromTriangles(Uint32Array.from(idx, (i) => map[i]!), b.vertexCount);
        const merged = mergeUntangleMeshes(this.untangle, tier);
        const opening = tierMesh.meta.regions.indexOf('opening');
        const fixed = new Uint8Array(b.vertexCount);
        for (let i = 0; i < map.length; i++) if (tierMesh.vertexRegion[i] === opening) fixed[map[i]!] = 1;
        const ring = fixed.slice();
        for (let v = 0; v < b.vertexCount; v++) {
          if (!fixed[v]) continue;
          for (let k = merged.start[v]!; k < merged.start[v + 1]!; k++) ring[merged.next[k]!] = 1;
        }
        this.tierUntangle = { indices: idx, mesh: merged, keep: ring };
      }
      mesh = this.tierUntangle.mesh;
      keep = this.tierUntangle.keep;
    }
    untangleDeltas(base, delta, mesh, (v) => v < b.bodyVertexCount && !keep?.[v] && base[v * 3 + 1]! < eyeY - 0.03, 80);
    const baseNormals = difference(computeQuadNormals(addDelta(base, delta), b.faceVerts, b.vertexCount), engine.normals);
    const out = new Map<string, PartShape>();

    if (this.body) {
      const map = this.bodySourceVertices!;
      const n = map.length;
      out.set('body', { deltas: gather3(delta, map, new Float32Array(n * 3)), normals: gather3(baseNormals, map, new Float32Array(n * 3)) });
    }
    for (const [key, pp] of this.proxies) {
      const proxy = pp.proxy;
      let d: Float32Array;
      if (pp.part.kind === 'garment' || pp.part.kind === 'hair') {
        // Loose parts follow the skin point they are bound to.
        d = transferBound(delta, proxy.refVerts, proxy.refWeights);
      } else {
        // Eyes, brows, lashes and teeth are skinned to the face rig, as MakeHuman poses proxies
        // (weights through the MHCLO binding), so lashes turn with the eyelid.
        let w = this.faceWeightCache.get(key);
        if (!w) {
          w = normaliseWeights(proxy.transferWeights(rig.weights), 0);
          this.faceWeightCache.set(key, w);
        }
        d = skinDeltas(pp.fitted, w, skin, moving);
      }
      const nd = difference(computeTriangleNormals(addDelta(pp.fitted, d), pp.topo.sourceIndices, proxy.vertexCount), pp.smooth);
      const n = pp.topo.sourceVertex.length;
      out.set(key, {
        deltas: gather3(d, pp.topo.sourceVertex, new Float32Array(n * 3)),
        normals: gather3(nd, pp.topo.sourceVertex, new Float32Array(n * 3)),
      });
    }
    if (this.cards) {
      const c = this.cards;
      const d = transferBound(delta, c.hair.binding.tri, c.hair.binding.bary);
      const n = c.part.positions.length / 3;
      const nd = difference(computeTriangleNormals(addDelta(c.part.positions, d), c.part.indices, n), c.part.normals);
      out.set('hair', { deltas: d, normals: nd });
    }
    for (const [key, s] of this.surfaceCards) {
      if (!s.binding) continue;
      const d = transferBound(delta, s.binding.tri, s.binding.bary);
      const n = s.part.positions.length / 3;
      const nd = difference(computeTriangleNormals(addDelta(s.part.positions, d), s.part.indices, n), s.part.normals);
      out.set(key, { deltas: d, normals: nd });
    }
    this.shapeCache.set(name, out);
    return out;
  }

  private untangle: UntangleMesh | null = null;
  private tierUntangle: { indices: Uint32Array; mesh: UntangleMesh; keep: Uint8Array } | null = null;

  /** Height of the eyes (the left eye joint) on the morphed base mesh. */
  private eyeHeight(base: Float32Array): number {
    const verts = this.engine.assets.base.vertexGroup('joint-l-eye');
    let y = 0;
    for (const v of verts) y += base[v * 3 + 1]!;
    return y / Math.max(1, verts.length);
  }

  /**
   * The calibrated weight of a blink's closing unit for the current character
   * and how many view rays still reach the eyeball at it (0: closed), or null
   * for expressions without calibration.
   */
  expressionCalibration(name: string): { weight: number; visibleRays: number } | null {
    const c = this.calibration.get(name);
    return c ? { weight: c.weight, visibleRays: c.visibleRays } : null;
  }

  /** The expression's pose-unit blend, with a blink's closing unit calibrated to this character. */
  private unitsFor(def: ExpressionDef, face: FaceAssets): [string, number][] {
    const cal = def.calibrate;
    const eyesPart = this.proxies.get('eyes');
    if (!cal || !this.body || !eyesPart) return def.units;
    const scaled = (w: number): [string, number][] => def.units.map(([u, x]) => [u, u === cal.unit ? x * w : x]);
    const version = this.engine.geometryVersion;
    const prev = this.calibration.get(def.name);
    // During a slider drag keep the last weight; calibrate again once the shape settles.
    if (prev && (prev.version === version || this.engine.interacting)) return scaled(prev.weight);
    const eyes = eyesPart.part;
    const ball = eyeballOf(eyes.positions, eyes.indices, cal.eye === 'L' ? 1 : -1);
    if (!ball) return def.units;
    const body = this.body.part;
    const base = this.engine.positions;
    const rig = face.rig;
    const heads = rig.heads(base);
    const map = this.bodySourceVertices!;
    const steps = closureSteps(cal.max, cal.step);
    let chosen = steps[steps.length - 1]!;
    let visibleRays = -1;
    const posed = new Float32Array(body.positions.length);
    for (const w of steps) {
      const skin = rig.skinMatrices(heads, face.units.blend(scaled(w)));
      const delta = skinDeltas(base, rig.weights, skin, FaceRig.moving(skin));
      for (let i = 0; i < map.length; i++) {
        const s = map[i]! * 3;
        posed[i * 3] = body.positions[i * 3]! + delta[s]!;
        posed[i * 3 + 1] = body.positions[i * 3 + 1]! + delta[s + 1]!;
        posed[i * 3 + 2] = body.positions[i * 3 + 2]! + delta[s + 2]!;
      }
      // The whole body occludes (grazing rays can be blocked by the nose or brow).
      visibleRays = eyeVisibility(posed, body.indices, eyes.positions, ball).visible;
      if (visibleRays === 0) {
        chosen = w;
        break;
      }
    }
    this.calibration.set(def.name, { version, weight: chosen, visibleRays });
    return scaled(chosen);
  }

  /** Blendshape weights shown in the viewport (by name, 0..1); exports are not affected. */
  async setExpressionPreview(weights: Record<string, number>): Promise<void> {
    this.previewWeights = Object.fromEntries(Object.entries(weights).filter(([, w]) => Number.isFinite(w) && w !== 0));
    if (Object.keys(this.previewWeights).length > 0) await this.prepareExpressions();
    this.applyPreview();
  }

  get expressionPreview(): Readonly<Record<string, number>> {
    return this.previewWeights;
  }

  private applyPreview(): void {
    const active: [Map<string, PartShape>, number][] = [];
    for (const [name, w] of Object.entries(this.previewWeights)) {
      const shapes = this.expressionShapes(name);
      if (shapes) active.push([shapes, w]);
    }
    for (const part of this.parts) {
      if (active.length === 0) {
        if (part.preview) {
          part.preview = undefined;
          part.version++;
        }
        continue;
      }
      const reuse = part.preview && part.preview.positions.length === part.positions.length ? part.preview : null;
      const positions = reuse?.positions ?? new Float32Array(part.positions.length);
      const normals = reuse?.normals ?? new Float32Array(part.normals.length);
      positions.set(part.positions);
      normals.set(part.normals);
      for (const [shapes, w] of active) {
        const s = shapes.get(part.key);
        if (!s || s.deltas.length !== positions.length) continue;
        for (let i = 0; i < positions.length; i++) {
          positions[i] = positions[i]! + w * s.deltas[i]!;
          normals[i] = normals[i]! + w * s.normals[i]!;
        }
      }
      for (let i = 0; i < normals.length; i += 3) {
        const l = Math.hypot(normals[i]!, normals[i + 1]!, normals[i + 2]!) || 1;
        normals[i] = normals[i]! / l;
        normals[i + 1] = normals[i + 1]! / l;
        normals[i + 2] = normals[i + 2]! / l;
      }
      part.preview = { positions, normals };
      part.version++;
    }
  }

  budget(): Budget {
    const doc = this.engine.doc;
    let body = 0;
    let head = 0;
    let hair = 0;
    let garments = 0;
    let eyes = 0;
    if (this.body) {
      body = this.body.part.triangleCount;
      head = Math.min(body, this.body.headTriangles);
    }
    if (this.cards) hair += this.cards.part.triangleCount;
    const browCards = this.surfaceCards.has(BROW_CARDS);
    for (const s of this.surfaceCards.values()) {
      if (s.kind === 'fur') garments += s.part.triangleCount;
      else eyes += s.part.triangleCount;
    }
    for (const [key, pp] of this.proxies) {
      if (browCards && key === 'eyebrows') continue;
      const n = pp.part.triangleCount;
      if (pp.part.kind === 'hair') hair += n;
      else if (pp.part.kind === 'garment') garments += n;
      else eyes += n;
    }
    const total = body + hair + garments + eyes;
    const target = doc.export.triangleBudget;
    const hardMax = doc.export.hardMax;
    // PRD F11: amber from 90% of the budget, red above it; export is blocked above the hard max.
    const state: Budget['state'] = total > target ? 'over' : total >= target * 0.9 ? 'warn' : 'ok';
    let textureBytes = texBytes(doc.export.headTexture) + texBytes(doc.export.bodyTexture);
    if (hair > 0) textureBytes += texBytes(doc.export.hairTexture);
    if (garments > 0) textureBytes += texBytes(doc.export.garmentAtlas);
    if (eyes > 0) textureBytes += texBytes(doc.export.eyesAtlas);
    return { body: body - head, head, hair, garments, eyesAndBrows: eyes, total, target, hardMax, state, exportBlocked: total > hardMax, textureBytes };
  }

  // ------------------------------------------------------------ internals

  private bodyFallbackMap: Uint32Array | null = null;
  private bodyInfluences: InfluenceTable | null = null;
  /** Geometry version the garment anchors were built for (-1: rebuild). */
  private anchoredFor = -1;
  private influenceCache = new Map<string, InfluenceTable>();

  private async loadBody(doc: Readonly<CharacterDoc>): Promise<void> {
    const assets = this.engine.assets;
    const meshPromise = assets.bodyMesh(doc.bodyMesh);
    let mesh: Ps2BodyMesh | null = null;
    let uvs: Float32Array;
    let indices: Uint32Array;
    let headTriangles = 0;
    let head: HeadLayout | null = null;
    if (meshPromise) {
      mesh = await meshPromise;
      head = await assets.headLayout(doc.bodyMesh);
      uvs = mesh.uvs;
      indices = mesh.indices;
      const headRegions = new Set(['head', 'face', 'opening'].map((r) => mesh!.meta.regions.indexOf(r)));
      for (let t = 0; t < indices.length; t += 3) if (headRegions.has(mesh.vertexRegion[indices[t]!]!)) headTriangles++;
    } else {
      // Body meshes not built yet: fall back to the full-density hm08 body.
      const base = assets.base;
      const topo = buildRenderTopology(base.faceVerts, base.faceUvs, base.uvs, base.facesWhere((g) => g === 'body'));
      this.bodyFallbackMap = topo.sourceVertex;
      uvs = topo.uvs;
      indices = topo.indices;
    }
    const n = uvs.length / 2;
    this.body = {
      mesh,
      head,
      fullIndices: indices,
      headTriangles,
      part: {
        key: 'body',
        kind: 'body',
        assetId: `ps2cc:bodymesh/${doc.bodyMesh}`,
        label: 'Body',
        zDepth: 0,
        material: { texture: null, tint: NEUTRAL, alphaCutout: false, alphaThreshold: 0.5, doubleSided: false, dirt: 0 },
        uvs,
        indices,
        positions: new Float32Array(n * 3),
        normals: new Float32Array(n * 3),
        version: 0,
        triangleCount: indices.length / 3,
      },
    };
    this.bodyMeshId = doc.bodyMesh;
    this.influenceCache.delete('body');
  }

  /** Generated card hair on the current body (Hair Studio draws its guides), or null. */
  get cardHair(): GeneratedHair | null {
    return this.cards?.hair ?? null;
  }

  /** Hair Studio's layer view: hide the scalp layer without touching the document. */
  setScalpLayerVisible(on: boolean): void {
    if (this.scalpHidden === !on) return;
    this.scalpHidden = !on;
    this.skinSynced = null;
    this.applySkin(this.engine.doc);
  }

  private scalpHidden = false;

  hairGenerator(): HairGenerator {
    const a = this.engine.assets;
    this.hairGen ??= new HairGenerator(a.base, a.rig, a.weights.sparse);
    return this.hairGen;
  }

  /**
   * The card atlas of the document, else a built-in one: for Hair v2 (a hair
   * colour is set) the strand atlas of the style's preset, for older hair the
   * brown card atlas it was made with; else a plain 4-strip layout.
   */
  private cardAtlas(doc: Readonly<CharacterDoc>, style: HairStyleParams): AtlasSpec {
    if (doc.hair.atlas) return doc.hair.atlas;
    const all = this.engine.assets.catalog.hairAtlases ?? [];
    const builtIn = doc.hair.colour
      ? (all.find((a) => a.strands === style.strands) ?? all.find((a) => a.strands))
      : (all.find((a) => a.id === 'ps2cc:atlas/cards_brown') ?? all.find((a) => !a.atlas.greyscale));
    return builtIn?.atlas ?? { format: 'ps2cc.atlas/1', texture: '', regions: atlasTemplate('strips4') };
  }

  /** Create, regenerate or drop the generated card hair (PRD F5 route B). */
  private syncCardHair(doc: Readonly<CharacterDoc>, signature: string | null): void {
    if (signature === null) {
      if (this.cards) this.influenceCache.delete('hair');
      this.cards = null;
      return;
    }
    // A style put into the document by hand (or from before the groom existed) may lack newer settings;
    // the Character Creator's length, volume and fringe sliders apply on top of it.
    const own = adjustStyle(sanitiseStyle(doc.hair.style), doc.hair.adjust);
    const atlas = this.cardAtlas(doc, own);
    // The style's budget was written for 3,500 triangles; the quality profile scales it (F13).
    const style = styleForBudget(own, doc.export.hairBudget);
    // Greyscale strand atlases are coloured through the hair's gradient map.
    const gradient = atlas.greyscale ? { colour: doc.hair.colour ?? DEFAULT_HAIR_COLOUR, regions: atlas.regions } : undefined;
    const material: PartMaterial = {
      texture: atlas.texture || null,
      tint: doc.hair.tint,
      alphaCutout: true,
      alphaThreshold: doc.hair.alphaThreshold,
      doubleSided: true,
      dirt: 0,
      ditherOuter: Boolean(doc.hair.ditherOuter),
      volumeNormals: style.build.normalFromSurface > 0,
      ...(gradient ? { gradient, softAlpha: true } : {}),
    };
    if (this.cards && this.cards.signature === signature) {
      this.cards.part.material = material;
      return;
    }
    const hair = this.hairGenerator().generate(style, atlas.regions, this.engine.positions, this.engine.skeleton);
    const n = hair.positions.length / 3;
    const part: ScenePart = {
      key: 'hair',
      kind: 'hair',
      assetId: 'ps2cc:hair/cards',
      label: 'Card hair: ' + style.name,
      zDepth: 60,
      material,
      uvs: hair.uvs,
      indices: hair.indices,
      positions: hair.positions.slice(),
      normals: new Float32Array(n * 3),
      version: 0,
      triangleCount: hair.triangleCount,
      layer: hair.layer,
      hairLayer: hair.hairLayer,
    };
    computeTriangleNormals(part.positions, part.indices, n, part.normals);
    blendVolumeNormals(part.positions, part.normals, hair.volumeAxis.top, hair.volumeAxis.length, style.build.normalFromSurface);
    this.cards = { part, hair, style, regions: atlas.regions, signature, generatedFor: this.engine.geometryVersion };
    this.influenceCache.delete('hair');
  }

  /**
   * Card hair follows the body: during a drag through its binding, and once the
   * shape settles it is regenerated on the new body (exact collision). The card
   * topology never depends on the body, so the buffers are updated in place.
   */
  private updateCardHair(): void {
    const c = this.cards;
    if (!c) return;
    // Use the style these cards were made from: a new style in the document arrives with the next sync().
    if (!this.engine.interacting && c.generatedFor !== this.engine.geometryVersion) {
      const hair = this.hairGenerator().generate(c.style, c.regions, this.engine.positions, this.engine.skeleton);
      if (hair.positions.length !== c.part.positions.length || hair.indices.length !== c.part.indices.length) {
        throw new Error('card hair topology changed with the body shape');
      }
      c.hair = hair;
      c.part.positions.set(hair.positions);
      c.generatedFor = this.engine.geometryVersion;
      this.influenceCache.delete('hair');
    } else if (c.generatedFor !== this.engine.geometryVersion) {
      c.hair.binding.fit(this.engine.positions, c.part.positions);
    }
    computeTriangleNormals(c.part.positions, c.part.indices, c.part.positions.length / 3, c.part.normals);
    blendVolumeNormals(c.part.positions, c.part.normals, c.hair.volumeAxis.top, c.hair.volumeAxis.length, c.style.build.normalFromSurface);
    c.part.version++;
  }

  /**
   * Anchor every garment to the visible body of the current shape (see
   * proxy/collision.ts). Called from update() once the shape has settled and
   * after garments or hidden faces change. Expects fitted garment positions.
   */
  private anchorGarments(): void {
    this.anchoredFor = this.engine.geometryVersion;
    const garments = [...this.proxies.values()].filter((pp) => pp.part.kind === 'garment');
    if (!this.body || garments.length === 0) return;
    const body = this.body.part;
    const surface = new BodySurface(body.positions, body.normals, body.indices);
    for (const pp of garments) pp.collider = new GarmentCollider(surface, pp.fitted, pp.topo.sourceIndices);
  }

  /**
   * Remove body triangles under garments that hide the body. On the
   * full-density hm08 fallback this is MakeHuman's rule: a face goes when ANY
   * of its vertices is in delete_verts. PS2 body triangles are much larger, so
   * that rule would cut holes well past the garment edge; there a triangle goes
   * when at least two of its corners are in delete_verts, or all three are in
   * the computed coverage. The garment collider keeps cloth outside the rest.
   */
  private applyHiddenBody(doc: Readonly<CharacterDoc>): void {
    if (!this.body) return;
    const deleted = new Set<number>();
    const covered: Set<number>[] = [];
    for (const g of doc.garments) {
      if (!g.hideBody) continue;
      const pp = this.proxies.get(garmentKey(g));
      if (!pp) continue;
      for (const v of pp.proxy.deleteVerts) deleted.add(v);
      if (pp.proxy.coveredVerts.length) covered.push(new Set(pp.proxy.coveredVerts));
    }
    const full = this.body.fullIndices;
    const map = this.body.mesh ? this.body.mesh.sourceVertex : this.bodyFallbackMap!;
    const deleteThreshold = this.body.mesh === null ? 1 : DELETE_MAJORITY;
    if (deleted.size === 0 && covered.length === 0) {
      this.body.part.indices = full;
    } else {
      const keep: number[] = [];
      for (let t = 0; t < full.length; t += 3) {
        const a = map[full[t]!]!;
        const b = map[full[t + 1]!]!;
        const c = map[full[t + 2]!]!;
        const n = (deleted.has(a) ? 1 : 0) + (deleted.has(b) ? 1 : 0) + (deleted.has(c) ? 1 : 0);
        if (n >= deleteThreshold) continue;
        if (covered.some((s) => s.has(a) && s.has(b) && s.has(c))) continue;
        keep.push(full[t]!, full[t + 1]!, full[t + 2]!);
      }
      this.body.part.indices = Uint32Array.from(keep);
    }
    this.body.part.triangleCount = this.body.part.indices.length / 3;
    this.body.part.version++;
  }
}

interface WantedProxy {
  key: string;
  kind: PartKind;
  assetId: string;
  material: PartMaterial;
}

/** Brow/lash density (PRD F3) as an alpha-cutout threshold: 1 -> 0.5 (MakeHuman look), 0 -> 0.95 (sparse). */
function densityThreshold(opacity: number | undefined): number {
  const o = Math.min(1, Math.max(0, opacity ?? 1));
  return 0.5 + (1 - o) * 0.45;
}

function garmentKey(g: GarmentSlot): string {
  return `garment:${g.slot}:${g.asset}`;
}

/** Key of the card brows part (it stands in for the eyebrow mesh). */
const BROW_CARDS = 'browCards';

interface SurfaceCardPart {
  part: ScenePart;
  kind: 'fur' | 'brows';
  /** The proxy part the cards grow on. */
  source: string;
  settings: FurTrim | CardBrows;
  /** Fur: the garment edge loops chosen and the cards on each, fixed when made. */
  loops: number[][];
  counts: number[];
  seed: number;
  signature: string;
  binding: HairBinding | null;
  generatedFor: number;
}

function wantedProxies(doc: Readonly<CharacterDoc>, has: (id: string) => boolean): WantedProxy[] {
  const out: WantedProxy[] = [];
  const cutout = (tint?: Tint, threshold = 0.5): PartMaterial => ({
    texture: null,
    tint: tint ?? NEUTRAL,
    alphaCutout: true,
    alphaThreshold: threshold,
    doubleSided: true,
    dirt: 0,
  });
  const solid = (tint?: Tint): PartMaterial => ({ texture: null, tint: tint ?? NEUTRAL, alphaCutout: false, alphaThreshold: 0.5,
    doubleSided: false, dirt: 0 });
  if (doc.eyes.asset && has(doc.eyes.asset)) {
    const look = doc.eyes.look;
    out.push({
      key: 'eyes',
      kind: 'eyes',
      assetId: doc.eyes.asset,
      material: {
        ...solid(doc.eyes.tint),
        texture: look ? null : (doc.eyes.texture ?? null),
        ...(look ? { eye: { look, catchLight: doc.export.lighting === 'vertex' } } : {}),
      },
    });
  }
  if (doc.eyebrows.asset && has(doc.eyebrows.asset)) {
    out.push({ key: 'eyebrows', kind: 'eyebrows', assetId: doc.eyebrows.asset, material: cutout(doc.eyebrows.tint, densityThreshold(doc.eyebrows.opacity)) });
  }
  if (doc.eyelashes.asset && has(doc.eyelashes.asset)) {
    // Part 2 F19: lashes with soft alpha (two-pass, D-109). (Brow meshes keep the cutout: their cards' faint
    // background would show as a band.)
    out.push({ key: 'eyelashes', kind: 'eyelashes', assetId: doc.eyelashes.asset, material: { ...cutout(doc.eyelashes.tint, densityThreshold(doc.eyelashes.opacity)), softAlpha: true } });
  }
  // Teeth are decimated hard (Part 2 F19) and may keep a few inward-facing slivers: drawn double-sided.
  if (doc.teeth?.asset && has(doc.teeth.asset)) out.push({ key: 'teeth', kind: 'teeth', assetId: doc.teeth.asset, material: { ...solid(), doubleSided: true } });
  if (doc.tongue?.asset && has(doc.tongue.asset)) out.push({ key: 'tongue', kind: 'teeth', assetId: doc.tongue.asset, material: solid() });
  for (const g of doc.garments) {
    if (!has(g.asset)) continue;
    out.push({
      key: garmentKey(g),
      kind: 'garment',
      assetId: g.asset,
      material: { texture: g.paint ?? g.texture ?? null, tint: g.tint, alphaCutout: true, alphaThreshold: 0.5, doubleSided: true, dirt: g.dirt },
    });
  }
  if (doc.hair.mode === 'mesh' && doc.hair.asset && has(doc.hair.asset)) {
    out.push({
      key: 'hair',
      kind: 'hair',
      assetId: doc.hair.asset,
      material: { ...cutout(doc.hair.tint, doc.hair.alphaThreshold), texture: doc.hair.texture ?? null },
    });
  }
  return out;
}
