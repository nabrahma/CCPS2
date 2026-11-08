import { useEffect, useState, type ReactNode } from 'react';
import { BUILTIN_PRESETS, applyPreset, parsePresetFile, presetFromCharacter, type Preset } from '@ps2cc/core';
import { backend } from '../backend';
import { runSliderSweep } from '../perf';
import { useStudio, useStudioVersion } from '../state/hooks';
import { useUi } from '../state/ui';

type MenuId = 'file' | 'edit' | 'view' | 'help' | null;

interface UserPreset {
  file: string;
  preset: Preset;
}

/** File, Edit, View and Help, at the top left of the viewport. */
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

  // User presets live in the library, so they are re-read each time the File menu opens.
  const [userPresets, setUserPresets] = useState<UserPreset[]>([]);
  const loadUserPresets = async () => {
    const items = await backend.listLibrary('presets');
    const known = (id: string) => studio.assets.modifiers.byName.has(id);
    const loaded = await Promise.all(
      items.map(async (item): Promise<UserPreset | null> => {
        try {
          return { file: item.file, preset: parsePresetFile(JSON.parse(await backend.readLibraryDocument(item.file)), known) };
        } catch (err) {
          backend.log('warn', `preset ${item.file} skipped: ${String(err)}`);
          return null;
        }
      }),
    );
    setUserPresets(loaded.filter((p): p is UserPreset => p !== null).sort((a, b) => a.preset.label.localeCompare(b.preset.label)));
  };
  useEffect(() => {
    if (menu === 'file') loadUserPresets().catch((err: unknown) => ui.error('Could not list your presets', err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu]);

  const measureSpeed = async () => {
    const r = await runSliderSweep(studio);
    backend.log('info', `slider sweep: ${JSON.stringify(r)}`);
    ui.info(`${r.fps} fps while dragging sliders (${r.meets60fps ? 'meets' : 'below'} the 60 fps target) on ${r.gpu}. One update takes ${r.updateMs.p50} ms. Saved to the log.`);
  };

  const savePreset = async () => {
    const name = window.prompt('Save these sliders as a preset named', engine.doc.name)?.trim();
    if (!name) return;
    await backend.savePreset(name, JSON.stringify(presetFromCharacter(engine.doc, name), null, 2));
    ui.info(`Saved preset ${name}`);
  };

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
        {userPresets.map(({ file, preset }) => (
          <div className="menu-row" key={file}>
            <button onClick={run(() => engine.replaceDoc(applyPreset(engine.doc, preset), `Preset ${preset.label}`), 'Preset failed')}>{preset.label}</button>
            <button
              className="menu-row-delete"
              title={`Delete preset ${preset.label}`}
              aria-label={`Delete preset ${preset.label}`}
              onClick={() => {
                if (!window.confirm(`Delete the preset ${preset.label}?`)) return;
                backend
                  .deleteLibraryItem(file)
                  .then(loadUserPresets)
                  .catch((err: unknown) => ui.error('Could not delete the preset', err));
              }}
            >
              ×
            </button>
          </div>
        ))}
        <button onClick={run(savePreset, 'Could not save the preset')} data-testid="menu-save-preset">
          Save sliders as preset…
        </button>
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
      <Menu id="help" label="Help" open={menu} setOpen={setMenu}>
        <button onClick={run(() => ui.setCreditsOpen(true), 'Could not open the credits')} data-testid="menu-credits">
          Credits…
        </button>
        <button onClick={run(measureSpeed, 'Could not measure the speed')} data-testid="menu-sweep">
          Measure slider speed
        </button>
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
