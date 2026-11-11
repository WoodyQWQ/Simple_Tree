import type {
  Command,
  NodeId,
  NodePatch,
  PlanResult,
  TreeNode,
} from "./types";
import {
  collectSubtreeIds,
  compareNodes,
  isSelfOrDescendant,
  orderWithInsert,
  ORDER_STEP,
} from "./tree";
import { isCompleted, computeLeafStats } from "./stats";
import { indexChildren } from "./tree";
import { normalizeTitle, validateNote, validateTitle } from "./validation";

export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

function createPatch(label: string): NodePatch {
  return { before: new Map(), after: new Map(), label };
}

function stage(patch: NodePatch, before: TreeNode | null, after: TreeNode | null): void {
  const id = (after ?? before)!.id;
  if (!patch.before.has(id)) patch.before.set(id, before);
  patch.after.set(id, after);
}

function error(message: string): PlanResult {
  return { ok: false, error: message };
}

export function planCommand(nodes: Map<NodeId, TreeNode>, command: Command): PlanResult {
  switch (command.type) {
    case "node.create": {
      const checked = validateTitle(command.title);
      if (!checked.ok) return error(checked.error);
      const parent =
        command.parentId === null ? null : nodes.get(command.parentId) ?? null;
      if (command.parentId !== null && !parent) {
        return error("目标父节点已不存在，请重新选择");
      }

      const childrenOf = indexChildren(nodes.values());
      const siblings = [...(childrenOf.get(command.parentId) ?? [])];
      let after: TreeNode | null = null;
      if (command.afterId) {
        after = nodes.get(command.afterId) ?? null;
        if (!after || after.parentId !== command.parentId) {
          return error("目标位置已变化，请重试");
        }
      }

      let sortIndex: number;
      const sorted = siblings.slice().sort(compareNodes);
      if (after) {
        const index = sorted.findIndex((n) => n.id === after!.id);
        const next = sorted[index + 1];
        if (next && next.sortIndex - after.sortIndex > 1) {
          sortIndex = Math.floor((after.sortIndex + next.sortIndex) / 2);
        } else {
          sortIndex = after.sortIndex + ORDER_STEP;
        }
      } else if (sorted.length === 0) {
        sortIndex = ORDER_STEP;
      } else {
        sortIndex = Math.max(...sorted.map((n) => n.sortIndex)) + ORDER_STEP;
      }

      const timestamp = nowIso();
      const node: TreeNode = {
        id: newId(),
        parentId: command.parentId,
        title: checked.value,
        note: "",
        priority: 0,
        dueDate: null,
        sortIndex,
        completedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      const patch = createPatch(`新建「${node.title}」`);
      stage(patch, null, node);
      if (parent && parent.completedAt !== null) {
        stage(patch, parent, { ...parent, completedAt: null, updatedAt: timestamp });
      }
      return { ok: true, patch, selectId: node.id };
    }

    case "node.rename": {
      const node = nodes.get(command.id);
      if (!node) return error("事项已不存在");
      const checked = validateTitle(command.title);
      if (!checked.ok) return error(checked.error);
      if (checked.value === node.title) {
        return { ok: true, patch: createPatch("无变化"), selectId: node.id };
      }
      const patch = createPatch(`重命名「${node.title}」`);
      stage(patch, node, { ...node, title: checked.value, updatedAt: nowIso() });
      return { ok: true, patch, selectId: node.id };
    }

    case "node.update": {
      const node = nodes.get(command.id);
      if (!node) return error("事项已不存在");
      if (command.patch.note !== undefined) {
        const noteCheck = validateNote(command.patch.note);
        if (!noteCheck.ok) return error(noteCheck.error);
      }
      if (command.patch.dueDate !== undefined && command.patch.dueDate !== null) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(command.patch.dueDate)) {
          return error("日期格式不正确");
        }
      }
      const next: TreeNode = {
        ...node,
        ...command.patch,
        note:
          command.patch.note !== undefined ? command.patch.note : node.note,
        updatedAt: nowIso(),
      };
      const same =
        next.note === node.note &&
        next.priority === node.priority &&
        next.dueDate === node.dueDate;
      const patch = createPatch(`编辑「${node.title}」`);
      if (!same) stage(patch, node, next);
      return { ok: true, patch, selectId: node.id };
    }

    case "node.move": {
      const node = nodes.get(command.id);
      if (!node) return error("事项已不存在");
      if (command.newParentId !== null && !nodes.has(command.newParentId)) {
        return error("目标位置已不存在，请重试");
      }
      const childrenOf = indexChildren(nodes.values());
      if (command.beforeId !== null) {
        const anchor = nodes.get(command.beforeId);
        if (!anchor || anchor.parentId !== command.newParentId || anchor.id === node.id) {
          return error("目标位置已变化，请重试");
        }
      }
      const parentOf = new Map<NodeId, NodeId | null>();
      for (const n of nodes.values()) parentOf.set(n.id, n.parentId);
      if (isSelfOrDescendant(command.newParentId, node.id, parentOf)) {
        return error("不能移动到自身或子事项下");
      }

      const timestamp = nowIso();
      const patch = createPatch(`移动「${node.title}」`);
      const oldParentId = node.parentId;
      const sameParent = oldParentId === command.newParentId;

      if (sameParent) {
        const siblings = childrenOf.get(oldParentId) ?? [];
        const ordered = orderWithInsert(siblings, node.id, command.beforeId);
        const beforeIds = siblings.map((n) => n.id).join(",");
        const afterIds = ordered.map((n) => n.id).join(",");
        if (beforeIds === afterIds) {
          return { ok: true, patch, selectId: node.id };
        }
        ordered.forEach((sibling, index) => {
          const nextSort = (index + 1) * ORDER_STEP;
          if (sibling.sortIndex !== nextSort) {
            stage(patch, sibling, { ...sibling, sortIndex: nextSort, updatedAt: timestamp });
          }
        });
        return { ok: true, patch, selectId: node.id };
      }

      const sourceSiblings = (childrenOf.get(oldParentId) ?? []).filter((n) => n.id !== node.id);
      sourceSiblings.forEach((sibling, index) => {
        const nextSort = (index + 1) * ORDER_STEP;
        if (sibling.sortIndex !== nextSort) {
          stage(patch, sibling, { ...sibling, sortIndex: nextSort, updatedAt: timestamp });
        }
      });

      const destSiblings = [...(childrenOf.get(command.newParentId) ?? [])];
      const orderedDest = orderWithInsert(
        [...destSiblings, node],
        node.id,
        command.beforeId,
      );
      orderedDest.forEach((sibling, index) => {
        if (sibling.id === node.id) return;
        const nextSort = (index + 1) * ORDER_STEP;
        if (sibling.sortIndex !== nextSort) {
          stage(patch, sibling, { ...sibling, sortIndex: nextSort, updatedAt: timestamp });
        }
      });

      const movedIndex = orderedDest.findIndex((sibling) => sibling.id === node.id);
      stage(patch, node, {
        ...node,
        parentId: command.newParentId,
        sortIndex:
          movedIndex >= 0 ? (movedIndex + 1) * ORDER_STEP : node.sortIndex,
        updatedAt: timestamp,
      });

      if (command.newParentId !== null) {
        const newParent = nodes.get(command.newParentId)!;
        const wasLeaf = (childrenOf.get(newParent.id) ?? []).length === 0;
        if (wasLeaf && newParent.completedAt !== null) {
          stage(patch, newParent, { ...newParent, completedAt: null, updatedAt: timestamp });
        }
      }
      return { ok: true, patch, selectId: node.id };
    }

    case "node.delete": {
      const node = nodes.get(command.id);
      if (!node) return error("事项已不存在");
      const ids = collectSubtreeIds(nodes, command.id);
      const patch = createPatch(`删除「${node.title}」`);
      for (const id of ids) stage(patch, nodes.get(id)!, null);
      return { ok: true, patch, selectId: null };
    }

    case "node.complete": {
      const node = nodes.get(command.id);
      if (!node) return error("事项已不存在");
      const hasChildren = (indexChildren(nodes.values()).get(node.id) ?? []).length > 0;
      if (hasChildren) return error("容器请使用完成子树");
      if (command.completed && node.completedAt !== null) {
        return { ok: true, patch: createPatch("无变化"), selectId: node.id };
      }
      if (!command.completed && node.completedAt === null) {
        return { ok: true, patch: createPatch("无变化"), selectId: node.id };
      }
      const patch = createPatch(command.completed ? `完成「${node.title}」` : `取消完成「${node.title}」`);
      stage(patch, node, {
        ...node,
        completedAt: command.completed ? nowIso() : null,
        updatedAt: nowIso(),
      });
      return { ok: true, patch, selectId: node.id };
    }

    case "subtree.complete": {
      const node = nodes.get(command.id);
      if (!node) return error("事项已不存在");
      const ids = collectSubtreeIds(nodes, command.id);
      const childrenOf = indexChildren(nodes.values());
      const leaves = ids.filter((id) => (childrenOf.get(id) ?? []).length === 0);
      if (leaves.length === 0) return error("没有可完成的事项");
      const allCompleted = leaves.every((id) => nodes.get(id)!.completedAt !== null);
      if (command.completed === allCompleted) {
        return { ok: true, patch: createPatch("无变化"), selectId: node.id };
      }
      const timestamp = nowIso();
      const patch = createPatch(
        command.completed
          ? `完成「${node.title}」子树（${leaves.length} 项）`
          : `取消完成「${node.title}」子树（${leaves.length} 项）`,
      );
      for (const leafId of leaves) {
        const leaf = nodes.get(leafId)!;
        stage(patch, leaf, {
          ...leaf,
          completedAt: command.completed ? timestamp : null,
          updatedAt: timestamp,
        });
      }
      return { ok: true, patch, selectId: node.id };
    }

    case "data.replace": {
      const patch = createPatch("覆盖导入");
      for (const node of nodes.values()) stage(patch, node, null);
      const childrenOf = indexChildren(command.nodes);
      for (const node of command.nodes) {
        const isContainer = (childrenOf.get(node.id) ?? []).length > 0;
        stage(patch, nodes.get(node.id) ?? null, {
          ...node,
          completedAt: isContainer ? null : node.completedAt,
        });
      }
      return { ok: true, patch, selectId: null };
    }

    default:
      return error("未知操作");
  }
}

