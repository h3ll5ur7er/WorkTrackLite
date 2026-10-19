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

  it('regression: moving up jumps over a hidden archived sibling', async () => {
    const a = await data.addNode({ parentId: null, name: 'A', kind: 'K' });
    const b = await data.addNode({ parentId: null, name: 'B', kind: 'K' });
    const c = await data.addNode({ parentId: null, name: 'C', kind: 'K' });
    await data.setArchived(b, true);
    await data.reorderNode(c, -1);
    await waitFor(() => data.tree().roots()[0]?.id === c);
    expect(
      data
        .tree()
        .roots()
        .map((n) => n.id),
    ).toEqual([c, a]);
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

  it('tag colours: concurrent edits all land, and undefined removes one', async () => {
    await Promise.all([data.setTagColor('a', '#ef4444'), data.setTagColor('b', '#22c55e'), data.setTagColor('c', '#3b82f6')]);
    await data.setTagColor('b', undefined);
    expect((await db.settings.get('app'))?.tagColors).toEqual({ a: '#ef4444', c: '#3b82f6' });
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

  describe('split, merge and bulk edits', () => {
    const H = 3_600_000;
    const T = new Date(2026, 9, 20, 9).getTime();

    it('splits an entry and undoes the split', async () => {
      await db.entries.add(makeEntry({ id: 'e', nodeId: 'n', start: T, end: T + 2 * H, note: 'x', billable: false }));
      const { original, newId } = await data.splitEntry('e', T + H / 2);
      const [first, second] = [await db.entries.get('e'), await db.entries.get(newId)];
      expect([first!.start, first!.end]).toEqual([T, T + H / 2]);
      expect(second).toMatchObject({ nodeId: 'n', start: T + H / 2, end: T + 2 * H, note: 'x', billable: false });

      await data.revertEntries([original], [newId]);
      expect(await db.entries.toArray()).toEqual([original]);
    });

    it('refuses to split outside the entry or a running timer', async () => {
      await db.entries.bulkAdd([makeEntry({ id: 'e', nodeId: 'n', start: T }), makeEntry({ id: 'r', nodeId: 'n', start: T, end: null })]);
      await expect(data.splitEntry('e', T)).rejects.toThrow('inside');
      await expect(data.splitEntry('r', T + H)).rejects.toThrow('inside');
      expect(await db.entries.count()).toBe(2);
    });

    it('merges entries and undoes the merge', async () => {
      const a = makeEntry({ id: 'a', nodeId: 'n', start: T, end: T + H });
      const b = makeEntry({ id: 'b', nodeId: 'n', start: T + H, end: T + 2 * H });
      await db.entries.bulkAdd([a, b]);
      const { originals, mergedId } = await data.mergeEntries(['b', 'a']);
      expect(mergedId).toBe('a');
      expect(await db.entries.toArray()).toEqual([expect.objectContaining({ id: 'a', start: T, end: T + 2 * H })]);

      await data.revertEntries(originals, []);
      expect(await db.entries.orderBy('start').toArray()).toEqual([a, b]);
    });

    it('a refused merge changes nothing', async () => {
      await db.entries.bulkAdd([makeEntry({ id: 'a', nodeId: 'n', start: T }), makeEntry({ id: 'b', nodeId: 'm', start: T + H })]);
      await expect(data.mergeEntries(['a', 'b'])).rejects.toThrow('same node');
      expect(await db.entries.count()).toBe(2);
    });

    it('bulk updates are all-or-nothing', async () => {
      await db.entries.bulkAdd([makeEntry({ id: 'a', nodeId: 'n', start: T }), makeEntry({ id: 'b', nodeId: 'n', start: T + H })]);
      const before = await data.updateEntries(['a', 'b'], (e) => ({ start: e.start + H, end: e.end! + H }));
      expect(before.map((e) => e.start)).toEqual([T, T + H]);
      expect((await db.entries.orderBy('start').toArray()).map((e) => e.start)).toEqual([T + H, T + 2 * H]);

      // One invalid result rejects the whole batch.
      await expect(data.updateEntries(['a', 'b'], (e) => (e.id === 'b' ? { end: e.start } : { nodeId: 'm' }))).rejects.toThrow();
      expect((await db.entries.toArray()).map((e) => e.nodeId)).toEqual(['n', 'n']);
      await expect(data.updateEntries(['a', 'gone'], () => ({ nodeId: 'm' }))).rejects.toThrow('no longer exist');
    });

    it('adds several entries at once, or none if one is invalid', async () => {
      const ids = await data.addEntries([
        { nodeId: 'n', start: T, end: T + H },
        { nodeId: 'n', start: T + H, end: T + 2 * H, note: 'b' },
      ]);
      expect(ids).toHaveLength(2);
      expect((await db.entries.get(ids[1]))?.note).toBe('b');
      await expect(
        data.addEntries([
          { nodeId: 'n', start: T, end: T + H },
          { nodeId: 'n', start: T, end: T },
        ]),
      ).rejects.toThrow();
      expect(await db.entries.count()).toBe(2);
    });

    it('deletes several entries', async () => {
      await db.entries.bulkAdd([makeEntry({ id: 'a', nodeId: 'n', start: T }), makeEntry({ id: 'b', nodeId: 'n', start: T + H })]);
      const removed = await data.deleteEntries(['a', 'b']);
      expect(removed.map((e) => e.id)).toEqual(['a', 'b']);
      expect(await db.entries.count()).toBe(0);
    });
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
