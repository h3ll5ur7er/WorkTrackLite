import { makeEntry } from '../testing/test-db';
import { DEFAULT_IDLE_SETTINGS, detectIdle, suggestedStop } from './idle';

const local = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();
const MIN = 60_000;

describe('detectIdle', () => {
  const running = makeEntry({ id: 'r', nodeId: 'n', start: local(20, 9), end: null });

  it('stays quiet while the app is seen regularly', () => {
    expect(detectIdle(running, local(20, 10), local(20, 9, 59), DEFAULT_IDLE_SETTINGS)).toBeNull();
    expect(detectIdle(null, local(20, 10), null, DEFAULT_IDLE_SETTINGS)).toBeNull();
  });

  it('reports an away gap (device slept or app closed)', () => {
    expect(detectIdle(running, local(20, 11), local(20, 10), DEFAULT_IDLE_SETTINGS)).toEqual({
      reason: 'away',
      entryId: 'r',
      awayFrom: local(20, 10),
      awayTo: local(20, 11),
    });
  });

  it('ignores gaps shorter than the threshold', () => {
    expect(detectIdle(running, local(20, 10, 14), local(20, 10), DEFAULT_IDLE_SETTINGS)).toBeNull();
  });

  it('clamps the gap to the timer start and asks again even after "keep"', () => {
    const late = makeEntry({ id: 'r', nodeId: 'n', start: local(20, 10, 30), end: null });
    const c = detectIdle(late, local(20, 11), local(20, 10), DEFAULT_IDLE_SETTINGS, ['away', 'long', 'midnight']);
    expect(c).toMatchObject({ reason: 'away', awayFrom: local(20, 10, 30) });
  });

  it('asks once when a timer crosses midnight', () => {
    const yesterday = makeEntry({ id: 'r', nodeId: 'n', start: local(19, 17), end: null });
    expect(detectIdle(yesterday, local(20, 9), local(20, 9) - MIN, DEFAULT_IDLE_SETTINGS)?.reason).toBe('midnight');
    // After "keep" for midnight, the long-running rule still applies (16h > 8h).
    expect(detectIdle(yesterday, local(20, 9), local(20, 9) - MIN, DEFAULT_IDLE_SETTINGS, ['midnight'])?.reason).toBe('long');
    expect(detectIdle(yesterday, local(20, 9), local(20, 9) - MIN, DEFAULT_IDLE_SETTINGS, ['midnight', 'long'])).toBeNull();
  });

  it('asks once after the long-running threshold', () => {
    expect(detectIdle(running, local(20, 17), local(20, 17) - MIN, DEFAULT_IDLE_SETTINGS)?.reason).toBe('long');
    expect(detectIdle(running, local(20, 16, 59), local(20, 16, 58), DEFAULT_IDLE_SETTINGS)).toBeNull();
    expect(detectIdle(running, local(20, 17), local(20, 17) - MIN, { awayMinutes: 15, longRunningHours: 12 })).toBeNull();
  });

  it('suggests stopping an hour after the start, never in the future', () => {
    expect(suggestedStop(running, local(20, 18))).toBe(local(20, 10));
    expect(suggestedStop(running, local(20, 9, 30))).toBe(local(20, 9, 30));
  });
});
