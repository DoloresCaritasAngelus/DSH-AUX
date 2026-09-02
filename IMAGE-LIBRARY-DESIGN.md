# IMAGE-LIBRARY DESIGN — AUX 图片生命周期可视化与交互面板

> 文档状态：**正式设计（待评审后实施）**
> 分支：`feat/aux-patch-diagnostics`
> 作者：AUX maintainer / AI agent
> 最后更新：2026-09-03
>
> 本文件是后续多次上下文压缩/多轮执行期间的**单一事实源**。执行者请先完整阅读本文件，
> 尤其是「执行上下文」「数据流」「文件改动清单」「分阶段实施」「验收标准」章节。

---

## 0. 执行上下文（压缩后必读）

- 仓库根：`/home/ehekatl/dsh/dsh work/aux`
- 当前工作分支：`feat/aux-patch-diagnostics`（本地未推送）
- 当前 main 已完成的基线：
  - DSH 支持范围：`0.1.2-alpha.2` ~ `0.1.2-alpha.3`（只支持 alpha 线）
  - 补丁已瘦身，旧补丁在 `bridge/retired/`
  - 已有 `patchLedger`、`/aux patch` 部署根修复、`PROJECT.md` / `PROJECT.AI.md`
- 项目维护原则：
  1. **纯插件层优先**：不修改 DSH node_modules / 不加 DSH 核心补丁；
  2. 需要 DSH 能力时优先使用官方客户端服务/API（`ctx.sessions`、`remote.*`、投影、事件）；
  3. 涉及用户数据要谨慎：不移动/删除 DSH 原始对象库导致会话回放损坏；
  4. 所有新增功能要可测试、可观测、可回滚；
  5. 文档同步：根 README / CHANGELOG / TESTING / PROJECT 需同步。

本功能目标：**做一个纯插件层、不依赖 DSH 版本的图片生命周期可视化面板**，让用户能直观看到
“我的图片在哪里、被哪些会话使用、是否共享/孤儿、有什么分析记忆”，并能执行安全的管理交互。

---

## 1. 背景与问题

AUX 的图片生命周期管理（归属 `session-images.json` / GC / 记忆 `image-memory.json`）已经很强，
但用户只能通过 `/aux gc-images` 和 `/aux memory` 间接感知。用户缺少：

- 一张“图库/素材库”视图；
- 每张图的归属/共享/孤儿状态；
- 基于缩略图的视觉确认；
- 精确到单张的删除/固化/回收交互；
- 与 DSH 会话、事件溯源、投影体系打通后的“这张图是怎么来的/被谁用过/分析过什么”。

### 现有数据事实（已调研确认）

- 用户图片由 DSH 归一化后落在：
  ```
  <DSH_HOME>/attachments/v1/objects/<sha256前2位>/<sha256>
  ```
  同目录常有 `<sha256>.png/.jpg/.webp/.gif` 硬链接（AUX bridge 创建，用于读图/展示）。
- `attachmentId` 格式：`sha256:<64位hex>`；文件路径可推导为 `objects/<前2位>/<hash>`。
- AUX 拥有两个插件自有 JSON：
  - `session-images.json`：`{ sessionId: [attachmentId, ...] }`（隐式共享：同一 id 出现在多个 session）
  - `image-memory.json`：`{ entries: [{ sessionId, attachmentId, question, summary, at }] }`
- DSH 客户端官方能力：
  - `ctx.sessions.open(sessionId)`：跳转/激活会话
  - `binding(sessionId).session.readAttachment(attachmentId)`：读取被该 session 引用的图片 bytes
  - `binding(sessionId).session.eventSource.getSnapshot().entries`：读取会话事件
  - 投影：`sessions.binding(...).projections.faceOf(key)` 可读 AUX 自有投影
  - `ctx.remote.commands.execute(...)` 可执行 `/aux` 命令，但会产生会话命令痕迹（尽量少用）
- DSH 官方命令返回只有 text，不适合返回大图/base64。

### 非目标（明确不做）

