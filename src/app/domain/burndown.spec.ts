import { makeEntry } from '../testing/test-db';
import { chartGeometry } from './burndown';

const H = 3_600_000;

describe('chartGeometry', () => {
  it('draws a flat line and the target line for an empty node', () => {
    const g = chartGeometry([], { type: 'target', seconds: 7200 }, 10 * H);
    expect(g.line.split(' ')).toHaveLength(2);
    expect(g.referenceY).not.toBeNull();
    expect(g.overBudget).toBe(false);
  });

  it('burns down a fixed budget and flags overshoot', () => {
    const g = chartGeometry(
      [makeEntry({ id: 'a', nodeId: 'n', start: 0, end: H }), makeEntry({ id: 'b', nodeId: 'n', start: 2 * H, end: 4 * H })],
      { type: 'fixed', seconds: 2 * 3600 },
      5 * H,
    );
    expect(g.overBudget).toBe(true);
    const ys = g.line.split(' ').map((p) => Number(p.split(',')[1]));
    // SVG y grows downwards: burning down means y increases.
    expect(ys[ys.length - 1]).toBeGreaterThan(ys[0]);
    expect(g.referenceY).not.toBeNull();
  });

  it('produces monotonic x even for overlapping entries', () => {
    const g = chartGeometry(
      [makeEntry({ id: 'a', nodeId: 'n', start: 0, end: 5 * H }), makeEntry({ id: 'b', nodeId: 'n', start: H, end: 2 * H })],
      { type: 'none', seconds: 0 },
      6 * H,
    );
    const xs = g.line.split(' ').map((p) => Number(p.split(',')[0]));
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
  });

  it('includes running entries up to now', () => {
    const g = chartGeometry([makeEntry({ id: 'a', nodeId: 'n', start: 0, end: null })], { type: 'none', seconds: 0 }, 2 * H);
    expect(g.line).not.toContain('NaN');
  });
});
