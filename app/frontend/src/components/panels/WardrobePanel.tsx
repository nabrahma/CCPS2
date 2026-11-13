import { useState } from 'react';
import { NEUTRAL_TINT, sanitiseFur, sanitiseLook, type GarmentSlotName } from '@ps2cc/core';
import { backend } from '../../backend';
import { useStudio, useStudioVersion } from '../../state/hooks';
import { useUi } from '../../state/ui';

const SLOTS: { id: GarmentSlotName | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'top', label: 'Tops' },
  { id: 'bottom', label: 'Bottoms' },
  { id: 'full', label: 'Suits & dresses' },
  { id: 'outer', label: 'Outer' },
  { id: 'shoes', label: 'Shoes' },
  { id: 'hat', label: 'Hats' },
  { id: 'gloves', label: 'Gloves' },
  { id: 'accessory', label: 'Accessories' },
];

/** Wardrobe (PRD F4): CC0 garments by slot; several can be worn. */
export function WardrobePanel() {
  const studio = useStudio();
  useStudioVersion();
  const ui = useUi();
  const select = ui.select;
  const [slot, setSlot] = useState<GarmentSlotName | 'all'>('all');
  const [filter, setFilter] = useState('');
  const worn = studio.engine.doc.garments;
  const garments = studio.assets.catalog.proxies.filter(
    (p) => p.category === 'clothes' && (slot === 'all' || p.slot === slot) && p.name.toLowerCase().includes(filter.toLowerCase()),
  );
  const importGarment = async () => {
    try {
      const path = await backend.pickGarmentFile();
      if (path) ui.openGarmentImport({ path });
    } catch (err) {
      ui.error('Could not import the garment', err);
    }
  };
  const exportBody = async () => {
    try {
      const path = await studio.exportBaseBody();
      if (path) ui.info('Base body exported. Model around it, then import the garment.');
    } catch (err) {
      ui.error('Could not export the base body', err);
    }
  };
  const remove = (id: string, name: string) => {
    studio.deleteGarment(id).then(
      () => ui.info(`Deleted ${name}`),
      (err: unknown) => ui.error('Could not delete the garment', err),
    );
  };
  const toggle = (id: string, garmentSlot: GarmentSlotName) =>
    studio.engine.update('Change garments', (d) => {
      const i = d.garments.findIndex((g) => g.asset === id);
      if (i >= 0) d.garments.splice(i, 1);
      else {
        // Garments made in Garment Studio come dressed (Part 2 F18).
        const def = studio.assets.proxyInfo(id).defaults;
        d.garments.push({
          slot: garmentSlot,
          asset: id,
          tint: { ...NEUTRAL_TINT, color: def?.tint ? [...def.tint] : [1, 1, 1] },
          dirt: 0,
          hideBody: true,
          ...(def?.look ? { look: sanitiseLook(def.look) } : {}),
          ...(def?.fur ? { fur: sanitiseFur(def.fur) } : {}),
        });
      }
    });
  return (
    <div className="slider-panel">
      <div className="panel-tools">
        <input className="search" type="search" placeholder="Filter garments…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div className="garment-tools">
          <button data-testid="garment-import" title="Import an OBJ, FBX or GLB modelled around the base body" onClick={() => void importGarment()}>
            Import garment…
          </button>
          <button data-testid="garment-export-body" title="The body to model your own garments around" onClick={() => void exportBody()}>
            Base body (OBJ)…
          </button>
        </div>
        <div className="toggle-row wrap">
          {SLOTS.map((s) => (
            <button key={s.id} className={slot === s.id ? 'chip active' : 'chip'} onClick={() => setSlot(s.id)}>
              {s.label}
            </button>
          ))}
        </div>
      </div>
      {worn.length > 0 && (
        <div className="worn">
          <h3>Wearing</h3>
          {worn.map((g) => (
            <button key={g.asset} className="worn-item" onClick={() => select(`garment:${g.slot}:${g.asset}`)}>
              {studio.assets.hasProxy(g.asset) ? studio.assets.proxyInfo(g.asset).name : 'Missing garment'} <span className="muted">({g.slot})</span>
            </button>
          ))}
        </div>
      )}
      <ul className="asset-list">
        {garments.map((p) => {
          const on = worn.some((g) => g.asset === p.id);
          return (
            <li key={p.id} className="asset-row">
              <button className={on ? 'asset active' : 'asset'} onClick={() => toggle(p.id, (p.slot ?? 'accessory') as GarmentSlotName)}>
                <span className="asset-name">{p.name.replace(/_/g, ' ')}</span>
                {p.hiddenFaces === 'computed' && <span className="muted" title="Hidden body faces computed by PS2CC (no MakeHuman data)">auto-hide</span>}
                <span className={p.overBudget ? 'tri warn' : 'tri'} title={p.overBudget ? 'Still above the 2,500-triangle PS2 garment target after decimation' : `decimated from ${p.originalTriangles ?? p.triangles}`}>
                  {p.triangles.toLocaleString()} tris
                </span>
              </button>
              {p.tags.includes('user') && (
                <button className="asset-delete" title={`Delete ${p.name} from the library`} aria-label={`Delete ${p.name}`} data-testid="garment-delete" onClick={() => remove(p.id, p.name)}>
                  ×
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
