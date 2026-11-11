import { useTreeStore } from "../store/treeStore";
import { SearchBox } from "../features/search/SearchBox";
import { FilterMenu } from "../features/filter/FilterMenu";
import { Icon } from "../components/ui";

export function Toolbar() {
  const view = useTreeStore((state) => state.view);
  const setView = useTreeStore((state) => state.setView);
  const openQuickAdd = useTreeStore((state) => state.openQuickAdd);
  const theme = useTreeStore((state) => state.theme);
  const setTheme = useTreeStore((state) => state.setTheme);
  const undo = useTreeStore((state) => state.undo);
  const redo = useTreeStore((state) => state.redo);
  const undoCount = useTreeStore((state) => state.undoStack.length);
  const redoCount = useTreeStore((state) => state.redoStack.length);
  const setSettingsOpen = useTreeStore((state) => state.setSettingsOpen);

  const effectiveDark =
    theme === "dark" ||
    (theme === "system" &&
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);

  return (
    <header className="toolbar">
      <div className="brand">
        <span className="brand-mark">
          <Icon name="tree" size={20} />
        </span>
        <span>Simple Tree</span>
      </div>

      <button className="btn btn-primary" onClick={openQuickAdd} title="快速添加（⌘⇧N）">
        <Icon name="plus" size={14} />
        快速添加
        <span className="kbd" style={{ borderColor: "rgba(255,255,255,0.35)", color: "inherit", background: "transparent" }}>
          ⌘⇧N
        </span>
      </button>

      <SearchBox />
      <FilterMenu />

      <div className="segmented" role="group" aria-label="视图切换">
        <button
          className={view === "outline" ? "on" : ""}
          onClick={() => setView("outline")}
          aria-pressed={view === "outline"}
        >
          <Icon name="outline" size={14} />
          大纲
        </button>
        <button
          className={view === "graph" ? "on" : ""}
          onClick={() => setView("graph")}
          aria-pressed={view === "graph"}
        >
          <Icon name="graph" size={14} />
          图谱
        </button>
      </div>

      <span style={{ flex: 1 }} />

      <button
        className="icon-btn"
        title="撤销（⌘Z）"
        aria-label="撤销"
        disabled={undoCount === 0}
        onClick={() => void undo()}
        style={{ opacity: undoCount === 0 ? 0.4 : 1 }}
      >
        <Icon name="undo" />
      </button>
      <button
        className="icon-btn"
        title="重做（⇧⌘Z）"
        aria-label="重做"
        disabled={redoCount === 0}
        onClick={() => void redo()}
        style={{ opacity: redoCount === 0 ? 0.4 : 1, transform: "scaleX(-1)" }}
      >
        <Icon name="undo" />
      </button>

      <button
        className="icon-btn"
        title={effectiveDark ? "切换到浅色" : "切换到深色"}
        aria-label="切换主题"
        onClick={() => setTheme(effectiveDark ? "light" : "dark")}
      >
        <Icon name={effectiveDark ? "sun" : "moon"} />
      </button>

      <button
        className="icon-btn"
        title="设置与数据"
        aria-label="设置与数据"
        onClick={() => setSettingsOpen(true)}
      >
        <Icon name="settings" />
      </button>
    </header>
  );
}
