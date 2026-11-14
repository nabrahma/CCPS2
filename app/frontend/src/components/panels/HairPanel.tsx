import { useEffect, useState, type ReactNode } from 'react';
import {
  DEFAULT_HAIR_COLOUR,
  DEFAULT_HAIR_STYLE,
  HAIR_COLOUR_PRESETS,
  HAIRLINE_PRESETS,
  NEUTRAL_ADJUST,
  STRAND_PRESET_PARAMS,
  STRAND_PRESETS,
  withScalpLayer,
  type HairAdjust,
  type HairColour,
  type StrandPreset,
  hairlineToPaint,
  hairStyleFile,
  parseHairStyleFile,
  STARTER_STYLES,
  starterStyle,
  styleForBudget,
  type HairlinePreset,
  type HairStyleParams,
  type PartSide,
} from '@ps2cc/core';
import { HairlinePainter } from './HairlinePainter';
import { backend, libraryUrl, type LibraryItem } from '../../backend';
import { useStudio, useStudioVersion } from '../../state/hooks';
import { refreshUserLibrary } from '../../state/library';
import { useUi } from '../../state/ui';

type Mode = 'none' | 'mesh' | 'cards';

/**
 * Hair (PRD F5): route A re-textures and tints MakeHuman hair meshes; route B
 * generates alpha-card hair from a style and a card atlas.
 */
export function HairPanel() {
  const studio = useStudio();
  useStudioVersion();
  const hair = studio.engine.doc.hair;
  const setMode = (mode: Mode) =>
    studio.engine.update('Hair mode', (d) => {
      // New card hair is Hair v2: a starter style with locks, a colour and the scalp layer.
      if (mode === 'cards') d.hair = { ...d.hair, mode, style: d.hair.style ?? starterStyle('short-messy'), atlas: d.hair.atlas ?? null, colour: d.hair.colour ?? structuredClone(DEFAULT_HAIR_COLOUR) };
      else if (mode === 'mesh') {
        const first = studio.assets.catalog.proxies.find((p) => p.category === 'hair');
        d.hair = { ...d.hair, mode, asset: d.hair.asset ?? first?.id };
      } else d.hair = { ...d.hair, mode };
      withScalpLayer(d);
    });
  return (
    <div className="slider-panel">
      <div className="toggle-row" role="tablist" aria-label="Hair type">
        {(['none', 'mesh', 'cards'] as Mode[]).map((m) => (
          <button key={m} role="tab" aria-selected={hair.mode === m} className={hair.mode === m ? 'chip active' : 'chip'} onClick={() => setMode(m)}>
            {{ none: 'Bald', mesh: 'Hair meshes', cards: 'Card hair' }[m]}
          </button>
        ))}
      </div>
      {hair.mode === 'mesh' && <MeshHair />}
      {hair.mode === 'cards' && <CardHair />}
      {hair.mode !== 'none' && <HairLook />}
    </div>
  );
}

/** Route A: MakeHuman hair meshes (decimated to the 3,500-triangle hair budget at build time). */
function MeshHair() {
  const studio = useStudio();
  const hair = studio.engine.doc.hair;
  const items = studio.assets.catalog.proxies.filter((p) => p.category === 'hair');
  return (
    <>
      <div className="picker-row">
        <label htmlFor="hair-mesh">Hair mesh</label>
        <select
          id="hair-mesh"
          value={hair.asset ?? ''}
          onChange={(e) => studio.engine.update('Change hair', (d) => void (d.hair = { ...d.hair, asset: e.target.value, texture: null }))}
        >
          {items.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.triangles.toLocaleString()} tris{p.overBudget ? ', over budget' : ''})
            </option>
          ))}
        </select>
      </div>
      {hair.texture && (
        <button onClick={() => studio.engine.update('Reset hair texture', (d) => void (d.hair.texture = null))}>Use original texture</button>
      )}
      <p className="hint">Drop a PNG on the hair to re-texture it. Click the hair, then use Export UV template to paint one that fits.</p>
    </>
  );
}

