import { useState } from 'react';
import type { GarmentSlot, ScenePart } from '@ps2cc/core';
import { useStudio } from '../state/hooks';
import { useUi } from '../state/ui';
import { exportUvTemplate } from '../uvTemplate';
import { TintRow } from './panels/HairPanel';
import { PainterLink } from './PainterLink';
import { GarmentLookEditor } from './panels/GarmentLookEditor';

/** PRD F4: export the part's UV wireframe over its current texture as a 1024 px PNG. */
export function UvTemplateButton({ part }: { part: ScenePart }) {
  const studio = useStudio();
  const ui = useUi();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const path = await exportUvTemplate(studio, part);
      if (path && path !== 'download') ui.info(`UV template saved to ${path}`);
    } catch (err) {
      ui.error('Could not export the UV template', err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button disabled={busy} onClick={() => void run()} title="1024 px PNG: the UV wireframe over the current texture, to paint over">
      {busy ? 'Exporting…' : 'Export UV template'}
    </button>
  );
}

/** A worn garment's settings (Clothes): tint, grime, materials, paint and its studios. */
export function GarmentInspector({ partKey }: { partKey: string }) {
  const studio = useStudio();
  const select = useUi((s) => s.select);
  const garment = studio.engine.doc.garments.find((g) => `garment:${g.slot}:${g.asset}` === partKey);
  if (!garment) return null;
  // Made in Garment Designer (a library garment, or one kept on this character): it opens there again.
  const info = studio.assets.hasProxy(garment.asset) ? studio.assets.proxyInfo(garment.asset) : null;
  const generated = (info?.tags ?? []).includes('generated') || /^(shell|pattern):/.test(studio.engine.doc.garmentEdits?.[garment.asset]?.base ?? '');
  const pattern = (info?.tags ?? []).includes('pattern') || (studio.engine.doc.garmentEdits?.[garment.asset]?.base ?? '').startsWith('pattern:');
  const edit = (label: string, fn: (g: GarmentSlot) => void, merge?: string) =>
    studio.engine.update(
      label,
      (d) => {
        const g = d.garments.find((x) => x.asset === garment.asset);
        if (g) fn(g);
      },
      merge,
    );
  return (
    <div className="garment-inspector">
      <TintRow label="Tint" color={garment.tint.color} onChange={(c) => edit('Garment tint', (g) => void (g.tint = { ...g.tint, color: c }), `tint:${partKey}`)} />
      <div className="slider-row">
        <label>Brightness</label>
        <input
          type="range"
          min={0.3}
          max={1.6}
          step={0.01}
          value={garment.tint.brightness}
          onChange={(e) => edit('Garment brightness', (g) => void (g.tint = { ...g.tint, brightness: Number(e.target.value) }), `bright:${partKey}`)}
          onPointerUp={() => studio.engine.endInteraction()}
        />
      </div>
      <div className="slider-row">
        <label>Dirt / grime</label>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={garment.dirt}
          onChange={(e) => edit('Garment dirt', (g) => void (g.dirt = Number(e.target.value)), `dirt:${partKey}`)}
          onPointerUp={() => studio.engine.endInteraction()}
        />
      </div>
      <label className="check">
        <input type="checkbox" checked={garment.hideBody} onChange={(e) => edit('Hide body', (g) => void (g.hideBody = e.target.checked))} /> Hide body
        under garment
      </label>
      {garment.texture && (
        <button onClick={() => edit('Reset garment texture', (g) => void (g.texture = null))}>Use original texture</button>
      )}
      <button onClick={() => useUi.getState().setGarmentStudio(partKey)} data-testid="open-garment-studio" title="Reshape the garment, crop it, add a collar, cuffs or pockets, and save it as a new garment">
        Edit in Garment Studio
      </button>
      <button onClick={() => useUi.getState().openStudio({ kind: 'texture', target: partKey })} data-testid="open-texture-studio-garment" title="Its materials, seams, decals and paint, saved as a new garment">
        Edit in Texture Studio
      </button>
      {generated && (
        <button onClick={() => useUi.getState().openStudio({ kind: 'designer', target: partKey })} data-testid="open-garment-designer" title="Its template and parameters: change them and save it again">
          Edit in Garment Designer
        </button>
      )}
      {pattern && <RedrapeButton asset={garment.asset} />}
      <GarmentLookEditor garment={garment} partKey={partKey} />
      <PainterLink target={`garment:${garment.slot}`} label="The garment" />
      {garment.paint && (
        <button onClick={() => edit('Remove garment paint', (g) => void (g.paint = null))} data-testid="garment-paint-remove">
          Remove paint
        </button>
      )}
      <button
        className="danger"
        onClick={() => {
          studio.engine.update('Remove garment', (d) => void (d.garments = d.garments.filter((g) => g.asset !== garment.asset)));
          select(null);
        }}
      >
        Remove garment
      </button>
    </div>
  );
}

/** Re-drape on this body (PRD Part 3, F31 step 8): a pattern garment draped again with this character's measurements. */
function RedrapeButton({ asset }: { asset: string }) {
  const studio = useStudio();
  const [busy, setBusy] = useState<number | null>(null);
  const run = async () => {
    setBusy(0);
    try {
      const id = await studio.redrapeGarment(asset, { onProgress: (f) => setBusy(f) });
      if (id) useUi.getState().info('Draped again on this body and kept on this character');
    } catch (err) {
      useUi.getState().error('The drape failed', err);
    } finally {
      setBusy(null);
    }
  };
  return busy !== null ? (
    <progress max={1} value={busy} data-testid="redrape-progress" />
  ) : (
    <button onClick={() => void run()} data-testid="redrape" title="Drape the pattern again with this character's own measurements (a few seconds); the garment is kept on this character">
      Re-drape on this body
    </button>
  );
}
