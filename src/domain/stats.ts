import type { LeafStats, NodeId, TreeNode } from "./types";

export function computeLeafStats(
  nodes: Map<NodeId, TreeNode>,
  childrenOf: Map<NodeId | null, TreeNode[]>,
): LeafStats {
  const stats: LeafStats = new Map();
  const postOrder: NodeId[] = [];
  const queue: (NodeId | null)[] = [null];
  let head = 0;

  while (head < queue.length) {
    const parentId = queue[head++];
    for (const child of childrenOf.get(parentId) ?? []) {
      postOrder.push(child.id);
      queue.push(child.id);
    }
  }

  for (let i = postOrder.length - 1; i >= 0; i--) {
    const id = postOrder[i];
    const kids = childrenOf.get(id) ?? [];
    if (kids.length === 0) {
      const leaf = nodes.get(id)!;
      stats.set(id, { done: leaf.completedAt ? 1 : 0, total: 1 });
    } else {
      let done = 0;
      let total = 0;
      for (const kid of kids) {
        const s = stats.get(kid.id)!;
        done += s.done;
        total += s.total;
      }
      stats.set(id, { done, total });
    }
  }
  return stats;
}

export function isContainer(childrenOf: Map<NodeId | null, TreeNode[]>, id: NodeId): boolean {
  return (childrenOf.get(id)?.length ?? 0) > 0;
}

export function isCompleted(
  node: TreeNode,
  childrenOf: Map<NodeId | null, TreeNode[]>,
  stats: LeafStats,
): boolean {
  if (isContainer(childrenOf, node.id)) {
    const s = stats.get(node.id);
    return !!s && s.total > 0 && s.done === s.total;
  }
  return node.completedAt !== null;
}

export function overallProgress(
  stats: LeafStats,
  childrenOf: Map<NodeId | null, TreeNode[]>,
): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const [id, stat] of stats) {
    const isLeaf = (childrenOf.get(id) ?? []).length === 0;
    if (isLeaf) {
      done += stat.done;
      total += 1;
    }
  }
  return { done, total };
}

export function countSubtreeLeaves(
  nodes: Map<NodeId, TreeNode>,
  childrenOf: Map<NodeId | null, TreeNode[]>,
  id: NodeId,
): { done: number; total: number } {
  const stats = computeLeafStats(nodes, childrenOf);
  return stats.get(id) ?? { done: 0, total: 0 };
}
