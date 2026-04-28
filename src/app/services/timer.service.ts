import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { db, uid } from '../data/db';
import { TimeEntry } from '../data/models';
import { DataService } from './data.service';

/**
 * TimerService manages the single live timer. There is at most one running
 * entry across the whole app (the "active" entry, identified by `end == null`).
 * Stopping closes it; starting on a new node stops any existing one first.
 */
@Injectable({ providedIn: 'root' })
export class TimerService {
  private data = inject(DataService);
  /** Ticks every second so durations re-render without per-component intervals. */
  readonly now = signal(Date.now());
  readonly running = computed(() => this.data.runningEntry());
  readonly elapsedSeconds = computed(() => {
    const r = this.running();
    return r ? Math.max(0, Math.floor((this.now() - r.start) / 1000)) : 0;
  });

  constructor() {
    setInterval(() => this.now.set(Date.now()), 1000);
    effect(() => {
      const r = this.running();
      if (r) void this.data.updateSettings({ lastEntryId: r.id, lastNodeId: r.nodeId });
    });
  }

  async start(nodeId: string, note?: string): Promise<TimeEntry> {
    await this.stop();
    const now = Date.now();
    const e: TimeEntry = { id: uid(), nodeId, start: now, end: null, note, createdAt: now, updatedAt: now };
    await db.entries.put(e);
    return e;
  }

  async stop(): Promise<void> {
    const r = this.running();
    if (!r) return;
    await db.entries.update(r.id, { end: Date.now(), updatedAt: Date.now() });
  }

  /** Resume the most recent entry's node (does not extend the old entry). */
  async resumeLast(): Promise<TimeEntry | null> {
    const last = this.data.settings().lastNodeId;
    if (!last) return null;
    return this.start(last);
  }
}
