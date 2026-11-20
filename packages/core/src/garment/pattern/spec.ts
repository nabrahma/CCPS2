/**
 * Pattern specifications: snapshots, edge geometry, validation (F29) and canonical bytes for hashing.
 *
 * Validation of a built pattern:
 * - every panel is one closed loop of edges over its vertex list;
 * - no panel self-intersects;
 * - sewing is manifold: every stitch names existing edges, no edge is stitched twice, and once the stitched
 *   edges are joined the free edges form closed boundary loops (hems and openings), never a dangling seam;
 * - every seam (a pair of interfaces) that is not a gather has sides whose lengths differ by at most 1%, or by
 *   at most 1 mm on short seams (a gather carries a ruffle coefficient or is gathered by a design parameter);
 * - every attached panel (pocket, flap, yoke) lies on its host panel.
 */
import { Sha256 } from '../../math/sha256';
import { acos, PI } from '../../math/dmath';
import { CubicBezier, QuadraticBezier, type P2 } from './num/curves';
import type { PatternSpec, PanelSpec } from './panel';
import type { StitchSide, StitchSpec } from './interface';
import { relToAbs2d } from './utils';

export type { PatternSpec, PanelSpec, StitchSpec, StitchSide };

/** A JSON copy of a spec (vertex and control-point arrays are live references until then). */
export function snapshot(spec: PatternSpec): PatternSpec {
  return JSON.parse(JSON.stringify(spec)) as PatternSpec;
}

/** Length of a panel edge from its spec (cm). */
export function edgeLength(panel: PanelSpec, edgeIndex: number): number {
  const e = panel.edges[edgeIndex]!;
  const a = panel.vertices[e.endpoints[0]!]!;
  const b = panel.vertices[e.endpoints[1]!]!;
  const chord = Math.sqrt((b[0]! - a[0]!) * (b[0]! - a[0]!) + (b[1]! - a[1]!) * (b[1]! - a[1]!));
  if (!e.curvature) return chord;
  if (e.curvature.type === 'circle') {
    const [rad, large] = e.curvature.params as [number, number, number];
    const half = Math.min(1, chord / (2 * rad));
    let ang = 2 * (PI / 2 - acos(half));
    if (large) ang = 2 * PI - ang;
    return rad * ang;
  }
  const cps = (e.curvature.params as number[][]).map((c) => relToAbs2d(a, b, c) as P2);
  const s: P2 = [a[0]!, a[1]!];
  const t: P2 = [b[0]!, b[1]!];
  return e.curvature.type === 'quadratic' ? new QuadraticBezier(s, cps[0]!, t).length() : new CubicBezier(s, cps[0]!, cps[1]!, t).length();
}

export interface PatternIssue {
  kind: 'open-loop' | 'self-intersection' | 'bad-stitch' | 'double-stitch' | 'dangling-seam' | 'length-mismatch' | 'loose-attachment';
  detail: string;
}

/**
 * Validate a built pattern. `gathered(stitchIndex)` says whether a stitch is an intended gather;
 * `selfIntersecting` is the panel test's result (Component.isSelfIntersecting).
 */
export interface AttachmentCheck {
  panel: string;
  host: string;
  edges: number[];
  points: number[][];
}

/** Point in polygon (even-odd), or within `tol` of its outline. */
function insideOutline(p: readonly number[], poly: readonly number[][], tol: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a[1]! > p[1]! !== b[1]! > p[1]! && p[0]! < ((b[0]! - a[0]!) * (p[1]! - a[1]!)) / (b[1]! - a[1]!) + a[0]!) inside = !inside;
  }
  if (inside) return true;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    const ex = b[0]! - a[0]!;
    const ey = b[1]! - a[1]!;
    const t = Math.max(0, Math.min(1, ((p[0]! - a[0]!) * ex + (p[1]! - a[1]!) * ey) / (ex * ex + ey * ey || 1)));
    const dx = a[0]! + t * ex - p[0]!;
    const dy = a[1]! + t * ey - p[1]!;
    if (dx * dx + dy * dy <= tol * tol) return true;
  }
  return false;
}

