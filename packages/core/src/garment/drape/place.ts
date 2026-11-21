/**
 * Initial placement of the panels around the body (F30). GarmentCode's programs place every panel flat
 * (rotation and translation, cm, y up from the floor, the front facing +z). Each panel goes to the body part
 * it is nearest to (torso, an arm, a leg, the head) and is wrapped around that part without stretching:
 * its points keep their height along the part's axis, and their distance across the panel becomes arc length
 * around an ellipse (torso, head) or a circle (limbs) 3 cm outside the part, centred where the panel faces.
 * Sleeves and trouser legs are so pre-wrapped around their limb, torso panels around the torso.
 */
import { atan2, cos, PI, sin, TAU } from '../../math/dmath';
import { edgeLength, type PanelSpec, type StitchSpec } from '../pattern/spec';
import { Rotation } from '../pattern/num/rotation';
import { SEG, type ShellBody } from '../shell/body';
import { landmarks } from '../shell/landmarks';
import type { PanelMesh } from './discretise';

type V3 = [number, number, number];

export interface WrapGroup {
  id: 'torso' | 'arm_l' | 'arm_r' | 'leg_l' | 'leg_r' | 'head';
  /** A point on the axis and its unit direction. */
  origin: V3;
  dir: V3;
  /** Ellipse axes (unit, perpendicular to dir) and semi-axes (m), the offset included. */
  e1: V3;
  e2: V3;
  a: number;
  b: number;
  /** Extent along the axis (m from origin), for choosing a panel's group. */
  lo: number;
  hi: number;
}

/** Distance the panels start outside the body. */
export const PLACE_OFFSET = 0.03;

const dot = (p: V3, q: V3) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
const sub = (p: V3, q: V3): V3 => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
const cross = (p: V3, q: V3): V3 => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
const scale = (p: V3, s: number): V3 => [p[0] * s, p[1] * s, p[2] * s];
const norm = (p: V3): V3 => {
  const l = Math.sqrt(dot(p, p)) || 1;
  return [p[0] / l, p[1] / l, p[2] / l];
};

/** Principal direction of a point set (power iteration on the covariance, fixed count). */
function principal(pts: V3[], c: V3, hint: V3): V3 {
  const C = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const p of pts) {
    const d = sub(p, c);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i * 3 + j] = C[i * 3 + j]! + d[i]! * d[j]!;
  }
  let v = norm(hint);
  for (let it = 0; it < 60; it++) {
    v = norm([C[0]! * v[0] + C[1]! * v[1] + C[2]! * v[2], C[3]! * v[0] + C[4]! * v[1] + C[5]! * v[2], C[6]! * v[0] + C[7]! * v[1] + C[8]! * v[2]]);
  }
  return dot(v, hint) < 0 ? scale(v, -1) : v;
}

