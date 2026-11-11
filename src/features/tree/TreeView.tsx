import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { NodeId } from "../../domain/types";
import {
  ancestorsOf,
  flattenVisible,
  isSelfOrDescendant,
  nextSiblingId,
  type Row,
} from "../../domain/tree";
import { isCompleted } from "../../domain/stats";
import { FILTERS_NONE } from "../../domain/types";
import { isFilterActive } from "../../domain/filter";
import { useTreeStore } from "../../store/treeStore";
import { useTreeData, useVisibility } from "../../store/selectors";
import { TreeRow, type DropPosition } from "./TreeRow";
import { Icon } from "../../components/ui";

interface DisplayNode {
  kind: "node";
  row: Row;
  key: string;
}

interface DisplayAdd {
  kind: "add";
  depth: number;
  key: string;
}

type DisplayItem = DisplayNode | DisplayAdd;

function InlineAddRow({
  parentId,
  afterId,
  depth,
}: {
  parentId: NodeId | null;
  afterId: NodeId | null;
  depth: number;
}) {
  const createNode = useTreeStore((state) => state.createNode);
  const clearInlineAdd = useTreeStore((state) => state.clearInlineAdd);
  const [value, setValue] = useState("");
  const composing = useRef(false);
  const done = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const finish = async (submit: boolean) => {
    if (done.current) return;
    const trimmed = value.replace(/\r?\n/g, " ").trim();
    if (!submit) {
      done.current = true;
      clearInlineAdd();
      return;
    }
    if (!trimmed) {
      useTreeStore.getState().pushToast({ message: "请输入名称", type: "info", duration: 2000 });
      done.current = false;
      inputRef.current?.focus();
      return;
    }
    done.current = true;
    const outcome = await createNode({ parentId, afterId, title: trimmed });
    if (outcome.ok) clearInlineAdd();
    else done.current = false;
  };

  return (
    <div className="tree-row" style={{ paddingLeft: 12 + Math.min(depth, 6) * 20 }}>
      <span className="row-chevron" style={{ visibility: "hidden" }} />
      <span className="row-check" style={{ visibility: "hidden" }} />
      <input
        ref={inputRef}
        className="input"
        style={{ height: 26, padding: "0 7px", fontSize: 13 }}
        placeholder="事项名称，Enter 保存，Esc 取消"
        value={value}
        aria-label="新事项名称"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (composing.current) return;
          if (event.key === "Enter") {
            event.preventDefault();
            void finish(true);
          } else if (event.key === "Escape") {
            event.preventDefault();
            void finish(false);
          }
        }}
        onBlur={() => {
          void finish(value.trim().length > 0);
        }}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
      />
    </div>
  );
}

function BottomDropZone({ active, onAdd }: { active: boolean; onAdd: () => void }) {
  const { setNodeRef } = useDroppable({ id: "__bottom__" });
  return (
    <div
      ref={setNodeRef}
      style={{
        minHeight: 120,
        padding: "10px 16px 40px",
        background: active ? "var(--accent-soft)" : undefined,
        transition: "background 120ms ease",
      }}
    >
      <button className="btn btn-sm btn-ghost" style={{ color: "var(--muted)" }} onClick={onAdd}>
        <Icon name="plus" size={14} />
        新建顶层事项
      </button>
    </div>
  );
}