export function applyPatch(
  nodes: Record<NodeId, TreeNode>,
  patch: NodePatch,
  reverse = false,
): Record<NodeId, TreeNode> {
  const next = { ...nodes };
  const source = reverse ? patch.before : patch.after;
  for (const [id, node] of source) {
    if (node) next[id] = node;
    else delete next[id];
  }
  return next;
}

export function applyPatchToMap(
  nodes: Map<NodeId, TreeNode>,
  patch: NodePatch,
  reverse = false,
): Map<NodeId, TreeNode> {
  const next = new Map(nodes);
  const source = reverse ? patch.before : patch.after;
  for (const [id, node] of source) {
    if (node) next.set(id, node);
    else next.delete(id);
  }
  return next;
}

/** Count leaves and incomplete leaves in a subtree; used by confirmations. */
export function subtreeSummary(
  nodes: Map<NodeId, TreeNode>,
  id: NodeId,
): { total: number; incomplete: number } {
  const childrenOf = indexChildren(nodes.values());
  const ids = collectSubtreeIds(nodes, id);
  let total = 0;
  let incomplete = 0;
  for (const current of ids) {
    if ((childrenOf.get(current) ?? []).length === 0) {
      total += 1;
      if (!nodes.get(current)!.completedAt) incomplete += 1;
    }
  }
  return { total, incomplete };
}

export function subtreeIsCompleted(
  nodes: Map<NodeId, TreeNode>,
  id: NodeId,
): boolean {
  const childrenOf = indexChildren(nodes.values());
  const stats = computeLeafStats(nodes, childrenOf);
  const node = nodes.get(id);
  if (!node) return false;
  return isCompleted(node, childrenOf, stats);
}

export function subtitle(nodes: Map<NodeId, TreeNode>, id: NodeId | null): string {
  if (!id) return "";
  const node = nodes.get(id);
  return node ? normalizeTitle(node.title) : "";
}
