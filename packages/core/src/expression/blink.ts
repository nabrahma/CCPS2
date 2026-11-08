/**
 * Eyelid closure (PRD M8: "blink closes the eyelids fully").
 *
 * MakeHuman's lid pose units turn the lid about a fixed bone, by the same
 * angle on every character, so on some eye shapes the upper lid stops short
 * of the lower lid and a sliver of eyeball stays visible. The blink
 * blendshapes are therefore calibrated per character: the smallest upper-lid
 * weight (from 1, in small steps) at which no view ray reaches the eyeball
 * before the eyelid skin. Too much rotation reopens a gap (the lids pass each
 * other), so the search stops at the first closed weight.
 */
import { TriangleBVH } from '../mesh/bvh';

export interface Eyeball {
  centre: [number, number, number];
  /** Largest distance from the centre to an eyeball vertex. */
  radius: number;
  /** Triangles of this eyeball in the eyes part. */
  triangles: Uint32Array;
}

/** View directions of the closure check: yaw (deg) x pitch (deg). */
export const EYE_VIEWS = { yaw: [-20, 0, 20], pitch: [-25, -15, 0, 15] } as const;
/** Rays per view: a grid of N x N over the eyeball's outline. */
export const EYE_GRID = 41;

/** The eyeball on one side (+1: the character's left, +x; -1: right) of an eyes part. */
export function eyeballOf(positions: ArrayLike<number>, indices: ArrayLike<number>, side: number): Eyeball | null {
  const tris: number[] = [];
  for (let t = 0; t < indices.length; t += 3) {
    const x = positions[indices[t]! * 3]! + positions[indices[t + 1]! * 3]! + positions[indices[t + 2]! * 3]!;
    if (x * side > 0) tris.push(indices[t]!, indices[t + 1]!, indices[t + 2]!);
  }
  if (tris.length === 0) return null;
  const verts = new Set(tris);
  const c: [number, number, number] = [0, 0, 0];
  for (const v of verts) for (let k = 0; k < 3; k++) c[k] = c[k]! + positions[v * 3 + k]! / verts.size;
  let r = 0;
  for (const v of verts) r = Math.max(r, Math.hypot(positions[v * 3]! - c[0], positions[v * 3 + 1]! - c[1], positions[v * 3 + 2]! - c[2]));
  return { centre: c, radius: r, triangles: Uint32Array.from(tris) };
}

/** Skin triangles near an eyeball (within 3 radii of its centre), to keep the ray tests local. */
export function trianglesNear(positions: ArrayLike<number>, indices: ArrayLike<number>, ball: Eyeball, reach = 3): Uint32Array {
  const keep: number[] = [];
  const lim = ball.radius * reach;
  for (let t = 0; t < indices.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const v = indices[t + k]! * 3;
      if (Math.hypot(positions[v]! - ball.centre[0], positions[v + 1]! - ball.centre[1], positions[v + 2]! - ball.centre[2]) < lim) {
        keep.push(indices[t]!, indices[t + 1]!, indices[t + 2]!);
        break;
      }
    }
  }
  return Uint32Array.from(keep);
}

/**
 * Rays from all EYE_VIEWS toward the eyeball: how many hit it at all
 * (`onEyeball`) and how many reach it before any skin triangle (`visible`).
 */
