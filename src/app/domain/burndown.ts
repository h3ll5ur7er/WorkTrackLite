import { Budget, TimeEntry } from '../core/models';
import { entryDurationSeconds } from './budget';

export interface ChartGeometry {
  /** SVG polyline points ("x,y x,y …"). */
  line: string;
  /** Closed SVG path for the area under the line. */
  area: string;
  /** y of the 0 line (fixed) or the target line (target), if any. */
  referenceY: number | null;
  /** y of the soft-limit line, if any. */
  softY: number | null;
  overBudget: boolean;
}

/**
 * Geometry for the small dashboard chart, in a `width × height` viewBox.
 *  - fixed budget → remaining time, burning down from the budget (negative on overshoot).
 *  - target/none  → cumulative tracked time counting up from 0.
 * X spans from the first entry (or 7 days ago when empty) to `now`.
 */
export function chartGeometry(entries: readonly TimeEntry[], budget: Budget, now: number, width = 100, height = 40): ChartGeometry {
  // Cumulative tracked seconds sampled at each entry's end, in end order.
  const done = [...entries]
    .map((e) => ({ end: e.end ?? now, start: e.start, seconds: entryDurationSeconds(e, now) }))
    .sort((a, b) => a.end - b.end);
  const samples: { t: number; tracked: number }[] = [];
  if (!done.length) {
    samples.push({ t: now - 7 * 86_400_000, tracked: 0 }, { t: now, tracked: 0 });
  } else {
    samples.push({ t: Math.min(...done.map((d) => d.start)), tracked: 0 });
    let acc = 0;
    for (const d of done) {
      acc += d.seconds;
      samples.push({ t: d.end, tracked: acc });
    }
    if (samples[samples.length - 1].t < now) samples.push({ t: now, tracked: acc });
  }

  const tMin = samples[0].t;
  const tMax = samples[samples.length - 1].t;
  const maxTracked = samples[samples.length - 1].tracked;
  const budgetS = budget.type === 'none' ? 0 : Math.max(0, budget.seconds || 0);
  const fixed = budget.type === 'fixed';
  const value = (tracked: number) => (fixed ? budgetS - tracked : tracked);
  const yMin = fixed ? Math.min(0, budgetS - maxTracked) : 0;
  const yMax = fixed ? Math.max(budgetS, 1) : Math.max(maxTracked, budgetS, 3600);

  const x = (t: number) => (tMax === tMin ? width : ((t - tMin) / (tMax - tMin)) * width);
  const y = (v: number) => (yMax === yMin ? height / 2 : height - ((v - yMin) / (yMax - yMin)) * height);
  const fmt = (n: number) => n.toFixed(2);

  const pts = samples.map((p) => [x(p.t), y(value(p.tracked))] as const);
  const baseline = y(value(0));
  const line = pts.map(([px, py]) => `${fmt(px)},${fmt(py)}`).join(' ');
  const area =
    `M ${fmt(pts[0][0])} ${fmt(baseline)} ` +
    pts.map(([px, py]) => `L ${fmt(px)} ${fmt(py)}`).join(' ') +
    ` L ${fmt(pts[pts.length - 1][0])} ${fmt(baseline)} Z`;

  let referenceY: number | null = null;
  if (fixed) referenceY = y(0);
  else if (budgetS > 0) referenceY = y(budgetS);
  const soft = budget.softLimit && budget.softLimit > 0 && budget.type !== 'none' ? budget.softLimit : null;
  const softY = soft == null ? null : y(value(soft));

  return { line, area, referenceY, softY, overBudget: budgetS > 0 && maxTracked > budgetS };
}
