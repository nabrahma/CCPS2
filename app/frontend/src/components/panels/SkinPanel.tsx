import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { BLEND_MODES, LAYER_KINDS, layerKind, layerParam, newLayer, PAINTED_LAYER_PREFIX, type BlendMode, type LayerKind, type RegionMask, type SkinLayer } from '@ps2cc/core';
import { backend, libraryUrl, type LibraryItem } from '../../backend';
import { applySidePhoto, cancelPhoto, exportRegionGuide, exportSkinTextures, exportSkinUvTemplate, fitFaceShape, placePhoto } from '../../skin';
import { useStudio, useStudioVersion } from '../../state/hooks';
import { useUi } from '../../state/ui';
import { PainterLink } from '../PainterLink';

const MASK_LABEL: Record<RegionMask, string> = { none: 'Everywhere', face: 'Face only', body: 'Body only', hands: 'Hands only' };
const BLEND_LABEL: Record<BlendMode, string> = { normal: 'Normal', multiply: 'Multiply', overlay: 'Overlay', screen: 'Screen' };

/**
 * Skin (PRD F6, F7): base skin, face photo projection, and the overlay layer
 * stack (top wins) with opacity, blend mode and region mask per layer.
 */
export function SkinPanel() {
  return (
    <div className="slider-panel skin-panel">
      <Section title="Base skin">
        <BaseSkins />
      </Section>
      <Section title="Face photo">
        <PhotoSection />
      </Section>
      <Section title="Layers">
        <LayerStack />
      </Section>
      <Section title="Texture Studio">
        <p className="hint">
          Paint the skin in Material Painter: brushes, projection, stencils, smart masks. Your paint comes back as the top layer, in the
          skin's own UV space, so it stays put whatever the body's shape.
        </p>
        <PainterLink target="skin" label="The skin" />
      </Section>
      <Section title="Paint your own">
        <PaintTools />
      </Section>
    </div>
  );
}

function BaseSkins() {
  const studio = useStudio();
  useStudioVersion();
  const ui = useUi();
  const [filter, setFilter] = useState('');
  const [userSkins, setUserSkins] = useState<LibraryItem[]>([]);
  useEffect(() => {
    void backend.listLibrary('skins').then(setUserSkins).catch(() => setUserSkins([]));
  }, []);
  const skins = useMemo(
    () => studio.assets.catalog.skins.filter((s) => s.name.toLowerCase().includes(filter.toLowerCase()) || s.id.includes(filter.toLowerCase())),
    [studio, filter],
  );
  const current = studio.engine.doc.skin.base;
  const setBase = (base: string) => studio.engine.update('Change skin', (d) => void (d.skin = { ...d.skin, base }));
  const importSkin = async () => {
    try {
      const items = await backend.pickAndImport('skins');
      if (items.length) {
        setUserSkins(await backend.listLibrary('skins'));
        setBase(libraryUrl(studio.info, items[0]!.file));
      }
    } catch (err) {
      ui.error('Could not import the skin', err);
    }
  };
  return (
    <>
      <div className="panel-tools">
        <input className="search" type="search" placeholder="Filter skins…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button onClick={() => void importSkin()} title="A full-body skin painted on the MakeHuman (hm08) UV layout">
          Import skin…
        </button>
      </div>
      <div className="thumb-grid">
        {userSkins.map((s) => {
          const url = libraryUrl(studio.info, s.file);
          return (
            <button key={s.id} className={url === current ? 'thumb active' : 'thumb'} onClick={() => setBase(url)} title={`${s.name} (your library)`}>
              <img loading="lazy" src={libraryUrl(studio.info, s.thumb || s.file)} alt="" />
              <span>{s.name}</span>
            </button>
          );
        })}
        {skins.map((s) => (
          <button key={s.id} className={s.id === current ? 'thumb active' : 'thumb'} onClick={() => setBase(s.id)} title={`${skinLabel(s.id)} (${s.licence})`}>
            <img loading="lazy" src={`${studio.info.coreAssetsUrl}/${s.texture}`} alt="" />
            <span>{skinLabel(s.id)}</span>
          </button>
        ))}
      </div>
    </>
  );
}

/** Display name of a catalog skin: its id (the MakeHuman material names are often generic). */
function skinLabel(id: string): string {
  return (id.split('/').pop() ?? id).replace(/_/g, ' ');
}

