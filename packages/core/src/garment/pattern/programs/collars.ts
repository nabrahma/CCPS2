/** Necklines and collars (port of assets/garment_programs/collars.py). */
import { cos, PI, sin } from '../../../math/dmath';
import { CurveEdge, Edge, EdgeSequence, type CircleEdge } from '../edge';
import { circleFromPointsAngle, circleFromThreePoints, fromVerts } from '../edge-factory';
import { Interface } from '../interface';
import type { CubicBezier } from '../num/curves';
import { Rotation } from '../num/rotation';
import { curveMatchTangentsEdge } from '../operators';
import { Component, Panel } from '../panel';
import { closeEnough } from '../utils';
import { bv, type Body, type Design } from './base';
import { StraightBandPanel } from './bands';
import { CircleArcPanel } from './circle-skirt';

const deg2rad = (d: number): number => d * (PI / 180);

interface NeckOpts {
  angle?: number;
  flip?: boolean;
  x?: number;
  y?: number;
}
type Neck = (depth: number, width: number, o: NeckOpts) => EdgeSequence;

export const VNeckHalf: Neck = (depth, width) => new EdgeSequence(new Edge([0, 0], [width / 2, -depth]));

export const SquareNeckHalf: Neck = (depth, width) =>
  fromVerts([
    [0, 0],
    [0, -depth],
    [width / 2, -depth],
  ]);

export const TrapezoidNeckHalf: Neck = (depth, width, o) => {
  const angle = o.angle ?? 90;
  if (closeEnough(angle, 180, 1) || closeEnough(angle, 0, 1)) return VNeckHalf(depth, width, {});
  const rad = deg2rad(angle);
  const bottomX = (-depth * cos(rad)) / sin(rad);
  if (bottomX > width / 2) return VNeckHalf(depth, width, {});
  return fromVerts([
    [0, 0],
    [bottomX, -depth],
    [width / 2, -depth],
  ]);
};

export const CurvyNeckHalf: Neck = (depth, width, o) => {
  const sign = o.flip ? -1 : 1;
  return new EdgeSequence(
    new CurveEdge(
      [0, 0],
      [width / 2, -depth],
      [
        [0.4, sign * 0.3],
        [0.8, sign * -0.3],
      ],
    ),
  );
};

export const CircleArcNeckHalf: Neck = (depth, width, o) => new EdgeSequence(circleFromPointsAngle([0, 0], [width / 2, -depth], deg2rad(o.angle ?? 90), !o.flip));

export const CircleNeckHalf: Neck = (depth, width) => {
  const circle = circleFromThreePoints([0, 0], [width, 0], [width / 2, -depth]);
  const subdiv = circle.subdivideLen([0.5, 0.5]);
  return new EdgeSequence(subdiv.edges[0]!);
};

export const Bezier2NeckHalf: Neck = (depth, width, o) => {
  const sign = o.flip ? 1 : -1;
  return new EdgeSequence(new CurveEdge([0, 0], [width / 2, -depth], [[o.x ?? 0.5, sign * (o.y ?? 0.3)]]));
};

export const NECKS: Record<string, Neck> = { VNeckHalf, SquareNeckHalf, TrapezoidNeckHalf, CurvyNeckHalf, CircleArcNeckHalf, CircleNeckHalf, Bezier2NeckHalf };

function neck(name: string): Neck {
  const n = NECKS[name];
  if (!n) throw Object.assign(new Error(`KeyError: '${name}'`), { pyType: 'KeyError' });
  return n;
}

export class NoPanelsCollar extends Component {
  constructor(name: string, _body: Body, design: Design) {
    super(name);
    const c = design.collar;
    const f = neck(c.f_collar.v)(c.fc_depth.v, c.width.v, { angle: c.fc_angle.v, flip: c.f_flip_curve.v, x: c.f_bezier_x.v, y: c.f_bezier_y.v });
    const b = neck(c.b_collar.v)(c.bc_depth.v, c.width.v, { angle: c.bc_angle.v, flip: c.b_flip_curve.v, x: c.b_bezier_x.v, y: c.b_bezier_y.v });
    this.interfaces = {
      front_proj: new Interface(this as unknown as Panel, f),
      back_proj: new Interface(this as unknown as Panel, b),
    };
  }

  override length(): number {
    return 0;
  }
}

export class Turtle extends Component {
  front: StraightBandPanel;
  back: StraightBandPanel;

  constructor(tag: string, body: Body, design: Design) {
    super(`Turtle_${tag}`);
    const depth = design.collar.component.depth.v;
    const f = CircleNeckHalf(design.collar.fc_depth.v, design.collar.width.v, {});
    const b = CircleNeckHalf(design.collar.bc_depth.v, design.collar.width.v, {});
    this.interfaces = { front_proj: new Interface(this as unknown as Panel, f), back_proj: new Interface(this as unknown as Panel, b) };
    const lf = f.totalLength();
    const lb = b.totalLength();
    const h = bv(body, 'height') - bv(body, 'head_l') + depth;
    this.front = new StraightBandPanel(`${tag}_collar_front`, lf, depth).translateBy([-lf / 2, h, 10]);
    this.back = new StraightBandPanel(`${tag}_collar_back`, lb, depth).translateBy([-lb / 2, h, -10]);
    this.stitchingRules.append([this.front.int('right'), this.back.int('right')]);
    Object.assign(this.interfaces, {
      front: this.front.int('left'),
      back: this.back.int('left'),
      bottom: Interface.fromMultiple(this.front.int('bottom'), this.back.int('bottom')),
    });
  }

