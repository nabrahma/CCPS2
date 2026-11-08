/**
 * Convert a quad mesh with separate vertex/UV indices (OBJ style) into a
 * render mesh: one render vertex per (vertex, uv) pair, triangle indices.
 * Smooth normals are computed on the original vertices (so UV seams do not
 * show as lighting seams) and gathered per render vertex.
 */
export interface RenderTopology {
  /** Source (geometry) vertex per render vertex. */
  sourceVertex: Uint32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  /** Source quad per triangle (for face masking). */
  triangleFace: Uint32Array;
  /** Triangles in source-vertex space (for smooth normals). */
  sourceIndices: Uint32Array;
}

export function buildRenderTopology(
  faceVerts: ArrayLike<number>,
  faceUvs: ArrayLike<number>,
  uvs: ArrayLike<number>,
  faces?: ArrayLike<number>,
): RenderTopology {
  const key = new Map<number, number>();
  const src: number[] = [];
  const uvIdx: number[] = [];
  const tris: number[] = [];
  const srcTris: number[] = [];
  const triFace: number[] = [];
  const faceCount = faces ? faces.length : faceVerts.length / 4;
  const vertexFor = (v: number, t: number): number => {
    const k = v * 1048576 + t;
    let id = key.get(k);
    if (id === undefined) {
      id = src.length;
      key.set(k, id);
      src.push(v);
      uvIdx.push(t);
    }
    return id;
  };
  for (let fi = 0; fi < faceCount; fi++) {
    const f = faces ? faces[fi]! : fi;
    const v = [faceVerts[f * 4]!, faceVerts[f * 4 + 1]!, faceVerts[f * 4 + 2]!, faceVerts[f * 4 + 3]!];
    const t = [faceUvs[f * 4]!, faceUvs[f * 4 + 1]!, faceUvs[f * 4 + 2]!, faceUvs[f * 4 + 3]!];
    const r = v.map((x, k) => vertexFor(x, t[k]!));
    tris.push(r[0]!, r[1]!, r[2]!);
    srcTris.push(v[0]!, v[1]!, v[2]!);
    triFace.push(f);
    if (v[3] !== v[2]) {
      tris.push(r[0]!, r[2]!, r[3]!);
      srcTris.push(v[0]!, v[2]!, v[3]!);
      triFace.push(f);
    }
  }
  const outUvs = new Float32Array(src.length * 2);
  uvIdx.forEach((t, i) => {
    outUvs[i * 2] = uvs[t * 2]!;
    outUvs[i * 2 + 1] = uvs[t * 2 + 1]!;
  });
  return {
    sourceVertex: Uint32Array.from(src),
    uvs: outUvs,
    indices: Uint32Array.from(tris),
    triangleFace: Uint32Array.from(triFace),
    sourceIndices: Uint32Array.from(srcTris),
  };
}

/** out[i] = values[map[i]] for xyz triplets. */
export function gather3(values: ArrayLike<number>, map: ArrayLike<number>, out: Float32Array): Float32Array {
  for (let i = 0; i < map.length; i++) {
    const s = map[i]! * 3;
    out[i * 3] = values[s]!;
    out[i * 3 + 1] = values[s + 1]!;
    out[i * 3 + 2] = values[s + 2]!;
  }
  return out;
}
