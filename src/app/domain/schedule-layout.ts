import { TimeEntry } from '../core/models';
import { MINUTES_PER_DAY, MS_PER_MINUTE, addDays, wallClockMinutes } from './time';

/** One visible piece of an entry inside one day column. */
export interface DaySegment {
  entry: TimeEntry;
  dayIdx: number;
  /** Absolute start/end of this piece (ms). */
  from: number;
  to: number;
  /** Position in the column as wall-clock minutes (0..1440), matching the hour grid. */
  topMin: number;
  heightMin: number;
  lane: number;
  laneCount: number;
  overlap: boolean;
}

/**
 * Splits entries into per-day segments for the given days (local midnights)
 * and assigns side-by-side lanes to overlapping segments.
 *
 * `endOf` supplies the effective end for each entry (e.g. now for a running
 * timer, or a drag preview).
 */
export function layoutWeek(
  entries: Iterable<TimeEntry>,
  dayStarts: readonly number[],
  endOf: (e: TimeEntry) => number,
  startOf: (e: TimeEntry) => number = (e) => e.start,
): DaySegment[][] {
  const columns: DaySegment[][] = dayStarts.map(() => []);
  if (!dayStarts.length) return columns;
  const rangeStart = dayStarts[0];
  const rangeEnd = addDays(dayStarts[dayStarts.length - 1], 1);
  for (const entry of entries) {
    const start = startOf(entry);
    const end = endOf(entry);
    if (end <= rangeStart || start >= rangeEnd || end <= start) continue;
    dayStarts.forEach((dayStart, dayIdx) => {
      const dayEnd = addDays(dayStart, 1);
      const from = Math.max(start, dayStart);
      const to = Math.min(end, dayEnd);
      if (to <= from) return;
      const topMin = wallClockMinutes(from);
      const endMin = to >= dayEnd ? MINUTES_PER_DAY : wallClockMinutes(to);
      columns[dayIdx].push({
        entry,
        dayIdx,
        from,
        to,
        topMin,
        // Wall-clock height can be ≤ 0 inside a repeated DST hour; keep it visible.
        heightMin: Math.max(endMin - topMin, Math.min(15, (to - from) / MS_PER_MINUTE)),
        lane: 0,
        laneCount: 1,
        overlap: false,
      });
    });
  }
  for (const col of columns) assignLanes(col);
  return columns;
}

/**
 * Greedy interval colouring: each segment goes into the first lane that is
 * free; segments in one overlap cluster share the cluster's lane count so
 * they split the column width evenly.
 */
export function assignLanes(segs: DaySegment[]): void {
  segs.sort((a, b) => a.from - b.from || a.to - b.to);
  let cluster: DaySegment[] = [];
  let clusterEnd = -Infinity;
  let lanesEnd: number[] = [];
  const flush = () => {
    const count = lanesEnd.length;
    for (const s of cluster) {
      s.laneCount = count;
      s.overlap = count > 1;
    }
    cluster = [];
    lanesEnd = [];
  };
  for (const s of segs) {
    if (s.from >= clusterEnd) {
      flush();
      clusterEnd = -Infinity;
    }
    let lane = lanesEnd.findIndex((end) => end <= s.from);
    if (lane === -1) {
      lane = lanesEnd.length;
      lanesEnd.push(s.to);
    } else {
      lanesEnd[lane] = s.to;
    }
    s.lane = lane;
    cluster.push(s);
    clusterEnd = Math.max(clusterEnd, s.to);
  }
  flush();
}

/** Rounds to the nearest `stepMin` minutes of wall-clock time. */
export function snapToGrid(ms: number, stepMin: number): number {
  const step = stepMin * MS_PER_MINUTE;
  const offset = new Date(ms).getTimezoneOffset() * MS_PER_MINUTE;
  return Math.round((ms - offset) / step) * step + offset;
}

/** Snaps to the closest start/end of another closed entry within `windowMin`, else returns `ms`. */
export function snapToNeighbors(ms: number, entries: Iterable<TimeEntry>, ignoreId: string, windowMin: number): number {
  const win = windowMin * MS_PER_MINUTE;
  let best = ms;
  let bestDelta = win + 1;
  for (const e of entries) {
    if (e.id === ignoreId || e.end == null) continue;
    for (const edge of [e.start, e.end]) {
      const d = Math.abs(edge - ms);
      if (d < bestDelta) {
        bestDelta = d;
        best = edge;
      }
    }
  }
  return bestDelta <= win ? best : ms;
}
