import { makeEntry, makeNode } from '../testing/test-db';
import { entriesToCsv } from './csv';

describe('entriesToCsv', () => {
  const nodes = [makeNode({ id: 'a', name: 'Acme, Inc.', kind: 'Customer' }), makeNode({ id: 'b', parentId: 'a', name: 'Site' })];

  it('emits a header and RFC 4180-quoted rows', () => {
    const csv = entriesToCsv([makeEntry({ id: 'e1', nodeId: 'b', start: 0, end: 3_600_000, note: 'has "quotes" and , comma' })], nodes, 0);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('entry_id,node_id,node_path,kind,start_iso,end_iso,duration_seconds,duration_hours,note,tags');
    expect(lines[1]).toContain('"Acme, Inc. / Site"');
    expect(lines[1]).toContain('"has ""quotes"" and , comma"');
    expect(lines[1]).toContain(',3600,1.0000,');
  });

  it('leaves the end blank for running entries and measures to now', () => {
    const csv = entriesToCsv([makeEntry({ id: 'e1', nodeId: 'a', start: 0, end: null })], nodes, 60_000);
    expect(csv).toContain(',1970-01-01T00:00:00.000Z,,60,0.0167,');
  });

  it('neutralises spreadsheet formulas in text cells', () => {
    const evil = [makeNode({ id: 'x', name: '=HYPERLINK("http://evil")', kind: '+cmd' })];
    const csv = entriesToCsv([makeEntry({ id: 'e', nodeId: 'x', start: 0, note: '@SUM(A1)', tags: ['-1'] })], evil, 0);
    const row = csv.trim().split('\n')[1];
    expect(row).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(row).toContain(",'+cmd,");
    expect(row).toContain(",'@SUM(A1),'-1");
  });

  it('sorts rows chronologically', () => {
    const csv = entriesToCsv(
      [makeEntry({ id: 'late', nodeId: 'a', start: 5000 }), makeEntry({ id: 'early', nodeId: 'a', start: 1000 })],
      nodes,
      0,
    );
    const ids = csv
      .trim()
      .split('\n')
      .slice(1)
      .map((l) => l.split(',')[0]);
    expect(ids).toEqual(['early', 'late']);
  });
});
