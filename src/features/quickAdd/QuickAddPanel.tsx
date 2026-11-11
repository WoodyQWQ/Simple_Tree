import { useEffect, useMemo, useRef, useState } from "react";
import type { NodeId } from "../../domain/types";
import { pathLabel } from "../../domain/tree";
import { searchNodes } from "../../domain/search";
import { validateTitle } from "../../domain/validation";
import { useTreeStore } from "../../store/treeStore";
import { useTreeData } from "../../store/selectors";
import { useAssociationSuggestions } from "../ai/useAssociationSuggestions";
import { Icon } from "../../components/ui";

type Mode = "child" | "sibling" | "top";

export function QuickAddPanel() {
  const quickAdd = useTreeStore((state) => state.quickAdd);
  const closeQuickAdd = useTreeStore((state) => state.closeQuickAdd);
  const createNode = useTreeStore((state) => state.createNode);
  const aiSettings = useTreeStore((state) => state.aiSettings);
  const data = useTreeData();

  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<Mode>("top");
  const [targetId, setTargetId] = useState<NodeId | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerMode, setPickerMode] = useState<"child" | "sibling">("child");
  const [submitting, setSubmitting] = useState(false);
  const composing = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastNonce = useRef(-1);

  useEffect(() => {
    if (!quickAdd.open) {
      lastNonce.current = -1;
      return;
    }
    if (lastNonce.current === quickAdd.nonce) return;
    lastNonce.current = quickAdd.nonce;
    setTitle("");
    setPickerOpen(false);
    setPickerQuery("");
    setSubmitting(false);
    const parent = quickAdd.defaultParentId;
    if (parent && data.map.has(parent)) {
      setMode("child");
      setTargetId(parent);
    } else {
      setMode("top");
      setTargetId(null);
    }
    window.setTimeout(() => inputRef.current?.focus(), 20);
    // 默认关联只在打开面板时锁定，不跟随选中项变化。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickAdd.open, quickAdd.nonce]);

  const suggestions = useAssociationSuggestions(quickAdd.open ? title : "");
  const aiConfigured = Boolean(aiSettings.enabled && aiSettings.apiKey.trim());

  const pickerResults = useMemo(
    () =>
      pickerQuery.trim()
        ? searchNodes(data.map, pickerQuery, 50)
        : [...data.map.values()]
            .sort((a, b) => a.title.localeCompare(b.title))
            .slice(0, 50)
            .map((node) => ({
              node,
              path: pathLabel(node.id, data.map),
              score: 0,
            })),
    [data.map, pickerQuery],
  );

  if (!quickAdd.open) return null;

  const targetExists = targetId !== null && data.map.has(targetId);
  const targetPath = targetExists ? pathLabel(targetId!, data.map) : null;
  const effectiveMode: Mode = mode;

  const applySuggestion = (nodeId: NodeId) => {
    if (!data.map.has(nodeId)) return;
    setTargetId(nodeId);
    setMode("child");
    setPickerOpen(false);
  };

  const chooseNode = (nodeId: NodeId) => {
    setTargetId(nodeId);
    setMode(pickerMode);
    setPickerOpen(false);
  };

  const submit = async () => {
    if (submitting) return;
    const checked = validateTitle(title);
    if (!checked.ok) {
      useTreeStore.getState().pushToast({ message: checked.error, type: "error", duration: 4000 });
      inputRef.current?.focus();
      return;
    }
    let parentId: NodeId | null = null;
    let afterId: NodeId | null = null;
    if (effectiveMode === "child") {
      if (!targetId || !data.map.has(targetId)) {
        useTreeStore
          .getState()
          .pushToast({ message: "目标节点已不存在，请重新选择", type: "error", duration: 5000 });
        setPickerOpen(true);
        return;
      }
      parentId = targetId;
    } else if (effectiveMode === "sibling") {
      const target = targetId ? data.map.get(targetId) : null;
      if (!target) {
        useTreeStore
          .getState()
          .pushToast({ message: "目标节点已不存在，请重新选择", type: "error", duration: 5000 });
        setPickerOpen(true);
        return;
      }
      parentId = target.parentId;
      afterId = target.id;
    }
    setSubmitting(true);
    const outcome = await createNode({ parentId, afterId, title: checked.value });
    setSubmitting(false);
    if (outcome.ok) {
      setTitle("");
      closeQuickAdd();
    } else {
      setPickerOpen(true);
    }
  };

  const panelLabel = (() => {
    if (effectiveMode === "top") return "作为顶层事项";
    if (effectiveMode === "sibling") {
      return targetPath ? `作为「${targetPath}」的同级（之后）` : "作为同级事项";
    }
    return targetPath ? `作为「${targetPath}」的子事项` : "作为子事项";
  })();

  return (
    <div className="quick-add" role="dialog" aria-label="快速添加事项">
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span className="detail-label">快速添加</span>
        <span style={{ flex: 1 }} />
        <button className="icon-btn" aria-label="关闭快速添加" onClick={closeQuickAdd}>
          <Icon name="close" />
        </button>
      </div>

      <input
        ref={inputRef}
        className="input"
        style={{ height: 36, fontSize: 14 }}
        placeholder="给花浇一次水…"
        value={title}
        aria-label="新事项标题"
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (composing.current) return;
          if (event.key === "Enter") {
            event.preventDefault();
            void submit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            if (pickerOpen) setPickerOpen(false);
            else closeQuickAdd();
          }
        }}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
      />

      <div className="qa-section">
        <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
          <span className="detail-label">关联到</span>
          <span style={{ flex: 1 }} />
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => setPickerOpen((value) => !value)}
          >
            {pickerOpen ? "收起" : "更改"}
          </button>
        </div>

        {!pickerOpen ? (
          <div>
            {effectiveMode !== "top" && (
              <button
                className={`qa-radio${effectiveMode === "child" ? " on" : ""}`}
                onClick={() => setMode("child")}
              >
                <span
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 999,
                    border: "1.5px solid var(--border-strong)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 999,
                      background: "var(--accent)",
                    }}
                  />
                </span>
                {panelLabel}
              </button>
            )}
            {effectiveMode === "sibling" && targetPath && (
              <div style={{ fontSize: 11.5, color: "var(--muted)", paddingLeft: 32, marginTop: 2 }}>
                新事项将插入到「{targetPath}」之后
              </div>
            )}
            <button
              className={`qa-radio${effectiveMode === "top" ? " on" : ""}`}
              onClick={() => {
                setMode("top");
                setTargetId(null);
              }}
            >
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 999,
                  border: "1.5px solid var(--border-strong)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {effectiveMode === "top" && (
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 999,
                      background: "var(--accent)",
                    }}
                  />
                )}
              </span>
              作为顶层事项
            </button>
            {mode !== "top" && !targetExists && (
              <div style={{ color: "var(--danger)", fontSize: 11.5, marginTop: 4 }}>
                目标节点已被删除，请重新选择。
              </div>
            )}
          </div>
        ) : (
          <div>
            <div className="segmented" style={{ marginBottom: 8 }}>
              <button
                className={pickerMode === "child" ? "on" : ""}
                onClick={() => setPickerMode("child")}
              >
                作为子事项
              </button>
              <button
                className={pickerMode === "sibling" ? "on" : ""}
                onClick={() => setPickerMode("sibling")}
              >
                作为同级（之后）
              </button>
            </div>
            <input
              className="input"
              placeholder="搜索已有节点…"
              value={pickerQuery}
              onChange={(event) => setPickerQuery(event.target.value)}
              aria-label="搜索关联节点"
            />
            <div className="picker-list" style={{ marginTop: 8 }}>
              {pickerResults.length === 0 ? (
                <div style={{ padding: 12, color: "var(--muted)", fontSize: 12 }}>
                  没有匹配的节点
                </div>
              ) : (
                pickerResults.map((result) => (
                  <button
                    key={result.node.id}
                    className={`picker-row${targetId === result.node.id ? " on" : ""}`}
                    onClick={() => chooseNode(result.node.id)}
                  >
                    <Icon name="tree" size={13} />
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span
                        style={{
                          display: "block",
                          fontSize: 12.5,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {result.node.title}
                      </span>
                      <span
                        style={{
                          display: "block",
                          fontSize: 11,
                          color: "var(--muted)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {result.path}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => {
                  setMode("top");
                  setTargetId(null);
                  setPickerOpen(false);
                }}
              >
                改为顶层事项
              </button>
            </div>
          </div>
        )}
      </div>

      {aiConfigured && (
        <div className="qa-section">
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <Icon name="sparkle" size={14} />
            <span className="detail-label">AI 推荐 · 可选</span>
            <span style={{ flex: 1 }} />
            {!suggestions.loading && (
              <button className="btn btn-sm btn-ghost" onClick={suggestions.retry}>
                重新推荐
              </button>
            )}
          </div>
          {suggestions.loading && (
            <div style={{ fontSize: 12, color: "var(--muted)" }}>正在寻找合适的上级…</div>
          )}
          {!suggestions.loading && suggestions.error && (
            <div style={{ fontSize: 12, color: "var(--muted)" }}>{suggestions.error}</div>
          )}
          {!suggestions.loading && !suggestions.error && suggestions.suggestions.length === 0 && (
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              {title.trim().length < 2 ? "输入至少 2 个字符后自动推荐" : "暂无建议，可手动选择"}
            </div>
          )}
          {suggestions.suggestions.map((suggestion) => {
            const node = data.map.get(suggestion.nodeId);
            if (!node) return null;
            const selected = targetId === suggestion.nodeId && effectiveMode === "child";
            return (
              <button
                key={suggestion.nodeId}
                className={`qa-suggestion${selected ? " on" : ""}`}
                onClick={() => applySuggestion(suggestion.nodeId)}
                aria-pressed={selected}
              >
                <span style={{ color: "var(--accent)", marginTop: 2 }}>
                  <Icon name="tree" size={13} />
                </span>
                <span style={{ minWidth: 0 }}>
                  <span
                    className="qa-path"
                    style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {pathLabel(node.id, data.map)}
                  </span>
                  <span className="qa-reason">{suggestion.reason}</span>
                </span>
                {selected && (
                  <span style={{ marginLeft: "auto", color: "var(--accent-text)", fontSize: 11 }}>
                    已选择
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <button className="btn" onClick={closeQuickAdd}>
          取消
        </button>
        <button className="btn btn-primary" disabled={submitting} onClick={() => void submit()}>
          添加
        </button>
      </div>
    </div>
  );
}
