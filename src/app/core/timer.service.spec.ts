import { TestBed } from '@angular/core/testing';
import { provideTestDb, waitFor } from '../testing/test-db';
import { AppDB } from './db';
import { DataService } from './data.service';
import { TimerService } from './timer.service';

describe('TimerService', () => {
  let db: AppDB;
  let data: DataService;
  let timer: TimerService;
  let nodeA: string;
  let nodeB: string;

  const open = async () => (await db.entries.toArray()).filter((e) => e.end == null);

  beforeEach(async () => {
    const t = provideTestDb();
    db = t.db;
    TestBed.configureTestingModule({ providers: t.providers });
    data = TestBed.inject(DataService);
    timer = TestBed.inject(TimerService);
    await waitFor(() => data.ready());
    nodeA = await data.addNode({ parentId: null, name: 'A', kind: 'K' });
    nodeB = await data.addNode({ parentId: null, name: 'B', kind: 'K' });
  });

  afterEach(async () => {
    TestBed.resetTestingModule();
    db.close();
    await db.delete();
  });

  it('starts and stops a timer', async () => {
    const started = await timer.start(nodeA);
    expect(started.started?.nodeId).toBe(nodeA);
    expect(await open()).toHaveLength(1);
    const stopped = await timer.stop();
    expect(stopped.closed.map((e) => e.id)).toEqual([started.started!.id]);
    expect(await open()).toHaveLength(0);
  });

  it('regression: concurrent starts never leave two running entries', async () => {
    await Promise.all([timer.start(nodeA), timer.start(nodeA), timer.start(nodeB), timer.start(nodeA)]);
    expect(await open()).toHaveLength(1);
  });

  it('regression: a double toggle is start then stop, never two timers', async () => {
    await Promise.all([timer.toggle(nodeA), timer.toggle(nodeA)]);
    expect(await open()).toHaveLength(0);
    expect(await db.entries.count()).toBe(1);
  });

  it('starting the node that is already running is a no-op', async () => {
    await timer.start(nodeA);
    const again = await timer.start(nodeA);
    expect(again.started).toBeNull();
    expect(await db.entries.count()).toBe(1);
  });

  it('starting another node stops the current one', async () => {
    await timer.start(nodeA);
    const change = await timer.start(nodeB);
    expect(change.closed).toHaveLength(1);
    expect((await open()).map((e) => e.nodeId)).toEqual([nodeB]);
  });

  it('undo restores the exact previous state', async () => {
    const first = await timer.start(nodeA);
    const change = await timer.start(nodeB);
    await timer.undo(change);
    const entries = await db.entries.toArray();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: first.started!.id, end: null });
    expect((await db.settings.get('app'))?.lastNodeId).toBe(nodeA);
  });

  it('remembers the last node and resumes it', async () => {
    await timer.start(nodeB);
    await timer.stop();
    await waitFor(() => data.settings().lastNodeId === nodeB);
    const resumed = await timer.resumeLast();
    expect(resumed.started?.nodeId).toBe(nodeB);
  });

  it('does not resume an archived node', async () => {
    await timer.start(nodeA);
    await timer.stop();
    await data.setArchived(nodeA, true);
    expect((await timer.resumeLast()).started).toBeNull();
  });

  it('exposes the running entry through signals', async () => {
    await timer.start(nodeA);
    await waitFor(() => timer.running()?.nodeId === nodeA);
    expect(timer.elapsedSeconds()).toBeGreaterThanOrEqual(0);
  });
});
