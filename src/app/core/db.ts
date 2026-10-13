import { InjectionToken } from '@angular/core';
import Dexie, { Table, Transaction } from 'dexie';
import { closeAllButNewest } from '../domain/entries';
import { HierarchyTemplate, Node, Settings, TimeEntry } from './models';

export const DB_NAME = 'worktracklite';

/**
 * IndexedDB schema. To change it:
 *  1. add a new `this.version(n)` block below (never edit an old one),
 *  2. put data fixes in its `.upgrade()` callback,
 *  3. bump BACKUP_FORMAT_VERSION in domain/backup.ts and teach
 *     `migrateBackup` how to lift older backups.
 *
 * Only index fields you query by. IndexedDB cannot index `null` or booleans,
 * so e.g. running entries (`end === null`) are found with a filter scan.
 */
export class WorkTrackDB extends Dexie {
  nodes!: Table<Node, string>;
  entries!: Table<TimeEntry, string>;
  templates!: Table<HierarchyTemplate, string>;
  settings!: Table<Settings, string>;

  constructor(name = DB_NAME) {
    super(name);
    this.version(1).stores({
      nodes: 'id, parentId, kind, order, archived, updatedAt',
      entries: 'id, nodeId, start, end, updatedAt',
      templates: 'id, name',
      settings: 'id',
    });
    this.version(2)
      .stores({
        nodes: 'id, parentId, updatedAt',
        entries: 'id, nodeId, start, updatedAt',
      })
      .upgrade(migrateToV2);
  }
}

/**
 * v2: rename the `per_hour` budget type to `target`, drop the persisted `view`
 * setting (now in the URL) and repair duplicate running timers left behind by
 * the old double-click race.
 */
async function migrateToV2(tx: Transaction): Promise<void> {
  await tx
    .table<Node>('nodes')
    .toCollection()
    .modify((n) => {
      if ((n.budget.type as string) === 'per_hour') n.budget.type = 'target';
    });
  await tx
    .table<Settings & { view?: unknown }>('settings')
    .toCollection()
    .modify((s) => {
      delete s.view;
    });
  const open = await tx
    .table<TimeEntry>('entries')
    .filter((e) => e.end == null)
    .toArray();
  for (const e of closeAllButNewest(open)) {
    await tx.table<TimeEntry>('entries').update(e.id, { end: e.end, updatedAt: Date.now() });
  }
}

/** The app-wide database. Tests provide a fresh, uniquely named instance. */
export const WORKTRACK_DB = new InjectionToken<WorkTrackDB>('WORKTRACK_DB', {
  providedIn: 'root',
  factory: () => new WorkTrackDB(),
});

export function uid(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  // Fallback for non-secure contexts (e.g. plain-http LAN hosting).
  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
