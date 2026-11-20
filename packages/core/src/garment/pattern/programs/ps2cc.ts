/**
 * This project's pattern programs (F29 "new programs"), built from the same types as the GarmentCode port:
 * bomber / blouson jacket, coat, utility vest, hoodie, work shirt, and the cargo pocket component.
 *
 * They share one torso block whose front and back side seams have equal length by construction (the front is
 * not shortened as GarmentCode's T-shirt front is), and reuse the port's sleeves, collars, hood, bands and
 * corner cuts. Open fronts get a placket band on the right front for the overlap. Pockets, flaps and the work
 * shirt's yoke are separate panels placed on the garment's face: GarmentCode sews only edge to edge, so they are
 * described as attachments (panel edges laid onto a host panel), which the drape solver joins (M23).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { PI, tan } from '../../../math/dmath';
import type { Edge } from '../edge';
import { fromVerts } from '../edge-factory';
import { Interface } from '../interface';
import { cutCorner } from '../operators';
import { Component, Panel } from '../panel';
import { deepcopy, linInterpolation, type Vert } from '../utils';
import { StraightBandPanel } from './bands';
import { BaseBodicePanel, bv, type Body, type Design } from './base';
import { makeCollar } from './collars';
import { Sleeve } from './sleeves';

const deg2rad = (d: number): number => d * (PI / 180);

/** A pocket, flap or overlay panel laid onto a host panel; `edges` are the panel edges sewn onto the host. */
export interface Attachment {
  panel: Panel;
  host: Panel;
  edges: Edge[];
}

interface BlockOpts {
  length: number;
  ease: number;
  flare: number;
  /** Flare offset shared by front and back, so the side seams have equal length. */
  flareOffset: number;
}

/**
 * Block sizes. Front and back halves are equally wide (a quarter of the eased bust each), so their armholes,
 * sleeve openings, shoulder and side seams match exactly: GarmentCode's narrower back makes the armhole cut land
 * at different heights and its sleeve openings need rebalancing, which leaves seams of unequal length.
 */
function blockSizes(body: Body, o: { length: number; ease: number; flare: number }): { wf: number; wb: number; L: number; fl: number } {
  const bust = bv(body, 'bust');
  const wf = (bust / 4) * o.ease;
  const wb = wf;
  const L = o.length * bv(body, 'waist_line');
  const fl = ((o.flare - 1) * (wf + wb)) / 2;
  return { wf, wb, L, fl };
}

/** Front or back half of the straight torso block: hem, side, shoulder, centre. */
export class BlockHalfPanel extends BaseBodicePanel {
  constructor(name: string, body: Body, design: Design, width: number, o: BlockOpts) {
    super(name, body, design);
    this.width = width;
    const L = o.length;
    const incl = tan(deg2rad(bv(body, '_shoulder_incl'))) * width;
    this.edges = fromVerts(
      [
        [0, 0],
        [-(width + o.flareOffset), 0],
        [-width, L],
        [0, L + incl],
      ],
      true,
    );
    const e = this.edges;
    this.interfaces = {
      outside: new Interface(this, e.edges[1]!),
      inside: new Interface(this, e.at(-1)),
      shoulder: new Interface(this, e.at(-2)),
      bottom: new Interface(this, e.edges[0]!),
      shoulder_corner: new Interface(this, [e.at(-3), e.at(-2)]),
      collar_corner: new Interface(this, [e.at(-2), e.at(-1)]),
    };
    this.translateBy([0, bv(body, 'height') - bv(body, 'head_l') - L - incl, 0]);
  }

  override getWidth(level: number): number {
    return super.getWidth(level) + this.width - this.body.shoulder_w! / 2;
  }
}

export interface PocketRequest {
  where: 'chest' | 'hip' | 'handwarmer';
  w: number;
  flap: number;
}

/** Live outline of a panel (its edges linearised), in panel coordinates. */
function liveOutline(panel: Panel): Vert[] {
  const pts: Vert[] = [];
  for (const e of panel.edges.edges) for (const s of e.linearize(e.length() > 4 ? Math.ceil(e.length() / 2) : 0).edges) pts.push(s.start);
  return pts;
}

function insidePoly(p: readonly number[], poly: readonly Vert[], margin: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a[1]! > p[1]! !== b[1]! > p[1]! && p[0]! < ((b[0]! - a[0]!) * (p[1]! - a[1]!)) / (b[1]! - a[1]!) + a[0]!) inside = !inside;
  }
  if (!inside) return false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    const ex = b[0]! - a[0]!;
    const ey = b[1]! - a[1]!;
    const t = Math.max(0, Math.min(1, ((p[0]! - a[0]!) * ex + (p[1]! - a[1]!) * ey) / (ex * ex + ey * ey || 1)));
    const dx = a[0]! + t * ex - p[0]!;
    const dy = a[1]! + t * ey - p[1]!;
    if (dx * dx + dy * dy < margin * margin) return false;
  }
  return true;
}

