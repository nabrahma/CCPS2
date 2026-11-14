/**
 * Procedural skin layers (PRD F6): dark circles, eye bags, stubble, lips,
 * eyeliner and eyeshadow, blush, freckles, dirt, bruises and sweat; and the
 * mouth interior's darkening towards the throat, and painted eyebrows and
 * eyelashes, the era-typical alternative to brow and lash geometry (Part 2
 * F19; D-146).
 *
 * Each layer is a function of the neutral surface (position and normal per
 * texel, from SkinLayout.surfaceMap) and the facial features measured on the
 * neutral mesh, so it is painted in hm08 UV space, crosses UV seams without a
 * break and stays in place when the body morphs. Output: RGBA, colour in RGB
 * and coverage in alpha. They are stand-ins until the user paints overlays on
 * the UV template (TODO_ART), not photo-sourced art.
 */
import type { SkinLayer } from '../character/doc';
import type { FaceFeatures, Vec3 } from './features';
import { createImage, dilateRgb, type RgbaImage } from './image';
import { colorParam, numParam } from './layers';
import type { SurfaceMap } from './layout';
import { fbm, hash3, smoothstep, spots, valueNoise } from './noise';
import { browCoverage, browShape, browStrokes, lashStrokes, rimProfile, rimRadius } from './painted-hair';
import { StrokeField } from './strokes';

export interface ProceduralContext {
  map: SurfaceMap;
  features: FaceFeatures;
  /** Island kind per island id (bruises and sweat avoid the mouth interior and eye sockets). */
  islandKinds: readonly string[];
  /** Island ids of the main face island and other islands that must not get face makeup. */
  faceIsland: number;
  /** The mouth interior's island. */
  mouthIsland: number;
}

type Shade = (p: Vec3, n: Vec3, out: { a: number; rgb: [number, number, number] | null }, island: number) => void;

/** Render a procedural layer into an RGBA image the size of the surface map. */
export function generateLayer(layer: SkinLayer, ctx: ProceduralContext): RgbaImage {
  const shade = shaderFor(layer, ctx);
  const { map } = ctx;
  // A windowed map (the brows and lashes, drawn finer around the eyes) fills a window-sized
  // image that goes into a full-size one at the end.
  const win = map.window;
  const width = win ? win.width : map.size;
  const height = win ? win.height : map.size;
  const img = createImage(width, height);
  if (!isProcedural(layer.kind)) throw new Error(`layer kind ${layer.kind} is not procedural`);
  // The pores' region map has no colour of its own (only its alpha is used).
  const base: [number, number, number] = layer.kind === 'pores' ? [128, 128, 128] : colorParam(layer, 'color');
  const p: Vec3 = [0, 0, 0];
  const n: Vec3 = [0, 0, 0];
  const out: { a: number; rgb: [number, number, number] | null } = { a: 0, rgb: null };
  const total = width * height;
  for (let t = 0; t < total; t++) {
    if (!map.coverage[t]) continue;
    p[0] = map.position[t * 3]!;
    p[1] = map.position[t * 3 + 1]!;
    p[2] = map.position[t * 3 + 2]!;
    n[0] = map.normal[t * 3]!;
    n[1] = map.normal[t * 3 + 1]!;
    n[2] = map.normal[t * 3 + 2]!;
    out.a = 0;
    out.rgb = null;
    shade(p, n, out, map.island[t]!);
    const c = out.rgb ?? base;
    img.data[t * 4] = c[0];
    img.data[t * 4 + 1] = c[1];
    img.data[t * 4 + 2] = c[2];
    img.data[t * 4 + 3] = Math.round(Math.min(1, Math.max(0, out.a)) * 255);
  }
  // Carry colour and coverage a few texels past the island edges, so bilinear filtering (and the
  // composite's 2x upsampling) does not fade the layer along every UV seam; the gutters are not
  // drawn on the mesh, so this only affects the edge texels' filtering.
  const edge = Uint8Array.from(map.coverage);
  dilateRgb(img, edge, GUTTER_TEXELS, 4);
  // Colour further out too, so filtering keeps the layer colour everywhere.
  for (let t = 0; t < total; t++) {
    if (map.coverage[t] || img.data[t * 4 + 3]! > 0) continue;
    img.data[t * 4] = base[0];
    img.data[t * 4 + 1] = base[1];
    img.data[t * 4 + 2] = base[2];
  }
  if (!win) return img;
  const full = createImage(map.size, map.size);
  for (let t = 0; t < map.size * map.size; t++) {
    full.data[t * 4] = base[0];
    full.data[t * 4 + 1] = base[1];
    full.data[t * 4 + 2] = base[2];
  }
  for (let y = 0; y < height; y++) full.data.set(img.data.subarray(y * width * 4, (y + 1) * width * 4), ((win.y0 + y) * map.size + win.x0) * 4);
  return full;
}

