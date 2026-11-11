import { useEffect, useMemo, useRef, useState } from "react";
import type { Priority } from "../../domain/types";
import { ancestorsOf, collectSubtreeIds } from "../../domain/tree";
import { isCompleted } from "../../domain/stats";
import { subtreeSummary } from "../../domain/commands";
import { dueInfo, formatTimestamp, PRIORITY_LABELS } from "../../domain/format";
import { isFilterActive } from "../../domain/filter";
import { useTreeData, useVisibility } from "../../store/selectors";
import { useTreeStore } from "../../store/treeStore";
import { confirmDialog } from "../../store/dialogStore";
import { Icon } from "../../components/ui";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DetailPanel() {
  const data = useTreeData();
  const selectedId = useTreeStore((state) => state.selectedId);
  const selectNode = useTreeStore((state) => state.selectNode);
  const setView = useTreeStore((state) => state.setView);
  const requestInlineAdd = useTreeStore((state) => state.requestInlineAdd);
  const renameNode = useTreeStore((state) => state.renameNode);
  const updateNode = useTreeStore((state) => state.updateNode);
  const deleteNode = useTreeStore((state) => state.deleteNode);
  const setLeafCompleted = useTreeStore((state) => state.setLeafCompleted);
  const setSubtreeCompleted = useTreeStore((state) => state.setSubtreeCompleted);
  const filters = useTreeStore((state) => state.filters);
  const today = useTreeStore((state) => state.today);
  const files = useTreeStore((state) => state.files);
  const attachFiles = useTreeStore((state) => state.attachFiles);
  const removeFile = useTreeStore((state) => state.removeFile);
  const openFile = useTreeStore((state) => state.openFile);
  const visibility = useVisibility(data, filters);

  const node = selectedId ? data.map.get(selectedId) ?? null : null;
  const [titleDraft, setTitleDraft] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const noteTimer = useRef<number | null>(null);
  const noteDirty = useRef(false);
  const noteRef = useRef("");
  const idRef = useRef<string | null>(null);
  const titleFocused = useRef(false);
  const noteFocused = useRef(false);

  useEffect(() => {
    const sameNode = idRef.current === (node?.id ?? null);
    if (sameNode) {
      if (!titleFocused.current) setTitleDraft(node?.title ?? "");
      if (!noteFocused.current) {
        setNoteDraft(node?.note ?? "");
        noteRef.current = node?.note ?? "";
        noteDirty.current = false;
      }
      return;
    }
    if (noteDirty.current && idRef.current && idRef.current !== (node?.id ?? null)) {
      void useTreeStore.getState().updateNode(idRef.current, { note: noteRef.current });
    }
    idRef.current = node?.id ?? null;
    setTitleDraft(node?.title ?? "");
    setNoteDraft(node?.note ?? "");
    noteRef.current = node?.note ?? "";
    noteDirty.current = false;
    if (noteTimer.current) {
      window.clearTimeout(noteTimer.current);
      noteTimer.current = null;
    }
  }, [node?.id, node?.title, node?.note]);

  useEffect(() => {
    return () => {
      if (noteTimer.current) window.clearTimeout(noteTimer.current);
      if (noteDirty.current && idRef.current) {
        void useTreeStore
          .getState()
          .updateNode(idRef.current, { note: noteRef.current });
      }
    };
  }, []);

  const hiddenByFilter = useMemo(() => {
    if (!node || !isFilterActive(filters) || !visibility.visible) return false;
    return !visibility.visible.has(node.id);
  }, [node, filters, visibility.visible]);

  if (!node) {
    return (
      <aside className="detail-panel empty" aria-label="事项详情">
        <div className="empty-state" style={{ padding: "48px 20px" }}>
          <div className="empty-title">未选择事项</div>
          <div style={{ fontSize: 12 }}>在大纲或图谱中选择一项查看详情。</div>
        </div>
      </aside>
    );
  }

  const childrenOf = data.childrenOf.get(node.id) ?? [];
  const container = childrenOf.length > 0;
  const completed = isCompleted(node, data.childrenOf, data.stats);
  const stats = data.stats.get(node.id) ?? { done: 0, total: 0 };
  const ancestors = ancestorsOf(node.id, data.map);
  const due = dueInfo(node, completed, today);
  const percent = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;
  const nodeFiles = Object.values(files ?? {})
    .filter((file) => file.nodeId === node.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const commitTitle = async () => {
    const trimmed = titleDraft.replace(/\r?\n/g, " ").trim();
    if (!trimmed) {
      setTitleDraft(node.title);
      useTreeStore.getState().pushToast({ message: "请输入名称", type: "info", duration: 2000 });
      return;
    }
    if (trimmed === node.title) return;
    const outcome = await renameNode(node.id, trimmed);
    if (!outcome.ok) setTitleDraft(node.title);
  };

  const scheduleNoteSave = (value: string) => {
    setNoteDraft(value);
    noteRef.current = value;
    noteDirty.current = true;
    if (noteTimer.current) window.clearTimeout(noteTimer.current);
    noteTimer.current = window.setTimeout(async () => {
      noteTimer.current = null;
      const outcome = await updateNode(node.id, { note: noteRef.current });
      if (outcome.ok) noteDirty.current = false;
    }, 600);
  };

  const flushNote = async () => {
    if (!noteDirty.current) return;
    if (noteTimer.current) {
      window.clearTimeout(noteTimer.current);
      noteTimer.current = null;
    }
    const outcome = await updateNode(node.id, { note: noteRef.current });
    if (outcome.ok) noteDirty.current = false;
  };

  const changePriority = async (priority: Priority) => {
    await updateNode(node.id, { priority });
  };

  const changeDue = async (value: string) => {
    await updateNode(node.id, { dueDate: value || null });
  };

  const toggleComplete = async () => {
    if (!container) {
      await setLeafCompleted(node.id, !completed);
      return;
    }
    const summary = subtreeSummary(data.map, node.id);
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

  const remove = async () => {
    const ids = collectSubtreeIds(data.map, node.id);
    const children = ids.length - 1;
    if (children > 0) {
      const summary = subtreeSummary(data.map, node.id);
      const ok = await confirmDialog({
        title: "删除事项",
        message: `将删除「${node.title}」及 ${children} 个子事项，其中 ${summary.incomplete} 项未完成。`,
        confirmLabel: "删除",
        danger: true,
        extra: "删除后可在本次会话内撤销。",
      });
      if (!ok) return;
    }
    await deleteNode(node.id);
  };

  return (
    <>
      <div className="detail-backdrop" onClick={() => selectNode(null)} />
      <aside className="detail-panel" aria-label="事项详情">
        <div className="detail-section" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="detail-label" style={{ flex: 1 }}>
            事项详情
          </span>
          <button className="icon-btn" aria-label="关闭详情" onClick={() => selectNode(null)}>
            <Icon name="close" />
          </button>
        </div>

        <div className="detail-section">
          <div className="breadcrumb" style={{ marginBottom: 8 }}>
            <button onClick={() => selectNode(null)}>全部</button>
            {ancestors.map((ancestorId) => {
              const ancestor = data.map.get(ancestorId);
              if (!ancestor) return null;
              return (
                <span key={ancestorId} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <span>/</span>
                  <button onClick={() => selectNode(ancestorId)}>{ancestor.title}</button>
                </span>
              );
            })}
          </div>
          <input
            className="input"
            style={{ height: 36, fontSize: 15, fontWeight: 600, borderColor: "transparent", paddingLeft: 0, background: "transparent" }}
            value={titleDraft}
            aria-label="标题"
            onChange={(event) => setTitleDraft(event.target.value.replace(/\r?\n/g, " "))}
            onFocus={() => {
              titleFocused.current = true;
            }}
            onBlur={() => {
              titleFocused.current = false;
              void commitTitle();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              } else if (event.key === "Escape") {
                setTitleDraft(node.title);
                event.currentTarget.blur();
              }
            }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
            <button
              className={`btn btn-sm${completed ? " btn-primary" : ""}`}
              onClick={() => void toggleComplete()}
            >
              <Icon name="check" size={13} />
              {container
                ? completed
                  ? "取消完成子树"
                  : "完成子树"
                : completed
                  ? "已完成"
                  : "标记完成"}
            </button>
            {due && (
              <span className={`due-badge ${due.tone}`}>
                {due.tone === "overdue" ? "已逾期" : due.tone === "today" ? "今天到期" : `截止 ${due.label}`}
              </span>
            )}
          </div>
          {hiddenByFilter && (
            <div style={{ marginTop: 8, fontSize: 11.5, color: "var(--warning)" }}>
              该事项不在当前筛选结果中。
            </div>
          )}
        </div>

        <div className="detail-section">
          <div className="field">
            <span className="field-label">优先级</span>
            <select
              className="input"
              aria-label="优先级"
              value={node.priority}
              onChange={(event) => void changePriority(Number(event.target.value) as Priority)}
            >
              {[0, 1, 2, 3].map((priority) => (
                <option key={priority} value={priority}>
                  {PRIORITY_LABELS[priority as Priority]}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <span className="field-label">截止日</span>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                className="input"
                type="date"
                aria-label="截止日"
                value={node.dueDate ?? ""}
                onChange={(event) => void changeDue(event.target.value)}
              />
              {node.dueDate && (
                <button className="btn btn-sm" onClick={() => void changeDue("")} title="清除截止日">
                  清除
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="detail-section">
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
            <span className="detail-label">备注</span>
            <span className="note-count">{noteDraft.length} / 5000</span>
          </div>
          <textarea
            className="input"
            placeholder="补充说明…"
            aria-label="备注"
            value={noteDraft}
            onChange={(event) => scheduleNoteSave(event.target.value)}
            onFocus={() => {
              noteFocused.current = true;
            }}
            onBlur={() => {
              noteFocused.current = false;
              void flushNote();
            }}
            style={{ minHeight: 110 }}
          />
        </div>

        <div className="detail-section">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 6,
            }}
          >
            <span className="detail-label">附件</span>
            <label className="btn btn-sm" style={{ cursor: "pointer" }}>
              <Icon name="plus" size={13} />
              添加文件
              <input
                type="file"
                multiple
                style={{ display: "none" }}
                onChange={(event) => {
                  const list = Array.from(event.target.files ?? []);
                  if (list.length) void attachFiles(node.id, list);
                  event.target.value = "";
                }}
              />
            </label>
          </div>
          {nodeFiles.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--muted)" }}>暂无关联文件。</div>
          ) : (
            <ul
              style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              {nodeFiles.map((file) => (
                <li
                  key={file.id}
                  style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}
                >
                  <button
                    className="file-name"
                    style={{
                      background: "none",
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                      color: "var(--accent)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      maxWidth: 190,
                      textAlign: "left",
                    }}
                    title={file.name}
                    onClick={() => void openFile(file.id)}
                  >
                    {file.name}
                  </button>
                  <span style={{ color: "var(--muted)", flexShrink: 0 }}>{formatSize(file.size)}</span>
                  <span style={{ flex: 1 }} />
                  <button
                    className="icon-btn"
                    aria-label="移除附件"
                    title="移除附件"
                    onClick={() => void removeFile(file.id)}
                  >
                    <Icon name="trash" size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="detail-section">
          <div className="detail-label" style={{ marginBottom: 6 }}>
            状态
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--muted)" }}>子事项</span>
              <span>{container ? `${stats.done} / ${stats.total} 叶子完成` : "无"}</span>
            </div>
            {container && (
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--muted)" }}>直接子项</span>
                <span>{childrenOf.length} 项（{percent}%）</span>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--muted)" }}>创建时间</span>
              <span>{formatTimestamp(node.createdAt)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--muted)" }}>更新时间</span>
              <span>{formatTimestamp(node.updatedAt)}</span>
            </div>
          </div>
        </div>

        <div className="detail-section" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            className="btn btn-sm"
            onClick={() => {
              setView("outline");
              requestInlineAdd(node.id, null);
            }}
          >
            <Icon name="plus" size={13} />
            添加子事项
          </button>
          <button className="btn btn-sm" onClick={() => selectNode(null)}>
            取消选择
          </button>
          <span style={{ flex: 1 }} />
          <button className="btn btn-sm btn-danger" onClick={() => void remove()}>
            <Icon name="trash" size={13} />
            删除
          </button>
        </div>
      </aside>
    </>
  );
}
