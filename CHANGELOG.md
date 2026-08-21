# Changelog

## Unreleased — 平台化开关 + SKILL 模式

- **工具/桥接三态开关**:`native` / `aux` / `compat`(compat 预留);关闭时工具从模型目录隐藏,桥接走原生;补丁不受开关影响。
- **SKILL 模式**:`native` / `audit` / `report` / `report-ondemand`;`report-ondemand` 支持 `includeOriginal` 取原文;`auto` 预留。
- **配置 schema**:新增 `aux.enabled`、`aux.skill.mode`、`aux.debug`(fullToolTrace / maxDebugEventBytes / debugEventsInHistory / redactSecrets),默认保守。
- **imageBridge 运行时门控**:补丁仍在,但 `imageBridge=native` 时不改写图片/不建硬链接。
- **内容真相/debug**:`fullToolTrace=true` 时,辅助调用写入 `aux/debug` 会话事件(ignorable,不进模型上下文);新增 `/aux debug [N]` 查看,并支持 `/aux debug <目标>` 跨会话读取(@this / session id / id 前缀 / cwd 片段)。
- **一键打补丁**:新增 `/aux patch` 命令(重跑 apply-patch + self-heal);设置页「平台开关」组提供“一键打补丁”按钮,通过 `/aux patch` 触发。
- **状态图标 UI / host→client 状态通道**:新增 `/aux status --json` 结构化状态(工具/桥接逐项 mode/state/reason/patch/action + 核心保护 + 事件记录 + restartRequired);设置页新增「诊断与修复」面板、状态点、补丁徽标与悬停原因。
- **设置页补丁状态展示**:每个工具/桥接显示可用状态与补丁状态;`unavailable` 项列出原因,可一键打补丁或提示配置。
- **重启生效提示**:运行中打补丁后,`/aux status --json` 返回 `restartRequired:true`;设置页「诊断与修复」面板显示“补丁已写入,重启 DSH 后生效”。
- **非标准安装路径补丁检测**:新增 `dsh-aux/src/bridge-locate.js`,统一用 `require.resolve` + 多级相对路径解析 DSH 包;修复源码树/自定义布局下 bridge 状态误报 `unknown` 的问题;`unknown` 文案改为“请运行 install.sh 或确认安装方式”。
- **一键安装全部补丁 + 结构化失败信息**:`/aux patch --json` 返回 `{ ok, restartRequired, steps[] }`;设置页按钮改为“一键安装当前 DSH 所需全部补丁”,失败时展示每个步骤的错误输出;补丁后自动刷新状态。
- **状态命令只读化**:`/aux status` 不再触发 `reconcileSessionImages`,避免持久化列表暂时不可用时状态查看变成删附件副作用。
- **状态图标最终交互**:`unavailable` 行可点击跳转到「诊断与修复」并高亮对应 issue;修复中显示 `fixing`;失败后保留 `unavailable` 并在 issue 内展示错误。
- **`/aux status` 统一重构**:人类可读输出改为消费 `collectPlatformStatus()`,消除两套状态推导,降低漂移风险。
- **低优先级打磨**:`configure` issue 改为可点击跳转对应设置组;任务字段/子代理字段补齐 `label htmlFor` + 控件 `id`;状态命令失败文案中英文化。
- 测试基线更新为 301。

## 0.3.3(2026-08-21)— 设置页 UI 重构 + reasoningEffort + 双语

- **设置页 UI 重构**:分组可折叠卡片(工具任务 / 桥接任务 / 子代理 / 全局),每个任务两列网格布局。
- **思考档位(reasoningEffort)**:每个任务可配置;设置页下拉选项来自当前 provider/model 的 `reasoning.efforts`;`AuxLlmRequest` 支持 per-call 覆盖;不传则沿用 provider 默认。
- **字段级重置**:每个已覆盖字段显示「重置」按钮,一键回到继承默认。
- **中英双语**:设置页跟随 DSH 语言(zh/en)。
- 测试基线更新为 291。

