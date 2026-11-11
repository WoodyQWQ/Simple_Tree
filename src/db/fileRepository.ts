import type { NodeFile, NodeId } from "../domain/types";
import { getDb, memoryFiles } from "./database";

export async function loadFiles(): Promise<Record<NodeId, NodeFile>> {
  const db = getDb();
  const record: Record<NodeId, NodeFile> = {};
  if (!db) {
    for (const file of memoryFiles.values()) record[file.id] = { ...file };
    return record;
  }
  const rows = await db.getAll("nodeFiles");
  for (const row of rows) record[row.id] = { ...row };
  return record;
}

export async function saveFile(file: NodeFile): Promise<void> {
  const db = getDb();
  if (!db) {
    memoryFiles.set(file.id, { ...file });
    return;
  }
  await db.put("nodeFiles", file);
}

export async function deleteFiles(ids: NodeId[]): Promise<void> {
  if (ids.length === 0) return;
  const db = getDb();
  if (!db) {
    for (const id of ids) memoryFiles.delete(id);
    return;
  }
  const tx = db.transaction("nodeFiles", "readwrite");
  for (const id of ids) await tx.store.delete(id);
  await tx.done;
}

export async function clearFiles(): Promise<void> {
  const db = getDb();
  if (!db) {
    memoryFiles.clear();
    return;
  }
  await db.clear("nodeFiles");
}