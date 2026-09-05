# A2 — 本地补丁台账(Patch Ledger)

> 目的:把对官方包的所有本地修改摆到明面——**位置 / 为何 / 无它会怎样 /
> 上游状态与维护路径**。这是"始终耦合 DSH"健康度最重的台账。
> 依据:仓库 `bridge/` 脚本 + `bridge/*.txt` 原/补丁块 + 运行中
> `<DSH>/node_modules/@deepseek-ai/*` 实况(2026-08-19 核对,均处于已应用)。
>
> ⚠️ **上游总定调(2026-08-19 决策)**:DSH 官方闭源、不开放 PR →
> **所有补丁都是永久维护债**。运营纪律为「**版本检测 + 动态打补丁 + 跟随 DSH
> 更新 + 保持向后兼容**」(细则见 `05-synthesis.md` §维护债治理与蓝图 §2.3)。
> `UPSTREAM-PR.md` 仅作"若官方未来开口"的方案存档,**非可执行计划**。
> 状态含义:`远期可能开口`(仅存档,不构成可期上游)/ `官方已 deferred`。

## 总表

| # | 目标(包 + 文件) | 缝/方法 | 补丁内容 | 无它会怎样 | 上游状态 |
|---|---|---|---|---|---|
| P1 | `dsh-host-apiproxy` `lib/index.js` | `admit()` | v2:v1→v2 升级;image block 原样保留进 user/message(UI 缩略图)+ 为附件补带扩展名硬链接 | 纯文本主模型粘贴图片报 `MODEL_DOES_NOT_SUPPORT_IMAGES`;或 v1 时代只显示文本不显示图 | `远期可能开口`(源自官方 discussion #733) |
| P2 | `dsh-agent-loop` `lib/index.js` | `buildRequest()` | 新增 `bridgeImagesForModel`:模型输入边界处,按 `inputModalities` 是否含 image 决定原样传图(多模态)或改写为 `vision_analyze` 路径文本(纯文本/未声明);`forceAuxVision` 开启时多模态也改写 | 纯文本主模型无法看图;v1 改写落在消息持久化层导致 UI 无缩略图 | `远期可能开口` |
| P3 | `dsh-host-apiproxy` `lib/index.js` | `selectModel()` | v3:移除"含图会话必须选声明 image 能力的模型"门控(允许多模态→纯文本切换,交给 P2 桥接) | 含图会话无法切到纯文本模型 | `远期可能开口` |
| P4 | `dsh-tool-subagent` `lib/index.js` | schema | `subagent` 工具 schema 增加可选参数 `requires_vision`(`auto/true/false`) | 子代理无法声明"任务需要视觉"以选择视觉模型 | `远期可能开口` |
| P5 | `dsh-tool-subagent` `lib/index.js` | request(`execute`) | executed 时读 `ctx.get("auxLlm").subagentRoute()` 注入 `agentOptions` / `toolFilter`(native/manual/vision-aware);`prepareTools` 兜底注入 AUX 工具 | 子代理无从走 AUX 辅助模型路由 | `远期可能开口` |
| P6 | `dsh-workflow-worker-thread` `lib/index.js` | `startChild()` | workflow `agent()` 启动子代理时按 `subagentIncludeWorkflow` + `subagentRoute()` 路由;显式 `{provider,model}` 优先 | workflow 并发扇出的子代理不走 AUX | `远期可能开口` |
| P7 | `dsh-session` `lib/index.js` | `append()` | `opts[1].ignorable===true` → 信封写入 `ignorable:true` | 无法给 out-of-repo 自定义事件打 ignorable 标记 → 持久化读链拒绝整个日志 | `远期可能开口`(UPSTREAM-PR.md PR1 存档;信封字段已预留) |
| P8 | `dsh-session` `lib/types/known-event-types.js` + `lib/index.js` 内嵌目录 | 读白名单 | 把 `aux/llm-call`(另 `thinking/language` 等)加进 `KNOWN_SESSION_EVENT_TYPES` | ⚠️ 无它其实**不是必须**:有 P7 的 ignorable 信封,读链对未知+ignorable 事件是"跳过校验"而非拒绝;白名单只是让当前 build 把 `aux/llm-call` 当一等公民。**停维护只以"旧版 DSH 事实绝迹"为判据(蓝图 §2.3),不由"官方原生支持"决定** | `官方已 deferred`(注册面 deferred) |
| P9 | `dsh-settings` `lib/index.js` | `register()`/`list()`/section hooks | 注册时记录 `exposedToWeb`,新增 `listExposed()`;hooks 透传 | Web 设置页无法发现自己 pub 的 settings section | `rc.7 原生取代`(rc.7 跳过,见 rc.7 适配结论;rc.6 保留) |
| P10 | `dsh-host-apiproxy` `lib/index.js` | `WEB_SETTINGS_NAMESPACES` | `exposedNamespaces()` 合并 `settings.listExposed()` 动态结果(白名单保持平台原始内容),含 v1→v2 升级 | Web 设置页 `settings.describe/mutate` 拒绝 aux 命名空间(只能命令行改) | `rc.7 原生取代`(rc.7 白名单已删、动态暴露,见 rc.7 适配结论;rc.6 保留) |
| P11 | `dsh-tool-skill` `lib/index.js` | schema | `skill` 工具 schema/description 增加可选 `task` 参数,供 dsh-aux 技能预审桥接读取主模型意图(不传时用会话上下文隐式推断) | 主模型无法显式告诉辅助模型「为什么调这个 skill」;混合上下文只能靠隐式 | `远期可能开口`(官方工具 schema 扩展点) |

## 关键观察(喂 A5)

1. **四类补丁**:桥接驻留型(P1-P6、P11)、溯源契约束(P7-P8)、设置暴露(P9-P10)。
   **没有一处可指望官方合入**——全部按「版本检测+动态补丁+跟随 DSH+向后兼容」
   长期维护。
2. **补丁的承受面**:都是 `lib/index.js` 的代码块级替换,`npm update`/重装 DSH 后
   全部丢失,需重跑 `install.sh`(幂等,校验不匹配则跳过不破坏)。运行中已全部在应用态。
3. **版本检测 + 动态补丁(核心管理机制)**:`install.sh`/`bridge` 先探测 DSH 版本与
   各目标包的 `detect` 锚点——凡目标**缺能力/属旧版**才应用对应补丁,新版(原生
   已有该行为)自动跳过。**"官方原生支持"不等于"停补丁"**:只要仍需兼容没有该
   行为的旧版 DSH,补丁就得保留(靠版本检测只对旧版生效)。
4. **退役(停维护)判据**:只有当一个落后版本**事实性绝迹**(大量 DSH 用户不会再
   使用不支持该行为的旧版本)时,才可摘除/停维护对应补丁。退役由"没人用了"决定,
   不由"官方支持了"决定。
5. **维护程序**(DSH 版本升级时):逐项核对 P1-P11 的 `detect` 锚点(匹配不中会
   跳过不破坏)→ 重跑 `install.sh`(按版本矩阵动态决策)→ 全量测试(285 基线)→
   `/aux status` 逐项确认状态 → 对受支持旧版 DSH 跑兼容性检查。
6. **其它插件维护债**:所有补丁目标都是 `@deepseek-ai` **官方 DSH 包**,没有针对
   第三方插件的补丁。唯一跨插件耦合是 P8 白名单 `orig-session-whitelist.txt` 的
   锚点含 `thinking/language` / `reasoning-chunks`(dsh-thinking-zh 等插件事件名);
   但 `self-heal.mjs` 的 P8 已改为**只插 `aux/llm-call`、不依赖其它插件事件名**,
   所以实际维护面仍收敛在 DSH 官方对象上。

## rc.7 适配结论(2026-08-19,实测 rc.7 tarball)

依据:registry `next` tag `0.1.0-rc.7` 逐包下载解包,对其 `lib/index.js` 跑本台账
锚点 + 原生特性比对(见 `05-synthesis.md` U14)。本地环境仍 rc.6;此守卫先行就绪。

| # | rc.7 锚点/原生 | rc.7 还需要吗 | 结论 |
|---|---|---|---|
| P1-P3 image-bridge | 锚点完整(`MODEL_DOES_NOT_SUPPORT_IMAGES` 等仍在) | ✅ 需要(无原生等价) | rc.7 保留,照常打 |
| P4-P5 subagent | 锚点完整;无原生 requires_vision/subagentRoute | ✅ 需要 | rc.7 保留 |
| P6 workflow | `this.subagents.start` 锚点完整 | ✅ 需要 | rc.7 保留 |
| P7 session ignorable | append 写路径与 rc.6 **相同,仍未原生支持 ignorerable 写入口** | ✅ 需要 | rc.7 保留 |
| P8 白名单 | rc.7 `known-event-types.js` 仍无 `aux/*` | ✅ 需要(配 P7) | rc.7 保留 |
| P9 settings 动态暴露 | rc.7 无 `exposedToWeb/listExposed`(原生 API 不存在) | ❌ **不再需要** | rc.7 **跳过**(版本守卫);rc.6 保留 |
| P10 allowlist | **`WEB_SETTINGS_NAMESPACES` 已删除**,host-api 直接 `settings.describe()` 动态暴露所有已注册 ns | ❌ **由官方原生取代** | rc.7 **跳过**(feature-detect);rc.6 保留 |
| P11 skill schema | rc.7 `dsh-tool-skill` 仍为 `parameters: { name: {` 原始形态,无 `task` | ✅ 需要(无原生等价) | rc.7 保留 |

配套结论:
- **插件本体 rc.7 兼容**:rc.7 `dsh-settings` 仍导出 `settingsNamespace` / `installSettingsSection`(我们 import 的官方 API)→ src 无需改。
- **skill 格式**:rc.7 `dsh-skill-filesystem` 仍用 kebab canonical(`user-invocable`/`disable-model-invocation`)→ 已定稿 `.agents/skills/*/SKILL.md` 有效,无需动。
- **命令准入**:rc.7 client `matchEnter` 语义不变(编译形变 `desc.input !== void 0`,判定同 rc.6)→ `input.hint` 契约不变。
- **守卫已实现**:`bridge/target.js` 新增 `readPackageVersion`/`isRc7OrNewer`;
  `patch-settings-allowlist.mjs` 以 `WEB_SETTINGS_NAMESPACES` 缺失为 feature-detect
  跳过;`patch-settings-dynamic-expose.mjs` 以版本守卫跳过。rc.6 上两脚本保持
  "已补丁/跳过"(已验证);rc.7 上自动优雅跳过(已验证逻辑)。
- **真实升级动作**(2026-08-19 已执行,见下):重跑补丁 → 全量测试 → `/aux status`
  逐项 → 旧版(rc.6)兼容检查。

## rc.7 实装补丁修复(2026-08-19 升级落地时暴露并修复)

1. **install.sh 包名校验正则 bug**:`@[A-Za-z0-9_-]+/...` 中 bash 的 `+` 是字面量,
   对 `@dolorescaritasangelus/dsh-aux` 永远不匹配 → install.sh 实际从未跑通过。
   已修为 `@[A-Za-z0-9_-][A-Za-z0-9_-]*/...`(两段至少一字符)。
2. **agent-loop patched 块缺 mark**:`patched-agent-loop-block.txt` 注释写
   `image-bridge v2+v3 (local patch)`,而 `applyOne` 校验的 mark 是
   `image-bridge v2 (local patch)` → 升级重打必"替换失败回滚"。已把首行改为恰好
   含 mark,并在次行注明 v3 特性。
3. **apply-patch 单步态缺陷**:`applyOne` 每次只应用一个状态就返回,干净重打会卡在
   `original→half→v3` 的中间态;且 skip 分支直接 return 导致**已应用的改动未写盘**。
   已改为循环推进到最终态、skip 时先写盘再返回(幂等一键到 v3)。
4. **P7 只打 append 块**:`patch-session-ignorable.mjs` 的白名单 orig 块
   (`thinking/language→reasoning-chunks`)在 rc.7 已不存在(目录里没有
   reasoning-chunks),整跑会因"块不匹配"失败、连 append 也不打。已由
   `bridge/self-heal.mjs` 改为外科式只打 append(P7),白名单用幂等插入只保证
   `aux/llm-call`(不负责其它插件事件)。
5. **启动自愈**:新增 `bridge/self-heal.mjs`(symlink → P1-P6 → P7 → P8 →
   P9/P10 rc 守卫),接入 `~/dsh/start-dsh.sh`;npm 升级后重启即自愈,不再重演
   2026-08-19 事故(symlink 被清 / 补丁丢失 / 白名单回归)。

## rc.7 接口应用决策(2026-08-19)

- **设置动态暴露 / 插件设置卡片 → 采用 rc.7 原生,rc.6 保留补丁**:
  rc.7 host-api 用 `settings.describe()` 动态暴露所有已注册 namespace(白名单常量
  已删)。已 live 验证:rc.7 上 `settings.describe` 返回 14 个 namespace,**含 aux**,
  插件设置页原生可读写。因此 P9/P10 在 rc.7 不打(版本守卫/feature-detect),rc.6
  继续补丁;插件代码无需改动(仍用官方 `installSettingsSection` + `settings.replace`)。
- **子代理 Job Panel 字段(`job/jobId/jobs`)→ 不采用**:rc.7 为 Codex/Claude 子代理
  任务接入 Job Panel 新增展示字段,与 AUX 的模型路由无关;引入只会增加新耦合。
  我们的 subagent 补丁锚点与 rc.7 兼容,不受影响。
- **其它 rc.7 变化(session 分页/max-token、MCP 图片附件、low 推理、Cordis 面板)→
  不采用/不需要**:不是 AUX 需要使用的接口。

## rc.8 适配预检(2026-08-20,基于 rc.8 tarball 静态核对 + 实机升级)

依据:`@deepseek-ai/*@0.1.0-rc.8` npm tarball 的 `lib/index.js` 与
`deepseek-harness` rc.7→rc.8 compare diff。**已实机升级**(2026-08-20 当前运行 rc.8)。

| # | rc.8 锚点/原生 | 还需要吗 | 结论 |
|---|---|---|---|
| P1-P3 image-bridge | `MODEL_DOES_NOT_SUPPORT_IMAGES` / `serializeImageAdmission` / selectModel 文案均在 | ✅ 需要 | rc.8 保留,锚点匹配 |
| P4-P5 subagent | `requires_vision` 无原生;`...config.agentOptions` 锚点完整 | ✅ 需要 | rc.8 保留 |
| P6 workflow | `this.subagents.start` 锚点完整 | ✅ 需要 | rc.8 保留 |
| P7 session ignorable | rc.8 append 仍未写 `ignorable`;`orig-session-append.txt` 与 rc.8 完全一致 | ✅ 需要 | rc.8 保留 |
| P8 白名单 | `known-event-types.js` 仍无 `aux/llm-call` | ✅ 需要(配 P7) | rc.8 保留 |
| P9/P10 settings | rc.8 仍无 `WEB_SETTINGS_NAMESPACES` / `exposedToWeb` / `listExposed`,动态暴露沿用 rc.7 | ❌ 不需要 | rc.8 **跳过**(与 rc.7 同守卫) |
| P11 skill schema | rc.8 `dsh-tool-skill` 仍为原始 `parameters: { name: {`,无 `task` | ✅ 需要 | rc.8 保留 |

rc.8 其它变化对 AUX 的影响:
- `ui-commands.matchEnter` 新增 `envelope`(图片提交拒绝策略),`desc.input !== undefined`
  判定不变 → `/aux` 的 `input.hint` 契约不受影响;我们命令不接受图片,无新行为。
- `agent-loop` 流中断时新增 `interruptedBlocks()` 收尾,现有 `BlockAssembler` API 不变。
- `host-apiproxy` 图片准入重构到 `dsh-attachment.admitEncodedImages`,但 `prompt` 路径
  与 P1 补丁作用点不变(仍在 `durablePromptContent` 返回后建硬链接)。
- `dsh-attachment` 新增 `maxImageDimension`;dsh-aux 只读 `maxImagesPerMessage` /
  `maxImageBytes` / `maxMessageImageBytes`,无破坏。
- LLM 默认重试 2→5、DeepSeek 目录可声明 `inputModalities`;对 dsh-aux 路由/能力门无破坏。
- subagent 内部(continuable childId、diagnostic 截断)有变化,但 P4/P5 补丁作用在
  `tool-subagent` request 组装,锚点未动。

结论:RC.8 升级不需要改 dsh-aux 源码或补丁块;已在临时部署用 rc.8 tarball
`apply-patch.mjs --dry-run` + 实打验证,P1-P8/P11 全部匹配并语法通过,P9/P10
按守卫跳过。**实机已升级到 rc.8**,启动自愈已重打 P1-P8/P11,`/aux status`
各 bridge 正常。

另:**`thinking/language` 白名单不属于 AUX**。它由 `dsh-thinking-zh` 插件负责;
该插件工作区已新增独立 `self-heal.mjs`(重建 symlink + 幂等补 `thinking/language`),
并接入 `start-dsh.sh`。相关改动不进入 AUX 本体 git。

## 0.1.1-rc.1 适配预检(2026-08-21,基于 GitHub tag diff + tarball dry-run)

依据:`deepseek-harness` `dsh-v0.1.0-rc.8` → `dsh-v0.1.1-rc.1` 源码 diff;
`@deepseek-ai/*@0.1.1-rc.1` npm tarball 临时部署 dry-run。

| # | 0.1.1-rc.1 锚点/原生 | 还需要吗 | 结论 |
|---|---|---|---|
| P1-P3 image-bridge | `MODEL_DOES_NOT_SUPPORT_IMAGES` / selectModel 文案仍在 | ✅ 需要 | 锚点匹配(dry-run 可从 original 升级) |
| P4-P5 subagent | `requires_vision` 无原生;`...config.agentOptions` 锚点仍在 | ✅ 需要 | 锚点匹配 |
| P6 workflow | `this.subagents.start` 锚点仍在 | ✅ 需要 | 锚点匹配 |
| P7 session ignorable | append 原块与 0.1.1-rc.1 完全一致 | ✅ 需要 | 匹配 |
| P8 白名单 | `KNOWN_SESSION_EVENT_TYPES = new Set([` 插入点仍在 | ✅ 需要(配 P7) | 匹配 |
| P9/P10 settings | rc.1 无 `WEB_SETTINGS_NAMESPACES`,原生动态暴露 | ❌ 不需要 | 跳过(需 `isRc7OrNewer` 识别 0.1.1-rc.1) |
| P11 skill schema | `dsh-tool-skill` 源码未变,`parameters: { name: {` 仍在 | ✅ 需要 | 锚点匹配 |

0.1.1-rc.1 其它变化对 AUX 的影响:
- **session-projection API 变更**:`register` 的 `schema/view` → `stateSchema/wire`,
  新增 `stateOf`;`snapshot()` 只返回带 `wire` 的单元。AUX `aux-status` 投影必须
  双 API 兼容(已实现 feature-detect)。
- `host-apiproxy` 内部投影注册已迁移到新 API;`session.create` 新增
  `reuseWorkspaceBlank`,AUX 不调用,无影响。
- `api/remotes` 事件 `credentials/updated` → `credentials/reference-updated`,
  AUX 不转发,无影响。
- `client/runtime`、`client/connection`、`api/gateway` 为内部重构,AUX 使用的
  `connection.api` 与 slots 表面未破坏。
- 补丁结论:0.1.1-rc.1 不需要改补丁块;需要改的是 AUX 源码(投影 API)、
  版本判定和 peerDependencies。

## 待决(写进 A5)

- 若官方最终提供"自定义事件注册面 + 轨迹过滤器"(事件溯源叙事),P7/P8 与
  `/aux history` 视图如何平滑迁移(见 `03-mechanism/*` 与 `04-glossary`)。

## 0.1.2-alpha.4/alpha.5/rc.1 适配预检(2026-09-04,基于 npm tarball + 临时安装实测)

依据:`@deepseek-ai/dsh-session` 等 0.1.2-alpha.3 → alpha.4/alpha.5/rc.1 npm tarball
逐包 diff;本机用 `scripts/install-dsh-version.mjs --version` 临时切换 alpha.2 /
alpha.3 / alpha.4 / rc.1 跑 `node --test tests/*.test.js` 与 `scripts/ci-fake-dsh.mjs`。

| # | alpha.4/5/rc.1 锚点/原生 | 还需要吗 | 结论 |
|---|---|---|---|
| P1-P6/P11 image/subagent/workflow/skill | 各 orig 锚点与 alpha.2/3 完全一致 | ✅ 需要 | 锚点匹配(ci-fake dry-run 可从 original 升级) |
| P7 session ignorable | append 内部从 `seq: this.log.length` 变为 `seq: SessionSeq(this.log.length)`;旧 orig 块不再命中 | ✅ 需要 | **需新增 alpha.4+ 原/补块**;本分支已加 `bridge/orig-session-append-alpha4-block.txt` + `patched-session-append-alpha4-block.txt` |
| P8 白名单 | `KNOWN_SESSION_EVENT_TYPES = new Set([` 插入点仍在 | ✅ 需要(配 P7) | 匹配 |
| P9/P10 settings | 0.1.2 线无旧 settings 补丁 | ❌ 不需要 | 已在 `bridge/retired/` |

### 0.1.2-alpha.4+ 其它变化对 AUX 的影响

- **Session API**:`Session#events` getter 移除,改为 `snapshotEvents()` / `eventAt()` /
  `ownEvents()`;`header.seedLength` 改为 `header.isSeeded` + `inheritedEventCount`。
  AUX host 原直接读 live `session.events` 的调用点全部需要迁移。
  本分支新增 `dsh-aux/src/session-utils.js` 的 `sessionEvents()` 双形态 helper,
  并把 bootstrap/history/debug/recentCalls/resolve/locate 迁移完成。
- **持久化/查询/投影**:`inspect()`/`SessionObservation`/projection 增加
  `inheritedEventCount` 字段;projection `init(header, inheritedEventCount)`。
  AUX 只读 `.events`、`init: () => ...`,不需要改。
- **子代理 report→send_message**:DSH 自带 `send_message` 改为双向 `agent_id`,
  `report` 工具移除。AUX 不注册/不调用 report,不直接依赖该变化;当前本机仍
  alpha.3,执行流程不依赖双向 send_message。
- **版本矩阵**:alpha.4/alpha.5/rc.1 在 AUX 相关包代码一致(alpha.5 与 rc.1 仅
  发布号差异/上游修复)。

### 兼容记录(未来切割旧版维护时使用)

- 本分支提交 `232202e` 是 0.1.2-rc.1 兼容适配的落点。
- 若未来抛弃 `0.1.2-alpha.2/alpha.3` 旧版维护,应:
  1. 删除/退役旧 append 块 `bridge/orig-session-append.txt` 与
     `bridge/patched-session-append.txt`,仅保留 alpha.4+ 块;
  2. 从 CI matrix 移除 `0.1.2-alpha.2` / `0.1.2-alpha.3`;
  3. 删除 `session-utils.js` 中对 `.events` fallback,只留 `snapshotEvents()`;
  4. 删除/标记旧 `.events` fake Session 测试;
  5. 在永久旧版分支上保留当时最后一次兼容版本,并复制 `bridge/` + 源码快照。
