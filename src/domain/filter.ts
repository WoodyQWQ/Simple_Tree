import type { Filters, LeafStats, NodeId, TreeNode } from "./types";
import { ancestorsOf } from "./tree";
import { isCompleted } from "./stats";
import { addDays, todayString } from "./validation";

export function isFilterActive(filters: Filters): boolean {
  return (
    filters.status !== "all" ||
    filters.priorities.length > 0 ||
    filters.due !== "all"
  );
}

export interface VisibilityResult {
  visible: Set<NodeId> | null;
  matches: Set<NodeId>;
}

export function computeVisibility(
  nodes: Map<NodeId, TreeNode>,
  childrenOf: Map<NodeId | null, TreeNode[]>,
  stats: LeafStats,
  filters: Filters,
  today = todayString(),
): VisibilityResult {
  if (!isFilterActive(filters)) {
    return { visible: null, matches: new Set() };
  }
  const weekEnd = addDays(today, 6);
  const matches = new Set<NodeId>();

  for (const node of nodes.values()) {
    const completed = isCompleted(node, childrenOf, stats);
    if (filters.status === "active" && completed) continue;
    if (filters.status === "completed" && !completed) continue;
    if (filters.priorities.length > 0 && !filters.priorities.includes(node.priority)) continue;

    if (filters.due !== "all") {
      if (filters.due === "none") {
        if (node.dueDate !== null) continue;
      } else {
        if (!node.dueDate || completed) continue;
        if (filters.due === "overdue" && !(node.dueDate < today)) continue;
        if (filters.due === "today" && node.dueDate !== today) continue;
        if (filters.due === "week" && !(node.dueDate >= today && node.dueDate <= weekEnd)) continue;
      }
    }
    matches.add(node.id);
  }

  const visible = new Set<NodeId>(matches);
  for (const id of matches) {
    for (const ancestorId of ancestorsOf(id, nodes)) visible.add(ancestorId);
  }
  return { visible, matches };
}
