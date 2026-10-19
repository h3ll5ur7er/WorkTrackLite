import { Absence, AbsenceKind, Budget, BudgetType, DEFAULT_SETTINGS, HierarchyTemplate, Node, Settings, TimeEntry } from '../core/models';
import { isCurrencyCode } from './billing';
import { isHexColor } from './color';
import { closeAllButNewest } from './entries';
import { fromDateKey } from './time';

const ABSENCE_KIND_IDS: readonly AbsenceKind[] = ['vacation', 'sick', 'holiday', 'other'];

/**
 * JSON backup format. Bump BACKUP_FORMAT_VERSION whenever the persisted shape
 * changes and extend `migrateBackup` so older files still import.
 */
export const BACKUP_APP_ID = 'worktracklite';
export const BACKUP_FORMAT_VERSION = 2;

export interface BackupData {
  nodes: Node[];
  entries: TimeEntry[];
  templates: HierarchyTemplate[];
  settings: Settings;
}

export interface BackupFile extends BackupData {
  app: typeof BACKUP_APP_ID;
  formatVersion: number;
  exportedAt: string;
}

export function createBackup(data: BackupData, now = Date.now()): BackupFile {
  return { app: BACKUP_APP_ID, formatVersion: BACKUP_FORMAT_VERSION, exportedAt: new Date(now).toISOString(), ...data };
}

export function backupFileName(now = Date.now(), encrypted = false): string {
  const d = new Date(now);
  const p = (n: number) => String(n).padStart(2, '0');
  return `worktracklite-backup-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}${encrypted ? '.encrypted' : ''}.json`;
}

export type ParseResult = { ok: true; data: BackupData; warnings: string[] } | { ok: false; error: string };

/**
 * Parses and validates a backup file. Rejects anything that would leave the
 * database inconsistent (dangling references, cycles, duplicate ids) so an
 * import can safely replace all existing data.
 */
