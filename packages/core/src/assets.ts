/** Loads the compiled core assets the engine needs at startup. */
import { readJson, type AssetSource } from './io/source';
import { headLayoutFrom, headLayoutPath, headMeshOf, type HeadLayout, type HeadLayoutFile } from './skin/headpack';
import { BaseMesh } from './mesh/basemesh';
import { ModifierSet } from './morph/modifiers';
import { TargetStore } from './morph/targets';
import { ProxyAsset, type GarmentDefaults } from './proxy/proxy';
import { RigDefinition } from './skeleton/rig';
import { RigWeights } from './skeleton/weights';
import { SkinComposer } from './skin/compose';
import { validateLandmarkTable, type LandmarkTable } from './skin/photo/project';
import { SliderCatalog } from './character/sliders';
import { Ps2BodyMesh, type BodyMeshInfo } from './mesh/ps2body';
import type { BodyMeshId } from './character/doc';
import type { AtlasSpec } from './hair/atlas';
import type { StrandPreset } from './hair/strand-atlas';
import { FaceRig } from './expression/facerig';
import { FacePoseUnits } from './expression/poseunits';
import { EXPRESSION_MAP, validateExpressionMap } from './expression/map';
import type { LicenceManifest } from './credits';
import type { CatalogMaterial } from './wardrobe/material';

export interface FaceAssets {
  rig: FaceRig;
  units: FacePoseUnits;
}

export interface CatalogProxy {
  id: string;
  category: 'eyes' | 'eyebrows' | 'eyelashes' | 'teeth' | 'tongue' | 'hair' | 'clothes';
  name: string;
  /** PS2 (decimated) version for garments; the original for everything else. */
  file: string;
  /** Full-resolution original (garments only), used by golden tests. */
  fullFile?: string;
  triangles: number;
  originalTriangles?: number;
  /** Still above the PS2 per-garment target after decimation. */
  overBudget?: boolean;
  /** Garments: where hidden body faces come from (MakeHuman delete_verts or computed at build time). */
  hiddenFaces?: 'makehuman' | 'computed' | 'none';
  slot: string | null;
  tags: string[];
  licence: string;
  /** Garments made in Garment Studio (Part 2 F18): look, fur and tint applied when put on. */
  defaults?: GarmentDefaults;
}

export interface CatalogSkin {
  id: string;
  name: string;
  texture: string;
  textureSize: [number, number];
  tags: string[];
  licence: string;
}

export interface CatalogEyeColour {
  id: string;
  name: string;
  texture: string;
}

export interface CatalogHairAtlas {
  id: string;
  name: string;
  atlas: AtlasSpec;
  licence: string;
  /** Hair v2 atlases: the strand preset they were baked with. */
  strands?: StrandPreset;
}

export interface Catalog {
  format: 'ps2cc.catalog/1';
  proxies: CatalogProxy[];
  skins: CatalogSkin[];
  eyeColours?: CatalogEyeColour[];
  bodyMeshes?: BodyMeshInfo[];
  /** Built-in hair card atlases (the first is the default for card hair). */
  hairAtlases?: CatalogHairAtlas[];
  /** The material library (Part 2 F18). */
  materials?: CatalogMaterial[];
}

/** Built by `pnpm build:landmarks` (app/frontend/e2e/build-landmarks.spec.ts). */
export const LANDMARK_TABLE = 'skin/landmarks.json';

export class CoreAssets {
  private proxyCache = new Map<string, Promise<ProxyAsset>>();
  /** The user's imported garments: how to load each one. */
  private userProxies = new Map<string, () => Promise<ProxyAsset>>();
  private bodyCache = new Map<BodyMeshId, Promise<Ps2BodyMesh>>();

  private constructor(
    readonly source: AssetSource,
    readonly base: BaseMesh,
    readonly targets: TargetStore,
    readonly modifiers: ModifierSet,
    readonly sliders: SliderCatalog,
    readonly rig: RigDefinition,
    readonly weights: RigWeights,
    readonly catalog: Catalog,
  ) {}

  static async load(source: AssetSource, onProgress?: (step: string) => void): Promise<CoreAssets> {
    onProgress?.('base mesh');
    const base = await BaseMesh.load(source);
    onProgress?.('morph targets');
    const targets = await TargetStore.load(source);
    onProgress?.('modifiers');
    const modifiers = await ModifierSet.load(source, targets);
    const sliders = new SliderCatalog(modifiers);
    onProgress?.('skeleton');
    const rig = await RigDefinition.load(source, 'game_engine');
    const weights = await RigWeights.load(source, rig, base.vertexCount);
    onProgress?.('catalog');
    const catalog = await readJson<Catalog>(source, 'catalog.json');
    return new CoreAssets(source, base, targets, modifiers, sliders, rig, weights, catalog);
  }

