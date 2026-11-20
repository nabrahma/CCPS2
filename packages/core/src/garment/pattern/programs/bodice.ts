/** Bodices and shirts (port of assets/garment_programs/bodice.py). */
import { PI, tan } from '../../../math/dmath';
import { EdgeSequence } from '../edge';
import { curveFromTangents, dartShape, fromVerts } from '../edge-factory';
import { Interface } from '../interface';
import { cutCorner } from '../operators';
import { Component } from '../panel';
import { deepcopy, linInterpolation } from '../utils';
import { BaseBodicePanel, bv, type Body, type Design } from './base';
import { makeCollar } from './collars';
import { Sleeve } from './sleeves';
import { TorsoBackHalfPanel, TorsoFrontHalfPanel } from './tee';

const deg2rad = (d: number): number => d * (PI / 180);

export class BodiceFrontHalf extends BaseBodicePanel {
  constructor(name: string, body: Body, design: Design) {
    super(name, body, design);
    const mBust = bv(body, 'bust');
    const mWaist = bv(body, 'waist');
    const bustPoint = bv(body, 'bust_points') / 2;
    const frontFrac = (bv(body, 'bust') - bv(body, 'back_width')) / 2 / bv(body, 'bust');
    this.width = frontFrac * mBust;
    const waist = (mWaist - bv(body, 'waist_back_width')) / 2;
    const shTan = tan(deg2rad(bv(body, '_shoulder_incl')));
    const shoulderIncl = shTan * this.width;
    const bottomDWidth = ((this.width - waist) * 2) / 3;
    const adjustment = shTan * (this.width - bv(body, 'shoulder_w') / 2);
    const maxLen = bv(body, 'waist_over_bust_line') - adjustment;
    const fbDiff = (frontFrac - (0.5 - frontFrac)) * bv(body, 'bust');
    const backAdjustment = shTan * (bv(body, 'back_width') / 2 - bv(body, 'shoulder_w') / 2);
    const sideLen = bv(body, 'waist_line') - backAdjustment - shTan * fbDiff;
    this.edges.append(
      fromVerts([
        [0, 0],
        [-this.width, 0],
        [-this.width, maxLen],
        [0, maxLen + shoulderIncl],
      ]),
    );
    this.edges.closeLoop();
    const bustLine = bv(body, 'waist_line') - bv(body, '_bust_line');
    const sideDDepth = 0.75 * (this.width - bustPoint);
    const sideDWidth = maxLen - sideLen;
    const [sEdge, sideInterface] = this.addDart(dartShape(sideDWidth, sideDDepth), this.edges.edges[1]!, bustLine + sideDWidth / 2);
    this.edges.substitute(1, sEdge);
    const xUpd = this.width - bv(body, 'shoulder_w') / 2;
    sEdge.at(-1).end[0] = sEdge.at(-1).end[0]! + xUpd;
    sEdge.at(-1).end[1] = sEdge.at(-1).end[1]! + shTan * xUpd;
    const [bEdge, bInterface] = this.addDart(dartShape(bottomDWidth, 0.9 * bustLine), this.edges.edges[0]!, bustPoint + bottomDWidth / 2);
    this.edges.substitute(0, bEdge);
    bEdge.at(-1).end[0] = -(waist + bottomDWidth);
    const e = this.edges;
    this.interfaces = {
      outside: new Interface(this, sideInterface),
      inside: new Interface(this, e.at(-1)),
      shoulder: new Interface(this, e.at(-2)),
      bottom: new Interface(this, bInterface),
      shoulder_corner: new Interface(this, [e.at(-3), e.at(-2)]),
      collar_corner: new Interface(this, [e.at(-2), e.at(-1)]),
    };
    this.translateBy([0, bv(body, 'height') - bv(body, 'head_l') - maxLen - shoulderIncl, 0]);
  }
}

