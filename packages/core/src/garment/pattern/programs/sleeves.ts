/** Sleeves and armhole shapes (port of assets/garment_programs/sleeves.py). */
import { cos, PI, sin } from '../../../math/dmath';
import { CurveEdge, Edge, EdgeSequence } from '../edge';
import { fromVerts } from '../edge-factory';
import { Interface, Stitches } from '../interface';
import { Rotation } from '../num/rotation';
import { curveMatchTangentsEdge, evenArmholeOpenings } from '../operators';
import { Component, Panel } from '../panel';
import { closeEnough, deepcopy, norm2, type Vert } from '../utils';
import { makeCuff } from './bands';
import { bv, type Body, type Design } from './base';
import type { CubicBezier } from '../num/curves';

const deg2rad = (d: number): number => d * (PI / 180);

interface ArmholeOpts {
  inclCoeff?: number;
  wCoeff?: number;
  invert?: boolean;
  bottomAngleMix?: number;
}

type Armhole = (incl: number, width: number, angle: number, o: ArmholeOpts) => [EdgeSequence, EdgeSequence | null];

export const ArmholeSquare: Armhole = (incl, width, angle, o) => {
  const edges = fromVerts([
    [0, 0],
    [incl, 0],
    [incl, width],
  ]);
  if (!(o.invert ?? true)) return [edges, null];
  const sa = sin(angle);
  const ca = cos(angle);
  const l = edges.edges[0]!.length();
  const sleeve = fromVerts([
    [incl + l * sa, -l * ca],
    [incl, 0],
    [incl, width],
  ]);
  sleeve.rotate(-angle);
  return [edges, sleeve];
};

export const ArmholeAngle: Armhole = (incl, width, angle, o) => {
  const inclCoeff = o.inclCoeff ?? 0.2;
  const wCoeff = o.wCoeff ?? 0.2;
  const diffIncl = incl * (1 - inclCoeff);
  const edges = fromVerts([
    [0, 0],
    [diffIncl, wCoeff * width],
    [incl, width],
  ]);
  if (!(o.invert ?? true)) return [edges, null];
  const sa = sin(angle);
  const ca = cos(angle);
  const l = edges.edges[0]!.length();
  const sleeve = fromVerts([
    [diffIncl + l * sa, wCoeff * width - l * ca],
    [diffIncl, wCoeff * width],
    [incl, width],
  ]);
  sleeve.rotate(-angle);
  return [edges, sleeve];
};

export const ArmholeCurve: Armhole = (incl, width, angle, o) => {
  const cps: Vert[] = [
    [0.5, 0.2],
    [0.8, 0.35],
  ];
  const edge = new CurveEdge([incl, width], [0, 0], cps);
  // reverse() flips the shared control-point list in place; the inverse starts from a copy of the flipped list.
  const edgeAsSeq = new EdgeSequence(edge.reverse());
  if (!(o.invert ?? true)) return [edgeAsSeq, null];
  const invCps = deepcopy(cps);
  const down = [0, -1];
  invCps[invCps.length - 1]![1] = invCps[invCps.length - 1]![1]! * -1;
  const sl = edge.straightLen();
  const invEdge = new CurveEdge([incl, width], [incl + down[0]! * sl, width + down[1]! * sl], invCps);
  invEdge.rotate(-angle);
  const sc = invEdge.shortcut();
  let rd = [sc[1]![0]! - sc[0]![0]!, sc[1]![1]! - sc[0]![1]!];
  const rn = norm2(rd);
  rd = [rd[0]! / rn, rd[1]! / rn];
  const left = [-1, 0];
  const mix = o.bottomAngleMix ?? 0;
  const dir = mix > 0 ? [(1 - mix) * rd[0]! + mix * down[0]!, (1 - mix) * rd[1]! + mix * down[1]!] : [(1 - mix) * rd[0]! + -mix * left[0]!, (1 - mix) * rd[1]! + -mix * left[1]!];
  const fin = curveMatchTangentsEdge(invEdge.asCurve() as CubicBezier, down, dir, edge.length());
  return [edgeAsSeq, new EdgeSequence(fin.reverse())];
};

const ARMHOLES: Record<string, Armhole> = { ArmholeSquare, ArmholeAngle, ArmholeCurve };

export class SleevePanel extends Panel {
  constructor(name: string, body: Body, design: Design, openShape: EdgeSequence, lengthShift = 0, standingMargin = 5) {
    super(name);
    const MIN_LENGTH = 5;
    const shoulderAngle = deg2rad(bv(body, '_shoulder_incl'));
    const restAngle = Math.max(deg2rad(design.sleeve_angle.v), shoulderAngle);
    let standing: boolean = design.standing_shoulder.v;
    let endWidth = design.end_width.v * Math.abs(openShape.edges[0]!.start[1]! - openShape.at(-1).end[1]!);
    endWidth = Math.max(endWidth, bv(body, 'wrist') / 2);
    if (!closeEnough(design.connect_ruffle.v, 1)) openShape.extend(design.connect_ruffle.v);
    const openingLength = Math.abs(openShape.edges[0]!.start[0]! - openShape.at(-1).end[0]!);
    const armWidth = Math.abs(openShape.edges[0]!.start[1]! - openShape.at(-1).end[1]!);
    let length = design.length.v * (bv(body, 'arm_length') - openingLength);
    length = Math.max(length + lengthShift, MIN_LENGTH);
    this.edges = fromVerts([
      [0, 0],
      [0, -endWidth],
      [length, -armWidth],
    ]);
    openShape.snapTo(this.edges.at(-1).end);
    openShape.edges[0]!.start = this.edges.at(-1).end;
    this.edges.append(openShape);
    this.edges.closeLoop();
    if (standing) {
      if (restAngle > shoulderAngle + deg2rad(standingMargin)) {
        const topEdge = this.edges.at(-1);
        const start = topEdge.start;
        const len = design.standing_shoulder_len.v;
        const xShift = len * cos(restAngle - shoulderAngle);
        const yShift = len * sin(restAngle - shoulderAngle);
        const standingEdge = new Edge(start, [start[0]! - xShift, start[1]! + yShift]);
        topEdge.start = standingEdge.end;
        this.edges.substitute(topEdge, [standingEdge, topEdge]);
      } else standing = false;
    }
    this.interfaces = {
      in: new Interface(this, openShape, design.connect_ruffle.v),
      out: new Interface(this, this.edges.edges[0]!, design.cuff.top_ruffle.v),
      top: new Interface(this, standing ? this.edges.slice(-2) : this.edges.at(-1)),
      bottom: new Interface(this, this.edges.edges[1]!),
    };
    this.setPivot(this.edges.at(-1).start);
    this.translateTo([-bv(body, 'shoulder_w') / 2, bv(body, 'height') - bv(body, 'head_l'), 0]);
  }

