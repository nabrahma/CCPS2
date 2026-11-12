import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ATLAS_TAGS, atlasTemplate, detectRegions, type AtlasRegion, type AtlasSpec, type AtlasTag, type AtlasTemplateId } from '@ps2cc/core';
import { resolveAssetUrl } from '@ps2cc/viewport';
import { backend } from '../backend';
import { useStudio } from '../state/hooks';
import { useUi } from '../state/ui';

const VIEW = 480;
const TAG_COLOURS: Record<AtlasTag, string> = {
  clump: '#ff7a59',
  strand: '#59c3ff',
  fringe: '#ffd659',
  flyaway: '#b77bff',
  base: '#6fe08a',
  lock: '#e05a8a',
};

type Drag = { index: number; mode: 'move' | 'resize'; startX: number; startY: number; start: AtlasRegion };

/**
 * Hair card atlas editor (PRD F5 step 1): auto-detected card regions over the
 * atlas image, which the user can move, resize, add, delete and tag. Saving
 * applies the atlas to the character's card hair and writes atlas.json beside
 * the PNG when it is a library image.
 */
export function AtlasEditor() {
  const studio = useStudio();
  const req = useUi((s) => s.atlasEditor);
  const openAtlasEditor = useUi((s) => s.openAtlasEditor);
  const info = useUi((s) => s.info);
  const error = useUi((s) => s.error);
  const [regions, setRegions] = useState<AtlasRegion[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [pixels, setPixels] = useState<{ rgba: Uint8ClampedArray; w: number; h: number } | null>(null);
  const [aspect, setAspect] = useState(1);
  const drag = useRef<Drag | null>(null);
  const url = req ? resolveAssetUrl(studio.info.coreAssetsUrl, req.texture) : '';

  // Load the image once per request: alpha for detection, aspect for the view.
  useEffect(() => {
    if (!req) return;
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (cancelled) return;
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, c.width, c.height);
      setPixels({ rgba: data.data, w: c.width, h: c.height });
      setAspect(c.height / c.width);
      setRegions(req.regions?.length ? req.regions : detectRegions(data.data, c.width, c.height));
      setSelected(null);
    };
    img.onerror = () => error(`Could not load the atlas image ${req.name}`);
    img.src = url;
    return () => {
      cancelled = true;
    };
  }, [req, url, error]);

  if (!req) return null;
  const viewW = aspect > 1 ? VIEW / aspect : VIEW;
  const viewH = viewW * aspect;

  const update = (i: number, r: AtlasRegion) => setRegions((rs) => rs.map((x, k) => (k === i ? clampRegion(r) : x)));
  const onPointerDown = (e: ReactPointerEvent, index: number, mode: Drag['mode']) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    setSelected(index);
    drag.current = { index, mode, startX: e.clientX, startY: e.clientY, start: regions[index]! };
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / viewW;
    const dy = (e.clientY - d.startY) / viewH;
    const s = d.start;
    update(d.index, d.mode === 'move' ? { ...s, x: s.x + dx, y: s.y + dy } : { ...s, w: Math.max(0.01, s.w + dx), h: Math.max(0.01, s.h + dy) });
  };
  const close = () => openAtlasEditor(null);
  const save = async () => {
    if (regions.length === 0) {
      error('The atlas needs at least one region');
      return;
    }
    const atlas: AtlasSpec = { format: 'ps2cc.atlas/1', texture: req.texture, regions };
    try {
      if (req.libraryFile) await backend.saveAtlas(req.libraryFile, JSON.stringify(atlas, null, 2));
      studio.engine.update('Hair atlas', (d) => {
        d.hair.atlas = atlas;
        if (d.hair.mode !== 'cards') d.hair.mode = 'cards';
      });
      info(`Atlas ${req.name} applied (${regions.length} regions)`);
      close();
    } catch (err) {
      error('Could not save the atlas', err);
    }
  };
  const sel = selected === null ? null : regions[selected];

  return (
    <div className="modal-backdrop">
      <div className="modal atlas-editor" role="dialog" aria-labelledby="atlas-title">
        <h2 id="atlas-title">Hair card atlas: {req.name}</h2>
        <p className="muted">Drag a box to move it, its corner to resize. Hair roots are at the top of each box.</p>
        <div className="atlas-body">
          <div
            className="atlas-view"
            style={{ width: viewW, height: viewH, backgroundImage: `url("${url}")` }}
            onPointerMove={onPointerMove}
            onPointerUp={() => (drag.current = null)}
            onPointerDown={() => setSelected(null)}
            data-testid="atlas-view"
          >
            {regions.map((r, i) => (
              <div
                key={i}
                className={i === selected ? 'atlas-box selected' : 'atlas-box'}
                style={{ left: r.x * viewW, top: r.y * viewH, width: r.w * viewW, height: r.h * viewH, borderColor: TAG_COLOURS[r.tag] }}
                onPointerDown={(e) => onPointerDown(e, i, 'move')}
              >
                <span className="atlas-tag" style={{ background: TAG_COLOURS[r.tag] }}>{r.tag}</span>
                <span className="atlas-handle" onPointerDown={(e) => onPointerDown(e, i, 'resize')} />
              </div>
            ))}
          </div>
          <div className="atlas-side">
            <h3>Regions ({regions.length})</h3>
            {sel && selected !== null ? (
              <>
                <div className="picker-row">
                  <label htmlFor="atlas-tag">Tag</label>
                  <select id="atlas-tag" value={sel.tag} onChange={(e) => update(selected, { ...sel, tag: e.target.value as AtlasTag })}>
                    {ATLAS_TAGS.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <button className="danger" onClick={() => { setRegions((rs) => rs.filter((_, k) => k !== selected)); setSelected(null); }}>
                  Delete region
                </button>
              </>
            ) : (
              <p className="muted">Click a box to tag or delete it.</p>
            )}
            <button onClick={() => { setRegions((rs) => [...rs, { x: 0.4, y: 0.1, w: 0.2, h: 0.8, tag: 'strand' }]); setSelected(regions.length); }}>
              Add region
            </button>
            <button disabled={!pixels} onClick={() => pixels && setRegions(detectRegions(pixels.rgba, pixels.w, pixels.h))}>
              Auto-detect
            </button>
            <h3>Templates</h3>
            {(['strips4', 'strips8', 'grid4x2'] as AtlasTemplateId[]).map((t) => (
              <button key={t} onClick={() => setRegions(atlasTemplate(t))}>
                {{ strips4: '4 strips', strips8: '8 strips', grid4x2: '4 × 2 grid' }[t]}
              </button>
            ))}
          </div>
        </div>
        <div className="modal-actions">
          <button onClick={close}>Cancel</button>
          <button className="primary" onClick={() => void save()}>Save and use</button>
        </div>
      </div>
    </div>
  );
}

function clampRegion(r: AtlasRegion): AtlasRegion {
  const w = Math.min(1, Math.max(0.01, r.w));
  const h = Math.min(1, Math.max(0.01, r.h));
  return { ...r, w, h, x: Math.min(1 - w, Math.max(0, r.x)), y: Math.min(1 - h, Math.max(0, r.y)) };
}