export class BodiceBackHalf extends BaseBodicePanel {
  constructor(name: string, body: Body, design: Design) {
    super(name, body, design);
    this.width = bv(body, 'back_width') / 2;
    const waist = bv(body, 'waist_back_width') / 2;
    const waistWidth = waist < this.width ? this.width : waist;
    const shTan = tan(deg2rad(bv(body, '_shoulder_incl')));
    const shoulderIncl = shTan * this.width;
    const backAdjustment = shTan * (this.width - bv(body, 'shoulder_w') / 2);
    const length = bv(body, 'waist_line') - backAdjustment;
    const edge0 = curveFromTangents([0, shoulderIncl / 4], [-waistWidth, 0], [-1, 0], null, null);
    this.edges.append(edge0);
    this.edges.append(
      fromVerts([
        edge0.end,
        [-this.width, bv(body, 'waist_line') - bv(body, '_bust_line')],
        [-this.width, length],
        [0, length + shoulderIncl],
      ]),
    );
    this.edges.closeLoop();
    const e = this.edges;
    this.interfaces = {
      outside: new Interface(this, [e.edges[1]!, e.edges[2]!]),
      inside: new Interface(this, e.at(-1)),
      shoulder: new Interface(this, e.at(-2)),
      bottom: new Interface(this, e.edges[0]!),
      shoulder_corner: new Interface(this, new EdgeSequence(e.at(-3), e.at(-2))),
      collar_corner: new Interface(this, new EdgeSequence(e.at(-2), e.at(-1))),
    };
    if (waist < this.getWidth(e.edges[2]!.end[1]! - e.edges[2]!.start[1]!)) {
      const wDiff = waistWidth - waist;
      const sideAdj = wDiff < 4 ? 0 : wDiff / 6;
      let bottomDWidth = wDiff - sideAdj;
      bottomDWidth /= 2;
      const bottomDDepth = 1 * (length - bv(body, '_bust_line'));
      const bottomDPosition = bv(body, 'bum_points') / 2;
      const dist = bottomDPosition * 0.5;
      let [bEdge, bInterface] = this.addDart(dartShape(bottomDWidth, 0.9 * bottomDDepth), e.edges[0]!, bottomDPosition + dist / 2 + bottomDWidth + bottomDWidth / 2);
      [bEdge, bInterface] = this.addDart(dartShape(bottomDWidth, bottomDDepth), bEdge.edges[0]!, bottomDPosition - dist / 2 + bottomDWidth / 2, true, bEdge, bInterface);
      this.edges.substitute(0, bEdge);
      this.interfaces.bottom = new Interface(this, bInterface);
      bEdge.at(-1).end[0] = bEdge.at(-1).end[0]! + sideAdj;
    }
    this.translateBy([0, bv(body, 'height') - bv(body, 'head_l') - length - shoulderIncl, 0]);
  }

  override getWidth(_level?: number): number {
    return this.width;
  }
}

export class BodiceHalf extends Component {
  ftorso: BaseBodicePanel;
  btorso: BaseBodicePanel;
  sleeve: Sleeve | null = null;
  collar_comp: Component | null = null;

  constructor(name: string, body: Body, designIn: Design, fitted = true) {
    super(name);
    const design = deepcopy(designIn);
    if (fitted) {
      this.ftorso = new BodiceFrontHalf(`${name}_ftorso`, body, design).translateBy([0, 0, 30]);
      this.btorso = new BodiceBackHalf(`${name}_btorso`, body, design).translateBy([0, 0, -25]);
    } else {
      this.ftorso = new TorsoFrontHalfPanel(`${name}_ftorso`, body, design).translateBy([0, 0, 30]);
      this.btorso = new TorsoBackHalfPanel(`${name}_btorso`, body, design).translateBy([0, 0, -25]);
    }
    Object.assign(this.interfaces, {
      f_bottom: this.ftorso.int('bottom'),
      b_bottom: this.btorso.int('bottom'),
      front_in: this.ftorso.int('inside'),
      back_in: this.btorso.int('inside'),
    });
    this.evalDepParams(body, design);
    if (design.shirt.strapless.v && fitted) this.makeStrapless(body, design);
    else {
      this.addSleeves(name, body, design);
      this.addCollars(name, body, design);
      this.stitchingRules.append([this.ftorso.int('shoulder'), this.btorso.int('shoulder')]);
    }
    this.stitchingRules.append([this.ftorso.int('outside'), this.btorso.int('outside')]);
  }

