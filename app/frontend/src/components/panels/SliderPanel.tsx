import { useMemo, useRef } from 'react';
import { randomizeCharacter, randomizeRealistic, type SliderDef, type SliderTab } from '@ps2cc/core';
import { useStudio, useStudioVersion } from '../../state/hooks';
import { refreshUserLibrary, toggleFavourite, useLibrary } from '../../state/library';
import { backend } from '../../backend';
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

  // Realistic random (PRD Part 3, F23): a person drawn from the population, not a flat spread of every slider.
  const realistic = () => {
    const seed = (Math.random() * 2 ** 31) | 0;
    const r = randomizeRealistic(studio.engine.doc, studio.assets.sliders, studio.assets, studio.assets.anthro, studio.assets.population, { seed, tab, locked: ui.locks });
    studio.engine.update(tab === 'body' ? 'Realistic random body' : 'Realistic random face', (d) => {
      d.macros = r.doc.macros;
      d.modifiers = r.doc.modifiers;
      if (tab === 'body') delete d.measurementTargets;
    });
    if (r.person) ui.info(`${r.person.sex === 'male' ? 'Man' : 'Woman'}, ${Math.round(r.person.years)} years, ${Math.round(r.person.statureCm)} cm`);
  };

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
          <button
            className="chip"
            onClick={realistic}
            title={tab === 'body' ? 'A realistic person: age, build and height drawn as they are spread in real people. Locked sliders stay.' : 'A believable face: small changes around the average, with a little left/right difference. Locked sliders stay.'}
            data-testid={`realistic-${tab}`}
          >
            <ShuffleIcon /> Realistic
          </button>
          <button className="chip" onClick={() => randomize(group ?? undefined)} title="Randomize within safe ranges (R)">
            <ShuffleIcon /> Randomize
          </button>
        </div>
      </div>
      {groups.length === 0 && (
        <p className="muted">{favourites && !ui.search ? 'No favourite sliders yet: click the heart on a slider to add it here.' : `No sliders match “${ui.search}”.`}</p>
      )}
      <UserSliders tab={tab} />
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

/** Sliders made from sculpts (PRD Part 3, F27): library .ps2target files, -1..1, on any character. */
function UserSliders({ tab }: { tab: SliderTab }) {
  const studio = useStudio();
  useStudioVersion();
  const ui = useUi();
  const list = studio.assets.userTargetList.filter((t) => t.tab === tab && (!ui.search || t.name.toLowerCase().includes(ui.search.toLowerCase())));
  if (list.length === 0) return null;
  const values = studio.engine.doc.userTargets ?? {};
  const set = (id: string, v: number, merge: boolean) =>
    studio.engine.update(
      'Your slider',
      (d) => {
        const next = { ...(d.userTargets ?? {}) };
        if (Math.abs(v) < 1e-4) delete next[id];
        else next[id] = v;
        if (Object.keys(next).length) d.userTargets = next;
        else delete d.userTargets;
      },
      merge ? `user-slider:${id}` : undefined,
    );
  const remove = async (id: string, file: string | undefined, name: string) => {
    if (!file || !window.confirm(`Delete the slider "${name}" from the library? Characters using it lose its shape.`)) return;
    try {
      await backend.deleteLibraryItem(file);
      await refreshUserLibrary(studio);
      if (values[id] !== undefined) set(id, 0, false);
    } catch (err) {
      ui.error('Could not delete the slider', err);
    }
  };
  return (
    <details open className="slider-group" data-testid={`user-sliders-${tab}`}>
      <summary>
        <span>Your sliders</span>
      </summary>
      {list.map((t) => {
        const v = values[t.id] ?? 0;
        return (
          <div key={t.id} className={v !== 0 ? 'slider-row changed' : 'slider-row'} title={`Made in Sculpt Studio (${t.id})`}>
            <label htmlFor={t.id}>{t.name}</label>
            <input
              id={t.id}
              type="range"
              min={-1}
              max={1}
              step={0.001}
              value={v}
              onChange={(e) => set(t.id, Number(e.target.value), true)}
              onPointerUp={() => studio.engine.endInteraction()}
              data-testid="user-slider"
            />
            <input className="num" type="number" min={-1} max={1} step={0.01} value={Number(v.toFixed(3))} onChange={(e) => Number.isFinite(Number(e.target.value)) && set(t.id, Math.min(1, Math.max(-1, Number(e.target.value))), false)} aria-label={`${t.name} value`} />
            <button className="icon" title="Reset to 0" disabled={v === 0} onClick={() => set(t.id, 0, false)}>
              <ResetIcon />
            </button>
            <button className="icon" title="Delete this slider from the library" onClick={() => void remove(t.id, t.file, t.name)}>
              ×
            </button>
          </div>
        );
      })}
    </details>
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
