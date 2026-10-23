import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { Observable, liveQuery } from 'dexie';
import { BackupData } from '../domain/backup';
import { planMerge, splitRanges } from '../domain/entry-edit';
import { LockedError, isLocked, lockEnd, lockProblem } from '../domain/lock';
import { pruneSkipped } from '../domain/recurring';
import { TreeIndex, closedSubtreeSeconds, entriesByNode, reorderSiblings } from '../domain/tree';
import { APP_DB, uid } from './db';
import { Absence, Budget, DEFAULT_SETTINGS, HierarchyTemplate, Node, RecurringRule, Settings, TimeEntry, WorkTime } from './models';
import { BUILTIN_TEMPLATES } from './templates';

export interface NewNode {
  name: string;
  kind: string;
  parentId: string | null;
  budget?: Budget;
  notes?: string;
  tags?: string[];
}

export type NodePatch = Partial<Omit<Node, 'id' | 'createdAt' | 'updatedAt' | 'parentId' | 'order'>>;
export type EntryPatch = Partial<Pick<TimeEntry, 'nodeId' | 'start' | 'end' | 'note' | 'tags' | 'billable'>>;
export type NewEntry = Pick<TimeEntry, 'nodeId' | 'start'> & { end: number } & Pick<TimeEntry, 'note' | 'tags' | 'billable'>;

/**
 * Single source of truth for the UI. Mirrors IndexedDB into signals via
 * Dexie's `liveQuery` (which also picks up writes from other tabs), and owns
 * every write so invariants live in one place.
 *
 * Derived, shared views (tree index, per-node aggregates) are computed here
 * once instead of in each component.
 */
@Injectable({ providedIn: 'root' })
export class DataService {
  readonly db = inject(APP_DB);
  private readonly destroyRef = inject(DestroyRef);

  readonly nodes = signal<Node[]>([]);
  readonly entries = signal<TimeEntry[]>([]);
  readonly templates = signal<HierarchyTemplate[]>([]);
  readonly settings = signal<Settings>(DEFAULT_SETTINGS);
  readonly ready = signal(false);
  readonly error = signal<string | null>(null);
  private readonly readyPromise: Promise<void>;
  private resolveReady!: () => void;

  /** Precomputed hierarchy (children, paths, subtrees). */
  readonly tree = computed(() => new TreeIndex(this.nodes()));
  readonly entriesByNode = computed(() => entriesByNode(this.entries()));
  /** Closed-entry seconds per node subtree; add live time via `liveSubtreeSeconds`. */
  readonly closedSubtreeSeconds = computed(() => closedSubtreeSeconds(this.tree(), this.entries()));
  /** The running entry, if any (the DB invariant guarantees at most one). */
  readonly runningEntry = computed(() => {
    let newest: TimeEntry | null = null;
    for (const e of this.entries()) if (e.end == null && (!newest || e.start > newest.start)) newest = e;
    return newest;
  });
  readonly activeTemplate = computed(() => this.templates().find((t) => t.id === this.settings().templateId));

  constructor() {
    this.readyPromise = new Promise((r) => (this.resolveReady = r));
    void this.bootstrap();
  }

  /** Resolves once the signals mirror the database (for code that runs before the UI). */
  whenReady(): Promise<void> {
    return this.readyPromise;
  }

  private async bootstrap(): Promise<void> {
    const destroyRef = this.destroyRef;
    try {
      await this.db.transaction('rw', this.db.templates, this.db.settings, async () => {
        if ((await this.db.templates.count()) === 0) await this.db.templates.bulkPut(BUILTIN_TEMPLATES);
        if (!(await this.db.settings.get('app'))) await this.db.settings.put(DEFAULT_SETTINGS);
      });
      await Promise.all([
        // Nodes and entries in one read transaction, set together: derived views (budgets,
        // alerts, reports) never see a write half applied, e.g. a restore's nodes without its entries.
        this.mirror(
          () =>
            this.db.transaction('r', this.db.nodes, this.db.entries, async () => ({
              nodes: await this.db.nodes.toArray(),
              entries: await this.db.entries.toArray(),
            })),
          (v) => {
            this.nodes.set(v.nodes);
            this.entries.set(v.entries);
          },
          destroyRef,
        ),
        this.mirror(
          () => this.db.templates.toArray(),
          (v) => this.templates.set(v),
          destroyRef,
        ),
        this.mirror(
          () => this.db.settings.get('app'),
          (v) => this.settings.set({ ...DEFAULT_SETTINGS, ...v }),
          destroyRef,
        ),
      ]);
      this.ready.set(true);
      this.resolveReady();
    } catch (e) {
      console.error(e);
      this.error.set(
        'Could not open the local database. Private browsing or disabled site storage can cause this. ' +
          (e instanceof Error ? e.message : String(e)),
      );
    }
  }

