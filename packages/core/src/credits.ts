/**
 * Help → Credits (PRD 9.2): who made what ships in the app, read from the
 * licence manifest the asset compiler writes, so it cannot drift from the files.
 */

export interface LicenceRow {
  file: string;
  asset?: string;
  licence: string;
  author: string;
  sourceUrl: string;
  upstream?: string;
  attributionRequired?: boolean;
}

export interface LicenceManifest {
  format?: string;
  policy?: string;
  files: LicenceRow[];
}

export interface CreditEntry {
  author: string;
  /** The asset pack or project the files came from. */
  source: string;
  licence: string;
  sourceUrl: string;
  /** Asset ids covered by this entry, sorted. */
  assets: string[];
  files: number;
  /** Some of the files were changed by PS2CC (CC-BY asks for this to be stated). */
  modified: boolean;
}

export interface Credits {
  /** Everything whose licence requires a credit. */
  attribution: CreditEntry[];
  /** CC0 work, credited as a courtesy. */
  courtesy: CreditEntry[];
  files: number;
  /** Files per licence, most common first. */
  licences: [string, number][];
}

const DECIMATED = ' (decimated by PS2CC)';

/** Group the manifest by author, source and licence. Every file lands in exactly one entry. */
export function buildCredits(manifest: LicenceManifest): Credits {
  const entries = new Map<string, CreditEntry & { names: Set<string>; sources: Set<string>; required: boolean }>();
  const licences = new Map<string, number>();
  for (const row of manifest.files) {
    licences.set(row.licence, (licences.get(row.licence) ?? 0) + 1);
    const modified = row.author.endsWith(DECIMATED);
    const author = modified ? row.author.slice(0, -DECIMATED.length) : row.author;
    const key = [author, row.licence, row.sourceUrl].join('\n');
    let entry = entries.get(key);
    if (!entry) {
      entry = { author, source: '', licence: row.licence, sourceUrl: row.sourceUrl, assets: [], files: 0, modified: false, names: new Set(), sources: new Set(), required: false };
      entries.set(key, entry);
    }
    entry.files++;
    entry.modified ||= modified;
    entry.required ||= Boolean(row.attributionRequired) || row.licence !== 'CC0-1.0';
    if (row.asset) entry.names.add(row.asset);
    // 'ps2cc' marks a file the asset compiler wrote itself (a notice), which is not a source.
    if (row.upstream && row.upstream !== 'ps2cc') entry.sources.add(row.upstream);
  }
  const attribution: CreditEntry[] = [];
  const courtesy: CreditEntry[] = [];
  for (const { names, sources, required, ...entry } of entries.values()) {
    (required ? attribution : courtesy).push({ ...entry, source: [...sources].sort().join(', '), assets: [...names].sort() });
  }
  const byAuthor = (a: CreditEntry, b: CreditEntry) => a.author.localeCompare(b.author) || a.source.localeCompare(b.source);
  return {
    attribution: attribution.sort(byAuthor),
    courtesy: courtesy.sort(byAuthor),
    files: manifest.files.length,
    licences: [...licences].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  };
}
