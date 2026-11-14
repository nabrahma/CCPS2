/**
 * The library the Character Creator picks from (Part 2 F20): body presets,
 * hairstyles, garments, outfits, skins and materials, built-in and the
 * user's, with what picking each one does, its thumbnail subject, and the
 * Asset Studio that edits it. Favourites and user tags are kept in settings.
 */
import { MESH_HAIR, meshHairName, plain, skinFacts } from './names';
import { create } from 'zustand';
import {
  applyOutfit,
  applyPreset,
  BUILTIN_OUTFITS,
  BUILTIN_PRESETS,
  DEFAULT_HAIR_COLOUR,
  hairColourKey,
  NEUTRAL_TINT,
  newLook,
  parseHairStyleFile,
  parseMaterialFile,
  parseOutfitFile,
  parsePresetFile,
  sanitiseFavourites,
  sanitiseFur,
  sanitiseLook,
  sanitiseUserTags,
  STARTER_STYLES,
  toggleFavourite as toggleFav,
  toggleUserTag,
  userMaterial,
  withScalpLayer,
  type CharacterDoc,
  type CoreAssets,
  type GarmentSlot,
  type GarmentSlotName,
  type HairSpec,
  type HairStyleParams,
  type LibraryCategory,
  type LibraryEntry,
  type Outfit,
  type Preset,
  type UserTags,
} from '@ps2cc/core';
import { backend, libraryUrl, type AppInfo, type LibraryItem } from '../backend';
import type { ThumbSubject } from '../thumbs/stage';
import type { Studio } from './studio';
import { useUi } from './ui';

/** A library entry the creator can show and pick. */
export interface CreatorEntry extends LibraryEntry {
  /** What the thumbnail shows, and the name its renders are kept under. */
  subject: ThumbSubject;
  thumbId: string;
  /** Whether the character uses it now. */
  active: (doc: Readonly<CharacterDoc>) => boolean;
  /** Pick it (one undo step). Garments toggle. */
  apply: () => void;
  /** Open it in its Asset Studio, if it has one. */
  edit?: () => void;
  /** Delete it from the library (the user's own only). */
  remove?: () => Promise<void>;
  /** A word on the thumbnail's corner (what kind it is, where kinds share a grid). */
  badge?: string;
}

interface UserLibrary {
  hairstyles: { item: LibraryItem; style: HairStyleParams }[];
  presets: { item: LibraryItem; preset: Preset }[];
  outfits: { item: LibraryItem; outfit: Outfit }[];
  skins: LibraryItem[];
}

interface LibraryState extends UserLibrary {
  favourites: string[];
  tags: UserTags;
  /** Bumped when the user's library changes. */
  version: number;
}

export const useLibrary = create<LibraryState>(() => ({ hairstyles: [], presets: [], outfits: [], skins: [], favourites: [], tags: {}, version: 0 }));

async function readDocs<T>(kind: string, parse: (raw: unknown) => T): Promise<{ item: LibraryItem; value: T }[]> {
  const items = await backend.listLibrary(kind).catch(() => [] as LibraryItem[]);
  const out = await Promise.all(
    items.map(async (item) => {
      try {
        return { item, value: parse(JSON.parse(await backend.readLibraryDocument(item.file))) };
      } catch (err) {
        backend.log('warn', `${kind} ${item.file} skipped: ${String(err)}`);
        return null;
      }
    }),
  );
  return out.filter((x): x is { item: LibraryItem; value: T } => x !== null).sort((a, b) => a.item.name.localeCompare(b.item.name));
}

/** Read the user's hairstyles, presets, outfits and skins (again, after one is saved). */
export async function refreshUserLibrary(studio: Studio): Promise<void> {
  const known = (id: string) => studio.assets.modifiers.byName.has(id);
  const [hairstyles, presets, outfits, skins] = await Promise.all([
    readDocs('hairstyles', parseHairStyleFile),
    readDocs('presets', (raw) => parsePresetFile(raw, known)),
    readDocs('outfits', (raw) => parseOutfitFile(raw, (a) => studio.assets.hasProxy(a))),
    backend.listLibrary('skins').catch(() => [] as LibraryItem[]),
  ]);
  useLibrary.setState((s) => ({
    hairstyles: hairstyles.map((h) => ({ item: h.item, style: h.value })),
    presets: presets.map((p) => ({ item: p.item, preset: p.value })),
    outfits: outfits.map((o) => ({ item: o.item, outfit: o.value })),
    skins,
    version: s.version + 1,
  }));
}

