/**
 * Pattern panels to triangle meshes (F30 discretisation, F31 coarse remesh). Each panel's outline is sampled
 * by arc length; the two sides of every stitch get the same number of samples, at the same arc-length
 * fractions, so seam points pair up exactly. The inside gets lattice points at the target edge length and
 * the whole is triangulated (constrained Delaunay).
 */
import { Arc, CubicBezier, Line, QuadraticBezier, type P2 } from '../pattern/num/curves';
import type { PanelSpec, PatternSpec, StitchSpec } from '../pattern/spec';
import { relToAbs2d } from '../pattern/utils';
import { latticePoints, ringArea, ringDistance2, triangulate } from './triangulate';

type Seg = Line | QuadraticBezier | CubicBezier | Arc;

/** The geometric curve of a panel edge (pattern coordinates, cm). */
export function edgeSegment(panel: PanelSpec, i: number): Seg {
  const e = panel.edges[i]!;
  const a = panel.vertices[e.endpoints[0]!]!;
  const b = panel.vertices[e.endpoints[1]!]!;
  const s: P2 = [a[0]!, a[1]!];
  const t: P2 = [b[0]!, b[1]!];
  if (!e.curvature) return new Line(s, t);
  if (e.curvature.type === 'circle') {
    const [rad, large, right] = e.curvature.params as [number, number, number];
    return new Arc(s, [rad, rad], 0, !!large, !!right, t);
  }
  const cps = (e.curvature.params as number[][]).map((c) => relToAbs2d(a, b, c) as P2);
  return e.curvature.type === 'quadratic' ? new QuadraticBezier(s, cps[0]!, t) : new CubicBezier(s, cps[0]!, cps[1]!, t);
}

/** Points at arc-length fractions k/n, k = 0..n. */
export function sampleSegment(seg: Seg, n: number): P2[] {
  const L = seg.length();
  const out: P2[] = [seg.point(0)];
  for (let k = 1; k < n; k++) {
    const t = seg instanceof Line ? k / n : seg.ilength((L * k) / n, 1e-9 * Math.max(1, L));
    out.push(seg.point(t));
  }
  out.push(seg.point(1));
  return out;
}

export interface PanelMesh {
  name: string;
  /** First particle (global index) of this panel. */
  offset: number;
  count: number;
  /** Pattern coordinates (cm), 2 per particle, boundary first. */
  points: Float64Array;
  /** Triangles (local indices), wound so that their normal is the panel's outside. */
  tris: Uint32Array;
  /** Per panel edge, the local indices of its samples from its start to its end. */
  edgeSamples: number[][];
  /** The panel's loop runs clockwise in the pattern plane (its outside is the pattern's -z). */
  clockwise: boolean;
  /** Pattern area (cm²). */
  area: number;
}

export interface Discretised {
  panels: PanelMesh[];
  /** Global particle pairs sewn together (deduplicated, sorted). */
  seams: Uint32Array;
  /** Per seam pair, the stitch it belongs to. */
  seamStitch: Int32Array;
  particles: number;
  /** Target edge length used (cm). */
  h: number;
}

/** Sample counts per (panel, edge): stitched edges share one count with their partner. */
function edgeCounts(spec: PatternSpec, names: string[], h: number): Map<string, number> {
  const counts = new Map<string, number>();
  const len = new Map<string, number>();
  for (const name of names) {
    const p = spec.panels[name]!;
    for (let i = 0; i < p.edges.length; i++) {
      const L = edgeSegment(p, i).length();
      len.set(`${name}#${i}`, L);
      // At least two segments: a tube of two narrow panels (a cuff) keeps four points round it, not two.
      counts.set(`${name}#${i}`, L < 1e-3 ? 1 : Math.max(2, Math.ceil(L / h - 1e-9)));
    }
  }
  // Stitches can chain (an edge stitched to two edges in a row): repeat until stable.
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (const st of spec.stitches) {
      const ka = `${st[0].panel}#${st[0].edge}`;
      const kb = `${st[1].panel}#${st[1].edge}`;
      if (!counts.has(ka) || !counts.has(kb)) continue;
      const m = Math.max(counts.get(ka)!, counts.get(kb)!);
      if (counts.get(ka) !== m || counts.get(kb) !== m) changed = true;
      counts.set(ka, m);
      counts.set(kb, m);
    }
    if (!changed) break;
  }
  return counts;
}

/**
 * Triangulate the panels of a pattern at edge length `h` (cm). `skip` names panels left out (attachments,
 * laid on their host after the drape).
 */
