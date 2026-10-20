import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DataService } from '../../core/data.service';
import { AbsenceKind, WorkTime } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { WorkTimeService } from '../../core/worktime.service';
import { formatHM } from '../../domain/format';
import { fromDateKey, startOfWeek, toDateKey } from '../../domain/time';
import { ABSENCE_KINDS, DEFAULT_WORK_HOURS, absenceDays } from '../../domain/worktime';

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Settings → Working time and Absences. */
@Component({
  selector: 'app-work-time-settings',
  template: `
    <section class="panel" aria-labelledby="s-work">
      <h2 id="s-work">Working time</h2>
      <label class="check-row">
        <input type="checkbox" [checked]="!!work()" (change)="setEnabled($any($event.target).checked)" />
        Track working hours and an overtime balance
      </label>
      @if (work(); as w) {
        <fieldset class="wt__days">
          <legend>Hours per day</legend>
          @for (d of orderedDays(); track d) {
            <label class="field">
              <span>{{ weekdayShort[d] }}</span>
              <input type="number" min="0" max="24" step="0.25" [value]="w.hours[d]" (change)="setHours(d, $any($event.target))" />
            </label>
          }
        </fieldset>
        <div class="grid">
          <label class="field">
            <span>Count the balance from</span>
            <input type="date" [value]="w.from" (change)="setFrom($any($event.target))" />
          </label>
          <label class="field">
            <span>Starting balance (hours, may be negative)</span>
            <input
              type="number"
              step="0.25"
              [value]="(w.carrySeconds ?? 0) / 3600"
              (change)="setCarry($any($event.target).valueAsNumber)"
            />
          </label>
        </div>
        <p class="muted">
          Weekly target {{ formatHM(weekTarget()) }}. Only time on nodes that count as working time is included (set per node in Manage;
          children inherit it).
        </p>
      }
    </section>

    @if (work()) {
      <section class="panel" aria-labelledby="s-absences">
        <h2 id="s-absences">Absences</h2>
        <form class="wt__add" aria-label="Add an absence" (submit)="$event.preventDefault(); addAbsence()">
          <label class="field">
            <span>From</span>
            <input type="date" required [value]="absFrom()" (input)="absFrom.set($any($event.target).value)" />
          </label>
          <label class="field">
            <span>To (inclusive)</span>
            <input type="date" [value]="absTo()" (input)="absTo.set($any($event.target).value)" />
          </label>
          <label class="field">
            <span>Kind</span>
            <select (change)="absKind.set($any($event.target).value)">
              @for (k of kinds; track k.id) {
                <option [value]="k.id" [selected]="absKind() === k.id">{{ k.label }}</option>
              }
            </select>
          </label>
          <label class="check-row wt__half">
            <input type="checkbox" [checked]="absHalf()" (change)="absHalf.set($any($event.target).checked)" />
            Half day
          </label>
          <button type="submit" class="btn btn--primary" [disabled]="!absFrom()">Add</button>
        </form>
        @if (absences().length) {
          <ul class="wt__list" aria-label="Absences">
            @for (a of absences(); track a.date) {
              <li>
                <span class="wt__date">{{ dayLabel(a.date) }}</span>
                <span>{{ kindLabel(a.kind) }}{{ a.half ? ' (half day)' : '' }}</span>
                <button
                  type="button"
                  class="btn btn--ghost btn--small"
                  [attr.aria-label]="'Remove absence on ' + dayLabel(a.date)"
                  (click)="remove(a.date)"
                >
                  ×
                </button>
              </li>
            }
          </ul>
        } @else {
          <p class="muted">No absences yet. Weekends and other days with 0 hours are skipped automatically.</p>
        }
      </section>
    }
  `,
  styles: `
    .wt__days {
      display: grid;
      grid-template-columns: repeat(7, minmax(56px, 1fr));
      gap: 6px;
      border: 0;
      padding: 0;
      margin: 8px 0;
    }
    .wt__days legend {
      font-size: 0.75rem;
      color: var(--c-fg-3);
      margin-bottom: 4px;
    }
    .wt__days input {
      width: 100%;
      box-sizing: border-box;
    }
    .wt__add {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: 8px;
      margin-bottom: 10px;
    }
    .wt__half {
      padding-bottom: 6px;
    }
    .wt__list {
      list-style: none;
      margin: 0;
      padding: 0;
      max-height: 280px;
      overflow-y: auto;
    }
    .wt__list li {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 4px 0;
      border-bottom: 1px solid var(--c-border);
    }
    .wt__date {
      min-width: 9rem;
      font-variant-numeric: tabular-nums;
    }
    .wt__list button {
      margin-left: auto;
    }
    @media (max-width: 520px) {
      .wt__days {
        grid-template-columns: repeat(4, 1fr);
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkTimeSettingsComponent {
  private readonly data = inject(DataService);
  private readonly toast = inject(ToastService);
  private readonly wt = inject(WorkTimeService);

  protected readonly formatHM = formatHM;
  protected readonly weekdayShort = WEEKDAY_SHORT;
  protected readonly kinds = ABSENCE_KINDS;
  protected readonly work = this.wt.work;
  /** Newest first. */
  protected readonly absences = computed(() => [...this.wt.absences()].reverse());
  protected readonly orderedDays = computed(() => {
    const first = this.data.settings().weekStartsOn ?? 1;
    return Array.from({ length: 7 }, (_, i) => (first + i) % 7);
  });
  protected readonly weekTarget = computed(() => (this.work()?.hours ?? []).reduce((s, h) => s + h * 3600, 0));

  protected readonly absFrom = signal('');
  protected readonly absTo = signal('');
  protected readonly absKind = signal<AbsenceKind>('vacation');
  protected readonly absHalf = signal(false);

  private defaults(): WorkTime {
    return { hours: [...DEFAULT_WORK_HOURS], from: toDateKey(startOfWeek(Date.now(), this.data.settings().weekStartsOn ?? 1)) };
  }

  protected async setEnabled(on: boolean): Promise<void> {
    const before = await this.data.updateWorkTime(on ? {} : null, this.defaults());
    if (!on && before) {
      this.toast.show('Working time is off', { action: { label: 'Undo', run: () => this.data.updateWorkTime(before, before) } });
    }
  }

  protected setHours(day: number, input: HTMLInputElement): Promise<unknown> {
    const v = input.valueAsNumber;
    const hours = [...(this.work()?.hours ?? DEFAULT_WORK_HOURS)];
    hours[day] = Number.isFinite(v) ? Math.min(24, Math.max(0, v)) : 0;
    input.value = String(hours[day]);
    return this.data.updateWorkTime({ hours }, this.defaults());
  }

  protected setFrom(input: HTMLInputElement): Promise<unknown> | void {
    if (fromDateKey(input.value) == null) {
      input.value = this.work()?.from ?? '';
      return;
    }
    return this.data.updateWorkTime({ from: input.value }, this.defaults());
  }

  protected setCarry(hours: number): Promise<unknown> {
    return this.data.updateWorkTime({ carrySeconds: Number.isFinite(hours) ? Math.round(hours * 3600) : 0 }, this.defaults());
  }

  protected async addAbsence(): Promise<void> {
    const work = this.work();
    if (!work) return;
    const days = absenceDays(this.absFrom(), this.absTo() || this.absFrom(), this.absKind(), this.absHalf(), work);
    if (!days.length) {
      this.toast.error('No working days in that range (days with 0 hours are skipped).');
      return;
    }
    const before = await this.data.changeAbsences(days);
    this.absFrom.set('');
    this.absTo.set('');
    this.absHalf.set(false);
    this.toast.show(`Added ${days.length} ${days.length === 1 ? 'day' : 'days'} of ${this.kindLabel(this.absKind()).toLowerCase()}`, {
      action: { label: 'Undo', run: () => this.data.updateSettings({ absences: before.length ? before : undefined }) },
    });
  }

  protected async remove(date: string): Promise<void> {
    const before = await this.data.changeAbsences([], [date]);
    this.toast.show(`Removed the absence on ${this.dayLabel(date)}`, {
      action: { label: 'Undo', run: () => this.data.updateSettings({ absences: before }) },
    });
  }

  protected dayLabel(key: string): string {
    const ms = fromDateKey(key);
    return ms == null
      ? key
      : new Date(ms).toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
  }

  protected kindLabel(kind: AbsenceKind): string {
    return ABSENCE_KINDS.find((k) => k.id === kind)?.label ?? kind;
  }
}
