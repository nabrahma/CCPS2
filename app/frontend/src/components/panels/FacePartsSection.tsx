import type { CatalogProxy } from '@ps2cc/core';
import { useStudio, useStudioVersion } from '../../state/hooks';

/** Eyes, eyebrows, eyelashes, teeth (PRD F3). */
export function FacePartsSection() {
  const studio = useStudio();
  useStudioVersion();
  const doc = studio.engine.doc;
  const of = (cat: CatalogProxy['category']) => studio.assets.catalog.proxies.filter((p) => p.category === cat);
  const pick = (field: 'eyes' | 'eyebrows' | 'eyelashes' | 'teeth', asset: string | null) =>
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
      <div className="picker-row">
        <label>Eye colour</label>
        <select
          value={doc.eyes.texture ?? ''}
          onChange={(e) => studio.engine.update('Eye colour', (d) => void (d.eyes = { ...d.eyes, texture: e.target.value || null }))}
        >
          <option value="">Default (brown)</option>
          {(studio.assets.catalog.eyeColours ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <Picker label="Eyebrows" value={doc.eyebrows.asset} items={of('eyebrows')} onChange={(a) => pick('eyebrows', a)} allowNone />
      <Picker label="Eyelashes" value={doc.eyelashes.asset} items={of('eyelashes')} onChange={(a) => pick('eyelashes', a)} allowNone />
      <Picker label="Teeth" value={doc.teeth?.asset ?? null} items={of('teeth')} onChange={(a) => pick('teeth', a)} allowNone />
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
      <p className="hint">Teeth are hidden by default so no budget is spent on the mouth interior (PRD F3).</p>
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
