import { memo, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { NodeId, TreeNode } from "../../domain/types";
import { PRIORITY_COLORS, PRIORITY_LABELS, dueInfo } from "../../domain/format";
import { collectSubtreeIds } from "../../domain/tree";
import { subtreeSummary } from "../../domain/commands";
import { useTreeStore } from "../../store/treeStore";
import { confirmDialog } from "../../store/dialogStore";
import { Icon } from "../../components/ui";

export type DropPosition = "before" | "after" | "inside";

export interface TreeRowProps {
  node: TreeNode;
  depth: number;
  selected: boolean;
  container: boolean;
  completed: boolean;
  done: number;
  total: number;
  matched: boolean;
  hits: number;
  flashNonce: number | null;
  editing: boolean;
  dropPosition: DropPosition | null;
  onRequestEdit: (id: NodeId) => void;
  onRequestAdd: (id: NodeId) => void;
  onRequestSibling: (id: NodeId) => void;
  onEndEdit: () => void;
}

function nodesToMap(): Map<NodeId, TreeNode> {
  const state = useTreeStore.getState();
  return new Map(Object.values(state.nodes ?? {}).map((node) => [node.id, node]));
}

function InlineTitleEditor({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (value: string) => Promise<boolean> | boolean;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const composing = useRef(false);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const commit = async () => {
    if (done.current) return;
    const trimmed = value.replace(/\r?\n/g, " ").trim();
    if (!trimmed) {
      done.current = true;
      useTreeStore.getState().pushToast({ message: "请输入名称", type: "info", duration: 2000 });
      onCancel();
      return;
    }
    done.current = true;
    const ok = await onCommit(trimmed);
    if (!ok) {
      done.current = false;
      window.setTimeout(() => ref.current?.focus(), 0);
    }
  };

  return (
    <input
      ref={ref}
      className="input"
      style={{ height: 26, padding: "0 7px", fontSize: 13 }}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        if (composing.current) return;
        if (event.key === "Enter") {
          event.preventDefault();
          void commit();
        } else if (event.key === "Escape") {
          event.preventDefault();
          done.current = true;
          onCancel();
        }
      }}
      onBlur={() => {
        void commit();
      }}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
      }}
      aria-label="事项标题"
    />
  );
}

function RowMenu({
  node,
  container,
  completed,
  position,
  onClose,
  onRequestEdit,
  onRequestSibling,
}: {
  node: TreeNode;
  container: boolean;
  completed: boolean;
  position: { top: number; left: number };
  onClose: () => void;
  onRequestEdit: () => void;
  onRequestSibling: () => void;
}) {
  const completeSubtree = async () => {
    const map = nodesToMap();
    const summary = subtreeSummary(map, node.id);
    const ok = await confirmDialog({
      title: completed ? "取消完成子树" : "完成子树",
      message: completed
        ? `将「${node.title}」下的 ${summary.total} 个事项标记为未完成？`
        : `完成「${node.title}」下的 ${summary.incomplete} 个未完成事项？`,
      confirmLabel: completed ? "取消完成" : "全部完成",
      extra: "该操作会写入子树内所有叶子事项，可在之后撤销。",
    });
    if (ok) {
      onClose();
      await useTreeStore.getState().setSubtreeCompleted(node.id, !completed);
    }
  };

  const remove = async () => {
    onClose();
    const map = nodesToMap();
    const ids = collectSubtreeIds(map, node.id);
    const children = ids.length - 1;
    if (children > 0) {
      const summary = subtreeSummary(map, node.id);
      const ok = await confirmDialog({
        title: "删除事项",
        message: `将删除「${node.title}」及 ${children} 个子事项，其中 ${summary.incomplete} 项未完成。`,
        confirmLabel: "删除",
        danger: true,
        extra: "删除后可在本次会话内撤销。",
      });
      if (!ok) return;
    }
    await useTreeStore.getState().deleteNode(node.id);
  };

  return createPortal(
    <>
      <div style={{ position: "fixed", inset: 0, zIndex: 70 }} onMouseDown={onClose} />
      <div className="menu" style={{ position: "fixed", top: position.top, left: position.left, zIndex: 71 }}>
        <button
          className="menu-item"
          onClick={() => {
            onClose();
            onRequestEdit();
          }}
        >
          重命名
        </button>
        <button
          className="menu-item"
          onClick={() => {
            onClose();
            onRequestSibling();
          }}
        >
          新建同级
        </button>
        {container && (
          <button className="menu-item" onClick={() => void completeSubtree()}>
            {completed ? "取消完成子树" : "完成子树"}
          </button>
        )}
        <div className="menu-sep" />
        <button className="menu-item danger" onClick={() => void remove()}>
          删除
        </button>
      </div>
    </>,
    document.body,
  );
}

