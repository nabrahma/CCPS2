/**
 * Body region classification on the rest hm08 mesh (PRD F2 region rules).
 * Regions are derived from MakeHuman joint cubes so they follow the mesh
 * definition rather than magic vertex lists.
 */
import type { BaseMesh } from '@ps2cc/core';

export const REGIONS = ['body', 'head', 'face', 'hands', 'opening', 'loop'] as const;
export type Region = (typeof REGIONS)[number];
export const REGION_ID: Record<Region, number> = { body: 0, head: 1, face: 2, hands: 3, opening: 4, loop: 5 };

type V3 = [number, number, number];

export function jointPosition(base: BaseMesh, name: string): V3 {
  const verts = base.vertexGroup(name);
  const p: V3 = [0, 0, 0];
  for (const v of verts) for (let k = 0; k < 3; k++) p[k] = p[k]! + base.positions[v * 3 + k]!;
  return p.map((x) => x / verts.length) as V3;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3) => Math.hypot(...a);
const norm = (a: V3): V3 => {
  const l = len(a);
  return [a[0] / l, a[1] / l, a[2] / l];
};

/**
 * Classify body vertices (0..bodyVertexCount-1). Returns one region id per
 * vertex. "opening" (eye/mouth rims) and "loop" (joint edge loops) override
 * the coarser regions because they are always locked.
 */
export function classifyBody(base: BaseMesh): Uint8Array {
  const n = base.bodyVertexCount;
  const out = new Uint8Array(n);
  const P = (v: number): V3 => [base.positions[v * 3]!, base.positions[v * 3 + 1]!, base.positions[v * 3 + 2]!];

  const head = jointPosition(base, 'joint-head');
  const headTop = jointPosition(base, 'joint-head-2');
  const eyeL = jointPosition(base, 'joint-l-eye');
  const eyeR = jointPosition(base, 'joint-r-eye');
  const mouth = jointPosition(base, 'joint-mouth');
  const jaw = jointPosition(base, 'joint-jaw');

  // Face box: from below the jaw to above the brows, in front of the ears.
  const browY = eyeL[1] + 0.035;
  const faceTop = browY + 0.45 * (headTop[1] - browY);
  const chinY = jaw[1] - 0.03;
  const earX = Math.abs(eyeL[0]) + 0.045;

  const loops: { at: V3; axis: V3; radius: number }[] = [];
  for (const side of ['l', 'r'] as const) {
    const sh = jointPosition(base, `joint-${side}-shoulder`);
    const el = jointPosition(base, `joint-${side}-elbow`);
    const wr = jointPosition(base, `joint-${side}-hand`);
    const hip = jointPosition(base, `joint-${side}-upper-leg`);
    const kn = jointPosition(base, `joint-${side}-knee`);
    const an = jointPosition(base, `joint-${side}-ankle`);
    loops.push({ at: sh, axis: norm(sub(el, sh)), radius: 0.09 });
    loops.push({ at: el, axis: norm(sub(wr, el)), radius: 0.07 });
    loops.push({ at: hip, axis: norm(sub(kn, hip)), radius: 0.12 });
    loops.push({ at: kn, axis: norm(sub(an, kn)), radius: 0.09 });
  }

  const hands = (['l', 'r'] as const).map((side) => {
    const el = jointPosition(base, `joint-${side}-elbow`);
    const wr = jointPosition(base, `joint-${side}-hand`);
    return { wrist: wr, axis: norm(sub(wr, el)) };
  });

  for (let v = 0; v < n; v++) {
    const p = P(v);
    let region: Region = 'body';
    const inHead = p[1] > head[1] - 0.01 && Math.abs(p[0]) < 0.14;
    if (inHead) {
      region = 'head';
      const front = p[2] > head[2] + 0.015;
      const earFront = Math.abs(p[0]) > earX - 0.03 && Math.abs(p[0]) < earX + 0.04 && p[2] > head[2] - 0.01 &&
        p[1] < browY + 0.01 && p[1] > mouth[1] - 0.01;
      if ((front && p[1] < faceTop && p[1] > chinY && Math.abs(p[0]) < earX) || earFront) region = 'face';
    }
    for (const h of hands) {
      if (dot(sub(p, h.wrist), h.axis) > -0.01 && len(sub(p, h.wrist)) < 0.25) region = 'hands';
    }
    for (const l of loops) {
      const d = sub(p, l.at);
      const along = dot(d, l.axis);
      const radial = len(sub(d, [l.axis[0] * along, l.axis[1] * along, l.axis[2] * along]));
      if (Math.abs(along) < 0.006 && radial < l.radius) region = 'loop';
    }
    if (len(sub(p, eyeL)) < 0.022 || len(sub(p, eyeR)) < 0.022 || len(sub(p, mouth)) < 0.03) region = 'opening';
    out[v] = REGION_ID[region];
  }
  // Mouth and eye corners (PRD F2: "lock vertices near eye and mouth openings"). The rims are
  // UV seams and already locked on the head (D-007), but joint-mouth sits about 8 cm back
  // inside the mouth, so nothing kept the lip-corner crease: the 8k tier moved one mouth corner.
  const corners = openingCorners(base);
  for (let v = 0; v < n; v++) {
    if (out[v] === REGION_ID.hands || out[v] === REGION_ID.loop) continue;
    const p = P(v);
    if (corners.some((c) => (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2 < c[3] ** 2)) out[v] = REGION_ID.opening;
  }
  return out;
}

/** Vertices within this distance of an eye corner / a mouth corner are locked . */
export const EYE_CORNER_LOCK = 0.005;
export const MOUTH_CORNER_LOCK = 0.005;

/** The two horizontal extremes of each opening rim (eye and mouth corners), with their lock radius. */
export function openingCorners(base: BaseMesh): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  for (const rim of openingRimGroups(base)) {
    const sorted = [...rim].sort((a, b) => a[0] - b[0]);
    // The mouth rim straddles the midline; eye rims do not.
    const r = sorted[0]![0] < 0 && sorted[sorted.length - 1]![0] > 0 ? MOUTH_CORNER_LOCK : EYE_CORNER_LOCK;
    out.push([...sorted[0]!, r], [...sorted[sorted.length - 1]!, r]);
  }
  return out;
}

