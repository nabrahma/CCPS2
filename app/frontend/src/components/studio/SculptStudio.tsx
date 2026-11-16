/**
 * Sculpt Studio (PRD Part 3, F27): brushes on the body itself, for likeness
 * work the sliders cannot reach. Strokes are drawn in the viewport (left drag;
 * the right button turns the view). Each stroke is one undo step, and the
 * sculpt is saved inside the character. Garments, hair, eyes and the skeleton
 * follow it. Save as slider keeps a sculpt for other characters too: it joins
 * "Your sliders" on the Face or Body tab.
 */
import { useEffect, useRef, useState } from 'react';
import { applySculptDab, BodyTopology, encodeSculpt, SCULPT_TOOLS, symmetriseLayer, userTargetFile, type SculptTool } from '@ps2cc/core';
import { backend } from '../../backend';
import { useStudio, useStudioVersion } from '../../state/hooks';
import { refreshUserLibrary } from '../../state/library';
import { useUi } from '../../state/ui';

const LABELS: Record<SculptTool, { label: string; hint: string }> = {
  grab: { label: 'Grab', hint: 'Drag the surface along with the pointer' },
  smooth: { label: 'Smooth', hint: 'Even out bumps and creases' },
  inflate: { label: 'Inflate', hint: 'Push the surface out (Alt: in)' },
  pinch: { label: 'Pinch', hint: 'Pull the surface together towards the brush centre' },
  flatten: { label: 'Flatten', hint: 'Press the surface towards a flat plane' },
  crease: { label: 'Crease', hint: 'Cut a soft fold into the surface' },
  mask: { label: 'Mask', hint: 'Protect an area from the other brushes (Alt: unmask)' },
};

