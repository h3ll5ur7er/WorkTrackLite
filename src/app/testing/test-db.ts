import { Provider } from '@angular/core';
import { APP_DB, AppDB, uid } from '../core/db';
import { Node, TimeEntry } from '../core/models';

/** A fresh, uniquely named database per test (fake-indexeddb). */
export function provideTestDb(): { db: AppDB; providers: Provider[] } {
  const db = new AppDB(`test-${uid()}`);
  return { db, providers: [{ provide: APP_DB, useValue: db }] };
}

export function makeNode(partial: Partial<Node> & { id: string }): Node {
  return {
    parentId: null,
    name: partial.id.toUpperCase(),
    kind: 'Item',
    order: 0,
    budget: { type: 'none', seconds: 0 },
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

export function makeEntry(partial: Partial<TimeEntry> & { id: string; nodeId: string; start: number }): TimeEntry {
  return { end: partial.start + 3_600_000, createdAt: 0, updatedAt: 0, ...partial };
}

/** Resolves once DataService has mirrored the DB and the condition holds. */
export async function waitFor(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error('waitFor: timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}
