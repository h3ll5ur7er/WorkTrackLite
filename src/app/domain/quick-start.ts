import { Node, TimeEntry } from '../core/models';
import { TreeIndex } from './tree';

export interface QuickStart {
  node: Node;
  favorite: boolean;
}

/**
 * The dashboard's quick-start row: favourites (by name), then the nodes used
 * most recently (latest entry first) that are not favourites. Archived nodes
 * and nodes under an archived ancestor are left out.
 */
export function quickStart(tree: TreeIndex, entries: readonly TimeEntry[], recentLimit = 5): QuickStart[] {
  const usable = (n: Node | undefined): n is Node => !!n && !n.archived && !tree.hasArchivedAncestor(n.id);
  const favorites = tree.nodes.filter((n) => n.favorite && usable(n)).sort((a, b) => a.name.localeCompare(b.name));
  const out: QuickStart[] = favorites.map((node) => ({ node, favorite: true }));
  const seen = new Set(favorites.map((n) => n.id));
  // A running entry counts as the most recent use.
  const byRecency = [...entries].sort((a, b) => (b.end ?? Infinity) - (a.end ?? Infinity) || b.start - a.start);
  let recent = 0;
  for (const e of byRecency) {
    if (recent >= recentLimit) break;
    if (seen.has(e.nodeId)) continue;
    seen.add(e.nodeId);
    const node = tree.get(e.nodeId);
    if (!usable(node)) continue;
    out.push({ node, favorite: false });
    recent++;
  }
  return out;
}
