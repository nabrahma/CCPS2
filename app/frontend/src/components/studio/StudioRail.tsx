/**
 * The Asset Studio's right column (Part 2 F20): the deep editor of the open
 * studio. Hair Studio has every hairstyle setting (the groom brushes are over
 * the viewport), Texture Studio the skin's layers and photos or a garment's
 * look and paint, Garment Studio the garment being reshaped (its tools are
 * over the viewport), Material Studio the material being made. Saving in a
 * studio adds an asset to the library, which the creator's steps pick from.
 */
import { useState } from 'react';
import { useStudio, useStudioVersion } from '../../state/hooks';
import { useUi } from '../../state/ui';
import { GarmentLookEditor } from '../panels/GarmentLookEditor';
import { HairPanel, TintRow } from '../panels/HairPanel';
import { SkinPanel } from '../panels/SkinPanel';
import { PainterLink } from '../PainterLink';
import { STUDIOS } from '../workspace/steps';
import { MaterialStudio } from './MaterialStudio';

export function StudioRail() {
  const ui = useUi();
  const s = ui.assetStudio!;
  const info = STUDIOS.find((x) => x.id === s.kind)!;
  return (
    <div className="rail-section studio-rail" data-testid={`studio-rail-${s.kind}`}>
      <p className="card-label">Asset Studio</p>
      <h2 className="inspector-title">{info.label}</h2>
      <p className="hint">{info.hint}</p>
      <div className="panel" role="tabpanel" aria-label={info.label}>
        {s.kind === 'hair' && <HairStudioPanel />}
        {s.kind === 'texture' && <TextureStudioPanel />}
        {s.kind === 'garment' && <GarmentStudioPanel />}
        {s.kind === 'material' && <MaterialStudio key={`${s.target}|${s.zone?.partKey ?? ''}`} />}
      </div>
    </div>
  );
}

function HairStudioPanel() {
  const studio = useStudio();
  useStudioVersion();
  const cards = studio.engine.doc.hair.mode === 'cards';
  return (
    <>
      <p className="hint">
        {cards
          ? 'Comb, puff and smooth the guides with the brushes over the viewport, then save the style: it joins the hairstyles in Hair.'
          : 'Groom brushes work on card hair: choose Card hair to comb a style.'}
      </p>
      <HairPanel />
    </>
  );
}

/** What Texture Studio paints: the skin, or one of the garments worn. */
function TextureTarget() {
  const studio = useStudio();
  const ui = useUi();
  const s = ui.assetStudio!;
  return (
    <div className="picker-row">
      <label htmlFor="texture-target">Paint</label>
      <select id="texture-target" value={s.target ?? 'skin'} onChange={(e) => ui.openStudio({ kind: 'texture', target: e.target.value })} data-testid="texture-target">
        <option value="skin">The skin</option>
        {studio.engine.doc.garments.map((g) => (
          <option key={g.asset} value={`garment:${g.slot}:${g.asset}`}>
            {studio.assets.hasProxy(g.asset) ? studio.assets.proxyInfo(g.asset).name.replace(/_/g, ' ') : g.asset}
          </option>
        ))}
      </select>
    </div>
  );
}

function TextureStudioPanel() {
  const studio = useStudio();
  useStudioVersion();
  const ui = useUi();
  const target = ui.assetStudio!.target ?? 'skin';
  const garment = target === 'skin' ? null : studio.engine.doc.garments.find((g) => `garment:${g.slot}:${g.asset}` === target);
  const [name, setName] = useState(() => (garment ? `${studio.assets.hasProxy(garment.asset) ? studio.assets.proxyInfo(garment.asset).name : 'Garment'} (painted)` : `${studio.engine.doc.name} skin`));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const label = name.trim();
    if (!label) return;
    setBusy(true);
    try {
      if (garment) {
        await studio.saveTexturedGarment(target, label);
        ui.info(`Saved ${label} to the Wardrobe and put it on`);
      } else {
        const url = await studio.saveSkinTexture(label);
        studio.engine.update('Use saved skin', (d) => void (d.skin = { ...d.skin, base: url, layers: d.skin.layers.filter((l) => l.kind === 'scalpHair' || l.kind === 'occlusion' || l.kind === 'cavity' || l.kind === 'lightBake') }));
        ui.info(`Saved ${label} to your skins and switched to it`);
      }
      ui.closeStudio();
    } catch (err) {
      ui.error('Could not save', err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <TextureTarget />
      {garment ? <GarmentTexture partKey={target} /> : <SkinPanel />}
      <details className="hair-section" open>
        <summary>Save</summary>
        <p className="hint">
          {garment
            ? 'Saves the garment as it looks now (materials, seams, decals, paint, tint and grime in one texture) as a new garment in the Wardrobe, and wears it.'
            : 'Saves the skin as it looks now (the base and every layer) as a new skin in Skin, and switches to it.'}
        </p>
        <div className="picker-row">
          <label htmlFor="texture-save-name">Name</label>
          <input id="texture-save-name" value={name} maxLength={64} onChange={(e) => setName(e.target.value)} data-testid="texture-save-name" />
        </div>
        <button onClick={() => void save()} disabled={busy || !name.trim()} data-testid="texture-save">
          {busy ? 'Saving…' : garment ? 'Save as new garment' : 'Save as new skin'}
        </button>
      </details>
    </>
  );
}

function GarmentTexture({ partKey }: { partKey: string }) {
  const studio = useStudio();
  const garment = studio.engine.doc.garments.find((g) => `garment:${g.slot}:${g.asset}` === partKey);
  if (!garment) return null;
  return (
    <div className="garment-inspector">
      <TintRow label="Tint" color={garment.tint.color} onChange={(c) => studio.engine.update('Garment tint', (d) => void (d.garments.find((g) => g.asset === garment.asset)!.tint.color = c), `tint:${partKey}`)} />
      <div className="slider-row">
        <label>Dirt / grime</label>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={garment.dirt}
          onChange={(e) => studio.engine.update('Garment dirt', (d) => void (d.garments.find((g) => g.asset === garment.asset)!.dirt = Number(e.target.value)), `dirt:${partKey}`)}
          onPointerUp={() => studio.engine.endInteraction()}
        />
      </div>
      <GarmentLookEditor garment={garment} partKey={partKey} />
      <PainterLink target={`garment:${garment.slot}`} label="The garment" />
    </div>
  );
}

function GarmentStudioPanel() {
  const studio = useStudio();
  useStudioVersion();
  const ui = useUi();
  const target = ui.assetStudio!.target;
  return (
    <>
      <div className="picker-row">
        <label htmlFor="garment-studio-target">Garment</label>
        <select id="garment-studio-target" value={target ?? ''} onChange={(e) => ui.openStudio({ kind: 'garment', target: e.target.value })} data-testid="garment-studio-target">
          {studio.engine.doc.garments.map((g) => (
            <option key={g.asset} value={`garment:${g.slot}:${g.asset}`}>
              {studio.assets.hasProxy(g.asset) ? studio.assets.proxyInfo(g.asset).name.replace(/_/g, ' ') : g.asset}
            </option>
          ))}
        </select>
      </div>
      <p className="hint">
        The tools are over the viewport: brushes to reshape, Crop and Roll up to shorten, Collar / cuff and Pocket to add parts. Save as new garment adds it to the Wardrobe (03), fitted to every body, and wears it.
      </p>
    </>
  );
}