/**
 * Place a requested pocket on the front half: chest pockets under the armhole at the bust point, hip pockets
 * and hand-warmers above the hem. The pocket (and its flap) is shrunk until it sits at least 1 cm inside the
 * panel; null when even a small one does not fit.
 */
function fitPocket(host: Panel, req: PocketRequest, body: Body, wf: number, Lf: number, cw: number, band: number): PocketSpec | null {
  const poly = liveOutline(host);
  const bp = bv(body, 'bust_points') / 2;
  for (let scale = 1; scale > 0.45; scale *= 0.9) {
    const w = req.w * scale;
    let s: PocketSpec;
    if (req.where === 'chest') {
      const h = w * 1.15;
      const top = Lf - cw - 3;
      s = { x: -Math.min(bp, wf - w / 2 - 2), y: top - h - (req.flap ? req.flap * 0.4 : 0), w, h, flap: req.flap, kind: 'patch' };
    } else if (req.where === 'hip') s = { x: -wf * 0.52, y: band > 0 ? 3 : 7, w, h: w * 1.1, flap: req.flap, kind: 'patch' };
    else s = { x: -wf * 0.42, y: 3, w, h: Math.min(18, Lf * 0.35), flap: 0, kind: 'handwarmer' };
    const fw = s.w + 1;
    const corners: Vert[] = [
      [s.x - s.w / 2, s.y],
      [s.x + s.w / 2, s.y],
      [s.x + s.w / 2, s.y + s.h],
      [s.x - s.w / 2, s.y + s.h],
    ];
    if (s.flap > 0) {
      const fy = s.y + s.h + 0.5 - s.flap + 1;
      corners.push([s.x - fw / 2, fy], [s.x + fw / 2, fy], [s.x + fw / 2, fy + s.flap], [s.x - fw / 2, fy + s.flap]);
    }
    if (corners.every((c) => insidePoly(c, poly, 1))) return s;
  }
  return null;
}

export interface PocketSpec {
  /** Where the pocket sits on the front: centre x (cm from centre front, negative to the side) and bottom y (cm from the hem). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Flap height (cm); 0 for none. */
  flap: number;
  /** Sewn on three sides (patch) or on top and bottom only (hand-warmer). */
  kind: 'patch' | 'handwarmer';
}

/** The cargo pocket component: a patch (or hand-warmer) pocket and an optional flap, attached to a host panel. */
export class CargoPocket extends Component {
  pocket: Panel;
  flap: Panel | null = null;
  attachments: Attachment[] = [];

  constructor(name: string, host: Panel, spec: PocketSpec) {
    super(`CargoPocket_${name}`);
    const { w, h } = spec;
    this.pocket = new Panel(`${name}_pocket`);
    this.pocket.edges = fromVerts(
      [
        [0, 0],
        [w, 0],
        [w, h],
        [0, h],
      ],
      true,
    );
    this.place(this.pocket, host, [spec.x - w / 2, spec.y]);
    // edges: 0 bottom, 1 right side, 2 top (opening), 3 left side
    const pe = this.pocket.edges.edges;
    this.attachments.push({ panel: this.pocket, host, edges: spec.kind === 'patch' ? [pe[0]!, pe[1]!, pe[3]!] : [pe[0]!, pe[2]!] });
    if (spec.flap > 0) {
      const fw = w + 1;
      this.flap = new Panel(`${name}_flap`);
      this.flap.edges = fromVerts(
        [
          [0, 0],
          [fw, 0],
          [fw, spec.flap],
          [0, spec.flap],
        ],
        true,
      );
      this.place(this.flap, host, [spec.x - fw / 2, spec.y + h + 0.5 - spec.flap + 1]);
      this.attachments.push({ panel: this.flap, host, edges: [this.flap.edges.edges[2]!] });
    }
  }

  /** Lay a panel on the host's plane with its local origin at the host-local point p. */
  private place(panel: Panel, host: Panel, p: Vert): void {
    panel.rotation = host.rotation;
    panel.translation = host.pointTo3D(p);
    panel.label = 'pocket';
  }
}

