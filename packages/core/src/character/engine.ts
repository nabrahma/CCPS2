/**
 * CharacterEngine: the single place character maths lives (PRD 4). The UI,
 * viewport and exporters read from it; nothing else mutates geometry.
 */
import type { CoreAssets } from '../assets';
import { computeQuadNormals } from '../mesh/normals';
import { normaliseEthnic, setEthnic, type EthnicKey, type MacroValues } from '../morph/macros';
import { MACROVAR_TO_KEY } from '../morph/modifiers';
import { Morpher } from '../morph/morpher';
import { fitSkeleton, type FittedSkeleton } from '../skeleton/rig';
import { UndoStack } from '../undo';
import { cloneCharacter, defaultCharacter, type CharacterDoc } from './doc';
import { ADULT_MIN_AGE } from './sliders';
import { completeStyle } from '../hair/style';

export type ChangeKind = 'geometry' | 'doc' | 'history';
export type ChangeListener = (kind: ChangeKind) => void;

export interface EditOptions {
  /** Consecutive edits with the same key merge into one undo step (slider drags). */
  mergeKey?: string;
  /** Mirror to the symmetric modifier (default true). */
  symmetry?: boolean;
}

export class CharacterEngine {
  private _doc: CharacterDoc;
  private readonly morpher: Morpher;
  private readonly listeners = new Set<ChangeListener>();
  private _geometryVersion = 0;
  private _interacting = false;
  private normalsVersion = -1;
  private readonly _normals: Float32Array;
  private skeletonCache: { version: number; skeleton: FittedSkeleton } | null = null;
  readonly history = new UndoStack<CharacterDoc>(cloneCharacter, 500);
  /** Duration of the last morph update in ms (performance logging, PRD F1). */
  lastUpdateMs = 0;

  constructor(
    readonly assets: CoreAssets,
    doc: CharacterDoc = defaultCharacter(),
  ) {
    this._doc = sanitise(cloneCharacter(doc));
    this.morpher = new Morpher(assets.base, assets.targets);
    this._normals = new Float32Array(assets.base.vertexCount * 3);
    this.morpher.rebuild(this.weights());
    this._geometryVersion++;
  }

  // ---------------------------------------------------------------- reading

  get doc(): Readonly<CharacterDoc> {
    return this._doc;
  }

  /** Morphed hm08 positions (metres). Do not modify. */
  get positions(): Float32Array {
    return this.morpher.positions;
  }

  get geometryVersion(): number {
    return this._geometryVersion;
  }

  /**
   * True while a drag is in progress: the last geometry change came from a
   * merged edit and endInteraction() has not been called yet. Expensive
   * derived data (garment collision anchors) waits until this is false.
   */
  get interacting(): boolean {
    return this._interacting;
  }

  /** Vertex normals of the morphed hm08 mesh (recomputed lazily). */
  get normals(): Float32Array {
    if (this.normalsVersion !== this._geometryVersion) {
      const b = this.assets.base;
      computeQuadNormals(this.positions, b.faceVerts, b.vertexCount, this._normals);
      this.normalsVersion = this._geometryVersion;
    }
    return this._normals;
  }

  /** GameEngine skeleton fitted to the current body (cached per geometry version). */
  get skeleton(): FittedSkeleton {
    if (!this.skeletonCache || this.skeletonCache.version !== this._geometryVersion) {
      this.skeletonCache = { version: this._geometryVersion, skeleton: fitSkeleton(this.assets.rig, this.positions) };
    }
    return this.skeletonCache.skeleton;
  }

  get currentWeights(): ReadonlyMap<number, number> {
    return this.morpher.currentWeights;
  }

  /** Current value of a slider (macro or modifier fullName). */
  value(id: string): number {
    const macroKey = macroKeyOf(id);
    if (macroKey) return this._doc.macros[macroKey];
    const m = this.assets.modifiers.byName.get(id);
    return this._doc.modifiers[id] ?? m?.defaultValue ?? 0;
  }