## 0.3.2(2026-08-21)— DSH 0.1.1-rc.1 兼容

- **DSH 0.1.1-rc.1 源码适配**:从 `deepseek-ai/deepseek-harness` tag
  `dsh-v0.1.0-rc.8` → `dsh-v0.1.1-rc.1` 做源码级 diff,核心变化是
  session-projection 注册 API(`schema/view` → `stateSchema/wire`)。
  dsh-aux 的 `aux-status` 投影改为**双 API 兼容**(feature-detect
  `sessionProjections.stateOf`),rc.6/7/8 继续用旧形态,0.1.1-rc.1 用新形态。
- **版本判定修正**:`bridge/target.js` 的 `isRc7OrNewer` 现在能正确识别
  `0.1.1-rc.1`(旧实现只看 rc 号,会把 0.1.1-rc.1 误判为 rc.1 老版本);
  同时覆盖稳定 0.1.x/0.2.x 新线。
- **peerDependencies 扩展**:15 个 DSH 官方 peer 依赖从 `^0.1.0-rc.6` 改为
  `>=0.1.0-rc.6 <0.2.0 || ^0.1.1-rc.1`,同时覆盖 rc.6/7/8 与 0.1.1-rc.1。
- **doctor 版本检查**:支持范围更新为 rc.6 / rc.7 / rc.8 / 0.1.1-rc.1。
- **补丁验证**:在临时 0.1.1-rc.1 部署上 `apply-patch.mjs --dry-run`
  P1-P6/P11 全部锚点匹配;P7 append 块匹配;P8 白名单插入点存在;
  settings 补丁随版本判定跳过(rc.1 原生动态设置)。
- **保持 rc.6/7/8 兼容**:行为变化全部走 feature-detection,不破坏旧版。

## 0.3.1(2026-08-20)— /aux 子命令识别修复 + 新增溯源命令 + 技能预审桥接

- **修复 `/aux status` / `/aux history` 等带参子命令被当成普通聊天发送**。
  根因:DSH 客户端对"未声明 `input` 提示的裸命令"只认无参裸行
  (`/aux` 单独回车),带参整行 `matchEnter` 直接落空回默认输入槽。这是官方
  设计——`/goal`、`/plan`、`/preset`、`/echo` 等带参命令都通过声明
  `input: { hint }` 让 `desc.input !== undefined` 走 leading-claim 执行路径。
  现在 dsh-aux 注册 `/aux` 时补上了 `input.hint`(列出全部子命令),
  裸 `/aux` 与 `/aux <subcommand> ...` 均正确执行。
- 依据:`deepseek-harness/master` 的
  `packages/client/ui-commands/src/client/service.ts` `matchEnter` 判定表。
- **新增 `/aux history [N]` 与 `/aux history full [N]`**:把既有的事件溯源
  基础设施(AUX_CALL_EVENT 会话事件)显式暴露成命令——
  `history` 简要溯源(默认最近 10 次,新→旧),`history full` 全部溯源
  (完整字段:路由/耗时/降级/error/输入输出 chars/purpose)。与
  `/aux status` 里「每任务最新一次」互补。
- **技能预审桥接(skill-audit)**:新增 `skill` 辅助任务路由,配置
  `aux.tasks.skill.provider/model` 后,原生 `skill` 工具结果会被 `tools/post-execute`
  桥接拦截:辅助模型精读 SKILL.md + 当前任务上下文(显式 `task` 参数 + 会话最近消息),
  返回「如何应用 / 适用性评估 / 已知坑与🔻易腐烂旧断言 / 执行建议 / 置信度」预审报告。
  主模型同时看到原始 SKILL.md + 报告,可对照辩证审视;未配置 skill 辅助模型时
  native 直通不拦截;辅助调用失败时回退原生结果。
  配套补丁:`dsh-tool-skill` schema 增加可选 `task` 参数(新增 P11 维护债),
  设置页新增「技能预审 (skill)」区块,`/aux test skill` 可自检。
