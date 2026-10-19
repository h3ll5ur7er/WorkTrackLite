import { RecurringRule } from '../core/models';
import { makeEntry } from '../testing/test-db';
import { SuggestionContext, pruneSkipped, ruleFromEntry, suggestions, weekdaysLabel } from './recurring';
import { daysFrom } from './time';

const local = (m: number, d: number, h = 0, min = 0) => new Date(2026, m - 1, d, h, min).getTime();
const week = daysFrom(local(10, 19), 7); // Mon 19 – Sun 25 Oct (25th: DST ends)
const standup: RecurringRule = {
  id: 'su',
  nodeId: 'int',
  weekdays: [1, 2, 3, 4, 5],
  startMinutes: 9 * 60,
  minutes: 15,
  from: '2026-10-01',
  note: 'standup',
};
const ctx = (over: Partial<SuggestionContext> = {}): SuggestionContext => ({
  entries: [],
  skipped: new Set(),
  absences: new Map(),
  lockEnd: null,
  usable: () => true,
  ...over,
});

describe('recurring suggestions', () => {
  it('suggests each weekday occurrence at its wall-clock time', () => {
    const s = suggestions([standup], week, ctx());
    expect(s.map((x) => x.key)).toEqual(['su@2026-10-19', 'su@2026-10-20', 'su@2026-10-21', 'su@2026-10-22', 'su@2026-10-23']);
    expect([s[0].start, s[0].end, s[0].note]).toEqual([local(10, 19, 9), local(10, 19, 9, 15), 'standup']);
  });

  it('keeps 09:00 on the DST day', () => {
    const daily = { ...standup, id: 'd', weekdays: [0] };
    expect(suggestions([daily], week, ctx())[0].start).toBe(local(10, 25, 9));
  });

  it('hides occurrences that are covered, skipped, on a full absence, locked, before "from", paused or for archived nodes', () => {
    const s = suggestions([standup], week, {
      ...ctx(),
      entries: [
        makeEntry({ id: 'a', nodeId: 'int', start: local(10, 19, 9, 5), end: local(10, 19, 9, 20) }), // covers Mon
        makeEntry({ id: 'b', nodeId: 'other', start: local(10, 20, 9), end: local(10, 20, 10) }), // other node: Tue stays
        makeEntry({ id: 'c', nodeId: 'int', start: local(10, 22, 8), end: null }), // running since 8: covers Thu
      ],
      skipped: new Set(['su@2026-10-21']),
      absences: new Map([['2026-10-23', { date: '2026-10-23', kind: 'vacation' as const }]]),
    });
    expect(s.map((x) => x.key)).toEqual(['su@2026-10-20']);
    expect(suggestions([standup], week, ctx({ lockEnd: local(10, 21) })).map((x) => x.key)).toEqual([
      'su@2026-10-21',
      'su@2026-10-22',
      'su@2026-10-23',
    ]);
    expect(suggestions([{ ...standup, from: '2026-10-22' }], week, ctx())).toHaveLength(2);
    expect(suggestions([{ ...standup, paused: true }], week, ctx())).toEqual([]);
    expect(suggestions([standup], week, ctx({ usable: () => false }))).toEqual([]);
    // A half-day absence keeps the suggestion.
    expect(
      suggestions(
        [standup],
        [local(10, 23)],
        ctx({ absences: new Map([['2026-10-23', { date: '2026-10-23', kind: 'sick' as const, half: true }]]) }),
      ),
    ).toHaveLength(1);
  });
});

describe('ruleFromEntry', () => {
  it('copies node, time, duration, note and tags', () => {
    const e = makeEntry({ id: 'e', nodeId: 'n', start: local(10, 20, 13, 30), end: local(10, 20, 14, 15), note: 'review', tags: ['t'] });
    expect(ruleFromEntry(e, [2], 'r')).toEqual({
      id: 'r',
      nodeId: 'n',
      weekdays: [2],
      startMinutes: 13 * 60 + 30,
      minutes: 45,
      from: '2026-10-20',
      note: 'review',
      tags: ['t'],
    });
  });
});

describe('weekdaysLabel', () => {
  it('reads like a person would say it', () => {
    expect(weekdaysLabel([1, 2, 3, 4, 5])).toBe('Mon–Fri');
    expect(weekdaysLabel([2])).toBe('Tue');
    expect(weekdaysLabel([5, 1, 3])).toBe('Mon, Wed, Fri');
    expect(weekdaysLabel([0, 1, 2, 3, 4, 5, 6])).toBe('Every day');
    expect(weekdaysLabel([6, 0], 1)).toBe('Sat, Sun');
  });
});

describe('pruneSkipped', () => {
  it('drops keys older than 90 days', () => {
    expect(pruneSkipped(['a@2026-06-01', 'a@2026-10-01'], local(10, 21))).toEqual(['a@2026-10-01']);
  });
});
