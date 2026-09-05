# IMAGE-LIBRARY IMPLEMENTATION PLAN — AUX 图片生命周期可视化与交互面板

> 文档类型：**实施计划 / 任务分解（Execution Plan）**
> 配套设计：`IMAGE-LIBRARY-DESIGN.md`（技术方案/数据模型/UI 设计）
> 分支：`feat/aux-patch-diagnostics`
> 状态：**待执行**
> 最后更新：2026-09-03
>
> 本计划用于在后续多次上下文压缩/并行子代理执行期间，作为**任务编排单一事实源**。
> 执行者先读本文件 + 设计文档；按依赖顺序推进；只做计划内审核，不做无限循环审核。

---

## 0. 目标与原则

实现一个**纯插件层、零 DSH 补丁**的图片库面板：
- 独立侧边栏入口 + 浮层面板；
- 网格/详情、搜索（含 image-memory）、复选/反选/批量、分页/缩略图档位；
- 删除/孤儿回收/固化/会话跳转；
- 与 DSH 投影/事件体系耦合（`aux-image-library`）。

执行原则：
1. **先契约后并行**：服务端/客户端/类型之间的接口先定死，减少并行返工。
2. **文件隔离并行**：只有“新增独立文件”的任务才交给并行子代理；会触碰同一文件的合并瓶颈由主执行者串行处理。
3. **审核有上限**：每个 Gate 只做一轮固定 review + 一轮修复；不引入子代理互相 review 的循环。
4. **不过度工程**：不做通用资产框架、不做独立产物仓库、不做搜索索引；严格按设计文档范围。

---

## 1. 任务图（概览）

```text
Phase 0 契约与基线（主执行者串行）
   │
   ▼
Phase 1 服务端核心 ── 并行安全区
   ├─ 1A retention.js             (新增独立文件)
   ├─ 1B image-library.js         (新增独立文件)
   └─ 1C image-actions.js         (新增独立文件)
   │
   ▼ Gate R1：服务端 review + 单元测试
   │
Phase 2 命令 + 投影（合并瓶颈，主执行者串行）
   ├─ 2A commands.js 接 /aux image*
   ├─ 2B projection.js + events.js
   └─ 2C index.js 注册投影/发布时机
   │
   ▼ Gate R2：命令/投影测试
   │
Phase 3 客户端 UI（单文件瓶颈，建议 1 个子代理整体做或主执行者实现）
   ├─ 3A client.d.ts 类型（可提前并行）
   ├─ 3B client.js：sidebar 入口 + 面板 + 搜索/复选/详情/缩略图
   └─ 3C 设置页轻量概览卡
   │
   ▼ Gate R3：客户端 review（一次）
   │
Phase 4 集成验证（主执行者串行）
   ├─ 4A 真实数据接线
   ├─ 4B 全量测试 + 手动 smoke
   └─ 4C 性能/边界检查（图片多、孤儿多、大图）
   │
   ▼ Gate R4：最终验收
   │
Phase 5 文档与收尾（可并行子代理）
   ├─ 5A README/CHANGELOG/TESTING/PROJECT 同步
   ├─ 5B 设计/计划文档状态标记
   └─ 5C 提交本地分支（不推送）
```

---

## 2. Phase 0：契约与基线（串行，必须先做）

目标：把所有并行任务依赖的“接口形状”固定下来，避免返工。

任务：
- [ ] 0.1 确认分支 `feat/aux-patch-diagnostics` 工作树干净。
- [ ] 0.2 定义 **契约文件**（可以放在设计文档或 `dsh-aux/src/images/contract.js`）：
  - `ImageLibraryEntry` / `ImageLibrarySnapshot`（含 kind）
  - `ImageLibraryAction`：delete / delete-orphans / retain / unretain / gc
  - `/aux images --json` 请求参数：`filter`, `query`, `limit`, `offset`
  - `/aux image <action>` 参数与返回 JSON
  - `aux-image-library` 投影 key 与快照内容