export interface TopOptions {
  length: number;
  ease: number;
  flare: number;
  open: boolean;
  /** Placket overlap on the right front (cm, open fronts); 0 for none. */
  placket: number;
  /** Rib hem band depth (cm) and its length ratio to the hem (< 1 gathers); depth 0 for none. */
  hemBand: number;
  hemRib: number;
  /** Back yoke depth below the neck (cm); 0 for none. */
  yoke: number;
  pockets: PocketRequest[];
}

/** Half of a top built on the torso block, with the port's sleeves and collar. */
export class TopHalf extends Component {
  ftorso: BlockHalfPanel;
  btorso: BlockHalfPanel;
  sleeve: Sleeve | null = null;
  collar_comp: Component | null = null;
  placket: StraightBandPanel | null = null;
  fband: StraightBandPanel | null = null;
  bband: StraightBandPanel | null = null;
  yoke: Panel | null = null;
  attachments: Attachment[] = [];

  constructor(name: string, body: Body, designIn: Design, o: TopOptions, right: boolean) {
    super(name);
    const design = deepcopy(designIn);
    const { wf, wb, L, fl } = blockSizes(body, o);
    const Lf = L;
    this.ftorso = new BlockHalfPanel(`${name}_ftorso`, body, design, wf, { length: Lf, ease: o.ease, flare: o.flare, flareOffset: fl }).translateBy([0, 0, 30]);
    this.btorso = new BlockHalfPanel(`${name}_btorso`, body, design, wb, { length: L, ease: o.ease, flare: o.flare, flareOffset: fl }).translateBy([0, 0, -25]);
    this.evalDepParams(body, design);
    // Sleeves (or sleeveless armholes) and the collar, as GarmentCode's bodice does.
    this.sleeve = new Sleeve(
      name,
      body,
      design,
      (l) => this.ftorso.getWidth(l),
      (l) => this.btorso.getWidth(l),
    );
    const [, fSleeve] = cutCorner(this.sleeve.int('in_front_shape').edges, this.ftorso.int('shoulder_corner'));
    const [, bSleeve] = cutCorner(this.sleeve.int('in_back_shape').edges, this.btorso.int('shoulder_corner'));
    if (!design.sleeve.sleeveless.v) {
      const bodiceSleeve = Interface.fromMultiple(fSleeve.reverse(true), bSleeve.reverse());
      this.stitchingRules.append([this.sleeve.int('in'), bodiceSleeve]);
      this.sleeve.placeByInterface(this.sleeve.int('in'), bodiceSleeve, -1 - bv(body, 'arm_pose_angle') / 10, 'top');
    }
    fSleeve.edges.propagateLabel(`${name}_armhole`);
    bSleeve.edges.propagateLabel(`${name}_armhole`);
    this.collar_comp = makeCollar(design.collar.component?.style?.v, name, body, design);
    const [, fc] = cutCorner(this.collar_comp.int('front_proj').edges, this.ftorso.int('collar_corner'));
    const [, bc] = cutCorner(this.collar_comp.int('back_proj').edges, this.btorso.int('collar_corner'));
    if (this.collar_comp.hasInt('bottom')) this.stitchingRules.append([Interface.fromMultiple(fc, bc), this.collar_comp.int('bottom')]);
    fc.edges.propagateLabel(`${name}_collar`);
    bc.edges.propagateLabel(`${name}_collar`);
    this.stitchingRules.append([this.ftorso.int('shoulder'), this.btorso.int('shoulder')]);
    this.stitchingRules.append([this.ftorso.int('outside'), this.btorso.int('outside')]);
    const ints = this.interfaces as Record<string, Interface>;
    ints.front_in = this.ftorso.int('inside');
    ints.back_in = this.btorso.int('inside');
    if (this.collar_comp.hasInt('front')) ints.front_in = Interface.fromMultiple(this.ftorso.int('inside'), this.collar_comp.int('front'));
    if (this.collar_comp.hasInt('back')) ints.back_in = Interface.fromMultiple(this.btorso.int('inside'), this.collar_comp.int('back'));
    // Placket band along the right front's centre edge, overlapping the left front.
    if (o.open && o.placket > 0 && right) {
      const edge = this.ftorso.int('inside').edges;
      const len = edge.totalLength();
      this.placket = new StraightBandPanel(`${name}_placket`, o.placket * 2, len);
      this.placket.label = 'placket';
      this.placket.rotation = this.ftorso.rotation;
      const top = this.ftorso.int('inside').edges.edges[0]!.start;
      this.placket.translation = this.ftorso.pointTo3D([top[0]! + o.placket, top[1]! - len / 2, 0]);
      this.placket.translateBy([0, 0, 1]);
      this.stitchingRules.append([this.ftorso.int('inside'), this.placket.int('left')]);
    }
    // Rib hem band (gathered when hemRib < 1).
    if (o.hemBand > 0) {
      const fLen = this.ftorso.int('bottom').edges.totalLength();
      const bLen = this.btorso.int('bottom').edges.totalLength();
      this.fband = new StraightBandPanel(`${name}_fhem`, fLen * o.hemRib, o.hemBand).translateBy([-fLen / 2, this.ftorso.translation[1]! - o.hemBand - 2, 31]);
      this.bband = new StraightBandPanel(`${name}_bhem`, bLen * o.hemRib, o.hemBand).translateBy([-bLen / 2, this.btorso.translation[1]! - o.hemBand - 2, -26]);
      this.fband.label = 'rib';
      this.bband.label = 'rib';
      const rf = this.stitchingRules.append([this.ftorso.int('bottom'), this.fband.int('top')]);
      const rb = this.stitchingRules.append([this.btorso.int('bottom'), this.bband.int('top')]);
      rf.intendedGather = rb.intendedGather = o.hemRib < 0.999;
      this.stitchingRules.append([this.fband.int('right'), this.bband.int('right')]);
      ints.front_band_in = this.fband.int('left');
      ints.back_band_in = this.bband.int('left');
    }
    // Back yoke laid over the back panel.
    if (o.yoke > 0) {
      this.yoke = yokeOverlay(`${name}_yoke`, this.btorso, o.yoke);
      if (this.yoke) this.attachments.push({ panel: this.yoke, host: this.btorso, edges: this.yoke.edges.edges.slice() });
    }
    const cw = design.sleeve.connecting_width.v;
    o.pockets.forEach((req, i) => {
      const spec = fitPocket(this.ftorso, req, body, wf, Lf, cw, o.hemBand);
      if (!spec) return;
      const pk = new CargoPocket(`${name}_p${i}`, this.ftorso, spec);
      this.subs.push(pk);
      this.attachments.push(...pk.attachments);
    });
  }

