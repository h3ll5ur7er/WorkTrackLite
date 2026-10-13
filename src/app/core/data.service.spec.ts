import { TestBed } from '@angular/core/testing';
import Dexie from 'dexie';
import { createBackup } from '../domain/backup';
import { makeEntry, makeNode, provideTestDb, waitFor } from '../testing/test-db';
import { WorkTrackDB, uid } from './db';
import { DataService } from './data.service';
import { DEFAULT_SETTINGS } from './models';

describe('DataService', () => {
  let db: WorkTrackDB;
  let data: DataService;

  beforeEach(async () => {
    const t = provideTestDb();
    db = t.db;
    TestBed.configureTestingModule({ providers: t.providers });
    data = TestBed.inject(DataService);
    await waitFor(() => data.ready());
  });

  afterEach(async () => {
    TestBed.resetTestingModule();
    db.close();
    await db.delete();
  });

  it('seeds templates and default settings on first run', async () => {
    expect(data.templates().length).toBeGreaterThan(0);
    expect(data.settings()).toMatchObject(DEFAULT_SETTINGS);
  });

  it('appends new siblings at the end, even after deletions', async () => {
    const a = await data.addNode({ parentId: null, name: 'A', kind: 'K' });
    const b = await data.addNode({ parentId: null, name: 'B', kind: 'K' });
    await data.deleteNodeCascade(a);
    const c = await data.addNode({ parentId: null, name: 'C', kind: 'K' });
    const order = new Map((await db.nodes.toArray()).map((n) => [n.id, n.order]));
    expect(order.get(c)).toBeGreaterThan(order.get(b)!);
  });

  it('reorders siblings', async () => {
    const a = await data.addNode({ parentId: null, name: 'A', kind: 'K' });
    const b = await data.addNode({ parentId: null, name: 'B', kind: 'K' });
    await data.reorderNode(b, -1);
    await waitFor(() => data.tree().roots()[0]?.id === b);
    expect(
      data
        .tree()
        .roots()
        .map((n) => n.id),
    ).toEqual([b, a]);
  });

  it('moves nodes but refuses to create cycles', async () => {
    const a = await data.addNode({ parentId: null, name: 'A', kind: 'K' });
    const b = await data.addNode({ parentId: a, name: 'B', kind: 'K' });
    const c = await data.addNode({ parentId: null, name: 'C', kind: 'K' });
    await data.moveNode(c, b);
    expect((await db.nodes.get(c))?.parentId).toBe(b);
    await expect(data.moveNode(a, c)).rejects.toThrow(/own subtree/);
  });

  it('cascade delete removes descendants and entries, and can be undone', async () => {
    const a = await data.addNode({ parentId: null, name: 'A', kind: 'K' });
    const b = await data.addNode({ parentId: a, name: 'B', kind: 'K' });
    await data.addEntry({ nodeId: b, start: 0, end: 1000 });
    const removed = await data.deleteNodeCascade(a);
    expect(await db.nodes.count()).toBe(0);
    expect(await db.entries.count()).toBe(0);
    await data.restoreDeleted(removed);
    expect(await db.nodes.count()).toBe(2);
    expect(await db.entries.count()).toBe(1);
  });

  it('rejects empty or inverted entries', async () => {
    const a = await data.addNode({ parentId: null, name: 'A', kind: 'K' });
    await expect(data.addEntry({ nodeId: a, start: 10, end: 10 })).rejects.toThrow(/after start/);
    const id = await data.addEntry({ nodeId: a, start: 0, end: 10 });
    await expect(data.updateEntry(id, { end: -5 })).rejects.toThrow(/after start/);
  });

  it('regression: concurrent settings updates do not drop each other', async () => {
    await Promise.all([
      data.updateSettings({ theme: 'light' }),
      data.updateSettings({ lastNodeId: 'x' }),
      data.updateSettings({ weekStartsOn: 0 }),
    ]);
    expect(await db.settings.get('app')).toMatchObject({ theme: 'light', lastNodeId: 'x', weekStartsOn: 0 });
  });

  it('snapshot → replaceAll restores the same data', async () => {
    const a = await data.addNode({ parentId: null, name: 'A', kind: 'K', tags: ['t'] });
    await data.addEntry({ nodeId: a, start: 0, end: 1000, note: 'n' });
    const snap = await data.snapshot();
    await data.replaceAll({ nodes: [makeNode({ id: 'other' })], entries: [], templates: [], settings: DEFAULT_SETTINGS });
    expect(await db.nodes.count()).toBe(1);
    await data.replaceAll(snap);
    expect(await data.snapshot()).toEqual(snap);
    expect(createBackup(snap).nodes).toHaveLength(1);
  });

  it('derives subtree totals from closed entries', async () => {
    const a = await data.addNode({ parentId: null, name: 'A', kind: 'K' });
    const b = await data.addNode({ parentId: a, name: 'B', kind: 'K' });
    await data.addEntry({ nodeId: b, start: 0, end: 60_000 });
    await waitFor(() => data.closedSubtreeSeconds().get(a) === 60);
  });
});

describe('WorkTrackDB migration v1 → v2', () => {
  it('renames per_hour budgets, drops the view setting and closes duplicate running timers', async () => {
    const name = `migrate-${uid()}`;
    const v1 = new Dexie(name);
    v1.version(1).stores({
      nodes: 'id, parentId, kind, order, archived, updatedAt',
      entries: 'id, nodeId, start, end, updatedAt',
      templates: 'id, name',
      settings: 'id',
    });
    await v1.table('nodes').put(makeNode({ id: 'n', budget: { type: 'per_hour' as never, seconds: 3600 } }));
    await v1
      .table('entries')
      .bulkPut([
        makeEntry({ id: 'old', nodeId: 'n', start: 1000, end: null }),
        makeEntry({ id: 'new', nodeId: 'n', start: 2000, end: null }),
      ]);
    await v1.table('settings').put({ id: 'app', theme: 'dark', view: 'manage' });
    v1.close();

    const db = new WorkTrackDB(name);
    await db.open();
    expect((await db.nodes.get('n'))?.budget.type).toBe('target');
    expect(await db.settings.get('app')).not.toHaveProperty('view');
    expect((await db.entries.get('old'))?.end).toBe(2000);
    expect((await db.entries.get('new'))?.end).toBeNull();
    db.close();
    await db.delete();
  });
});
