import { useState, type ReactNode } from 'react';
import { BUILTIN_PRESETS, applyPreset } from '@ps2cc/core';
import { backend } from '../backend';
import { useStudio, useStudioVersion } from '../state/hooks';
import { useUi } from '../state/ui';

type MenuId = 'file' | 'edit' | 'view' | null;

/** File, Edit and View, at the top left of the viewport. */
export function AppMenus() {
  const studio = useStudio();
  useStudioVersion();
  const ui = useUi();
  const [menu, setMenu] = useState<MenuId>(null);
  const engine = studio.engine;
  const run = (fn: () => unknown | Promise<unknown>, failMsg: string) => () => {
    setMenu(null);
    Promise.resolve()
      .then(fn)
      .catch((err: unknown) => ui.error(failMsg, err));
  };
  const confirmDiscard = () => !studio.dirty || window.confirm('Discard unsaved changes?');

  return (
    <nav className="menus" onMouseLeave={() => setMenu(null)}>
      <Menu id="file" label="File" open={menu} setOpen={setMenu}>
        <button onClick={run(() => confirmDiscard() && studio.newCharacter(), 'New failed')}>New character</button>
        <button onClick={run(() => ui.setBrowserOpen(true), 'Could not open the character browser')} data-testid="menu-characters">
          Characters… <kbd>Ctrl+O</kbd>
        </button>
        <button onClick={run(async () => confirmDiscard() && (await studio.open()), 'Could not open the character')}>Open file…</button>
        <button onClick={run(async () => ui.info(`Saved ${await studio.save()}`), 'Save failed')}>
          Save <kbd>Ctrl+S</kbd>
        </button>
        <button onClick={run(async () => { const p = await studio.save(true); if (p) ui.info(`Saved ${p}`); }, 'Save failed')}>
          Save as… <kbd>Ctrl+Shift+S</kbd>
        </button>
        <button onClick={run(() => studio.duplicate(), 'Duplicate failed')}>Duplicate</button>
        <hr />
        <span className="menu-label">Presets</span>
        {BUILTIN_PRESETS.map((p) => (
          <button key={p.id} onClick={run(() => engine.replaceDoc(applyPreset(engine.doc, p), `Preset ${p.label}`), 'Preset failed')}>
            {p.label}
          </button>
        ))}
        <hr />
        <button onClick={run(() => backend.openLogFolder(), 'Could not open logs')}>Open log folder</button>
      </Menu>
      <Menu id="edit" label="Edit" open={menu} setOpen={setMenu}>
        <button disabled={!engine.history.canUndo} onClick={run(() => engine.undo(), 'Undo failed')}>
          Undo {engine.history.undoLabel ? `“${shortLabel(engine.history.undoLabel)}”` : ''} <kbd>Ctrl+Z</kbd>
        </button>
        <button disabled={!engine.history.canRedo} onClick={run(() => engine.redo(), 'Redo failed')}>
          Redo <kbd>Ctrl+Y</kbd>
        </button>
      </Menu>
      <Menu id="view" label="View" open={menu} setOpen={setMenu}>
        <label className="menu-check">
          <input type="checkbox" checked={ui.curated} onChange={(e) => ui.setCurated(e.target.checked)} /> Curated PS2 sliders
        </label>
        <label className="menu-check">
          <input type="checkbox" checked={ui.symmetry} onChange={(e) => ui.setSymmetry(e.target.checked)} /> Symmetry
        </label>
        <label className="menu-check">
          <input type="checkbox" checked={ui.wireOverlay} onChange={(e) => ui.setView({ wireOverlay: e.target.checked })} /> Wireframe overlay <kbd>W</kbd>
        </label>
      </Menu>
    </nav>
  );
}

function shortLabel(label: string): string {
  const s = label.replace(/^Change /, '');
  return s.length > 28 ? `${s.slice(0, 27)}…` : s;
}

function Menu(props: { id: Exclude<MenuId, null>; label: string; open: MenuId; setOpen: (m: MenuId) => void; children: ReactNode }) {
  const isOpen = props.open === props.id;
  return (
    <div className="menu" onMouseEnter={() => props.open && props.setOpen(props.id)}>
      <button className={isOpen ? 'menu-button open' : 'menu-button'} aria-expanded={isOpen} onClick={() => props.setOpen(isOpen ? null : props.id)}>
        {props.label}
      </button>
      {isOpen && <div className="menu-popup">{props.children}</div>}
    </div>
  );
}
