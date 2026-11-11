import { create } from "zustand";
import type {
  AiSettings,
  Command,
  Filters,
  NodeFile,
  NodeId,
  NodePatch,
  NodePosition,
  TreeNode,
  ThemeMode,
  ViewMode,
  BackupRecord,
} from "../domain/types";
import { EMPTY_AI_SETTINGS, FILTERS_NONE } from "../domain/types";
import {
  applyPatch,
  newId,
  nowIso,
  planCommand,
} from "../domain/commands";
import { ancestorsOf, pathLabel } from "../domain/tree";
import { layoutTree, overlayPositions } from "../domain/graphLayout";
import { todayString } from "../domain/validation";
import { initStorage } from "../db/database";
import { commitPatch, loadNodes, replaceAllNodes } from "../db/nodeRepository";
import {
  clearPositions,
  deletePositions,
  loadPositions,
  savePosition,
} from "../db/positionRepository";
import {
  clearFiles,
  deleteFiles,
  loadFiles,
  saveFile,
} from "../db/fileRepository";
import {
  clearAllFileBlobs,
  deleteFileBlob,
  isFileStorageSupported,
  readFileBlob,
  writeFileBlob,
} from "../db/fileStorage";
import { createBackup } from "../db/backupRepository";
import { loadAiSettings, saveAiSettings } from "../db/settingsRepository";

export interface ToastItem {
  id: string;
  message: string;
  type: "info" | "success" | "error";
  actionLabel?: string;
  onAction?: () => void;
  duration: number;
  leaving?: boolean;
}

interface UndoEntry {
  id: string;
  patch: NodePatch;
  selectionBefore: NodeId | null;
  selectionAfter: NodeId | null;
  label: string;
}

export interface FocusRequest {
  id: NodeId;
  nonce: number;
}

export interface QuickAddState {
  open: boolean;
  defaultParentId: NodeId | null;
  nonce: number;
}

export interface InlineAddRequest {
  parentId: NodeId | null;
  afterId: NodeId | null;
  nonce: number;
}

export type Outcome =
  | { ok: true; id: NodeId | null; entryId?: string }
  | { ok: false; error: string };

interface TreeState {
  ready: boolean;
  storageMode: "persistent" | "memory";
  loadError: string | null;
  nodes: Record<NodeId, TreeNode> | null;
  selectedId: NodeId | null;
  expanded: Set<NodeId>;
  view: ViewMode;
  filters: Filters;
  searchQuery: string;
  theme: ThemeMode;
  accent: string | null;
  today: string;
  aiSettings: AiSettings;
  positions: Record<NodeId, NodePosition> | null;
  files: Record<NodeId, NodeFile> | null;
  toasts: ToastItem[];
  undoStack: UndoEntry[];
  redoStack: UndoEntry[];
  flash: FocusRequest | null;
  focus: FocusRequest | null;
  quickAdd: QuickAddState;
  inlineAdd: InlineAddRequest | null;
  settingsOpen: boolean;

  init: () => Promise<void>;
  refresh: () => Promise<void>;
  execute: (command: Command) => Promise<Outcome>;
  createNode: (input: { parentId: NodeId | null; afterId?: NodeId | null; title: string }) => Promise<Outcome>;
  renameNode: (id: NodeId, title: string) => Promise<Outcome>;
  updateNode: (
    id: NodeId,
    patch: Partial<Pick<TreeNode, "note" | "priority" | "dueDate">>,
  ) => Promise<Outcome>;
  moveNode: (id: NodeId, newParentId: NodeId | null, beforeId: NodeId | null) => Promise<Outcome>;
  deleteNode: (id: NodeId) => Promise<Outcome>;
  setLeafCompleted: (id: NodeId, completed: boolean) => Promise<Outcome>;
  setSubtreeCompleted: (id: NodeId, completed: boolean) => Promise<Outcome>;
  importNodes: (nodes: TreeNode[]) => Promise<Outcome>;
  restoreBackup: (backup: BackupRecord) => Promise<Outcome>;
  undo: (entryId?: string) => Promise<void>;
  redo: () => Promise<void>;

