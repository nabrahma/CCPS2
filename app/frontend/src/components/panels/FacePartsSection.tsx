import { DEFAULT_EYE_LOOK, IRIS_LIBRARY, type CatalogProxy, type EyeLook } from '@ps2cc/core';
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
  const opacity = (field: 'eyebrows' | 'eyelashes', v: number) =>
    studio.engine.update(`${field} density`, (d) => void (d[field] = { ...d[field], opacity: v }), `density:${field}`);

  return (
    <details open className="slider-group">
      <summary>
        <span>Eyes &amp; brows</span>
      </summary>
      <Picker label="Eyes" value={doc.eyes.asset} items={of('eyes')} onChange={(a) => pick('eyes', a)} />
      <EyeControls />
      <Picker label="Eyebrows" value={doc.eyebrows.asset} items={of('eyebrows')} onChange={(a) => pick('eyebrows', a)} allowNone />
      <Picker label="Eyelashes" value={doc.eyelashes.asset} items={of('eyelashes')} onChange={(a) => pick('eyelashes', a)} allowNone />
      <Picker label="Teeth" value={doc.teeth?.asset ?? null} items={of('teeth')} onChange={(a) => pick('teeth', a)} allowNone />
      <Picker label="Tongue" value={doc.tongue?.asset ?? null} items={of('tongue')} onChange={(a) => pick('tongue', a)} allowNone />
      <div className="slider-row">
        <label>Brow density</label>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={doc.eyebrows.opacity ?? 1}
          onChange={(e) => opacity('eyebrows', Number(e.target.value))}
          onPointerUp={() => studio.engine.endInteraction()}
        />
      </div>
      <p className="hint">Teeth and tongue together are at most 600 triangles; remove them to spend nothing on the mouth.</p>
    </details>
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
