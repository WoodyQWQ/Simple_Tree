# 图谱可编辑画布：布局优化 + 图内新增/拖拽/重连

## Context

当前图谱（`GraphView.tsx` + `graphLayout.ts`）是「只读投影」：由 `layoutTree()` 纯函数按环形布局（父居中、子均布四周）每次数据变化重算，交互只有平移/缩放/旋转/选中。

用户现在要求图谱变为**可编辑画布**：

1. 保持并优化「父节点居中、子节点均匀分布在四周」的环形布局，并优化连线样式。
2. 在图谱内直接新增节点。
3. 用鼠标拖动节点来**调整位置**，以及拖动节点到另一个节点上来**改变链接对象（父节点）**。

这与原 PRD 的「图谱只读、不图内编辑」（A-11 / Q-09）直接冲突，本次需求即覆盖该约束。

## 核心设计决策

### 位置持久化：独立存储 + 自动布局兜底

- 树领域模型 `TreeNode` 保持纯净（只含 `parentId` / `sortIndex` 等），**不加** x/y 字段，避免污染导入导出校验与领域语义。
- 新增独立的节点坐标存储（见下），记录**被手动移动过的节点**坐标。
- 渲染时坐标 = `overlayPositions(自动环形布局, 手动坐标)`：有手动坐标的节点用其坐标，其余节点沿用环形自动布局结果。
- 「父居中、子四周」由环形自动布局保证；手动拖动只覆盖被拖动的节点，其余仍自动环绕 → 结构变化时整体仍协调。

### 布局函数拆分

- `layoutTree(nodes)`：保留现有纯环形布局（父居中、子均布、半径按子树包围圆推导），作为初始/兜底/一键重排的坐标来源。**接口不变**，现有单测继续生效。
- 新增 `overlayPositions(layout, positions)`：以 layout 为基础，把 `positions` 里存在的节点坐标覆盖为手动坐标，返回新的 `GraphLayout`（重算 bounds）。

### 重连（拖到另一节点）语义

- 拖动节点命中另一非自身/非祖先后代节点时，松手 = `moveNode(id, targetId, null)`（复用现有 `node.move` 命令，进撤销栈），同时把该节点坐标更新为松手位置，视觉连续。
- 不支持拖到空白改父（保持为纯位置移动）；仅拖到另一节点上才重连。

### 撤销范围

- 结构改动（新增/重连/删除）沿用现有 node 命令 + undo 栈。
- **位置移动不进 undo**（视为视图层偏好），通过工具栏「自动布局」一键复原环形。

## 数据与存储改动

- `src/domain/types.ts`：新增 `export interface NodePosition { x: number; y: number }`。
- `src/db/database.ts`：`DB_VERSION` 2→3；`upgrade` 中新增 `graphPositions` store（`keyPath: "id"`，值 `{ id, x, y }`）；新增 `export const memoryPositions = new Map<string, NodePosition>()`；`SimpleTreeDB` schema 增加 `graphPositions`。
- 新增 `src/db/positionRepository.ts`：
  - `loadPositions(): Promise<Record<NodeId, NodePosition>>`
  - `savePosition(id, pos)` （memory 模式下写 `memoryPositions`）
  - `deletePositions(ids: NodeId[])`（删除节点时清理）
  - `clearPositions()`（导入/恢复/一键重排时清空）
- 导入/导出**不包含**坐标（`buildExport` / `validateImport` 不变）；导入、恢复备份后调用 `clearPositions()`，触发重新环形初始化。

## Store 改动（`src/store/treeStore.ts`）

- 状态新增 `positions: Record<NodeId, NodePosition> | null`（初始 null，init 时加载）。
- 新增 action：
  - `setPosition(id, pos)`：写入内存 `positions` 并 `savePosition` 持久化（节流/直接写）。
  - `resetPositions()`：清空内存与存储（对应「自动布局」按钮）。
  - `createNodeAt(input, pos)`：`createNode` 成功后 `setPosition(newId, pos)`（用于双击/按钮新建）。