/** Texels the layers' colour and coverage reach past the island edges. */
const GUTTER_TEXELS = 3;

/** True for procedural kinds (generated from the surface). */
export function isProcedural(kind: SkinLayer['kind']): boolean {
  return kind !== 'tone' && kind !== 'image' && kind !== 'occlusion' && kind !== 'cavity' && kind !== 'lightBake' && kind !== 'scalpHair';
}

function gauss(dx: number, dy: number, dz: number, rx: number, ry: number, rz: number): number {
  return Math.exp(-((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) + (dz * dz) / (rz * rz)));
}

/**
 * Typical distance between neighbouring texels of a map on the surface (metres): what a hair
 * stroke is filtered over.
 */
function texelSize(map: SurfaceMap): number {
  const w = map.window ? map.window.width : map.size;
  const h = map.window ? map.window.height : map.size;
  const d: number[] = [];
  for (let y = 0; y < h - 1 && d.length < 4000; y += 3) {
    for (let x = 0; x < w - 1 && d.length < 4000; x += 3) {
      const t = y * w + x;
      if (!map.coverage[t] || !map.coverage[t + 1] || map.island[t] !== map.island[t + 1]) continue;
      const u = t + 1;
      d.push(Math.hypot(map.position[t * 3]! - map.position[u * 3]!, map.position[t * 3 + 1]! - map.position[u * 3 + 1]!, map.position[t * 3 + 2]! - map.position[u * 3 + 2]!));
    }
  }
  if (d.length === 0) return 0.0005;
  d.sort((x, y) => x - y);
  return d[d.length >> 1]!;
}

/** Facing the camera (front of the head), soft. */
const front = (n: Vec3) => smoothstep(-0.1, 0.45, n[2]);

