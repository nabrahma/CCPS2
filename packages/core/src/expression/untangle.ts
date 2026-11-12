/**
 * Untangle a blendshape. MakeHuman's face rig can fold the skin where it
 * compresses: opening the jaw on some faces folds the skin under the chin
 * (its own full-density mesh shows the same folds). Coarse body tiers hid it;
 * the full-head tiers of the quality profiles (Part 2 F13) do not. Where a
 * triangle turns over, its corners' deltas are pulled towards their
 * neighbours' until nothing turns over, so the shape stays smooth.
 */

export interface UntangleMesh {
  /** Triangles to test: both diagonals of every quad, so any later triangulation passes. */
  tris: Uint32Array;
  /** Neighbours per vertex (quad edges), CSR. */
  start: Uint32Array;
  next: Uint32Array;
}

/** Build the test triangles and neighbours from quads (faceVerts, 4 per face; a triangle repeats its last vertex). */
export function untangleMesh(faceVerts: ArrayLike<number>, faces: number[], vertexCount: number): UntangleMesh {
  const tris: number[] = [];
  const nb: Set<number>[] = Array.from({ length: vertexCount }, () => new Set<number>());
  for (const f of faces) {
    const q = [faceVerts[f * 4]!, faceVerts[f * 4 + 1]!, faceVerts[f * 4 + 2]!, faceVerts[f * 4 + 3]!];
    const k = q[3] === q[2] ? 3 : 4;
    if (k === 3) tris.push(q[0]!, q[1]!, q[2]!);
    else tris.push(q[0]!, q[1]!, q[2]!, q[0]!, q[2]!, q[3]!, q[0]!, q[1]!, q[3]!, q[1]!, q[2]!, q[3]!);
    for (let i = 0; i < k; i++) {
      const a = q[i]!;
      const b = q[(i + 1) % k]!;
      nb[a]!.add(b);
      nb[b]!.add(a);
    }
  }
  const start = new Uint32Array(vertexCount + 1);
  for (let v = 0; v < vertexCount; v++) start[v + 1] = start[v]! + nb[v]!.size;
  const next = new Uint32Array(start[vertexCount]!);
  for (let v = 0; v < vertexCount; v++) next.set([...nb[v]!], start[v]!);
  return { tris: Uint32Array.from(tris), start, next };
}

/** The same from a triangle list (a body tier's triangles, in base-mesh vertex ids). */
export function untangleMeshFromTriangles(indices: ArrayLike<number>, vertexCount: number): UntangleMesh {
  const nb: Set<number>[] = Array.from({ length: vertexCount }, () => new Set<number>());
  const tris: number[] = [];
  for (let t = 0; t < indices.length; t += 3) {
    const q = [indices[t]!, indices[t + 1]!, indices[t + 2]!];
    if (q[0] === q[1] || q[1] === q[2] || q[0] === q[2]) continue;
    tris.push(q[0]!, q[1]!, q[2]!);
    for (let i = 0; i < 3; i++) {
      nb[q[i]!]!.add(q[(i + 1) % 3]!);
      nb[q[(i + 1) % 3]!]!.add(q[i]!);
    }
  }
  const start = new Uint32Array(vertexCount + 1);
  for (let v = 0; v < vertexCount; v++) start[v + 1] = start[v]! + nb[v]!.size;
  const next = new Uint32Array(start[vertexCount]!);
  for (let v = 0; v < vertexCount; v++) next.set([...nb[v]!], start[v]!);
  return { tris: Uint32Array.from(tris), start, next };
}

/** Both meshes' triangles and neighbours (untangled together, so fixing one cannot break the other). */
export function mergeUntangleMeshes(a: UntangleMesh, b: UntangleMesh): UntangleMesh {
  const n = a.start.length - 1;
  const start = new Uint32Array(n + 1);
  const lists: number[][] = [];
  for (let v = 0; v < n; v++) {
    const s = new Set<number>();
    for (let k = a.start[v]!; k < a.start[v + 1]!; k++) s.add(a.next[k]!);
    for (let k = b.start[v]!; k < b.start[v + 1]!; k++) s.add(b.next[k]!);
    lists.push([...s]);
    start[v + 1] = start[v]! + s.size;
  }
  const next = new Uint32Array(start[n]!);
  for (let v = 0; v < n; v++) next.set(lists[v]!, start[v]!);
  const tris = new Uint32Array(a.tris.length + b.tris.length);
  tris.set(a.tris);
  tris.set(b.tris, a.tris.length);
  return { tris, start, next };
}

