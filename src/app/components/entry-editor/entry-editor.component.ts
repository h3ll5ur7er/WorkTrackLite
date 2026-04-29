import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Node, TimeEntry } from '../../data/models';
import { DataService } from '../../services/data.service';

export interface EntryDraft {
  /** When editing, the existing entry id; absent when creating new. */
  id?: string;
  nodeId: string | null;
  start: number;
  end: number;
  note?: string;
}

@Component({
  selector: 'app-entry-editor',
  imports: [CommonModule, FormsModule],
  template: `
    <div class="modal" *ngIf="open" (click)="onBackdrop($event)">
      <div class="modal__panel" (click)="$event.stopPropagation()">
        <header class="modal__header">
          <h3>{{ draft.id ? 'Edit time entry' : 'New time entry' }}</h3>
          <button class="btn btn--ghost btn--small" (click)="cancel.emit()" aria-label="Close">×</button>
        </header>

        <div class="modal__body">
          <label class="field">
            <span>Node</span>
            <select [(ngModel)]="draft.nodeId">
              <option [ngValue]="null" disabled>— select —</option>
              <option *ngFor="let o of nodeOptions()" [ngValue]="o.id">{{ o.label }}</option>
            </select>
          </label>

          <div class="row">
            <label class="field">
              <span>Start</span>
              <input type="datetime-local" [ngModel]="toLocal(draft.start)"
                     (ngModelChange)="draft.start = fromLocal($event)" />
            </label>
            <label class="field">
              <span>End</span>
              <input type="datetime-local" [ngModel]="toLocal(draft.end)"
                     (ngModelChange)="draft.end = fromLocal($event)" />
            </label>
          </div>

          <div class="row">
            <label class="field field--small">
              <span>Duration (h)</span>
              <input type="number" min="0" step="0.25"
                     [ngModel]="durationHours()"
                     (ngModelChange)="setDurationHours($event)" />
            </label>
            <span class="field__readout">{{ duration() }}</span>
          </div>

          <label class="field">
            <span>Note</span>
            <input type="text" [(ngModel)]="draft.note" placeholder="Optional…" />
          </label>

          <p *ngIf="error()" class="error">{{ error() }}</p>
        </div>

        <footer class="modal__footer">
          <button *ngIf="draft.id" class="btn btn--ghost" (click)="del.emit(draft.id!)">Delete</button>
          <span class="spacer"></span>
          <button class="btn" (click)="cancel.emit()">Cancel</button>
          <button class="btn btn--primary" [disabled]="!canSave()" (click)="trySave()">Save</button>
        </footer>
      </div>
    </div>
  `,
  styles: [`
    .modal { position: fixed; inset: 0; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; z-index: 1100; padding: 16px; }
    .modal__panel { width: min(520px, 100%); background: var(--c-bg-2); border: 1px solid var(--c-border); border-radius: 10px; box-shadow: 0 24px 64px rgba(0,0,0,0.5); display: flex; flex-direction: column; max-height: 90vh; }
    .modal__header { display: flex; justify-content: space-between; align-items: center; padding: 12px 14px; border-bottom: 1px solid var(--c-border); }
    .modal__header h3 { margin: 0; font-size: 1rem; }
    .modal__body { padding: 14px; display: flex; flex-direction: column; gap: 10px; overflow: auto; }
    .modal__footer { display: flex; gap: 6px; align-items: center; padding: 10px 14px; border-top: 1px solid var(--c-border); }
    .modal__footer .spacer { flex: 1; }
    .row { display: flex; gap: 10px; flex-wrap: wrap; }
    .field { display: flex; flex-direction: column; gap: 4px; flex: 1 1 200px; min-width: 160px; font-size: 0.85rem; }
    .field span { color: var(--c-fg-3); font-size: 0.75rem; }
    .field input, .field select { padding: 6px 8px; background: var(--c-bg); border: 1px solid var(--c-border); border-radius: 4px; color: inherit; font: inherit; }
    .field--small { flex: 0 0 140px; }
    .field__readout { align-self: flex-end; padding: 6px 8px; color: var(--c-fg-3); font-variant-numeric: tabular-nums; }
    .error { color: var(--c-danger); margin: 0; font-size: 0.85rem; }
  `],
})
export class EntryEditorComponent {
  private data = inject(DataService);

  @Input() open = false;
  @Input() draft: EntryDraft = { nodeId: null, start: Date.now(), end: Date.now() + 3600_000 };

  @Output() save = new EventEmitter<EntryDraft>();
  @Output() cancel = new EventEmitter<void>();
  @Output() del = new EventEmitter<string>();

  readonly error = signal<string | null>(null);

  readonly nodeOptions = computed<{ id: string; label: string }[]>(() => {
    const all = this.data.nodes();
    const byId = new Map(all.map(n => [n.id, n] as const));
    const path = (n: Node): string => n.parentId
      ? `${path(byId.get(n.parentId)!)} / ${n.name}`
      : n.name;
    return all
      .filter(n => !n.archived)
      .map(n => ({ id: n.id, label: path(n) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  });

  duration(): string {
    const ms = Math.max(0, this.draft.end - this.draft.start);
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h}h ${String(m).padStart(2, '0')}m`;
  }

  durationHours(): number {
    return Math.round(((this.draft.end - this.draft.start) / 3600_000) * 100) / 100;
  }
  setDurationHours(h: number) {
    if (!isFinite(h) || h < 0) return;
    this.draft.end = this.draft.start + Math.round(h * 3600_000);
  }

  canSave(): boolean {
    return !!this.draft.nodeId && this.draft.end > this.draft.start;
  }

  trySave() {
    this.error.set(null);
    if (!this.draft.nodeId) { this.error.set('Pick a node.'); return; }
    if (this.draft.end <= this.draft.start) { this.error.set('End must be after start.'); return; }
    this.save.emit({ ...this.draft });
  }

  onBackdrop(ev: MouseEvent) {
    if (ev.target === ev.currentTarget) this.cancel.emit();
  }

  /** datetime-local <-> epoch ms helpers (local time, no TZ shift). */
  toLocal(ms: number): string {
    const d = new Date(ms);
    const pad = (x: number) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  fromLocal(s: string): number {
    const t = Date.parse(s);
    return isNaN(t) ? this.draft.start : t;
  }
}
