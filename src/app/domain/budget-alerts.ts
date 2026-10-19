import { BudgetReport } from './budget';

export type AlertLevel = 'ok' | 'soft' | 'over';

const RANK: Record<AlertLevel, number> = { ok: 0, soft: 1, over: 2 };

export function alertLevel(r: BudgetReport): AlertLevel {
  return r.overBudget ? 'over' : r.softBreached ? 'soft' : 'ok';
}

export interface AlertStep {
  /** Node ids that reached a higher level than last time, with that level. */
  raised: { nodeId: string; level: AlertLevel }[];
  /** What to remember for next time (only nodes above `ok`). */
  remembered: Record<string, AlertLevel>;
}

/**
 * Compares current levels with the ones already announced. Only a rise is
 * announced (ok → soft, soft → over, ok → over); a level that drops (budget
 * raised, entries deleted) is forgotten, so crossing it again alerts again.
 */
export function alertStep(announced: Readonly<Record<string, AlertLevel>>, current: ReadonlyMap<string, AlertLevel>): AlertStep {
  const raised: AlertStep['raised'] = [];
  const remembered: Record<string, AlertLevel> = {};
  for (const [nodeId, level] of current) {
    if (level === 'ok') continue;
    remembered[nodeId] = level;
    if (RANK[level] > RANK[announced[nodeId] ?? 'ok']) raised.push({ nodeId, level });
  }
  return { raised, remembered };
}
