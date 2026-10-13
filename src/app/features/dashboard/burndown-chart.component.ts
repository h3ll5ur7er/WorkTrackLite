import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Budget, TimeEntry } from '../../core/models';
import { chartGeometry } from '../../domain/burndown';

/** Tiny inline-SVG burn-down / burn-up chart for dashboard cards. Geometry lives in domain/burndown.ts. */
@Component({
  selector: 'app-burndown-chart',
  template: `
    @let g = geometry();
    <svg [attr.viewBox]="'0 0 ' + W + ' ' + H" preserveAspectRatio="none" class="bd" focusable="false">
      @if (g.referenceY !== null) {
        <line x1="0" [attr.x2]="W" [attr.y1]="g.referenceY" [attr.y2]="g.referenceY" class="bd__ref" />
      }
      @if (g.softY !== null) {
        <line x1="0" [attr.x2]="W" [attr.y1]="g.softY" [attr.y2]="g.softY" class="bd__soft" />
      }
      <path [attr.d]="g.area" class="bd__area" [class.bd__area--over]="g.overBudget" />
      <polyline [attr.points]="g.line" class="bd__line" [class.bd__line--over]="g.overBudget" />
    </svg>
  `,
  styles: `
    :host {
      display: block;
      width: 100%;
      height: 100%;
    }
    .bd {
      width: 100%;
      height: 100%;
      display: block;
    }
    .bd__ref {
      stroke: var(--c-fg-3);
      stroke-width: 1;
      stroke-dasharray: 3 3;
      opacity: 0.5;
      vector-effect: non-scaling-stroke;
    }
    .bd__soft {
      stroke: var(--c-warn);
      stroke-width: 1;
      stroke-dasharray: 2 4;
      opacity: 0.7;
      vector-effect: non-scaling-stroke;
    }
    .bd__line {
      fill: none;
      stroke: var(--c-accent);
      stroke-width: 1.5;
      vector-effect: non-scaling-stroke;
    }
    .bd__line--over {
      stroke: var(--c-danger);
    }
    .bd__area {
      fill: var(--c-accent);
      opacity: 0.15;
    }
    .bd__area--over {
      fill: var(--c-danger);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BurndownChartComponent {
  readonly entries = input<readonly TimeEntry[]>([]);
  readonly budget = input<Budget>({ type: 'none', seconds: 0 });
  /** Pass a minute-resolution clock; the chart does not need per-second updates. */
  readonly now = input<number>(Date.now());

  protected readonly W = 100;
  protected readonly H = 40;
  protected readonly geometry = computed(() => chartGeometry(this.entries(), this.budget(), this.now(), this.W, this.H));
}