- [ ] 0.3 定义 **retention API 签名**（供 1A/1B/1C 引用）：
  ```js
  imageRetentionPath()
  loadRetained(): Promise<Set<string>>
  saveRetained(set): Promise<void>
  setRetained(attachmentId, retained): Promise<Set<string>>
  ```
- [ ] 0.4 定义 **ownership/gc 复用边界**：1C 只调用已有导出，不修改 `ownership.js`/`gc.js` 内部逻辑；如需小改，必须列为单独任务并知会主执行者。
- [ ] 0.5 准备测试 fixture 工具（可选）：创建临时 DSH_HOME 并写入 `objects/`、`session-images.json`、`image-memory.json` 的 helper，供 1A/1B/1C 的测试复用。

产出：契约文件或文档更新 + fixture helper。
验收：并行子代理只依赖契约即可开工。

---

## 3. Phase 1：服务端核心（可并行）

> 并行安全：三个任务各自新增 `images/` 下不同文件，互不修改对方文件。
> 唯一依赖：1B 和 1C 都依赖 0.3 的 retention API 签名；1A 实现它。

### 1A — `dsh-aux/src/images/retention.js`（可并行）

内容：
- 实现 `imageRetentionPath()`：`<DSH_HOME>/attachments/v1/image-retention.json`
- 实现 `loadRetained()` / `saveRetained()` / `setRetained()`
- 原子写：`<path>.tmp` + rename；损坏隔离 `.corrupt-*`
- 文件格式：`{ version: 1, retained: string[] }`

验收：
- 单测覆盖：空文件、损坏文件隔离、并发 set 不丢、`{}` 兼容。

### 1B — `dsh-aux/src/images/image-library.js`（可并行）

内容：
- `collectImageLibrary(service)`：扫描 `objects/`，读取 `session-images.json` / `image-memory.json` / retention，返回 `ImageLibrarySnapshot`
- `deriveObjectPath(attachmentId)`、`scanObjectFiles(root)`、`deriveFileName(entry)`
- 安全：只扫真实目录/普通文件，拒绝符号链接（复用 gc.js 的安全模式）
- 字段：kind、attachmentId、hash、mediaType/bytes/mtime、ownerSessions、referenceCount、shared、orphan、retained、memories、readableBySessionId、fileName

验收：
- 单测覆盖：归属聚合、共享/孤儿判定、retained 标记、记忆关联、符号链接拒绝、缺文件容错。

### 1C — `dsh-aux/src/images/image-actions.js`（可并行）

内容：
- `deleteImage(service, attachmentId, { force })`
- `deleteOrphans(service, { includeRetained })`
- 安全规则：
  - 仍被 live/persisted session 引用时拒绝，除非 force；
  - force 时同步从 `session-images.json` ownership 中移除该 id（走 `ownership.js` 现有队列/保存，不手写并发写）；
  - 删除对象文件 + 扩展名硬链接，沿用 lstat 防符号链接校验；
  - 默认跳过 retained；孤儿回收可 `--include-retained`。
- 与 `retention.js` 交互：删除时若该图 retained，是否自动 unretain（建议：删除时清除 retained 记录）。

验收：
- 单测覆盖：被引用拒绝、force 删除、孤儿回收跳过/包含 retained、符号链接拒绝、删除后 ownership 同步。

### Phase 1 测试文件

建议新增独立测试文件：
- `tests/image-retention.test.js`（给 1A）
- `tests/image-library.test.js`（给 1B）
- `tests/image-actions.test.js`（给 1C）
这样三个子代理各自写测试互不冲突。

---

## 4. Gate R1：服务端审核（串行，只一轮）

主执行者检查：
- [ ] 三个文件不修改 DSH 核心 / 不碰 `bridge/`
- [ ] 接口与 Phase 0 契约一致
- [ ] 安全规则（符号链接、引用保护、原子写）符合设计
- [ ] 单测通过：`node --test tests/image-retention.test.js tests/image-library.test.js tests/image-actions.test.js`