/** The wrap groups of a body, from its parts. */
export function wrapGroups(body: ShellBody): WrapGroup[] {
  const P = body.positions;
  const parts = new Map<number, V3[]>();
  for (let i = 0; i < body.segment.length; i++) {
    const s = body.segment[i]!;
    let l = parts.get(s);
    if (!l) parts.set(s, (l = []));
    l.push([P[i * 3]!, P[i * 3 + 1]!, P[i * 3 + 2]!]);
  }
  const pts = (...segs: number[]) => segs.flatMap((s) => parts.get(s) ?? []);
  const centroid = (l: V3[]): V3 => {
    const c: V3 = [0, 0, 0];
    for (const p of l) for (let k = 0; k < 3; k++) c[k] = c[k]! + p[k]!;
    return scale(c, 1 / Math.max(1, l.length));
  };
  const out: WrapGroup[] = [];
  const vertical = (id: WrapGroup['id'], l: V3[], centreX: number | null, loFloor: boolean): WrapGroup => {
    const c = centroid(l);
    if (centreX !== null) c[0] = centreX;
    let a = 0;
    let b = 0;
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of l) {
      a = Math.max(a, Math.abs(p[0] - c[0]));
      b = Math.max(b, Math.abs(p[2] - c[2]));
      lo = Math.min(lo, p[1] - c[1]);
      hi = Math.max(hi, p[1] - c[1]);
    }
    if (loFloor) lo = body.ground - c[1];
    return { id, origin: c, dir: [0, 1, 0], e1: [1, 0, 0], e2: [0, 0, 1], a: a + PLACE_OFFSET, b: b + PLACE_OFFSET, lo, hi };
  };
  out.push(vertical('torso', pts(SEG.torso, SEG.pelvis), 0, true));
  out.push(vertical('head', pts(SEG.head, SEG.neck), 0, false));
  const limb = (id: WrapGroup['id'], segs: number[], hint: V3): WrapGroup => {
    const l = pts(...segs);
    const c = centroid(l);
    const d = principal(l, c, hint);
    // e1 horizontal-ish (perpendicular to d and z), e2 completing the frame.
    let e1 = cross(d, [0, 0, 1]);
    if (dot(e1, e1) < 1e-8) e1 = cross(d, [1, 0, 0]);
    e1 = norm(e1);
    const e2 = norm(cross(e1, d));
    let lo = Infinity;
    let hi = -Infinity;
    const rs: number[] = [];
    for (const p of l) {
      const q = sub(p, c);
      const al = dot(q, d);
      lo = Math.min(lo, al);
      hi = Math.max(hi, al);
      const perp = sub(q, scale(d, al));
      rs.push(Math.sqrt(dot(perp, perp)));
    }
    rs.sort((x, y) => x - y);
    // The 98th percentile: the deltoid's top and the knee's cap do not set the whole limb's size.
    const r = rs[Math.floor(rs.length * 0.98)] ?? 0;
    return { id, origin: c, dir: d, e1, e2, a: r + PLACE_OFFSET, b: r + PLACE_OFFSET, lo, hi };
  };
  out.push(limb('arm_l', [SEG.upperarm_l, SEG.lowerarm_l], [1, -1, 0]));
  out.push(limb('arm_r', [SEG.upperarm_r, SEG.lowerarm_r], [-1, -1, 0]));
  out.push(limb('leg_l', [SEG.thigh_l, SEG.calf_l], [0, -1, 0]));
  out.push(limb('leg_r', [SEG.thigh_r, SEG.calf_r], [0, -1, 0]));
  return out;
}

/** GarmentCode's coordinates (cm, y from the floor) to the body's (m). */
export function gcToBody(body: ShellBody, torso: WrapGroup, p: readonly number[]): V3 {
  return [p[0]! / 100, p[1]! / 100 + body.ground, p[2]! / 100 + torso.origin[2]];
}

/** Arc-length table of an ellipse (a cos φ, b sin φ) over [0, 2π). */
class EllipseArc {
  private readonly cum: Float64Array;
  readonly total: number;
  private static readonly M = 2048;

  constructor(
    readonly a: number,
    readonly b: number,
  ) {
    const M = EllipseArc.M;
    this.cum = new Float64Array(M + 1);
    let px = a;
    let py = 0;
    for (let i = 1; i <= M; i++) {
      const f = (i / M) * TAU;
      const x = a * cos(f);
      const y = b * sin(f);
      this.cum[i] = this.cum[i - 1]! + Math.sqrt((x - px) * (x - px) + (y - py) * (y - py));
      px = x;
      py = y;
    }
    this.total = this.cum[M]!;
  }

  arcAt(phi: number): number {
    const M = EllipseArc.M;
    let f = phi / TAU;
    f -= Math.floor(f);
    const u = f * M;
    const i = Math.min(M - 1, Math.floor(u));
    return this.cum[i]! + (this.cum[i + 1]! - this.cum[i]!) * (u - i);
  }

