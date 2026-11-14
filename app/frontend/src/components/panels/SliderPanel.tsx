import { useMemo, useRef } from 'react';
import { randomizeCharacter, type SliderDef, type SliderTab } from '@ps2cc/core';
import { useStudio, useStudioVersion } from '../../state/hooks';
import { toggleFavourite, useLibrary } from '../../state/library';
import { useUi } from '../../state/ui';
import { HeartIcon, LockIcon, ResetIcon, ShuffleIcon } from '../icons';

/**
 * Body and Face sliders (PRD F1; D-149): search and a region menu on top;
 * symmetry, favourites and randomize under them; then the sliders by region.
 * Every slider has reset, lock (for randomize) and a heart (favourites).
 */
export function SliderPanel({ tab }: { tab: SliderTab }) {
  const studio = useStudio();
  useStudioVersion();
  const ui = useUi();
  const focus = ui.sliderFocus.sub === tab ? ui.sliderFocus : { sub: tab, group: null, favourites: false };
  const group = focus.group;
  const favourites = focus.favourites;
  const regions = useMemo(() => [...new Set(studio.assets.sliders.search('', ui.curated).filter((s) => s.tab === tab).map((s) => s.group))], [studio, ui.curated, tab]);
  const favs = useLibrary((s) => s.favourites);
  const sliders = useMemo(() => {
    const liked = new Set(favs.filter((f) => f.startsWith('slider:')).map((f) => f.slice('slider:'.length)));
    const list = studio.assets.sliders
      .search(ui.search, ui.curated && !favourites)
      .filter((s) => (favourites ? liked.has(s.id) : s.tab === tab && (!group || s.group === group)));
    // When symmetry is on, show only the left side of paired modifiers (the right one follows).
    if (!ui.symmetry) return list;
    return list.filter((s) => !(s.symmetricOpposite && studio.assets.modifiers.byName.get(s.id)?.symmetrySide === 'r'));
  }, [studio, ui.search, ui.curated, ui.symmetry, tab, group, favourites, favs]);
  const groups = useMemo(() => {
    const m = new Map<string, SliderDef[]>();
    for (const s of sliders) {
      const list = m.get(s.group);
      if (list) list.push(s);
      else m.set(s.group, [s]);
    }
    return [...m.entries()];
  }, [sliders]);

  const randomize = (group?: string) =>
    studio.engine.replaceDoc(
      randomizeCharacter(studio.engine.doc, studio.assets.sliders, {
        seed: (Math.random() * 2 ** 31) | 0,
        tab,
        group,
        locked: ui.locks,
        includeAll: !ui.curated,
      }),
      group ? `Randomize ${group}` : `Randomize ${tab}`,
    );

  return (
    <div className="slider-panel">
      <div className="panel-tools">
        <div className="tool-line">
          <input
            className="search"
            type="search"
            placeholder="Search sliders…"
            value={ui.search}
            onChange={(e) => ui.setSearch(e.target.value)}
            aria-label="Search sliders"
          />
          <select
            value={favourites ? '♥' : (group ?? '')}
            onChange={(e) => ui.focusSliders(e.target.value === '♥' ? { sub: tab, favourites: true } : { sub: tab, group: e.target.value || null })}
            aria-label="Region"
            data-testid={`region-${tab}`}
          >
            <option value="">All regions</option>
            {regions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
            <option value={'♥'}>Favourite sliders</option>
          </select>
        </div>
        <div className="tool-line">
          <label className="check" title="Move left and right together">
            <input type="checkbox" checked={ui.symmetry} onChange={(e) => ui.setSymmetry(e.target.checked)} /> Symmetry
          </label>
          <label className="check" title="Every MakeHuman slider and its full range, not just the PS2 set">
            <input type="checkbox" checked={!ui.curated} onChange={(e) => ui.setCurated(!e.target.checked)} data-testid="sliders-all" /> Every slider
          </label>
          <span className="tb-spacer" />
          <button className="chip" onClick={() => randomize(group ?? undefined)} title="Randomize within safe ranges (R)">
            <ShuffleIcon /> Randomize
          </button>
        </div>
      </div>
      {groups.length === 0 && (
        <p className="muted">{favourites && !ui.search ? 'No favourite sliders yet: click the heart on a slider to add it here.' : `No sliders match “${ui.search}”.`}</p>
      )}
      {groups.map(([group, list]) => (
        <details key={group} open className="slider-group">
          <summary>
            <span>{group}</span>
            <button
              className="icon"
              title={`Randomize ${group}`}
              onClick={(e) => {
                e.preventDefault();
                randomize(group);
              }}
            >
              <ShuffleIcon />
            </button>
          </summary>
          {list.map((s) => (
            <SliderRow key={s.id} def={s} />
          ))}
        </details>
      ))}
    </div>
  );
}

function SliderRow({ def }: { def: SliderDef }) {
  const studio = useStudio();
  const ui = useUi();
  const value = studio.engine.value(def.id);
  const dragging = useRef(false);
  const min = ui.curated ? def.safeMin : def.min;
  const max = ui.curated ? def.safeMax : def.max;
  const set = (v: number, merge: boolean) =>
    studio.engine.setValue(def.id, v, { mergeKey: merge ? `slider:${def.id}` : undefined, symmetry: ui.symmetry });
  const locked = ui.locks.has(def.id);
  const liked = useLibrary((s) => s.favourites.includes(`slider:${def.id}`));
  const changed = Math.abs(value - def.defaultValue) > 1e-6;
  return (
    <div className={changed ? 'slider-row changed' : 'slider-row'} title={def.description || def.id}>
      <label htmlFor={def.id}>{def.label}</label>
      <input
        id={def.id}
        type="range"
        min={min}
        max={max}
        step={0.001}
        value={Math.min(max, Math.max(min, value))}
        onPointerDown={() => (dragging.current = true)}
        onChange={(e) => set(Number(e.target.value), true)}
        onPointerUp={() => {
          dragging.current = false;
          studio.engine.endInteraction();
        }}
        onKeyUp={() => studio.engine.endInteraction()}
      />
      <input
        className="num"
        type="number"
        min={def.min}
        max={def.max}
        step={0.01}
        value={Number(value.toFixed(3))}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) set(v, false);
        }}
        aria-label={`${def.label} value`}
      />
      <button className="icon" title="Reset to default" disabled={!changed} onClick={() => studio.engine.resetValue(def.id, { symmetry: ui.symmetry })}>
        <ResetIcon />
      </button>
      <button className={locked ? 'icon locked' : 'icon'} title={locked ? 'Unlock for randomize' : 'Lock for randomize'} onClick={() => ui.toggleLock(def.id)}>
        <LockIcon />
      </button>
      <button
        className={liked ? 'icon liked' : 'icon'}
        title={liked ? 'Remove from favourite sliders' : 'Add to favourite sliders'}
        aria-label={liked ? `Remove ${def.label} from favourites` : `Add ${def.label} to favourites`}
        aria-pressed={liked}
        onClick={() => toggleFavourite(studio, `slider:${def.id}`)}
        data-testid="slider-favourite"
      >
        <HeartIcon filled={liked} />
      </button>
    </div>
  );
}
