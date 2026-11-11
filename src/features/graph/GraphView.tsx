import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GraphLayout, GraphLayoutNode, NodeId, Point, Viewport } from "../../domain/types";
import {
  MAX_SCALE,
  MIN_SCALE,
  centerNodeViewport,
  clampScale,
  edgeEndpoints,
  fitViewport,
  hitTest,
  layoutTree,
  overlayPositions,
  toLayout,
  toScreen,
  truncateLabel,
} from "../../domain/graphLayout";
import { ancestorsOf, descendantsOf, pathLabel } from "../../domain/tree";
import { isCompleted } from "../../domain/stats";
import { dueInfo, PRIORITY_COLORS } from "../../domain/format";
import { useTreeData } from "../../store/selectors";
import { useTreeStore } from "../../store/treeStore";
import { Icon } from "../../components/ui";

let graphViewport: Viewport = { tx: 56, ty: 400, scale: 1 };
let graphInitialized = false;

function readColors() {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string) => style.getPropertyValue(name).trim();
  return {
    panel: read("--panel"),
    panel2: read("--panel-2"),
    border: read("--border"),
    borderStrong: read("--border-strong"),
    text: read("--text"),
    muted: read("--muted"),
    accent: read("--accent"),
    accentSoft: read("--accent-soft"),
    danger: read("--danger"),
  };
}

