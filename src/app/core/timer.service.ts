import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { DataService } from './data.service';
import { uid } from './db';
import { TimeEntry } from './models';

/**
 * Result of a timer operation: exactly what changed, so it can be undone.
 * `closed` holds the entries *as they were before* they were stopped.
 */
export interface TimerChange {
  started: TimeEntry | null;
  closed: TimeEntry[];
  /** `settings.lastNodeId` before a start changed it (restored by undo). */
  previousLastNodeId?: string;
}

const NO_CHANGE: TimerChange = { started: null, closed: [] };

/**
 * The single live timer. Invariant: at most one entry has `end === null`.
 *
 * Every operation runs inside one IndexedDB read-write transaction and reads
 * the *database* (not the possibly stale signals), so rapid double clicks or
 * concurrent tabs cannot create a second running entry.
 */
@Injectable({ providedIn: 'root' })
export class TimerService {
  private readonly data = inject(DataService);
  private readonly db = this.data.db;

  /** Wall clock, ticking every second. Only read it where a per-second update is wanted. */
  readonly now = signal(Date.now());
  /** Same clock at minute resolution, for views that do not need seconds (charts, calendar). */
  readonly minute = computed(() => Math.floor(this.now() / 60_000) * 60_000, { equal: (a, b) => a === b });

  readonly running = this.data.runningEntry;
  readonly elapsedSeconds = computed(() => {
    const r = this.running();
    return r ? Math.max(0, Math.floor((this.now() - r.start) / 1000)) : 0;
  });

  constructor() {
    const id = setInterval(() => this.now.set(Date.now()), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(id));
  }

  /** Starts a timer on `nodeId`, stopping any other. No-op if it is already running there. */
  async start(nodeId: string, note?: string): Promise<TimerChange> {
    return this.afterStart(await this.db.transaction('rw', this.db.entries, () => this.startInTx(nodeId, note)));
  }

  /** Stops whatever is running. */
  async stop(): Promise<TimerChange> {
    return this.db.transaction('rw', this.db.entries, () => this.stopInTx());
  }

  /** Stops the timer if it runs on `nodeId`, otherwise starts it there (one transaction). */
  async toggle(nodeId: string): Promise<TimerChange> {
    const change = await this.db.transaction('rw', this.db.entries, async () => {
      const open = await this.openEntries();
      return open.some((e) => e.nodeId === nodeId) ? this.stopInTx() : this.startInTx(nodeId);
    });
    return this.afterStart(change);
  }

  /** Starts a new entry on the node of the last timer. */
  async resumeLast(): Promise<TimerChange> {
    const last = (await this.db.settings.get('app'))?.lastNodeId;
    const node = last ? await this.db.nodes.get(last) : undefined;
    if (!node || node.archived) return NO_CHANGE;
    return this.start(node.id);
  }

  /** Reverts a change made by start/stop/toggle. */
  async undo(change: TimerChange): Promise<void> {
    await this.db.transaction('rw', this.db.entries, async () => {
      if (change.started) await this.db.entries.delete(change.started.id);
      if (change.closed.length) await this.db.entries.bulkPut(change.closed);
    });
    if (change.started) await this.data.updateSettings({ lastNodeId: change.previousLastNodeId });
  }

  private async startInTx(nodeId: string, note?: string): Promise<TimerChange> {
    const open = await this.openEntries();
    if (open.length === 1 && open[0].nodeId === nodeId) return NO_CHANGE;
    const now = Date.now();
    const closed = await this.closeAll(open, now);
    const started: TimeEntry = { id: uid(), nodeId, start: now, end: null, note, createdAt: now, updatedAt: now };
    await this.db.entries.add(started);
    return { started, closed };
  }

  private async stopInTx(): Promise<TimerChange> {
    return { started: null, closed: await this.closeAll(await this.openEntries(), Date.now()) };
  }

  private async afterStart(change: TimerChange): Promise<TimerChange> {
    if (!change.started) return change;
    const previousLastNodeId = (await this.db.settings.get('app'))?.lastNodeId;
    await this.data.updateSettings({ lastNodeId: change.started.nodeId });
    return { ...change, previousLastNodeId };
  }

  private openEntries(): Promise<TimeEntry[]> {
    return this.db.entries.filter((e) => e.end == null).toArray();
  }

  private async closeAll(open: TimeEntry[], now: number): Promise<TimeEntry[]> {
    for (const e of open) {
      await this.db.entries.update(e.id, { end: Math.max(now, e.start), updatedAt: now });
    }
    return open;
  }
}
