import { DOCUMENT, DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { DEFAULT_IDLE_SETTINGS, IdleCheck, IdleReason, IdleSettings, detectIdle } from '../domain/idle';
import { DataService } from './data.service';
import { TimeEntry } from './models';
import { TimerChange, TimerService } from './timer.service';
import { ToastService } from './toast.service';

const LAST_SEEN_KEY = 'worktracklite.lastSeen';
const ACK_KEY = 'worktracklite.idleAck';
const HEARTBEAT_MS = 30_000;

export type IdleChoice = { kind: 'keep' } | { kind: 'stop-at'; at: number } | { kind: 'split' };

/**
 * Forgotten-timer guard. Writes a heartbeat to localStorage (shared by all
 * tabs of this browser) and, when the app comes back after a gap, or a timer
 * has run very long or past midnight, asks what to do (see domain/idle.ts).
 */
@Injectable({ providedIn: 'root' })
export class IdleService {
  private readonly data = inject(DataService);
  private readonly timer = inject(TimerService);
  private readonly toast = inject(ToastService);
  private readonly document = inject(DOCUMENT);

  /** The question currently shown to the user, if any. */
  readonly pending = signal<IdleCheck | null>(null);

  readonly settings = computed<IdleSettings & { enabled: boolean }>(() => {
    const s = this.data.settings();
    return {
      enabled: s.idleGuard ?? true,
      awayMinutes: s.idleAwayMinutes ?? DEFAULT_IDLE_SETTINGS.awayMinutes,
      longRunningHours: s.idleLongRunningHours ?? DEFAULT_IDLE_SETTINGS.longRunningHours,
    };
  });

  constructor() {
    const win = this.document.defaultView;
    const onWake = () => {
      if (this.document.visibilityState !== 'hidden') this.check();
    };
    void this.data.whenReady().then(() => this.check());
    const id = setInterval(() => this.check(), HEARTBEAT_MS);
    this.document.addEventListener('visibilitychange', onWake);
    win?.addEventListener('focus', onWake);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(id);
      this.document.removeEventListener('visibilitychange', onWake);
      win?.removeEventListener('focus', onWake);
    });
  }

  /** Compares now with the last heartbeat, then records a new one. */
  check(now = Date.now()): void {
    // Before the data has loaded, writing a heartbeat would erase the gap we must detect.
    if (!this.data.ready()) return;
    const lastSeen = this.readNumber(LAST_SEEN_KEY);
    this.write(LAST_SEEN_KEY, String(now));
    if (this.pending() || !this.settings().enabled) return;
    const running = this.data.runningEntry();
    this.pending.set(detectIdle(running, now, lastSeen, this.settings(), running ? this.acknowledged(running.id) : []));
  }

  async resolve(choice: IdleChoice): Promise<void> {
    const check = this.pending();
    this.pending.set(null);
    if (!check) return;
    const entry = this.data.entries().find((e) => e.id === check.entryId && e.end == null);
    if (!entry) return;
    if (choice.kind === 'keep') {
      if (check.reason !== 'away') this.acknowledge(entry.id, check.reason);
      return;
    }
    const end = choice.kind === 'split' ? check.awayFrom! : choice.at;
    try {
      await this.data.updateEntry(entry.id, { end: Math.max(end, entry.start + 1000) });
      const started = choice.kind === 'split' ? (await this.timer.start(entry.nodeId, entry.note)).started : null;
      const change: TimerChange = { started, closed: [entry] };
      this.toast.show(choice.kind === 'split' ? 'Away time removed; timer continues' : 'Timer stopped', {
        action: { label: 'Undo', run: () => this.timer.undo(change) },
      });
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  private acknowledged(entryId: string): IdleReason[] {
    try {
      const ack = JSON.parse(this.read(ACK_KEY) ?? 'null') as { entryId: string; reasons: IdleReason[] } | null;
      return ack?.entryId === entryId ? ack.reasons : [];
    } catch {
      return [];
    }
  }

  private acknowledge(entryId: string, reason: IdleReason): void {
    this.write(ACK_KEY, JSON.stringify({ entryId, reasons: [...new Set([...this.acknowledged(entryId), reason])] }));
  }

  // localStorage can throw (privacy modes); the guard then simply stays quiet.
  private read(key: string): string | null {
    try {
      return this.document.defaultView?.localStorage.getItem(key) ?? null;
    } catch {
      return null;
    }
  }
  private readNumber(key: string): number | null {
    const v = Number(this.read(key));
    return Number.isFinite(v) && v > 0 ? v : null;
  }
  private write(key: string, value: string): void {
    try {
      this.document.defaultView?.localStorage.setItem(key, value);
    } catch {
      /* ignore */
    }
  }
}

/** Exposed for the dialog: the entry the pending question is about. */
export function pendingEntry(data: DataService, check: IdleCheck | null): TimeEntry | undefined {
  return check ? data.entries().find((e) => e.id === check.entryId) : undefined;
}
