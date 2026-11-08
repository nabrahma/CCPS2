import { useMemo, useRef } from 'react';
import { randomizeCharacter, type SliderDef, type SliderTab } from '@ps2cc/core';
import { useStudio, useStudioVersion } from '../../state/hooks';
import { useUi } from '../../state/ui';
import { LockIcon, ResetIcon, ShuffleIcon } from '../icons';
import { FacePartsSection } from './FacePartsSection';

/** Body/Face slider panel (PRD F1): curated or all, search, symmetry, reset, lock, randomize. */
export function SliderPanel({ tab }: { tab: SliderTab }) {
  const studio = useStudio();
  useStudioVersion();
  const ui = useUi();
  const sliders = useMemo(() => {
    const list = studio.assets.sliders.search(ui.search, ui.curated).filter((s) => s.tab === tab);
    // When symmetry is on, show only the left side of paired modifiers (the right one follows).
    if (!ui.symmetry) return list;
    return list.filter((s) => !(s.symmetricOpposite && studio.assets.modifiers.byName.get(s.id)?.symmetrySide === 'r'));
  }, [studio, ui.search, ui.curated, ui.symmetry, tab]);
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
        <input
          className="search"
          type="search"
          placeholder="Search sliders…"
          value={ui.search}
          onChange={(e) => ui.setSearch(e.target.value)}
          aria-label="Search sliders"
        />
        <div className="toggle-row">
          <button className={ui.curated ? 'chip active' : 'chip'} onClick={() => ui.setCurated(true)}>
            Curated
          </button>
          <button className={!ui.curated ? 'chip active' : 'chip'} onClick={() => ui.setCurated(false)}>
            All
          </button>
          <label className="chip-check" title="Mirror left/right modifiers">
            <input type="checkbox" checked={ui.symmetry} onChange={(e) => ui.setSymmetry(e.target.checked)} /> Symmetry
          </label>
          <button className="chip" onClick={() => randomize()} title="Randomize this tab within safe ranges (R)">
            <ShuffleIcon /> Random
          </button>
        </div>
      </div>
      {groups.length === 0 && <p className="muted">No sliders match “{ui.search}”.</p>}
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
      {tab === 'face' && <FacePartsSection />}
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
    </div>
  );
}