  evalDepParams(body: Body, design: Design): void {
    const maxCwidth = this.ftorso.int('shoulder_corner').edges.edges[0]!.length() - 1;
    const minCwidth = bv(body, '_armscye_depth');
    const v = design.sleeve.connecting_width.v;
    design.sleeve.connecting_width.v = Math.min(minCwidth + minCwidth * v, maxCwidth);
    const maxW = bv(body, '_base_sleeve_balance') - 2;
    const minW = bv(body, 'neck_w');
    let width: number;
    if (design.collar.width.v >= 0) width = design.collar.width.v = linInterpolation(minW, maxW, design.collar.width.v);
    else width = design.collar.width.v = linInterpolation(0, minW, 1 + design.collar.width.v);
    const tg = tan(deg2rad(bv(body, '_shoulder_incl')));
    const fDepthAdj = tg * (this.ftorso.getWidth(0) - width / 2);
    const bDepthAdj = tg * (this.btorso.getWidth(0) - width / 2);
    const maxFLen = this.ftorso.int('collar_corner').edges.edges[1]!.length() - tg * this.ftorso.getWidth(0) - 1;
    const maxBLen = this.btorso.int('collar_corner').edges.edges[1]!.length() - tg * this.btorso.getWidth(0) - 1;
    design.collar.f_strapless_depth = { v: Math.min(design.collar.fc_depth.v * bv(body, '_bust_line'), maxFLen) };
    design.collar.fc_depth.v = design.collar.f_strapless_depth.v + fDepthAdj;
    design.collar.b_strapless_depth = { v: Math.min(design.collar.bc_depth.v * bv(body, '_bust_line'), maxBLen) };
    design.collar.bc_depth.v = design.collar.b_strapless_depth.v + bDepthAdj;
  }

  addSleeves(name: string, body: Body, design: Design): void {
    this.sleeve = new Sleeve(
      name,
      body,
      design,
      (l) => this.ftorso.getWidth(l),
      (l) => this.btorso.getWidth(l),
    );
    const [, fSleeveInt] = cutCorner(this.sleeve.int('in_front_shape').edges, this.ftorso.int('shoulder_corner'));
    const [, bSleeveInt] = cutCorner(this.sleeve.int('in_back_shape').edges, this.btorso.int('shoulder_corner'));
    if (!design.sleeve.sleeveless.v) {
      const bodiceSleeveInt = Interface.fromMultiple(fSleeveInt.reverse(true), bSleeveInt.reverse());
      this.stitchingRules.append([this.sleeve.int('in'), bodiceSleeveInt]);
      const gap = -1 - bv(body, 'arm_pose_angle') / 10;
      this.sleeve.placeByInterface(this.sleeve.int('in'), bodiceSleeveInt, gap, 'top');
    }
    fSleeveInt.edges.propagateLabel(`${this.name}_armhole`);
    bSleeveInt.edges.propagateLabel(`${this.name}_armhole`);
  }

  addCollars(name: string, body: Body, design: Design): void {
    this.collar_comp = makeCollar(design.collar.component?.style?.v, name, body, design);
    const [, fcInterface] = cutCorner(this.collar_comp.int('front_proj').edges, this.ftorso.int('collar_corner'));
    const [, bcInterface] = cutCorner(this.collar_comp.int('back_proj').edges, this.btorso.int('collar_corner'));
    if (this.collar_comp.hasInt('bottom')) this.stitchingRules.append([Interface.fromMultiple(fcInterface, bcInterface), this.collar_comp.int('bottom')]);
    const ints = this.interfaces as Record<string, Interface>;
    if (this.collar_comp.hasInt('front')) {
      ints.front_collar = this.collar_comp.int('front');
      ints.front_in = Interface.fromMultiple(this.ftorso.int('inside'), ints.front_collar);
    }
    if (this.collar_comp.hasInt('back')) {
      ints.back_collar = this.collar_comp.int('back');
      ints.back_in = Interface.fromMultiple(this.btorso.int('inside'), ints.back_collar);
    }
    fcInterface.edges.propagateLabel(`${this.name}_collar`);
    bcInterface.edges.propagateLabel(`${this.name}_collar`);
  }

