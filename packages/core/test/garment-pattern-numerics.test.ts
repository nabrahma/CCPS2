/**
 * PRD Part 3, F29: the numeric layer under the GarmentCode port agrees with svgpathtools and SciPy.
 *
 * The fixture (`fixtures/garmentcode/numerics.json.gz`) is written by `tools/asset-compiler/garmentcode_oracle.py
 * numerics` from the pinned GarmentCode environment: random curves, rotations, and the optimiser calls GarmentCode
 * makes (tangent-fitted curves by BFGS, tangent matching and corner/edge fitting by L-BFGS-B).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { absSq, curveFromTangents } from '../src/garment/pattern/edge-factory';
import { Arc, CubicBezier, Line, QuadraticBezier, type P2, type Segment } from '../src/garment/pattern/num/curves';
import { minimize, minimizeBFGS, minimizeLBFGSB } from '../src/garment/pattern/num/optimize';
import { Rotation } from '../src/garment/pattern/num/rotation';
import { bendExtend2Tangent, fitLocationCorner, fitLocationEdge } from '../src/garment/pattern/operators';
import { absToRel2d } from '../src/garment/pattern/utils';

/* eslint-disable @typescript-eslint/no-explicit-any */
const FIX = JSON.parse(gunzipSync(readFileSync(join(__dirname, 'fixtures/garmentcode/numerics.json.gz'))).toString('utf-8')) as any;

/** |a - b| within rel * max(1, |b|). */
function near(a: number, b: number, rel = 1e-9): boolean {
  return Math.abs(a - b) <= rel * Math.max(1, Math.abs(b));
}
const nearV = (a: readonly number[], b: readonly number[], rel = 1e-9): boolean => a.length === b.length && a.every((v, i) => near(v, b[i]!, rel));

function makeCurve(rec: any): Segment {
  if (rec.kind === 'cubic') return new CubicBezier(...(rec.spec as [P2, P2, P2, P2]));
  if (rec.kind === 'quad') return new QuadraticBezier(...(rec.spec as [P2, P2, P2]));
  return new Arc(rec.spec[0], rec.spec[1], 0, !!rec.spec[2], !!rec.spec[3], rec.spec[4]);
}

describe('svgpathtools curves', () => {
  it('points, lengths, inverse lengths, crops, tangents and curvature match', () => {
    const bad: string[] = [];
    FIX.curves.forEach((rec: any, i: number) => {
      const c = makeCurve(rec);
      rec.ts.forEach((t: number, k: number) => {
        if (!nearV(c.point(t), rec.points[k])) bad.push(`${i} ${rec.kind} point(${t})`);
      });
      if (!near(c.length(), rec.length, 1e-9)) bad.push(`${i} ${rec.kind} length ${c.length()} vs ${rec.length}`);
      if (!near(c.length(0, rec.ts[2]), rec.partial, 1e-9)) bad.push(`${i} ${rec.kind} partial length`);
      if (!near(c.ilength(rec.length * rec.frac, 1e-10), rec.ilength, 1e-8)) bad.push(`${i} ${rec.kind} ilength ${c.ilength(rec.length * rec.frac, 1e-10)} vs ${rec.ilength}`);
      const crop = c.cropped(rec.crop[0], rec.crop[1]);
      if (!nearV(crop.start, rec.cropStart, 1e-8) || !nearV(crop.end, rec.cropEnd, 1e-8)) bad.push(`${i} ${rec.kind} crop ends`);
      if (!near(crop.length(), rec.cropLength, 1e-8)) bad.push(`${i} ${rec.kind} crop length`);
      if (rec.cropBpoints) (crop as CubicBezier | QuadraticBezier).bpoints().forEach((p: P2, k: number) => nearV(p, rec.cropBpoints[k], 1e-8) || bad.push(`${i} ${rec.kind} crop control ${k}`));
      if (rec.kind === 'arc') {
        if (!nearV((crop as Arc).radius, rec.radius, 1e-9)) bad.push(`${i} arc crop radius`);
        if ((crop as Arc).largeArc !== rec.largeArc) bad.push(`${i} arc crop large flag`);
      }
      rec.ts.slice(2).forEach((t: number, k: number) => {
        if (!nearV(c.unitTangent(t), rec.tangents[k])) bad.push(`${i} ${rec.kind} tangent`);
        if (!near(c.curvature(t), rec.curvatures[k], 1e-8)) bad.push(`${i} ${rec.kind} curvature ${c.curvature(t)} vs ${rec.curvatures[k]}`);
      });
    });
    expect(bad).toEqual([]);
  });

  it('a line is exact', () => {
    const l = new Line([0, 0], [3, 4]);
    expect(l.length()).toBe(5);
    expect(l.ilength(2.5)).toBe(0.5);
  });
});

describe('SciPy rotations', () => {
  it('from_euler, as_euler, composition, apply and from_rotvec match', () => {
    const bad: string[] = [];
    FIX.rotations.forEach((rec: any, i: number) => {
      const r1 = Rotation.fromEuler('XYZ', rec.euler, true);
      const r2 = Rotation.fromEuler('XYZ', rec.euler2, true);
      if (!nearV(r1.quat, rec.quat, 1e-12)) bad.push(`${i} quat`);
      if (!nearV(r1.asEuler('XYZ', true), rec.asEuler, 1e-9)) bad.push(`${i} as_euler ${r1.asEuler('XYZ', true)} vs ${rec.asEuler}`);
      const c = r2.mul(r1);
      if (!nearV(c.quat, rec.composed, 1e-12)) bad.push(`${i} composed`);
      if (!nearV(c.asEuler('XYZ', true), rec.composedEuler, 1e-9)) bad.push(`${i} composed euler`);
      if (!nearV(r1.apply(rec.v), rec.applied, 1e-12)) bad.push(`${i} apply`);
      if (!nearV(Rotation.fromRotvec(rec.rotvec).quat, rec.rotvecQuat, 1e-12)) bad.push(`${i} rotvec`);
    });
    expect(bad).toEqual([]);
  });
});

