/**
 * Studio: owns the engine, the character scene and the viewport, and keeps
 * them in sync. UI components read from it through hooks (state/hooks.ts).
 */
import {
  CharacterEngine,
  CharacterScene,
  CoreAssets,
  bakeInputs,
  bakeSignature,
  DEFAULT_BAKE,
  defaultCharacter,
  DEFAULT_PROFILE,
  garmentBakeStrength,
  type BakeSettings,
  baseBodyObj,
  FetchAssetSource,
  importGarment,
  bodySurface,
  editMeshToRaw,
  moveToBody,
  remapTexture,
  type EditMesh,
  type GarmentDefaults,
  type BodySurface,
  parseCharacter,
  ProxyAsset,
  readJson,
  referenceBody,
  SLOT_BUDGET,
  serializeCharacter,
  type CatalogProxy,
  type CharacterDoc,
  type ImportedGarment,
  type ImportSlot,
  type ProxyMeta,
  type RawGarmentMesh,
  type ReferenceBody,
  type RgbaImage,
  editMeshFromProxy,
  bodySurfaceAt,
  garmentTexture,
  materialFile,
  outfitFromCharacter,
  userMaterial,
  type ConvertedMaterial,
  type MaterialAdjust,
  type MaterialKind,
} from '@ps2cc/core';
import { BakeCancelled, resolveAssetUrl, Viewport, type BakedMap } from '@ps2cc/viewport';
import { backend, isDesktop, libraryUrl, type AppInfo, type GarmentFile, type Settings } from '../backend';
import { decodeImage, imageToPng } from '../images';
import { ThumbnailStage } from '../thumbs/stage';
import { loadUserMaterials, refreshUserLibrary, useLibrary } from './library';
import { useUi } from './ui';

type Listener = () => void;