- **README 单一真相(U1)**:npm 发布用的 `dsh-aux/README.md`(.en)不再是第二份
  人工维护文档,改为仓库根 README 的**生成快照**——新增
  `scripts/gen-package-readme.mjs`(`prepack` 自动再生成,`--check` 供 CI),并
  加回归测试防漂移(285 项全过)。消除"两套 README"文档债。
- **DSH rc.7 升级适配 + 启动自愈**:本地升级 rc.7 后全量重打 P1-P8(P9/P10 rc.7
   原生跳过);修复 install.sh 包名校验正则、agent-loop patched 块缺 mark、
   apply-patch 单步/未写盘缺陷;新增 `bridge/self-heal.mjs`(symlink + 补丁 +
   白名单 aux/llm-call 幂等自愈)并接入 `~/dsh/start-dsh.sh`,npm 升级后重启即
   自愈,不再丢 symlink/补丁/自定义事件白名单。
- **推送前加固**:`install.sh` 现在会幂等把启动自愈 hook 写进 `start-dsh.sh`
   (标记+备份+`--no-start-hook`);`self-heal.mjs` 补 symlink 父目录 mkdir 与逐步骤
   容错;`apply-patch.mjs` 循环加 no-op 守卫;新增 `TESTING.md` 测试活文档。
- **GitHub 安装更新体验**:新增 `update.sh`(`git pull` + 重跑 `install.sh` 一键更新);
  新增 `scripts/doctor.mjs` 健康检查(部署根/symlink/profile/补丁/P7/P8/自愈 hook/版本兼容);
  `install-start-hook.mjs` 支持更多启动脚本写法(`dsh web`、`pnpm dsh web` 等);
  `self-heal.mjs` 在补丁锚点不匹配/无法自愈时输出醒目 ⚠️ 提示;`/aux status`
  在补丁缺失时顶部显示「请运行 ./update.sh」警告。
- **DSH rc.8 支持**:已完成 rc.8 实机升级与补丁验证(P1-P8/P11 全打,P9/P10 跳过);
  多版本支持矩阵见 `aux-notes/13-version-support-plan.md`。

## 0.3.0(2026-08-17)— 子代理辅助模型桥接(subagent bridge)

- **透明接管原生 `subagent` 工具**:主模型看到的仍是 `subagent`,补丁在
  execute 里读取 `ctx.auxLlm.subagentRoute()` 并注入 `agentOptions` 与
  `toolFilter`。foreground / background / continuable 全部覆盖。
- **模式**:
  - `native`(默认):不拦截,原生行为;
  - `manual`:子代理统一用 `general` 模型;
  - `vision-aware`:任务需要视觉 → `vision` 模型,否则 → `general` 模型。
- **判定**:新增可选参数 `requires_vision`(`auto/true/false`);`auto` 用
  关键词启发式(可配置 `visionKeywords`),不确定时保守落到 `general`。
- **兜底链**:`prepareTools`(默认开)在子代理**已有 allow 白名单**时并入
  `vision_analyze` 等 AUX 工具(无 allow 则保持目录开放,避免过滤掉
  bash/read 破坏 Anchored/Standard bootstrap);子代理模型自己看图失败后可
  调用 `vision_analyze` → AUX 视觉辅助模型兜底。
- **设置页**:新增「子代理辅助模型」区块(mode / includeWorkflow / general /
  vision / prepareTools / visionKeywords)。
- **workflow 子代理桥接**:`dsh-workflow-worker-thread` 的 `startChild()`
  也读取 `ctx.auxLlm.subagentRoute()`(经 `subagentIncludeWorkflow` 门控),
  让 `workflow` 里 `agent()` 批量扇出的并行子代理同样走
  native / manual / vision-aware;显式 `agent(prompt,{provider,model})`
  优先于 AUX 路由。`/aux status` 新增独立 `workflow-bridge` 状态。
