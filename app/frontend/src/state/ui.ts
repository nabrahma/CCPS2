/** UI-only state (no character data): tabs, view options, selection, toasts. */
import { create } from 'zustand';
import type { AtlasRegion, DecalKind, LibraryCategory, LightingModel, Look, PhotoCheck, ShadowMode } from '@ps2cc/core';
import type { GarmentFile } from '../backend';
import { DEFAULT_POST, type CameraPresetId, type LightingPresetId, type PostSettings, type ShadingMode } from '@ps2cc/viewport';

export type BackgroundId = 'preset' | 'black' | 'grey' | 'image';

/** The Character Creator's six steps (Part 2 F20). */
export type TabId = 'create' | 'hair' | 'wardrobe' | 'appearance' | 'look' | 'export';

/** The right dock's tabs (M18): the parts tree and controls, the library, the Asset Studio, settings. */
export type DockTab = 'modify' | 'library' | 'studio' | 'settings';

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
  selected: string | null;
  /** What the right column shows. */
  railMode: 'controls' | 'inspect';
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
  /** The library browser's category; null closes it (back to Modify). */
  library: { category: LibraryCategory } | null;
  setLibrary(v: { category: LibraryCategory } | null): void;
  /** The right dock's open tab (M18). */
  dockTab: DockTab;
  setDockTab(v: DockTab): void;
  /** Parts hidden in the viewport (the parts tree's checkboxes); not saved, not exported. */
  hiddenParts: string[];
  toggleHidden(key: string): void;
  /** 01 Create: body or face sliders, one slider group (the parts tree), or the favourite sliders. */
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
  setRailMode(mode: 'controls' | 'inspect'): void;
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
  tab: 'create',
  curated: true,
  symmetry: true,
  search: '',
  locks: new Set(),
  selected: null,
  railMode: 'controls',
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
      railMode: 'controls',
    }),
  closeStudio: () => set({ assetStudio: null, hairStudio: false, garmentStudio: null, garmentTool: null, dockTab: 'modify' }),
  library: null,
  setLibrary: (library) => set(library ? { library, dockTab: 'library' } : { library: null, dockTab: 'modify' }),
  dockTab: 'modify',
  setDockTab: (dockTab) => set((s) => ({ dockTab, library: dockTab === 'library' ? (s.library ?? { category: 'bodies' }) : s.library })),
  hiddenParts: [],
  toggleHidden: (key) => set((s) => ({ hiddenParts: s.hiddenParts.includes(key) ? s.hiddenParts.filter((k) => k !== key) : [...s.hiddenParts, key] })),
  sliderFocus: { sub: 'body', group: null, favourites: false },
  focusSliders: (v) =>
    set({ ...(v.group ? { camera: v.sub === 'face' ? 'face' : 'full' } : {}), sliderFocus: { sub: v.sub, group: v.group ?? null, favourites: v.favourites ?? false }, tab: 'create', railMode: 'controls', dockTab: 'modify', assetStudio: null, hairStudio: false, garmentStudio: null, garmentTool: null }),
  garmentTool: null,
  setGarmentTool: (garmentTool) => set({ garmentTool }),
  garmentStudio: null,
  // Garment Studio is one of the Asset Studio's editors: opening it opens the studio, closing it closes the studio.
  setGarmentStudio: (garmentStudio) =>
    set(
      garmentStudio
        ? { garmentStudio, assetStudio: { kind: 'garment', target: garmentStudio }, hairStudio: false, garmentTool: null, railMode: 'controls', dockTab: 'studio' }
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
  // A creator step closes the Asset Studio.
  setTab: (tab) => set({ tab, search: '', railMode: 'controls', dockTab: 'modify', assetStudio: null, hairStudio: false, garmentStudio: null, garmentTool: null }),
  setRailMode: (railMode) => set({ railMode }),
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
  // Choosing a part opens its details; clearing the selection leaves the column alone.
  select: (selected) => set((s) => ({ selected, railMode: selected ? 'inspect' : s.railMode, dockTab: selected && !s.assetStudio ? 'modify' : s.dockTab })),
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
