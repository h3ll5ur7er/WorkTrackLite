import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  linkedSignal,
  output,
} from '@angular/core';
import { DataService, NewEntry } from '../../core/data.service';
import { formatHM, parseTags } from '../../domain/format';
import { MS_PER_HOUR, fromLocalInput, toLocalInput } from '../../domain/time';

export interface EntryDraft {
  /** Existing entry id when editing; absent when creating. */
  id?: string;
  nodeId: string | null;
  start: number;
  end: number;
  note?: string;
  tags?: string[];
  /** undefined = follow the node. */
  billable?: boolean;
}

/** The fields to store for a draft (empty note/tags dropped). */
export function draftFields(d: EntryDraft): NewEntry {
  return {
    nodeId: d.nodeId!,
    start: d.start,
    end: d.end,
    note: d.note || undefined,
    tags: d.tags?.length ? d.tags : undefined,
    billable: d.billable,
  };
}

/** Modal dialog to create or edit a closed time entry. */
@Component({
  selector: 'app-entry-editor',
  host: { '(document:keydown.escape)': 'cancelled.emit()' },
  template: `
    <div class="modal">
      <button type="button" class="modal__backdrop" tabindex="-1" aria-label="Close dialog" (click)="cancelled.emit()"></button>
      <form
        class="modal__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="entry-editor-title"
        (submit)="$event.preventDefault(); readonly() || trySave()"
      >
        <header class="modal__header">
          <h2 id="entry-editor-title">{{ readonly() ? 'Time entry (locked)' : form().id ? 'Edit time entry' : 'New time entry' }}</h2>
          <button type="button" class="btn btn--ghost btn--small" (click)="cancelled.emit()" aria-label="Close">×</button>
        </header>

        <fieldset class="modal__body" [disabled]="readonly()">
          @if (readonly()) {
            <p class="modal__locked">🔒 This entry is in a locked period. Unlock the period in Settings to change it.</p>
          }
          <label class="field">
            <span>Node</span>
            <select name="node" (change)="patch({ nodeId: $any($event.target).value || null })">
              <option value="" disabled [selected]="!form().nodeId">— select —</option>
              @for (o of nodeOptions(); track o.id) {
                <option [value]="o.id" [selected]="o.id === form().nodeId">{{ o.label }}</option>
              }
            </select>
          </label>

          <div class="modal__row">
            <label class="field">
              <span>Start</span>
              <input name="start" type="datetime-local" [value]="startInput()" (change)="setStart($any($event.target).value)" />
            </label>
            <label class="field">
              <span>End</span>
              <input name="end" type="datetime-local" [value]="endInput()" (change)="setEnd($any($event.target).value)" />
            </label>
          </div>

          <div class="modal__row">
            <label class="field field--small">
              <span>Duration (h)</span>
              <input
                name="duration"
                type="number"
                min="0"
                step="0.25"
                [value]="durationHours()"
                (change)="setDurationHours($any($event.target).valueAsNumber)"
              />
            </label>
            <span class="modal__readout">{{ durationLabel() }}</span>
          </div>

          <label class="field">
            <span>Note</span>
            <input
              name="note"
              type="text"
              [value]="form().note ?? ''"
              (input)="patch({ note: $any($event.target).value })"
              placeholder="Optional…"
            />
          </label>

          <label class="field">
            <span>Tags (comma separated)</span>
            <input
              name="tags"
              type="text"
              [value]="(form().tags ?? []).join(', ')"
              (change)="patch({ tags: parseTags($any($event.target).value) })"
            />
          </label>

          <label class="field">
            <span>Billable</span>
            <select name="billable" (change)="setBillable($any($event.target).value)">
              <option value="" [selected]="form().billable === undefined">
                Like the node ({{ nodeBillable() ? 'billable' : 'not billable' }})
              </option>
              <option value="yes" [selected]="form().billable === true">Billable</option>
              <option value="no" [selected]="form().billable === false">Not billable</option>
            </select>
          </label>

          @if (!readonly() && validationError(); as err) {
            <p class="error" role="alert">{{ err }}</p>
          }
        </fieldset>

        <footer class="modal__footer">
          @if (readonly()) {
            <span class="modal__spacer"></span>
            <button type="button" class="btn btn--primary" (click)="cancelled.emit()">Close</button>
          } @else {
            @if (form().id; as id) {
              <button type="button" class="btn btn--ghost" (click)="deleted.emit(id)">Delete</button>
            }
            <span class="modal__spacer"></span>
            <button type="button" class="btn" (click)="cancelled.emit()">Cancel</button>
            <button type="submit" class="btn btn--primary" [disabled]="!!validationError()">Save</button>
          }
        </footer>
      </form>
    </div>
  `,
  styles: `
    .modal {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.55);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1100;
      padding: 16px;
    }
    .modal__backdrop {
      position: absolute;
      inset: 0;
      border: 0;
      background: transparent;
      cursor: default;
    }
    .modal__panel {
      position: relative;
      width: min(520px, 100%);
      background: var(--c-bg-2);
      border: 1px solid var(--c-border);
      border-radius: 10px;
      box-shadow: 0 24px 64px var(--c-shadow);
      display: flex;
      flex-direction: column;
      max-height: 90vh;
      max-height: calc(100dvh - 32px);
    }
    .modal__header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 14px;
      border-bottom: 1px solid var(--c-border);
    }
    .modal__header h2 {
      margin: 0;
      font-size: 1rem;
    }
    .modal__body {
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      overflow: auto;
    }
    .modal__row {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    .modal__row .field {
      flex: 1 1 200px;
      min-width: 160px;
    }
    .field--small {
      flex: 0 0 140px !important;
      min-width: 0 !important;
    }
    fieldset.modal__body {
      border: 0;
      margin: 0;
      min-width: 0;
    }
    .modal__locked {
      margin: 0;
      color: var(--c-warn);
    }
    .modal__readout {
      align-self: flex-end;
      padding: 6px 8px;
      color: var(--c-fg-3);
      font-variant-numeric: tabular-nums;
    }
    .modal__footer {
      display: flex;
      gap: 6px;
      align-items: center;
      padding: 10px 14px;
      border-top: 1px solid var(--c-border);
    }
    .modal__spacer {
      flex: 1;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EntryEditorComponent implements AfterViewInit {
  private readonly data = inject(DataService);
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly draft = input.required<EntryDraft>();
  /** Show the entry without letting it change (locked period). */
  readonly readonly = input(false);
  readonly saved = output<EntryDraft>();
  readonly cancelled = output<void>();
  readonly deleted = output<string>();

  /** Local, editable copy of the draft (reset whenever the input changes). */
  protected readonly form = linkedSignal(() => ({ ...this.draft() }));
  protected readonly parseTags = parseTags;

  /** Focus as soon as the view exists; openers render synchronously (see `renderNow`). */
  ngAfterViewInit(): void {
    // A read-only (disabled) form has nothing to type into: focus Close instead.
    (this.host.nativeElement as HTMLElement)
      .querySelector<HTMLElement>('select:enabled, input:enabled, .modal__footer .btn--primary')
      ?.focus();
  }

  protected readonly nodeOptions = computed(() => {
    const tree = this.data.tree();
    const current = this.form().nodeId;
    return tree.nodes
      .filter((n) => n.id === current || (!n.archived && !tree.hasArchivedAncestor(n.id)))
      .map((n) => ({ id: n.id, label: tree.pathLabel(n.id) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  });

  protected readonly startInput = computed(() => toLocalInput(this.form().start));
  protected readonly endInput = computed(() => toLocalInput(this.form().end));
  protected readonly durationHours = computed(() => Math.round(((this.form().end - this.form().start) / MS_PER_HOUR) * 100) / 100);
  protected readonly durationLabel = computed(() => formatHM(Math.max(0, (this.form().end - this.form().start) / 1000)));

  protected readonly validationError = computed(() => {
    const f = this.form();
    if (!f.nodeId) return 'Pick a node.';
    if (!(f.end > f.start)) return 'End must be after start.';
    return null;
  });

  protected patch(p: Partial<EntryDraft>): void {
    this.form.update((f) => ({ ...f, ...p }));
  }

  /** Changing the start keeps the duration (moves the entry). */
  protected setStart(value: string): void {
    const t = fromLocalInput(value);
    if (t == null) return;
    this.form.update((f) => ({ ...f, start: t, end: t + (f.end - f.start) }));
  }

  protected readonly nodeBillable = computed(() => {
    const id = this.form().nodeId;
    return id ? this.data.tree().billableOf(id) : true;
  });

  protected setBillable(value: string): void {
    this.patch({ billable: value === 'yes' ? true : value === 'no' ? false : undefined });
  }

  protected setEnd(value: string): void {
    const t = fromLocalInput(value);
    if (t != null) this.patch({ end: t });
  }

  protected setDurationHours(h: number): void {
    if (Number.isFinite(h) && h > 0) this.form.update((f) => ({ ...f, end: f.start + Math.round(h * MS_PER_HOUR) }));
  }

  protected trySave(): void {
    if (!this.validationError()) this.saved.emit({ ...this.form() });
  }
}
