import { Injectable, computed, signal } from '@angular/core';
import { liveQuery, Subscription } from 'dexie';
import { db, uid } from '../data/db';
import { Budget, HierarchyTemplate, Node, Settings, TimeEntry } from '../data/models';
import { BUILTIN_TEMPLATES } from '../data/templates';

/**
 * DataService is the single source of truth for the UI. It mirrors IndexedDB
 * via Dexie's `liveQuery` into Angular signals so components can use
 * `nodes()`, `entries()`, `settings()` without manual subscriptions.
 */
@Injectable({ providedIn: 'root' })
export class DataService {
  readonly nodes = signal<Node[]>([]);
  readonly entries = signal<TimeEntry[]>([]);
  readonly templates = signal<HierarchyTemplate[]>([]);
  readonly settings = signal<Settings>({ id: 'app', theme: 'dark' });
  readonly ready = signal(false);

  /** Currently running entry (no end time), if any. */
  readonly runningEntry = computed(() => this.entries().find(e => e.end == null) ?? null);

  private subs: Subscription[] = [];

  constructor() {
    this.bootstrap();
  }

  private async bootstrap() {
    // Seed built-in templates and default settings on first run.
    const t = await db.templates.count();
    if (t === 0) await db.templates.bulkPut(BUILTIN_TEMPLATES);
    const s = await db.settings.get('app');
    if (!s) await db.settings.put({ id: 'app', theme: 'dark' });

    this.subs.push(liveQuery(() => db.nodes.toArray()).subscribe(v => this.nodes.set(v)));
    this.subs.push(liveQuery(() => db.entries.toArray()).subscribe(v => this.entries.set(v)));
    this.subs.push(liveQuery(() => db.templates.toArray()).subscribe(v => this.templates.set(v)));
    this.subs.push(liveQuery(() => db.settings.get('app')).subscribe(v => v && this.settings.set(v)));
    this.ready.set(true);
  }

  // --- Nodes ---

  async addNode(input: { name: string; kind: string; parentId: string | null; budget?: Budget; notes?: string; tags?: string[] }): Promise<string> {
    const siblings = input.parentId == null
      ? await db.nodes.filter(n => n.parentId == null).count()
      : await db.nodes.where('parentId').equals(input.parentId).count();
    const now = Date.now();
    const node: Node = {
      id: uid(),
      parentId: input.parentId,
      name: input.name.trim() || 'Untitled',
      kind: input.kind,
      notes: input.notes,
      tags: input.tags,
      order: siblings,
      budget: input.budget ?? { type: 'none', seconds: 0 },
      createdAt: now,
      updatedAt: now,
    };
    await db.nodes.put(node);
    return node.id;
  }

  async updateNode(id: string, patch: Partial<Omit<Node, 'id' | 'createdAt'>>): Promise<void> {
    await db.nodes.update(id, { ...patch, updatedAt: Date.now() });
  }

  async deleteNodeCascade(id: string): Promise<void> {
    // Find descendants from the live signal (synchronous & cheap).
    const all = this.nodes();
    const childrenByParent = new Map<string | null, Node[]>();
    for (const n of all) {
      const arr = childrenByParent.get(n.parentId) ?? [];
      arr.push(n);
      childrenByParent.set(n.parentId, arr);
    }
    const ids: string[] = [];
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      ids.push(cur);
      for (const k of childrenByParent.get(cur) ?? []) stack.push(k.id);
    }
    await db.transaction('rw', db.nodes, db.entries, async () => {
      await db.entries.where('nodeId').anyOf(ids).delete();
      await db.nodes.bulkDelete(ids);
    });
  }

  // --- Entries ---

  async addManualEntry(nodeId: string, start: number, end: number, note?: string): Promise<string> {
    if (end < start) [start, end] = [end, start];
    const now = Date.now();
    const e: TimeEntry = { id: uid(), nodeId, start, end, note, createdAt: now, updatedAt: now };
    await db.entries.put(e);
    return e.id;
  }

  async updateEntry(id: string, patch: Partial<Omit<TimeEntry, 'id' | 'createdAt'>>): Promise<void> {
    await db.entries.update(id, { ...patch, updatedAt: Date.now() });
  }

  async deleteEntry(id: string): Promise<void> {
    await db.entries.delete(id);
  }

  // --- Settings ---

  async updateSettings(patch: Partial<Settings>): Promise<void> {
    const cur = this.settings();
    await db.settings.put({ ...cur, ...patch, id: 'app' });
  }
}