若发现阻塞问题 → 一次修复；然后进入 Phase 2。**不安排子代理互审**。

---

## 5. Phase 2：命令 + 投影（串行，合并瓶颈）

原因：`commands.js`、`projection.js`、`index.js` 都是已有文件，多个并行改会冲突，因此由一个执行者/一个子代理串行完成。

任务：
- [ ] 2A `commands.js` 增加：
  - `/aux images`（文本概览）
  - `/aux images --json`（完整 JSON，支持 filter/query/limit/offset）
  - `/aux image delete <id> [--force]`
  - `/aux image gc-orphans [--include-retained]`
  - `/aux image retain <id>` / `/aux image unretain <id>`
- [ ] 2B `projection.js` + `events.js`：
  - 新增事件类型 `aux/image-library`
  - 新增投影 key `aux-image-library`，折叠最新快照
- [ ] 2C `index.js`：
  - 在 service start、图片操作后、设置变更后发布 `aux-image-library` 投影
  - 投影快照限制条数（例如前 200/500 条或裁剪字段），避免事件过大

验收：
- 命令 JSON 结构符合契约
- 投影可被 `sessions.binding(...).projections.faceOf('aux-image-library')` 读取
- 现有 `/aux status` 不受影响

---

## 6. Gate R2：命令/投影测试（串行，只一轮）

- [ ] 新增/更新命令测试（可交给一个测试子代理，但需要 2A/2B/2C 先落地）
- [ ] 投影测试：发布后可读
- [ ] 全量回归：`node --test tests/*.test.js`

若失败 → 一次修复 → 进入 Phase 3。

---

## 7. Phase 3：客户端 UI（单文件瓶颈，建议一个子代理整体做）

原因：客户端 bundle 在单个 `client.js` 文件内，无法安全并行编辑同一文件。
建议：
- **3A 类型声明** `client.d.ts` 可提前在 Phase 1 并行完成（只改类型文件，不与服务端冲突）。
- **3B/3C UI 主体** 由一个子代理完整实现，或主执行者亲自实现；避免多人改 `client.js`。

任务：
- [ ] 3A `client.d.ts`：
  - `ImageLibraryEntry` / `ImageLibrarySnapshot`
  - `ImageLibrarySelectionState` / `ImageLibraryViewPreferences`
- [ ] 3B `client.js`：
  - 注册 `sidebar.footer.action` 图库入口（参考 CordisPanel）
  - 图库浮层面板：网格/列表、搜索框、状态过滤、分页/虚拟滚动、缩略图档位
  - 复选/反选/全选/清空 + 批量操作栏
  - 详情抽屉：大图预览（readAttachment）、归属会话跳转、记忆显示、删除/固化按钮
  - 设置页轻量概览卡（可选）
- [ ] 3C 交互接线：
  - 调 `/aux images --json` 拉列表
  - 调 `/aux image ...` 执行写操作
  - 读 `aux-image-library` 投影做缓存/即时统计
  - `sessions.open(id)` 跳转

验收：
- 手动/视觉：侧边栏可打开图库、缩略图可显示、搜索/过滤/复选/批量/详情可用
- 代码 review：不把大图 base64 放进投影/命令，不触碰原生包

---

## 8. Gate R3：客户端 review（串行，只一轮）

- [ ] UI 行为符合设计文档 6.x
- [ ] 类型/注入正确，无运行时明显错误
- [ ] 孤儿图占位、readAttachment 失败降级
- [ ] 选择/批量操作有确认，危险操作有保护

若问题 → 一次修复 → 进入 Phase 4。

---

## 9. Phase 4：集成验证（串行）

- [ ] 4A 用真实 DSH_HOME 只读打开面板验证（不执行删除/GC，除非用户同意）
- [ ] 4B 全量测试 + README 同步检查
- [ ] 4C 边界检查：
  - 100+ 图片时网格/搜索/分页性能
  - 孤儿多、共享多、记忆多时状态统计正确
  - 大图缩略图内存/并发控制