  /** GarmentCode's BodiceHalf.eval_dep_params: armhole depth and collar width and depth from the body. */
  private evalDepParams(body: Body, design: Design): void {
    const maxCwidth = this.ftorso.int('shoulder_corner').edges.edges[0]!.length() - 1;
    const minCwidth = bv(body, '_armscye_depth');
    design.sleeve.connecting_width.v = Math.min(minCwidth + minCwidth * design.sleeve.connecting_width.v, maxCwidth);
    const maxW = bv(body, '_base_sleeve_balance') - 2;
    const minW = bv(body, 'neck_w');
    const width = (design.collar.width.v = design.collar.width.v >= 0 ? linInterpolation(minW, maxW, design.collar.width.v) : linInterpolation(0, minW, 1 + design.collar.width.v));
    const tg = tan(deg2rad(bv(body, '_shoulder_incl')));
    const maxF = this.ftorso.int('collar_corner').edges.edges[1]!.length() - tg * this.ftorso.getWidth(0) - 1;
    const maxB = this.btorso.int('collar_corner').edges.edges[1]!.length() - tg * this.btorso.getWidth(0) - 1;
    design.collar.fc_depth.v = Math.min(design.collar.fc_depth.v * bv(body, '_bust_line'), maxF) + tg * (this.ftorso.getWidth(0) - width / 2);
    design.collar.bc_depth.v = Math.min(design.collar.bc_depth.v * bv(body, '_bust_line'), maxB) + tg * (this.btorso.getWidth(0) - width / 2);
  }

  override length(): number {
    return this.btorso.length();
  }
}

/** The part of a panel above a horizontal line `depth` below its top, as an overlay panel on the same plane. */
function yokeOverlay(name: string, host: Panel, depth: number): Panel | null {
  const verts = host.edges.verts();
  const pts: Vert[] = [];
  for (const e of host.edges.edges) {
    const n = e.length() > 4 ? Math.ceil(e.length() / 2) : 0;
    for (const s of e.linearize(n).edges) pts.push(s.start);
  }
  const top = Math.max(...verts.map((v) => v[1]!));
  const yLine = top - depth;
  const clipped: Vert[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    const ain = a[1]! >= yLine;
    const bin = b[1]! >= yLine;
    if (ain) clipped.push([a[0]!, a[1]!]);
    if (ain !== bin) {
      const t = (yLine - a[1]!) / (b[1]! - a[1]!);
      clipped.push([a[0]! + t * (b[0]! - a[0]!), yLine]);
    }
  }
  const poly: Vert[] = [];
  for (const p of clipped) {
    const last = poly[poly.length - 1];
    if (!last || Math.abs(last[0]! - p[0]!) > 1e-3 || Math.abs(last[1]! - p[1]!) > 1e-3) poly.push(p);
  }
  if (poly.length > 2 && Math.abs(poly[0]![0]! - poly[poly.length - 1]![0]!) < 1e-3 && Math.abs(poly[0]![1]! - poly[poly.length - 1]![1]!) < 1e-3) poly.pop();
  if (poly.length < 3) return null;
  const p = new Panel(name, 'yoke');
  p.edges = fromVerts(poly, true);
  p.rotation = host.rotation;
  p.translation = host.translation.slice();
  return p;
}

