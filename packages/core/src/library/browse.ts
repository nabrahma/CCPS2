/**
 * Library browser (Part 2 F20): every asset the creator can pick (body
 * presets, hairstyles, garments, outfits, skins, materials), searchable by
 * name and tag, with favourites. Tags come from the catalog (slot, kind,
 * source) and from the user, who can add their own to any asset.
 */

export type LibraryCategory = 'bodies' | 'hair' | 'garments' | 'outfits' | 'skins' | 'materials';

export const LIBRARY_CATEGORIES: readonly { id: LibraryCategory; label: string }[] = [
  { id: 'bodies', label: 'Bodies' },
  { id: 'hair', label: 'Hair' },
  { id: 'garments', label: 'Garments' },
  { id: 'outfits', label: 'Outfits' },
  { id: 'skins', label: 'Skins' },
  { id: 'materials', label: 'Materials' },
];

export interface LibraryEntry {
  /** Unique across categories, e.g. "garment:mh:clothes/..." or "hair:starter:mara-bob". */
  id: string;
  category: LibraryCategory;
  name: string;
  /** Tags of the asset itself (slot, kind, "user", ...). */
  tags: readonly string[];
  /** Made or imported by the user (it can be edited or deleted). */
  user: boolean;
}

export interface LibraryQuery {
  /** Words that must all appear in the name or a tag. */
  text?: string;
  /** Only entries with this tag. */
  tag?: string | null;
  favouritesOnly?: boolean;
}

/** User tags: entry id to tags. */
export type UserTags = Record<string, string[]>;

export const MAX_FAVOURITES = 2000;
export const MAX_TAGS_PER_ENTRY = 12;

/** A tag as stored: lower case, letters, digits, spaces and dashes, at most 24 characters. Empty when nothing is left. */
export function normaliseTag(tag: string): string {
  return tag
    .toLowerCase()
    .replace(/[^a-z0-9 -]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24)
    .trim();
}

/** All tags of an entry: its own and the user's, without repeats. */
export function entryTags(entry: LibraryEntry, userTags: UserTags): string[] {
  return [...new Set([...entry.tags.map(normaliseTag), ...(userTags[entry.id] ?? [])].filter(Boolean))];
}

/**
 * Entries matching a query: favourites first, then the user's own, then by
 * name. Matching ignores case and punctuation; every word must match.
 */
export function searchLibrary<T extends LibraryEntry>(entries: readonly T[], query: LibraryQuery, favourites: ReadonlySet<string>, userTags: UserTags = {}): T[] {
  const words = normaliseTag(query.text ?? '').replace(/-/g, ' ').split(' ').filter(Boolean);
  const tag = query.tag ? normaliseTag(query.tag) : null;
  const hits = entries.filter((e) => {
    if (query.favouritesOnly && !favourites.has(e.id)) return false;
    const tags = entryTags(e, userTags);
    if (tag && !tags.includes(tag)) return false;
    if (!words.length) return true;
    const hay = `${normaliseTag(e.name)} ${tags.join(' ')}`.replace(/-/g, ' ');
    return words.every((w) => hay.includes(w));
  });
  return hits.sort((a, b) => {
    const fa = favourites.has(a.id) ? 0 : 1;
    const fb = favourites.has(b.id) ? 0 : 1;
    if (fa !== fb) return fa - fb;
    if (a.user !== b.user) return a.user ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/** The tags in use across entries, most used first. */
export function libraryTags(entries: readonly LibraryEntry[], userTags: UserTags = {}): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const e of entries) for (const t of entryTags(e, userTags)) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** Favourites from settings: unique strings, at most MAX_FAVOURITES. */
export function sanitiseFavourites(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((v): v is string => typeof v === 'string' && v.length > 0 && v.length <= 300))].slice(0, MAX_FAVOURITES);
}

/** User tags from settings: normalised, unique, at most MAX_TAGS_PER_ENTRY per entry; entries with none are dropped. */
export function sanitiseUserTags(raw: unknown): UserTags {
  const out: UserTags = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, tags] of Object.entries(raw as Record<string, unknown>).slice(0, MAX_FAVOURITES)) {
    if (!id || id.length > 300 || !Array.isArray(tags)) continue;
    const clean = [...new Set(tags.filter((t): t is string => typeof t === 'string').map(normaliseTag).filter(Boolean))].slice(0, MAX_TAGS_PER_ENTRY);
    if (clean.length) out[id] = clean;
  }
  return out;
}

/** Favourites with `id` added or removed. */
export function toggleFavourite(favourites: readonly string[], id: string): string[] {
  return favourites.includes(id) ? favourites.filter((f) => f !== id) : [...favourites, id].slice(-MAX_FAVOURITES);
}

/** User tags with `tag` added to (or, when it is there, removed from) an entry. */
export function toggleUserTag(userTags: UserTags, id: string, tag: string): UserTags {
  const t = normaliseTag(tag);
  if (!t) return userTags;
  const cur = userTags[id] ?? [];
  const next = cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t].slice(0, MAX_TAGS_PER_ENTRY);
  const out = { ...userTags };
  if (next.length) out[id] = next;
  else delete out[id];
  return out;
}
