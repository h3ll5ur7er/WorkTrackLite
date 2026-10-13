import { TimeEntry } from '../core/models';

/**
 * Given several running entries, returns copies of all but the newest with an
 * `end` set to the start of the newest one (they were started by accident).
 */
export function closeAllButNewest(open: readonly TimeEntry[]): TimeEntry[] {
  if (open.length < 2) return [];
  const sorted = [...open].sort((a, b) => b.start - a.start);
  const newest = sorted[0];
  return sorted.slice(1).map((e) => ({ ...e, end: Math.max(e.start, newest.start) }));
}
