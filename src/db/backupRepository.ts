import type { BackupMeta, BackupRecord, TreeNode } from "../domain/types";
import { SCHEMA_VERSION } from "../domain/validation";
import { newId } from "../domain/commands";
import { getDb, memoryBackups } from "./database";

const MAX_BACKUPS = 3;

export async function createBackup(
  nodes: TreeNode[],
  reason: string,
): Promise<BackupRecord> {
  const record: BackupRecord = {
    id: newId(),
    createdAt: new Date().toISOString(),
    reason,
    nodes: nodes.map((node) => ({ ...node })),
    schemaVersion: SCHEMA_VERSION,
  };
  const db = getDb();
  if (!db) {
    memoryBackups.unshift(record);
    memoryBackups.splice(MAX_BACKUPS);
    return record;
  }
  const tx = db.transaction("backups", "readwrite");
  await tx.store.put(record);
  const all = await tx.store.getAll();
  all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const stale of all.slice(MAX_BACKUPS)) {
    await tx.store.delete(stale.id);
  }
  await tx.done;
  return record;
}

export async function listBackups(): Promise<BackupMeta[]> {
  const db = getDb();
  const all = db ? await db.getAll("backups") : [...memoryBackups];
  return all
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, MAX_BACKUPS)
    .map((record) => ({
      id: record.id,
      createdAt: record.createdAt,
      reason: record.reason,
      count: record.nodes.length,
    }));
}

export async function getBackup(id: string): Promise<BackupRecord | null> {
  const db = getDb();
  if (!db) return memoryBackups.find((record) => record.id === id) ?? null;
  return (await db.get("backups", id)) ?? null;
}
