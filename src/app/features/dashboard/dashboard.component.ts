import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { DataService } from '../../core/data.service';
import { Node, TimeEntry } from '../../core/models';
import { TimerChange, TimerService } from '../../core/timer.service';
import { ToastService } from '../../core/toast.service';
import { reportForBudget } from '../../domain/budget';
import { formatHM } from '../../domain/format';
import { MS_PER_HOUR } from '../../domain/time';
import { liveSubtreeSeconds } from '../../domain/tree';
import { LongPressDirective, LongPressEvent } from '../../shared/long-press.directive';
import { ContextMenuComponent, MenuItem } from '../../shared/ui/context-menu.component';
import { EntryDraft, EntryEditorComponent } from '../../shared/ui/entry-editor.component';
import { BurndownChartComponent } from './burndown-chart.component';

interface CardBase {
  node: Node;
  pathLabels: string[];
  /** Entries of the whole subtree (stable until data changes; feeds the chart). */
  entries: TimeEntry[];
}

export interface DashboardCard extends CardBase {
  trackedSeconds: number;
  remainingSeconds: number;
  budgetSeconds: number;
  overBudget: boolean;
  softBreached: boolean;
  isRunning: boolean;
}

/** Ignore a second activation of the same card within this window (double clicks/taps). */
const REPEAT_GUARD_MS = 400;

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, BurndownChartComponent, ContextMenuComponent, EntryEditorComponent, LongPressDirective],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardComponent {
  private readonly data = inject(DataService);
  protected readonly timer = inject(TimerService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  protected readonly query = signal('');
  protected readonly menu = signal<{ x: number; y: number; card: DashboardCard } | null>(null);
  protected readonly editor = signal<EntryDraft | null>(null);
  protected readonly formatHM = formatHM;
  private lastActivation = { nodeId: '', at: 0 };

  /** Card skeletons: only recomputed when nodes or entries change. */
  private readonly bases = computed<CardBase[]>(() => {
    const tree = this.data.tree();
    const byNode = this.data.entriesByNode();
    return tree.nodes
      .filter((n) => tree.isOnDashboard(n))
      .map((node) => ({
        node,
        pathLabels: tree.pathNames(node.id).slice(0, -1),
        entries: tree.subtreeIds(node.id).flatMap((id) => byNode.get(id) ?? []),
      }));
  });

  /** Live cards: cheap per-second update (adds the running timer's elapsed time). */
  protected readonly cards = computed<DashboardCard[]>(() => {
    const tree = this.data.tree();
    const closed = this.data.closedSubtreeSeconds();
    const running = this.timer.running();
    const now = this.timer.now();
    const terms = this.query().trim().toLowerCase().split(/\s+/).filter(Boolean);
    return this.bases()
      .filter((b) => {
        const hay = [...b.pathLabels, b.node.name, b.node.kind, ...(b.node.tags ?? [])].join(' ').toLowerCase();
        return terms.every((t) => hay.includes(t));
      })
      .map((b) => {
        const r = reportForBudget(b.node.budget, liveSubtreeSeconds(tree, closed, b.node.id, running, now));
        return {
          ...b,
          trackedSeconds: r.trackedSeconds,
          remainingSeconds: r.remainingSeconds,
          budgetSeconds: r.budgetSeconds,
          overBudget: r.overBudget,
          softBreached: r.softBreached,
          isRunning: running?.nodeId === b.node.id,
        };
      })
      .sort(
        (a, b) =>
          Number(b.isRunning) - Number(a.isRunning) ||
          Number(b.overBudget) - Number(a.overBudget) ||
          a.node.name.localeCompare(b.node.name),
      );
  });

  protected readonly totalCards = computed(() => this.bases().length);

  protected async toggle(card: DashboardCard): Promise<void> {
    const now = Date.now();
    if (this.lastActivation.nodeId === card.node.id && now - this.lastActivation.at < REPEAT_GUARD_MS) return;
    this.lastActivation = { nodeId: card.node.id, at: now };
    const change = await this.timer.toggle(card.node.id);
    this.announce(change, card.node.name);
  }

  private announce(change: TimerChange, name: string): void {
    if (!change.started && !change.closed.length) return;
    this.toast.show(change.started ? `Started timer on ${name}` : `Stopped timer on ${name}`, {
      action: { label: 'Undo', run: () => this.timer.undo(change) },
    });
  }

  protected onContextMenu(ev: MouseEvent, card: DashboardCard): void {
    ev.preventDefault();
    this.menu.set({ x: ev.clientX, y: ev.clientY, card });
  }

  protected onLongPress(ev: LongPressEvent, card: DashboardCard): void {
    this.menu.set({ x: ev.x, y: ev.y, card });
  }

  protected openMenuFrom(button: HTMLElement, card: DashboardCard): void {
    const r = button.getBoundingClientRect();
    this.menu.set({ x: r.left, y: r.bottom + 4, card });
  }

  protected menuItems(card: DashboardCard): MenuItem[] {
    return [
      {
        label: card.isRunning ? 'Stop timer' : 'Start timer',
        run: async () => this.announce(await this.timer.toggle(card.node.id), card.node.name),
      },
      { label: 'Log time…', run: () => this.openEditor(card.node.id) },
      { label: 'Open in Manage', run: () => this.router.navigate(['/manage', card.node.id]) },
      {
        label: 'Hide from dashboard',
        run: async () => {
          await this.data.updateNode(card.node.id, { showInDashboard: false });
          this.toast.show(`${card.node.name} hidden. Re-enable it in Manage.`, {
            action: { label: 'Undo', run: () => this.data.updateNode(card.node.id, { showInDashboard: card.node.showInDashboard }) },
          });
        },
      },
    ];
  }

  private openEditor(nodeId: string): void {
    const end = Math.floor(Date.now() / 900_000) * 900_000;
    this.editor.set({ nodeId, start: end - MS_PER_HOUR, end, note: '' });
  }

  protected async saveEntry(draft: EntryDraft): Promise<void> {
    try {
      await this.data.addEntry({
        nodeId: draft.nodeId!,
        start: draft.start,
        end: draft.end,
        note: draft.note || undefined,
        tags: draft.tags,
      });
      this.editor.set(null);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : String(e));
    }
  }
}