// ------------------------------------------------------------------ the programs

export interface PS2Top extends Component {
  attachments: Attachment[];
}

/** A whole top: right and left halves (the left mirrored), joined at the centre back and, when closed, centre front. */
export class TopGarment extends Component implements PS2Top {
  right: TopHalf;
  left: TopHalf;
  attachments: Attachment[] = [];

  constructor(name: string, body: Body, design: Design, o: TopOptions) {
    super(name);
    this.right = new TopHalf('right', body, design, o, true);
    this.left = new TopHalf('left', body, design, o, false).mirror();
    this.stitchingRules.append([this.right.int('back_in'), this.left.int('back_in')]);
    if (!o.open) this.stitchingRules.append([this.right.int('front_in'), this.left.int('front_in')]);
    if (o.hemBand > 0) {
      this.stitchingRules.append([this.right.int('back_band_in'), this.left.int('back_band_in')]);
      if (!o.open) this.stitchingRules.append([this.right.int('front_band_in'), this.left.int('front_band_in')]);
    }
    this.attachments = [...this.right.attachments, ...this.left.attachments];
  }

  override length(): number {
    return this.right.length();
  }
}

const pick = (d: Design, group: string, key: string): any => d[group][key].v;

/** Front pockets a program group asks for: chest, hip, hand-warmer (placed by TopHalf). */
function pocketsFrom(d: Design, group: string, wf: number): PocketRequest[] {
  const out: PocketRequest[] = [];
  const g = d[group];
  const flaps = g.flaps ? pick(d, group, 'flaps') : false;
  if (g.chest_pockets && pick(d, group, 'chest_pockets')) out.push({ where: 'chest', w: pick(d, group, 'chest_pocket_w'), flap: flaps ? 5 : 0 });
  if (g.hip_pockets && pick(d, group, 'hip_pockets')) out.push({ where: 'hip', w: pick(d, group, 'hip_pocket_w'), flap: flaps ? 6 : 0 });
  if (g.handwarmer && pick(d, group, 'handwarmer')) out.push({ where: 'handwarmer', w: Math.min(wf * 0.7, 24), flap: 0 });
  return out;
}

function topOptions(body: Body, d: Design, group: string, fixed: Partial<TopOptions>): TopOptions {
  const length = pick(d, group, 'length');
  const ease = pick(d, group, 'width');
  const flare = d[group].flare ? pick(d, group, 'flare') : 1;
  const { wf } = blockSizes(body, { length, ease, flare });
  const hemBand = d[group].hem_band ? pick(d, group, 'hem_band') : 0;
  return {
    length,
    ease,
    flare,
    open: fixed.open ?? true,
    placket: d[group].overlap ? pick(d, group, 'overlap') : 0,
    hemBand,
    hemRib: d[group].hem_rib ? pick(d, group, 'hem_rib') : 1,
    yoke: d[group].yoke ? pick(d, group, 'yoke') : 0,
    pockets: pocketsFrom(d, group, wf),
    ...fixed,
  };
}

export function buildBomber(name: string, body: Body, d: Design): TopGarment {
  return new TopGarment(name, body, d, topOptions(body, d, 'bomber', { open: true }));
}
export function buildCoat(name: string, body: Body, d: Design): TopGarment {
  return new TopGarment(name, body, d, topOptions(body, d, 'coat', { open: true }));
}
export function buildUtilityVest(name: string, body: Body, d: Design): TopGarment {
  const dd = deepcopy(d);
  dd.sleeve.sleeveless.v = true;
  return new TopGarment(name, body, dd, topOptions(body, dd, 'utility-vest', { open: true }));
}
export function buildHoodie(name: string, body: Body, d: Design): TopGarment {
  const dd = deepcopy(d);
  dd.collar.component.style.v = 'Hood2Panels';
  return new TopGarment(name, body, dd, topOptions(body, dd, 'hoodie', { open: false, placket: 0 }));
}
export function buildWorkShirt(name: string, body: Body, d: Design): TopGarment {
  return new TopGarment(name, body, d, topOptions(body, d, 'work-shirt', { open: true }));
}