/** Add the user's Material Studio materials to the library. One unreadable material must not stop the app. */
export async function loadUserMaterials(info: AppInfo, assets: CoreAssets): Promise<void> {
  for (const { item, value } of await readDocs('materials', parseMaterialFile)) {
    assets.addUserMaterial(userMaterial(value, item.id, libraryUrl(info, `materials/${value.diffuse}`)));
  }
}

/** Favourites and tags from settings. */
export function loadLibraryPrefs(settings: { favourites?: string[]; libraryTags?: Record<string, string[]> }): void {
  useLibrary.setState({ favourites: sanitiseFavourites(settings.favourites), tags: sanitiseUserTags(settings.libraryTags) });
}

function savePrefs(studio: Studio): void {
  const { favourites, tags } = useLibrary.getState();
  if (!studio.settings) return;
  studio.settings = { ...studio.settings, favourites, libraryTags: tags };
  backend.saveSettings(studio.settings).catch((err: unknown) => backend.log('warn', `saving favourites failed: ${String(err)}`));
}

export function toggleFavourite(studio: Studio, id: string): void {
  useLibrary.setState((s) => ({ favourites: toggleFav(s.favourites, id) }));
  savePrefs(studio);
}

export function toggleTag(studio: Studio, id: string, tag: string): void {
  useLibrary.setState((s) => ({ tags: toggleUserTag(s.tags, id, tag) }));
  savePrefs(studio);
}

// ------------------------------------------------------------------ actions

/** A garment as it is put on from the library: its defaults (look, fur, tint) applied. */
export function garmentToWear(studio: Studio, id: string, slot: GarmentSlotName): GarmentSlot {
  const def = studio.assets.proxyInfo(id).defaults;
  return {
    slot,
    asset: id,
    tint: { ...NEUTRAL_TINT, color: def?.tint ? [...def.tint] : [1, 1, 1] },
    dirt: 0,
    hideBody: true,
    ...(def?.look ? { look: sanitiseLook(def.look) } : {}),
    ...(def?.fur ? { fur: sanitiseFur(def.fur) } : {}),
  };
}

/** Put a garment on, or take it off if it is worn. */
export function toggleGarment(studio: Studio, id: string, slot: GarmentSlotName): void {
  studio.engine.update('Change garments', (d) => {
    const i = d.garments.findIndex((g) => g.asset === id);
    if (i >= 0) d.garments.splice(i, 1);
    else d.garments.push(garmentToWear(studio, id, slot));
  });
}

export function setHairStyle(studio: Studio, style: HairStyleParams, label = 'Hairstyle'): void {
  studio.engine.update(label, (d) => {
    d.hair = { ...d.hair, mode: 'cards', style: structuredClone(style), atlas: d.hair.atlas ?? null };
    // Hair v2 styles come with their colour gradient (kept if one is set) and the scalp layer.
    if (style.locks.enabled) d.hair.colour ??= structuredClone(DEFAULT_HAIR_COLOUR);
    withScalpLayer(d);
  });
}

/** Dress the garment `partKey` in a material (its first zone; a plain garment gets a look). */
export function applyMaterial(studio: Studio, partKey: string, materialId: string): void {
  studio.engine.update('Garment material', (d) => {
    const g = d.garments.find((x) => `garment:${x.slot}:${x.asset}` === partKey);
    if (!g) return;
    if (!g.look) g.look = newLook(materialId);
    else g.look.zones[0]!.material = materialId;
  });
}

/** The garment a material goes on: the selected one, or the outermost worn top. */
export function materialTarget(studio: Studio): string | null {
  const sel = useUi.getState().selected;
  if (sel?.startsWith('garment:') && studio.engine.doc.garments.some((g) => `garment:${g.slot}:${g.asset}` === sel)) return sel;
  const order: GarmentSlotName[] = ['outer', 'top', 'full', 'bottom'];
  for (const slot of order) {
    const g = studio.engine.doc.garments.find((x) => x.slot === slot);
    if (g) return `garment:${g.slot}:${g.asset}`;
  }
  return null;
}

// ------------------------------------------------------------------ entries

const hairName = (doc: Readonly<CharacterDoc>) => (doc.hair.mode === 'cards' ? doc.hair.style?.name : null);

/** The thumbnail hair: the style in the character's own hair colour. */
function hairSubject(doc: Readonly<CharacterDoc>, hair: Partial<HairSpec>): ThumbSubject {
  const colour = structuredClone(doc.hair.colour ?? DEFAULT_HAIR_COLOUR);
  const spec: HairSpec = { mode: 'none', tint: { ...NEUTRAL_TINT, color: [1, 1, 1] }, alphaThreshold: 0.5, ...hair };
  if (spec.mode === 'cards') spec.colour = colour;
  return { kind: 'hair', hair: spec };
}

