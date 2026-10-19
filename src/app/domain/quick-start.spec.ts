import { makeEntry, makeNode } from '../testing/test-db';
import { quickStart } from './quick-start';
import { TreeIndex } from './tree';

describe('quickStart', () => {
  const tree = new TreeIndex([
    makeNode({ id: 'zeta', name: 'Zeta', favorite: true }),
    makeNode({ id: 'alpha', name: 'Alpha', favorite: true }),
    makeNode({ id: 'old', name: 'Old', archived: true }),
    makeNode({ id: 'under', name: 'Under', parentId: 'old' }),
    makeNode({ id: 'gone-fav', name: 'Gone', favorite: true, archived: true }),
    makeNode({ id: 'a', name: 'A' }),
    makeNode({ id: 'b', name: 'B' }),
    makeNode({ id: 'c', name: 'C' }),
  ]);

  it('lists favourites by name, then recently used nodes newest first, without duplicates', () => {
    const entries = [
      makeEntry({ id: '1', nodeId: 'a', start: 1000, end: 2000 }),
      makeEntry({ id: '2', nodeId: 'b', start: 3000, end: 4000 }),
      makeEntry({ id: '3', nodeId: 'a', start: 5000, end: 6000 }),
      makeEntry({ id: '4', nodeId: 'zeta', start: 7000, end: 8000 }),
      makeEntry({ id: '5', nodeId: 'c', start: 500, end: null }), // running: most recent
    ];
    expect(quickStart(tree, entries).map((q) => [q.node.id, q.favorite])).toEqual([
      ['alpha', true],
      ['zeta', true],
      ['c', false],
      ['a', false],
      ['b', false],
    ]);
  });

  it('skips archived nodes and caps the recent part', () => {
    const entries = [
      makeEntry({ id: '1', nodeId: 'under', start: 9000, end: 9500 }),
      makeEntry({ id: '2', nodeId: 'old', start: 8000, end: 8500 }),
      makeEntry({ id: '3', nodeId: 'b', start: 1000, end: 2000 }),
      makeEntry({ id: '4', nodeId: 'a', start: 3000, end: 4000 }),
    ];
    expect(quickStart(tree, entries, 1).map((q) => q.node.id)).toEqual(['alpha', 'zeta', 'a']);
  });
});