export const TreeRow = memo(function TreeRow({
  node,
  depth,
  selected,
  container,
  completed,
  done,
  total,
  matched,
  hits,
  flashNonce,
  editing,
  dropPosition,
  onRequestEdit,
  onRequestAdd,
  onRequestSibling,
  onEndEdit,
}: TreeRowProps) {
  const expanded = useTreeStore((state) => state.expanded.has(node.id));
  const toggleExpanded = useTreeStore((state) => state.toggleExpanded);
  const selectNode = useTreeStore((state) => state.selectNode);
  const setLeafCompleted = useTreeStore((state) => state.setLeafCompleted);
  const setSubtreeCompleted = useTreeStore((state) => state.setSubtreeCompleted);
  const renameNode = useTreeStore((state) => state.renameNode);
  const attachFiles = useTreeStore((state) => state.attachFiles);
  const today = useTreeStore((state) => state.today);
  const [flash, setFlash] = useState(false);
  const [fileOver, setFileOver] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<{ top: number; left: number } | null>(null);

  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: node.id,
    disabled: editing,
  });
  const { setNodeRef: setDropRef } = useDroppable({ id: node.id });
  const setRef = (element: HTMLDivElement | null) => {
    setDragRef(element);
    setDropRef(element);
  };

  useEffect(() => {
    if (!flashNonce) return;
    setFlash(true);
    const timer = window.setTimeout(() => setFlash(false), 2000);
    return () => window.clearTimeout(timer);
  }, [flashNonce]);

  const due = dueInfo(node, completed, today);
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  const indent = 12 + Math.min(depth, 6) * 20;

  const toggleComplete = async () => {
    if (!container) {
      await setLeafCompleted(node.id, !completed);
      return;
    }
    const summary = subtreeSummary(nodesToMap(), node.id);
    const ok = await confirmDialog({
      title: completed ? "取消完成子树" : "完成子树",
      message: completed
        ? `将「${node.title}」下的 ${summary.total} 个事项标记为未完成？`
        : `完成「${node.title}」下的 ${summary.incomplete} 个未完成事项？`,
      confirmLabel: completed ? "取消完成" : "全部完成",
      extra: "批量操作使用同一时间戳，可在之后撤销。",
    });
    if (ok) await setSubtreeCompleted(node.id, !completed);
  };

  const rowClass = [
    "tree-row",
    selected ? "selected" : "",
    flash ? "flash" : "",
    matched ? "matched" : "",
    dropPosition === "inside" ? "inside-drop" : "",
    fileOver ? "inside-drop" : "",
    due?.tone === "overdue" ? "overdue" : "",
    isDragging ? "dragging" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={setRef}
      className={rowClass}
      style={{ paddingLeft: indent }}
      {...attributes}
      {...listeners}
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={selected}
      aria-expanded={container ? expanded : undefined}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("button,input")) return;
        selectNode(node.id);
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setFileOver(true);
      }}
      onDragLeave={() => setFileOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setFileOver(false);
        const files = Array.from(event.dataTransfer.files ?? []);
        if (files.length === 0) return;
        void attachFiles(node.id, files);
      }}
      title={node.title}
    >
      {dropPosition === "before" && <span className="drop-line" style={{ top: 0, left: indent }} />}
      {dropPosition === "after" && (
        <span className="drop-line" style={{ bottom: 0, left: indent }} />
      )}
      <button
        className={`row-chevron${expanded ? " open" : ""}`}
        aria-label={expanded ? "折叠" : "展开"}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          toggleExpanded(node.id);
        }}
        style={{ visibility: container ? "visible" : "hidden" }}
      >
        <Icon name="chevron" size={13} />
      </button>

      <button
        className={
          container
            ? `ring${completed ? " done" : ""}`
            : `row-check${completed ? " done" : ""}`
        }
        style={container ? ({ "--p": percent } as CSSProperties) : undefined}
        aria-label={completed ? `取消完成 ${node.title}` : `完成 ${node.title}`}
        aria-pressed={completed}
        title={
          container
            ? `${done} / ${total} 已完成（${percent}%）`
            : completed
              ? "取消完成"
              : "完成"
        }
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          void toggleComplete();
        }}
      >
        {container ? (
          percent === 100 ? <Icon name="check" size={10} /> : null
        ) : completed ? (
          <Icon name="check" size={12} />
        ) : null}
      </button>

      {depth >= 7 && (
        <span className="kbd" style={{ flex: "0 0 auto" }} title={`层级 ${depth + 1}`}>
          L{depth + 1}
        </span>
      )}

      <div style={{ minWidth: 0, flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
        {editing ? (
          <InlineTitleEditor
            initial={node.title}
            onCommit={async (value) => {
              const outcome = await renameNode(node.id, value);
              if (outcome.ok) onEndEdit();
              return outcome.ok;
            }}
            onCancel={onEndEdit}
          />
        ) : (
          <span
            className={`row-title${completed ? " completed" : ""}`}
            onDoubleClick={(event) => {
              event.stopPropagation();
              onRequestEdit(node.id);
            }}
          >
            {node.title}
          </span>
        )}
        {node.priority !== 0 && (
          <span
            className="priority-dot"
            style={{ background: PRIORITY_COLORS[node.priority] }}
            title={`优先级：${PRIORITY_LABELS[node.priority]}`}
          />
        )}
      </div>

      {hits > 0 && (
        <span className="progress-pill" style={{ background: "var(--accent-soft)" }}>
          含 {hits} 项命中
        </span>
      )}

      {due && (
        <span className={`due-badge ${due.tone}`} title={`截止日 ${node.dueDate}`}>
          {due.label}
        </span>
      )}

      {container && (
        <span className="row-progress" title={`${percent}% 已完成`}>
          {done} / {total}
        </span>
      )}

      <span className="row-actions">
        <button
          className="row-action"
          title="添加子事项"
          aria-label={`在 ${node.title} 下添加子事项`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onRequestAdd(node.id);
          }}
        >
          <Icon name="plus" size={14} />
        </button>
        <button
          className="row-action"
          title="更多操作"
          aria-label={`${node.title} 的更多操作`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            const rect = event.currentTarget.getBoundingClientRect();
            setMenuAnchor({ top: rect.bottom + 4, left: Math.max(8, rect.right - 180) });
          }}
        >
          <Icon name="more" size={15} />
        </button>
      </span>

      {menuAnchor && (
        <RowMenu
          node={node}
          container={container}
          completed={completed}
          position={menuAnchor}
          onClose={() => setMenuAnchor(null)}
          onRequestEdit={() => onRequestEdit(node.id)}
          onRequestSibling={() => onRequestSibling(node.id)}
        />
      )}
    </div>
  );
});
