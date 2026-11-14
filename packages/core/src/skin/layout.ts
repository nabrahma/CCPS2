/**
 * The hm08 skin UV layout: UV islands, what each island is (head, body,
 * hands, feet), region masks for the layer stack (PRD F6 "region mask (face,
 * body, hands)") and UV-space rasterisation of surface attributes (position
 * and normal maps) that procedural layers and the photo projection use.
 *
 * Measured on the pinned hm08 mesh: 9 islands. The body is one island; the
 * head is four (face/scalp/neck, the mouth interior and two eye-socket
 * patches); hands and feet are one island each.
 */
import type { BaseMesh } from '../mesh/basemesh';
import type { RigDefinition } from '../skeleton/rig';
import type { SparseWeights } from '../skeleton/weights';
import { blurChannel, createImage, type RgbaImage } from './image';

export type IslandKind = 'head' | 'body' | 'hands' | 'feet';
export type SkinRegion = 'face' | 'body' | 'hands';

export interface UvIsland {
  id: number;
  kind: IslandKind;
  /** hm08 face indices (quads; triangles repeat their last corner). */
  faces: number[];
  /** UV bounding box [u0, v0, u1, v1]. */
  box: [number, number, number, number];
}

/** One UV triangle of the hm08 body: 3 vertex indices and 3 UV indices. */
export interface LayoutTriangle {
  face: number;
  verts: [number, number, number];
  uvs: [number, number, number];
}

/** Per-texel surface attributes rasterised in UV space. */
export interface SurfaceMap {
  size: number;
  /**
   * Only this rectangle of the size x size texture (texels, rows top first); the arrays
   * below then hold width x height texels. Absent: the whole texture.
   */
  window?: TexelWindow;
  /** 1 where a body triangle covers the texel centre. */
  coverage: Uint8Array;
  /** Island id per texel (-1 outside). */
  island: Int16Array;
  /** Interpolated position (xyz per texel, metres). */
  position: Float32Array;
  /** Interpolated, normalised normal (xyz per texel). */
  normal: Float32Array;
}

/** A rectangle of texels (rows top first). */
export interface TexelWindow {
  x0: number;
  y0: number;
  width: number;
  height: number;
}

const HAND_BONE = /^(hand|thumb|index|middle|ring|pinky)_/;
const FOOT_BONE = /^(foot|ball)_/;

export class SkinLayout {
  readonly islands: UvIsland[];
  /** Island id per hm08 face (-1 for helper and joint geometry). */
  readonly faceIsland: Int32Array;
  readonly triangles: LayoutTriangle[];
  private readonly cornerIsland = new Map<string, number[]>();

  private constructor(readonly base: BaseMesh, islands: UvIsland[], faceIsland: Int32Array) {
    this.islands = islands;
    this.faceIsland = faceIsland;
    const tris: LayoutTriangle[] = [];
    for (const isl of islands) {
      for (const f of isl.faces) {
        const v = [0, 1, 2, 3].map((k) => base.faceVerts[f * 4 + k]!);
        const t = [0, 1, 2, 3].map((k) => base.faceUvs[f * 4 + k]!);
        tris.push({ face: f, verts: [v[0]!, v[1]!, v[2]!], uvs: [t[0]!, t[1]!, t[2]!] });
        if (v[3] !== v[2]) tris.push({ face: f, verts: [v[0]!, v[2]!, v[3]!], uvs: [t[0]!, t[2]!, t[3]!] });
        for (let k = 0; k < 4; k++) {
          const key = cornerKey(v[k]!, base.uvs[t[k]! * 2]!, base.uvs[t[k]! * 2 + 1]!);
          const list = this.cornerIsland.get(key);
          if (!list) this.cornerIsland.set(key, [isl.id]);
          else if (!list.includes(isl.id)) list.push(isl.id);
        }
      }
    }
    this.triangles = tris;
  }