export function eyeVisibility(
  skinPositions: ArrayLike<number>,
  skinTriangles: ArrayLike<number>,
  eyePositions: ArrayLike<number>,
  ball: Eyeball,
  grid = EYE_GRID,
): { visible: number; onEyeball: number } {
  const skin = new TriangleBVH(skinPositions, skinTriangles);
  const eye = new TriangleBVH(eyePositions, ball.triangles);
  let visible = 0;
  let onEyeball = 0;
  const c = ball.centre;
  const span = ball.radius * 1.1;
  for (const yaw of EYE_VIEWS.yaw) {
    for (const pitch of EYE_VIEWS.pitch) {
      const ay = (yaw * Math.PI) / 180;
      const ap = (pitch * Math.PI) / 180;
      // From the viewer toward the face (the character faces +Z).
      const d = [-Math.sin(ay) * Math.cos(ap), -Math.sin(ap), -Math.cos(ay) * Math.cos(ap)];
      const u = [Math.cos(ay), 0, -Math.sin(ay)];
      const v = [d[1]! * u[2]! - d[2]! * u[1]!, d[2]! * u[0]! - d[0]! * u[2]!, d[0]! * u[1]! - d[1]! * u[0]!];
      for (let i = 0; i < grid; i++) {
        for (let j = 0; j < grid; j++) {
          const a = ((i / (grid - 1)) * 2 - 1) * span;
          const b = ((j / (grid - 1)) * 2 - 1) * span;
          const o = [0, 1, 2].map((k) => c[k]! + a * u[k]! + b * v[k]! - 0.25 * d[k]!);
          const hit = eye.raycast(o, d, 0, 1);
          if (!hit) continue;
          onEyeball++;
          if (!skin.raycast(o, d, 0, hit.t)) visible++;
        }
      }
    }
  }
  return { visible, onEyeball };
}

/** Calibration of a blink: weights of the closing unit to try, in order. */
export function closureSteps(max: number, step: number): number[] {
  const out: number[] = [];
  for (let w = 1; w <= max + 1e-9; w += step) out.push(Math.round(w * 1000) / 1000);
  return out;
}

/**
 * Lash edges that cross the eyeball surface, keyed "a,b" (render vertex
 * indices), with the crossing point. MakeHuman's lash roots already sit inside
 * its low-poly eye shell at rest, so callers compare against the rest set.
 */
export function lashCrossings(
  lashPositions: ArrayLike<number>,
  lashTriangles: ArrayLike<number>,
  eyePositions: ArrayLike<number>,
  ball: Eyeball,
): Map<string, [number, number, number]> {
  const eye = new TriangleBVH(eyePositions, ball.triangles);
  const out = new Map<string, [number, number, number]>();
  const c = ball.centre;
  const P = lashPositions;
  for (let t = 0; t < lashTriangles.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = lashTriangles[t + e]!;
      const b = lashTriangles[t + ((e + 1) % 3)]!;
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      if (out.has(key)) continue;
      const o = [P[a * 3]!, P[a * 3 + 1]!, P[a * 3 + 2]!];
      if (Math.hypot(o[0]! - c[0], o[1]! - c[1], o[2]! - c[2]) > ball.radius * 2) continue;
      const d = [P[b * 3]! - o[0]!, P[b * 3 + 1]! - o[1]!, P[b * 3 + 2]! - o[2]!];
      const len = Math.hypot(d[0]!, d[1]!, d[2]!);
      if (len < 1e-9) continue;
      const u = d.map((x) => x / len);
      const hit = eye.raycast(o, u, 0, len);
      if (hit) out.set(key, [o[0]! + hit.t * u[0]!, o[1]! + hit.t * u[1]!, o[2]! + hit.t * u[2]!]);
    }
  }
  return out;
}

/** Whether a surface point can be seen from any of the EYE_VIEWS past the skin and the eye (BVHs of both). */
export function pointVisible(p: ArrayLike<number>, skin: TriangleBVH, eye: TriangleBVH): boolean {
  for (const yaw of EYE_VIEWS.yaw) {
    for (const pitch of EYE_VIEWS.pitch) {
      const ay = (yaw * Math.PI) / 180;
      const ap = (pitch * Math.PI) / 180;
      const v = [Math.sin(ay) * Math.cos(ap), Math.sin(ap), Math.cos(ay) * Math.cos(ap)];
      const o = [0, 1, 2].map((k) => p[k]! + 2e-4 * v[k]!);
      if (!skin.raycast(o, v, 0, 0.25) && !eye.raycast(o, v, 0, 0.25)) return true;
    }
  }
  return false;
}
