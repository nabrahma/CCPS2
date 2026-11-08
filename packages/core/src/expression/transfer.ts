/**
 * Transfer of base-mesh expression deltas to the parts bound to it (PRD F8:
 * "Eyebrows, eyelashes and the hair shell must receive the same blendshapes
 * (transfer through their MHCLO binding) so blinking moves the lashes").
 */

/** Delta of points bound to base triangles: the weighted sum of the base vertices' deltas. */
export function transferBound(
  base: Float32Array,
  refVerts: ArrayLike<number>,
  refWeights: ArrayLike<number>,
  out: Float32Array = new Float32Array(refVerts.length),
): Float32Array {
  const n = refVerts.length / 3;
  for (let i = 0; i < n; i++) {
    let x = 0;
    let y = 0;
    let z = 0;
    for (let k = 0; k < 3; k++) {
      const w = refWeights[i * 3 + k]!;
      if (w === 0) continue;
      const v = refVerts[i * 3 + k]! * 3;
      x += w * base[v]!;
      y += w * base[v + 1]!;
      z += w * base[v + 2]!;
    }
    out[i * 3] = x;
    out[i * 3 + 1] = y;
    out[i * 3 + 2] = z;
  }
  return out;
}

/** positions + delta. */
export function addDelta(positions: ArrayLike<number>, delta: ArrayLike<number>, out: Float32Array = new Float32Array(positions.length)): Float32Array {
  for (let i = 0; i < positions.length; i++) out[i] = positions[i]! + delta[i]!;
  return out;
}

/** after - before. */
export function difference(after: ArrayLike<number>, before: ArrayLike<number>, out: Float32Array = new Float32Array(after.length)): Float32Array {
  for (let i = 0; i < after.length; i++) out[i] = after[i]! - before[i]!;
  return out;
}

/** True when any component is larger than `epsilon`. */
export function moves(delta: ArrayLike<number>, epsilon = 1e-6): boolean {
  for (let i = 0; i < delta.length; i++) if (Math.abs(delta[i]!) > epsilon) return true;
  return false;
}
