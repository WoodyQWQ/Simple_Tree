import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { AiSettings, BackupMeta, ThemeMode, TreeNode } from "../../domain/types";
import { associationCandidates, requestAssociationSuggestions } from "../../domain/association";
import { formatTimestamp, formatUsage } from "../../domain/format";
import { downloadExport, parseImportFile, storageEstimate } from "../../db/importExport";
import { listBackups, getBackup } from "../../db/backupRepository";
import { useTreeStore } from "../../store/treeStore";
import { confirmDialog } from "../../store/dialogStore";
import { Modal, Icon } from "../../components/ui";

const CONSENT_KEY = "st:ai-consent";

type ImportPreview =
  | { kind: "ok"; nodes: TreeNode[]; exportedAt: string | null; fileName: string }
  | { kind: "error"; errors: { index: number; field: string; message: string }[]; fileName: string };

export function SettingsDialog() {
  const open = useTreeStore((state) => state.settingsOpen);
  const setOpen = useTreeStore((state) => state.setSettingsOpen);
  const theme = useTreeStore((state) => state.theme);
  const setTheme = useTreeStore((state) => state.setTheme);
  const accent = useTreeStore((state) => state.accent);
  const setAccent = useTreeStore((state) => state.setAccent);
  const storageMode = useTreeStore((state) => state.storageMode);
  const nodes = useTreeStore((state) => state.nodes);
  const aiSettings = useTreeStore((state) => state.aiSettings);
  const saveAi = useTreeStore((state) => state.saveAi);
  const importNodes = useTreeStore((state) => state.importNodes);
  const restoreBackup = useTreeStore((state) => state.restoreBackup);
  const pushToast = useTreeStore((state) => state.pushToast);
  const undo = useTreeStore((state) => state.undo);

  const [draft, setDraft] = useState<AiSettings>(aiSettings);
  const [showKey, setShowKey] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);
  const [backups, setBackups] = useState<BackupMeta[]>([]);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(aiSettings);
    setTestResult(null);
    setPreview(null);
    void storageEstimate().then(setUsage);
    void listBackups().then(setBackups);
    setConsentChecked(localStorage.getItem(CONSENT_KEY) === "1");
  }, [open, aiSettings]);

  if (!open) return null;

  const nodeList = Object.values(nodes ?? {});
  const enableNeedsConsent = draft.enabled && !aiSettings.enabled && localStorage.getItem(CONSENT_KEY) !== "1";
  const aiComplete = Boolean(draft.baseUrl.trim() && draft.model.trim() && draft.apiKey.trim());

  const handleFile = async (file: File) => {
    const result = await parseImportFile(file);
    if (result.ok) {
      setPreview({
        kind: "ok",
        nodes: result.nodes,
        exportedAt: result.exportedAt,
        fileName: file.name,
      });
    } else {
      setPreview({ kind: "error", errors: result.errors, fileName: file.name });
    }
  };

  const doImport = async () => {
    if (!preview || preview.kind !== "ok") return;
    const confirmed = await confirmDialog({
      title: "覆盖导入",
      message: `将用「${preview.fileName}」替换当前全部 ${nodeList.length} 个事项。`,
      confirmLabel: `替换 ${nodeList.length} 个事项`,
      danger: true,
      extra: "导入前会自动创建当前数据的完整备份，保留最近 3 份。",
    });
    if (!confirmed) return;
    setBusy(true);
    const outcome = await importNodes(preview.nodes);
    setBusy(false);
    if (outcome.ok) {
      pushToast({
        message: `已导入 ${preview.nodes.length} 项`,
        type: "success",
        duration: 8000,
        actionLabel: "撤销",
        onAction: () => {
          void undo(outcome.entryId);
        },
      });
      setPreview(null);
      void listBackups().then(setBackups);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const restore = async (meta: BackupMeta) => {
    const confirmed = await confirmDialog({
      title: "恢复备份",
      message: `将恢复 ${formatTimestamp(meta.createdAt)} 的备份（${meta.count} 项），替换当前全部 ${nodeList.length} 个事项。`,
      confirmLabel: "恢复",
      extra: "恢复前会再次备份当前数据，恢复后选择与撤销栈会被清空。",
    });
    if (!confirmed) return;
    const record = await getBackup(meta.id);
    if (!record) {
      pushToast({ message: "备份不存在", type: "error", duration: 4000 });
      return;
    }
    setBusy(true);
    await restoreBackup(record);
    setBusy(false);
    void listBackups().then(setBackups);
  };

  const saveSettings = async () => {
    if (!draft.enabled) {
      await saveAi({ ...draft, apiKey: "" });
      pushToast({ message: "已关闭 AI 推荐并清除密钥", type: "info", duration: 3000 });
      return;
    }
    if (!aiComplete) {
      pushToast({ message: "请填写端点、模型与密钥", type: "error", duration: 4000 });
      return;
    }
    if (enableNeedsConsent && !consentChecked) {
      pushToast({ message: "请先确认隐私说明", type: "error", duration: 4000 });
      return;
    }
    if (consentChecked) localStorage.setItem(CONSENT_KEY, "1");
    await saveAi(draft);
    pushToast({ message: "AI 配置已保存", type: "success", duration: 3000 });
  };

  const testConnection = async () => {
    if (!aiComplete) {
      setTestResult("请先填写端点、模型与密钥");
      return;
    }
    if (nodeList.length === 0) {
      setTestResult("请先创建至少一个事项，以便用候选项测试");
      return;
    }
    setTesting(true);
    setTestResult(null);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 8000);
    try {
      const candidates = associationCandidates(new Map(nodeList.map((node) => [node.id, node])), "测试");
      await requestAssociationSuggestions(
        { ...draft, enabled: true },
        "测试连接",
        candidates,
        new Map(nodeList.map((node) => [node.id, node])),
        controller.signal,
      );
      setTestResult("连接成功");
    } catch {
      setTestResult("连接失败，请检查端点、模型、密钥或跨域设置");
    } finally {
      window.clearTimeout(timer);
      setTesting(false);
    }
  };

  const themeOptions: Array<{ value: ThemeMode; label: string }> = [
    { value: "light", label: "浅色" },
    { value: "dark", label: "深色" },
    { value: "system", label: "跟随系统" },
  ];

  const accentPresets = [
    "#3b82c4",
    "#5b6ea6",
    "#7c5cbf",
    "#c0506b",
    "#d9822b",
    "#2f9e86",
    "#9a7b45",
  ];

  return (
    <Modal
      title="设置与数据"
      wide
      onClose={() => setOpen(false)}
      footer={
        <>
          <span style={{ flex: 1, fontSize: 11.5, color: "var(--muted)" }}>
            Simple Tree v1.0.0 · 数据保存在本机
          </span>
          <button className="btn" onClick={() => setOpen(false)}>
            关闭
          </button>
        </>
      }
    >
      <div className="settings-section">
        <div className="detail-label" style={{ marginBottom: 8 }}>
          主题
        </div>
        <div className="segmented">
          {themeOptions.map((option) => (
            <button
              key={option.value}
              className={theme === option.value ? "on" : ""}
              onClick={() => setTheme(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="detail-label" style={{ margin: "14px 0 8px" }}>
          主题色
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <button
            className={`accent-swatch accent-default${accent === null ? " active" : ""}`}
            title="默认（随深浅模式自动调整）"
            aria-label="默认主题色"
            aria-pressed={accent === null}
            onClick={() => setAccent(null)}
          >
            <span />
          </button>
          {accentPresets.map((color) => (
            <button
              key={color}
              className={`accent-swatch${accent === color ? " active" : ""}`}
              style={{ "--swatch": color } as CSSProperties}
              title={color}
              aria-label={`主题色 ${color}`}
              aria-pressed={accent === color}
              onClick={() => setAccent(color)}
            >
              <span />
            </button>
          ))}
          <label className="accent-custom" title="自定义颜色">
            <input
              type="color"
              value={accent ?? "#57764a"}
              onChange={(event) => setAccent(event.target.value)}
              aria-label="自定义主题色"
            />
            自定义
          </label>
        </div>
      </div>

      <div className="settings-section">
        <div className="detail-label" style={{ marginBottom: 8 }}>
          存储与数据
        </div>
        <div style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 5 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--muted)" }}>存储模式</span>
            <span>{storageMode === "persistent" ? "正常（IndexedDB）" : "临时模式（不保存）"}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--muted)" }}>节点数量</span>
            <span>{nodeList.length} 项</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--muted)" }}>存储用量</span>
            <span>
              {usage ? `${formatUsage(usage.usage)} / ${formatUsage(usage.quota)}` : "未知"}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button className="btn btn-sm" onClick={() => downloadExport(nodeList)}>
            <Icon name="download" size={13} />
            导出 JSON
          </button>
          <button
            className="btn btn-sm"
            disabled={storageMode === "memory"}
            onClick={() => fileInput.current?.click()}
            title={storageMode === "memory" ? "临时模式下无法导入" : "导入 JSON"}
          >
            <Icon name="upload" size={13} />
            导入 JSON
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            style={{ display: "none" }}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
        </div>
        {storageMode === "memory" && (
          <div style={{ fontSize: 11.5, color: "var(--danger)", marginTop: 8 }}>
            本地存储不可用：当前更改不会被保存，导入已禁用，但仍可导出。
          </div>
        )}

        {preview && (
          <div style={{ marginTop: 12, padding: 10, border: "1px solid var(--border)", borderRadius: 8 }}>
            {preview.kind === "ok" ? (
              <>
                <div style={{ fontSize: 12, fontWeight: 600 }}>导入摘要</div>
                <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>
                  文件：{preview.fileName} · 节点 {preview.nodes.length} 项 · 顶层{" "}
                  {preview.nodes.filter((node) => node.parentId === null).length} 项
                  {preview.exportedAt ? ` · 导出于 ${formatTimestamp(preview.exportedAt)}` : ""}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => void doImport()}>
                    替换当前 {nodeList.length} 个事项
                  </button>
                  <button className="btn btn-sm btn-ghost" onClick={() => setPreview(null)}>
                    取消
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--danger)" }}>
                  导入失败：{preview.fileName}
                </div>
                <ul style={{ margin: "6px 0 0", paddingLeft: 16, fontSize: 11.5, color: "var(--muted)" }}>
                  {preview.errors.slice(0, 5).map((error, index) => (
                    <li key={index}>
                      {error.index >= 0 ? `第 ${error.index + 1} 项 · ` : ""}
                      {error.field}：{error.message}
                    </li>
                  ))}
                </ul>
                <button
                  className="btn btn-sm"
                  style={{ marginTop: 8 }}
                  onClick={() => {
                    setPreview(null);
                    if (fileInput.current) fileInput.current.value = "";
                  }}
                >
                  关闭
                </button>
              </>
            )}
          </div>
        )}

        {backups.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div className="detail-label" style={{ marginBottom: 6 }}>
              最近备份
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {backups.map((backup) => (
                <div
                  key={backup.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 11.5,
                    padding: "6px 8px",
                    border: "1px solid var(--border)",
                    borderRadius: 7,
                  }}
                >
                  <span style={{ flex: 1 }}>
                    {formatTimestamp(backup.createdAt)} · {backup.count} 项 · {backup.reason}
                  </span>
                  <button className="btn btn-sm" disabled={busy} onClick={() => void restore(backup)}>
                    恢复
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="settings-section">
        <div className="detail-label" style={{ marginBottom: 8 }}>
          AI 关联配置
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, marginBottom: 10 }}>
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
          />
          启用 AI 自动关联建议（可选）
        </label>
        {draft.enabled && (
          <>
            {enableNeedsConsent && (
              <div
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: 10,
                  marginBottom: 10,
                  background: "var(--panel-2)",
                  fontSize: 11.5,
                  color: "var(--muted)",
                }}
              >
                启用后，输入新事项标题时会把「事项标题 + 本地筛选出的候选节点标题与父路径」发送到你配置的第三方模型服务。不会发送备注、完成状态、时间戳或身份信息。密钥只保存在本机，不进入导出与备份。节点标题仅作为数据，不会被当作指令执行。
                <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, color: "var(--text)" }}>
                  <input
                    type="checkbox"
                    checked={consentChecked}
                    onChange={(event) => setConsentChecked(event.target.checked)}
                  />
                  我已了解并同意上述数据发送
                </label>
              </div>
            )}
            <div className="field">
              <span className="field-label">兼容端点</span>
              <input
                className="input"
                placeholder="https://api.openai.com/v1"
                aria-label="兼容端点"
                value={draft.baseUrl}
                onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
              />
            </div>
            <div className="field">
              <span className="field-label">模型</span>
              <input
                className="input"
                placeholder="gpt-4o-mini"
                aria-label="模型"
                value={draft.model}
                onChange={(event) => setDraft({ ...draft, model: event.target.value })}
              />
            </div>
            <div className="field">
              <span className="field-label">API Key（只保存在本机）</span>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  className="input"
                  type={showKey ? "text" : "password"}
                  placeholder="sk-..."
                  aria-label="API Key"
                  value={draft.apiKey}
                  onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
                />
                <button className="btn btn-sm" onClick={() => setShowKey((value) => !value)}>
                  {showKey ? "隐藏" : "显示"}
                </button>
                <button
                  className="btn btn-sm"
                  onClick={() => setDraft({ ...draft, apiKey: "" })}
                  title="清除密钥"
                >
                  清除
                </button>
              </div>
            </div>
            <div className="field">
              <span className="field-label">可选代理地址（CORS 受限时）</span>
              <input
                className="input"
                placeholder="https://your-proxy.example.com/v1"
                aria-label="代理地址"
                value={draft.proxyUrl ?? ""}
                onChange={(event) => setDraft({ ...draft, proxyUrl: event.target.value })}
              />
            </div>
          </>
        )}
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
          <button className="btn btn-sm btn-primary" onClick={() => void saveSettings()}>
            保存 AI 配置
          </button>
          {draft.enabled && (
            <button className="btn btn-sm" disabled={testing} onClick={() => void testConnection()}>
              {testing ? "测试中…" : "测试连接"}
            </button>
          )}
          {!draft.enabled && aiSettings.enabled && (
            <span style={{ fontSize: 11.5, color: "var(--muted)" }}>保存后将清除已存密钥</span>
          )}
        </div>
        {testResult && (
          <div style={{ marginTop: 6, fontSize: 11.5, color: "var(--muted)" }}>{testResult}</div>
        )}
        <div style={{ marginTop: 8, fontSize: 11, color: "var(--faint)" }}>
          提示：浏览器直连第三方端点可能受 CORS 限制；建议只发送最少必要数据。
        </div>
      </div>

      <div className="settings-section" style={{ borderBottom: 0 }}>
        <div className="detail-label" style={{ marginBottom: 8 }}>
          快捷键
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
          {[
            ["快速添加事项", "⌘⇧N"],
            ["搜索", "⌘K"],
            ["撤销", "⌘Z"],
            ["重做", "⇧⌘Z"],
            ["新建同级（行菜单）", "⋯"],
            ["删除（行菜单）", "⋯"],
          ].map(([label, key]) => (
            <div key={label} style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--muted)" }}>{label}</span>
              <span className="kbd">{key}</span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 10, fontSize: 11, color: "var(--faint)" }}>
          数据只保存在本机浏览器。建议定期导出 JSON 备份。
        </div>
      </div>
    </Modal>
  );
}