- `retryVisionWithAux` 作为保留配置(schema 已留,暂未暴露到设置页,功能后续实现)。
- **零系统提示词改动**:不注入系统提示词,兼容极简 / Anchored Standard。
- `/aux status` 显示 `subagent-bridge` 与 `workflow-bridge` 模式与补丁状态。
- 新增 `src/subagent-route.js`(纯函数)、`src/subagent-bridge.js`(补丁检测)、
  `tests/subagent-route.test.js`;`bridge/apply-patch.mjs` 新增
  `dsh-tool-subagent` 两个补丁目标(schema + request)与
  `dsh-workflow-worker-thread` 一个补丁目标(startChild)。

## 0.2.0(2026-08-17)— 视觉路由策略开关

- **forceAuxVision(设置页开关,默认关)**:开启后,即使主模型原生支持图片,
  image-bridge 也会把图片改写为 `vision_analyze`,统一走 AUX 视觉辅助模型。
  适合“主模型很贵、辅助视觉模型更便宜/更合适”的用法。
- **visionFallbackToMain(设置页开关,默认开)**:关闭后,视觉辅助模型失败时
  直接失败,不再回退到主模型(避免纯文本主模型回退后同样失败、或用户不想
  用昂贵主模型跑视觉)。
- **image-bridge v3 升级**:`apply-patch.mjs` 支持从旧 v2 自动升级到
  `forceAuxVision` 版本;`/aux status` 的 `v3` 同时覆盖模型切换与强制视觉。
- 新增 `forceAuxVision` / `visionFallbackToMain` 两个配置字段并同步到设置页。

## 0.1.9(2026-08-17)— image-bridge v3:含图会话可切换纯文本模型

- **修复模型切换**:含图片的会话无法切换到纯文本模型(`selectModel` 拒绝
  `inputModalities` 不含 image 的新模型)。根因是 DSH 旧门控不知道 dsh-aux
  的 image-bridge v2 已在模型输入边界把图片改写为 `vision_analyze` 路径文本。
- **补丁新增第三目标**:`bridge/apply-patch.mjs` 现在同时打
  `dsh-host-apiproxy selectModel`,移除“图片会话必须选图像模型”的旧门控。
- **避免错误绕过**:不要再通过“给纯文本模型强行标记 image 能力”来切换;那会让
  bridge 误以为模型原生支持图片,把 image block 原样发给真实不支持的模型,
  导致供应商 `429 invalid_request_error`。
- **状态上报**:`/aux status` 的 image-bridge 状态升级为 `v3`,并区分
  `v2`(旧 bridge 已装但切换仍受限)与 `v3`(切换已放开)。
- 新增 `bridge/orig-select-model-block.txt` / `bridge/patched-select-model-block.txt`;
  测试保持全绿(106 项)。

## 0.1.8(2026-08-16)— 低/中优先级质量加固

- **路由可观测性**:无路由失败也会记录 `aux/llm-call` 事件;`shouldFallback` 从死代码变为实际使用。
- **自定义任务**:`registerTask` 注册的任务现在出现在 `/aux status`,并可通过 `/aux model` 查看(写入仍不支持)。
- **压缩引擎**:
  - `compressWithPlan` 支持透传 `singleCallMaxChars` / `maxRounds` / `maxSegments`;
  - `maxRounds < 3` 时自动禁用分层压缩;
  - `maxOutputChars` 强制正整数;
  - 单行超长文本保持完整行,不再因硬切破坏 `\n` 重组。
- **抓取与视觉**:
  - 非 OK/异常路径统一释放 HTTP body;
  - `vision_analyze` 多图改为 allSettled,单图失败不再丢弃全部结果。
- **图片生命周期**:
  - `session-images.json` 所有写盘(含 cleanup 整体读改写)串行化;
  - GC 增加 `lstat` 复核,降低符号链接 TOCTOU;
  - `onSessionDisposed` 改用显式 shutdown 标志,批量删除不再被误判为关机。
