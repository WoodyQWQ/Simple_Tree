import type { NodeId, TreeNode } from "./types";

export const ORDER_STEP = 1024;

export function compareNodes(a: TreeNode, b: TreeNode): number {
  return (
    a.sortIndex - b.sortIndex ||
    a.createdAt.localeCompare(b.createdAt) ||
    a.id.localeCompare(b.id)
  );
}

export function indexChildren(
  nodes: Iterable<TreeNode>,
): Map<NodeId | null, TreeNode[]> {
  const childrenOf = new Map<NodeId | null, TreeNode[]>();
  for (const node of nodes) {
    const list = childrenOf.get(node.parentId) ?? [];
    list.push(node);
    childrenOf.set(node.parentId, list);
  }
  for (const list of childrenOf.values()) {
    list.sort(compareNodes);
  }
  return childrenOf;
}

export function buildParentOf(nodes: Iterable<TreeNode>): Map<NodeId, NodeId | null> {
  const parentOf = new Map<NodeId, NodeId | null>();
  for (const node of nodes) parentOf.set(node.id, node.parentId);
  return parentOf;
}

/** Root-first ancestor ids, excluding the node itself. */
export function ancestorsOf(
  id: NodeId,
  nodes: Map<NodeId, TreeNode>,
): NodeId[] {
  const result: NodeId[] = [];
  const seen = new Set<NodeId>();
  let cursor = nodes.get(id)?.parentId ?? null;
  while (cursor !== null) {
    if (seen.has(cursor)) break;
    seen.add(cursor);
    result.push(cursor);
    cursor = nodes.get(cursor)?.parentId ?? null;
  }
  return result.reverse();
}

export function pathOf(id: NodeId, nodes: Map<NodeId, TreeNode>): TreeNode[] {
  const node = nodes.get(id);
  if (!node) return [];
  return [...ancestorsOf(id, nodes).map((ancestorId) => nodes.get(ancestorId)!), node].filter(
    Boolean,
  );
}

export function pathLabel(id: NodeId, nodes: Map<NodeId, TreeNode>): string {
  return pathOf(id, nodes)
    .map((n) => n.title)
    .join(" / ");
}

export function childPath(id: NodeId | null, nodes: Map<NodeId, TreeNode>): string {
  if (id === null) return "全部";
  return pathLabel(id, nodes) || "全部";
}

export function isSelfOrDescendant(
  candidateParentId: NodeId | null,
  nodeId: NodeId,
  parentOf: Map<NodeId, NodeId | null>,
): boolean {
  let cursor = candidateParentId;
  const seen = new Set<NodeId>();
  while (cursor !== null) {
    if (cursor === nodeId) return true;
    if (seen.has(cursor)) throw new Error("数据存在环");
    seen.add(cursor);
    cursor = parentOf.get(cursor) ?? null;
  }
  return false;
}

export function descendantsOf(
  nodes: Map<NodeId, TreeNode>,
  id: NodeId,
): Set<NodeId> {
  const childrenOf = indexChildren(nodes.values());
  const result = new Set<NodeId>();
  const stack = [id];
  while (stack.length) {
    const current = stack.pop()!;
    for (const child of childrenOf.get(current) ?? []) {
      if (result.has(child.id)) continue;
      result.add(child.id);
      stack.push(child.id);
    }
  }
  return result;
}

export function reindexSiblings(siblings: TreeNode[]): TreeNode[] {
  return siblings.map((node, index) => ({
    ...node,
    sortIndex: (index + 1) * ORDER_STEP,
  }));
}

export function nextSiblingId(
  target: TreeNode,
  childrenOf: Map<NodeId | null, TreeNode[]>,
): NodeId | null {
  const siblings = childrenOf.get(target.parentId) ?? [];
  const index = siblings.findIndex((n) => n.id === target.id);
  if (index < 0) return null;
  return siblings[index + 1]?.id ?? null;
}

export interface Row {
  node: TreeNode;
  depth: number;
}

export function flattenVisible(
  childrenOf: Map<NodeId | null, TreeNode[]>,
  expanded: Set<NodeId>,
  visibility: Set<NodeId> | null,
): Row[] {
  const rows: Row[] = [];
  const walk = (list: TreeNode[], depth: number) => {
    for (const node of list) {
      if (visibility && !visibility.has(node.id)) continue;
      rows.push({ node, depth });
      if (expanded.has(node.id)) walk(childrenOf.get(node.id) ?? [], depth + 1);
    }
  };
  walk(childrenOf.get(null) ?? [], 0);
  return rows;
}

export function collectSubtreeIds(
  nodes: Map<NodeId, TreeNode>,
  id: NodeId,
): NodeId[] {
  if (!nodes.has(id)) return [];
  return [id, ...descendantsOf(nodes, id)];
}

/** Resulting sibling list order after inserting `movingId` before `beforeId` (null = end). */
export function orderWithInsert(
  siblings: TreeNode[],
  movingId: NodeId,
  beforeId: NodeId | null,
): TreeNode[] {
  if (beforeId === movingId) return siblings;
  const list = siblings.filter((n) => n.id !== movingId);
  const moving = siblings.find((n) => n.id === movingId);
  if (!moving) return list;
  if (beforeId === null) return [...list, moving];
  const index = list.findIndex((n) => n.id === beforeId);
  if (index < 0) return [...list, moving];
  return [...list.slice(0, index), moving, ...list.slice(index)];
}
