/**
 * The sculpt layer (PRD Part 3, F27): a sparse displacement of the hm08 body
 * vertices, added after every slider, stored in the character file. A sculpt
 * can also be saved as a slider (a user target, `.ps2target`), usable on any
 * character.
 *
 * Stored as base64: vertex indices (uint32) and xyz deltas (float32, metres).
 * Like garment edits, a stored sculpt is never changed once made; a new one
 * replaces it, so undo copies share it.
 */
import { base64ToBytes, bytesToBase64 } from '../proxy/garment-edit';

export interface SculptData {
  /** Base64 of uint32 vertex indices (ascending). */
  vertices: string;
  /** Base64 of float32 xyz deltas, 3 per vertex, metres. */
  deltas: string;
}

/** Deltas smaller than this (metres, per axis) are dropped when a sculpt is stored. */
export const SCULPT_EPSILON = 1e-6;

/** A dense layer (xyz per body vertex) as stored sparse data, or null when it moves nothing. */
export function encodeSculpt(dense: Float32Array): SculptData | null {
  const idx: number[] = [];
  const n = dense.length / 3;
  for (let v = 0; v < n; v++) {
    if (Math.abs(dense[v * 3]!) > SCULPT_EPSILON || Math.abs(dense[v * 3 + 1]!) > SCULPT_EPSILON || Math.abs(dense[v * 3 + 2]!) > SCULPT_EPSILON) idx.push(v);
  }
  if (idx.length === 0) return null;
  const vertices = Uint32Array.from(idx);
  const deltas = new Float32Array(idx.length * 3);
  idx.forEach((v, i) => deltas.set(dense.subarray(v * 3, v * 3 + 3), i * 3));
  return { vertices: bytesToBase64(new Uint8Array(vertices.buffer)), deltas: bytesToBase64(new Uint8Array(deltas.buffer)) };
}

/** Stored sculpt data as a dense layer of `vertexCount` vertices (unknown or out-of-range entries are skipped). */
export function decodeSculpt(data: SculptData, vertexCount: number, out = new Float32Array(vertexCount * 3)): Float32Array {
  out.fill(0);
  const vb = base64ToBytes(data.vertices);
  const db = base64ToBytes(data.deltas);
  if (vb.length % 4 !== 0 || db.length !== vb.length * 3) throw new Error('sculpt: vertex and delta counts do not match');
  const vertices = new Uint32Array(vb.buffer, vb.byteOffset, vb.length / 4);
  const deltas = new Float32Array(db.buffer, db.byteOffset, db.length / 4);
  for (let i = 0; i < vertices.length; i++) {
    const v = vertices[i]!;
    if (v >= vertexCount) continue;
    const x = deltas[i * 3]!;
    const y = deltas[i * 3 + 1]!;
    const z = deltas[i * 3 + 2]!;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    out[v * 3] = x;
    out[v * 3 + 1] = y;
    out[v * 3 + 2] = z;
  }
  return out;
}

/** Well-formed sculpt data, or undefined. */
export function sanitiseSculpt(raw: unknown): SculptData | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Partial<SculptData>;
  if (typeof r.vertices !== 'string' || typeof r.deltas !== 'string' || r.vertices.length === 0) return undefined;
  try {
    const vb = base64ToBytes(r.vertices);
    const db = base64ToBytes(r.deltas);
    if (vb.length % 4 !== 0 || db.length !== vb.length * 3) return undefined;
  } catch {
    return undefined;
  }
  return { vertices: r.vertices, deltas: r.deltas };
}

/** The number of vertices a sculpt moves. */
export function sculptVertexCount(data: SculptData): number {
  return (data.vertices.length * 3) / 4 / 4;
}

// ---------------------------------------------------------------- user targets (.ps2target)

export const TARGET_FORMAT = 'ps2cc.target/1';

/** A sculpt saved as a slider (PRD Part 3, F27): a library document, one JSON file with the delta in base64. */
export interface UserTargetFile {
  format: typeof TARGET_FORMAT;
  name: string;
  /** 'face' or 'body': which tab its slider shows in. */
  tab: 'face' | 'body';
  /** The base mesh it is a delta of. */
  mesh: 'hm08';
  sculpt: SculptData;
}

export interface UserTarget {
  /** "user:targets/<stem>" */
  id: string;
  name: string;
  tab: 'face' | 'body';
  data: SculptData;
  /** Library file, for deleting it. */
  file?: string;
}

export function userTargetFile(name: string, tab: 'face' | 'body', sculpt: SculptData): UserTargetFile {
  return { format: TARGET_FORMAT, name, tab, mesh: 'hm08', sculpt };
}

