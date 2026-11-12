/**
 * Generated card hair (PRD F5 route B). The pipeline follows Daniel Bystedt's
 * "Hair cards from curves" Blender setup (docs/hair-system.md):
 *
 *   scalp + hairline mask
 *   -> a few GUIDE curves that carry the style (flow, gravity, parting, curl,
 *      bangs, ponytail, collision with the head proxy)
 *   -> a curve per card, INTERPOLATED from the guides around its root, then
 *      clumped onto its nearest guide, frizzed and trimmed to its own length
 *   -> Hair v2 (PRD F15): locks, wide bowed ribbons that make the hair's
 *      mass, from their own well-spread roots
 *   -> one card per curve (cards-from-curves.ts), layer by layer from the
 *      inside out, with atlas regions by tag
 *   -> optional scalp shell -> binding to the body.
 *
 * Guides come from the style's sliders, or from a groom combed in Hair Studio
 * (style.groom.curves), stored on the neutral head and scaled to this one.
 *
 * Card mode (D-114): when the style carries hand-placed cards
 * (style.groom.cards), they replace the locks and cards made from the guides,
 * one card per curve, exactly as the artist placed them.
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
import { cardFromCurve, type HairSurface } from './cards-from-curves';
import { arcLengths, closestOnPolyline, curveLength, pointAt, resample, shapeRange, trim } from './curves';
import { dominantBones, HeadProxy } from './headproxy';
import { paintCoverage } from './hairline-paint';
import { Scalp, type HeadFrame, type ScalpRoot } from './scalp';
import { hairline, type AuthoredCard, type AuthoredGuide, type HairStyleParams } from './style';

type Vec3 = [number, number, number];

export interface GeneratedHair {
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  /** Per vertex: 0 = shell / innermost layer .. 1 = outermost layer. */
  layer: Float32Array;
  /** Per vertex: which of the three layers it belongs to (HAIR_LAYER_SHELL, _LOCK, _CARD). */
  hairLayer: Uint8Array;
  /** Vertex indices of the card roots (two per card). */
  roots: Uint32Array;
  cards: number;
  locks: number;
  shellTriangles: number;
  lockTriangles: number;
  triangleCount: number;
  proxy: HeadProxy;
  binding: HairBinding;
  /** Guide curves the cards were interpolated from (for review, tests and Hair Studio). */
  guideCurves: Vec3[][];
  /** Where each guide grows, on the neutral scalp (Hair Studio turns guides into an authored groom with these). */
  guideRoots: ScalpRoot[];
  /**
   * Every lock and card as its curve and settings, on this body: what Hair Studio's card mode edits.
   * In card mode it lists all the style's hand-placed cards, the ones the budget left out included.
   */
  cardCurves: CardCurve[];
  /** The parting line on the scalp, when the style has one. */
  parting: Vec3[] | null;
  /** Axis of the hair's volume for shading normals: from the middle of the skull straight down. */
  volumeAxis: { top: Vec3; length: number };
}

/** One lock or card as its curve (world space, on the current body) and its settings: see AuthoredCard. */
export interface CardCurve {
  root: ScalpRoot;
  points: Vec3[];
  kind: 'lock' | 'card';
  /** Width at the root, metres on this body. */
  width: number;
  tag: AtlasTag;
  /** Index among the atlas's regions with this tag (wraps). */
  region: number;
  flip: boolean;
  /** Twist from root to tip, half turns. */
  twist: number;
  layer: number;
  random: number;
  /** Card mode: the profile's budget left this card out of the mesh. */
  culled?: boolean;
}

/** Points per guide curve. */
export const GUIDE_POINTS = 12;

/** Values of GeneratedHair.hairLayer. */
export const HAIR_LAYER_SHELL = 0;
export const HAIR_LAYER_LOCK = 1;
export const HAIR_LAYER_CARD = 2;
/** The per-vertex `layer` value of locks: above the shell and the innermost cards, below the outer ones. */
const LOCK_LAYER = 0.2;
/** Lock sections crowd towards the root, where the hair bends over the skull. */
const LOCK_ROOT_BIAS = 1.7;
/** Most a hair may be stretched past its guides to reach its own length. */
const MAX_STRETCH = 1.35;

interface Guide {
  /** Root on the neutral body (what "nearest guide" is measured on, so it never depends on the body). */
  neutral: Vec3;
  /** The root's angles on the neutral head: from the crown, and around it. */
  theta: number;
  phi: number;
  /** Hairs only follow guides of their own group: one per side of the parting, and one for the fringe. */
  group: number;
  /** The length the style asks for at this root. */
  nominal: number;
  points: Vec3[];
  arcs: number[];
  root: ScalpRoot;
  /** Lock tool settings of an authored guide (1 and 0 otherwise). */
  lockWidth: number;
  lockCurl: number;
}

/** Where the head is and how big, from its scalp: authored grooms and partings are scaled with it. */
interface HeadBox {
  centre: Vec3;
  extent: Vec3;
}

interface PlannedCard {
  root: ScalpRoot;
  segments: number;
}

