import { DOCUMENT, Injectable, computed, effect, inject, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { reportForBudget } from '../domain/budget';
import { AlertLevel, alertLevel, alertStep } from '../domain/budget-alerts';
import { formatHM } from '../domain/format';
import { liveSubtreeSeconds } from '../domain/tree';
import { DataService } from './data.service';
import { TimerService } from './timer.service';
import { ToastService } from './toast.service';

/** Levels already announced, shared by all tabs of this browser (so only one tab alerts). */
const ANNOUNCED_KEY = 'worktracklite.budgetAlerts';

/**
 * Tells the user when a node's tracked time crosses its warning threshold or
 * its budget: a toast in the app and, if allowed, a system notification.
 * Checked when data changes and once a minute while a timer runs.
 */
@Injectable({ providedIn: 'root' })
export class BudgetAlertService {
  private readonly data = inject(DataService);
  private readonly timer = inject(TimerService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly window = inject(DOCUMENT).defaultView;

  readonly enabled = computed(() => this.data.settings().budgetAlerts ?? true);
  readonly notify = computed(() => this.data.settings().budgetNotifications ?? false);

  /** Current level of every live node that has a budget. */
  private readonly levels = computed(() => {
    const tree = this.data.tree();
    const closed = this.data.closedSubtreeSeconds();
    const running = this.timer.running();
    const now = this.timer.minute();
    const out = new Map<string, AlertLevel>();
    for (const n of tree.nodes) {
      if (n.budget.type === 'none' || n.archived || tree.hasArchivedAncestor(n.id)) continue;
      out.set(n.id, alertLevel(reportForBudget(n.budget, liveSubtreeSeconds(tree, closed, n.id, running, now))));
    }
    return out;
  });

  constructor() {
    effect(() => {
      if (!this.data.ready() || !this.enabled()) return;
      const levels = this.levels();
      untracked(() => this.process(levels));
    });
  }

  private process(levels: ReadonlyMap<string, AlertLevel>): void {
    const stored = this.read();
    const step = alertStep(stored ?? {}, levels);
    this.write(step.remembered);
    // First run on this device: remember what is already over, without a burst of old news.
    if (!stored || !step.raised.length) return;
    const tree = this.data.tree();
    for (const { nodeId, level } of step.raised.slice(0, 3)) {
      const node = tree.get(nodeId);
      if (!node) continue;
      const r = reportForBudget(
        node.budget,
        liveSubtreeSeconds(tree, this.data.closedSubtreeSeconds(), nodeId, this.timer.running(), Date.now()),
      );
      const of = `${formatHM(r.trackedSeconds)} of ${formatHM(r.budgetSeconds)}`;
      const message =
        level === 'over'
          ? `${node.name} is over its ${node.budget.type === 'target' ? 'target' : 'budget'} (${of})`
          : `${node.name} reached its warning threshold (${of})`;
      this.toast.show(message, {
        kind: level === 'over' ? 'error' : 'info',
        durationMs: 10_000,
        action: { label: 'Open', run: () => this.router.navigate(['/manage', nodeId]) },
      });
      if (this.notify()) void this.systemNotification(message, nodeId);
    }
    if (step.raised.length > 3) this.toast.show(`…and ${step.raised.length - 3} more budgets crossed a limit.`);
  }

  /** Asks the browser for permission; returns the resulting state. */
  async requestPermission(): Promise<NotificationPermission | 'unsupported'> {
    const N = this.window?.Notification;
    if (!N) return 'unsupported';
    return N.permission === 'default' ? N.requestPermission() : N.permission;
  }

  permission(): NotificationPermission | 'unsupported' {
    return this.window?.Notification?.permission ?? 'unsupported';
  }

  private async systemNotification(body: string, nodeId: string): Promise<void> {
    if (this.permission() !== 'granted') return;
    const options = { body, tag: `budget-${nodeId}`, icon: 'icons/icon-192x192.png' };
    try {
      // Android only shows notifications through the service worker.
      const reg = await this.window?.navigator.serviceWorker?.getRegistration();
      if (reg) await reg.showNotification('WorkTrackLite', options);
      else new Notification('WorkTrackLite', options);
    } catch {
      /* best effort: the toast already told the user */
    }
  }

  private read(): Record<string, AlertLevel> | null {
    try {
      const raw = this.window?.localStorage.getItem(ANNOUNCED_KEY);
      const v: unknown = raw ? JSON.parse(raw) : null;
      return v && typeof v === 'object' ? (v as Record<string, AlertLevel>) : null;
    } catch {
      return null;
    }
  }

  private write(v: Record<string, AlertLevel>): void {
    try {
      this.window?.localStorage.setItem(ANNOUNCED_KEY, JSON.stringify(v));
    } catch {
      /* private mode: alerts may repeat after a reload */
    }
  }
}
