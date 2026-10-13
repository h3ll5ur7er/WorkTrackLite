import { Budget, TimeEntry } from '../core/models';
import { entryDurationSeconds, reportForBudget, totalSeconds } from './budget';

function entry(start: number, end: number | null): TimeEntry {
  return { id: 'e', nodeId: 'n', start, end, createdAt: start, updatedAt: start };
}

describe('budget', () => {
  describe('entryDurationSeconds', () => {
    it('returns full duration for completed entries', () => {
      expect(entryDurationSeconds(entry(0, 60_000))).toBe(60);
    });
    it('uses now for running entries', () => {
      expect(entryDurationSeconds(entry(0, null), 30_000)).toBe(30);
    });
    it('clamps negative durations to zero', () => {
      expect(entryDurationSeconds(entry(60_000, 0))).toBe(0);
    });
  });

  it('totalSeconds sums entries', () => {
    expect(totalSeconds([entry(0, 60_000), entry(0, 120_000)])).toBe(180);
  });

  describe('reportForBudget', () => {
    it('reports nothing for type none, even with a soft limit', () => {
      const r = reportForBudget({ type: 'none', seconds: 0, softLimit: 10 } as Budget, 999);
      expect(r).toMatchObject({ budgetSeconds: 0, remainingSeconds: 0, overBudget: false, softBreached: false });
    });

    it('target: remaining goes negative once exceeded', () => {
      const r = reportForBudget({ type: 'target', seconds: 3600 }, 7200);
      expect(r).toMatchObject({ trackedSeconds: 7200, remainingSeconds: -3600, overBudget: true, ratio: 2 });
    });

    it('fixed: burns down and goes negative on overshoot', () => {
      const r = reportForBudget({ type: 'fixed', seconds: 36_000 }, 50_000);
      expect(r.remainingSeconds).toBe(-14_000);
      expect(r.overBudget).toBe(true);
    });

    it('soft limit triggers softBreached but not overBudget', () => {
      const r = reportForBudget({ type: 'fixed', seconds: 3600, softLimit: 1800 }, 2000);
      expect(r.softBreached).toBe(true);
      expect(r.overBudget).toBe(false);
    });

    it('over budget supersedes the soft limit', () => {
      const r = reportForBudget({ type: 'fixed', seconds: 3600, softLimit: 1800 }, 5000);
      expect(r.softBreached).toBe(false);
      expect(r.overBudget).toBe(true);
    });

    it('a zero budget never reports over budget', () => {
      expect(reportForBudget({ type: 'fixed', seconds: 0 }, 100).overBudget).toBe(false);
    });
  });
});