  /** Subscribes a live query to a setter; resolves after the first value. */
  private mirror<T>(query: () => T | Promise<T>, set: (v: T) => void, destroyRef: DestroyRef): Promise<void> {
    return new Promise((resolve, reject) => {
      const obs: Observable<T> = liveQuery(query);
      const sub = obs.subscribe({
        next: (v) => {
          set(v);
          resolve();
        },
        error: (e) => {
          this.error.set(String(e));
          reject(e);
        },
      });
      destroyRef.onDestroy(() => sub.unsubscribe());
    });
  }

  // --- Nodes ---------------------------------------------------------------

  async addNode(input: NewNode): Promise<string> {
    const now = Date.now();
    const id = uid();
    await this.db.transaction('rw', this.db.nodes, async () => {
      const node: Node = {
        id,
        parentId: input.parentId,
        name: input.name.trim() || 'Untitled',
        kind: input.kind.trim() || 'Item',
        notes: input.notes,
        tags: input.tags,
        order: await this.nextOrder(input.parentId),
        budget: input.budget ?? { type: 'none', seconds: 0 },
        createdAt: now,
        updatedAt: now,
      };
      await this.db.nodes.add(node);
    });
    return id;
  }

  async updateNode(id: string, patch: NodePatch): Promise<void> {
    await this.db.nodes.update(id, { ...patch, updatedAt: Date.now() });
  }

  /** Moves a node under a new parent (appended last). Refuses to create cycles. */
  async moveNode(id: string, newParentId: string | null): Promise<void> {
    await this.db.transaction('rw', this.db.nodes, async () => {
      const all = await this.db.nodes.toArray();
      const tree = new TreeIndex(all);
      if (newParentId != null && tree.subtreeIds(id).includes(newParentId)) {
        throw new Error('A node cannot be moved into its own subtree.');
      }
      if (newParentId != null && !tree.get(newParentId)) throw new Error('Target parent does not exist.');
      await this.db.nodes.update(id, {
        parentId: newParentId,
        order: await this.nextOrder(newParentId),
        updatedAt: Date.now(),
      });
    });
  }

  /** Moves a node one visible step up (-1) or down (+1) among its siblings. */
  async reorderNode(id: string, direction: -1 | 1): Promise<void> {
    await this.db.transaction('rw', this.db.nodes, async () => {
      const tree = new TreeIndex(await this.db.nodes.toArray());
      const node = tree.get(id);
      if (!node) return;
      const siblings = tree.childrenOf(tree.get(node.parentId) ? node.parentId : null, { includeArchived: true });
      const reordered = reorderSiblings(siblings, id, direction);
      if (!reordered) return;
      // Renumber everything so equal/legacy order values cannot make the move a no-op.
      const now = Date.now();
      await Promise.all(reordered.map((s, i) => (s.order === i ? null : this.db.nodes.update(s.id, { order: i, updatedAt: now }))));
    });
  }

  async setArchived(id: string, archived: boolean): Promise<void> {
    await this.updateNode(id, { archived: archived || undefined });
  }

  /** Deletes a node, its descendants and all their entries. Returns what was removed (for undo). */
  async deleteNodeCascade(id: string): Promise<{ nodes: Node[]; entries: TimeEntry[] }> {
    return this.db.transaction('rw', this.db.nodes, this.db.entries, this.db.settings, async () => {
      const ids = new TreeIndex(await this.db.nodes.toArray()).subtreeIds(id);
      const nodes = (await this.db.nodes.bulkGet(ids)).filter((n): n is Node => !!n);
      const entries = await this.db.entries.where('nodeId').anyOf(ids).toArray();
      const until = (await this.db.settings.get('app'))?.lockedUntil;
      if (until && entries.some((e) => isLocked(e.start, lockEnd(until)))) {
        throw new Error(`${new LockedError(until).message} Archive the node instead to hide it.`);
      }
      await this.db.entries.bulkDelete(entries.map((e) => e.id));
      await this.db.nodes.bulkDelete(ids);
      return { nodes, entries };
    });
  }

