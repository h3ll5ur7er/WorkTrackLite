import { ChangeDetectionStrategy, ChangeDetectorRef, Component, computed, effect, inject, signal } from '@angular/core';
import { DataService } from '../../core/data.service';
import { TimerService } from '../../core/timer.service';
import { TimeEntry } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { formatHMS } from '../../domain/format';
import { renderNow } from '../render-now';
import { RunningNoteComponent } from './running-note.component';

@Component({
  selector: 'app-timer-bar',
  imports: [RunningNoteComponent],
  template: `
    @if (editing(); as e) {
      <app-running-note [entry]="e" (saved)="saveNote(e, $event)" (cancelled)="closeNote()" />
    }
    <div class="bar" [class.bar--running]="timer.running()">
      <div class="bar__left">
        @if (timer.running(); as r) {
          <span class="bar__dot" aria-hidden="true"></span>
          <span class="bar__name" [title]="activePath()">{{ activeName() }}</span>
          <span class="bar__elapsed" role="timer" aria-label="Elapsed time">{{ elapsed() }}</span>
          <button
            #noteBtn
            type="button"
            class="btn btn--ghost btn--small bar__note"
            [attr.aria-expanded]="!!editing()"
            [attr.aria-label]="r.note ? 'Edit note: ' + r.note : 'Add a note'"
            [title]="r.note ? 'Edit note' : 'Add a note or tags'"
            (click)="editing() ? closeNote() : openNote(r, noteBtn)"
          >
            <span aria-hidden="true">✎</span>
            <span class="bar__note-text">{{ r.note || 'Add note' }}</span>
            @for (t of r.tags ?? []; track t) {
              <span class="bar__tag">#{{ t }}</span>
            }
          </button>
        } @else {
          <span class="bar__idle">No active timer</span>
        }
      </div>
      <div class="bar__right">
        @if (timer.running()) {
          <button type="button" class="btn btn--danger" (click)="timer.stop()">■ Stop</button>
        } @else if (lastNodeName(); as last) {
          <button type="button" class="btn" (click)="timer.resumeLast()" [title]="'Start a new timer on ' + last">
            ▶ Resume {{ last }}
          </button>
        }
      </div>
    </div>
  `,
  styles: `
    .bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      padding: 8px 14px;
      background: var(--c-bg-2);
      border-top: 1px solid var(--c-border);
      font-variant-numeric: tabular-nums;
    }
    .bar--running {
      background: var(--c-accent-bg);
    }
    .bar__left {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
      flex: 1;
    }
    .bar__name {
      /* The node name keeps its space; the note preview shrinks first. */
      flex: 0 1 auto;
      min-width: 4ch;
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .bar__dot {
      flex: 0 0 auto;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--c-danger);
      animation: pulse 1.2s ease-in-out infinite;
    }
    .bar__elapsed {
      color: var(--c-accent);
      font-weight: 600;
    }
    .bar__note {
      flex: 0 4 auto;
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      max-width: 50%;
      color: var(--c-fg-3);
    }
    .bar__note-text {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
    }
    .bar__tag {
      font-size: 0.75rem;
      color: var(--c-accent);
      white-space: nowrap;
    }
    @media (max-width: 720px) {
      .bar__note {
        max-width: none;
      }
      .bar__tag {
        display: none;
      }
    }
    .bar__idle {
      color: var(--c-fg-3);
    }
    .bar__right {
      display: flex;
      gap: 6px;
    }
    @keyframes pulse {
      0%,
      100% {
        opacity: 1;
      }
      50% {
        opacity: 0.4;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .bar__dot {
        animation: none;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TimerBarComponent {
  private readonly data = inject(DataService);
  protected readonly timer = inject(TimerService);
  private readonly toast = inject(ToastService);
  private readonly cdr = inject(ChangeDetectorRef);

  /** The running entry whose note is being edited (a snapshot from when the form opened). */
  protected readonly editing = signal<TimeEntry | null>(null);
  private returnFocus: HTMLElement | null = null;

  constructor() {
    // Close the form if its timer stops or another one starts meanwhile (e.g. from another tab).
    effect(() => {
      const e = this.editing();
      if (e && this.timer.running()?.id !== e.id) this.editing.set(null);
    });
  }

  protected openNote(entry: TimeEntry, opener: HTMLElement): void {
    this.returnFocus = opener;
    this.editing.set(entry);
    renderNow(this.cdr);
  }

  protected closeNote(): void {
    this.editing.set(null);
    this.returnFocus?.focus();
  }

  protected async saveNote(entry: TimeEntry, v: { note: string | undefined; tags: string[] | undefined }): Promise<void> {
    try {
      await this.data.updateEntry(entry.id, v);
      this.closeNote();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  protected readonly elapsed = computed(() => formatHMS(this.timer.elapsedSeconds()));
  protected readonly activeName = computed(() => {
    const r = this.timer.running();
    return r ? (this.data.tree().get(r.nodeId)?.name ?? '(deleted)') : '';
  });
  protected readonly activePath = computed(() => {
    const r = this.timer.running();
    return r ? this.data.tree().pathLabel(r.nodeId) : '';
  });
  protected readonly lastNodeName = computed(() => {
    const n = this.data.tree().get(this.data.settings().lastNodeId);
    return n && !n.archived ? n.name : null;
  });
}
