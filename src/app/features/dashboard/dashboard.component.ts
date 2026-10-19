import { ChangeDetectionStrategy, ChangeDetectorRef, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { renderNow } from '../../shared/render-now';
import { DataService } from '../../core/data.service';
import { Node, TimeEntry } from '../../core/models';
import { TimerChange, TimerService } from '../../core/timer.service';
import { ToastService } from '../../core/toast.service';
import { reportForBudget } from '../../domain/budget';
import { formatHM } from '../../domain/format';
import { MS_PER_HOUR } from '../../domain/time';
import { quickStart } from '../../domain/quick-start';
import { liveSubtreeSeconds } from '../../domain/tree';
import { LongPressDirective, LongPressEvent } from '../../shared/long-press.directive';
import { ContextMenuComponent, MenuItem } from '../../shared/ui/context-menu.component';
import { EntryDraft, EntryEditorComponent, draftFields } from '../../shared/ui/entry-editor.component';
import { TagChipsComponent } from '../../shared/ui/tag-chips.component';
import { BurndownChartComponent } from './burndown-chart.component';
import { WorkSummaryComponent } from './work-summary.component';

interface CardBase {
  node: Node;
  pathLabels: string[];
  /** Own or inherited colour (null: default accent). */
  color: string | null;
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
  imports: [
    RouterLink,
    BurndownChartComponent,
    ContextMenuComponent,
    EntryEditorComponent,
    LongPressDirective,
    TagChipsComponent,
    WorkSummaryComponent,
  ],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardComponent {
  private readonly data = inject(DataService);
  private readonly cdr = inject(ChangeDetectorRef);
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
        color: tree.colorOf(node.id),
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
          Number(!!b.node.favorite) - Number(!!a.node.favorite) ||
          Number(b.overBudget) - Number(a.overBudget) ||
          a.node.name.localeCompare(b.node.name),
      );
  });

  protected readonly totalCards = computed(() => this.bases().length);

  /** Favourites, then recently used nodes: one tap to start or stop. */
  protected readonly quick = computed(() => {
    const tree = this.data.tree();
    const running = this.timer.running();
    return quickStart(tree, this.data.entries()).map((q) => ({
      ...q,
      path: tree.pathNames(q.node.id).slice(0, -1).join(' › '),
      color: tree.colorOf(q.node.id),
      isRunning: running?.nodeId === q.node.id,
    }));
  });

  protected toggle(card: DashboardCard): Promise<void> {
    return this.toggleNode(card.node);
  }

  protected async toggleNode(node: Node): Promise<void> {
    const now = Date.now();
    if (this.lastActivation.nodeId === node.id && now - this.lastActivation.at < REPEAT_GUARD_MS) return;
    this.lastActivation = { nodeId: node.id, at: now };
    const change = await this.timer.toggle(node.id);
    this.announce(change, node.name);
  }

  protected async setFavorite(node: Node, favorite: boolean): Promise<void> {
    await this.data.updateNode(node.id, { favorite: favorite || undefined });
    this.toast.show(favorite ? `${node.name} added to favourites` : `${node.name} removed from favourites`, {
      action: { label: 'Undo', run: () => this.data.updateNode(node.id, { favorite: node.favorite }) },
    });
  }

  private announce(change: TimerChange, name: string): void {
    if (!change.started && !change.closed.length) return;
    this.toast.show(change.started ? `Started timer on ${name}` : `Stopped timer on ${name}`, {
      action: { label: 'Undo', run: () => this.timer.undo(change) },
    });
  }

  protected onContextMenu(ev: MouseEvent, card: DashboardCard): void {
    ev.preventDefault();
    this.openMenu({ x: ev.clientX, y: ev.clientY, card });
  }

  protected onLongPress(ev: LongPressEvent, card: DashboardCard): void {
    this.openMenu({ x: ev.x, y: ev.y, card });
  }

  protected openMenuFrom(button: HTMLElement, card: DashboardCard): void {
    const r = button.getBoundingClientRect();
    this.openMenu({ x: r.left, y: r.bottom + 4, card });
  }

  protected menuItems(card: DashboardCard): MenuItem[] {
    return [
      {
        label: card.isRunning ? 'Stop timer' : 'Start timer',
        run: async () => this.announce(await this.timer.toggle(card.node.id), card.node.name),
      },
      { label: 'Log time…', run: () => this.openEditor(card.node.id) },
      card.node.favorite
        ? { label: 'Remove from favourites', run: () => this.setFavorite(card.node, false) }
        : { label: 'Add to favourites', run: () => this.setFavorite(card.node, true) },
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
    this.showEditor({ nodeId, start: end - MS_PER_HOUR, end, note: '' });
  }

  protected async saveEntry(draft: EntryDraft): Promise<void> {
    try {
      await this.data.addEntry(draftFields(draft));
      this.editor.set(null);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  /** Opens a menu and renders it now, so it has focus before the next keystroke. */
  private openMenu(m: { x: number; y: number; card: DashboardCard }): void {
    this.menu.set(m);
    renderNow(this.cdr);
  }

  /** Opens the entry editor and renders it now, so it has focus before the next keystroke. */
  private showEditor(draft: EntryDraft): void {
    this.editor.set(draft);
    renderNow(this.cdr);
  }
}
