import { reportForBudget } from './budget';
import { alertLevel, alertStep } from './budget-alerts';

describe('alertLevel', () => {
  const fixed = { type: 'fixed' as const, seconds: 10 * 3600, softLimit: 8 * 3600 };
  it('maps budget reports to ok / soft / over', () => {
    expect(alertLevel(reportForBudget(fixed, 7 * 3600))).toBe('ok');
    expect(alertLevel(reportForBudget(fixed, 8 * 3600))).toBe('soft');
    expect(alertLevel(reportForBudget(fixed, 10 * 3600))).toBe('soft');
    expect(alertLevel(reportForBudget(fixed, 10 * 3600 + 1))).toBe('over');
    expect(alertLevel(reportForBudget({ type: 'none', seconds: 0 }, 99 * 3600))).toBe('ok');
  });
});

describe('alertStep', () => {
  it('announces only rises and remembers levels above ok', () => {
    const step = alertStep(
      { a: 'soft', b: 'over', c: 'soft' },
      new Map([
        ['a', 'over'],
        ['b', 'over'],
        ['c', 'soft'],
        ['d', 'soft'],
        ['e', 'ok'],
      ] as const),
    );
    expect(step.raised).toEqual([
      { nodeId: 'a', level: 'over' },
      { nodeId: 'd', level: 'soft' },
    ]);
    expect(step.remembered).toEqual({ a: 'over', b: 'over', c: 'soft', d: 'soft' });
  });

  it('forgets a level that dropped, so crossing it again alerts again', () => {
    const dropped = alertStep({ a: 'over' }, new Map([['a', 'soft']] as const));
    expect(dropped).toEqual({ raised: [], remembered: { a: 'soft' } });
    const again = alertStep(dropped.remembered, new Map([['a', 'over']] as const));
    expect(again.raised).toEqual([{ nodeId: 'a', level: 'over' }]);
  });

  it('regression: nodes missing from the current levels keep what was announced', () => {
    // E.g. a restore: settings arrive before the restored nodes, so the old node set is current.
    expect(alertStep({ restored: 'over', old: 'soft' }, new Map([['old', 'ok']] as const)).remembered).toEqual({ restored: 'over' });
  });
});
