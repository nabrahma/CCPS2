/** Panel skirts (port of assets/garment_programs/skirt_paneled.py). */
import { PI, tan } from '../../../math/dmath';
import { Edge, EdgeSequence } from '../edge';
import { circleFromThreePoints, curveFromTangents, dartShape, fromVerts, sideWithCut } from '../edge-factory';
import { Interface, Stitches } from '../interface';
import { Rotation } from '../num/rotation';
import { cutIntoEdge, distributeY } from '../operators';
import { Panel } from '../panel';
import { closeEnough } from '../utils';
import { BaseBottoms, bv, StackableSkirtComponent, type Body, type Design } from './base';
import type { SkirtOptions } from './circle-skirt';

const deg2rad = (d: number): number => d * (PI / 180);

export class SkirtPanel extends Panel {
  right: EdgeSequence;
  waist: Edge;
  left: EdgeSequence;
  bottom: Edge;

  constructor(name: string, waistLength = 70, length = 70, ruffles = 1, matchTopIntTo: number | null = null, bottomCut = 0, flare = 0) {
    super(name);
    const baseWidth = waistLength;
    const topWidth = baseWidth * ruffles;
    const lowWidth = topWidth + 2 * flare;
    const xShiftTop = (lowWidth - topWidth) / 2;
    this.right = bottomCut ? sideWithCut([0, 0], [xShiftTop, length], bottomCut / length) : new EdgeSequence(new Edge([0, 0], [xShiftTop, length]));
    this.waist = new Edge(this.right.at(-1).end, [xShiftTop + topWidth, length]);
    this.left = bottomCut ? sideWithCut(this.waist.end, [lowWidth, 0], 0, bottomCut / length) : new EdgeSequence(new Edge(this.waist.end, [lowWidth, 0]));
    this.bottom = new Edge(this.left.at(-1).end, this.right.edges[0]!.start);
    this.interfaces = {
      right: new Interface(this, this.right.at(-1)),
      top: new Interface(this, this.waist, matchTopIntTo !== null ? this.waist.length() / matchTopIntTo : ruffles).reverse(true),
      left: new Interface(this, this.left.edges[0]!),
      bottom: new Interface(this, this.bottom),
    };
    this.edges = this.right;
    this.edges.append(this.waist);
    this.edges.append(this.left);
    this.edges.append(this.bottom);
    this.topCenterPivot();
    this.centerX();
  }
}

export class ThinSkirtPanel extends Panel {
  flare: number;

  constructor(name: string, topWidth = 10, bottomWidth = 20, length = 70, bCurvature = 0) {
    super(name);
    this.flare = (bottomWidth - topWidth) / 2;
    this.edges = fromVerts([
      [0, 0],
      [this.flare, length],
      [this.flare + topWidth, length],
      [this.flare * 2 + topWidth, 0],
    ]);
    if (closeEnough(bCurvature, 0)) this.edges.closeLoop();
    else this.edges.append(circleFromThreePoints(this.edges.at(-1).end, this.edges.edges[0]!.start, [0.5, bCurvature], true));
    this.setPivot(this.edges.edges[0]!.end);
    const e = this.edges.edges;
    this.interfaces = {
      right: new Interface(this, e[0]!),
      top: new Interface(this, e[1]!),
      left: new Interface(this, e[2]!),
      bottom: new Interface(this, this.edges.at(-1)),
    };
  }
}

export interface FittedSkirtOptions {
  hiplineExt?: number;
  dartPosition?: number;
  dartFrac?: number;
  doubleDart?: boolean;
  matchTopIntTo?: number | null;
  slit?: number;
  leftSlit?: number;
  rightSlit?: number;
  sideCut?: EdgeSequence | EdgeSequence[] | null;
  flipSideCut?: boolean;
}