  /**
   * Split the hm08 body faces into UV islands (faces sharing a UV edge) and
   * classify each by the bones that dominate its vertices.
   */
  static build(base: BaseMesh, rig: RigDefinition, weights: SparseWeights): SkinLayout {
    const faces = base.facesWhere((g) => g === 'body');
    const parent = new Map<number, number>();
    for (const f of faces) parent.set(f, f);
    const find = (x: number): number => {
      let r = x;
      while (parent.get(r) !== r) r = parent.get(r)!;
      let y = x;
      while (parent.get(y) !== r) {
        const next = parent.get(y)!;
        parent.set(y, r);
        y = next;
      }
      return r;
    };
    const edgeOwner = new Map<string, number>();
    for (const f of faces) {
      const n = base.faceVerts[f * 4 + 3] === base.faceVerts[f * 4 + 2] ? 3 : 4;
      for (let k = 0; k < n; k++) {
        const a = base.faceUvs[f * 4 + k]!;
        const b = base.faceUvs[f * 4 + ((k + 1) % n)]!;
        const key = a < b ? `${a}_${b}` : `${b}_${a}`;
        const g = edgeOwner.get(key);
        if (g === undefined) edgeOwner.set(key, f);
        else {
          const ra = find(g);
          const rb = find(f);
          if (ra !== rb) parent.set(ra, rb);
        }
      }
    }
    // Dominant bone per vertex.
    const dominant = new Int16Array(weights.length).fill(-1);
    weights.forEach((list, v) => {
      let best = 0;
      for (const [b, w] of list) if (w > best) [best, dominant[v]] = [w, b];
    });
    const head = rig.index.get('head');
    const groups = new Map<number, number[]>();
    for (const f of faces) {
      const r = find(f);
      const g = groups.get(r);
      if (g) g.push(f);
      else groups.set(r, [f]);
    }
    // Stable order: by the smallest face index in each island.
    const ordered = [...groups.values()].sort((a, b) => a[0]! - b[0]!);
    const faceIsland = new Int32Array(base.faceCount).fill(-1);
    const islands: UvIsland[] = ordered.map((list, id) => {
      const count = { head: 0, hands: 0, feet: 0, all: 0 };
      const box: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
      for (const f of list) {
        faceIsland[f] = id;
        for (let k = 0; k < 4; k++) {
          const v = base.faceVerts[f * 4 + k]!;
          const t = base.faceUvs[f * 4 + k]!;
          const b = dominant[v]!;
          const name = b >= 0 ? rig.bones[b]!.name : '';
          if (b === head) count.head++;
          else if (HAND_BONE.test(name)) count.hands++;
          else if (FOOT_BONE.test(name)) count.feet++;
          count.all++;
          const u = base.uvs[t * 2]!;
          const vv = base.uvs[t * 2 + 1]!;
          box[0] = Math.min(box[0], u);
          box[1] = Math.min(box[1], vv);
          box[2] = Math.max(box[2], u);
          box[3] = Math.max(box[3], vv);
        }
      }
      const kind: IslandKind =
        count.head / count.all >= 0.5 ? 'head' : count.hands / count.all >= 0.5 ? 'hands' : count.feet / count.all >= 0.5 ? 'feet' : 'body';
      return { id, kind, faces: list, box };
    });
    return new SkinLayout(base, islands, faceIsland);
  }

  /** Region of an island for layer masks: head islands are "face", hands "hands", everything else "body". */
  regionOf(island: number): SkinRegion {
    const kind = this.islands[island]!.kind;
    return kind === 'head' ? 'face' : kind === 'hands' ? 'hands' : 'body';
  }

  /**
   * Islands a render corner (hm08 vertex + its UV) can belong to. Usually
   * one; two only where islands touch at a single UV point.
   */
  islandsOfCorner(vertex: number, u: number, v: number): number[] {
    return this.cornerIsland.get(cornerKey(vertex, u, v)) ?? [];
  }

  /**
   * Rasterise triangles in UV space at size x size: `visit(texel, tri, b0, b1, b2)`
   * for every texel whose centre lies inside (barycentric weights of the
   * triangle's corners). Texels on a shared edge may be visited twice.
   */
  rasterize(size: number, tris: readonly LayoutTriangle[], visit: (texel: number, tri: LayoutTriangle, b0: number, b1: number, b2: number) => void): void {
    const uv = this.base.uvs;
    for (const tri of tris) {
      const xs = tri.uvs.map((t) => uv[t * 2]! * size);
      const ys = tri.uvs.map((t) => (1 - uv[t * 2 + 1]!) * size);
      rasterTriangle(size, xs, ys, (texel, b0, b1, b2) => visit(texel, tri, b0, b1, b2));
    }
  }

  /** Triangles of the given islands (default: all). */
  trianglesOf(pred: (island: UvIsland) => boolean = () => true): LayoutTriangle[] {
    return this.triangles.filter((t) => pred(this.islands[this.faceIsland[t.face]!]!));
  }

