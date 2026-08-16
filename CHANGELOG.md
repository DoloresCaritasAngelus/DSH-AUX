# Changelog

## 0.1.7(未发布)— compress_text 场景化压缩

- **场景感知**:自动识别代码/日志/文档/通用,支持 `mode` 软提示与 `preserve` 结构化保留规则;混合内容走增强版通用模式。
- **输出预算**:新增 `maxOutputChars` 参数,优先于 `targetRatio` 控制输出大小。
- **多轮/分层压缩**:超长输入自动分段压缩后合并;超过 200K 字符自动启用“骨架→精炼”分层压缩;单段失败自动重试/再切分,仍失败保留原文并标记 `degraded`。
- **压缩元数据**:返回 `strategy`、`confidence`、`rounds`、`segments`、`degraded`、`warnings`。
- 输入安全上限提升到 500K 字符;新增 22 项 compression 测试。

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
