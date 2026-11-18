/**
 * Boots and shoes (PRD Part 3, F28): the foot and calf shell built as rings.
 * Each ring is a horizontal slice of the body's foot and calf, made convex
 * (the cloth or leather bridges between the toes and over the arch), offset
 * by the ease and sampled at even angles, so consecutive rings line up and
 * the boot gets the clean, chunky low-poly form of era footwear. The toes
 * count as taller by the toe-box height, so the upper rises over them, and a
 * sole slab (`addSoleSlab`) goes under the whole footprint. Socks are the same
 * rings, close over the foot, without a slab.
 */
import { cos, sin, TAU } from '../../math/dmath';
import { SEG, type ShellBody } from './body';
import { addFanCap, addSoleSlab } from './features';
import { landmarks, SIDES, type Side } from './landmarks';
import { FIXED, LOFT, WorkMesh } from './mesh';
import { hull2d } from './shape';
import { dot, normalize, sub } from './vec';

export interface BootOptions {
  /** Top of the shaft above the ankle (metres). */
  height: number;
  ease: number;
  shaftEase: number;
  sole: number;
  welt: number;
  toeBox: number;
  /** Vertices around each ring. */
  around: number;
  /** Hem index given to the top loops, per side. */
  hem: Record<Side, number>;
  /** A sole slab under the footprint (default); socks have none. */
  slab?: boolean;
  /**
   * Rings below this height keep their place (clear by construction: pushed one by one off the sole they would go
   * through the floor on a heavy foot); default just above the ankle.
   */
  fixedBelow?: number;
}

/** Distance from (cx, cz) along direction (dx, dz) to the edge of a convex polygon. */
export function reach(hx: number[], hz: number[], cx: number, cz: number, dx: number, dz: number): number {
  let best = 0;
  const k = hx.length;
  for (let i = 0; i < k; i++) {
    const ax = hx[i]! - cx;
    const az = hz[i]! - cz;
    const bx = hx[(i + 1) % k]! - cx;
    const bz = hz[(i + 1) % k]! - cz;
    const ex = bx - ax;
    const ez = bz - az;
    const den = dx * ez - dz * ex;
    if (Math.abs(den) < 1e-15) continue;
    const t = (ax * ez - az * ex) / den;
    const s = (ax * dz - az * dx) / den;
    if (t > 0 && s >= -1e-9 && s <= 1 + 1e-9) best = Math.max(best, t);
  }
  return best;
}

