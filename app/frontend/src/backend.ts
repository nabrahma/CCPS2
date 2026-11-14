/**
 * Bridge to the Go backend. In the desktop app Wails injects `window.go` and
 * `window.runtime`; in a plain browser (dev server, Playwright) we fall back to
 * localStorage so the UI stays testable. Generated wailsjs bindings are not
 * imported on purpose: they only exist after `wails build`.
 */
import type { QualityProfileId } from '@ps2cc/core';

export interface AppInfo {
  version: string;
  coreAssetsUrl: string;
  libraryUrl: string;
  root: string;
  logDir: string;
  recoveryPath: string;
  recoveryModified: string;
  /** Asset-server prefix of character browser thumbnails (desktop only). */
  charactersUrl?: string;
  /** Backend process id (desktop only; used by the M9 crash-recovery test). */
  pid?: number;
}

/** Where characters, the library and settings are kept (M18). */
export interface DataFolder {
  path: string;
  default: string;
  isDefault: boolean;
  /** Set by PS2CC_HOME: not changeable in the app. */
  fromEnv: boolean;
  /** Why the chosen folder is not used this time ('' when it is). */
  fallback: string;
}

/** What choosing a folder as the data folder would do. */
export interface MovePlan {
  root: string;
  mode: 'copy' | 'use';
  files: number;
  bytes: number;
}

export interface CharacterInfo {
  name: string;
  path: string;
  modified: string;
  /** A recent character saved outside the data folder. */
  external?: boolean;
  /** Thumbnail URL on the app's asset server, when the character has one. */
  thumb?: string;
}

export interface LibraryItem {
  id: string;
  kind: string;
  name: string;
  file: string;
  thumb: string;
  width: number;
  height: number;
  hasAlpha: boolean;
}

export interface Settings {
  unityProject: string;
  triangleBudget: number;
  hardMax: number;
  headTexture: number;
  bodyTexture: number;
  autosaveMinutes: number;
  firstRunCompleted: boolean;
  curatedView: boolean;
  symmetry: boolean;
  /** The quality profile new characters start with (F13). */
  qualityProfile: QualityProfileId;
  /** Material Painter's executable chosen by the user ('' finds it in the usual install folders; D-115). */
  materialPainter?: string;
  /** Library browser (Part 2 F20): starred entries, and the user's own tags per entry. */
  favourites?: string[];
  libraryTags?: Record<string, string[]>;
}

/** Where Material Painter is (Texture Studio, D-115). */
export interface PainterInfo {
  exe: string;
  found: boolean;
}

/** What Material Painter painted, and the reference it painted over (PNG, base64). */
export interface PaintResult {
  painted: string;
  reference: string;
}

/** What an export wrote (app/backend/exporter.Result). */
export interface ExportResult {
  dir: string;
  files: string[];
  bytes: number;
}

/** A garment mesh read by the backend: little-endian typed arrays in base64. */
export interface GarmentFile {
  name: string;
  positions: string;
  uvs: string;
  faceVerts: string;
  faceUvs: string;
  hasUvs: boolean;
  triangles: number;
}