export function GraphView() {
  const data = useTreeData();
  const selectedId = useTreeStore((state) => state.selectedId);
  const selectNode = useTreeStore((state) => state.selectNode);
  const setView = useTreeStore((state) => state.setView);
  const requestInlineAdd = useTreeStore((state) => state.requestInlineAdd);
  const flash = useTreeStore((state) => state.flash);
  const focus = useTreeStore((state) => state.focus);
  const theme = useTreeStore((state) => state.theme);
  const today = useTreeStore((state) => state.today);
  const positions = useTreeStore((state) => state.positions);
  const setPosition = useTreeStore((state) => state.setPosition);
  const resetPositions = useTreeStore((state) => state.resetPositions);
  const createNodeAt = useTreeStore((state) => state.createNodeAt);
  const moveNode = useTreeStore((state) => state.moveNode);
  const attachFiles = useTreeStore((state) => state.attachFiles);

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [viewport, setViewport] = useState<Viewport>(graphViewport);
  const [hover, setHover] = useState<{ id: NodeId; x: number; y: number } | null>(null);
  const [flashId, setFlashId] = useState<NodeId | null>(null);
  const [draft, setDraft] = useState<{ x: number; y: number; parentId: NodeId | null } | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [dragPreview, setDragPreview] = useState<{ id: NodeId; x: number; y: number } | null>(null);
  const [candidateId, setCandidateId] = useState<NodeId | null>(null);

  const baseLayout: GraphLayout = useMemo(() => layoutTree(data.map), [data.map]);
  const layout: GraphLayout = useMemo(() => {
    const merged = { ...(positions ?? {}) };
    if (dragPreview) merged[dragPreview.id] = { x: dragPreview.x, y: dragPreview.y };
    return overlayPositions(baseLayout, merged);
  }, [baseLayout, positions, dragPreview]);
  const selectedPath = useMemo(() => {
    const set = new Set<NodeId>();
    if (!selectedId) return set;
    set.add(selectedId);
    for (const ancestorId of ancestorsOf(selectedId, data.map)) set.add(ancestorId);
    return set;
  }, [selectedId, data.map]);

  const drawRef = useRef<() => void>(() => undefined);
  const rafRef = useRef(0);
  const latest = useRef({
    layout,
    data,
    selectedId,
    selectedPath,
    hoverId: hover?.id ?? null,
    flashId,
    candidateId,
    today,
  });
  latest.current = {
    layout,
    data,
    selectedId,
    selectedPath,
    hoverId: hover?.id ?? null,
    flashId,
    candidateId,
    today,
  };

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const width = wrap.clientWidth;
    const height = wrap.clientHeight;
    if (width === 0 || height === 0) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { layout: currentLayout, data: currentData, selectedId: currentSelected, selectedPath: path, hoverId, flashId: currentFlash, candidateId: currentCandidate, today: currentToday } = latest.current;
    const vp = graphViewport;
    const colors = readColors();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    ctx.save();
    ctx.translate(vp.tx, vp.ty);
    ctx.scale(vp.scale, vp.scale);

    for (const edge of currentLayout.edges) {
      const fromNode = currentLayout.byId.get(edge.from);
      const toNode = currentLayout.byId.get(edge.to);
      if (!fromNode || !toNode) continue;
      const highlighted = path.has(edge.from) && path.has(edge.to);
      const { from, to } = edgeEndpoints(fromNode, toNode);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.strokeStyle = highlighted ? colors.accent : colors.border;
      ctx.lineWidth = (highlighted ? 2 : 1.2) / vp.scale;
      ctx.stroke();
    }

    const lodAll = vp.scale >= 0.9;
    const lodFirstTwo = vp.scale >= 0.45;

    for (const item of currentLayout.nodes) {
      const center = toScreen(
        { x: item.x + item.width / 2, y: item.y + item.height / 2 },
        vp,
      );
      if (
        center.x < -120 ||
        center.y < -80 ||
        center.x > width + 120 ||
        center.y > height + 80
      ) {
        continue;
      }
      const stats = currentData.stats.get(item.id) ?? { done: 0, total: 0 };
      const completed = isCompleted(item.node, currentData.childrenOf, currentData.stats);
      const overdue = Boolean(
        item.node.dueDate && !completed && item.node.dueDate < currentToday,
      );
      const selected = item.id === currentSelected;
      const inPath = path.has(item.id);
      const hovered = item.id === hoverId;
      const isCandidate = item.id === currentCandidate;

      ctx.beginPath();
      ctx.roundRect(item.x, item.y, item.width, item.height, 8);
      ctx.fillStyle = selected ? colors.accentSoft : colors.panel;
      ctx.fill();
      ctx.strokeStyle = selected || hovered || isCandidate ? colors.accent : overdue ? colors.danger : inPath ? colors.accent : colors.borderStrong;
      ctx.lineWidth = (selected || isCandidate ? 2 : 1.1) / vp.scale;
      ctx.stroke();

      const cy = item.y + item.height / 2;
      if (stats.total > 1 || (currentData.childrenOf.get(item.id) ?? []).length > 0) {
        const r = 6.5;
        const cx = item.x + 17;
        const ratio = stats.total > 0 ? stats.done / stats.total : 0;
        if (ratio >= 1) {
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fillStyle = colors.accent;
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(cx - 3, cy);
          ctx.lineTo(cx - 0.5, cy + 2.5);
          ctx.lineTo(cx + 3.5, cy - 3);
          ctx.strokeStyle = colors.panel;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.strokeStyle = colors.border;
          ctx.lineWidth = 2.4;
          ctx.stroke();
          if (ratio > 0) {
            ctx.beginPath();
            ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + ratio * Math.PI * 2);
            ctx.strokeStyle = colors.accent;
            ctx.lineWidth = 2.4;
            ctx.lineCap = "round";
            ctx.stroke();
          }
        }
      } else {
        ctx.beginPath();
        ctx.roundRect(item.x + 10, cy - 6, 12, 12, 3);
        if (completed) {
          ctx.fillStyle = colors.accent;
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(item.x + 13, cy);
          ctx.lineTo(item.x + 15.5, cy + 2.5);
          ctx.lineTo(item.x + 19.5, cy - 3);
          ctx.strokeStyle = colors.panel;
          ctx.lineWidth = 1.6;
          ctx.stroke();
        } else {
          ctx.strokeStyle = colors.borderStrong;
          ctx.lineWidth = 1.4;
          ctx.stroke();
        }
      }

      if (item.node.priority !== 0) {
        ctx.beginPath();
        ctx.arc(item.x + item.width - 11, cy, 3, 0, Math.PI * 2);
        ctx.fillStyle = PRIORITY_COLORS[item.node.priority];
        ctx.fill();
      }

      const shouldDrawLabel =
        lodAll ||
        (lodFirstTwo && (item.depth <= 1 || selected || inPath || hovered)) ||
        (!lodFirstTwo && (item.depth === 0 || selected || inPath || hovered)) ||
        selected ||
        inPath ||
        hovered;

      if (shouldDrawLabel) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(item.x + 2, item.y + 2, item.width - 4, item.height - 4);
        ctx.clip();
        ctx.translate(item.x + 34, cy);
        ctx.font = '12px "Inter", "SF Pro Text", "PingFang SC", sans-serif';
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillStyle = completed ? colors.muted : colors.text;
        ctx.fillText(truncateLabel(item.node.title, 16), 0, 0);
        ctx.restore();
      }
    }
    ctx.restore();

    if (currentFlash) {
      const flashNode = currentLayout.byId.get(currentFlash);
      if (flashNode) {
        const topLeft = toScreen({ x: flashNode.x, y: flashNode.y }, vp);
        const size = { width: flashNode.width * vp.scale, height: flashNode.height * vp.scale };
        ctx.save();
        ctx.strokeStyle = colors.accent;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.roundRect(topLeft.x - 3, topLeft.y - 3, size.width + 6, size.height + 6, 10);
        ctx.stroke();
        ctx.restore();
      }
    }
  }, []);

  drawRef.current = draw;

  const requestDraw = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = 0;
      drawRef.current();
    });
  }, []);

  useEffect(() => {
    requestDraw();
  }, [layout, selectedId, hover?.id, flashId, candidateId, theme, size, today, requestDraw]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const observer = new ResizeObserver(() => {
      setSize({ width: wrap.clientWidth, height: wrap.clientHeight });
    });
    observer.observe(wrap);
    setSize({ width: wrap.clientWidth, height: wrap.clientHeight });
    return () => observer.disconnect();
  }, []);

  const applyViewport = useCallback((next: Viewport) => {
    graphViewport = next;
    setViewport(next);
    requestDraw();
  }, [requestDraw]);

  const centerOn = useCallback(
    (id: NodeId) => {
      const node = layout.byId.get(id);
      const wrap = wrapRef.current;
      if (!node || !wrap) return;
      applyViewport(
        centerNodeViewport(
          node,
          graphViewport,
          wrap.clientWidth,
          wrap.clientHeight,
        ),
      );
    },
    [layout, applyViewport],
  );

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || size.width === 0 || layout.nodes.length === 0) return;
    if (!graphInitialized) {
      const next =
        layout.nodes.length === 1
          ? (() => {
              const node = layout.nodes[0];
              return {
                tx: size.width / 2 - (node.x + node.width / 2),
                ty: size.height / 2 - (node.y + node.height / 2),
                scale: 1,
              };
            })()
          : fitViewport(layout, size.width, size.height);
      graphInitialized = true;
      applyViewport(next);
      if (selectedId) centerOn(selectedId);
    }
    // 只在首次有数据时初始化视口；后续新增/删除节点保持当前视角。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.width, size.height, layout.nodes.length]);

  useEffect(() => {
    if (!focus) return;
    if (!layout.byId.has(focus.id)) return;
    centerOn(focus.id);
    setFlashId(focus.id);
    const timer = window.setTimeout(() => setFlashId(null), 2000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce]);

  useEffect(() => {
    if (!flash) return;
    if (!layout.byId.has(flash.id)) return;
    setFlashId(flash.id);
    const timer = window.setTimeout(() => setFlashId(null), 2000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flash?.nonce]);

  const drag = useRef<{
    mode: "pan" | "node";
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    moved: boolean;
    pointerId: number;
    id: NodeId | null;
  } | null>(null);

  const localPoint = (event: React.PointerEvent | React.WheelEvent | React.MouseEvent): Point => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  };

  const findCandidate = useCallback(
    (draggedId: NodeId, local: Point): GraphLayoutNode | null => {
      const blocked = descendantsOf(data.map, draggedId);
      blocked.add(draggedId);
      for (let i = layout.nodes.length - 1; i >= 0; i--) {
        const node = layout.nodes[i];
        if (blocked.has(node.id)) continue;
        if (
          local.x >= node.x - 4 &&
          local.x <= node.x + node.width + 4 &&
          local.y >= node.y - 4 &&
          local.y <= node.y + node.height + 4
        ) {
          return node;
        }
      }
      return null;
    },
    [data.map, layout],
  );

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return;
    const point = localPoint(event);
    const hit = hitTest(layout, graphViewport, point);
    const mode = hit ? "node" : "pan";
    drag.current = {
      mode,
      startX: point.x,
      startY: point.y,
      lastX: point.x,
      lastY: point.y,
      moved: false,
      pointerId: event.pointerId,
      id: hit ? hit.id : null,
    };
    try {
      canvasRef.current?.setPointerCapture(event.pointerId);
    } catch {
      // 合成事件或指针已失效时忽略捕获失败。
    }
    canvasRef.current?.classList.add("dragging");
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const point = localPoint(event);
    const current = drag.current;
    if (current) {
      const dx = point.x - current.lastX;
      const dy = point.y - current.lastY;
      if (Math.abs(point.x - current.startX) + Math.abs(point.y - current.startY) > 3) {
        current.moved = true;
      }
      if (current.mode === "pan" && (dx !== 0 || dy !== 0)) {
        applyViewport({ ...graphViewport, tx: graphViewport.tx + dx, ty: graphViewport.ty + dy });
      } else if (current.mode === "node" && current.moved && current.id) {
        const local = toLayout(point, graphViewport);
        setDragPreview({ id: current.id, x: local.x, y: local.y });
        setCandidateId(findCandidate(current.id, local)?.id ?? null);
      }
      current.lastX = point.x;
      current.lastY = point.y;
      if (current.moved) {
        setHover(null);
        return;
      }
    }
    if (!current || !current.moved) {
      const hit = hitTest(layout, graphViewport, point);
      setHover(hit ? { id: hit.id, x: point.x, y: point.y } : null);
    }
  };

  const endDrag = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const current = drag.current;
    const point = localPoint(event);
    canvasRef.current?.classList.remove("dragging");
    if (!current) return;
    if (current.mode === "node" && current.moved && current.id) {
      const local = toLayout(point, graphViewport);
      const candidate = findCandidate(current.id, local);
      if (candidate) {
        const self = layout.byId.get(current.id);
        const fromX = self ? self.x + self.width / 2 : local.x;
        const fromY = self ? self.y + self.height / 2 : local.y;
        const toX = candidate.x + candidate.width / 2;
        const toY = candidate.y + candidate.height + 24;
        const dx = toX - fromX;
        const dy = toY - fromY;
        const subtreeIds = [current.id, ...descendantsOf(data.map, current.id)];
        void moveNode(current.id, candidate.id, null).then(() => {
          const frozen = useTreeStore.getState().positions ?? {};
          for (const id of subtreeIds) {
            const p = frozen[id];
            if (p) void setPosition(id, { x: p.x + dx, y: p.y + dy });
          }
        });
      } else {
        void setPosition(current.id, { x: local.x, y: local.y });
      }
    } else if (!current.moved) {
      const hit = hitTest(layout, graphViewport, point);
      selectNode(hit ? hit.id : null);
    }
    setDragPreview(null);
    setCandidateId(null);
    drag.current = null;
    try {
      canvasRef.current?.releasePointerCapture(current.pointerId);
    } catch {
      // 指针已释放时忽略。
    }
  };

  const zoomAt = useCallback(
    (factor: number, anchor: Point) => {
      const previous = graphViewport;
      const scale = clampScale(previous.scale * factor);
      if (scale === previous.scale) return;
      const local = toLayout(anchor, previous);
      applyViewport({
        ...previous,
        scale,
        tx: anchor.x - local.x * scale,
        ty: anchor.y - local.y * scale,
      });
    },
    [applyViewport],
  );

  const zoomCenter = (factor: number) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    zoomAt(factor, { x: wrap.clientWidth / 2, y: wrap.clientHeight / 2 });
  };

  const fit = () => {
    const wrap = wrapRef.current;
    if (!wrap || layout.nodes.length === 0) return;
    applyViewport(fitViewport(layout, wrap.clientWidth, wrap.clientHeight));
  };

  const goToRoot = () => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    // 根节点即顶层节点（parentId 为 null）；取它们的质心作为“根”的位置。
    const roots = layout.nodes.filter((n) => n.node.parentId === null);
    if (roots.length === 0) return;
    const cx = roots.reduce((sum, n) => sum + n.x + n.width / 2, 0) / roots.length;
    const cy = roots.reduce((sum, n) => sum + n.y + n.height / 2, 0) / roots.length;
    applyViewport({
      tx: wrap.clientWidth / 2 - cx * graphViewport.scale,
      ty: wrap.clientHeight / 2 - cy * graphViewport.scale,
      scale: graphViewport.scale,
    });
  };

  const openDraft = (parentId: NodeId | null, center: Point) => {
    setDraft({ x: center.x, y: center.y, parentId });
    setDraftTitle("");
  };

  const submitDraft = () => {
    if (!draft) return;
    const title = draftTitle.trim();
    if (!title) {
      setDraft(null);
      setDraftTitle("");
      return;
    }
    void createNodeAt({ parentId: draft.parentId, title }, { x: draft.x, y: draft.y });
    setDraft(null);
    setDraftTitle("");
  };

  const cancelDraft = () => {
    setDraft(null);
    setDraftTitle("");
  };

  const addNode = () => {
    const wrap = wrapRef.current;
    const center = { x: (wrap?.clientWidth ?? 0) / 2, y: (wrap?.clientHeight ?? 0) / 2 };
    let local = toLayout(center, graphViewport);
    let parentId: NodeId | null = null;
    if (selectedId) {
      const node = layout.byId.get(selectedId);
      if (node) {
        parentId = selectedId;
        local = { x: node.x + node.width / 2, y: node.y + node.height / 2 + 96 };
      }
    }
    openDraft(parentId, local);
  };

  const autoLayout = async () => {
    await resetPositions();
    const wrap = wrapRef.current;
    if (!wrap || baseLayout.nodes.length === 0) return;
    applyViewport(fitViewport(baseLayout, wrap.clientWidth, wrap.clientHeight));
  };

  const draftScreen = draft ? toScreen({ x: draft.x, y: draft.y }, graphViewport) : null;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      // 只有捏合/按住 Ctrl 的滚轮才缩放；触控板普通上下、左右滑动一律平移视图，
      // 避免上下滑动时误触发缩放而与移动视图的操作冲突。
      if (event.ctrlKey) {
        const rect = canvas.getBoundingClientRect();
        const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        zoomAt(Math.exp(-event.deltaY * 0.0015), point);
        return;
      }
      applyViewport({
        ...graphViewport,
        tx: graphViewport.tx - event.deltaX,
        ty: graphViewport.ty - event.deltaY,
      });
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [zoomAt, applyViewport]);

  const selectedNode = selectedId ? data.map.get(selectedId) : null;
  const hoverNode = hover ? data.map.get(hover.id) : null;
  const hoverStats = hover ? data.stats.get(hover.id) ?? { done: 0, total: 0 } : null;
  const hoverCompleted = hoverNode
    ? isCompleted(hoverNode, data.childrenOf, data.stats)
    : false;
  const hoverDue = hoverNode ? dueInfo(hoverNode, hoverCompleted, today) : null;

  const zoomPercent = Math.round(viewport.scale * 100);

  return (
    <div className="content">
      <div className="graph-toolbar">
        <button className="icon-btn" aria-label="缩小" onClick={() => zoomCenter(1 / 1.25)} disabled={viewport.scale <= MIN_SCALE + 0.001}>
          <Icon name="minus" />
        </button>
        <span className="zoom-label">{zoomPercent}%</span>
        <button className="icon-btn" aria-label="放大" onClick={() => zoomCenter(1.25)} disabled={viewport.scale >= MAX_SCALE - 0.001}>
          <Icon name="plus" />
        </button>
        <span style={{ width: 1, height: 18, background: "var(--border)", margin: "0 4px" }} />
        <button className="btn btn-sm" onClick={fit}>
          <Icon name="fit" size={14} />
          适应窗口
        </button>
        <button className="btn btn-sm" onClick={goToRoot}>
          <Icon name="tree" size={14} />
          回到根节点
        </button>
        <span style={{ width: 1, height: 18, background: "var(--border)", margin: "0 4px" }} />
        <button className="btn btn-sm" onClick={addNode}>
          <Icon name="plus" size={14} />
          添加节点
        </button>
        <button className="btn btn-sm" onClick={() => void autoLayout()}>
          <Icon name="fit" size={14} />
          整理
        </button>
        <span style={{ flex: 1 }} />
        {selectedNode && (
          <span style={{ fontSize: 11.5, color: "var(--muted)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {pathLabel(selectedNode.id, data.map)}
          </span>
        )}
      </div>

      <div
        className="graph-canvas-wrap"
        ref={wrapRef}
        onMouseLeave={() => setHover(null)}
      >
        <canvas
          ref={canvasRef}
          className="graph-canvas"
          role="img"
          aria-label={`树图谱，共 ${layout.nodes.length} 个节点${selectedNode ? `，已选中「${pathLabel(selectedNode.id, data.map)}」` : ""}。拖动空白平移，捏合或按住 Ctrl 滚动缩放，拖动节点移动或合并，双击空白新建。`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={(event) => {
            const point = localPoint(event);
            const hit = hitTest(layout, graphViewport, point);
            if (hit) {
              selectNode(hit.id);
              return;
            }
            const local = toLayout(point, graphViewport);
            setDraft({ x: local.x, y: local.y, parentId: null });
            setDraftTitle("");
          }}
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes("Files")) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            const rect = event.currentTarget.getBoundingClientRect();
            const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
            const hit = hitTest(layout, graphViewport, point);
            setCandidateId(hit ? hit.id : null);
          }}
          onDragLeave={() => setCandidateId(null)}
          onDrop={(event) => {
            event.preventDefault();
            setCandidateId(null);
            const files = Array.from(event.dataTransfer.files ?? []);
            if (files.length === 0) return;
            const rect = event.currentTarget.getBoundingClientRect();
            const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
            const hit = hitTest(layout, graphViewport, point);
            if (hit) void attachFiles(hit.id, files);
          }}
        />
        {draft && draftScreen && (
          <input
            className="graph-draft-input"
            style={{
              left: draftScreen.x,
              top: draftScreen.y,
              transform: "translate(-50%, -50%)",
            }}
            autoFocus
            value={draftTitle}
            placeholder={draft.parentId ? "子节点名称" : "新节点名称"}
            onChange={(event) => setDraftTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submitDraft();
              } else if (event.key === "Escape") {
                event.preventDefault();
                cancelDraft();
              }
            }}
            onBlur={cancelDraft}
          />
        )}
        {data.map.size === 0 && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div className="empty-state">
              <Icon name="tree" size={30} />
              <div className="empty-title">还没有事项</div>
              <div style={{ fontSize: 12 }}>图谱会在这里展示整棵树。</div>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setView("outline");
                  requestInlineAdd(null, null);
                }}
              >
                切换到大纲新建
              </button>
            </div>
          </div>
        )}
        {hover && hoverNode && hoverStats && (
          <div
            className="graph-tooltip"
            style={{
              left: Math.min(Math.max(8, hover.x + 14), Math.max(8, size.width - 312)),
              top: Math.min(Math.max(8, hover.y + 14), Math.max(8, size.height - 120)),
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 2 }}>{hoverNode.title}</div>
            <div style={{ color: "var(--muted)", fontSize: 11.5, marginBottom: 4 }}>
              {pathLabel(hoverNode.id, data.map)}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
              {hoverCompleted ? "已完成" : "未完成"}
              {hoverStats.total > 1 ? ` · ${hoverStats.done} / ${hoverStats.total} 叶子完成` : ""}
              {hoverDue ? ` · ${hoverDue.label}` : ""}
            </div>
          </div>
        )}
        {data.map.size > 0 && (
          <div className="graph-hint">拖动节点移动 · 拖到另一节点合并 · 双击空白新建 · 捏合/⌘滚动缩放 · 滑动或拖动空白平移</div>
        )}
      </div>
    </div>
  );
}
