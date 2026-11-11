import type { AiSettings } from "../domain/types";
import { getDb, memorySettings } from "./database";

const AI_KEY = "ai";

export async function loadAiSettings(): Promise<AiSettings | null> {
  const db = getDb();
  if (!db) return (memorySettings.get(AI_KEY) as AiSettings | undefined) ?? null;
  const row = await db.get("settings", AI_KEY);
  return (row?.value as AiSettings | undefined) ?? null;
}

export async function saveAiSettings(settings: AiSettings): Promise<void> {
  const db = getDb();
  if (!db) {
    memorySettings.set(AI_KEY, settings);
    return;
  }
  await db.put("settings", { key: AI_KEY, value: settings });
}

export async function clearAiSettings(): Promise<void> {
  const db = getDb();
  if (!db) {
    memorySettings.delete(AI_KEY);
    return;
  }
  await db.delete("settings", AI_KEY);
}