/** Hand-placed cards as planned: kept ones in drawing order, every card's segments, and the ones left out. */
interface PlacedPlan {
  order: number[];
  segments: number[];
  culled: number[];
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
  /** Half the scalp's width on the neutral body. */
  private readonly neutralHalfWidth: number;
  /** Scalp vertices on the outer edge of the scalp region, where the shell must have faded out. */
  private readonly scalpBorder = new Set<number>();
  /** The scalp's box on the neutral body. */
  private readonly neutralBox: HeadBox;
  /** The head proxy of the body being generated. */
  private lastProxy: HeadProxy | null = null;

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
    let half = 0;
    for (const v of this.scalp.vertices) half = Math.max(half, Math.abs(base.positions[v * 3]! - this.neutralFrame.centre[0]));
    this.neutralHalfWidth = half;
    this.neutralBox = this.headBox(base.positions);
    // An edge with a single quad is on the rim of the region.
    const edges = new Map<string, number>();
    const Q = this.scalp.quads;
    const corners = (q: number) => [0, 1, 2, 3].map((k) => Q[q * 4 + k]!).filter((v, k, all) => all.indexOf(v) === k);
    for (let q = 0; q < Q.length / 4; q++) {
      const c = corners(q);
      c.forEach((a, k) => {
        const b = c[(k + 1) % c.length]!;
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      });
    }
    for (const [key, count] of edges) if (count === 1) for (const v of key.split(':')) this.scalpBorder.add(Number(v));
  }

  /**
   * The cards a style will produce, layer by layer, fitted to its triangle
   * budget. Only the style and the neutral body go in, so the result (and with
   * it the mesh topology) is the same on every body.
   */
  plan(style: HairStyleParams): {
    layers: PlannedCard[][];
    layerCounts: number[];
    shellQuads: number[];
    segments: number;
    locks: PlannedCard[];
    /** Card mode: the hand-placed cards that fit the budget, in drawing order, with their segments. */
    placed: PlacedPlan | null;
  } {
    const shellQuads = style.shell.enabled ? this.maskedQuads(style) : [];
    if (style.groom.cards?.length) {
      const placed = this.planPlaced(style, style.groom.cards, Math.max(0, style.budget[1] - shellQuads.length * 2));
      return { layers: [], layerCounts: [], shellQuads, segments: style.cards.segments, locks: [], placed };
    }
    const L = style.cards.layers;
    let counts = Array.from({ length: L }, (_, k) => Math.round(style.guides * (L === 1 ? 1 : 0.55 + (0.45 * k) / (L - 1))));
    const [min, max] = style.budget;
    // Locks first, inside their share of what the shell leaves; the cards fill the rest.
    const locks = this.planLocks(style, Math.max(0, max - shellQuads.length * 2) * style.locks.share);
    const lockTris = locks.reduce((n, c) => n + c.segments * style.locks.columns * 2, 0);
    const shellTris = shellQuads.length * 2 + lockTris;
    const sample = () =>
      counts.map((count, k) =>
        this.scalp
          .sampleRoots(count, mix(style.seed, 7919 * (k + 1)), style.hairline, this.base.positions, this.neutralFrame)
          .map((root) => ({ root, segments: this.segmentsFor(style, root) })),
      );
    const triangles = (layers: PlannedCard[][]) => layers.reduce((n, cards) => n + cards.reduce((m, c) => m + c.segments * 2, 0), 0);
    let layers = sample();
    for (let pass = 0; pass < 4; pass++) {
      const cardTris = triangles(layers);
      if (cardTris === 0 || (shellTris + cardTris <= max && shellTris + cardTris >= min)) break;
      const want = shellTris + cardTris > max ? max - shellTris : min - shellTris;
      const f = Math.max(0, want / cardTris);
      counts = counts.map((c) => (f < 1 ? Math.floor(c * f) : Math.ceil(c * f)));
      layers = sample();
    }
    // Rounding can leave a few triangles too many: drop cards from the outside in.
    for (let k = layers.length - 1; shellTris + triangles(layers) > max && layers.some((l) => l.length > 0); k = (k - 1 + layers.length) % layers.length) {
      layers[k]!.pop();
    }
    return { layers, layerCounts: layers.map((l) => l.length), shellQuads, segments: style.cards.segments, locks, placed: null };
  }

  /**
   * Hand-placed cards in drawing order (locks first, then cards from the inside out) and their
   * segments, from their lengths on the neutral head. When they need more than `room`
   * triangles (a smaller profile), detail cards are left out evenly over the head, then locks.
   */
  private planPlaced(style: HairStyleParams, cards: readonly AuthoredCard[], room: number): PlacedPlan {
    const C = Math.max(1, style.locks.columns);
    const segments = cards.map((c) => this.segmentsForLength(style, offsetsLength(c.points)));
    const tris = (i: number) => segments[i]! * (cards[i]!.kind === 'lock' ? C : 1) * 2;
    const order = cards.map((_, i) => i);
    const locks = order.filter((i) => cards[i]!.kind === 'lock');
    const detail = order.filter((i) => cards[i]!.kind !== 'lock').sort((a, b) => cards[a]!.layer - cards[b]!.layer || a - b);
    const kept = new Set(order);
    let total = order.reduce((n, i) => n + tris(i), 0);
    if (total > room) {
      const byHash = (list: number[]) => [...list].sort((a, b) => mix(style.seed, a + 1) - mix(style.seed, b + 1));
      for (const i of [...byHash(detail), ...byHash(locks)]) {
        if (total <= room) break;
        kept.delete(i);
        total -= tris(i);
      }
    }
    return { order: [...locks, ...detail].filter((i) => kept.has(i)), segments, culled: order.filter((i) => !kept.has(i)) };
  }

  /** Lock roots (well spread over the scalp) and their segments, as many as fit in `room` triangles. */
  private planLocks(style: HairStyleParams, room: number): PlannedCard[] {
    if (!style.locks.enabled || style.locks.count <= 0) return [];
    const C = style.locks.columns;
    const sample = (n: number) =>
      this.scalp
        .sampleRoots(n, mix(style.seed, 0x10c4f3a1), style.hairline, this.base.positions, this.neutralFrame)
        .map((root) => ({ root, segments: this.segmentsFor(style, root) }));
    const tris = (l: PlannedCard[]) => l.reduce((n, c) => n + c.segments * C * 2, 0);
    let count = style.locks.count;
    let locks = sample(count);
    for (let pass = 0; pass < 4 && tris(locks) > room && locks.length > 0; pass++) {
      count = Math.floor((count * room) / tris(locks));
      locks = sample(count);
    }
    while (tris(locks) > room && locks.length > 0) locks.pop();
    return locks;
  }

  /**
   * Generate the hair for a body. `positions` are current hm08 positions,
   * `skeleton` the skeleton fitted to them.
   */
  generate(style: HairStyleParams, atlas: readonly AtlasRegion[], positions: ArrayLike<number>, skeleton: FittedSkeleton): GeneratedHair {
    if (atlas.length === 0) throw new Error('hair atlas has no regions');
    const proxy = HeadProxy.fit(this.base, this.rig, skeleton, this.dominant, positions, this.scalp.vertices);
    this.lastProxy = proxy;
    const { layers, shellQuads, locks, placed } = this.plan(style);
    const out = new MeshBuilder();
    const surface = this.surface(positions, proxy);
    const top = proxy.cranium.centre;
    const volumeAxis = { top: [top[0], top[1], top[2]] as Vec3, length: 0.6 };

    // 1. Scalp shell (innermost, drawn first).
    if (shellQuads.length) this.buildShell(out, style, atlas, shellQuads, positions, proxy);
    const shellTriangles = out.indices.length / 3;

    // 2. The groom: guide curves, and the parting line they fall away from.
    const guides = this.guides(style, positions, proxy);
    const parting = this.partingLine(style, positions, surface);
    const roots: number[] = [];

    const cardCurves: CardCurve[] = [];
    const lockRegions = regionsFor(atlas, 'lock');
    const pick = (tag: AtlasTag, index: number) => {
      const regions = regionsFor(atlas, tag);
      return regions[((index % regions.length) + regions.length) % regions.length]!;
    };
    let cards = 0;
    let lockCount = 0;
    let lockTriangles = 0;

    if (placed) {
      // Card mode: every hand-placed card exactly where it was put, locks first, then the cards from the inside out.
      const world = this.placedCurves(style.groom.cards!, positions, proxy);
      const culled = new Set(placed.culled);
      world.forEach((c, i) => c && cardCurves.push(culled.has(i) ? { ...c, culled: true } : c));
      for (const i of placed.order) {
        const c = world[i];
        if (!c) continue;
        const segments = placed.segments[i]!;
        if (c.kind === 'lock') {
          this.emitLock(out, style, surface, parting, proxy, roots, { curve: c.points, segments, width: c.width, random: c.random, twist: c.twist * Math.PI, region: pick(c.tag, c.region), flip: c.flip });
          lockCount++;
        } else {
          if (lockTriangles === 0) lockTriangles = out.indices.length / 3 - shellTriangles;
          this.emitCard(out, style, surface, parting, proxy, roots, { curve: c.points, segments, width: c.width, random: c.random, twist: c.twist * Math.PI, region: pick(c.tag, c.region), flip: c.flip, layer: c.layer });
          cards++;
        }
      }
      if (cards === 0) lockTriangles = out.indices.length / 3 - shellTriangles;
    } else {
      // 3. Locks: the hair's mass, under the detail cards.
      locks.forEach(({ root, segments }, i) => {
        const rng = new Rng(mix(mix(style.seed, 0x5bd1e995), i + 1));
        const { curve, lead } = this.childWithLead(style, root, 0, false, guides, positions, proxy, volumeAxis, rng, style.locks.lift);
        const regionIndex = Math.floor(rng.next() * lockRegions.length);
        const width = style.locks.width * (1 + style.locks.widthJitter * rng.range(-0.5, 0.5)) * lead.lockWidth;
        const random = rng.next();
        const twist = lead.lockCurl * (rng.next() < 0.5 ? -1 : 1);
        const flip = rng.next() < 0.5;
        this.emitLock(out, style, surface, parting, proxy, roots, { curve, segments, width, random, twist: twist * Math.PI, region: lockRegions[regionIndex]!, flip });
        cardCurves.push({ root, points: curve.map((q) => [q[0], q[1], q[2]] as Vec3), kind: 'lock', width, tag: 'lock', region: regionIndex, flip, twist, layer: LOCK_LAYER, random });
      });
      lockCount = locks.length;
      lockTriangles = out.indices.length / 3 - shellTriangles;

      // 4. Cards, layer by layer from the inside out.
      const L = layers.length;
      for (let k = 0; k < L; k++) {
        const layerT = L === 1 ? 1 : k / (L - 1);
        layers[k]!.forEach(({ root, segments }, i) => {
          const rng = new Rng(mix(mix(style.seed, k + 1), i + 1));
          const tag = this.tagFor(style, root, k, L, rng);
          const flyaway = tag === 'flyaway';
          const curve = this.child(style, root, layerT, flyaway, guides, positions, proxy, volumeAxis, rng);
          const regions = regionsFor(atlas, tag);
          const regionIndex = Math.floor(rng.next() * regions.length);
          // Loose hairs are thinner (the setup's "sparse" cards use a smaller radius), and no two cards are quite alike.
          const width = style.cards.width * (flyaway ? 0.8 : 1) * (0.85 + 0.3 * rng.next());
          const random = rng.next();
          // Mirror the texture on half the cards so a few atlas strips do not repeat visibly.
          const flip = rng.next() < 0.5;
          this.emitCard(out, style, surface, parting, proxy, roots, { curve, segments, width, random, region: regions[regionIndex]!, flip, layer: layerT });
          cardCurves.push({ root, points: curve.map((q) => [q[0], q[1], q[2]] as Vec3), kind: 'card', width, tag, region: regionIndex, flip, twist: 0, layer: layerT, random });
          cards++;
        });
      }
    }
    const mesh = out.finish();
    const binding = new HairBinding(positions, this.bindTriangles, mesh.positions);
    return {
      ...mesh,
      roots: Uint32Array.from(roots),
      cards,
      locks: lockCount,
      shellTriangles,
      lockTriangles,
      triangleCount: mesh.indices.length / 3,
      proxy,
      binding,
      guideCurves: guides.map((g) => g.points),
      guideRoots: guides.map((g) => g.root),
      cardCurves,
      parting,
      volumeAxis,
    };
  }

  /**
   * A guide drawn on this body, as an authored guide on the neutral head
   * (Hair Studio stores the groom so; see generate's use of style.groom.curves).
   */
  authoredGuide(root: ScalpRoot, points: readonly Vec3[], positions: ArrayLike<number>, lock?: { width?: number; curl?: number }): AuthoredGuide {
    const box = this.headBox(positions);
    const r = rootPoint(positions, root);
    const scale = this.scaleOf(box);
    const flat: number[] = [];
    // The first point keeps its small lift off the skin, so the guide comes back exactly.
    for (const p of points) for (let k = 0; k < 3; k++) flat.push(round6((p[k]! - r[k]!) / scale[k]!));
    const g: AuthoredGuide = { root: [root.a, root.b, root.c, round6(root.wa), round6(root.wb), round6(root.wc)], points: flat };
    if (lock?.width !== undefined && lock.width !== 1) g.lockWidth = lock.width;
    if (lock?.curl !== undefined && lock.curl !== 0) g.lockCurl = lock.curl;
    return g;
  }

  /** A lock or card on this body as a hand-placed card on the neutral head (Hair Studio's card mode). */
  authoredCard(c: Omit<CardCurve, 'culled'>, positions: ArrayLike<number>): AuthoredCard {
    const g = this.authoredGuide(c.root, c.points, positions);
    const s = this.scaleOf(this.headBox(positions));
    const card: AuthoredCard = {
      root: g.root,
      points: g.points,
      kind: c.kind,
      width: round6(c.width / widthScale(s)),
      tag: c.tag,
      region: c.region,
      layer: round3(c.layer),
      random: round3(c.random),
    };
    if (c.flip) card.flip = true;
    if (c.twist) card.twist = round3(Math.min(1, Math.max(-1, c.twist)));
    return card;
  }

  /** Hand-placed cards on this body: roots on its scalp, shapes and widths scaled with its head (null where a root is not on hm08). */
  private placedCurves(cards: readonly AuthoredCard[], positions: ArrayLike<number>, proxy: HeadProxy): (CardCurve | null)[] {
    const s = this.scaleOf(this.headBox(positions));
    return cards.map((c) => {
      const root = this.authoredRoot(c);
      if ([root.a, root.b, root.c].some((v) => v < 0 || v >= this.base.vertexCount)) return null;
      const r = rootPoint(positions, root);
      const points: Vec3[] = [];
      for (let i = 0; i + 2 < c.points.length; i += 3) {
        const q: Vec3 = [r[0] + c.points[i]! * s[0], r[1] + c.points[i + 1]! * s[1], r[2] + c.points[i + 2]! * s[2]];
        if (i > 0) proxy.pushOut(q, 0.003);
        points.push(q);
      }
      return {
        root,
        points,
        kind: c.kind,
        width: c.width * widthScale(s),
        tag: c.tag,
        region: c.region,
        flip: Boolean(c.flip),
        twist: c.twist ?? 0,
        layer: c.kind === 'lock' ? LOCK_LAYER : c.layer,
        random: c.random ?? 0.5,
      };
    });
  }

  /** One lock: a ribbon `locks.columns` quads wide, bowed across, its sections crowding towards the root. */
  private emitLock(
    out: MeshBuilder,
    style: HairStyleParams,
    surface: HairSurface,
    parting: Vec3[] | null,
    proxy: HeadProxy,
    roots: number[],
    l: { curve: Vec3[]; segments: number; width: number; random: number; twist: number; region: AtlasRegion; flip: boolean },
  ): void {
    const C = style.locks.columns;
    const { region, flip, segments } = l;
    const card = cardFromCurve(
      { curve: l.curve, segments, width: l.width, taper: style.locks.taper, random: l.random, surface, parting, columns: C, bow: style.locks.bow, twist: l.twist, rootBias: LOCK_ROOT_BIAS },
      style.build,
    );
    const first = out.vertexCount;
    roots.push(first, first + C);
    card.positions.forEach((p, v) => {
      proxy.pushOut(p, 0.002);
      const col = (v % (C + 1)) / C;
      out.vertex(p, [region.x + region.w * (flip ? 1 - col : col), 1 - (region.y + region.h * card.along[Math.floor(v / (C + 1))]!)], LOCK_LAYER, HAIR_LAYER_LOCK);
    });
    for (let j = 0; j < segments; j++) {
      for (let c = 0; c < C; c++) {
        const a = first + j * (C + 1) + c;
        out.triangle(a, a + 1, a + C + 2);
        out.triangle(a, a + C + 2, a + C + 1);
      }
    }
  }

  /** One detail card: a flat strip, one texture strip wide. */
  private emitCard(
    out: MeshBuilder,
    style: HairStyleParams,
    surface: HairSurface,
    parting: Vec3[] | null,
    proxy: HeadProxy,
    roots: number[],
    c: { curve: Vec3[]; segments: number; width: number; random: number; twist?: number; region: AtlasRegion; flip: boolean; layer: number },
  ): void {
    const { region, flip, segments } = c;
    const card = cardFromCurve(
      { curve: c.curve, segments, width: c.width, taper: style.cards.taper, random: c.random, surface, parting, ...(c.twist ? { twist: c.twist } : {}) },
      style.build,
    );
    const first = out.vertexCount;
    roots.push(first, first + 1);
    card.positions.forEach((p, v) => {
      proxy.pushOut(p, 0.001);
      const left = (v & 1) === 0;
      out.vertex(p, [left !== flip ? region.x : region.x + region.w, 1 - (region.y + region.h * card.along[v >> 1]!)], c.layer, HAIR_LAYER_CARD);
    });
    for (let j = 0; j < segments; j++) {
      const a = first + j * 2;
      out.triangle(a, a + 1, a + 3);
      out.triangle(a, a + 3, a + 2);
    }
  }

  private scalpBvh: { positions: ArrayLike<number>; bvh: TriangleBVH } | null = null;

  /**
   * The nearest point of the scalp on a body, as a root (Hair Studio's Add,
   * Slide and Density brushes, and its parting tool), with the outward normal.
   */
  attachToScalp(p: Vec3, positions: ArrayLike<number>): { root: ScalpRoot; point: Vec3; normal: Vec3 } | null {
    if (this.scalpBvh?.positions !== positions) this.scalpBvh = { positions, bvh: new TriangleBVH(positions, this.scalp.triangles) };
    const hit = this.scalpBvh.bvh.closestPoint(p);
    if (!hit) return null;
    const T = this.scalp.triangles;
    const [a, b, c] = [T[hit.triangle * 3]!, T[hit.triangle * 3 + 1]!, T[hit.triangle * 3 + 2]!];
    const partial: ScalpRoot = { a, b, c, wa: hit.bary[0], wb: hit.bary[1], wc: hit.bary[2], theta: 0, phi: 0 };
    const { theta, phi } = Scalp.angles(this.neutralPoint(partial), this.neutralFrame);
    const n = triangleNormal(positions, a, b, c);
    const box = this.headBox(positions);
    if (dot(n, sub(hit.point, box.centre)) < 0) scale(n, -1);
    return { root: { ...partial, theta, phi }, point: hit.point, normal: n };
  }

  /** Outward normal of the scalp at a root on a body. */
  rootNormal(root: ScalpRoot, positions: ArrayLike<number>): Vec3 {
    const n = triangleNormal(positions, root.a, root.b, root.c);
    const box = this.headBox(positions);
    if (dot(n, sub(rootPoint(positions, root), box.centre)) < 0) scale(n, -1);
    return n;
  }

  /** The middle of the head across (X symmetry mirrors about it). */
  headMiddle(positions: ArrayLike<number>): number {
    return this.headBox(positions).centre[0];
  }

  /** An authored guide's root as a scalp root (with its angles on the neutral head). */
  authoredRoot(g: AuthoredGuide): ScalpRoot {
    const [a, b, c, wa, wb, wc] = g.root;
    const root: ScalpRoot = { a, b, c, wa, wb, wc, theta: 0, phi: 0 };
    const { theta, phi } = Scalp.angles(this.neutralPoint(root), this.neutralFrame);
    return { ...root, theta, phi };
  }

  /**
   * The scalp layer's view of a style (PRD F15), on the NEUTRAL head: how far a
   * point is towards the hairline (0 at the crown, 1 on the line; a painted
   * mask gives a soft band around 1) and which way short hair lies there
   * (unit, along the skin): the groom's own directions at the roots.
   */
  scalpField(style: HairStyleParams): { ratio(p: Vec3): number; flow(p: Vec3, n: Vec3): Vec3 } {
    const frame = this.neutralFrame;
    const c = frame.centre;
    const box = this.neutralBox;
    const flowSource = flowCurves(style);
    const authored = flowSource
      ? flowSource.map((g) => {
          const at = this.neutralPoint(this.authoredRoot(g));
          // A little way along the guide: the first point can sit almost on the root.
          const k = Math.min(g.points.length - 3, 6);
          return { at, d: [g.points[k]! - g.points[0]!, g.points[k + 1]! - g.points[1]!, g.points[k + 2]! - g.points[2]!] as Vec3 };
        })
      : null;
    const offset = this.partOffset(style);
    const line: Vec3[] = [];
    if (style.part.line) for (let i = 0; i + 2 < style.part.line.length; i += 3) line.push([style.part.line[i]!, style.part.line[i + 1]!, style.part.line[i + 2]!]);
    const side = (p: Vec3) => {
      if (this.partWeight(style, Scalp.angles(p, frame).phi) < 0.5) return 0;
      if (line.length >= 2) return p[0] >= closestOnPolyline(line, p).point[0] ? 1 : -1;
      if (offset === null) return 0;
      return p[0] >= c[0] + offset * this.neutralHalfWidth ? 1 : -1;
    };
    return {
      ratio: (p) => {
        const { theta, phi } = Scalp.angles(p, frame);
        if (style.hairline.preset === 'painted' && style.hairline.painted) return 1 + (0.5 - paintCoverage(style.hairline.painted, theta, phi)) * 0.3;
        return theta / Math.max(1e-6, Scalp.maskLimit(style.hairline, phi));
      },
      flow: (p, n) => {
        let d: Vec3;
        if (authored) {
          let best = authored[0]!;
          let bd = Infinity;
          for (const g of authored) {
            const dd = (g.at[0] - p[0]) ** 2 + (g.at[1] - p[1]) ** 2 + (g.at[2] - p[2]) ** 2;
            if (dd < bd) {
              bd = dd;
              best = g;
            }
          }
          d = [...best.d];
        } else {
          const { theta, phi } = Scalp.angles(p, frame);
          const root = { theta, phi } as ScalpRoot;
          if (this.isBangs(style, root)) d = [0, -0.45, 0.6];
          else if (style.ponytail.enabled) {
            const tie: Vec3 = [box.centre[0], c[1] + (style.ponytail.height - 0.4) * box.extent[1] * 0.8, box.centre[2] - box.extent[2] / 2];
            d = sub(tie, p);
          } else {
            const lateral: Vec3 = [0, 0, 0];
            const sd = this.parted(style) ? side(p) : 0;
            if (!this.parted(style)) {
              const h: Vec3 = [p[0] - c[0], 0, p[2] - c[2]];
              normalise(h);
              lateral[0] = h[0];
              lateral[2] = h[2];
            } else if (sd === 0) lateral[1] = -1;
            else lateral[0] = sd;
            d = add(mul([0, 0, -1], style.flowBack), mul(lateral, 1 - style.flowBack));
            d[2] += style.frame * Math.max(0, Math.cos(phi)) * smoothstep(0.3, 0.9, theta) * 1.5;
          }
          // Short hair lies down the head as much as gravity lets it.
          d[1] -= style.gravity * 0.6;
        }
        let t = sub(d, mul(n, dot(d, n)));
        if (Math.hypot(...t) < 1e-6) t = sub([0, -1, 0], mul(n, -n[1]));
        normalise(t);
        return t;
      },
    };
  }

  /** A point on this body's head mapped to the neutral head (partings drawn in Hair Studio are stored so). */
  toNeutral(p: Vec3, positions: ArrayLike<number>): Vec3 {
    const box = this.headBox(positions);
    const s = this.scaleOf(box);
    const c0 = this.neutralBox.centre;
    return [c0[0] + (p[0] - box.centre[0]) / s[0], c0[1] + (p[1] - box.centre[1]) / s[1], c0[2] + (p[2] - box.centre[2]) / s[2]];
  }

  /** A point on the neutral head mapped to this body's head. */
  fromNeutral(p: Vec3, positions: ArrayLike<number>): Vec3 {
    const box = this.headBox(positions);
    const s = this.scaleOf(box);
    const c0 = this.neutralBox.centre;
    return [box.centre[0] + (p[0] - c0[0]) * s[0], box.centre[1] + (p[1] - c0[1]) * s[1], box.centre[2] + (p[2] - c0[2]) * s[2]];
  }

  /** The scalp's box on a body. */
  private headBox(positions: ArrayLike<number>): HeadBox {
    const lo: Vec3 = [Infinity, Infinity, Infinity];
    const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const v of this.scalp.vertices) {
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k]!, positions[v * 3 + k]!);
        hi[k] = Math.max(hi[k]!, positions[v * 3 + k]!);
      }
    }
    return { centre: [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2], extent: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]] };
  }

  private scaleOf(box: HeadBox): Vec3 {
    const n = this.neutralBox.extent;
    return [box.extent[0] / Math.max(1e-6, n[0]), box.extent[1] / Math.max(1e-6, n[1]), box.extent[2] / Math.max(1e-6, n[2])];
  }

  /** Skin weights (head and neck only) per generated vertex. */
  skinWeights(hair: GeneratedHair): SparseWeights {
    return hair.binding.weights(this.weights, this.skinBones, this.headBone);
  }

  // ------------------------------------------------------------ internals

  /** The skin of the head, neck and shoulders as the surface cards snap to. */
  private surface(positions: ArrayLike<number>, proxy: HeadProxy): HairSurface {
    const T = this.bindTriangles;
    const bvh = new TriangleBVH(positions, T);
    const c = proxy.cranium.centre;
    return {
      closest: (p) => {
        const hit = bvh.closestPoint(p);
        if (!hit) return null;
        const n = triangleNormal(positions, T[hit.triangle * 3]!, T[hit.triangle * 3 + 1]!, T[hit.triangle * 3 + 2]!);
        // Out of the body: away from the skull's centre on the head, away from the spine below it.
        const y = Math.min(c[1], hit.point[1]);
        if (dot(n, [hit.point[0] - c[0], hit.point[1] - y, hit.point[2] - c[2]]) < 0) scale(n, -1);
        return { point: hit.point, normal: n, distance: hit.distance };
      },
    };
  }

  private neutralPoint(root: ScalpRoot): Vec3 {
    const P = this.base.positions;
    const r: Vec3 = [0, 0, 0];
    for (let k = 0; k < 3; k++) r[k] = root.wa * P[root.a * 3 + k]! + root.wb * P[root.b * 3 + k]! + root.wc * P[root.c * 3 + k]!;
    return r;
  }

  /** Does the style part the hair (from the sliders or a line drawn in Hair Studio)? */
  private parted(style: HairStyleParams): boolean {
    return style.part.side !== 'none' || Boolean(style.part.line);
  }

  /** The parting's place across the head, -1..1 (0 is the middle), or null without a parting. */
  private partOffset(style: HairStyleParams): number | null {
    if (style.part.side === 'none') return null;
    const def = style.part.side === 'left' ? 0.35 : style.part.side === 'right' ? -0.35 : 0;
    return style.part.position !== 0 ? style.part.position : def;
  }

  /**
   * How much the parting governs hair at this azimuth: 1 in front, fading to 0
   * past the style's reach (Hair v2: a curtain fringe parts the front only and
   * the back falls straight). Without a reach the parting runs over the whole head.
   */
  private partWeight(style: HairStyleParams, phi: number): number {
    const reach = style.part.reach;
    if (reach === undefined) return 1;
    const a = Math.abs((phi * 180) / Math.PI);
    return 1 - smoothstep(reach - 15, reach + 15, a);
  }

  /** Which side of the parting a root is on (1 or -1; 0 without a parting), decided on the neutral body. */
  private sideOf(style: HairStyleParams, root: ScalpRoot): number {
    if (this.partWeight(style, root.phi) < 0.5) return 0;
    const line = style.part.line;
    if (line) {
      // A drawn parting runs from the front over the top: the side is left or right of its nearest point.
      const p = this.neutralPoint(root);
      const pts: Vec3[] = [];
      for (let i = 0; i + 2 < line.length; i += 3) pts.push([line[i]!, line[i + 1]!, line[i + 2]!]);
      const near = closestOnPolyline(pts, p);
      return p[0] >= near.point[0] ? 1 : -1;
    }
    const offset = this.partOffset(style);
    if (offset === null) return 0;
    return this.neutralPoint(root)[0] >= this.neutralFrame.centre[0] + offset * this.neutralHalfWidth ? 1 : -1;
  }

  private groupOf(style: HairStyleParams, root: ScalpRoot): number {
    if (!this.parted(style)) return this.isBangs(style, root) ? 2 : 0;
    if (this.isBangs(style, root)) return 2;
    const side = this.sideOf(style, root);
    // Behind the parting's reach both sides share their guides.
    return side > 0 ? 1 : side < 0 ? 0 : 3;
  }

  /** The length the style gives a hair at this root, before any random variation. */
  private nominalLength(style: HairStyleParams, root: ScalpRoot): number {
    if (this.isBangs(style, root)) return style.bangs.length;
    // A ponytail hair runs over the scalp to the tie and then down the tail.
    if (style.ponytail.enabled) return style.ponytail.length + 0.12;
    return this.lengthAt(style, root);
  }

  /** Quads for a card: one per `segmentLength` of hair, at most `cards.segments` ("Subdivide by length"). */
  private segmentsFor(style: HairStyleParams, root: ScalpRoot): number {
    return this.segmentsForLength(style, this.nominalLength(style, root));
  }

  private segmentsForLength(style: HairStyleParams, length: number): number {
    const most = style.ponytail.enabled ? Math.max(3, style.cards.segments) : style.cards.segments;
    const wanted = Math.ceil((length * style.build.lengthFactor) / style.build.segmentLength);
    return Math.min(most, Math.max(1, wanted));
  }

  private guides(style: HairStyleParams, positions: ArrayLike<number>, proxy: HeadProxy): Guide[] {
    if (style.groom.curves?.length) return this.authoredGuides(style, style.groom.curves, positions, proxy);
    const roots = this.scalp.sampleRoots(style.groom.guides, mix(style.seed, 0x6a09e667), style.hairline, this.base.positions, this.neutralFrame);
    return roots.map((root, i) => {
      const rng = new Rng(mix(mix(style.seed, 0x51ed270b), i + 1));
      const points = resample(this.guide(style, root, 1, positions, proxy, rng, GUIDE_POINTS - 1), GUIDE_POINTS);
      return {
        neutral: this.neutralPoint(root),
        theta: root.theta,
        phi: root.phi,
        group: this.groupOf(style, root),
        nominal: this.nominalLength(style, root),
        points,
        arcs: arcLengths(points),
        root,
        lockWidth: 1,
        lockCurl: 0,
      };
    });
  }

  /** A groom combed in Hair Studio, placed on this body: roots on its scalp, shapes scaled with its head. */
  private authoredGuides(style: HairStyleParams, curves: readonly AuthoredGuide[], positions: ArrayLike<number>, proxy: HeadProxy): Guide[] {
    const scale = this.scaleOf(this.headBox(positions));
    const out: Guide[] = [];
    for (const g of curves) {
      const root = this.authoredRoot(g);
      if ([root.a, root.b, root.c].some((v) => v < 0 || v >= this.base.vertexCount)) continue;
      const r = rootPoint(positions, root);
      const pts: Vec3[] = [];
      for (let i = 0; i + 2 < g.points.length; i += 3) {
        const q: Vec3 = [r[0] + g.points[i]! * scale[0], r[1] + g.points[i + 1]! * scale[1], r[2] + g.points[i + 2]! * scale[2]];
        if (i > 0) proxy.pushOut(q, 0.003);
        pts.push(q);
      }
      const points = resample(pts, GUIDE_POINTS);
      out.push({
        neutral: this.neutralPoint(root),
        theta: root.theta,
        phi: root.phi,
        group: this.groupOf(style, root),
        nominal: curveLength(points),
        points,
        arcs: arcLengths(points),
        root,
        lockWidth: g.lockWidth ?? 1,
        lockCurl: g.lockCurl ?? 0,
      });
    }
    return out;
  }

  /**
   * The parting line (the setup's "Parting line curve"): where the plane of
   * the parting meets the scalp, from the front hairline over the top to
   * behind the crown.
   */
  private partingLine(style: HairStyleParams, positions: ArrayLike<number>, surface: HairSurface): Vec3[] | null {
    if (style.ponytail.enabled) return null;
    const line = style.part.line;
    if (line) {
      // Drawn in Hair Studio on the neutral head: placed on this head and laid back onto its scalp.
      const pts: Vec3[] = [];
      for (let i = 0; i + 2 < line.length; i += 3) {
        const hit = surface.closest(this.fromNeutral([line[i]!, line[i + 1]!, line[i + 2]!], positions));
        if (hit) pts.push(hit.point);
      }
      return pts.length >= 2 ? pts : null;
    }
    const offset = this.partOffset(style);
    if (offset === null) return null;
    const crane = this.lastProxy!.cranium;
    const c = crane.centre;
    const x = c[0] + offset * crane.radii[0];
    const pts: Vec3[] = [];
    for (let deg = Math.min(70, style.hairline.front); deg >= -40; deg -= 6) {
      const a = (deg * Math.PI) / 180;
      const hit = surface.closest([x, c[1] + crane.radii[1] * 1.2 * Math.cos(a), c[2] + crane.radii[2] * 1.2 * Math.sin(a)]);
      if (hit) pts.push([x, hit.point[1], hit.point[2]]);
    }
    return pts.length >= 2 ? pts : null;
  }

  /**
   * One hair's curve: the shapes of the nearest guides blended at its own root
   * ("Interpolate Hair Curves"), set to its own length ("Trim Hair Curves"),
   * drawn towards its nearest guide ("Clump Hair Curves") and given a little
   * waviness of its own ("Hair Curves Noise"). Loose hairs are lifted off the
   * layers below, more towards the tip (the "Normal offset" and "Shape" of
   * "Interpolate hair for haircards").
   */
  private child(
    style: HairStyleParams,
    root: ScalpRoot,
    layerT: number,
    flyaway: boolean,
    guides: readonly Guide[],
    P: ArrayLike<number>,
    proxy: HeadProxy,
    axis: { top: Vec3; length: number },
    rng: Rng,
  ): Vec3[] {
    return this.childWithLead(style, root, layerT, flyaway, guides, P, proxy, axis, rng).curve;
  }

  private childWithLead(
    style: HairStyleParams,
    root: ScalpRoot,
    layerT: number,
    flyaway: boolean,
    guides: readonly Guide[],
    P: ArrayLike<number>,
    proxy: HeadProxy,
    axis: { top: Vec3; length: number },
    rng: Rng,
    liftOverride?: number,
  ): { curve: Vec3[]; lead: Guide } {
    const c = proxy.cranium.centre;
    const r: Vec3 = [0, 0, 0];
    for (let k = 0; k < 3; k++) r[k] = root.wa * P[root.a * 3 + k]! + root.wb * P[root.b * 3 + k]! + root.wc * P[root.c * 3 + k]!;
    const n = triangleNormal(P, root.a, root.b, root.c);
    if (dot(n, sub(r, c)) < 0) scale(n, -1);
    const lift = liftOverride ?? 0.0015 + style.volume * 0.6 * layerT;
    const p0 = add(r, mul(n, lift));
    const groom = style.groom;

    // Nearest guides of this hair's own group, by distance between roots on the neutral body.
    const group = this.groupOf(style, root);
    const neutral = this.neutralPoint(root);
    let pool = guides.filter((g) => g.group === group);
    if (pool.length === 0) pool = [...guides];
    const near = pool
      .map((g) => ({ g, d: Math.hypot(g.neutral[0] - neutral[0], g.neutral[1] - neutral[1], g.neutral[2] - neutral[2]) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, Math.max(1, groom.interpolate));
    let total = 0;
    const weights = near.map(({ d }) => {
      const w = 1 / (d * d + 1e-6);
      total += w;
      return w;
    });
    // A guide's shape is turned about the head's vertical axis by the angle between the two roots, so a
    // hair at the side of the head that follows a guide from further back still hangs beside the head,
    // not through it. (Blender's "Follow Surface Normal" tilts the whole hair, which would swing hair
    // that hangs under gravity; turning about the vertical keeps "down" down.) Near the crown the angle
    // around the head means little, so the turn fades out there.
    const turns = near.map(({ g }) => {
      let yaw = root.phi - g.phi;
      yaw -= Math.PI * 2 * Math.round(yaw / (Math.PI * 2));
      yaw *= smoothstep(0.15, 0.6, Math.min(root.theta, g.theta));
      return [Math.cos(yaw), Math.sin(yaw)] as const;
    });
    let curve: Vec3[] = [];
    let guideNominal = 0;
    for (let i = 0; i < GUIDE_POINTS; i++) {
      const q: Vec3 = [p0[0], p0[1], p0[2]];
      near.forEach(({ g }, j) => {
        const w = weights[j]! / total;
        const [cos, sin] = turns[j]!;
        const ox = g.points[i]![0] - g.points[0]![0];
        const oz = g.points[i]![2] - g.points[0]![2];
        q[0] += w * (ox * cos + oz * sin);
        q[1] += w * (g.points[i]![1] - g.points[0]![1]);
        q[2] += w * (oz * cos - ox * sin);
        if (i === 0) guideNominal += w * g.nominal;
      });
      curve.push(q);
    }

    // Its own length: cut shorter, or stretched a little from the root.
    const wanted = this.nominalLength(style, root) * (1 + style.lengthJitter * rng.range(-0.5, 0.5)) * (0.9 + 0.1 * layerT);
    const ratio = guideNominal > 1e-6 ? wanted / guideNominal : 1;
    if (ratio < 1) curve = resample(trim(curve, ratio), GUIDE_POINTS);
    else if (ratio > 1.02) curve = curve.map((q) => add(p0, mul(sub(q, p0), Math.min(ratio, MAX_STRETCH))));

    const lead = near[0]!.g;
    const length = curveLength(curve);
    const waveA: Vec3 = [rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)];
    const waveB: Vec3 = [rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)];
    const phase = rng.range(0, Math.PI * 2);
    for (let i = 1; i < curve.length; i++) {
      const t = i / (curve.length - 1);
      // Roots stay planted whatever the shape says.
      const planted = Math.min(1, t * 4);
      let q = curve[i]!;
      if (groom.clump > 0) {
        const onGuide = pointAt(lead.points, lead.arcs, t * length).point;
        q = lerp(q, onGuide, groom.clump * shapeRange(t, groom.clumpShape) * planted);
      }
      if (groom.frizz > 0) {
        const k = groom.frizz * shapeRange(t, groom.frizzShape) * planted;
        const a = Math.sin(t * 8.2 + phase);
        const b = Math.sin(t * 4.4 + phase * 1.7);
        q = add(q, [(waveA[0] * a + waveB[0] * b) * k, (waveA[1] * a + waveB[1] * b) * k, (waveA[2] * a + waveB[2] * b) * k]);
      }
      if (flyaway && groom.flyawayLift > 0) {
        const down = Math.min(axis.length, Math.max(0, axis.top[1] - q[1]));
        const outward: Vec3 = [q[0] - axis.top[0], q[1] - (axis.top[1] - down), q[2] - axis.top[2]];
        normalise(outward);
        q = add(q, mul(outward, groom.flyawayLift * shapeRange(t, 0.35)));
      }
      proxy.pushOut(q, 0.003 + lift * 0.5);
      curve[i] = q;
    }
    return { curve, lead };
  }

  /**
   * How far a neutral scalp vertex is towards the hairline: 0 at the crown, 1
   * on the line, more outside it. A painted mask has no line to measure
   * against, so it only says in (0.5) or out (1.2).
   */
  private hairlineRatio(style: HairStyleParams, v: number): number {
    const P = this.base.positions;
    const { theta, phi } = Scalp.angles([P[v * 3]!, P[v * 3 + 1]!, P[v * 3 + 2]!], this.neutralFrame);
    if (style.hairline.preset === 'painted') return Scalp.allows(style.hairline, theta, phi) ? 0.5 : 1.2;
    return theta / Math.max(1e-6, Scalp.maskLimit(style.hairline, phi));
  }

  /** Scalp quads the shell is made of: every quad that reaches inside the hairline. */
  private maskedQuads(style: HairStyleParams): number[] {
    const Q = this.scalp.quads;
    const out: number[] = [];
    const reach = style.shell.reach ?? 1;
    for (let q = 0; q < Q.length / 4; q++) {
      if ([0, 1, 2, 3].some((k) => this.hairlineRatio(style, Q[q * 4 + k]!) < reach)) out.push(q);
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
      const len = style.ponytail.length;
      for (let j = 1; j <= n2; j++) {
        const u = j / n2;
        const q: Vec3 = [tie[0] + spread[0] * u, tie[1] - len * u, tie[2] + spread[2] * u - 0.03 * u * (1 - style.gravity)];
        proxy.pushOut(q, 0.004);
        pts.push(q);
      }
      return pts;
    }

    const bangs = this.isBangs(style, root);
    const length = this.nominalLength(style, root);
    // Flow: combed back and/or away from the part; bangs fall forward over the forehead.
    let flow: Vec3;
    if (bangs) {
      flow = [0, -0.45, 0.6];
    } else {
      const lateral: Vec3 = [0, 0, 0];
      if (!this.parted(style)) {
        const h: Vec3 = [r[0] - c[0], 0, r[2] - c[2]];
        normalise(h);
        lateral[0] = h[0];
        lateral[2] = h[2];
      } else if (style.part.reach === undefined) {
        lateral[0] = this.sideOf(style, root);
      } else {
        // Away from the parting in front; straight down the head behind its reach.
        const w = this.partWeight(style, root.phi);
        const side = r[0] >= c[0] ? 1 : -1;
        lateral[0] = w * side;
        lateral[1] = -(1 - w);
      }
      flow = add(mul([0, 0, -1], style.flowBack), mul(lateral, 1 - style.flowBack));
      // Hair rooted towards the front hairline is drawn forward, so it drapes round the face.
      const frontness = Math.max(0, Math.cos(root.phi)) * smoothstep(0.3, 0.9, root.theta);
      flow[2] += style.frame * frontness * 1.5;
    }
    let t = sub(flow, mul(n, dot(flow, n)));
    if (Math.hypot(...t) < 1e-6) t = sub(down, mul(n, dot(down, n)));
    normalise(t);
    const d = add(t, mul(n, 0.1 + style.volume * 10));
    normalise(d);
    // A little direction of its own per guide, so locks do not all hang alike.
    for (let k = 0; k < 3; k++) d[k] = d[k]! + rng.range(-0.04, 0.04);
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
        // Mirrored azimuth (no seam at the back) across the dense middle of the strip. Down the strip runs
        // the way to the hairline: the solid part covers the scalp, and the hairline itself falls in the
        // strip's ragged end, so the texture's alpha draws it instead of the edges of the scalp's quads.
        const ang = Scalp.angles([N[x * 3]!, N[x * 3 + 1]!, N[x * 3 + 2]!], this.neutralFrame);
        const u = region.x + region.w * (0.2 + 0.6 * (Math.abs(ang.phi) / Math.PI));
        // The region's own rim (where the head's skin weights end, at the nape) counts as outside too.
        // A cap that stops short of the hairline fades out at its own edge instead.
        const ratio = this.scalpBorder.has(x) ? 1.2 : this.hairlineRatio(style, x) / (style.shell.reach ?? 1);
        const down = ratio <= 0.97 ? 0.25 + 0.47 * (ratio / 0.97) : ratio <= 1 ? 0.72 + 0.14 * ((ratio - 0.97) / 0.03) : Math.min(0.995, 0.86 + 0.9 * (ratio - 1));
        const vv = 1 - (region.y + region.h * down);
        out.vertex(p, [u, vv], 0, HAIR_LAYER_SHELL);
      });
      out.triangle(first, first + 1, first + 2);
      if (v[3] !== v[2]) out.triangle(first, first + 2, first + 3);
    }
  }
}

