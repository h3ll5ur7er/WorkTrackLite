import { ChangeDetectionStrategy, ChangeDetectorRef, Component, computed, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { renderNow } from '../../shared/render-now';
import { DataService } from '../../core/data.service';
import { Budget, BudgetType, Node, TimeEntry } from '../../core/models';
import { TimerService } from '../../core/timer.service';
import { ToastService } from '../../core/toast.service';
import { entryDurationSeconds, reportForBudget } from '../../domain/budget';
import { DEFAULT_CURRENCY, formatMoney, totalAmount } from '../../domain/billing';
import { entriesToCsv } from '../../domain/csv';
import { clipToRange } from '../../domain/reports';
import { formatHMS, parseTags } from '../../domain/format';
import { MS_PER_HOUR } from '../../domain/time';
import { liveSubtreeSeconds, reorderSiblings } from '../../domain/tree';
import { downloadFile, safeFileName } from '../../shared/download';
import { ColorPickerComponent } from '../../shared/ui/color-picker.component';
import { EntryDraft, EntryEditorComponent, draftFields } from '../../shared/ui/entry-editor.component';
import { TagChipsComponent } from '../../shared/ui/tag-chips.component';

@Component({
  selector: 'app-node-detail',
  imports: [DatePipe, EntryEditorComponent, ColorPickerComponent, TagChipsComponent],
  templateUrl: './node-detail.component.html',
  styleUrl: './node-detail.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NodeDetailComponent {
  private readonly data = inject(DataService);
  private readonly cdr = inject(ChangeDetectorRef);
  protected readonly timer = inject(TimerService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  readonly node = input<Node | null>(null);

  protected readonly formatHMS = formatHMS;
  protected readonly newChildName = signal('');
  protected readonly newChildKind = signal('');
  protected readonly editor = signal<EntryDraft | null>(null);

  private readonly tree = this.data.tree;

  /** Kind suggestion for a new child, from the active hierarchy template. */
  protected readonly suggestedChildKind = computed(() => {
    const n = this.node();
    const levels = this.data.activeTemplate()?.levels ?? [];
    const idx = n ? levels.indexOf(n.kind) : -1;
    return idx >= 0 && idx + 1 < levels.length ? levels[idx + 1] : 'Item';
  });

  protected readonly path = computed(() => {
    const n = this.node();
    return n ? this.tree().pathNames(n.id).slice(0, -1) : [];
  });

  protected readonly ownEntries = computed(() => {
    const n = this.node();
    return n ? [...(this.data.entriesByNode().get(n.id) ?? [])].sort((a, b) => b.start - a.start) : [];
  });

  private readonly subtreeEntries = computed(() => {
    const n = this.node();
    if (!n) return [];
    const byNode = this.data.entriesByNode();
    return this.tree()
      .subtreeIds(n.id)
      .flatMap((id) => byNode.get(id) ?? []);
  });

  protected readonly isLeaf = computed(() => {
    const n = this.node();
    return !!n && this.tree().isLeaf(n.id);
  });
  protected readonly hasChildren = computed(() => {
    const n = this.node();
    return !!n && this.tree().childrenOf(n.id, { includeArchived: true }).length > 0;
  });

  /** Budgets apply to the whole subtree, consistent with the dashboard. */
  protected readonly report = computed(() => {
    const n = this.node();
    if (!n) return null;
    const tracked = liveSubtreeSeconds(this.tree(), this.data.closedSubtreeSeconds(), n.id, this.timer.running(), this.timer.now());
    return reportForBudget(n.budget, tracked);
  });

  protected readonly ownSeconds = computed(() => {
    const now = this.timer.now();
    return this.ownEntries().reduce((s, e) => s + entryDurationSeconds(e, now), 0);
  });

  protected readonly isRunningHere = computed(() => this.timer.running()?.nodeId === this.node()?.id);

  /** Whether "Move up"/"Move down" can do anything (same rule the service applies). */
  protected readonly siblingPosition = computed(() => {
    const n = this.node();
    if (!n) return { first: true, last: true };
    const tree = this.tree();
    const siblings = tree.childrenOf(tree.get(n.parentId) ? n.parentId : null, { includeArchived: true });
    return { first: !reorderSiblings(siblings, n.id, -1), last: !reorderSiblings(siblings, n.id, 1) };
  });

  protected readonly parentOptions = computed(() => {
    const n = this.node();
    if (!n) return [];
    const tree = this.tree();
    return tree
      .validParentsFor(n.id)
      .map((p) => ({ id: p.id, label: tree.pathLabel(p.id) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  });

  // --- Timer ---------------------------------------------------------------

  protected async startTimer(): Promise<void> {
    const n = this.node();
    if (n) await this.timer.start(n.id);
  }

  protected async stopTimer(): Promise<void> {
    await this.timer.stop();
  }

  // --- Node edits ------------------------------------------------------------

  private async patch(p: Parameters<DataService['updateNode']>[1]): Promise<void> {
    const n = this.node();
    if (n) await this.data.updateNode(n.id, p);
  }

  protected rename(name: string): Promise<void> {
    const trimmed = name.trim();
    return trimmed ? this.patch({ name: trimmed }) : Promise.resolve();
  }
  protected setKind(kind: string): Promise<void> {
    return this.patch({ kind: kind.trim() || 'Item' });
  }
  /** Colour the node would get from its ancestors if it had none itself. */
  protected readonly inheritedColor = computed(() => {
    const n = this.node();
    return n?.parentId ? this.tree().colorOf(n.parentId) : null;
  });

  protected readonly currency = computed(() => this.data.settings().currency ?? DEFAULT_CURRENCY);
  protected readonly inheritedRate = computed(() => {
    const n = this.node();
    return n?.parentId ? this.tree().rateOf(n.parentId) : null;
  });
  protected readonly inheritedBillable = computed(() => {
    const n = this.node();
    return n?.parentId ? this.tree().billableOf(n.parentId) : true;
  });

  /** Money view of the budget and of all billable time in the subtree (when a rate applies). */
  protected readonly value = computed(() => {
    const n = this.node();
    const rate = n ? this.tree().rateOf(n.id) : null;
    if (!n || rate === null) return null;
    const pieces = clipToRange(this.subtreeEntries(), { from: -Infinity, to: Infinity }, this.timer.minute());
    const tracked = totalAmount(this.tree(), pieces, this.data.settings().rounding).amount;
    const budget = n.budget.type !== 'none' && n.budget.seconds > 0 ? (n.budget.seconds / 3600) * rate : null;
    return { tracked: formatMoney(tracked, this.currency()), budget: budget === null ? null : formatMoney(budget, this.currency()) };
  });

  protected setRate(v: number): Promise<void> {
    return this.patch({ rate: Number.isFinite(v) && v >= 0 ? v : undefined });
  }
  protected setBillable(v: string): Promise<void> {
    return this.patch({ billable: v === 'yes' ? true : v === 'no' ? false : undefined });
  }

  protected setColor(color: string | undefined): Promise<void> {
    return this.patch({ color });
  }
  protected setNotes(notes: string): Promise<void> {
    return this.patch({ notes: notes.trim() ? notes : undefined });
  }
  protected setTags(value: string): Promise<void> {
    const tags = parseTags(value);
    return this.patch({ tags: tags.length ? tags : undefined });
  }

  protected setBudgetType(type: BudgetType): Promise<void> {
    const n = this.node();
    return n ? this.patch({ budget: { ...n.budget, type } }) : Promise.resolve();
  }
  protected setBudgetHours(hours: number): Promise<void> {
    const n = this.node();
    if (!n || !Number.isFinite(hours)) return Promise.resolve();
    const budget: Budget = { ...n.budget, seconds: Math.max(0, Math.round(hours * 3600)) };
    return this.patch({ budget });
  }
  protected setSoftLimitHours(hours: number): Promise<void> {
    const n = this.node();
    if (!n) return Promise.resolve();
    const softLimit = Number.isFinite(hours) && hours > 0 ? Math.round(hours * 3600) : undefined;
    return this.patch({ budget: { ...n.budget, softLimit } });
  }

  protected setShowInDashboard(value: boolean): Promise<void> {
    // Store no override when the value matches the default (leaf → shown).
    return this.patch({ showInDashboard: value === this.isLeaf() ? undefined : value });
  }

  protected async setArchived(archived: boolean): Promise<void> {
    const n = this.node();
    if (!n) return;
    if (archived && this.isRunningHere()) await this.timer.stop();
    await this.data.setArchived(n.id, archived);
    this.toast.show(archived ? `Archived ${n.name}` : `Restored ${n.name}`, {
      action: { label: 'Undo', run: () => this.data.setArchived(n.id, !archived) },
    });
  }

  protected async reorder(direction: -1 | 1): Promise<void> {
    const n = this.node();
    if (n) await this.data.reorderNode(n.id, direction);
  }

  protected async moveTo(parentId: string): Promise<void> {
    const n = this.node();
    if (!n) return;
    try {
      await this.data.moveNode(n.id, parentId || null);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  protected async addChild(): Promise<void> {
    const n = this.node();
    const name = this.newChildName().trim();
    if (!n || !name) return;
    const kind = this.newChildKind().trim() || this.suggestedChildKind();
    const id = await this.data.addNode({ parentId: n.id, name, kind });
    this.newChildName.set('');
    this.newChildKind.set('');
    await this.router.navigate(['/manage', id]);
  }

  protected async deleteNode(): Promise<void> {
    const n = this.node();
    if (!n) return;
    const what = this.hasChildren() ? 'it, all its children and their time entries' : 'it and its time entries';
    if (!confirm(`Delete "${n.name}"? This removes ${what}.\n\nTip: Archive keeps the history.`)) return;
    const removed = await this.data.deleteNodeCascade(n.id);
    await this.router.navigate(n.parentId ? ['/manage', n.parentId] : ['/manage']);
    this.toast.show(`Deleted ${n.name}`, { action: { label: 'Undo', run: () => this.data.restoreDeleted(removed) } });
  }

  // --- Entries ---------------------------------------------------------------

  protected newEntry(): void {
    const n = this.node();
    if (!n) return;
    const end = Math.floor(Date.now() / 900_000) * 900_000;
    this.showEditor({ nodeId: n.id, start: end - MS_PER_HOUR, end, note: '' });
  }

  protected editEntry(e: TimeEntry): void {
    if (e.end == null) return;
    this.showEditor({ id: e.id, nodeId: e.nodeId, start: e.start, end: e.end, note: e.note, tags: e.tags, billable: e.billable });
  }

  protected async saveEntry(d: EntryDraft): Promise<void> {
    try {
      const fields = draftFields(d);
      if (d.id) await this.data.updateEntry(d.id, fields);
      else await this.data.addEntry(fields);
      this.editor.set(null);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  protected async deleteEntry(id: string): Promise<void> {
    const removed = await this.data.deleteEntry(id);
    this.editor.set(null);
    if (removed) this.toast.show('Entry deleted', { action: { label: 'Undo', run: () => this.data.restoreEntries([removed]) } });
  }

  protected exportCsv(scope: 'node' | 'subtree'): void {
    const n = this.node();
    if (!n) return;
    const entries = scope === 'node' ? this.ownEntries() : this.subtreeEntries();
    const csv = entriesToCsv(entries, this.tree(), Date.now(), this.data.settings().rounding);
    downloadFile(`worktracklite_${safeFileName(n.name)}_${scope}.csv`, csv, 'text/csv;charset=utf-8');
  }

  protected entrySeconds(e: TimeEntry): number {
    return entryDurationSeconds(e, this.timer.now());
  }

  /** Opens the entry editor and renders it now, so it has focus before the next keystroke. */
  private showEditor(draft: EntryDraft): void {
    this.editor.set(draft);
    renderNow(this.cdr);
  }
}
