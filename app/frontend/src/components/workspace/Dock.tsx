/**
 * The right dock (M18): four tabs.
 * - Modify: the parts tree, and under it the controls of what is chosen (a
 *   creator step, a body region's sliders, or a part's details).
 * - Library: everything the creator can pick, as thumbnails under the look.
 * - Studio: the Asset Studio (Hair, Texture, Garment, Material Studio).
 * - Settings: the data folder, preferences and help.
 */
import type { ReactNode } from 'react';
import { LIBRARY_CATEGORIES } from '@ps2cc/core';
import { backend } from '../../backend';
import { runSliderSweep } from '../../perf';
import { useStudio, useStudioVersion } from '../../state/hooks';
import { useUi, type DockTab } from '../../state/ui';
import { AppearanceStep, CreateStep, ExportStep, HairStep, LookStep, WardrobeStep } from '../creator/Steps';
import { DataFolderBody } from '../DataFolderDialog';
import { GearIcon, LibraryIcon, SlidersIcon, StudioIcon } from '../icons';
import { Inspector } from '../Inspector';
import { LibraryGrid } from '../library/LibraryGrid';
import { StudioRail } from '../studio/StudioRail';
import { PartsTree } from './PartsTree';
import { openStudioOf, STUDIOS, TABS } from './steps';

const DOCK_TABS: { id: DockTab; label: string; icon: ReactNode; testId: string; title: string }[] = [
  { id: 'modify', label: 'Modify', icon: <SlidersIcon />, testId: 'dock-modify', title: 'The parts of the character and their controls' },
  { id: 'library', label: 'Library', icon: <LibraryIcon />, testId: 'open-library', title: 'Presets, hairstyles, garments, outfits, skins and materials (Ctrl+L)' },
  { id: 'studio', label: 'Studio', icon: <StudioIcon />, testId: 'open-asset-studio', title: 'Asset Studio: Hair, Texture, Garment and Material Studio' },
  { id: 'settings', label: 'Settings', icon: <GearIcon />, testId: 'dock-settings', title: 'Data folder, preferences and help' },
];

export function Dock() {
  const ui = useUi();
  const tab = ui.dockTab;
  return (
    <aside className="dock" aria-label="Dock">
      <div className="dock-tabs" role="tablist" aria-label="Dock">
        {DOCK_TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? 'dock-tab active' : 'dock-tab'}
            onClick={() => (t.id === 'studio' && !ui.assetStudio ? ui.setDockTab('studio') : ui.setDockTab(t.id))}
            title={t.title}
            data-testid={t.testId}
          >
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      {tab === 'modify' && <ModifyTab />}
      {tab === 'library' && <LibraryTab />}
      {tab === 'studio' && <StudioTab />}
      {tab === 'settings' && <SettingsTab />}
    </aside>
  );
}