- ❌ 不修改 DSH 核心 / node_modules / 不加 DSH 版本相关补丁。
- ❌ 不移动 DSH 原始对象库；不做“迁移图片存储路径”。
- ❌ 不做独立于 DSH 的“产物仓库/文件中心”（Hermes 式独立产物空间）。
- ❌ 不做用户自定义附件存储目录。
- ✅ 但“图片素材/产物心智模型”会作为 UI 设计语言。

---

## 2. 目标与用户价值

### 2.1 核心目标

1. 新增独立的“图片库”可视面板（默认从 DSH 侧边栏底部入口打开），不把完整图库塞进现有 AUX 设置页。
2. 展示每张图片：
   - 缩略图（能读时）
   - attachmentId / 文件名
   - 大小 / 时间
   - 归属会话列表（可跳转）
   - 引用计数 / 共享状态 / 孤儿状态
   - 相关记忆（question/summary，可搜索）
   - 固化状态
3. 交互：
   - 单张删除（安全）
   - 一键回收孤儿
   - 固化 / 取消固化
   - 会话跳转
   - 记忆搜索/过滤
4. 自动清理天数可配置（设置项），替代手写 `/aux gc-images 30`。

### 2.2 用户故事

- 作为用户，我想看到我发过的所有图片，不用猜文件名。
- 我想知道某张图被哪些会话引用，避免误删。
- 我想把某张不再需要的图单独删掉，而不是等 30 天。
- 我想把某张重要图片“固化”，不被自动清理。
- 我想从图片直接跳到引用它的会话。
- 我想看这张图当时问了什么、AUX 分析出什么。

---

## 3. 总体架构

```text
┌────────────────────────────────────────────────────────────┐
│ DSH Host 侧（AUX 服务端 / 插件层）                            │
│                                                            │
│  [现有] ownership.js / gc.js / memory.js                    │
│  [新增] image-library.js  —— 只读聚合 + 操作                 │
│  [新增] aux-image-library 投影发布器                          │
│  [新增] /aux images [--json] 等命令（备用/文本入口）            │
│  [新增] settings schema: imageRetentionDays / retained       │
└────────────────────────────────────────────────────────────┘
                        │ 投影 / 事件（不产生命令卡片）
                        ▼
┌────────────────────────────────────────────────────────────┐
│ DSH Web Client 侧（AUX settings UI）                         │
│                                                            │
│  [新增] “图片管理” tab/分组                                  │
│   - 读取 aux-image-library 投影                              │
│   - 通过 sessions.binding(id).session.readAttachment 读图   │
│   - 通过 sessions.open(id) 跳转会话语境                      │
│   - 调用 AUX host 命令执行删除/固化/GC（低频操作）             │
└────────────────────────────────────────────────────────────┘
```

### 关键设计决策（ADR）

- **ADR-1**：列表数据用 **AUX 自有投影** 推送，不在每次打开面板时执行 `/aux` 命令。
  理由：避免会话命令卡片污染；与 `aux-platform` 一致；支持快照/缓存。
- **ADR-2**：缩略图用官方 `readAttachment`，不把图片 bytes 放入命令/投影。
  理由：命令/投影文本通道不适合大二进制；readAttachment 是官方授权通道。
- **ADR-3**：删除/固化等写操作走 `/aux image ...` 命令（低频、用户主动触发），
  可以接受产生一条会话命令记录；也可考虑后续增加专用 remote 方法。
- **ADR-4**：不移动/删除 DSH 原始对象；删除只针对 AUX 认为“不再被任何活跃/持久会话引用”的孤儿，
  或用户显式确认的单张图片（需同时处理 ownership 引用）。
- **ADR-5**：固化数据放在 AUX 自有文件（建议 `image-retention.json` 或并入 `image-memory.json`），
  不碰 DSH 数据。GC 读取该标记跳过固化图。

---

## 4. 数据模型

### 4.1 新增/扩展的插件自有 JSON

#### `image-retention.json`（新增，建议）

```json
{
  "version": 1,
  "retained": [
    "sha256:xxxx..."
  ]
}
```

- 只存被用户“固化”的 attachmentId。
- 固化图不受自动清理（retention days）影响。
- 手动删除仍可删除；会话删除后如不再被引用，是否自动解除固化？设计：**固化不阻止会话删除后的孤儿判定，
  但如果用户显式固化，默认保留文件直到用户手动删除/取消固化**（避免用户以为固化了却被 GC）。需要明确定义。

