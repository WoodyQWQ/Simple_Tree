import { useEffect, useLayoutEffect } from "react";
import { Toolbar } from "../components/Toolbar";
import { ToastHost, ConfirmDialogHost } from "../components/ui";
import { useTreeStore, applyAccent } from "../store/treeStore";
import { TreeView } from "../features/tree/TreeView";
import { GraphView } from "../features/graph/GraphView";
import { DetailPanel } from "../features/detail/DetailPanel";
import { QuickAddPanel } from "../features/quickAdd/QuickAddPanel";
import { SettingsDialog } from "../features/settings/SettingsDialog";
import { Icon } from "../components/ui";

export function App() {
  const init = useTreeStore((state) => state.init);
  const ready = useTreeStore((state) => state.ready);
  const view = useTreeStore((state) => state.view);
  const theme = useTreeStore((state) => state.theme);
  const accent = useTreeStore((state) => state.accent);
  const storageMode = useTreeStore((state) => state.storageMode);
  const loadError = useTreeStore((state) => state.loadError);
  const nodeCount = useTreeStore((state) => (state.nodes ? Object.keys(state.nodes).length : 0));
  const openQuickAdd = useTreeStore((state) => state.openQuickAdd);
  const quickAddOpen = useTreeStore((state) => state.quickAdd.open);
  const undo = useTreeStore((state) => state.undo);
  const redo = useTreeStore((state) => state.redo);

  useEffect(() => {
    void init();
    const timer = window.setInterval(() => {
      useTreeStore.getState().refreshToday();
    }, 60000);
    return () => window.clearInterval(timer);
  }, [init]);

  useLayoutEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && media.matches);
      document.documentElement.classList.toggle("dark", dark);
      document.documentElement.style.colorScheme = dark ? "dark" : "light";
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  useLayoutEffect(() => {
    applyAccent(accent);
  }, [accent]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const inEditable =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable;

      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        openQuickAdd();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        if (inEditable) return;
        event.preventDefault();
        if (event.shiftKey) void redo();
        else void undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openQuickAdd, undo, redo]);

  return (
    <div className="app-shell">
      <Toolbar />
      {storageMode === "memory" && ready && (
        <div className="banner" role="status">
          <Icon name="lock" size={14} />
          本地存储不可用，当前更改不会被保存。请及时导出数据。
        </div>
      )}
      {loadError && (
        <div className="banner" role="status">
          {loadError}
        </div>
      )}
      {ready && nodeCount > 5000 && (
        <div
          className="banner"
          role="status"
          style={{ background: "var(--accent-soft)", color: "var(--accent-text)" }}
        >
          当前 {nodeCount} 个节点，超过设计目标 5,000，操作性能可能下降。
        </div>
      )}

      <div className="main-area" style={{ position: "relative" }}>
        {view === "outline" ? <TreeView /> : <GraphView />}
        <DetailPanel />
        {quickAddOpen && <QuickAddPanel />}
      </div>

      <SettingsDialog />
      <ConfirmDialogHost />
      <ToastHost />
    </div>
  );
}
