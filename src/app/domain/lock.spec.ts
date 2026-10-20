import { makeEntry } from '../testing/test-db';
import { LockedError, isLocked, lockEnd, lockProblem } from './lock';

const local = (m: number, d: number, h = 0) => new Date(2026, m - 1, d, h).getTime();

describe('period lock', () => {
  it('locks everything that starts before the end of the chosen day', () => {
    const end = lockEnd('2026-10-25'); // the 25-hour DST day
    expect(end).toBe(local(10, 26));
    expect(isLocked(local(10, 25, 23), end)).toBe(true);
    expect(isLocked(local(10, 26), end)).toBe(false);
    expect(isLocked(local(1, 1), lockEnd(undefined))).toBe(false);
    expect(lockEnd('nonsense')).toBeNull();
  });

  it('only past days can be locked, and not under a running timer', () => {
    const now = local(10, 21, 15);
    expect(lockProblem('2026-10-20', now, null)).toBeNull();
    expect(lockProblem('2026-10-21', now, null)).toContain('before today');
    expect(lockProblem('2026-10-20', now, makeEntry({ id: 'r', nodeId: 'n', start: local(10, 20, 22), end: null }))).toContain(
      'running timer',
    );
    expect(lockProblem('2026-10-19', now, makeEntry({ id: 'r', nodeId: 'n', start: local(10, 20, 22), end: null }))).toBeNull();
    expect(lockProblem('', now, null)).toContain('valid date');
  });

  it('explains the lock in its error', () => {
    expect(new LockedError('2026-10-31').message).toMatch(/^Entries up to .*31.* are locked/);
  });
});
