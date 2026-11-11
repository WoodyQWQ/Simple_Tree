import { useEffect, useMemo, useRef, useState } from "react";
import { useTreeStore } from "../../store/treeStore";
import { useTreeData } from "../../store/selectors";
import { highlightParts, searchNodes } from "../../domain/search";
import { isCompleted } from "../../domain/stats";
import { dueInfo } from "../../domain/format";
import { Icon } from "../../components/ui";

export function SearchBox() {
  const data = useTreeData();
  const query = useTreeStore((state) => state.searchQuery);
  const setQuery = useTreeStore((state) => state.setSearchQuery);
  const requestFocus = useTreeStore((state) => state.requestFocus);
  const today = useTreeStore((state) => state.today);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [composing, setComposing] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(
    () => searchNodes(data.map, query, 50),
    [data.map, query],
  );

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setOpen(true);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const commit = (index: number) => {
    const result = results[index];
    if (!result) return;
    requestFocus(result.node.id);
    setOpen(false);
    inputRef.current?.blur();
  };

  const handleKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (composing) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (results.length) setActive((current) => (current + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (results.length) setActive((current) => (current - 1 + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (results.length) commit(active);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  const showResults = open && query.trim().length > 0;

  return (
    <div className="search-wrap" ref={wrapRef}>
      <span className="search-icon">
        <Icon name="search" size={15} />
      </span>
      <input
        ref={inputRef}
        className="input search-input"
        value={query}
        placeholder="搜索事项  ⌘K"
        aria-label="搜索事项"
        role="combobox"
        aria-expanded={showResults}
        aria-controls="search-results"
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKey}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={() => setComposing(false)}
      />
      {showResults && (
        <div className="search-results" id="search-results" role="listbox">
          {results.length === 0 ? (
            <div className="empty-state" style={{ padding: "22px 12px" }}>
              <div>没有匹配「{query.trim()}」的事项</div>
              <button className="btn btn-sm" onClick={() => setQuery("")}>
                清除关键词
              </button>
            </div>
          ) : (
            results.map((result, index) => {
              const completed = isCompleted(
                result.node,
                data.childrenOf,
                data.stats,
              );
              const due = dueInfo(result.node, completed, today);
              return (
                <button
                  key={result.node.id}
                  id={`search-${result.node.id}`}
                  className={`search-result${index === active ? " active" : ""}`}
                  role="option"
                  aria-selected={index === active}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => commit(index)}
                >
                  <span className="title">
                    {highlightParts(result.node.title, query).map((part, partIndex) =>
                      part.match ? (
                        <span className="match" key={partIndex}>
                          {part.text}
                        </span>
                      ) : (
                        <span key={partIndex}>{part.text}</span>
                      ),
                    )}
                  </span>
                  <span className="path">
                    {result.path} · {completed ? "已完成" : "未完成"}
                    {due ? ` · ${due.label}` : ""}
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
