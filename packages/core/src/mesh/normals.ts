/**
 * Area-weighted vertex normals for a quad mesh (each quad is split along the
 * 0-2 diagonal for the face normal). Degenerate quads (triangles stored with a
 * repeated last vertex) are handled naturally.
 */
export function computeQuadNormals(
  positions: ArrayLike<number>,
  faceVerts: ArrayLike<number>,
  vertexCount: number,
  out: Float32Array = new Float32Array(vertexCount * 3),
  faces?: ArrayLike<number>,
): Float32Array {
  out.fill(0);
  const faceCount = faces ? faces.length : faceVerts.length / 4;
  for (let fi = 0; fi < faceCount; fi++) {
    const f = faces ? faces[fi]! : fi;
    const a = faceVerts[f * 4]!;
    const b = faceVerts[f * 4 + 1]!;
    const c = faceVerts[f * 4 + 2]!;
    const d = faceVerts[f * 4 + 3]!;
    // Newell-style normal of the quad from its two diagonals (robust for non-planar quads).
    const d1x = positions[c * 3]! - positions[a * 3]!;
    const d1y = positions[c * 3 + 1]! - positions[a * 3 + 1]!;
    const d1z = positions[c * 3 + 2]! - positions[a * 3 + 2]!;
    const d2x = positions[d * 3]! - positions[b * 3]!;
    const d2y = positions[d * 3 + 1]! - positions[b * 3 + 1]!;
    const d2z = positions[d * 3 + 2]! - positions[b * 3 + 2]!;
    const nx = d1y * d2z - d1z * d2y;
    const ny = d1z * d2x - d1x * d2z;
    const nz = d1x * d2y - d1y * d2x;
    const corners = d === c ? 3 : 4;
    for (let k = 0; k < corners; k++) {
      const v = faceVerts[f * 4 + k]!;
      out[v * 3] = out[v * 3]! + nx;
      out[v * 3 + 1] = out[v * 3 + 1]! + ny;
      out[v * 3 + 2] = out[v * 3 + 2]! + nz;
    }
  }
  for (let v = 0; v < vertexCount; v++) {
    const x = out[v * 3]!;
    const y = out[v * 3 + 1]!;
    const z = out[v * 3 + 2]!;
    const len = Math.hypot(x, y, z);
    if (len > 1e-20) {
      out[v * 3] = x / len;
      out[v * 3 + 1] = y / len;
      out[v * 3 + 2] = z / len;
    } else {
      out[v * 3 + 1] = 1;
    }
  }
  return out;
}

/** Normals for an indexed triangle mesh. */
export function computeTriangleNormals(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
  vertexCount: number,
  out: Float32Array = new Float32Array(vertexCount * 3),
): Float32Array {
  out.fill(0);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]!;
    const b = indices[t + 1]!;
    const c = indices[t + 2]!;
    const ux = positions[b * 3]! - positions[a * 3]!;
    const uy = positions[b * 3 + 1]! - positions[a * 3 + 1]!;
    const uz = positions[b * 3 + 2]! - positions[a * 3 + 2]!;
    const vx = positions[c * 3]! - positions[a * 3]!;
    const vy = positions[c * 3 + 1]! - positions[a * 3 + 1]!;
    const vz = positions[c * 3 + 2]! - positions[a * 3 + 2]!;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) {
      out[v * 3] = out[v * 3]! + nx;
      out[v * 3 + 1] = out[v * 3 + 1]! + ny;
      out[v * 3 + 2] = out[v * 3 + 2]! + nz;
    }
  }
  for (let v = 0; v < vertexCount; v++) {
    const len = Math.hypot(out[v * 3]!, out[v * 3 + 1]!, out[v * 3 + 2]!);
    if (len > 1e-20) {
      out[v * 3] = out[v * 3]! / len;
      out[v * 3 + 1] = out[v * 3 + 1]! / len;
      out[v * 3 + 2] = out[v * 3 + 2]! / len;
    } else {
      out[v * 3 + 1] = 1;
    }
  }
  return out;
}
