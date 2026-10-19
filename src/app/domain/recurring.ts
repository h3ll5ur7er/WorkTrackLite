import { Absence, RecurringRule, TimeEntry } from '../core/models';
import { MS_PER_MINUTE, addDays, atWallClockMinutes, fromDateKey, toDateKey } from './time';

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const WORKDAYS = [1, 2, 3, 4, 5];

export interface Suggestion {
  /** `${ruleId}@yyyy-mm-dd`, also the key stored when skipped. */
  key: string;
  ruleId: string;
  nodeId: string;
  start: number;
  end: number;
  note?: string;
  tags?: string[];
}

export function occurrenceKey(ruleId: string, dayStart: number): string {
  return `${ruleId}@${toDateKey(dayStart)}`;
}

export interface SuggestionContext {
  entries: readonly TimeEntry[];
  skipped: ReadonlySet<string>;
  absences: ReadonlyMap<string, Absence>;
  /** Start of unlocked time (null: nothing locked). */
  lockEnd: number | null;
  /** Live (not archived) node? */
  usable: (nodeId: string) => boolean;
}

/**
 * Occurrences of the rules on the given days (local midnights) that still need
 * an answer: not skipped, not already covered by an entry on the same node
 * that overlaps it, not on a full-day absence, not in a locked period.
 */
export function suggestions(rules: readonly RecurringRule[], days: readonly number[], ctx: SuggestionContext): Suggestion[] {
  const out: Suggestion[] = [];
  for (const rule of rules) {
    if (rule.paused || !rule.minutes || !ctx.usable(rule.nodeId)) continue;
    const first = fromDateKey(rule.from) ?? -Infinity;
    for (const day of days) {
      if (day < first || !rule.weekdays.includes(new Date(day).getDay())) continue;
      const key = occurrenceKey(rule.id, day);
      if (ctx.skipped.has(key)) continue;
      const absence = ctx.absences.get(toDateKey(day));
      if (absence && !absence.half) continue;
      const start = atWallClockMinutes(day, rule.startMinutes);
      const end = start + rule.minutes * MS_PER_MINUTE;
      if (ctx.lockEnd != null && start < ctx.lockEnd) continue;
      const covered = ctx.entries.some((e) => e.nodeId === rule.nodeId && e.start < end && (e.end ?? Infinity) > start);
      if (covered) continue;
      out.push({
        key,
        ruleId: rule.id,
        nodeId: rule.nodeId,
        start,
        end,
        ...(rule.note ? { note: rule.note } : {}),
        ...(rule.tags?.length ? { tags: rule.tags } : {}),
      });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** A rule repeating a closed entry on the given weekdays, starting from the entry's day. */
export function ruleFromEntry(e: TimeEntry, weekdays: number[], id: string): RecurringRule {
  const d = new Date(e.start);
  const rule: RecurringRule = {
    id,
    nodeId: e.nodeId,
    weekdays: [...new Set(weekdays)].sort(),
    startMinutes: d.getHours() * 60 + d.getMinutes(),
    minutes: Math.max(1, Math.round(((e.end ?? e.start) - e.start) / MS_PER_MINUTE)),
    from: toDateKey(e.start),
  };
  if (e.note) rule.note = e.note;
  if (e.tags?.length) rule.tags = e.tags;
  return rule;
}

/** "Mon–Fri", "Tue", "Mon, Wed, Fri", "Every day". */
export function weekdaysLabel(weekdays: readonly number[], weekStartsOn = 1): string {
  const set = new Set(weekdays);
  if (set.size === 7) return 'Every day';
  const order = Array.from({ length: 7 }, (_, i) => (weekStartsOn + i) % 7).filter((d) => set.has(d));
  const short = (d: number) => WEEKDAY_NAMES[d].slice(0, 3);
  // A run of 3+ consecutive days (in week order) reads as a range.
  const all = Array.from({ length: 7 }, (_, i) => (weekStartsOn + i) % 7);
  const idx = order.map((d) => all.indexOf(d));
  const consecutive = idx.length >= 3 && idx.every((v, i) => i === 0 || v === idx[i - 1] + 1);
  return consecutive ? `${short(order[0])}–${short(order[order.length - 1])}` : order.map(short).join(', ');
}

/** Skipped keys from the last 90 days (older ones can never show again). */
export function pruneSkipped(keys: readonly string[], now: number): string[] {
  const cutoff = toDateKey(addDays(now, -90));
  return keys.filter((k) => (k.split('@')[1] ?? '') >= cutoff);
}
