import { makeEntry, makeNode } from '../testing/test-db';
import { TreeIndex, closedSubtreeSeconds, entriesByNode, liveSubtreeSeconds, reorderSiblings } from './tree';

const H = 3_600_000;

function sampleTree() {
  return new TreeIndex([
    makeNode({ id: 'acme', name: 'Acme' }),
    makeNode({ id: 'web', parentId: 'acme', name: 'Website', order: 1 }),
    makeNode({ id: 'app', parentId: 'acme', name: 'App', order: 0 }),
    makeNode({ id: 'design', parentId: 'web', name: 'Design' }),
    makeNode({ id: 'old', parentId: 'acme', name: 'Old', order: 2, archived: true }),
    makeNode({ id: 'old-task', parentId: 'old', name: 'Old task' }),
    makeNode({ id: 'design-v0', parentId: 'design', name: 'Design v0', archived: true }),
  ]);
}

describe('TreeIndex', () => {
  it('sorts children by order, then name, and hides archived by default', () => {
    const t = sampleTree();
    expect(t.childrenOf('acme').map((n) => n.id)).toEqual(['app', 'web']);
    expect(t.childrenOf('acme', { includeArchived: true }).map((n) => n.id)).toEqual(['app', 'web', 'old']);
  });

  it('builds paths and ancestor lists', () => {
    const t = sampleTree();
    expect(t.pathLabel('design')).toBe('Acme / Website / Design');
    expect(t.ancestorIds('design')).toEqual(['web', 'acme']);
    expect(t.pathNames('missing')).toEqual([]);
  });

  it('subtreeIds includes archived descendants', () => {
    expect(sampleTree().subtreeIds('acme').sort()).toEqual(['acme', 'app', 'design', 'design-v0', 'old', 'old-task', 'web']);
  });

  it('isLeaf ignores archived children; dashboard hides archived subtrees', () => {
    const t = sampleTree();
    expect(t.isLeaf('design')).toBe(true);
    expect(t.isLeaf('web')).toBe(false);
    expect(t.isOnDashboard(t.get('design')!)).toBe(true);
    expect(t.isOnDashboard(t.get('web')!)).toBe(false);
    expect(t.isOnDashboard(t.get('old-task')!)).toBe(false);
    expect(t.isOnDashboard({ ...t.get('web')!, showInDashboard: true })).toBe(true);
  });

  it('validParentsFor excludes the node itself and its descendants', () => {
    const ids = sampleTree()
      .validParentsFor('web')
      .map((n) => n.id);
    expect(ids).toContain('acme');
    expect(ids).toContain('app');
    expect(ids).not.toContain('web');
    expect(ids).not.toContain('design');
  });

  it('treats orphans as roots and survives parent cycles', () => {
    const t = new TreeIndex([
      makeNode({ id: 'orphan', parentId: 'gone' }),
      makeNode({ id: 'a', parentId: 'b' }),
      makeNode({ id: 'b', parentId: 'a' }),
    ]);
    expect(t.roots().map((n) => n.id)).toEqual(['orphan']);
    expect(t.ancestorIds('a')).toEqual(['b']);
    expect(t.subtreeIds('a').sort()).toEqual(['a', 'b']);
  });
});

describe('aggregation', () => {
  it('closedSubtreeSeconds sums closed entries up the tree and skips running ones', () => {
    const t = sampleTree();
    const entries = [
      makeEntry({ id: '1', nodeId: 'design', start: 0, end: H }),
      makeEntry({ id: '2', nodeId: 'web', start: 0, end: 2 * H }),
      makeEntry({ id: '3', nodeId: 'app', start: 0, end: null }),
      makeEntry({ id: '4', nodeId: 'old-task', start: 0, end: H }),
    ];
    const closed = closedSubtreeSeconds(t, entries);
    expect(closed.get('design')).toBe(3600);
    expect(closed.get('web')).toBe(3 * 3600);
    expect(closed.get('app')).toBe(0);
    expect(closed.get('acme')).toBe(4 * 3600);
  });

  it('liveSubtreeSeconds adds the running entry to its node and ancestors only', () => {
    const t = sampleTree();
    const running = makeEntry({ id: 'r', nodeId: 'design', start: 0, end: null });
    const closed = new Map([['acme', 100]]);
    expect(liveSubtreeSeconds(t, closed, 'acme', running, 60_000)).toBe(160);
    expect(liveSubtreeSeconds(t, closed, 'design', running, 60_000)).toBe(60);
    expect(liveSubtreeSeconds(t, closed, 'app', running, 60_000)).toBe(0);
  });

  it('entriesByNode groups by node', () => {
    const m = entriesByNode([makeEntry({ id: '1', nodeId: 'a', start: 0 }), makeEntry({ id: '2', nodeId: 'a', start: 1 })]);
    expect(m.get('a')?.length).toBe(2);
  });
});

describe('reorderSiblings', () => {
  const sibs = (...ids: string[]) =>
    ids.map((id, order) => makeNode({ id: id.replace('*', ''), order, archived: id.endsWith('*') || undefined }));
  const ids = (nodes: { id: string }[] | null) => nodes?.map((n) => n.id) ?? null;

  it('swaps with the adjacent sibling', () => {
    expect(ids(reorderSiblings(sibs('a', 'b', 'c'), 'b', -1))).toEqual(['b', 'a', 'c']);
    expect(ids(reorderSiblings(sibs('a', 'b', 'c'), 'b', 1))).toEqual(['a', 'c', 'b']);
  });

  it('returns null at either end', () => {
    expect(reorderSiblings(sibs('a', 'b'), 'a', -1)).toBeNull();
    expect(reorderSiblings(sibs('a', 'b'), 'b', 1)).toBeNull();
  });

  it('regression: skips hidden archived siblings so the visible order always changes', () => {
    // Visible order is a, c. Moving c up must put it before a, not just before the hidden b.
    expect(ids(reorderSiblings(sibs('a', 'b*', 'c'), 'c', -1))).toEqual(['c', 'a', 'b']);
    expect(ids(reorderSiblings(sibs('a', 'b*', 'c'), 'a', 1))).toEqual(['b', 'c', 'a']);
    // Only archived siblings in that direction: nothing visible to pass, so no move.
    expect(reorderSiblings(sibs('a*', 'b'), 'b', -1)).toBeNull();
  });

  it('an archived node (shown via "Show archived") moves past any sibling', () => {
    expect(ids(reorderSiblings(sibs('a', 'b*'), 'b', -1))).toEqual(['b', 'a']);
  });
});
