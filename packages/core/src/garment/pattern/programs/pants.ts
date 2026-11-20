/** Trousers (port of assets/garment_programs/pants.py). */
import { PI, tan } from '../../../math/dmath';
import { Edge, EdgeSequence } from '../edge';
import { curveFromTangents, dartShape } from '../edge-factory';
import { Interface, Stitches } from '../interface';
import { Panel, type Component } from '../panel';
import { closeEnough, deepcopy } from '../utils';
import { makeCuff } from './bands';
import { BaseBottoms, bv, type Body, type Design } from './base';

const deg2rad = (d: number): number => d * (PI / 180);

export class PantPanel extends Panel {
  constructor(name: string, body: Body, design: Design, length: number, waist: number, hips: number, hipsDepthIn: number, crotchWidth: number, dartPosition: number, matchTopIntTo: number | null = null, hiplineExt = 1, doubleDart = false) {
    super(name);
    const flare = (bv(body, 'leg_circ') * (design.flare.v - 1)) / 4;
    const hipsDepth = hipsDepthIn * hiplineExt;
    const hipSideIncl = deg2rad(bv(body, '_hip_inclination'));
    const dartDepth = hipsDepth * 0.8;
    const crotchDepthDiff = bv(body, 'crotch_hip_diff');
    const crotchExtention = crotchWidth;
    const wDiff = hips - waist;
    let hwShift = tan(hipSideIncl) * hipsDepth;
    if (hwShift > wDiff) hwShift = wDiff;
    const rightBottom: Edge = closeEnough(design.flare.v, 1) ? new Edge([-flare, 0], [0, length]) : curveFromTangents([-flare, 0], [0, length], null, [0, 1], [0.75, 0]);
    const rightTop = curveFromTangents(rightBottom.end, [hwShift, length + hipsDepth], [0, 1], null, [0.5, 0]);
    const top = new Edge(rightTop.end, [wDiff + waist, length + hipsDepth]);
    const crotchTop = new Edge(top.end, [hips, length + 0.45 * hipsDepth]);
    const crotchBottom = curveFromTangents(crotchTop.end, [hips + crotchExtention, length - crotchDepthDiff], [0, -1], [1, 0], [0.5, -0.5]);
    const y = Math.min(0, length - crotchDepthDiff * 1.5);
    const left = curveFromTangents(crotchBottom.end, [crotchBottom.end[0]! - 2 + flare, y], null, [flare, y - crotchBottom.end[1]!], [0.3, 0]);
    this.edges = new EdgeSequence(rightBottom, rightTop, top, crotchTop, crotchBottom, left).closeLoop();
    const bottom = this.edges.at(-1);
    this.setPivot(crotchBottom.end);
    this.translation = [-0.5, -hipsDepth - crotchDepthDiff + 5, 0];
    this.interfaces = {
      outside: new Interface(this, new EdgeSequence(rightBottom, rightTop), [1, hiplineExt]),
      crotch: new Interface(this, new EdgeSequence(crotchTop, crotchBottom)),
      inside: new Interface(this, left),
      bottom: new Interface(this, bottom),
    };
    const dartWidth = wDiff - hwShift;
    const ruffle = matchTopIntTo !== null ? waist / matchTopIntTo : 1;
    if (wDiff > hwShift) {
      const [topEdges, intEdges] = this.addDarts(top, dartWidth, dartDepth, dartPosition, doubleDart);
      this.interfaces.top = new Interface(this, intEdges, ruffle);
      this.edges.substitute(top, topEdges);
    } else this.interfaces.top = new Interface(this, top, ruffle);
  }

  addDarts(top: Edge, dartWidth: number, dartDepth: number, dartPosition: number, doubleDart: boolean): [EdgeSequence, EdgeSequence] {
    let offsetsMid: number[];
    let darts: EdgeSequence[];
    if (doubleDart) {
      const dist = dartPosition * 0.5;
      offsetsMid = [-(dartPosition + dist / 2 + dartWidth / 2 + dartWidth / 4), -(dartPosition - dist / 2) - dartWidth / 4];
      darts = [dartShape(dartWidth / 2, dartDepth * 0.9), dartShape(dartWidth / 2, dartDepth)];
    } else {
      offsetsMid = [-dartPosition - dartWidth / 2];
      darts = [dartShape(dartWidth, dartDepth)];
    }
    let topEdges = new EdgeSequence(top);
    let intEdges = new EdgeSequence(top);
    for (let i = 0; i < offsetsMid.length; i++) {
      const leftEdgeLen = topEdges.at(-1).length();
      [topEdges, intEdges] = this.addDart(darts[i]!, topEdges.at(-1), leftEdgeLen + offsetsMid[i]!, true, topEdges, intEdges);
    }
    return [topEdges, intEdges];
  }
}