> 补充：孤儿回收命令应跳过 retained 图，除非用户选择“同时删除固化图”。

#### `session-images.json`（沿用）

- 所有权/引用来源，不改结构。

#### `image-memory.json`（沿用）

- 记忆来源，不改结构。

### 4.2 settings schema 新增

```ts
aux.imageRetentionDays?: number   // 默认 30
aux.imageAutoCleanEnabled?: boolean // 默认 false？由产品决定
```

- 目前 GC 是手动命令；若要“自动清理”，需要 AUX 增加定时任务。**建议 Phase 3 再做自动清理，
  Phase 2 先支持设置天数并让 `/aux gc-images` 读取该配置。**

### 4.3 图片条目（Image Library Entry）——投影片段

```ts
interface ImageLibraryEntry {
  kind: 'image' | string;      // 预留扩展：当前仅 'image'，未来可表示网页快照/压缩产物等
  attachmentId: string;        // sha256:xxx
  hash: string;                // xxx
  mediaType?: string;          // 来自扩展名/ref，可能缺失
  bytes?: number;              // 文件大小
  mtimeMs?: number;
  // 归属
  ownerSessions: string[];
  ownerLiveSessions: string[]; // 仍存活的会话（可跳转）
  referenceCount: number;      // ownerSessions.length
  shared: boolean;             // referenceCount > 1
  orphan: boolean;             // ownerSessions.length === 0
  retained: boolean;
  // 记忆
  memories: Array<{ sessionId, question, summary, at }>;
  firstSeenAt?: number;
  lastSeenAt?: number;
  // 可读性
  readableBySessionId?: string; // 某个可读附件 owner session，用于 readAttachment
  fileName?: string;            // 从硬链接推导 <hash>.png 等
}

interface ImageLibrarySnapshot {
  generatedAt: number;
  settings: {
    imageRetentionDays: number;
    imageAutoCleanEnabled: boolean;
  };
  counts: {
    total: number;
    orphan: number;
    shared: number;
    retained: number;
    withMemory: number;
  };
  entries: ImageLibraryEntry[];
}
```

---

## 5. 服务端设计（Host 侧）

### 5.1 只读聚合模块 `dsh-aux/src/images/image-library.js`（新增）

职责：
- 扫描 `objects/` 下的真实文件（拒绝符号链接，沿用 gc.js 安全模式）。
- 读取 `session-images.json`、`image-memory.json`、`image-retention.json`。
- 计算每个 attachment 的归属/共享/孤儿/记忆/时间。
- 生成 `ImageLibrarySnapshot`。

主要函数：
```js
export async function collectImageLibrary(service) // 返回 ImageLibrarySnapshot
export async function collectImageLibraryEntry(service, attachmentId)
export function deriveObjectPath(attachmentId)      // sha256: -> objects/<2>/<hash>
export function scanObjectFiles(root)               // 安全扫描
```

依赖：
- `ownership.js`: `loadSessionImages`, `liveSessionIds`, `sessionImagesPath`
- `memory.js`: `imageMemoryPath`
- 新 `retention.js`（见下）

### 5.2 固化存储模块 `dsh-aux/src/images/retention.js`（新增）

```js
export function imageRetentionPath()
export async function loadRetained()
export async function setRetained(attachmentId, retained: boolean)
export function isRetained(retainedSet, attachmentId)
```

- 原子写：`<path>.tmp` + rename
- 损坏处理：参考 image-memory 的隔离策略
- 文件仅 AUX 自有

### 5.3 操作函数

放 `dsh-aux/src/images/image-library.js` 或 `image-actions.js`：

```js
export async function deleteImage(service, attachmentId, { force?: boolean })
export async function deleteOrphans(service)
export async function setRetained(attachmentId, retained)
export async function reconcileReferences(service, attachmentId)
```

安全规则：
- `deleteImage`：
  - 若 attachment 仍被任何活跃/持久 session 引用，**拒绝**，除非 `force:true` 且用户确认；
  - force 删除时需同时从所有 session ownership 中移除该 id，并落盘；
  - 删除对象文件及同目录扩展名硬链接；
  - 保留 image-memory 记录（历史），但可标记 deleted。
