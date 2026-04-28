import { Budget, Node, TimeEntry } from '../data/models';

/** Returns the duration (seconds) of an entry. If still running, uses `now`. */
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
  /** Total budget seconds (0 if not applicable). */
  budgetSeconds: number;
  /** Seconds tracked against the node (and its descendants when computed by caller). */
  trackedSeconds: number;
  /**
   * Remaining seconds. For `fixed` this is `budget - tracked` (may be negative).
   * For `per_hour` this is `budget - tracked` as a soft target (may be negative).
   * For `none` this is 0.
   */
  remainingSeconds: number;
  /** 0..1+ ratio of tracked vs budget. 0 when budget is 0. */
  ratio: number;
  /** True when soft limit reached (but not yet over budget). */
  softBreached: boolean;
  /** True when over the hard budget (tracked > budget). */
  overBudget: boolean;
}

export function reportForBudget(budget: Budget, trackedSeconds: number): BudgetReport {
  const budgetSeconds = budget.type === 'none' ? 0 : Math.max(0, budget.seconds || 0);
  const remainingSeconds = budget.type === 'none' ? 0 : budgetSeconds - trackedSeconds;
  const ratio = budgetSeconds > 0 ? trackedSeconds / budgetSeconds : 0;
  const overBudget = budgetSeconds > 0 && trackedSeconds > budgetSeconds;
  const softBreached =
    !overBudget &&
    !!budget.softLimit &&
    budget.softLimit > 0 &&
    trackedSeconds >= budget.softLimit;
  return { type: budget.type, budgetSeconds, trackedSeconds, remainingSeconds, ratio, softBreached, overBudget };
}

/** Build a parent → children map for a flat node list. */
export function indexChildren(nodes: Iterable<Node>): Map<string | null, Node[]> {
  const map = new Map<string | null, Node[]>();
  for (const n of nodes) {
    const arr = map.get(n.parentId) ?? [];
    arr.push(n);
    map.set(n.parentId, arr);
  }
  for (const arr of map.values()) arr.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  return map;
}

/** Returns ids of `nodeId` and all of its descendants. */
export function descendantIds(nodeId: string, childrenByParent: Map<string | null, Node[]>): string[] {
  const out: string[] = [nodeId];
  const stack = [nodeId];
  while (stack.length) {
    const id = stack.pop()!;
    const kids = childrenByParent.get(id) ?? [];
    for (const k of kids) {
      out.push(k.id);
      stack.push(k.id);
    }
  }
  return out;
}
