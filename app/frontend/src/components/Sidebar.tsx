import type { ReactNode } from 'react';
import { useStudio } from '../state/hooks';
import { useUi, type TabId } from '../state/ui';
import { BudgetBar } from './BudgetBar';
import { BodyIcon, BoltIcon, BrandMark, CharactersIcon, ExportIcon, ExpressionIcon, FaceIcon, HairIcon, PanelIcon, SkinIcon, WardrobeIcon } from './icons';

export const TABS: { id: TabId; label: string; icon: ReactNode }[] = [
  { id: 'body', label: 'Body', icon: <BodyIcon /> },
  { id: 'face', label: 'Face', icon: <FaceIcon /> },
  { id: 'skin', label: 'Skin', icon: <SkinIcon /> },
  { id: 'hair', label: 'Hair', icon: <HairIcon /> },
  { id: 'wardrobe', label: 'Wardrobe', icon: <WardrobeIcon /> },
  { id: 'expressions', label: 'Expressions', icon: <ExpressionIcon /> },
  { id: 'export', label: 'Export', icon: <ExportIcon /> },
];

/** Navigation: a new character, the editing sections, the character browser and the budget. */
export function Sidebar() {
  const studio = useStudio();
  const ui = useUi();
  const newCharacter = () => {
    if (!studio.dirty || window.confirm('Discard unsaved changes?')) studio.newCharacter();
  };
  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <BrandMark />
        <button className="icon-button" onClick={ui.toggleSidebar} aria-label={ui.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={ui.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          <PanelIcon />
        </button>
      </div>
      <button className="new-button" onClick={newCharacter} title="New character" aria-label="New character">
        <span className="nav-label">New</span>
        <BoltIcon />
      </button>
      <nav className="tabs" role="tablist" aria-orientation="vertical">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={ui.tab === t.id && ui.railMode === 'controls'} aria-label={t.label} title={t.label} className={ui.tab === t.id ? 'tab active' : 'tab'} onClick={() => ui.setTab(t.id)}>
            {t.icon}
            <span className="nav-label">{t.label}</span>
          </button>
        ))}
        <hr />
        <button className="tab" onClick={() => ui.setBrowserOpen(true)} aria-label="Characters" title="Characters (Ctrl+O)">
          <CharactersIcon />
          <span className="nav-label">Characters</span>
        </button>
      </nav>
      <BudgetBar />
    </aside>
  );
}
