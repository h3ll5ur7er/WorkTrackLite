import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { Observable, liveQuery } from 'dexie';
import { BackupData } from '../domain/backup';
import { TreeIndex, closedSubtreeSeconds, entriesByNode } from '../domain/tree';
import { WORKTRACK_DB, uid } from './db';
import { Budget, DEFAULT_SETTINGS, HierarchyTemplate, Node, Settings, TimeEntry } from './models';
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
export type EntryPatch = Partial<Pick<TimeEntry, 'nodeId' | 'start' | 'end' | 'note' | 'tags'>>;

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
  readonly db = inject(WORKTRACK_DB);
  private readonly destroyRef = inject(DestroyRef);

  readonly nodes = signal<Node[]>([]);
  readonly entries = signal<TimeEntry[]>([]);
  readonly templates = signal<HierarchyTemplate[]>([]);
  readonly settings = signal<Settings>(DEFAULT_SETTINGS);
  readonly ready = signal(false);
  readonly error = signal<string | null>(null);

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
    void this.bootstrap();
  }

  private async bootstrap(): Promise<void> {
    const destroyRef = this.destroyRef;
    try {
      await this.db.transaction('rw', this.db.templates, this.db.settings, async () => {
        if ((await this.db.templates.count()) === 0) await this.db.templates.bulkPut(BUILTIN_TEMPLATES);
        if (!(await this.db.settings.get('app'))) await this.db.settings.put(DEFAULT_SETTINGS);
      });
      await Promise.all([
        this.mirror(
          () => this.db.nodes.toArray(),
          (v) => this.nodes.set(v),
          destroyRef,
        ),
        this.mirror(
          () => this.db.entries.toArray(),
          (v) => this.entries.set(v),
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

  /** Swaps a node with its previous (-1) or next (+1) visible sibling. */
  async reorderNode(id: string, direction: -1 | 1): Promise<void> {
    await this.db.transaction('rw', this.db.nodes, async () => {
      const tree = new TreeIndex(await this.db.nodes.toArray());
      const node = tree.get(id);
      if (!node) return;
      const siblings = tree.childrenOf(node.parentId != null && tree.get(node.parentId) ? node.parentId : null, {
        includeArchived: true,
      });
      const idx = siblings.findIndex((s) => s.id === id);
      const target = idx + direction;
      if (idx < 0 || target < 0 || target >= siblings.length) return;
      [siblings[idx], siblings[target]] = [siblings[target], siblings[idx]];
      // Renumber so equal/legacy order values cannot make the swap a no-op.
      const now = Date.now();
      await Promise.all(siblings.map((s, i) => (s.order === i ? null : this.db.nodes.update(s.id, { order: i, updatedAt: now }))));
    });
  }

  async setArchived(id: string, archived: boolean): Promise<void> {
    await this.updateNode(id, { archived: archived || undefined });
  }

  /** Deletes a node, its descendants and all their entries. Returns what was removed (for undo). */
  async deleteNodeCascade(id: string): Promise<{ nodes: Node[]; entries: TimeEntry[] }> {
    return this.db.transaction('rw', this.db.nodes, this.db.entries, async () => {
      const ids = new TreeIndex(await this.db.nodes.toArray()).subtreeIds(id);
      const nodes = (await this.db.nodes.bulkGet(ids)).filter((n): n is Node => !!n);
      const entries = await this.db.entries.where('nodeId').anyOf(ids).toArray();
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

  /** Adds a closed entry. Rejects empty or inverted ranges. */
  async addEntry(input: { nodeId: string; start: number; end: number; note?: string; tags?: string[] }): Promise<string> {
    assertRange(input.start, input.end);
    const now = Date.now();
    const e: TimeEntry = { id: uid(), ...input, createdAt: now, updatedAt: now };
    await this.db.entries.add(e);
    return e.id;
  }

  async updateEntry(id: string, patch: EntryPatch): Promise<void> {
    await this.db.transaction('rw', this.db.entries, async () => {
      const cur = await this.db.entries.get(id);
      if (!cur) throw new Error('Entry no longer exists.');
      const next = { ...cur, ...patch };
      if (next.end != null) assertRange(next.start, next.end);
      await this.db.entries.put({ ...next, updatedAt: Date.now() });
    });
  }

  async deleteEntry(id: string): Promise<TimeEntry | undefined> {
    return this.db.transaction('rw', this.db.entries, async () => {
      const e = await this.db.entries.get(id);
      await this.db.entries.delete(id);
      return e;
    });
  }

  /** Re-inserts entries (used by undo). */
  async restoreEntries(entries: TimeEntry[]): Promise<void> {
    await this.db.entries.bulkPut(entries);
  }

  // --- Settings --------------------------------------------------------------

  /** Atomic read-modify-write so concurrent updates never drop each other's fields. */
  async updateSettings(patch: Partial<Omit<Settings, 'id'>>): Promise<void> {
    await this.db.transaction('rw', this.db.settings, async () => {
      const cur = (await this.db.settings.get('app')) ?? DEFAULT_SETTINGS;
      await this.db.settings.put({ ...DEFAULT_SETTINGS, ...cur, ...patch, id: 'app' });
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
