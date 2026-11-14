import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  browCoverage,
  browShape,
  browStrokes,
  decodeBrowPaint,
  encodeBrowPaint,
  browPaintEmpty,
  paintBrowDab,
  parseColor,
  layerParam,
  type FaceFeatures,
  type SkinLayer,
} from '@ps2cc/core';

const WIDTH = 320;
const HEIGHT = 128;

interface Frame {
  x0: number;
  y1: number;
  scale: number;
}

/** The view: both brows and eyes seen from the front, the character's left on the right. */
function frameOf(f: FaceFeatures): Frame {
  const W = Math.max(f.eyes[0].halfWidth, f.eyes[1].halfWidth);
  const xMax = Math.max(Math.abs(f.eyes[0].centre[0]), Math.abs(f.eyes[1].centre[0])) + 3.3 * W;
  const yc = (f.eyes[0].centre[1] + f.eyes[1].centre[1]) / 2;
  const y0 = yc - 0.9 * W;
  const y1 = yc + 3.3 * W;
  const scale = Math.min(WIDTH / (2 * xMax), HEIGHT / (y1 - y0));
  return { x0: -WIDTH / 2 / scale, y1: y1 + (HEIGHT / scale - (y1 - y0)) / 2, scale };
}

/** A point of the view in brow space: which brow, and s along it and h up, in eye half widths. */
function browPoint(f: FaceFeatures, fr: Frame, px: number, py: number): { side: 0 | 1; s: number; h: number } {
  const wx = fr.x0 + px / fr.scale;
  const wy = fr.y1 - py / fr.scale;
  const side: 0 | 1 = Math.sign(wx) === Math.sign(f.eyes[0].centre[0]) ? 0 : 1;
  const e = f.eyes[side];
  const sign = Math.sign(e.centre[0]) || 1;
  return { side, s: ((wx - e.centre[0]) * sign) / e.halfWidth, h: (wy - e.centre[1]) / e.halfWidth };
}

function draw(canvas: HTMLCanvasElement, f: FaceFeatures, fr: Frame, layer: SkinLayer, paint: Float32Array, k: number): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const view: SkinLayer = { ...layer, paint: browPaintEmpty(paint) ? undefined : encodeBrowPaint(paint) };
  const shape = browShape(view);
  const [r, g, b] = parseColor(layerParam(layer, 'color') as string);
  // Skin, with the brow's outline as a light wash.
  const img = ctx.createImageData(WIDTH, HEIGHT);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const p = browPoint(f, fr, x + 0.5, y + 0.5);
      const c = browCoverage(shape, p.side, p.s, p.h) * 0.3;
      const o = (y * WIDTH + x) * 4;
      img.data[o] = 214 * (1 - c) + r * c;
      img.data[o + 1] = 178 * (1 - c) + g * c;
      img.data[o + 2] = 156 * (1 - c) + b * c;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const toPx = (wx: number, wy: number): [number, number] => [(wx - fr.x0) * fr.scale, (fr.y1 - wy) * fr.scale];
  // The eyes.
  for (const e of f.eyes) {
    const rim = e.rim && e.rim.length > 2 ? e.rim : null;
    ctx.beginPath();
    if (rim) {
      const pts = [...rim].sort((a, b2) => Math.atan2(a[1] - e.centre[1], a[0] - e.centre[0]) - Math.atan2(b2[1] - e.centre[1], b2[0] - e.centre[0]));
      pts.forEach((v, i) => (i ? ctx.lineTo(...toPx(v[0], v[1])) : ctx.moveTo(...toPx(v[0], v[1]))));
      ctx.closePath();
    } else {
      const [cx, cy] = toPx(e.centre[0], e.centre[1]);
      ctx.ellipse(cx, cy, e.halfWidth * fr.scale, e.halfHeight * fr.scale, 0, 0, Math.PI * 2);
    }
    ctx.fillStyle = '#f1ebe6';
    ctx.fill();
    ctx.strokeStyle = '#5b4036';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  // The hairs, as they grow in this shape.
  ctx.strokeStyle = `rgba(${r},${g},${b},0.75)`;
  ctx.lineWidth = 0.7;
  ctx.lineCap = 'round';
  for (const side of [0, 1] as const) {
    const e = f.eyes[side];
    const sign = Math.sign(e.centre[0]) || 1;
    ctx.beginPath();
    for (const st of browStrokes(view, shape, e, side, k)) {
      const w = (x: number, y: number) => toPx(e.centre[0] + x * sign, e.centre[1] + y);
      ctx.moveTo(...w(st.x0, st.y0));
      ctx.quadraticCurveTo(...w(st.x1, st.y1), ...w(st.x2, st.y2));
    }
    ctx.stroke();
  }
}