interface GoApp {
  Info(): Promise<AppInfo>;
  Log(level: string, message: string): Promise<void>;
  SaveCharacter(doc: string): Promise<string>;
  SaveCharacterAs(doc: string, name: string): Promise<string>;
  OpenCharacter(): Promise<{ path: string; doc: string } | null>;
  SaveCharacterTo(path: string, doc: string): Promise<string>;
  DataFolder(): Promise<DataFolder>;
  ChooseDataFolder(): Promise<MovePlan | null>;
  PlanDataFolder(dir: string): Promise<MovePlan>;
  MoveDataFolder(dir: string): Promise<MovePlan>;
  UseDefaultDataFolder(): Promise<void>;
  Restart(): Promise<void>;
  LoadCharacter(path: string): Promise<string>;
  ListCharacters(): Promise<CharacterInfo[] | null>;
  Autosave(doc: string): Promise<string>;
  SaveRender(name: string, file: string, pngBase64: string): Promise<string>;
  SaveTexture(name: string, file: string, pngBase64: string): Promise<string>;
  SaveImageAs(suggestedName: string, pngBase64: string): Promise<string>;
  SaveLookAs(suggestedName: string, lookJson: string): Promise<string>;
  PickAndImport(kind: string): Promise<LibraryItem[] | null>;
  ImportPath(kind: string, path: string): Promise<LibraryItem>;
  ImportBytes(kind: string, fileName: string, base64: string): Promise<LibraryItem>;
  ListLibrary(kind: string): Promise<LibraryItem[] | null>;
  DeleteLibraryItem(file: string): Promise<void>;
  SaveAtlas(imageFile: string, atlasJson: string): Promise<string>;
  LoadAtlas(imageFile: string): Promise<string>;
  SaveHairstyle(name: string, styleJson: string): Promise<LibraryItem>;
  SavePreset(name: string, presetJson: string): Promise<LibraryItem>;
  SaveOutfit(name: string, outfitJson: string): Promise<LibraryItem>;
  SaveMaterial(name: string, materialJson: string, diffuseBase64: string): Promise<LibraryItem>;
  ReadLibraryDocument(file: string): Promise<string>;
  PickGarmentFile(): Promise<string>;
  ReadGarment(path: string): Promise<GarmentFile>;
  SaveGarment(metaJson: string, binBase64: string): Promise<LibraryItem>;
  SaveBaseBody(objText: string): Promise<string>;
  GetSettings(): Promise<Settings>;
  SaveSettings(s: Settings): Promise<void>;
  PickUnityProject(): Promise<string>;
  CheckUnityProject(dir: string): Promise<string>;
  ExportCharacter(messageBase64: string, target: string): Promise<ExportResult>;
  ChooseExportFolder(): Promise<string>;
  OpenFolder(dir: string): Promise<void>;
  OpenLogFolder(): Promise<void>;
  PainterStatus(): Promise<PainterInfo>;
  PainterLocate(): Promise<string>;
  PainterEnableAgents(): Promise<void>;
  PainterHasSession(character: string, target: string): Promise<boolean>;
  PainterOpen(character: string, target: string, objText: string, referenceBase64: string, size: number): Promise<void>;
  PainterCollect(character: string, target: string): Promise<PaintResult>;
}

interface WailsRuntime {
  OnFileDrop(cb: (x: number, y: number, paths: string[]) => void, useDropTarget: boolean): void;
  OnFileDropOff(): void;
  EventsOn?(name: string, cb: (...args: never[]) => void): () => void;
}

declare global {
  interface Window {
    go?: { main?: { App?: GoApp } };
    runtime?: WailsRuntime;
  }
}

const go = (): GoApp | null => window.go?.main?.App ?? null;

export const isDesktop = (): boolean => go() !== null;

const DEFAULT_SETTINGS: Settings = {
  unityProject: '',
  triangleBudget: 12000,
  hardMax: 15000,
  headTexture: 1024,
  bodyTexture: 1024,
  autosaveMinutes: 2,
  firstRunCompleted: false,
  curatedView: true,
  symmetry: true,
  qualityProfile: 'enhanced',
};

function browserOnly(feature: string): never {
  throw new Error(`${feature} needs the desktop app (running in a browser)`);
}

