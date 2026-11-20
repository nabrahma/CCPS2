/** Waistbands and cuffs (port of assets/garment_programs/bands.py). */
import { fromVerts } from '../edge-factory';
import { Interface, Stitches } from '../interface';
import { Component, Panel } from '../panel';
import { linInterpolation } from '../utils';
import { BaseBand, bv, type Body, type Design } from './base';
import { CircleArcPanel } from './circle-skirt';
import { SkirtPanel } from './skirt-paneled';

export class StraightBandPanel extends Panel {
  constructor(name: string, width: number, depth: number, matchIntProportion: number | null = null) {
    super(name);
    this.edges = fromVerts(
      [
        [0, 0],
        [0, depth],
        [width, depth],
        [width, 0],
      ],
      true,
    );
    const ruffle = matchIntProportion !== null ? width / matchIntProportion : 1;
    this.interfaces = {
      right: new Interface(this, this.edges.edges[0]!),
      top: new Interface(this, this.edges.edges[1]!, ruffle).reverse(true),
      left: new Interface(this, this.edges.edges[2]!),
      bottom: new Interface(this, this.edges.edges[3]!, ruffle),
    };
    this.topCenterPivot();
    this.centerX();
  }
}

export class StraightWB extends BaseBand {
  declare waist: number;
  declare waistBackFrac: number;
  declare hips: number;
  declare hipsBackFrac: number;
  declare width: number;
  declare topWidth: number;
  declare topBackFraction: number;
  declare front: Panel;
  declare back: Panel;

  constructor(body: Body, design: Design, rise = 1, className = 'StraightWB') {
    super(className, body, design, '', rise);
    this.waist = design.waistband.waist.v * bv(body, 'waist');
    this.waistBackFrac = bv(body, 'waist_back_width') / bv(body, 'waist');
    this.hips = bv(body, 'hips') * design.waistband.waist.v;
    this.hipsBackFrac = bv(body, 'hip_back_width') / bv(body, 'hips');
    this.width = design.waistband.width.v;
    this.rise = rise;
    if (this.rise + this.width > 1) this.rise = 1 - this.width;
    this.topWidth = linInterpolation(this.hips, this.waist, this.rise + this.width);
    this.topBackFraction = linInterpolation(this.hipsBackFrac, this.waistBackFrac, this.rise + this.width);
    this.width = this.width * bv(body, 'hips_line');
    this.definePanels();
    this.front.translateBy([0, bv(body, '_waist_level'), 20]);
    this.back.translateBy([0, bv(body, '_waist_level'), -15]);
    this.stitchingRules = new Stitches([this.front.int('right'), this.back.int('right')], [this.front.int('left'), this.back.int('left')]);
    this.interfaces = {
      bottom_f: this.front.int('bottom'),
      bottom_b: this.back.int('bottom'),
      top_f: this.front.int('top'),
      top_b: this.back.int('top'),
      bottom: Interface.fromMultiple(this.front.int('bottom'), this.back.int('bottom')),
      top: Interface.fromMultiple(this.front.int('top'), this.back.int('top')),
    };
  }

  definePanels(): void {
    const body = this.body!;
    const backWidth = this.topWidth * this.topBackFraction;
    this.front = new StraightBandPanel('wb_front', this.topWidth - backWidth, this.width, body.waist! - body.waist_back_width!);
    this.back = new StraightBandPanel('wb_back', backWidth, this.width, body.waist_back_width!);
  }
}

export class FittedWB extends StraightWB {
  declare bottomWidth: number;
  declare bottomBackFraction: number;

  constructor(body: Body, design: Design, rise = 1) {
    super(body, design, rise, 'FittedWB');
  }

  override definePanels(): void {
    const body = this.body!;
    this.bottomWidth = linInterpolation(this.hips, this.waist, this.rise!);
    this.bottomBackFraction = linInterpolation(this.hipsBackFrac, this.waistBackFrac, this.rise!);
    this.front = CircleArcPanel.fromAllLength('wb_front', this.width, this.topWidth * (1 - this.topBackFraction), this.bottomWidth * (1 - this.bottomBackFraction), body.waist! - body.waist_back_width!, body.waist! - body.waist_back_width!);
    this.back = CircleArcPanel.fromAllLength('wb_back', this.width, this.topWidth * this.topBackFraction, this.bottomWidth * this.bottomBackFraction, body.waist_back_width!, body.waist_back_width!);
  }
}