  /** Re-inserts nodes and entries removed by `deleteNodeCascade`. */
  async restoreDeleted(removed: { nodes: Node[]; entries: TimeEntry[] }): Promise<void> {
    await this.db.transaction('rw', this.db.nodes, this.db.entries, async () => {
      await this.db.nodes.bulkPut(removed.nodes);
      await this.db.entries.bulkPut(removed.entries);
    });
  }

  private async nextOrder(parentId: string | null): Promise<number> {
    const siblings =
      parentId == null
        ? await this.db.nodes.filter((n) => n.parentId == null).toArray()
        : await this.db.nodes.where('parentId').equals(parentId).toArray();
    return siblings.reduce((max, s) => Math.max(max, s.order + 1), 0);
  }

  // --- Entries ---------------------------------------------------------------
  //
  // Every entry write runs in one transaction with the settings table and refuses
  // to touch a locked period (Settings.lockedUntil, see domain/lock.ts): neither
  // the old nor the new version of an entry may start inside it.

  /** Adds a closed entry. Rejects empty or inverted ranges. */
  async addEntry(input: NewEntry): Promise<string> {
    assertRange(input.start, input.end);
    const now = Date.now();
    const e: TimeEntry = { id: uid(), ...input, createdAt: now, updatedAt: now };
    await this.entryTx(async (guard) => {
      guard(e);
      await this.db.entries.add(e);
    });
    return e.id;
  }

  async updateEntry(id: string, patch: EntryPatch): Promise<void> {
    await this.entryTx(async (guard) => {
      const cur = await this.db.entries.get(id);
      if (!cur) throw new Error('Entry no longer exists.');
      const next = { ...cur, ...patch };
      if (next.end != null) assertRange(next.start, next.end);
      guard(cur, next);
      await this.db.entries.put({ ...next, updatedAt: Date.now() });
    });
  }

  async deleteEntry(id: string): Promise<TimeEntry | undefined> {
    return this.entryTx(async (guard) => {
      const e = await this.db.entries.get(id);
      if (e) guard(e);
      await this.db.entries.delete(id);
      return e;
    });
  }

  /** Re-inserts entries (used by undo). */
  async restoreEntries(entries: TimeEntry[]): Promise<void> {
    await this.entryTx(async (guard) => {
      guard(...entries, ...(await this.db.entries.bulkGet(entries.map((e) => e.id))).filter((e): e is TimeEntry => !!e));
      await this.db.entries.bulkPut(entries);
    });
  }

  /** Undo for split/merge: puts the old versions back and removes entries that were created. */
  async revertEntries(restore: TimeEntry[], removeIds: string[]): Promise<void> {
    await this.entryTx(async (guard) => {
      guard(...restore, ...(await this.db.entries.bulkGet(removeIds)).filter((e): e is TimeEntry => !!e));
      await this.db.entries.bulkDelete(removeIds);
      await this.db.entries.bulkPut(restore);
    });
  }

  /** Splits a closed entry at `at`. Returns the original (for undo) and the id of the second half. */
  async splitEntry(id: string, at: number): Promise<{ original: TimeEntry; newId: string }> {
    return this.entryTx(async (guard) => {
      const original = await this.db.entries.get(id);
      if (!original) throw new Error('Entry no longer exists.');
      const parts = splitRanges(original, at);
      if (!parts) throw new Error('Pick a time inside the entry.');
      guard(original);
      const now = Date.now();
      const newId = uid();
      await this.db.entries.bulkPut([
        { ...parts.first, updatedAt: now },
        { ...parts.second, id: newId, createdAt: now, updatedAt: now },
      ]);
      return { original, newId };
    });
  }

  /** Merges entries into the earliest one (see `planMerge`). Returns the originals for undo. */
  async mergeEntries(ids: string[]): Promise<{ originals: TimeEntry[]; mergedId: string; gapMs: number }> {
    return this.entryTx(async (guard) => {
      const originals = await this.existingEntries(ids);
      const plan = planMerge(originals);
      if ('error' in plan) throw new Error(plan.error);
      guard(...originals);
      await this.db.entries.bulkDelete(plan.removeIds);
      await this.db.entries.put({ ...plan.merged, updatedAt: Date.now() });
      return { originals, mergedId: plan.merged.id, gapMs: plan.gapMs };
    });
  }

