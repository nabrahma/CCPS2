import { useState } from 'react';
import type { GarmentSlot, ScenePart } from '@ps2cc/core';
import { useStudio, useStudioVersion } from '../state/hooks';
import { useUi } from '../state/ui';
import { exportUvTemplate } from '../uvTemplate';
import { TintRow } from './panels/HairPanel';
import { PainterLink } from './PainterLink';
import { GarmentLookEditor } from './panels/GarmentLookEditor';

/** Right-hand context inspector (PRD 7): details of the part clicked in the viewport. */
export function Inspector() {
  const studio = useStudio();
  useStudioVersion();
  const ui = useUi();
  const part = studio.scene.parts.find((p) => p.key === ui.selected) ?? null;
  const doc = studio.engine.doc;
  return (
    <div className="inspector">
      <p className="card-label">Inspector</p>
      {!part && <h2 className="inspector-title">Click any part of the character</h2>}
      {part && (
        <div className="inspector-body">
          <h2 className="inspector-title">{part.label}</h2>
          <dl className="facts">
            <dt>Asset</dt>
            <dd title={part.assetId}>{part.assetId}</dd>
            <dt>Triangles</dt>
            <dd>{part.triangleCount.toLocaleString()}</dd>
            <dt>Draw order</dt>
            <dd>{part.zDepth}</dd>
          </dl>
          {part.kind === 'body' && (
            <>
              <p>
                Skin: <strong>{doc.skin.base.replace('mh:skins/', '')}</strong>
              </p>
              <button onClick={() => ui.setTab('skin')}>Change skin…</button>
              <button onClick={() => ui.setTab('export')}>Body mesh tier…</button>
            </>
          )}
          {part.kind === 'garment' && <GarmentInspector partKey={part.key} />}
          {part.kind === 'hair' && <button onClick={() => ui.setTab('hair')}>Edit hair…</button>}
          {(part.kind === 'garment' || part.kind === 'hair') && <UvTemplateButton part={part} />}
          {(part.kind === 'eyes' || part.kind === 'eyebrows' || part.kind === 'eyelashes') && (
            <button onClick={() => ui.setTab('face')}>Edit in Face tab…</button>
          )}
        </div>
      )}
      <section className="drop-hint">
        <h3>Drop files</h3>
        <p className="muted">
          Drop a PNG or JPG on a garment to texture it, or anywhere else to choose where it goes. Drop an OBJ, FBX or GLB to import a garment.
        </p>
      </section>
    </div>
  );
}

/** PRD F4: export the part's UV wireframe over its current texture as a 1024 px PNG. */
function UvTemplateButton({ part }: { part: ScenePart }) {
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

function GarmentInspector({ partKey }: { partKey: string }) {
  const studio = useStudio();
  const select = useUi((s) => s.select);
  const garment = studio.engine.doc.garments.find((g) => `garment:${g.slot}:${g.asset}` === partKey);
  if (!garment) return null;
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
