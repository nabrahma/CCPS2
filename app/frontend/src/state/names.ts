/**
 * Plain names and filter facts for the library's built-in assets (D-149).
 * MakeHuman's community assets are named after files ("afro01",
 * "toigo_blunt_bob_with_bangs") and their catalog tags are often wrong (female
 * skins tagged "male"), so the creator names them here and works out length,
 * gender and age from what they are.
 */

export type HairLength = 'short' | 'medium' | 'long';

/** MakeHuman's mesh hairstyles: a name, the length, and who made them. */
export const MESH_HAIR: Record<string, { name: string; length: HairLength; author: string }> = {
  'mh:hair/afro01': { name: 'Afro', length: 'short', author: 'MakeHuman' },
  'mh:hair/bob01': { name: 'Swept bob', length: 'medium', author: 'MakeHuman' },
  'mh:hair/bob02': { name: 'Side-fringe bob', length: 'medium', author: 'MakeHuman' },
  'mh:hair/braid01': { name: 'Braid', length: 'long', author: 'MakeHuman' },
  'mh:hair/long01': { name: 'Long', length: 'long', author: 'MakeHuman' },
  'mh:hair/ponytail01': { name: 'Ponytail', length: 'long', author: 'MakeHuman' },
  'mh:hair/short01': { name: 'Short', length: 'short', author: 'MakeHuman' },
  'mh:hair/short02': { name: 'Short textured', length: 'short', author: 'MakeHuman' },
  'mh:hair/short03': { name: 'Short side-swept', length: 'short', author: 'MakeHuman' },
  'mh:hair/short04': { name: 'Slicked short', length: 'short', author: 'MakeHuman' },
  'mh:hair/cortu_shaggy_green_hair': { name: 'Long shaggy', length: 'long', author: 'cortu' },
  'mh:hair/cortu_short_messy_hair': { name: 'Short messy', length: 'short', author: 'cortu' },
  'mh:hair/cortu_straight_bangs': { name: 'Straight with bangs', length: 'medium', author: 'cortu' },
  'mh:hair/cortu_strawberry_cloud_hair': { name: 'Curly cloud', length: 'medium', author: 'cortu' },
  'mh:hair/culturalibre_hair_01': { name: 'Long straight', length: 'long', author: 'culturalibre' },
  'mh:hair/culturalibre_hair_02': { name: 'Short crop', length: 'short', author: 'culturalibre' },
  'mh:hair/culturalibre_hair_05': { name: 'Side part', length: 'short', author: 'culturalibre' },
  'mh:hair/culturalibre_hair_06': { name: 'Spiky', length: 'short', author: 'culturalibre' },
  'mh:hair/elvs_double_mh_braid': { name: 'Double braid', length: 'long', author: 'elvs' },
  'mh:hair/elvs_french_braid_variation': { name: 'French braid', length: 'long', author: 'elvs' },
  'mh:hair/elvs_reverse_french_braid_bun': { name: 'Braided bun', length: 'medium', author: 'elvs' },
  'mh:hair/elvs_unkempt_french_braid': { name: 'Unkempt braid', length: 'medium', author: 'elvs' },
  'mh:hair/faydaen_hair_1': { name: 'Swept-back tail', length: 'medium', author: 'faydaen' },
  'mh:hair/learning_anime_hair': { name: 'Anime', length: 'medium', author: 'learning' },
  'mh:hair/littleright_bobcut_hair': { name: 'Bowl bob', length: 'medium', author: 'littleright' },
  'mh:hair/o4saken_long01': { name: 'Long layered', length: 'long', author: 'o4saken' },
  'mh:hair/rehmanpolanski_hair_bun_brown': { name: 'Bun', length: 'short', author: 'rehmanpolanski' },
  'mh:hair/sonntag78_blond_with_headband': { name: 'Curls with headband', length: 'medium', author: 'sonntag78' },
  'mh:hair/sonntag78_junglebook_hair': { name: 'Wild', length: 'long', author: 'sonntag78' },
  'mh:hair/toigo_blunt_bob': { name: 'Blunt bob', length: 'medium', author: 'toigo' },
  'mh:hair/toigo_blunt_bob_with_bangs': { name: 'Blunt bob with bangs', length: 'medium', author: 'toigo' },
  'mh:hair/toigo_curled_under_bob': { name: 'Curled-under bob', length: 'medium', author: 'toigo' },
  'mh:hair/toigo_curled_under_bob_with_bangs': { name: 'Curled-under bob with bangs', length: 'medium', author: 'toigo' },
  'mh:hair/toigo_inverted_bob': { name: 'Inverted bob', length: 'medium', author: 'toigo' },
  'mh:hair/toigo_inverted_bob_with_bangs': { name: 'Inverted bob with bangs', length: 'medium', author: 'toigo' },
};