- `deleteOrphans`：
  - 只删除 ownerSessions 为空 且 未 retained 的文件；可选 `--include-retained`。
- 删除前沿用 gc.js 的 lstat/非符号链接安全校验。

### 5.4 投影发布（关键）

新增投影 key：`aux-image-library`（`AUX_IMAGE_LIBRARY_KEY`）。

- 在 service 启动、设置变更、图片生命周期事件后，调用 `publishImageLibrary(service)` 将快照写入隐藏 ignorable 会话事件 `aux/image-library`。
- 投影定义参考现有 `aux-platform`（`projection.js`），reuse `AUX_PLATFORM_SCHEMA` style record schema。
- 由于快照可能较大（图片多），**需要分页或限制条目**：投影只存摘要 + 最近 N 张（如 500），完整列表可通过 `/aux images --json` 获取或增加分页命令。ADR-6：投影用于概览/缓存，列表用于完整数据。

### 5.5 命令接口

新增 `/aux image` 子命令（或 `/aux images`）：

```text
/aux images                     # 人类可读文本概览/列表（可选）
/aux images --json              # 完整 JSON（可带 limit/offset/query）
/aux image delete <id> [--force]
/aux image gc-orphans [--include-retained]
/aux image retain <id>          # 固化
/aux image unretain <id>        # 取消固化
```

说明：`/aux images --json` 作为 fallback/调试入口；设置页首选投影。

---

## 6. 客户端设计（Web UI）

### 6.0 UI 布局决策：不做“设置页内大杂烩”

AUX 设置页已经承载工具任务/桥接/子代理/全局/平台开关/诊断，再把完整图片库塞进去会显著臃肿。
图片库是**高频浏览型资产视图**，不是低频配置页。因此采用：

> **独立图库浮层面板（Library Panel）+ 侧边栏入口 + 设置页内仅保留一个轻量配置入口/统计卡。**

### 6.1 入口设计

推荐主入口：**`sidebar.footer.action`（侧边栏底部操作区）**
- 在设置按钮旁新增“图库”图标按钮（wide/rail 两种形态参考 CordisPanel）。
- 点击后从侧边栏展开一个**浮层面板**（CSS fixed/popover，类似 CordisPanel 的 `position:fixed` 面板），
  不离开当前会话/不跳页。
- 这是 DSH 官方支持的扩展点，AUX 的 client 包可以注册多个 slot，因此不需要任何补丁。

辅助入口（可选）：
- 设置页内加一张“图片管理”**概览卡**（显示数量统计 + “打开图库”按钮），
  让用户在设置语境里也能发现该功能，但不把整个列表搬进设置页。
- 会话头部 `conversation.session.header.actions` 可放一个“本会话图片”按钮（Phase 2+），
  针对当前会话过滤图库。

### 6.1.1 已验证的 DSH UI 扩展点

- `sidebar.footer.action`：侧边栏底部操作区（设置旁），官方示例 `client-ui-cordis CordisPanel` 注册于此并自绘浮层面板。
- `conversation.session.header.actions`：会话标题旁操作区，可放“本会话图片”（Phase 2+）。
- `conversation.chat.turnTail`：官方 `client-ui-deliverables` 在此展示每轮“产物文件”，可作为单轮图片/文件入口的参考，但不是我们的主入口。
- AUX 当前 client 已注册 `settings.section` 与 `conversation.input.left`；新增 `sidebar.footer.action` 是同类机制，无需 DSH 补丁。

> 实现时需在 client bundle 中新增一个 `sidebar.footer.action` 注入，并复用现有 `sessions` / `runAuxCommand` 注入面。

### 6.2 图库面板布局（精心的信息架构）

