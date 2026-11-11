import type { NodeId, NodePosition } from "../domain/types";
import { getDb, memoryPositions } from "./database";

export async function loadPositions(): Promise<Record<NodeId, NodePosition>> {
  const db = getDb();
  const record: Record<NodeId, NodePosition> = {};
  if (!db) {
    for (const [id, pos] of memoryPositions) record[id] = { ...pos };
    return record;
  }
  const rows = await db.getAll("graphPositions");
  for (const row of rows) record[row.id] = { x: row.x, y: row.y };
  return record;
}

export async function savePosition(id: NodeId, pos: NodePosition): Promise<void> {
  const db = getDb();
  if (!db) {
    memoryPositions.set(id, { ...pos });
    return;
  }
  await db.put("graphPositions", { id, x: pos.x, y: pos.y });
}

export async function deletePositions(ids: NodeId[]): Promise<void> {
  if (ids.length === 0) return;
  const db = getDb();
  if (!db) {
    for (const id of ids) memoryPositions.delete(id);
    return;
  }
  const tx = db.transaction("graphPositions", "readwrite");
  for (const id of ids) await tx.store.delete(id);
  await tx.done;
}

export async function clearPositions(): Promise<void> {
  const db = getDb();
  if (!db) {
    memoryPositions.clear();
    return;
  }
  await db.clear("graphPositions");
}