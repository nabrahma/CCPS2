/**
 * Generated card hair (PRD F5 route B, steps 3–7):
 *
 *   roots (scalp + mask) -> guide strands (flow, gravity, curl, bangs,
 *   ponytail, collision with the head proxy) -> cards swept along the guides
 *   (taper, twist aligned to the scalp normal, layers inner -> outer, atlas
 *   regions by tag) -> optional scalp shell -> binding to the body.
 *
 * Deterministic: the same style, atlas and body give the same mesh (see
 * hashHair). Card topology depends only on the style, never on the body.
 */
import { TriangleBVH } from '../mesh/bvh';
import type { BaseMesh } from '../mesh/basemesh';
import { Rng } from '../random';
import type { FittedSkeleton, RigDefinition } from '../skeleton/rig';
import type { SparseWeights } from '../skeleton/weights';
import { regionsFor, type AtlasRegion, type AtlasTag } from './atlas';
import { HairBinding } from './binding';
import { dominantBones, HeadProxy } from './headproxy';
import { Scalp, type HeadFrame, type ScalpRoot } from './scalp';
import { hairline, type HairStyleParams } from './style';

type Vec3 = [number, number, number];

export interface GeneratedHair {
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  /** Per vertex: 0 = shell / innermost layer .. 1 = outermost layer. */
  layer: Float32Array;
  /** Vertex indices of the card roots (two per card). */
  roots: Uint32Array;
  cards: number;
  shellTriangles: number;
  triangleCount: number;
  proxy: HeadProxy;
  binding: HairBinding;
}

const BIND_BONES = ['head', 'neck_01', 'spine_03', 'spine_02', 'clavicle_l', 'clavicle_r', 'upperarm_l', 'upperarm_r'];
const SKIN_BONES = ['head', 'neck_01'];

/** Cached per asset set: scalp, neutral head frame, binding surface, dominant bones. */
export class HairGenerator {
  readonly scalp: Scalp;
  private readonly dominant: { bone: Int16Array; weight: Float32Array };
  private readonly neutralFrame: HeadFrame;
  private readonly bindTriangles: Uint32Array;
  readonly skinBones: Set<number>;
  readonly headBone: number;

  constructor(
    private readonly base: BaseMesh,
    private readonly rig: RigDefinition,
    private readonly weights: SparseWeights,
  ) {
    this.dominant = dominantBones(weights);
    const scalp = scalpFaces(base, rig, this.dominant);
    this.scalp = new Scalp(base, scalp.faces);
    // Hairline masks and atlas mapping are measured in this frame on the neutral body.
    this.neutralFrame = scalp.frame;
    const bindBones = new Set(BIND_BONES.map((b) => rig.index.get(b)!).filter((b) => b !== undefined));
    const tris: number[] = [];
    for (const f of base.facesWhere((g) => g === 'body')) {
      const q = [0, 1, 2, 3].map((k) => base.faceVerts[f * 4 + k]!);
      if (!q.every((v) => bindBones.has(this.dominant.bone[v]!))) continue;
      tris.push(q[0]!, q[1]!, q[2]!);
      if (q[3] !== q[2]) tris.push(q[0]!, q[2]!, q[3]!);
    }
    tris.push(...this.scalp.triangles);
    this.bindTriangles = Uint32Array.from(tris);
    this.skinBones = new Set(SKIN_BONES.map((b) => rig.index.get(b)!));
    this.headBone = rig.index.get('head')!;
  }

  /** Triangles a style will produce: [cards, shell], after fitting the budget. */
  plan(style: HairStyleParams): { layerCounts: number[]; shellQuads: number[]; segments: number } {
    const shellQuads = style.shell.enabled ? this.maskedQuads(style) : [];
    const segments = style.ponytail.enabled ? Math.max(3, style.cards.segments) : style.cards.segments;
    const L = style.cards.layers;
    let counts = Array.from({ length: L }, (_, k) => Math.round(style.guides * (L === 1 ? 1 : 0.55 + (0.45 * k) / (L - 1))));
    const shellTris = shellQuads.length * 2;
    const perCard = segments * 2;
    const cardTris = counts.reduce((s, c) => s + c, 0) * perCard;
    const [min, max] = style.budget;
    if (cardTris > 0 && shellTris + cardTris > max) {
      const f = Math.max(0, (max - shellTris) / cardTris);
      counts = counts.map((c) => Math.floor(c * f));
    } else if (cardTris > 0 && shellTris + cardTris < min) {
      const f = (min - shellTris) / cardTris;
      counts = counts.map((c) => Math.ceil(c * f));
    }
    return { layerCounts: counts, shellQuads, segments };
  }

