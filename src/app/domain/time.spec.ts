import {
  addDays,
  atWallClockMinutes,
  daysFrom,
  fromDateKey,
  fromLocalInput,
  isSameDay,
  startOfDay,
  startOfWeek,
  toDateKey,
  toLocalInput,
  wallClockMinutes,
} from './time';

// test-setup.ts pins TZ=Europe/Zurich: DST ends Sun 2026-10-25, starts Sun 2026-03-29.
const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();

describe('time (DST-aware calendar math)', () => {
  it('runs in a DST time zone', () => {
    expect(new Date(local(2026, 7, 1)).getTimezoneOffset()).not.toBe(new Date(local(2026, 12, 1)).getTimezoneOffset());
  });

  it('startOfDay returns local midnight', () => {
    expect(startOfDay(local(2026, 10, 25, 15, 30))).toBe(local(2026, 10, 25));
  });

  it('addDays keeps the wall-clock time across the autumn change (25h day)', () => {
    const next = addDays(local(2026, 10, 24, 9), 1);
    expect(next).toBe(local(2026, 10, 25, 9));
    expect(next - local(2026, 10, 24, 9)).toBe(25 * 3_600_000);
  });

  it('addDays keeps the wall-clock time across the spring change (23h day)', () => {
    expect(addDays(local(2026, 3, 28), 1)).toBe(local(2026, 3, 29));
    expect(local(2026, 3, 30) - addDays(local(2026, 3, 28), 1)).toBe(23 * 3_600_000);
  });

  it('startOfWeek honours weekStartsOn', () => {
    const wed = local(2026, 10, 14, 12);
    expect(startOfWeek(wed, 1)).toBe(local(2026, 10, 12));
    expect(startOfWeek(wed, 0)).toBe(local(2026, 10, 11));
    expect(startOfWeek(local(2026, 10, 12), 1)).toBe(local(2026, 10, 12));
  });

  it('regression: stepping week by week never gets stuck at a DST change', () => {
    // The old code did weekStart + 7 * 24h and re-anchored, which looped on the week of 2026-10-19.
    let w = startOfWeek(local(2026, 10, 1), 1);
    const seen: string[] = [];
    for (let i = 0; i < 8; i++) {
      seen.push(new Date(w).toDateString());
      w = startOfWeek(addDays(w, 7), 1);
    }
    expect(new Set(seen).size).toBe(8);
    expect(seen).toContain(new Date(local(2026, 10, 19)).toDateString());
    expect(seen).toContain(new Date(local(2026, 10, 26)).toDateString());
  });

  it('daysFrom yields 7 local midnights even in a week with a 25h day', () => {
    const days = daysFrom(local(2026, 10, 19), 7);
    expect(days.map((d) => new Date(d).getHours())).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(days[6]).toBe(local(2026, 10, 25));
  });

  it('wall-clock minutes round-trip with atWallClockMinutes on a DST day', () => {
    const day = local(2026, 10, 25);
    const t = atWallClockMinutes(day, 9 * 60 + 15);
    expect(t).toBe(local(2026, 10, 25, 9, 15));
    expect(wallClockMinutes(t)).toBe(9 * 60 + 15);
  });

  it('isSameDay compares calendar days', () => {
    expect(isSameDay(local(2026, 10, 25, 0, 1), local(2026, 10, 25, 23, 59))).toBe(true);
    expect(isSameDay(local(2026, 10, 25, 23, 59), local(2026, 10, 26))).toBe(false);
  });

  it('datetime-local conversions are local and symmetric', () => {
    const t = local(2026, 10, 25, 14, 5);
    expect(toLocalInput(t)).toBe('2026-10-25T14:05');
    expect(fromLocalInput('2026-10-25T14:05')).toBe(t);
    expect(fromLocalInput('2026-10-25T14:05:30')).toBe(t + 30_000);
    expect(fromLocalInput('not a date')).toBeNull();
    expect(fromLocalInput('')).toBeNull();
  });
});

describe('date keys', () => {
  it('round-trips local days, including the DST days', () => {
    for (const day of [new Date(2026, 2, 29), new Date(2026, 9, 25), new Date(2026, 0, 1)]) {
      expect(fromDateKey(toDateKey(day.getTime() + 13 * 3_600_000))).toBe(day.getTime());
    }
    expect(toDateKey(new Date(2026, 9, 25, 23, 59).getTime())).toBe('2026-10-25');
  });
  it('rejects malformed and impossible dates', () => {
    expect(fromDateKey('2026-02-30')).toBeNull();
    expect(fromDateKey('26-1-1')).toBeNull();
    expect(fromDateKey('')).toBeNull();
  });
});