export class FittedSkirtPanel extends Panel {
  constructor(name: string, body: Body, design: Design, waist: number, hips: number, hipsDepth: number, length: number, o: FittedSkirtOptions = {}) {
    super(name);
    const hiplineExt = o.hiplineExt ?? 1;
    const dartFrac = o.dartFrac ?? 0.5;
    const lowAngle = design.low_angle.v;
    const hipSideIncl = deg2rad(bv(body, '_hip_inclination'));
    const flare = design.flare.v;
    const lowWidth = (bv(body, 'hips') * (flare - 1)) / 4 + hips;
    const adjHipsDepth = hipsDepth * hiplineExt;
    let dartDepth = hipsDepth * dartFrac;
    dartDepth = Math.max(dartDepth - (hipsDepth - adjHipsDepth), 0);
    const wDiff = hips - waist;
    let hwShift = tan(hipSideIncl) * adjHipsDepth;
    if (hwShift > wDiff) hwShift = wDiff;
    const angleShift = tan(deg2rad(lowAngle)) * lowWidth;
    const rightBottom: Edge = closeEnough(flare, 1) ? new Edge([hips - lowWidth, angleShift], [0, length]) : curveFromTangents([hips - lowWidth, angleShift], [0, length], null, [0, 1], [0.75, 0]);
    const rightTop = curveFromTangents(rightBottom.end, [hwShift, length + adjHipsDepth], [0, 1], null, [0.5, 0]);
    const right = new EdgeSequence(rightBottom, rightTop);
    const top = new Edge(right.at(-1).end, [hips * 2 - hwShift, length + adjHipsDepth]);
    const leftTop = curveFromTangents(top.end, [hips * 2, length], null, [0, -1], [0.5, 0]);
    let leftBottom: Edge = closeEnough(flare, 1) ? new Edge(leftTop.end, [hips + lowWidth, -angleShift]) : curveFromTangents(leftTop.end, [hips + lowWidth, -angleShift], [0, -1], null, [0.25, 0]);
    const left = new EdgeSequence(leftTop, leftBottom);
    this.edges = new EdgeSequence(right, top, left).closeLoop();
    let bottom: Edge | EdgeSequence = this.edges.at(-1);
    if (o.slit) {
      const be = bottom as Edge;
      const [newEdges, , intEdges] = cutIntoEdge(dartShape(2, null, o.slit * length), be, be.length() / 2, true);
      this.edges.substitute(be, newEdges);
      bottom = intEdges;
    }
    if (o.leftSlit) {
      const frac = o.leftSlit;
      const nlb = leftBottom.subdivideLen([1 - frac, frac]);
      left.substitute(leftBottom, nlb.edges[0]!);
      this.edges.substitute(leftBottom, nlb);
      leftBottom = nlb.edges[0]!;
    }
    if (o.rightSlit) {
      const frac = o.rightSlit;
      const nrb = rightBottom.subdivideLen([frac, 1 - frac]);
      right.substitute(rightBottom, nrb.edges[1]!);
      this.edges.substitute(rightBottom, nrb);
    }
    if (o.sideCut) {
      try {
        const [newEdges] = cutIntoEdge(o.sideCut, leftBottom, leftBottom.length() / 2, true, o.flipSideCut ?? false);
        this.edges.substitute(leftBottom, newEdges);
        left.substitute(leftBottom, newEdges);
      } catch {
        // GarmentCode skips the decorative cut when it does not fit
      }
    }
    this.topCenterPivot();
    this.translation = [-hips / 2, 5, 0];
    this.interfaces = {
      bottom: new Interface(this, bottom),
      right: new Interface(this, right, [...Array.from({ length: right.length - 1 }, () => 1), hiplineExt]),
      left: new Interface(this, left, [hiplineExt, ...Array.from({ length: left.length - 1 }, () => 1)]),
    };
    this.int('left').edgesFlipping[0] = true;
    this.int('right').edgesFlipping[this.int('right').edgesFlipping.length - 1] = true;
    if (wDiff > hwShift) {
      const dartWidth = wDiff - hwShift;
      const [topEdges, intEdges] = this.addDarts(top, dartWidth, dartDepth, o.dartPosition!, o.doubleDart ?? false);
      this.interfaces.top = new Interface(this, intEdges, o.matchTopIntTo != null ? intEdges.totalLength() / o.matchTopIntTo : 1);
      this.edges.substitute(top, topEdges);
    } else this.interfaces.top = new Interface(this, top, o.matchTopIntTo != null ? top.length() / o.matchTopIntTo : 1);
  }

