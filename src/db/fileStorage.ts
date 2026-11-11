import type { NodeId } from "../domain/types";

const DIR_NAME = "files";

/** 浏览器是否支持 OPFS（Origin Private File System）文件存储。 */
export function isFileStorageSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.storage !== "undefined" &&
    typeof navigator.storage.getDirectory === "function"
  );
}

async function fileDir() {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(DIR_NAME, { create: true });
}

export async function writeFileBlob(fileId: NodeId, blob: Blob): Promise<void> {
  const dir = await fileDir();
  const handle = await dir.getFileHandle(fileId, { create: true });
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

export async function readFileBlob(fileId: NodeId): Promise<Blob | null> {
  try {
    const dir = await fileDir();
    const handle = await dir.getFileHandle(fileId);
    return await handle.getFile();
  } catch {
    return null;
  }
}

export async function deleteFileBlob(fileId: NodeId): Promise<void> {
  const dir = await fileDir();
  await dir.removeEntry(fileId).catch(() => undefined);
}

export async function clearAllFileBlobs(): Promise<void> {
  const root = await navigator.storage.getDirectory();
  await root.removeEntry(DIR_NAME, { recursive: true }).catch(() => undefined);
}