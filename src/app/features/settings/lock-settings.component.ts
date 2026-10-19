import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DataService } from '../../core/data.service';
import { ToastService } from '../../core/toast.service';
import { addDays, fromDateKey, startOfDay, toDateKey } from '../../domain/time';

/** Settings → Locked period: make finished (e.g. invoiced) time read-only. */
@Component({
  selector: 'app-lock-settings',
  template: `
    <section class="panel" aria-labelledby="s-lock">
      <h2 id="s-lock">Locked period</h2>
      @if (lockedUntil(); as until) {
        <p data-testid="lock-state">
          🔒 Entries up to <strong>{{ label(until) }}</strong> are locked: they cannot be added, changed or deleted.
        </p>
      } @else {
        <p class="muted">Nothing is locked. Lock a period after invoicing or reporting it, so it cannot change by accident.</p>
      }
      <form class="row lock__form" aria-label="Lock a period" (submit)="$event.preventDefault(); lock(date())">
        <label class="field">
          <span>Lock everything up to and including</span>
          <input type="date" [max]="yesterday()" [value]="date()" (input)="date.set($any($event.target).value)" />
        </label>
        <button type="submit" class="btn btn--primary" [disabled]="!date()">Lock</button>
        <button type="button" class="btn" (click)="lock(endOfLastMonth())">Lock up to the end of last month</button>
        @if (lockedUntil()) {
          <button type="button" class="btn btn--ghost" (click)="unlock()">Unlock</button>
        }
      </form>
    </section>
  `,
  styles: `
    .lock__form {
      align-items: flex-end;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LockSettingsComponent {
  private readonly data = inject(DataService);
  private readonly toast = inject(ToastService);

  protected readonly lockedUntil = computed(() => this.data.settings().lockedUntil);
  protected readonly date = signal('');
  protected readonly yesterday = signal(toDateKey(addDays(startOfDay(Date.now()), -1)));

  protected endOfLastMonth(): string {
    const d = new Date(startOfDay(Date.now()));
    d.setDate(0); // last day of the previous month
    return toDateKey(d.getTime());
  }

  protected async lock(key: string): Promise<void> {
    try {
      const before = await this.data.setLockedUntil(key);
      this.date.set('');
      this.toast.show(`Locked everything up to ${this.label(key)}`, {
        action: { label: 'Undo', run: () => this.data.setLockedUntil(before) },
      });
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  protected async unlock(): Promise<void> {
    const before = await this.data.setLockedUntil(undefined);
    this.toast.show('Unlocked', { action: { label: 'Undo', run: () => this.data.setLockedUntil(before) } });
  }

  protected label(key: string): string {
    const ms = fromDateKey(key);
    return ms == null ? key : new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  }
}