export class CuffBand extends BaseBand {
  front: Panel;
  back: Panel;

  constructor(tag: string, design: Design, length?: number | null) {
    super('CuffBand', null, design, tag);
    this.design = design.cuff;
    const len = length ?? this.design.cuff_len.v;
    this.front = new StraightBandPanel(`${tag}_cuff_f`, this.design.b_width.v / 2, len);
    this.front.translateBy([0, 0, 15]);
    this.back = new StraightBandPanel(`${tag}_cuff_b`, this.design.b_width.v / 2, len);
    this.back.translateBy([0, 0, -15]);
    this.stitchingRules = new Stitches([this.front.int('right'), this.back.int('right')], [this.front.int('left'), this.back.int('left')]);
    this.interfaces = {
      bottom: Interface.fromMultiple(this.front.int('bottom'), this.back.int('bottom')),
      top_front: this.front.int('top'),
      top_back: this.back.int('top'),
      top: Interface.fromMultiple(this.front.int('top'), this.back.int('top')),
    };
  }
}

export class CuffSkirt extends BaseBand {
  front: Panel;
  back: Panel;

  constructor(tag: string, design: Design, length?: number | null) {
    super('CuffSkirt', null, design, tag);
    this.design = design.cuff;
    const width = this.design.b_width.v;
    const flareDiff = ((this.design.skirt_flare.v - 1) * width) / 2;
    const len = length ?? this.design.cuff_len.v;
    this.front = new SkirtPanel(`${tag}_cuff_skirt_f`, width / 2, len, this.design.skirt_ruffle.v, null, 0, flareDiff);
    this.front.translateBy([0, 0, 15]);
    this.back = new SkirtPanel(`${tag}_cuff_skirt_b`, width / 2, len, this.design.skirt_ruffle.v, null, 0, flareDiff);
    this.back.translateBy([0, 0, -15]);
    this.stitchingRules = new Stitches([this.front.int('right'), this.back.int('right')], [this.front.int('left'), this.back.int('left')]);
    this.interfaces = {
      top: Interface.fromMultiple(this.front.int('top'), this.back.int('top')),
      top_front: this.front.int('top'),
      top_back: this.back.int('top'),
      bottom: Interface.fromMultiple(this.front.int('bottom'), this.back.int('bottom')),
    };
  }
}

export class CuffBandSkirt extends Component {
  cuff: CuffBand;
  skirt: CuffSkirt;

  constructor(tag: string, design: Design) {
    super('CuffBandSkirt');
    this.cuff = new CuffBand(tag, design, design.cuff.cuff_len.v * (1 - design.cuff.skirt_fraction.v));
    this.skirt = new CuffSkirt(tag, design, design.cuff.cuff_len.v * design.cuff.skirt_fraction.v);
    this.skirt.placeBelow(this.cuff);
    this.stitchingRules = new Stitches([this.cuff.int('bottom'), this.skirt.int('top')]);
    this.interfaces = {
      top: this.cuff.int('top'),
      top_front: this.cuff.int('top_front'),
      top_back: this.cuff.int('top_back'),
      bottom: this.skirt.int('bottom'),
    };
  }

  override length(): number {
    return this.cuff.length() + this.skirt.length();
  }
}

export const CUFFS = {
  CuffBand: (tag: string, d: Design) => new CuffBand(tag, d),
  CuffSkirt: (tag: string, d: Design) => new CuffSkirt(tag, d),
  CuffBandSkirt: (tag: string, d: Design) => new CuffBandSkirt(tag, d),
} as const;

export function makeCuff(type: string, tag: string, design: Design): Component {
  const f = (CUFFS as Record<string, (t: string, d: Design) => Component>)[type];
  if (!f) throw Object.assign(new Error(`AttributeError: module 'bands' has no attribute '${type}'`), { pyType: 'AttributeError' });
  return f(tag, design);
}