  /** Applies a change to several closed entries at once. Returns the previous versions for undo. */
  async updateEntries(ids: string[], change: (e: TimeEntry) => EntryPatch): Promise<TimeEntry[]> {
    return this.entryTx(async (guard) => {
      const originals = await this.existingEntries(ids);
      if (originals.some((e) => e.end == null)) throw new Error('A running timer cannot be edited together with other entries.');
      const now = Date.now();
      const next = originals.map((e) => ({ ...e, ...change(e), updatedAt: now }));
      for (const e of next) assertRange(e.start, e.end!);
      guard(...originals, ...next);
      await this.db.entries.bulkPut(next);
      return originals;
    });
  }

  /** Adds several closed entries in one transaction (all or nothing). Returns their ids. */
  async addEntries(inputs: NewEntry[]): Promise<string[]> {
    for (const e of inputs) assertRange(e.start, e.end);
    const now = Date.now();
    const rows: TimeEntry[] = inputs.map((e) => ({ id: uid(), ...e, createdAt: now, updatedAt: now }));
    await this.entryTx(async (guard) => {
      guard(...rows);
      await this.db.entries.bulkAdd(rows);
    });
    return rows.map((e) => e.id);
  }

  async deleteEntries(ids: string[]): Promise<TimeEntry[]> {
    return this.entryTx(async (guard) => {
      const originals = await this.existingEntries(ids);
      guard(...originals);
      await this.db.entries.bulkDelete(originals.map((e) => e.id));
      return originals;
    });
  }

  private async existingEntries(ids: string[]): Promise<TimeEntry[]> {
    const found = await this.db.entries.bulkGet(ids);
    if (found.some((e) => !e)) throw new Error('Some entries no longer exist.');
    return found as TimeEntry[];
  }

  /**
   * Runs `body` in a read-write transaction over entries and settings. `guard`
   * throws a LockedError if any given entry starts inside the locked period,
   * which aborts the whole transaction.
   */
  private entryTx<T>(body: (guard: (...entries: Pick<TimeEntry, 'start'>[]) => void) => Promise<T>): Promise<T> {
    return this.db.transaction('rw', this.db.entries, this.db.settings, async () => {
      const until = (await this.db.settings.get('app'))?.lockedUntil;
      const end = lockEnd(until);
      return body((...entries) => {
        if (until && entries.some((e) => isLocked(e.start, end))) throw new LockedError(until);
      });
    });
  }

  /** Locks every entry that starts on or before `lockedUntil` (yyyy-mm-dd); `undefined` unlocks. */
  async setLockedUntil(lockedUntil: string | undefined, now = Date.now()): Promise<string | undefined> {
    return this.db.transaction('rw', this.db.entries, this.db.settings, async () => {
      if (lockedUntil) {
        const open = await this.db.entries.filter((e) => e.end == null).toArray();
        const running = open.sort((a, b) => b.start - a.start)[0] ?? null;
        const problem = lockProblem(lockedUntil, now, running);
        if (problem) throw new Error(problem);
      }
      const cur = { ...DEFAULT_SETTINGS, ...(await this.db.settings.get('app')) };
      await this.db.settings.put({ ...cur, lockedUntil, id: 'app' });
      return cur.lockedUntil;
    });
  }

  // --- Settings --------------------------------------------------------------

  /** Atomic read-modify-write so concurrent updates never drop each other's fields. */
  async updateSettings(patch: Partial<Omit<Settings, 'id'>>): Promise<void> {
    await this.db.transaction('rw', this.db.settings, async () => {
      const cur = (await this.db.settings.get('app')) ?? DEFAULT_SETTINGS;
      await this.db.settings.put({ ...DEFAULT_SETTINGS, ...cur, ...patch, id: 'app' });
    });
  }

  /** Sets (or with `undefined` clears) one tag's colour, atomically. */
  async setTagColor(tag: string, color: string | undefined): Promise<void> {
    await this.db.transaction('rw', this.db.settings, async () => {
      const cur = { ...DEFAULT_SETTINGS, ...(await this.db.settings.get('app')) };
      const tagColors = { ...(cur.tagColors ?? {}) };
      if (color) tagColors[tag] = color;
      else delete tagColors[tag];
      await this.db.settings.put({ ...cur, tagColors, id: 'app' });
    });
  }