describe('SciPy optimisers as GarmentCode calls them', () => {
  const recs = (op: string): any[] => FIX.optim.filter((r: any) => r.op === op);

  it('BFGS: curve_from_tangents follows SciPy and reaches the same control point when the fit is well posed', () => {
    const bad: string[] = [];
    let posed = 0;
    recs('curve_from_tangents').forEach((r, i) => {
      const nz = (v: number[] | null): P2 | null => {
        if (!v) return null;
        const q = absToRel2d(r.start, r.end, v, true);
        const n = Math.sqrt(q[0]! * q[0]! + q[1]! * q[1]!);
        return [q[0]! / n, q[1]! / n];
      };
      const t0 = nz(r.tan0);
      const t1 = nz(r.tan1);
      const f = (cp: number[]): number => {
        const c = new QuadraticBezier([0, 0], [cp[0]!, cp[1]!], [1, 0]);
        c.pyComplex = true;
        let s = 0;
        if (t0) {
          const u = c.unitTangent(0);
          s += absSq(u[0] - t0[0], u[1] - t0[1]);
        }
        if (t1) {
          const u = c.unitTangent(1);
          s += absSq(u[0] - t1[0], u[1] - t1[1]);
        }
        return s;
      };
      const its: number[][] = [];
      minimizeBFGS(f, r.guess ?? [0.5, 0], 1e-5, (x) => its.push(x));
      (r.iterates as number[][]).slice(0, 2).forEach((x, k) => nearV(its[k] ?? [], x, k ? 1e-6 : 1e-9) || bad.push(`${i} iterate ${k + 1}: ${its[k]} vs ${x}`));
      // Well posed: the optimum is a finite control point (otherwise BFGS walks off until the gradient fades).
      if (Math.max(...r.cp[0].map(Math.abs)) < 10) {
        posed++;
        const e = curveFromTangents(r.start, r.end, r.tan0, r.tan1, r.guess);
        if (!nearV(e.controlPoints[0]!, r.cp[0], 1e-6)) bad.push(`${i}: ${e.controlPoints[0]} vs ${r.cp[0]}`);
      }
    });
    expect(posed).toBeGreaterThan(30);
    expect(bad).toEqual([]);
  });

  it('L-BFGS-B: curve_match_tangents follows SciPy through its first iterates (its last steps are rounding-driven, D-173)', () => {
    const bad: string[] = [];
    let second = 0;
    recs('curve_match_tangents').forEach((r, i) => {
      const curve = new CubicBezier(...(r.cps as [P2, P2, P2, P2]));
      const cps = curve.bpoints().map((p) => [p[0], p[1]]);
      let dir = [cps[3]![0]! - cps[0]![0]!, cps[3]![1]! - cps[0]![1]!];
      const dn = Math.sqrt(dir[0]! * dir[0]! + dir[1]! * dir[1]!);
      dir = [dir[0]! / dn, dir[1]! / dn];
      const unit = (v: number[]): P2 => {
        const n = Math.sqrt(v[0]! * v[0]! + v[1]! * v[1]!);
        return [v[0]! / n, v[1]! / n];
      };
      const L = r.targetLen ?? curve.length();
      const its: number[][] = [];
      minimizeLBFGSB((s) => bendExtend2Tangent(s, cps, L, dir, unit(r.tan0), unit(r.tan1), 70), [0, 0, 0, 0, 0], undefined, (x) => its.push(x));
      if (!nearV(its[0] ?? [], r.iterates[0], 1e-9)) bad.push(`${i} iterate 1: ${its[0]} vs ${r.iterates[0]}`);
      if (nearV(its[1] ?? [], r.iterates[1], 1e-6)) second++;
    });
    expect(bad).toEqual([]);
    // From the second step on, a flipped comparison inside the line search can send the two down different paths.
    expect(second).toBeGreaterThanOrEqual(36);
  });

  it('L-BFGS-B with bounds: the corner and edge fits match', () => {
    const bad: string[] = [];
    recs('fit_location_corner').forEach((r, i) => {
      const c1 = new Line(r.a, r.b);
      const c2 = new Line(r.b, r.c);
      const o = minimize((l) => fitLocationCorner(l, r.target, c1, c2), [0.5, 0.5], {
        bounds: [
          [0, 1],
          [0, 1],
        ],
      });
      if (!nearV(o.x, r.x, 1e-6)) bad.push(`corner ${i}: ${o.x} vs ${r.x} (nit ${o.nit} vs ${r.nit})`);
    });
    recs('fit_location_edge').forEach((r, i) => {
      const curve = r.line ? new Line(r.cps[0], r.cps[3]) : new CubicBezier(...(r.cps as [P2, P2, P2, P2]));
      const o = minimize((s) => fitLocationEdge(s, r.loc, r.width, curve), [0.1, 0.1], { bounds: [[0, 1]] });
      if (!nearV(o.x, r.x, 1e-6)) bad.push(`edge ${i}: ${o.x} vs ${r.x} (nit ${o.nit} vs ${r.nit})`);
    });
    expect(bad).toEqual([]);
  });
});