export const backend = {
  async info(): Promise<AppInfo> {
    const g = go();
    if (g) return g.Info();
    return { version: 'browser', coreAssetsUrl: '/core', libraryUrl: '/library', root: '', logDir: '', recoveryPath: '', recoveryModified: '' };
  },
  log(level: 'info' | 'warn' | 'error', message: string): void {
    const g = go();
    if (g) void g.Log(level, message);
    else console[level === 'warn' ? 'warn' : level === 'error' ? 'error' : 'info'](`[ps2cc] ${message}`);
  },
  /** Save a character: over `path` when it has one (opened or saved as), else into the data folder by its name. */
  async save(doc: string, path: string | null = null): Promise<string> {
    const g = go();
    if (g) return path ? g.SaveCharacterTo(path, doc) : g.SaveCharacter(doc);
    localStorage.setItem('ps2cc:last', doc);
    return 'browser:localStorage';
  },
  async saveAs(doc: string, name: string): Promise<string> {
    const g = go();
    if (g) return g.SaveCharacterAs(doc, name);
    return backend.save(doc);
  },
  /** Ask for a character file: its path and text, or null when cancelled. */
  async open(): Promise<{ path: string; doc: string } | null> {
    const g = go();
    if (g) return (await g.OpenCharacter()) ?? null;
    const doc = localStorage.getItem('ps2cc:last');
    return doc ? { path: '', doc } : null;
  },
  async dataFolder(): Promise<DataFolder> {
    const g = go();
    if (g) return g.DataFolder();
    return { path: 'browser storage', default: 'browser storage', isDefault: true, fromEnv: false, fallback: '' };
  },
  async chooseDataFolder(): Promise<MovePlan | null> {
    const g = go();
    return g ? ((await g.ChooseDataFolder()) ?? null) : browserOnly('Choosing a data folder');
  },
  async moveDataFolder(dir: string): Promise<MovePlan> {
    const g = go();
    return g ? g.MoveDataFolder(dir) : browserOnly('Moving the data folder');
  },
  async useDefaultDataFolder(): Promise<void> {
    const g = go();
    return g ? g.UseDefaultDataFolder() : browserOnly('Moving the data folder');
  },
  async restart(): Promise<void> {
    const g = go();
    return g ? g.Restart() : window.location.reload();
  },
  /** Copy progress while the data folder moves (desktop only). */
  onDataFolderProgress(cb: (done: number, total: number) => void): () => void {
    const rt = window.runtime;
    if (!rt?.EventsOn) return () => undefined;
    return rt.EventsOn('datafolder:progress', cb);
  },
  async load(path: string): Promise<string> {
    const g = go();
    if (g) return g.LoadCharacter(path);
    return localStorage.getItem('ps2cc:last') ?? browserOnly('Loading files');
  },
  async listCharacters(): Promise<CharacterInfo[]> {
    const g = go();
    return g ? ((await g.ListCharacters()) ?? []) : [];
  },
  async autosave(doc: string): Promise<void> {
    const g = go();
    if (g) await g.Autosave(doc);
    else localStorage.setItem('ps2cc:autosave', doc);
  },
  async saveRender(name: string, file: string, png: Blob): Promise<string> {
    const g = go();
    if (!g) return download(png, `${file}.png`);
    return g.SaveRender(name, file, await blobToBase64(png));
  },
  /** Save an exported texture to Characters/<name>/textures (browser: download). */
  async saveTexture(name: string, file: string, png: Blob): Promise<string> {
    const g = go();
    if (!g) return download(png, `${file}.png`);
    return g.SaveTexture(name, file, await blobToBase64(png));
  },
  /** Ask where to save a PNG (UV templates). Returns the path, or '' if cancelled. */
  async saveImageAs(suggestedName: string, png: Blob): Promise<string> {
    const g = go();
    if (!g) return download(png, suggestedName);
    return g.SaveImageAs(suggestedName, await blobToBase64(png));
  },
  /** Ask where to save a .ps2look. Returns the path, or '' if cancelled. */
  async saveLookAs(suggestedName: string, lookJson: string): Promise<string> {
    const g = go();
    if (!g) return download(new Blob([lookJson], { type: 'application/json' }), suggestedName);
    return g.SaveLookAs(suggestedName, lookJson);
  },
  async pickAndImport(kind: string): Promise<LibraryItem[]> {
    const g = go();
    return g ? ((await g.PickAndImport(kind)) ?? []) : browserOnly('Library import');
  },
  async importPath(kind: string, path: string): Promise<LibraryItem> {
    const g = go();
    return g ? g.ImportPath(kind, path) : browserOnly('Library import');
  },
  async importFile(kind: string, file: File): Promise<LibraryItem> {
    const g = go();
    if (g) return g.ImportBytes(kind, file.name, await blobToBase64(file));
    // Browser mode: keep the file in memory only (listed until the page reloads).
    const url = URL.createObjectURL(file);
    const stem = file.name.replace(/\.[^.]+$/, '');
    const item = { id: `user:${kind}/${stem}`, kind, name: file.name, file: url, thumb: url, width: 0, height: 0, hasAlpha: true };
    browserImports.set(kind, [item, ...(browserImports.get(kind) ?? []).filter((x) => x.id !== item.id)]);
    return item;
  },
  async listLibrary(kind: string): Promise<LibraryItem[]> {
    const g = go();
    if (g) return (await g.ListLibrary(kind)) ?? [];
    if (kind === 'hairstyles' || kind === 'presets' || kind === 'outfits' || kind === 'materials') {
      return Object.keys(browserDocs()).filter((k) => k.startsWith(`${kind}/`) && (kind !== 'materials' || browserFiles.has(k.replace(/\.ps2mat$/, '_diffuse.png')))).map((file) => ({
        id: `user:${file.replace(/\.ps2\w+$/, '')}`, kind, name: file.slice(kind.length + 1).replace(/\.ps2(hair|preset|outfit|mat)$/, ''), file, thumb: '', width: 0, height: 0, hasAlpha: false,
      }));
    }
    return browserImports.get(kind) ?? [];
  },
  /** Save a hair card atlas beside its library image (atlas.json, PRD F5). Browser mode keeps it in localStorage. */
  async saveAtlas(imageFile: string, atlasJson: string): Promise<string> {
    const g = go();
    if (g) return g.SaveAtlas(imageFile, atlasJson);
    putBrowserDoc(`atlas:${imageFile}`, atlasJson);
    return `atlas:${imageFile}`;
  },
  async loadAtlas(imageFile: string): Promise<string | null> {
    const g = go();
    if (g) return (await g.LoadAtlas(imageFile)) || null;
    return browserDocs()[`atlas:${imageFile}`] ?? null;
  },
  async saveHairstyle(name: string, styleJson: string): Promise<LibraryItem> {
    const g = go();
    if (g) return g.SaveHairstyle(name, styleJson);
    const file = `hairstyles/${name.replace(/[^\w -]/g, '_')}.ps2hair`;
    putBrowserDoc(file, styleJson);
    return { id: `user:${file}`, kind: 'hairstyles', name, file, thumb: '', width: 0, height: 0, hasAlpha: false };
  },
  async savePreset(name: string, presetJson: string): Promise<LibraryItem> {
    const g = go();
    if (g) return g.SavePreset(name, presetJson);
    const file = `presets/${name.replace(/[^\w -]/g, '_')}.ps2preset`;
    putBrowserDoc(file, presetJson);
    return { id: `user:${file}`, kind: 'presets', name, file, thumb: '', width: 0, height: 0, hasAlpha: false };
  },
  async saveOutfit(name: string, outfitJson: string): Promise<LibraryItem> {
    const g = go();
    if (g) return g.SaveOutfit(name, outfitJson);
    const file = `outfits/${safeName(name)}.ps2outfit`;
    putBrowserDoc(file, outfitJson);
    return { id: `user:${file.replace(/\.ps2outfit$/, '')}`, kind: 'outfits', name, file, thumb: '', width: 0, height: 0, hasAlpha: false };
  },
  /**
   * Save a Material Studio material: the document, and its era diffuse as a
   * PNG beside it (the backend points the document's `diffuse` at it). Browser
   * mode keeps the image in memory until the page reloads.
   */
  async saveMaterial(name: string, materialJson: string, diffuse: Blob): Promise<LibraryItem> {
    const g = go();
    if (g) return g.SaveMaterial(name, materialJson, await blobToBase64(diffuse));
    const stem = safeName(name);
    const file = `materials/${stem}.ps2mat`;
    const doc = JSON.parse(materialJson) as { material: { diffuse: string } };
    doc.material.diffuse = `${stem}_diffuse.png`;
    const old = browserFiles.get(`materials/${stem}_diffuse.png`);
    if (old) URL.revokeObjectURL(old);
    browserFiles.set(`materials/${stem}_diffuse.png`, URL.createObjectURL(diffuse));
    putBrowserDoc(file, JSON.stringify(doc));
    return { id: `user:materials/${stem}`, kind: 'materials', name: stem, file, thumb: `materials/${stem}_diffuse.png`, width: 0, height: 0, hasAlpha: false };
  },
  async readLibraryDocument(file: string): Promise<string> {
    const g = go();
    if (g) return g.ReadLibraryDocument(file);
    const doc = browserDocs()[file];
    if (doc === undefined) throw new Error(`${file} not found`);
    return doc;
  },
  async deleteLibraryItem(file: string): Promise<void> {
    const g = go();
    if (g) await g.DeleteLibraryItem(file);
    else removeBrowserDoc(file);
  },
  /** Ask for a garment mesh file ('' if cancelled). */
  async pickGarmentFile(): Promise<string> {
    const g = go();
    return g ? g.PickGarmentFile() : browserOnly('Importing a garment');
  },
  async readGarment(path: string): Promise<GarmentFile> {
    const g = go();
    return g ? g.ReadGarment(path) : browserOnly('Importing a garment');
  },
  /** Store an imported garment in the library (browser mode: nowhere, it lasts until reload). */
  async saveGarment(metaJson: string, bin: Uint8Array<ArrayBuffer>): Promise<LibraryItem> {
    const g = go();
    if (g) return g.SaveGarment(metaJson, await blobToBase64(new Blob([bin])));
    const meta = JSON.parse(metaJson) as { id: string; name: string; binary: string };
    return { id: meta.id, kind: 'garments', name: meta.name, file: `garments/${meta.binary.replace(/\.bin$/, '.json')}`, thumb: '', width: 0, height: 0, hasAlpha: false };
  },
  /** Save the base body OBJ through a Save dialog (browser: download). Returns the path, or '' if cancelled. */
  async saveBaseBody(objText: string): Promise<string> {
    const g = go();
    return g ? g.SaveBaseBody(objText) : download(new Blob([objText], { type: 'text/plain' }), 'ps2cc_base_body.obj');
  },
  async settings(): Promise<Settings> {
    const g = go();
    if (g) return { ...DEFAULT_SETTINGS, ...(await g.GetSettings()) };
    const raw = localStorage.getItem('ps2cc:settings');
    return raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) } : { ...DEFAULT_SETTINGS };
  },
  async saveSettings(s: Settings): Promise<void> {
    const g = go();
    if (g) await g.SaveSettings(s);
    else localStorage.setItem('ps2cc:settings', JSON.stringify(s));
  },
  async pickUnityProject(): Promise<string> {
    const g = go();
    return g ? g.PickUnityProject() : browserOnly('Choosing a Unity project');
  },
  /** Validate a typed Unity project folder; resolves to its Unity version ('' if unknown). Browser mode accepts any path. */
  async checkUnityProject(dir: string): Promise<string> {
    const g = go();
    if (g) return g.CheckUnityProject(dir);
    if (!dir.trim()) throw new Error('no folder given');
    return '';
  },
  /** Write an export (FBX, textures, sidecar, GLB) from the engine's message. Browser mode downloads the message instead. */
  async exportCharacter(message: Uint8Array, target: string, name: string): Promise<ExportResult> {
    const g = go();
    const blob = new Blob([message as BlobPart], { type: 'application/octet-stream' });
    if (!g) {
      download(blob, `${name}.ps2exp`);
      return { dir: 'download', files: [`${name}.ps2exp`], bytes: message.byteLength };
    }
    return g.ExportCharacter(await blobToBase64(blob), target);
  },
  async chooseExportFolder(): Promise<string> {
    const g = go();
    return g ? g.ChooseExportFolder() : browserOnly('Choosing a folder');
  },
  openFolder(dir: string): void {
    void go()?.OpenFolder(dir);
  },
  openLogFolder(): void {
    void go()?.OpenLogFolder();
  },
  /** Texture Studio (D-115): where Material Painter is. Browser mode: never found. */
  async painterStatus(): Promise<PainterInfo> {
    const g = go();
    return g ? g.PainterStatus() : { exe: '', found: false };
  },
  async painterLocate(): Promise<string> {
    const g = go();
    return g ? g.PainterLocate() : browserOnly('Material Painter');
  },
  async painterEnableAgents(): Promise<void> {
    const g = go();
    return g ? g.PainterEnableAgents() : browserOnly('Material Painter');
  },
  async painterHasSession(character: string, target: string): Promise<boolean> {
    const g = go();
    return g ? g.PainterHasSession(character, target) : false;
  },
  /** Send a mesh and the texture to paint over to Material Painter (starting it if needed). */
  async painterOpen(character: string, target: string, objText: string, reference: Blob, size: number): Promise<void> {
    const g = go();
    return g ? g.PainterOpen(character, target, objText, await blobToBase64(reference), size) : browserOnly('Material Painter');
  },
  async painterCollect(character: string, target: string): Promise<PaintResult> {
    const g = go();
    return g ? g.PainterCollect(character, target) : browserOnly('Material Painter');
  },
  /** Explorer drag-and-drop with real file paths (desktop only). */
  onFileDrop(cb: (x: number, y: number, paths: string[]) => void): () => void {
    const rt = window.runtime;
    if (!rt) return () => undefined;
    rt.OnFileDrop(cb, false);
    return () => rt.OnFileDropOff();
  },
};

