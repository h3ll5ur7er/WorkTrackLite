import { Absence, AbsenceKind, TimeEntry, WorkTime } from '../core/models';
import { clipToRange } from './reports';
import { addDays, fromDateKey, startOfDay, startOfWeek, toDateKey } from './time';

export const ABSENCE_KINDS: { id: AbsenceKind; label: string }[] = [
  { id: 'vacation', label: 'Vacation' },
  { id: 'sick', label: 'Sick' },
  { id: 'holiday', label: 'Public holiday' },
  { id: 'other', label: 'Other absence' },
];

export const DEFAULT_WORK_HOURS = [0, 8, 8, 8, 8, 8, 0];

/** Seconds expected on a day: its weekday's hours, less a full or half absence. */
export function targetSeconds(dayStart: number, work: WorkTime, absences: ReadonlyMap<string, Absence>): number {
  const base = (work.hours[new Date(dayStart).getDay()] ?? 0) * 3600;
  const a = absences.get(toDateKey(dayStart));
  return Math.round(a ? (a.half ? base / 2 : 0) : base);
}

/** Tracked seconds per local day (key: local midnight), entries split at midnight. */
export function workedByDay(entries: Iterable<TimeEntry>, from: number, to: number, now: number): Map<number, number> {
  const out = new Map<number, number>();
  for (const p of clipToRange(entries, { from, to }, now)) {
    for (let day = startOfDay(p.from); day < p.to; day = addDays(day, 1)) {
      const a = Math.max(p.from, day);
      const b = Math.min(p.to, addDays(day, 1));
      if (b > a) out.set(day, (out.get(day) ?? 0) + Math.floor((b - a) / 1000));
    }
  }
  return out;
}

export interface WorkSummary {
  today: { worked: number; target: number };
  /** The whole week containing today (target for all its days, worked so far). */
  week: { worked: number; target: number };
  /** Carry-over plus worked − target for every day from `from` up to yesterday. */
  balance: number;
}

/**
 * Today, this week and the overtime balance. `entries` should already be
 * limited to working time. Today is left out of the balance until it is over,
 * so the balance does not dip every morning.
 */
export function workSummary(
  entries: readonly TimeEntry[],
  work: WorkTime,
  absences: readonly Absence[],
  now: number,
  weekStartsOn = 1,
): WorkSummary {
  const byKey = new Map(absences.map((a) => [a.date, a]));
  const today = startOfDay(now);
  const weekStart = startOfWeek(now, weekStartsOn);
  const weekEnd = addDays(weekStart, 7);
  const first = fromDateKey(work.from) ?? today;
  const worked = workedByDay(entries, Math.min(first, weekStart), weekEnd, now);
  const w = (day: number) => worked.get(day) ?? 0;

  let balance = work.carrySeconds ?? 0;
  for (let day = first; day < today; day = addDays(day, 1)) balance += w(day) - targetSeconds(day, work, byKey);

  const week = { worked: 0, target: 0 };
  for (let day = weekStart; day < weekEnd; day = addDays(day, 1)) {
    week.worked += w(day);
    week.target += targetSeconds(day, work, byKey);
  }
  return { today: { worked: w(today), target: targetSeconds(today, work, byKey) }, week, balance };
}

/** One absence per day in `[fromKey, toKey]` that has target hours (weekends etc. are skipped). */
export function absenceDays(fromKey: string, toKey: string, kind: AbsenceKind, half: boolean, work: WorkTime): Absence[] {
  const from = fromDateKey(fromKey);
  const to = fromDateKey(toKey);
  if (from == null || to == null || to < from) return [];
  const out: Absence[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    if ((work.hours[new Date(day).getDay()] ?? 0) > 0) out.push({ date: toDateKey(day), kind, ...(half ? { half: true } : {}) });
  }
  return out;
}
