import { TimeEntry } from '../core/models';
import { BudgetReport, reportForBudget } from './budget';
import { TreeIndex, liveSubtreeSeconds } from './tree';

export type AlertLevel = 'ok' | 'soft' | 'over';

const RANK: Record<AlertLevel, number> = { ok: 0, soft: 1, over: 2 };

export function alertLevel(r: BudgetReport): AlertLevel {
  return r.overBudget ? 'over' : r.softBreached ? 'soft' : 'ok';
}

/** Current level of every live (non-archived) node that has a budget. */
export function budgetLevels(
  tree: TreeIndex,
  closed: ReadonlyMap<string, number>,
  running: TimeEntry | null,
  now: number,
): Map<string, AlertLevel> {
  const out = new Map<string, AlertLevel>();
  for (const n of tree.nodes) {
    if (n.budget.type === 'none' || n.archived || tree.hasArchivedAncestor(n.id)) continue;
    out.set(n.id, alertLevel(reportForBudget(n.budget, liveSubtreeSeconds(tree, closed, n.id, running, now))));
  }
  return out;
}

export interface AlertStep {
  /** Node ids that reached a higher level than last time, with that level. */
  raised: { nodeId: string; level: AlertLevel }[];
  /** What to remember for next time (only nodes above `ok`). */
  remembered: Record<string, AlertLevel>;
}

/**
 * Compares current levels with the ones already announced. Only a rise is
 * announced (ok → soft, soft → over, ok → over); a level seen to drop (budget
 * raised, entries deleted) is forgotten, so crossing it again alerts again.
 * Nodes missing from `current` (archived, or data not loaded yet, e.g. during a
 * restore) keep what was announced.
 */
export function alertStep(announced: Readonly<Record<string, AlertLevel>>, current: ReadonlyMap<string, AlertLevel>): AlertStep {
  const raised: AlertStep['raised'] = [];
  const remembered: Record<string, AlertLevel> = {};
  for (const [nodeId, level] of Object.entries(announced)) if (!current.has(nodeId)) remembered[nodeId] = level;
  for (const [nodeId, level] of current) {
    if (level === 'ok') continue;
    remembered[nodeId] = level;
    if (RANK[level] > RANK[announced[nodeId] ?? 'ok']) raised.push({ nodeId, level });
  }
  return { raised, remembered };
}