  phiAt(s: number): number {
    const M = EllipseArc.M;
    let r = s / this.total;
    r -= Math.floor(r);
    const target = r * this.total;
    let lo = 0;
    let hi = M;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid]! <= target) lo = mid;
      else hi = mid;
    }
    const seg = this.cum[lo + 1]! - this.cum[lo]!;
    const t = seg > 0 ? (target - this.cum[lo]!) / seg : 0;
    return ((lo + t) / M) * TAU;
  }
}

export interface Placement {
  /** Initial positions, 3 per particle (m). */
  positions: Float64Array;
  /** Group of each panel. */
  groups: WrapGroup['id'][];
  /** Vertical shift applied to GarmentCode's layout (m). */
  shiftY: number;
  /** The garment hangs from the shoulders (a top, a dress); otherwise from the waist. */
  upper: boolean;
  /** Per panel, the panel it is laid against (null: placed by its own layout). */
  hosted: (string | null)[];
}

/** A panel's points (pattern cm) placed by its own rotation and translation (GarmentCode cm). */
export function panelTo3D(panel: PanelSpec, pts: Float64Array): Float64Array {
  const r = Rotation.fromEuler('XYZ', panel.rotation, true);
  const n = pts.length / 2;
  const out = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = r.apply([pts[i * 2]!, pts[i * 2 + 1]!, 0]);
    out[i * 3] = v[0] + panel.translation[0]!;
    out[i * 3 + 1] = v[1] + panel.translation[1]!;
    out[i * 3 + 2] = v[2] + panel.translation[2]!;
  }
  return out;
}

/** The panel's outward normal in GarmentCode's frame. */
export function panelNormal(panel: PanelSpec, clockwise: boolean): V3 {
  const r = Rotation.fromEuler('XYZ', panel.rotation, true);
  const v = r.apply([0, 0, clockwise ? -1 : 1]);
  return [v[0], v[1], v[2]];
}

function axisDistance2D(g: WrapGroup, p: V3): number {
  // In the frontal plane (GarmentCode's panels sit well in front of or behind the body).
  const q: V3 = [p[0] - g.origin[0], p[1] - g.origin[1], 0];
  const d: V3 = [g.dir[0], g.dir[1], 0];
  const dl = Math.sqrt(dot(d, d));
  if (dl < 1e-6) return Math.sqrt(dot(q, q));
  const u = scale(d, 1 / dl);
  let al = dot(q, u);
  const lo = g.lo * dl;
  const hi = g.hi * dl;
  al = Math.max(lo, Math.min(hi, al));
  const e = sub(q, scale(u, al));
  return Math.sqrt(dot(e, e));
}

/** A small panel sewn to a bigger one: laid against its host across their longest seam. */
interface HostLink {
  host: number;
  /** Rigid map of the panel's pattern points into the host's pattern plane: p' = R p + t (optionally mirrored). */
  cos: number;
  sin: number;
  tx: number;
  ty: number;
  mirror: boolean;
}

/**
 * Place every panel (its pattern points, cm) around the body. Small panels (bands, cuffs, collars, plackets,
 * lapels) are laid against their host across their longest seam, as if the pattern were unfolded there,
 * and go wherever the host goes: GarmentCode's own layout often leaves them far from where they are sewn.
 */
