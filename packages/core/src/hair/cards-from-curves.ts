/**
 * Hair cards from curves: a port of Daniel Bystedt's "Hair cards from curves"
 * geometry-node group to TypeScript (docs/hair-system.md maps every stage to
 * the node frames it comes from). One call turns one hair curve into one card.
 *
 *   curve -> snap its root to the parting line -> trim -> even points
 *   -> frame with its normal on the scalp normal at the root (tilt), eased by
 *      the root/tip alignment, plus a random twist growing to the tip
 *   -> a flat strip laid along the curve, its width tangent to the head
 *   -> root corners snapped to the parting line, lift beside the parting
 *   -> roots blended onto the scalp, anything inside the head pushed out
 *
 * The strip itself is the group's card source mesh: flat, one texture column,
 * and scaled a little shorter than its curve ("Haircard downscale").
 */
import {
  add,
  arcLengths,
  closestOnPolyline,
  cross,
  dot,
  lerp,
  mul,
  normalized,
  pointAt,
  resample,
  rotateAbout,
  signedAngle,
  sub,
  tangents,
  transportNormals,
  trim,
  worldNormal,
  type Vec3,
} from './curves';

/** The skin the cards align and snap to (the group's "Surface collection"). */
export interface HairSurface {
  /** Closest point of the skin to p, with the outward unit normal there. */
  closest(p: Vec3): { point: Vec3; normal: Vec3; distance: number } | null;
}

/** Settings of the node group, under the names of its inputs. Distances in metres, angles in degrees. */
export interface CardBuildParams {
  /** "Length Factor": the part of each curve that becomes a card. */
  lengthFactor: number;
  /** "Tip tilt randomize": random twist about the curve, growing from none at the root. */
  tipTwist: number;
  /** "Align to world or surface": 0 keeps the curve's own normal, 1 uses the scalp normal. */
  alignToSurface: number;
  /** "Root align to surface" and "Tip align to surface": how much of that alignment each end gets. */
  rootAlign: number;
  tipAlign: number;
  /** "Offset tilt". */
  offsetTilt: number;
  /** "Root snap distance": card vertices this close to the root (along the hair) are pulled onto the scalp. */
  rootSnap: number;
  /** "Snap if inside": vertices inside the head and this close to its surface are moved out. */
  snapIfInside: number;
  /** "Snap surface offset": how far above the skin snapped vertices sit. */
  surfaceOffset: number;
  /** "Subdivide at length", adapted for a triangle budget: one card segment per this much hair. */
  segmentLength: number;
  /** "Normal from surface": 0 shades each card by its own faces, 1 by the head's volume. */
  normalFromSurface: number;
  /** "Parting snap distance": roots this close to the parting line start on it. */
  partSnap: number;
  /** "Parting curve lift height" and "lift distance": hair rises this much at the parting, fading over the distance. */
  partLiftHeight: number;
  partLiftDistance: number;
  /** "Haircard downscale": the card's length as a fraction of its curve. */
  downscale: number;
}

/** Defaults from the group's own example ("Hair cards thick"), with a lower random twist for short PS2 hair. */
export const DEFAULT_CARD_BUILD: CardBuildParams = {
  lengthFactor: 1,
  tipTwist: 0.1,
  alignToSurface: 1,
  rootAlign: 1,
  tipAlign: 1,
  offsetTilt: 0,
  rootSnap: 0.026,
  snapIfInside: 0.022,
  surfaceOffset: 0.001,
  segmentLength: 0.06,
  normalFromSurface: 1,
  partSnap: 0.03,
  partLiftHeight: 0.006,
  partLiftDistance: 0.03,
  downscale: 0.969,
};