/** Route B: generated card hair. */
function CardHair() {
  const studio = useStudio();
  const ui = useUi();
  const style = studio.engine.doc.hair.style ?? DEFAULT_HAIR_STYLE;
  const atlas = studio.engine.doc.hair.atlas;
  const [saved, setSaved] = useState<LibraryItem[]>([]);
  const triangles = studio.scene.parts.find((p) => p.key === 'hair')?.triangleCount ?? 0;
  useEffect(() => {
    void backend.listLibrary('hairstyles').then(setSaved).catch(() => setSaved([]));
  }, []);
  const edit = (label: string, fn: (s: HairStyleParams) => void, merge?: string) =>
    studio.engine.update(
      label,
      (d) => {
        const s = structuredClone(d.hair.style ?? DEFAULT_HAIR_STYLE);
        fn(s);
        d.hair.style = s;
        withScalpLayer(d);
      },
      merge,
    );
  const editHair = (label: string, fn: (h: { colour: HairColour; adjust: HairAdjust }) => void, merge?: string) =>
    studio.engine.update(
      label,
      (d) => {
        const h = { colour: structuredClone(d.hair.colour ?? DEFAULT_HAIR_COLOUR), adjust: { ...(d.hair.adjust ?? NEUTRAL_ADJUST) } };
        fn(h);
        d.hair.colour = h.colour;
        d.hair.adjust = h.adjust;
        withScalpLayer(d);
      },
      merge,
    );
  const colour = studio.engine.doc.hair.colour;
  const adjust = studio.engine.doc.hair.adjust ?? NEUTRAL_ADJUST;
  const pickStyle = async (value: string) => {
    try {
      const next = value.startsWith('starter:')
        ? starterStyle(value.slice('starter:'.length))
        : parseHairStyleFile(JSON.parse(await backend.readLibraryDocument(value)));
      studio.engine.update('Hairstyle', (d) => {
        d.hair.style = next;
        // Hair v2 styles come with their colour gradient (kept if one is set) and the scalp layer.
        if (next.locks.enabled) d.hair.colour ??= structuredClone(DEFAULT_HAIR_COLOUR);
        withScalpLayer(d);
      });
    } catch (err) {
      ui.error('Could not load the hairstyle', err);
    }
  };
  const saveStyle = async () => {
    const name = window.prompt('Save hairstyle as', style.name);
    if (!name) return;
    try {
      const item = await backend.saveHairstyle(name, JSON.stringify(hairStyleFile({ ...style, name }), null, 2));
      setSaved(await backend.listLibrary('hairstyles'));
      await refreshUserLibrary(studio);
      ui.info(`Saved ${item.name}.ps2hair`);
    } catch (err) {
      ui.error('Could not save the hairstyle', err);
    }
  };
  const loadAtlasImage = async () => {
    try {
      const [item] = await backend.pickAndImport('hair-atlases');
      if (!item) return;
      const existing = await backend.loadAtlas(item.file);
      const regions = existing ? (JSON.parse(existing) as { regions: [] }).regions : null;
      ui.openAtlasEditor({ texture: libraryUrl(studio.info, item.file), libraryFile: item.file, name: item.name, regions });
    } catch (err) {
      ui.error('Could not import the atlas', err);
    }
  };
  const builtIns = studio.assets.catalog.hairAtlases ?? [];
  // The atlas used when the hair has none of its own (as the scene picks it): Hair v2 hair the
  // strand atlas of its style, older hair the brown card atlas it was made with.
  const builtIn = studio.engine.doc.hair.colour
    ? (builtIns.find((b) => b.strands === style.strands) ?? builtIns.find((b) => b.strands))
    : (builtIns.find((b) => b.id === 'ps2cc:atlas/cards_brown') ?? builtIns.find((b) => !b.atlas.greyscale));
  const current = atlas ?? builtIn?.atlas ?? null;
  // The budget the hair is generated to: the style's, scaled by the quality profile (F13).
  const [lo, hi] = styleForBudget(style, studio.engine.doc.export.hairBudget).budget;
  const n = (label: string, path: string, v: number, min: number, max: number, step: number, set: (s: HairStyleParams, v: number) => void, unit = '') => (
    <Slider key={path} label={label} value={v} min={min} max={max} step={step} unit={unit}
      onChange={(x) => edit(label, (s) => set(s, x), `hair:${path}`)} onDone={() => studio.engine.endInteraction()} />
  );
  return (
    <>
      <div className="picker-row">
        <label htmlFor="hair-style">Style</label>
        <select id="hair-style" value="" onChange={(e) => e.target.value && void pickStyle(e.target.value)}>
          <option value="">{style.name}</option>
          <optgroup label="Starter styles">
            {STARTER_STYLES.map((s) => (
              <option key={s.id} value={`starter:${s.id}`}>{s.style.name}</option>
            ))}
          </optgroup>
          {saved.length > 0 && (
            <optgroup label="My styles">
              {saved.map((s) => (
                <option key={s.file} value={s.file}>{s.name}</option>
              ))}
            </optgroup>
          )}
        </select>
      </div>
      <p className={triangles > hi || triangles < lo ? 'hint warn' : 'hint'} data-testid="hair-budget">
        {triangles.toLocaleString()} triangles (style budget {lo.toLocaleString()}–{hi.toLocaleString()})
      </p>
      <div className="toggle-row">
        <button onClick={() => edit('New hair seed', (s) => void (s.seed = (s.seed * 48271 + 11) % 2147483647))} title="Same style, new random strands">
          New seed ({style.seed})
        </button>
        <button onClick={() => void saveStyle()}>Save style…</button>
        <button className={ui.hairStudio ? 'active' : ''} aria-pressed={ui.hairStudio} onClick={() => ui.setView({ hairStudio: !ui.hairStudio })} data-testid="hair-groom-toggle" title="The groom brushes over the viewport: comb the guides, draw the parting, shape locks">
          Groom brushes
        </button>
      </div>

      <Section title="Colour">
        <div className="picker-row">
          <label htmlFor="hair-colour-preset">Preset</label>
          <select
            id="hair-colour-preset"
            data-testid="hair-colour-preset"
            value=""
            onChange={(e) => {
              const pick = HAIR_COLOUR_PRESETS[e.target.value];
              if (pick) editHair('Hair colour', (h) => void (h.colour = structuredClone(pick.colour)));
            }}
          >
            <option value="">{colour ? 'Choose…' : 'Part 1 card colours (tint)'}</option>
            {Object.entries(HAIR_COLOUR_PRESETS).map(([id, c]) => (
              <option key={id} value={id}>{c.name}</option>
            ))}
          </select>
        </div>
        {colour && (
          <>
            <TintRow label="Colour" color={colour.base} onChange={(c) => editHair('Hair colour', (h) => void (h.colour.base = c), 'hair-colour')} />
            <Slider label="Darker roots" value={colour.rootDarken} min={0} max={1} step={0.01} onChange={(v) => editHair('Darker roots', (h) => void (h.colour.rootDarken = v), 'hair-roots')} onDone={() => studio.engine.endInteraction()} />
            <Slider label="Lighter tips" value={colour.tipLighten} min={0} max={1} step={0.01} onChange={(v) => editHair('Lighter tips', (h) => void (h.colour.tipLighten = v), 'hair-tips')} onDone={() => studio.engine.endInteraction()} />
            <Slider label="Streaks" value={colour.streaks} min={0} max={1} step={0.01} onChange={(v) => editHair('Streaks', (h) => void (h.colour.streaks = v), 'hair-streaks')} onDone={() => studio.engine.endInteraction()} />
            {colour.streaks > 0 && <TintRow label="Streak colour" color={colour.streakColour} onChange={(c) => editHair('Streak colour', (h) => void (h.colour.streakColour = c), 'hair-streak-colour')} />}
            <Slider label="Grey" value={colour.grey} min={0} max={1} step={0.01} onChange={(v) => editHair('Grey hair', (h) => void (h.colour.grey = v), 'hair-grey')} onDone={() => studio.engine.endInteraction()} />
          </>
        )}
      </Section>

      <Section title="Adjust">
        <p className="hint">On top of the style, which stays as it was made.</p>
        <Slider label="Length" value={adjust.length} min={0.5} max={1.6} step={0.01} onChange={(v) => editHair('Hair length', (h) => void (h.adjust.length = v), 'hair-adj-len')} onDone={() => studio.engine.endInteraction()} />
        <Slider label="Volume" value={adjust.volume} min={0.3} max={2} step={0.01} onChange={(v) => editHair('Hair volume', (h) => void (h.adjust.volume = v), 'hair-adj-vol')} onDone={() => studio.engine.endInteraction()} />
        <Slider label="Fringe" value={adjust.fringe} min={0.5} max={1.6} step={0.01} onChange={(v) => editHair('Fringe length', (h) => void (h.adjust.fringe = v), 'hair-adj-fringe')} onDone={() => studio.engine.endInteraction()} />
      </Section>

      <Section title="Locks">
        <label className="check">
          <input type="checkbox" checked={style.locks.enabled} onChange={(e) => edit('Locks', (s) => void (s.locks.enabled = e.target.checked))} data-testid="hair-locks" /> Hair mass from locks (wide ribbons under the cards)
        </label>
        {style.locks.enabled && n('Locks', 'lk-count', style.locks.count, 0, 300, 1, (s, v) => void (s.locks.count = Math.round(v)))}
        {style.locks.enabled && n('Lock width', 'lk-width', style.locks.width, 0.02, 0.16, 0.001, (s, v) => void (s.locks.width = v), 'm')}
        {style.locks.enabled && n('Bow', 'lk-bow', style.locks.bow, 0, 1, 0.01, (s, v) => void (s.locks.bow = v))}
        {style.locks.enabled && n('Share of budget', 'lk-share', style.locks.share, 0, 1, 0.01, (s, v) => void (s.locks.share = v))}
      </Section>

      <Section title="Card texture">
        <div className="picker-row">
          <label htmlFor="hair-atlas">Texture</label>
          <select
            id="hair-atlas"
            data-testid="hair-atlas"
            value={atlas ? (builtIns.find((b) => b.atlas.texture === atlas.texture)?.id ?? 'own') : (builtIn?.id ?? '')}
            onChange={(e) => {
              const pick = builtIns.find((b) => b.id === e.target.value);
              // The default built-in is stored as "no atlas of its own".
              if (pick) studio.engine.update('Hair card texture', (d) => void (d.hair.atlas = pick === builtIn ? null : structuredClone(pick.atlas)));
            }}
          >
            {builtIns.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
            {atlas && !builtIns.some((b) => b.atlas.texture === atlas.texture) && <option value="own">Your texture ({atlas.regions.length} regions)</option>}
          </select>
        </div>
        <div className="picker-row">
          <label htmlFor="hair-strands">Strands</label>
          <select id="hair-strands" data-testid="hair-strands" value={style.strands} onChange={(e) => edit('Hair strands', (s) => void (s.strands = e.target.value as StrandPreset))}>
            {STRAND_PRESETS.map((p) => (
              <option key={p} value={p}>{STRAND_PRESET_PARAMS[p].name}</option>
            ))}
          </select>
        </div>
        <p className="hint">Drop your own card texture (PNG with alpha) on the hair, or load one. Strips are found automatically.</p>
        <div className="toggle-row wrap">
          <button onClick={() => void loadAtlasImage()}>Load atlas PNG…</button>
          {current && current.texture && (
            <button onClick={() => ui.openAtlasEditor({ texture: current.texture, libraryFile: null, name: atlas ? 'current atlas' : (builtIn?.name ?? 'atlas'), regions: current.regions })}>
              Edit regions…
            </button>
          )}
        </div>
      </Section>

      <Section title="Length">
        {n('Front', 'len-front', style.length.front, 0, 0.6, 0.005, (s, v) => void (s.length.front = v), 'm')}
        {n('Sides', 'len-sides', style.length.sides, 0, 0.6, 0.005, (s, v) => void (s.length.sides = v), 'm')}
        {n('Back', 'len-back', style.length.back, 0, 0.6, 0.005, (s, v) => void (s.length.back = v), 'm')}
        {n('Top', 'len-top', style.length.top, 0, 0.6, 0.005, (s, v) => void (s.length.top = v), 'm')}
        {n('Randomness', 'len-jitter', style.lengthJitter, 0, 1, 0.01, (s, v) => void (s.lengthJitter = v))}
      </Section>

      <Section title="Flow">
        <div className="picker-row">
          <label htmlFor="hair-part">Part</label>
          <select id="hair-part" value={style.part.side} onChange={(e) => edit('Hair part', (s) => void (s.part.side = e.target.value as PartSide))}>
            <option value="none">None</option>
            <option value="left">Left</option>
            <option value="center">Centre</option>
            <option value="right">Right</option>
          </select>
        </div>
        {style.part.side !== 'none' && n('Part position', 'part-pos', style.part.position, -1, 1, 0.01, (s, v) => void (s.part.position = v))}
        {n('Combed back', 'flow-back', style.flowBack, 0, 1, 0.01, (s, v) => void (s.flowBack = v))}
        {n('Frame the face', 'frame', style.frame, 0, 1, 0.01, (s, v) => void (s.frame = v))}
        {n('Gravity', 'gravity', style.gravity, 0, 1, 0.01, (s, v) => void (s.gravity = v))}
        {n('Volume', 'volume', style.volume, 0, 0.04, 0.001, (s, v) => void (s.volume = v), 'm')}
        {n('Curl size', 'curl-amp', style.curl.amplitude, 0, 0.03, 0.0005, (s, v) => void (s.curl.amplitude = v), 'm')}
        {n('Curl frequency', 'curl-freq', style.curl.frequency, 0, 40, 0.5, (s, v) => void (s.curl.frequency = v), '/m')}
        <label className="check">
          <input type="checkbox" checked={style.bangs.enabled} onChange={(e) => edit('Bangs', (s) => void (s.bangs.enabled = e.target.checked))} /> Bangs
        </label>
        {style.bangs.enabled && n('Bangs length', 'bangs-len', style.bangs.length, 0.01, 0.3, 0.005, (s, v) => void (s.bangs.length = v), 'm')}
        {style.bangs.enabled && n('Bangs width', 'bangs-width', style.bangs.width, 0, 1, 0.01, (s, v) => void (s.bangs.width = v))}
        <label className="check">
          <input type="checkbox" checked={style.ponytail.enabled} onChange={(e) => edit('Ponytail', (s) => void (s.ponytail.enabled = e.target.checked))} /> Ponytail
        </label>
        {style.ponytail.enabled && n('Tie height', 'pony-h', style.ponytail.height, 0, 1, 0.01, (s, v) => void (s.ponytail.height = v))}
        {style.ponytail.enabled && n('Tail length', 'pony-len', style.ponytail.length, 0.05, 0.8, 0.01, (s, v) => void (s.ponytail.length = v), 'm')}
      </Section>

      <Section title="Cards">
        {n('Cards', 'guides', style.guides, 0, 300, 1, (s, v) => void (s.guides = Math.round(v)))}
        {n('Layers', 'layers', style.cards.layers, 1, 6, 1, (s, v) => void (s.cards.layers = Math.round(v)))}
        {n('Most segments', 'segments', style.cards.segments, 1, 12, 1, (s, v) => void (s.cards.segments = Math.round(v)))}
        {n('Card width', 'width', style.cards.width, 0.005, 0.1, 0.001, (s, v) => void (s.cards.width = v), 'm')}
        {n('Taper', 'taper', style.cards.taper, 0, 1, 0.01, (s, v) => void (s.cards.taper = v))}
        {n('Flyaways', 'flyaway', style.cards.flyaway, 0, 1, 0.01, (s, v) => void (s.cards.flyaway = v))}
        {n('Hair per segment', 'seg-len', style.build.segmentLength, 0.02, 0.3, 0.005, (s, v) => void (s.build.segmentLength = v), 'm')}
      </Section>

      <Section title="Groom">
        <p className="hint">A few guide curves carry the style. Every card follows the guides around its root.</p>
        {n('Guides', 'g-guides', style.groom.guides, 4, 120, 1, (s, v) => void (s.groom.guides = Math.round(v)))}
        {n('Blend guides', 'g-interp', style.groom.interpolate, 1, 4, 1, (s, v) => void (s.groom.interpolate = Math.round(v)))}
        {n('Clump', 'g-clump', style.groom.clump, 0, 1, 0.01, (s, v) => void (s.groom.clump = v))}
        {n('Clump towards tip', 'g-clump-shape', style.groom.clumpShape, 0.05, 0.95, 0.01, (s, v) => void (s.groom.clumpShape = v))}
        {n('Frizz', 'g-frizz', style.groom.frizz, 0, 0.03, 0.0005, (s, v) => void (s.groom.frizz = v), 'm')}
        {n('Flyaway lift', 'g-lift', style.groom.flyawayLift, 0, 0.04, 0.001, (s, v) => void (s.groom.flyawayLift = v), 'm')}
      </Section>

      <Section title="Card build">
        <p className="hint">How cards sit on their curves: twist, roots, the parting and shading.</p>
        {n('Length used', 'b-len', style.build.lengthFactor, 0.1, 1, 0.01, (s, v) => void (s.build.lengthFactor = v))}
        {n('Lie on the head', 'b-align', style.build.alignToSurface, 0, 1, 0.01, (s, v) => void (s.build.alignToSurface = v))}
        {n('…at the root', 'b-root-align', style.build.rootAlign, 0, 1, 0.01, (s, v) => void (s.build.rootAlign = v))}
        {n('…at the tip', 'b-tip-align', style.build.tipAlign, 0, 1, 0.01, (s, v) => void (s.build.tipAlign = v))}
        {n('Random tip twist', 'b-twist', style.build.tipTwist, 0, 1, 0.01, (s, v) => void (s.build.tipTwist = v))}
        {n('Twist offset', 'b-offset', style.build.offsetTilt, -180, 180, 1, (s, v) => void (s.build.offsetTilt = v), '°')}
        {n('Root snap', 'b-snap', style.build.rootSnap, 0, 0.08, 0.001, (s, v) => void (s.build.rootSnap = v), 'm')}
        {n('Push out if inside', 'b-inside', style.build.snapIfInside, 0, 0.08, 0.001, (s, v) => void (s.build.snapIfInside = v), 'm')}
        {n('Height off the skin', 'b-surface', style.build.surfaceOffset, 0, 0.01, 0.0005, (s, v) => void (s.build.surfaceOffset = v), 'm')}
        {n('Soft shading', 'b-normal', style.build.normalFromSurface, 0, 1, 0.01, (s, v) => void (s.build.normalFromSurface = v))}
        {style.part.side !== 'none' && n('Parting snap', 'b-part-snap', style.build.partSnap, 0, 0.08, 0.001, (s, v) => void (s.build.partSnap = v), 'm')}
        {style.part.side !== 'none' && n('Parting lift', 'b-part-lift', style.build.partLiftHeight, 0, 0.03, 0.0005, (s, v) => void (s.build.partLiftHeight = v), 'm')}
        {style.part.side !== 'none' && n('Lift reach', 'b-part-reach', style.build.partLiftDistance, 0, 0.1, 0.001, (s, v) => void (s.build.partLiftDistance = v), 'm')}
      </Section>

      <Section title="Hairline and scalp">
        <div className="picker-row">
          <label htmlFor="hairline">Hairline</label>
          <select
            id="hairline"
            value={style.hairline.preset}
            onChange={(e) => {
              const preset = e.target.value as HairlinePreset;
              edit('Hairline', (s) => {
                if (preset === 'painted') s.hairline = { ...s.hairline, preset, painted: hairlineToPaint(s.hairline) };
                else if (preset === 'custom') s.hairline = { ...s.hairline, preset, painted: undefined };
                else s.hairline = { preset, ...HAIRLINE_PRESETS[preset] };
              });
            }}
          >
            <option value="full">Full</option>
            <option value="low">Low</option>
            <option value="receding">Receding</option>
            <option value="high-nape">High nape</option>
            <option value="custom">Custom</option>
            <option value="painted">Painted</option>
          </select>
        </div>
        {style.hairline.preset === 'painted' ? (
          <HairlinePainter mask={style.hairline} onChange={(painted) => edit('Paint hairline', (s) => void (s.hairline = { ...s.hairline, painted }))} />
        ) : (
          (['front', 'temples', 'sides', 'nape'] as const).map((k) =>
            n(k[0]!.toUpperCase() + k.slice(1), `hl-${k}`, style.hairline[k], 0, 150, 1, (s, v) => void (s.hairline = { ...s.hairline, preset: 'custom', [k]: v }), '°'),
          )
        )}
        <label className="check">
          <input type="checkbox" checked={style.shell.enabled} onChange={(e) => edit('Scalp shell', (s) => void (s.shell.enabled = e.target.checked))} /> Scalp
          shell (base layer for short hair)
        </label>
        <label className="check">
          <input type="checkbox" checked={style.scalpLayer.enabled} onChange={(e) => edit('Scalp layer', (s) => void (s.scalpLayer.enabled = e.target.checked))} data-testid="hair-scalp-layer" /> Short
          hair painted on the scalp (a skin layer)
        </label>
        {style.scalpLayer.enabled && n('Hairline softness', 'sl-soft', style.scalpLayer.softness, 0, 1, 0.01, (s, v) => void (s.scalpLayer.softness = v))}
        {style.scalpLayer.enabled && n('Strand contrast', 'sl-density', style.scalpLayer.density, 0, 1, 0.01, (s, v) => void (s.scalpLayer.density = v))}
        {style.scalpLayer.enabled && !colour && <p className="hint warn">The scalp layer needs a hair colour (Colour above).</p>}
      </Section>
    </>
  );
}

/** Tint, cutout and dither: shared by both routes. */
function HairLook() {
  const studio = useStudio();
  const hair = studio.engine.doc.hair;
  return (
    <Section title="Look">
      <Slider label="Alpha cutoff" value={hair.alphaThreshold} min={0.05} max={0.95} step={0.01}
        onChange={(v) => studio.engine.update('Hair cutoff', (d) => void (d.hair.alphaThreshold = v), 'hair-cutoff')}
        onDone={() => studio.engine.endInteraction()} />
      <TintRow label="Hair tint" color={hair.tint.color}
        onChange={(c) => studio.engine.update('Hair tint', (d) => void (d.hair.tint = { ...d.hair.tint, color: c }), 'hair-tint')} />
      {hair.mode === 'cards' && (
        <label className="check">
          <input type="checkbox" checked={Boolean(hair.ditherOuter)} onChange={(e) => studio.engine.update('Hair dither', (d) => void (d.hair.ditherOuter = e.target.checked))} />{' '}
          Dithered outer layer
        </label>
      )}
    </Section>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="hair-section" open>
      <summary>{title}</summary>
      {children}
    </details>
  );
}

function Slider(props: { label: string; value: number; min: number; max: number; step: number; unit?: string; onChange: (v: number) => void; onDone: () => void }) {
  const id = `hair-${props.label.replace(/\W+/g, '-').toLowerCase()}`;
  const shown = props.step >= 1 ? String(Math.round(props.value)) : props.value.toFixed(props.step < 0.01 ? 3 : 2);
  return (
    <div className="slider-row">
      <label htmlFor={id}>{props.label}</label>
      <input id={id} type="range" min={props.min} max={props.max} step={props.step} value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))} onPointerUp={props.onDone} onKeyUp={props.onDone} />
      <span className="slider-value">
        {shown}
        {props.unit}
      </span>
    </div>
  );
}

export function TintRow(props: { label: string; color: [number, number, number]; onChange: (c: [number, number, number]) => void }) {
  const hex = `#${props.color.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0')).join('')}`;
  return (
    <div className="picker-row">
      <label>{props.label}</label>
      <input
        type="color"
        value={hex}
        onChange={(e) => {
          const v = e.target.value;
          props.onChange([parseInt(v.slice(1, 3), 16) / 255, parseInt(v.slice(3, 5), 16) / 255, parseInt(v.slice(5, 7), 16) / 255]);
        }}
      />
    </div>
  );
}
