/** UI-only state (no character data): tabs, view options, selection, toasts. */
import { create } from 'zustand';
import type { AtlasRegion, DecalKind, LightingModel, Look, PhotoCheck, ShadowMode } from '@ps2cc/core';
import type { GarmentFile } from '../backend';
import { DEFAULT_POST, type CameraPresetId, type LightingPresetId, type PostSettings, type ShadingMode } from '@ps2cc/viewport';

export type BackgroundId = 'preset' | 'black' | 'grey' | 'image';

/** The editor's categories (D-149): one per part of the character, each with its own panel. */
export type TabId = 'body' | 'face' | 'skin' | 'eyes' | 'brows' | 'lashes' | 'makeup' | 'mouth' | 'hair' | 'clothes' | 'look' | 'export';

/** What the dock shows: a category's panel, the Asset Studio, or settings. */
export type DockTab = 'modify' | 'studio' | 'settings';

/** The Asset Studio's editors (Part 2 F20). */
export type StudioKind = 'hair' | 'texture' | 'garment' | 'material';

/**
 * An open Asset Studio. `target`: the garment's part key (Garment Studio, or
 * Texture Studio on a garment), 'skin' (Texture Studio on the skin), the
 * material it starts from (Material Studio), null for Hair Studio.
 */
export interface AssetStudioState {
  kind: StudioKind;
  target: string | null;
  /** Material Studio: the garment zone the material is previewed on and goes to on Save. */
  zone?: { partKey: string; zone: number } | null;
}

/** An open atlas editor (PRD F5 step 1): the image, its library file (for atlas.json) and starting regions. */
export interface AtlasEditorRequest {
  texture: string;
  /** Library-relative image file; the atlas is saved beside it. Null for built-in textures. */
  libraryFile: string | null;
  name: string;
  regions: AtlasRegion[] | null;
}

/** Photo projection (PRD F7): what the UI shows while and after placing a face photo. */
export interface PhotoStatus {
  image: string;
  busy: string | null;
  check: PhotoCheck | null;
}

/** The import dialog (PRD F4): a file to read, or a mesh already read (tests). */
export type GarmentImportRequest = { path: string } | { mesh: GarmentFile };

export interface Toast {
  id: number;
  kind: 'info' | 'error';
  message: string;
  details?: string;
}