export function parseUserTargetFile(raw: unknown): UserTargetFile {
  const r = raw as Partial<UserTargetFile> | null;
  if (!r || r.format !== TARGET_FORMAT) throw new Error('not a PS2CC target (.ps2target)');
  if (r.mesh !== 'hm08') throw new Error(`target for an unknown mesh ${String(r.mesh)}`);
  const sculpt = sanitiseSculpt(r.sculpt);
  if (!sculpt) throw new Error('the target has no valid deltas');
  return { format: TARGET_FORMAT, name: typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 64) : 'Target', tab: r.tab === 'body' ? 'body' : 'face', mesh: 'hm08', sculpt };
}

/** User target values in a character: id -> -1..1; values of 0 are dropped. */
export function sanitiseUserTargets(raw: unknown): Record<string, number> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!k.startsWith('user:targets/') || typeof v !== 'number' || !Number.isFinite(v) || v === 0) continue;
    out[k] = Math.min(1, Math.max(-1, v));
  }
  return Object.keys(out).length ? out : undefined;
}

// ---------------------------------------------------------------- helper geometry follows the skin

/**
 * hm08's helper geometry (joint cubes, eyes, teeth, tongue, lash and hair
 * helpers) has no sculptable skin, but MakeHuman's own targets move it with
 * the body, and the skeleton and the eyes are fitted to it. A sculpt moves
 * each helper vertex by a weighted mean of its nearest body vertices' deltas
 * (12 neighbours on the rest mesh, weight 1/(d^2 + 1 mm^2)), so the skeleton
 * and the eyes follow a sculpt too.
 */
export interface HelperBinding {
  /** First helper vertex (= body vertex count). */
  start: number;
  /** Per helper vertex, K body vertex indices and weights (summing to 1). */
  index: Uint32Array;
  weight: Float32Array;
  k: number;
}

const bindingCache = new WeakMap<object, HelperBinding>();

export function helperBinding(base: { positions: Float32Array; vertexCount: number; bodyVertexCount: number }, k = 12): HelperBinding {
  const cached = bindingCache.get(base);
  if (cached) return cached;
  const p = base.positions;
  const n = base.bodyVertexCount;
  const total = base.vertexCount;
  // A uniform grid over the body vertices.
  const cell = 0.02;
  const grid = new Map<string, number[]>();
  const key = (x: number, y: number, z: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  for (let v = 0; v < n; v++) {
    const kk = key(p[v * 3]!, p[v * 3 + 1]!, p[v * 3 + 2]!);
    const list = grid.get(kk);
    if (list) list.push(v);
    else grid.set(kk, [v]);
  }
  const helpers = total - n;
  const index = new Uint32Array(helpers * k);
  const weight = new Float32Array(helpers * k);
  for (let h = 0; h < helpers; h++) {
    const v = n + h;
    const x = p[v * 3]!;
    const y = p[v * 3 + 1]!;
    const z = p[v * 3 + 2]!;
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    const cz = Math.floor(z / cell);
    let best: { v: number; d2: number }[] = [];
    for (let r = 1; r <= 12 && best.length < k; r++) {
      best = [];
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dz = -r; dz <= r; dz++) {
            const list = grid.get(`${cx + dx},${cy + dy},${cz + dz}`);
            if (!list) continue;
            for (const u of list) {
              const ex = p[u * 3]! - x;
              const ey = p[u * 3 + 1]! - y;
              const ez = p[u * 3 + 2]! - z;
              best.push({ v: u, d2: ex * ex + ey * ey + ez * ez });
            }
          }
        }
      }
    }
    best.sort((a, b) => a.d2 - b.d2 || a.v - b.v);
    let sum = 0;
    for (let i = 0; i < k; i++) {
      const b = best[Math.min(i, best.length - 1)]!;
      const w = 1 / (b.d2 + 1e-6);
      index[h * k + i] = b.v;
      weight[h * k + i] = w;
      sum += w;
    }
    for (let i = 0; i < k; i++) weight[h * k + i] = weight[h * k + i]! / sum;
  }
  const out = { start: n, index, weight, k };
  bindingCache.set(base, out);
  return out;
}

/** A body-vertex layer extended to every hm08 vertex: helpers get the weighted mean of their body neighbours' deltas. */
export function withHelpers(layer: Float32Array, binding: HelperBinding, vertexCount: number): Float32Array {
  const out = new Float32Array(vertexCount * 3);
  out.set(layer.subarray(0, Math.min(layer.length, binding.start * 3)));
  const k = binding.k;
  for (let h = 0; h < vertexCount - binding.start; h++) {
    let x = 0;
    let y = 0;
    let z = 0;
    for (let i = 0; i < k; i++) {
      const u = binding.index[h * k + i]! * 3;
      const w = binding.weight[h * k + i]!;
      x += layer[u]! * w;
      y += layer[u + 1]! * w;
      z += layer[u + 2]! * w;
    }
    const v = (binding.start + h) * 3;
    out[v] = x;
    out[v + 1] = y;
    out[v + 2] = z;
  }
  return out;
}
