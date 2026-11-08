/**
 * Test garments "modelled around the exported body" (PRD M10). A person would
 * do this in a modelling program; here the geometry is shrink-wrapped by rays
 * onto the exported OBJ. The topology is independent of the body's, and the
 * meshes are dense so that import has to decimate them. These are test
 * fixtures, not art: nothing here ships.
 */
import { TriangleBVH } from '../src/mesh/bvh';
import type { RawGarmentMesh } from '../src/proxy/garment-import';

type Vec3 = [number, number, number];

export interface ObjBody {
  positions: Float32Array;
  triangles: Uint32Array;
  bvh: TriangleBVH;
}

/** Parse the exported base body back from its OBJ text. */
export function parseBodyObj(text: string): ObjBody {
  const pos: number[] = [];
  const tris: number[] = [];
  for (const line of text.split('\n')) {
    const part = line.trim().split(/\s+/);
    if (part[0] === 'v') pos.push(Number(part[1]), Number(part[2]), Number(part[3]));
    else if (part[0] === 'f') {
      const v = part.slice(1).map((c) => Number(c.split('/')[0]) - 1);
      for (let k = 1; k + 1 < v.length; k++) tris.push(v[0]!, v[k]!, v[k + 1]!);
    }
  }
  const positions = Float32Array.from(pos);
  const triangles = Uint32Array.from(tris);
  return { positions, triangles, bvh: new TriangleBVH(positions, triangles) };
}

class MeshBuilder {
  readonly pos: number[] = [];
  readonly uv: number[] = [];
  readonly faces: number[] = [];

  /** Closed-around rings of equal size, joined by quads. Each corner has its own UV entry along the seam. */
  addTube(rings: Vec3[][]): void {
    const segments = rings[0]!.length;
    const first = this.pos.length / 3;
    const firstUv = this.uv.length / 2;
    rings.forEach((ring, r) => {
      for (let s = 0; s < segments; s++) this.pos.push(...ring[s]!);
      for (let s = 0; s <= segments; s++) this.uv.push(s / segments, r / (rings.length - 1));
    });
    const v = (r: number, s: number) => first + r * segments + (s % segments);
    const t = (r: number, s: number) => firstUv + r * (segments + 1) + s;
    for (let r = 0; r + 1 < rings.length; r++) {
      for (let s = 0; s < segments; s++) this.faces.push(v(r, s), v(r, s + 1), v(r + 1, s + 1), v(r + 1, s), t(r, s), t(r, s + 1), t(r + 1, s + 1), t(r + 1, s));
    }
  }

