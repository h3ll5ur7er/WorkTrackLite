import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { Node, TimeEntry } from '../../data/models';
import { DataService } from '../../services/data.service';
import { TimerService } from '../../services/timer.service';
import { descendantIds, indexChildren, reportForBudget, totalSeconds } from '../../services/budget';
import { BurndownChartComponent } from '../burndown-chart/burndown-chart.component';

interface DashboardCard {
  node: Node;
  pathLabels: string[];
  trackedSeconds: number;
  ratio: number;
  overBudget: boolean;
  softBreached: boolean;
  remainingSeconds: number;
  budgetSeconds: number;
  budgetType: Node['budget']['type'];
  isRunning: boolean;
}

@Component({
  selector: 'app-dashboard',
  imports: [CommonModule, BurndownChartComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent {
  private data = inject(DataService);
  protected timer = inject(TimerService);

  /** Right-click context menu position + target node, or null when closed. */
  readonly menu = signal<{ x: number; y: number; nodeId: string } | null>(null);
  readonly query = signal('');

  // Build the child map from non-archived nodes only, so a node whose only
  // children are archived is still treated as a leaf for dashboard purposes.
  private readonly childrenByParent = computed(() => indexChildren(this.data.nodes().filter(n => !n.archived)));

  /** Entries indexed by nodeId for O(1) lookup, avoiding per-card full-table scans. */
  private readonly entriesIndex = computed(() => {
    const m = new Map<string, TimeEntry[]>();
    for (const e of this.data.entries()) {
      const arr = m.get(e.nodeId) ?? [];
      arr.push(e);
      m.set(e.nodeId, arr);
    }
    return m;
  });

  /** Nodes that should appear on the dashboard (leaves by default, overridable). */
  private readonly dashboardNodes = computed<Node[]>(() => {
    const all = this.data.nodes();
    const childMap = this.childrenByParent();
    return all.filter(n => {
      if (n.archived) return false;
      const isLeaf = !(childMap.get(n.id)?.length);
      return n.showInDashboard ?? isLeaf;
    });
  });

  readonly cards = computed<DashboardCard[]>(() => {
    const all = this.data.nodes();
    const byId = new Map(all.map(n => [n.id, n] as const));
    const childMap = this.childrenByParent();
    const idx = this.entriesIndex();
    const now = this.timer.now();
    const running = this.timer.running();
    const q = this.query().trim().toLowerCase();

    return this.dashboardNodes().map(node => {
      // Build "Customer / Project / Phase / Task" path
      const path: string[] = [];
      let cur: Node | undefined = node;
      while (cur) {
        path.unshift(cur.name);
        cur = cur.parentId ? byId.get(cur.parentId) : undefined;
      }
      // Aggregate tracked seconds across the whole subtree of this card,
      // so a card with sub-tasks still reflects everything below it.
      const ids = new Set(descendantIds(node.id, childMap));
      const ents: TimeEntry[] = [];
      for (const id of ids) {
        const nodeEntries = idx.get(id);
        if (nodeEntries) ents.push(...nodeEntries);
      }
      const r = reportForBudget(node.budget, totalSeconds(ents, now));
      return {
        node,
        pathLabels: path.slice(0, -1),
        trackedSeconds: r.trackedSeconds,
        ratio: r.ratio,
        overBudget: r.overBudget,
        softBreached: r.softBreached,
        remainingSeconds: r.remainingSeconds,
        budgetSeconds: r.budgetSeconds,
        budgetType: r.type,
        isRunning: !!running && running.nodeId === node.id,
      } as DashboardCard;
    }).filter(c =>
      !q ||
      c.node.name.toLowerCase().includes(q) ||
      c.pathLabels.join(' ').toLowerCase().includes(q)
    ).sort((a, b) => {
      // Running first, then over-budget, then by name
      if (a.isRunning !== b.isRunning) return a.isRunning ? -1 : 1;
      if (a.overBudget !== b.overBudget) return a.overBudget ? -1 : 1;
      return a.node.name.localeCompare(b.node.name);
    });
  });

  readonly entriesByNode = computed(() => {
    const m = new Map<string, TimeEntry[]>();
    const childMap = this.childrenByParent();
    const idx = this.entriesIndex();
    for (const card of this.cards()) {
      const ids = new Set(descendantIds(card.node.id, childMap));
      const cardEntries: TimeEntry[] = [];
      for (const id of ids) {
        const nodeEntries = idx.get(id);
        if (nodeEntries) cardEntries.push(...nodeEntries);
      }
      m.set(card.node.id, cardEntries);
    }
    return m;
  });

  formatHMS(sec: number): string {
    const sign = sec < 0 ? '-' : '';
    const s = Math.abs(Math.floor(sec));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${sign}${h}:${String(m).padStart(2, '0')}`;
  }

  /** Toggle: stop if running here, switch if running elsewhere, start otherwise. */
  async onCardClick(card: DashboardCard) {
    const running = this.timer.running();
    if (running && running.nodeId === card.node.id) {
      await this.timer.stop();
    } else {
      await this.timer.start(card.node.id);
    }
  }

  onCardContext(ev: MouseEvent, card: DashboardCard) {
    ev.preventDefault();
    this.menu.set({ x: ev.clientX, y: ev.clientY, nodeId: card.node.id });
  }

  closeMenu() { this.menu.set(null); }

  /** Emitted to parent so it can switch to manage view + select the node. */
  openInManage(nodeId: string) {
    this.menu.set(null);
    this.openInManageFn(nodeId);
  }

  /** Provided by host (AppComponent). */
  openInManageFn: (nodeId: string) => void = () => {};
}
