import { TimeEntry } from '../core/models';
import { MS_PER_MINUTE, addDays } from './time';

/** Entries further apart than this are not offered for merging (the gap would become tracked time). */
export const MERGE_MAX_GAP_MS = 15 * MS_PER_MINUTE;

/** The two halves of an entry split at `at`, or null if `at` is not strictly inside a closed entry. */
export function splitRanges(e: TimeEntry, at: number): { first: TimeEntry; second: Omit<TimeEntry, 'id'> } | null {
  if (e.end == null || at <= e.start || at >= e.end) return null;
  const second: Omit<TimeEntry, 'id'> & { id?: string } = { ...e, start: at };
  delete second.id;
  return { first: { ...e, end: at }, second };
}

/** Middle of a closed entry, rounded to the minute (and still strictly inside). */
export function midpoint(e: TimeEntry): number | null {
  if (e.end == null) return null;
  const at = e.start + Math.round((e.end - e.start) / 2 / MS_PER_MINUTE) * MS_PER_MINUTE;
  return at > e.start && at < e.end ? at : null;
}

export interface MergePlan {
  /** The combined entry; keeps the id of the earliest one. */
  merged: TimeEntry;
  removeIds: string[];
  /** Untracked time between the entries that the merge turns into tracked time. */
  gapMs: number;
}

/**
 * How to merge entries into one, or why they can't be: all must be closed,
 * on the same node, agree on billable, and follow each other with gaps of at
 * most `maxGapMs`. Overlaps are fine (the merged span counts them once).
 */
export function planMerge(entries: readonly TimeEntry[], maxGapMs = MERGE_MAX_GAP_MS): MergePlan | { error: string } {
  if (entries.length < 2) return { error: 'Select at least two entries.' };
  if (entries.some((e) => e.end == null)) return { error: 'A running timer cannot be merged.' };
  if (new Set(entries.map((e) => e.nodeId)).size > 1) return { error: 'Only entries on the same node can be merged.' };
  if (new Set(entries.map((e) => e.billable)).size > 1) return { error: 'Entries differ in billable; make them match first.' };
  const sorted = [...entries].sort((a, b) => a.start - b.start || a.end! - b.end!);
  let end = sorted[0].end!;
  let gapMs = 0;
  for (const e of sorted.slice(1)) {
    const gap = e.start - end;
    if (gap > maxGapMs) return { error: 'Entries are too far apart to merge.' };
    if (gap > 0) gapMs += gap;
    end = Math.max(end, e.end!);
  }
  const notes = unique(sorted.map((e) => e.note?.trim() ?? '').filter(Boolean));
  const tags = unique(sorted.flatMap((e) => e.tags ?? []));
  const merged: TimeEntry = { ...sorted[0], end, note: notes.join('; '), tags };
  if (!notes.length) delete merged.note;
  if (!tags.length) delete merged.tags;
  return { merged, removeIds: sorted.slice(1).map((e) => e.id), gapMs };
}

/** Closest closed entries on the same node right before and after `e` that could be merged with it. */
export function mergeNeighbors(
  all: readonly TimeEntry[],
  e: TimeEntry,
  maxGapMs = MERGE_MAX_GAP_MS,
): { prev: TimeEntry | null; next: TimeEntry | null } {
  let prev: TimeEntry | null = null;
  let next: TimeEntry | null = null;
  if (e.end == null) return { prev, next };
  for (const o of all) {
    if (o.id === e.id || o.end == null || o.nodeId !== e.nodeId || o.billable !== e.billable) continue;
    if (o.start <= e.start) {
      if (e.start - o.end <= maxGapMs && (!prev || o.start > prev.start)) prev = o;
    } else if (o.start - e.end <= maxGapMs && (!next || o.start < next.start)) {
      next = o;
    }
  }
  return { prev, next };
}

/**
 * Moves an entry by whole calendar days plus a fixed offset, keeping its
 * duration. Days go through `addDays`, so a DST change keeps the wall-clock time.
 */
export function shiftEntry(e: TimeEntry, dayShift: number, offsetMs: number): { start: number; end: number } {
  const start = addDays(e.start, dayShift) + offsetMs;
  return { start, end: start + (e.end ?? e.start) - e.start };
}

function unique<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

export interface CopyPlan {
  /** New closed entries (without ids) to add. */
  copies: (Pick<TimeEntry, 'nodeId' | 'start' | 'note' | 'tags' | 'billable'> & { end: number })[];
  /** Copies left out because the exact same entry already exists there. */
  duplicates: number;
  /** Copies that overlap an existing entry (added anyway; the calendar marks them). */
  overlaps: number;
}

/**
 * Copies the closed entries starting in `[from, to)` by `dayShift` calendar
 * days (wall-clock times kept across DST). Running timers are not copied.
 */
export function planCopy(all: readonly TimeEntry[], from: number, to: number, dayShift: number): CopyPlan {
  const plan: CopyPlan = { copies: [], duplicates: 0, overlaps: 0 };
  const closed = all.filter((e) => e.end != null);
  for (const e of closed) {
    if (e.start < from || e.start >= to) continue;
    const { start, end } = shiftEntry(e, dayShift, 0);
    if (closed.some((o) => o.nodeId === e.nodeId && o.start === start && o.end === end)) {
      plan.duplicates++;
      continue;
    }
    if (closed.some((o) => o.start < end && start < o.end!)) plan.overlaps++;
    const copy: CopyPlan['copies'][number] = { nodeId: e.nodeId, start, end };
    if (e.note) copy.note = e.note;
    if (e.tags?.length) copy.tags = e.tags;
    if (e.billable !== undefined) copy.billable = e.billable;
    plan.copies.push(copy);
  }
  return plan;
}
