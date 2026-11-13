/**
 * Garment look (Part 2 F18), in the Inspector: material zones from the
 * library, seams and stitches, folds and decals. Islands, painted zones and
 * decals are placed on the garment in the viewport (GarmentLookTool).
 */
import {
  DECAL_DEFAULTS,
  DECAL_KINDS,
  FOLD_SITES,
  LINE_DECALS,
  newLook,
  type DecalKind,
  type FoldSite,
  type GarmentLook,
  type GarmentSlot,
  type MaterialZone,
} from '@ps2cc/core';
import { useStudio } from '../../state/hooks';
import { useUi } from '../../state/ui';
import { TintRow } from './HairPanel';

const DECAL_LABELS: Record<DecalKind, string> = { zip: 'Zip', button: 'Button', rivet: 'Rivet', buckle: 'Buckle', strap: 'Strap', pocketFlap: 'Pocket flap', pocket: 'Patch pocket' };
const SITE_LABELS: Record<FoldSite, string> = { elbows: 'Elbows', armpits: 'Armpits', waist: 'Waist', crotch: 'Crotch', knees: 'Knees' };

function Slider(props: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void; testid?: string }) {
  const studio = useStudio();
  return (
    <div className="slider-row">
      <label>{props.label}</label>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
        onPointerUp={() => studio.engine.endInteraction()}
        data-testid={props.testid}
      />
    </div>
  );
}

