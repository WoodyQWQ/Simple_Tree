import type { NodeId, Priority, TreeNode } from "./types";
import { ORDER_STEP, compareNodes, indexChildren } from "./tree";

export const SCHEMA_VERSION = 1;
export const APP_ID = "simple-tree";
export const MAX_TITLE = 120;
export const MAX_NOTE = 5000;

export function normalizeTitle(raw: string): string {
  return raw.replace(/\r?\n/g, " ").trim();
}

export function validateTitle(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const value = normalizeTitle(raw);
  if (value.length === 0) return { ok: false, error: "请输入名称" };
  if ([...value].length > MAX_TITLE) return { ok: false, error: `标题不能超过 ${MAX_TITLE} 个字符` };
  return { ok: true, value };
}

export function validateNote(note: string): { ok: true } | { ok: false; error: string } {
  if (note.length > MAX_NOTE) return { ok: false, error: `备注不能超过 ${MAX_NOTE} 个字符` };
  return { ok: true };
}

export function isValidDateString(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export function todayString(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDays(dateString: string, days: number): string {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(year, month - 1, day + days);
  return todayString(date);
}

export interface ImportError {
  index: number;
  field: string;
  message: string;
}

export type ImportResult =
  | { ok: true; nodes: TreeNode[]; exportedAt: string | null }
  | { ok: false; errors: ImportError[] };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function validateNode(
  raw: unknown,
  index: number,
  errors: ImportError[],
): TreeNode | null {
  const fail = (field: string, message: string) => {
    errors.push({ index, field, message });
  };
  if (!isPlainObject(raw)) {
    fail("node", "节点必须是对象");
    return null;
  }
  const id = raw.id;
  if (typeof id !== "string" || id.trim() === "") fail("id", "id 必须是非空字符串");
  const parentId = raw.parentId;
  if (parentId !== null && typeof parentId !== "string") fail("parentId", "parentId 必须为空或字符串");
  const title = typeof raw.title === "string" ? normalizeTitle(raw.title) : "";
  if (!title) fail("title", "标题不能为空");
  if ([...title].length > MAX_TITLE) fail("title", `标题不能超过 ${MAX_TITLE} 个字符`);
  const note = raw.note;
  if (typeof note !== "string") fail("note", "note 必须是字符串");
  else if (note.length > MAX_NOTE) fail("note", `备注不能超过 ${MAX_NOTE} 个字符`);
  const priority = raw.priority;
  if (priority !== 0 && priority !== 1 && priority !== 2 && priority !== 3) {
    fail("priority", "priority 必须为 0–3");
  }
  const dueDate = raw.dueDate;
  if (dueDate !== null && (typeof dueDate !== "string" || !isValidDateString(dueDate))) {
    fail("dueDate", "dueDate 必须为 YYYY-MM-DD 或空");
  }
  const sortIndex = raw.sortIndex;
  if (typeof sortIndex !== "number" || !Number.isFinite(sortIndex)) {
    fail("sortIndex", "sortIndex 必须是有限数字");
  }
  const completedAt = raw.completedAt;
  if (completedAt !== null && !isIsoTimestamp(completedAt)) {
    fail("completedAt", "completedAt 必须为合法 ISO 时间或空");
  }
  if (!isIsoTimestamp(raw.createdAt)) fail("createdAt", "createdAt 必须为合法 ISO 时间");
  if (!isIsoTimestamp(raw.updatedAt)) fail("updatedAt", "updatedAt 必须为合法 ISO 时间");

  if (errors.some((e) => e.index === index)) return null;

  return {
    id: id as string,
    parentId: parentId as string | null,
    title,
    note: note as string,
    priority: priority as Priority,
    dueDate: dueDate as string | null,
    sortIndex: sortIndex as number,
    completedAt: completedAt as string | null,
    createdAt: raw.createdAt as string,
    updatedAt: raw.updatedAt as string,
  };
}

export function validateImport(input: unknown): ImportResult {
  if (!isPlainObject(input)) {
    return { ok: false, errors: [{ index: -1, field: "file", message: "文件内容不是 JSON 对象" }] };
  }
  if (input.app !== APP_ID) {
    return { ok: false, errors: [{ index: -1, field: "app", message: "不是 Simple Tree 导出文件" }] };
  }
  if (input.schemaVersion !== SCHEMA_VERSION) {
    const version = Number(input.schemaVersion);
    return {
      ok: false,
      errors: [
        {
          index: -1,
          field: "schemaVersion",
          message:
            version > SCHEMA_VERSION
              ? `文件版本 ${version} 高于当前支持的版本 ${SCHEMA_VERSION}`
              : `不支持的文件版本 ${String(input.schemaVersion)}`,
        },
      ],
    };
  }
  if (!Array.isArray(input.nodes)) {
    return { ok: false, errors: [{ index: -1, field: "nodes", message: "nodes 必须是数组" }] };
  }

  const errors: ImportError[] = [];
  const nodes: TreeNode[] = [];
  input.nodes.forEach((raw, index) => {
    const node = validateNode(raw, index, errors);
    if (node) nodes.push(node);
  });
  if (errors.length) return { ok: false, errors: errors.slice(0, 50) };

  const byId = new Map<NodeId, TreeNode>();
  for (const node of nodes) {
    if (byId.has(node.id)) {
      return {
        ok: false,
        errors: [{ index: -1, field: "id", message: `节点 id 重复：${node.id}` }],
      };
    }
    byId.set(node.id, node);
  }
  for (const node of nodes) {
    if (node.parentId !== null && !byId.has(node.parentId)) {
      return {
        ok: false,
        errors: [
          {
            index: -1,
            field: "parentId",
            message: `节点「${node.title}」的父节点不存在`,
          },
        ],
      };
    }
  }

  // DFS 染色检测环
  const color = new Map<NodeId, 0 | 1 | 2>();
  for (const node of nodes) {
    if (color.get(node.id) === 2) continue;
    const stack: Array<{ id: NodeId; entered: boolean }> = [{ id: node.id, entered: false }];
    while (stack.length) {
      const current = stack.pop()!;
      const currentColor = color.get(current.id) ?? 0;
      if (current.entered) {
        color.set(current.id, 2);
        continue;
      }
      if (currentColor === 1) {
        return {
          ok: false,
          errors: [{ index: -1, field: "parentId", message: "数据中存在环" }],
        };
      }
      color.set(current.id, 1);
      stack.push({ id: current.id, entered: true });
      const parentId = byId.get(current.id)!.parentId;
      if (parentId !== null) {
        const parentColor = color.get(parentId) ?? 0;
        if (parentColor === 1) {
          return {
            ok: false,
            errors: [{ index: -1, field: "parentId", message: "数据中存在环" }],
          };
        }
        if (parentColor === 0) stack.push({ id: parentId, entered: false });
      }
    }
  }

  // 归一化：容器完成时间清空；同级 sortIndex 重建
  const childrenOf = indexChildren(nodes);
  for (const list of childrenOf.values()) {
    const sorted = [...list].sort(compareNodes);
    const needsRebuild =
      new Set(sorted.map((n) => n.sortIndex)).size !== sorted.length;
    sorted.forEach((node, index) => {
      if (needsRebuild) node.sortIndex = (index + 1) * ORDER_STEP;
      if ((childrenOf.get(node.id) ?? []).length > 0) node.completedAt = null;
    });
  }

  return {
    ok: true,
    nodes,
    exportedAt: typeof input.exportedAt === "string" ? input.exportedAt : null,
  };
}

export function isValidTime(value: string): boolean {
  return isIsoTimestamp(value);
}
