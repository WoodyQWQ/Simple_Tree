import type { TreeNode } from "../domain/types";
import { APP_ID, SCHEMA_VERSION, validateImport, type ImportResult } from "../domain/validation";

export interface ExportFile {
  app: string;
  schemaVersion: number;
  exportedAt: string;
  nodes: TreeNode[];
}

export function buildExport(nodes: TreeNode[], now = new Date()): ExportFile {
  return {
    app: APP_ID,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    nodes,
  };
}

export function exportFileName(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `simple-tree-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
    now.getHours(),
  )}${pad(now.getMinutes())}.json`;
}

export function downloadExport(nodes: TreeNode[]): void {
  const payload = JSON.stringify(buildExport(nodes), null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = exportFileName();
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function parseImportFile(file: File): Promise<ImportResult> {
  let text: string;
  try {
    text = await file.text();
  } catch {
    return {
      ok: false,
      errors: [{ index: -1, field: "file", message: "无法读取文件" }],
    };
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return {
      ok: false,
      errors: [{ index: -1, field: "file", message: "文件不是合法 JSON" }],
    };
  }
  return validateImport(json);
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
  try {
    const estimate = await navigator.storage.estimate();
    return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 };
  } catch {
    return null;
  }
}
