import { useMemo } from "react";
import { useTreeStore } from "./treeStore";
import type { Filters, LeafStats, NodeId, TreeNode } from "../domain/types";
import { indexChildren } from "../domain/tree";
import { computeLeafStats, overallProgress } from "../domain/stats";
import { computeVisibility } from "../domain/filter";

export interface TreeData {
  map: Map<NodeId, TreeNode>;
  childrenOf: Map<NodeId | null, TreeNode[]>;
  stats: LeafStats;
  overall: { done: number; total: number };
}

export function useTreeData(): TreeData {
  const nodes = useTreeStore((state) => state.nodes);
  return useMemo(() => {
    const map = new Map<NodeId, TreeNode>(
      Object.values(nodes ?? {}).map((node) => [node.id, node]),
    );
    const childrenOf = indexChildren(map.values());
    const stats = computeLeafStats(map, childrenOf);
    return { map, childrenOf, stats, overall: overallProgress(stats, childrenOf) };
  }, [nodes]);
}

export function useVisibility(data: TreeData, filters: Filters) {
  const today = useTreeStore((state) => state.today);
  return useMemo(
    () => computeVisibility(data.map, data.childrenOf, data.stats, filters, today),
    [data, filters, today],
  );
}
