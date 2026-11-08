/**
 * Snapshot-based undo/redo (PRD F1: >= 200 steps; a slider drag is one step).
 *
 * Character documents are small (a few KB), so storing whole snapshots is the
 * simplest correct approach. `mergeKey` lets consecutive edits of the same
 * slider collapse into one step while a drag is in progress.
 */
export class UndoStack<T> {
  private past: { state: T; label: string }[] = [];
  private future: { state: T; label: string }[] = [];
  private mergeKey: string | null = null;

  constructor(
    private readonly clone: (v: T) => T,
    readonly limit = 500,
  ) {}

  /** Record `before` as the state to return to, unless merging into the current step. */
  push(before: T, label: string, mergeKey?: string): void {
    if (mergeKey && mergeKey === this.mergeKey) {
      this.future = [];
      return;
    }
    this.past.push({ state: this.clone(before), label });
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    this.mergeKey = mergeKey ?? null;
  }

  /** End the current merge group (call on slider release). */
  seal(): void {
    this.mergeKey = null;
  }

  undo(current: T): T | null {
    const prev = this.past.pop();
    if (!prev) return null;
    this.future.push({ state: this.clone(current), label: prev.label });
    this.mergeKey = null;
    return prev.state;
  }

  redo(current: T): T | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push({ state: this.clone(current), label: next.label });
    this.mergeKey = null;
    return next.state;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  get undoLabel(): string | null {
    return this.past.at(-1)?.label ?? null;
  }

  get redoLabel(): string | null {
    return this.future.at(-1)?.label ?? null;
  }

  clear(): void {
    this.past = [];
    this.future = [];
    this.mergeKey = null;
  }
}