export function buildBoots(body: ShellBody, o: BootOptions): WorkMesh {
  const L = landmarks(body);
  const m = new WorkMesh();
  const P = body.positions;
  const n = P.length / 3;
  const ySole = L.ground + o.sole;
  for (const s of SIDES) {
    const footSeg = SEG[`foot_${s}`];
    const calfSeg = SEG[`calf_${s}`];
    const heel = L.foot[s].head;
    const toeBone = body.boneNames.indexOf(`ball_${s}`);
    const toe: [number, number, number] = [body.skeleton.tails[toeBone * 3]!, body.skeleton.tails[toeBone * 3 + 1]!, body.skeleton.tails[toeBone * 3 + 2]!];
    const fwd = normalize([toe[0] - heel[0], 0, toe[2] - heel[2]]);
    const footLen = dot(sub(toe, heel), fwd);
    // Heights of this foot's and calf's vertices, with the toes counted taller (the toe box).
    const yEff = new Float64Array(n).fill(NaN);
    for (let v = 0; v < n; v++) {
      const seg = body.segment[v]!;
      if (seg !== footSeg && seg !== calfSeg) continue;
      const x = P[v * 3]!;
      const z = P[v * 3 + 2]!;
      const t = ((x - heel[0]) * fwd[0] + (z - heel[2]) * fwd[2]) / footLen;
      const k = Math.max(0, Math.min(1, (t - 0.45) / 0.35));
      yEff[v] = P[v * 3 + 1]! + o.toeBox * k * k * (3 - 2 * k);
    }
    /**
     * The body's outline at a height: where its triangles cross it, at their real
     * heights and at the toe box's (so the upper rises over the toes and never
     * cuts into the foot), plus (low on the foot) everything below.
     */
    const outline = (h: number, below: boolean): { xs: number[]; zs: number[] } => {
      const xs: number[] = [];
      const zs: number[] = [];
      const T = body.tris;
      for (let t = 0; t < T.length; t += 3) {
        const v = [T[t]!, T[t + 1]!, T[t + 2]!];
        if (v.some((x) => Number.isNaN(yEff[x]!))) continue;
        for (let k = 0; k < 3; k++) {
          const a = v[k]!;
          const b = v[(k + 1) % 3]!;
          for (const [ya, yb] of [
            [yEff[a]!, yEff[b]!],
            [P[a * 3 + 1]!, P[b * 3 + 1]!],
          ] as const) {
            if ((ya - h) * (yb - h) < 0) {
              const f = (h - ya) / (yb - ya);
              xs.push(P[a * 3]! + (P[b * 3]! - P[a * 3]!) * f);
              zs.push(P[a * 3 + 2]! + (P[b * 3 + 2]! - P[a * 3 + 2]!) * f);
            }
          }
        }
      }
      if (below) {
        for (let v = 0; v < n; v++) {
          // Up to 2 cm over the ground too: a ring at the sole holds the heel's and the toes' bulge above it.
          if (!Number.isNaN(yEff[v]!) && yEff[v]! < Math.max(h, L.ground + 0.02) && yEff[v]! > h - 0.03) {
            xs.push(P[v * 3]!);
            zs.push(P[v * 3 + 2]!);
          }
        }
      }
      return { xs, zs };
    };
    const ankle = L.ankle[s].y;
    const top = ankle + o.height;
    // Ring heights: tight near the ground (toe cap, instep), wider apart up the shaft.
    const heights = [ySole - 0.002, ySole + 0.006, ySole + 0.016, ySole + 0.028, ySole + 0.042, ySole + 0.058, ankle - 0.012, ankle + 0.015];
    // Shaft rings: a count from the height alone, so every body gets the same rings.
    const shaft = Math.max(0, Math.ceil((o.height - 0.07) / 0.045));
    for (let k = 1; k <= shaft; k++) heights.push(ankle + 0.05 + ((top - 0.02 - (ankle + 0.05)) * (k - 1)) / Math.max(1, shaft));
    heights.push(Math.max(top, heights[heights.length - 1]! + 0.01));
    const rings: number[][] = [];
    let last: { xs: number[]; zs: number[] } | null = null;
    for (const h of heights) {
      // A ring at or under the ground (a sock's) takes the footprint just above it.
      let { xs, zs } = outline(Math.max(h, L.ground + 0.004), h < ySole + 0.03);
      // A ring above the leg (a very tall boot on a short body) keeps the outline below.
      if (xs.length < 3 && last) ({ xs, zs } = last);
      if (xs.length < 3) continue;
      last = { xs, zs };
      const hull = hull2d(xs, zs);
      const hx = hull.map((i) => xs[i]!);
      const hz = hull.map((i) => zs[i]!);
      let cx = 0;
      let cz = 0;
      for (let i = 0; i < hx.length; i++) {
        cx += hx[i]!;
        cz += hz[i]!;
      }
      cx /= hx.length;
      cz /= hx.length;
      const ease = h > ankle + 0.02 ? o.shaftEase : o.ease;
      // Points evenly around an ellipse the size of the outline, along the foot: a long foot gets as many at the
      // toe and the heel as along its sides (at even angles the toe's corner falls between two).
      const side = [fwd[2], -fwd[0]];
      let w = 1e-3;
      let l = 1e-3;
      for (let i = 0; i < hx.length; i++) {
        w = Math.max(w, Math.abs((hx[i]! - cx) * side[0]! + (hz[i]! - cz) * side[1]!));
        l = Math.max(l, Math.abs((hx[i]! - cx) * fwd[0] + (hz[i]! - cz) * fwd[2]));
      }
      const dirs: [number, number][] = [];
      for (let j = 0; j < o.around; j++) {
        const f = (TAU * j) / o.around;
        const a = w * sin(f);
        const b = l * cos(f);
        const dx = side[0]! * a + fwd[0] * b;
        const dz = side[1]! * a + fwd[2] * b;
        const d = Math.sqrt(dx * dx + dz * dz);
        dirs.push([dx / d, dz / d]);
      }
      // The chords between ring points hold the outline too.
      const radii = ringRadii(hx, hz, cx, cz, dirs, ease);
      const ring: number[] = [];
      for (let j = 0; j < o.around; j++) {
        const [dx, dz] = dirs[j]!;
        const r = radii[j]!;
        const seg = h > ankle ? calfSeg : footSeg;
        // The lowest rings sit inside the sole: they keep their place.
        ring.push(m.addVertex([cx + dx * r, h, cz + dz * r], [dx, 0, dz], seg, h < (o.fixedBelow ?? ankle + 0.02) ? LOFT | FIXED : LOFT, -1, ease));
      }
      rings.push(ring);
    }
    // Sides: medial and lateral halves (seams at the toe and the heel).
    const half = (j: number) => {
      const lateralPositive = s === 'l';
      const xPositive = j < o.around / 2;
      return m.panelId(`boot_${s}_${xPositive === lateralPositive ? 'out' : 'in'}`);
    };
    for (let k = 0; k + 1 < rings.length; k++) {
      const A = rings[k]!;
      const B = rings[k + 1]!;
      for (let j = 0; j < o.around; j++) {
        const j2 = (j + 1) % o.around;
        const panel = half(j);
        m.addTri(A[j]!, A[j2]!, B[j2]!, panel);
        m.addTri(A[j]!, B[j2]!, B[j]!, panel);
      }
    }
    // Close the bottom (inside the sole) and mark the top as the hem.
    addFanCap(m, rings[0]!, m.panelId('sole'), -1, footSeg);
    for (const v of rings[rings.length - 1]!) {
      m.hem[v] = o.hem[s];
      m.dist[v] = 0;
    }
    if (o.slab !== false) addSoleSlab(m, [footSeg, calfSeg], ySole, L.ground, o.welt, footSeg, 24, true);
  }
  return m;
}

