import type { Priority, TreeNode } from "./types";
import { todayString } from "./validation";

export const PRIORITY_LABELS: Record<Priority, string> = {
  0: "无",
  1: "低",
  2: "中",
  3: "高",
};

export const PRIORITY_COLORS: Record<Priority, string> = {
  0: "var(--border-strong)",
  1: "#7f9dbf",
  2: "#c29a4f",
  3: "#bd6350",
};

export function dueInfo(
  node: TreeNode,
  completed: boolean,
  today = todayString(),
): { label: string; tone: "overdue" | "today" | "plain" } | null {
  if (!node.dueDate) return null;
  if (!completed && node.dueDate < today) {
    return { label: "逾期", tone: "overdue" };
  }
  if (!completed && node.dueDate === today) {
    return { label: "今天", tone: "today" };
  }
  const [, month, day] = node.dueDate.split("-");
  return { label: `${month}-${day}`, tone: "plain" };
}

export function formatDate(value: string | null): string {
  if (!value) return "未设置";
  return value;
}

export function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export function formatUsage(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
