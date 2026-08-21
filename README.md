[English](README.en.md) | **简体中文**

<div align="center"><img src="assets/deepseek-girl.png" alt="AUX" width="120" /></div>

> 嗨~ 我是 AUX,主人的辅助模型小助手 💙
> 主模型专心聊天,我负责看图、读网页、压长文!
> 需要我的时候,直接叫我就好～

<div align="center">

![Version](https://img.shields.io/badge/version-0.3.3-blue)
![Tests](https://img.shields.io/badge/tests-301-brightgreen)
![License](https://img.shields.io/badge/license-MIT-green)
![Platform](https://img.shields.io/badge/DSH-0.1.0--rc.6%20~%200.1.1--rc.1-0078D4)

</div>

# dsh-aux — DSH 辅助模型系统

> 给主 agent 配一个“副手”:**视觉分析、网页提取、长文本压缩**这些旁路任务,由独立辅助 LLM 完成,主模型专注对话。不建子智能体、不做会话协同——装完即用,零配置。

---

## 目录

- [为什么需要它](#为什么需要它)
- [核心特性](#核心特性)
- [环境要求](#环境要求)
- [快速开始](#快速开始)
- [使用指南](#使用指南)
- [工作原理](#工作原理)
- [兼容性与依赖](#兼容性与依赖)
- [常见问题](#常见问题)
- [相关项目](#相关项目)
- [文档](#文档)
- [致谢与借鉴](#致谢与借鉴)
- [许可证](#许可证)

---

## 为什么需要它

对话模型越来越强,但“看图、读网页、压长文”这类任务交给主模型做会打断思路、烧上下文。dsh-aux 把它们拆给**辅助模型**:你只管发,背后自动路由到合适的模型——主模型答你的问题,辅助模型负责“看一眼图片”“总结这个网页”“把这 5 万字压缩一下”。

## 核心特性

| 特性 | 说明 |
|---|---|
| **统一辅助 LLM 路由** | 每类任务可配独立模型/超时/并发;失败自动降级主模型;连续失败进入冷却;每次调用写入会话事件,可审计 |
| **四个开箱即用工具** | `vision_analyze`(图像分析)、`web_extract`(网页提取+摘要)、`web_crawl`(站点深度抓取+整体摘要)、`compress_text`(长文本压缩) |
| **会话压缩桥接** | 配置 `compaction` 任务后,原生 DSH 自动/手动压缩会改走 AUX 辅助模型;含图会话图片缺失/纯文本路由时自动降级,压缩不失败 |
| **子代理/工作流桥接** | 原生 `subagent` 与 `workflow` 并行 `agent()` 子代理透明走 AUX(native/manual/vision-aware);零新工具、零系统提示词改动 |
| **技能预审桥接** | 配置 `skill` 辅助模型后,原生 `skill` 工具调用会先由辅助模型精读 SKILL.md + 当前任务,返回「如何应用 / 已知坑 / 🔻易腐烂旧断言 / 执行建议」预审报告;主模型可对照原文辩证审视 |
| **`/aux` 命令** | 状态查看、模型切换、图片回收、视觉自检、图片记忆 |
| **Web 设置页 + 状态 chip** | 分组可折叠设置页,每任务模型/超时/并发/思考档位配置;中英双语跟随 DSH 语言;composer 实时显示最近一次辅助调用 |
| **会话图片生命周期** | 删除会话自动清理无引用图片;共享保留、归档不误删;图片记忆跨重启可查 |
| **零配置可用** | 不配任何模型也能跑——辅助任务自动使用会话主模型 |

### 四个工具

| 工具 | 干什么 | 典型场景 |
|---|---|---|
| `vision_analyze` | 图像分析(支持多图并行) | “这张图里是什么?” “读出图表数值” “对比两张图” |
| `web_extract` | 网页抓取 + 摘要(支持 `followLinks` 同源递归) | “总结这个页面” “回答某网页里的问题” “抓这个文档站” |
| `web_crawl` | 站点深度抓取 + 整体摘要(scope/robots/限流/预算) | “抓取整个文档站并总结” “列出 docs 站所有 API 端点” |
| `compress_text` | 长文本压缩(自动识别代码/日志/文档,支持输出预算、多轮/分层压缩) | 压日志、压文档、压超长上下文 |

## 环境要求

- **DSH** 0.1.0-rc.6 ~ 0.1.1-rc.1(已验证 rc.6 / rc.7 / rc.8 / 0.1.1-rc.1)
- **Node.js** ≥ 20
- **运行时零第三方依赖**:peerDependencies 全部是 DSH 官方包(环境自带),无 `dependencies`,无需额外安装任何第三方运行时库。

## 快速开始

```sh
# 方式一:克隆仓库后一键安装(推荐,含 image-bridge 集成组件)
git clone https://github.com/DoloresCaritasAngelus/DSH-AUX.git
cd DSH-AUX && ./install.sh

# 方式二:本地源码安装插件本体(未发布 npm 时使用)
git clone https://github.com/DoloresCaritasAngelus/DSH-AUX.git
cd DSH-AUX/dsh-aux
dsh plugin --profile web add "file:$(pwd)"
```

重启 DSH 后:

1. 发一张图片给 agent,它会用 `vision_analyze` 描述给你(纯文本主模型也能发——image-bridge 已集成);
2. 输入 `/aux status` 查看各任务路由;
3. 想让视觉走专用模型?`/aux model vision <provider>/mimo-v2.5`。

## 更新(GitHub 安装用户)

```sh
# 推荐:拉取最新代码 + 重新接线(幂等,会自动补新补丁/自愈 hook)
./update.sh

# 如果你已经手动 git pull 或下载 zip 解压,只重新接线:
./update.sh --no-pull

# 更新后健康检查(不修改任何文件):
node scripts/doctor.mjs
```

> 为什么不能只 `git pull`?dsh-aux 的 bridge 补丁和启动自愈 hook 写在 DSH
> 部署里(`node_modules` / `start-dsh.sh`),`git pull` 只更新源码。`./update.sh`
> 会重新跑 `install.sh`,把新增补丁/自愈 hook 写进部署。自愈 hook 会在每次
> 启动 DSH 前自动补 symlink、补丁和白名单;若你的启动脚本不是 `start-dsh.sh`,
> 请手动运行 `./update.sh`。

## 使用指南

### 命令

| 命令 | 作用 |
|---|---|
| `/aux status` | 查看各任务路由与最近调用 |
| `/aux history [N]` | 简要溯源:最近 N 次辅助调用(默认 10) |
| `/aux history full [N]` | 全部溯源:完整事件字段(默认全部) |
| `/aux model <task> [provider/model]` | 查看/设置某任务的辅助模型 |
| `/aux vision <path> <question...>` | 命令行直接看图 |
| `/aux test <task>` | 自检某任务路由 |
| `/aux memory [n]` | 查看最近图片分析记忆 |
| `/aux gc-images [days]` | 手动回收旧附件图片 |

### 设置页

Web → 设置 → 辅助模型,可为 `vision` / `web_extract` / `web_crawl` / `compress` / `compaction` / `skill` 分别配置模型。其中 **`compaction` 就是会话压缩模型**——配置后原生 DSH 的自动/手动压缩会走 AUX 辅助模型。**`skill` 就是技能预审模型**——配置后原生 `skill` 工具调用会先由辅助模型出预审报告。`web_extract` / `web_crawl` 还可单独配置 `maxChars`(页面字符预算,默认 32000)。每个任务还可选「思考档位」,选项来自当前 provider/model 支持的 `reasoning.efforts`,不传则沿用 provider 默认。设置页按「工具任务 / 桥接任务 / 子代理 / 全局 / 平台开关」分组折叠,并支持中英双语跟随 DSH 语言。在「平台开关」中可为每个工具/桥接选择 `native` / `aux`(`compat` 为未来预留),并可配置 SKILL 审计模式(`native` / `audit` / `report` / `report-ondemand`)与 debug 记录选项。设置页顶部还有「诊断与修复」面板:每个工具/桥接显示状态点、补丁徽标与不可用原因,补丁缺失时可一键重打;补丁写入后会提示“重启 DSH 后生效”。也可关闭「在对话界面显示辅助模型状态芯片」(关闭后不再向 Web/第三方暴露 `aux-status` 投影,`/aux status` 不受影响)。

### 网页提取 (web_extract)

抓取一个网页(或开 `followLinks` 顺同源链接)交给辅助模型,返回**事实摘要 + 要点**。

| 参数 | 默认 | 说明 |
|---|---|---|
| `url` | 必填 | 要抓的页面 |
| `question` | — | 可选追问,用于聚焦回答 |
| `maxChars` | 32000 | 页面字符预算,可配;递归时作全站累计预算 |
| `followLinks` | `off` | `same-origin` 时在同源内顺链递归抓文档站 |
| `maxPages` / `maxDepth` | 3 / 1 | 递归的页数 / 链接深度上限(`0` 仅抓种子) |

- **输出**:单页返回 `summary`/`keyPoints` + `chars`(正文码点)与 `truncated`(是否被裁);递归额外给 `pages`、`totalChars`。
- **边界**:静态 HTML 摘要代理——不执行 JS(SPA 站点可能是空壳),不能点击/翻页/填表。
- **递归**:与 web_crawl 同一套抓取引擎,遵守 robots.txt、每主机限速与逐跳 SSRF;只顺同源文档链接,跳过图片/压缩包/音视频。

### 站点抓取 (web_crawl)

从种子 URL 出发**深度抓取整个文档站**(或 `hosts` 白名单的多个子站),一次辅助调用返回整体摘要 + 页面清单。完整设计见 `WEB-CRAWL-DESIGN.md`。

| 参数 | 默认 | 说明 |
|---|---|---|
| `url` | 必填 | 起始种子页 |
| `scope` | `same-origin` | 抓取范围;`hosts` 时只抓 `hosts` 列出的主机 |
| `hosts` | — | `scope=hosts` 时的允许主机(种子必须在其中) |
| `seedUrls` | — | 额外深度-0 种子(仍 SSRF 校验并按 scope 过滤) |
| `maxPages` / `maxDepth` | 10 / 2 | 页数上限 / 链接深度上限 |
| `maxCharsPerPage` | 32000 | 每页字符预算 |
| `respectRobots` | true | 遵守 robots.txt(Disallow 路径不抓) |
| `minIntervalMs` | 250 | 同一主机两次请求的最小间隔 |
| `useSitemap` | false | 从 `<origin>/sitemap.xml` 补种(嵌套 index 不递归) |
| `maxPagesPerHost` | 0(不限) | 单主机页数上限 |
| `perPageSummaries` | false | false=聚合摘要;true=每页单独摘要 |

**两种摘要模式**

| 模式 | 怎么摘要 | 成本 |
|---|---|---|
| **A(默认)** | 所有页面一次性调用 → 整体 `summary`/`keyPoints` + `pages` 清单 | 1 次调用 |
| **B**(`perPageSummaries:true`) | 每页单独摘要 → `perPage` 列表,再对摘要做一次聚合 | ≈ 页数 + 1 次调用 |

**行为**:遵守 robots 与每主机限速,每页每跳都走 SSRF 逐跳校验;静态 HTML、不渲染 JS;**声明非并发安全**——靠顺序 BFS + 限速避免对单域扇出轰炸。

### 清洗与反爬(大上下文时代)

面向便宜的大上下文辅助模型,网页提取的目标从「压缩到最小」转为「**去毒后完整交付**」:把干净的整页交给辅助模型直接回答/摘要,主模型只拿结果。

**清洗**:`htmlToText` 整块删除 `script/style/iframe/canvas` 等零语义块与 `data:` base64,只留正文文本与数字/URL。**去毒(H5)不变**:页面正文包进带随机 nonce 的不可信数据块,与 `Question` 物理分离,忽略一切内嵌指令。

**反爬(零依赖)**

| 场景 | 行为 |
|---|---|
| 编码 | 按 `Content-Type` / `<meta charset>` 用 `TextDecoder` 解码(GBK/GB18030 等不乱码) |
| JS Challenge | 检测到 CF/挑战壳 → 返回 `browserRequired` 标记,不烧 aux token,提示改用浏览器 |
| 429 / 502-504 | 自动重试一次(短退避);仍失败报带 rate-limited 提示的错 |
| 403 等 4xx | 报带「可能需浏览器/登录」提示的错,不给 aux 喂空内容 |
| 重定向 | 逐跳 SSRF 跟随,结果暴露 `redirects` 跳数(落地页 ≠ 请求页) |
| 代理 | 直连优先,传输出错自动回退 `HTTP(S)_PROXY`(尊重 `NO_PROXY`),零依赖 |

### 子代理与工作流桥接(subagent / workflow)

DSH 原生的 `subagent` 工具,以及 `workflow` 批量**并发扇出的 `agent()` 子代理**,都被**透明桥接**到 AUX——对话里照常用 `subagent`/`workflow`,但真正干活的是 AUX 辅助模型,复用每任务配置、失败冷却和主模型降级。**零新工具、零系统提示词改动**。

| 模式 | 子代理用什么模型 |
|---|---|
| `native`(默认) | 不拦截,完全原生/主模型行为 |
| `manual` | 所有子代理统一走 `subagent.general` 指定模型 |
| `vision-aware` | 判定「需要视觉」(如命中 `visionKeywords`)时走 `subagent.vision`,否则 `general` |

**配置**(设置页「子代理辅助模型」块,或 yaml):

```yaml
aux:
  subagent:
    mode: vision-aware        # native | manual | vision-aware
    general: { provider: opencode-go, model: glm-5.2 }
    vision:  { provider: opencode-go, model: kimi-k2.7-code }
    includeWorkflow: true      # workflow 的并行 agent() 子代理也走 AUX(默认 true)
    prepareTools: true         # 给子代理注入 vision_analyze 等 AUX 工具作兜底
    visionKeywords: [ "图片", "图像", "截图" ]
    retryVisionWithAux: false  # 实验性:子代理失败后二次派发到 AUX 视觉
```

- `includeWorkflow=false` 时,即使 `mode != native`,`workflow` 的子代理也不拦截(仅 `subagent` 工具生效)。
- 安装:本地补丁由 `install.sh`(或 `bridge/apply-patch.mjs`)安装;`/aux status` 会显示 `subagent-bridge` / `workflow-bridge` 的当前模式与补丁状态。设计细节见 `SUBAGENT-BRIDGE.md` / `WORKFLOW-BRIDGE.md`。

### 技能预审桥接(skill-audit)

DSH 原生流程是「主模型看到 catalog → 调 `skill` → 直接执行 SKILL.md」。dsh-aux 在中间插入一道**辅助模型尽职调查**:

```
主模型看到 catalog → 决定调用 skill("auth-flow")
    ↓
原生 skill 工具照常加载 SKILL.md
    ↓
【AUX tools/post-execute 拦截】
    ↓
辅助模型精读 SKILL.md + 当前任务(显式 task 参数 + 会话最近消息)
    ↓
返回预审报告:
  - 如何应用 / 适用性评估
  - 已知坑 / 🔻易腐烂旧断言标注
  - 执行建议 / 置信度
    ↓
主模型同时看到「原始 SKILL.md + 预审报告」→ 辩证审视 → 接受/修改/拒绝
    ↓
真正执行
```

- **启用**:设置页「技能预审 (skill)」或 `/aux model skill <provider>/<model>` 配置专用辅助模型后才拦截;未配置时 native 直通。
- **不沉淀 skill**:dsh-aux 不负责创建/管理技能,技能仍由官方原生或记忆管理插件负责。
- **返回原文**:主模型始终能看到原始 SKILL.md,不会盲信辅助模型。
- **失败降级**:辅助调用失败时返回原生 SKILL.md,不阻塞主模型。

### 安全边界

- **SSRF 防护(默认开启)**:`web_extract` / `web_crawl` 与 `vision_analyze` 的 `imageUrl` 默认拒绝内网/环回/云元数据地址(`localhost`、`127.0.0.1`、`10.x`、`192.168.x`、`169.254.169.254`、`*.local`、Teredo/6to4 内嵌私有地址等),且只允许 `http/https`;回退抓取路径的重定向**每一跳都在请求前校验**(逐跳 DNS+地址检查),provider seam 路径也要求返回最终 URL、对该 URL 复审,并把 3xx 交给逐跳逻辑重新跟随。需要抓取本机/内网服务时,在插件配置里显式设置 `allowInternalUrls: true`。
- **Prompt 注入缓解**:辅助模型提示把网页正文、待压缩文本、图片内文字都视为**不可信数据**;网页正文被包裹进带随机 nonce 的 `<<<UNTRUSTED PAGE DATA …>>>` … `<<<END UNTRUSTED PAGE DATA …>>>` 数据块,与 `Question` 指令物理分离,并明确禁止执行其中嵌入的指令;`guideText` 是受信任的插件配置,只应从可信来源复制。
- **并发硬上限**:每个任务的 `maxConcurrency` 即使配置得更大,实际也按 **10** 封顶,避免误配导致对辅助模型并发轰炸。

### 编程调用(给其他插件开发者)

```js
const result = await ctx.auxLlm.call("compress", {
  messages,
  system,
  session,
  signal
});
// => { text, provider, model }
```

自定义任务:`ctx.auxLlm.registerTask(...)`。

## 工作原理

- **路由解析**:显式配置 > 任务默认 > 会话主模型;辅助模型失败自动降级主模型。
- **健壮性**:每任务超时(默认 60s)、并发信号量(默认 2)、失败冷却(连续 3 次 → 停 60s)、错误分类、聚合错误报告每一跳。
- **可观测**:每次调用写 `aux/llm-call` 会话事件 + `aux-status` 投影,历史可回放。
- **图片能力门**:调用前查模型输入能力,明确不支持的模型直接跳过换路;未声明能力的模型放行由服务端决定。
- **压缩协同**:`dsh-compaction-basic` 的摘要调用可通过 `ctx.auxLlm` 的 `compaction` 任务执行,复用 AUX 的超时/并发/冷却/降级/事件记录。

## 源码结构

`dsh-aux/src/index.js` 只保留 **Service 装配与路由调度**,其余按领域拆分,方便社区贡献者定位:

- `config.js` / `route.js` / `prompt.js` / `url-policy.js` — 配置、路由、提示词、SSRF 策略
- `events.js` / `projection.js` / `bootstrap.js` / `commands.js` / `fetch.js` — 事件、投影、Bootstrap 引导、命令、抓取
- `tools/` — `vision_analyze` / `web_extract` / `compress_text` 工具实现与注册
- `images/` — 附件归属、清理、图片记忆、图片引用解析
- `image-bridge.js` / `compaction-bridge.js` / `compaction-messages.js` — 桥接与压缩消息降级

## 兼容性与依赖

- **平台**:DSH 0.1.0-rc.6 ~ 0.1.1-rc.1;Node ≥ 20。
- **运行时零第三方依赖**:peerDependencies 全部是 DSH 官方包(环境自带),无 `dependencies`。
- **测试零依赖**:`node --test tests/*.test.js`(301 项;文件清单与基线见 `TESTING.md`)。

### 集成组件

- **image-bridge**:让纯文本主模型也能直接粘贴图片,UI 保留缩略图;含图会话可切换到纯文本模型(v3);`npm update` 后需重跑 `bridge/apply-patch.mjs`。
- **settings 动态暴露**:设置页可读写 aux 配置;对应补丁已随本仓库 `bridge/` 落地,不依赖官方 deepseek-harness 合入。
- **会话事件注册通道**:`aux/llm-call` 以 `ignorable: true` 标记写入;未装补丁时自动降级不写事件,保护会话日志。
- **会话删除协同**:配合社区插件 dsh-plugin-session-delete,删除会话时自动清理无引用图片。
- **compaction-bridge**:配置 `compaction` 任务后,原生压缩改走 AUX;含图会话图片不可用时自动降级为文本占位。
- **subagent-bridge**:透明接管原生 `subagent` 与 `workflow` 并行 `agent()` 子代理,按 native / manual / vision-aware 路由到 AUX(见上文「子代理与工作流桥接」)。

### 极简 / Anchored Standard 兼容

首个持久 `tool/call` 前只暴露 Minimal 工具对,并剥离自动注入上下文——这是这些预设实现“首轮轨迹锚定”的核心机制。dsh-aux **首轮绝不注入任何 AUX 上下文/提示词**;首个 `tool/call` 后目录开放,AUX 工具出现,并通过 `agent/pre-step` 注入一次提示,引导直接使用 `vision_analyze`,避免子代理绕路。Anchored Standard 的设计与实现见 [xiaobright/dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard/tree/main)。

## 常见问题

**Q1:为什么在极简 / Anchored Standard 预设的首轮看不到 `vision_analyze` 等 AUX 工具?**

A:这些预设的“首轮轨迹锚定”机制会在首个持久 `tool/call` 前只暴露 Minimal 工具对,并剥离自动注入的上下文。dsh-aux 尊重这一机制,**首轮绝不注入任何 AUX 上下文/提示词**,也不会提前暴露自己的工具。首个 `tool/call` 之后工具目录开放,`vision_analyze` / `web_extract` / `compress_text` 就会出现,并通过 `agent/pre-step` 注入一次提示引导直接使用。

**Q2:为什么 `/compact` 在含图会话里失败了?**

A:如果会话消息里的 image block 对应附件对象已被 GC/清理(读回报 `Attachment object is missing.`),或所有可选压缩路由均不支持图片输入,图片对压缩不可用。此时 dsh-aux 会把图片**降级为文本占位**(`[图片: name (type, WxH) — 未纳入压缩摘要]`)后继续交给 AUX 压缩,避免整个压缩任务失败——所以正常情况下压缩不会因图片不可用而失败。

**Q3:dsh-aux 需要配置模型才能用吗?**

A:不需要。dsh-aux 是**零配置**的:不配任何模型也能跑,辅助任务会自动回退到会话主模型。你可以随时通过设置页或 `/aux model <task> <provider/model>` 为某个任务指定专用模型。

## 相关项目

- [dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard/tree/main) — Anchored Standard 预设的设计与实现
- [dsh-vision-toolkit](https://github.com/Anionex/dsh-vision-toolkit) — 社区视觉工具集
- [dsh-plugin-session-delete](https://github.com/lsz-asd/dsh-plugin-session-delete) — 会话删除插件(删除会话时自动清理无引用图片)
- [SeekMaid-pet](https://github.com/DoloresCaritasAngelus/SeekMaid-pet) — SeekMaid 电子宠物

## 文档

| 文档 | 内容 |
|---|---|
| [AI.md](./dsh-aux/AI.md) | 给 AI 代理的安装指南 |
| [PRD.md](./PRD.md) | 需求规格与设计决策 |
| [CHANGELOG.md](./CHANGELOG.md) | 版本历史 |
| [COMPARISON.md](./COMPARISON.md) | 与社区视觉插件的架构对比 |
| [VISION-AGENT.md](./VISION-AGENT.md) | 视觉子代理策略与记忆架构 |
| [SESSION-ATTACHMENT-GC.md](./SESSION-ATTACHMENT-GC.md) | 会话删除时图片清理设计 |
| [CONTRIBUTIONS.md](./CONTRIBUTIONS.md) | 致谢与借鉴说明 |

## 致谢与借鉴

设计受 **Hermes Agent**、**agent-vision-toolkit**、**dsh-vision**、**deepseek-harness #733** 与 **DeepSeek Harness** 平台启发,逐条说明见 [CONTRIBUTIONS.md](./CONTRIBUTIONS.md)。

## 许可证

[MIT License](./LICENSE) © 2026 dsh-aux contributors
