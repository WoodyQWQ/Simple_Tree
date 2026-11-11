import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { BackupRecord, NodeFile, NodePosition, TreeNode } from "../domain/types";

interface SettingRow {
  key: string;
  value: unknown;
}

interface PositionRow extends NodePosition {
  id: string;
}

interface SimpleTreeDB extends DBSchema {
  nodes: {
    key: string;
    value: TreeNode;
  };
  backups: {
    key: string;
    value: BackupRecord;
  };
  settings: {
    key: string;
    value: SettingRow;
  };
  graphPositions: {
    key: string;
    value: PositionRow;
  };
  nodeFiles: {
    key: string;
    value: NodeFile;
  };
}

const DB_NAME = "simple-tree";
const DB_VERSION = 4;

let db: IDBPDatabase<SimpleTreeDB> | null = null;
let memoryMode = false;

export const memoryNodes = new Map<string, TreeNode>();
export const memoryBackups: BackupRecord[] = [];
export const memorySettings = new Map<string, unknown>();
export const memoryPositions = new Map<string, NodePosition>();
export const memoryFiles = new Map<string, NodeFile>();

export async function initStorage(): Promise<"persistent" | "memory"> {
  if (db) return "persistent";
  if (typeof indexedDB === "undefined") {
    memoryMode = true;
    return "memory";
  }
  try {
    db = await openDB<SimpleTreeDB>(DB_NAME, DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains("nodes")) {
          database.createObjectStore("nodes", { keyPath: "id" });
        }
        if (!database.objectStoreNames.contains("backups")) {
          database.createObjectStore("backups", { keyPath: "id" });
        }
        if (!database.objectStoreNames.contains("settings")) {
          database.createObjectStore("settings", { keyPath: "key" });
        }
        if (!database.objectStoreNames.contains("graphPositions")) {
          database.createObjectStore("graphPositions", { keyPath: "id" });
        }
        if (!database.objectStoreNames.contains("nodeFiles")) {
          database.createObjectStore("nodeFiles", { keyPath: "id" });
        }
      },
    });
    memoryMode = false;
    return "persistent";
  } catch {
    db = null;
    memoryMode = true;
    return "memory";
  }
}

export function getDb(): IDBPDatabase<SimpleTreeDB> | null {
  return db;
}

export function isMemoryMode(): boolean {
  return memoryMode;
}