export class PantsHalf extends BaseBottoms {
  front: PantPanel;
  back: PantPanel;
  cuff?: Component;

  constructor(tag: string, body: Body, designIn: Design, rise: number | null = null) {
    super('PantsHalf', body, designIn, tag, rise);
    const design = designIn.pants;
    this.rise = rise ?? design.rise.v;
    const [waist, hipsDepth, waistBack] = this.evalRise(this.rise!);
    const minExt = bv(body, 'leg_circ') - bv(body, 'hips') / 2 + 5;
    const frontHip = (bv(body, 'hips') - bv(body, 'hip_back_width')) / 2;
    const crotchExtention = minExt * design.width.v;
    const frontExtention = frontHip / 4;
    const backExtention = crotchExtention - frontExtention;
    let length: number = design.length.v;
    let cuffLen: number = design.cuff.cuff_len.v;
    if (design.cuff.type.v) {
      if (length - cuffLen < design.length.range[0]) cuffLen = length - design.length.range[0];
      length -= cuffLen;
    }
    length *= bv(body, '_leg_length');
    cuffLen *= bv(body, '_leg_length');
    this.front = new PantPanel(`pant_f_${tag}`, body, design, length, (waist - waistBack) / 2, (bv(body, 'hips') - bv(body, 'hip_back_width')) / 2, hipsDepth, frontExtention, bv(body, 'bust_points') / 2, (bv(body, 'waist') - bv(body, 'waist_back_width')) / 2).translateBy([0, bv(body, '_waist_level') - 5, 25]);
    this.back = new PantPanel(`pant_b_${tag}`, body, design, length, waistBack / 2, bv(body, 'hip_back_width') / 2, hipsDepth, backExtention, bv(body, 'bum_points') / 2, bv(body, 'waist_back_width') / 2, 1.1, true).translateBy([0, bv(body, '_waist_level') - 5, -20]);
    this.stitchingRules = new Stitches([this.front.int('outside'), this.back.int('outside')], [this.front.int('inside'), this.back.int('inside')]);
    if (design.cuff.type.v) {
      const pantBottom = Interface.fromMultiple(this.front.int('bottom'), this.back.int('bottom'));
      const cdesign = deepcopy(design);
      cdesign.cuff.b_width = { v: pantBottom.edges.totalLength() / design.cuff.top_ruffle.v };
      cdesign.cuff.cuff_len.v = cuffLen;
      this.cuff = makeCuff(cdesign.cuff.type.v, `pant_${tag}`, cdesign);
      this.cuff.placeByInterface(this.cuff.int('top'), pantBottom, 5, 'left');
      // The cuff is narrower than the leg by its top_ruffle parameter: a gather by design.
      this.stitchingRules.append([pantBottom, this.cuff.int('top')]).intendedGather = !closeEnough(design.cuff.top_ruffle.v, 1, 1e-3);
    }
    this.interfaces = {
      crotch_f: this.front.int('crotch'),
      crotch_b: this.back.int('crotch'),
      top_f: this.front.int('top'),
      top_b: this.back.int('top'),
    };
  }

  override length(): number {
    if (this.design.pants.cuff.type.v) return this.front.length() + this.cuff!.length();
    return this.front.length();
  }
}

export class Pants extends BaseBottoms {
  right: PantsHalf;
  left: PantsHalf;

  constructor(body: Body, design: Design, rise: number | null = null) {
    super('Pants', body, design);
    this.right = new PantsHalf('r', body, design, rise);
    this.left = new PantsHalf('l', body, design, rise).mirror();
    this.stitchingRules = new Stitches([this.right.int('crotch_f'), this.left.int('crotch_f')], [this.right.int('crotch_b'), this.left.int('crotch_b')]);
    this.interfaces = {
      top_f: Interface.fromMultiple(this.right.int('top_f'), this.left.int('top_f')),
      top_b: Interface.fromMultiple(this.right.int('top_b'), this.left.int('top_b')),
      top: Interface.fromMultiple(this.right.int('top_f').flipEdges(), this.left.int('top_f').reverse(true), this.left.int('top_b').flipEdges(), this.right.int('top_b').reverse(true)),
    };
  }

  override getRise(): number | null {
    return this.right.getRise();
  }

  override length(): number {
    return this.right.length();
  }
}
