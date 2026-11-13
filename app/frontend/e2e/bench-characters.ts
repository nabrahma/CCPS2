/**
 * The benchmark characters (PRD Part 2 section 4), Mara and Cole, shared by
 * the benchmark board and the milestone tests.
 *
 * Since M15 they wear outfits made in Garment Studio (`pnpm build:outfits`):
 * a roll-neck sweater under Mara's utility vest and Cole's cropped leather
 * jacket (shearling collar and fur trim), cargo trousers with patch pockets,
 * and Mara's wristbands. Library garments with no look of their own (boots,
 * Cole's gloves) are dressed in library leather here.
 */
import type { Page } from '@playwright/test';
import { garment, setCharacter } from './helpers';
import type { TestWindow } from './skin-helpers';

const DEFAULTS = { gender: 0.5, age: 0.5, muscle: 0.5, weight: 0.5, height: 0.5, proportions: 0.5, breastSize: 0.5, breastFirmness: 0.5, african: 1 / 3, asian: 1 / 3, caucasian: 1 / 3 };
const tint = (r: number, g: number, b: number) => ({ color: [r, g, b], brightness: 1 });

/** A library material for a garment that has no look of its own: [material, tint, wear]. */
type Dress = [string, [number, number, number], number];

export const CHARACTERS = [
  {
    id: 'mara',
    name: 'Mara',
    macros: { ...DEFAULTS, gender: 0, age: 0.38, muscle: 0.55, weight: 0.42, height: 0.48 },
    garments: [
      garment('ps2cc:clothes/rollneck_sweater', 'top', { tint: tint(0.62, 0.7, 0.62), dirt: 0.25 }),
      garment('ps2cc:clothes/mara_utility_vest', 'outer', { dirt: 0.45 }),
      garment('ps2cc:clothes/cargo_trousers', 'bottom', { tint: tint(0.9, 0.86, 0.76), dirt: 0.4 }),
      garment('mh:clothes/toigo_ankle_boots_female', 'shoes'),
      garment('ps2cc:clothes/wristbands', 'gloves'),
    ],
    dress: { 'mh:clothes/toigo_ankle_boots_female': ['leather_worn', [0.7, 0.6, 0.5], 0.5] } as Record<string, Dress>,
    skin: 'mh:skins/young_caucasian_female',
    // Short layered bob, uneven ends, side-swept fringe (Hair v2, M12).
    hair: { style: 'mara-bob', colour: 'blonde' },
    layers: [
      ['freckles', { density: 0.35 }],
      ['darkCircles', {}],
      ['dirt', { amount: 0.25 }],
    ],
  },
  {
    id: 'cole',
    name: 'Cole',
    macros: { ...DEFAULTS, gender: 1, age: 0.55, muscle: 0.62, weight: 0.5, height: 0.6 },
    garments: [
      garment('ps2cc:clothes/rollneck_sweater', 'top', { tint: tint(0.4, 0.4, 0.42) }),
      garment('ps2cc:clothes/cole_leather_jacket', 'outer', { dirt: 0.2 }),
      garment('ps2cc:clothes/cargo_trousers', 'bottom', { tint: tint(0.66, 0.68, 0.6), dirt: 0.3 }),
      garment('mh:clothes/toigo_ankle_boots_male', 'shoes'),
      garment('mh:clothes/learning_mma_fighting_gloves', 'gloves'),
    ],
    dress: {
      // Ankle boots: the tall ones show through the cargo trousers at the knee.
      'mh:clothes/toigo_ankle_boots_male': ['leather_black', [0.9, 0.85, 0.8], 0.4],
      'mh:clothes/learning_mma_fighting_gloves': ['leather_black', [1, 1, 1], 0.3],
    } as Record<string, Dress>,
    skin: 'mh:skins/young_caucasian_male',
    // Centre-parted curtain fringe, chin-length side locks, short nape (Hair v2, M12).
    hair: { style: 'cole-curtain', colour: 'darkBrown' },
    layers: [
      ['stubble', { density: 0.35 }],
      ['eyeBags', {}],
    ],
  },
] as const;

export type BenchCharacter = (typeof CHARACTERS)[number];

/** Build a benchmark character in the app: body, outfit (with each garment's look), skin and hair. */
export async function buildCharacter(page: Page, c: BenchCharacter): Promise<void> {
  await setCharacter(page, c.macros, { name: c.name, modifiers: {}, garments: c.garments });
  await page.evaluate(
    async (c: BenchCharacter) => {
      const w = window as unknown as TestWindow;
      const s = w.__ps2cc;
      const { core } = w.__ps2ccTest;
      s.engine.update('benchmark', (d) => {
        d.skin = { base: c.skin, layers: [], photo: null };
        const colour = structuredClone(core.HAIR_COLOUR_PRESETS[c.hair.colour]!.colour);
        d.hair = { mode: 'cards', style: core.starterStyle(c.hair.style), atlas: null, colour, tint: { color: [1, 1, 1], brightness: 1 }, alphaThreshold: 0.5 };
        for (const [kind, params] of c.layers) {
          const layer = core.newLayer(kind as never);
          Object.assign(layer.params, params);
          d.skin.layers.push(layer);
        }
        core.withScalpLayer(d as never);
        // Outfits: the Garment Studio garments' own looks and fur, library leather for the rest.
        for (const g of d.garments) {
          const def = s.assets.proxyInfo(g.asset).defaults;
          if (def?.look) g.look = core.sanitiseLook(def.look);
          if (def?.fur) g.fur = core.sanitiseFur(def.fur);
          const dress = (c.dress as Record<string, [string, [number, number, number], number]>)[g.asset];
          if (dress) {
            const look = core.newLook(`ps2cc:materials/${dress[0]}`);
            look.zones[0]!.tint = dress[1];
            look.zones[0]!.wear = dress[2];
            g.look = look;
          }
        }
      });
      await s.settled();
    },
    c,
  );
}
