import { TimeEntry } from '../core/models';
import { makeEntry } from '../testing/test-db';
import { DaySegment, assignLanes, layoutWeek, snapToGrid, snapToNeighbors } from './schedule-layout';
import { daysFrom } from './time';

const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const end = (e: TimeEntry) => e.end ?? e.start;

describe('layoutWeek', () => {
  const days = daysFrom(local(2026, 10, 19), 7); // week with the 25h Sunday (Europe/Zurich)

  it('places an entry by wall-clock minutes', () => {
    const cols = layoutWeek(
      [makeEntry({ id: 'a', nodeId: 'n', start: local(2026, 10, 20, 9), end: local(2026, 10, 20, 10, 30) })],
      days,
      end,
    );
    expect(cols[1]).toHaveLength(1);
    expect(cols[1][0]).toMatchObject({ topMin: 540, heightMin: 90, lane: 0, laneCount: 1, overlap: false });
  });

  it('splits entries crossing midnight into two segments', () => {
    const cols = layoutWeek([makeEntry({ id: 'a', nodeId: 'n', start: local(2026, 10, 20, 23), end: local(2026, 10, 21, 1) })], days, end);
    expect(cols[1][0]).toMatchObject({ topMin: 23 * 60, heightMin: 60 });
    expect(cols[2][0]).toMatchObject({ topMin: 0, heightMin: 60 });
  });

  it('keeps the hour grid aligned on the 25h DST day', () => {
    const cols = layoutWeek([makeEntry({ id: 'a', nodeId: 'n', start: local(2026, 10, 25, 14), end: local(2026, 10, 25, 15) })], days, end);
    expect(cols[6][0]).toMatchObject({ topMin: 14 * 60, heightMin: 60 });
  });

  it('ignores entries outside the range', () => {
    const cols = layoutWeek([makeEntry({ id: 'a', nodeId: 'n', start: local(2026, 10, 1, 9) })], days, end);
    expect(cols.flat()).toHaveLength(0);
  });
});

describe('assignLanes', () => {
  const seg = (id: string, from: number, to: number) => ({ entry: { id } as TimeEntry, from, to }) as DaySegment;

  it('gives overlapping segments separate lanes and shares the lane count per cluster', () => {
    const segs = [seg('a', 0, 10), seg('b', 5, 15), seg('c', 12, 20), seg('d', 30, 40)];
    assignLanes(segs);
    const by = Object.fromEntries(segs.map((s) => [s.entry.id, s]));
    expect([by['a'].lane, by['b'].lane, by['c'].lane]).toEqual([0, 1, 0]);
    expect(by['a'].laneCount).toBe(2);
    expect(by['c'].overlap).toBe(true);
    expect(by['d']).toMatchObject({ lane: 0, laneCount: 1, overlap: false });
  });

  it('touching segments do not overlap', () => {
    const segs = [seg('a', 0, 10), seg('b', 10, 20)];
    assignLanes(segs);
    expect(segs.every((s) => s.laneCount === 1 && !s.overlap)).toBe(true);
  });
});

describe('snapping', () => {
  it('snaps to the 15-minute wall-clock grid', () => {
    expect(snapToGrid(local(2026, 10, 20, 9, 7), 15)).toBe(local(2026, 10, 20, 9, 0));
    expect(snapToGrid(local(2026, 10, 20, 9, 8), 15)).toBe(local(2026, 10, 20, 9, 15));
  });

  it('snaps to nearby edges of other closed entries within the window', () => {
    const others = [makeEntry({ id: 'x', nodeId: 'n', start: local(2026, 10, 20, 8), end: local(2026, 10, 20, 9, 5) })];
    expect(snapToNeighbors(local(2026, 10, 20, 9), others, 'self', 10)).toBe(local(2026, 10, 20, 9, 5));
    expect(snapToNeighbors(local(2026, 10, 20, 10), others, 'self', 10)).toBe(local(2026, 10, 20, 10));
    expect(snapToNeighbors(local(2026, 10, 20, 9), others, 'x', 10)).toBe(local(2026, 10, 20, 9));
  });
});