  /**
   * Interpolate per-vertex positions (and normals) into UV space. Used with
   * the neutral mesh for procedural layers (they stay put when the body
   * morphs) and with the current mesh for photo projection.
   */
  surfaceMap(size: number, positions: ArrayLike<number>, normals: ArrayLike<number>, pred?: (island: UvIsland) => boolean, window?: TexelWindow): SurfaceMap {
    const w = window ? window.width : size;
    const n = w * (window ? window.height : size);
    const map: SurfaceMap = {
      size,
      ...(window ? { window } : {}),
      coverage: new Uint8Array(n),
      island: new Int16Array(n).fill(-1),
      position: new Float32Array(n * 3),
      normal: new Float32Array(n * 3),
    };
    let tris = this.trianglesOf(pred);
    if (window) {
      // Only triangles that reach into the window.
      const uv = this.base.uvs;
      tris = tris.filter((t) => {
        const xs = t.uvs.map((i) => uv[i * 2]! * size);
        const ys = t.uvs.map((i) => (1 - uv[i * 2 + 1]!) * size);
        return Math.max(...xs) >= window.x0 && Math.min(...xs) <= window.x0 + window.width && Math.max(...ys) >= window.y0 && Math.min(...ys) <= window.y0 + window.height;
      });
    }
    this.rasterize(size, tris, (global, tri, b0, b1, b2) => {
      let texel = global;
      if (window) {
        const x = (global % size) - window.x0;
        const y = Math.floor(global / size) - window.y0;
        if (x < 0 || y < 0 || x >= window.width || y >= window.height) return;
        texel = y * w + x;
      }
      if (map.coverage[texel]) return;
      map.coverage[texel] = 1;
      map.island[texel] = this.faceIsland[tri.face]!;
      const [a, b, c] = tri.verts;
      let nl = 0;
      for (let k = 0; k < 3; k++) {
        map.position[texel * 3 + k] = b0 * positions[a * 3 + k]! + b1 * positions[b * 3 + k]! + b2 * positions[c * 3 + k]!;
        const nk = b0 * normals[a * 3 + k]! + b1 * normals[b * 3 + k]! + b2 * normals[c * 3 + k]!;
        map.normal[texel * 3 + k] = nk;
        nl += nk * nk;
      }
      nl = Math.sqrt(nl) || 1;
      for (let k = 0; k < 3; k++) map.normal[texel * 3 + k]! /= nl;
    });
    return map;
  }

  /**
   * Region masks at size x size: R = face (head islands), G = body (body and
   * feet), B = hands, A = any skin. Each mask is dilated by `feather` pixels
   * past its island edge and then softened by the same amount, so masked
   * layers fade out across UV seams instead of stopping hard at them.
   */
  regionMasks(size: number, feather = Math.max(1, Math.round(size / 256))): RgbaImage {
    const n = size * size;
    const channels = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
    const any = new Uint8Array(n);
    const channelOf: Record<SkinRegion, number> = { face: 0, body: 1, hands: 2 };
    this.rasterize(size, this.triangles, (texel, tri) => {
      channels[channelOf[this.regionOf(this.faceIsland[tri.face]!)]]![texel] = 1;
      any[texel] = 1;
    });
    const out = createImage(size, size);
    channels.forEach((ch, c) => {
      const grown = blurChannel(dilateBinary(ch, size, feather), size, size, feather / 2, 2);
      for (let i = 0; i < n; i++) out.data[i * 4 + c] = Math.round(Math.min(1, ch[i]! > 0 ? 1 : grown[i]!) * 255);
    });
    for (let i = 0; i < n; i++) out.data[i * 4 + 3] = any[i] ? 255 : 0;
    return out;
  }
}

function cornerKey(vertex: number, u: number, v: number): string {
  return `${vertex}|${Math.fround(u)}|${Math.fround(v)}`;
}

/** Binary dilation by `r` pixels (square neighbourhood, separable). */
function dilateBinary(src: Float32Array, size: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < size; y++) {
    let last = -Infinity;
    for (let x = 0; x < size; x++) {
      if (src[y * size + x]! > 0) last = x;
      if (x - last <= r) tmp[y * size + x] = 1;
    }
    last = Infinity;
    for (let x = size - 1; x >= 0; x--) {
      if (src[y * size + x]! > 0) last = x;
      if (last - x <= r) tmp[y * size + x] = 1;
    }
  }
  for (let x = 0; x < size; x++) {
    let last = -Infinity;
    for (let y = 0; y < size; y++) {
      if (tmp[y * size + x]! > 0) last = y;
      if (y - last <= r) out[y * size + x] = 1;
    }
    last = Infinity;
    for (let y = size - 1; y >= 0; y--) {
      if (tmp[y * size + x]! > 0) last = y;
      if (last - y <= r) out[y * size + x] = 1;
    }
  }
  return out;
}

/**
 * Visit texel centres inside a triangle given in continuous image
 * coordinates (x right, y down). Degenerate triangles are skipped.
 */
export function rasterTriangle(size: number, xs: number[], ys: number[], visit: (texel: number, b0: number, b1: number, b2: number) => void): void {
  const [x0, x1, x2] = xs as [number, number, number];
  const [y0, y1, y2] = ys as [number, number, number];
  const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (Math.abs(area) < 1e-12) return;
  const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
  const maxX = Math.min(size - 1, Math.ceil(Math.max(x0, x1, x2)));
  const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
  const maxY = Math.min(size - 1, Math.ceil(Math.max(y0, y1, y2)));
  const eps = -1e-7;
  for (let y = minY; y <= maxY; y++) {
    const py = y + 0.5;
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      const b0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) / area;
      const b1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) / area;
      const b2 = 1 - b0 - b1;
      if (b0 >= eps && b1 >= eps && b2 >= eps) visit(y * size + x, b0, b1, b2);
    }
  }
}
