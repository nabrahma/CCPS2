/**
 * Modifiers, ported from MakeHuman 1.x `apps/humanmodifier.py`.
 *
 * MakeHuman keeps modifier values implicitly in a "detail stack" of target
 * weights. PS2CC stores the modifier values explicitly (CharacterDoc) and
 * derives the target weights from them with the same maths:
 *
 *   weight(target) = value-dependent side factor  x  product of macro factors
 *
 * The derivation is a pure function of (macro values, modifier values), which
 * the asset compiler verified holds for hm08: no non-macro target depends on
 * macro variables (assets/core/targets/registry_report.json).
 */
import { readJson, type AssetSource } from '../io/source';
import { macroFactors, type MacroValues } from './macros';
import type { TargetStore } from './targets';

export type ModifierKind = 'universal' | 'macro' | 'ethnic';

/** One modifier definition as written in MakeHuman's *_modifiers.json. */
interface RawModifierDef {
  target?: string;
  min?: string;
  max?: string;
  mid?: string;
  macrovar?: string;
  modifierType?: string;
  defaultValue?: number;
  label?: string;
  cam?: string;
}

interface RawGroup {
  group: string;
  modifiers: RawModifierDef[];
}

export interface RawModifierFile {
  file: string;
  data: RawGroup[];
  descriptions: Record<string, string>;
  sliders: unknown;
}

export interface ModifiersDocument {
  format: 'ps2cc.modifiers/1';
  files: RawModifierFile[];
}

/** A resolved target reference: index into TargetStore and the factor names its weight multiplies. */
interface TargetRef {
  target: number;
  factors: string[];
}

/** Macro variable a macro modifier controls, keyed by MakeHuman macrovar name. */
export const MACROVAR_TO_KEY: Record<string, keyof MacroValues> = {
  Gender: 'gender',
  Age: 'age',
  Muscle: 'muscle',
  Weight: 'weight',
  Height: 'height',
  BodyProportions: 'proportions',
  BreastSize: 'breastSize',
  BreastFirmness: 'breastFirmness',
  African: 'african',
  Asian: 'asian',
  Caucasian: 'caucasian',
};

export class Modifier {
  readonly fullName: string;
  readonly groupName: string;
  readonly name: string;
  readonly kind: ModifierKind;
  readonly defaultValue: number;
  readonly description: string;
  /** For macro/ethnic modifiers: the MacroValues key they control. */
  readonly macroKey: keyof MacroValues | null;
  /** Universal modifiers only: factor names of the left/center/right target groups. */
  readonly left: string | null;
  readonly right: string | null;
  readonly center: string | null;
  readonly targets: readonly TargetRef[];
  /** Symmetric partner (fullName) when the name has an l/r component. */
  readonly symmetricOpposite: string | null;
  readonly symmetrySide: 'l' | 'r' | null;
  /** Which source file it came from (modeling, bodyshapes, measurement). */
  readonly file: string;

  constructor(init: {
    groupName: string;
    name: string;
    kind: ModifierKind;
    defaultValue: number;
    description: string;
    macroKey: keyof MacroValues | null;
    left: string | null;
    right: string | null;
    center: string | null;
    targets: TargetRef[];
    file: string;
  }) {
    this.groupName = init.groupName;
    this.name = init.name;
    this.fullName = `${init.groupName}/${init.name}`;
    this.kind = init.kind;
    this.defaultValue = init.defaultValue;
    this.description = init.description;
    this.macroKey = init.macroKey;
    this.left = init.left;
    this.right = init.right;
    this.center = init.center;
    this.targets = init.targets;
    this.file = init.file;
    // Port of Modifier.getSymmetrySide / getSymmetricOpposite.
    const parts = this.name.split('-');
    if (parts.includes('l')) this.symmetrySide = 'l';
    else if (parts.includes('r')) this.symmetrySide = 'r';
    else this.symmetrySide = null;
    this.symmetricOpposite = this.symmetrySide
      ? `${this.groupName}/${parts.map((p) => (p === 'r' ? 'l' : p === 'l' ? 'r' : p)).join('-')}`
      : null;
  }

  get isMacro(): boolean {
    return this.kind !== 'universal';
  }

  get min(): number {
    return this.kind === 'universal' && this.left !== null ? -1 : 0;
  }

  get max(): number {
    return 1;
  }

  /** Port of clampValue (Universal: [-1,1] with a left side, else [0,1]). */
  clamp(value: number): number {
    if (!Number.isFinite(value)) return this.defaultValue;
    return Math.min(this.max, Math.max(this.min, value));
  }

  /**
   * Port of getFactors + getTargetWeights: write the weight of every target
   * this modifier controls into `out`.
   */
  writeWeights(value: number, factors: Record<string, number>, out: Map<number, number>): void {
    const v = this.clamp(value);
    let local: Record<string, number>;
    if (this.kind === 'universal') {
      local = { ...factors };
      if (this.left !== null) local[this.left] = -Math.min(v, 0.0);
      if (this.center !== null) local[this.center] = 1.0 - Math.abs(v);
      local[this.right!] = Math.max(0.0, v);
    } else {
      local = { ...factors, [this.groupName]: 1.0 };
    }
    for (const ref of this.targets) {
      let w = 1.0;
      for (const f of ref.factors) {
        const fv = local[f];
        if (fv === undefined) throw new Error(`modifier ${this.fullName}: no value for factor "${f}"`);
        w *= fv;
      }
      out.set(ref.target, w);
    }
  }
}

