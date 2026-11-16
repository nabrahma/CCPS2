/**
 * Sculpt brushes (PRD Part 3, F27) on the full-resolution hm08 body: Grab,
 * Smooth, Inflate, Pinch, Flatten, Crease, and a Mask that protects what it
 * covers from the others. Each brush dab adds to a dense sculpt layer (xyz
 * per body vertex). Only vertices facing the viewer are touched, so a stroke
 * on the cheek does not reach through to the ear behind it. With X symmetry
 * the dab is repeated mirrored, through the hm08 mirror table; where both
 * dabs reach a vertex (on the centre line) their effects are averaged, so the
 * centre moves only along the plane of symmetry.
 */
import type { BodyTopology } from '../anthro/topology';

type Vec3 = [number, number, number];
export type SculptTool = 'grab' | 'smooth' | 'inflate' | 'pinch' | 'flatten' | 'crease' | 'mask';
export const SCULPT_TOOLS: readonly SculptTool[] = ['grab', 'smooth', 'inflate', 'pinch', 'flatten', 'crease', 'mask'];

export interface SculptContext {
  /** Current hm08 positions (with the sculpt so far), metres. */
  positions: ArrayLike<number>;
  /** Vertex normals of those positions. */
  normals: ArrayLike<number>;
  topology: BodyTopology;
  /** hm08 mirror table (vertex -> vertex across x = 0). */
  mirror: ArrayLike<number>;
  /** 0..1 per body vertex: how much the mask protects it. */
  mask?: Float32Array;
}

export interface SculptDab {
  tool: SculptTool;
  centre: Vec3;
  radius: number;
  /** 0..1. */
  strength: number;
  /** Where the viewer is (front-facing test). */
  eye: Vec3;
  /** Grab: how far the pointer moved since the last dab (metres). */
  delta?: Vec3;
  symmetry: boolean;
  /** Mask: take mask away instead of adding it. */
  erase?: boolean;
}

/** Smooth falloff from 1 at the centre to 0 at the radius. */
export function sculptFalloff(t: number): number {
  if (t >= 1) return 0;
  const u = 1 - t * t;
  return u * u;
}

interface Weighted {
  v: number;
  w: number;
}

function affected(ctx: SculptContext, centre: Vec3, radius: number, eye: Vec3): Weighted[] {
  const p = ctx.positions;
  const n = ctx.normals;
  const out: Weighted[] = [];
  const r2 = radius * radius;
  const count = ctx.topology.vertexCount;
  for (let v = 0; v < count; v++) {
    const dx = p[v * 3]! - centre[0];
    const dy = p[v * 3 + 1]! - centre[1];
    const dz = p[v * 3 + 2]! - centre[2];
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= r2) continue;
    // Facing the viewer.
    const ex = eye[0] - p[v * 3]!;
    const ey = eye[1] - p[v * 3 + 1]!;
    const ez = eye[2] - p[v * 3 + 2]!;
    if (n[v * 3]! * ex + n[v * 3 + 1]! * ey + n[v * 3 + 2]! * ez <= 0) continue;
    let w = sculptFalloff(Math.sqrt(d2) / radius);
    if (ctx.mask) w *= 1 - ctx.mask[v]!;
    if (w > 0) out.push({ v, w });
  }
  return out;
}