export function SculptStudio({ canvas }: { canvas: HTMLCanvasElement | null }) {
  const studio = useStudio();
  useStudioVersion();
  const ui = useUi();
  const vp = studio.viewport;
  const [tool, setTool] = useState<SculptTool>('grab');
  const [radius, setRadius] = useState(2.5);
  const [strength, setStrength] = useState(0.5);
  const [symmetry, setSymmetry] = useState(true);
  const [name, setName] = useState(`${studio.engine.doc.name} sculpt`);
  const [tab, setTab] = useState<'face' | 'body'>('face');
  const [busy, setBusy] = useState(false);
  const [maskCount, setMaskCount] = useState(0);
  const mask = useRef<Float32Array>(new Float32Array(studio.assets.base.bodyVertexCount));
  const mirror = useRef<Uint32Array | null>(null);
  const topo = BodyTopology.of(studio.assets.base);

  useEffect(() => {
    void studio.assets.mirror().then((m) => (mirror.current = m));
  }, [studio]);

  // Brush mode while the studio is open: left drag paints, the right button orbits.
  useEffect(() => {
    if (!vp) return;
    vp.setBrushMode(true);
    return () => vp.setBrushMode(false);
  }, [vp]);

  useEffect(() => {
    if (!canvas || !vp) return;
    let layer: Float32Array | null = null;
    let last: [number, number, number] | null = null;
    let lastXY: [number, number] | null = null;
    const at = (e: PointerEvent): [number, number] => {
      const r = canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    const dab = (e: PointerEvent, xy: [number, number]) => {
      if (!layer || !mirror.current) return;
      const view = vp.groomView();
      const hit = view.pick(xy[0], xy[1], 'body');
      let delta: [number, number, number] | undefined;
      let centre: [number, number, number] | null = hit?.point ?? null;
      if (tool === 'grab') {
        if (!last || !lastXY) return;
        const depth = view.project(last).depth;
        const a = view.unproject(lastXY[0], lastXY[1], depth);
        const b = view.unproject(xy[0], xy[1], depth);
        delta = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        centre = last;
      }
      if (!centre) return;
      const ctx = { positions: studio.engine.positions, normals: studio.engine.normals, topology: topo, mirror: mirror.current, mask: mask.current };
      const reverse = e.altKey;
      const t: SculptTool = tool;
      applySculptDab(ctx, layer, {
        tool: t,
        centre,
        radius: radius / 100,
        strength: t === 'grab' ? 1 : t === 'inflate' && reverse ? -strength : strength,
        eye: view.eye,
        delta,
        symmetry,
        erase: t === 'mask' && reverse,
      });
      if (t === 'mask') setMaskCount(mask.current.reduce((n, m) => n + (m > 0.5 ? 1 : 0), 0));
      else studio.engine.previewSculpt(layer);
      if (t === 'grab' && delta && last) last = [last[0] + delta[0], last[1] + delta[1], last[2] + delta[2]];
      else if (hit) last = hit.point;
      lastXY = xy;
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const xy = at(e);
      const hit = vp.groomView().pick(xy[0], xy[1], 'body');
      if (!hit) return;
      canvas.setPointerCapture(e.pointerId);
      layer = studio.engine.sculptLayer();
      last = hit.point;
      lastXY = xy;
      if (tool !== 'grab') dab(e, xy);
    };
    const move = (e: PointerEvent) => {
      if (!layer) return;
      dab(e, at(e));
    };
    const up = () => {
      if (!layer) return;
      const done = layer;
      layer = null;
      last = null;
      lastXY = null;
      if (tool === 'mask') return;
      // One undo step per stroke.
      const data = encodeSculpt(done);
      studio.engine.update('Sculpt stroke', (d) => {
        if (data) d.sculpt = data;
        else delete d.sculpt;
      });
      studio.engine.previewSculpt(null);
      studio.engine.endInteraction();
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    return () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      if (layer) up();
    };
  }, [canvas, vp, tool, radius, strength, symmetry, studio, topo]);

  const sculpted = Boolean(studio.engine.doc.sculpt);
  const clear = () => studio.engine.update('Clear sculpt', (d) => void delete d.sculpt);
  const makeSymmetric = () => {
    if (!mirror.current) return;
    const layer = studio.engine.sculptLayer();
    symmetriseLayer(layer, mirror.current);
    const data = encodeSculpt(layer);
    studio.engine.update('Make sculpt symmetric', (d) => {
      if (data) d.sculpt = data;
      else delete d.sculpt;
    });
  };
  const saveAsSlider = async () => {
    const data = studio.engine.doc.sculpt;
    if (!data || !name.trim()) return;
    setBusy(true);
    try {
      const item = await backend.saveTarget(name.trim(), JSON.stringify(userTargetFile(name.trim(), tab, data)));
      await refreshUserLibrary(studio);
      // The sculpt becomes the slider at 1: same shape, now adjustable and reusable.
      studio.engine.update('Sculpt to slider', (d) => {
        delete d.sculpt;
        d.userTargets = { ...(d.userTargets ?? {}), [item.id]: 1 };
      });
      ui.info(`Saved the slider "${name.trim()}": it is under Your sliders on the ${tab === 'face' ? 'Face' : 'Body'} tab`);
    } catch (err) {
      ui.error('Could not save the slider', err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sculpt-studio" data-testid="sculpt-studio">
      <p className="hint">Left drag sculpts; the right button turns the view, the middle one pans. Each stroke is one undo step (Ctrl+Z).</p>
      <div className="tool-line tools" role="group" aria-label="Brush">
        {SCULPT_TOOLS.map((t) => (
          <button key={t} className={tool === t ? 'chip active' : 'chip'} onClick={() => setTool(t)} title={LABELS[t].hint} data-testid={`sculpt-tool-${t}`}>
            {LABELS[t].label}
          </button>
        ))}
      </div>
      <div className="picker-row">
        <label htmlFor="sculpt-radius">Radius</label>
        <input id="sculpt-radius" type="range" min={0.5} max={10} step={0.1} value={radius} onChange={(e) => setRadius(Number(e.target.value))} data-testid="sculpt-radius" />
        <span className="num">{radius.toFixed(1)} cm</span>
      </div>
      <div className="picker-row">
        <label htmlFor="sculpt-strength">Strength</label>
        <input id="sculpt-strength" type="range" min={0.05} max={1} step={0.05} value={strength} onChange={(e) => setStrength(Number(e.target.value))} disabled={tool === 'grab'} data-testid="sculpt-strength" />
        <span className="num">{tool === 'grab' ? '—' : strength.toFixed(2)}</span>
      </div>
      <label className="check" title="Mirror strokes across the middle of the body">
        <input type="checkbox" checked={symmetry} onChange={(e) => setSymmetry(e.target.checked)} data-testid="sculpt-symmetry" /> X symmetry
      </label>
      <div className="tool-line">
        <span className="muted">{maskCount > 0 ? `Mask covers ${maskCount.toLocaleString()} vertices` : 'No mask'}</span>
        <span className="tb-spacer" />
        <button
          onClick={() => {
            mask.current.fill(0);
            setMaskCount(0);
          }}
          disabled={maskCount === 0}
        >
          Clear mask
        </button>
        <button
          onClick={() => {
            for (let i = 0; i < mask.current.length; i++) mask.current[i] = 1 - mask.current[i]!;
            setMaskCount(mask.current.reduce((n, m) => n + (m > 0.5 ? 1 : 0), 0));
          }}
        >
          Invert mask
        </button>
      </div>
      <div className="tool-line">
        <button onClick={makeSymmetric} disabled={!sculpted} title="Make the sculpt the same on both sides" data-testid="sculpt-symmetrise">
          Make symmetric
        </button>
        <button onClick={clear} disabled={!sculpted} data-testid="sculpt-clear">
          Clear sculpt
        </button>
      </div>
      <details className="more save-copy" data-testid="sculpt-save">
        <summary>Save as slider (optional)</summary>
        <p className="hint">The sculpt is already on this character and saved with it. As a slider it works on any character, from −1 to 1.</p>
        <div className="picker-row">
          <label htmlFor="sculpt-name">Name</label>
          <input id="sculpt-name" value={name} maxLength={64} onChange={(e) => setName(e.target.value)} data-testid="sculpt-name" />
        </div>
        <div className="picker-row">
          <label htmlFor="sculpt-tab">Show on</label>
          <select id="sculpt-tab" value={tab} onChange={(e) => setTab(e.target.value as 'face' | 'body')}>
            <option value="face">Face tab</option>
            <option value="body">Body tab</option>
          </select>
        </div>
        <button className="primary" onClick={() => void saveAsSlider()} disabled={!sculpted || busy || !name.trim()} data-testid="sculpt-save-slider">
          {busy ? 'Saving…' : 'Save as slider'}
        </button>
      </details>
      <p className="hint">Make plausible (projecting a face sculpt onto a measured face space) needs the GNM face model, which PS2CC does not ship yet.</p>
    </div>
  );
}
