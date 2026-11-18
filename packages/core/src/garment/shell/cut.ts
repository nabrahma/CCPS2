/**
 * Region selection and hems (PRD Part 3, F28 steps 1 and 2). A garment keeps
 * the body where every constraint that applies to a vertex's body part is
 * non-negative; vertices of parts outside the garment's domain are outside.
 * Triangles are split exactly where the field crosses zero, so each hem is a
 * clean boundary loop: on a plane for a straight hem, on a curve for a
 * neckline.
 */
import type { ShellBody } from './body';
import { WorkMesh } from './mesh';
import { normalize, type Vec3 } from './vec';

export interface Constraint {
  /** Name of the hem or opening this constraint makes ('hem', 'neck', 'cuff_l', ...). */
  id: string;
  /** Body parts it applies to (SEGMENTS indices). */
  segments: readonly number[];
  /** If set, it applies only to vertices whose dominant bone is one of these (rig bone indices). */
  bones?: readonly number[];
  /** Signed value at a point of a body part: >= 0 keeps it. Metres, so bands can be measured from the hem. */
  value(p: Vec3, seg: number): number;
}

/** Value given to body parts outside the garment's domain. */
const OUTSIDE = -0.05;
const EPS = 1e-6;


/** Field value and active constraint of a body point. */
function evaluate(p: Vec3, seg: number, bone: number, domain: ReadonlySet<number>, constraints: readonly Constraint[]): [number, number] {
  if (!domain.has(seg)) return [OUTSIDE, -1];
  let f = Infinity;
  let which = -1;
  for (let i = 0; i < constraints.length; i++) {
    const c = constraints[i]!;
    if (!c.segments.includes(seg)) continue;
    if (c.bones && !c.bones.includes(bone)) continue;
    const v = c.value(p, seg);
    if (v < f) {
      f = v;
      which = i;
    }
  }
  if (which < 0) return [1, -1];
  // Never exactly zero: a vertex on the cut would make zero-area triangles.
  if (Math.abs(f) < EPS) f = f < 0 ? -EPS : EPS;
  return [f, which];
}

/** The cut field of a body: value and deciding constraint per shell vertex. */
export interface CutField {
  f: Float64Array;
  act: Int32Array;
}

export function cutField(body: ShellBody, domain: readonly number[], constraints: readonly Constraint[]): CutField {
  const n = body.positions.length / 3;
  const dom = new Set(domain);
  const f = new Float64Array(n);
  const act = new Int32Array(n);
  for (let v = 0; v < n; v++) {
    const p: Vec3 = [body.positions[v * 3]!, body.positions[v * 3 + 1]!, body.positions[v * 3 + 2]!];
    const [val, which] = evaluate(p, body.segment[v]!, body.bone[v]!, dom, constraints);
    f[v] = val;
    act[v] = which;
  }
  return { f, act };
}

/**
 * Cut the shell body to the garment's region. With `field` (the reference
 * body's), the cut is the same on any body: the same edges are split at the
 * same fractions, so the topology never depends on the body's shape.
 */
export function cutBody(body: ShellBody, domain: readonly number[], constraints: readonly Constraint[], field?: CutField): WorkMesh {
  const n = body.positions.length / 3;
  const { f, act } = field ?? cutField(body, domain, constraints);
  const mesh = new WorkMesh();
  const panel = mesh.panelId('main');
  const kept = new Int32Array(n).fill(-1);
  const keep = (v: number): number => {
    let i = kept[v]!;
    if (i < 0) {
      i = mesh.addVertex(
        [body.positions[v * 3]!, body.positions[v * 3 + 1]!, body.positions[v * 3 + 2]!],
        [body.normals[v * 3]!, body.normals[v * 3 + 1]!, body.normals[v * 3 + 2]!],
        body.segment[v]!,
        0,
        v,
      );
      kept[v] = i;
      mesh.hem[i] = act[v]!;
      mesh.dist[i] = f[v]!;
    }
    return i;
  };
  const splits = new Map<number, number>();
  /** The point where the field crosses zero on edge a (inside) - b (outside). */
  const split = (a: number, b: number): number => {
    const key = Math.min(a, b) * n + Math.max(a, b);
    let i = splits.get(key);
    if (i === undefined) {
      const t = f[a]! / (f[a]! - f[b]!);
      const P = body.positions;
      const N = body.normals;
      const p: Vec3 = [P[a * 3]! + (P[b * 3]! - P[a * 3]!) * t, P[a * 3 + 1]! + (P[b * 3 + 1]! - P[a * 3 + 1]!) * t, P[a * 3 + 2]! + (P[b * 3 + 2]! - P[a * 3 + 2]!) * t];
      const nn = normalize([N[a * 3]! + (N[b * 3]! - N[a * 3]!) * t, N[a * 3 + 1]! + (N[b * 3 + 1]! - N[a * 3 + 1]!) * t, N[a * 3 + 2]! + (N[b * 3 + 2]! - N[a * 3 + 2]!) * t]);
      i = mesh.addVertex(p, nn, body.segment[a]!, 0, -1);
      // The cut's constraint: the one that made the outside vertex outside (or the inside one's).
      mesh.hem[i] = act[b]! >= 0 ? act[b]! : act[a]!;
      mesh.dist[i] = 0;
      splits.set(key, i);
    }
    return i;
  };
  const T = body.tris;
  for (let t = 0; t < T.length; t += 3) {
    const v = [T[t]!, T[t + 1]!, T[t + 2]!];
    const inside = v.map((x) => f[x]! >= 0);
    const count = inside.filter(Boolean).length;
    if (count === 0) continue;
    if (count === 3) {
      mesh.addTri(keep(v[0]!), keep(v[1]!), keep(v[2]!), panel);
      continue;
    }
    // Rotate so the odd one out is first, keeping the winding.
    const r = count === 1 ? inside.indexOf(true) : inside.indexOf(false);
    const a = v[r]!;
    const b = v[(r + 1) % 3]!;
    const c = v[(r + 2) % 3]!;
    if (count === 1) {
      // a inside: one triangle.
      mesh.addTri(keep(a), split(a, b), split(a, c), panel);
    } else {
      // a outside, b and c inside: a quad.
      const ab = split(b, a);
      const ac = split(c, a);
      mesh.addTri(ab, keep(b), keep(c), panel);
      mesh.addTri(ab, keep(c), ac, panel);
    }
  }
  return mesh;
}
