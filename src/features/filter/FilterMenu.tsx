import { useEffect, useRef, useState } from "react";
import type { DueFilter, Filters, Priority, StatusFilter } from "../../domain/types";
import { FILTERS_NONE } from "../../domain/types";
import { isFilterActive } from "../../domain/filter";
import { useTreeStore } from "../../store/treeStore";
import { Icon } from "../../components/ui";

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "active", label: "未完成" },
  { value: "completed", label: "已完成" },
];

const PRIORITY_OPTIONS: Array<{ value: Priority; label: string }> = [
  { value: 0, label: "无" },
  { value: 1, label: "低" },
  { value: 2, label: "中" },
  { value: 3, label: "高" },
];

const DUE_OPTIONS: Array<{ value: DueFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "overdue", label: "已逾期" },
  { value: "today", label: "今天" },
  { value: "week", label: "7 天内" },
  { value: "none", label: "无截止日" },
];

export function FilterMenu() {
  const filters = useTreeStore((state) => state.filters);
  const setFilters = useTreeStore((state) => state.setFilters);
  const view = useTreeStore((state) => state.view);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const active = isFilterActive(filters);
  const disabled = view === "graph";

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  const update = (patch: Partial<Filters>) => {
    setFilters({ ...filters, ...patch });
  };

  const togglePriority = (priority: Priority) => {
    const next = filters.priorities.includes(priority)
      ? filters.priorities.filter((value) => value !== priority)
      : [...filters.priorities, priority];
    update({ priorities: next.sort() });
  };

  return (
    <div style={{ position: "relative" }} ref={wrapRef}>
      <button
        className={`icon-btn${active ? " active" : ""}`}
        title={disabled ? "图谱始终展示整棵树" : "筛选"}
        aria-label="筛选"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="filter" />
        {active && (
          <span
            style={{
              position: "absolute",
              top: 5,
              right: 5,
              width: 5,
              height: 5,
              borderRadius: 999,
              background: "var(--accent)",
            }}
          />
        )}
      </button>
      {open && !disabled && (
        <div className="popover" style={{ right: 0, top: 36, width: 260, padding: 12 }}>
          <div className="field">
            <span className="field-label">完成状态</span>
            <div className="segmented" style={{ width: "100%" }}>
              {STATUS_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  className={filters.status === option.value ? "on" : ""}
                  style={{ flex: 1 }}
                  onClick={() => update({ status: option.value })}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span className="field-label">优先级</span>
            <div style={{ display: "flex", gap: 4 }}>
              {PRIORITY_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  className={`btn btn-sm${filters.priorities.includes(option.value) ? " active" : ""}`}
                  style={
                    filters.priorities.includes(option.value)
                      ? { background: "var(--accent-soft)", borderColor: "var(--accent-ring)" }
                      : undefined
                  }
                  onClick={() => togglePriority(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span className="field-label">截止日</span>
            <select
              className="input"
              value={filters.due}
              onChange={(event) => update({ due: event.target.value as DueFilter })}
            >
              {DUE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>
              {active ? "筛选中" : "未筛选"}
            </span>
            <button
              className="btn btn-sm"
              disabled={!active}
              onClick={() => setFilters(FILTERS_NONE)}
            >
              清除筛选
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
