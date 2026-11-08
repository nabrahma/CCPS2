/** UI-only state (no character data): tabs, view options, selection, toasts. */
import { create } from 'zustand';
import type { AtlasRegion, PhotoCheck } from '@ps2cc/core';
import type { GarmentFile } from '../backend';
import { DEFAULT_POST, type CameraPresetId, type LightingPresetId, type PostSettings, type ShadingMode } from '@ps2cc/viewport';

export type BackgroundId = 'preset' | 'black' | 'grey' | 'image';

export type TabId = 'body' | 'face' | 'skin' | 'hair' | 'wardrobe' | 'expressions' | 'export';

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
  sidebarCollapsed: boolean;
  shading: ShadingMode;
  wireOverlay: boolean;
  lighting: LightingPresetId;
  post: PostSettings;
  camera: CameraPresetId;
  turntable: boolean;
  poseTest: boolean;
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
  /** Help → Credits. */
  creditsOpen: boolean;
  setCreditsOpen(v: boolean): void;
  setTab(tab: TabId): void;
  setRailMode(mode: 'controls' | 'inspect'): void;
  toggleSidebar(): void;
  setCurated(v: boolean): void;
  setSymmetry(v: boolean): void;
  setSearch(v: string): void;
  toggleLock(id: string): void;
  select(key: string | null): void;
  setView(patch: Partial<Pick<UiState, 'shading' | 'wireOverlay' | 'lighting' | 'post' | 'camera' | 'turntable' | 'poseTest' | 'background' | 'backgroundImage'>>): void;
  info(message: string): void;
  error(message: string, err?: unknown): void;
  dismiss(id: number): void;
  openDropDialog(v: { files: File[]; paths: string[] } | null): void;
  openAtlasEditor(v: AtlasEditorRequest | null): void;
  openGarmentImport(v: GarmentImportRequest | null): void;
  setPhoto(v: PhotoStatus | null): void;
}

let toastId = 0;

export const useUi = create<UiState>((set) => ({
  tab: 'body',
  curated: true,
  symmetry: true,
  search: '',
  locks: new Set(),
  selected: null,
  railMode: 'controls',
  sidebarCollapsed: false,
  shading: 'ps2',
  wireOverlay: false,
  lighting: 'studio',
  post: { ...DEFAULT_POST },
  camera: 'full',
  turntable: false,
  poseTest: false,
  background: 'preset',
  backgroundImage: null,
  toasts: [],
  dropDialog: null,
  atlasEditor: null,
  garmentImport: null,
  browserOpen: false,
  setBrowserOpen: (browserOpen) => set({ browserOpen }),
  creditsOpen: false,
  setCreditsOpen: (creditsOpen) => set({ creditsOpen }),
  photo: null,
  setTab: (tab) => set({ tab, search: '', railMode: 'controls' }),
  setRailMode: (railMode) => set({ railMode }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
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
  select: (selected) => set((s) => ({ selected, railMode: selected ? 'inspect' : s.railMode })),
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
