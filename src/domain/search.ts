import type { NodeId, TreeNode } from "./types";
import { pathLabel } from "./tree";

export interface SearchResult {
  node: TreeNode;
  path: string;
  score: number;
}

export function normalizeSearch(value: string): string {
  return value.normalize("NFKC").toLowerCase();
}

export function searchNodes(
  nodes: Map<NodeId, TreeNode>,
  rawQuery: string,
  limit = 50,
): SearchResult[] {
  const query = normalizeSearch(rawQuery.trim());
  if (!query) return [];
  const results: SearchResult[] = [];
  for (const node of nodes.values()) {
    const title = normalizeSearch(node.title);
    const index = title.indexOf(query);
    if (index < 0) continue;
    let score = 0;
    if (title === query) score = 3000;
    else if (index === 0) score = 2000;
    else score = 1000;
    results.push({ node, path: pathLabel(node.id, nodes), score });
  }
  results.sort(
    (a, b) =>
      b.score - a.score ||
      b.node.updatedAt.localeCompare(a.node.updatedAt) ||
      a.node.title.localeCompare(b.node.title),
  );
  return results.slice(0, limit);
}

export function highlightParts(title: string, rawQuery: string): Array<{ text: string; match: boolean }> {
  const query = rawQuery.trim();
  if (!query) return [{ text: title, match: false }];
  const normalizedTitle = title.normalize("NFKC").toLowerCase();
  const normalizedQuery = normalizeSearch(query);
  const index = normalizedTitle.indexOf(normalizedQuery);
  if (index < 0) return [{ text: title, match: false }];
  // NFKC 归一化通常保持长度；若不一致则退化为整体展示，避免错位截断。
  if (title.length !== normalizedTitle.length) {
    return [{ text: title, match: false }];
  }
  return [
    { text: title.slice(0, index), match: false },
    { text: title.slice(index, index + normalizedQuery.length), match: true },
    { text: title.slice(index + normalizedQuery.length), match: false },
  ].filter((part) => part.text.length > 0);
}