/**
 * The brow brush (D-148): paint the brows' outline onto their shape, seen from
 * the front. Adding grows hair where you paint, erasing takes it away; the
 * hairs follow a real brow's flow wherever they grow. A stroke is one undo
 * step, committed when the mouse is released.
 */
export function BrowBrush({ layer, features, onChange }: { layer: SkinLayer; features: FaceFeatures; onChange: (paint: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paint = useRef(decodeBrowPaint(layer.paint));
  const last = useRef<{ x: number; y: number } | null>(null);
  const [erase, setErase] = useState(false);
  const [mirror, setMirror] = useState(true);
  const [size, setSize] = useState(0.3);
  const [strength, setStrength] = useState(0.5);
  const fr = useMemo(() => frameOf(features), [features]);
  const k = features.eyeSpacing / 0.0648;

  // Follow the document: a preset, an undo, another character.
  useEffect(() => {
    paint.current = decodeBrowPaint(layer.paint);
    if (canvasRef.current) draw(canvasRef.current, features, fr, layer, paint.current, k);
  }, [layer, features, fr, k]);

  const at = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - box.left) / box.width) * WIDTH, y: ((e.clientY - box.top) / box.height) * HEIGHT };
  };
  const dab = (to: { x: number; y: number }) => {
    const from = last.current ?? to;
    const step = Math.max(1, size * features.eyes[0].halfWidth * fr.scale * 0.4);
    const steps = Math.min(48, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / step) || 1);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const p = browPoint(features, fr, from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
      paintBrowDab(paint.current, mirror ? 'both' : p.side, p.s, p.h, size, (erase ? -1 : 1) * strength * 0.5);
    }
    last.current = to;
    if (canvasRef.current) draw(canvasRef.current, features, fr, layer, paint.current, k);
  };

  return (
    <div className="brow-brush">
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        data-testid="brow-brush"
        aria-label="Brows seen from the front: paint to add brow, erase to take it away"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          last.current = null;
          dab(at(e));
        }}
        onPointerMove={(e) => {
          if (e.buttons & 1 && last.current) dab(at(e));
        }}
        onPointerUp={() => {
          if (!last.current) return;
          last.current = null;
          onChange(browPaintEmpty(paint.current) ? null : encodeBrowPaint(paint.current));
        }}
      />
      <div className="hairline-tools">
        <div className="seg">
          <button className={erase ? '' : 'active'} onClick={() => setErase(false)} data-testid="brow-brush-add">
            Add
          </button>
          <button className={erase ? 'active' : ''} onClick={() => setErase(true)} data-testid="brow-brush-erase">
            Erase
          </button>
        </div>
        <label className="check">
          <input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} data-testid="brow-brush-mirror" /> Both brows
        </label>
        <button onClick={() => onChange(null)} disabled={!layer.paint} data-testid="brow-brush-clear">
          Clear
        </button>
      </div>
      <div className="slider-row">
        <label htmlFor="brow-brush-size">Brush size</label>
        <input id="brow-brush-size" type="range" min={0.08} max={0.8} step={0.01} value={size} onChange={(e) => setSize(Number(e.target.value))} data-testid="brow-brush-size" />
      </div>
      <div className="slider-row">
        <label htmlFor="brow-brush-strength">Strength</label>
        <input id="brow-brush-strength" type="range" min={0.1} max={1} step={0.01} value={strength} onChange={(e) => setStrength(Number(e.target.value))} />
      </div>
      <p className="hint">Paint over the shape to grow brow there, erase to thin it. The hairs follow a real brow's flow wherever they grow.</p>
    </div>
  );
}
