/** Tiered and godet skirts (port of assets/garment_programs/skirt_levels.py and godet.py). */
import { sq } from '../num/sq';
import { fromVerts } from '../edge-factory';
import { Interface } from '../interface';
import { Rotation } from '../num/rotation';
import { cutIntoEdge, distributeHorizontally } from '../operators';
import { Panel, type BaseComponent } from '../panel';
import { closeEnough, npSign } from '../utils';
import { BaseBottoms, bv, type Body, type Design, type StackableSkirtComponent } from './base';
import { AsymmSkirtCircle, SkirtCircle, type SkirtOptions } from './circle-skirt';
import { PencilSkirt, Skirt2 } from './skirt-paneled';
import type { Edge } from '../edge';

type SkirtCtor = (body: Body, design: Design, opts: SkirtOptions) => StackableSkirtComponent;

export const STACKABLE: Record<string, SkirtCtor> = {
  Skirt2: (b, d, o) => new Skirt2(b, d, o),
  PencilSkirt: (b, d, o) => new PencilSkirt(b, d, o),
  SkirtCircle: (b, d, o) => new SkirtCircle(b, d, o),
  AsymmSkirtCircle: (b, d, o) => new AsymmSkirtCircle(b, d, o),
};

function skirtClass(name: string): SkirtCtor {
  const c = STACKABLE[name];
  if (!c) throw Object.assign(new Error(`KeyError: '${name}'`), { pyType: 'KeyError' });
  return c;
}

export class SkirtLevels extends BaseBottoms {
  declare baseLen: number;
  declare levelLen: number;
  angle: number;

  constructor(body: Body, design: Design, rise: number | null = null) {
    super('SkirtLevels', body, design, '', rise);
    const ld = design['levels-skirt'];
    const lbody: Body = { ...body };
    const nLevels: number = ld.num_levels.v;
    const ruffle = ld.level_ruffle.v;
    this.evalLength(ld, body);
    this.rise = rise ?? ld.rise.v;
    const base = skirtClass(ld.base.v)(body, design, { length: this.baseLen, rise: this.rise, slit: false });
    this.subs.push(base);
    const bd = (base as unknown as { design?: Design }).design;
    this.angle = bd && typeof bd === 'object' && 'low_angle' in bd ? bd.low_angle.v : 0;
    const levelClass = skirtClass(ld.level.v);
    for (let i = 0; i < nLevels; i++) {
      const prev = this.subs[this.subs.length - 1]!;
      lbody.waist = ruffle * prev.int('bottom').edges.totalLength();
      lbody.waist_back_width = ruffle * prev.int('bottom_b').edges.totalLength();
      const lvl = levelClass(lbody, design, { tag: String(i), length: this.levelLen, slit: false, topRuffles: false });
      this.subs.push(lvl);
      lvl.rotateBy(Rotation.fromEuler('XYZ', [0, 0, -this.angle], true));
      lvl.placeByInterface(lvl.int('top'), this.subs[this.subs.length - 2]!.int('bottom'), 5);
      // Each level is cut level_ruffle times wider than the level above: a gather by design.
      this.stitchingRules.append([this.subs[this.subs.length - 2]!.int('bottom'), lvl.int('top')]).intendedGather = !closeEnough(ruffle, 1, 1e-3);
    }
    this.interfaces = { top: this.subs[0]!.int('top') };
  }

  evalLength(ld: Design, body: Body): void {
    const total = ld.length.v * bv(body, '_leg_length');
    this.baseLen = total * ld.base_length_frac.v;
    this.levelLen = (total - this.baseLen) / ld.num_levels.v;
    this.baseLen = bv(body, 'hips_line') * ld.rise.v + this.baseLen;
  }
}

export class Insert extends Panel {
  constructor(id: number, width = 30, depth = 30) {
    super(`Insert_${id}`);
    this.edges = fromVerts(
      [
        [0, 0],
        [width / 2, depth],
        [width, 0],
      ],
      true,
    );
    this.interfaces = [new Interface(this, this.edges.slice(undefined, 2))];
    this.topCenterPivot();
    this.centerX();
  }
}

export class GodetSkirt extends BaseBottoms {
  base: StackableSkirtComponent;

  constructor(body: Body, design: Design, rise: number | null = null) {
    super('GodetSkirt', body, design, '', rise);
    const gd = design['godet-skirt'];
    const insW: number = gd.insert_w.v;
    const insDepth: number = gd.insert_depth.v;
    this.base = skirtClass(gd.base.v)(body, design, { rise, slit: false });
    const bintr = this.base.int('bottom');
    const pairs = bintr.edges.edges.map((e, k) => [e, bintr.panel[k]!] as const);
    for (const [edge, panel] of pairs) this.inserts(edge, panel, insW, insDepth, gd.num_inserts.v / bintr.length, gd.cuts_distance.v);
    this.interfaces = { top: this.base.int('top') };
  }

  inserts(bottomEdgeIn: Edge, panel: Panel, insW: number, insDepth: number, numInsertsF = 3, cutsDist = 0): void {
    let bottomEdge = bottomEdgeIn;
    const numInserts = Math.trunc(numInsertsF);
    const bottomLen = bottomEdge.length();
    const pb = panel.bbox3D();
    const zTransl = panel.translation[2]! + npSign(panel.translation[2]!) * 5;
    const yBase = pb[0][1];
    const xShift = (pb[0][0] + pb[1][0]) / 2;
    let cutWidth = (bottomLen - cutsDist * numInserts) / numInserts;
    if (cutWidth < 1) {
      cutWidth = 1;
      cutsDist = (bottomLen - cutWidth * numInserts) / numInserts;
    }
    const insert = new Insert(0, insW, insDepth).translateBy([xShift - (numInserts * insW) / 2 + insW / 2, yBase + insDepth, zTransl]);
    this.subs.push(...distributeHorizontally(insert, numInserts, -insW, `ins_${panel.name}`));
    const sideLen = Math.sqrt(sq(insW / 2) + sq(insDepth));
    let cutDepth: number;
    if (sideLen > cutWidth / 2) cutDepth = Math.sqrt(sq(sideLen) - sq(cutWidth / 2));
    else {
      cutDepth = 1;
      cutWidth = 2 * Math.sqrt(sq(sideLen) - sq(cutDepth));
    }
    const cutShape = fromVerts([
      [0, 0],
      [cutWidth / 2, cutDepth],
      [cutWidth, 0],
    ]);
    const right = zTransl < 0;
    for (let i = 0; i < numInserts; i++) {
      const offset = cutWidth / 2 + (i === 0 ? cutsDist / 2 : cutsDist);
      const [newBottom, cutted] = cutIntoEdge(cutShape, bottomEdge, offset, right);
      panel.edges.substitute(bottomEdge, newBottom);
      bottomEdge = newBottom.at(-1);
      const cutInterface = new Interface(panel, cutted);
      if (right) cutInterface.reverse();
      const sub = this.subs[right ? this.subs.length - 1 - i : this.subs.length - (numInserts - i)]! as BaseComponent;
      this.stitchingRules.append([(sub.interfaces as Interface[])[0]!, cutInterface]);
    }
  }

  override getRise(): number | null {
    return this.base.getRise();
  }

  override length(): number {
    return this.base.length();
  }
}