  /** Adds or replaces a recurring rule. Returns the previous list for undo. */
  async saveRecurring(rule: RecurringRule): Promise<RecurringRule[]> {
    return this.settingsTx((cur) => {
      const list = cur.recurring ?? [];
      const i = list.findIndex((r) => r.id === rule.id);
      const recurring = i < 0 ? [...list, rule] : list.map((r) => (r.id === rule.id ? rule : r));
      return [{ recurring }, list];
    });
  }

  async deleteRecurring(id: string): Promise<RecurringRule[]> {
    return this.settingsTx((cur) => {
      const list = cur.recurring ?? [];
      const recurring = list.filter((r) => r.id !== id);
      return [{ recurring: recurring.length ? recurring : undefined }, list];
    });
  }

  /** Remembers that a suggestion was skipped (keys older than 90 days are dropped). */
  async skipSuggestions(keys: string[], now = Date.now()): Promise<string[]> {
    return this.settingsTx((cur) => {
      const before = cur.recurringSkipped ?? [];
      return [{ recurringSkipped: pruneSkipped([...new Set([...before, ...keys])], now) }, before];
    });
  }

  /** Read-modify-write of settings in one transaction; `change` returns the patch and a result. */
  private settingsTx<R>(change: (cur: Settings) => [Partial<Settings>, R]): Promise<R> {
    return this.db.transaction('rw', this.db.settings, async () => {
      const cur = { ...DEFAULT_SETTINGS, ...(await this.db.settings.get('app')) };
      const [patch, result] = change(cur);
      await this.db.settings.put({ ...cur, ...patch, id: 'app' });
      return result;
    });
  }

  /** Merges into the working-time settings (`null` turns them off). Returns the previous value for undo. */
  async updateWorkTime(patch: Partial<WorkTime> | null, base: WorkTime): Promise<WorkTime | undefined> {
    return this.db.transaction('rw', this.db.settings, async () => {
      const cur = { ...DEFAULT_SETTINGS, ...(await this.db.settings.get('app')) };
      const before = cur.workTime;
      const workTime = patch === null ? undefined : { ...(before ?? base), ...patch };
      await this.db.settings.put({ ...cur, workTime, id: 'app' });
      return before;
    });
  }

  /**
   * Adds absences (replacing any on the same days) and removes the given days,
   * atomically. Returns the previous list for undo.
   */
  async changeAbsences(add: Absence[], removeDates: string[] = []): Promise<Absence[]> {
    return this.db.transaction('rw', this.db.settings, async () => {
      const cur = { ...DEFAULT_SETTINGS, ...(await this.db.settings.get('app')) };
      const before = cur.absences ?? [];
      const drop = new Set([...removeDates, ...add.map((a) => a.date)]);
      const absences = [...before.filter((a) => !drop.has(a.date)), ...add].sort((x, y) => x.date.localeCompare(y.date));
      await this.db.settings.put({ ...cur, absences: absences.length ? absences : undefined, id: 'app' });
      return before;
    });
  }

  // --- Backup ----------------------------------------------------------------

  async snapshot(): Promise<BackupData> {
    return this.db.transaction('r', [this.db.nodes, this.db.entries, this.db.templates, this.db.settings], async () => ({
      nodes: await this.db.nodes.toArray(),
      entries: await this.db.entries.toArray(),
      templates: await this.db.templates.toArray(),
      settings: { ...DEFAULT_SETTINGS, ...(await this.db.settings.get('app')) },
    }));
  }

  /** Replaces all data with a validated backup in one transaction. */
  async replaceAll(data: BackupData): Promise<void> {
    await this.db.transaction('rw', [this.db.nodes, this.db.entries, this.db.templates, this.db.settings], async () => {
      await Promise.all([this.db.nodes.clear(), this.db.entries.clear(), this.db.templates.clear(), this.db.settings.clear()]);
      await this.db.nodes.bulkAdd(data.nodes);
      await this.db.entries.bulkAdd(data.entries);
      await this.db.templates.bulkPut(data.templates.length ? data.templates : BUILTIN_TEMPLATES);
      await this.db.settings.put({ ...data.settings, id: 'app' });
    });
  }
}

function assertRange(start: number, end: number): void {
  if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error('Start and end must be valid times.');
  if (end <= start) throw new Error('End must be after start.');
}