export function GarmentLookEditor({ garment, partKey }: { garment: GarmentSlot; partKey: string }) {
  const studio = useStudio();
  const ui = useUi();
  const materials = studio.assets.catalog.materials ?? [];
  const look = garment.look ?? null;
  const editLook = (label: string, fn: (l: GarmentLook) => void, merge?: string) =>
    studio.engine.update(
      label,
      (d) => {
        const g = d.garments.find((x) => x.asset === garment.asset);
        if (!g?.look) return;
        const l = structuredClone(g.look);
        fn(l);
        g.look = l;
      },
      merge,
    );
  if (!look) {
    return (
      <div className="look-editor">
        <h3>Materials</h3>
        <p className="muted">Dress the garment in library materials, with seams, stitches, folds and decals.</p>
        <button
          data-testid="look-start"
          onClick={() =>
            studio.engine.update('Dress with materials', (d) => {
              const g = d.garments.find((x) => x.asset === garment.asset);
              if (g) g.look = newLook(null);
            })
          }
        >
          Use materials
        </button>
      </div>
    );
  }
  const tool = ui.garmentTool && ui.garmentTool.partKey === partKey ? ui.garmentTool : null;
  const zoneRow = (z: MaterialZone, i: number) => {
    const edit = (label: string, fn: (z: MaterialZone) => void, merge?: string) => editLook(label, (l) => fn(l.zones[i]!), merge);
    const picking = tool?.mode === 'islands' && tool.zone === i;
    const painting = tool?.mode === 'paint' && tool.zone === i;
    return (
      <div key={z.id} className="zone" data-testid={`look-zone-${i}`}>
        <div className="zone-head">
          <input className="zone-name" value={z.name} onChange={(e) => edit('Rename zone', (zz) => void (zz.name = e.target.value), `zname:${partKey}:${i}`)} aria-label="Zone name" />
          <select value={z.material ?? ''} onChange={(e) => edit('Zone material', (zz) => void (zz.material = e.target.value || null))} data-testid={`look-zone-material-${i}`} aria-label="Material">
            <option value="">Garment's own texture</option>
            {materials.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          {look.zones.length > 1 && (
            <button className="asset-delete" title="Remove this zone" aria-label="Remove zone" onClick={() => editLook('Remove zone', (l) => void l.zones.splice(i, 1))}>
              ×
            </button>
          )}
        </div>
        <TintRow label="Colour" color={z.tint} onChange={(c) => edit('Zone colour', (zz) => void (zz.tint = c), `ztint:${partKey}:${i}`)} />
        <Slider label="Scale" min={0.25} max={4} step={0.05} value={z.scale} onChange={(v) => edit('Zone scale', (zz) => void (zz.scale = v), `zscale:${partKey}:${i}`)} />
        <Slider label="Rotation" min={0} max={180} step={1} value={z.rotation} onChange={(v) => edit('Zone rotation', (zz) => void (zz.rotation = v), `zrot:${partKey}:${i}`)} />
        <Slider label="Wear" min={0} max={1} step={0.01} value={z.wear} onChange={(v) => edit('Zone wear', (zz) => void (zz.wear = v), `zwear:${partKey}:${i}`)} testid={`look-zone-wear-${i}`} />
        <div className="zone-tools">
          <span className="muted">{z.islands === 'rest' ? 'Covers the rest' : `${z.islands.length} pieces`}</span>
          <button
            className={picking ? 'active' : ''}
            data-testid={`look-zone-pick-${i}`}
            title="Click pieces of the garment to add them to this zone or take them out"
            onClick={() => ui.setGarmentTool(picking ? null : { partKey, mode: 'islands', zone: i })}
          >
            {picking ? 'Done picking' : 'Pick pieces'}
          </button>
          <button
            className={painting ? 'active' : ''}
            data-testid={`look-zone-paint-${i}`}
            title="Paint where this zone goes, across pieces"
            onClick={() => ui.setGarmentTool(painting ? null : { partKey, mode: 'paint', zone: i, radiusMm: 30 })}
          >
            {painting ? 'Done painting' : 'Paint'}
          </button>
        </div>
      </div>
    );
  };
  const s = look.seams;
  const f = look.folds;
  const placing = tool?.mode === 'decal' ? tool.kind : null;
  return (
    <div className="look-editor" data-testid="look-editor">
      <h3>Materials</h3>
      {look.zones.map(zoneRow)}
      <div className="row-buttons">
        <button
          data-testid="look-add-zone"
          onClick={() =>
            editLook('Add zone', (l) => {
              const n = l.zones.length + 1;
              l.zones.push({ id: `z${Date.now().toString(36)}`, name: `Zone ${n}`, islands: [], material: materials[0]?.id ?? null, tint: [1, 1, 1], scale: 1, rotation: 0, wear: 0 });
            })
          }
        >
          Add zone
        </button>
        {look.mask && <button onClick={() => editLook('Clear painted zones', (l) => void (l.mask = null))}>Clear painted zones</button>}
      </div>
      {tool?.mode === 'paint' && (
        <Slider label="Brush (mm)" min={5} max={150} step={1} value={tool.radiusMm} onChange={(v) => ui.setGarmentTool({ ...tool, radiusMm: v })} />
      )}

      <h3>Seams and stitches</h3>
      <Slider label="Stitches" min={0} max={1} step={0.01} value={s.stitches} onChange={(v) => editLook('Stitches', (l) => void (l.seams.stitches = v), `stitch:${partKey}`)} testid="look-stitches" />
      <Slider label="Seam shadow" min={0} max={1} step={0.01} value={s.shadow} onChange={(v) => editLook('Seam shadow', (l) => void (l.seams.shadow = v), `seamsh:${partKey}`)} />
      <Slider label="Stitch spacing (mm)" min={2} max={12} step={0.5} value={s.spacingMm} onChange={(v) => editLook('Stitch spacing', (l) => void (l.seams.spacingMm = v), `stsp:${partKey}`)} />
      <label className="check">
        <input type="checkbox" checked={s.hemRows === 2} onChange={(e) => editLook('Hem stitching', (l) => void (l.seams.hemRows = e.target.checked ? 2 : 1))} /> Double stitch hems
      </label>
      <label className="check">
        <input type="checkbox" checked={s.thread !== null} onChange={(e) => editLook('Thread colour', (l) => void (l.seams.thread = e.target.checked ? [0.85, 0.75, 0.5] : null))} /> Own thread colour
      </label>
      {s.thread && <TintRow label="Thread" color={s.thread} onChange={(c) => editLook('Thread colour', (l) => void (l.seams.thread = c), `thread:${partKey}`)} />}

      <h3>Folds</h3>
      <Slider label="Strength" min={0} max={1.5} step={0.01} value={f.strength} onChange={(v) => editLook('Folds', (l) => void (l.folds.strength = v), `folds:${partKey}`)} testid="look-folds" />
      {FOLD_SITES.map((site) => (
        <Slider key={site} label={SITE_LABELS[site]} min={0} max={2} step={0.05} value={f.sites[site]} onChange={(v) => editLook('Fold site', (l) => void (l.folds.sites[site] = v), `fold:${site}:${partKey}`)} />
      ))}
      <Slider label="Variation" min={1} max={50} step={1} value={f.seed} onChange={(v) => editLook('Fold variation', (l) => void (l.folds.seed = v), `fseed:${partKey}`)} />

      <h3>Decals</h3>
      <div className="row-buttons wrap">
        {DECAL_KINDS.map((k) => (
          <button
            key={k}
            className={placing === k ? 'active' : ''}
            data-testid={`look-decal-${k}`}
            title={LINE_DECALS.has(k) ? 'Drag on the garment from one end to the other' : 'Click on the garment to place it'}
            onClick={() => ui.setGarmentTool(placing === k ? null : { partKey, mode: 'decal', kind: k })}
          >
            {DECAL_LABELS[k]}
          </button>
        ))}
      </div>
      {placing && <p className="muted">{LINE_DECALS.has(placing) ? 'Drag on the garment from one end to the other.' : 'Click on the garment to place it.'}</p>}
      {look.decals.map((d, i) => (
        <div key={d.id} className="decal" data-testid={`look-decal-row-${i}`}>
          <div className="zone-head">
            <strong>{DECAL_LABELS[d.kind]}</strong>
            <button className="asset-delete" aria-label="Remove decal" title="Remove" onClick={() => editLook('Remove decal', (l) => void l.decals.splice(i, 1))}>
              ×
            </button>
          </div>
          <Slider label="Size (mm)" min={4} max={400} step={1} value={d.sizeMm} onChange={(v) => editLook('Decal size', (l) => void (l.decals[i]!.sizeMm = v), `dsize:${partKey}:${i}`)} />
          {DECAL_DEFAULTS[d.kind].heightMm !== undefined && (
            <Slider label="Height (mm)" min={4} max={400} step={1} value={d.heightMm ?? 50} onChange={(v) => editLook('Decal height', (l) => void (l.decals[i]!.heightMm = v), `dh:${partKey}:${i}`)} />
          )}
          {!LINE_DECALS.has(d.kind) && (
            <Slider label="Rotation" min={-180} max={180} step={1} value={d.rotation} onChange={(v) => editLook('Decal rotation', (l) => void (l.decals[i]!.rotation = v), `drot:${partKey}:${i}`)} />
          )}
          <TintRow label="Colour" color={d.colour} onChange={(c) => editLook('Decal colour', (l) => void (l.decals[i]!.colour = c), `dcol:${partKey}:${i}`)} />
        </div>
      ))}
      <button
        className="danger"
        onClick={() => {
          ui.setGarmentTool(null);
          studio.engine.update('Remove materials', (d) => {
            const g = d.garments.find((x) => x.asset === garment.asset);
            if (g) g.look = null;
          });
        }}
      >
        Back to the garment's texture
      </button>
    </div>
  );
}