```text
┌───────────────────────────────────────────────────────────────┐
│ 侧边栏 footer: [设置] [图库🖼] (wide)  /  [⚙] [🖼] (rail)      │
└───────────────────────────────────────────────────────────────┘

点击图库按钮后弹出面板（宽 640~720px，高度 70~80vh，可滚动）：

┌──────────────────────────────────────────────────────────────┐
│ 图库                    🔍 搜索记忆/文件名      [刷新] [⋮]      │
│ 共 128 张 · 共享 12 · 孤儿 8 · 已固化 5 · 有记忆 43            │
│                                                              │
│ 过滤器: [全部] [仅共享] [仅孤儿] [仅已固化] [仅有记忆] [仅本会话] │
│                                                              │
│ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐             │
│ │ 缩略图   │ │ 缩略图   │ │ 缩略图   │ │ 缩略图   │             │
│ │ 3会话 共享│ │ 孤儿     │ │ 1会话   │ │ 固化⭐   │             │
│ │ 📝有记忆  │ │         │ │ 📝有记忆 │ │ 2会话 共享│             │
│ └─────────┘ └─────────┘ └─────────┘ └─────────┘             │
│                                                              │
│ 网格视图（默认） / 列表视图（可切换）                           │
│ 虚拟滚动/分页：每屏约 20-40 张，滚动加载                          │
└──────────────────────────────────────────────────────────────┘

点击卡片 → 右侧/下方详情抽屉（Detail Drawer）：

┌──────────────────────────────────────────────────────────────┐
│ ← 返回图库                                    [🗑 删除] [固化]  │
│ ┌────────────────────┐                                      │
│ │    大图预览         │   归属会话:                            │
│ │  (readAttachment)  │   session-xxx… [跳转]                 │
│ └────────────────────┘   session-yyy… [跳转]                 │
│ 文件名: sha256….png                                         │
│ 大小: 1.2MB · 上传: 2026-09-02 10:11                        │
│ 状态: 共享 · 引用 2 · 已固化 ⭐                              │
│ 记忆:                                                       │
│   Q: 这张图里是什么?                                        │
│   A: 图表显示……                                            │
│   Q: 再分析一次 …                                          │
└──────────────────────────────────────────────────────────────┘
```

### 6.2.1 复选 / 反选 / 批量操作

图库面板支持**多选管理**，与“点卡片看详情”互不冲突：

- 每张卡片：
  - 单击卡片 → 打开详情；
  - 卡片右上角复选框 / 长按（触屏）/ 键盘 Space → 加入选区；
- 顶部出现批量操作栏（选中 ≥1 时）：
  - `已选 N 张`
  - `全选当前结果` / `反选当前结果` / `清空`
  - 批量操作：`删除`、`固化`、`取消固化`、`回收孤儿`（仅当选区含孤儿）
- 选择语义：
  - **全选 / 反选** 默认作用于“当前过滤 + 当前页/当前结果集”（视分页模式而定）；
  - 切换搜索/过滤时保留已有选区，但批量栏提示“选区包含过滤外 N 项”，避免误删看不见的图片；
  - 批量删除前二次确认，并展示“其中 X 张仍被会话引用，将跳过（除非勾选强制）”；
  - 批量回收孤儿前提示将删除的文件数量与释放空间。

### 6.2.2 搜索设计

搜索框位于面板标题区，提供实时过滤：

- 默认：一个关键词跨字段匹配
  - 文件名 / attachmentId（`hash`、`sha256:...`、`xxx.png`）
  - 记忆 `question` / `summary`
  - 归属会话 ID / 会话标题（若可得）
- 可选高级限定（后续再开放，避免首版复杂）：
  - `id:xxxx` / `session:xxxx` / `q:关键词`
- 与状态过滤器关系：
  - 过滤器 chips（共享/孤儿/固化/有记忆/本会话）与搜索词为 **AND**；
  - 搜索只缩小当前 chip 范围。
- 记忆命中反馈（低成本、高价值）：
  - 搜索词命中 `image-memory.json` 的 `question`/`summary` 时，卡片显示“记忆命中”角标；
  - 详情中高亮命中的记忆片段；
  - 空结果提示“试试搜索图片分析时的问题/描述”，引导用户利用记忆搜索。
- 交互：
  - 输入即过滤（防抖 ~200ms）；
  - 空结果显示空态 + “清除搜索/清除过滤”按钮；
  - 命中记忆关键词时，卡片仍显示图片，详情里高亮匹配的记忆片段。

### 6.2.3 视图偏好：单页数量 / 缩略图显示大小