- **测试稳定性**:固定 sleep 改为轮询等待;新增 15 项回归测试;总测试 161 项。
- **安装器与补丁加固**:
  - 新增 `bridge/target.js`,统一校验补丁目标必须位于 `node_modules/@deepseek-ai/.../lib/index.js`,防止相对路径逃逸写入任意文件;
  - `install.sh` 增加 profile 名与包名白名单校验,补丁写入改为位置参数传递,消除 heredoc 注入;
  - `imagePath` 明确依赖宿主 `fs` 服务的路径沙箱,插件层不重复实现/绕过该边界;新增 2 项边界测试,验证插件始终使用 `fs.resolve` 的结果且不绕过宿主拒绝。

## 0.1.7(2026-08-16)— compress_text 场景化压缩与质量加固

- **场景感知**:自动识别代码/日志/文档/通用,支持 `mode` 软提示与 `preserve` 结构化保留规则;混合内容走增强版通用模式。
- **输出预算**:新增 `maxOutputChars` 参数,优先于 `targetRatio` 控制输出大小。
- **多轮/分层压缩**:超长输入自动分段压缩后合并;超过 200K 字符自动启用“骨架→精炼”分层压缩;单段失败自动重试/再切分,仍失败保留原文并标记 `degraded`。
- **压缩元数据**:返回 `strategy`、`confidence`、`rounds`、`segments`、`degraded`、`warnings`。
- 输入安全上限提升到 500K 字符;新增 30 项 compression 测试。

## 0.1.6(2026-08-16)— 安全加固与源码拆分

- **SSRF 防护(默认开启)**:`web_extract` 与 `vision_analyze` 的 `imageUrl` 现在默认
  拒绝内网/环回/云元数据地址(`localhost`、`127.0.0.1`、`10.x`、`192.168.x`、
  `169.254.169.254`、`*.local` 等),且只允许 `http/https`;新增插件配置
  `allowInternalUrls: true` 可显式放行本机/内网抓取。新增 DNS 解析检查,
  可拦截 `localtest.me` 这类解析到内网地址的绕过手法;原生 fetch 回退路径
  改为手动跟随重定向,每一跳在发出请求前都做 SSRF 校验。
- 维护定时器改为 `unref`,避免测试进程被 5 分钟对账定时器挂住无法退出。
- **Prompt 注入缓解**:`web_extract` / `compress_text` 的系统提示明确将网页正文与
  待压缩文本视为不可信数据,禁止执行其中嵌入的指令;`guideText` 文档标注为受信任
  插件配置,只应从可信来源复制。
- **并发硬上限**:每个任务的 `maxConcurrency` 即使配置得更大,实际按 **10** 封顶,
  避免误配导致对辅助模型并发轰炸。
- **源码结构拆分**:`src/index.js` 从约 2000 行降到约 570 行,只保留 Service 装配与
  路由调度;配置/事件/投影/Bootstrap/命令/抓取/工具/图片生命周期/桥接拆分到独立模块,
  并补充源码结构文档,方便社区贡献者定位。
- 测试增至 100 项(aux)。

## 0.1.5(2026-08-16)— 命名空间脱敏、文档双语与隐私改进

- **包名去官方化**:从 `@deepseek-ai/dsh-aux` 改为 `@dolorescaritasangelus/dsh-aux`,避免冒充 DeepSeek 官方命名空间;同步更新 client 插件 id、文档、bridge 路径解析与测试
- **Git 历史脱敏**:重写全部提交,移除本机绝对路径;GitHub 历史与 tag 已强制更新
- **文档体验**:重写根 README 与插件包 README,新增英文版与中英文切换;加入 AUX 可爱向自我介绍与 SeekMaid 桌宠形象图;增加 TOC、FAQ、相关项目
- 修正安装方式说明:未发布 npm 时使用 `file:` 本地源码安装,移除不可用的 `git+https://...` 直装命令
- 修复 `bridge/` 脚本硬编码本地绝对路径,改为按部署形态相对解析;新增 `bridge/NOTICE`,为 DeepSeek Harness 原始代码摘录补充 MIT 声明
- **隐私改进**:设置页新增「在对话界面显示辅助模型状态芯片」开关;关闭后注销 `aux-status` 投影,不再向 Web/第三方暴露。`aux-status` 投影数据最小化,仅保留 `task / ok / fallbackUsed / durationMs`,不再暴露 provider/model/errorCode/inputChars/outputChars

