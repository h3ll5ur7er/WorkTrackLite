import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DataService } from '../../core/data.service';
import { TimerService } from '../../core/timer.service';
import { DEFAULT_CURRENCY, amountsByNode, formatMoney, totalAmount } from '../../domain/billing';
import { readableTextColor } from '../../domain/color';
import { entriesToCsv, tableToCsv } from '../../domain/csv';
import { formatHM } from '../../domain/format';
import {
  DateRange,
  RangePreset,
  clipToRange,
  presetRange,
  reportByDay,
  reportByNode,
  reportByTag,
  totalSecondsOf,
} from '../../domain/reports';
import { addDays, startOfDay } from '../../domain/time';
import { downloadFile } from '../../shared/download';

type GroupBy = 'node' | 'day' | 'tag';

const PRESETS: { id: RangePreset; label: string }[] = [
  { id: 'this-week', label: 'This week' },
  { id: 'last-week', label: 'Last week' },
  { id: 'this-month', label: 'This month' },
  { id: 'last-month', label: 'Last month' },
  { id: 'last-30-days', label: 'Last 30 days' },
];

/** yyyy-mm-dd for <input type="date"> (local). */
function toDateInput(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fromDateInput(v: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : null;
}

@Component({
  selector: 'app-reports',
  templateUrl: './reports.component.html',
  styleUrl: './reports.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReportsComponent {
  private readonly data = inject(DataService);
  private readonly timer = inject(TimerService);

  protected readonly presets = PRESETS;
  protected readonly formatHM = formatHM;
  protected readonly preset = signal<RangePreset | 'custom'>('this-week');
  private readonly custom = signal<DateRange>(presetRange('this-week', Date.now()));
  protected readonly groupBy = signal<GroupBy>('node');
  /** Optional subtree filter (node id) or '' for everything. */
  protected readonly scope = signal('');

  protected readonly range = computed<DateRange>(() => {
    const p = this.preset();
    return p === 'custom' ? this.custom() : presetRange(p, this.timer.minute(), this.data.settings().weekStartsOn ?? 1);
  });
  protected readonly fromInput = computed(() => toDateInput(this.range().from));
  /** The inclusive last day, as people read date ranges. */
  protected readonly toInput = computed(() => toDateInput(addDays(this.range().to, -1)));

  protected readonly scopeOptions = computed(() => {
    const tree = this.data.tree();
    return tree.nodes
      .filter((n) => tree.childrenOf(n.id, { includeArchived: true }).length > 0 || !n.parentId)
      .map((n) => ({ id: n.id, label: tree.pathLabel(n.id) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  });

  private readonly pieces = computed(() => {
    const scope = this.scope();
    const tree = this.data.tree();
    const ids = scope ? new Set(tree.subtreeIds(scope)) : null;
    const entries = ids ? this.data.entries().filter((e) => ids.has(e.nodeId)) : this.data.entries();
    return clipToRange(entries, this.range(), this.timer.minute());
  });

  protected readonly total = computed(() => totalSecondsOf(this.pieces()));

  private readonly rounding = computed(() => this.data.settings().rounding);
  protected readonly currency = computed(() => this.data.settings().currency ?? DEFAULT_CURRENCY);
  /** Billing is shown only when some node has a rate. */
  protected readonly hasRates = computed(() => this.data.nodes().some((n) => n.rate !== undefined));
  protected readonly totalMoney = computed(() => totalAmount(this.data.tree(), this.pieces(), this.rounding()));
  private readonly amounts = computed(() => amountsByNode(this.data.tree(), this.pieces(), this.rounding()));

  protected money(amount: number): string {
    return formatMoney(amount, this.currency());
  }
  protected amountFor(nodeId: string): number {
    return this.amounts().get(nodeId)?.amount ?? 0;
  }

  protected readonly nodeRows = computed(() => {
    const tree = this.data.tree();
    const scope = this.scope();
    const rows = reportByNode(tree, this.pieces());
    // With a scope, show the scoped subtree from its root, re-based to depth 0.
    if (!scope) return rows;
    const startDepth = tree.ancestorIds(scope).length;
    const ids = new Set(tree.subtreeIds(scope));
    return rows.filter((r) => ids.has(r.nodeId)).map((r) => ({ ...r, depth: r.depth - startDepth }));
  });
  protected readonly dayRows = computed(() => reportByDay(this.pieces(), this.range()));
  protected readonly tagRows = computed(() => reportByTag(this.data.tree(), this.pieces()));
  protected readonly maxDay = computed(() => Math.max(1, ...this.dayRows().map((d) => d.seconds)));

  protected tagStyle(tag: string | null): { bg: string | null; fg: string | null } {
    const c = tag ? this.data.settings().tagColors?.[tag] : undefined;
    return c ? { bg: c, fg: readableTextColor(c) } : { bg: null, fg: null };
  }

  protected nodeColor(id: string): string | null {
    return id ? this.data.tree().colorOf(id) : null;
  }

  protected percent(seconds: number): number {
    const t = this.total();
    return t ? Math.round((seconds / t) * 1000) / 10 : 0;
  }

  protected dayLabel(day: number): string {
    return new Date(day).toLocaleDateString(undefined, { weekday: 'short', month: 'numeric', day: 'numeric' });
  }

  protected setPreset(p: RangePreset | 'custom'): void {
    if (p === 'custom') this.custom.set(this.range());
    this.preset.set(p);
  }

  protected setFrom(v: string): void {
    const from = fromDateInput(v);
    if (from == null) return;
    const r = this.range();
    this.custom.set({ from, to: Math.max(r.to, addDays(from, 1)) });
    this.preset.set('custom');
  }

  protected setTo(v: string): void {
    const last = fromDateInput(v);
    if (last == null) return;
    const to = addDays(startOfDay(last), 1);
    this.custom.set({ from: Math.min(this.range().from, addDays(to, -1)), to });
    this.preset.set('custom');
  }

  protected exportSummary(): void {
    const hours = (s: number) => Math.round((s / 3600) * 10000) / 10000;
    let csv: string;
    if (this.groupBy() === 'node') {
      const tree = this.data.tree();
      const amounts = this.amounts();
      csv = tableToCsv(
        ['node_path', 'own_hours', 'total_hours', 'billable_hours', `amount_${this.currency()}`],
        this.nodeRows().map((r) => {
          const a = amounts.get(r.nodeId);
          return [
            r.nodeId ? tree.pathLabel(r.nodeId) : r.name,
            hours(r.ownSeconds),
            hours(r.totalSeconds),
            hours(a?.billableSeconds ?? 0),
            a?.amount ?? 0,
          ];
        }),
      );
    } else if (this.groupBy() === 'day') {
      csv = tableToCsv(
        ['date', 'hours'],
        this.dayRows().map((r) => [toDateInput(r.day), hours(r.seconds)]),
      );
    } else {
      csv = tableToCsv(
        ['tag', 'hours'],
        this.tagRows().map((r) => [r.tag ?? '(untagged)', hours(r.seconds)]),
      );
    }
    downloadFile(`worktracklite_report_${this.fileSuffix()}_by-${this.groupBy()}.csv`, csv, 'text/csv;charset=utf-8');
  }

  /** Entries in the range, clipped to it (start/end and durations inside the range only). */
  protected exportEntries(): void {
    const clipped = this.pieces().map((p) => ({ ...p.entry, start: p.from, end: p.to }));
    downloadFile(
      `worktracklite_entries_${this.fileSuffix()}.csv`,
      entriesToCsv(clipped, this.data.tree(), Date.now(), this.rounding()),
      'text/csv;charset=utf-8',
    );
  }

  private fileSuffix(): string {
    return `${this.fromInput()}_${this.toInput()}`;
  }
}