“每页多少张”和“缩略图多大”都是**显示偏好**，不改变原图，不改数据：

- 单页数量：
  - 默认 `虚拟滚动/无限加载`（每屏按视口加载）；
  - 可选 `分页模式`：每页 24 / 48 / 96，带上一页/下一页/页码；
- 缩略图显示大小：
  - 提供三档或滑杆：`小（96px）/ 中（160px）/ 大（240px）`；
  - 只改变 CSS grid 密度；实际原图/大图预览仍由 `readAttachment` 提供；
- 持久化：
  - 视图偏好存 **localStorage**（浏览器本地记忆）；
  - 不进入 AUX settings schema，避免设置页膨胀；若未来要跨设备同步再提升为 settings 字段。

### 6.3 信息架构原则

1. **网格优先**：图片是视觉对象，默认大缩略图网格；
2. **状态可视化**：每张卡片用角标/底色表达 `共享/孤儿/固化/有记忆`，不依赖用户点开详情；
3. **渐进披露**：概览 → 网格 → 点开详情 → 操作；不在一个屏幕塞所有控件；
4. **当前会话语境**：若从会话头部进入，面板自动过滤“本会话图片”，并提供“查看全部图库”切换；
5. **轻量配置仍在设置页**：`imageRetentionDays`、自动清理开关等配置项留在 AUX 设置页（属于低频配置），
   图库面板只做浏览/搜索/管理。

### 6.4 数据读取

- 面板打开时：
  - 读 `aux-image-library` 投影（已缓存概览 + 最近条目）即时显示；
  - 如需完整列表/过滤，调用 `/aux images --json`（带 limit/offset/filter）补充。
- 缩略图：
  - 对 `entry.readableBySessionId` 的条目，用 `sessions.binding(sid).session.readAttachment(attachmentId)` 获取 bytes → `URL.createObjectURL` / data URL；
  - 做 LRU 缓存与并发限制，只加载可视区缩略图（IntersectionObserver）；
  - 孤儿/不可读条目显示占位图标。
- 搜索记忆/文件名：客户端过滤投影/JSON 中的 `memories` 与 `fileName`。

### 6.5 交互调用

- 删除/固化/回收 → 调用 `runAuxCommand('/aux image ...')`，执行后刷新投影；
- 跳转 → `sessions.open(sessionId)`，并关闭/收起图库面板（让用户落到会话）；
- 删除/固化后乐观更新本地列表，失败回滚提示。

### 6.6 组件结构（建议）

```text
dsh-aux/src/client.js (或拆成 client/image-library.js)
├─ ImageLibraryPanel        // 浮层容器（由 sidebar.footer.action 打开）
│  ├─ ImageLibraryHeader    // 标题/搜索/刷新/设置入口
│  ├─ ImageLibraryFilters   // 状态过滤 chips
│  ├─ ImageSelectionBar    // 已选 N / 全选 / 反选 / 批量操作
│  ├─ ImageGrid             // 虚拟滚动或分页网格
│  │  └─ ImageCard          // 缩略图 + 状态角标 + 复选框
│  ├─ ImagePager           // 分页控件/加载更多（可选）
│  └─ ImageDetailDrawer     // 详情/操作
├─ useViewPreferences      // localStorage: 每页数量/缩略图档位
├─ useImageSelection       // 当前选区/全选/反选/清空
├─ useImageLibrarySnapshot  // 读 aux-image-library 投影
└─ useAttachmentThumbnail   // 通过 readAttachment 加载缩略图 + 缓存
```

### 6.7 类型声明

更新 `dsh-aux/src/client.d.ts`：
- `ImageLibraryEntry`
- `ImageLibrarySnapshot`
- `ImageLibrarySelectionState`（selectedIds / lastActionedFilter）
- `ImageLibraryViewPreferences`（pageSize / thumbnailSize / paginationMode）
- 图库面板 props 需要 `sessions` / `runAuxCommand`（设置页组件已有类似注入，可抽公共 hook）。

### 6.8 未来扩展性：从“图片库”到“资产库”（只预留，不过度设计）

当前只做图片生命周期管理。但 AUX 已有 `web_extract` / `web_crawl` / `compress_text`，
未来也可能新增工具并产生可管理的“产物/文件”。为避免届时推翻重构，**仅预留**：