/** Every modifier in MakeHuman load order, plus lookup tables. */
export class ModifierSet {
  readonly list: readonly Modifier[];
  readonly byName: ReadonlyMap<string, Modifier>;
  readonly macros: readonly Modifier[];
  readonly universals: readonly Modifier[];
  readonly doc: ModifiersDocument;

  constructor(doc: ModifiersDocument, targets: TargetStore) {
    this.doc = doc;
    const list: Modifier[] = [];
    const byName = new Map<string, Modifier>();
    const findTargets = (groupPath: string | null): TargetRef[] => {
      if (groupPath === null) return [];
      const ids = targets.byGroup.get(groupPath) ?? [];
      // Port of ManagedTargetModifier.findTargets: factors = target vars + [target group].
      return ids.map((id) => {
        const e = targets.entries[id]!;
        return { target: id, factors: [...e.vars, e.group] };
      });
    };

    for (const file of doc.files) {
      for (const g of file.data) {
        const groupName = g.group.replace(/\//g, '-');
        for (const def of g.modifiers) {
          let m: Modifier;
          if (def.macrovar !== undefined) {
            const kind: ModifierKind = def.modifierType === 'EthnicModifier' ? 'ethnic' : 'macro';
            const key = MACROVAR_TO_KEY[def.macrovar];
            if (!key) throw new Error(`unknown macro variable ${def.macrovar}`);
            const name = def.macrovar.replace(/\//g, '-');
            m = new Modifier({
              groupName,
              name,
              kind,
              defaultValue: def.defaultValue ?? (kind === 'ethnic' ? 1 / 3 : 0.5),
              description: file.descriptions[`${groupName}/${name}`] ?? '',
              macroKey: key,
              left: null,
              right: null,
              center: null,
              targets: findTargets(groupName),
              file: file.file,
            });
          } else {
            if (!def.target) throw new Error(`modifier in group ${groupName} has no target`);
            // Port of UniversalModifier.__init__.
            const targetName = `${groupName}-${def.target}`;
            let left: string | null = null;
            let right: string;
            let center: string | null = null;
            let name: string;
            if (def.min && def.max) {
              left = `${targetName}-${def.min}`;
              right = `${targetName}-${def.max}`;
              if (def.mid) {
                center = `${targetName}-${def.mid}`;
                name = `${def.target}-${def.min}|${def.mid}|${def.max}`;
              } else {
                name = `${def.target}-${def.min}|${def.max}`;
              }
            } else {
              right = targetName;
              name = def.target;
            }
            name = name.replace(/\//g, '-');
            m = new Modifier({
              groupName,
              name,
              kind: 'universal',
              defaultValue: def.defaultValue ?? 0,
              description: file.descriptions[`${groupName}/${name}`] ?? '',
              macroKey: null,
              left,
              right,
              center,
              targets: [...findTargets(left), ...findTargets(right), ...findTargets(center)],
              file: file.file,
            });
          }
          if (byName.has(m.fullName)) throw new Error(`duplicate modifier ${m.fullName}`);
          list.push(m);
          byName.set(m.fullName, m);
        }
      }
    }
    this.list = list;
    this.byName = byName;
    this.macros = list.filter((m) => m.isMacro);
    this.universals = list.filter((m) => !m.isMacro);
  }

  static async load(source: AssetSource, targets: TargetStore): Promise<ModifierSet> {
    return new ModifierSet(await readJson<ModifiersDocument>(source, 'modifiers/modifiers.json'), targets);
  }

  get(fullName: string): Modifier {
    const m = this.byName.get(fullName);
    if (!m) throw new Error(`unknown modifier ${fullName}`);
    return m;
  }

  /**
   * Target weights for a character (equivalent of MakeHuman's
   * targetsDetailStack after applyAllTargets). Zero weights are omitted, as
   * Human.setDetail does.
   */
  computeWeights(macros: MacroValues, values: Readonly<Record<string, number>>): Map<number, number> {
    const factors = macroFactors(macros);
    const out = new Map<number, number>();
    for (const m of this.list) {
      const value = m.isMacro ? macros[m.macroKey!] : (values[m.fullName] ?? m.defaultValue);
      m.writeWeights(value, factors, out);
    }
    for (const [k, w] of out) if (w === 0) out.delete(k);
    return out;
  }

  /** Weights contributed by a single universal modifier (fast path for slider drags). */
  modifierWeights(m: Modifier, macros: MacroValues, value: number): Map<number, number> {
    const out = new Map<number, number>();
    m.writeWeights(value, macroFactors(macros), out);
    return out;
  }
}