/**
 * Rim vertices of the eye and mouth openings: hm08 vertices shared between the
 * face UV island and the small head islands (eye sockets, mouth interior).
 * Measured on the pinned mesh: two eye rims of 28 vertices and a lip line of 38.
 */
export function openingRims(base: BaseMesh): V3[] {
  return openingRimGroups(base).flat();
}

/** Rim vertices per opening (one group per eye and one for the mouth). */
export function openingRimGroups(base: BaseMesh): V3[][] {
  const faces = base.facesWhere((g) => g === 'body');
  const parent = new Map<number, number>(faces.map((f) => [f, f]));
  const find = (x: number): number => {
    while (parent.get(x) !== x) x = parent.get(x)!;
    return x;
  };
  const owner = new Map<string, number>();
  for (const f of faces) {
    const k = base.faceVerts[f * 4 + 3] === base.faceVerts[f * 4 + 2] ? 3 : 4;
    for (let i = 0; i < k; i++) {
      const a = base.faceUvs[f * 4 + i]!;
      const b = base.faceUvs[f * 4 + ((i + 1) % k)]!;
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      const g = owner.get(key);
      if (g === undefined) owner.set(key, f);
      else if (find(g) !== find(f)) parent.set(find(g), find(f));
    }
  }
  const islands = new Map<number, Set<number>>();
  for (const f of faces) {
    const r = find(f);
    const set = islands.get(r) ?? new Set<number>();
    for (let i = 0; i < 4; i++) set.add(base.faceVerts[f * 4 + i]!);
    islands.set(r, set);
  }
  const neckY = jointPosition(base, 'joint-neck')[1];
  const list = [...islands.values()];
  const size = (s: Set<number>) => s.size;
  const headIslands = list.filter((s) => [...s].every((v) => base.positions[v * 3 + 1]! > neckY - 0.02));
  const face = headIslands.reduce((a, b) => (size(a) >= size(b) ? a : b));
  const groups: V3[][] = [];
  for (const s of headIslands) {
    if (s === face) continue;
    const rim: V3[] = [];
    for (const v of s) if (face.has(v)) rim.push([base.positions[v * 3]!, base.positions[v * 3 + 1]!, base.positions[v * 3 + 2]!]);
    if (rim.length > 0) groups.push(rim);
  }
  return groups;
}