1. **数据模型**：`ImageLibraryEntry` 已含 `kind` 字段，现在恒为 `'image'`；
   未来新增资源类型时，可扩展 `kind` 与可选来源字段，不破坏现有消费方。
2. **服务端聚合**：`image-library.js` 命名与函数以“library entry”为主，不叫死 `attachmentId`；
   后续可增加 `collectLibrarySources()` 或按 kind 分派，但暂不实现。
3. **投影/命令**：投影与 `/aux images` 命令保持“通用列表”语义，不把图片专属字段写死到不可扩展；
   当前仍只输出图片。
4. **UI**：过滤器和分组在概念上按 `kind` 设计，但现在只渲染 `kind === 'image'`；
   搜索/批量操作逻辑天然与资源类型解耦（搜索名称/记忆/归属）。
5. **明确不做**：不建通用插件注册表、不做 artifact schema、不做 web_extract 落盘迁移、
   不把 web/compress 产物纳入当前图库——等真实需求出现再扩展。

---
## 7. 与 DSH 溯源/轨迹/投影的耦合

### 7.1 事件溯源（Trace）

- 每次 AUX 视觉分析已有 `aux/llm-call` 事件（含 task/inputChars 等）。
- 图片管理需要的“哪次分析/哪个 question/summary”目前主要来自 `image-memory.json`；
  但它已经足够支撑面板，不强制改事件。
- 可选增强：在 `image-memory.json` 写入时同步记录事件 seq 或 message seq，让 UI 能深链到具体消息。
  - 需要调研事件 seq 如何从 service 获取；若复杂，可在 Phase 2 不做。

### 7.2 投影（Projection）

- 新增 `aux-image-library` 投影，与 `aux-platform` 并列。
- 图库面板与设置页概览卡都通过投影读取概览，避免命令卡片。
- 投影内容包含：生成时间、统计、条目（限制数量/可裁剪字段）。
- 完整列表用 `/aux images --json` 分页补充。

### 7.3 轨迹（Trajectory）

- 图片卡片可以展示生命周期徽标：
  - `created`（出现于对象库）
  - `analyzed`（有 image-memory）
  - `referenced-by-session`
  - `shared`
  - `orphan`
  - `retained`
  - `deleted`
- 这些状态可完全由 `session-images.json` + `image-memory.json` + retention 推导，不需要 DSH 核心补丁。

### 7.4 会话跳转

- 使用官方 `sessions.open(sessionId)`；图库面板通过 client 注入的 `sessions` 服务调用。

---

## 8. 分阶段实施

### Phase 1 — 只读图片库（核心）

交付：
1. 新增 `retention.js`（load/save/原子写），但先不接 UI。
2. 新增 `image-library.js`：扫描对象、聚合 `session-images.json` + `image-memory.json` + retention，生成快照。
3. 新增 `/aux images --json` 与 `/aux image delete/gc-orphans/retain/unretain`（先做 delete/gc-orphans 服务端函数）。
4. 新增 `aux-image-library` 投影与发布。
5. 新增图库浮层面板（只读）：显示缩略图（readAttachment）、归属、共享/孤儿、记忆摘要、固化标记；设置页仅加入口概览卡。
6. 测试：image-library 聚合、retention、命令 JSON、投影。

### Phase 2 — 交互

1. 单张删除（安全确认 + force）
2. 一键回收孤儿
3. 会话跳转
4. 固化/取消固化 UI
5. 记忆搜索 UI
6. 刷新/乐观更新

### Phase 3 — 策略与配置

1. settings schema 增加 `imageRetentionDays` / `imageAutoCleanEnabled`
2. `/aux gc-images` 读取配置默认天数
3. 自动清理定时器（如启用）
4. 清理时跳过 retained
5. README/CHANGELOG/TESTING/PROJECT 同步

### Phase 0（已完成的调研）

- 附件存储、readAttachment、sessions.open、投影机制均已确认可行。

---

## 9. 文件改动清单（预估）