export interface UiState {
  tab: TabId;
  curated: boolean;
  symmetry: boolean;
  search: string;
  locks: Set<string>;
  /** The part clicked in the viewport (a garment's settings open in Clothes). */
  selected: string | null;
  shading: ShadingMode;
  wireOverlay: boolean;
  lighting: LightingPresetId;
  /** A look loaded from a .ps2look file (shown instead of `lighting`). */
  customLook: Look | null;
  /** 'auto': the character's quality profile decides (F13). */
  lightingModel: 'auto' | LightingModel;
  shadowMode: 'auto' | ShadowMode;
  post: PostSettings;
  camera: CameraPresetId;
  turntable: boolean;
  poseTest: boolean;
  /** Hair Studio (PRD F15): grooming brushes over the viewport (on while the Asset Studio shows Hair Studio). */
  hairStudio: boolean;
  /** The Asset Studio, when one of its editors is open (Part 2 F20). */
  assetStudio: AssetStudioState | null;
  openStudio(v: AssetStudioState): void;
  closeStudio(): void;
  /** What the dock shows. */
  dockTab: DockTab;
  setDockTab(v: DockTab): void;
  /** Parts hidden in the viewport (the eye buttons); not saved, not exported. */
  hiddenParts: string[];
  toggleHidden(key: string): void;
  /** Body and Face: one slider region, or the favourite sliders. */
  sliderFocus: { sub: 'body' | 'face'; group: string | null; favourites: boolean };
  focusSliders(v: { sub: 'body' | 'face'; group?: string | null; favourites?: boolean }): void;
  /** Garment looks (Part 2 F18): what a click or drag on the selected garment does (null: nothing). */
  garmentTool: GarmentTool | null;
  setGarmentTool(v: GarmentTool | null): void;
  /** Garment Studio (Part 2 F18): the worn garment being reshaped (its part key), or null. */
  garmentStudio: string | null;
  setGarmentStudio(v: string | null): void;
  background: BackgroundId;
  /** URL of the user's background image, once one is chosen. */
  backgroundImage: string | null;
  toasts: Toast[];
  dropDialog: { files: File[]; paths: string[] } | null;
  atlasEditor: AtlasEditorRequest | null;
  garmentImport: GarmentImportRequest | null;
  photo: PhotoStatus | null;
  /** Character browser (File → Characters…, Ctrl+O). */
  browserOpen: boolean;
  setBrowserOpen(v: boolean): void;
  /** File → Data folder (M18). */
  dataFolderOpen: boolean;
  setDataFolderOpen(v: boolean): void;
  /** Help → Credits. */
  creditsOpen: boolean;
  setCreditsOpen(v: boolean): void;
  setTab(tab: TabId): void;
  setCurated(v: boolean): void;
  setSymmetry(v: boolean): void;
  setSearch(v: string): void;
  toggleLock(id: string): void;
  select(key: string | null): void;
  setView(
    patch: Partial<
      Pick<UiState, 'shading' | 'wireOverlay' | 'lighting' | 'customLook' | 'lightingModel' | 'shadowMode' | 'post' | 'camera' | 'turntable' | 'poseTest' | 'background' | 'backgroundImage' | 'hairStudio'>
    >,
  ): void;
  info(message: string): void;
  error(message: string, err?: unknown): void;
  dismiss(id: number): void;
  openDropDialog(v: { files: File[]; paths: string[] } | null): void;
  openAtlasEditor(v: AtlasEditorRequest | null): void;
  openGarmentImport(v: GarmentImportRequest | null): void;
  setPhoto(v: PhotoStatus | null): void;
}

/** A viewport tool on a garment's look: toggle a zone's islands, paint a zone, or place a decal. */
export type GarmentTool =
  | { partKey: string; mode: 'islands'; zone: number }
  | { partKey: string; mode: 'paint'; zone: number; radiusMm: number }
  | { partKey: string; mode: 'decal'; kind: DecalKind };

let toastId = 0;

