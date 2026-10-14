import { makeEntry } from '../testing/test-db';
import { MERGE_MAX_GAP_MS, mergeNeighbors, midpoint, planMerge, shiftEntry, splitRanges } from './entry-edit';
import { MS_PER_HOUR, MS_PER_MINUTE } from './time';

const local = (m: number, d: number, h = 0, min = 0) => new Date(2026, m - 1, d, h, min).getTime();

describe('splitRanges', () => {
  const e = makeEntry({ id: 'a', nodeId: 'n', start: local(10, 20, 9), end: local(10, 20, 12), note: 'x', tags: ['t'], billable: false });

  it('cuts a closed entry in two, copying node, note, tags and billable', () => {
    const r = splitRanges(e, local(10, 20, 10, 30))!;
    expect(r.first).toEqual({ ...e, end: local(10, 20, 10, 30) });
    expect(r.second).toEqual({
      nodeId: 'n',
      start: local(10, 20, 10, 30),
      end: e.end,
      note: 'x',
      tags: ['t'],
      billable: false,
      createdAt: 0,
      updatedAt: 0,
    });
    expect('id' in r.second).toBe(false);
  });

  it('refuses points on or outside the edges and running entries', () => {
    expect(splitRanges(e, e.start)).toBeNull();
    expect(splitRanges(e, e.end!)).toBeNull();
    expect(splitRanges(e, e.end! + 1)).toBeNull();
    expect(splitRanges({ ...e, end: null }, local(10, 20, 10))).toBeNull();
  });
});

describe('midpoint', () => {
  it('rounds to the minute and stays inside', () => {
    expect(midpoint(makeEntry({ id: 'a', nodeId: 'n', start: local(10, 20, 9), end: local(10, 20, 10, 1) }))).toBe(local(10, 20, 9, 31));
    expect(midpoint(makeEntry({ id: 'a', nodeId: 'n', start: 0, end: MS_PER_MINUTE }))).toBeNull();
    expect(midpoint(makeEntry({ id: 'a', nodeId: 'n', start: 0, end: null }))).toBeNull();
  });
});

describe('planMerge', () => {
  const at = (h: number, min = 0) => local(10, 20, h, min);
  const a = makeEntry({ id: 'a', nodeId: 'n', start: at(9), end: at(10), note: 'spec', tags: ['x'] });
  const b = makeEntry({ id: 'b', nodeId: 'n', start: at(10, 10), end: at(11), note: 'spec', tags: ['y', 'x'] });
  const c = makeEntry({ id: 'c', nodeId: 'n', start: at(10, 30), end: at(10, 45), note: 'review' });

  it('spans the entries, keeps the earliest id, joins notes and tags, reports the gap', () => {
    const plan = planMerge([b, c, a]);
    if ('error' in plan) throw new Error(plan.error);
    expect(plan.merged).toEqual({ ...a, end: at(11), note: 'spec; review', tags: ['x', 'y'] });
    expect(plan.removeIds).toEqual(['b', 'c']);
    // 10:00–10:10 was untracked; the overlap of b and c is counted once.
    expect(plan.gapMs).toBe(10 * MS_PER_MINUTE);
  });

  it('leaves out empty notes and tags', () => {
    const plan = planMerge([makeEntry({ id: 'p', nodeId: 'n', start: at(9) }), makeEntry({ id: 'q', nodeId: 'n', start: at(10) })]);
    if ('error' in plan) throw new Error(plan.error);
    expect('note' in plan.merged || 'tags' in plan.merged).toBe(false);
    expect(plan.gapMs).toBe(0);
  });

  it('explains why entries cannot be merged', () => {
    expect(planMerge([a])).toEqual({ error: expect.stringContaining('two') });
    expect(planMerge([a, { ...b, end: null }])).toEqual({ error: expect.stringContaining('running') });
    expect(planMerge([a, { ...b, nodeId: 'other' }])).toEqual({ error: expect.stringContaining('same node') });
    expect(planMerge([a, { ...b, billable: false }])).toEqual({ error: expect.stringContaining('billable') });
    const far = { ...b, start: at(10) + MERGE_MAX_GAP_MS + 1, end: at(12) };
    expect(planMerge([a, far])).toEqual({ error: expect.stringContaining('far apart') });
  });
});

describe('mergeNeighbors', () => {
  const at = (h: number, min = 0) => local(10, 20, h, min);
  const e = makeEntry({ id: 'e', nodeId: 'n', start: at(10), end: at(11) });

  it('finds the closest mergeable entries on either side', () => {
    const all = [
      e,
      makeEntry({ id: 'early', nodeId: 'n', start: at(8), end: at(9) }),
      makeEntry({ id: 'prev', nodeId: 'n', start: at(9), end: at(9, 50) }),
      makeEntry({ id: 'other-node', nodeId: 'm', start: at(11), end: at(12) }),
      makeEntry({ id: 'next', nodeId: 'n', start: at(11, 15), end: at(12) }),
      makeEntry({ id: 'later', nodeId: 'n', start: at(11, 20), end: at(12) }),
    ];
    const r = mergeNeighbors(all, e);
    expect([r.prev?.id, r.next?.id]).toEqual(['prev', 'next']);
  });

  it('skips running, far-away and differently billable entries', () => {
    const all = [
      e,
      makeEntry({ id: 'running', nodeId: 'n', start: at(11), end: null }),
      makeEntry({ id: 'far', nodeId: 'n', start: at(8), end: at(9, 44) }),
      makeEntry({ id: 'nb', nodeId: 'n', start: at(11), end: at(12), billable: false }),
    ];
    expect(mergeNeighbors(all, e)).toEqual({ prev: null, next: null });
  });
});

describe('shiftEntry', () => {
  it('keeps the wall-clock time across the DST change and the duration', () => {
    const e = makeEntry({ id: 'e', nodeId: 'n', start: local(10, 24, 9), end: local(10, 24, 11) });
    expect(shiftEntry(e, 1, 30 * MS_PER_MINUTE)).toEqual({ start: local(10, 25, 9, 30), end: local(10, 25, 11, 30) });
    expect(shiftEntry(e, 0, -MS_PER_HOUR)).toEqual({ start: local(10, 24, 8), end: local(10, 24, 10) });
  });
});
