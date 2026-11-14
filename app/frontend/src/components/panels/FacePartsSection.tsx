import { DEFAULT_EYE_LOOK, IRIS_LIBRARY, LAYER_PRESETS, layerKind, newLayer, presetParams, type CatalogProxy, type EyeLook, type ParamSpec } from '@ps2cc/core';
import { BrowBrush } from './BrowBrush';
import { useStudio, useStudioVersion } from '../../state/hooks';

/** Eyes, eyebrows, eyelashes, teeth and tongue (PRD F3, Part 2 F19). */
export function FacePartsSection() {
  const studio = useStudio();
  useStudioVersion();
  const doc = studio.engine.doc;
  const of = (cat: CatalogProxy['category']) => studio.assets.catalog.proxies.filter((p) => p.category === cat);
  const pick = (field: 'eyes' | 'eyebrows' | 'eyelashes' | 'teeth' | 'tongue', asset: string | null) =>
    studio.engine.update(`Change ${field}`, (d) => {
      d[field] = { ...(d[field] ?? {}), asset };
    });

  return (
    <details open className="slider-group">
      <summary>
        <span>Eyes &amp; brows</span>
      </summary>
      <Picker label="Eyes" value={doc.eyes.asset} items={of('eyes')} onChange={(a) => pick('eyes', a)} />
      <EyeControls />
      <PaintedPart kind="brows" mesh="eyebrows" label="Eyebrows" />
      <PaintedPart kind="lashes" mesh="eyelashes" label="Eyelashes" />
      <Picker label="Teeth" value={doc.teeth?.asset ?? null} items={of('teeth')} onChange={(a) => pick('teeth', a)} allowNone />
      <Picker label="Tongue" value={doc.tongue?.asset ?? null} items={of('tongue')} onChange={(a) => pick('tongue', a)} allowNone />
      <p className="hint">Teeth and tongue together are at most 600 triangles; remove them to spend nothing on the mouth.</p>
    </details>
  );
}

/**
 * Eyebrows and eyelashes are painted on the skin (D-146): on or off, a preset,
 * and their settings by group; the brows also have a brush for their outline
 * (D-148). A character saved with MakeHuman's brow or lash mesh keeps it until
 * you switch to painted.
 */
