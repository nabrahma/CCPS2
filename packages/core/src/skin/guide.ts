/**
 * Face region guide (PRD F6: "ship a UV template and a face region guide so
 * the user can paint new overlays"): the hm08 UV layout with the mask regions
 * filled, outlines of the facial features (lips, under-eye, beard area) and
 * label anchors. The app draws the label text and saves it as a PNG.
 */
import { newLayer } from './layers';
import type { SkinComposer } from './compose';
import { createImage, sampleBilinear, type RgbaImage } from './image';
import type { Vec3 } from './features';

export interface GuideLabel {
  text: string;
  /** UV of the label anchor (v up). */
  u: number;
  v: number;
}

const FILL: Record<'face' | 'body' | 'hands', [number, number, number]> = {
  face: [196, 120, 96],
  body: [110, 110, 118],
  hands: [86, 128, 186],
};

export function regionGuide(composer: SkinComposer, size = 2048): { image: RgbaImage; labels: GuideLabel[] } {
  const out = createImage(size, size, [22, 22, 26, 255]);
  const masks = composer.masks;
  const tmp = [0, 0, 0, 0];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const v = 1 - (y + 0.5) / size;
      sampleBilinear(masks, u, v, tmp);
      if (tmp[3]! < 128) continue;
      const w = [tmp[0]! / 255, tmp[1]! / 255, tmp[2]! / 255];
      const sum = w[0]! + w[1]! + w[2]! || 1;
      const c = [0, 1, 2].map((k) => (w[0]! * FILL.face[k]! + w[1]! * FILL.body[k]! + w[2]! * FILL.hands[k]!) / sum);
      out.data.set([c[0]!, c[1]!, c[2]!, 255], (y * size + x) * 4);
    }
  }
  // Feature outlines from the procedural placements (the same shapes the layers use).
  const outlines: { layer: ReturnType<typeof newLayer>; threshold: number; colour: [number, number, number]; label: string }[] = [
    { layer: newLayer('lips'), threshold: 128, colour: [255, 90, 110], label: 'Lips' },
    { layer: newLayer('darkCircles'), threshold: 90, colour: [180, 140, 255], label: 'Under-eye' },
    { layer: newLayer('stubble', { params: { color: '#000000', density: 1, fullness: 1, shadow: 1, seed: 1 } }), threshold: 60, colour: [255, 210, 90], label: 'Beard area' },
    { layer: newLayer('blush'), threshold: 110, colour: [255, 150, 150], label: 'Cheek' },
  ];
  const labels: GuideLabel[] = [];
  for (const o of outlines) {
    const img = composer.layerImage(o.layer);
    const n = img.width;
    const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < n && y < n && img.data[(y * n + x) * 4 + 3]! >= o.threshold;
    let cu = 0;
    let cv = 0;
    let count = 0;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (!inside(x, y)) continue;
        cu += (x + 0.5) / n;
        cv += 1 - (y + 0.5) / n;
        count++;
        const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
        if (!edge) continue;
        // Draw the edge pixel scaled up to the guide size.
        const s = size / n;
        for (let dy = 0; dy < Math.max(1, s); dy++)
          for (let dx = 0; dx < Math.max(1, s); dx++) {
            const gx = Math.floor(x * s + dx);
            const gy = Math.floor(y * s + dy);
            if (gx < size && gy < size) out.data.set([...o.colour, 255], (gy * size + gx) * 4);
          }
      }
    }
    // Under-eye, beard and cheek come in two halves; label the larger cluster only once.
    if (count > 0) labels.push({ text: o.label, u: cu / count, v: cv / count });
  }
  // Points: eye openings and nose tip, at the UV of the nearest neutral surface texel.
  const f = composer.features;
  const points: [string, Vec3][] = [
    ['Eye', f.eyes[0].centre],
    ['Eye', f.eyes[1].centre],
    ['Nose tip', f.noseTip],
  ];
  for (const [text, p] of points) {
    const uv = nearestUv(composer, p);
    if (!uv) continue;
    labels.push({ text, u: uv[0], v: uv[1] });
    const cx = Math.floor(uv[0] * size);
    const cy = Math.floor((1 - uv[1]) * size);
    const r = Math.max(2, Math.round(size / 400));
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && y >= 0 && x < size && y < size && dx * dx + dy * dy <= r * r) out.data.set([255, 255, 255, 255], (y * size + x) * 4);
      }
  }
  // Region labels at the centre of each island kind's largest island.
  const islands = composer.layout.islands;
  const byKind = new Map<string, (typeof islands)[number]>();
  for (const isl of islands) {
    const cur = byKind.get(isl.kind);
    if (!cur || isl.faces.length > cur.faces.length) byKind.set(isl.kind, isl);
  }
  const names: Record<string, string> = { head: 'Head (own texture on export)', body: 'Body', hands: 'Hand', feet: 'Foot' };
  for (const [kind, isl] of byKind) labels.push({ text: names[kind]!, u: (isl.box[0] + isl.box[2]) / 2, v: isl.box[3] - 0.02 });
  return { image: out, labels };
}

/** UV of the neutral-surface texel nearest to a 3D point (null if none within 1 cm). */
export function nearestUv(composer: SkinComposer, p: Vec3): [number, number] | null {
  const map = composer.surface;
  let best = 1e-4;
  let at = -1;
  for (let t = 0; t < map.coverage.length; t++) {
    if (!map.coverage[t]) continue;
    const d = (map.position[t * 3]! - p[0]) ** 2 + (map.position[t * 3 + 1]! - p[1]) ** 2 + (map.position[t * 3 + 2]! - p[2]) ** 2;
    if (d < best) [best, at] = [d, t];
  }
  if (at < 0) return null;
  const n = map.size;
  return [((at % n) + 0.5) / n, 1 - (Math.floor(at / n) + 0.5) / n];
}