export interface CardInput {
  /** The hair curve, root first. */
  curve: readonly Vec3[];
  /** Quads along the card. */
  segments: number;
  /** Full width in metres (the source card's width times "Radius mult"). */
  width: number;
  /** 0..1 narrowing of the strip towards the tip; the texture's alpha normally does this instead. */
  taper: number;
  /** A number in [0, 1) that is this curve's own (the group's per-curve Random Value). */
  random: number;
  surface: HairSurface;
  /** The parting line on the scalp, or null. */
  parting: readonly Vec3[] | null;
  /**
   * Hair v2 locks (PRD F15): quads across the strip (default 1, a flat card),
   * how far the strip bows out across its width (0..1 of its half width, at
   * the middle), and an extra twist that grows to the tip (radians).
   */
  columns?: number;
  bow?: number;
  twist?: number;
  /**
   * Sections crowd towards the root by this power (1 = even). Hair bends most
   * over the skull near its root, where long straight spans would cut into the head.
   */
  rootBias?: number;
}

export interface Card {
  /** `columns + 1` vertices per cross section, left to right; `segments + 1` sections, root first. */
  positions: Vec3[];
  /** 0 at the root to 1 at the tip, per section (texture V). */
  along: number[];
}

/** Port of "Is inside of surface": behind the nearest face and within `proximity` of it. */
export function isInside(hit: { point: Vec3; normal: Vec3; distance: number }, p: Vec3, proximity: number): boolean {
  return hit.distance < proximity && dot(hit.normal, sub(p, hit.point)) < 0;
}

export function cardFromCurve(input: CardInput, params: CardBuildParams): Card {
  const { surface, parting } = input;
  const S = Math.max(1, Math.round(input.segments));
  const C = Math.max(1, Math.round(input.columns ?? 1));
  const bow = input.bow ?? 0;
  let curve = input.curve.map((p) => [...p] as Vec3);

  // Frame "Snap curves to parting curve": a root near the parting line starts on it.
  if (parting && params.partSnap > 0) {
    const near = closestOnPolyline(parting, curve[0]!);
    if (near.distance < params.partSnap) curve[0] = near.point;
  }
  // Trim Curve, then "Redistribute Curve Points": even spacing keeps the frame steady.
  curve = resample(trim(curve, params.lengthFactor), Math.max(9, S * 2 + 1));
  const arcs = arcLengths(curve);
  const total = arcs[arcs.length - 1]!;
  const tans = tangents(curve);

  // Frames "Store surface normal" and "Align tilt to surface normal". The group measures the tilt at
  // the root only ("Tilt by root position" = 1) and carries it along a minimum-twist frame.
  const rootHit = surface.closest(curve[0]!);
  const world0 = worldNormal(tans[0]!);
  let rootTilt = 0;
  if (rootHit) {
    const n = sub(rootHit.normal, mul(tans[0]!, dot(rootHit.normal, tans[0]!)));
    // A curve leaving the scalp straight along its normal has no preferred side; keep the world frame.
    if (Math.hypot(n[0], n[1], n[2]) > 1e-4) rootTilt = signedAngle(world0, normalized(n), tans[0]!);
  }
  const frame = transportNormals(tans, world0);
  // Frame "Random tip twist": -180..180 degrees for this curve, scaled along the hair.
  const twist = (input.random * 2 - 1) * Math.PI * params.tipTwist;
  const offset = (params.offsetTilt * Math.PI) / 180;

  const positions: Vec3[] = [];
  const along: number[] = [];
  const normals: Vec3[] = [];
  for (let j = 0; j <= S; j++) {
    const s = (j / S) ** (input.rootBias ?? 1);
    // "Position geo along X for each spline": the card is centred on its curve and slightly shorter.
    const arc = total * (0.5 + (s - 0.5) * params.downscale);
    const at = pointAt(curve, arcs, arc);
    const f = total > 0 ? arc / total : 0;
    const tan = normalized(lerp(tans[at.segment]!, tans[Math.min(tans.length - 1, at.segment + 1)]!, at.t), tans[at.segment]!);
    const base = normalized(lerp(frame[at.segment]!, frame[Math.min(frame.length - 1, at.segment + 1)]!, at.t), frame[at.segment]!);
    const align = params.alignToSurface * (params.rootAlign + (params.tipAlign - params.rootAlign) * f);
    const normal = rotateAbout(base, tan, rootTilt * align + twist * f + offset + (input.twist ?? 0) * f);
    // "Deform X axis of geo along curve": the strip's width runs across the curve, tangent to the head.
    const side = normalized(cross(tan, normal), [1, 0, 0]);
    const half = (input.width / 2) * Math.max(0.15, 1 - input.taper * s);
    if (C === 1) positions.push(sub(at.point, mul(side, half)), add(at.point, mul(side, half)));
    else {
      // A lock: the middle stands off the head and the edges come down to it, so it reads as volume.
      for (let c = 0; c <= C; c++) {
        const x = (c / C) * 2 - 1;
        positions.push(add(add(at.point, mul(side, x * half)), mul(normal, bow * half * (1 - x * x) * 0.5)));
      }
    }
    normals.push(normal);
    along.push(s);
  }

  for (let v = 0; v < positions.length; v++) {
    const section = Math.floor(v / (C + 1));
    // The group's "length" attribute: distance along the card itself, 0 at its root end.
    const arc = total * params.downscale * along[section]!;
    let p = positions[v]!;
    if (parting) {
      const near = closestOnPolyline(parting, p);
      // Frame "Snap vertices to parting curve": both root corners meet on the line.
      if (section === 0 && near.distance < params.partSnap) p = near.point;
      // Frame "Lift close to parting curve": everything else rises beside it.
      else if (section > 0 && params.partLiftHeight > 0 && params.partLiftDistance > 0) {
        const k = Math.min(1, Math.max(0, 1 - near.distance / params.partLiftDistance));
        p = add(p, mul(normals[section]!, params.partLiftHeight * k));
      }
    }
    // Frame "Snap root to surface": blended from all the way at the root to nothing at the snap distance.
    const reach = params.rootSnap + 0.01;
    if (params.rootSnap > 0 && arc < reach) {
      const hit = surface.closest(p);
      if (hit) p = lerp(p, add(hit.point, mul(hit.normal, params.surfaceOffset)), Math.min(1, Math.max(0, 1 - arc / reach)));
    }
    // Frame "Push outside of surface".
    if (params.snapIfInside > 0) {
      const hit = surface.closest(p);
      if (hit && isInside(hit, p, params.snapIfInside)) p = add(hit.point, mul(hit.normal, params.surfaceOffset));
    }
    positions[v] = p;
  }
  return { positions, along };
}