  selectNode: (id: NodeId | null) => void;
  requestFocus: (id: NodeId) => void;
  requestInlineAdd: (parentId: NodeId | null, afterId?: NodeId | null) => void;
  clearInlineAdd: () => void;
  openQuickAdd: () => void;
  closeQuickAdd: () => void;
  toggleExpanded: (id: NodeId) => void;
  setAllExpanded: (expanded: boolean) => void;
  setView: (view: ViewMode) => void;
  setFilters: (filters: Filters) => void;
  setSearchQuery: (query: string) => void;
  setTheme: (theme: ThemeMode) => void;
  setAccent: (accent: string | null) => void;
  refreshToday: () => void;
  setSettingsOpen: (open: boolean) => void;
  saveAi: (settings: AiSettings) => Promise<void>;

  setPosition: (id: NodeId, pos: NodePosition) => Promise<void>;
  setPositions: (positions: Record<NodeId, NodePosition>) => Promise<void>;
  resetPositions: () => Promise<void>;
  createNodeAt: (
    input: { parentId: NodeId | null; afterId?: NodeId | null; title: string },
    pos: NodePosition,
  ) => Promise<Outcome>;

  attachFiles: (nodeId: NodeId, files: File[]) => Promise<void>;
  removeFile: (fileId: NodeId) => Promise<void>;
  openFile: (fileId: NodeId) => Promise<void>;

  pushToast: (toast: Omit<ToastItem, "id" | "duration"> & { duration?: number }) => string;
  dismissToast: (id: string) => void;
  notifyError: (message: string) => void;
}

let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

const THEME_KEY = "st:theme";
const ACCENT_KEY = "st:accent";
const EXPANDED_KEY = "st:expanded";

function loadTheme(): ThemeMode {
  const raw = localStorage.getItem(THEME_KEY);
  return raw === "light" || raw === "dark" || raw === "system" ? raw : "system";
}

function loadAccent(): string | null {
  const raw = localStorage.getItem(ACCENT_KEY);
  return raw && /^#[0-9a-fA-F]{6}$/.test(raw) ? raw : null;
}

export function applyAccent(accent: string | null): void {
  const root = document.documentElement;
  if (!accent) {
    root.style.removeProperty("--accent");
    return;
  }
  root.style.setProperty("--accent", accent);
}

function loadExpanded(): Set<NodeId> {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((value): value is string => typeof value === "string"));
  } catch {
    return new Set();
  }
}

function saveExpanded(expanded: Set<NodeId>): void {
  try {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify([...expanded]));
  } catch {
    // 设备偏好写入失败不影响数据操作。
  }
}

function nodeMap(nodes: Record<NodeId, TreeNode> | null): Map<NodeId, TreeNode> {
  return new Map(Object.values(nodes ?? {}).map((node) => [node.id, node]));
}

function toRecord(nodes: Iterable<TreeNode>): Record<NodeId, TreeNode> {
  const record: Record<NodeId, TreeNode> = {};
  for (const node of nodes) record[node.id] = node;
  return record;
}

function patchIsEmpty(patch: NodePatch): boolean {
  return patch.after.size === 0 && patch.before.size === 0;
}

let broadcast: BroadcastChannel | null = null;