/** Browser mode: images imported since the page loaded, by library kind. */
const browserImports = new Map<string, LibraryItem[]>();

/** Browser mode: library files kept in memory (Material Studio diffuses), by library-relative path. */
const browserFiles = new Map<string, string>();

/** The library's file-name rule (paths.SafeName in the backend). */
function safeName(name: string): string {
  return name.trim().replace(/[^\w -]/g, '_').replace(/^[ .]+|[ .]+$/g, '') || 'untitled';
}

/** URL for a library-relative file. */
export function libraryUrl(info: AppInfo, rel: string): string {
  if (/^(blob:|data:|https?:)/.test(rel)) return rel;
  const kept = browserFiles.get(rel);
  if (kept) return kept;
  return `${info.libraryUrl}/${rel.split('/').map(encodeURIComponent).join('/')}`;
}

/** Browser-mode stand-in for library documents (atlases, hairstyles). */
function browserDocs(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem('ps2cc:docs') ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

function putBrowserDoc(key: string, value: string): void {
  localStorage.setItem('ps2cc:docs', JSON.stringify({ ...browserDocs(), [key]: value }));
}

function removeBrowserDoc(key: string): void {
  const docs = browserDocs();
  delete docs[key];
  localStorage.setItem('ps2cc:docs', JSON.stringify(docs));
}

function download(blob: Blob, fileName: string): string {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
  return 'download';
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) s += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  return btoa(s);
}