function shaderFor(layer: SkinLayer, ctx: ProceduralContext): Shade {
  const f = ctx.features;
  const k = f.eyeSpacing / 0.0648; // shapes were tuned on the hm08 base (eyes 64.8 mm apart)
  const [eyeL, eyeR] = f.eyes;
  const mouth = f.mouth;
  const seed = layer.params.seed !== undefined ? numParam(layer, 'seed') : 1;
  const onFace = (p: Vec3) => p[1] > f.chin[1] - 0.06 * k && p[2] > f.neck[2] - 0.01 * k;
  const mx = mouth.centre;
  // The beard area (stubble, stubble hairs): 0..1, `fullness` 0 = goatee and moustache, 1 = full beard.
  const beard = (p: Vec3, fullness: number): number => {
    if (!onFace(p)) return 0;
    const ax = Math.abs(p[0]);
    // Cheek line from the mouth corner up to the sideburn; the beard is below it.
    const t = smoothstep(mouth.halfWidth, mouth.halfWidth + 0.05 * k, ax);
    const lineY = mx[1] + 0.012 * k + t * (0.045 * k);
    let w = 1 - smoothstep(lineY - 0.004 * k, lineY + 0.004 * k, p[1]);
    // Moustache: up to just under the nose.
    if (ax < mouth.halfWidth * 1.3) w = Math.max(w, 1 - smoothstep(f.noseTip[1] - 0.02 * k, f.noseTip[1] - 0.012 * k, p[1]));
    // Not on the lips.
    const lip = gauss(p[0] - mx[0], p[1] - (mx[1] - 0.001 * k), 0, mouth.halfWidth * 1.05, 0.0085 * k, 1);
    w *= 1 - smoothstep(0.35, 0.7, lip);
    // Under the jaw it fades out towards the Adam's apple.
    w *= smoothstep(f.chin[1] - 0.035 * k, f.chin[1] - 0.01 * k, p[1]);
    // Behind the sideburns it stops.
    w *= smoothstep(f.neck[2] - 0.005 * k, f.neck[2] + 0.025 * k, p[2]);
    // Not on the ears (out at the side and well back from the jaw line).
    w *= 1 - smoothstep(0.068 * k, 0.075 * k, ax) * (1 - smoothstep(0.05 * k, 0.065 * k, p[2] - f.neck[2]));
    const reach = mouth.halfWidth * 1.4 + fullness * 0.08 * k;
    return w * (1 - smoothstep(reach * 0.8, reach, ax));
  };
  switch (layer.kind) {
    case 'darkCircles': {
      const size = numParam(layer, 'size');
      return (p, n, o) => {
        let a = 0;
        for (const e of [eyeL, eyeR]) {
          const side = Math.sign(e.centre[0]);
          const dx = p[0] - (e.centre[0] + side * 0.002 * k);
          const dy = p[1] - (e.centre[1] - e.halfHeight - 0.006 * k * size);
          const dz = p[2] - e.centre[2];
          // A crescent under the eye: a soft ellipse minus the eye opening.
          const under = gauss(dx, dy, dz, (e.halfWidth + 0.006 * k) * size, 0.0075 * k * size, 0.03 * k);
          const opening = gauss(p[0] - e.centre[0], p[1] - e.centre[1], 0, e.halfWidth * 1.05, e.halfHeight * 1.6, 1);
          a = Math.max(a, under * (1 - opening) * smoothstep(e.centre[1] + 0.002, e.centre[1] - e.halfHeight, p[1]));
        }
        o.a = a * front(n) * 1.1;
      };
    }
    case 'eyeBags': {
      const size = numParam(layer, 'size');
      return (p, n, o) => {
        let a = 0;
        for (const e of [eyeL, eyeR]) {
          const dx = p[0] - e.centre[0];
          // Bags curve up towards the outer corner.
          const curve = 0.12 * (dx * dx) / (0.01 * k);
          const dy = p[1] - (e.centre[1] - e.halfHeight - 0.012 * k * size) - curve;
          a = Math.max(a, gauss(dx, dy, p[2] - e.centre[2], (e.halfWidth + 0.004 * k) * size, 0.0035 * k * size, 0.03 * k));
        }
        o.a = a * front(n);
      };
    }
    case 'stubble': {
      const density = numParam(layer, 'density');
      const fullness = numParam(layer, 'fullness');
      const shadow = numParam(layer, 'shadow');
      const cell = 0.0006 * k;
      return (p, n, o) => {
        const w = beard(p, fullness);
        if (w <= 0.001) return;
        const hair = valueNoise(p[0] / cell, p[1] / cell, p[2] / cell, seed) < density ? 1 : 0;
        const patch = 0.75 + 0.25 * fbm(p[0] / (0.012 * k), p[1] / (0.012 * k), p[2] / (0.012 * k), seed + 7, 2);
        o.a = w * patch * (shadow + (1 - shadow) * hair);
      };
    }
    case 'lips': {
      const size = numParam(layer, 'size');
      const c = mouth.centre;
      return (p, n, o) => {
        const x = (p[0] - c[0]) / (mouth.halfWidth * 1.08 * size);
        if (Math.abs(x) > 1.2) return;
        const dy = p[1] - c[1];
        // Upper lip thinner than the lower one; both taper towards the corners.
        const hh = (dy > 0 ? 0.0068 : 0.0085) * k * size * (1 - 0.55 * x * x);
        const r = Math.hypot(x, dy / Math.max(1e-5, hh));
        o.a = (1 - smoothstep(0.75, 1.05, r)) * smoothstep(c[2] - 0.02 * k, c[2] - 0.008 * k, p[2]);
      };
    }
    case 'eyeliner': {
      const thick = numParam(layer, 'thickness');
      const shadowAmt = numParam(layer, 'shadow');
      const liner = colorParam(layer, 'color');
      const shadowCol = colorParam(layer, 'shadowColor');
      const rgb: [number, number, number] = [0, 0, 0];
      return (p, n, o) => {
        let a = 0;
        let s = 0;
        for (const e of [eyeL, eyeR]) {
          const dx = (p[0] - e.centre[0]) / (e.halfWidth * 1.08);
          const dy = (p[1] - e.centre[1]) / (e.halfHeight * 1.5);
          if (Math.abs(dx) > 4 || Math.abs(dy) > 6 || Math.abs(p[2] - e.centre[2]) > 0.02 * k) continue;
          const r = Math.hypot(dx, dy);
          const upper = smoothstep(-0.6, 0.4, dy) * 0.55 + 0.45;
          if (thick > 0) a = Math.max(a, upper * Math.exp(-(((r - 1.12) / (0.16 * thick)) ** 2)));
          // Eyeshadow: on the upper lid, fading out softly towards the brow and both corners.
          if (shadowAmt > 0)
            s = Math.max(s, shadowAmt * smoothstep(-0.2, 0.9, dy) * smoothstep(0.95, 1.25, r) * (1 - smoothstep(1.6, 2.5, r)) * Math.exp(-((dx / 2.1) ** 4)));
        }
        const total = Math.max(a, s);
        if (total <= 0) return;
        const m = a / (a + s + 1e-6);
        for (let i = 0; i < 3; i++) rgb[i] = Math.round(shadowCol[i]! + (liner[i]! - shadowCol[i]!) * m);
        o.a = total * front(n);
        o.rgb = rgb;
      };
    }
    case 'blush': {
      const size = numParam(layer, 'size');
      return (p, n, o) => {
        let a = 0;
        for (const e of [eyeL, eyeR]) {
          const cx = e.centre[0] + Math.sign(e.centre[0]) * 0.012 * k;
          const cy = (e.centre[1] + mouth.centre[1]) / 2 + 0.004 * k;
          a = Math.max(a, gauss(p[0] - cx, p[1] - cy, p[2] - (e.centre[2] - 0.01 * k), 0.02 * k * size, 0.014 * k * size, 0.03 * k));
        }
        o.a = a * front(n);
      };
    }
    case 'freckles': {
      const density = numParam(layer, 'density');
      const size = numParam(layer, 'size');
      const cell = 0.0035 * k;
      return (p, n, o) => {
        // Across the nose and upper cheeks.
        const cy = (eyeL.centre[1] + f.noseTip[1]) / 2 - 0.004 * k;
        const region = Math.min(1, 1.6 * gauss(p[0], p[1] - cy, 0, 0.055 * k, 0.02 * k, 1)) * front(n);
        if (region < 0.02) return;
        o.a = region * spots(p[0] / cell, p[1] / cell, p[2] / cell, seed, 0.2 + 0.8 * density, 0.42 * size);
      };
    }
    case 'dirt': {
      const amount = numParam(layer, 'amount');
      const scale = 0.035 * numParam(layer, 'scale');
      return (p, _n, o) => {
        const big = fbm(p[0] / scale, p[1] / scale, p[2] / scale, seed, 3);
        const grain = hash3(Math.floor(p[0] / 0.0012), Math.floor(p[1] / 0.0012), Math.floor(p[2] / 0.0012), seed + 3);
        const cover = smoothstep(0.62 - 0.4 * amount, 0.82 - 0.3 * amount, big);
        o.a = cover * (0.7 + 0.3 * grain);
      };
    }
    case 'bruises': {
      const count = Math.round(numParam(layer, 'count'));
      const size = numParam(layer, 'size');
      const rim = colorParam(layer, 'rim');
      const centre = colorParam(layer, 'color');
      const sites = bruiseSites(ctx, count, seed);
      const radius = 0.028 * size;
      const rgb: [number, number, number] = [0, 0, 0];
      return (p, _n, o) => {
        let best = 0;
        let dBest = 1;
        for (const s of sites) {
          const d = Math.hypot(p[0] - s[0], p[1] - s[1], p[2] - s[2]) / radius;
          if (d > 1.5) continue;
          const warped = d + 0.35 * (valueNoise(p[0] / 0.008, p[1] / 0.008, p[2] / 0.008, seed + 11) - 0.5);
          const a = 1 - smoothstep(0.35, 1, warped);
          if (a > best) [best, dBest] = [a, warped];
        }
        if (best <= 0) return;
        const m = smoothstep(0.25, 0.9, dBest);
        for (let i = 0; i < 3; i++) rgb[i] = Math.round(centre[i]! + (rim[i]! - centre[i]!) * m);
        o.a = best;
        o.rgb = rgb;
      };
    }
    case 'brows': {
      // Hair by hair, with a soft fill under it (painted-hair.ts; D-148).
      const shape = browShape(layer);
      const fill = numParam(layer, 'fill');
      const texel = texelSize(ctx.map);
      const fields = ([0, 1] as const).map((i) => new StrokeField(browStrokes(layer, shape, f.eyes[i], i, k), texel, 0.003 * k));
      return (p, n, o) => {
        let a = 0;
        for (let i = 0; i < 2; i++) {
          const e = f.eyes[i]!;
          const sign = Math.sign(e.centre[0]) || 1;
          const W = e.halfWidth;
          const X = (p[0] - e.centre[0]) * sign;
          const Y = p[1] - e.centre[1];
          const s = X / W;
          const h = Y / W;
          if (s < -3.2 || s > 3.5 || h < 0 || h > 3.5) continue;
          // The brow wraps round the side of the head: its tail is about 2 cm behind the eye.
          if (p[2] < e.centre[2] - 0.03 * k || p[2] > e.centre[2] + 0.02 * k) continue;
          const cover = browCoverage(shape, i as 0 | 1, s, h);
          // A soft, slightly uneven tone carries the shape, as brow powder or the era's painted brows.
          const patch = 0.78 + 0.22 * valueNoise(X / (0.003 * k), Y / (0.003 * k), i * 5 + 1, shape.seed + 47);
          const tone = fill * 0.95 * smoothstep(0.05, 0.8, cover) * patch;
          const hair = fields[i]!.coverage(X, Y);
          a = Math.max(a, 1 - (1 - tone) * (1 - hair));
        }
        o.a = a * front(n);
      };
    }
    case 'lashes': {
      // A lash line along each lid, a fringe of lashes from the eye's real rim (heaviest at the
      // outer corner, clumped if asked), a smoky shadow and lower lashes (painted-hair.ts; D-148).
      const lower = numParam(layer, 'lower');
      const thickness = numParam(layer, 'thickness');
      const smudge = numParam(layer, 'smudge');
      const outer = numParam(layer, 'outer');
      const density = numParam(layer, 'density');
      const texel = texelSize(ctx.map);
      const rims = [rimProfile(eyeL), rimProfile(eyeR)];
      const fields = [0, 1].map((i) => new StrokeField(lashStrokes(layer, f.eyes[i as 0 | 1], rims[i]!, k), texel, 0.003 * k));
      return (p, n, o) => {
        let a = 0;
        for (let i = 0; i < 2; i++) {
          const e = i === 0 ? eyeL : eyeR;
          const sign = Math.sign(e.centre[0]) || 1;
          const hw = e.halfWidth;
          const vx = p[0] - e.centre[0];
          const vy = p[1] - e.centre[1];
          if (Math.abs(vx) > 2.2 * hw || Math.abs(vy) > 1.6 * hw || Math.abs(p[2] - e.centre[2]) > 0.02 * k) continue;
          const th = Math.atan2(vy, vx);
          const rimR = rimRadius(rims[i]!, th);
          const d = Math.hypot(vx, vy) - rimR; // metres outside the rim
          const s = (vx / hw) * sign; // -1 inner corner, +1 outer
          const upper = vy > 0;
          // Along the lid: none at the inner corner, fullest towards the outer corner.
          const lid = upper
            ? smoothstep(-1.05, -0.6, s) * (0.6 + 0.4 * smoothstep(-0.3, 0.8, s)) * (1 - smoothstep(1.05, 1.3, s))
            : smoothstep(-0.7, -0.2, s) * (1 - smoothstep(0.9, 1.15, s));
          // The lash line: dark at the roots, on the lid just outside the rim (the eye hides the rim
          // itself), widest at the outer corner of the upper lid.
          let line = 0;
          if (thickness > 0 && d > -0.0008 * k && d < 0.004 * k) {
            const width = upper ? 0.0006 * k * thickness * (1 + 0.7 * smoothstep(0.2, 1, s)) : 0.0007 * k * Math.max(0.3, thickness);
            const g = Math.exp(-(((d - (upper ? 0.6 : 0.2) * width) / width) ** 2));
            line = upper ? 0.95 * lid * g : lower * 0.4 * lid * g;
          }
          // Smoky shadow round the lash line, reaching further at the outer corner.
          let smoke = 0;
          if (smudge > 0) {
            const reach = 0.0028 * k * (1 + 0.6 * outer * smoothstep(0.2, 1, s));
            const wide = smoothstep(-1.1, -0.5, s) * (1 - smoothstep(1.2, 1.7, s));
            smoke = smudge * (upper ? 0.55 : 0.35) * wide * Math.exp(-((Math.max(0, d) / reach) ** 2)) * smoothstep(-0.0004 * k, 0.0002 * k, d);
          }
          // The lashes' mass near their roots, seen from the front as a soft dark band over the line.
          const mass = upper && d > -0.0003 * k ? 0.35 * density * lid * Math.exp(-(((d - 0.0008 * k) / (0.0011 * k)) ** 2)) : 0;
          const hair = fields[i]!.coverage(vx * sign, vy);
          a = Math.max(a, 1 - (1 - line) * (1 - smoke) * (1 - mass) * (1 - hair));
        }
        o.a = a * front(n);
      };
    }
    case 'pores': {
      // Region strength for the pore tile (detail.ts): strongest on the nose, then the cheeks,
      // lighter on the forehead and the rest of the face, none on the eyelids and lips, faint on the body.
      const nose = numParam(layer, 'nose');
      const cheeks = numParam(layer, 'cheeks');
      const forehead = numParam(layer, 'forehead');
      const body = numParam(layer, 'body');
      const eyeY = (eyeL.centre[1] + eyeR.centre[1]) / 2;
      return (p, _n, o, island) => {
        if (island !== ctx.faceIsland) {
          o.a = ctx.islandKinds[island] === 'head' ? 0 : body;
          return;
        }
        let w = 0.6 * cheeks;
        // Forehead: above the brows, fading in over a couple of centimetres.
        w = Math.max(w, forehead * smoothstep(eyeY + 0.012 * k, eyeY + 0.03 * k, p[1]));
        for (const e of [eyeL, eyeR]) {
          const side = Math.sign(e.centre[0]);
          const cheek = gauss(p[0] - (e.centre[0] + side * 0.006 * k), p[1] - (f.noseTip[1] + 0.004 * k), p[2] - (e.centre[2] - 0.01 * k), 0.028 * k, 0.026 * k, 0.04 * k);
          w = Math.max(w, cheeks * (0.6 + 0.4 * cheek));
        }
        const noseW = gauss(p[0], p[1] - (f.noseTip[1] + 0.012 * k), p[2] - (f.noseTip[2] - 0.012 * k), 0.017 * k, 0.026 * k, 0.03 * k);
        w = Math.max(w, nose * smoothstep(0.2, 0.7, noseW));
        // None on the lids (around each eye opening) or the lips.
        for (const e of [eyeL, eyeR]) {
          const lid = gauss(p[0] - e.centre[0], p[1] - e.centre[1], 0, e.halfWidth * 1.9, e.halfHeight * 3.5, 1);
          w *= 1 - smoothstep(0.2, 0.6, lid);
        }
        const lip = gauss(p[0] - mx[0], p[1] - (mx[1] - 0.001 * k), 0, mouth.halfWidth * 1.35, 0.011 * k, 1);
        w *= 1 - smoothstep(0.15, 0.5, lip);
        // The scalp and the back of the head (under hair) get the body's strength.
        const back = 1 - smoothstep(f.neck[2] - 0.01 * k, f.neck[2] + 0.03 * k, p[2]);
        const top = smoothstep(eyeY + 0.06 * k, eyeY + 0.09 * k, p[1]);
        const away = Math.max(back, top);
        o.a = w * (1 - away) + body * away;
      };
    }
    case 'stubbleHair': {
      // Region strength for the stubble-hair tile (detail.ts): the beard area.
      const fullness = numParam(layer, 'fullness');
      return (p, n, o, island) => {
        // The face island only: elsewhere hm08's UVs are too stretched for the tile (it streaks), and
        // the stubble layer's own shadow carries on under the jaw.
        if (island !== ctx.faceIsland) return;
        // Fading out under the jaw (facing down), where the face island's UVs compress towards its edge.
        o.a = beard(p, fullness) * (1 - smoothstep(0.15, 0.55, -n[1]));
      };
    }
    case 'mouth': {
      // Dark towards the throat: 0 at the lip line, full at `depth` behind it, on the mouth interior only.
      const depth = (numParam(layer, 'depth') / 100) * k;
      const lip = mouth.centre[2];
      return (p, _n, o, island) => {
        if (island !== ctx.mouthIsland) return;
        o.a = smoothstep(0.002 * k, depth, lip - p[2]);
      };
    }
    case 'sweat': {
      const amount = numParam(layer, 'amount');
      const cell = 0.0035 * k;
      return (p, n, o) => {
        // Forehead, nose and upper lip.
        const forehead = gauss(p[0], p[1] - (eyeL.centre[1] + 0.035 * k), 0, 0.05 * k, 0.018 * k, 1);
        const nose = gauss(p[0], p[1] - f.noseTip[1], 0, 0.012 * k, 0.02 * k, 1);
        const lip = gauss(p[0], p[1] - (mouth.centre[1] + 0.012 * k), 0, 0.02 * k, 0.005 * k, 1);
        const region = Math.max(forehead, nose, lip) * front(n);
        if (region < 0.02) return;
        const drops = spots(p[0] / cell, p[1] / cell, p[2] / cell, seed, 0.25 + 0.6 * amount, 0.35);
        o.a = region * (0.25 * amount + drops);
      };
    }
    default:
      throw new Error(`layer kind ${layer.kind} is not procedural`);
  }
}

/** Deterministic bruise centres on visible skin (arms, legs, torso, face front). */
function bruiseSites(ctx: ProceduralContext, count: number, seed: number): Vec3[] {
  const { map } = ctx;
  const candidates: number[] = [];
  for (let t = 0; t < map.coverage.length; t += 7) {
    if (!map.coverage[t]) continue;
    const kind = ctx.islandKinds[map.island[t]!];
    if (kind !== 'body' && !(map.island[t] === ctx.faceIsland && map.normal[t * 3 + 2]! > 0.4)) continue;
    candidates.push(t);
  }
  const out: Vec3[] = [];
  for (let i = 0; i < count && candidates.length > 0; i++) {
    const t = candidates[Math.floor(hash3(i, 17, 3, seed) * candidates.length)]!;
    out.push([map.position[t * 3]!, map.position[t * 3 + 1]!, map.position[t * 3 + 2]!]);
  }
  return out;
}
