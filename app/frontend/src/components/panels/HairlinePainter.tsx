import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { decodePaint, encodePaint, hairlineToPaint, paintableLimit, paintStroke, type HairlineMask } from '@ps2cc/core';

const SIZE = 240;
/** The rim of the map is this far down the head from the crown. */
const MAX_THETA = (160 * Math.PI) / 180;
const DEG = Math.PI / 180;
const ACCENT = [255, 74, 28] as const;

/** Map pixel to head angles. The crown is the centre, the face at the top, the character's left on the left. */
function toAngles(x: number, y: number): { theta: number; phi: number } {
  const dx = x - SIZE / 2;
  const dy = y - SIZE / 2;
  return { theta: (Math.hypot(dx, dy) / (SIZE / 2)) * MAX_THETA, phi: Math.atan2(-dx, -dy) };
}

function draw(canvas: HTMLCanvasElement, cells: Uint8Array): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const img = ctx.createImageData(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const { theta, phi } = toAngles(x + 0.5, y + 0.5);
      const o = (y * SIZE + x) * 4;
      if (theta > MAX_THETA) continue;
      const inZone = theta <= paintableLimit(phi);
      const col = Math.min(119, Math.floor(((phi / DEG + 180) / 360) * 120));
      const row = Math.min(59, Math.floor((theta / DEG) / 3));
      const on = cells[row * 120 + col] === 1;
      const base = inZone ? 44 : 22;
      const hatch = !inZone && (x + y) % 8 < 2 ? 12 : 0;
      img.data[o] = on && inZone ? ACCENT[0] : base + hatch;
      img.data[o + 1] = on && inZone ? ACCENT[1] : base + hatch;
      img.data[o + 2] = on && inZone ? ACCENT[2] : base + hatch;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  ctx.strokeStyle = '#ffffff30';
  for (const deg of [45, 90, 135]) {
    ctx.beginPath();
    ctx.arc(SIZE / 2, SIZE / 2, ((deg * DEG) / MAX_THETA) * (SIZE / 2), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = '#ffffffb0';
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Face', SIZE / 2, 14);
  ctx.fillText('Nape', SIZE / 2, SIZE - 6);
  ctx.textAlign = 'left';
  ctx.fillText('L', 6, SIZE / 2 + 4);
  ctx.textAlign = 'right';
  ctx.fillText('R', SIZE - 6, SIZE / 2 + 4);
}

/**
 * Paint where hair grows (PRD F5 step 2), on a map of the scalp seen from
 * above. A stroke is committed when the mouse is released, so one stroke is
 * one undo step and the hair regenerates once.
 */
export function HairlinePainter({ mask, onChange }: { mask: HairlineMask; onChange: (hex: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cells = useRef<Uint8Array>(new Uint8Array(0));
  const last = useRef<{ theta: number; phi: number } | null>(null);
  const [radius, setRadius] = useState(12);
  const [erase, setErase] = useState(false);
  const [mirror, setMirror] = useState(true);

  // Follow the document: a new preset, an undo, a loaded style.
  useEffect(() => {
    cells.current = decodePaint(mask.painted ?? hairlineToPaint(mask));
    if (canvasRef.current) draw(canvasRef.current, cells.current);
  }, [mask]);

  const point = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    return toAngles(((e.clientX - box.left) / box.width) * SIZE, ((e.clientY - box.top) / box.height) * SIZE);
  };
  const paint = (to: { theta: number; phi: number }) => {
    // Fill the gap since the last event, so a fast stroke stays continuous.
    const from = last.current ?? to;
    const span = Math.hypot(to.theta - from.theta, to.phi - from.phi);
    const steps = Math.min(64, Math.ceil(span / (radius * DEG * 0.5)) || 1);
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      // Across the back of the head phi wraps; dabbing only the endpoint there avoids a streak through the face.
      const p = Math.abs(to.phi - from.phi) > Math.PI ? to.phi : from.phi + (to.phi - from.phi) * k;
      paintStroke(cells.current, from.theta + (to.theta - from.theta) * k, p, radius * DEG, !erase, mirror);
    }
    last.current = to;
    if (canvasRef.current) draw(canvasRef.current, cells.current);
  };

  return (
    <div className="hairline-paint">
      <canvas
        ref={canvasRef}
        width={SIZE}
        height={SIZE}
        data-testid="hairline-paint"
        aria-label="Hairline map: paint where hair grows"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          last.current = null;
          paint(point(e));
        }}
        onPointerMove={(e) => {
          if (e.buttons & 1 && last.current) paint(point(e));
        }}
        onPointerUp={() => {
          if (!last.current) return;
          last.current = null;
          onChange(encodePaint(cells.current));
        }}
      />
      <div className="hairline-tools">
        <div className="seg">
          <button className={erase ? '' : 'active'} onClick={() => setErase(false)}>
            Grow
          </button>
          <button className={erase ? 'active' : ''} onClick={() => setErase(true)} data-testid="hairline-erase">
            Erase
          </button>
        </div>
        <label className="check">
          <input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} /> Mirror
        </label>
      </div>
      <div className="slider-row">
        <label htmlFor="hairline-brush">Brush</label>
        <input id="hairline-brush" type="range" min={3} max={30} step={1} value={radius} onChange={(e) => setRadius(Number(e.target.value))} />
        <span className="slider-value">{radius}°</span>
      </div>
      <p className="hint">The face is at the top. Hair can only grow on the lit zone; hatched areas have no scalp.</p>
    </div>
  );
}