  makeStrapless(body: Body, design: Design): void {
    let outDepth = design.sleeve.connecting_width.v;
    const fInDepth = design.collar.f_strapless_depth.v;
    const bInDepth = design.collar.b_strapless_depth.v;
    const shoulderAngle = deg2rad(bv(body, '_shoulder_incl'));
    const sleeveBalance = bv(body, '_base_sleeve_balance') / 2;
    const backW = this.btorso.getWidth(0);
    const shoulderAdj = tan(shoulderAngle) * (backW - sleeveBalance);
    outDepth -= shoulderAdj;
    this.adjustTopLevel(this.btorso, outDepth, bInDepth);
    const lenBack = this.btorso.int('outside').edges.totalLength();
    const lenFront = this.ftorso.int('outside').edges.totalLength();
    this.adjustTopLevel(this.ftorso, outDepth, fInDepth, lenFront - lenBack);
    this.ftorso.int('shoulder').edges.propagateLabel('strapless_top');
    this.btorso.int('shoulder').edges.propagateLabel('strapless_top');
  }

  private adjustTopLevel(panel: BaseBodicePanel, outLevelIn: number, inLevel: number, targetRemove?: number): void {
    let outLevel = outLevelIn;
    const top = panel.int('shoulder').edges.edges[0]!;
    const minY = Math.min(top.start[1]!, top.end[1]!);
    let ins = top.start;
    let out = top.end;
    if (top.start[1]! < top.end[1]!) {
      ins = top.end;
      out = top.start;
    }
    ins[1] = minY - inLevel;
    const outside = panel.int('outside').edges.at(-1);
    let bot = outside.start;
    if (bot === out) bot = outside.end;
    if (targetRemove !== undefined) {
      const angleSin = Math.abs(out[1]! - bot[1]!) / outside.length();
      const currRemove = outLevel / angleSin;
      const lengthDiff = targetRemove - currRemove;
      outLevel += lengthDiff * angleSin;
    }
    const angleCotan = Math.abs(out[0]! - bot[0]!) / Math.abs(out[1]! - bot[1]!);
    out[0] = out[0]! - outLevel * angleCotan;
    out[1] = minY - outLevel;
  }

  override length(): number {
    return this.btorso.length();
  }
}

export class Shirt extends Component {
  right: BodiceHalf;
  left: BodiceHalf;

  constructor(body: Body, designIn: Design, fitted = false, className = 'Shirt') {
    super(className);
    const design = Shirt.evalDepParams(designIn);
    this.right = new BodiceHalf('right', body, design, fitted);
    this.left = new BodiceHalf('left', body, design.left.enable_asym.v ? design.left : design, fitted).mirror();
    this.stitchingRules.append([this.right.int('front_in'), this.left.int('front_in')]);
    this.stitchingRules.append([this.right.int('back_in'), this.left.int('back_in')]);
    this.interfaces = {
      bottom: Interface.fromMultiple(this.right.int('f_bottom').reverse(), this.left.int('f_bottom'), this.left.int('b_bottom').reverse(), this.right.int('b_bottom')),
    };
  }

  static evalDepParams(designIn: Design): Design {
    let design = designIn;
    if (design.left.enable_asym.v) {
      design = deepcopy(design);
      design.collar.component.style.v = null;
      design.left.collar.component = { style: { v: null } };
      design.left.shirt.length = { v: design.shirt.length.v };
      design.left.collar.fc_depth = { v: design.collar.fc_depth.v };
      design.left.collar.bc_depth = { v: design.collar.bc_depth.v };
    }
    return design;
  }

  override length(): number {
    return this.right.length();
  }
}

export class FittedShirt extends Shirt {
  constructor(body: Body, design: Design) {
    super(body, design, true, 'FittedShirt');
  }
}