export function placePanels(body: ShellBody, panels: { spec: PanelSpec; mesh: PanelMesh }[], stitches: readonly StitchSpec[] = [], groups = wrapGroups(body)): Placement {
  const torso = groups.find((g) => g.id === 'torso')!;
  const index = new Map(panels.map((p, i) => [p.mesh.name, i]));
  const hosts: (HostLink | null)[] = findHosts(panels, stitches, index);
  const gcFlat = (pi: number, pts: Float64Array): Float64Array => {
    const gc = panelTo3D(panels[pi]!.spec, pts);
    const n = pts.length / 2;
    const p = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) {
      const q = gcToBody(body, torso, [gc[i * 3]!, gc[i * 3 + 1]!, gc[i * 3 + 2]!]);
      p[i * 3] = q[0];
      p[i * 3 + 1] = q[1];
      p[i * 3 + 2] = q[2];
    }
    return p;
  };
  const flat = panels.map(({ mesh }, pi) => gcFlat(pi, mesh.points));
  // Nearest group by the panel's centroid (hosted panels go with their host).
  // Before anchoring, GarmentCode's heights are within a few centimetres of the body's (its tops sit a little
  // low): enough to tell a top's panels from trousers'.
  const bustY = landmarks(body).bustY;
  const shiftGuess = 0.05;
  const own = flat.map((p) => {
    const n = p.length / 3;
    const c: V3 = [0, 0, 0];
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) c[k] = c[k]! + p[i * 3 + k]! / n;
    let best = 0;
    let bd = Infinity;
    // A panel reaching above the bust (a coat's front) is not a leg's, however low it hangs.
    let topY = -Infinity;
    for (let i = 1; i < p.length; i += 3) topY = Math.max(topY, p[i]!);
    const reachesChest = topY + shiftGuess > bustY;
    groups.forEach((g, gi) => {
      if (reachesChest && (g.id === 'leg_l' || g.id === 'leg_r')) return;
      const d = axisDistance2D(g, c);
      if (d < bd - 1e-9) {
        bd = d;
        best = gi;
      }
    });
    return best;
  });
  const rootOf = (pi: number): number => {
    let r = pi;
    for (let guard = 0; hosts[r] && guard < panels.length; guard++) r = hosts[r]!.host;
    return r;
  };
  // A band sewn to panels round both legs (or both arms), a waistband, goes round the torso (not a trouser
  // leg's own panel, sewn to the other leg at the crotch).
  const largest = panels.reduce((m, p) => Math.max(m, p.mesh.area), 0);
  const torsoIndex = groups.findIndex((g) => g.id === 'torso');
  const partners = panels.map(() => new Set<number>());
  for (const st of stitches) {
    const a = index.get(st[0].panel);
    const b = index.get(st[1].panel);
    if (a === undefined || b === undefined || a === b) continue;
    partners[a]!.add(b);
    partners[b]!.add(a);
  }
  const spans = (pi: number) => {
    const ids = new Set([...partners[pi]!].map((q) => groups[own[q]!]!.id));
    return (ids.has('leg_l') && ids.has('leg_r')) || (ids.has('arm_l') && ids.has('arm_r'));
  };
  panels.forEach((_, pi) => {
    if (panels[pi]!.mesh.area < 0.3 * largest && spans(pi)) {
      own[pi] = torsoIndex;
      hosts[pi] = null;
    }
  });
  const choice = panels.map((_, pi) => own[rootOf(pi)]!);
  // Anchor the garment on the body: GarmentCode lays panels out for its own simulator (the bodice's top a few
  // centimetres under the shoulders) and lets the sewing pull them up. Here the top of a top sits at the side
  // neck point, the top of trousers and skirts at the waist. The top is that of the main panels (not of a
  // lapel or collar standing above them).
  const lm = landmarks(body);
  const main = (pi: number) => !hosts[pi] && groups[choice[pi]!]!.id !== 'head' && groups[choice[pi]!]!.id !== 'arm_l' && groups[choice[pi]!]!.id !== 'arm_r';
  const isUpper = panels.some((_, pi) => {
    const g = groups[choice[pi]!]!.id;
    if (g === 'arm_l' || g === 'arm_r') return true;
    if (!main(pi)) return false;
    const p = flat[pi]!;
    for (let i = 1; i < p.length; i += 3) if (p[i]! > lm.bustY) return true;
    return false;
  });
  let bigArea = 0;
  panels.forEach((p, pi) => {
    if (main(pi)) bigArea = Math.max(bigArea, p.mesh.area);
  });
  let top = -Infinity;
  panels.forEach((pm, pi) => {
    if (!main(pi) || pm.mesh.area < 0.25 * bigArea) return;
    const p = flat[pi]!;
    for (let i = 1; i < p.length; i += 3) top = Math.max(top, p[i]!);
  });
  const anchor = isUpper ? lm.neck.base(PI / 2) + 0.01 : lm.waistY + 0.01;
  const shiftY = Number.isFinite(top) ? anchor - top : 0;
  const shift = (p: Float64Array) => {
    for (let i = 1; i < p.length; i += 3) p[i] = p[i]! + shiftY;
    return p;
  };
  for (const p of flat) shift(p);
  // A panel lying across its part's axis (a lapel's collar ring around the neck) keeps its flat placement.
  const keepFlat = panels.map(({ spec, mesh }, pi) => !hosts[pi] && Math.abs(dot(panelNormal(spec, mesh.clockwise), groups[choice[pi]!]!.dir)) > 0.7);
  // Each group's ellipse grows until its wrapped panels at any height along its axis fit without
  // overlapping (with 5% to spare): widths add up only where panels share a stretch of the axis.
  const BIN = 0.02;
  const binWidths = new Map<number, Map<number, number>>();
  const frames = panels.map(({ spec, mesh }, pi) => {
    const gi = choice[pi]!;
    const g = groups[gi]!;
    const n0 = panelNormal(spec, mesh.clockwise);
    let nPerp = sub(n0, scale(g.dir, dot(n0, g.dir)));
    if (dot(nPerp, nPerp) < 1e-8) nPerp = g.e2;
    nPerp = norm(nPerp);
    const t = norm(cross(g.dir, nPerp));
    if (hosts[pi] || keepFlat[pi]) return { g, gi, nPerp, t };
    const p = flat[pi]!;
    const range = new Map<number, [number, number]>();
    for (let i = 0; i < p.length / 3; i++) {
      const q = sub([p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!], g.origin);
      const s = dot(q, t);
      const bin = Math.floor(dot(q, g.dir) / BIN);
      const r = range.get(bin);
      if (r) {
        r[0] = Math.min(r[0], s);
        r[1] = Math.max(r[1], s);
      } else range.set(bin, [s, s]);
    }
    let bw = binWidths.get(gi);
    if (!bw) binWidths.set(gi, (bw = new Map()));
    for (const [bin, r] of range) bw.set(bin, (bw.get(bin) ?? 0) + (r[1] - r[0]));
    return { g, gi, nPerp, t };
  });
  const arcs = new Map<number, { arc: EllipseArc; k: number }>();
  groups.forEach((g, gi) => {
    let arc = new EllipseArc(g.a, g.b);
    let need = 0;
    for (const w of binWidths.get(gi)?.values() ?? []) need = Math.max(need, w * 1.05);
    let k = 1;
    if (need > arc.total) {
      k = need / arc.total;
      arc = new EllipseArc(g.a * k, g.b * k);
    }
    arcs.set(gi, { arc, k });
  });

  /** Pattern points of panel pi (cm) to the body, by that panel's own placement. */
  const mapPoints = (pi: number, pts: Float64Array, depth = 0): Float64Array => {
    const link = hosts[pi];
    if (link && depth < panels.length) {
      const q = new Float64Array(pts.length);
      for (let i = 0; i < pts.length / 2; i++) {
        const x = pts[i * 2]!;
        const y = link.mirror ? -pts[i * 2 + 1]! : pts[i * 2 + 1]!;
        q[i * 2] = link.cos * x - link.sin * y + link.tx;
        q[i * 2 + 1] = link.sin * x + link.cos * y + link.ty;
      }
      return mapPoints(link.host, q, depth + 1);
    }
    const p = shift(gcFlat(pi, pts));
    if (keepFlat[pi]) return p;
    const { g, gi, nPerp, t } = frames[pi]!;
    const { arc, k } = arcs.get(gi)!;
    const A = g.a * k;
    const B = g.b * k;
    // Where the panel faces on the ellipse, and which way arc length runs there.
    const n1 = dot(nPerp, g.e1);
    const n2 = dot(nPerp, g.e2);
    const phi0 = atan2(A * n2, B * n1);
    const tang: V3 = [-A * sin(phi0) * g.e1[0] + B * cos(phi0) * g.e2[0], -A * sin(phi0) * g.e1[1] + B * cos(phi0) * g.e2[1], -A * sin(phi0) * g.e1[2] + B * cos(phi0) * g.e2[2]];
    const sign = dot(tang, t) >= 0 ? 1 : -1;
    const s0 = arc.arcAt(phi0);
    const out = new Float64Array(p.length);
    for (let i = 0; i < p.length / 3; i++) {
      const q = sub([p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!], g.origin);
      const along = dot(q, g.dir);
      const s = dot(q, t);
      const phi = arc.phiAt(s0 + sign * s);
      const ca = A * cos(phi);
      const sb = B * sin(phi);
      for (let c = 0; c < 3; c++) out[i * 3 + c] = g.origin[c]! + g.dir[c]! * along + g.e1[c]! * ca + g.e2[c]! * sb;
    }
    return out;
  };

  const total = panels.reduce((s, x) => s + x.mesh.points.length / 2, 0);
  const positions = new Float64Array(total * 3);
  let o = 0;
  panels.forEach(({ mesh }, pi) => {
    positions.set(mapPoints(pi, mesh.points), o * 3);
    o += mesh.points.length / 2;
  });
  return { positions, groups: choice.map((gi) => groups[gi]!.id), shiftY, upper: isUpper, hosted: hosts.map((h) => (h ? panels[h.host]!.mesh.name : null)) };
}

