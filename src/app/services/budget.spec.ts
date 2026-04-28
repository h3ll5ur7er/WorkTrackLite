import { Budget, TimeEntry } from '../data/models';
import { entryDurationSeconds, reportForBudget, totalSeconds } from './budget';

function entry(start: number, end: number | null): TimeEntry {
  return { id: 'e', nodeId: 'n', start, end, createdAt: start, updatedAt: start };
}

describe('budget service', () => {
  describe('entryDurationSeconds', () => {
    it('returns full duration for completed entries', () => {
      expect(entryDurationSeconds(entry(0, 60_000))).toBe(60);
    });
    it('uses now() for live entries', () => {
      expect(entryDurationSeconds(entry(0, null), 30_000)).toBe(30);
    });
    it('clamps to zero for negative duration', () => {
      expect(entryDurationSeconds(entry(60_000, 0))).toBe(0);
    });
  });

  describe('totalSeconds', () => {
    it('sums multiple entries', () => {
      const total = totalSeconds([entry(0, 60_000), entry(0, 120_000)]);
      expect(total).toBe(180);
    });
  });

  describe('reportForBudget', () => {
    it('returns zero everything when type is none', () => {
      const r = reportForBudget({ type: 'none', seconds: 0 } as Budget, 999);
      expect(r.budgetSeconds).toBe(0);
      expect(r.remainingSeconds).toBe(0);
      expect(r.overBudget).toBeFalse();
    });

    it('per_hour reports tracked vs target including negative remaining when over', () => {
      const r = reportForBudget({ type: 'per_hour', seconds: 3600 }, 7200);
      expect(r.trackedSeconds).toBe(7200);
      expect(r.remainingSeconds).toBe(-3600);
      expect(r.overBudget).toBeTrue();
    });

    it('fixed budget burns down and goes negative on overshoot', () => {
      const r = reportForBudget({ type: 'fixed', seconds: 36_000 }, 50_000);
      expect(r.remainingSeconds).toBe(-14_000);
      expect(r.overBudget).toBeTrue();
    });

    it('soft limit triggers softBreached but not overBudget', () => {
      const r = reportForBudget({ type: 'fixed', seconds: 3600, softLimit: 1800 }, 2000);
      expect(r.softBreached).toBeTrue();
      expect(r.overBudget).toBeFalse();
    });

    it('over budget supersedes soft limit', () => {
      const r = reportForBudget({ type: 'fixed', seconds: 3600, softLimit: 1800 }, 5000);
      expect(r.softBreached).toBeFalse();
      expect(r.overBudget).toBeTrue();
    });
  });
});