/** Every entry of a category, built-in and the user's. */
export function libraryEntries(studio: Studio, category: LibraryCategory): CreatorEntry[] {
  const lib = useLibrary.getState();
  const doc = studio.engine.doc;
  const ui = useUi.getState();
  const assets = studio.assets;
  switch (category) {
    case 'bodies':
      return [
        ...BUILTIN_PRESETS.map((p) => ({ preset: p, user: false, file: '' })),
        ...lib.presets.map((p) => ({ preset: p.preset, user: true, file: p.item.file })),
      ].map(({ preset, user, file }) => ({
        id: `body:${preset.id}`,
        category,
        name: preset.label,
        tags: [(preset.macros.gender ?? 0.5) >= 0.5 ? 'male' : 'female', ...(user ? ['yours'] : [])],
        user,
        subject: { kind: 'preset', preset },
        thumbId: `body:${preset.id}`,
        active: () => false,
        apply: () => studio.engine.replaceDoc(applyPreset(studio.engine.doc, preset), `Preset ${preset.label}`),
        ...(user ? { remove: () => backend.deleteLibraryItem(file).then(() => refreshUserLibrary(studio)) } : {}),
      }));
    case 'hair': {
      const colourKey = hairColourKey(doc.hair.colour ?? DEFAULT_HAIR_COLOUR);
      const openHairStudio = () => ui.openStudio({ kind: 'hair', target: null });
      const styles: CreatorEntry[] = [
        ...STARTER_STYLES.map((s) => ({ id: `hair:starter:${s.id}`, style: s.style, user: false, file: '' })),
        ...lib.hairstyles.map((h) => ({ id: `hair:${h.item.id}`, style: h.style, user: true, file: h.item.file })),
      ].map(({ id, style, user, file }) => ({
        id,
        category,
        name: style.name,
        tags: [style.length.sides >= 0.22 ? 'long' : style.length.sides <= 0.08 ? 'short' : 'medium', 'editable', ...(user ? ['yours'] : [])],
        user,
        subject: hairSubject(doc, { mode: 'cards', style, atlas: null }),
        thumbId: `${id}|${colourKey}`,
        active: (d) => hairName(d) === style.name,
        apply: () => setHairStyle(studio, style),
        edit: () => {
          if (hairName(studio.engine.doc) !== style.name) setHairStyle(studio, style);
          openHairStudio();
        },
        ...(user ? { remove: () => backend.deleteLibraryItem(file).then(() => refreshUserLibrary(studio)) } : {}),
      }));
      const meshes: CreatorEntry[] = assets.catalog.proxies
        .filter((p) => p.category === 'hair')
        .map((p) => ({
          id: `hair:mesh:${p.id}`,
          category,
          name: meshHairName(p.id, p.name),
          tags: [MESH_HAIR[p.id]?.length ?? 'medium', 'mesh'],
          badge: 'Mesh',
          user: false,
          subject: hairSubject(doc, { mode: 'mesh', asset: p.id }),
          thumbId: `hair:mesh:${p.id}`,
          active: (d) => d.hair.mode === 'mesh' && d.hair.asset === p.id,
          apply: () =>
            studio.engine.update('Change hair', (d) => {
              d.hair = { ...d.hair, mode: 'mesh', asset: p.id, texture: null };
              withScalpLayer(d);
            }),
        }));
      const bald: CreatorEntry = {
        id: 'hair:none',
        category,
        name: 'Bald',
        tags: ['short'],
        user: false,
        subject: hairSubject(doc, { mode: 'none' }),
        thumbId: 'hair:none',
        active: (d) => d.hair.mode === 'none',
        apply: () =>
          studio.engine.update('Hair mode', (d) => {
            d.hair = { ...d.hair, mode: 'none' };
            withScalpLayer(d);
          }),
      };
      return [bald, ...styles, ...meshes];
    }
    case 'garments':
      return assets.catalog.proxies
        .filter((p) => p.category === 'clothes')
        .map((p) => {
          const slot = (p.slot ?? 'accessory') as GarmentSlotName;
          const user = p.tags.includes('user');
          return {
            id: `garment:${p.id}`,
            category,
            name: plain(p.name),
            tags: [slot, ...(user ? ['yours'] : [])],
            user,
            subject: { kind: 'garment', garment: garmentToWear(studio, p.id, slot) },
            thumbId: `garment:${p.id}`,
            active: (d) => d.garments.some((g) => g.asset === p.id),
            apply: () => toggleGarment(studio, p.id, slot),
            edit: () => {
              if (!studio.engine.doc.garments.some((g) => g.asset === p.id)) toggleGarment(studio, p.id, slot);
              ui.openStudio({ kind: 'garment', target: `garment:${slot}:${p.id}` });
            },
            ...(user ? { remove: () => studio.deleteGarment(p.id) } : {}),
          };
        });
    case 'outfits':
      return [
        ...BUILTIN_OUTFITS.map((o) => ({ outfit: o, user: false, file: '' })),
        ...lib.outfits.map((o) => ({ outfit: o.outfit, user: true, file: o.item.file })),
      ]
        .map(({ outfit, user, file }) => {
          const wearable = outfit.garments.filter((g) => assets.hasProxy(g.asset));
          const defaults = (a: string) => (assets.hasProxy(a) ? assets.proxyInfo(a).defaults : undefined);
          const dressed = applyOutfit(doc as CharacterDoc, { ...outfit, garments: wearable }, defaults).garments;
          return {
            id: `outfit:${outfit.id}`,
            category,
            name: outfit.label,
            tags: [...(user ? ['yours'] : [])],
            user,
            subject: { kind: 'outfit', garments: dressed } as ThumbSubject,
            thumbId: `outfit:${outfit.id}`,
            active: (d: Readonly<CharacterDoc>) => d.garments.length === wearable.length && wearable.every((g) => d.garments.some((x) => x.asset === g.asset)),
            apply: () => studio.engine.replaceDoc(applyOutfit(studio.engine.doc as CharacterDoc, { ...outfit, garments: wearable }, defaults), `Outfit ${outfit.label}`),
            ...(user ? { remove: () => backend.deleteLibraryItem(file).then(() => refreshUserLibrary(studio)) } : {}),
            wearable: wearable.length,
          };
        })
        .filter((e) => e.wearable > 0);
    case 'skins': {
      const setBase = (base: string) => studio.engine.update('Change skin', (d) => void (d.skin = { ...d.skin, base }));
      const texture = () => ui.openStudio({ kind: 'texture', target: 'skin' });
      return [
        ...lib.skins.map((s) => {
          const url = libraryUrl(studio.info, s.file);
          return {
            id: `skin:${s.id}`,
            category,
            name: s.name.replace(/\.(png|jpe?g)$/i, ''),
            tags: ['yours'],
            user: true,
            subject: { kind: 'skin', base: url } as ThumbSubject,
            thumbId: `skin:${s.id}`,
            active: (d: Readonly<CharacterDoc>) => d.skin.base === url,
            apply: () => setBase(url),
            edit: () => {
              setBase(url);
              texture();
            },
            remove: () => backend.deleteLibraryItem(s.file).then(() => refreshUserLibrary(studio)),
          };
        }),
        ...assets.catalog.skins.map((s) => ({
          id: `skin:${s.id}`,
          category,
          name: skinFacts(s.id).name,
          tags: [skinFacts(s.id).gender, skinFacts(s.id).age].filter((t): t is NonNullable<typeof t> => t !== null),
          user: false,
          subject: { kind: 'skin', base: s.id } as ThumbSubject,
          thumbId: `skin:${s.id}`,
          active: (d: Readonly<CharacterDoc>) => d.skin.base === s.id,
          apply: () => setBase(s.id),
          edit: () => {
            setBase(s.id);
            texture();
          },
        })),
      ];
    }
    case 'materials':
      return (assets.catalog.materials ?? [])
        .filter((m) => !m.id.includes('~draft'))
        .map((m) => {
          const user = m.source.site === 'user';
          return {
            id: `material:${m.id}`,
            category,
            name: m.name,
            tags: [m.kind, ...(user ? ['yours'] : [])],
            user,
            subject: { kind: 'material', id: m.id } as ThumbSubject,
            thumbId: `material:${m.id}`,
            active: (d: Readonly<CharacterDoc>) => d.garments.some((g) => g.look?.zones.some((z) => z.material === m.id)),
            apply: () => {
              const target = materialTarget(studio);
              if (!target) {
                ui.error('Put on a garment first: the material goes on the selected garment');
                return;
              }
              applyMaterial(studio, target, m.id);
            },
            edit: () => ui.openStudio({ kind: 'material', target: m.id, zone: materialTarget(studio) ? { partKey: materialTarget(studio)!, zone: 0 } : null }),
            ...(user
              ? {
                  remove: async () => {
                    await backend.deleteLibraryItem(`materials/${m.id.replace(/^user:materials\//, '')}.ps2mat`);
                    assets.removeUserMaterial(m.id);
                    useLibrary.setState((s) => ({ version: s.version + 1 }));
                  },
                }
              : {}),
          };
        });
  }
}
