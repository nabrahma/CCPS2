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
  // hair02 and hair03 (D-150).
  'mh:hair/elvs_50s_updo': { name: '1950s updo', length: 'medium', author: 'Elvaerwyn' },
  'mh:hair/elvs_adrienne_hair': { name: 'Long side part', length: 'long', author: 'Elvaerwyn' },
  'mh:hair/elvs_ashley_may_hair': { name: 'Feathered', length: 'medium', author: 'Elvaerwyn' },
  'mh:hair/elvs_braid_bun': { name: 'Braided top bun', length: 'short', author: 'Elvaerwyn' },
  'mh:hair/elvs_braided_rows': { name: 'Cornrows with beads', length: 'short', author: 'Elvaerwyn' },
  'mh:hair/elvs_daisy_hair': { name: 'Long straight, parted', length: 'long', author: 'Elvaerwyn' },
  'mh:hair/elvs_grump_hair': { name: 'Comb-over', length: 'short', author: 'Elvaerwyn' },
  'mh:hair/elvs_hazel_hair': { name: 'Long wavy', length: 'long', author: 'Elvaerwyn' },
  'mh:hair/elvs_inverted_curly_bob': { name: 'Inverted curly bob', length: 'medium', author: 'Elvaerwyn' },
  'mh:hair/elvs_island_princess_hair': { name: 'Long with a flower', length: 'long', author: 'Elvaerwyn' },
  'mh:hair/elvs_katherine_hair': { name: 'Asymmetric', length: 'medium', author: 'Elvaerwyn' },
  'mh:hair/elvs_keylth_hair': { name: 'Long loose', length: 'long', author: 'Elvaerwyn' },
  'mh:hair/elvs_lady_hippy_hair': { name: 'Long hippie', length: 'long', author: 'Elvaerwyn' },
  'mh:hair/elvs_lara_hair': { name: 'Single long braid', length: 'long', author: 'Elvaerwyn' },
  'mh:hair/elvs_maxwell_hair': { name: 'Swept quiff', length: 'short', author: 'Elvaerwyn' },
  'mh:hair/elvs_micky_afro': { name: 'Afro puffs', length: 'short', author: 'Elvaerwyn' },
  'mh:hair/elvs_short_daisy_hair': { name: 'Straight bob, parted', length: 'medium', author: 'Elvaerwyn' },
  'mh:hair/elvs_short_side_do': { name: 'Stylised side sweep', length: 'short', author: 'Elvaerwyn' },
  'mh:hair/elvs_that_80s_babe_hair': { name: '1980s long', length: 'long', author: 'Elvaerwyn' },
  'mh:hair/elvs_wavy_bob': { name: 'Curly bob', length: 'medium', author: 'Elvaerwyn' },
  'mh:hair/elvs_witchy_lil_bob': { name: 'Straight bob with fringe', length: 'medium', author: 'Elvaerwyn' },
  'mh:hair/culturalibre_hair_11': { name: 'Stylised spikes', length: 'short', author: 'culturalibre' },
  'mh:hair/culturalibre_hair_12': { name: 'Stylised swoop', length: 'medium', author: 'culturalibre' },
  'mh:hair/culturalibre_hair_13': { name: 'Layered short ponytail', length: 'medium', author: 'culturalibre' },
  'mh:hair/culturalibre_hair_14': { name: 'Short rounded', length: 'short', author: 'culturalibre' },
  'mh:hair/culturalibre_hair_17': { name: 'Long wavy, swept', length: 'long', author: 'culturalibre' },
  'mh:hair/culturalibre_hair_18': { name: 'Long with bangs', length: 'long', author: 'culturalibre' },
  'mh:hair/grinsegold_wig_bow_tie': { name: 'Period wig with ribbon', length: 'medium', author: 'grinsegold' },
  'mh:hair/grinsegold_wig_bun_blonde_braids': { name: 'Braided bun wig', length: 'short', author: 'grinsegold' },
  'mh:hair/o4saken_chinesebob01': { name: 'Sleek bob', length: 'medium', author: 'o4saken' },
  'mh:hair/o4saken_curly01': { name: 'Long curly', length: 'long', author: 'o4saken' },
  'mh:hair/punkduck_alpha7_curly': { name: 'Curly, shoulder length', length: 'medium', author: 'punkduck' },
  'mh:hair/punkduck_alpha7_curly2': { name: 'Long curly, full', length: 'long', author: 'punkduck' },
  'mh:hair/punkduck_alpha7_long': { name: 'Long straight, centre part', length: 'long', author: 'punkduck' },
  'mh:hair/punkduck_alpha7_long2': { name: 'Long layered with fringe', length: 'long', author: 'punkduck' },
};

/** A mesh hairstyle's plain name (one not listed: its file name, tidied). */
export function meshHairName(id: string, fallback: string): string {
  return MESH_HAIR[id]?.name ?? tidy(fallback);
}

/** What kind of thing a built-in garment is, from its asset pack (D-150): the wardrobe filters by it. */
export type GarmentKind = 'glasses' | 'jewellery' | 'mask' | 'facial-hair' | 'fantasy' | 'gear';

