import type {
  GraphEdge,
  GraphLayout,
  GraphLayoutNode,
  NodeId,
  NodePosition,
  Point,
  TreeNode,
  Viewport,
} from "./types";
import { indexChildren } from "./tree";

export const NODE_WIDTH = 168;
export const NODE_HEIGHT = 36;
export const NODE_RADIUS = Math.hypot(NODE_WIDTH / 2, NODE_HEIGHT / 2);
export const RING_GAP = 34;
export const MIN_SCALE = 0.1;
export const MAX_SCALE = 4;

const ROOT_KEY = "__root__";
type LayoutKey = NodeId | typeof ROOT_KEY;

/**
 * 环形布局：每个父节点的直接子节点均匀分布在同一圆周上，叶子节点即围绕父节点成圈。
 * 半径按子树包围圆计算，保证相邻子树与父节点本身互不重叠。
 */
export function layoutTree(nodes: Map<NodeId, TreeNode>): GraphLayout {
  const empty: GraphLayout = {
    nodes: [],
    byId: new Map(),
    edges: [],
    bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  };
  if (nodes.size === 0) return empty;

  const childrenOf = indexChildren(nodes.values());
  const ringOf = new Map<LayoutKey, number>();

  const measure = (key: LayoutKey): number => {
    const children = childrenOf.get(key === ROOT_KEY ? null : key) ?? [];
    if (children.length === 0) return NODE_RADIUS;
    const radii = children.map((child) => measure(child.id));
    const parentRadius = key === ROOT_KEY ? 0 : NODE_RADIUS;
    const largest = Math.max(...radii);
    let ring: number;
    if (children.length === 1) {
      ring = parentRadius + largest + RING_GAP;
    } else {
      let maxPair = 0;
      for (let index = 0; index < radii.length; index += 1) {
        maxPair = Math.max(maxPair, radii[index] + radii[(index + 1) % radii.length]);
      }
      ring = Math.max(
        parentRadius + largest + RING_GAP,
        (maxPair + RING_GAP) / (2 * Math.sin(Math.PI / children.length)),
      );
    }
    ringOf.set(key, ring);
    return ring + largest;
  };
  measure(ROOT_KEY);

  const layoutNodes: GraphLayoutNode[] = [];
  const byId = new Map<NodeId, GraphLayoutNode>();
  const edges: GraphEdge[] = [];

  const place = (key: LayoutKey, cx: number, cy: number, depth: number) => {
    const children = childrenOf.get(key === ROOT_KEY ? null : key) ?? [];
    if (children.length === 0) return;
    const ring = ringOf.get(key) ?? 0;
    const step = (Math.PI * 2) / children.length;
    const start = children.length === 1 ? 0 : -Math.PI / 2;
    children.forEach((child, index) => {
      const angle = start + step * index;
      const childX = cx + Math.cos(angle) * ring;
      const childY = cy + Math.sin(angle) * ring;
      const graphNode: GraphLayoutNode = {
        id: child.id,
        node: child,
        x: childX - NODE_WIDTH / 2,
        y: childY - NODE_HEIGHT / 2,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        depth,
      };
      layoutNodes.push(graphNode);
      byId.set(child.id, graphNode);
      if (child.parentId && byId.has(child.parentId)) {
        edges.push({ from: child.parentId, to: child.id });
      }
      place(child.id, childX, childY, depth + 1);
    });
  };
  place(ROOT_KEY, 0, 0, 0);

  const bounds = computeBounds(layoutNodes);
  if (!bounds) return empty;
  return { nodes: layoutNodes, byId, edges, bounds };
}

export function computeBounds(
  nodes: GraphLayoutNode[],
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height);
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

/**
 * 以自动环形布局为基础，用手动坐标覆盖存在坐标的节点。
 * `positions` 的值视为节点中心；返回的新布局按覆盖后的坐标重算 bounds。
 */
export function overlayPositions(
  layout: GraphLayout,
  positions: Record<NodeId, NodePosition>,
): GraphLayout {
  const nodes = layout.nodes.map((node) => {
    const pos = positions[node.id];
    if (!pos) return node;
    return {
      ...node,
      x: pos.x - node.width / 2,
      y: pos.y - node.height / 2,
    };
  });
  const byId = new Map<NodeId, GraphLayoutNode>();
  for (const node of nodes) byId.set(node.id, node);
  const bounds = computeBounds(nodes);
  return {
    nodes,
    byId,
    edges: layout.edges,
    bounds:
      bounds ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  };
}

/** 连线端点取两节点矩形边界与连线方向的交点，保证环形布局下的连线不压住节点。 */
export function edgeEndpoints(
  from: GraphLayoutNode,
  to: GraphLayoutNode,
): { from: Point; to: Point } {
  const fromCenter = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const toCenter = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
  return {
    from: boundaryPoint(from, toCenter.x - fromCenter.x, toCenter.y - fromCenter.y),
    to: boundaryPoint(to, fromCenter.x - toCenter.x, fromCenter.y - toCenter.y),
  };
}

function boundaryPoint(node: GraphLayoutNode, dx: number, dy: number): Point {
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const scaleX = dx === 0 ? Infinity : node.width / 2 / Math.abs(dx);
  const scaleY = dy === 0 ? Infinity : node.height / 2 / Math.abs(dy);
  const scale = Math.min(scaleX, scaleY);
  return { x: cx + dx * scale, y: cy + dy * scale };
}

export function toScreen(point: Point, viewport: Viewport): Point {
  return {
    x: viewport.tx + point.x * viewport.scale,
    y: viewport.ty + point.y * viewport.scale,
  };
}

export function toLayout(point: Point, viewport: Viewport): Point {
  return {
    x: (point.x - viewport.tx) / viewport.scale,
    y: (point.y - viewport.ty) / viewport.scale,
  };
}

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function fitViewport(
  layout: GraphLayout,
  width: number,
  height: number,
  margin = 56,
): Viewport {
  if (layout.nodes.length === 0) {
    return { tx: 48, ty: height / 2, scale: 1 };
  }
  const bounds = layout.bounds;
  const availableWidth = Math.max(80, width - margin * 2);
  const availableHeight = Math.max(80, height - margin * 2);
  const scale = clampScale(
    Math.min(
      availableWidth / Math.max(1, bounds.maxX - bounds.minX),
      availableHeight / Math.max(1, bounds.maxY - bounds.minY),
      1.2,
    ),
  );
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  return {
    tx: width / 2 - centerX * scale,
    ty: height / 2 - centerY * scale,
    scale,
  };
}

export function centerNodeViewport(
  layoutNode: GraphLayoutNode,
  viewport: Viewport,
  width: number,
  height: number,
): Viewport {
  const center = {
    x: layoutNode.x + layoutNode.width / 2,
    y: layoutNode.y + layoutNode.height / 2,
  };
  return {
    ...viewport,
    tx: width / 2 - center.x * viewport.scale,
    ty: height / 2 - center.y * viewport.scale,
  };
}

export function hitTest(
  layout: GraphLayout,
  viewport: Viewport,
  point: Point,
): GraphLayoutNode | null {
  const local = toLayout(point, viewport);
  for (let i = layout.nodes.length - 1; i >= 0; i--) {
    const node = layout.nodes[i];
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
}

export function truncateLabel(title: string, max = 16): string {
  const chars = [...title];
  return chars.length > max ? `${chars.slice(0, max).join("")}…` : title;
}