  /**
   * Generate the hair for a body. `positions` are current hm08 positions,
   * `skeleton` the skeleton fitted to them.
   */
  generate(style: HairStyleParams, atlas: readonly AtlasRegion[], positions: ArrayLike<number>, skeleton: FittedSkeleton): GeneratedHair {
    if (atlas.length === 0) throw new Error('hair atlas has no regions');
    const proxy = HeadProxy.fit(this.base, this.rig, skeleton, this.dominant, positions, this.scalp.vertices);
    const crane = proxy.cranium;
    const c = crane.centre;
    const { layerCounts, shellQuads, segments } = this.plan(style);
    const out = new MeshBuilder();
    const scalpBvh = new TriangleBVH(positions, this.scalp.triangles);

    // 1. Scalp shell (innermost, drawn first).
    if (shellQuads.length) this.buildShell(out, style, atlas, shellQuads, positions, proxy);
    const shellTriangles = out.indices.length / 3;

    // 2. Cards, layer by layer from the inside out.
    const L = layerCounts.length;
    let cards = 0;
    const roots: number[] = [];
    for (let k = 0; k < L; k++) {
      const layerT = L === 1 ? 1 : k / (L - 1);
      const sampled = this.scalp.sampleRoots(layerCounts[k]!, mix(style.seed, 7919 * (k + 1)), style.hairline, this.base.positions, this.neutralFrame);
      sampled.forEach((root, i) => {
        const rng = new Rng(mix(mix(style.seed, k + 1), i + 1));
        const guide = this.guide(style, root, layerT, positions, proxy, rng, segments);
        const tag = this.tagFor(style, root, k, L, rng);
        const regions = regionsFor(atlas, tag);
        const region = regions[Math.floor(rng.next() * regions.length)]!;
        roots.push(out.vertexCount, out.vertexCount + 1);
        this.sweep(out, style, guide, region, layerT, proxy, c, scalpBvh);
        cards++;
      });
    }
    const mesh = out.finish();
    const binding = new HairBinding(positions, this.bindTriangles, mesh.positions);
    return {
      ...mesh,
      roots: Uint32Array.from(roots),
      cards,
      shellTriangles,
      triangleCount: mesh.indices.length / 3,
      proxy,
      binding,
    };
  }

  /** Skin weights (head and neck only) per generated vertex. */
  skinWeights(hair: GeneratedHair): SparseWeights {
    return hair.binding.weights(this.weights, this.skinBones, this.headBone);
  }

  // ------------------------------------------------------------ internals

  private maskedQuads(style: HairStyleParams): number[] {
    const Q = this.scalp.quads;
    const P = this.base.positions;
    const out: number[] = [];
    for (let q = 0; q < Q.length / 4; q++) {
      const inside = [0, 1, 2, 3].every((k) => {
        const v = Q[q * 4 + k]!;
        const { theta, phi } = Scalp.angles([P[v * 3]!, P[v * 3 + 1]!, P[v * 3 + 2]!], this.neutralFrame);
        return theta <= Scalp.maskLimit(style.hairline, phi);
      });
      if (inside) out.push(q);
    }
    return out;
  }

  private tagFor(style: HairStyleParams, root: ScalpRoot, layer: number, layers: number, rng: Rng): AtlasTag {
    if (this.isBangs(style, root)) return 'fringe';
    if (layers === 1) return rng.next() < style.cards.flyaway ? 'flyaway' : 'clump';
    if (layer === 0) return 'base';
    if (layer === layers - 1) return rng.next() < style.cards.flyaway ? 'flyaway' : 'clump';
    return 'strand';
  }

  private isBangs(style: HairStyleParams, root: ScalpRoot): boolean {
    if (!style.bangs.enabled) return false;
    const halfWidth = (style.bangs.width * 70 * Math.PI) / 180;
    return Math.abs(root.phi) < halfWidth && root.theta > 0.45;
  }

  /** Strand length at a root: top, front, sides and back blended by the root's head-frame angles. */
  private lengthAt(style: HairStyleParams, root: ScalpRoot): number {
    const { front, sides, back, top } = style.length;
    const cos = Math.cos(root.phi);
    const wf = Math.max(0, cos) ** 2;
    const wb = Math.max(0, -cos) ** 2;
    const ws = Math.sin(root.phi) ** 2;
    const horizontal = (wf * front + wb * back + ws * sides) / (wf + wb + ws || 1);
    const wTop = smoothstep(0.8, 0.35, root.theta);
    return wTop * top + (1 - wTop) * horizontal;
  }