function PaintedPart({ kind, mesh, label }: { kind: 'brows' | 'lashes'; mesh: 'eyebrows' | 'eyelashes'; label: string }) {
  const studio = useStudio();
  useStudioVersion();
  const doc = studio.engine.doc;
  const spec = layerKind(kind);
  const layer = doc.skin.layers.find((l) => l.kind === kind);
  const on = Boolean(layer?.enabled);
  const meshAsset = doc[mesh].asset;
  const presets = LAYER_PRESETS[kind] ?? [];
  const toggle = (v: boolean) =>
    studio.engine.update(`${label} ${v ? 'on' : 'off'}`, (d) => {
      const l = d.skin.layers.find((x) => x.kind === kind);
      if (l) l.enabled = v;
      else if (v) d.skin.layers.push(newLayer(kind));
    });
  const toPainted = () =>
    studio.engine.update(`Painted ${label.toLowerCase()}`, (d) => {
      d[mesh] = { ...d[mesh], asset: null };
      if (mesh === 'eyebrows') delete d.eyebrows.cards;
      const l = d.skin.layers.find((x) => x.kind === kind);
      if (l) l.enabled = true;
      else d.skin.layers.push(newLayer(kind));
    });
  const set = (key: string, value: number | string, name: string) =>
    studio.engine.update(
      `${label}: ${name}`,
      (d) => {
        const l = d.skin.layers.find((x) => x.kind === kind);
        if (l) l.params = { ...l.params, [key]: value };
      },
      `${kind}:${key}`,
    );
  const applyPreset = (id: string) => {
    const preset = presets.find((p) => p.id === id);
    if (!preset) return;
    studio.engine.update(`${label}: ${preset.label}`, (d) => {
      const l = d.skin.layers.find((x) => x.kind === kind);
      if (l) l.params = presetParams(l, preset);
    });
  };
  const setPaint = (paint: string | null) =>
    studio.engine.update(paint ? `${label}: brush` : `${label}: clear brush`, (d) => {
      const l = d.skin.layers.find((x) => x.kind === kind);
      if (!l) return;
      if (paint) l.paint = paint;
      else delete l.paint;
    });
  const control = (p: ParamSpec) =>
    !layer ? null : p.type === 'color' ? (
      <div className="picker-row" key={p.key}>
        <label>{p.label}</label>
        <input
          type="color"
          value={String(layer.params[p.key] ?? p.default)}
          onChange={(e) => set(p.key, e.target.value, p.label)}
          onBlur={() => studio.engine.endInteraction()}
          data-testid={`face-${kind}-${p.key}`}
        />
      </div>
    ) : (
      <div className="slider-row" key={p.key}>
        <label>{p.label}</label>
        <input
          type="range"
          min={p.min}
          max={p.max}
          step={p.step}
          value={Number(layer.params[p.key] ?? p.default)}
          onChange={(e) => set(p.key, Number(e.target.value), p.label)}
          onPointerUp={() => studio.engine.endInteraction()}
          data-testid={`face-${kind}-${p.key}`}
        />
      </div>
    );
  const shown = spec.params.filter((p) => p.key !== 'seed');
  const groups = [...new Set(shown.map((p) => p.group).filter((g): g is string => Boolean(g)))];
  return (
    <div className="painted-part" data-testid={`face-${kind}`}>
      <label className="check">
        <input type="checkbox" checked={on} onChange={(e) => toggle(e.target.checked)} data-testid={`face-${kind}-on`} /> {label}
      </label>
      {meshAsset && (
        <div className="button-row">
          <span className="muted">This character has the old {label.toLowerCase()} mesh.</span>
          <button onClick={toPainted} data-testid={`face-${kind}-to-painted`}>
            Use painted
          </button>
        </div>
      )}
      {on && layer && (
        <>
          {presets.length > 0 && (
            <div className="picker-row">
              <label>Preset</label>
              <select value="" onChange={(e) => applyPreset(e.target.value)} data-testid={`face-${kind}-preset`}>
                <option value="">Choose a starting point…</option>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          {shown.filter((p) => !p.group).map(control)}
          <div className="slider-row">
            <label>Opacity</label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={layer.opacity}
              onChange={(e) =>
                studio.engine.update(
                  `${label}: opacity`,
                  (d) => {
                    const l = d.skin.layers.find((x) => x.kind === kind);
                    if (l) l.opacity = Number(e.target.value);
                  },
                  `${kind}:opacity`,
                )
              }
              onPointerUp={() => studio.engine.endInteraction()}
              data-testid={`face-${kind}-opacity`}
            />
          </div>
          {kind === 'brows' && (
            <details className="painted-group" open>
              <summary>Brush</summary>
              <BrowBrush layer={layer} features={studio.assets.skinComposer.features} onChange={setPaint} />
            </details>
          )}
          {groups.map((g) => (
            <details className="painted-group" key={g} open>
              <summary>{g}</summary>
              {shown.filter((p) => p.group === g).map(control)}
            </details>
          ))}
          <div className="button-row">
            <span className="muted">Seed {String(layer.params.seed ?? 1)}</span>
            <button onClick={() => set('seed', Math.floor(Math.random() * 9998) + 1, 'new hairs')} data-testid={`face-${kind}-reseed`}>
              New hairs
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Picker(props: { label: string; value: string | null; items: CatalogProxy[]; onChange: (id: string | null) => void; allowNone?: boolean }) {
  return (
    <div className="picker-row">
      <label>{props.label}</label>
      <select value={props.value ?? ''} onChange={(e) => props.onChange(e.target.value || null)}>
        {props.allowNone && <option value="">None</option>}
        {props.items.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} ({p.triangles} tris)
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Generated eyes (Part 2 F19): an iris from the library, then its colours,
 * pupil, veins and the lids' shadow. MakeHuman's eye textures stay available.
 */
function EyeControls() {
  const studio = useStudio();
  useStudioVersion();
  const doc = studio.engine.doc;
  const look = doc.eyes.look ?? null;
  const preset = look ? (IRIS_LIBRARY.find((p) => p.look.iris === look.iris && p.look.inner === look.inner)?.id ?? 'custom') : null;
  const choose = (value: string) =>
    studio.engine.update('Eye colour', (d) => {
      const mh = value.startsWith('mh:') || value === '';
      if (mh) {
        d.eyes = { ...d.eyes, look: null, texture: value || null };
        return;
      }
      const p = IRIS_LIBRARY.find((x) => x.id === value);
      if (p) d.eyes = { ...d.eyes, look: { ...(d.eyes.look ?? DEFAULT_EYE_LOOK), ...p.look } };
    });
  const set = <K extends keyof EyeLook>(key: K, value: EyeLook[K], label: string) =>
    studio.engine.update(label, (d) => void (d.eyes = { ...d.eyes, look: { ...(d.eyes.look ?? DEFAULT_EYE_LOOK), [key]: value } }), `eye:${key}`);
  const slider = (key: 'pupil' | 'veins' | 'lidShadow' | 'fibres', label: string, min: number, max: number) => (
    <div className="slider-row">
      <label>{label}</label>
      <input
        type="range"
        min={min}
        max={max}
        step={0.01}
        value={look![key]}
        data-testid={`eye-${key}`}
        onChange={(e) => set(key, Number(e.target.value), label)}
        onPointerUp={() => studio.engine.endInteraction()}
      />
    </div>
  );
  const colour = (key: 'iris' | 'inner' | 'sclera', label: string) => (
    <div className="picker-row">
      <label>{label}</label>
      <input type="color" value={look![key]} data-testid={`eye-${key}`} onChange={(e) => set(key, e.target.value, label)} onBlur={() => studio.engine.endInteraction()} />
    </div>
  );
  return (
    <>
      <div className="picker-row">
        <label>Eye colour</label>
        <select data-testid="eye-colour" value={look ? preset! : (doc.eyes.texture ?? '')} onChange={(e) => choose(e.target.value)}>
          <optgroup label="Iris library (generated)">
            {IRIS_LIBRARY.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            {preset === 'custom' && <option value="custom">Custom</option>}
          </optgroup>
          <optgroup label="MakeHuman textures">
            <option value="">Default (brown)</option>
            {(studio.assets.catalog.eyeColours ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </optgroup>
        </select>
      </div>
      {look && (
        <>
          {colour('iris', 'Iris')}
          {colour('inner', 'Around the pupil')}
          {colour('sclera', 'White of the eye')}
          {slider('pupil', 'Pupil size', 0.15, 0.6)}
          {slider('fibres', 'Iris detail', 0, 1)}
          {slider('veins', 'Veins', 0, 1)}
          {slider('lidShadow', 'Lid shadow', 0, 1)}
          <p className="hint">
            {doc.export.lighting === 'vertex'
              ? 'Classic lighting has no specular, so a catch-light is painted into the eyes.'
              : 'Per-pixel lighting gives the eyes a real wet highlight.'}
          </p>
        </>
      )}
    </>
  );
}