- `refresh()`、`restoreBackup()`、`importNodes()` 成功后重载或清空 `positions`；`node.delete` 提交后在 `run()` 内清理被删 `collectSubtreeIds` 的坐标（调用 `deletePositions`，并同步内存）。
- 坐标变更不进入 `undoStack` / `redoStack`。

## 布局与连线（`src/domain/graphLayout.ts`）

- 新增 `overlayPositions(layout, positions)`，及复算 bounds 的小工具（复用现有 bounds 计算逻辑，可抽出 `computeBounds(nodes)`）。
- 连线优化：在 `GraphView` 中把当前 `moveTo/lineTo` 直线改为**带弧度的三次贝塞尔曲线**（父子连线，控制点沿连线中点法向偏移，弯曲方向背离父中心，强化「环绕」观感），并在子节点端加小圆点或箭头；高亮路径配色不变。边界端点计算复用 `edgeEndpoints`。

## 交互改造（`src/features/graph/GraphView.tsx`）

扩展 `drag` ref 状态机，新增 `node` 拖动模式：

- `onPointerDown`：命中节点 → `mode="node"`，记录 `{ id, hasMoved }`。
- `onPointerMove`（node 模式）：
  - 节点中心跟随 `toLayout(point)`，实时更新本地 positions 预览并 `requestDraw()`（不立即持久化）。
  - `hitTest` 检测当前悬停的候选父节点（排除自身及 `isSelfOrDescendant`），高亮候选。
- `onPointerUp`（node 模式）：
  - 若悬停在候选节点 → `moveNode(id, 候选id, null)` 重连，并把该节点坐标持久化为松手位置。
  - 否则 → 仅持久化坐标（`setPosition`）。
  - `hasMoved` 为 false 时仍走原「点击选中」逻辑。
- 新增节点：
  - 双击空白（`hitTest` 为 null）→ `createNodeAt({ parentId: null, title }, 双击点坐标)`（标题走现有快速录入或弹一个标题输入）。
  - 工具栏新增「添加节点」按钮：有选中则在选中节点下、否则顶层，位置放选中节点附近或画布中心。
- 工具栏新增「自动布局」按钮 → `resetPositions()` 并重新 `fitViewport`。
- 图内提示文案更新（说明拖动节点=移动、拖到另一节点=重连、双击空白=新建、Alt=旋转）。

标题输入：复用现有快速录入 `QuickAddPanel` 较复杂，P0 采用轻量方案——双击/按钮后在目标位置弹出一个内联标题输入（可复用 `InlineTitleEditor` 或弹 `window.prompt` 式的小对话框）。实现时优先复用 `QuickAddPanel` 的关联能力，若无缝则退化为内联标题输入。

## 涉及文件汇总

- `src/domain/types.ts` — `NodePosition`
- `src/db/database.ts` — store + 版本 + memoryPositions
- `src/db/positionRepository.ts` — 新增
- `src/store/treeStore.ts` — positions 状态与 action
- `src/domain/graphLayout.ts` — `overlayPositions`、bounds 抽取
- `src/features/graph/GraphView.tsx` — 拖拽状态机、新增/重连/自动布局、连线曲线

## 验证

1. `npm test`：现有 24 例仍通过（`layoutTree` 接口未变）；新增 `overlayPositions` 用例（覆盖坐标与 bounds、缺省沿用环形）。
2. `npm run build`：TS 严格模式 + 构建通过。
3. 浏览器（Chrome DevTools MCP，`http://127.0.0.1:5183/`）实测：
   - 刷新后默认图谱，父居中、子四周环形分布。
   - 双击空白新建顶层节点并出现在点击处。
   - 拖动节点自由移动，刷新后位置还在（IndexedDB 持久化）。
   - 拖动节点到另一节点上松手 → 父子关系改变，大纲与进度同步，可撤销。
   - 连线呈现曲线、箭头指向子节点。
   - 「自动布局」一键复原环形；导入/恢复备份后坐标被清空重排。
   - 控制台无 error/warn。