## 0.1.4(2026-08-16)— 压缩桥接图片降级与 Bootstrap 预设引导

- **修复 `/compact` 与自动压缩在含图会话中因图片不可用而失败**:
  压缩回放消息中的 image block 若附件对象已被 GC/清理(读回报
  `Attachment object is missing.`),或所有可选压缩路由均不支持图片输入,
  dsh-aux 现在会把图片降级为文本占位后继续交给 AUX 压缩
  - 路由支持图片且附件可读时,image block 原样保留,视觉信息仍可进入摘要;
  - 附件缺失/损坏或候选路由纯文本时,以 `[图片: name (type, WxH) — 未纳入压缩摘要]`
    占位,避免整个压缩任务失败
- 新增 2 项回归测试(图片附件缺失降级、候选路由均不支持图片时直接文本化)
- **Bootstrap 预设(极简 / Anchored Standard)引导**:
  - **首轮绝不注入任何 AUX 上下文/提示词**(包括含图首轮),保留极简 / Anchored
    Standard 对 V4F/V4P 的锚定;
  - **极简模式**:首个持久 `tool/call` 前,dsh-aux 从 assembled 工具目录中过滤掉
    自己的三个工具(`vision_analyze` / `web_extract` / `compress_text`),保持极简
    两工具暴露;首个 `tool/call` 后目录开放,AUX 工具出现,并与 Anchored Standard
    一样通过 `agent/pre-step` 注入一次晋升提醒;
  - **Anchored Standard**:首个持久 `tool/call` 后目录开放,通过 `agent/pre-step`
    注入一次提示:“首轮 AUX 工具不可用;后续看图请直接使用 vision_analyze,
    不要创建子代理”;
  - systemPrompt 的 `aux:tools-guide` 在 complete persona 下本就不生效,因此改用
    pre-step 通道覆盖 Minimal / Anchored Standard。
- 新增 4 项回归测试(引导逻辑、minimal 首轮过滤/晋升后开放、pre-step 实际注入一次、首轮含图也不注入)

## 0.1.3(2026-08-16)— 会话压缩桥接与事件检测修复

- 新增 `compaction` 辅助任务:设置页与 `/aux model compaction` 可配置专用会话压缩模型
- 新增 compaction-bridge:配置 `compaction` 任务后,原生 `dsh-compaction-basic`
  的摘要调用改走 `ctx.auxLlm`,复用 AUX 的超时/并发/冷却/降级/事件记录
- 修复场景:会话含图片、摘要模型被路由到纯文本版本时,自动/手动压缩不可用
- `ctx.auxLlm` 请求支持可选 `tools`,供 compaction bridge 回放工具 schema
- `/aux status` 显示 compaction-bridge 状态
- compaction-bridge 失败时不再 fallback 到原生摘要,直接抛出 AUX 真实错误
  (AUX 调用内部已包含主模型 fallback,二次 fallback 只会掩盖根因)
- 文档注明原生 `dsh-compaction-basic` 为单次全量摘要;超大输入请调大
  `compaction.timeoutMs`(实测 shadowed 449K tokens 可单次成功)
- **会话事件白名单冲突**: 持久化读链(KNOWN_SESSION_EVENT_TYPES)拒绝
  白名单外的插件自定义事件(含 `aux/llm-call`),带该类事件的会话历史整体
  加载失败。`bridge/patch-session-ignorable.mjs` 补齐 dsh-session `append`
  的 `ignorable` 写入入口(官方 SessionEvent envelope 预留通道)+ 白名单
  放行旧日志;dsh-aux 的事件均以 `ignorable: true` 标记写入
- **传播性保护**: 未打 dsh-session ignorable 补丁的部署(GitHub 直接装插件)
  自动检测并在缺补丁时**降级不写事件**(+ 一次警告),防止无标记插件事件
  污染会话日志导致历史不可读;`/aux status` 显示「会话事件记录」状态
