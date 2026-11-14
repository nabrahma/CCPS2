import type { ReactNode } from 'react';
import { useStudio } from '../state/hooks';
import { useUi, type StudioKind, type TabId } from '../state/ui';
import { BudgetBar } from './BudgetBar';
import { BodyIcon, BoltIcon, BrandMark, CharactersIcon, ExportIcon, HairIcon, LibraryIcon, LookIcon, PanelIcon, SkinIcon, StudioIcon, WardrobeIcon } from './icons';

/** The Character Creator's six steps (Part 2 F20), in order. */
export const TABS: { id: TabId; step: string; label: string; icon: ReactNode; hint: string }[] = [
  { id: 'create', step: '01', label: 'Create', icon: <BodyIcon />, hint: 'Base, body and face' },
  { id: 'hair', step: '02', label: 'Hair', icon: <HairIcon />, hint: 'Hairstyle and colour' },
  { id: 'wardrobe', step: '03', label: 'Wardrobe', icon: <WardrobeIcon />, hint: 'Garments and outfits' },
  { id: 'appearance', step: '04', label: 'Appearance', icon: <SkinIcon />, hint: 'Skin, eyes, makeup and details' },
  { id: 'look', step: '05', label: 'Look', icon: <LookIcon />, hint: 'Quality profile, look and lighting' },
  { id: 'export', step: '06', label: 'Export', icon: <ExportIcon />, hint: 'To Unity or a folder' },
];

/** The Asset Studio's editors (Part 2 F20). */
export const STUDIOS: { id: StudioKind; label: string; hint: string }[] = [
  { id: 'hair', label: 'Hair Studio', hint: 'Groom, shape and save hairstyles' },
  { id: 'texture', label: 'Texture Studio', hint: 'Skin layers, photos, painting; save skins and garment textures' },
  { id: 'garment', label: 'Garment Studio', hint: 'Reshape and kitbash garments' },
  { id: 'material', label: 'Material Studio', hint: 'Make materials from library materials or your images' },
];

/** Navigation: the creator's steps (or the Asset Studio's editors), the library, the character browser and the budget. */
export function Sidebar() {
  const studio = useStudio();
  const ui = useUi();
  const newCharacter = () => {
    if (!studio.dirty || window.confirm('Discard unsaved changes?')) studio.newCharacter();
  };
  const inStudio = ui.assetStudio !== null;
  /** Switch editors inside the Asset Studio, with the target each one needs. */
  const openStudio = (kind: StudioKind) => {
    const sel = ui.selected?.startsWith('garment:') ? ui.selected : null;
    const worn = studio.engine.doc.garments[0];
    const garment = sel ?? (worn ? `garment:${worn.slot}:${worn.asset}` : null);
    if (kind === 'garment' && !garment) {
      ui.error('Put on a garment first: Garment Studio edits a garment the character wears');
      return;
    }
    ui.openStudio({
      kind,
      target: kind === 'hair' ? null : kind === 'garment' ? garment : kind === 'texture' ? 'skin' : (studio.assets.catalog.materials?.[0]?.id ?? null),
      zone: kind === 'material' && garment ? { partKey: garment, zone: 0 } : null,
    });
  };
  return (
    <aside className={inStudio ? 'sidebar studio-mode' : 'sidebar'}>
      <div className="sidebar-head">
        <BrandMark />
        <button className="icon-button" onClick={ui.toggleSidebar} aria-label={ui.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={ui.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          <PanelIcon />
        </button>
      </div>
      {inStudio ? (
        <button className="new-button back-button" onClick={ui.closeStudio} title="Back to the Character Creator" aria-label="Back to Creator" data-testid="studio-back">
          <span className="nav-label">‹ Creator</span>
          <StudioIcon />
        </button>
      ) : (
        <button className="new-button" onClick={newCharacter} title="New character" aria-label="New character">
          <span className="nav-label">New</span>
          <BoltIcon />
        </button>
      )}
      {inStudio ? (
        <nav className="tabs" role="tablist" aria-orientation="vertical" aria-label="Asset Studio">
          <p className="nav-heading nav-label">Asset Studio</p>
          {STUDIOS.map((s) => (
            <button
              key={s.id}
              role="tab"
              aria-selected={ui.assetStudio?.kind === s.id}
              aria-label={s.label}
              title={s.hint}
              className={ui.assetStudio?.kind === s.id ? 'tab active' : 'tab'}
              onClick={() => openStudio(s.id)}
              data-testid={`studio-tab-${s.id}`}
            >
              <StudioIcon />
              <span className="nav-label">{s.label}</span>
            </button>
          ))}
        </nav>
      ) : (
        <nav className="tabs steps" role="tablist" aria-orientation="vertical" aria-label="Character Creator">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={ui.tab === t.id && ui.railMode === 'controls'}
              aria-label={t.label}
              title={`${t.step} ${t.label}: ${t.hint}`}
              className={ui.tab === t.id ? 'tab active' : 'tab'}
              onClick={() => ui.setTab(t.id)}
              data-testid={`step-${t.id}`}
            >
              {t.icon}
              <span className="nav-label">
                <span className="step-number">{t.step}</span> {t.label}
              </span>
            </button>
          ))}
        </nav>
      )}
      <nav className="tabs">
        <hr />
        <button className="tab" onClick={() => ui.setLibrary({ category: ui.tab === 'hair' ? 'hair' : ui.tab === 'wardrobe' ? 'garments' : ui.tab === 'appearance' ? 'skins' : 'bodies' })} aria-label="Library" title="Library: every preset, hairstyle, garment, outfit, skin and material (Ctrl+L)" data-testid="open-library">
          <LibraryIcon />
          <span className="nav-label">Library</span>
        </button>
        {!inStudio && (
          <button className="tab" onClick={() => openStudio('hair')} aria-label="Asset Studio" title="Asset Studio: Hair, Texture, Garment and Material Studio" data-testid="open-asset-studio">
            <StudioIcon />
            <span className="nav-label">Asset Studio</span>
          </button>
        )}
        <button className="tab" onClick={() => ui.setBrowserOpen(true)} aria-label="Characters" title="Characters (Ctrl+O)">
          <CharactersIcon />
          <span className="nav-label">Characters</span>
        </button>
      </nav>
      <BudgetBar />
    </aside>
  );
}
