import { TimeEntry } from '../core/models';
import { addDays, startOfDay, startOfWeek } from './time';
import { TreeIndex } from './tree';

/** [from, to) in epoch ms, both local midnights. */
export interface DateRange {
  from: number;
  to: number;
}

export type RangePreset = 'this-week' | 'last-week' | 'this-month' | 'last-month' | 'last-30-days';

export function presetRange(preset: RangePreset, now: number, weekStartsOn = 1): DateRange {
  const today = startOfDay(now);
  switch (preset) {
    case 'this-week': {
      const from = startOfWeek(now, weekStartsOn);
      return { from, to: addDays(from, 7) };
    }
    case 'last-week': {
      const to = startOfWeek(now, weekStartsOn);
      return { from: addDays(to, -7), to };
    }
    case 'this-month': {
      const d = new Date(today);
      const from = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
      return { from, to: new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime() };
    }
    case 'last-month': {
      const d = new Date(today);
      return { from: new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime(), to: new Date(d.getFullYear(), d.getMonth(), 1).getTime() };
    }
    case 'last-30-days':
      return { from: addDays(today, -29), to: addDays(today, 1) };
  }
}

/** The part of an entry that falls inside a range (running entries count up to `now`). */
export interface Piece {
  entry: TimeEntry;
  from: number;
  to: number;
  seconds: number;
}

export function clipToRange(entries: Iterable<TimeEntry>, range: DateRange, now: number): Piece[] {
  const out: Piece[] = [];
  for (const entry of entries) {
    const from = Math.max(entry.start, range.from);
    const to = Math.min(entry.end ?? now, range.to);
    if (to > from) out.push({ entry, from, to, seconds: Math.floor((to - from) / 1000) });
  }
  return out;
}

export interface NodeRow {
  nodeId: string;
  name: string;
  depth: number;
  /** Time booked directly on this node. */
  ownSeconds: number;
  /** Own time plus all descendants. */
  totalSeconds: number;
}

/**
 * One row per node that has time in its subtree, in tree order (depth first,
 * siblings by order), so the result reads like the Manage tree with subtotals.
 */
export function reportByNode(tree: TreeIndex, pieces: readonly Piece[]): NodeRow[] {
  const own = new Map<string, number>();
  for (const p of pieces) own.set(p.entry.nodeId, (own.get(p.entry.nodeId) ?? 0) + p.seconds);
  const total = new Map<string, number>();
  const sum = (id: string): number => {
    let s = own.get(id) ?? 0;
    for (const k of tree.childrenOf(id, { includeArchived: true })) s += sum(k.id);
    total.set(id, s);
    return s;
  };
  const roots = tree.roots({ includeArchived: true });
  for (const r of roots) sum(r.id);
  // Entries on nodes that no longer exist still count in the grand total.
  const rows: NodeRow[] = [];
  const walk = (id: string, depth: number) => {
    const t = total.get(id) ?? 0;
    if (!t) return;
    rows.push({ nodeId: id, name: tree.get(id)?.name ?? '(deleted)', depth, ownSeconds: own.get(id) ?? 0, totalSeconds: t });
    for (const k of tree.childrenOf(id, { includeArchived: true })) walk(k.id, depth + 1);
  };
  for (const r of roots) walk(r.id, 0);
  const missing = [...own.entries()].filter(([id]) => !tree.get(id)).reduce((s, [, v]) => s + v, 0);
  if (missing) rows.push({ nodeId: '', name: '(deleted nodes)', depth: 0, ownSeconds: missing, totalSeconds: missing });
  return rows;
}

export interface DayRow {
  day: number;
  seconds: number;
}

/** Seconds per local calendar day in the range (entries crossing midnight are split). */
export function reportByDay(pieces: readonly Piece[], range: DateRange): DayRow[] {
  const rows: DayRow[] = [];
  for (let day = range.from; day < range.to; day = addDays(day, 1)) {
    const next = addDays(day, 1);
    let seconds = 0;
    for (const p of pieces) {
      const from = Math.max(p.from, day);
      const to = Math.min(p.to, next);
      if (to > from) seconds += Math.floor((to - from) / 1000);
    }
    rows.push({ day, seconds });
  }
  return rows;
}

export interface TagRow {
  tag: string | null;
  seconds: number;
}

/**
 * Seconds per tag. An entry counts for its own tags and its node's tags; an
 * entry with several tags counts for each, so tag rows can add up to more than
 * the total. `tag: null` collects untagged time.
 */
export function reportByTag(tree: TreeIndex, pieces: readonly Piece[]): TagRow[] {
  const m = new Map<string | null, number>();
  for (const p of pieces) {
    const tags = new Set([...(p.entry.tags ?? []), ...(tree.get(p.entry.nodeId)?.tags ?? [])]);
    if (!tags.size) m.set(null, (m.get(null) ?? 0) + p.seconds);
    for (const t of tags) m.set(t, (m.get(t) ?? 0) + p.seconds);
  }
  return [...m.entries()]
    .map(([tag, seconds]) => ({ tag, seconds }))
    .sort((a, b) => (a.tag === null ? 1 : b.tag === null ? -1 : b.seconds - a.seconds || a.tag.localeCompare(b.tag)));
}

export function totalSecondsOf(pieces: readonly Piece[]): number {
  return pieces.reduce((s, p) => s + p.seconds, 0);
}
