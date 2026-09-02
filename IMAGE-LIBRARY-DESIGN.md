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

1. 在 AUX 设置页新增“图片管理”可视区域（建议作为独立 tab 或分组）。
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

### 6.1 入口

在 AUX settings page 增加新 tab/分组 `imageLibrary`，与现有 `tools/bridges/subagent/global/platform` 并列。
建议使用设置页现有 `group()` 可折叠卡片，或实现 tab 切换（如果 DSH settings section 支持 tab）。

### 6.2 UI 布局

```
[图片管理]  [工具任务] [桥接任务] [子代理] [全局] [平台开关] ...
┌──────────────────────────────────────────────┐
│ 图片库  (刷新按钮 / 搜索框 / 过滤器)           │
│ 统计: 共 N · 共享 X · 孤儿 Y · 已固化 Z        │
│ ┌──────┐ ┌──────┐ ┌──────┐                  │
│ │缩略图 │ │缩略图 │ │缩略图 │ ...              │
│ │会话数 │ │孤儿  │ │共享  │                  │
│ └──────┘ └──────┘ └──────┘                  │
│ 点击卡片 → 详情：                             │
│   - 大图预览（readAttachment）                │
│   - 归属会话列表 + [跳转]                     │
│   - 引用数/共享/孤儿/固化 badge               │
│   - 记忆列表（question/summary/at）可搜索      │
│   - 操作：删除 / 固化/取消固化                │
└──────────────────────────────────────────────┘
```

### 6.3 数据读取

- 组件 mount 后：
  - 读 `aux-image-library` 投影（已缓存概览）
  - 如需完整列表，调用 `/aux images --json`（低频）
- 缩略图：
  - 对 `entry.readableBySessionId` 的条目，用 `sessions.binding(sid).session.readAttachment(attachmentId)` 获取 bytes → `URL.createObjectURL` / data URL
  - 需要批量时做 LRU/缓存，限制并发
  - 孤儿/不可读条目显示占位图标

### 6.4 交互调用

- 删除/固化/回收 → 调用 `runAuxCommand('/aux image ...')`，执行后刷新投影
- 跳转 → `sessions.open(sessionId)`
- 搜索记忆 → 客户端过滤投影/JSON 中的 memories

### 6.5 类型声明

更新 `dsh-aux/src/client.d.ts`：
- `ImageLibraryEntry`
- `ImageLibrarySnapshot`
- `AuxSettingsPageProps` 中增加 imageLibrary 相关可选注入（如 sessions 已有）

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
- 客户端设置页通过投影读取概览，避免命令卡片。
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

- 使用官方 `sessions.open(sessionId)`；设置页已具备 `sessions` 服务注入。

---

## 8. 分阶段实施

### Phase 1 — 只读图片库（核心）

交付：
1. 新增 `retention.js`（load/save/原子写），但先不接 UI。
2. 新增 `image-library.js`：扫描对象、聚合 `session-images.json` + `image-memory.json` + retention，生成快照。
3. 新增 `/aux images --json` 与 `/aux image delete/gc-orphans/retain/unretain`（先做 delete/gc-orphans 服务端函数）。
4. 新增 `aux-image-library` 投影与发布。
5. 设置页新增“图片管理”只读列表：显示缩略图（readAttachment）、归属、共享/孤儿、记忆摘要、固化标记。
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
dsh-aux/src/client.js                       # UI 组件
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

- [ ] 设置页出现“图片管理”，可看到真实图片缩略图/元数据/归属/共享/孤儿/记忆。
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
