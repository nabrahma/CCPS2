/**
 * Library grid (Part 2 F20; D-149): entries of one or more categories as
 * thumbnails rendered under the viewport's look. Above it, when asked: a
 * search box, one plain filter (length, gender...) and a favourites star.
 * Clicking an entry picks it; your own entries can be edited or deleted from
 * the small buttons on their card.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { entryTags, searchLibrary, type LibraryCategory } from '@ps2cc/core';
import { useStudio, useStudioVersion } from '../../state/hooks';
import { libraryEntries, toggleFavourite, useLibrary, type CreatorEntry } from '../../state/library';
import { useUi } from '../../state/ui';
import { THUMB_LARGE, THUMB_SMALL } from '../../thumbs/stage';
import { StarIcon } from '../icons';

/** One choice of the grid's filter. */
export interface LibraryFacet {
  id: string;
  label: string;
  test: (e: CreatorEntry) => boolean;
}

export interface LibraryGridProps {
  categories: readonly LibraryCategory[];
  /** Only entries this accepts. */
  filter?: (e: CreatorEntry) => boolean;
  size?: 'small' | 'large';
  /** Search and the favourites star above the grid. */
  tools?: boolean;
  /** The filter menu's choices (besides "All"). */
  facets?: readonly LibraryFacet[];
  /** What the filter menu's "All" says. */
  allLabel?: string;
  /** Most entries shown before "Show all". */
  limit?: number;
  testId?: string;
  /** After an entry is picked. */
  onPicked?: (e: CreatorEntry) => void;
}