  private readonly heads = new Map<BodyMeshId, Promise<HeadLayout>>();

  /**
   * The head texture's UV layout for a PS2 body mesh (Part 2 F19), from
   * `skin/head/<mesh>.json` (solved here, a few seconds, if it is missing).
   */
  headLayout(id: BodyMeshId): Promise<HeadLayout> {
    let p = this.heads.get(id);
    if (!p) {
      p = (async () => {
        const mesh = await this.bodyMesh(id);
        if (!mesh) throw new Error(`unknown body mesh ${id}`);
        const file = await readJson<HeadLayoutFile>(this.source, headLayoutPath(id)).catch(() => null);
        return headLayoutFrom(this.skinComposer.layout, this.base, headMeshOf(this.skinComposer.layout, mesh), file);
      })();
      this.heads.set(id, p);
    }
    return p;
  }

  private composer: SkinComposer | null = null;
  private face: Promise<FaceAssets> | null = null;

  /**
   * MakeHuman's default rig, its weights and the face pose units, for baking
   * expression blendshapes (PRD F8). Loaded on first use.
   */
  faceAssets(): Promise<FaceAssets> {
    this.face ??= (async () => {
      const rig = await RigDefinition.load(this.source, 'default');
      const weights = await RigWeights.load(this.source, rig, this.base.vertexCount);
      const units = await FacePoseUnits.load(this.source);
      const problems = validateExpressionMap(EXPRESSION_MAP, units);
      if (problems.length) throw new Error(`expression_map.json: ${problems.join('; ')}`);
      return { rig: new FaceRig(rig, weights.sparse), units };
    })();
    return this.face;
  }
  private landmarks: Promise<LandmarkTable | null> | null = null;

  /** Skin UV layout, region masks and procedural layers (built on first use, about 0.3 s). */
  get skinComposer(): SkinComposer {
    this.composer ??= new SkinComposer(this.base, this.rig, this.weights.sparse);
    return this.composer;
  }

  /** MediaPipe landmark -> hm08 vertex table for photo projection, or null when not built yet. */
  landmarkTable(): Promise<LandmarkTable | null> {
    this.landmarks ??= readJson<unknown>(this.source, LANDMARK_TABLE)
      .then(validateLandmarkTable)
      .catch(() => null);
    return this.landmarks;
  }

  /** The manifest of every shipped file (Help → Credits). */
  licenceManifest(): Promise<LicenceManifest> {
    return readJson<LicenceManifest>(this.source, 'LICENSES.json');
  }

  proxyInfo(id: string): CatalogProxy {
    const p = this.catalog.proxies.find((e) => e.id === id);
    if (!p) throw new Error(`unknown asset ${id}`);
    return p;
  }

  hasProxy(id: string): boolean {
    return this.catalog.proxies.some((e) => e.id === id);
  }

  /** Load (and cache) a proxy asset by id; `full` loads the undecimated original of a garment. */
  proxy(id: string, opts: { full?: boolean } = {}): Promise<ProxyAsset> {
    const info = this.proxyInfo(id);
    const file = opts.full && info.fullFile ? info.fullFile : info.file;
    let p = this.proxyCache.get(file);
    if (!p) {
      p = this.userProxies.get(id)?.() ?? ProxyAsset.load(this.source, file);
      this.proxyCache.set(file, p);
      p.catch(() => this.proxyCache.delete(file));
    }
    return p;
  }

  /** Add an imported garment to the catalog (replaces an entry with the same id). */
  addUserProxy(info: CatalogProxy, load: () => Promise<ProxyAsset>): void {
    this.removeUserProxy(info.id);
    this.catalog.proxies.push(info);
    this.userProxies.set(info.id, load);
  }

  removeUserProxy(id: string): void {
    if (!this.userProxies.delete(id)) return;
    const i = this.catalog.proxies.findIndex((p) => p.id === id);
    if (i >= 0) this.proxyCache.delete(this.catalog.proxies.splice(i, 1)[0]!.file);
  }

  /** Resolve a texture reference: catalog ids (mh:eyecolour/...) map to their file; paths pass through. */
  textureFor(ref: string | null | undefined): string | null {
    if (!ref) return null;
    const eye = this.catalog.eyeColours?.find((e) => e.id === ref);
    return eye ? eye.texture : ref;
  }

  skin(id: string): CatalogSkin | undefined {
    return this.catalog.skins.find((s) => s.id === id);
  }

  /** The PS2 body topology (built at compile time), or null when not compiled yet. */
  bodyMesh(id: BodyMeshId): Promise<Ps2BodyMesh> | null {
    if (!this.catalog.bodyMeshes?.some((b) => b.id === id)) return null;
    let p = this.bodyCache.get(id);
    if (!p) {
      p = Ps2BodyMesh.load(this.source, id);
      this.bodyCache.set(id, p);
    }
    return p;
  }
}
