/**
 * GarmentCode's body parameters and program base classes (port of assets/bodies/body_params.py and
 * assets/garment_programs/base_classes.py).
 *
 * Bodies are GarmentCode's measurement keys in cm and degrees, produced for our characters by
 * `garmentCodeBody` (core/anthro, F24); the derived keys (`_waist_level` and so on) follow body_params.py.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Component, Panel } from '../panel';
import { linInterpolation } from '../utils';

export type Body = Record<string, number>;
/** A design dictionary as in GarmentCode's design_params YAML: nested groups with {v, range, type, default_prob} leaves. */
export type Design = any;

/** BodyParameters.eval_dependencies(None) over the measured keys. */
export function bodyParameters(measurements: Readonly<Record<string, number>>): Body {
  const p: Body = { ...measurements };
  p._waist_level = p.height! - p.head_l! - p.waist_line!;
  p._leg_length = p._waist_level - p.hips_line!;
  p._base_sleeve_balance = p.shoulder_w! - 2;
  p._bust_line = 'vert_bust_line' in p ? (1 - 1 / 3) * p.vert_bust_line! + (1 / 3) * p.bust_line! : p.bust_line!;
  p._hip_inclination = p.hip_inclination! / 2;
  p._shoulder_incl = p.shoulder_incl!;
  p._armscye_depth = p.armscye_depth! + 2.5;
  return p;
}

/** body[key], raising like a KeyError when missing. */
export function bv(body: Body, key: string): number {
  const v = body[key];
  if (v === undefined) throw Object.assign(new Error(`KeyError: '${key}'`), { pyType: 'KeyError' });
  return v;
}

export abstract class BaseBodicePanel extends Panel {
  body: Body;
  design: Design;
  width = 0;

  constructor(name: string, body: Body, design: Design) {
    super(name);
    this.body = body;
    this.design = design;
    this.interfaces = {};
  }

  /** Panel width at a level counted from the top (excluding darts). */
  getWidth(level: number): number {
    const side = this.int('outside').edges.at(-1);
    let x = side.end[0]! - side.start[0]!;
    let y = side.end[1]! - side.start[1]!;
    if (y < 0) {
      x = -x;
      y = -y;
    }
    return (level * x) / y + this.body.shoulder_w! / 2;
  }
}

export class BaseBottoms extends Component {
  body: Body;
  design: Design;
  rise: number | null;
  adjHipsDepth = 0;
  adjWaist = 0;

  constructor(className: string, body: Body, design: Design, tag = '', rise: number | null = null) {
    super(tag ? `${className}_${tag}` : className);
    this.body = body;
    this.design = design;
    this.rise = rise;
    this.interfaces = {};
  }

  getRise(): number | null {
    return this.rise;
  }

  evalRise(rise: number): [number, number, number] {
    const waist = this.body.waist!;
    const hips = this.body.hips!;
    this.adjHipsDepth = rise * this.body.hips_line!;
    this.adjWaist = linInterpolation(hips, waist, rise);
    const back = linInterpolation(this.body.hip_back_width!, this.body.waist_back_width!, rise);
    return [this.adjWaist, this.adjHipsDepth, back];
  }
}

/** A skirt that can stack with others (bottom to top). */
export class StackableSkirtComponent extends BaseBottoms {}

export class BaseBand extends Component {
  body: Body | null;
  design: Design;
  rise: number | null;

  constructor(className: string, body: Body | null, design: Design, tag = '', rise: number | null = null) {
    super(tag ? `${className}_${tag}` : className);
    this.body = body;
    this.design = design;
    this.rise = rise;
    this.interfaces = {};
  }

  override length(): number {
    return this.subcomponents()[0]!.length();
  }
}