export function TreeView() {
  const data = useTreeData();
  const expanded = useTreeStore((state) => state.expanded);
  const filters = useTreeStore((state) => state.filters);
  const setFilters = useTreeStore((state) => state.setFilters);
  const selectedId = useTreeStore((state) => state.selectedId);
  const toggleExpanded = useTreeStore((state) => state.toggleExpanded);
  const setAllExpanded = useTreeStore((state) => state.setAllExpanded);
  const requestInlineAdd = useTreeStore((state) => state.requestInlineAdd);
  const inlineAdd = useTreeStore((state) => state.inlineAdd);
  const flash = useTreeStore((state) => state.flash);
  const focus = useTreeStore((state) => state.focus);
  const ready = useTreeStore((state) => state.ready);
  const showToast = useTreeStore((state) => state.pushToast);
  const moveNode = useTreeStore((state) => state.moveNode);
  const setSettingsOpen = useTreeStore((state) => state.setSettingsOpen);

  const [editingId, setEditingId] = useState<NodeId | null>(null);
  const [activeId, setActiveId] = useState<NodeId | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    id: string;
    position: DropPosition | "bottom";
  } | null>(null);
  const activeIdRef = useRef<NodeId | null>(null);
  const pointerStart = useRef(0);
  const hoverTimer = useRef<number | null>(null);
  const hoverTarget = useRef<NodeId | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const filterActive = isFilterActive(filters);
  const visibility = useVisibility(data, filters);

  const expandedForView = useMemo(() => {
    if (!filterActive || !visibility.visible) return expanded;
    return new Set([...expanded, ...visibility.visible]);
  }, [expanded, filterActive, visibility.visible]);

  const rows = useMemo(
    () => flattenVisible(data.childrenOf, expandedForView, visibility.visible),
    [data.childrenOf, expandedForView, visibility.visible],
  );

  const addIndex = useMemo(() => {
    if (!inlineAdd) return -1;
    if (inlineAdd.afterId) {
      const index = rows.findIndex((row) => row.node.id === inlineAdd.afterId);
      return index < 0 ? rows.length : index + 1;
    }
    if (inlineAdd.parentId) {
      const index = rows.findIndex((row) => row.node.id === inlineAdd.parentId);
      if (index < 0) return rows.length;
      const parentDepth = rows[index].depth;
      let cursor = index + 1;
      while (cursor < rows.length && rows[cursor].depth > parentDepth) cursor += 1;
      return cursor;
    }
    return rows.length;
  }, [inlineAdd, rows]);

  const display = useMemo(() => {
    const items: DisplayItem[] = rows.map((row) => ({
      kind: "node",
      row,
      key: row.node.id,
    }));
    if (inlineAdd) {
      const depth = inlineAdd.afterId
        ? rows.find((row) => row.node.id === inlineAdd.afterId)?.depth ?? 0
        : inlineAdd.parentId
          ? (rows.find((row) => row.node.id === inlineAdd.parentId)?.depth ?? -1) + 1
          : 0;
      items.splice(Math.min(Math.max(addIndex, 0), items.length), 0, {
        kind: "add",
        depth,
        key: `__add__${inlineAdd.nonce}`,
      });
    }
    return items;
  }, [rows, inlineAdd, addIndex]);

  const hitCounts = useMemo(() => {
    const counts = new Map<NodeId, number>();
    if (!filterActive) return counts;
    for (const id of visibility.matches) {
      for (const ancestorId of ancestorsOf(id, data.map)) {
        counts.set(ancestorId, (counts.get(ancestorId) ?? 0) + 1);
      }
    }
    return counts;
  }, [filterActive, visibility.matches, data.map]);

  const parentOf = useMemo(() => {
    const map = new Map<NodeId, NodeId | null>();
    for (const node of data.map.values()) map.set(node.id, node.parentId);
    return map;
  }, [data.map]);

  const virtualizer = useVirtualizer({
    count: display.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 36,
    overscan: 12,
  });

  useEffect(() => {
    if (!inlineAdd) return;
    const timer = window.setTimeout(() => {
      if (addIndex >= 0) virtualizer.scrollToIndex(addIndex, { align: "center" });
    }, 20);
    return () => window.clearTimeout(timer);
  }, [inlineAdd?.nonce, addIndex, virtualizer]);

  useEffect(() => {
    const targetId = flash?.id ?? focus?.id;
    if (!targetId) return;
    const index = display.findIndex(
      (item) => item.kind === "node" && item.row.node.id === targetId,
    );
    if (index >= 0) {
      window.requestAnimationFrame(() => {
        virtualizer.scrollToIndex(index, { align: "center" });
      });
    }
  }, [flash?.nonce, focus?.nonce, display, virtualizer]);

  const wasFilterActive = useRef(filterActive);
  const savedScroll = useRef(0);
  useEffect(() => {
    if (filterActive && !wasFilterActive.current) {
      savedScroll.current = scrollRef.current?.scrollTop ?? 0;
    } else if (!filterActive && wasFilterActive.current) {
      const top = savedScroll.current;
      window.requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = top;
      });
    }
    wasFilterActive.current = filterActive;
  }, [filterActive]);

  useEffect(() => {
    if (editingId && !data.map.has(editingId)) setEditingId(null);
  }, [editingId, data.map]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const collisionDetection: CollisionDetection = (args) => {
    const pointer = pointerWithin(args);
    if (pointer.length > 0) return pointer;
    return rectIntersection(args);
  };

  const resolvePosition = (
    overId: string,
    rect: { top: number; height: number },
    pointerY: number,
  ): { id: string; position: DropPosition | "bottom" } | null => {
    if (overId === "__bottom__") return { id: overId, position: "bottom" };
    const ratio = (pointerY - rect.top) / Math.max(1, rect.height);
    const position: DropPosition = ratio < 0.25 ? "before" : ratio > 0.75 ? "after" : "inside";
    const currentActiveId = activeIdRef.current;
    if (!currentActiveId) return { id: overId, position };
    if (overId === currentActiveId) return null;
    const newParentId =
      position === "inside" ? overId : parentOf.get(overId) ?? null;
    if (isSelfOrDescendant(newParentId, currentActiveId, parentOf)) return null;
    return { id: overId, position };
  };

  const clearDragState = () => {
    setActiveId(null);
    activeIdRef.current = null;
    setDropTarget(null);
    hoverTarget.current = null;
    if (hoverTimer.current) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  };

  const onDragStart = (event: DragStartEvent) => {
    const id = String(event.active.id);
    activeIdRef.current = id;
    setActiveId(id);
    const activator = event.activatorEvent as PointerEvent;
    pointerStart.current = activator.clientY ?? 0;
    setDropTarget(null);
  };

  const onDragMove = (event: DragMoveEvent) => {
    const { over } = event;
    if (!over) {
      setDropTarget(null);
      return;
    }
    const pointerY = pointerStart.current + event.delta.y;
    const next = resolvePosition(String(over.id), over.rect, pointerY);
    setDropTarget(next);

    if (next?.position === "inside" && next.id !== "__bottom__") {
      const target = data.map.get(next.id);
      const hasChildren = (data.childrenOf.get(next.id) ?? []).length > 0;
      if (target && hasChildren && !expanded.has(next.id)) {
        if (hoverTarget.current !== next.id) {
          if (hoverTimer.current) {
            window.clearTimeout(hoverTimer.current);
            hoverTimer.current = null;
          }
          hoverTarget.current = next.id;
          hoverTimer.current = window.setTimeout(() => {
            toggleExpanded(next.id);
            hoverTimer.current = null;
          }, 600);
        }
      } else {
        hoverTarget.current = null;
      }
    } else {
      if (hoverTimer.current) {
        window.clearTimeout(hoverTimer.current);
        hoverTimer.current = null;
      }
      hoverTarget.current = null;
    }
  };

  const onDragEnd = (event: DragEndEvent) => {
    const currentActiveId = activeIdRef.current;
    const over = event.over;
    if (!currentActiveId || !over) {
      clearDragState();
      return;
    }
    const pointerY = pointerStart.current + event.delta.y;
    const target = resolvePosition(String(over.id), over.rect, pointerY);
    if (!target) {
      showToast({ message: "不能移动到自身或子事项下", type: "error", duration: 4000 });
      clearDragState();
      return;
    }
    if (target.position === "bottom") {
      void moveNode(currentActiveId, null, null);
    } else {
      const targetNode = data.map.get(target.id);
      if (targetNode) {
        if (target.position === "inside") {
          void moveNode(currentActiveId, targetNode.id, null);
        } else if (target.position === "before") {
          void moveNode(currentActiveId, targetNode.parentId, targetNode.id);
        } else {
          void moveNode(
            currentActiveId,
            targetNode.parentId,
            nextSiblingId(targetNode, data.childrenOf),
          );
        }
      }
    }
    clearDragState();
  };

  const activeNode = activeId ? data.map.get(activeId) : null;
  const empty = data.map.size === 0;
  const noMatch = !empty && filterActive && rows.length === 0;

  return (
    <div className="content">
      <div className="tree-header">
        <span className="tree-title">全部事项</span>
        <span className="progress-pill">
          已完成 {data.overall.done} / {data.overall.total}
        </span>
        {filterActive && (
          <span className="progress-pill" style={{ background: "var(--accent-soft)" }}>
            筛选中 · {visibility.matches.size} 项命中
            <button
              className="row-action"
              style={{ width: 18, height: 18 }}
              aria-label="清除筛选"
              onClick={() => setFilters(FILTERS_NONE)}
            >
              <Icon name="close" size={11} />
            </button>
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button className="btn btn-sm btn-ghost" onClick={() => setAllExpanded(true)}>
          展开全部
        </button>
        <button className="btn btn-sm btn-ghost" onClick={() => setAllExpanded(false)}>
          收起全部
        </button>
      </div>

      <div className="tree-scroll" ref={scrollRef} role="tree" aria-label="事项树">
        {!ready ? (
          <div style={{ padding: 18 }}>
            {[62, 45, 52, 38].map((width, index) => (
              <div
                key={index}
                style={{
                  height: 12,
                  width: `${width}%`,
                  borderRadius: 6,
                  background: "var(--border)",
                  margin: "0 0 14px",
                  opacity: 0.7,
                }}
              />
            ))}
          </div>
        ) : empty ? (
          <div style={{ padding: "48px 20px" }}>
            <div className="empty-state" style={{ padding: 0 }}>
              <Icon name="tree" size={30} />
              <div className="empty-title">还没有事项</div>
              <div style={{ fontSize: 12 }}>数据保存在本机，可随时导出备份。</div>
              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                <button className="btn btn-primary" onClick={() => requestInlineAdd(null, null)}>
                  新建顶层事项
                </button>
                <button className="btn" onClick={() => setSettingsOpen(true)}>
                  导入数据
                </button>
              </div>
            </div>
            {inlineAdd && (
              <div style={{ maxWidth: 520, margin: "4px auto 0" }}>
                <InlineAddRow
                  parentId={inlineAdd.parentId}
                  afterId={inlineAdd.afterId}
                  depth={0}
                />
              </div>
            )}
          </div>
        ) : noMatch ? (
          <div className="empty-state" style={{ padding: 42 }}>
            <div className="empty-title">没有符合条件的事项</div>
            <button className="btn btn-sm" onClick={() => setFilters(FILTERS_NONE)}>
              清除筛选
            </button>
          </div>
        ) : null}

        {ready && !empty && (
          <DndContext
            sensors={sensors}
            collisionDetection={collisionDetection}
            onDragStart={onDragStart}
            onDragMove={onDragMove}
            onDragEnd={onDragEnd}
            onDragCancel={clearDragState}
          >
            <div className="tree-body" style={{ height: virtualizer.getTotalSize() }}>
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const item = display[virtualRow.index];
                if (!item) return null;
                return (
                  <div
                    key={item.key}
                    role="presentation"
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: virtualRow.size,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    {item.kind === "add" ? (
                      <InlineAddRow
                        parentId={inlineAdd?.parentId ?? null}
                        afterId={inlineAdd?.afterId ?? null}
                        depth={item.depth}
                      />
                    ) : (
                      <TreeRow
                        node={item.row.node}
                        depth={item.row.depth}
                        selected={selectedId === item.row.node.id}
                        container={(data.childrenOf.get(item.row.node.id) ?? []).length > 0}
                        completed={isCompleted(item.row.node, data.childrenOf, data.stats)}
                        done={data.stats.get(item.row.node.id)?.done ?? 0}
                        total={data.stats.get(item.row.node.id)?.total ?? 0}
                        matched={visibility.matches.has(item.row.node.id)}
                        hits={
                          filterActive && !visibility.matches.has(item.row.node.id)
                            ? hitCounts.get(item.row.node.id) ?? 0
                            : 0
                        }
                        flashNonce={flash?.id === item.row.node.id ? flash.nonce : null}
                        editing={editingId === item.row.node.id}
                        dropPosition={
                          dropTarget?.id === item.row.node.id &&
                          dropTarget.position !== "bottom"
                            ? dropTarget.position
                            : null
                        }
                        onRequestEdit={(id) => setEditingId(id)}
                        onRequestAdd={(id) => requestInlineAdd(id, null)}
                        onRequestSibling={(id) => {
                          const node = data.map.get(id);
                          if (node) requestInlineAdd(node.parentId, node.id);
                        }}
                        onEndEdit={() => setEditingId(null)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
            <DragOverlay dropAnimation={null}>
              {activeNode ? (
                <div className="drag-overlay">
                  <Icon name="tree" size={14} />
                  {activeNode.title}
                </div>
              ) : null}
            </DragOverlay>
            <BottomDropZone
              active={dropTarget?.position === "bottom"}
              onAdd={() => requestInlineAdd(null, null)}
            />
          </DndContext>
        )}
      </div>
    </div>
  );
}