export const useTreeStore = create<TreeState>((set, get) => {
  const pushUndo = (entry: UndoEntry) => {
    set((state) => ({
      undoStack: [...state.undoStack.slice(-29), entry],
      redoStack: [],
    }));
  };

  const notifyError = (message: string) => {
    get().pushToast({ message, type: "error", duration: 0 });
  };

  const expandFor = (id: NodeId | null, extra: Set<NodeId> = new Set()) => {
    const state = get();
    if (!id || !state.nodes) return extra;
    for (const ancestorId of ancestorsOf(id, nodeMap(state.nodes))) extra.add(ancestorId);
    if (state.nodes[id]) extra.add(id);
    return extra;
  };

  const persistExpanded = (next: Set<NodeId>) => {
    saveExpanded(next);
  };

  // 结构变化前把当前布局坐标固化为手动坐标，避免环形布局重新排布导致整图跳动。
  const freezePositions = async () => {
    const state = get();
    if (!state.nodes) return;
    const layout = overlayPositions(layoutTree(nodeMap(state.nodes)), state.positions ?? {});
    const next: Record<NodeId, NodePosition> = {};
    for (const node of layout.nodes) {
      next[node.id] = { x: node.x + node.width / 2, y: node.y + node.height / 2 };
    }
    set({ positions: next });
    await Promise.allSettled(
      Object.entries(next).map(([id, pos]) => savePosition(id, pos)),
    );
  };

  const run = async (command: Command): Promise<Outcome> =>
    enqueue(async () => {
      const state = get();
      if (!state.nodes) return { ok: false, error: "数据尚未加载" };
      const map = nodeMap(state.nodes);
      const plan = planCommand(map, command);
      if (!plan.ok) return { ok: false, error: plan.error };
      if (patchIsEmpty(plan.patch)) {
        return { ok: true, id: plan.selectId };
      }

      if (
        command.type === "node.create" ||
        command.type === "node.move" ||
        command.type === "node.delete"
      ) {
        await freezePositions();
      }

      try {
        await commitPatch(plan.patch);
      } catch {
        return { ok: false, error: "保存失败，请重试" };
      }

      if (command.type === "node.delete") {
        const deletedIds: NodeId[] = [];
        for (const [id, node] of plan.patch.after) {
          if (node === null) deletedIds.push(id);
        }
        if (deletedIds.length > 0) {
          await deletePositions(deletedIds).catch(() => undefined);
          const current = get().positions ?? {};
          const next = { ...current };
          for (const id of deletedIds) delete next[id];
          set({ positions: next });

          const currentFiles = get().files ?? {};
          const fileIds = Object.values(currentFiles)
            .filter((file) => deletedIds.includes(file.nodeId))
            .map((file) => file.id);
          if (fileIds.length > 0) {
            await deleteFiles(fileIds).catch(() => undefined);
            await Promise.allSettled(fileIds.map((id) => deleteFileBlob(id)));
            const nextFiles = { ...currentFiles };
            for (const id of fileIds) delete nextFiles[id];
            set({ files: nextFiles });
          }
        }
      }

      const selectionBefore = get().selectedId;
      const nextNodes = applyPatch(get().nodes!, plan.patch);
      const changesSelection =
        command.type === "node.create" ||
        command.type === "node.move" ||
        command.type === "node.delete";
      const nextSelection = changesSelection ? plan.selectId : selectionBefore;
      const extra = expandFor(nextSelection);
      if (command.type === "node.move") {
        expandFor(command.newParentId, extra);
        extra.add(command.newParentId ?? "");
      }
      if (command.type === "node.create" && command.parentId) {
        extra.add(command.parentId);
      }
      if (command.type === "data.replace") {
        set({
          nodes: nextNodes,
          selectedId: nextSelection,
          expanded: new Set(),
          filters: FILTERS_NONE,
        });
        persistExpanded(new Set());
        return { ok: true, id: nextSelection };
      }

      const expanded = new Set([...get().expanded, ...extra]);
      expanded.delete("");
      set({
        nodes: nextNodes,
        selectedId: nextSelection,
        expanded,
        redoStack: [],
      });
      persistExpanded(expanded);
      const undoEntry: UndoEntry = {
        id: newId(),
        patch: plan.patch,
        selectionBefore,
        selectionAfter: nextSelection,
        label: plan.patch.label,
      };
      pushUndo(undoEntry);
      if (command.type === "node.create" || command.type === "node.move") {
        const flashId = command.type === "node.move" ? command.id : nextSelection;
        if (flashId) set({ flash: { id: flashId, nonce: Date.now() } });
      }
      broadcast?.postMessage({ type: "nodes-changed" });
      return { ok: true, id: nextSelection, entryId: undoEntry.id };
    });

  const applyUndo = async (entry: UndoEntry, reverse: boolean): Promise<boolean> => {
    const source = reverse ? entry.patch.before : entry.patch.after;
    const patch: NodePatch = { before: new Map(), after: source, label: entry.label };
    try {
      await commitPatch(patch);
    } catch {
      notifyError("撤销失败，请重试");
      return false;
    }
    const nextNodes = applyPatch(get().nodes ?? {}, entry.patch, reverse);
    const selection = reverse ? entry.selectionBefore : entry.selectionAfter;
    const extra = expandFor(selection);
    const expanded = new Set([...get().expanded, ...extra]);
    expanded.delete("");
    set({ nodes: nextNodes, selectedId: selection, expanded });
    persistExpanded(expanded);
    broadcast?.postMessage({ type: "nodes-changed" });
    return true;
  };

  return {
    ready: false,
    storageMode: "persistent",
    loadError: null,
    nodes: null,
    selectedId: null,
    expanded: loadExpanded(),
    view: "graph",
    filters: FILTERS_NONE,
    searchQuery: "",
    theme: loadTheme(),
    accent: loadAccent(),
    today: todayString(),
    aiSettings: EMPTY_AI_SETTINGS,
    positions: null,
    files: null,
    toasts: [],
    undoStack: [],
    redoStack: [],
    flash: null,
    focus: null,
    quickAdd: { open: false, defaultParentId: null, nonce: 0 },
    inlineAdd: null,
    settingsOpen: false,

    init: async () => {
      const mode = await initStorage();
      let stored: AiSettings | null = null;
      try {
        stored = await loadAiSettings();
      } catch {
        stored = null;
      }
      try {
        const nodes = await loadNodes();
        const record = toRecord(nodes);
        const positions = await loadPositions();
        const files = await loadFiles();
        const expanded = new Set([...loadExpanded()].filter((id) => record[id]));
        if (expanded.size !== loadExpanded().size) persistExpanded(expanded);
        set({
          ready: true,
          storageMode: mode,
          nodes: record,
          expanded,
          positions,
          files,
          aiSettings: stored ?? EMPTY_AI_SETTINGS,
        });
      } catch {
        set({
          ready: true,
          storageMode: "memory",
          nodes: {},
          loadError: "本地数据读取失败，已进入临时模式",
        });
      }

      if (typeof BroadcastChannel !== "undefined" && !broadcast) {
        broadcast = new BroadcastChannel("simple-tree");
        broadcast.onmessage = () => {
          void get().refresh();
        };
      }
    },

    refresh: async () => {
      try {
        const nodes = await loadNodes();
        const record = toRecord(nodes);
        const selected = get().selectedId;
        set({
          nodes: record,
          selectedId: selected && record[selected] ? selected : null,
        });
      } catch {
        notifyError("刷新数据失败");
      }
    },

    execute: async (command) => {
      const outcome = await run(command);
      if (!outcome.ok) notifyError(outcome.error);
      return outcome;
    },

    createNode: async (input) => {
      const outcome = await run({
        type: "node.create",
        parentId: input.parentId,
        afterId: input.afterId ?? null,
        title: input.title,
      });
      if (!outcome.ok) {
        notifyError(outcome.error);
        return outcome;
      }
      const state = get();
      const targetPath = input.parentId
        ? pathLabel(input.parentId, nodeMap(state.nodes))
        : "顶层";
      if (state.filters !== FILTERS_NONE) {
        set({ filters: FILTERS_NONE });
        get().pushToast({ message: "已清除筛选以显示新事项", type: "info", duration: 3000 });
      }
      get().pushToast({
        message: `已添加到「${targetPath}」`,
        type: "success",
        duration: 8000,
        actionLabel: "撤销",
        onAction: () => {
          void get().undo(outcome.entryId);
        },
      });
      return outcome;
    },

    renameNode: async (id, title) => {
      const outcome = await run({ type: "node.rename", id, title });
      if (!outcome.ok) notifyError(outcome.error);
      return outcome;
    },

    updateNode: async (id, patch) => {
      const outcome = await run({ type: "node.update", id, patch });
      if (!outcome.ok) notifyError(outcome.error);
      return outcome;
    },

    moveNode: async (id, newParentId, beforeId) => {
      const outcome = await run({ type: "node.move", id, newParentId, beforeId });
      if (!outcome.ok) {
        notifyError(outcome.error);
        return outcome;
      }
      if (!outcome.entryId) return outcome;
      get().pushToast({
        message: "已移动事项",
        type: "success",
        duration: 8000,
        actionLabel: "撤销",
        onAction: () => {
          void get().undo(outcome.entryId);
        },
      });
      return outcome;
    },

    deleteNode: async (id) => {
      const outcome = await run({ type: "node.delete", id });
      if (!outcome.ok) notifyError(outcome.error);
      else
        get().pushToast({
          message: "已删除事项",
          type: "info",
          duration: 8000,
          actionLabel: "撤销",
          onAction: () => {
            void get().undo(outcome.entryId);
          },
        });
      return outcome;
    },

    setLeafCompleted: async (id, completed) => {
      const outcome = await run({ type: "node.complete", id, completed });
      if (!outcome.ok) notifyError(outcome.error);
      return outcome;
    },

    setSubtreeCompleted: async (id, completed) => {
      const outcome = await run({ type: "subtree.complete", id, completed });
      if (!outcome.ok) notifyError(outcome.error);
      return outcome;
    },

    importNodes: async (nodes) => {
      const state = get();
      if (!state.nodes) return { ok: false, error: "数据尚未加载" };
      if (state.storageMode === "memory") {
        const message = "临时模式下无法导入";
        notifyError(message);
        return { ok: false, error: message };
      }
      try {
        await createBackup(Object.values(state.nodes), "导入前自动备份");
      } catch {
        const message = "无法创建导入备份，已取消导入";
        notifyError(message);
        return { ok: false, error: message };
      }

      const result = await enqueue(async () => {
        const current = nodeMap(get().nodes);
        const plan = planCommand(current, { type: "data.replace", nodes });
        if (!plan.ok) return { ok: false as const, error: plan.error };
        try {
          await replaceAllNodes(nodes);
        } catch {
          return { ok: false as const, error: "导入写入失败，现有数据未改变" };
        }
        const entry: UndoEntry = {
          id: newId(),
          patch: plan.patch,
          selectionBefore: get().selectedId,
          selectionAfter: null,
          label: "覆盖导入",
        };
        set({
          nodes: toRecord(nodes),
          selectedId: null,
          expanded: new Set(),
          undoStack: [entry],
          redoStack: [],
          filters: FILTERS_NONE,
          positions: {},
          files: {},
        });
        await clearPositions().catch(() => undefined);
        await clearFiles().catch(() => undefined);
        await clearAllFileBlobs().catch(() => undefined);
        persistExpanded(new Set());
        broadcast?.postMessage({ type: "nodes-changed" });
        return { ok: true as const, id: null, entryId: entry.id };
      });
      if (!result.ok) notifyError(result.error);
      return result;
    },

    restoreBackup: async (backup) => {
      const state = get();
      if (!state.nodes) return { ok: false, error: "数据尚未加载" };
      try {
        await createBackup(Object.values(state.nodes), "恢复备份前自动备份");
      } catch {
        const message = "无法备份当前数据，已取消恢复";
        notifyError(message);
        return { ok: false, error: message };
      }
      try {
        await replaceAllNodes(backup.nodes);
      } catch {
        const message = "恢复失败，现有数据未改变";
        notifyError(message);
        return { ok: false, error: message };
      }
      set({
        nodes: toRecord(backup.nodes),
        selectedId: null,
        expanded: new Set(),
        undoStack: [],
        redoStack: [],
        filters: FILTERS_NONE,
        positions: {},
        files: {},
      });
      await clearPositions().catch(() => undefined);
      await clearFiles().catch(() => undefined);
      await clearAllFileBlobs().catch(() => undefined);
      persistExpanded(new Set());
      broadcast?.postMessage({ type: "nodes-changed" });
      get().pushToast({ message: `已恢复备份（${backup.nodes.length} 项）`, type: "success", duration: 3000 });
      return { ok: true, id: null };
    },

    undo: async (entryId) => {
      const state = get();
      const entry = state.undoStack[state.undoStack.length - 1];
      if (!entry) {
        get().pushToast({ message: "没有可撤销的操作", type: "info", duration: 3000 });
        return;
      }
      if (entryId && entry.id !== entryId) {
        get().pushToast({ message: "该操作已不是最近一步", type: "info", duration: 3000 });
        return;
      }
      const ok = await applyUndo(entry, true);
      if (!ok) return;
      set((current) => ({
        undoStack: current.undoStack.slice(0, -1),
        redoStack: [...current.redoStack, entry],
      }));
    },

    redo: async () => {
      const state = get();
      const entry = state.redoStack[state.redoStack.length - 1];
      if (!entry) {
        get().pushToast({ message: "没有可重做的操作", type: "info", duration: 3000 });
        return;
      }
      const ok = await applyUndo(entry, false);
      if (!ok) return;
      set((current) => ({
        undoStack: [...current.undoStack, entry],
        redoStack: current.redoStack.slice(0, -1),
      }));
    },

    selectNode: (id) => set({ selectedId: id }),

    requestFocus: (id) => {
      const state = get();
      if (!state.nodes || !state.nodes[id]) return;
      const expanded = new Set(state.expanded);
      for (const ancestorId of ancestorsOf(id, nodeMap(state.nodes))) expanded.add(ancestorId);
      const nonce = Date.now();
      set({
        selectedId: id,
        expanded,
        filters: FILTERS_NONE,
        focus: { id, nonce },
        flash: { id, nonce },
      });
      persistExpanded(expanded);
    },

    requestInlineAdd: (parentId, afterId = null) => {
      const expanded = new Set(get().expanded);
      if (parentId) expanded.add(parentId);
      if (!parentId && afterId) {
        const parent = get().nodes?.[afterId]?.parentId ?? null;
        if (parent) expanded.add(parent);
      }
      set({
        view: "outline",
        expanded,
        inlineAdd: { parentId, afterId, nonce: Date.now() },
      });
      persistExpanded(expanded);
    },

    clearInlineAdd: () => set({ inlineAdd: null }),

    openQuickAdd: () => {
      const selectedId = get().selectedId;
      const exists = selectedId ? !!get().nodes?.[selectedId] : false;
      set({
        quickAdd: {
          open: true,
          defaultParentId: exists ? selectedId : null,
          nonce: Date.now(),
        },
      });
    },

    closeQuickAdd: () => set((state) => ({ quickAdd: { ...state.quickAdd, open: false } })),

    toggleExpanded: (id) => {
      const expanded = new Set(get().expanded);
      if (expanded.has(id)) expanded.delete(id);
      else expanded.add(id);
      set({ expanded });
      persistExpanded(expanded);
    },

    setAllExpanded: (value) => {
      const nodes = get().nodes;
      if (!nodes) return;
      const expanded = value
        ? new Set(Object.keys(nodes))
        : new Set<NodeId>();
      set({ expanded });
      persistExpanded(expanded);
    },

    setView: (view) => set({ view }),
    setFilters: (filters) => set({ filters }),
    setSearchQuery: (searchQuery) => set({ searchQuery }),

    setTheme: (theme) => {
      localStorage.setItem(THEME_KEY, theme);
      const dark =
        theme === "dark" ||
        (theme === "system" &&
          typeof window !== "undefined" &&
          window.matchMedia("(prefers-color-scheme: dark)").matches);
      document.documentElement.classList.toggle("dark", dark);
      document.documentElement.style.colorScheme = dark ? "dark" : "light";
      set({ theme });
    },

    setAccent: (accent) => {
      const normalized = accent && /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : null;
      if (normalized) localStorage.setItem(ACCENT_KEY, normalized);
      else localStorage.removeItem(ACCENT_KEY);
      applyAccent(normalized);
      set({ accent: normalized });
    },

    refreshToday: () => {
      const today = todayString();
      if (today !== get().today) set({ today });
    },

    setSettingsOpen: (settingsOpen) => set({ settingsOpen }),

    saveAi: async (settings) => {
      try {
        await saveAiSettings(settings);
        set({ aiSettings: settings });
      } catch {
        notifyError("AI 配置保存失败");
      }
    },

    setPosition: async (id, pos) => {
      const current = get().positions ?? {};
      const next = { ...current, [id]: { x: pos.x, y: pos.y } };
      set({ positions: next });
      try {
        await savePosition(id, pos);
      } catch {
        notifyError("坐标保存失败");
      }
    },

    setPositions: async (positions) => {
      set({ positions });
      await Promise.allSettled(
        Object.entries(positions).map(([id, pos]) => savePosition(id, pos)),
      );
    },

    resetPositions: async () => {
      try {
        await clearPositions();
      } catch {
        notifyError("重置布局失败");
        return;
      }
      set({ positions: {} });
    },

    createNodeAt: async (input, pos) => {
      const outcome = await get().createNode(input);
      if (outcome.ok && outcome.id) {
        await get().setPosition(outcome.id, pos);
      }
      return outcome;
    },

    attachFiles: async (nodeId, files) => {
      const state = get();
      if (!state.nodes || !state.nodes[nodeId]) {
        notifyError("目标事项已不存在");
        return;
      }
      if (!isFileStorageSupported()) {
        notifyError("当前浏览器不支持本地文件存储");
        return;
      }
      const current = state.files ?? {};
      const next = { ...current };
      try {
        for (const file of files) {
          const id = newId();
          await writeFileBlob(id, file);
          const meta: NodeFile = {
            id,
            nodeId,
            name: file.name,
            size: file.size,
            mimeType: file.type || "application/octet-stream",
            createdAt: nowIso(),
          };
          await saveFile(meta);
          next[id] = meta;
        }
      } catch {
        notifyError("文件保存失败，请重试");
        return;
      }
      set({ files: next });
      get().pushToast({
        message: `已关联 ${files.length} 个文件`,
        type: "success",
        duration: 3000,
      });
    },

    removeFile: async (fileId) => {
      const file = get().files?.[fileId];
      if (!file) return;
      await deleteFiles([fileId]).catch(() => undefined);
      await deleteFileBlob(fileId).catch(() => undefined);
      const next = { ...(get().files ?? {}) };
      delete next[fileId];
      set({ files: next });
    },

    openFile: async (fileId) => {
      const file = get().files?.[fileId];
      if (!file) {
        notifyError("文件已不存在");
        return;
      }
      try {
        const blob = await readFileBlob(fileId);
        if (!blob) {
          notifyError("文件内容已丢失");
          return;
        }
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = file.name;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
      } catch {
        notifyError("打开文件失败");
      }
    },

    pushToast: (toast) => {
      const id = newId();
      const duration = toast.duration ?? 3000;
      set((state) => ({
        toasts: [...state.toasts, { ...toast, id, duration }],
      }));
      if (duration > 0) {
        setTimeout(() => get().dismissToast(id), duration);
      }
      return id;
    },

    dismissToast: (id) => {
      const current = get().toasts.find((toast) => toast.id === id);
      if (current?.leaving) return;
      set((state) => ({
        toasts: state.toasts.map((toast) =>
          toast.id === id ? { ...toast, leaving: true } : toast,
        ),
      }));
      setTimeout(() => {
        set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
      }, 200);
    },

    notifyError,
  };
});
