import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTestDb, waitFor } from '../testing/test-db';
import { BudgetAlertService } from './budget-alert.service';
import { WorkTrackDB } from './db';
import { DataService } from './data.service';
import { ToastService } from './toast.service';

const H = 3_600_000;
const T = new Date(2026, 0, 15, 9, 0).getTime();

describe('BudgetAlertService', () => {
  let db: WorkTrackDB;
  let data: DataService;
  let toast: ToastService;
  let nodeId: string;

  beforeEach(async () => {
    localStorage.clear();
    const t = provideTestDb();
    db = t.db;
    TestBed.configureTestingModule({ providers: [...t.providers, provideRouter([])] });
    data = TestBed.inject(DataService);
    toast = TestBed.inject(ToastService);
    TestBed.inject(BudgetAlertService);
    await waitFor(() => data.ready());
    nodeId = await data.addNode({
      parentId: null,
      name: 'Website',
      kind: 'Project',
      budget: { type: 'fixed', seconds: 10 * 3600, softLimit: 8 * 3600 },
    });
    await settle();
  });

  afterEach(async () => {
    TestBed.resetTestingModule();
    db.close();
    await db.delete();
  });

  /** Waits for the DB change to reach the signals, then runs effects. */
  async function settle(cond: () => boolean = () => true): Promise<void> {
    await waitFor(cond);
    TestBed.tick();
  }

  async function track(hours: number): Promise<void> {
    const start = T + (await db.entries.count()) * 24 * H;
    await data.addEntry({ nodeId, start, end: start + hours * H });
    await settle(() => data.entries().some((e) => e.start === start));
  }

  const messages = () => toast.toasts().map((t) => t.message);

  it('stays quiet about limits already crossed on first run, then announces each rise once', async () => {
    // Nothing announced yet on this device: the first pass only records the state.
    expect(JSON.parse(localStorage.getItem('worktracklite.budgetAlerts')!)).toEqual({});

    await track(8);
    expect(messages()).toEqual(['Website reached its warning threshold (8:00 of 10:00)']);
    expect(toast.toasts()[0].action?.label).toBe('Open');

    await track(1); // still soft: no repeat
    expect(messages()).toHaveLength(1);

    await track(2);
    expect(messages().at(-1)).toBe('Website is over its budget (11:00 of 10:00)');
    expect(toast.toasts().at(-1)?.kind).toBe('error');
  });

  it('a node that was already over when alerts started is not announced', async () => {
    TestBed.resetTestingModule();
    localStorage.removeItem('worktracklite.budgetAlerts');
    const t = provideTestDb();
    const db2 = t.db;
    await db2.open();
    await db2.nodes.add({
      id: 'n',
      parentId: null,
      name: 'Old',
      kind: 'K',
      order: 0,
      budget: { type: 'fixed', seconds: 3600 },
      createdAt: 0,
      updatedAt: 0,
    });
    await db2.entries.add({ id: 'e', nodeId: 'n', start: T, end: T + 2 * H, createdAt: 0, updatedAt: 0 });
    TestBed.configureTestingModule({ providers: [...t.providers, provideRouter([])] });
    const d2 = TestBed.inject(DataService);
    const t2 = TestBed.inject(ToastService);
    TestBed.inject(BudgetAlertService);
    await waitFor(() => d2.ready() && d2.entries().length === 1);
    TestBed.tick();
    expect(t2.toasts()).toEqual([]);
    expect(JSON.parse(localStorage.getItem('worktracklite.budgetAlerts')!)).toEqual({ n: 'over' });
    db2.close();
    await db2.delete();
  });

  it('can be switched off', async () => {
    await data.updateSettings({ budgetAlerts: false });
    await settle(() => data.settings().budgetAlerts === false);
    await track(9);
    expect(messages()).toEqual([]);
  });
});
