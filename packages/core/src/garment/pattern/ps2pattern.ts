/**
 * `.ps2pattern` files (F29): a pattern program's inputs (program id, design parameters, the body's GarmentCode
 * measurements) and the pattern built from them. Rebuilding from the inputs must give byte-identical canonical
 * bytes, so a file always regenerates exactly and a library garment can be re-made on another body.
 */
import type { AttachmentSpec, BuiltPattern } from './build';
import './programs/ps2cc-programs';
import { buildProgram } from './programs/registry';
import { canonicalJSON, patternHash, type PatternSpec } from './spec';
import type { Design } from './programs/base';

/** Bumped when a program change alters the patterns it builds. */
export const PATTERN_GENERATOR_VERSION = 1;

export interface Ps2Pattern {
  format: 'ps2pattern';
  version: 1;
  generator: number;
  program: string;
  design: Design;
  /** GarmentCode body keys (cm, degrees) the pattern was made to. */
  body: Record<string, number>;
  pattern: PatternSpec;
  attachments: AttachmentSpec[];
  /** SHA-256 of the pattern's canonical bytes. */
  hash: string;
}

export function makePs2Pattern(program: string, design: Design, body: Readonly<Record<string, number>>, built?: BuiltPattern): Ps2Pattern {
  const b = built ?? buildProgram(program, structuredClone(design), body);
  return {
    format: 'ps2pattern',
    version: 1,
    generator: PATTERN_GENERATOR_VERSION,
    program,
    design: structuredClone(design),
    body: { ...body },
    pattern: b.spec,
    attachments: b.attachments,
    hash: patternHash(b.spec),
  };
}

/** The file's text: canonical JSON (sorted keys, shortest round-trip numbers). */
export function serializePs2Pattern(p: Ps2Pattern): string {
  return `${canonicalJSON(p)}\n`;
}

export function parsePs2Pattern(text: string): Ps2Pattern {
  const p = JSON.parse(text) as Ps2Pattern;
  if (p.format !== 'ps2pattern') throw new Error('not a .ps2pattern file');
  if (p.version !== 1) throw new Error(`unsupported .ps2pattern version ${String(p.version)}`);
  if (typeof p.program !== 'string' || !p.design || !p.body || !p.pattern) throw new Error('.ps2pattern is missing program, design, body or pattern');
  return p;
}

/** Rebuild from the file's inputs; `identical` says whether the bytes equal the stored pattern's. */
export function rebuildPs2Pattern(p: Ps2Pattern): { built: BuiltPattern; identical: boolean } {
  const built = buildProgram(p.program, structuredClone(p.design), p.body);
  const identical = canonicalJSON(built.spec) === canonicalJSON(p.pattern) && canonicalJSON(built.attachments) === canonicalJSON(p.attachments ?? []);
  return { built, identical };
}
