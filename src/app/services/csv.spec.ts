import { Node, TimeEntry } from '../data/models';
import { buildNodePaths, entriesToCsv } from './csv';

function node(id: string, parentId: string | null, name: string): Node {
  return {
    id, parentId, name, kind: 'k', order: 0,
    budget: { type: 'none', seconds: 0 }, createdAt: 0, updatedAt: 0,
  };
}

describe('csv service', () => {
  it('buildNodePaths joins ancestors with " / "', () => {
    const nodes = [node('a', null, 'A'), node('b', 'a', 'B'), node('c', 'b', 'C')];
    const paths = buildNodePaths(nodes);
    expect(paths.get('c')).toBe('A / B / C');
    expect(paths.get('a')).toBe('A');
  });

  it('entriesToCsv emits header plus a row per entry with proper escaping', () => {
    const nodes = [node('a', null, 'Acme, Inc.')];
    const e: TimeEntry = {
      id: 'e1', nodeId: 'a', start: 0, end: 3_600_000,
      note: 'has "quotes" and , comma', createdAt: 0, updatedAt: 0,
    };
    const csv = entriesToCsv([e], nodes, 0);
    const lines = csv.trim().split('\n');
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain('entry_id');
    // node path containing comma must be quoted
    expect(lines[1]).toContain('"Acme, Inc."');
    // note containing quotes must be quoted with quotes doubled
    expect(lines[1]).toContain('"has ""quotes"" and , comma"');
    // 1 hour duration → "3600,1.0000"
    expect(lines[1]).toContain(',3600,1.0000,');
  });

  it('omits end ISO for running entries', () => {
    const nodes = [node('a', null, 'A')];
    const e: TimeEntry = { id: 'e1', nodeId: 'a', start: 0, end: null, createdAt: 0, updatedAt: 0 };
    const csv = entriesToCsv([e], nodes, 60_000);
    // duration 60 seconds, end column blank
    expect(csv).toContain(',1970-01-01T00:00:00.000Z,,60,0.0167,');
  });
});
