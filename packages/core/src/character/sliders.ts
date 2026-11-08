/**
 * Slider catalog (PRD F1): MakeHuman's own grouping for the "All sliders"
 * view plus PS2CC's curated view (curated_sliders.json).
 */
import curatedJson from '../data/curated_sliders.json';
import type { Modifier, ModifierSet } from '../morph/modifiers';

export type SliderTab = 'body' | 'face';

export interface SliderDef {
  /** Modifier fullName. */
  id: string;
  label: string;
  tab: SliderTab;
  group: string;
  min: number;
  max: number;
  /** Range used in the curated view and by Randomize. */
  safeMin: number;
  safeMax: number;
  defaultValue: number;
  curated: boolean;
  macro: boolean;
  /** Paired modifier mirrored when symmetry is on. */
  symmetricOpposite: string | null;
  description: string;
}

interface CuratedFile {
  adultMinAge: number;
  sliders: { mod: string; label: string; tab: SliderTab; group: string; safe: [number, number] }[];
}

interface MhSliderEntry {
  mod: string;
  label?: string;
}

/** Groups never shown or randomised (PRD non-goal: anatomical detail). */
const HIDDEN_GROUPS = new Set(['genitals']);
const HIDDEN_MODIFIERS = new Set(['pelvis/bulge-decr|incr', 'breast/nipple-size-decr|incr', 'breast/nipple-point-decr|incr']);

const curated = curatedJson as unknown as CuratedFile;

export const ADULT_MIN_AGE = curated.adultMinAge;

/** Port of the idea behind MakeHuman's automatic slider labels. */
export function defaultLabel(m: Modifier): string {
  if (m.isMacro) return m.name.replace(/([a-z])([A-Z])/g, '$1 $2');
  let name = m.name.replace(/^(l|r)-/, '');
  name = name.replace(/-([a-z]+)\|([a-z]+)(\|[a-z]+)?$/, (_s, a: string, b: string, c?: string) =>
    c ? ` ${a}/${b}/${c.slice(1)}` : ` ${a}/${b}`,
  );
  name = name.replace(/-/g, ' ');
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function isHiddenModifier(fullName: string): boolean {
  return HIDDEN_GROUPS.has(fullName.split('/')[0]!) || HIDDEN_MODIFIERS.has(fullName);
}

export class SliderCatalog {
  readonly all: readonly SliderDef[];
  readonly curated: readonly SliderDef[];
  readonly byId: ReadonlyMap<string, SliderDef>;

  constructor(modifiers: ModifierSet) {
    const cur = curated;
    const curatedById = new Map(cur.sliders.map((s) => [s.mod, s]));
    const all: SliderDef[] = [];
    const seen = new Set<string>();

    const make = (m: Modifier, tab: SliderTab, group: string, label?: string): SliderDef => {
      const c = curatedById.get(m.fullName);
      let min = m.min;
      if (m.macroKey === 'age') min = cur.adultMinAge;
      const safe = c?.safe ?? [Math.max(min, m.min === -1 ? -0.5 : 0), m.min === -1 ? 0.5 : m.max];
      return {
        id: m.fullName,
        label: c?.label ?? label ?? defaultLabel(m),
        tab: c?.tab ?? tab,
        group: c?.group ?? group,
        min,
        max: m.max,
        safeMin: Math.max(min, safe[0]),
        safeMax: Math.min(m.max, safe[1]),
        defaultValue: m.defaultValue,
        curated: !!c,
        macro: m.isMacro,
        symmetricOpposite: m.symmetricOpposite && modifiers.byName.has(m.symmetricOpposite) ? m.symmetricOpposite : null,
        description: m.description,
      };
    };

    for (const file of modifiers.doc.files) {
      const tabs = file.sliders as Record<string, { modifiers: Record<string, MhSliderEntry[]> }>;
      for (const [tabName, tab] of Object.entries(tabs)) {
        const sliderTab: SliderTab = tabName === 'Face' ? 'face' : 'body';
        for (const [groupName, entries] of Object.entries(tab.modifiers)) {
          for (const e of entries) {
            const m = modifiers.byName.get(e.mod);
            if (!m || seen.has(m.fullName) || isHiddenModifier(m.fullName)) continue;
            seen.add(m.fullName);
            const group = tabName === 'Macro modelling' ? 'Main' : capitalise(groupName);
            all.push(make(m, sliderTab, group, e.label));
          }
        }
      }
    }
    // Modifiers MakeHuman does not list in a slider file still get a slider.
    for (const m of modifiers.list) {
      if (seen.has(m.fullName) || isHiddenModifier(m.fullName)) continue;
      seen.add(m.fullName);
      all.push(make(m, 'body', 'Other'));
    }
    this.all = all;
    this.byId = new Map(all.map((s) => [s.id, s]));
    this.curated = cur.sliders.map((c) => {
      const s = this.byId.get(c.mod);
      if (!s) throw new Error(`curated slider ${c.mod} is not a known modifier`);
      return s;
    });
  }

  search(query: string, curatedOnly: boolean): SliderDef[] {
    const q = query.trim().toLowerCase();
    const list = curatedOnly ? this.curated : this.all;
    if (!q) return [...list];
    return list.filter((s) => s.label.toLowerCase().includes(q) || s.id.toLowerCase().includes(q) || s.group.toLowerCase().includes(q));
  }
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