function PhotoSection() {
  const studio = useStudio();
  useStudioVersion();
  const ui = useUi();
  const status = useUi((s) => s.photo);
  const [fitting, setFitting] = useState(false);
  const photo = studio.engine.doc.skin.photo;
  const choose = async () => {
    try {
      const items = await backend.pickAndImport('photos');
      if (items[0]) await placePhoto(studio, libraryUrl(studio.info, items[0].file));
    } catch (err) {
      ui.error('Could not import the photo', err);
    }
  };
  const edit = (label: string, fn: (p: NonNullable<typeof photo>) => void, merge?: string) =>
    studio.engine.update(label, (d) => d.skin.photo && fn(d.skin.photo), merge);
  return (
    <div className="photo-section" data-testid="photo-section">
      <p className="hint">
        Drop a front-facing photo (neutral expression, even light, eyes open) on the window, or choose one. The face is found
        automatically and warped onto the head.
      </p>
      <div className="button-row">
        <button onClick={() => void choose()} disabled={Boolean(status?.busy)}>
          Choose photo…
        </button>
        {photo && !status?.busy && (
          <button className="danger" onClick={() => studio.engine.update('Remove face photo', (d) => void (d.skin.photo = null))}>
            Remove photo
          </button>
        )}
      </div>
      {status?.busy && (
        <div className="progress-row" role="status">
          <span className="spinner" aria-hidden /> {status.busy}
          <button onClick={() => cancelPhoto(studio)}>Cancel</button>
        </div>
      )}
      {status?.check && status.image === photo?.image && (
        <div className="photo-check" data-testid="photo-check">
          <span className="muted">
            Head turn {Math.abs(status.check.yaw).toFixed(0)}°, tilt {Math.abs(status.check.pitch).toFixed(0)}°
          </span>
          {status.check.warnings.map((w) => (
            <p key={w} className="warning-text">
              ⚠ {w}
            </p>
          ))}
        </div>
      )}
      {photo && (
        <>
          <div className="photo-preview">
            <img src={photo.image} alt="Face photo" />
          </div>
          <button
            disabled={fitting || Boolean(status?.busy)}
            title="Adjust eye spacing, nose, jaw and similar sliders towards the photo. Undo puts them back."
            data-testid="fit-face"
            onClick={() => {
              setFitting(true);
              // A frame for the button to show its state; the fit itself takes about a second.
              requestAnimationFrame(() => {
                fitFaceShape(studio)
                  .then(({ before, after }) => ui.info(`Face fitted: landmark error ${(before * 100).toFixed(1)}% → ${(after * 100).toFixed(1)}%`))
                  .catch((err: unknown) => ui.error('Could not fit the face', err))
                  .finally(() => setFitting(false));
              });
            }}
          >
            {fitting ? 'Fitting…' : 'Fit face shape to photo'}
          </button>
          <Slider
            label="Strength"
            value={photo.strength}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => edit('Photo strength', (p) => void (p.strength = v), 'photo:strength')}
            onDone={() => studio.engine.endInteraction()}
          />
          <label className="check-row">
            <input type="checkbox" checked={photo.colourMatch} onChange={(e) => edit('Photo colour match', (p) => void (p.colourMatch = e.target.checked))} />
            Match colour to the skin
          </label>
          <SidePhotos />
        </>
      )}
    </div>
  );
}