export function discretise(spec: PatternSpec, h: number, skip: ReadonlySet<string> = new Set()): Discretised {
  const names = Object.keys(spec.panels).filter((n) => !skip.has(n));
  const counts = edgeCounts(spec, names, h);
  const panels: PanelMesh[] = [];
  let offset = 0;
  for (const name of names) {
    const p = spec.panels[name]!;
    const ring: number[] = [];
    const edgeSamples: number[][] = [];
    const E = p.edges.length;
    for (let i = 0; i < E; i++) {
      const n = counts.get(`${name}#${i}`)!;
      const pts = sampleSegment(edgeSegment(p, i), n);
      const start = ring.length / 2;
      const idx: number[] = [];
      for (let k = 0; k < n; k++) {
        ring.push(pts[k]![0], pts[k]![1]);
        idx.push(start + k);
      }
      idx.push(-1); // the next edge's first sample (filled below)
      edgeSamples.push(idx);
    }
    for (let i = 0; i < E; i++) edgeSamples[i]![edgeSamples[i]!.length - 1] = edgeSamples[(i + 1) % E]![0]!;
    const area = ringArea(ring);
    const interior = latticePoints(ring, h);
    let tri = triangulate(ring, interior);
    // A panel too narrow for lattice points (a band, a cuff sewn into a tube) is spanned by chords between
    // boundary points; sewn to another such panel along both sides, the two would share those chords. Each
    // chord gets a point at its middle, until none is left.
    for (let pass = 0; pass < 3; pass++) {
      const nbr = ring.length / 2;
      const mids: number[] = [];
      const seen = new Set<number>();
      for (let t = 0; t < tri.tris.length / 3; t++)
        for (let k = 0; k < 3; k++) {
          const a = tri.tris[t * 3 + k]!;
          const b = tri.tris[t * 3 + ((k + 1) % 3)]!;
          if (a >= nbr || b >= nbr) continue;
          const d = Math.abs(a - b);
          if (d === 1 || d === nbr - 1) continue;
          const key = Math.min(a, b) * nbr + Math.max(a, b);
          if (seen.has(key)) continue;
          seen.add(key);
          const mx = (tri.points[a * 2]! + tri.points[b * 2]!) / 2;
          const my = (tri.points[a * 2 + 1]! + tri.points[b * 2 + 1]!) / 2;
          // Only chords across the panel: one along a gently curved outline has its middle next to it.
          const cx = tri.points[a * 2]! - tri.points[b * 2]!;
          const cy = tri.points[a * 2 + 1]! - tri.points[b * 2 + 1]!;
          const dm = ringDistance2(ring, mx, my);
          if (dm < 0.0625 * (cx * cx + cy * cy) || dm < 0.16 * h * h) continue;
          mids.push(mx, my);
        }
      if (!mids.length) break;
      tri = triangulate(ring, Array.from(tri.points.subarray(nbr * 2)).concat(mids));
    }
    const clockwise = area < 0;
    const tris = tri.tris;
    if (clockwise) {
      for (let t = 0; t < tris.length / 3; t++) {
        const b = tris[t * 3 + 1]!;
        tris[t * 3 + 1] = tris[t * 3 + 2]!;
        tris[t * 3 + 2] = b;
      }
    }
    panels.push({ name, offset, count: tri.points.length / 2, points: tri.points, tris, edgeSamples, clockwise, area: Math.abs(area) });
    offset += tri.points.length / 2;
  }

  // Seams: GarmentCode's orientation (edge 1's end to edge 2's start; start to start for right_wrong).
  const byName = new Map(panels.map((pm) => [pm.name, pm]));
  const pairs = new Map<number, [number, number, number]>();
  spec.stitches.forEach((st: StitchSpec, si) => {
    const A = byName.get(st[0].panel);
    const B = byName.get(st[1].panel);
    if (!A || !B) return;
    const ea = A.edgeSamples[st[0].edge]!;
    const eb = B.edgeSamples[st[1].edge]!;
    const rightWrong = st[2] === 'right_wrong';
    const n = ea.length;
    for (let k = 0; k < n; k++) {
      const ga = A.offset + ea[k]!;
      const gb = B.offset + eb[rightWrong ? k : n - 1 - k]!;
      if (ga === gb) continue;
      const lo = Math.min(ga, gb);
      const hi = Math.max(ga, gb);
      const key = lo * offset + hi;
      if (!pairs.has(key)) pairs.set(key, [lo, hi, si]);
    }
  });
  const keys = [...pairs.keys()].sort((a, b) => a - b);
  const seams = new Uint32Array(keys.length * 2);
  const seamStitch = new Int32Array(keys.length);
  keys.forEach((k, i) => {
    const [a, b, s] = pairs.get(k)!;
    seams[i * 2] = a;
    seams[i * 2 + 1] = b;
    seamStitch[i] = s;
  });
  return { panels, seams, seamStitch, particles: offset, h };
}
