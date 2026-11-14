/**
 * Material Studio (Part 2 F20): make a garment material from a library
 * material or from your own images, adjust it, and save it to the library,
 * where every garment look can use it.
 *
 * - Start from: any library material (its PBR maps), or your images: a colour
 *   map, and optionally normal, roughness, occlusion and height maps. A single
 *   photo works too: its relief comes from its brightness.
 * - Adjust: hue, saturation, brightness, contrast, relief, occlusion, and
 *   "make seamless" for images that do not tile; the kind, tile size and name.
 * - The preview is the converted era diffuse, tiled, and the garment the
 *   studio was opened from wearing it (one undo step, put back on Cancel).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  convertMaterial,
  MATERIAL_KINDS,
  NEUTRAL_MATERIAL_ADJUST,
  newLook,
  seamDifference,
  userMaterial,
  type ConvertedMaterial,
  type MaterialAdjust,
  type MaterialKind,
  type MaterialSources,
  type RgbaImage,
} from '@ps2cc/core';
import { resolveAssetUrl } from '@ps2cc/viewport';
import { decodeImage, imageToPng } from '../../images';
import { useStudio, useStudioVersion } from '../../state/hooks';
import { useUi } from '../../state/ui';

type MapKey = 'albedo' | 'normal' | 'roughness' | 'ao' | 'height';
const MAP_LABEL: Record<MapKey, string> = { albedo: 'Colour (required)', normal: 'Normal', roughness: 'Roughness', ao: 'Occlusion', height: 'Height' };
const PREVIEW_SIZE = 512;
let draftCounter = 0;

const ADJUST_SLIDERS: { key: keyof MaterialAdjust; label: string; min: number; max: number; step: number }[] = [
  { key: 'hue', label: 'Hue', min: -180, max: 180, step: 1 },
  { key: 'saturation', label: 'Saturation', min: 0, max: 2, step: 0.01 },
  { key: 'brightness', label: 'Brightness', min: 0.2, max: 2, step: 0.01 },
  { key: 'contrast', label: 'Contrast', min: 0.2, max: 2, step: 0.01 },
  { key: 'relief', label: 'Relief', min: 0, max: 2, step: 0.01 },
  { key: 'occlusion', label: 'Occlusion', min: 0, max: 2, step: 0.01 },
  { key: 'seamless', label: 'Make seamless', min: 0, max: 0.4, step: 0.01 },
];

export function MaterialStudio() {
  const studio = useStudio();
  useStudioVersion();
  const ui = useUi();
  const state = ui.assetStudio!;
  const materials = (studio.assets.catalog.materials ?? []).filter((m) => !m.id.includes('~draft'));
  const [from, setFrom] = useState<string>(state.target && materials.some((m) => m.id === state.target) ? state.target : 'images');
  const start = materials.find((m) => m.id === from) ?? null;
  const [sources, setSources] = useState<Partial<Record<MapKey, RgbaImage>> & { arm?: RgbaImage }>({});
  const [adjust, setAdjust] = useState<MaterialAdjust>({ ...NEUTRAL_MATERIAL_ADJUST });
  const [kind, setKind] = useState<MaterialKind>(start?.kind ?? 'cotton');
  const [tileCm, setTileCm] = useState(Math.round((start?.tileMetres ?? 0.3) * 100));
  const [name, setName] = useState(start ? `${start.name} (mine)` : 'My material');
  const [preview, setPreview] = useState<{ url: string; seam: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const zone = state.zone ?? null;
  const original = useRef<string | null | undefined>(undefined);
  const draft = useRef<string | null>(null);

  // The zone's material when the studio opened, to put back on Cancel.
  useEffect(() => {
    if (!zone) return;
    const g = studio.engine.doc.garments.find((x) => `garment:${x.slot}:${x.asset}` === zone.partKey);
    original.current = g?.look?.zones[zone.zone]?.material ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load the starting material's maps.
  useEffect(() => {
    if (from === 'images') return;
    const m = materials.find((x) => x.id === from);
    if (!m) return;
    let alive = true;
    setBusy('Loading the material…');
    const load = (p: string) => decodeImage(resolveAssetUrl(studio.info.coreAssetsUrl, p));
    const maps =
      m.source.site === 'user'
        ? // A user material is already an era diffuse: start from it, flat (its relief is in it).
          load(m.diffuse).then((albedo) => ({ albedo, normal: flat(albedo.width) }))
        : Promise.all([load(m.pbr.albedo), load(m.pbr.normal), load(m.pbr.arm)]).then(([albedo, normal, arm]) => ({ albedo, normal, arm }));
    maps.then(
      (s) => {
        if (!alive) return;
        setSources(s);
        setKind(m.kind);
        setTileCm(Math.round(m.tileMetres * 100));
        setBusy(null);
      },
      (err: unknown) => {
        if (!alive) return;
        setBusy(null);
        setError(`Could not load ${m.name}: ${String(err)}`);
      },
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from]);

  const ready = Boolean(sources.albedo);
  const srcKey = useMemo(() => Object.values(sources).map((s) => (s ? `${s.width}x${s.height}` : '')).join('|') + Math.random(), [sources]);

  // Convert at preview size after a pause in the changes; show it tiled, and on the garment.
  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => {
      const converted = convertMaterial(sources as MaterialSources, adjust, PREVIEW_SIZE);
      void imageToPng(converted.diffuse).then((png) => {
        const url = URL.createObjectURL(png);
        setPreview((old) => {
          // Released a little later: the swatch and the garment keep showing it until the new one is drawn.
          if (old) window.setTimeout(() => URL.revokeObjectURL(old.url), 5000);
          return { url, seam: seamDifference(converted.diffuse) };
        });
        if (zone) showOnGarment(converted, url);
      });
    }, 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srcKey, adjust, kind, tileCm, ready]);

  /** The garment wears the draft: a temporary library material, replaced by each new preview. */
  const showOnGarment = (converted: ConvertedMaterial, url: string) => {
    if (!zone) return;
    const id = `user:materials/~draft-${++draftCounter}`;
    const doc = { name, kind, tileMetres: tileCm / 100, roughness: converted.roughness, gloss: converted.gloss, swatch: converted.swatch, diffuse: 'draft.png', diffuseSize: PREVIEW_SIZE, from: from === 'images' ? null : from, adjust };
    studio.assets.addUserMaterial(userMaterial(doc, id, url));
    setZoneMaterial(id, 'Material Studio preview', 'material-studio-preview');
    dropDraft();
    draft.current = id;
  };
  const dropDraft = () => {
    if (!draft.current) return;
    studio.assets.removeUserMaterial(draft.current);
    studio.scene.garmentLooks.forgetMaterial(draft.current);
    draft.current = null;
  };
  const setZoneMaterial = (id: string | null, label: string, merge?: string) => {
    if (!zone) return;
    studio.engine.update(
      label,
      (d) => {
        const g = d.garments.find((x) => `garment:${x.slot}:${x.asset}` === zone.partKey);
        if (!g) return;
        if (!g.look) {
          if (id === null) return;
          g.look = newLook(id);
        } else if (g.look.zones[zone.zone]) g.look.zones[zone.zone]!.material = id;
      },
      merge,
    );
  };

  const pickImage = async (key: MapKey, file: File) => {
    try {
      const url = URL.createObjectURL(file);
      const img = await decodeImage(url).finally(() => URL.revokeObjectURL(url));
      setError(null);
      setSources((s) => ({ ...(from === 'images' ? s : {}), [key]: img }));
      if (from !== 'images') setFrom('images');
      if (key === 'albedo' && name === 'My material') setName(file.name.replace(/\.[^.]+$/, '').slice(0, 48));
    } catch (err) {
      setError(`Could not read ${file.name}: ${String(err)}`);
    }
  };

  const close = () => {
    if (zone && original.current !== undefined && draft.current) setZoneMaterial(original.current, 'Material Studio cancel');
    dropDraft();
    ui.closeStudio();
  };

  const save = async () => {
    if (!ready) return;
    const label = name.trim();
    if (!label) {
      setError('Give the material a name');
      return;
    }
    setBusy('Converting and saving…');
    setError(null);
    try {
      const converted = convertMaterial(sources as MaterialSources, adjust);
      const id = await studio.saveMaterial(label, kind, tileCm / 100, converted, from === 'images' ? null : from, adjust);
      if (zone) setZoneMaterial(id, `Material ${label}`);
      dropDraft();
      ui.info(`Saved ${label} to the library`);
      ui.closeStudio();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const zoneGarment = zone ? studio.engine.doc.garments.find((x) => `garment:${x.slot}:${x.asset}` === zone.partKey) : null;
  return (
    <div className="slider-panel material-studio" data-testid="material-studio">
      <div className="picker-row">
        <label htmlFor="material-from">Start from</label>
        <select id="material-from" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="material-from">
          <option value="images">Your images</option>
          {materials.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>
      <details className="hair-section" open={from === 'images'}>
        <summary>Your images</summary>
        <p className="hint">A colour map is enough (a photo of the cloth works: its relief comes from its brightness). Add normal, roughness, occlusion or height maps if you have them.</p>
        {(Object.keys(MAP_LABEL) as MapKey[]).map((k) => (
          <label key={k} className="file-row">
            <span>{MAP_LABEL[k]}</span>
            <input
              type="file"
              accept="image/png,image/jpeg"
              data-testid={`material-image-${k}`}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void pickImage(k, f);
              }}
            />
            {from === 'images' && sources[k] && <span className="muted">{sources[k]!.width}×{sources[k]!.height}</span>}
          </label>
        ))}
      </details>
      <div
        className="material-preview"
        data-testid="material-preview"
        data-seam={preview ? preview.seam.toFixed(4) : ''}
        style={preview ? { backgroundImage: `url(${preview.url})`, backgroundSize: '50% 50%' } : undefined}
      >
        {!preview && <span className="muted">{busy ?? (ready ? 'Converting…' : 'Choose a material or a colour map')}</span>}
      </div>
      <p className="hint">
        Two by two tiles, {tileCm * 2} cm across.{' '}
        {zoneGarment ? `Shown on the ${studio.assets.hasProxy(zoneGarment.asset) ? studio.assets.proxyInfo(zoneGarment.asset).name.replace(/_/g, ' ') : 'garment'} in the viewport.` : 'Click a garment before opening the studio to see it worn.'}
        {preview && preview.seam > 0.08 && ' The edges do not match yet: raise Make seamless.'}
      </p>
      <details className="hair-section" open>
        <summary>Adjust</summary>
        {ADJUST_SLIDERS.map((a) => (
          <div className="slider-row" key={a.key}>
            <label htmlFor={`material-${a.key}`}>{a.label}</label>
            <input id={`material-${a.key}`} type="range" min={a.min} max={a.max} step={a.step} value={adjust[a.key]} onChange={(e) => setAdjust({ ...adjust, [a.key]: Number(e.target.value) })} data-testid={`material-${a.key}`} />
            <span className="num muted">{a.key === 'hue' ? `${adjust[a.key]}°` : adjust[a.key].toFixed(2)}</span>
          </div>
        ))}
        <button className="link" onClick={() => setAdjust({ ...NEUTRAL_MATERIAL_ADJUST })}>
          Reset
        </button>
      </details>
      <details className="hair-section" open>
        <summary>Material</summary>
        <div className="picker-row">
          <label htmlFor="material-kind">Kind</label>
          <select id="material-kind" value={kind} onChange={(e) => setKind(e.target.value as MaterialKind)} data-testid="material-kind">
            {MATERIAL_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </div>
        <div className="slider-row">
          <label htmlFor="material-tile">Tile size (cm)</label>
          <input id="material-tile" type="range" min={2} max={100} step={1} value={tileCm} onChange={(e) => setTileCm(Number(e.target.value))} data-testid="material-tile" />
          <span className="num muted">{tileCm}</span>
        </div>
        <div className="picker-row">
          <label htmlFor="material-name">Name</label>
          <input id="material-name" value={name} maxLength={64} onChange={(e) => setName(e.target.value)} data-testid="material-name" />
        </div>
      </details>
      {error && (
        <p className="error-text" data-testid="material-error">
          {error}
        </p>
      )}
      <div className="button-row">
        <button onClick={() => void save()} disabled={!ready || busy !== null} data-testid="material-save" title="Convert at 1024 px and add it to the library">
          {busy === 'Converting and saving…' ? 'Saving…' : 'Save to library'}
        </button>
        <button onClick={close} data-testid="material-cancel">
          Close without saving
        </button>
      </div>
    </div>
  );
}

function flat(size: number): RgbaImage {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) data.set([128, 128, 255, 255], i * 4);
  return { width: size, height: size, data };
}
