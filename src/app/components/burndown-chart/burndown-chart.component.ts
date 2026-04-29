import { CommonModule } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { Budget, TimeEntry } from '../../data/models';
import { entryDurationSeconds } from '../../services/budget';

/**
 * Tiny inline-SVG chart used on dashboard cards.
 *  - fixed budget   → burndown line from `budget` down through 0 (negative on overshoot).
 *  - per_hour/none  → cumulative tracked seconds, counting up from 0.
 *
 * X axis: time. We pick a window from the first entry start (or now-7d if no
 * entries) to `max(now, lastEntryEnd)`. Y axis auto-scales with sensible
 * defaults so an empty chart still shows the budget reference line.
 */
@Component({
  selector: 'app-burndown-chart',
  imports: [CommonModule],
  template: `
    <svg [attr.viewBox]="'0 0 ' + W + ' ' + H" preserveAspectRatio="none" class="bd">
      <!-- zero / target reference line -->
      <line *ngIf="zeroY() !== null"
            [attr.x1]="0" [attr.x2]="W"
            [attr.y1]="zeroY()" [attr.y2]="zeroY()"
            class="bd__zero" />
      <!-- soft limit reference line (per-hour / none mode) -->
      <line *ngIf="softY() !== null"
            [attr.x1]="0" [attr.x2]="W"
            [attr.y1]="softY()" [attr.y2]="softY()"
            class="bd__soft" />
      <!-- area under curve -->
      <path *ngIf="areaPath()" [attr.d]="areaPath()" class="bd__area"
            [class.bd__area--over]="overBudget()" />
      <!-- main line -->
      <polyline *ngIf="linePoints()" [attr.points]="linePoints()" class="bd__line"
                [class.bd__line--over]="overBudget()" />
    </svg>
  `,
  styles: [`
    :host { display: block; width: 100%; height: 100%; }
    .bd { width: 100%; height: 100%; display: block; }
    .bd__zero { stroke: var(--c-fg-3); stroke-width: 1; stroke-dasharray: 3 3; opacity: 0.5; }
    .bd__soft { stroke: var(--c-warn); stroke-width: 1; stroke-dasharray: 2 4; opacity: 0.6; }
    .bd__line { fill: none; stroke: var(--c-accent); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
    .bd__line--over { stroke: var(--c-danger); }
    .bd__area { fill: var(--c-accent); opacity: 0.15; }
    .bd__area--over { fill: var(--c-danger); }
  `],
})
export class BurndownChartComponent {
  readonly entries = input<TimeEntry[]>([]);
  readonly budget = input<Budget>({ type: 'none', seconds: 0 });
  readonly now = input<number>(Date.now());

  readonly W = 100;
  readonly H = 40;

  /** Cumulative samples [{t, tracked}], including a final point at "now". */
  private readonly samples = computed(() => {
    const sorted = [...this.entries()]
      .filter(e => e.start != null)
      .sort((a, b) => a.start - b.start);
    const out: Array<{ t: number; tracked: number }> = [];
    let acc = 0;
    if (sorted.length === 0) {
      out.push({ t: this.now() - 7 * 24 * 3600 * 1000, tracked: 0 });
      out.push({ t: this.now(), tracked: 0 });
      return out;
    }
    out.push({ t: sorted[0].start, tracked: 0 });
    for (const e of sorted) {
      const end = e.end ?? this.now();
      acc += entryDurationSeconds(e, this.now());
      out.push({ t: end, tracked: acc });
    }
    if (out[out.length - 1].t < this.now()) {
      out.push({ t: this.now(), tracked: acc });
    }
    return out;
  });

  private readonly bounds = computed(() => {
    const s = this.samples();
    const tMin = s[0].t;
    const tMax = s[s.length - 1].t;
    const b = this.budget();
    const maxTracked = Math.max(...s.map(p => p.tracked));
    let yMin = 0;
    let yMax = 0;
    if (b.type === 'fixed') {
      const budgetS = Math.max(0, b.seconds || 0);
      const remainingMin = budgetS - maxTracked;
      yMin = Math.min(0, remainingMin) - 1;
      yMax = Math.max(budgetS, 1);
    } else {
      yMin = 0;
      yMax = Math.max(maxTracked, b.seconds || 0, 3600);
    }
    return { tMin, tMax, yMin, yMax };
  });

  private toX(t: number): number {
    const { tMin, tMax } = this.bounds();
    if (tMax === tMin) return this.W;
    return ((t - tMin) / (tMax - tMin)) * this.W;
  }
  private toY(v: number): number {
    const { yMin, yMax } = this.bounds();
    if (yMax === yMin) return this.H / 2;
    return this.H - ((v - yMin) / (yMax - yMin)) * this.H;
  }

  /** Y value to plot for a given cumulative tracked seconds. */
  private yFor(tracked: number): number {
    const b = this.budget();
    if (b.type === 'fixed') return this.toY((b.seconds || 0) - tracked);
    return this.toY(tracked);
  }

  readonly linePoints = computed(() =>
    this.samples().map(p => `${this.toX(p.t).toFixed(2)},${this.yFor(p.tracked).toFixed(2)}`).join(' ')
  );

  readonly areaPath = computed(() => {
    const pts = this.samples();
    if (!pts.length) return '';
    const baselineY = this.budget().type === 'fixed' ? this.toY(this.budget().seconds || 0) : this.toY(0);
    const head = `M ${this.toX(pts[0].t).toFixed(2)} ${baselineY.toFixed(2)}`;
    const line = pts.map(p => `L ${this.toX(p.t).toFixed(2)} ${this.yFor(p.tracked).toFixed(2)}`).join(' ');
    const tail = `L ${this.toX(pts[pts.length - 1].t).toFixed(2)} ${baselineY.toFixed(2)} Z`;
    return `${head} ${line} ${tail}`;
  });

  readonly zeroY = computed(() => {
    const b = this.budget();
    if (b.type === 'fixed') return this.toY(0);
    if (b.seconds > 0) return this.toY(b.seconds);
    return null;
  });

  readonly softY = computed(() => {
    const b = this.budget();
    if (!b.softLimit || b.softLimit <= 0) return null;
    if (b.type === 'fixed') return this.toY((b.seconds || 0) - b.softLimit);
    return this.toY(b.softLimit);
  });

  readonly overBudget = computed(() => {
    const b = this.budget();
    if (b.type === 'none' || !b.seconds) return false;
    const last = this.samples().at(-1);
    return !!last && last.tracked > b.seconds;
  });
}
