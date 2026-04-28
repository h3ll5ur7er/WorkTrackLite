import { Node, TimeEntry } from '../data/models';
import { entryDurationSeconds } from './budget';

const HEADER = ['entry_id', 'node_id', 'node_path', 'kind', 'start_iso', 'end_iso', 'duration_seconds', 'duration_hours', 'note', 'tags'];

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/** Build "Customer / Project / Task" path strings for each node id. */
export function buildNodePaths(nodes: Iterable<Node>): Map<string, string> {
  const byId = new Map<string, Node>();
  for (const n of nodes) byId.set(n.id, n);
  const cache = new Map<string, string>();
  function path(id: string): string {
    const cached = cache.get(id);
    if (cached !== undefined) return cached;
    const n = byId.get(id);
    if (!n) return '';
    const p = n.parentId ? path(n.parentId) + ' / ' + n.name : n.name;
    cache.set(id, p);
    return p;
  }
  for (const id of byId.keys()) path(id);
  return cache;
}

export function entriesToCsv(entries: Iterable<TimeEntry>, nodes: Iterable<Node>, now: number = Date.now()): string {
  const nodeList = [...nodes];
  const paths = buildNodePaths(nodeList);
  const byId = new Map(nodeList.map(n => [n.id, n] as const));
  const rows: string[] = [HEADER.join(',')];
  for (const e of entries) {
    const dur = entryDurationSeconds(e, now);
    const node = byId.get(e.nodeId);
    rows.push([
      e.id,
      e.nodeId,
      paths.get(e.nodeId) ?? '',
      node?.kind ?? '',
      new Date(e.start).toISOString(),
      e.end == null ? '' : new Date(e.end).toISOString(),
      String(dur),
      (dur / 3600).toFixed(4),
      e.note ?? '',
      (e.tags ?? []).join('|'),
    ].map(csvEscape).join(','));
  }
  return rows.join('\n') + '\n';
}
