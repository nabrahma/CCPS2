/**
 * The right dock (D-149): a rail of categories, one per part of the
 * character, and the panel of the chosen one. Like MetaHuman's categories or
 * Blender's vertical property tabs: one place for each thing, and only that
 * thing's controls on screen. The Asset Studio and Settings sit at the foot of
 * the rail.
 */
import type { ReactNode } from 'react';
import { backend } from '../../backend';
import { runSliderSweep } from '../../perf';
import { useStudio, useStudioVersion } from '../../state/hooks';
import { useUi, type TabId } from '../../state/ui';
import { BodyPanel, BrowsPanel, ClothesPanel, ExportStep, EyesPanel, FacePanel, HairStep, LashesPanel, LookStep, MakeupPanel, MouthPanel, SkinStep } from '../creator/Steps';
import { DataFolderBody } from '../DataFolderDialog';
import { EyeIcon, GearIcon, StudioIcon } from '../icons';
import { StudioRail } from '../studio/StudioRail';
import { CATEGORIES, openStudioOf, STUDIOS } from './steps';

const PANELS: Record<TabId, () => ReactNode> = {
  body: () => <BodyPanel />,
  face: () => <FacePanel />,
  skin: () => <SkinStep />,
  eyes: () => <EyesPanel />,
  brows: () => <BrowsPanel />,
  lashes: () => <LashesPanel />,
  makeup: () => <MakeupPanel />,
  mouth: () => <MouthPanel />,
  hair: () => <HairStep />,
  clothes: () => <ClothesPanel />,
  look: () => <LookStep />,
  export: () => <ExportStep />,
};

/** Categories whose part can be hidden in the viewport from the panel's title. */
const PART_OF: Partial<Record<TabId, string>> = { hair: 'hair', eyes: 'eyes' };

export function Dock() {
  const ui = useUi();
  const tab = ui.dockTab;
  return (
    <aside className="dock" aria-label="Editor">
      <CategoryRail />
      <div className="dock-main">
        {tab === 'modify' && <CategoryPanel />}
        {tab === 'studio' && <StudioTab />}
        {tab === 'settings' && <SettingsTab />}
      </div>
    </aside>
  );
}

function CategoryRail() {
  const ui = useUi();
  let group: string | null = null;
  return (
    <nav className="cat-rail" role="tablist" aria-orientation="vertical" aria-label="Character">
      {CATEGORIES.map((c) => {
        const gap = group !== null && group !== c.group;
        group = c.group;
        const on = ui.dockTab === 'modify' && ui.tab === c.id;
        return (
          <button
            key={c.id}
            role="tab"
            aria-selected={on}
            aria-label={c.label}
            title={`${c.label}: ${c.hint}`}
            className={`cat${on ? ' active' : ''}${gap ? ' gap' : ''}`}
            onClick={() => ui.setTab(c.id)}
            data-testid={`cat-${c.id}`}
          >
            {c.icon}
            <span>{c.label}</span>
          </button>
        );
      })}
      <span className="cat-spacer" />
      <button
        role="tab"
        aria-selected={ui.dockTab === 'studio'}
        aria-label="Studio"
        title="Asset Studio: Hair, Texture, Garment and Material Studio"
        className={`cat gap${ui.dockTab === 'studio' ? ' active' : ''}`}
        onClick={() => ui.setDockTab('studio')}
        data-testid="open-asset-studio"
      >
        <StudioIcon />
        <span>Studio</span>
      </button>
      <button
        role="tab"
        aria-selected={ui.dockTab === 'settings'}
        aria-label="Settings"
        title="Data folder, preferences and help"
        className={`cat${ui.dockTab === 'settings' ? ' active' : ''}`}
        onClick={() => ui.setDockTab('settings')}
        data-testid="dock-settings"
      >
        <GearIcon />
        <span>Settings</span>
      </button>
    </nav>
  );
}