/** Left and right photos for the three-photo projection (Part 2 F19). */
function SidePhotos() {
  const studio = useStudio();
  useStudioVersion();
  const ui = useUi();
  const [busy, setBusy] = useState<'left' | 'right' | null>(null);
  const sides = studio.engine.doc.skin.photo?.sides;
  const choose = async (side: 'left' | 'right') => {
    try {
      const items = await backend.pickAndImport('photos');
      if (!items[0]) return;
      setBusy(side);
      await applySidePhoto(studio, side, libraryUrl(studio.info, items[0].file));
    } catch (err) {
      ui.error('Could not use the side photo', err);
    } finally {
      setBusy(null);
    }
  };
  const remove = (side: 'left' | 'right') =>
    studio.engine.update(`Remove ${side} side photo`, (d) => {
      if (d.skin.photo?.sides) d.skin.photo.sides = { ...d.skin.photo.sides, [side]: null };
    });
  return (
    <div className="side-photos" data-testid="side-photos">
      <p className="hint">Optional: a left and a right photo (three-quarter views, about 45°) cover the sides of the head. The front photo stays in charge of the eyes and mouth.</p>
      {(['left', 'right'] as const).map((side) => (
        <div className="button-row" key={side}>
          <button disabled={busy !== null} onClick={() => void choose(side)} data-testid={`side-photo-${side}`}>
            {busy === side ? 'Finding the face…' : sides?.[side] ? `Replace ${side} photo…` : `Add ${side} photo…`}
          </button>
          {sides?.[side] && (
            <>
              <img className="side-thumb" src={sides[side]!.image} alt={`${side} photo`} />
              <button className="danger" onClick={() => remove(side)}>
                Remove
              </button>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function LayerStack() {
  const studio = useStudio();
  useStudioVersion();
  const ui = useUi();
  const layers = studio.engine.doc.skin.layers;
  const [kind, setKind] = useState<LayerKind>('darkCircles');
  const add = (layer: SkinLayer) => studio.engine.update(`Add ${layerKind(layer.kind).label}`, (d) => void d.skin.layers.push(layer));
  const addOverlay = async () => {
    try {
      const items = await backend.pickAndImport('overlays');
      for (const it of items) add(newLayer('image', { image: libraryUrl(studio.info, it.file) }));
    } catch (err) {
      ui.error('Could not import the overlay', err);
    }
  };
  return (
    <>
      <div className="picker-row">
        <label htmlFor="skin-add-kind">Add</label>
        <select id="skin-add-kind" value={kind} onChange={(e) => setKind(e.target.value as LayerKind)}>
          {LAYER_KINDS.filter((k) => k.kind !== 'image').map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.label}
            </option>
          ))}
        </select>
        <button onClick={() => add(newLayer(kind))} data-testid="skin-add-layer">
          Add layer
        </button>
      </div>
      <div className="button-row">
        <button onClick={() => void addOverlay()} title="A PNG with alpha painted on the skin UV template">
          Add image overlay…
        </button>
      </div>
      {layers.length === 0 && <p className="muted">No layers yet. The top layer wins.</p>}
      <ol className="layer-list" data-testid="skin-layers">
        {[...layers].reverse().map((l) => (
          <LayerCard key={l.id} layer={l} index={layers.indexOf(l)} count={layers.length} />
        ))}
      </ol>
    </>
  );
}

function LayerCard({ layer, index, count }: { layer: SkinLayer; index: number; count: number }) {
  const studio = useStudio();
  const spec = layerKind(layer.kind);
  const [open, setOpen] = useState(true);
  const edit = (label: string, fn: (l: SkinLayer) => void, merge?: string) =>
    studio.engine.update(
      label,
      (d) => {
        const l = d.skin.layers.find((x) => x.id === layer.id);
        if (l) fn(l);
      },
      merge,
    );
  const move = (delta: number) =>
    studio.engine.update('Reorder layers', (d) => {
      const i = d.skin.layers.findIndex((x) => x.id === layer.id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= d.skin.layers.length) return;
      const [l] = d.skin.layers.splice(i, 1);
      d.skin.layers.splice(j, 0, l!);
    });
  const done = () => studio.engine.endInteraction();
  const name =
    layer.kind === 'image'
      ? layer.id.startsWith(PAINTED_LAYER_PREFIX)
        ? 'Painted in Material Painter'
        : `Overlay: ${decodeURIComponent(layer.image?.split('/').pop() ?? '')}`
      : spec.label;
  return (
    <li className={layer.enabled ? 'layer-card' : 'layer-card disabled'} data-kind={layer.kind}>
      <div className="layer-head">
        <input type="checkbox" aria-label={`Show ${name}`} checked={layer.enabled} onChange={(e) => edit('Toggle layer', (l) => void (l.enabled = e.target.checked))} />
        <button className="layer-name" onClick={() => setOpen(!open)} aria-expanded={open}>
          {name}
        </button>
        <button className="icon" title="Move up (towards the top)" disabled={index === count - 1} onClick={() => move(1)}>
          ▲
        </button>
        <button className="icon" title="Move down" disabled={index === 0} onClick={() => move(-1)}>
          ▼
        </button>
        <button className="icon danger" title="Delete layer" onClick={() => studio.engine.update('Delete layer', (d) => void (d.skin.layers = d.skin.layers.filter((x) => x.id !== layer.id)))}>
          ✕
        </button>
      </div>
      {open && (
        <div className="layer-body">
          <Slider label="Opacity" value={layer.opacity} min={0} max={1} step={0.01} onChange={(v) => edit('Layer opacity', (l) => void (l.opacity = v), `skin:${layer.id}:opacity`)} onDone={done} />
          <div className="picker-row">
            <label htmlFor={`blend-${layer.id}`}>Blend</label>
            <select id={`blend-${layer.id}`} value={layer.blend} onChange={(e) => edit('Blend mode', (l) => void (l.blend = e.target.value as BlendMode))}>
              {BLEND_MODES.map((m) => (
                <option key={m} value={m}>
                  {BLEND_LABEL[m]}
                </option>
              ))}
            </select>
          </div>
          <div className="picker-row">
            <label htmlFor={`mask-${layer.id}`}>Region</label>
            <select id={`mask-${layer.id}`} value={layer.mask} onChange={(e) => edit('Layer region', (l) => void (l.mask = e.target.value as RegionMask))}>
              {(Object.keys(MASK_LABEL) as RegionMask[]).map((m) => (
                <option key={m} value={m}>
                  {MASK_LABEL[m]}
                </option>
              ))}
            </select>
          </div>
          {spec.params.map((p) =>
            p.type === 'color' ? (
              <div className="picker-row" key={p.key}>
                <label htmlFor={`${layer.id}-${p.key}`}>{p.label}</label>
                <input
                  id={`${layer.id}-${p.key}`}
                  type="color"
                  value={layerParam(layer, p.key) as string}
                  onChange={(e) => edit(p.label, (l) => void (l.params[p.key] = e.target.value), `skin:${layer.id}:${p.key}`)}
                  onBlur={done}
                />
              </div>
            ) : (
              <Slider
                key={p.key}
                label={p.label}
                value={layerParam(layer, p.key) as number}
                min={p.min}
                max={p.max}
                step={p.step}
                onChange={(v) => edit(p.label, (l) => void (l.params[p.key] = v), `skin:${layer.id}:${p.key}`)}
                onDone={done}
              />
            ),
          )}
        </div>
      )}
    </li>
  );
}

function PaintTools() {
  const studio = useStudio();
  const ui = useUi();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (label: string, fn: () => Promise<string | string[]>) => {
    setBusy(label);
    try {
      const out = await fn();
      const paths = (Array.isArray(out) ? out : [out]).filter((p) => p && p !== 'download');
      if (paths.length) ui.info(`Saved ${paths.join(', ')}`);
    } catch (err) {
      ui.error(`Could not export the ${label}`, err);
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <p className="hint">
        Overlays are painted in the MakeHuman (hm08) UV layout. Export the template and the region guide, paint a PNG with alpha,
        then add it with Add image overlay.
      </p>
      <div className="button-column">
        <button disabled={busy !== null} onClick={() => void run('UV template', () => exportSkinUvTemplate(studio))}>
          {busy === 'UV template' ? 'Exporting…' : 'Export skin UV template (2048 px)'}
        </button>
        <button disabled={busy !== null} onClick={() => void run('region guide', () => exportRegionGuide(studio))}>
          {busy === 'region guide' ? 'Exporting…' : 'Export face region guide'}
        </button>
        <button
          disabled={busy !== null}
          onClick={() => void run('skin textures', () => exportSkinTextures(studio))}
          title="The head texture (its own material on export) and the body texture, as the exporter will write them"
        >
          {busy === 'skin textures' ? 'Saving…' : 'Save head and body textures'}
        </button>
      </div>
    </>
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

function Slider(props: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; onDone: () => void }) {
  const id = useId();
  const shown = props.step >= 1 ? String(Math.round(props.value)) : props.value.toFixed(2);
  return (
    <div className="slider-row">
      <label htmlFor={id}>{props.label}</label>
      <input
        id={id}
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
        onPointerUp={props.onDone}
        onKeyUp={props.onDone}
      />
      <span className="slider-value">{shown}</span>
    </div>
  );
}
