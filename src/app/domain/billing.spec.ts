import { makeEntry, makeNode } from '../testing/test-db';
import { amountsByNode, formatMoney, isBillable, isCurrencyCode, roundSeconds, totalAmount } from './billing';
import { clipToRange } from './reports';
import { TreeIndex } from './tree';

const MIN = 60;

describe('roundSeconds', () => {
  it('is exact without a rule', () => {
    expect(roundSeconds(61)).toBe(61);
    expect(roundSeconds(-5)).toBe(0);
  });
  it('rounds up, down or to nearest step', () => {
    expect(roundSeconds(16 * MIN, { minutes: 15, mode: 'up' })).toBe(30 * MIN);
    expect(roundSeconds(15 * MIN, { minutes: 15, mode: 'up' })).toBe(15 * MIN);
    expect(roundSeconds(29 * MIN, { minutes: 15, mode: 'down' })).toBe(15 * MIN);
    expect(roundSeconds(22 * MIN, { minutes: 15, mode: 'nearest' })).toBe(15 * MIN);
    expect(roundSeconds(23 * MIN, { minutes: 15, mode: 'nearest' })).toBe(30 * MIN);
    expect(roundSeconds(1, { minutes: 6, mode: 'up' })).toBe(6 * MIN);
  });
});

describe('billing', () => {
  const tree = new TreeIndex([
    makeNode({ id: 'acme', rate: 120 }),
    makeNode({ id: 'web', parentId: 'acme' }),
    makeNode({ id: 'internal', parentId: 'acme', billable: false }),
    makeNode({ id: 'special', parentId: 'acme', rate: 200 }),
    makeNode({ id: 'norate' }),
  ]);
  const H = 3_600_000;
  const pieces = clipToRange(
    [
      makeEntry({ id: '1', nodeId: 'web', start: 0, end: H }), // 120
      makeEntry({ id: '2', nodeId: 'internal', start: 0, end: H }), // not billable
      makeEntry({ id: '3', nodeId: 'internal', start: 0, end: H / 2, billable: true }), // 60 (override)
      makeEntry({ id: '4', nodeId: 'special', start: 0, end: H / 4 }), // 50
      makeEntry({ id: '5', nodeId: 'web', start: 0, end: H / 4, billable: false }),
      makeEntry({ id: '6', nodeId: 'norate', start: 0, end: H }), // billable, no rate
    ],
    { from: 0, to: 10 * H },
    10 * H,
  );

  it('inherits rates and billable flags; entries can override', () => {
    expect(tree.rateOf('web')).toBe(120);
    expect(tree.rateOf('special')).toBe(200);
    expect(tree.rateOf('norate')).toBeNull();
    expect(isBillable(tree, { nodeId: 'internal' })).toBe(false);
    expect(isBillable(tree, { nodeId: 'internal', billable: true })).toBe(true);
  });

  it('sums amounts per subtree', () => {
    const m = amountsByNode(tree, pieces);
    expect(m.get('acme')).toEqual({ billableSeconds: 1.75 * 3600, amount: 230 });
    expect(m.get('internal')).toEqual({ billableSeconds: 1800, amount: 60 });
    expect(m.get('norate')).toEqual({ billableSeconds: 3600, amount: 0 });
    expect(totalAmount(tree, pieces)).toEqual({ billableSeconds: 2.75 * 3600, amount: 230 });
  });

  it('applies rounding per entry', () => {
    // 15 min on "special" rounded up to 30 → 100; others already on the grid.
    expect(totalAmount(tree, pieces, { minutes: 30, mode: 'up' }).amount).toBe(280);
  });

  it('formats money and validates currency codes', () => {
    expect(formatMoney(1234.5, 'EUR')).toMatch(/1.?234[.,]50/);
    expect(formatMoney(1, 'NOT-A-CODE')).toBe('1.00 NOT-A-CODE');
    expect(isCurrencyCode('CHF')).toBe(true);
    expect(isCurrencyCode('chf')).toBe(false);
  });
});