function CategoryPanel() {
  const ui = useUi();
  const studio = useStudio();
  useStudioVersion();
  const c = CATEGORIES.find((x) => x.id === ui.tab) ?? CATEGORIES[0]!;
  const part = PART_OF[c.id];
  const present = part ? studio.scene.parts.some((p) => p.key === part) : false;
  return (
    <section className="cat-panel" role="tabpanel" aria-label={c.label} data-testid={`panel-${c.id}`}>
      <header className="cat-head">
        <div>
          <h2>{c.label}</h2>
          <p>{c.hint}</p>
        </div>
        {part && present && <VisibilityToggle partKey={part} label={c.label} />}
      </header>
      <div className="cat-body" key={c.id}>
        {PANELS[c.id]()}
      </div>
    </section>
  );
}

/** Hide a part in the viewport only (it is still exported). */
export function VisibilityToggle({ partKey, label }: { partKey: string; label: string }) {
  const hidden = useUi((s) => s.hiddenParts.includes(partKey));
  const toggle = useUi((s) => s.toggleHidden);
  return (
    <button
      className={hidden ? 'icon vis off' : 'icon vis'}
      onClick={() => toggle(partKey)}
      aria-label={hidden ? `Show ${label}` : `Hide ${label}`}
      aria-pressed={!hidden}
      title={hidden ? 'Hidden in the viewport (still exported)' : 'Hide in the viewport'}
      data-testid={`vis-${partKey}`}
    >
      <EyeIcon off={hidden} />
    </button>
  );
}

function StudioTab() {
  const studio = useStudio();
  const ui = useUi();
  if (!ui.assetStudio) {
    return (
      <section className="cat-panel" data-testid="studio-launcher">
        <header className="cat-head">
          <div>
            <h2>Asset Studio</h2>
            <p>The deep editors. What you save joins the library.</p>
          </div>
        </header>
        <div className="cat-body">
          <div className="studio-cards">
            {STUDIOS.map((s) => (
              <button key={s.id} className="studio-card" onClick={() => openStudioOf(studio, s.id)} data-testid={`studio-tab-${s.id}`}>
                <strong>{s.label}</strong>
                <span className="muted">{s.hint}</span>
              </button>
            ))}
          </div>
        </div>
      </section>
    );
  }
  return (
    <div className="dock-body studio-dock">
      <div className="studio-switch" role="tablist" aria-label="Asset Studio">
        <button className="back" onClick={ui.closeStudio} aria-label="Back to Creator" title="Back to the character" data-testid="studio-back">
          ‹ Back
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
  useStudioVersion();
  const ui = useUi();
  const measure = async () => {
    const r = await runSliderSweep(studio);
    backend.log('info', `slider sweep: ${JSON.stringify(r)}`);
    ui.info(`${r.fps} fps while dragging sliders (${r.meets60fps ? 'meets' : 'below'} the 60 fps target) on ${r.gpu}. One update takes ${r.updateMs.p50} ms. Saved to the log.`);
  };
  return (
    <section className="cat-panel" data-testid="settings-panel">
      <header className="cat-head">
        <div>
          <h2>Settings</h2>
          <p>Data folder, preferences and help</p>
        </div>
      </header>
      <div className="cat-body">
        <DataFolderBody />
        <section className="settings-section">
          <h3>Sliders</h3>
          <label className="check">
            <input type="checkbox" checked={!ui.curated} onChange={(e) => ui.setCurated(!e.target.checked)} /> Show every MakeHuman slider (otherwise the PS2 set)
          </label>
          <label className="check">
            <input type="checkbox" checked={ui.symmetry} onChange={(e) => ui.setSymmetry(e.target.checked)} /> Symmetry
          </label>
          <label className="check">
            <input type="checkbox" checked={ui.wireOverlay} onChange={(e) => ui.setView({ wireOverlay: e.target.checked })} /> Wireframe overlay (W)
          </label>
        </section>
        <section className="settings-section">
          <h3>Baking</h3>
          <label className="check">
            <input type="checkbox" checked={studio.autoBake} onChange={(e) => studio.setAutoBake(e.target.checked)} data-testid="settings-auto-bake" /> Bake automatically after each change
          </label>
          <p className="muted">Off: bake with Bake in the status bar or in Export. An export with a bake option on always bakes first.</p>
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
    </section>
  );
}
