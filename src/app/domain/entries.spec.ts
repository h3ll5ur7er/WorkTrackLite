import { makeEntry } from '../testing/test-db';
import { closeAllButNewest } from './entries';

describe('closeAllButNewest', () => {
  it('does nothing for zero or one running entry', () => {
    expect(closeAllButNewest([])).toEqual([]);
    expect(closeAllButNewest([makeEntry({ id: 'a', nodeId: 'n', start: 0, end: null })])).toEqual([]);
  });

  it('closes older running entries at the start of the newest', () => {
    const fixed = closeAllButNewest([
      makeEntry({ id: 'a', nodeId: 'n', start: 1000, end: null }),
      makeEntry({ id: 'b', nodeId: 'n', start: 3000, end: null }),
      makeEntry({ id: 'c', nodeId: 'n', start: 2000, end: null }),
    ]);
    expect(fixed.map((e) => [e.id, e.end])).toEqual([
      ['c', 3000],
      ['a', 3000],
    ]);
  });
});