- **修复事件记录检测失效**: `_sessionEventsSupported()` 的候选路径原为
  `../dsh-session`(从 src/index.js 只到 dsh-aux/ 目录,永远解析失败),
  导致重启后所有 `aux/llm-call` 事件写入被永久降级禁用。现改为
  `sessionPatchCandidates()` 多候选检测(symlink 部署 / realpath 源码树 /
  上级 node_modules),任一候选命中补丁标记即启用;新增 3 项回归测试
- **修复 vision 等调用事件被静默丢弃**: 未传 `purpose` 的任务(如 vision)
  写入的事件 data 含 undefined 字段,dsh-session 的 JSON 快照(walkJsonValue)
  拒绝任何 undefined 属性值 → append 抛错被吞 → 事件丢失。现于事件构造前
  剥离 undefined 字段,防御所有调用方;新增回归测试
- 测试增至 81 项(aux)

## 0.1.2(2026-08-15)— 多图与修复

- vision_analyze 支持多图并行(images 数组,受任务并发信号量约束)
- **修复 image-memory 并发写竞态**:多图并行时 read-modify-write 丢条目(实测 5 丢 4),改为串行队列,新增回归测试
- 主 agent 引导段(aux:tools-guide):直接用 vision_analyze,不建子代理(guideText 可覆盖/禁用)
- vision prompt 增加 GIF 动画条件引导(不虚构静态图动作)
- COMPARISON.md 重写为最终结论版(移除过程性内容)

## 0.1.1(2026-08-15)— 修复与体验

- 修正文档:平台压缩/剪枝组件实为自动触发(高水位),无需手动启用
- vision_analyze 工具描述:同一图片相同问题可复用之前结果,避免重复分析
- settings 动态暴露机制说明、image-bridge 集成组件定位

## 0.1.0(2026-08-15)— 正式版

- 自 0.1.0-rc.6 转正;功能不变,修复归属缓存覆盖 bug、gc-images 符号链接防逃逸
- image-bridge 集成为安装组件(install.sh 一键),/aux status 显示其状态
- 文档完善:README 面向用户重写、AI.md 安装指南、CONTRIBUTIONS.md 致谢

## 0.1.0-rc.6(2026-08-15)— 初始版本

- 统一辅助 LLM 路由服务 `ctx.auxLlm`:任务分派、路由解析(显式配置 > 任务默认 > 主模型)、
  超时(默认 60s)、并发信号量(默认 2)、失败冷却(3 次/60s)、主模型降级、聚合错误 `AuxCallError`
- 三个辅助任务工具:`vision_analyze`(focus-hint 意图感知,question 必填)、
  `web_extract`(HTML 清洗 + 无 web provider 时回退全局 fetch)、`compress_text`
- 事件溯源:每次调用写 `aux/llm-call` 会话事件 + `aux-status` 投影
- `/aux` 命令:status / model / gc-images / vision / test / memory
- client 设置页 + composer 状态 chip(仅列 active 供应商)
- 会话图片生命周期管理:归属记录(session-images.json)+ 事件驱动清理 +
  冷会话定时对账 + 手动 GC;共享引用保留、归档不误删;图片记忆(image-memory.json)
- 图片能力门:发起前查 `resolveModelInfo`,空模态视为未知放行
- 测试:63 项(aux)+ 4 项(bridge 逻辑),node:test 零依赖
- 文档:PRD / README / AI.md(面向 AI 安装代理)/ CONTRIBUTIONS.md / COMPARISON.md /
  SESSION-ATTACHMENT-GC.md / VISION-AGENT.md

### 配套(仓库 bridge/ 目录,独立于插件本体)

- image-bridge v2:纯文本主模型粘贴图片可用且 UI 保留缩略图(两段式:admit 保留
  image block,agent-loop 模型输入边界按模态改写),幂等安装/回滚
- settings 白名单补丁:设置页可写 aux 配置