  /** Character height in metres (body vertices only), like MakeHuman's getHeightCm. */
  heightMetres(): number {
    const p = this.positions;
    let lo = Infinity;
    let hi = -Infinity;
    for (let v = 0; v < this.assets.base.bodyVertexCount; v++) {
      const y = p[v * 3 + 1]!;
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
    return hi - lo;
  }

  onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ---------------------------------------------------------------- editing

  /** Set a slider by id (macro or modifier fullName). */
  setValue(id: string, value: number, opts: EditOptions = {}): void {
    const before = this._doc;
    const next = cloneCharacter(before);
    const macroKey = macroKeyOf(id);
    if (macroKey) {
      if (macroKey === 'african' || macroKey === 'asian' || macroKey === 'caucasian') {
        next.macros = setEthnic(next.macros, macroKey as EthnicKey, value);
      } else {
        next.macros[macroKey] = clamp(value, macroKey === 'age' ? ADULT_MIN_AGE : 0, 1);
      }
    } else {
      const m = this.assets.modifiers.get(id);
      const v = m.clamp(value);
      setOrDelete(next.modifiers, id, v, m.defaultValue);
      if (opts.symmetry !== false && m.symmetricOpposite && this.assets.modifiers.byName.has(m.symmetricOpposite)) {
        setOrDelete(next.modifiers, m.symmetricOpposite, v, m.defaultValue);
      }
    }
    this.commit(next, `Change ${id}`, opts.mergeKey);
  }

  resetValue(id: string, opts: EditOptions = {}): void {
    const macroKey = macroKeyOf(id);
    if (macroKey) {
      const def = this.assets.modifiers.get(id).defaultValue;
      if (macroKey === 'african' || macroKey === 'asian' || macroKey === 'caucasian') {
        // Port of EthnicModifier.resetValue: resetting one resets all three.
        const next = cloneCharacter(this._doc);
        next.macros.african = next.macros.asian = next.macros.caucasian = 1 / 3;
        this.commit(next, 'Reset ethnicity');
        return;
      }
      this.setValue(id, def, opts);
      return;
    }
    const m = this.assets.modifiers.get(id);
    this.setValue(id, m.defaultValue, opts);
  }

  /** Replace the whole document (load, preset, randomize). One undo step. */
  replaceDoc(doc: CharacterDoc, label = 'Replace character'): void {
    this.commit(sanitise(cloneCharacter(doc)), label);
  }

  /** Apply an arbitrary document edit as one undo step. */
  update(label: string, fn: (draft: CharacterDoc) => void, mergeKey?: string): void {
    const next = cloneCharacter(this._doc);
    fn(next);
    this.commit(sanitise(next), label, mergeKey);
  }

  /** Load a document without recording history (open file, new character). */
  load(doc: CharacterDoc): void {
    this._doc = sanitise(cloneCharacter(doc));
    this._interacting = false;
    this.history.clear();
    this.morpher.rebuild(this.weights());
    this._geometryVersion++;
    this.emit('geometry');
    this.emit('doc');
    this.emit('history');
  }

  /** End of an interactive drag: seal the undo step and recompute exactly. */
  endInteraction(): void {
    this.history.seal();
    this._interacting = false;
    this.morpher.rebuild(this.weights());
    this._geometryVersion++;
    this.emit('geometry');
  }

  /**
   * Temporarily show another document's body shape (A/B compare, PRD 7)
   * without touching the current document or the undo history.
   * Pass null to return to the current document.
   */
  preview(doc: Readonly<CharacterDoc> | null): void {
    const target = doc ? sanitise(cloneCharacter(doc as CharacterDoc)) : this._doc;
    this._interacting = false;
    this.morpher.rebuild(this.weights(target));
    this._geometryVersion++;
    this.emit('geometry');
  }

  undo(): boolean {
    const prev = this.history.undo(this._doc);
    if (!prev) return false;
    this.apply(prev);
    this.emit('history');
    return true;
  }

  redo(): boolean {
    const next = this.history.redo(this._doc);
    if (!next) return false;
    this.apply(next);
    this.emit('history');
    return true;
  }

  // ---------------------------------------------------------------- internals

  private weights(doc: CharacterDoc = this._doc): Map<number, number> {
    return this.assets.modifiers.computeWeights(doc.macros, doc.modifiers);
  }

  private commit(next: CharacterDoc, label: string, mergeKey?: string): void {
    this.history.push(this._doc, label, mergeKey);
    this.apply(next, mergeKey !== undefined);
    this.emit('history');
  }

  private apply(next: CharacterDoc, dragging = false): void {
    const geometryChanged =
      JSON.stringify(next.macros) !== JSON.stringify(this._doc.macros) ||
      JSON.stringify(next.modifiers) !== JSON.stringify(this._doc.modifiers);
    this._doc = next;
    if (geometryChanged) {
      this._interacting = dragging;
      const t0 = now();
      this.morpher.setWeights(this.weights());
      this.lastUpdateMs = now() - t0;
      this._geometryVersion++;
      this.emit('geometry');
    }
    this.emit('doc');
  }

  private emit(kind: ChangeKind): void {
    for (const l of this.listeners) l(kind);
  }
}

function macroKeyOf(id: string): keyof MacroValues | null {
  const [group, name] = id.split('/');
  if (!name || !group) return null;
  if (!group.startsWith('macrodetails') && group !== 'breast') return null;
  return MACROVAR_TO_KEY[name] ?? null;
}

function clamp(v: number, lo: number, hi: number): number {
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;
}

function setOrDelete(map: Record<string, number>, key: string, v: number, def: number): void {
  if (Math.abs(v - def) < 1e-9) delete map[key];
  else map[key] = v;
}

/** Enforce product rules on any document entering the engine. */
function sanitise(doc: CharacterDoc): CharacterDoc {
  doc.macros.age = Math.max(doc.macros.age, ADULT_MIN_AGE); // all characters are adults (PRD F1)
  normaliseEthnic(doc.macros);
  // A card style from before the groom existed (or set by hand) gets the settings it lacks.
  if (doc.hair.mode === 'cards' && doc.hair.style) doc.hair.style = completeStyle(doc.hair.style);
  return doc;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());