/**
 * Hosts of the small panels: a panel under 30% of the area of the panel it shares the most seam length with
 * (and smaller than it) is laid against it, across their longest stitch.
 */
function findHosts(panels: { spec: PanelSpec; mesh: PanelMesh }[], stitches: readonly StitchSpec[], index: Map<string, number>): (HostLink | null)[] {
  const shared = panels.map(() => new Map<number, number>());
  const longest = panels.map(() => new Map<number, { len: number; mine: number; theirs: number; rw: boolean }>());
  for (const st of stitches) {
    const a = index.get(st[0].panel);
    const b = index.get(st[1].panel);
    if (a === undefined || b === undefined || a === b) continue;
    const la = edgeLength(panels[a]!.spec, st[0].edge);
    const lb = edgeLength(panels[b]!.spec, st[1].edge);
    const rw = st[2] === 'right_wrong';
    for (const [p, q, mine, theirs, len] of [
      [a, b, st[0].edge, st[1].edge, la],
      [b, a, st[1].edge, st[0].edge, lb],
    ] as const) {
      shared[p]!.set(q, (shared[p]!.get(q) ?? 0) + len);
      const cur = longest[p]!.get(q);
      if (!cur || len > cur.len + 1e-9) longest[p]!.set(q, { len, mine, theirs, rw });
    }
  }
  return panels.map((pm, pi) => {
    let best = -1;
    let bl = 0;
    for (const [q, len] of shared[pi]!) {
      if (panels[q]!.mesh.area <= pm.mesh.area) continue;
      if (len > bl + 1e-9 || (Math.abs(len - bl) <= 1e-9 && q < best)) {
        bl = len;
        best = q;
      }
    }
    // A band sewn round several panels (a waistband on four trouser panels) is not laid against one of them.
    let total = 0;
    for (const len of shared[pi]!.values()) total += len;
    if (best < 0 || pm.mesh.area >= 0.3 * panels[best]!.mesh.area || bl < 0.4 * total) return null;
    const e = longest[pi]!.get(best)!;
    const P = pm.spec;
    const H = panels[best]!.spec;
    const pv = (sp: PanelSpec, edge: number, end: number) => sp.vertices[sp.edges[edge]!.endpoints[end]!]!;
    const a0 = pv(P, e.mine, 0);
    const a1 = pv(P, e.mine, 1);
    // GarmentCode's orientation: this edge's start meets the host edge's end (start for right_wrong).
    const t0 = pv(H, e.theirs, e.rw ? 0 : 1);
    const t1 = pv(H, e.theirs, e.rw ? 1 : 0);
    const solve = (mirror: boolean): HostLink => {
      const ax = a0[0]!;
      const ay = mirror ? -a0[1]! : a0[1]!;
      const bx = a1[0]!;
      const by = mirror ? -a1[1]! : a1[1]!;
      const ang = atan2(t1[1]! - t0[1]!, t1[0]! - t0[0]!) - atan2(by - ay, bx - ax);
      const c = cos(ang);
      const s = sin(ang);
      return { host: best, cos: c, sin: s, tx: t0[0]! - (c * ax - s * ay), ty: t0[1]! - (s * ax + c * ay), mirror };
    };
    // The panel goes on the far side of the seam from the host's middle (unfolded); mirrored if it must.
    const side = (l: HostLink): number => {
      let cx = 0;
      let cy = 0;
      const n = pm.mesh.points.length / 2;
      for (let i = 0; i < n; i++) {
        const x = pm.mesh.points[i * 2]!;
        const y = l.mirror ? -pm.mesh.points[i * 2 + 1]! : pm.mesh.points[i * 2 + 1]!;
        cx += (l.cos * x - l.sin * y + l.tx) / n;
        cy += (l.sin * x + l.cos * y + l.ty) / n;
      }
      const hm = panels[best]!.mesh;
      let hx = 0;
      let hy = 0;
      const m = hm.points.length / 2;
      for (let i = 0; i < m; i++) {
        hx += hm.points[i * 2]! / m;
        hy += hm.points[i * 2 + 1]! / m;
      }
      const ex = t1[0]! - t0[0]!;
      const ey = t1[1]! - t0[1]!;
      return (ex * (cy - t0[1]!) - ey * (cx - t0[0]!)) * (ex * (hy - t0[1]!) - ey * (hx - t0[0]!));
    };
    // Every stitch between the two: how far apart its ends land (an insert sewn into a slit along both sides
    // fits one way only).
    const misfit = (l: HostLink): number => {
      let d = 0;
      for (const st of stitches) {
        const mine = st[0].panel === pm.mesh.name && st[1].panel === panels[best]!.mesh.name ? 0 : st[1].panel === pm.mesh.name && st[0].panel === panels[best]!.mesh.name ? 1 : -1;
        if (mine < 0) continue;
        const sides = [st[0], st[1]] as const;
        const me = sides[mine as 0 | 1]!.edge;
        const them = sides[(1 - mine) as 0 | 1]!.edge;
        const rw = st[2] === 'right_wrong';
        for (let end = 0; end < 2; end++) {
          const a = pv(P, me, end);
          const ax = a[0]!;
          const ay = l.mirror ? -a[1]! : a[1]!;
          const x = l.cos * ax - l.sin * ay + l.tx;
          const y = l.sin * ax + l.cos * ay + l.ty;
          const t = pv(H, them, rw ? end : 1 - end);
          d += Math.sqrt((x - t[0]!) * (x - t[0]!) + (y - t[1]!) * (y - t[1]!));
        }
      }
      return d;
    };
    const plain = solve(false);
    const mirrored = solve(true);
    const mp = misfit(plain);
    const mm = misfit(mirrored);
    if (Math.abs(mp - mm) > 0.5) return mp < mm ? plain : mirrored;
    return side(plain) <= 0 ? plain : mirrored;
  });
}
