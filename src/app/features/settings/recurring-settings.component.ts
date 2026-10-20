import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DataService } from '../../core/data.service';
import { uid } from '../../core/db';
import { RecurringRule } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { formatHM } from '../../domain/format';
import { WEEKDAY_NAMES, WORKDAYS, weekdaysLabel } from '../../domain/recurring';
import { startOfDay, toDateKey } from '../../domain/time';

/** Settings → Recurring entries: rules that show up as suggestions in the schedule. */
@Component({
  selector: 'app-recurring-settings',
  template: `
    <section class="panel" aria-labelledby="s-recurring">
      <h2 id="s-recurring">Recurring entries</h2>
      <p class="muted">
        They appear as dashed suggestions in the schedule; click one to add it or skip it. Quickest way to make one: right-click an entry →
        "Repeat every …".
      </p>
      @if (rules().length) {
        <ul class="rc__list" aria-label="Recurring entries">
          @for (r of rules(); track r.rule.id) {
            <li [class.rc__paused]="r.rule.paused">
              <span class="rc__when">{{ r.days }} {{ r.time }}</span>
              <span class="rc__what">{{ r.path }}{{ r.rule.note ? ' · ' + r.rule.note : '' }}</span>
              <button type="button" class="btn btn--small" (click)="togglePaused(r.rule)">{{ r.rule.paused ? 'Resume' : 'Pause' }}</button>
              <button
                type="button"
                class="btn btn--ghost btn--small"
                [attr.aria-label]="'Delete recurring entry ' + r.path"
                (click)="remove(r.rule)"
              >
                ×
              </button>
            </li>
          }
        </ul>
      }
      <form class="rc__add" aria-label="Add a recurring entry" (submit)="$event.preventDefault(); add()">
        <label class="field rc__node">
          <span>Node</span>
          <select (change)="nodeId.set($any($event.target).value)">
            <option value="" [selected]="!nodeId()">— select —</option>
            @for (o of nodeOptions(); track o.id) {
              <option [value]="o.id" [selected]="o.id === nodeId()">{{ o.label }}</option>
            }
          </select>
        </label>
        <fieldset class="rc__days">
          <legend>Days</legend>
          @for (d of orderedDays(); track d) {
            <label class="rc__day">
              <input type="checkbox" [checked]="days().includes(d)" (change)="toggleDay(d, $any($event.target).checked)" />
              {{ weekdayShort(d) }}
            </label>
          }
        </fieldset>
        <label class="field">
          <span>Start</span>
          <input type="time" [value]="start()" (input)="start.set($any($event.target).value)" />
        </label>
        <label class="field">
          <span>Minutes</span>
          <input type="number" min="1" max="1440" step="1" [value]="minutes()" (input)="minutes.set($any($event.target).valueAsNumber)" />
        </label>
        <label class="field rc__note">
          <span>Note (optional)</span>
          <input type="text" [value]="note()" (input)="note.set($any($event.target).value)" />
        </label>
        <button type="submit" class="btn btn--primary" [disabled]="!canAdd()">Add</button>
      </form>
    </section>
  `,
  styles: `
    .rc__list {
      list-style: none;
      margin: 0 0 12px;
      padding: 0;
    }
    .rc__list li {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px 12px;
      padding: 6px 0;
      border-bottom: 1px solid var(--c-border);
    }
    .rc__when {
      font-variant-numeric: tabular-nums;
      min-width: 11rem;
    }
    .rc__what {
      flex: 1 1 12rem;
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .rc__paused {
      opacity: 0.6;
    }
    .rc__add {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: 8px;
    }
    .rc__node {
      flex: 1 1 14rem;
    }
    .rc__note {
      flex: 1 1 10rem;
    }
    .rc__days {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 10px;
      border: 0;
      padding: 0;
      margin: 0;
    }
    .rc__days legend {
      font-size: 0.75rem;
      color: var(--c-fg-3);
      margin-bottom: 4px;
    }
    .rc__day {
      display: flex;
      align-items: center;
      gap: 3px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecurringSettingsComponent {
  private readonly data = inject(DataService);
  private readonly toast = inject(ToastService);

  private readonly weekStartsOn = computed(() => this.data.settings().weekStartsOn ?? 1);
  protected readonly orderedDays = computed(() => Array.from({ length: 7 }, (_, i) => (this.weekStartsOn() + i) % 7));
  protected readonly rules = computed(() => {
    const tree = this.data.tree();
    return (this.data.settings().recurring ?? []).map((rule) => {
      const h = Math.floor(rule.startMinutes / 60);
      const m = rule.startMinutes % 60;
      return {
        rule,
        days: weekdaysLabel(rule.weekdays, this.weekStartsOn()),
        time: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}, ${formatHM(rule.minutes * 60)}`,
        path: tree.get(rule.nodeId) ? tree.pathLabel(rule.nodeId) : '(deleted node)',
      };
    });
  });
  protected readonly nodeOptions = computed(() => {
    const tree = this.data.tree();
    return tree.nodes
      .filter((n) => !n.archived && !tree.hasArchivedAncestor(n.id))
      .map((n) => ({ id: n.id, label: tree.pathLabel(n.id) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  });

  protected readonly nodeId = signal('');
  protected readonly days = signal<number[]>([...WORKDAYS]);
  protected readonly start = signal('09:00');
  protected readonly minutes = signal(15);
  protected readonly note = signal('');
  protected readonly canAdd = computed(
    () => !!this.nodeId() && this.days().length > 0 && /^\d{2}:\d{2}$/.test(this.start()) && this.minutes() > 0,
  );

  protected weekdayShort(d: number): string {
    return WEEKDAY_NAMES[d].slice(0, 3);
  }

  protected toggleDay(d: number, on: boolean): void {
    this.days.update((ds) => (on ? [...new Set([...ds, d])] : ds.filter((x) => x !== d)));
  }

  protected async add(): Promise<void> {
    if (!this.canAdd()) return;
    const [h, m] = this.start().split(':').map(Number);
    const note = this.note().trim();
    const rule: RecurringRule = {
      id: uid(),
      nodeId: this.nodeId(),
      weekdays: [...this.days()].sort(),
      startMinutes: h * 60 + m,
      minutes: Math.round(this.minutes()),
      from: toDateKey(startOfDay(Date.now())),
      ...(note ? { note } : {}),
    };
    await this.data.saveRecurring(rule);
    this.nodeId.set('');
    this.note.set('');
    this.toast.show('Recurring entry added; it shows as suggestions in the schedule.');
  }

  protected togglePaused(rule: RecurringRule): Promise<unknown> {
    return this.data.saveRecurring({ ...rule, paused: rule.paused ? undefined : true });
  }

  protected async remove(rule: RecurringRule): Promise<void> {
    const before = await this.data.deleteRecurring(rule.id);
    this.toast.show('Recurring entry deleted', {
      action: { label: 'Undo', run: () => this.data.updateSettings({ recurring: before }) },
    });
  }
}
