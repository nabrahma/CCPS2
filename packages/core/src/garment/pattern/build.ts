/** Building GarmentCode's garment from a design and validating the result. */
import { snapshot, validatePattern, type PatternIssue, type PatternSpec } from './spec';
import { panelOutline } from './svg';
import { bodyParameters, type Body, type Design } from './programs/base';
import { MetaGarment } from './programs/meta';
import type { Component, Panel } from './panel';
import type { StitchSpec } from './interface';


export interface BuiltPattern {
  garment: Component;
  spec: PatternSpec;
  /** Per stitch: whether it gathers (a ruffle coefficient other than 1). */
  gathered: boolean[];
  /** Per stitch: the seam (pair of interfaces) it belongs to. */
  seam: number[];
  /** Panels laid onto other panels (pockets, flaps, yokes): this project's programs only. */
  attachments: AttachmentSpec[];
}

/** Build GarmentCode's MetaGarment for a design on a body (GarmentCode measurement keys, cm). */
export function buildMetaGarment(name: string, design: Design, measurements: Readonly<Record<string, number>>): BuiltPattern {
  const body: Body = bodyParameters(measurements);
  return buildGarment(new MetaGarment(name, body, design));
}

/** A panel laid onto a host panel: the edges sewn onto it and their end points in the host's 2D coordinates. */
export interface AttachmentSpec {
  panel: string;
  host: string;
  edges: number[];
  /** Host-local positions of the attached edges' end points (cm), two per edge; the third coordinate is the distance off the host plane. */
  points: number[][];
}

interface LiveAttachment {
  panel: Panel;
  host: Panel;
  edges: { start: number[]; end: number[]; geometricId: number }[];
}

/** Host-local coordinates of a world point (inverse of Panel.pointTo3D). */
function hostLocal(host: Panel, w: readonly number[]): number[] {
  const m = host.rotation.matrix();
  const d = [w[0]! - host.translation[0]!, w[1]! - host.translation[1]!, w[2]! - host.translation[2]!];
  return [0, 1, 2].map((c) => m[0]![c]! * d[0]! + m[1]![c]! * d[1]! + m[2]![c]! * d[2]!);
}

/** Assemble any garment component into a snapshot spec, stitch metadata and attachments. */
export function buildGarment(garment: Component & { attachments?: LiveAttachment[] }): BuiltPattern {
  const atts = (garment.attachments ?? []).map((a) => ({
    a,
    shift0: a.host.pivotShift.slice(),
    pts: a.edges.flatMap((e) => [e.start, e.end]).map((v) => hostLocal(a.host, a.panel.pointTo3D(v))),
  }));
  const live = garment.assembly();
  const gathered = live.stitches.map((s: StitchSpec) => (s as unknown as { gathered?: boolean }).gathered === true);
  const rules: unknown[] = [];
  const seam = live.stitches.map((s: StitchSpec) => {
    const r = (s as unknown as { rule?: unknown }).rule;
    let k = rules.indexOf(r);
    if (k < 0) k = rules.push(r) - 1;
    return k;
  });
  const attachments: AttachmentSpec[] = atts.map(({ a, shift0, pts }) => {
    const dx = a.host.pivotShift[0] - shift0[0]!;
    const dy = a.host.pivotShift[1] - shift0[1]!;
    return { panel: a.panel.name, host: a.host.name, edges: a.edges.map((e) => e.geometricId), points: pts.map((p) => [p[0]! + dx, p[1]! + dy, p[2]!]) };
  });
  return { garment, spec: snapshot(live), gathered, seam, attachments };
}

/** Validate a built pattern (F29 rules; see spec.ts). */
export function validateBuilt(b: BuiltPattern): PatternIssue[] {
  return validatePattern(b.spec, {
    selfIntersecting: b.garment.isSelfIntersecting(),
    gathered: (i) => b.gathered[i] ?? false,
    seam: (i) => b.seam[i] ?? i,
    attachments: b.attachments,
    outline: (name) => panelOutline(b.spec.panels[name]!, 2),
  });
}