/**
 * `buildBoots` with as many points around as fit the slot's budget with the
 * rims (four triangles per top-loop point) and without decimating: rings
 * decimated collapse unevenly. The count depends on the options only, so
 * every body gets the same topology.
 */
export function buildBootsWithin(body: ShellBody, o: BootOptions, budget: number, decimateAbove: number): WorkMesh {
  let m = buildBoots(body, o);
  for (let around = o.around; around >= 8; around -= 2) {
    m = around === o.around ? m : buildBoots(body, { ...o, around });
    if (m.triangleCount <= decimateAbove && m.triangleCount + 2 * 4 * around <= budget) break;
  }
  return m;
}

/**
 * Radii of ring points along `dirs` around (cx, cz) whose polygon holds the
 * convex outline grown by `ease`: each starts at the outline's reach along its
 * direction plus the ease; where an outline corner (grown by the ease) lies
 * outside the chord between two points (a thumb or a toe between two
 * directions), both points move out until the chord holds it.
 */
export function ringRadii(hx: readonly number[], hz: readonly number[], cx: number, cz: number, dirs: readonly (readonly [number, number])[], ease: number): number[] {
  const n = dirs.length;
  const R = dirs.map(([dx, dz]) => reach(hx as number[], hz as number[], cx, cz, dx, dz) + ease);
  for (let it = 0; it < 6; it++) {
    let moved = false;
    for (let j = 0; j < n; j++) {
      const k = (j + 1) % n;
      const ax = dirs[j]![0] * R[j]!;
      const az = dirs[j]![1] * R[j]!;
      const bx = dirs[k]![0] * R[k]!;
      const bz = dirs[k]![1] * R[k]!;
      // The chord's outward normal (away from the centre) and its distance from the centre.
      let nx = bz - az;
      let nz = ax - bx;
      const l = Math.sqrt(nx * nx + nz * nz);
      if (l < 1e-12) continue;
      nx /= l;
      nz /= l;
      if (nx * ax + nz * az < 0) {
        nx = -nx;
        nz = -nz;
      }
      const reachChord = nx * ax + nz * az;
      let need = reachChord;
      for (let i = 0; i < hx.length; i++) {
        const px = hx[i]! - cx;
        const pz = hz[i]! - cz;
        // Only corners in this sector (between the two directions).
        const c1 = dirs[j]![0] * pz - dirs[j]![1] * px;
        const c2 = px * dirs[k]![1] - pz * dirs[k]![0];
        if (c1 * c2 < 0) continue;
        if (px * (dirs[j]![0] + dirs[k]![0]) + pz * (dirs[j]![1] + dirs[k]![1]) <= 0) continue;
        need = Math.max(need, nx * px + nz * pz + ease);
      }
      if (need > reachChord * (1 + 1e-9)) {
        const f = need / reachChord;
        R[j] = R[j]! * f;
        R[k] = R[k]! * f;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return R;
}
