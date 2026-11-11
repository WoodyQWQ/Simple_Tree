import { describe, expect, it } from "vitest";
import type { NodeId, TreeNode } from "./types";
import {
  ancestorsOf,
  flattenVisible,
  indexChildren,
  isSelfOrDescendant,
  nextSiblingId,
  orderWithInsert,
  pathLabel,
} from "./tree";
import { computeLeafStats, isCompleted, overallProgress } from "./stats";
import { applyPatch, planCommand } from "./commands";
import { validateImport, validateTitle, MAX_TITLE } from "./validation";
import { searchNodes } from "./search";
import { computeVisibility, isFilterActive } from "./filter";
import { associationCandidates, parseAiResponse } from "./association";
import { fitViewport, hitTest, layoutTree, overlayPositions, toLayout, toScreen } from "./graphLayout";
import { FILTERS_NONE } from "./types";

function makeNode(
  id: NodeId,
  parentId: NodeId | null,
  title: string,
  sortIndex: number,
  extra: Partial<TreeNode> = {},
): TreeNode {
  return {
    id,
    parentId,
    title,
    note: "",
    priority: 0,
    dueDate: null,
    sortIndex,
    completedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

function tree(): Map<NodeId, TreeNode> {
  return new Map(
    [
      makeNode("a", null, "工作", 1024),
      makeNode("b", "a", "第四季度", 1024),
      makeNode("c", "b", "撰写周报", 1024, { completedAt: "2026-01-02T00:00:00.000Z" }),
      makeNode("d", "b", "复盘会议", 2048, { priority: 2, dueDate: "2026-01-03" }),
      makeNode("e", null, "生活", 2048),
      makeNode("f", "e", "体检预约", 1024),
    ].map((node) => [node.id, node]),
  );
}

describe("tree", () => {
  it("builds paths and ancestors", () => {
    const nodes = tree();
    expect(pathLabel("c", nodes)).toBe("工作 / 第四季度 / 撰写周报");
    expect(ancestorsOf("c", nodes)).toEqual(["a", "b"]);
  });

  it("flattens only expanded visible rows", () => {
    const nodes = tree();
    const childrenOf = indexChildren(nodes.values());
    const rows = flattenVisible(childrenOf, new Set(["a"]), null);
    expect(rows.map((row) => row.node.id)).toEqual(["a", "b", "e"]);
    expect(rows.map((row) => row.depth)).toEqual([0, 1, 0]);
  });

  it("detects self and descendant targets", () => {
    const nodes = tree();
    const parentOf = new Map([...nodes.values()].map((n) => [n.id, n.parentId]));
    expect(isSelfOrDescendant("b", "a", parentOf)).toBe(true);
    expect(isSelfOrDescendant("a", "b", parentOf)).toBe(false);
    expect(isSelfOrDescendant(null, "a", parentOf)).toBe(false);
  });

  it("keeps order when dropping after itself", () => {
    const nodes = tree();
    const siblings = indexChildren(nodes.values()).get("b")!;
    expect(orderWithInsert(siblings, "c", "c")).toBe(siblings);
    expect(orderWithInsert(siblings, "c", "d").map((n) => n.id)).toEqual(["c", "d"]);
    expect(nextSiblingId(nodes.get("c")!, indexChildren(nodes.values()))).toBe("d");
  });
});

describe("stats", () => {
  it("derives container completion from leaves", () => {
    const nodes = tree();
    const childrenOf = indexChildren(nodes.values());
    const stats = computeLeafStats(nodes, childrenOf);
    expect(stats.get("b")).toEqual({ done: 1, total: 2 });
    expect(stats.get("a")).toEqual({ done: 1, total: 2 });
    expect(isCompleted(nodes.get("a")!, childrenOf, stats)).toBe(false);
    expect(overallProgress(stats, childrenOf)).toEqual({ done: 1, total: 3 });
  });
});

describe("commands", () => {
  it("creates a child under the target and appends", () => {
    const nodes = tree();
    const plan = planCommand(nodes, {
      type: "node.create",
      parentId: "b",
      title: "  新事项  ",
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const created = plan.patch.after.get(plan.selectId!)!;
    expect(created.parentId).toBe("b");
    expect(created.title).toBe("新事项");
    expect(created.sortIndex).toBeGreaterThan(2048);
  });

  it("turns a completed leaf into a container", () => {
    const nodes = new Map([["a", makeNode("a", null, "已完成", 1024, { completedAt: "2026-01-02T00:00:00.000Z" })]]);
    const plan = planCommand(nodes, { type: "node.create", parentId: "a", title: "子项" });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.patch.after.get("a")!.completedAt).toBeNull();
  });

  it("rejects a move into its own subtree", () => {
    const nodes = tree();
    const plan = planCommand(nodes, {
      type: "node.move",
      id: "a",
      newParentId: "b",
      beforeId: null,
    });
    expect(plan.ok).toBe(false);
  });

  it("rejects a create when the parent disappeared", () => {
    const nodes = tree();
    const plan = planCommand(nodes, { type: "node.create", parentId: "missing", title: "x" });
    expect(plan.ok).toBe(false);
  });

  it("reorders siblings and writes new indexes", () => {
    const nodes = tree();
    const plan = planCommand(nodes, {
      type: "node.move",
      id: "d",
      newParentId: "b",
      beforeId: "c",
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.patch.after.get("d")!.sortIndex).toBe(1024);
    expect(plan.patch.after.get("c")!.sortIndex).toBe(2048);
  });

  it("assigns the moved node a new index in its destination", () => {
    const nodes = new Map(
      [
        makeNode("p", null, "甲", 1024),
        makeNode("x", "p", "X", 1024),
        makeNode("y", "p", "Y", 2048),
        makeNode("q", null, "乙", 2048),
        makeNode("a", "q", "A", 1024),
        makeNode("b", "q", "B", 2048),
      ].map((node) => [node.id, node]),
    );
    const plan = planCommand(nodes, {
      type: "node.move",
      id: "y",
      newParentId: "q",
      beforeId: "a",
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const moved = plan.patch.after.get("y")!;
    expect(moved.parentId).toBe("q");
    expect(moved.sortIndex).toBe(1024);
    expect(plan.patch.after.get("a")!.sortIndex).toBe(2048);
    expect(plan.patch.after.get("b")!.sortIndex).toBe(3072);
  });

  it("deletes a whole subtree and reverts with the same data", () => {
    const nodes = tree();
    const before = JSON.stringify([...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)));
    const plan = planCommand(nodes, { type: "node.delete", id: "a" });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.patch.after.size).toBe(4);
    const after = applyPatch(
      Object.fromEntries(nodes),
      plan.patch,
    );
    expect(Object.keys(after)).toEqual(["e", "f"]);
    const restored = applyPatch(after, plan.patch, true);
    expect(JSON.stringify(Object.values(restored).sort((a, b) => a.id.localeCompare(b.id)))).toBe(before);
  });

  it("completes a subtree with one timestamp", () => {
    const nodes = tree();
    const plan = planCommand(nodes, { type: "subtree.complete", id: "a", completed: true });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const times = [...plan.patch.after.values()].map((node) => node!.completedAt);
    expect(new Set(times).size).toBe(1);
    expect([...plan.patch.after.keys()].sort()).toEqual(["c", "d"]);
  });
});

describe("validation", () => {
  it("validates titles", () => {
    expect(validateTitle("   ").ok).toBe(false);
    expect(validateTitle("  hello \n world ")).toEqual({ ok: true, value: "hello   world" });
    expect(validateTitle("x".repeat(MAX_TITLE + 1)).ok).toBe(false);
  });

  it("accepts a valid export and normalizes container completion", () => {
    const nodes = tree();
    const raw = {
      app: "simple-tree",
      schemaVersion: 1,
      exportedAt: "2026-01-02T00:00:00.000Z",
      nodes: [...nodes.values()].map((node) =>
        node.id === "a" ? { ...node, completedAt: "2026-01-02T00:00:00.000Z" } : node,
      ),
    };
    const result = validateImport(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.nodes.find((node) => node.id === "a")!.completedAt).toBeNull();
  });

  it("rejects cycles and newer schema versions", () => {
    const bad = {
      app: "simple-tree",
      schemaVersion: 1,
      nodes: [
        makeNode("a", "b", "甲", 1024),
        makeNode("b", "a", "乙", 1024),
      ],
    };
    expect(validateImport(bad).ok).toBe(false);
    expect(
      validateImport({ app: "simple-tree", schemaVersion: 9, nodes: [] }).ok,
    ).toBe(false);
  });
});

describe("search and filter", () => {
  it("ranks exact matches first", () => {
    const nodes = tree();
    const results = searchNodes(nodes, "复盘");
    expect(results[0].node.id).toBe("d");
    expect(results[0].path).toBe("工作 / 第四季度 / 复盘会议");
  });

  it("keeps matched nodes plus ancestors", () => {
    const nodes = tree();
    const childrenOf = indexChildren(nodes.values());
    const stats = computeLeafStats(nodes, childrenOf);
    const filters = { ...FILTERS_NONE, status: "active" as const };
    expect(isFilterActive(filters)).toBe(true);
    const { visible, matches } = computeVisibility(nodes, childrenOf, stats, filters);
    expect([...matches].sort()).toEqual(["a", "b", "d", "e", "f"]);
    expect(visible?.has("b")).toBe(true);
  });
});

describe("association", () => {
  it("returns scored candidates and drops ids outside the whitelist", () => {
    const nodes = tree();
    const candidates = associationCandidates(nodes, "周报");
    expect(candidates[0].node.id).toBe("c");
    const suggestions = parseAiResponse(
      JSON.stringify({
        suggestions: [
          { nodeId: "out-of-list", reason: "不存在" },
          { nodeId: "b", reason: "季度事项" },
          { nodeId: "c", reason: "直接相关" },
        ],
      }),
      candidates,
      nodes,
    );
    expect(suggestions.map((s) => s.nodeId)).toEqual(["b", "c"]);
  });
});

describe("graph layout", () => {
  const centerOf = (node: { x: number; y: number; width: number; height: number }) => ({
    x: node.x + node.width / 2,
    y: node.y + node.height / 2,
  });

  it("lays out every node once with parent edges", () => {
    const nodes = tree();
    const layout = layoutTree(nodes);
    expect(layout.nodes).toHaveLength(6);
    expect(layout.edges).toHaveLength(4);
    expect(new Set(layout.nodes.map((n) => n.id)).size).toBe(6);
  });

  it("places leaf children evenly on a circle around the parent", () => {
    const nodes = tree();
    const layout = layoutTree(nodes);
    const parent = layout.byId.get("b")!;
    const parentCenter = centerOf(parent);
    const leaves = ["c", "d"].map((id) => centerOf(layout.byId.get(id)!));
    const radius = Math.hypot(leaves[0].x - parentCenter.x, leaves[0].y - parentCenter.y);
    const radiusOther = Math.hypot(
      leaves[1].x - parentCenter.x,
      leaves[1].y - parentCenter.y,
    );
    expect(radiusOther).toBeCloseTo(radius);
    expect(radius).toBeGreaterThan(parent.width);
  });

  it("spreads all leaf children into one even circle", () => {
    const nodes = new Map<NodeId, TreeNode>([["p", makeNode("p", null, "项目", 1024)]]);
    for (let index = 0; index < 6; index += 1) {
      nodes.set(`k${index}`, makeNode(`k${index}`, "p", `事项${index}`, (index + 1) * 1024));
    }
    const layout = layoutTree(nodes);
    const parent = centerOf(layout.byId.get("p")!);
    const points = [...Array(6).keys()].map((index) =>
      centerOf(layout.byId.get(`k${index}`)!),
    );
    const radii = points.map((point) => Math.hypot(point.x - parent.x, point.y - parent.y));
    for (const radius of radii) expect(radius).toBeCloseTo(radii[0]);
    const chords = points.map((point, index) => {
      const next = points[(index + 1) % points.length];
      return Math.hypot(next.x - point.x, next.y - point.y);
    });
    for (const chord of chords) expect(chord).toBeCloseTo(chords[0]);
  });

  it("round-trips screen and layout coordinates, and hits nodes", () => {
    const nodes = tree();
    const layout = layoutTree(nodes);
    const viewport = { tx: 40, ty: 200, scale: 1.2 };
    const point = { x: 30, y: 20 };
    const back = toLayout(toScreen(point, viewport), viewport);
    expect(back.x).toBeCloseTo(point.x);
    expect(back.y).toBeCloseTo(point.y);
    const node = layout.nodes[0];
    const center = toScreen(
      { x: node.x + node.width / 2, y: node.y + node.height / 2 },
      viewport,
    );
    expect(hitTest(layout, viewport, center)?.id).toBe(node.id);
  });

  it("fits the tree inside the canvas", () => {
    const nodes = tree();
    const layout = layoutTree(nodes);
    const vp = fitViewport(layout, 800, 600);
    expect(vp.scale).toBeGreaterThan(0.1);
    const corners = toScreen({ x: layout.bounds.minX, y: layout.bounds.minY }, vp);
    expect(corners.x).toBeGreaterThanOrEqual(0);
    expect(corners.y).toBeGreaterThanOrEqual(0);
  });

  it("overlays manual positions as node centers and falls back to ring layout", () => {
    const nodes = tree();
    const base = layoutTree(nodes);
    const b = base.byId.get("b")!;
    const overlaid = overlayPositions(base, { b: { x: 300, y: 200 } });
    const moved = overlaid.byId.get("b")!;
    expect(moved.x).toBeCloseTo(300 - moved.width / 2);
    expect(moved.y).toBeCloseTo(200 - moved.height / 2);
    // 未覆盖的节点保持环形布局坐标不变。
    const c = overlaid.byId.get("c")!;
    const baseC = base.byId.get("c")!;
    expect(c.x).toBe(baseC.x);
    expect(c.y).toBe(baseC.y);
    // bounds 随覆盖后的坐标重算。
    expect(overlaid.bounds.minX).toBeLessThanOrEqual(moved.x);
    expect(overlaid.bounds.maxX).toBeGreaterThanOrEqual(moved.x + moved.width);
  });

  it("overlays no-op when positions is empty", () => {
    const nodes = tree();
    const base = layoutTree(nodes);
    const overlaid = overlayPositions(base, {});
    expect(overlaid.nodes.map((n) => `${n.x},${n.y}`)).toEqual(
      base.nodes.map((n) => `${n.x},${n.y}`),
    );
  });
});