export function validatePattern(spec: PatternSpec, opts: { selfIntersecting: boolean; gathered: (i: number) => boolean; seam?: (i: number) => number; attachments?: AttachmentCheck[]; outline?: (panel: string) => number[][] }): PatternIssue[] {
  const issues: PatternIssue[] = [];
  for (const [name, p] of Object.entries(spec.panels)) {
    const n = p.edges.length;
    const used = new Set<number>();
    for (let i = 0; i < n; i++) {
      const e = p.edges[i]!;
      const next = p.edges[(i + 1) % n]!;
      for (const k of e.endpoints) {
        if (!(k >= 0 && k < p.vertices.length)) issues.push({ kind: 'open-loop', detail: `${name} edge ${i} has no vertex ${k}` });
        used.add(k);
      }
      if (e.endpoints[1] !== next.endpoints[0]) issues.push({ kind: 'open-loop', detail: `${name} edge ${i} does not meet edge ${(i + 1) % n}` });
    }
    if (used.size !== p.vertices.length) issues.push({ kind: 'open-loop', detail: `${name} has unused vertices` });
  }
  if (opts.selfIntersecting) issues.push({ kind: 'self-intersection', detail: 'a panel crosses itself' });
  // Stitch references, double use, lengths.
  const key = (s: StitchSide): string => `${s.panel}#${s.edge}`;
  const stitched = new Map<string, number>();
  spec.stitches.forEach((st, i) => {
    for (const side of [st[0], st[1]]) {
      const p = spec.panels[side.panel];
      if (!p || !(side.edge >= 0 && side.edge < p.edges.length)) {
        issues.push({ kind: 'bad-stitch', detail: `stitch ${i} names ${key(side)}` });
        continue;
      }
      if (stitched.has(key(side))) issues.push({ kind: 'double-stitch', detail: `${key(side)} in stitches ${stitched.get(key(side))} and ${i}` });
      stitched.set(key(side), i);
    }
  });
  // Seam lengths: each seam (a pair of interfaces, GarmentCode's StitchingRule) sewn edge for edge; the two sides
  // must agree within 1% unless the seam gathers.
  const seams = new Map<number, { a: number; b: number; gathered: boolean; first: number }>();
  spec.stitches.forEach((st, i) => {
    const pa = spec.panels[st[0].panel];
    const pb = spec.panels[st[1].panel];
    if (!pa || !pb || !(st[0].edge < pa.edges.length) || !(st[1].edge < pb.edges.length)) return;
    const id = opts.seam ? opts.seam(i) : i;
    const s = seams.get(id) ?? { a: 0, b: 0, gathered: false, first: i };
    s.a += edgeLength(pa, st[0].edge);
    s.b += edgeLength(pb, st[1].edge);
    s.gathered = s.gathered || opts.gathered(i);
    seams.set(id, s);
  });
  for (const s of seams.values()) {
    if (s.gathered) continue;
    const mismatch = Math.abs(s.a - s.b) / Math.max(1e-9, Math.min(s.a, s.b));
    const st = spec.stitches[s.first]!;
    // 1%, or 1 mm on short seams (below sewing precision).
    if (mismatch > 0.01 && Math.abs(s.a - s.b) > 0.1) issues.push({ kind: 'length-mismatch', detail: `seam from ${key(st[0])} to ${key(st[1])}: ${s.a.toFixed(2)} cm vs ${s.b.toFixed(2)} cm (${(mismatch * 100).toFixed(1)}%)` });
  }
  if (issues.some((x) => x.kind === 'bad-stitch')) return issues;
  // Join stitched edges the way GarmentCode's mesh builder does (its default connects edge 1's end to edge 2's
  // start, right side to right side; a 'right_wrong' stitch connects start to start) and check the free edges
  // form closed loops: every boundary vertex has an even number of free edges.
  const parent = new Map<string, string>();
  const find = (a: string): string => {
    let r = a;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
    let c = a;
    while (parent.has(c) && parent.get(c) !== r) {
      const nx = parent.get(c)!;
      parent.set(c, r);
      c = nx;
    }
    return r;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  const vid = (panel: string, v: number): string => `${panel}:${v}`;
  for (const st of spec.stitches) {
    const [a, b] = [st[0], st[1]];
    const ea = spec.panels[a.panel]!.edges[a.edge]!.endpoints;
    const eb = spec.panels[b.panel]!.edges[b.edge]!.endpoints;
    const swap = st[2] !== 'right_wrong';
    union(vid(a.panel, ea[0]!), vid(b.panel, swap ? eb[1]! : eb[0]!));
    union(vid(a.panel, ea[1]!), vid(b.panel, swap ? eb[0]! : eb[1]!));
  }
  const degree = new Map<string, number>();
  for (const [name, p] of Object.entries(spec.panels)) {
    p.edges.forEach((e, i) => {
      if (stitched.has(`${name}#${i}`)) return;
      for (const k of e.endpoints) {
        const r = find(vid(name, k));
        degree.set(r, (degree.get(r) ?? 0) + 1);
      }
    });
  }
  for (const [v, deg] of degree) if (deg % 2 !== 0) issues.push({ kind: 'dangling-seam', detail: `free edges end at ${v} (${deg} free edges meet there)` });
  // Attached panels (pockets, flaps, yokes) lie on their host: every attached end point inside the host outline.
  for (const a of opts.attachments ?? []) {
    const host = spec.panels[a.host];
    const p = spec.panels[a.panel];
    if (!host || !p || a.edges.some((e) => !(e >= 0 && e < p.edges.length))) {
      issues.push({ kind: 'loose-attachment', detail: `${a.panel} on ${a.host}: missing panel or edge` });
      continue;
    }
    const poly = opts.outline ? opts.outline(a.host) : host.vertices;
    const out = a.points.filter((q) => Math.abs(q[2] ?? 0) > 0.05 || !insideOutline(q, poly, 0.05));
    if (out.length) issues.push({ kind: 'loose-attachment', detail: `${a.panel} on ${a.host}: ${out.length} point(s) off the host, e.g. ${out[0]!.map((x) => x.toFixed(2)).join(', ')}` });
  }
  return issues;
}

/** Canonical bytes of a spec: keys sorted, numbers as JavaScript prints them (shortest round-trip). */
export function canonicalJSON(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .filter((k) => o[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJSON(o[k])}`)
      .join(',')}}`;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? (Object.is(value, -0) ? '0' : String(value)) : 'null';
  return JSON.stringify(value);
}

export function patternHash(spec: PatternSpec): string {
  return new Sha256().updateText(canonicalJSON(spec)).hex();
}
