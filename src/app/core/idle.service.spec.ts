import { TestBed } from '@angular/core/testing';
import { provideTestDb, waitFor } from '../testing/test-db';
import { AppDB } from './db';
import { DataService } from './data.service';
import { IdleService } from './idle.service';

const H = 3_600_000;
// A fixed late afternoon in the past: "9 hours ago" never crosses midnight, and
// entries the service creates with the real clock always come after it.
const NOW = new Date(2026, 0, 15, 18, 0).getTime();

describe('IdleService', () => {
  let db: AppDB;
  let data: DataService;
  let idle: IdleService;
  let nodeId: string;

  beforeEach(async () => {
    localStorage.clear();
    const t = provideTestDb();
    db = t.db;
    TestBed.configureTestingModule({ providers: t.providers });
    data = TestBed.inject(DataService);
    idle = TestBed.inject(IdleService);
    await waitFor(() => data.ready());
    nodeId = await data.addNode({ parentId: null, name: 'A', kind: 'K' });
  });

  afterEach(async () => {
    TestBed.resetTestingModule();
    db.close();
    await db.delete();
  });

  async function runningSince(start: number): Promise<string> {
    await db.entries.add({ id: 'run', nodeId, start, end: null, createdAt: start, updatedAt: start });
    await waitFor(() => data.runningEntry()?.id === 'run');
    return 'run';
  }

  it('detects an away gap from the stored heartbeat, then records a new one', async () => {
    const now = NOW;
    await runningSince(now - 3 * H);
    localStorage.setItem('worktracklite.lastSeen', String(now - 2 * H));
    idle.check(now);
    expect(idle.pending()).toMatchObject({ reason: 'away', awayFrom: now - 2 * H, awayTo: now });
    expect(localStorage.getItem('worktracklite.lastSeen')).toBe(String(now));
  });

  it('"remove away time" closes the entry when you left and starts a new one', async () => {
    const now = NOW;
    await runningSince(now - 3 * H);
    localStorage.setItem('worktracklite.lastSeen', String(now - 2 * H));
    idle.check(now);
    await idle.resolve({ kind: 'split' });
    const entries = (await db.entries.toArray()).sort((a, b) => a.start - b.start);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ id: 'run', end: now - 2 * H });
    expect(entries[1]).toMatchObject({ nodeId, end: null });
    expect(idle.pending()).toBeNull();
  });

  it('"keep running" on a long timer is not asked again for that entry', async () => {
    const now = NOW;
    await runningSince(now - 9 * H);
    localStorage.setItem('worktracklite.lastSeen', String(now - 60_000));
    idle.check(now);
    expect(idle.pending()?.reason).toBe('long');
    await idle.resolve({ kind: 'keep' });
    idle.check(now + 60_000);
    expect(idle.pending()).toBeNull();
  });

  it('"stop at" closes the entry at the chosen time', async () => {
    const now = NOW;
    await runningSince(now - 9 * H);
    localStorage.setItem('worktracklite.lastSeen', String(now - 60_000));
    idle.check(now);
    await idle.resolve({ kind: 'stop-at', at: now - 8 * H });
    expect((await db.entries.get('run'))?.end).toBe(now - 8 * H);
  });

  it('can be switched off', async () => {
    const now = NOW;
    await data.updateSettings({ idleGuard: false });
    await waitFor(() => data.settings().idleGuard === false);
    await runningSince(now - 9 * H);
    localStorage.setItem('worktracklite.lastSeen', String(now - 2 * H));
    idle.check(now);
    expect(idle.pending()).toBeNull();
  });
});