export function LibraryGrid({ categories, filter, size = 'small', tools = true, facets, allLabel = 'All', limit, testId, onPicked }: LibraryGridProps) {
  const studio = useStudio();
  const version = useStudioVersion();
  const lib = useLibrary();
  const [text, setText] = useState('');
  const [facet, setFacet] = useState('');
  const [favOnly, setFavOnly] = useState(false);
  const [all, setAll] = useState(false);
  const entries = useMemo(
    () => categories.flatMap((c) => libraryEntries(studio, c)).filter((e) => !filter || filter(e)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [studio, categories.join(','), filter, lib.version, version],
  );
  const favourites = useMemo(() => new Set(lib.favourites), [lib.favourites]);
  const hits = useMemo(() => {
    const found = searchLibrary(entries, { text, tag: null, favouritesOnly: favOnly }, favourites, lib.tags);
    const f = facets?.find((x) => x.id === facet);
    return f ? found.filter(f.test) : found;
  }, [entries, text, favOnly, favourites, lib.tags, facets, facet]);
  const narrowed = Boolean(text || facet || favOnly);
  const shown = limit && !all && !narrowed ? hits.slice(0, limit) : hits;
  const doc = studio.engine.doc;
  return (
    <div className={`library-grid-wrap ${size}`} data-testid={testId}>
      {tools && (
        <div className="library-tools">
          <input className="search" type="search" placeholder="Search…" value={text} onChange={(e) => setText(e.target.value)} aria-label="Search" data-testid="library-search" />
          {facets && facets.length > 0 && (
            <select value={facet} onChange={(e) => setFacet(e.target.value)} aria-label="Filter" data-testid="library-filter">
              <option value="">{allLabel}</option>
              {facets.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          )}
          <button className={favOnly ? 'icon fav-toggle on' : 'icon fav-toggle'} aria-pressed={favOnly} onClick={() => setFavOnly(!favOnly)} data-testid="library-favourites" title="Favourites only" aria-label="Favourites only">
            <StarIcon filled={favOnly} />
          </button>
        </div>
      )}
      {shown.length === 0 && <p className="muted">{favOnly ? 'No favourites here yet: star one to add it.' : 'Nothing matches.'}</p>}
      <div className={`library-grid ${size}`} role="list">
        {shown.map((e) => (
          <LibraryCard key={e.id} entry={e} size={size} active={e.active(doc)} favourite={favourites.has(e.id)} tags={entryTags(e, lib.tags)} onPicked={onPicked} />
        ))}
      </div>
      {limit && !all && !narrowed && shown.length < hits.length && (
        <button className="link" onClick={() => setAll(true)} data-testid="library-show-all">
          Show all {hits.length}
        </button>
      )}
    </div>
  );
}

function LibraryCard({ entry, size, active, favourite, tags, onPicked }: { entry: CreatorEntry; size: 'small' | 'large'; active: boolean; favourite: boolean; tags: string[]; onPicked?: (e: CreatorEntry) => void }) {
  const studio = useStudio();
  const ui = useUi();
  const pick = () => {
    entry.apply();
    onPicked?.(entry);
  };
  const remove = () => {
    if (!entry.remove || !window.confirm(`Delete ${entry.name} from your library?`)) return;
    entry.remove().then(
      () => ui.info(`Deleted ${entry.name}`),
      (err: unknown) => ui.error(`Could not delete ${entry.name}`, err),
    );
  };
  return (
    <div className={active ? 'library-card active' : 'library-card'} role="listitem" data-testid="library-card" data-entry={entry.id} data-active={active}>
      <button className="library-thumb" onClick={pick} title={entry.name} aria-label={entry.name} aria-pressed={active}>
        <Thumb entry={entry} size={size} />
        {entry.badge && <span className="thumb-badge">{entry.badge}</span>}
      </button>
      {(entry.edit || entry.remove) && (
        <div className="card-actions-mini">
          {entry.edit && (
            <button onClick={() => entry.edit!()} data-testid="library-edit" title="Open it in the Asset Studio">
              Edit
            </button>
          )}
          {entry.remove && (
            <button className="danger" onClick={remove} data-testid="library-delete" title="Delete it from your library">
              Delete
            </button>
          )}
        </div>
      )}
      <div className="library-caption">
        <span className="library-name" onClick={pick} title={tags.length ? `${entry.name} (${tags.join(', ')})` : entry.name}>
          {entry.name}
        </span>
        <button className={favourite ? 'icon star on' : 'icon star'} onClick={() => toggleFavourite(studio, entry.id)} aria-label={favourite ? `Remove ${entry.name} from favourites` : `Add ${entry.name} to favourites`} aria-pressed={favourite} data-testid="library-star">
          <StarIcon filled={favourite} />
        </button>
      </div>
    </div>
  );
}

/** A thumbnail rendered when it scrolls into view, again when the look changes. */
export function Thumb({ entry, size }: { entry: CreatorEntry; size: 'small' | 'large' }) {
  const studio = useStudio();
  useStudioVersion();
  // Re-render when the look changes: the stage's key includes it.
  useUi((s) => `${s.lighting}|${s.customLook?.id ?? ''}|${s.lightingModel}|${s.shadowMode}`);
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const dims = size === 'large' ? THUMB_LARGE : THUMB_SMALL;
  const key = `${entry.thumbId}|${studio.thumbnails.lookKey()}${entry.subject.kind === 'look' ? `|${studio.getVersion()}` : ''}`;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((list) => setVisible(list.some((x) => x.isIntersecting)), { rootMargin: '120px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    setFailed(false);
    studio.thumbnails.thumb(entry.thumbId, entry.subject, dims).then(
      (u) => alive && setUrl(u),
      (err: unknown) => {
        if (alive && !(err instanceof Error && err.message === 'cancelled')) setFailed(true);
      },
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, key]);
  return (
    <div ref={ref} className="thumb-frame" style={{ aspectRatio: `${dims[0]} / ${dims[1]}` }} data-testid="thumb" data-state={url ? 'ready' : failed ? 'failed' : 'loading'}>
      {url ? <img src={url} alt="" draggable={false} /> : <span className="muted">{failed ? 'no preview' : '…'}</span>}
    </div>
  );
}
