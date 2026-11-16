/**
 * Face points by hand (PRD Part 3, F33): the 68 points of the iBUG
 * convention on a photo, for when MediaPipe finds no face (a stylised
 * drawing, a dark or partly hidden face), or to correct the points it found.
 *
 * Drag a point to move it; with Mirror on, its partner on the other side of
 * the face follows across the midline. Drag empty space to move every point,
 * and use the wheel to scale them around the pointer (placing the template).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { IBUG_COUNT, IBUG_GROUPS, IBUG_MIRROR, ibugFromMediapipe, ibugTemplate, placeTemplate } from '@ps2cc/core';
import { applyManualPoints } from '../skin';
import { useStudio } from '../state/hooks';
import { useUi } from '../state/ui';

const MAX_W = 900;
const MAX_H = 640;

export function PointEditor() {
  const studio = useStudio();
  const ui = useUi();
  const req = ui.pointEditor;
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [points, setPoints] = useState<number[] | null>(null);
  const [mirror, setMirror] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement | null>(null);
  const drag = useRef<{ kind: 'point'; index: number } | { kind: 'all'; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!req) return;
    let alive = true;
    const el = new Image();
    el.crossOrigin = 'anonymous';
    el.onload = () => {
      if (!alive) return;
      setImg(el);
      // Start from the points already used for this photo, or the template on the middle of the photo.
      const p = studio.engine.doc.skin.photo;
      if (p?.image === req.image && p.landmarks) {
        setPoints(p.landmarkSet === 'ibug68' ? p.landmarks.filter((_v, i) => i % 3 !== 2) : ibugFromMediapipe(p.landmarks));
        return;
      }
      void studio.assets.landmarkTable().then((table) => {
        if (!alive || !table) return;
        const template = ibugTemplate(table, studio.engine.positions);
        setPoints(placeTemplate(template, 0.5, 0.48, 0.42, el.naturalWidth / el.naturalHeight));
      });
    };
    el.onerror = () => ui.error('Could not load the photo');
    el.src = req.image;
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req?.image]);

  const size = useMemo(() => {
    if (!img) return { w: MAX_W, h: MAX_H };
    const s = Math.min(MAX_W / img.naturalWidth, MAX_H / img.naturalHeight, 1.5);
    return { w: Math.round(img.naturalWidth * s), h: Math.round(img.naturalHeight * s) };
  }, [img]);

  if (!req) return null;
  const close = () => {
    ui.openPointEditor(null);
    setPoints(null);
    setImg(null);
  };
  const at = (e: React.PointerEvent | React.WheelEvent): [number, number] => {
    const r = svg.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  };
  const midline = (p: number[]) => {
    // The mean x of the nose bridge (iBUG 27-30).
    let x = 0;
    for (let k = 27; k <= 30; k++) x += p[k * 2]!;
    return x / 4;
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !points) return;
    const [x, y] = at(e);
    const next = points.slice();
    if (d.kind === 'point') {
      next[d.index * 2] = x;
      next[d.index * 2 + 1] = y;
      const m = IBUG_MIRROR[d.index]!;
      if (mirror && m !== d.index) {
        const mid = midline(next);
        next[m * 2] = 2 * mid - x;
        next[m * 2 + 1] = y;
      }
    } else {
      const dx = x - d.x;
      const dy = y - d.y;
      for (let k = 0; k < IBUG_COUNT; k++) {
        next[k * 2] = next[k * 2]! + dx;
        next[k * 2 + 1] = next[k * 2 + 1]! + dy;
      }
      drag.current = { kind: 'all', x, y };
    }
    setPoints(next);
  };
  const wheel = (e: React.WheelEvent) => {
    if (!points) return;
    const [cx, cy] = at(e);
    const f = e.deltaY < 0 ? 1.04 : 1 / 1.04;
    setPoints(points.map((v, i) => (i % 2 === 0 ? cx + (v - cx) * f : cy + (v - cy) * f)));
  };
  const apply = async () => {
    if (!points) return;
    setBusy(true);
    try {
      await applyManualPoints(studio, req.image, points);
      ui.info('Face placed with your points');
      close();
    } catch (err) {
      ui.error('Could not use the points', err);
    } finally {
      setBusy(false);
    }
  };

  const px = (k: number): [number, number] => [points![k * 2]! * size.w, points![k * 2 + 1]! * size.h];
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Face points" data-testid="point-editor">
      <div className="modal point-editor">
        <h2>Face points</h2>
        <p className="hint">
          {req.reason === 'no-face' ? 'No face was found in this photo automatically. ' : ''}
          Drag the points onto the eyes, brows, nose, lips and jaw line. Drag empty space to move them all; the wheel scales them.
        </p>
        <div className="point-stage" style={{ width: size.w, height: size.h }}>
          {img && <img src={req.image} alt="Face photo" width={size.w} height={size.h} draggable={false} />}
          {points && (
            <svg
              ref={svg}
              width={size.w}
              height={size.h}
              onPointerDown={(e) => {
                (e.target as Element).setPointerCapture?.(e.pointerId);
                const t = (e.target as Element).getAttribute('data-point');
                if (t !== null) {
                  drag.current = { kind: 'point', index: Number(t) };
                  setSelected(Number(t));
                } else {
                  const [x, y] = at(e);
                  drag.current = { kind: 'all', x, y };
                }
              }}
              onPointerMove={move}
              onPointerUp={() => (drag.current = null)}
              onWheel={wheel}
              data-testid="point-stage"
            >
              {IBUG_GROUPS.map((g) => {
                const seq = Array.from({ length: g.to - g.from }, (_v, i) => g.from + i);
                if (g.closed) seq.push(g.from);
                return <polyline key={g.name} points={seq.map((k) => px(k).join(',')).join(' ')} className="point-line" />;
              })}
              {Array.from({ length: IBUG_COUNT }, (_v, k) => {
                const [x, y] = px(k);
                return <circle key={k} cx={x} cy={y} r={selected === k ? 5 : 4} data-point={k} className={selected === k ? 'point active' : 'point'} />;
              })}
            </svg>
          )}
        </div>
        <div className="tool-line">
          <label className="check" title="Move the matching point on the other side of the face too">
            <input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} /> Mirror
          </label>
          {selected !== null && <span className="muted">Point {selected + 1} of 68: {IBUG_GROUPS.find((g) => selected >= g.from && selected < g.to)?.name}</span>}
          <span className="tb-spacer" />
          <button onClick={close} disabled={busy}>
            Cancel
          </button>
          <button className="primary" onClick={() => void apply()} disabled={busy || !points} data-testid="point-editor-apply">
            {busy ? 'Placing…' : 'Use these points'}
          </button>
        </div>
      </div>
    </div>
  );
}
