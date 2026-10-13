import { Node, TimeEntry } from '../core/models';
import { entryDurationSeconds } from './budget';

/**
 * Read-only, precomputed view of the node hierarchy. Build it once per change
 * of the node list (DataService.tree) and share it, instead of re-deriving
 * children/paths/descendants in every component.
 */
export class TreeIndex {
  readonly byId: ReadonlyMap<string, Node>;
  /** parentId → children sorted by (order, name). Includes archived nodes. */
  private readonly children: ReadonlyMap<string | null, Node[]>;
  private readonly pathCache = new Map<string, string[]>();

  constructor(readonly nodes: readonly Node[]) {
    this.byId = new Map(nodes.map((n) => [n.id, n] as const));
    const children = new Map<string | null, Node[]>();
    for (const n of nodes) {
      // Orphans (parent missing) are treated as roots so they stay reachable.
      const parent = n.parentId != null && this.byId.has(n.parentId) ? n.parentId : null;
      const arr = children.get(parent) ?? [];
      arr.push(n);
      children.set(parent, arr);
    }
    for (const arr of children.values()) arr.sort(compareSiblings);
    this.children = children;
  }

  get(id: string | null | undefined): Node | undefined {
    return id == null ? undefined : this.byId.get(id);
  }

  childrenOf(id: string | null, opts: { includeArchived?: boolean } = {}): Node[] {
    const all = this.children.get(id) ?? [];
    return opts.includeArchived ? all : all.filter((n) => !n.archived);
  }

  roots(opts: { includeArchived?: boolean } = {}): Node[] {
    return this.childrenOf(null, opts);
  }

  /** A node is a leaf when it has no non-archived children. */
  isLeaf(id: string): boolean {
    return this.childrenOf(id).length === 0;
  }

  /** Whether a node should show on the dashboard (explicit override, else leaves only). */
  isOnDashboard(n: Node): boolean {
    if (n.archived || this.hasArchivedAncestor(n.id)) return false;
    return n.showInDashboard ?? this.isLeaf(n.id);
  }

  hasArchivedAncestor(id: string): boolean {
    return this.ancestorIds(id).some((a) => this.byId.get(a)?.archived);
  }

  /** Ancestor ids from the direct parent up to the root. */
  ancestorIds(id: string): string[] {
    const out: string[] = [];
    const seen = new Set<string>([id]);
    let cur = this.byId.get(id);
    while (cur?.parentId && this.byId.has(cur.parentId) && !seen.has(cur.parentId)) {
      out.push(cur.parentId);
      seen.add(cur.parentId);
      cur = this.byId.get(cur.parentId);
    }
    return out;
  }

  /** Names from the root down to the node itself. */
  pathNames(id: string): string[] {
    const cached = this.pathCache.get(id);
    if (cached) return cached;
    const n = this.byId.get(id);
    if (!n) return [];
    const names = [
      ...this.ancestorIds(id)
        .reverse()
        .map((a) => this.byId.get(a)!.name),
      n.name,
    ];
    this.pathCache.set(id, names);
    return names;
  }

  /** "Customer / Project / Task" */
  pathLabel(id: string): string {
    return this.pathNames(id).join(' / ');
  }

  /** `id` plus all descendants (archived included), depth first. */
  subtreeIds(id: string): string[] {
    const out: string[] = [];
    const stack = [id];
    const seen = new Set<string>();
    while (stack.length) {
      const cur = stack.pop()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      out.push(cur);
      for (const k of this.childrenOf(cur, { includeArchived: true })) stack.push(k.id);
    }
    return out;
  }

  /** Nodes `id` may be moved under: anything outside its own subtree (null = top level). */
  validParentsFor(id: string): Node[] {
    const forbidden = new Set(this.subtreeIds(id));
    return this.nodes.filter((n) => !forbidden.has(n.id) && !n.archived);
  }
}

function compareSiblings(a: Node, b: Node): number {
  return a.order - b.order || a.name.localeCompare(b.name);
}

/** Groups entries by node id. */
export function entriesByNode(entries: Iterable<TimeEntry>): Map<string, TimeEntry[]> {
  const m = new Map<string, TimeEntry[]>();
  for (const e of entries) {
    const arr = m.get(e.nodeId);
    if (arr) arr.push(e);
    else m.set(e.nodeId, [e]);
  }
  return m;
}

/**
 * Seconds of *closed* entries per node, summed over each node's subtree.
 * Running entries are excluded so the result only changes when data changes;
 * add the live running time on top (see `liveSubtreeSeconds`).
 */
export function closedSubtreeSeconds(tree: TreeIndex, entries: Iterable<TimeEntry>): Map<string, number> {
  const own = new Map<string, number>();
  for (const e of entries) {
    if (e.end == null) continue;
    own.set(e.nodeId, (own.get(e.nodeId) ?? 0) + entryDurationSeconds(e));
  }
  const total = new Map<string, number>();
  const visit = (id: string, seen: Set<string>): number => {
    const cached = total.get(id);
    if (cached !== undefined) return cached;
    if (seen.has(id)) return 0; // defensive: cycles in corrupted data
    seen.add(id);
    let sum = own.get(id) ?? 0;
    for (const k of tree.childrenOf(id, { includeArchived: true })) sum += visit(k.id, seen);
    total.set(id, sum);
    return sum;
  };
  for (const n of tree.nodes) visit(n.id, new Set());
  return total;
}

/** Closed subtree seconds plus the running entry's elapsed time if it is inside the subtree. */
export function liveSubtreeSeconds(
  tree: TreeIndex,
  closed: ReadonlyMap<string, number>,
  nodeId: string,
  running: TimeEntry | null,
  now: number,
): number {
  let s = closed.get(nodeId) ?? 0;
  if (running && (running.nodeId === nodeId || tree.ancestorIds(running.nodeId).includes(nodeId))) {
    s += entryDurationSeconds(running, now);
  }
  return s;
}