  private guide(style: HairStyleParams, root: ScalpRoot, layerT: number, P: ArrayLike<number>, proxy: HeadProxy, rng: Rng, segments: number): Vec3[] {
    const crane = proxy.cranium;
    const c = crane.centre;
    const r: Vec3 = [0, 0, 0];
    for (let k = 0; k < 3; k++) r[k] = root.wa * P[root.a * 3 + k]! + root.wb * P[root.b * 3 + k]! + root.wc * P[root.c * 3 + k]!;
    const n = triangleNormal(P, root.a, root.b, root.c);
    if (dot(n, sub(r, c)) < 0) scale(n, -1);
    const lift = 0.0015 + style.volume * 0.6 * layerT;
    const p0 = add(r, mul(n, lift));
    const pts: Vec3[] = [p0];
    const down: Vec3 = [0, -1, 0];

    if (style.ponytail.enabled && !this.isBangs(style, root)) {
      // Gather over the scalp to a tie point at the back of the head, then hang as a tail.
      const tie: Vec3 = [c[0], c[1] + (style.ponytail.height - 0.4) * crane.radii[1] * 1.6, c[2] - crane.radii[2]];
      proxy.pushOut(tie, 0.012);
      const n1 = Math.max(1, Math.round(segments * 0.45));
      const n2 = segments - n1;
      for (let i = 1; i <= n1; i++) {
        const q = lerp(p0, tie, i / n1);
        proxy.pushOut(q, 0.003 + lift);
        pts.push(q);
      }
      const spread: Vec3 = [rng.range(-1, 1) * 0.018, 0, rng.range(-1, 1) * 0.012];
      const len = style.ponytail.length * (1 + style.lengthJitter * rng.range(-0.3, 0.3));
      for (let j = 1; j <= n2; j++) {
        const u = j / n2;
        const q: Vec3 = [tie[0] + spread[0] * u, tie[1] - len * u, tie[2] + spread[2] * u - 0.03 * u * (1 - style.gravity)];
        proxy.pushOut(q, 0.004);
        pts.push(q);
      }
      return pts;
    }

    const bangs = this.isBangs(style, root);
    const length = (bangs ? style.bangs.length : this.lengthAt(style, root)) * (1 + style.lengthJitter * rng.range(-0.5, 0.5)) * (0.9 + 0.1 * layerT);
    // Flow: combed back and/or away from the part; bangs fall forward over the forehead.
    let flow: Vec3;
    if (bangs) {
      flow = [0, -0.45, 0.6];
    } else {
      const lateral: Vec3 = [0, 0, 0];
      if (style.part.side === 'none') {
        const h: Vec3 = [r[0] - c[0], 0, r[2] - c[2]];
        normalise(h);
        lateral[0] = h[0];
        lateral[2] = h[2];
      } else {
        const def = style.part.side === 'left' ? 0.35 : style.part.side === 'right' ? -0.35 : 0;
        const partX = c[0] + (style.part.position !== 0 ? style.part.position : def) * crane.radii[0];
        lateral[0] = r[0] >= partX ? 1 : -1;
      }
      flow = add(mul([0, 0, -1], style.flowBack), mul(lateral, 1 - style.flowBack));
    }
    let t = sub(flow, mul(n, dot(flow, n)));
    if (Math.hypot(...t) < 1e-6) t = sub(down, mul(n, dot(down, n)));
    normalise(t);
    const d = add(t, mul(n, 0.1 + style.volume * 10));
    normalise(d);
    // Small per-strand direction jitter.
    for (let k = 0; k < 3; k++) d[k] = d[k]! + rng.range(-0.08, 0.08);
    normalise(d);

    const ds = length / segments;
    let prev = p0;
    for (let i = 1; i <= segments; i++) {
      const bend = style.gravity * ds * 28;
      for (let k = 0; k < 3; k++) d[k] = d[k]! + down[k]! * bend;
      normalise(d);
      const q = add(prev, mul(d, ds));
      proxy.pushOut(q, 0.003 + lift * 0.5);
      const step = sub(q, prev);
      if (Math.hypot(...step) > 1e-9) {
        normalise(step);
        d[0] = step[0];
        d[1] = step[1];
        d[2] = step[2];
      }
      pts.push(q);
      prev = q;
    }
    // Curl: a helix around the strand, growing from the root.
    if (style.curl.amplitude > 0 && style.curl.frequency > 0) {
      const phase = rng.range(0, Math.PI * 2);
      let arc = 0;
      for (let i = 1; i < pts.length; i++) {
        arc += Math.hypot(...sub(pts[i]!, pts[i - 1]!));
        const tan = sub(pts[i]!, pts[i - 1]!);
        normalise(tan);
        const out = sub(pts[i]!, c);
        const b1 = cross(tan, out);
        normalise(b1);
        const b2 = cross(tan, b1);
        const a = style.curl.amplitude * Math.sqrt(i / (pts.length - 1));
        const w = Math.PI * 2 * style.curl.frequency * arc + phase;
        const q = add(pts[i]!, add(mul(b1, a * Math.sin(w)), mul(b2, a * Math.cos(w))));
        proxy.pushOut(q, 0.003);
        pts[i] = q;
      }
    }
    return pts;
  }