  mesh(): RawGarmentMesh {
    const n = this.faces.length / 8;
    const faceVerts = new Uint32Array(n * 4);
    const faceUvs = new Uint32Array(n * 4);
    for (let f = 0; f < n; f++) {
      faceVerts.set(this.faces.slice(f * 8, f * 8 + 4), f * 4);
      faceUvs.set(this.faces.slice(f * 8 + 4, f * 8 + 8), f * 4);
    }
    return { positions: Float32Array.from(this.pos), uvs: Float32Array.from(this.uv), faceVerts, faceUvs, hasUvs: true };
  }
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Rings around a polyline, each vertex pushed out from the axis to the first skin it meets, plus a gap. */
function wrapTube(body: ObjBody, axis: Vec3[], rings: number, segments: number, gap: number): Vec3[][] {
  const out: Vec3[][] = [];
  for (let r = 0; r < rings; r++) {
    const f = (r / (rings - 1)) * (axis.length - 1);
    const i = Math.min(axis.length - 2, Math.floor(f));
    const centre = lerp(axis[i]!, axis[i + 1]!, f - i);
    const dir = unit(sub(axis[i + 1]!, axis[i]!));
    const u = unit(cross(dir, Math.abs(dir[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0]));
    const v = cross(dir, u);
    const ring: Vec3[] = [];
    let last = 0.05;
    for (let s = 0; s < segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      const d: Vec3 = unit([u[0] * Math.cos(a) + v[0] * Math.sin(a), u[1] * Math.cos(a) + v[1] * Math.sin(a), u[2] * Math.cos(a) + v[2] * Math.sin(a)]);
      const hit = body.bvh.raycast(centre, d, 0, 0.6);
      last = hit ? hit.t : last;
      ring.push([centre[0] + d[0] * (last + gap), centre[1] + d[1] * (last + gap), centre[2] + d[2] * (last + gap)]);
    }
    out.push(ring);
  }
  return out;
}

export interface FixtureJoints {
  head(bone: string): Vec3;
}

const GAP = 0.008;

/** A shirt: torso plus two short sleeves (three separate shells, as many real garments are). */
export function testShirt(body: ObjBody, j: FixtureJoints): RawGarmentMesh {
  const m = new MeshBuilder();
  m.addTube(wrapTube(body, [lerp(j.head('pelvis'), j.head('spine_01'), 0.4), j.head('spine_01'), j.head('spine_02'), lerp(j.head('spine_02'), j.head('spine_03'), 0.7)], 48, 96, GAP));
  for (const side of ['l', 'r']) {
    const a = j.head(`upperarm_${side}`);
    const b = j.head(`lowerarm_${side}`);
    m.addTube(wrapTube(body, [lerp(a, b, 0.25), lerp(a, b, 0.9)], 16, 32, GAP));
  }
  return m.mesh();
}

/** Trousers: two legs from the upper thigh to above the ankle. */
export function testTrousers(body: ObjBody, j: FixtureJoints): RawGarmentMesh {
  const m = new MeshBuilder();
  for (const side of ['l', 'r']) {
    const hip = j.head(`thigh_${side}`);
    const knee = j.head(`calf_${side}`);
    m.addTube(wrapTube(body, [lerp(hip, knee, 0.2), knee, lerp(knee, j.head(`foot_${side}`), 0.85)], 56, 40, GAP));
  }
  return m.mesh();
}

/** A loose knee-length skirt: a cone that clears the widest part of both legs. */
export function testSkirt(body: ObjBody, j: FixtureJoints): RawGarmentMesh {
  const top = lerp(j.head('pelvis'), j.head('spine_01'), 0.2)[1];
  const bottom = j.head('calf_l')[1] + 0.05;
  const cx = 0;
  const cz = j.head('pelvis')[2];
  const segments = 72;
  const rows = 28;
  const reach: number[][] = [];
  for (let r = 0; r < rows; r++) {
    const y = top + ((bottom - top) * r) / (rows - 1);
    const row = new Array<number>(segments).fill(0);
    for (let v = 0; v < body.positions.length / 3; v++) {
      const x = body.positions[v * 3]! - cx;
      const z = body.positions[v * 3 + 2]! - cz;
      // Legs and hips only: the arms hang outside this range.
      if (Math.abs(body.positions[v * 3 + 1]! - y) > 0.06 || Math.abs(x) > 0.24) continue;
      const s = Math.floor(((Math.atan2(z, x) + Math.PI) / (Math.PI * 2)) * segments) % segments;
      row[s] = Math.max(row[s]!, Math.hypot(x, z));
    }
    reach.push(row);
  }
  const rings: Vec3[][] = [];
  let widest = 0;
  for (let r = 0; r < rows; r++) {
    const y = top + ((bottom - top) * r) / (rows - 1);
    const ring: Vec3[] = [];
    widest = Math.max(widest, ...reach[r]!);
    for (let s = 0; s < segments; s++) {
      const near = Math.max(reach[r]![(s + segments - 1) % segments]!, reach[r]![s]!, reach[r]![(s + 1) % segments]!);
      // It flares from the hips, so it never follows the legs inwards.
      const radius = Math.max(near, r / (rows - 1) > 0.25 ? widest * 0.96 : near) + 0.015;
      const a = ((s + 0.5) / segments) * Math.PI * 2 - Math.PI;
      ring.push([cx + Math.cos(a) * radius, y, cz + Math.sin(a) * radius]);
    }
    rings.push(ring);
  }
  const m = new MeshBuilder();
  m.addTube(rings);
  return m.mesh();
}

/** As Wavefront OBJ, the way a modelling program would write it. */
export function meshToObj(mesh: RawGarmentMesh, name: string): string {
  const lines = [`o ${name}`];
  for (let i = 0; i < mesh.positions.length; i += 3) lines.push(`v ${mesh.positions[i]!.toFixed(6)} ${mesh.positions[i + 1]!.toFixed(6)} ${mesh.positions[i + 2]!.toFixed(6)}`);
  for (let i = 0; i < mesh.uvs.length; i += 2) lines.push(`vt ${mesh.uvs[i]!.toFixed(6)} ${mesh.uvs[i + 1]!.toFixed(6)}`);
  for (let f = 0; f < mesh.faceVerts.length; f += 4) {
    const c = (k: number) => `${mesh.faceVerts[f + k]! + 1}/${mesh.faceUvs[f + k]! + 1}`;
    lines.push(`f ${c(0)} ${c(1)} ${c(2)} ${c(3)}`);
  }
  return lines.join('\n') + '\n';
}
