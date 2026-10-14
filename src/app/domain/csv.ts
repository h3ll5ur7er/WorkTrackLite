import { Node, TimeEntry } from '../core/models';
import { Rounding } from '../core/models';
import { isBillable, roundSeconds } from './billing';
import { entryDurationSeconds } from './budget';
import { TreeIndex } from './tree';

const HEADER = [
  'entry_id',
  'node_id',
  'node_path',
  'kind',
  'start_iso',
  'end_iso',
  'duration_seconds',
  'duration_hours',
  'note',
  'tags',
  'billable',
  'rate',
  'amount',
];

/** RFC 4180 quoting. */
function csvEscape(v: string): string {
  return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

/**
 * Neutralises spreadsheet formula injection for user-entered text: a cell
 * starting with = + - @ (or tab / CR) is prefixed with a single quote so
 * Excel/LibreOffice/Sheets show it as text instead of evaluating it.
 */
function textCell(v: string | undefined): string {
  const s = v ?? '';
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

/** Entries as CSV, oldest first. Times are UTC ISO-8601; running entries have an empty end. */
export function entriesToCsv(
  entries: Iterable<TimeEntry>,
  nodes: readonly Node[] | TreeIndex,
  now = Date.now(),
  rounding?: Rounding,
): string {
  const tree = nodes instanceof TreeIndex ? nodes : new TreeIndex(nodes);
  const rows: string[] = [HEADER.join(',')];
  const sorted = [...entries].sort((a, b) => a.start - b.start);
  for (const e of sorted) {
    const dur = entryDurationSeconds(e, now);
    const billable = isBillable(tree, e);
    const rate = tree.rateOf(e.nodeId);
    const amount = billable && rate != null ? (Math.round((roundSeconds(dur, rounding) / 3600) * rate * 100) / 100).toFixed(2) : '';
    rows.push(
      [
        e.id,
        e.nodeId,
        textCell(tree.pathLabel(e.nodeId)),
        textCell(tree.get(e.nodeId)?.kind),
        new Date(e.start).toISOString(),
        e.end == null ? '' : new Date(e.end).toISOString(),
        String(dur),
        (dur / 3600).toFixed(4),
        textCell(e.note),
        textCell((e.tags ?? []).join('|')),
        billable ? 'yes' : 'no',
        rate == null ? '' : String(rate),
        amount,
      ]
        .map(csvEscape)
        .join(','),
    );
  }
  return rows.join('\n') + '\n';
}

/** Generic CSV for summary tables. Strings are treated as user text (formula-safe); numbers as-is. */
export function tableToCsv(header: readonly string[], rows: readonly (readonly (string | number)[])[]): string {
  const cell = (v: string | number) => (typeof v === 'number' ? String(v) : csvEscape(textCell(v)));
  return [header.map((h) => csvEscape(h)).join(','), ...rows.map((r) => r.map(cell).join(','))].join('\n') + '\n';
}
