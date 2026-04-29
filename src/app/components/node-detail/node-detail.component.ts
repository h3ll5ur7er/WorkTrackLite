import { CommonModule } from '@angular/common';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Budget, BudgetType, Node, TimeEntry } from '../../data/models';
import { DataService } from '../../services/data.service';
import { TimerService } from '../../services/timer.service';
import { descendantIds, indexChildren, reportForBudget, totalSeconds } from '../../services/budget';
import { entriesToCsv } from '../../services/csv';

@Component({
    selector: 'app-node-detail',
    imports: [CommonModule, FormsModule],
    templateUrl: './node-detail.component.html',
    styleUrl: './node-detail.component.scss'
})
export class NodeDetailComponent {
  private data = inject(DataService);
  protected timer = inject(TimerService);

  /** Node selected in the tree. */
  readonly node = input<Node | null>(null);
  readonly addedChild = output<string>();

  // child creation form
  newChildName = signal('');
  newChildKind = signal('');
  // manual entry form
  manualStart = signal<string>('');
  manualEnd = signal<string>('');
  manualNote = signal('');

  /** Suggested kind label for a new child based on the active hierarchy template. */
  readonly suggestedChildKind = computed(() => {
    const n = this.node();
    if (!n) return '';
    const tplId = this.data.settings().templateId;
    const tpl = this.data.templates().find(t => t.id === tplId);
    if (!tpl) return 'Item';
    const idx = tpl.levels.indexOf(n.kind);
    return idx >= 0 && idx + 1 < tpl.levels.length ? tpl.levels[idx + 1] : 'Item';
  });

  readonly entriesForNode = computed(() => {
    const n = this.node();
    if (!n) return [] as TimeEntry[];
    return this.data.entries()
      .filter(e => e.nodeId === n.id)
      .sort((a, b) => b.start - a.start);
  });

  readonly subtreeEntries = computed(() => {
    const n = this.node();
    if (!n) return [] as TimeEntry[];
    const ids = new Set(descendantIds(n.id, indexChildren(this.data.nodes())));
    return this.data.entries().filter(e => ids.has(e.nodeId));
  });

  readonly nodeReport = computed(() => {
    const n = this.node();
    if (!n) return null;
    return reportForBudget(n.budget, totalSeconds(this.entriesForNode(), this.timer.now()));
  });

  readonly subtreeReport = computed(() => {
    const n = this.node();
    if (!n) return null;
    return reportForBudget(n.budget, totalSeconds(this.subtreeEntries(), this.timer.now()));
  });

  readonly isRunningHere = computed(() => {
    const r = this.timer.running();
    const n = this.node();
    return !!(r && n && r.nodeId === n.id);
  });

  formatHMS(sec: number): string {
    const sign = sec < 0 ? '-' : '';
    const s = Math.abs(Math.floor(sec));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    return `${sign}${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  }

  async startTimer() {
    const n = this.node();
    if (n) await this.timer.start(n.id);
  }
  async stopTimer() { await this.timer.stop(); }

  async addChild() {
    const n = this.node();
    if (!n) return;
    const name = this.newChildName().trim();
    if (!name) return;
    const kind = this.newChildKind().trim() || this.suggestedChildKind() || 'Item';
    const id = await this.data.addNode({ parentId: n.id, name, kind });
    this.newChildName.set('');
    this.newChildKind.set('');
    this.addedChild.emit(id);
  }

  async updateBudgetType(value: BudgetType) {
    const n = this.node();
    if (!n) return;
    const budget: Budget = { ...n.budget, type: value };
    await this.data.updateNode(n.id, { budget });
  }
  async updateBudgetHours(hours: number) {
    const n = this.node();
    if (!n) return;
    const seconds = Math.max(0, Math.round(Number(hours) * 3600));
    await this.data.updateNode(n.id, { budget: { ...n.budget, seconds } });
  }
  async updateSoftLimitHours(hours: number) {
    const n = this.node();
    if (!n) return;
    const v = Number(hours);
    const softLimit = isFinite(v) && v > 0 ? Math.round(v * 3600) : undefined;
    await this.data.updateNode(n.id, { budget: { ...n.budget, softLimit } });
  }
  async renameNode(name: string) {
    const n = this.node();
    if (!n) return;
    await this.data.updateNode(n.id, { name: name.trim() || n.name });
  }
  async toggleShowInDashboard(value: boolean) {
    const n = this.node();
    if (!n) return;
    await this.data.updateNode(n.id, { showInDashboard: value });
  }
  async deleteNode() {
    const n = this.node();
    if (!n) return;
    if (!confirm(`Delete "${n.name}" and all its children/entries?`)) return;
    await this.data.deleteNodeCascade(n.id);
  }

  async addManual() {
    const n = this.node();
    if (!n) return;
    const s = Date.parse(this.manualStart());
    const e = Date.parse(this.manualEnd());
    if (isNaN(s) || isNaN(e)) return;
    await this.data.addManualEntry(n.id, s, e, this.manualNote() || undefined);
    this.manualStart.set('');
    this.manualEnd.set('');
    this.manualNote.set('');
  }

  async deleteEntry(id: string) {
    if (!confirm('Delete this entry?')) return;
    await this.data.deleteEntry(id);
  }

  exportCsv(scope: 'node' | 'subtree') {
    const entries = scope === 'node' ? this.entriesForNode() : this.subtreeEntries();
    const csv = entriesToCsv(entries, this.data.nodes(), this.timer.now());
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeName = (this.node()?.name ?? 'export').replace(/[^a-z0-9_-]+/gi, '_');
    a.href = url;
    a.download = `worktracklite_${safeName}_${scope}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  toLocalInput(ms: number): string {
    const d = new Date(ms);
    const pad = (x: number) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
}
