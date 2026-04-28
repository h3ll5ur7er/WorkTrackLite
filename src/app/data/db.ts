import Dexie, { Table } from 'dexie';
import { Node, Settings, TimeEntry, HierarchyTemplate } from './models';

export class WorkTrackDB extends Dexie {
  nodes!: Table<Node, string>;
  entries!: Table<TimeEntry, string>;
  templates!: Table<HierarchyTemplate, string>;
  settings!: Table<Settings, string>;

  constructor() {
    super('worktracklite');
    this.version(1).stores({
      nodes:     'id, parentId, kind, order, archived, updatedAt',
      entries:   'id, nodeId, start, end, updatedAt',
      templates: 'id, name',
      settings:  'id',
    });
  }
}

export const db = new WorkTrackDB();

export function uid(): string {
  // RFC4122-ish, sufficient for local-only ids.
  const c = (globalThis.crypto ?? (globalThis as any).msCrypto) as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
