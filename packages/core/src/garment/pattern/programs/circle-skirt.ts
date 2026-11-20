/** Circle skirts (port of assets/garment_programs/circle_skirt.py). */
import { cos, PI, sin } from '../../../math/dmath';
import { Edge } from '../edge';
import { circleFromPointsRadius, circleFromThreePoints, dartShape } from '../edge-factory';
import { Interface, Stitches } from '../interface';
import { sq } from '../num/sq';
import { cutIntoEdge } from '../operators';
import { Panel } from '../panel';
import { bv, StackableSkirtComponent, type Body, type Design } from './base';

export class CircleArcPanel extends Panel {
  constructor(name: string, topRad: number, length: number, angle: number, matchTopIntProportion: number | null = null, matchBottomIntProportion: number | null = null) {
    super(name);
    const halfarc = angle / 2;
    const distW = 2 * topRad * sin(halfarc);
    const distOut = 2 * (topRad + length) * sin(halfarc);
    const vertLen = length * cos(halfarc);
    this.edges.append(circleFromPointsRadius([-distW / 2, 0], [distW / 2, 0], topRad, halfarc > PI / 2));
    this.edges.append(new Edge(this.edges.at(-1).end, [distOut / 2, -vertLen]));
    this.edges.append(circleFromPointsRadius(this.edges.at(-1).end, [-distOut / 2, -vertLen], topRad + length, halfarc > PI / 2, false));
    this.edges.closeLoop();
    const e = this.edges.edges;
    this.interfaces = {
      top: new Interface(this, e[0]!, matchTopIntProportion !== null ? e[0]!.length() / matchTopIntProportion : 1).reverse(true),
      bottom: new Interface(this, e[2]!, matchBottomIntProportion !== null ? e[2]!.length() / matchBottomIntProportion : 1),
      left: new Interface(this, e[1]!),
      right: new Interface(this, e[3]!),
    };
  }

  override length(): number {
    return this.int('right').edges.totalLength();
  }

  static fromWLengthSuns(name: string, length: number, topWidth: number, sunFraction: number, matchTop: number | null = null, matchBottom: number | null = null): CircleArcPanel {
    const arc = sunFraction * 2 * PI;
    return new CircleArcPanel(name, topWidth / arc, length, arc, matchTop, matchBottom);
  }

  static fromAllLength(name: string, length: number, topWidth: number, bottomWidth: number, matchTop: number | null = null, matchBottom: number | null = null): CircleArcPanel {
    const arc = (bottomWidth - topWidth) / length;
    return new CircleArcPanel(name, topWidth / arc, length, arc, matchTop, matchBottom);
  }

  static fromLengthRad(name: string, length: number, topWidth: number, rad: number, matchTop: number | null = null, matchBottom: number | null = null): CircleArcPanel {
    return new CircleArcPanel(name, rad, length, topWidth / rad, matchTop, matchBottom);
  }
}

export class AsymHalfCirclePanel extends Panel {
  constructor(name: string, topRad: number, lengthF: number, lengthS: number, matchTopIntProportion: number | null = null, matchBottomIntProportion: number | null = null) {
    super(name);
    const distW = 2 * topRad;
    const distOut = 2 * (topRad + lengthS);
    this.edges.append(circleFromPointsRadius([-distW / 2, 0], [distW / 2, 0], topRad, false));
    this.edges.append(new Edge(this.edges.at(-1).end, [distOut / 2, 0]));
    this.edges.append(circleFromThreePoints(this.edges.at(-1).end, [-distOut / 2, 0], [0, -(topRad + lengthF)]));
    this.edges.closeLoop();
    const e = this.edges.edges;
    this.interfaces = {
      top: new Interface(this, e[0]!, matchTopIntProportion !== null ? e[0]!.length() / matchTopIntProportion : 1).reverse(true),
      bottom: new Interface(this, e[2]!, matchBottomIntProportion !== null ? e[2]!.length() / matchBottomIntProportion : 1),
      left: new Interface(this, e[1]!),
      right: new Interface(this, e[3]!),
    };
  }

