/** Straight (non-fitted) torso panels (port of assets/garment_programs/tee.py). */
import { PI, tan } from '../../../math/dmath';
import { fromVerts } from '../edge-factory';
import { Interface } from '../interface';
import { BaseBodicePanel, bv, type Body, type Design } from './base';

const deg2rad = (d: number): number => d * (PI / 180);

export class TorsoFrontHalfPanel extends BaseBodicePanel {
  constructor(name: string, body: Body, designIn: Design) {
    super(name, body, designIn);
    const design = designIn.shirt;
    const mWidth = design.width.v * bv(body, 'bust');
    let bWidth = design.flare.v * mWidth;
    const bodyWidth = (bv(body, 'bust') - bv(body, 'back_width')) / 2;
    const frac = bodyWidth / bv(body, 'bust');
    this.width = frac * mWidth;
    bWidth = frac * bWidth;
    const shTan = tan(deg2rad(bv(body, '_shoulder_incl')));
    const shoulderIncl = shTan * this.width;
    let length = design.length.v * bv(body, 'waist_line');
    const fbDiff = (frac - (0.5 - frac)) * bv(body, 'bust');
    length = length - shTan * fbDiff;
    this.edges = fromVerts(
      [
        [0, 0],
        [-bWidth, 0],
        [-this.width, length],
        [0, length + shoulderIncl],
      ],
      true,
    );
    const e = this.edges;
    this.interfaces = {
      outside: new Interface(this, e.edges[1]!),
      inside: new Interface(this, e.at(-1)),
      shoulder: new Interface(this, e.at(-2)),
      bottom: new Interface(this, e.edges[0]!, e.edges[0]!.length() / ((bv(body, 'waist') - bv(body, 'waist_back_width')) / 2)),
      shoulder_corner: new Interface(this, [e.at(-3), e.at(-2)]),
      collar_corner: new Interface(this, [e.at(-2), e.at(-1)]),
    };
    this.translateBy([0, bv(body, 'height') - bv(body, 'head_l') - length - shoulderIncl, 0]);
  }

  override getWidth(level: number): number {
    return super.getWidth(level) + this.width - this.body.shoulder_w! / 2;
  }
}

export class TorsoBackHalfPanel extends BaseBodicePanel {
  constructor(name: string, body: Body, designIn: Design) {
    super(name, body, designIn);
    const design = designIn.shirt;
    const mWidth = design.width.v * bv(body, 'bust');
    let bWidth = design.flare.v * mWidth;
    const bodyWidth = bv(body, 'back_width') / 2;
    const frac = bodyWidth / bv(body, 'bust');
    this.width = frac * mWidth;
    bWidth = frac * bWidth;
    const shoulderIncl = tan(deg2rad(bv(body, '_shoulder_incl'))) * this.width;
    const length = design.length.v * bv(body, 'waist_line');
    this.edges = fromVerts(
      [
        [0, 0],
        [-bWidth, 0],
        [-this.width, length],
        [0, length + shoulderIncl],
      ],
      true,
    );
    const e = this.edges;
    this.interfaces = {
      outside: new Interface(this, e.edges[1]!),
      inside: new Interface(this, e.at(-1)),
      shoulder: new Interface(this, e.at(-2)),
      bottom: new Interface(this, e.edges[0]!, e.edges[0]!.length() / (bv(body, 'waist_back_width') / 2)),
      shoulder_corner: new Interface(this, [e.at(-3), e.at(-2)]),
      collar_corner: new Interface(this, [e.at(-2), e.at(-1)]),
    };
    this.translateBy([0, bv(body, 'height') - bv(body, 'head_l') - length - shoulderIncl, 0]);
  }

  override getWidth(level: number): number {
    return super.getWidth(level) + this.width - this.body.shoulder_w! / 2;
  }
}
