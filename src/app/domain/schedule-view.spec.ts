import { alignStart, resolveView, stepStart } from './schedule-view';

const local = (d: number, h = 0) => new Date(2026, 9, d, h).getTime();

describe('schedule views', () => {
  it('auto picks the view by width', () => {
    expect(resolveView('auto', 390)).toBe('day');
    expect(resolveView('auto', 800)).toBe('3day');
    expect(resolveView('auto', 1280)).toBe('week');
    expect(resolveView('day', 1280)).toBe('day');
  });

  it('weeks snap to the week start, other views to the day', () => {
    expect(alignStart('week', local(21, 15))).toBe(local(19));
    expect(alignStart('3day', local(21, 15))).toBe(local(21));
  });

  it('steps by the number of visible days across the DST change', () => {
    expect(stepStart('day', local(24), 1)).toBe(local(25));
    expect(stepStart('day', local(25), 1)).toBe(local(26));
    expect(stepStart('3day', local(24), 1)).toBe(local(27));
    expect(stepStart('3day', local(27), -1)).toBe(local(24));
    expect(stepStart('week', local(19), 1)).toBe(local(26));
  });
});