/** The displacement one dab gives, as a sparse map (vertex -> xyz); the mask brush instead returns mask changes in x. */
function dabDisplacement(ctx: SculptContext, dab: SculptDab): Map<number, Vec3> {
  const out = new Map<number, Vec3>();
  const list = affected(ctx, dab.centre, dab.radius, dab.eye);
  if (list.length === 0) return out;
  const p = ctx.positions;
  const n = ctx.normals;
  const s = dab.strength;
  const topo = ctx.topology;
  // The surface direction under the brush: the weighted mean normal.
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (const { v, w } of list) {
    nx += n[v * 3]! * w;
    ny += n[v * 3 + 1]! * w;
    nz += n[v * 3 + 2]! * w;
  }
  const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
  nx /= nl;
  ny /= nl;
  nz /= nl;
  const [cx, cy, cz] = dab.centre;
  for (const { v, w } of list) {
    const px = p[v * 3]!;
    const py = p[v * 3 + 1]!;
    const pz = p[v * 3 + 2]!;
    let d: Vec3;
    switch (dab.tool) {
      case 'grab': {
        const g = dab.delta ?? [0, 0, 0];
        d = [g[0] * w, g[1] * w, g[2] * w];
        break;
      }
      case 'smooth': {
        let ax = 0;
        let ay = 0;
        let az = 0;
        const a = topo.nbrStart[v]!;
        const b = topo.nbrStart[v + 1]!;
        for (let k = a; k < b; k++) {
          const u = topo.nbr[k]!;
          ax += p[u * 3]!;
          ay += p[u * 3 + 1]!;
          az += p[u * 3 + 2]!;
        }
        const c = b - a || 1;
        const k = s * w * 0.5;
        d = [(ax / c - px) * k, (ay / c - py) * k, (az / c - pz) * k];
        break;
      }
      case 'inflate': {
        const k = s * w * dab.radius * 0.04;
        d = [n[v * 3]! * k, n[v * 3 + 1]! * k, n[v * 3 + 2]! * k];
        break;
      }
      case 'pinch':
      case 'crease': {
        // Towards the centre, in the surface (the normal part removed).
        let tx = cx - px;
        let ty = cy - py;
        let tz = cz - pz;
        const along = tx * nx + ty * ny + tz * nz;
        tx -= along * nx;
        ty -= along * ny;
        tz -= along * nz;
        const k = s * w * (dab.tool === 'crease' ? 0.12 : 0.18);
        d = [tx * k, ty * k, tz * k];
        if (dab.tool === 'crease') {
          const dig = -s * w * dab.radius * 0.03;
          d = [d[0] + nx * dig, d[1] + ny * dig, d[2] + nz * dig];
        }
        break;
      }
      case 'flatten': {
        // Onto the plane through the centre across the mean normal.
        const off = (px - cx) * nx + (py - cy) * ny + (pz - cz) * nz;
        const k = -off * s * w * 0.3;
        d = [nx * k, ny * k, nz * k];
        break;
      }
      case 'mask':
        d = [(dab.erase ? -1 : 1) * s * w, 0, 0];
        break;
    }
    out.set(v, d);
  }
  return out;
}

function mirrored(dab: SculptDab): SculptDab {
  return {
    ...dab,
    centre: [-dab.centre[0], dab.centre[1], dab.centre[2]],
    eye: [-dab.eye[0], dab.eye[1], dab.eye[2]],
    delta: dab.delta ? [-dab.delta[0], dab.delta[1], dab.delta[2]] : undefined,
  };
}

/**
 * Apply one dab. Adds the displacement into `layer` (xyz per body vertex,
 * metres), or for the mask tool, changes `ctx.mask`. Returns the vertices it
 * changed.
 */
export function applySculptDab(ctx: SculptContext, layer: Float32Array, dab: SculptDab): number[] {
  const first = dabDisplacement(ctx, dab);
  let total = first;
  if (dab.symmetry) {
    const second = dabDisplacement(ctx, mirrored(dab));
    total = new Map<number, Vec3>();
    // The mirror image of the second dab is the second dab itself (it was made at the mirrored place);
    // vertices both reach get the mean of the two, others their one effect.
    for (const [v, d] of first) {
      const e = second.get(v);
      total.set(v, e ? [(d[0] + e[0]) / 2, (d[1] + e[1]) / 2, (d[2] + e[2]) / 2] : d);
    }
    for (const [v, e] of second) if (!first.has(v)) total.set(v, e);
  }
  const changed: number[] = [];
  if (dab.tool === 'mask') {
    if (!ctx.mask) return changed;
    for (const [v, d] of total) {
      ctx.mask[v] = Math.min(1, Math.max(0, ctx.mask[v]! + d[0]));
      changed.push(v);
    }
    return changed;
  }
  for (const [v, d] of total) {
    layer[v * 3] = layer[v * 3]! + d[0];
    layer[v * 3 + 1] = layer[v * 3 + 1]! + d[1];
    layer[v * 3 + 2] = layer[v * 3 + 2]! + d[2];
    changed.push(v);
  }
  return changed;
}

/** Make a layer exactly symmetric (mean of itself and its mirror image). */
export function symmetriseLayer(layer: Float32Array, mirror: ArrayLike<number>): void {
  const n = layer.length / 3;
  const copy = Float32Array.from(layer);
  for (let v = 0; v < n; v++) {
    const m = mirror[v]!;
    if (m >= n) continue;
    layer[v * 3] = (copy[v * 3]! - copy[m * 3]!) / 2;
    layer[v * 3 + 1] = (copy[v * 3 + 1]! + copy[m * 3 + 1]!) / 2;
    layer[v * 3 + 2] = (copy[v * 3 + 2]! + copy[m * 3 + 2]!) / 2;
  }
}