  private sweep(out: MeshBuilder, style: HairStyleParams, pts: Vec3[], region: AtlasRegion, layerT: number, proxy: HeadProxy, c: Vec3, scalp: TriangleBVH): void {
    // How far the strand's root floats above the scalp (its layer lift).
    const rootHit = scalp.closestPoint(pts[0]!);
    const rootLift = rootHit ? rootHit.distance : 0;
    const S = pts.length - 1;
    const first = out.vertexCount;
    for (let i = 0; i <= S; i++) {
      const s = i / S;
      const tan = i < S ? sub(pts[i + 1]!, pts[i]!) : sub(pts[i]!, pts[i - 1]!);
      normalise(tan);
      const outward = sub(pts[i]!, c);
      normalise(outward);
      // Twist aligned to the scalp: the card's width runs across the strand, tangent to the head.
      let side = cross(outward, tan);
      if (Math.hypot(...side) < 1e-6) side = [1, 0, 0];
      normalise(side);
      const w = Math.max(0.15, 1 - style.cards.taper * s) * style.cards.width * 0.5;
      const v = 1 - (region.y + region.h * s);
      for (const sgn of [-1, 1]) {
        let p = add(pts[i]!, mul(side, sgn * w));
        if (i === 0) {
          // Root corners sit on the scalp (at the strand's lift), not on the chord across it.
          const hit = scalp.closestPoint(p);
          if (hit) {
            const n = sub(hit.point, c);
            normalise(n);
            p = add(hit.point, mul(n, Math.max(0.001, rootLift)));
          }
        }
        proxy.pushOut(p, 0.001);
        out.vertex(p, [sgn < 0 ? region.x : region.x + region.w, v], layerT);
      }
    }
    for (let i = 0; i < S; i++) {
      const a = first + i * 2;
      out.triangle(a, a + 1, a + 3);
      out.triangle(a, a + 3, a + 2);
    }
  }

  private buildShell(out: MeshBuilder, style: HairStyleParams, atlas: readonly AtlasRegion[], quads: number[], P: ArrayLike<number>, proxy: HeadProxy): void {
    const Q = this.scalp.quads;
    const region = regionsFor(atlas, 'base')[0]!;
    const c = proxy.cranium.centre;
    // Smooth outward normals on the masked cap.
    const normals = new Map<number, Vec3>();
    for (const q of quads) {
      const v = [0, 1, 2, 3].map((k) => Q[q * 4 + k]!);
      const n = triangleNormal(P, v[0]!, v[1]!, v[2]!);
      const centre: Vec3 = [P[v[0]! * 3]!, P[v[0]! * 3 + 1]!, P[v[0]! * 3 + 2]!];
      if (dot(n, sub(centre, c)) < 0) scale(n, -1);
      for (const x of v) normals.set(x, add(normals.get(x) ?? [0, 0, 0], n));
    }
    const N = this.base.positions;
    for (const q of quads) {
      const v = [0, 1, 2, 3].map((k) => Q[q * 4 + k]!);
      const first = out.vertexCount;
      v.forEach((x) => {
        const n = normals.get(x)!;
        normalise(n);
        const p: Vec3 = [P[x * 3]! + n[0] * style.shell.offset, P[x * 3 + 1]! + n[1] * style.shell.offset, P[x * 3 + 2]! + n[2] * style.shell.offset];
        proxy.pushOut(p, 0.0005);
        // Mirrored azimuth (no seam at the back) and polar angle, both mapped into the dense middle of
        // the strip: atlases fade out at their edges, roots and tips.
        const ang = Scalp.angles([N[x * 3]!, N[x * 3 + 1]!, N[x * 3 + 2]!], this.neutralFrame);
        const u = region.x + region.w * (0.2 + 0.6 * (Math.abs(ang.phi) / Math.PI));
        const vv = 1 - (region.y + region.h * (0.3 + 0.4 * Math.min(1, ang.theta / 2.4)));
        out.vertex(p, [u, vv], 0);
      });
      out.triangle(first, first + 1, first + 2);
      if (v[3] !== v[2]) out.triangle(first, first + 2, first + 3);
    }
  }
}

