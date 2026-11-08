import type { InfluenceTable } from './weights';
import { MAX_INFLUENCES } from './weights';

/**
 * Linear blend skinning on the CPU (preview pose test and export checks).
 * `skin` holds one column-major 4x4 skinning matrix per bone.
 */
export function skinPositions(
  rest: Float32Array,
  influences: InfluenceTable,
  skin: Float64Array,
  out: Float32Array = new Float32Array(rest.length),
  restNormals?: Float32Array,
  outNormals?: Float32Array,
): Float32Array {
  const n = influences.vertexCount;
  for (let v = 0; v < n; v++) {
    const x = rest[v * 3]!;
    const y = rest[v * 3 + 1]!;
    const z = rest[v * 3 + 2]!;
    let px = 0;
    let py = 0;
    let pz = 0;
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (let k = 0; k < MAX_INFLUENCES; k++) {
      const w = influences.weights[v * MAX_INFLUENCES + k]!;
      if (w === 0) continue;
      const m = influences.joints[v * MAX_INFLUENCES + k]! * 16;
      px += w * (skin[m]! * x + skin[m + 4]! * y + skin[m + 8]! * z + skin[m + 12]!);
      py += w * (skin[m + 1]! * x + skin[m + 5]! * y + skin[m + 9]! * z + skin[m + 13]!);
      pz += w * (skin[m + 2]! * x + skin[m + 6]! * y + skin[m + 10]! * z + skin[m + 14]!);
      if (restNormals) {
        const a = restNormals[v * 3]!;
        const b = restNormals[v * 3 + 1]!;
        const c = restNormals[v * 3 + 2]!;
        nx += w * (skin[m]! * a + skin[m + 4]! * b + skin[m + 8]! * c);
        ny += w * (skin[m + 1]! * a + skin[m + 5]! * b + skin[m + 9]! * c);
        nz += w * (skin[m + 2]! * a + skin[m + 6]! * b + skin[m + 10]! * c);
      }
    }
    out[v * 3] = px;
    out[v * 3 + 1] = py;
    out[v * 3 + 2] = pz;
    if (restNormals && outNormals) {
      const l = Math.hypot(nx, ny, nz) || 1;
      outNormals[v * 3] = nx / l;
      outNormals[v * 3 + 1] = ny / l;
      outNormals[v * 3 + 2] = nz / l;
    }
  }
  return out;
}