  override length(): number {
    return this.int('right').edges.totalLength();
  }
}

export interface SkirtOptions {
  tag?: string;
  length?: number | null;
  rise?: number | null;
  slit?: boolean;
  topRuffles?: boolean;
}

export class SkirtCircle extends StackableSkirtComponent {
  front: Panel;
  back: Panel;

  constructor(body: Body, design: Design, opts: SkirtOptions = {}, asymm = false, minLen = 5, className = 'SkirtCircle') {
    const tag = opts.tag ?? '';
    super(className, body, design, tag);
    const d = design['flare-skirt'];
    const suns = d.suns.v;
    this.rise = opts.rise ?? d.rise.v;
    const [waist, hipsDepth] = this.evalRise(this.rise!);
    let length = opts.length ?? hipsDepth + d.length.v * bv(body, '_leg_length');
    length = Math.max(length, minLen);
    const fname = tag ? `skirt_front_${tag}` : 'skirt_front';
    const bname = tag ? `skirt_back_${tag}` : 'skirt_back';
    if (!asymm) {
      this.front = CircleArcPanel.fromWLengthSuns(fname, length, waist / 2, suns / 2, bv(body, 'waist') - bv(body, 'waist_back_width')).translateBy([0, bv(body, '_waist_level'), 15]);
      this.back = CircleArcPanel.fromWLengthSuns(bname, length, waist / 2, suns / 2, bv(body, 'waist_back_width')).translateBy([0, bv(body, '_waist_level'), -15]);
    } else {
      const wRad = waist / 2 / PI;
      const fLength = d.asymm.front_length.v * length;
      const totLen = wRad * 2 + length + fLength;
      const delR = totLen / 2 - fLength - wRad;
      const sLength = Math.sqrt(sq(totLen / 2) - sq(delR)) - wRad;
      this.front = new AsymHalfCirclePanel(fname, wRad, fLength, sLength, bv(body, 'waist') - bv(body, 'waist_back_width')).translateBy([0, bv(body, '_waist_level'), 15]);
      this.back = new AsymHalfCirclePanel(bname, wRad, length, sLength, bv(body, 'waist_back_width')).translateBy([0, bv(body, '_waist_level'), -15]);
    }
    if (d.cut.add.v && (opts.slit ?? true)) this.addCut(d.cut.place.v > 0 ? this.front : this.back, d, length);
    this.stitchingRules = new Stitches([this.front.int('right'), this.back.int('right')], [this.front.int('left'), this.back.int('left')]);
    this.interfaces = {
      top: Interface.fromMultiple(this.front.int('top'), this.back.int('top')),
      bottom_f: this.front.int('bottom'),
      bottom_b: this.back.int('bottom'),
      bottom: Interface.fromMultiple(this.front.int('bottom'), this.back.int('bottom')),
    };
  }

  addCut(panel: Panel, design: Design, skLength: number): void {
    const width = design.cut.width.v * skLength;
    const depth = design.cut.depth.v * skLength;
    const target = panel.int('bottom').edges.edges[0]!;
    const tLen = target.length();
    let offset = Math.abs(design.cut.place.v * tLen);
    offset = Math.max(offset, width / 2);
    offset = Math.min(offset, tLen - width / 2);
    const right = target.start[0]! > target.end[0]!;
    const cut = dartShape(width, null, depth);
    const [newEdges, , interf] = cutIntoEdge(cut, target, offset, right);
    panel.edges.substitute(target, newEdges);
    panel.int('bottom').substitute(
      target,
      interf,
      interf.edges.map(() => panel),
    );
  }

  override length(): number {
    return this.front.length();
  }
}

export class AsymmSkirtCircle extends SkirtCircle {
  constructor(body: Body, design: Design, opts: SkirtOptions = {}) {
    super(body, design, opts, true, 5, 'AsymmSkirtCircle');
  }
}