export const useUi = create<UiState>((set) => ({
  tab: 'body',
  curated: true,
  symmetry: true,
  search: '',
  locks: new Set(),
  selected: null,
  shading: 'ps2',
  wireOverlay: false,
  lighting: 'studio',
  customLook: null,
  lightingModel: 'auto',
  shadowMode: 'auto',
  post: { ...DEFAULT_POST },
  camera: 'full',
  turntable: false,
  poseTest: false,
  hairStudio: false,
  assetStudio: null,
  openStudio: (v) =>
    set({
      dockTab: 'studio',
      assetStudio: v,
      hairStudio: v.kind === 'hair',
      garmentStudio: v.kind === 'garment' ? v.target : null,
      garmentTool: null,
    }),
  closeStudio: () => set({ assetStudio: null, hairStudio: false, garmentStudio: null, garmentTool: null, dockTab: 'modify' }),
  dockTab: 'modify',
  setDockTab: (dockTab) => set(dockTab === 'studio' ? { dockTab } : { dockTab, assetStudio: null, hairStudio: false, garmentStudio: null, garmentTool: null }),
  hiddenParts: [],
  toggleHidden: (key) => set((s) => ({ hiddenParts: s.hiddenParts.includes(key) ? s.hiddenParts.filter((k) => k !== key) : [...s.hiddenParts, key] })),
  sliderFocus: { sub: 'body', group: null, favourites: false },
  focusSliders: (v) =>
    set({ ...(v.group ? { camera: v.sub === 'face' ? 'face' : 'full' } : {}), sliderFocus: { sub: v.sub, group: v.group ?? null, favourites: v.favourites ?? false }, tab: v.sub, dockTab: 'modify', assetStudio: null, hairStudio: false, garmentStudio: null, garmentTool: null }),
  garmentTool: null,
  setGarmentTool: (garmentTool) => set({ garmentTool }),
  garmentStudio: null,
  // Garment Studio is one of the Asset Studio's editors: opening it opens the studio, closing it closes the studio.
  setGarmentStudio: (garmentStudio) =>
    set(
      garmentStudio
        ? { garmentStudio, assetStudio: { kind: 'garment', target: garmentStudio }, hairStudio: false, garmentTool: null, dockTab: 'studio' }
        : { garmentStudio: null, assetStudio: null, garmentTool: null, dockTab: 'modify' },
    ),
  background: 'preset',
  backgroundImage: null,
  toasts: [],
  dropDialog: null,
  atlasEditor: null,
  garmentImport: null,
  browserOpen: false,
  setBrowserOpen: (browserOpen) => set({ browserOpen }),
  dataFolderOpen: false,
  setDataFolderOpen: (dataFolderOpen) => set({ dataFolderOpen }),
  creditsOpen: false,
  setCreditsOpen: (creditsOpen) => set({ creditsOpen }),
  photo: null,
  // A category closes the Asset Studio; Body and Face keep their slider region only between themselves.
  setTab: (tab) =>
    set((s) => ({
      tab,
      search: '',
      sliderFocus: tab === 'body' || tab === 'face' ? { sub: tab, group: s.sliderFocus.sub === tab ? s.sliderFocus.group : null, favourites: false } : s.sliderFocus,
      dockTab: 'modify',
      assetStudio: null,
      hairStudio: false,
      garmentStudio: null,
      garmentTool: null,
    })),
  setCurated: (curated) => set({ curated }),
  setSymmetry: (symmetry) => set({ symmetry }),
  setSearch: (search) => set({ search }),
  toggleLock: (id) =>
    set((s) => {
      const locks = new Set(s.locks);
      if (locks.has(id)) locks.delete(id);
      else locks.add(id);
      return { locks };
    }),
  // Clicking a part in the viewport opens its category (a garment: Clothes, with its settings).
  select: (selected) =>
    set((s) => {
      const tab = selected ? categoryOfPart(selected) : null;
      if (!tab || s.assetStudio) return { selected };
      return { selected, tab, dockTab: 'modify' };
    }),
  setView: (patch) => set(patch),
  info: (message) => set((s) => ({ toasts: [...s.toasts, { id: ++toastId, kind: 'info', message }] })),
  error: (message, err) =>
    set((s) => ({
      toasts: [
        ...s.toasts,
        {
          id: ++toastId,
          kind: 'error',
          message: `${message}${err instanceof Error ? `: ${err.message}` : typeof err === 'string' ? `: ${err}` : ''}`,
          details: err instanceof Error ? (err.stack ?? err.message) : err === undefined ? undefined : String(err),
        },
      ],
    })),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  openDropDialog: (dropDialog) => set({ dropDialog }),
  openGarmentImport: (garmentImport) => set({ garmentImport }),
  openAtlasEditor: (atlasEditor) => set({ atlasEditor }),
  setPhoto: (photo) => set({ photo }),
}));

/** The category that edits a part of the scene (its key, as the viewport and scene name parts). */
export function categoryOfPart(key: string): TabId | null {
  if (key.startsWith('garment:') || key.startsWith('fur:')) return 'clothes';
  if (key === 'hair') return 'hair';
  if (key === 'body') return 'skin';
  if (key === 'eyes') return 'eyes';
  if (key === 'eyebrows' || key === 'browCards') return 'brows';
  if (key === 'eyelashes') return 'lashes';
  if (key === 'teeth' || key === 'tongue') return 'mouth';
  return null;
}
