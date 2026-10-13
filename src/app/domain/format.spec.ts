import { formatHM, formatHMS, formatRange, parseTags } from './format';

describe('format', () => {
  it('formatHMS handles zero, hours and negatives', () => {
    expect(formatHMS(0)).toBe('0:00:00');
    expect(formatHMS(3725)).toBe('1:02:05');
    expect(formatHMS(-61)).toBe('-0:01:01');
    expect(formatHMS(59.9)).toBe('0:00:59');
  });

  it('formatHM drops seconds', () => {
    expect(formatHM(3725)).toBe('1:02');
    expect(formatHM(-3600)).toBe('-1:00');
  });

  it('formatRange shows local clock times and duration', () => {
    const s = new Date(2026, 0, 5, 9, 0).getTime();
    expect(formatRange(s, s + 90 * 60_000)).toBe('09:00–10:30 · 1:30');
  });

  it('parseTags trims, drops empties and de-duplicates', () => {
    expect(parseTags(' a, b ,, a,c ')).toEqual(['a', 'b', 'c']);
    expect(parseTags('')).toEqual([]);
  });
});