- [ ] 4D 用 fake DSH_HOME 验证删除/固化/孤儿回收端到端（不碰真实数据）

---

## 10. Gate R4：最终验收（一次）

- [ ] 对照 `IMAGE-LIBRARY-DESIGN.md` 验收标准逐项勾选
- [ ] 全量测试通过
- [ ] 文档同步完成
- [ ] 提交本地分支（不推送）

---

## 11. Phase 5：文档与收尾（可并行）

可并行子代理：
- [ ] 5A 文档组：更新 README/README.en/CHANGELOG/TESTING/PROJECT/PROJECT.AI
- [ ] 5B 设计状态组：更新 IMAGE-LIBRARY-DESIGN.md 与 IMPLEMENTATION-PLAN 状态为“已实施/进行中”
- [ ] 5C 提交组：整理 commit message，本地提交

---

## 12. 并行子代理编排建议（省时）

### 第一批并行（Phase 0 完成后启动，2~3 个）
| 子代理 | 任务 | 产出文件 |
|---|---|---|
| SA1 | 1A retention.js + 测试 | `dsh-aux/src/images/retention.js`, `tests/image-retention.test.js` |
| SA2 | 1B image-library.js + 测试 | `dsh-aux/src/images/image-library.js`, `tests/image-library.test.js` |
| SA3 | 1C image-actions.js + 测试 | `dsh-aux/src/images/image-actions.js`, `tests/image-actions.test.js` |

### 第二批（Phase 1 合入后）
| 子代理 | 任务 | 说明 |
|---|---|---|
| SA4 | Phase 2 命令+投影（串行一人） | 涉及 commands/projection/index |
| SA5（可选） | 3A client.d.ts 类型 | 只改类型，可与 SA4 并行 |

### 第三批（Phase 2/3 接口稳定后）
| 子代理 | 任务 | 说明 |
|---|---|---|
| SA6 | Phase 3 客户端 UI 整体 | 单文件，只能一个 agent |
| SA7（可并行） | 测试补充/命令测试 | 等待 SA4 接口后可并行 |

### 收尾批
| 子代理 | 任务 |
|---|---|
| SA8 | 文档同步 |
| SA9 | 全量回归 + 最终 commit（主执行者也可自己做） |

---

## 13. 避免过度工程化的规则

1. **每个 Gate 只一轮 review + 一轮修复**，不做多轮循环；
2. **不引入子代理互相 review**；
3. **不构建通用框架/抽象层**，除非真实需要；
4. **不新增超出设计文档的功能**（例如语义搜索、自动迁移、通用产物库）；
5. 若子代理报告需要“重构既有模块”才能继续，**先停下报告主执行者**，不要擅自扩大范围；
6. 测试覆盖“核心安全/聚合/命令”，不追求 100% UI snapshot。

---

## 14. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 客户端单文件导致 UI 并行困难 | 接受单 agent 实现；3A 类型并行；后续若需要可再讨论拆分 client bundle |
| 服务端三个新文件并行后接口漂移 | Phase 0 契约先行；Gate R1 统一检查 |
| 删除图片破坏会话回放 | 默认拒绝被引用删除；force 有确认；测试覆盖 |
| 投影快照过大 | 限条数/裁剪字段；完整列表走命令 |
| 子代理范围蔓延 | 见“避免过度工程化”规则 5 |

---

## 15. 下次开工清单（压缩后直接可用）

1. 读 `IMAGE-LIBRARY-DESIGN.md` + `IMAGE-LIBRARY-IMPLEMENTATION-PLAN.md`
2. 确认分支 `feat/aux-patch-diagnostics` 干净
3. 执行 Phase 0（契约 + fixture）
4. 启动第一批并行子代理（SA1/SA2/SA3）
5. 按 Gate R1 → Phase 2 → R2 → Phase 3 → R3 → Phase 4 → R4 → Phase 5 推进
6. 全程不推远端；完成后向用户报告
