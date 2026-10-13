import { Budget, TimeEntry } from '../core/models';

/** Duration (seconds) of an entry. Running entries are measured up to `now`. */
export function entryDurationSeconds(e: TimeEntry, now: number = Date.now()): number {
  const end = e.end ?? now;
  return Math.max(0, Math.floor((end - e.start) / 1000));
}

/** Sum of seconds tracked across the given entries. */
export function totalSeconds(entries: Iterable<TimeEntry>, now: number = Date.now()): number {
  let s = 0;
  for (const e of entries) s += entryDurationSeconds(e, now);
  return s;
}

export interface BudgetReport {
  type: Budget['type'];
  /** Budget / target seconds (0 when type is `none`). */
  budgetSeconds: number;
  trackedSeconds: number;
  /** `budget - tracked`; negative on overshoot. 0 for `none`. */
  remainingSeconds: number;
  /** tracked / budget (0 when there is no budget). */
  ratio: number;
  /** Soft limit reached but not yet over budget. */
  softBreached: boolean;
  /** Tracked time exceeds the budget / target. */
  overBudget: boolean;
}

export function reportForBudget(budget: Budget, trackedSeconds: number): BudgetReport {
  const budgetSeconds = budget.type === 'none' ? 0 : Math.max(0, budget.seconds || 0);
  const remainingSeconds = budget.type === 'none' ? 0 : budgetSeconds - trackedSeconds;
  const ratio = budgetSeconds > 0 ? trackedSeconds / budgetSeconds : 0;
  const overBudget = budgetSeconds > 0 && trackedSeconds > budgetSeconds;
  const softBreached =
    budget.type !== 'none' && !overBudget && !!budget.softLimit && budget.softLimit > 0 && trackedSeconds >= budget.softLimit;
  return { type: budget.type, budgetSeconds, trackedSeconds, remainingSeconds, ratio, softBreached, overBudget };
}
