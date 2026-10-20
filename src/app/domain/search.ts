import { TimeEntry } from '../core/models';
import { TreeIndex } from './tree';

/** Lower case without accents, so "cafe" finds "Café". */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

export interface Query {
  /** Words that must all appear in the note, tags or node path. */
  words: string[];
  /** `#tag` terms: the entry or its node must have a tag starting with each. */
  tags: string[];
}

export function parseQuery(q: string): Query {
  const words: string[] = [];
  const tags: string[] = [];
  for (const t of q.trim().split(/\s+/).filter(Boolean)) {
    if (t.startsWith('#') && t.length > 1) tags.push(fold(t.slice(1)));
    else words.push(fold(t));
  }
  return { words, tags };
}

export function isEmptyQuery(q: Query): boolean {
  return !q.words.length && !q.tags.length;
}

/** Entries matching every term, newest first. */
export function searchEntries(entries: readonly TimeEntry[], tree: TreeIndex, q: Query): TimeEntry[] {
  if (isEmptyQuery(q)) return [];
  const pathCache = new Map<string, string>();
  const path = (id: string) => {
    let p = pathCache.get(id);
    if (p === undefined) pathCache.set(id, (p = fold(tree.pathLabel(id))));
    return p;
  };
  const out: TimeEntry[] = [];
  for (const e of entries) {
    const tags = [...(e.tags ?? []), ...(tree.get(e.nodeId)?.tags ?? [])].map(fold);
    if (!q.tags.every((t) => tags.some((x) => x.startsWith(t)))) continue;
    const hay = `${fold(e.note ?? '')} ${tags.join(' ')} ${path(e.nodeId)}`;
    if (q.words.every((w) => hay.includes(w))) out.push(e);
  }
  return out.sort((a, b) => b.start - a.start);
}

export interface Segment {
  text: string;
  match: boolean;
}

/** Splits `text` into matching and non-matching parts for highlighting (accent-insensitive). */
export function highlight(text: string, words: readonly string[]): Segment[] {
  if (!text) return [];
  const folded = fold(text);
  // Folding can change the length (e.g. ligatures); then skip highlighting rather than misplace it.
  if (folded.length !== text.length || !words.length) return [{ text, match: false }];
  const marks = new Array<boolean>(text.length).fill(false);
  for (const w of words) {
    for (let i = folded.indexOf(w); w && i >= 0; i = folded.indexOf(w, i + w.length)) marks.fill(true, i, i + w.length);
  }
  const out: Segment[] = [];
  for (let i = 0; i < text.length;) {
    let j = i;
    while (j < text.length && marks[j] === marks[i]) j++;
    out.push({ text: text.slice(i, j), match: marks[i] });
    i = j;
  }
  return out;
}
