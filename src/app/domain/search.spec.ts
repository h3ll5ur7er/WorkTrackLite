import { makeEntry, makeNode } from '../testing/test-db';
import { fold, highlight, parseQuery, searchEntries } from './search';
import { TreeIndex } from './tree';

const tree = new TreeIndex([
  makeNode({ id: 'acme', name: 'Acme Café' }),
  makeNode({ id: 'web', parentId: 'acme', name: 'Website', tags: ['client'] }),
  makeNode({ id: 'int', name: 'Internal' }),
]);
const entries = [
  makeEntry({ id: 'a', nodeId: 'web', start: 1000, note: 'Login page review', tags: ['review'] }),
  makeEntry({ id: 'b', nodeId: 'int', start: 3000, note: 'Weekly review meeting' }),
  makeEntry({ id: 'c', nodeId: 'web', start: 2000, note: 'Fix login bug', tags: ['bug'] }),
];
const ids = (q: string) => searchEntries(entries, tree, parseQuery(q)).map((e) => e.id);

describe('search', () => {
  it('matches all words in the note, tags and node path, newest first', () => {
    expect(ids('review')).toEqual(['b', 'a']);
    expect(ids('LOGIN')).toEqual(['c', 'a']);
    expect(ids('login review')).toEqual(['a']);
    expect(ids('website')).toEqual(['c', 'a']);
    expect(ids('cafe login')).toEqual(['c', 'a']); // accent-insensitive, matches the parent's name
    expect(ids('')).toEqual([]);
    expect(ids('nothing')).toEqual([]);
  });

  it('#tag terms match entry or node tags by prefix', () => {
    expect(ids('#rev')).toEqual(['a']);
    expect(ids('#client')).toEqual(['c', 'a']); // inherited from the node
    expect(ids('#client bug')).toEqual(['c']);
    expect(ids('#')).toEqual(entries.filter((e) => e.note?.includes('#')).map((e) => e.id));
  });

  it('highlights matches, ignoring case and accents', () => {
    expect(highlight('Café review', [fold('cafe')])).toEqual([
      { text: 'Café', match: true },
      { text: ' review', match: false },
    ]);
    expect(highlight('review the review', ['review'])).toEqual([
      { text: 'review', match: true },
      { text: ' the ', match: false },
      { text: 'review', match: true },
    ]);
    expect(highlight('x', [])).toEqual([{ text: 'x', match: false }]);
    expect(highlight('', ['x'])).toEqual([]);
  });
});