export function parseBackup(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'The file is not valid JSON.' };
  }
  if (!isObject(raw) || raw['app'] !== BACKUP_APP_ID) {
    return { ok: false, error: 'This is not a WorkTrackLite backup.' };
  }
  const version = raw['formatVersion'];
  if (typeof version !== 'number' || version < 1) return { ok: false, error: 'Missing backup format version.' };
  if (version > BACKUP_FORMAT_VERSION) {
    return { ok: false, error: `This backup was made by a newer version (format ${version}). Update the app first.` };
  }
  try {
    const warnings: string[] = [];
    const data = migrateBackup(raw, version, warnings);
    validate(data);
    return { ok: true, data, warnings };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Lifts older backup formats to the current one. `version` is the file's declared format version. */
function migrateBackup(raw: Record<string, unknown>, version: number, warnings: string[]): BackupData {
  const nodes = arrayOf(raw, 'nodes').map(toNode);
  const entries = arrayOf(raw, 'entries').map(toEntry);
  const templates = raw['templates'] === undefined ? [] : arrayOf(raw, 'templates').map(toTemplate);
  const settings = toSettings(raw['settings']);
  // v1 → v2: `per_hour` became `target` (applied regardless of the declared version, so
  // hand-edited files cannot smuggle the legacy value into the database).
  for (const n of nodes) if ((n.budget.type as string) === 'per_hour') n.budget.type = 'target';
  // Invariant: at most one running entry.
  const fixed = closeAllButNewest(entries.filter((e) => e.end == null));
  if (fixed.length) {
    const byId = new Map(fixed.map((e) => [e.id, e] as const));
    for (let i = 0; i < entries.length; i++) entries[i] = byId.get(entries[i].id) ?? entries[i];
    warnings.push(`Closed ${fixed.length} duplicate running timer(s).`);
  }
  return { nodes, entries, templates, settings };
}

function validate({ nodes, entries }: BackupData): void {
  const ids = new Set<string>();
  for (const n of nodes) {
    if (ids.has(n.id)) throw new Error(`Duplicate node id ${n.id}.`);
    ids.add(n.id);
  }
  for (const n of nodes) {
    if (n.parentId != null && !ids.has(n.parentId)) throw new Error(`Node "${n.name}" refers to a missing parent.`);
  }
  const parent = new Map(nodes.map((n) => [n.id, n.parentId] as const));
  for (const n of nodes) {
    const seen = new Set<string>();
    let cur: string | null | undefined = n.id;
    while (cur != null) {
      if (seen.has(cur)) throw new Error(`Node "${n.name}" is part of a parent cycle.`);
      seen.add(cur);
      cur = parent.get(cur);
    }
  }
  const entryIds = new Set<string>();
  for (const e of entries) {
    if (entryIds.has(e.id)) throw new Error(`Duplicate entry id ${e.id}.`);
    entryIds.add(e.id);
    if (!ids.has(e.nodeId)) throw new Error(`Entry ${e.id} refers to a missing node.`);
    if (e.end != null && e.end < e.start) throw new Error(`Entry ${e.id} ends before it starts.`);
  }
}

// --- field-level coercion -------------------------------------------------

const BUDGET_TYPES: readonly string[] = ['none', 'target', 'fixed', 'per_hour'];

function toNode(v: unknown, i: number): Node {
  const o = obj(v, `nodes[${i}]`);
  const b = obj(o['budget'] ?? { type: 'none', seconds: 0 }, `nodes[${i}].budget`);
  const type = str(b['type'], `nodes[${i}].budget.type`);
  if (!BUDGET_TYPES.includes(type)) throw new Error(`nodes[${i}] has unknown budget type "${type}".`);
  const budget: Budget = { type: type as BudgetType, seconds: num(b['seconds'] ?? 0, `nodes[${i}].budget.seconds`) };
  if (b['softLimit'] != null) budget.softLimit = num(b['softLimit'], `nodes[${i}].budget.softLimit`);
  return {
    id: str(o['id'], `nodes[${i}].id`),
    parentId: o['parentId'] == null ? null : str(o['parentId'], `nodes[${i}].parentId`),
    name: str(o['name'], `nodes[${i}].name`),
    kind: typeof o['kind'] === 'string' ? o['kind'] : 'Item',
    notes: optStr(o['notes']),
    tags: optTags(o['tags']),
    order: typeof o['order'] === 'number' ? o['order'] : 0,
    budget,
    color: isHexColor(o['color']) ? o['color'].toLowerCase() : undefined,
    rate: typeof o['rate'] === 'number' && Number.isFinite(o['rate']) && o['rate'] >= 0 ? o['rate'] : undefined,
    billable: typeof o['billable'] === 'boolean' ? o['billable'] : undefined,
    work: typeof o['work'] === 'boolean' ? o['work'] : undefined,
    favorite: o['favorite'] === true ? true : undefined,
    archived: o['archived'] === true ? true : undefined,
    showInDashboard: typeof o['showInDashboard'] === 'boolean' ? o['showInDashboard'] : undefined,
    createdAt: typeof o['createdAt'] === 'number' ? o['createdAt'] : 0,
    updatedAt: typeof o['updatedAt'] === 'number' ? o['updatedAt'] : 0,
  };
}

function toEntry(v: unknown, i: number): TimeEntry {
  const o = obj(v, `entries[${i}]`);
  return {
    id: str(o['id'], `entries[${i}].id`),
    nodeId: str(o['nodeId'], `entries[${i}].nodeId`),
    start: num(o['start'], `entries[${i}].start`),
    end: o['end'] == null ? null : num(o['end'], `entries[${i}].end`),
    note: optStr(o['note']),
    tags: optTags(o['tags']),
    billable: typeof o['billable'] === 'boolean' ? o['billable'] : undefined,
    createdAt: typeof o['createdAt'] === 'number' ? o['createdAt'] : 0,
    updatedAt: typeof o['updatedAt'] === 'number' ? o['updatedAt'] : 0,
  };
}

function toTemplate(v: unknown, i: number): HierarchyTemplate {
  const o = obj(v, `templates[${i}]`);
  const levels = o['levels'];
  if (!Array.isArray(levels) || !levels.every((l) => typeof l === 'string')) {
    throw new Error(`templates[${i}].levels must be a list of strings.`);
  }
  return { id: str(o['id'], `templates[${i}].id`), name: str(o['name'], `templates[${i}].name`), levels };
}

function toSettings(v: unknown): Settings {
  const o = isObject(v) ? v : {};
  const s: Settings = { ...DEFAULT_SETTINGS };
  if (o['theme'] === 'dark' || o['theme'] === 'light' || o['theme'] === 'system') s.theme = o['theme'];
  if (typeof o['templateId'] === 'string') s.templateId = o['templateId'];
  if (typeof o['lastNodeId'] === 'string') s.lastNodeId = o['lastNodeId'];
  if (typeof o['weekStartsOn'] === 'number' && o['weekStartsOn'] >= 0 && o['weekStartsOn'] <= 6) {
    s.weekStartsOn = o['weekStartsOn'];
  }
  if (typeof o['lastBackupAt'] === 'number') s.lastBackupAt = o['lastBackupAt'];
  if (isObject(o['tagColors'])) {
    const colors = Object.entries(o['tagColors']).filter((kv): kv is [string, string] => isHexColor(kv[1]));
    if (colors.length) s.tagColors = Object.fromEntries(colors.map(([k, v]) => [k, v.toLowerCase()]));
  }
  if (isCurrencyCode(o['currency'])) s.currency = o['currency'];
  const r = o['rounding'];
  if (isObject(r) && typeof r['minutes'] === 'number' && r['minutes'] >= 0 && ['up', 'nearest', 'down'].includes(r['mode'] as string)) {
    s.rounding = { minutes: r['minutes'], mode: r['mode'] as 'up' | 'nearest' | 'down' };
  }
  if (typeof o['idleGuard'] === 'boolean') s.idleGuard = o['idleGuard'];
  if (typeof o['budgetAlerts'] === 'boolean') s.budgetAlerts = o['budgetAlerts'];
  if (typeof o['lockedUntil'] === 'string' && fromDateKey(o['lockedUntil']) != null) s.lockedUntil = o['lockedUntil'];
  const wt = o['workTime'];
  if (
    isObject(wt) &&
    Array.isArray(wt['hours']) &&
    wt['hours'].length === 7 &&
    typeof wt['from'] === 'string' &&
    fromDateKey(wt['from']) != null
  ) {
    const hours = wt['hours'].map((h) => (typeof h === 'number' && h >= 0 && h <= 24 ? h : 0));
    s.workTime = { hours, from: wt['from'] };
    if (typeof wt['carrySeconds'] === 'number' && Number.isFinite(wt['carrySeconds'])) s.workTime.carrySeconds = wt['carrySeconds'];
  }
  if (Array.isArray(o['absences'])) {
    const byDate = new Map<string, Absence>();
    for (const a of o['absences']) {
      if (!isObject(a) || typeof a['date'] !== 'string' || fromDateKey(a['date']) == null) continue;
      if (!ABSENCE_KIND_IDS.includes(a['kind'] as AbsenceKind)) continue;
      byDate.set(a['date'], { date: a['date'], kind: a['kind'] as AbsenceKind, ...(a['half'] === true ? { half: true } : {}) });
    }
    if (byDate.size) s.absences = [...byDate.values()].sort((x, y) => x.date.localeCompare(y.date));
  }
  if (typeof o['budgetNotifications'] === 'boolean') s.budgetNotifications = o['budgetNotifications'];
  if (typeof o['idleAwayMinutes'] === 'number' && o['idleAwayMinutes'] > 0) s.idleAwayMinutes = o['idleAwayMinutes'];
  if (typeof o['idleLongRunningHours'] === 'number' && o['idleLongRunningHours'] > 0) s.idleLongRunningHours = o['idleLongRunningHours'];
  return s;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function obj(v: unknown, where: string): Record<string, unknown> {
  if (!isObject(v)) throw new Error(`${where} must be an object.`);
  return v;
}
function arrayOf(o: Record<string, unknown>, key: string): unknown[] {
  const v = o[key];
  if (!Array.isArray(v)) throw new Error(`"${key}" must be a list.`);
  return v;
}
function str(v: unknown, where: string): string {
  if (typeof v !== 'string' || !v) throw new Error(`${where} must be a non-empty string.`);
  return v;
}
function num(v: unknown, where: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${where} must be a number.`);
  return v;
}
function optStr(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}
function optTags(v: unknown): string[] | undefined {
  return Array.isArray(v) && v.length ? v.filter((t): t is string => typeof t === 'string') : undefined;
}
