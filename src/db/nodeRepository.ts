import type { NodePatch, TreeNode } from "../domain/types";
import { getDb, memoryNodes } from "./database";

export async function loadNodes(): Promise<TreeNode[]> {
  const db = getDb();
  if (!db) return [...memoryNodes.values()];
  return db.getAll("nodes");
}

export async function commitPatch(patch: NodePatch): Promise<void> {
  const db = getDb();
  if (!db) {
    for (const [id, node] of patch.after) {
      if (node) memoryNodes.set(id, node);
      else memoryNodes.delete(id);
    }
    return;
  }
  const tx = db.transaction("nodes", "readwrite");
  for (const [id, node] of patch.after) {
    if (node) await tx.store.put(node);
    else await tx.store.delete(id);
  }
  await tx.done;
}

export async function replaceAllNodes(nodes: TreeNode[]): Promise<void> {
  const db = getDb();
  if (!db) {
    memoryNodes.clear();
    for (const node of nodes) memoryNodes.set(node.id, node);
    return;
  }
  const tx = db.transaction("nodes", "readwrite");
  await tx.store.clear();
  for (const node of nodes) await tx.store.put(node);
  await tx.done;
}
