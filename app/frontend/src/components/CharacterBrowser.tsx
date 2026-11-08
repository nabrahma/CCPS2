import { useEffect, useState } from 'react';
import { parseCharacter, serializeCharacter, type CharacterDoc } from '@ps2cc/core';
import { backend, isDesktop, type CharacterInfo } from '../backend';
import { useStudio } from '../state/hooks';
import { useUi } from '../state/ui';

/**
 * Character browser (PRD F10): every saved character with its thumbnail, to
 * open or duplicate. Thumbnails are written on save (studio.saveThumbnail).
 */
export function CharacterBrowser({ onClose }: { onClose: () => void }) {
  const studio = useStudio();
  const ui = useUi();
  const [list, setList] = useState<CharacterInfo[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = () =>
    backend
      .listCharacters()
      .then(setList)
      .catch((err: unknown) => ui.error('Could not list characters', err));
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const confirmDiscard = () => !studio.dirty || window.confirm('Discard unsaved changes to the current character?');

  const open = async (c: CharacterInfo) => {
    if (!confirmDiscard()) return;
    setBusy(c.path);
    try {
      await studio.openPath(c.path);
      ui.info(`Opened ${c.name}`);
      onClose();
    } catch (err) {
      ui.error(`Could not open ${c.name}`, err);
    } finally {
      setBusy(null);
    }
  };

  /** Save a copy under a new name and id (with its own thumbnail), then open it. */
  const duplicate = async (c: CharacterInfo) => {
    if (!confirmDiscard()) return;
    setBusy(c.path);
    try {
      const doc = parseCharacter(JSON.parse(await backend.load(c.path))) as CharacterDoc;
      const taken = new Set((list ?? []).map((x) => x.name.toLowerCase()));
      let name = `${doc.name} copy`;
      for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${doc.name} copy ${i}`;
      doc.id = crypto.randomUUID();
      doc.name = name;
      studio.loadText(serializeCharacter(doc), { unsaved: true });
      await studio.save();
      ui.info(`Duplicated ${c.name} as ${name}`);
      await refresh();
    } catch (err) {
      ui.error(`Could not duplicate ${c.name}`, err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal browser-modal" role="dialog" aria-labelledby="browser-title" data-testid="character-browser" onClick={(e) => e.stopPropagation()}>
        <h2 id="browser-title">Characters</h2>
        {!isDesktop() && <p className="hint">Saved characters are listed in the desktop app (in a browser, File → Open reads the last save).</p>}
        {list && list.length === 0 && <p className="muted">No saved characters yet. Save one with Ctrl+S.</p>}
        {!list && <p className="muted">Loading…</p>}
        <div className="character-grid">
          {list?.map((c) => (
            <figure key={c.path} className={c.name === studio.engine.doc.name ? 'character-card current' : 'character-card'} data-testid="character-card">
              <button className="character-thumb" onClick={() => void open(c)} disabled={busy !== null} title={`Open ${c.name}`}>
                {c.thumb ? <img src={c.thumb} alt="" loading="lazy" /> : <span className="muted">no thumbnail</span>}
              </button>
              <figcaption>
                <strong>{c.name}</strong>
                <span className="muted">{new Date(c.modified).toLocaleString()}</span>
              </figcaption>
              <div className="card-actions">
                <button onClick={() => void open(c)} disabled={busy !== null}>
                  Open
                </button>
                <button onClick={() => void duplicate(c)} disabled={busy !== null} data-testid="character-duplicate">
                  Duplicate
                </button>
              </div>
            </figure>
          ))}
        </div>
        <div className="modal-actions">
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
