/**
 * The library browser (Part 2 F20): large thumbnails of everything the
 * creator can pick, rendered under the current look, by category, with
 * favourites, tags and search. Picking applies the entry to the character.
 */
import { LIBRARY_CATEGORIES } from '@ps2cc/core';
import { useUi } from '../../state/ui';
import { LibraryGrid } from './LibraryGrid';

export function LibraryBrowser() {
  const library = useUi((s) => s.library);
  const setLibrary = useUi((s) => s.setLibrary);
  const lookLabel = useUi((s) => s.customLook?.label ?? s.lighting);
  if (!library) return null;
  const close = () => setLibrary(null);
  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal library-modal" role="dialog" aria-labelledby="library-title" data-testid="library-browser" onClick={(e) => e.stopPropagation()}>
        <div className="library-head">
          <h2 id="library-title">Library</h2>
          <span className="muted">Thumbnails under the {lookLabel} look</span>
          <span className="spacer" />
          <button onClick={close} data-testid="library-close">
            Close
          </button>
        </div>
        <div className="toggle-row" role="tablist" aria-label="Library category">
          {LIBRARY_CATEGORIES.map((c) => (
            <button
              key={c.id}
              role="tab"
              aria-selected={library.category === c.id}
              className={library.category === c.id ? 'chip active' : 'chip'}
              onClick={() => setLibrary({ category: c.id })}
              data-testid={`library-category-${c.id}`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <LibraryGrid key={library.category} categories={[library.category]} size="large" testId="library-browser-grid" />
      </div>
    </div>
  );
}
