import { makeEntry, makeNode } from '../testing/test-db';
import { clipToRange, presetRange, reportByDay, reportByNode, reportByTag, totalSecondsOf } from './reports';
import { TreeIndex } from './tree';

const local = (m: number, d: number, h = 0, min = 0) => new Date(2026, m - 1, d, h, min).getTime();
const H = 3600;

describe('presetRange (Europe/Zurich)', () => {
  const now = local(10, 21, 15); // Wednesday
  it('weeks honour weekStartsOn', () => {
    expect(presetRange('this-week', now, 1)).toEqual({ from: local(10, 19), to: local(10, 26) });
    expect(presetRange('last-week', now, 1)).toEqual({ from: local(10, 12), to: local(10, 19) });
    expect(presetRange('this-week', now, 0).from).toBe(local(10, 18));
  });
  it('months and the last 30 days', () => {
    expect(presetRange('this-month', now)).toEqual({ from: local(10, 1), to: local(11, 1) });
    expect(presetRange('last-month', now)).toEqual({ from: local(9, 1), to: local(10, 1) });
    expect(presetRange('last-30-days', now)).toEqual({ from: local(9, 22), to: local(10, 22) });
    // January → December of the previous year.
    expect(presetRange('last-month', local(1, 10))).toEqual({ from: new Date(2025, 11, 1).getTime(), to: local(1, 1) });
  });
});

describe('clipToRange', () => {
  const range = { from: local(10, 19), to: local(10, 26) };
  it('keeps the part inside the range, counts running entries to now', () => {
    const pieces = clipToRange(
      [
        makeEntry({ id: 'before', nodeId: 'n', start: local(10, 18, 23), end: local(10, 19, 1) }),
        makeEntry({ id: 'inside', nodeId: 'n', start: local(10, 20, 9), end: local(10, 20, 10) }),
        makeEntry({ id: 'outside', nodeId: 'n', start: local(10, 10, 9), end: local(10, 10, 10) }),
        makeEntry({ id: 'running', nodeId: 'n', start: local(10, 21, 9), end: null }),
      ],
      range,
      local(10, 21, 9, 30),
    );
    expect(pieces.map((p) => [p.entry.id, p.seconds])).toEqual([
      ['before', H],
      ['inside', H],
      ['running', 1800],
    ]);
  });
});

describe('grouping', () => {
  const tree = new TreeIndex([
    makeNode({ id: 'acme', name: 'Acme', tags: ['client'] }),
    makeNode({ id: 'web', parentId: 'acme', name: 'Web', order: 0 }),
    makeNode({ id: 'app', parentId: 'acme', name: 'App', order: 1 }),
    makeNode({ id: 'idle', name: 'Idle' }),
  ]);
  const range = { from: local(10, 19), to: local(10, 26) };
  const pieces = clipToRange(
    [
      makeEntry({ id: '1', nodeId: 'web', start: local(10, 19, 9), end: local(10, 19, 11), tags: ['meeting'] }),
      makeEntry({ id: '2', nodeId: 'acme', start: local(10, 20, 9), end: local(10, 20, 10) }),
      // Crosses midnight into the 25-hour DST Sunday.
      makeEntry({ id: '3', nodeId: 'app', start: local(10, 24, 23), end: local(10, 25, 1) }),
      makeEntry({ id: '4', nodeId: 'gone', start: local(10, 21, 9), end: local(10, 21, 9, 30) }),
    ],
    range,
    local(10, 26),
  );

  it('by node: tree order with own time and subtotals; deleted nodes kept', () => {
    expect(reportByNode(tree, pieces)).toEqual([
      { nodeId: 'acme', name: 'Acme', depth: 0, ownSeconds: H, totalSeconds: 5 * H },
      { nodeId: 'web', name: 'Web', depth: 1, ownSeconds: 2 * H, totalSeconds: 2 * H },
      { nodeId: 'app', name: 'App', depth: 1, ownSeconds: 2 * H, totalSeconds: 2 * H },
      { nodeId: '', name: '(deleted nodes)', depth: 0, ownSeconds: 1800, totalSeconds: 1800 },
    ]);
    expect(totalSecondsOf(pieces)).toBe(5.5 * H);
  });

  it('by day: splits at midnight, 7 days even in a DST week', () => {
    const days = reportByDay(pieces, range);
    expect(days).toHaveLength(7);
    expect(days.map((d) => d.seconds / H)).toEqual([2, 1, 0.5, 0, 0, 1, 1]);
    expect(days[6].day).toBe(local(10, 25));
  });

  it('by tag: entry and node tags, untagged last', () => {
    expect(reportByTag(tree, pieces)).toEqual([
      { tag: 'meeting', seconds: 2 * H },
      { tag: 'client', seconds: H },
      { tag: null, seconds: 2.5 * H },
    ]);
  });
});