```text
dsh-aux/src/config.js                       # 增加 IMAGE_LIBRARY_KEY / settings schema 字段
dsh-aux/src/images/retention.js             # 新增
dsh-aux/src/images/image-library.js         # 新增
dsh-aux/src/images/gc.js                    # 读取 retention/配置（Phase 3）
dsh-aux/src/images/ownership.js             # 可能暴露 helper（删除引用）
dsh-aux/src/commands.js                     # 新增 /aux image* 命令
dsh-aux/src/projection.js                   # 新增 aux-image-library 投影定义
dsh-aux/src/index.js                        # 注册投影、发布时机、settings hooks
dsh-aux/src/status.js                       # 可并入 image 状态或保持独立
dsh-aux/src/client.d.ts                     # 类型
dsh-aux/src/client.js                       # UI 组件（可拆 client/image-library.js）
dsh-aux/src/events.js                       # 可选新事件类型（aux/image-library）
tests/*.test.js                             # 新增测试
README.md / README.en.md / CHANGELOG.md / TESTING.md / PROJECT*.md
```

---

## 10. 测试策略

- 单元：retention 原子写/损坏隔离；image-library 聚合（构造临时 DSH_HOME，放 objects/JSON）；
  delete/gc-orphans 安全规则（引用拒绝、孤儿删除、硬链接删除、符号链接拒绝）。
- 命令：`/aux images --json` 返回结构；`/aux image delete` 行为。
- 投影：发布后 `aux-image-library` 投影可读。
- UI：现有测试不覆盖 React 渲染，但类型/接口通过；可选做 snapshot 或留待手动验证。
- 全量基线需更新。

---

## 11. 风险与开放问题

| 风险/问题 | 影响 | 缓解 |
|---|---|---|
| 图片库很大时投影/JSON 过大 | 性能 | 投影限制条数/字段；JSON 支持分页/过滤 |
| readAttachment 对孤儿不可用 | 孤儿无缩略图 | 显示元数据/占位；后续可考虑 host 读图通道 |
| 删除图片可能破坏历史会话回放 | 高风险 | 默认拒绝删除仍被引用的图；force 需明确确认；删除同时清理 ownership |
| “固化”语义需清晰 | 产品歧义 | 文档明确：固化跳过自动清理，但手动删除/会话删除的孤儿回收需定义 |
| 会话跳转在 settings 弹层内可能切换当前会话 | UX | 先尝试 `sessions.open`；若弹层不关闭，再考虑通过 workspace 打开 |
| `/aux image delete` 产生命令卡片 | 可接受 | 写操作低频；只读走投影 |
| DSH 未来版本 API 变化 | 维护 | 尽量只依赖 alpha.2/alpha.3 已确认 API；若 readAttachment/投影变化，集中隔离在 adapter |

---

## 12. 验收标准（Definition of Done）

- [ ] 侧边栏“图库”入口可打开独立面板，可看到真实图片缩略图/元数据/归属/共享/孤儿/记忆；设置页提供轻量入口卡而非完整列表。
- [ ] 从图片可跳转到引用会话（若 API 允许）。
- [ ] 可对单张执行安全删除；被引用图会被拒绝或要求 force 确认。
- [ ] 可一键回收孤儿；retained 图默认被跳过。
- [ ] 可固化/取消固化；固化图不被自动清理（若自动清理已实现）。
- [ ] `imageRetentionDays` 可配置，并影响 GC。
- [ ] 所有服务端能力有测试；全量测试通过。
- [ ] README/CHANGELOG/TESTING/PROJECT 已同步。
- [ ] 不修改 DSH node_modules / 不引入新 DSH 补丁。

---

## 13. 后续执行提示（给压缩后的 agent）

1. 先看本文件 + `dsh-aux/src/images/ownership.js` / `memory.js` / `gc.js` / `projection.js` / `client.js`。
2. 从 Phase 1 开始，小步提交；每步跑 `node --test tests/*.test.js`。
3. 使用真实 DSH_HOME 时可只读不写；测试用临时 `DSH_HOME`。
4. 如需确认 API，查 `/home/ehekatl/dsh/node_modules/@deepseek-ai/*/lib/types/**/*.d.ts`。
5. 不要改动 `bridge/`（除非补丁相关）；不要推送到远端，等用户指示。