/**
 * Frame "Transfer normal from surface". The group copies the nearest scalp
 * normal onto every card vertex, which makes the hair shade as one soft volume
 * instead of as separate planes. PS2CC's hair also hangs below the head, where
 * the nearest skin normal would point down, so the normal comes from the
 * hair's volume instead: straight out from an axis that runs from the middle
 * of the skull down through the neck (DECISIONS D-078).
 *
 * `normals` holds the cards' own normals on entry and the blend on return.
 */
export function blendVolumeNormals(positions: ArrayLike<number>, normals: Float32Array, axisTop: Vec3, axisLength: number, amount: number): void {
  const k = Math.min(1, Math.max(0, amount));
  if (k === 0) return;
  for (let v = 0; v < positions.length / 3; v++) {
    const p: Vec3 = [positions[v * 3]!, positions[v * 3 + 1]!, positions[v * 3 + 2]!];
    const down = Math.min(axisLength, Math.max(0, axisTop[1] - p[1]));
    const out = normalized([p[0] - axisTop[0], p[1] - (axisTop[1] - down), p[2] - axisTop[2]]);
    const own: Vec3 = [normals[v * 3]!, normals[v * 3 + 1]!, normals[v * 3 + 2]!];
    // Cards are double sided: take the side of the card that faces out before blending.
    const facing = dot(own, out) < 0 ? mul(own, -1) : own;
    const n = normalized(lerp(facing, out, k), out);
    normals[v * 3] = n[0];
    normals[v * 3 + 1] = n[1];
    normals[v * 3 + 2] = n[2];
  }
}