  override length(): number {
    return this.int('bottom').edges.totalLength();
  }
}

export class Sleeve extends Component {
  design: Design;
  body: Body;
  f_sleeve?: SleevePanel;
  b_sleeve?: SleevePanel;
  cuff?: Component;

  constructor(tag: string, body: Body, designIn: Design, frontW: number | ((l: number) => number), backW: number | ((l: number) => number)) {
    super(`Sleeve_${tag}`);
    const design = designIn.sleeve;
    this.design = design;
    this.body = body;
    const sleeveBalance = bv(body, '_base_sleeve_balance') / 2;
    const restAngle = Math.max(deg2rad(design.sleeve_angle.v), deg2rad(bv(body, '_shoulder_incl')));
    const connectingWidth: number = design.connecting_width.v;
    const smoothing: number = design.smoothing_coeff.v;
    const fw = typeof frontW === 'function' ? frontW(connectingWidth) : frontW;
    const bw = typeof backW === 'function' ? backW(connectingWidth) : backW;
    const armholeName: string = design.sleeveless.v ? design.armhole_shape.v : 'ArmholeCurve';
    const armhole = ARMHOLES[armholeName];
    if (!armhole) throw Object.assign(new Error(`KeyError: '${armholeName}'`), { pyType: 'KeyError' });
    const opts: ArmholeOpts = { inclCoeff: smoothing, wCoeff: smoothing, invert: !design.sleeveless.v, bottomAngleMix: design.opening_dir_mix.v };
    const [frontProject, frontOpening0] = armhole(fw - sleeveBalance, connectingWidth, restAngle, opts);
    const [backProject, backOpening0] = armhole(bw - sleeveBalance, connectingWidth, restAngle, opts);
    this.interfaces = {
      in_front_shape: new Interface(this as unknown as Panel, frontProject),
      in_back_shape: new Interface(this as unknown as Panel, backProject),
    };
    if (design.sleeveless.v) return;
    let frontOpening = frontOpening0!;
    let backOpening = backOpening0!;
    if (fw !== bw) [frontOpening, backOpening] = evenArmholeOpenings(frontOpening, backOpening, 0.2 / frontOpening.totalLength());
    const cuffLenAdj = this.cuffLenAdj();
    this.f_sleeve = new SleevePanel(`${tag}_sleeve_f`, body, design, frontOpening, -cuffLenAdj).translateBy([0, 0, 15]);
    this.b_sleeve = new SleevePanel(`${tag}_sleeve_b`, body, design, backOpening, -cuffLenAdj).translateBy([0, 0, -15]);
    this.stitchingRules = new Stitches([this.f_sleeve.int('top'), this.b_sleeve.int('top')], [this.f_sleeve.int('bottom'), this.b_sleeve.int('bottom')]);
    (this.interfaces as Record<string, Interface>).in = Interface.fromMultiple(this.f_sleeve.int('in'), this.b_sleeve.int('in').reverse(true));
    (this.interfaces as Record<string, Interface>).out = Interface.fromMultiple(this.f_sleeve.int('out'), this.b_sleeve.int('out'));
    if (design.cuff.type.v) {
      const cdesign = deepcopy(design);
      let cuffCirc = this.int('out').edges.totalLength() / design.cuff.top_ruffle.v;
      cuffCirc = Math.max(cuffCirc, bv(body, 'wrist'));
      cdesign.cuff.b_width = { v: cuffCirc };
      cdesign.cuff.cuff_len.v = cuffLenAdj;
      this.cuff = makeCuff(cdesign.cuff.type.v, `sl_${tag}`, cdesign);
      this.cuff.rotateBy(Rotation.fromEuler('XYZ', [0, 0, -90], true));
      this.cuff.placeByInterface(this.cuff.int('top'), this.int('out'), 2, 'top');
      this.stitchingRules.append([this.cuff.int('top'), this.int('out')]);
      (this.interfaces as Record<string, Interface>).out = this.cuff.int('bottom');
    }
    this.rotateBy(Rotation.fromEuler('XYZ', [0, 0, bv(body, 'arm_pose_angle')], true));
    this.setPanelLabel('arm');
  }

  cuffLenAdj(): number {
    if (!this.design.cuff.type.v) return 0;
    let adj = this.design.cuff.cuff_len.v * this.body.arm_length!;
    const maxLen = this.design.length.v * this.body.arm_length!;
    if (adj > maxLen * 0.7) adj = maxLen * 0.7;
    return adj;
  }

  override length(): number {
    if (this.design.sleeveless.v) return 0;
    if (this.design.cuff.type.v) return this.f_sleeve!.length() + this.cuff!.length();
    return this.f_sleeve!.length();
  }
}
