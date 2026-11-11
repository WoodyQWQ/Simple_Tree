export type NodeId = string;
export type Priority = 0 | 1 | 2 | 3;

export interface TreeNode {
  id: NodeId;
  parentId: NodeId | null;
  title: string;
  note: string;
  priority: Priority;
  dueDate: string | null;
  sortIndex: number;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AiSettings {
  enabled: boolean;
  baseUrl: string;
  model: string;
  apiKey: string;
  proxyUrl?: string;
}

export const EMPTY_AI_SETTINGS: AiSettings = {
  enabled: false,
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  apiKey: "",
  proxyUrl: "",
};

export interface AiSuggestion {
  nodeId: NodeId;
  reason: string;
}

export interface AssociationCandidate {
  node: TreeNode;
  path: string;
  score: number;
}

export interface BackupRecord {
  id: string;
  createdAt: string;
  reason: string;
  nodes: TreeNode[];
  schemaVersion: number;
}

export interface BackupMeta {
  id: string;
  createdAt: string;
  reason: string;
  count: number;
}

export type ViewMode = "outline" | "graph";
export type ThemeMode = "light" | "dark" | "system";
export type StatusFilter = "all" | "active" | "completed";
export type DueFilter = "all" | "overdue" | "today" | "week" | "none";

export interface Filters {
  status: StatusFilter;
  priorities: Priority[];
  due: DueFilter;
}

export const FILTERS_NONE: Filters = {
  status: "all",
  priorities: [],
  due: "all",
};

export interface Viewport {
  tx: number;
  ty: number;
  scale: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface NodePosition {
  x: number;
  y: number;
}

export interface NodeFile {
  id: NodeId;
  nodeId: NodeId;
  name: string;
  size: number;
  mimeType: string;
  createdAt: string;
}

export interface GraphLayoutNode {
  id: NodeId;
  node: TreeNode;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
}

export interface GraphEdge {
  from: NodeId;
  to: NodeId;
}

export interface GraphLayout {
  nodes: GraphLayoutNode[];
  byId: Map<NodeId, GraphLayoutNode>;
  edges: GraphEdge[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

export type LeafStats = Map<NodeId, { done: number; total: number }>;

export interface PlanError {
  ok: false;
  error: string;
}

export interface NodePatch {
  before: Map<NodeId, TreeNode | null>;
  after: Map<NodeId, TreeNode | null>;
  label: string;
}

export interface PlanOk {
  ok: true;
  patch: NodePatch;
  selectId: NodeId | null;
}

export type PlanResult = PlanOk | PlanError;

export type Command =
  | { type: "node.create"; parentId: NodeId | null; afterId?: NodeId | null; title: string }
  | { type: "node.rename"; id: NodeId; title: string }
  | { type: "node.update"; id: NodeId; patch: Partial<Pick<TreeNode, "note" | "priority" | "dueDate">> }
  | { type: "node.move"; id: NodeId; newParentId: NodeId | null; beforeId: NodeId | null }
  | { type: "node.delete"; id: NodeId }
  | { type: "node.complete"; id: NodeId; completed: boolean }
  | { type: "subtree.complete"; id: NodeId; completed: boolean }
  | { type: "data.replace"; nodes: TreeNode[] };
