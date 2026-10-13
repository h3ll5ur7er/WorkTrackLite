import { DEFAULT_SETTINGS } from '../core/models';
import { makeEntry, makeNode } from '../testing/test-db';
import { BACKUP_FORMAT_VERSION, backupFileName, createBackup, parseBackup } from './backup';

const valid = () =>
  createBackup(
    {
      nodes: [makeNode({ id: 'a', budget: { type: 'fixed', seconds: 3600, softLimit: 1800 } }), makeNode({ id: 'b', parentId: 'a', tags: ['x'] })],
      entries: [makeEntry({ id: 'e', nodeId: 'b', start: 0, end: 1000, note: 'n', tags: ['t'] })],
      templates: [{ id: 'dev', name: 'Dev', levels: ['A', 'B'] }],
      settings: { ...DEFAULT_SETTINGS, theme: 'light', weekStartsOn: 0, lastNodeId: 'b' },
    },
    0,
  );

function parse(obj: unknown) {
  return parseBackup(JSON.stringify(obj));
}

describe('backup', () => {
  it('round-trips a backup unchanged', () => {
    const file = valid();
    const res = parse(file);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.nodes).toEqual(file.nodes);
    expect(res.data.entries).toEqual(file.entries);
    expect(res.data.templates).toEqual(file.templates);
    expect(res.data.settings).toEqual(file.settings);
    expect(res.warnings).toEqual([]);
    expect(file.formatVersion).toBe(BACKUP_FORMAT_VERSION);
  });

  it('rejects non-JSON, foreign JSON and newer formats', () => {
    expect(parseBackup('{nope')).toEqual({ ok: false, error: expect.stringContaining('not valid JSON') });
    expect(parse({ hello: 1 })).toEqual({ ok: false, error: expect.stringContaining('not a WorkTrackLite backup') });
    expect(parse({ ...valid(), formatVersion: 99 })).toEqual({ ok: false, error: expect.stringContaining('newer version') });
  });

  it('rejects dangling references, cycles, duplicates and inverted entries', () => {
    const b = valid();
    expect(parse({ ...b, entries: [makeEntry({ id: 'e', nodeId: 'zzz', start: 0 })] }).ok).toBe(false);
    expect(parse({ ...b, nodes: [makeNode({ id: 'a', parentId: 'zzz' })], entries: [] }).ok).toBe(false);
    expect(parse({ ...b, nodes: [makeNode({ id: 'a', parentId: 'b' }), makeNode({ id: 'b', parentId: 'a' })], entries: [] }).ok).toBe(false);
    expect(parse({ ...b, nodes: [makeNode({ id: 'a' }), makeNode({ id: 'a' })], entries: [] }).ok).toBe(false);
    expect(parse({ ...b, entries: [makeEntry({ id: 'e', nodeId: 'a', start: 10, end: 5 })] }).ok).toBe(false);
  });

  it('reports which field is wrong', () => {
    const res = parse({ ...valid(), nodes: [{ id: 'a', name: 5 }] });
    expect(res).toEqual({ ok: false, error: 'nodes[0].name must be a non-empty string.' });
  });

  it('migrates v1 backups: per_hour → target and duplicate running timers closed', () => {
    const v1 = {
      app: 'worktracklite',
      formatVersion: 1,
      nodes: [makeNode({ id: 'a', budget: { type: 'per_hour' as never, seconds: 10 } })],
      entries: [makeEntry({ id: 'x', nodeId: 'a', start: 1, end: null }), makeEntry({ id: 'y', nodeId: 'a', start: 2, end: null })],
      settings: { id: 'app', theme: 'dark', view: 'manage' },
    };
    const res = parse(v1);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.nodes[0].budget.type).toBe('target');
    expect(res.data.entries.filter((e) => e.end == null).map((e) => e.id)).toEqual(['y']);
    expect(res.data.settings.theme).toBe('dark');
    expect(res.warnings.length).toBe(1);
  });

  it('names files by local date', () => {
    expect(backupFileName(new Date(2026, 9, 3, 23, 59).getTime())).toBe('worktracklite-backup-2026-10-03.json');
  });
});
