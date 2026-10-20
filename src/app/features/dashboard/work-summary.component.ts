import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { WorkTimeService } from '../../core/worktime.service';
import { formatHM } from '../../domain/format';

/** Dashboard panel: today, this week and the overtime balance (when working time is on). */
@Component({
  selector: 'app-work-summary',
  imports: [RouterLink],
  template: `
    @if (wt.summary(); as s) {
      <section class="ws" aria-labelledby="ws-title">
        <h2 id="ws-title" class="visually-hidden">Working time</h2>
        <div class="ws__item">
          <span class="ws__label">Today</span>
          <span class="ws__value" data-testid="work-today"
            >{{ hm(s.today.worked) }} <small>of {{ hm(s.today.target) }}</small></span
          >
          <span class="ws__bar" aria-hidden="true"><span [style.width.%]="pct(s.today.worked, s.today.target)"></span></span>
        </div>
        <div class="ws__item">
          <span class="ws__label">This week</span>
          <span class="ws__value" data-testid="work-week"
            >{{ hm(s.week.worked) }} <small>of {{ hm(s.week.target) }}</small></span
          >
          <span class="ws__bar" aria-hidden="true"><span [style.width.%]="pct(s.week.worked, s.week.target)"></span></span>
        </div>
        <div class="ws__item" title="Overtime up to the end of yesterday, including the starting balance">
          <span class="ws__label">Balance</span>
          <span
            class="ws__value"
            data-testid="work-balance"
            [class.ws__value--minus]="s.balance < 0"
            [class.ws__value--plus]="s.balance > 0"
            >{{ signed() }}</span
          >
          <a class="ws__link" routerLink="/settings">Hours &amp; absences</a>
        </div>
      </section>
    }
  `,
  styles: `
    .ws {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
      padding: 10px 14px;
      background: var(--c-bg-2);
      border: 1px solid var(--c-border);
      border-radius: 10px;
    }
    .ws__item {
      display: flex;
      flex-direction: column;
      gap: 3px;
      min-width: 0;
    }
    .ws__label {
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--c-fg-3);
    }
    .ws__value {
      font-weight: 600;
      font-size: 1.1rem;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .ws__value small {
      font-weight: 400;
      font-size: 0.75rem;
      color: var(--c-fg-3);
    }
    .ws__value--plus {
      color: var(--c-ok);
    }
    .ws__value--minus {
      color: var(--c-danger);
    }
    .ws__bar {
      height: 4px;
      background: var(--c-bg);
      border-radius: 2px;
      overflow: hidden;
    }
    .ws__bar span {
      display: block;
      height: 100%;
      background: var(--c-accent);
    }
    .ws__link {
      font-size: 0.75rem;
      color: var(--c-fg-3);
    }
    @media (max-width: 520px) {
      .ws {
        gap: 8px;
        padding: 8px 10px;
      }
      .ws__value {
        font-size: 0.95rem;
      }
      .ws__value small {
        display: block;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkSummaryComponent {
  protected readonly wt = inject(WorkTimeService);
  protected readonly signed = computed(() => {
    const b = this.wt.summary()?.balance ?? 0;
    return (b > 0 ? '+' : '') + formatHM(b);
  });

  protected hm(seconds: number): string {
    return formatHM(seconds);
  }

  protected pct(part: number, whole: number): number {
    return whole > 0 ? Math.min(100, (part / whole) * 100) : part > 0 ? 100 : 0;
  }
}