  addDarts(top: Edge, dartWidth: number, dartDepth: number, dartPosition: number, doubleDart: boolean): [EdgeSequence, EdgeSequence] {
    const topEdgeLen = top.length();
    let offsetsMid: number[];
    let darts: EdgeSequence[];
    if (doubleDart) {
      const dist = dartPosition * 0.5;
      offsetsMid = [-(dartPosition + dist / 2 + dartWidth / 2) - dartWidth / 4, -(dartPosition - dist / 2) - dartWidth / 4, dartPosition - dist / 2 + dartWidth / 4, dartPosition + dist / 2 + dartWidth / 2 + dartWidth / 4];
      const full = dartShape(dartWidth / 2, dartDepth);
      const small = dartShape(dartWidth / 2, dartDepth * 0.9);
      darts = [small, full, full, small];
    } else {
      offsetsMid = [-dartPosition - dartWidth / 2, dartPosition + dartWidth / 2];
      const d = dartShape(dartWidth, dartDepth);
      darts = [d, d];
    }
    let topEdges = new EdgeSequence(top);
    let intEdges = new EdgeSequence(top);
    for (let i = 0; i < offsetsMid.length; i++) {
      const leftEdgeLen = topEdges.at(-1).length();
      [topEdges, intEdges] = this.addDart(darts[i]!, topEdges.at(-1), leftEdgeLen - topEdgeLen / 2 + offsetsMid[i]!, true, topEdges, intEdges);
    }
    return [topEdges, intEdges];
  }
}

export class PencilSkirt extends StackableSkirtComponent {
  front: FittedSkirtPanel;
  back: FittedSkirtPanel;

  constructor(body: Body, design: Design, opts: SkirtOptions = {}) {
    super('PencilSkirt', body, design, opts.tag ?? '');
    const d = design['pencil-skirt'];
    this.design = d;
    if (d.style_side_cut.v !== null && d.style_side_cut.v !== undefined) throw Object.assign(new Error(`decorative side cut '${d.style_side_cut.v}' is not ported (D-171)`), { pyType: 'NotPorted' });
    const slit = opts.slit ?? true;
    this.rise = opts.rise ?? d.rise.v;
    const [waist, hipsDepth, backWaist] = this.evalRise(this.rise!);
    const length = opts.length == null ? d.length.v * bv(body, '_leg_length') : opts.length - hipsDepth;
    this.front = new FittedSkirtPanel('skirt_front', body, d, (waist - backWaist) / 2, (bv(body, 'hips') - bv(body, 'hip_back_width')) / 2, hipsDepth, length, {
      dartPosition: bv(body, 'bust_points') / 2,
      dartFrac: 0.8,
      matchTopIntTo: bv(body, 'waist') - bv(body, 'waist_back_width'),
      slit: slit ? d.front_slit.v : 0,
      leftSlit: slit ? d.left_slit.v : 0,
      rightSlit: slit ? d.right_slit.v : 0,
    }).translateTo([0, bv(body, '_waist_level'), 25]);
    this.back = new FittedSkirtPanel('skirt_back', body, d, backWaist / 2, bv(body, 'hip_back_width') / 2, hipsDepth, length, {
      hiplineExt: 1.05,
      dartPosition: bv(body, 'bum_points') / 2,
      dartFrac: 0.85,
      doubleDart: true,
      matchTopIntTo: bv(body, 'waist_back_width'),
      slit: slit ? d.back_slit.v : 0,
      leftSlit: slit ? d.left_slit.v : 0,
      rightSlit: slit ? d.right_slit.v : 0,
      flipSideCut: false,
    }).translateTo([0, bv(body, '_waist_level'), -20]);
    this.stitchingRules = new Stitches([this.front.int('right'), this.back.int('right')], [this.front.int('left'), this.back.int('left')]);
    this.interfaces = {
      top_f: this.front.int('top'),
      top_b: this.back.int('top'),
      top: Interface.fromMultiple(this.front.int('top').flipEdges(), this.back.int('top').reverse(true)),
      bottom_f: this.front.int('bottom'),
      bottom_b: this.back.int('bottom'),
      bottom: Interface.fromMultiple(this.front.int('bottom'), this.back.int('bottom')),
    };
  }