const PACK_KIND: Record<string, GarmentKind> = {
  glasses01: 'glasses',
  glasses02: 'glasses',
  jewelry01: 'jewellery',
  jewelry02: 'jewellery',
  masks01: 'mask',
  masks02: 'mask',
  bodyparts01: 'fantasy',
  bodyparts02: 'fantasy',
  bodyparts03: 'fantasy',
  bodyparts04: 'fantasy',
  bodyparts05: 'facial-hair',
  bodyparts06: 'facial-hair',
  equipment01: 'gear',
  equipment02: 'gear',
  equipment03: 'gear',
};

export function garmentKind(pack: string | undefined): GarmentKind | null {
  return (pack && PACK_KIND[pack]) || null;
}

/** Authors' prefixes on MakeHuman community skins. */
const SKIN_AUTHORS = [
  'blindsaypatten_', 'bobby_03_', 'bogdan666_', 'callharvey3d_', 'culturalibre_', 'cutoff3d_', 'darthfurby_', 'flower-angel_', 'naim_abbassi_',
  'nyloseth_', 'onlytheghosts_', 'reizibarrientos_', 'skalldyrssuppe_', 'sohh_', 'sonntag78_', 'spreadcore_', 'titleknown_', 'toigo_', 'trashhunter_',
  'xhado84_',
];

const SKIN_NAMES: Record<string, string> = {
  'mh:skins/blindsaypatten_uniform_skin_texture': 'Even tone',
  'mh:skins/bobby_03_young_female_hairless': 'Grey',
  'mh:skins/nyloseth_zoeyskin': 'Zoey',
  'mh:skins/flower-angel_red_head_skin': 'Red-head',
  'mh:skins/darthfurby_caucasian_female': 'Caucasian female, detailed',
  'mh:skins/toigo_light_skin_with_makeup': 'Light, with makeup',
  // skins03 (D-150): non-natural skins.
  'mh:skins/bobby_03_grey_skinned_person': 'Grey-skinned',
  'mh:skins/bogdan666_elfskinsohlen': 'Elf',
  'mh:skins/callharvey3d_baboon_people': 'Baboon',
  'mh:skins/naim_abbassi_zombie_skin': 'Zombie',
  'mh:skins/sohh_female_zombie_skin': 'Zombie, female',
  'mh:skins/reizibarrientos_blue_leopard_skin': 'Blue leopard',
  'mh:skins/sonntag78_orkifyheadtarget_custom_skin': 'Orc',
  'mh:skins/spreadcore_gray_alien_bio_armor_skin_1': 'Grey alien, bio-armour',
  'mh:skins/spreadcore_green_alien_skin_1': 'Green alien',
  'mh:skins/spreadcore_green_alien_skin_2': 'Green alien 2',
  'mh:skins/titleknown_trans_flag': 'Trans flag body paint',
  'mh:skins/trashhunter_black_kameri_fur': 'Black fur',
  'mh:skins/xhado84_young_asian_female_body_suit_gold': 'Gold body suit',
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

/**
 * Authors' prefixes on MakeHuman community garments (D-150), longest first so
 * "culturalibre_cl_" goes before "culturalibre_".
 */
const GARMENT_AUTHORS = [
  'culturalibre_cl_', 'callharvey3d_harvey_', 'matcreator_mc-', 'kwnet_at_', 'green_tomato_', 'spamrakuen_sagerfrogs_', 'spamrakuen_tbm_',
  'aethelraed_', 'callharvey3d_', 'cortu_', 'culturalibre_', 'donitz_', 'drednicolson_', 'dressupdoc_', 'elvs_', 'ews_', 'frankyaye_',
  'freezychan_', 'gredal_', 'grinsegold_', 'jaldmic_', 'janexx_', 'javherre_', 'joachip_', 'joepal_', 'jujube_', 'learning_', 'maciekg_',
  'madmanny_', 'marco_', 'matcreator_', 'mindfront_', 'mrgreaterthan_', 'mtknife_', 'namuhekam_', 'o4saken_', 'punkduck_',
  'rehmanpolanski_', 'scailman_', 'scsouza_', 'skalldyrssuppe_', 'sonicteam998_', 'spamrakuen_', 'thegreatengineer_', 'tiomegamanx_',
  'toigo_', 'v0rt3x_', 'wdg_', 'wojackowl_', 'wolgade_',
];

/**
 * A built-in garment's name. Community garments are named from their file
 * ("elvs_male_trouser_with_chain" → "Men's trouser with chain", "mindfront_f_dress_03"
 * → "Women's dress 3"), since their own names are often codes ("mens_teeshirt1j");
 * MakeHuman's own garments keep theirs ("Male casualsuit01").
 */
export function garmentName(id: string, raw: string): string {
  const file = id.startsWith('mh:clothes/') ? id.slice('mh:clothes/'.length) : null;
  const author = file ? GARMENT_AUTHORS.find((a) => file.startsWith(a)) : undefined;
  if (!file || !author) return plain(raw);
  const words = file
    .slice(author.length)
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])0*1$/i, '$1')
    .replace(/ 0*1$/, '')
    .replace(/([a-z])0*(\d+)$/i, '$1 $2')
    .replace(/ 0+(\d)/g, ' $1')
    .trim()
    .split(' ');
  const who: Record<string, string> = { f: "Women's", female: "Women's", ladies: "Women's", fem: "Women's", m: "Men's", male: "Men's", mens: "Men's" };
  if (words.length > 1 && who[words[0]!]) words[0] = who[words[0]!]!;
  const s = words.join(' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "male_casualsuit01" → "Male casualsuit01": underscores to spaces, a capital first. */
export function plain(raw: string): string {
  const s = raw.replace(/_+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