/**
 * Scalp faces: body quads whose vertices all belong to the head bone and lie
 * inside the widest hairline preset ('low'), measured from the centre of the
 * neutral head. Each style's own mask then narrows this down.
 */
function scalpFaces(base: BaseMesh, rig: RigDefinition, dominant: { bone: Int16Array; weight: Float32Array }): { faces: number[]; frame: HeadFrame } {
  const head = rig.index.get('head');
  if (head === undefined) throw new Error('rig has no head bone');
  const P = base.positions;
  const isHead = (v: number) => dominant.bone[v] === head && dominant.weight[v]! >= 0.5;
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < base.bodyVertexCount; v++) {
    if (!isHead(v)) continue;
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k]!, P[v * 3 + k]!);
      hi[k] = Math.max(hi[k]!, P[v * 3 + k]!);
    }
  }
  // Centre of the cranium: middle of the head box in x and z, 60% of the way up (above the face).
  const frame: HeadFrame = { centre: [(lo[0]! + hi[0]!) / 2, lo[1]! + 0.6 * (hi[1]! - lo[1]!), (lo[2]! + hi[2]!) / 2 - 0.1 * (hi[2]! - lo[2]!)] };
  const widest = hairline('low');
  const inside = (v: number) => {
    const { theta, phi } = Scalp.angles([P[v * 3]!, P[v * 3 + 1]!, P[v * 3 + 2]!], frame);
    return theta <= Scalp.maskLimit(widest, phi);
  };
  const faces = base.facesWhere((g) => g === 'body').filter((f) => [0, 1, 2, 3].every((k) => {
    const v = base.faceVerts[f * 4 + k]!;
    return isHead(v) && inside(v);
  }));
  return { faces, frame };
}

/** FNV-1a hash of a generated mesh (positions quantised to 10 µm, UVs to 1e-6). */
export function hashHair(h: Pick<GeneratedHair, 'positions' | 'uvs' | 'indices'>): string {
  let x = 0x811c9dc5;
  const feed = (n: number) => {
    x ^= n & 0xff;
    x = Math.imul(x, 0x01000193);
    x ^= (n >>> 8) & 0xff;
    x = Math.imul(x, 0x01000193);
    x ^= (n >>> 16) & 0xff;
    x = Math.imul(x, 0x01000193);
    x ^= (n >>> 24) & 0xff;
    x = Math.imul(x, 0x01000193);
  };
  for (const p of h.positions) feed(Math.round(p * 1e5));
  for (const u of h.uvs) feed(Math.round(u * 1e6));
  for (const i of h.indices) feed(i);
  feed(h.indices.length);
  return (x >>> 0).toString(16).padStart(8, '0');
}

class MeshBuilder {
  private p: number[] = [];
  private uv: number[] = [];
  private l: number[] = [];
  indices: number[] = [];

  get vertexCount(): number {
    return this.p.length / 3;
  }

  vertex(p: Vec3, uv: [number, number], layer: number): void {
    this.p.push(p[0], p[1], p[2]);
    this.uv.push(uv[0], uv[1]);
    this.l.push(layer);
  }

  triangle(a: number, b: number, c: number): void {
    this.indices.push(a, b, c);
  }

  finish() {
    return {
      positions: Float32Array.from(this.p),
      uvs: Float32Array.from(this.uv),
      indices: Uint32Array.from(this.indices),
      layer: Float32Array.from(this.l),
    };
  }
}

function mix(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return h >>> 0;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function triangleNormal(P: ArrayLike<number>, a: number, b: number, c: number): Vec3 {
  const u: Vec3 = [P[b * 3]! - P[a * 3]!, P[b * 3 + 1]! - P[a * 3 + 1]!, P[b * 3 + 2]! - P[a * 3 + 2]!];
  const v: Vec3 = [P[c * 3]! - P[a * 3]!, P[c * 3 + 1]! - P[a * 3 + 1]!, P[c * 3 + 2]! - P[a * 3 + 2]!];
  const n = cross(u, v);
  normalise(n);
  return n;
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
function scale(a: Vec3, s: number): void {
  a[0] *= s;
  a[1] *= s;
  a[2] *= s;
}
function normalise(a: Vec3): void {
  const l = Math.hypot(a[0], a[1], a[2]);
  if (l > 1e-12) scale(a, 1 / l);
}
