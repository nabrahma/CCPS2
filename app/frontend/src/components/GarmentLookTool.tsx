/**
 * Viewport tool for a garment's look (Part 2 F18): click pieces into a
 * material zone, paint a zone across pieces, or place a decal (drag for zips
 * and straps). Each click, stroke or placement is one undo step.
 */
import { useEffect, useRef } from 'react';
import { decodeMask, DECAL_DEFAULTS, encodeMask, LINE_DECALS, uvIslands, type GarmentLook } from '@ps2cc/core';
import { useStudio } from '../state/hooks';
import { useUi } from '../state/ui';

/** Painted zones are stored at this size. */
const MASK_SIZE = 256;

export function GarmentLookTool({ canvas }: { canvas: HTMLCanvasElement | null }) {
  const studio = useStudio();
  const ui = useUi();
  const tool = ui.garmentTool;
  const vp = studio.viewport;
  const stroke = useRef<{ start: [number, number]; startUv: [number, number] | null; mask: Uint8Array | null; island: number; moved: boolean } | null>(null);

  useEffect(() => {
    if (!vp || !tool) return;
    vp.setBrushMode(true);
    return () => vp.setBrushMode(false);
  }, [vp, tool]);

  useEffect(() => {
    if (!canvas || !vp || !tool) return;
    const part = studio.scene.parts.find((p) => p.key === tool.partKey);
    const garment = studio.engine.doc.garments.find((g) => `garment:${g.slot}:${g.asset}` === tool.partKey);
    if (!part || !garment) return;
    const assetId = garment.asset;
    const at = (e: PointerEvent): [number, number] => {
      const r = canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    const pick = (e: PointerEvent) => {
      const [x, y] = at(e);
      return vp.groomView().pick(x, y, tool.partKey);
    };
    const update = (label: string, fn: (l: GarmentLook) => void) =>
      studio.engine.update(label, (d) => {
        const g = d.garments.find((x) => x.asset === assetId);
        if (!g?.look) return;
        const l = structuredClone(g.look);
        fn(l);
        g.look = l;
      });
    const paintAt = async (uv: [number, number], s: NonNullable<typeof stroke.current>) => {
      if (tool.mode !== 'paint' || !s.mask) return;
      const canvasData = await studio.scene.garmentLooks.canvas(assetId, MASK_SIZE);
      const cx = Math.floor(uv[0] * MASK_SIZE);
      const cy = Math.floor((1 - uv[1]) * MASK_SIZE);
      const island = canvasData.raster.island[Math.min(MASK_SIZE - 1, Math.max(0, cy)) * MASK_SIZE + Math.min(MASK_SIZE - 1, Math.max(0, cx))]!;
      if (island < 0) return;
      const upm = canvasData.islands.uvPerMetre[island]!;
      const r = (tool.radiusMm / 1000) * upm * MASK_SIZE;
      for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(MASK_SIZE - 1, Math.ceil(cy + r)); y++)
        for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(MASK_SIZE - 1, Math.ceil(cx + r)); x++) {
          if (Math.hypot(x - cx, y - cy) > r) continue;
          // Only the piece under the brush: other pieces may lie next to it in UV space.
          if (canvasData.raster.island[y * MASK_SIZE + x] !== island) continue;
          s.mask[y * MASK_SIZE + x] = tool.zone + 1;
        }
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const hit = pick(e);
      canvas.setPointerCapture(e.pointerId);
      const look = studio.engine.doc.garments.find((g) => g.asset === assetId)?.look;
      stroke.current = {
        start: at(e),
        startUv: hit ? hit.uv : null,
        mask: tool.mode === 'paint' ? (look?.mask && look.mask.size === MASK_SIZE ? decodeMask(look.mask) : new Uint8Array(MASK_SIZE * MASK_SIZE)) : null,
        island: -1,
        moved: false,
      };
      if (hit && tool.mode === 'paint') void paintAt(hit.uv, stroke.current);
    };
    const move = (e: PointerEvent) => {
      const s = stroke.current;
      if (!s) return;
      const p = at(e);
      if (Math.hypot(p[0] - s.start[0], p[1] - s.start[1]) > 4) s.moved = true;
      if (tool.mode === 'paint') {
        const hit = pick(e);
        if (hit) void paintAt(hit.uv, s);
      }
    };
    const up = async (e: PointerEvent) => {
      const s = stroke.current;
      stroke.current = null;
      if (!s) return;
      if (tool.mode === 'paint') {
        const mask = s.mask!;
        update('Paint zone', (l) => void (l.mask = encodeMask(MASK_SIZE, mask)));
        return;
      }
      const hit = pick(e);
      if (tool.mode === 'islands') {
        if (s.moved || !hit || hit.face < 0) return;
        const { surface } = await studio.scene.garmentLooks.surface(assetId);
        const island = uvIslands(surface).ofTriangle[hit.face];
        if (island === undefined) return;
        update('Pick garment piece', (l) => {
          const z = l.zones[tool.zone];
          if (!z) return;
          if (z.islands === 'rest') {
            // The rest zone takes a piece by freeing it from the others.
            for (const o of l.zones) if (o.islands !== 'rest') o.islands = o.islands.filter((i) => i !== island);
          } else if (z.islands.includes(island)) z.islands = z.islands.filter((i) => i !== island);
          else {
            for (const o of l.zones) if (o !== z && o.islands !== 'rest') o.islands = o.islands.filter((i) => i !== island);
            z.islands = [...z.islands, island];
          }
        });
        return;
      }
      // Decals.
      const kind = tool.kind;
      const def = DECAL_DEFAULTS[kind];
      if (LINE_DECALS.has(kind)) {
        if (!s.startUv || !hit) return;
        const end = hit.uv;
        if (Math.hypot(end[0] - s.startUv[0], end[1] - s.startUv[1]) < 0.01) return;
        update(`Add ${kind}`, (l) => void l.decals.push({ id: `d${Date.now().toString(36)}`, kind, uv: s.startUv!, uv2: end, sizeMm: def.sizeMm, rotation: 0, colour: def.colour }));
      } else {
        if (!hit || s.moved) return;
        update(`Add ${kind}`, (l) =>
          void l.decals.push({ id: `d${Date.now().toString(36)}`, kind, uv: hit.uv, sizeMm: def.sizeMm, ...(def.heightMm !== undefined ? { heightMm: def.heightMm } : {}), rotation: 0, colour: def.colour }),
        );
      }
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    return () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
    };
  }, [canvas, vp, tool, studio]);

  if (!tool) return null;
  return (
    <div className="garment-tool-hint" data-testid="garment-tool">
      {tool.mode === 'islands' ? 'Click pieces of the garment to add them to the zone.' : tool.mode === 'paint' ? 'Drag on the garment to paint the zone.' : LINE_DECALS.has(tool.kind) ? 'Drag from one end to the other.' : 'Click to place.'}{' '}
      Right-drag turns the view.{' '}
      <button onClick={() => ui.setGarmentTool(null)} data-testid="garment-tool-done">
        Done
      </button>
    </div>
  );
}