function decode(base64: string): ArrayBuffer {
  const s = atob(base64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out.buffer;
}

function decodeGarment(f: GarmentFile): RawGarmentMesh {
  return {
    positions: new Float32Array(decode(f.positions)),
    uvs: new Float32Array(decode(f.uvs)),
    faceVerts: new Uint32Array(decode(f.faceVerts)),
    faceUvs: new Uint32Array(decode(f.faceUvs)),
    hasUvs: f.hasUvs,
  };
}

/** The Wardrobe entry of an imported garment. */
function garmentEntry(meta: ProxyMeta, file: string): CatalogProxy {
  return {
    id: meta.id,
    category: 'clothes',
    name: meta.name,
    file,
    triangles: meta.faceCount,
    originalTriangles: meta.originalTriangles,
    hiddenFaces: meta.hiddenFaces,
    overBudget: meta.faceCount > (SLOT_BUDGET[meta.slot ?? 'accessory'] ?? 0) * 1.03,
    slot: meta.slot ?? 'accessory',
    tags: meta.tags,
    licence: 'user',
    ...(meta.defaults ? { defaults: meta.defaults } : {}),
  };
}

export class Studio {
  private listeners = new Set<Listener>();
  private version = 0;
  viewport: Viewport | null = null;
  /** Serialized document as last saved/loaded (dirty tracking and A/B compare). */
  private savedText: string;
  private syncing: Promise<void> = Promise.resolve();
  private autosaveTimer: number | null = null;
  /** App settings (first-run setup, budgets, Unity project); new characters start from them. */
  settings: Settings | null = null;
  /** The body garments are bound to (built on first import). */
  private garmentBody: ReferenceBody | null = null;
  /** Bake engine (F16): what is shown, what is running, and its status for the UI. */
  private baked: { signature: string; maps: Map<string, BakedMap> } | null = null;
  private bakeRun: { signature: string; cancel: boolean; done: Promise<void> } | null = null;
  private bakeTimer: number | null = null;
  /**
   * Bake in the background after changes. Off unless chosen in Settings: the
   * bake is the user's to start (Bake in the status bar), and an export with a
   * bake option bakes first. Always off in e2e runs, which bake on request.
   */
  autoBake = false;
  /** Override the bake settings (tests bake small maps). */
  bakeOverride: Partial<BakeSettings> | null = null;
  /** `stale`: a bake option is on and the character changed since the last bake (or was never baked). */
  bakeStatus: { state: 'off' | 'waiting' | 'stale' | 'baking' | 'done' | 'failed'; progress: number; ms: number; timings: Record<string, number> } = {
    state: 'off',
    progress: 0,
    ms: 0,
    timings: {},
  };

  private constructor(
    readonly info: AppInfo,
    readonly assets: CoreAssets,
    readonly engine: CharacterEngine,
    readonly scene: CharacterScene,
  ) {
    this.savedText = serializeCharacter(engine.doc as CharacterDoc);
    engine.onChange((kind) => {
      if (kind === 'geometry') {
        this.scene.update();
        this.viewport?.refresh();
        this.scheduleBake();
      }
      if (kind === 'doc') this.queueSync();
      this.bump();
    });
  }

  static async create(onProgress: (step: string) => void): Promise<Studio> {
    const info = await backend.info();
    const assets = await CoreAssets.load(new FetchAssetSource(info.coreAssetsUrl), onProgress);
    onProgress('your garments');
    await Studio.loadUserGarments(info, assets);
    onProgress('your materials');
    await loadUserMaterials(info, assets);
    onProgress('character');
    const engine = new CharacterEngine(assets, defaultCharacter('Untitled'));
    // The scene decodes images itself for photo projection (the photo and the base skin for colour matching).
    const scene = new CharacterScene(engine, { loadImage: (url) => decodeImage(resolveAssetUrl(info.coreAssetsUrl, url)) });
    await scene.sync();
    const studio = new Studio(info, assets, engine, scene);
    backend.log('info', `assets loaded: ${assets.modifiers.list.length} modifiers, ${assets.targets.size} targets`);
    return studio;
  }

  /** Add the garments in the library to the Wardrobe. One unreadable entry must not stop the app. */
  private static async loadUserGarments(info: AppInfo, assets: CoreAssets): Promise<void> {
    const library = new FetchAssetSource(info.libraryUrl);
    for (const item of await backend.listLibrary('garments')) {
      if (!item.file.endsWith('.json')) continue;
      try {
        const meta = await readJson<ProxyMeta>(library, item.file);
        assets.addUserProxy(garmentEntry(meta, item.file), () => ProxyAsset.load(library, item.file));
      } catch (err) {
        backend.log('warn', `skipping garment ${item.file}: ${String(err)}`);
      }
    }
  }

  // ------------------------------------------------------------ subscription

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getVersion = (): number => this.version;

  private bump(): void {
    this.version++;
    for (const l of this.listeners) l();
  }

  // ------------------------------------------------------------ viewport

  attachViewport(canvas: HTMLCanvasElement): Viewport {
    this.viewport?.dispose();
    const vp = new Viewport(canvas, {
      assetBaseUrl: this.info.coreAssetsUrl,
      onPick: (key) => useUi.getState().select(key),
    });
    vp.setCharacter(this.scene);
    vp.setCameraPreset('full');
    vp.start();
    this.viewport = vp;
    this.scheduleBake(0);
    return vp;
  }

  detachViewport(): void {
    // Baked maps live on the viewport's renderer: bake again on the next one.
    if (this.bakeRun) this.bakeRun.cancel = true;
    if (this.baked) for (const m of this.baked.maps.values()) m.release();
    this.baked = null;
    this.viewport?.dispose();
    this.viewport = null;
  }

  private queueSync(): void {
    this.syncing = this.syncing
      .then(() => this.scene.sync())
      .then(() => {
        this.viewport?.refresh();
        this.scheduleBake();
        this.bump();
      })
      .catch((err: unknown) => useUi.getState().error('Could not update the character', err));
  }

  /** Resolves when pending asset loads (garments, hair, photo) are applied and the skin is composited. */
  async settled(): Promise<void> {
    await this.syncing;
    await this.viewport?.skinSettled();
  }

  // ------------------------------------------------------------ bake engine (Part 2 F16)

  /** Bake settings for the current document: the map size follows the body texture. */
  bakeSettings(): BakeSettings {
    const ex = this.engine.doc.export;
    return { ...DEFAULT_BAKE, size: Math.min(1024, Math.max(512, ex.bodyTexture)), ...(this.bakeOverride ?? {}) };
  }

  /** The character changed: rebake shortly after it stops changing if auto-bake is on (F16), else mark the bake out of date. */
  scheduleBake(delayMs = 800): void {
    if (!this.autoBake) {
      this.refreshBakeState();
      return;
    }
    if (this.bakeTimer !== null) window.clearTimeout(this.bakeTimer);
    this.bakeTimer = window.setTimeout(() => {
      this.bakeTimer = null;
      void this.runBake();
    }, delayMs);
    if (this.wantsBake() && this.bakeStatus.state !== 'baking') this.setBakeStatus({ state: 'waiting', progress: 0 });
  }

  /** Manual baking: whether the shown bake still matches the character. Starts no bake. */
  private refreshBakeState(): void {
    if (this.bakeRun) return; // the run's end calls this again
    if (!this.wantsBake()) {
      // A bake option was turned off: take the baked maps away (cheap, no bake).
      if (this.baked || this.bakeStatus.state !== 'off') void this.runBake();
      return;
    }
    const current = this.baked?.signature === bakeSignature(this.scene, this.bakeSettings());
    const state = current ? 'done' : this.bakeStatus.state === 'failed' ? 'failed' : 'stale';
    if (state !== this.bakeStatus.state) this.setBakeStatus({ state, progress: current ? 1 : 0 });
  }

  /** Whether the viewport shows a bake (possibly an out-of-date one). */
  get hasBake(): boolean {
    return this.baked !== null;
  }

  /** Auto-bake on or off, kept in settings. */
  setAutoBake(on: boolean): void {
    this.autoBake = on;
    if (this.settings) {
      this.settings = { ...this.settings, autoBake: on };
      backend.saveSettings(this.settings).catch((err: unknown) => backend.log('warn', `saving settings failed: ${String(err)}`));
    }
    if (on) this.scheduleBake(0);
    this.bump();
  }

  private wantsBake(): boolean {
    const ex = this.engine.doc.export;
    return ex.bakeAO || ex.bakeLight;
  }

  private setBakeStatus(patch: Partial<Studio['bakeStatus']>): void {
    this.bakeStatus = { ...this.bakeStatus, ...patch };
    this.bump();
  }

  /** Bake now if the character changed since the last bake. Resolves when the maps are on the character. */
  async runBake(): Promise<void> {
    const vp = this.viewport;
    if (!vp) return;
    if (this.engine.interacting) {
      if (this.autoBake) this.scheduleBake();
      return;
    }
    await this.syncing;
    if (!this.wantsBake()) {
      if (this.bakeRun) this.bakeRun.cancel = true;
      if (this.baked) {
        for (const m of this.baked.maps.values()) m.release();
        this.baked = null;
        vp.setBakeMaps(new Map());
        await this.scene.setBakedBody(null);
        vp.refresh();
      }
      this.setBakeStatus({ state: 'off', progress: 0 });
      return;
    }
    const settings = this.bakeSettings();
    const signature = bakeSignature(this.scene, settings);
    if (this.baked?.signature === signature) {
      this.applyBakeStrengths();
      if (this.bakeStatus.state !== 'done') this.setBakeStatus({ state: 'done', progress: 1 });
      return;
    }
    if (this.bakeRun?.signature === signature) return this.bakeRun.done;
    if (this.bakeRun) this.bakeRun.cancel = true;
    const run = { signature, cancel: false, done: Promise.resolve() };
    run.done = (async () => {
      const t0 = performance.now();
      this.setBakeStatus({ state: 'baking', progress: 0 });
      try {
        const inputs = bakeInputs(this.scene, settings);
        const result = await vp.baker.bake(
          inputs,
          settings,
          (done, total) => {
            this.bakeStatus = { ...this.bakeStatus, progress: done / total };
            if (done % 4 === 0) this.bump();
          },
          () => run.cancel,
        );
        if (run.cancel) {
          for (const m of result.maps.values()) m.release();
          return;
        }
        if (this.baked) for (const m of this.baked.maps.values()) m.release();
        this.baked = { signature, maps: result.maps };
        this.applyBakeStrengths();
        const body = result.maps.get('body');
        await this.scene.setBakedBody(body ? { image: body.image, key: signature } : null);
        vp.refresh();
        const ms = Math.round(performance.now() - t0);
        backend.log('info', `bake ${settings.size}px x ${settings.rays} rays: ${ms} ms (${JSON.stringify(result.timings)})`);
        this.setBakeStatus({ state: 'done', progress: 1, ms, timings: result.timings });
      } catch (err) {
        if (err instanceof BakeCancelled) return;
        this.setBakeStatus({ state: 'failed', progress: 0 });
        backend.log('warn', `bake failed: ${String(err)}`);
      } finally {
        if (this.bakeRun === run) {
          this.bakeRun = null;
          // Changed while baking? (Auto-bake has already queued the next bake.)
          if (!this.autoBake) this.refreshBakeState();
        }
      }
    })();
    this.bakeRun = run;
    return run.done;
  }

  /** Garments show their baked maps in the viewport at the strengths the export will use. */
  private applyBakeStrengths(): void {
    const vp = this.viewport;
    if (!vp || !this.baked) return;
    const s = garmentBakeStrength(this.engine.doc.export.bakeLight);
    const shown = new Map<string, { texture: BakedMap['texture']; ao: number; cavity: number; light: number }>();
    for (const [key, m] of this.baked.maps) if (key !== 'body') shown.set(key, { texture: m.texture, ...s });
    vp.setBakeMaps(shown);
  }

  /** Resolves when the baked maps match the character (export waits for this). */
  async bakeSettled(): Promise<void> {
    if (!this.wantsBake()) return;
    if (this.bakeTimer !== null) {
      window.clearTimeout(this.bakeTimer);
      this.bakeTimer = null;
    }
    await this.runBake();
  }

  /** The baked map of a part (rows top first), if the current bake has one. */
  bakedImage(partKey: string): BakedMap['image'] | null {
    return this.baked?.maps.get(partKey)?.image ?? null;
  }

  // ------------------------------------------------------------ custom garments (PRD F4)

  /** Fit a mesh read from a file, store it in the library and add it to the Wardrobe. */
  async importGarment(file: GarmentFile, options: { name: string; slot: ImportSlot }): Promise<ImportedGarment> {
    this.garmentBody ??= referenceBody(this.assets);
    const garment = await importGarment(decodeGarment(file), { ...options, body: this.garmentBody });
    const item = await backend.saveGarment(JSON.stringify(garment.meta), garment.bin);
    this.assets.addUserProxy(garmentEntry(garment.meta, item.file), () => Promise.resolve(garment.proxy));
    this.bump();
    return garment;
  }

  /**
   * Save a garment edited in Garment Studio (Part 2 F18) as a new library
   * garment. `edit` is on the body it was edited on (`editedOn`); it is moved
   * onto the reference body, imported like a modelled garment (M10), and gets
   * its texture remapped to the edited UVs from `texture` (the original's).
   */
  async saveStudioGarment(
    edit: EditMesh,
    editedOn: BodySurface,
    options: { name: string; slot: ImportSlot; texture: string | null; textureImage?: RgbaImage; defaults?: GarmentDefaults },
  ): Promise<ImportedGarment> {
    this.garmentBody ??= referenceBody(this.assets);
    const onRef = moveToBody(edit, editedOn, bodySurface(this.garmentBody));
    const garment = await importGarment(editMeshToRaw(onRef), { name: options.name, slot: options.slot, body: this.garmentBody });
    const original = options.textureImage ?? null;
    const fromFile = !original && options.texture ? await decodeImage(resolveAssetUrl(this.info.coreAssetsUrl, options.texture)).catch(() => null) : null;
    const tex = remapTexture(original ?? fromFile, edit, 1024);
    const stem = garment.meta.binary.replace(/\.bin$/, '');
    const item = await backend.importFile('garment-textures', new File([await imageToPng(tex)], `${stem}.png`, { type: 'image/png' }));
    garment.meta.material = { diffuseColor: [0.8, 0.8, 0.8], transparent: false, backfaceCull: false, opacity: 1, diffuseTexture: libraryUrl(this.info, item.file), textureSize: [tex.width, tex.height] };
    garment.meta.tags = ['user', 'garment-studio'];
    if (options.defaults) garment.meta.defaults = options.defaults;
    const saved = await backend.saveGarment(JSON.stringify(garment.meta), garment.bin);
    this.assets.addUserProxy(garmentEntry(garment.meta, saved.file), () => Promise.resolve(garment.proxy));
    this.bump();
    return garment;
  }

  /**
   * Texture Studio on a garment (Part 2 F20): save the garment as it looks now
   * (its look, paint and tint composed into one texture) as a new library
   * garment with the same shape, and wear it in place of the original.
   */
  async saveTexturedGarment(partKey: string, name: string): Promise<ImportedGarment> {
    const garment = this.engine.doc.garments.find((g) => `garment:${g.slot}:${g.asset}` === partKey);
    const part = this.scene.parts.find((p) => p.key === partKey);
    if (!garment || !part) throw new Error('that garment is not worn');
    await this.settled();
    const proxy = await this.assets.proxy(garment.asset);
    const positions = this.engine.positions.slice();
    const edit = editMeshFromProxy(proxy, { positions } as ReferenceBody);
    const texture = await garmentTexture(part, 1024, (url) => decodeImage(resolveAssetUrl(this.info.coreAssetsUrl, url)));
    const body = bodySurfaceAt(this.assets, positions);
    const saved = await this.saveStudioGarment(edit, body, { name, slot: garment.slot, texture: null, textureImage: texture });
    this.engine.update('Save garment texture', (d) => {
      const i = d.garments.findIndex((g) => g.asset === garment.asset);
      if (i >= 0) d.garments[i] = { slot: garment.slot, asset: saved.meta.id, tint: { color: [1, 1, 1], brightness: 1 }, dirt: 0, hideBody: garment.hideBody, ...(garment.fur ? { fur: garment.fur } : {}) };
    });
    return saved;
  }

  /** Texture Studio on the skin: save the composited skin (base and every layer) as a library skin. Returns its URL. */
  async saveSkinTexture(name: string): Promise<string> {
    const vp = this.viewport;
    if (!vp) throw new Error('the viewport is not ready');
    await this.settled();
    const img = vp.skinComposite();
    if (!img) throw new Error('the skin has no layers to save');
    const item = await backend.importFile('skins', new File([await imageToPng(img)], `${name.replace(/[^\w -]/g, '_') || 'skin'}.png`, { type: 'image/png' }));
    await refreshUserLibrary(this);
    return libraryUrl(this.info, item.file);
  }

  /** Material Studio: save a converted material to the library. Returns its id (a material of the same name is replaced). */
  async saveMaterial(name: string, kind: MaterialKind, tileMetres: number, converted: ConvertedMaterial, from: string | null, adjust: MaterialAdjust): Promise<string> {
    const file = materialFile(name, kind, tileMetres, converted, 'diffuse.png', from, adjust);
    const item = await backend.saveMaterial(name, JSON.stringify(file, null, 2), await imageToPng(converted.diffuse));
    const doc = JSON.parse(await backend.readLibraryDocument(item.file)) as { material: { diffuse: string } };
    const diffuse = libraryUrl(this.info, `materials/${doc.material.diffuse}`);
    this.scene.garmentLooks.forgetMaterial(item.id);
    this.thumbnails.forget(`material:${item.id}`);
    this.assets.addUserMaterial(userMaterial({ ...file.material, diffuse: doc.material.diffuse }, item.id, diffuse));
    useLibrary.setState((st) => ({ version: st.version + 1 }));
    this.bump();
    return item.id;
  }

  /** Save what the character wears as an outfit. */
  async saveOutfit(name: string): Promise<void> {
    await backend.saveOutfit(name, JSON.stringify(outfitFromCharacter(this.engine.doc, name), null, 2));
    await refreshUserLibrary(this);
  }

  private stage: ThumbnailStage | null = null;

  /** Look-matched library thumbnails (Part 2 F20), made on first use. */
  get thumbnails(): ThumbnailStage {
    return (this.stage ??= new ThumbnailStage(this));
  }

  /** Take a garment off the character and out of the library. */
  async deleteGarment(id: string): Promise<void> {
    const { file } = this.assets.proxyInfo(id);
    if (this.engine.doc.garments.some((g) => g.asset === id)) {
      this.engine.update('Remove garment', (d) => void (d.garments = d.garments.filter((g) => g.asset !== id)));
      await this.settled();
    }
    await backend.deleteLibraryItem(file);
    this.assets.removeUserProxy(id);
    this.bump();
  }

  /** Save the body garments are modelled around. Returns the path, or '' if cancelled. */
  exportBaseBody(): Promise<string> {
    return backend.saveBaseBody(baseBodyObj(this.assets));
  }

  // ------------------------------------------------------------ documents

  get dirty(): boolean {
    return serializeCharacter(this.engine.doc as CharacterDoc) !== this.savedText;
  }

  get savedDocText(): string {
    return this.savedText;
  }

  /** A new character with the app settings applied (quality profile, Unity project). */
  newDocument(name = 'Untitled'): CharacterDoc {
    const s = this.settings;
    const doc = defaultCharacter(name, s?.qualityProfile ?? DEFAULT_PROFILE);
    if (s?.unityProject) doc.export.unityProject = s.unityProject;
    return doc;
  }

  newCharacter(): void {
    this.engine.load(this.newDocument());
    this.currentPath = null;
    this.savedText = serializeCharacter(this.engine.doc as CharacterDoc);
    this.bump();
  }

  /**
   * Load a character document. `unsaved` keeps it marked as changed (a
   * restored autosave is not the saved file).
   */
  loadText(text: string, opts: { unsaved?: boolean; path?: string } = {}): void {
    const doc = parseCharacter(JSON.parse(text));
    this.engine.load(doc);
    this.currentPath = opts.path || null;
    this.savedText = opts.unsaved ? '' : serializeCharacter(this.engine.doc as CharacterDoc);
    this.bump();
    const missing = doc.garments.filter((g) => !this.assets.hasProxy(g.asset));
    if (missing.length) useUi.getState().error(`${missing.length} garment${missing.length > 1 ? 's are' : ' is'} no longer in the library: ${missing.map((g) => g.asset.replace(/^user:garment\//, '')).join(', ')}`);
  }

  /** Open a saved character by path (character browser). */
  async openPath(path: string): Promise<void> {
    this.loadText(await backend.load(path), { path });
  }

  /**
   * The file the character came from or was last saved as: Ctrl+S saves over
   * it, wherever it is (M18). Null for a new character, which is saved into
   * the data folder under its name.
   */
  currentPath: string | null = null;

  /** Thumbnail for the character browser: the full-body camera, 256 x 320, written beside the renders. */
  async saveThumbnail(): Promise<void> {
    const vp = this.viewport;
    if (!vp) return;
    await this.settled();
    const png = await vp.screenshotFromPreset('full', 256, 320);
    await backend.saveRender(this.engine.doc.name, 'thumb', png);
  }

  async save(as = false): Promise<string | null> {
    const text = serializeCharacter(this.engine.doc as CharacterDoc);
    const path = as ? await backend.saveAs(text, this.engine.doc.name) : await backend.save(text, this.currentPath);
    if (!path) return null;
    if (as || this.currentPath) this.currentPath = path;
    this.savedText = text;
    this.bump();
    // The character browser shows a thumbnail per saved character (desktop only; browser mode would download it).
    if (isDesktop()) await this.saveThumbnail().catch((err: unknown) => backend.log('warn', `thumbnail failed: ${String(err)}`));
    return path;
  }

  async open(): Promise<boolean> {
    const opened = await backend.open();
    if (!opened) return false;
    this.loadText(opened.doc, { path: opened.path });
    return true;
  }

  duplicate(): void {
    const doc = structuredClone(this.engine.doc) as CharacterDoc;
    doc.id = crypto.randomUUID();
    doc.name = `${doc.name} copy`;
    this.engine.load(doc);
    this.currentPath = null;
    this.savedText = '';
    this.bump();
  }

  /** Autosave every N minutes while there are unsaved changes (PRD F10). */
  startAutosave(minutes: number): void {
    if (this.autosaveTimer !== null) window.clearInterval(this.autosaveTimer);
    this.autosaveTimer = window.setInterval(() => {
      if (!this.dirty) return;
      backend
        .autosave(serializeCharacter(this.engine.doc as CharacterDoc))
        .catch((err: unknown) => backend.log('error', `autosave failed: ${String(err)}`));
    }, minutes * 60_000);
  }
}