function turned(p: ArrayLike<number>, d: ArrayLike<number>, a: number, b: number, c: number): boolean {
  const ax = p[a * 3]!, ay = p[a * 3 + 1]!, az = p[a * 3 + 2]!;
  const ux = p[b * 3]! - ax, uy = p[b * 3 + 1]! - ay, uz = p[b * 3 + 2]! - az;
  const vx = p[c * 3]! - ax, vy = p[c * 3 + 1]! - ay, vz = p[c * 3 + 2]! - az;
  const qax = ax + d[a * 3]!, qay = ay + d[a * 3 + 1]!, qaz = az + d[a * 3 + 2]!;
  const sx = p[b * 3]! + d[b * 3]! - qax, sy = p[b * 3 + 1]! + d[b * 3 + 1]! - qay, sz = p[b * 3 + 2]! + d[b * 3 + 2]! - qaz;
  const tx = p[c * 3]! + d[c * 3]! - qax, ty = p[c * 3 + 1]! + d[c * 3 + 1]! - qay, tz = p[c * 3 + 2]! + d[c * 3 + 2]! - qaz;
  const n0 = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
  const n1 = [sy * tz - sz * ty, sz * tx - sx * tz, sx * ty - sy * tx];
  return n0[0]! * n1[0]! + n0[1]! * n1[1]! + n0[2]! * n1[2]! < 0;
}

/**
 * Smooth `delta` (in place) where triangles of `mesh` turn over, on vertices
 * `allow` accepts. Returns the number of turned triangles left.
 */
export function untangleDeltas(
  positions: ArrayLike<number>,
  delta: Float32Array,
  mesh: UntangleMesh,
  allow: (v: number) => boolean,
  maxIterations = 40,
): number {
  const { tris, start, next } = mesh;
  // Only triangles the shape moves can turn over.
  const live: number[] = [];
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t]!, b = tris[t + 1]!, c = tris[t + 2]!;
    if (delta[a * 3] || delta[a * 3 + 1] || delta[a * 3 + 2] || delta[b * 3] || delta[b * 3 + 1] || delta[b * 3 + 2] || delta[c * 3] || delta[c * 3 + 1] || delta[c * 3 + 2]) live.push(t);
  }
  let left = 0;
  for (let it = 0; it <= maxIterations; it++) {
    const bad = new Set<number>();
    left = 0;
    for (const t of live) {
      const a = tris[t]!, b = tris[t + 1]!, c = tris[t + 2]!;
      if (!turned(positions, delta, a, b, c)) continue;
      left++;
      for (const v of [a, b, c]) {
        if (!allow(v)) continue;
        bad.add(v);
        // Widen to the one-ring, so the fold relaxes into its surroundings rather than moving next door.
        for (let k = start[v]!; k < start[v + 1]!; k++) if (allow(next[k]!)) bad.add(next[k]!);
      }
    }
    if (left === 0 || it === maxIterations || bad.size === 0) break;
    const avg = new Float32Array(bad.size * 3);
    let i = 0;
    for (const v of bad) {
      const n = start[v + 1]! - start[v]!;
      let x = 0, y = 0, z = 0;
      for (let k = start[v]!; k < start[v + 1]!; k++) {
        const u = next[k]!;
        x += delta[u * 3]!;
        y += delta[u * 3 + 1]!;
        z += delta[u * 3 + 2]!;
      }
      avg[i * 3] = n ? 0.5 * delta[v * 3]! + (0.5 * x) / n : delta[v * 3]!;
      avg[i * 3 + 1] = n ? 0.5 * delta[v * 3 + 1]! + (0.5 * y) / n : delta[v * 3 + 1]!;
      avg[i * 3 + 2] = n ? 0.5 * delta[v * 3 + 2]! + (0.5 * z) / n : delta[v * 3 + 2]!;
      i++;
    }
    i = 0;
    for (const v of bad) {
      delta[v * 3] = avg[i * 3]!;
      delta[v * 3 + 1] = avg[i * 3 + 1]!;
      delta[v * 3 + 2] = avg[i * 3 + 2]!;
      i++;
    }
  }
  return left;
}