  override length(): number {
    return this.int('back').edges.totalLength();
  }
}

export class SimpleLapelPanel extends Panel {
  constructor(name: string, length: number, maxDepth: number) {
    super(name);
    this.edges = fromVerts([
      [0, 0],
      [maxDepth, 0],
      [maxDepth, -length],
    ]);
    this.edges.append(new CurveEdge(this.edges.at(-1).end, this.edges.edges[0]!.start, [[0.7, 0.2]]));
    this.interfaces = { to_collar: new Interface(this, this.edges.edges[0]!), to_bodice: new Interface(this, this.edges.edges[1]!) };
  }
}

export class SimpleLapel extends Component {
  front: SimpleLapelPanel;
  back: Panel;

  constructor(tag: string, body: Body, design: Design) {
    super(`Turtle_${tag}`);
    const c = design.collar;
    const depth = c.component.depth.v;
    const standing: boolean = c.component.lapel_standing.v;
    const f = neck(c.f_collar.v)(c.fc_depth.v, c.width.v, { angle: c.fc_angle.v, flip: c.f_flip_curve.v });
    const b = CircleNeckHalf(c.bc_depth.v, c.width.v, {});
    this.interfaces = { front_proj: new Interface(this as unknown as Panel, f), back_proj: new Interface(this as unknown as Panel, b) };
    const lf = f.totalLength();
    const lb = b.totalLength();
    const h = bv(body, 'height') - bv(body, 'head_l') + depth * 2;
    this.front = new SimpleLapelPanel(`${tag}_collar_front`, lf, depth).translateBy([-depth * 2, h, 35]);
    if (standing) this.back = new StraightBandPanel(`${tag}_collar_back`, lb, depth).translateBy([-lb / 2, h, -10]);
    else {
      const [rad, angle] = (b.edges[0] as CircleEdge).asRadiusAngle();
      this.back = new CircleArcPanel(`${tag}_collar_back`, rad, depth, angle).translateBy([-lb, h, -10]);
      this.back.rotateBy(Rotation.fromEuler('XYZ', [90, 45, 0], true));
    }
    if (standing) this.back.int('right').setRightWrong(true);
    this.stitchingRules.append([this.front.int('to_collar'), this.back.int('right')]);
    Object.assign(this.interfaces, {
      back: this.back.int('left'),
      bottom: Interface.fromMultiple(this.front.int('to_bodice').setRightWrong(true), standing ? this.back.int('bottom') : this.back.int('top').setRightWrong(true)),
    });
  }

  override length(): number {
    return this.int('back').edges.totalLength();
  }
}

export class HoodPanel extends Panel {
  constructor(name: string, fDepth: number, bDepth: number, fLength: number, bLength: number, widthIn: number, inLength: number, depth: number) {
    super(name);
    const width = widthIn / 2;
    const length = inLength + width / 2;
    const bbIn = new CurveEdge([-width, -bDepth], [0, 0], [
      [0.3, -0.2],
      [0.6, 0.2],
    ]);
    this.edges.append(curveMatchTangentsEdge(bbIn.asCurve() as CubicBezier, [1, 0], [1, 0], bLength));
    const bfIn = new CurveEdge(this.edges.at(-1).end, [width, -fDepth], [
      [0.3, 0.2],
      [0.6, -0.2],
    ]);
    this.edges.append(curveMatchTangentsEdge(bfIn.asCurve() as CubicBezier, [1, 0], [1, 0], fLength));
    this.edges.append(
      fromVerts([
        this.edges.at(-1).end,
        [width * 1.2, length],
        [width * 1.2 - depth, length],
      ]),
    );
    this.edges.append(new CurveEdge(this.edges.at(-1).end, this.edges.edges[0]!.start, [[0.2, -0.5]]));
    this.interfaces = { to_other_side: new Interface(this, this.edges.slice(-2)), to_bodice: new Interface(this, this.edges.slice(0, 2)).reverse() };
    this.rotateBy(Rotation.fromEuler('XYZ', [0, -90, 0], true));
    this.translateBy([-width, 0, 0]);
  }
}

export class Hood2Panels extends Component {
  panel: HoodPanel;

  constructor(tag: string, body: Body, design: Design) {
    super(`Hood_${tag}`);
    const c = design.collar;
    const width = c.width.v;
    const f = CircleNeckHalf(c.fc_depth.v, c.width.v, {});
    const b = CircleNeckHalf(c.bc_depth.v, c.width.v, {});
    this.interfaces = { front_proj: new Interface(this as unknown as Panel, f), back_proj: new Interface(this as unknown as Panel, b) };
    this.panel = new HoodPanel(`${tag}_hood`, c.fc_depth.v, c.bc_depth.v, f.totalLength(), b.totalLength(), width, bv(body, 'head_l') * c.component.hood_length.v, (width / 2) * c.component.hood_depth.v).translateBy([0, bv(body, 'height') - bv(body, 'head_l') + 10, 0]);
    Object.assign(this.interfaces, { back: this.panel.int('to_other_side'), bottom: this.panel.int('to_bodice') });
  }

  override length(): number {
    return this.panel.length();
  }
}

export function makeCollar(style: unknown, name: string, body: Body, design: Design): Component {
  const s = String(style);
  if (s === 'Turtle') return new Turtle(name, body, design);
  if (s === 'SimpleLapel') return new SimpleLapel(name, body, design);
  if (s === 'Hood2Panels') return new Hood2Panels(name, body, design);
  return new NoPanelsCollar(name, body, design);
}