/** A mesh hairstyle's plain name (one not listed: its file name, tidied). */
export function meshHairName(id: string, fallback: string): string {
  return MESH_HAIR[id]?.name ?? tidy(fallback);
}

/** Authors' prefixes on MakeHuman community skins. */
const SKIN_AUTHORS = ['blindsaypatten_', 'bobby_03_', 'callharvey3d_', 'cutoff3d_', 'darthfurby_', 'flower-angel_', 'nyloseth_', 'onlytheghosts_', 'skalldyrssuppe_', 'toigo_'];

const SKIN_NAMES: Record<string, string> = {
  'mh:skins/blindsaypatten_uniform_skin_texture': 'Even tone',
  'mh:skins/bobby_03_young_female_hairless': 'Grey',
  'mh:skins/nyloseth_zoeyskin': 'Zoey',
  'mh:skins/flower-angel_red_head_skin': 'Red-head',
  'mh:skins/darthfurby_caucasian_female': 'Caucasian female, detailed',
  'mh:skins/toigo_light_skin_with_makeup': 'Light, with makeup',
};

export interface SkinFacts {
  name: string;
  gender: 'female' | 'male' | null;
  age: 'young' | 'middle-aged' | 'old' | null;
}

/** A built-in skin's name, gender and age, from its file name (not its catalog tags). */
export function skinFacts(id: string): SkinFacts {
  const file = id.split('/').pop() ?? id;
  const words = file.toLowerCase().split(/[_-]+/);
  const gender = words.includes('female') ? 'female' : words.includes('male') ? 'male' : null;
  const age = words.includes('young') ? 'young' : words.includes('middleage') || words.includes('middle') ? 'middle-aged' : words.includes('old') ? 'old' : null;
  let name = SKIN_NAMES[id];
  if (!name) {
    let base = file;
    for (const a of SKIN_AUTHORS) if (base.startsWith(a)) base = base.slice(a.length);
    name = tidy(
      base
        .replace(/^middleage_/, 'middle-aged_')
        .replace(/^middle_aged_/, 'middle-aged_')
        .replace(/_skin_/, '_')
        .replace(/_skin$/, '')
        .replace(/_with_/g, ', with ')
        .replace(/(\D)(\d)$/, '$1 $2'),
    );
  }
  return { name, gender, age };
}

/** "toigo_blunt_bob" → "Toigo blunt bob"; a trailing 01 goes, other numbers stay. */
export function tidy(raw: string): string {
  const s = raw
    .replace(/[_]+/g, ' ')
    .replace(/(\D)0*1$/, '$1')
    .replace(/(\D)0*(\d+)$/, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
  const proper = s.replace(/\b(african|asian|caucasian|indian|eurasian)\b/gi, (w) => w[0]!.toUpperCase() + w.slice(1).toLowerCase());
  return proper.charAt(0).toUpperCase() + proper.slice(1);
}

/** "male_casualsuit01" → "Male casualsuit01": underscores to spaces, a capital first. */
export function plain(raw: string): string {
  const s = raw.replace(/_+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
