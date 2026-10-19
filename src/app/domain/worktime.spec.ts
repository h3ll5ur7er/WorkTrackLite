import { makeEntry } from '../testing/test-db';
import { WorkTime } from '../core/models';
import { absenceDays, targetSeconds, workSummary, workedByDay } from './worktime';

const local = (m: number, d: number, h = 0, min = 0) => new Date(2026, m - 1, d, h, min).getTime();
const H = 3600;
const work: WorkTime = { hours: [0, 8, 8, 8, 8, 4, 0], from: '2026-10-19' }; // Mon–Thu 8 h, Fri 4 h

describe('targetSeconds', () => {
  it('uses the weekday hours, less absences', () => {
    const none = new Map();
    expect(targetSeconds(local(10, 19), work, none)).toBe(8 * H); // Monday
    expect(targetSeconds(local(10, 23), work, none)).toBe(4 * H); // Friday
    expect(targetSeconds(local(10, 25), work, none)).toBe(0); // Sunday (the 25-hour day)
    const abs = new Map([
      ['2026-10-19', { date: '2026-10-19', kind: 'vacation' as const }],
      ['2026-10-20', { date: '2026-10-20', kind: 'sick' as const, half: true }],
    ]);
    expect(targetSeconds(local(10, 19), work, abs)).toBe(0);
    expect(targetSeconds(local(10, 20), work, abs)).toBe(4 * H);
  });
});

describe('workedByDay', () => {
  it('splits entries at local midnight and counts a running entry up to now', () => {
    const map = workedByDay(
      [
        makeEntry({ id: 'a', nodeId: 'n', start: local(10, 24, 22), end: local(10, 25, 2) }),
        makeEntry({ id: 'b', nodeId: 'n', start: local(10, 26, 9), end: null }),
      ],
      local(10, 19),
      local(10, 27),
      local(10, 26, 10, 30),
    );
    expect(map.get(local(10, 24))).toBe(2 * H);
    expect(map.get(local(10, 25))).toBe(2 * H);
    expect(map.get(local(10, 26))).toBe(1.5 * H);
  });
});

describe('workSummary', () => {
  const day = (d: number, hours: number, startHour = 8) =>
    makeEntry({ id: `d${d}-${startHour}`, nodeId: 'n', start: local(10, d, startHour), end: local(10, d, startHour) + hours * H * 1000 });

  it('balance covers the days before today; today and the week are shown separately', () => {
    const entries = [day(19, 9), day(20, 7.5), day(21, 3)]; // Mon +1, Tue −0.5, Wed (today) in progress
    const s = workSummary(entries, { ...work, carrySeconds: 2 * H }, [], local(10, 21, 11, 0));
    expect(s.balance).toBe(2 * H + 1 * H - 0.5 * H);
    expect(s.today).toEqual({ worked: 3 * H, target: 8 * H });
    expect(s.week).toEqual({ worked: 19.5 * H, target: 36 * H });
  });

  it('absences credit their target; days before "from" are ignored', () => {
    const entries = [day(16, 10), day(19, 8)]; // Fri 16 Oct is before "from"
    const s = workSummary(entries, work, [{ date: '2026-10-20', kind: 'vacation' }], local(10, 22, 7));
    // Mon 0, Tue (vacation) 0, Wed −8.
    expect(s.balance).toBe(-8 * H);
    expect(s.week.target).toBe(28 * H);
  });

  it('a start date in the future leaves only the carry-over', () => {
    const s = workSummary([], { ...work, from: '2026-11-01', carrySeconds: -H }, [], local(10, 21, 12));
    expect(s.balance).toBe(-H);
  });
});

describe('absenceDays', () => {
  it('creates one absence per working day in the range', () => {
    expect(absenceDays('2026-10-23', '2026-10-27', 'vacation', false, work).map((a) => a.date)).toEqual([
      '2026-10-23',
      '2026-10-26',
      '2026-10-27',
    ]);
    expect(absenceDays('2026-10-20', '2026-10-20', 'sick', true, work)).toEqual([{ date: '2026-10-20', kind: 'sick', half: true }]);
    expect(absenceDays('2026-10-27', '2026-10-20', 'sick', false, work)).toEqual([]);
  });
});
