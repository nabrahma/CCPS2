/**
 * Crowd generator (PRD Part 3, F23): many different, believable adults from
 * one seed, for NPCs. Each gets its body from the population sampler, a stock
 * skin for its age and heritage, and hair and an outfit from the pools chosen
 * here. Preview one, save them all as characters, or save and export them all.
 */
import { useMemo, useState } from 'react';
import {
  BUILTIN_OUTFITS,
  generateCrowd,
  MAX_CROWD,
  serializeCharacter,
  STARTER_STYLES,
  type CharacterDoc,
  type CrowdMember,
  type HairSpec,
  type Outfit,
} from '@ps2cc/core';
import { backend } from '../../backend';
import { exportCharacter } from '../../export/exportCharacter';
import { useStudio, useStudioVersion } from '../../state/hooks';
import { useLibrary } from '../../state/library';
import { useUi } from '../../state/ui';

const cardHair = (doc: Readonly<CharacterDoc>, style: (typeof STARTER_STYLES)[number]['style']): HairSpec => ({ ...structuredClone(doc.hair), mode: 'cards', style, atlas: null });

export function CrowdStudio() {
  const studio = useStudio();
  useStudioVersion();
  const ui = useUi();
  const lib = useLibrary();
  const [seed, setSeed] = useState(() => (Math.random() * 1e6) | 0);
  const [count, setCount] = useState(10);
  const [prefix, setPrefix] = useState('Villager');
  const [variation, setVariation] = useState(0.5);
  const [useHair, setUseHair] = useState(true);
  const [useOutfits, setUseOutfits] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<number | null>(null);

  const doc = studio.engine.doc;
  const outfits: Outfit[] = useMemo(
    () => [...BUILTIN_OUTFITS, ...lib.outfits.map((o) => o.outfit)].map((o) => ({ ...o, garments: o.garments.filter((g) => studio.assets.hasProxy(g.asset)) })).filter((o) => o.garments.length > 0),
    [lib.outfits, studio],
  );
  const hair: HairSpec[] = useMemo(() => [...STARTER_STYLES.map((s) => cardHair(doc, s.style)), ...lib.hairstyles.map((h) => cardHair(doc, h.style))], [doc, lib.hairstyles]);

  const make = (n = count): CrowdMember[] => {
    const defaults = (a: string) => (studio.assets.hasProxy(a) ? studio.assets.proxyInfo(a).defaults : undefined);
    return generateCrowd(studio.assets.sliders, studio.assets, studio.assets.anthro, studio.assets.population, {
      seed,
      count: n,
      namePrefix: prefix,
      template: studio.newDocument('Crowd'),
      hair: useHair ? hair : [],
      outfits: useOutfits ? outfits : [],
      skins: studio.assets.catalog.skins.map((s) => s.id),
      garmentDefaults: defaults,
      variation,
    });
  };
  const members = useMemo(() => make(Math.min(count, 60)), [seed, count, prefix, variation, useHair, useOutfits, hair, outfits]); // eslint-disable-line react-hooks/exhaustive-deps

  const show = (i: number) => {
    const m = members[i];
    if (!m) return;
    studio.loadText(serializeCharacter(m.doc), { unsaved: true });
    setPreview(i);
  };

  const keepCurrent = async <T,>(work: () => Promise<T>): Promise<T> => {
    const text = serializeCharacter(studio.engine.doc as CharacterDoc);
    const path = studio.currentPath;
    const dirty = studio.dirty;
    try {
      return await work();
    } finally {
      studio.loadText(text, { path: path ?? undefined, unsaved: dirty });
      setPreview(null);
    }
  };

  const saveAll = async (exportToo: boolean) => {
    if (exportToo && !studio.engine.doc.export.unityProject) {
      ui.error('Choose your Unity project in Export first: the crowd is exported there');
      return;
    }
    const all = make();
    let done = 0;
    try {
      await keepCurrent(async () => {
        for (const m of all) {
          setBusy(`${exportToo ? 'Exporting' : 'Saving'} ${m.doc.name} (${done + 1} of ${all.length})`);
          await backend.save(serializeCharacter(m.doc));
          if (exportToo) {
            studio.engine.load(m.doc);
            await studio.settled();
            await exportCharacter(studio, { target: '', glb: false, tPose: m.doc.export.tPose });
          }
          done++;
        }
      });
      ui.info(`${exportToo ? 'Saved and exported' : 'Saved'} ${done} characters (${prefix} 001 to ${prefix} ${String(done).padStart(3, '0')})`);
    } catch (err) {
      ui.error(`Stopped after ${done} of ${all.length} characters`, err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="crowd-studio" data-testid="crowd-studio">
      <div className="picker-row">
        <label htmlFor="crowd-count">How many</label>
        <input id="crowd-count" type="number" min={1} max={MAX_CROWD} value={count} onChange={(e) => setCount(Math.min(MAX_CROWD, Math.max(1, Math.floor(Number(e.target.value) || 1))))} data-testid="crowd-count" />
      </div>
      <div className="picker-row">
        <label htmlFor="crowd-seed">Seed</label>
        <input id="crowd-seed" type="number" value={seed} onChange={(e) => setSeed(Math.floor(Number(e.target.value) || 0))} data-testid="crowd-seed" />
        <button className="chip" onClick={() => setSeed((Math.random() * 1e6) | 0)} title="A new crowd">
          New
        </button>
      </div>
      <div className="picker-row">
        <label htmlFor="crowd-prefix">Names</label>
        <input id="crowd-prefix" value={prefix} maxLength={40} onChange={(e) => setPrefix(e.target.value)} data-testid="crowd-prefix" />
      </div>
      <div className="picker-row">
        <label htmlFor="crowd-variation">Face and detail variety</label>
        <input id="crowd-variation" type="range" min={0} max={1} step={0.05} value={variation} onChange={(e) => setVariation(Number(e.target.value))} />
      </div>
      <label className="check">
        <input type="checkbox" checked={useHair} onChange={(e) => setUseHair(e.target.checked)} /> Hairstyles from the library ({hair.length})
      </label>
      <label className="check">
        <input type="checkbox" checked={useOutfits} onChange={(e) => setUseOutfits(e.target.checked)} /> Outfits from the library ({outfits.length})
      </label>
      <p className="hint">The same seed always makes the same people, and person 7 is the same whether you make 10 or 100. Bodies follow real-population statistics: ages 18 to 80, heights and builds as they are spread in people.</p>
      <div className="crowd-list" data-testid="crowd-list">
        {members.map((m, i) => (
          <button key={m.index} className={preview === i ? 'crowd-member active' : 'crowd-member'} onClick={() => show(i)} disabled={busy !== null} data-testid="crowd-member">
            <strong>{m.doc.name}</strong>
            <span className="muted">
              {m.person.sex === 'male' ? 'Man' : 'Woman'}, {Math.round(m.person.years)}, {Math.round(m.person.statureCm)} cm
            </span>
          </button>
        ))}
        {count > members.length && <p className="hint">and {count - members.length} more</p>}
      </div>
      {preview !== null && <p className="hint">Showing {members[preview]?.doc.name}. It is a new unsaved character; Save keeps it, or open your character again from File.</p>}
      <div className="tool-line">
        <button onClick={() => void saveAll(false)} disabled={busy !== null} data-testid="crowd-save">
          Save all {count}
        </button>
        <button className="primary" onClick={() => void saveAll(true)} disabled={busy !== null} data-testid="crowd-export" title="Save each one and export it to the Unity project">
          Save and export all
        </button>
      </div>
      {busy && <p className="hint" data-testid="crowd-busy">{busy}…</p>}
    </div>
  );
}
