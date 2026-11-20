/** The whole garment (port of assets/garment_programs/meta_garment.py): an upper garment, a waistband and bottoms. */
import { Component } from '../panel';
import { bv, type Body, type Design } from './base';
import { FittedWB, StraightWB } from './bands';
import { FittedShirt, Shirt } from './bodice';
import { AsymmSkirtCircle, SkirtCircle } from './circle-skirt';
import { Pants } from './pants';
import { GodetSkirt, SkirtLevels } from './skirt-levels';
import { PencilSkirt, Skirt2, SkirtManyPanels } from './skirt-paneled';

type Lower = Component & { getRise(): number | null };

const UPPER: Record<string, (b: Body, d: Design) => Component> = {
  Shirt: (b, d) => new Shirt(b, d),
  FittedShirt: (b, d) => new FittedShirt(b, d),
};

const LOWER: Record<string, (b: Body, d: Design, rise: number | null) => Lower> = {
  Pants: (b, d, r) => new Pants(b, d, r),
  SkirtCircle: (b, d, r) => new SkirtCircle(b, d, { rise: r }),
  AsymmSkirtCircle: (b, d, r) => new AsymmSkirtCircle(b, d, { rise: r }),
  GodetSkirt: (b, d, r) => new GodetSkirt(b, d, r),
  Skirt2: (b, d, r) => new Skirt2(b, d, { rise: r }),
  SkirtManyPanels: (b, d, r) => new SkirtManyPanels(b, d, { rise: r }),
  PencilSkirt: (b, d, r) => new PencilSkirt(b, d, { rise: r }),
  SkirtLevels: (b, d, r) => new SkirtLevels(b, d, r),
};

const BELT: Record<string, (b: Body, d: Design, rise: number) => Component> = {
  StraightWB: (b, d, r) => new StraightWB(b, d, r),
  FittedWB: (b, d, r) => new FittedWB(b, d, r),
};

function pick<T>(table: Record<string, T>, name: string): T {
  const f = table[name];
  if (!f) throw Object.assign(new Error(`KeyError: '${name}'`), { pyType: 'KeyError' });
  return f;
}

export class TotalLengthError extends Error {
  readonly pyType = 'TotalLengthError';
}
export class IncorrectElementConfiguration extends Error {
  readonly pyType = 'IncorrectElementConfiguration';
}

export class MetaGarment extends Component {
  body: Body;
  design: Design;
  upperName: string | null;
  lowerName: string | null;
  beltName: string | null;

  constructor(name: string, body: Body, design: Design) {
    super(name);
    this.body = body;
    this.design = design;
    this.upperName = design.meta.upper.v ?? null;
    this.lowerName = design.meta.bottom.v ?? null;
    this.beltName = design.meta.wb.v ?? null;
    if (this.upperName) {
      this.subs = [pick(UPPER, this.upperName)(body, design)];
      this.subs[this.subs.length - 1]!.setPanelLabel('body', false);
    }
    let lower: Lower | null = null;
    if (this.lowerName) lower = pick(LOWER, this.lowerName)(body, design, this.upperName && this.upperName.includes('Fitted') ? 1 : null);
    if (this.beltName) {
      const belt = pick(BELT, this.beltName)(body, design, lower ? (lower.getRise() as number) : 1);
      this.subs.push(belt);
      if (this.subs.length > 1) {
        const cur = this.subs[this.subs.length - 1]!;
        const prev = this.subs[this.subs.length - 2]!;
        cur.placeByInterface(cur.int('top'), prev.int('bottom'), 5);
        this.stitchingRules.append([prev.int('bottom'), cur.int('top')]);
      }
      belt.int('top').edges.propagateLabel('lower_interface');
      belt.setPanelLabel('body', false);
    }
    if (this.lowerName && lower) {
      this.subs.push(lower);
      if (this.subs.length > 1) {
        const cur = this.subs[this.subs.length - 1]!;
        const prev = this.subs[this.subs.length - 2]!;
        cur.placeByInterface(cur.int('top'), prev.int('bottom'), 5);
        this.stitchingRules.append([prev.int('bottom'), cur.int('top')]);
      }
      if (!this.beltName) lower.int('top').edges.propagateLabel('lower_interface');
      lower.setPanelLabel('leg', false);
    }
  }

  assertTotalLength(tol = 1): void {
    const length = this.length();
    const floor = bv(this.body, 'height') - bv(this.body, 'head_l');
    if (length > floor + tol) throw new TotalLengthError(`MetaGarment::${this.name}::ERROR::Total length ${length} exceeds the floor length ${floor}`);
  }

  assertNonEmpty(filterBelts = true): void {
    if (!this.upperName && !this.lowerName && (filterBelts || !this.beltName)) throw new IncorrectElementConfiguration('empty garment');
  }
}