/**
 * Scalp faces: body quads whose vertices all belong to the head bone and lie
 * inside (a margin past) the widest hairline preset ('low'), measured from the
 * centre of the neutral head. Each style's own mask then narrows this down.
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
  // A little past the widest hairline, so the shell has quads to fade out on beyond any hairline.
  const low = hairline('low');
  const widest = { ...low, front: low.front + 6, temples: low.temples + 6, sides: low.sides + 5, nape: low.nape + 6 };
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
  private kind: number[] = [];
  indices: number[] = [];

  get vertexCount(): number {
    return this.p.length / 3;
  }

  vertex(p: Vec3, uv: [number, number], layer: number, kind: number): void {
    this.p.push(p[0], p[1], p[2]);
    this.uv.push(uv[0], uv[1]);
    this.l.push(layer);
    this.kind.push(kind);
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
      hairLayer: Uint8Array.from(this.kind),
    };
  }
}

function rootPoint(P: ArrayLike<number>, root: ScalpRoot): Vec3 {
  const r: Vec3 = [0, 0, 0];
  for (let k = 0; k < 3; k++) r[k] = root.wa * P[root.a * 3 + k]! + root.wb * P[root.b * 3 + k]! + root.wc * P[root.c * 3 + k]!;
  return r;
}

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;
const round3 = (v: number) => Math.round(v * 1e3) / 1e3;

/** Card widths go across the head: they scale with its width and depth. */
const widthScale = (s: Vec3) => (s[0] + s[2]) / 2;

/** Length of a curve stored as flat offsets. */
function offsetsLength(points: readonly number[]): number {
  let n = 0;
  for (let i = 3; i + 2 < points.length; i += 3) n += Math.hypot(points[i]! - points[i - 3]!, points[i + 1]! - points[i - 2]!, points[i + 2]! - points[i - 1]!);
  return n;
}

/**
 * The curves the scalp layer takes its flow from: hand-placed locks (or cards when there are no
 * locks), at most 300, else the combed guides, else none (the sliders' flow).
 */
function flowCurves(style: HairStyleParams): readonly AuthoredGuide[] | null {
  const cards = style.groom.cards;
  if (cards?.length) {
    const locks = cards.filter((c) => c.kind === 'lock');
    const from = locks.length ? locks : cards;
    const step = Math.max(1, Math.ceil(from.length / 300));
    return from.filter((_, i) => i % step === 0);
  }
  return style.groom.curves?.length ? style.groom.curves : null;
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