  override length(): number {
    return this.front.length();
  }
}

export class Skirt2 extends StackableSkirtComponent {
  front: SkirtPanel;
  back: SkirtPanel;

  constructor(body: Body, design: Design, opts: SkirtOptions = {}, minLen = 5) {
    const tag = opts.tag ?? '';
    super('Skirt2', body, design, tag);
    const d = design.skirt;
    const slit = opts.slit ?? true;
    const topRuffles = opts.topRuffles ?? true;
    this.rise = opts.rise ?? d.rise.v;
    const [waist, hipLine, backWaist] = this.evalRise(this.rise!);
    let length = opts.length ?? hipLine + d.length.v * bv(body, '_leg_length');
    length = Math.max(length, minLen);
    this.front = new SkirtPanel(tag ? `skirt_front_${tag}` : 'skirt_front', waist - backWaist, length, topRuffles ? d.ruffle.v : 1, bv(body, 'waist') - bv(body, 'waist_back_width'), slit ? d.bottom_cut.v * d.length.v : 0, d.flare.v).translateTo([0, bv(body, '_waist_level'), 25]);
    this.back = new SkirtPanel(tag ? `skirt_back_${tag}` : 'skirt_back', backWaist, length, topRuffles ? d.ruffle.v : 1, bv(body, 'waist_back_width'), slit ? d.bottom_cut.v * d.length.v : 0, d.flare.v).translateTo([0, bv(body, '_waist_level'), -20]);
    this.stitchingRules = new Stitches([this.front.int('right'), this.back.int('right')], [this.front.int('left'), this.back.int('left')]);
    this.interfaces = {
      top_f: this.front.int('top'),
      top_b: this.back.int('top'),
      top: Interface.fromMultiple(this.front.int('top'), this.back.int('top')),
      bottom_f: this.front.int('bottom'),
      bottom_b: this.back.int('bottom'),
      bottom: Interface.fromMultiple(this.front.int('bottom'), this.back.int('bottom')),
    };
  }

  override length(): number {
    return this.front.length();
  }
}

export class SkirtManyPanels extends BaseBottoms {
  front: ThinSkirtPanel;

  constructor(body: Body, design: Design, opts: { tag?: string; rise?: number | null } = {}, minLen = 5) {
    const tagExtra = String(design['flare-skirt']['skirt-many-panels'].n_panels.v);
    const tag = opts.tag ? `${opts.tag}_${tagExtra}` : tagExtra;
    super('SkirtManyPanels', body, design, tag, opts.rise ?? null);
    const d = design['flare-skirt'];
    this.rise = opts.rise ?? d.rise.v;
    const [waist, hipLine] = this.evalRise(this.rise!);
    const nPanels: number = d['skirt-many-panels'].n_panels.v;
    let length = hipLine + d.length.v * bv(body, '_leg_length');
    length = Math.max(length, minLen);
    const flareCoeffPi = 1 + (d.suns.v * length * 2 * PI) / waist;
    const panelW = waist / nPanels;
    this.front = new ThinSkirtPanel('front', panelW, panelW * flareCoeffPi, length, d['skirt-many-panels'].panel_curve.v);
    const dist = this.front.int('bottom').edges.totalLength() / (2 * tan(PI / nPanels));
    this.front.translateTo([-dist, bv(body, '_waist_level'), 0]);
    this.front.rotateBy(Rotation.fromEuler('XYZ', [0, -90, 0], true));
    this.front.rotateAlign([-dist, 0, panelW / 2]);
    this.front.int('top').reverse(true);
    this.subs = distributeY(this.front, nPanels, 0, 'skirt_panel');
    for (let i = 1; i < nPanels; i++) this.stitchingRules.append([this.subs[i - 1]!.int('left'), this.subs[i]!.int('right')]);
    this.stitchingRules.append([this.subs[this.subs.length - 1]!.int('left'), this.subs[0]!.int('right')]);
    this.interfaces = { top: Interface.fromMultiple(...this.subs.map((s) => s.int('top'))) };
  }

  override length(): number {
    return this.front.length();
  }
}