function ModifyTab() {
  const ui = useUi();
  const studio = useStudio();
  useStudioVersion();
  const step = TABS.find((t) => t.id === ui.tab);
  const inspecting = ui.railMode === 'inspect' && ui.selected !== null && studio.scene.parts.some((p) => p.key === ui.selected);
  return (
    <div className="dock-body modify">
      <div className="dock-tree">
        <PartsTree />
      </div>
      <section className="dock-panel">
        {inspecting ? (
          <div className="panel" data-testid="inspector-panel">
            <Inspector />
          </div>
        ) : (
          <>
            <p className="card-label">
              {step?.step} {step?.label}
            </p>
            <div className="panel" role="tabpanel" aria-label={step?.label ?? ''}>
              {ui.tab === 'create' && <CreateStep />}
              {ui.tab === 'hair' && <HairStep />}
              {ui.tab === 'wardrobe' && <WardrobeStep />}
              {ui.tab === 'appearance' && <AppearanceStep />}
              {ui.tab === 'look' && <LookStep />}
              {ui.tab === 'export' && <ExportStep />}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function LibraryTab() {
  const ui = useUi();
  const lookLabel = ui.customLook?.label ?? ui.lighting;
  const category = ui.library?.category ?? 'bodies';
  return (
    <div className="dock-body library-dock" data-testid="library-browser">
      <div className="library-head">
        <p className="card-label">Library</p>
        <span className="muted">under the {lookLabel} look</span>
      </div>
      <div className="toggle-row wrap" role="tablist" aria-label="Library category">
        {LIBRARY_CATEGORIES.map((c) => (
          <button
            key={c.id}
            role="tab"
            aria-selected={category === c.id}
            className={category === c.id ? 'chip active' : 'chip'}
            onClick={() => ui.setLibrary({ category: c.id })}
            data-testid={`library-category-${c.id}`}
          >
            {c.label}
          </button>
        ))}
      </div>
      <LibraryGrid key={category} categories={[category]} size="large" testId="library-browser-grid" />
    </div>
  );
}

function StudioTab() {
  const studio = useStudio();
  const ui = useUi();
  if (!ui.assetStudio) {
    return (
      <div className="dock-body" data-testid="studio-launcher">
        <p className="card-label">Asset Studio</p>
        <p className="hint">The deep editors. What you save here joins the library, and the creator's steps pick from it.</p>
        <div className="studio-cards">
          {STUDIOS.map((s) => (
            <button key={s.id} className="studio-card" onClick={() => openStudioOf(studio, s.id)} data-testid={`studio-tab-${s.id}`}>
              <strong>{s.label}</strong>
              <span className="muted">{s.hint}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="dock-body studio-dock">
      <div className="studio-switch" role="tablist" aria-label="Asset Studio">
        <button className="back" onClick={ui.closeStudio} aria-label="Back to Creator" title="Back to the Character Creator" data-testid="studio-back">
          ‹ Creator
        </button>
        {STUDIOS.map((s) => (
          <button
            key={s.id}
            role="tab"
            aria-selected={ui.assetStudio?.kind === s.id}
            aria-label={s.label}
            className={ui.assetStudio?.kind === s.id ? 'chip active' : 'chip'}
            onClick={() => openStudioOf(studio, s.id)}
            title={s.hint}
            data-testid={`studio-tab-${s.id}`}
          >
            {s.label.replace(' Studio', '')}
          </button>
        ))}
      </div>
      <StudioRail />
    </div>
  );
}

function SettingsTab() {
  const studio = useStudio();
  const ui = useUi();
  const measure = async () => {
    const r = await runSliderSweep(studio);
    backend.log('info', `slider sweep: ${JSON.stringify(r)}`);
    ui.info(`${r.fps} fps while dragging sliders (${r.meets60fps ? 'meets' : 'below'} the 60 fps target) on ${r.gpu}. One update takes ${r.updateMs.p50} ms. Saved to the log.`);
  };
  return (
    <div className="dock-body settings-dock" data-testid="settings-panel">
      <div className="panel">
        <DataFolderBody />
        <section className="settings-section">
          <h3>Sliders</h3>
          <label className="check">
            <input type="checkbox" checked={ui.curated} onChange={(e) => ui.setCurated(e.target.checked)} /> Curated PS2 sliders (otherwise every MakeHuman slider)
          </label>
          <label className="check">
            <input type="checkbox" checked={ui.symmetry} onChange={(e) => ui.setSymmetry(e.target.checked)} /> Symmetry
          </label>
          <label className="check">
            <input type="checkbox" checked={ui.wireOverlay} onChange={(e) => ui.setView({ wireOverlay: e.target.checked })} /> Wireframe overlay (W)
          </label>
        </section>
        <section className="settings-section">
          <h3>Help</h3>
          <div className="button-row wrap">
            <button onClick={() => ui.setCreditsOpen(true)}>Credits…</button>
            <button onClick={() => void measure().catch((err: unknown) => ui.error('Could not measure the speed', err))}>Measure slider speed</button>
            <button onClick={() => backend.openLogFolder()}>Open log folder</button>
          </div>
          <p className="muted">PS2CC {studio.info.version}</p>
        </section>
      </div>
    </div>
  );
}
