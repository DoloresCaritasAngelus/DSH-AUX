[English](README.en.md) | **简体中文**

<div align="center"><img src="https://raw.githubusercontent.com/DoloresCaritasAngelus/DSH-AUX/main/assets/deepseek-girl.png" alt="AUX" width="120" /></div>

<div align="center">

> 嗨~ 我是 AUX，主人的辅助模型小助手 💙
> 主模型专心聊天，我负责看图、读网页、压长文！
> 需要我的时候，直接叫我就好～

![Version](https://img.shields.io/badge/version-0.4.1-FIX1-blue)
![Tests](https://img.shields.io/badge/tests-320-brightgreen)
![License](https://img.shields.io/badge/license-MIT-green)
![Platform](https://img.shields.io/badge/DSH-0.1.2--alpha.2%20~%200.1.2--alpha.3-0078D4)

</div>

# dsh-aux — DSH 辅助模型系统

> 给主 agent 配一个「副手」：**视觉分析、网页提取、长文本压缩**这些旁路任务，由独立辅助 LLM 完成，主模型专注对话。
> 也可以透明接管你已有的 `subagent` / `workflow`——**不会额外创建子代理**，也不会抢走主模型的对话。

> 💬 「这些杂活交给我，主人专心聊天就好啦～」

---

## 目录

- [这是什么？](#这是什么)
- [核心亮点](#核心亮点)
- [我都能帮你做什么](#我都能帮你做什么)
- [平台开关与 SKILL 模式](#平台开关与-skill-模式)
- [快速开始](#快速开始)
- [日常命令](#日常命令)
- [设置页与状态面板](#设置页与状态面板)
- [桥接与高级能力](#桥接与高级能力)
- [安全边界](#安全边界)
- [工作原理](#工作原理)
- [项目结构](#项目结构)
- [兼容性与依赖](#兼容性与依赖)
- [文档](#文档)
- [常见问题](#常见问题)
- [相关项目](#相关项目)
- [许可证](#许可证)

---

## 这是什么？

对话模型越来越强，但“看图、读网页、压长文”这类任务交给主模型做会打断思路、烧上下文。**dsh-aux** 把它们拆给**辅助模型**：你只管发，背后自动路由到合适的模型——主模型答你的问题，辅助模型负责“看一眼图片”“总结这个网页”“把这 5 万字压缩一下”。

- **统一辅助 LLM 路由**：每类任务可配独立模型 / 超时 / 并发 / 思考档位。
- **零配置可用**：不配任何模型也能跑，缺省自动使用会话主模型。
- **可观测**：每次调用写入会话事件，`/aux status`、设置页、状态芯片都能看到。

## 核心亮点

| 特性 | 说明 |
|---|---|
| **四个开箱即用工具** | `vision_analyze`、`web_extract`、`web_crawl`、`compress_text` |
| **统一路由与降级** | 每任务独立模型/超时/并发；失败自动降级主模型，连续失败进入冷却 |
| **平台化开关** | 每个工具/桥接可选 `native` / `aux`；`compat` 为未来预留 |
| **SKILL 审计** | 四级模式：`native` / `audit` / `report` / `report-ondemand` |
| **子代理 / 工作流桥接** | 原生 `subagent` 与 `workflow` 并行 `agent()` 透明走 AUX |
| **技能预审桥接** | 先由辅助模型精读 SKILL.md + 当前任务，返回预审报告 |
| **会话压缩桥接** | 配置 `compaction` 后，原生自动/手动压缩改走 AUX |
| **设置页 + 状态面板** | 分组可折叠，中英双语；完整平台状态、补丁可诊断、一键修复、重启检测 |
| **会话图片生命周期** | 删会话自动清无引用图片；共享保留、图片记忆跨重启 |
| **零第三方运行时依赖** | peerDependencies 全为 DSH 官方包 |

## 我都能帮你做什么

| 工具 | 干什么 | 典型场景 |
|---|---|---|
| `vision_analyze` | 图像分析（支持多图并行） | “这张图里是什么？” “读出图表数值” |
| `web_extract` | 网页抓取 + 摘要（支持同源递归） | “总结这个页面” “回答某网页里的问题” |
| `web_crawl` | 站点深度抓取 + 整体摘要 | “抓取整个文档站并总结” |
| `compress_text` | 长文本压缩（代码/日志/文档自适应） | 压日志、压文档、压超长上下文 |

> 💬 「看图、读网页、压长文——都是我的拿手活！」

<details>
<summary><b>工具完整参数（点开查看）</b></summary>

### web_extract

| 参数 | 默认 | 说明 |
|---|---|---|
| `url` | 必填 | 要抓的页面 |
| `question` | — | 可选追问，用于聚焦回答 |
| `maxChars` | 32000 | 页面字符预算 |
| `followLinks` | `off` | `same-origin` 时在同源内顺链递归 |
| `maxPages` / `maxDepth` | 3 / 1 | 递归页数 / 深度上限（`0` 仅抓种子） |

- **输出**：单页返回 `summary` / `keyPoints` + `chars` / `truncated`；递归额外给 `pages`、`totalChars`。
- **边界**：静态 HTML 摘要代理——不执行 JS；不能点击/翻页/填表。
- **递归**：与 `web_crawl` 同一套抓取引擎，遵守 robots.txt、限速与逐跳 SSRF。

### web_crawl

| 参数 | 默认 | 说明 |
|---|---|---|
| `url` | 必填 | 起始种子页 |
| `scope` | `same-origin` | 抓取范围；`hosts` 时只抓列出的主机 |
| `hosts` | — | `scope=hosts` 时的允许主机列表 |
| `seedUrls` | — | 额外深度-0 种子（仍 SSRF 校验） |
| `maxPages` / `maxDepth` | 10 / 2 | 页数上限 / 链接深度上限 |
| `maxCharsPerPage` | 32000 | 每页字符预算 |
| `respectRobots` | true | 遵守 robots.txt |
| `minIntervalMs` | 250 | 同一主机最小请求间隔 |
| `useSitemap` | false | 从 `<origin>/sitemap.xml` 补种 |
| `maxPagesPerHost` | 0（不限） | 单主机页数上限 |
| `perPageSummaries` | false | false=聚合摘要；true=每页单独摘要 |

**两种摘要模式**

| 模式 | 怎么摘要 | 成本 |
|---|---|---|
| **A（默认）** | 所有页面一次性调用 → 整体摘要 + 页面清单 | 1 次调用 |
| **B** | 每页单独摘要 → 再聚合 | ≈ 页数 + 1 次调用 |

</details>

### 清洗与反爬（零依赖）

- **编码**：按 `Content-Type` / `<meta charset>` 解码，GBK/GB18030 不乱码。
- **JS Challenge**：检测到 CF / 挑战壳 → 返回 `browserRequired`，不烧 token，提示改用浏览器。
- **429 / 502-504**：自动重试一次（短退避）；仍失败报带 rate-limited 提示的错。
- **403 等 4xx**：报「可能需要浏览器 / 登录」提示，不给辅助模型喂空内容。
- **重定向**：逐跳 SSRF 跟随，结果暴露 `redirects` 跳数。
- **代理**：直连优先，传输出错自动回退 `HTTP(S)_PROXY`（尊重 `NO_PROXY`），零依赖。

## 平台开关与 SKILL 模式

这是 v0.4.0 的核心体验：AUX 不再是“自动但黑盒”，而是**可配置、可关闭、可解释**。

### 工具 / 桥接三态开关

| 模式 | 行为 |
|---|---|
| `native` | 关闭 AUX，走 DSH 原生行为；工具从模型目录隐藏 |
| `aux` | 打开 AUX，使用我们的实现 / 桥接 |
| `compat` | **未来预留**，当前不可用，UI 上显示为 disabled |

适用于：`vision_analyze`、`web_extract`、`web_crawl`、`compress_text`、`imageBridge`、`subagentBridge`、`workflowBridge`、`compactionBridge`、`skillAudit`。

> 💬 「不想让我插手？一键切回原生就好～」

### SKILL 审计模式

| 模式 | 行为 |
|---|---|
| `native` | 不拦截，原生直通 |
| `audit` | 辅助模型先审计 SKILL.md + 当前任务，主模型再执行 |
| `report` | 只返回审计报告，不执行 |
| `report-ondemand` | 按需取原文（`includeOriginal: true`） |

### 诊断与修复面板

设置页顶部会显示每个工具 / 桥接的**状态点、补丁徽标、不可用原因**；补丁缺失时可以一键重打，写入后提示“重启 DSH 后生效”。状态数据通过隐藏的 `aux/platform-status` 事件 + `aux-platform` 投影读取（非命令通道，不会在会话里生成 `/aux status --json` 命令卡片）。

> 💬 「哪里不对劲，我会亮起来告诉你～」

## 快速开始

```sh
# 方式一：克隆仓库后一键安装（推荐，含 image-bridge 集成组件）
git clone https://github.com/DoloresCaritasAngelus/DSH-AUX.git
cd DSH-AUX && ./install.sh

# 方式二：本地源码安装插件本体（未发布 npm 时使用）
git clone https://github.com/DoloresCaritasAngelus/DSH-AUX.git
cd DSH-AUX/dsh-aux
dsh plugin --profile web add "file:$(pwd)"
```

重启 DSH 后：

1. 发一张图片给 agent，它会用 `vision_analyze` 描述给你（纯文本主模型也能发——image-bridge 已集成）；
2. 输入 `/aux status` 查看各任务路由；
3. 想让视觉走专用模型？`/aux model vision <provider>/mimo-v2.5`。

> 💬 「装好之后，直接叫我就行～」

### 更新（GitHub 安装用户）

```sh
./update.sh                # 拉取最新代码 + 重新接线（幂等）
./update.sh --no-pull      # 已手动更新源码时，只重新接线
node scripts/doctor.mjs    # 更新后健康检查（不修改任何文件）
```

> 为什么不能只 `git pull`？dsh-aux 的 bridge 补丁和启动自愈 hook 写在 DSH 部署里（`node_modules` / `start-dsh.sh`），`git pull` 只更新源码。`./update.sh` 会重新跑 `install.sh`，把新增补丁 / 自愈 hook 写进部署。

## 日常命令

| 命令 | 作用 |
|---|---|
| `/aux status` | 查看各任务路由与最近调用 |
| `/aux status --json` | 返回结构化平台状态（设置页/诊断用） |
| `/aux history [N]` | 简要溯源：最近 N 次辅助调用（默认 10） |
| `/aux history full [N]` | 完整事件字段 |
| `/aux debug [N]` | 查看 AUX 内容真相 / debug 事件 |
| `/aux debug <目标> [N]` | 跨会话查看（@this / session id / 前缀 / cwd） |
| `/aux patch` | 一键安装当前 DSH 所需全部补丁并自愈 |
| `/aux patch --json` | 同上，返回结构化步骤结果 |
| `/aux model <task> [provider/model]` | 查看 / 设置某任务的辅助模型 |
| `/aux vision <path> <question...>` | 命令行直接看图 |
| `/aux test <task>` | 自检某任务路由 |
| `/aux memory [n]` | 查看最近图片分析记忆 |
| `/aux gc-images [days]` | 手动回收旧附件图片 |

## 设置页与状态面板

### 为什么要先看这里？

AUX 的一些桥接需要平台补丁才能完整工作（`image-bridge`、`subagent` / `workflow`、`compaction`、`skill` 等）。旧体验容易让用户踩两个坑：

- 不知道“这个补丁是不是必需的”；
- 不知道“我的补丁到底装好没有”。

这套设置页把两个问题都变成**可视化状态**：它告诉你每个工具 / 桥接当前是什么状态、补丁是否缺失、缺了该怎么办。平台开关把「补丁是必需还是可选」从哲学问题变成了**可配置选择**：

| 模式 | 补丁关系 |
|---|---|
| `native` | 不需要 AUX 补丁，走 DSH 原生 |
| `aux` | 需要对应补丁；缺失时状态面板直接标出来，并提供一键修复 |
| `compat` | 未来预留，当前不可用 |

> 💬 「补丁有没有装好？不用猜，我会直接告诉你～」

### 3 步上手

1. 安装后**重启 DSH**；
2. 打开 Web → 设置 → 辅助模型；
3. 看顶部「诊断与修复」面板：
   - 状态正常：可以开始用；
   - 补丁缺失 / 状态异常：点「一键修复」；
   - 修复后提示**重启 DSH 使补丁生效**，重启后回到面板确认状态恢复正常。

### 设置页还能做什么

Web → 设置 → 辅助模型，可为 `vision` / `web_extract` / `web_crawl` / `compress` / `compaction` / `skill` 分别配置模型、超时、并发、`maxChars` 与**思考档位**。设置页按「工具任务 / 桥接任务 / 子代理 / 全局 / 平台开关」分组折叠，中英双语跟随 DSH 语言。

- **状态 chip**：composer 实时显示最近一次辅助调用（任务、耗时、是否降级）。
- **诊断与修复**：每个工具/桥接显示状态点、补丁徽标、不可用原因；补丁缺失可一键重打，写入后检测并提示重启。
- **平台开关**：工具和桥接可切换 `native` / `aux` / `compat`，不想用 AUX 的地方直接关掉。
- **SKILL 审计模式**：`native` / `audit` / `report` / `report-ondemand`。
- **隐私**：可关闭「在对话界面显示辅助模型状态芯片」；关闭后不再向 Web/第三方暴露 `aux-status` 投影，`/aux status` 不受影响。

## 桥接与高级能力

### subagent / workflow 桥接

DSH 原生的 `subagent` 工具，以及 `workflow` 批量并发扇出的 `agent()` 子代理，都被**透明桥接**到 AUX——对话里照常用 `subagent` / `workflow`，真正干活的是 AUX 辅助模型。**零新工具、零系统提示词改动。**

| 模式 | 子代理用什么模型 |
|---|---|
| `native`（默认） | 不拦截，完全原生 / 主模型行为 |
| `manual` | 所有子代理统一走 `subagent.general` 指定模型 |
| `vision-aware` | 需要视觉时走 `subagent.vision`，否则 `general` |

> 💬 「你的子代理也可以交给我照看，不抢话、只帮忙～」

<details>
<summary><b>子代理配置示例（点开查看）</b></summary>

```yaml
aux:
  subagent:
    mode: vision-aware        # native | manual | vision-aware
    general: { provider: opencode-go, model: glm-5.2, reasoningEffort: high }
    vision:  { provider: opencode-go, model: kimi-k2.7-code, reasoningEffort: high }
    includeWorkflow: true      # workflow 的并行 agent() 子代理也走 AUX
    prepareTools: true         # 给子代理注入 vision_analyze 等 AUX 工具作兜底
    visionKeywords: [ "图片", "图像", "截图" ]
    retryVisionWithAux: false  # 实验性保留配置，当前未实现
```

</details>

### 技能预审桥接（skill-audit）

DSH 原生流程是「主模型看到 catalog → 调 `skill` → 直接执行 SKILL.md」。dsh-aux 在中间插入一道**辅助模型尽职调查**：

```
主模型看到 catalog → 决定调用 skill → 原生 skill 工具加载 SKILL.md
    ↓
AUX 拦截 → 辅助模型精读 SKILL.md + 当前任务
    ↓
返回「如何应用 / 已知坑 / 🔻易腐烂旧断言 / 执行建议」
    ↓
主模型同时看到「原始 SKILL.md + 预审报告」→ 辩证审视 → 真正执行
```

- **启用**：设置页或 `/aux model skill <provider>/<model>` 配置专用辅助模型后才拦截；未配置时 native 直通。
- **不沉淀 skill**：不负责创建/管理技能，仍由官方原生或记忆管理插件负责。
- **失败降级**：辅助调用失败时返回原生 SKILL.md，不阻塞主模型。

### 会话压缩桥接

配置 `compaction` 任务后，原生 DSH 自动 / 手动压缩会改走 AUX 辅助模型，复用 AUX 的超时 / 并发 / 冷却 / 降级 / 事件记录。含图会话里图片不可用时，自动降级为文本占位，压缩不失败。

### 编程调用（给其他插件开发者）

```js
const result = await ctx.auxLlm.call("compress", {
  messages,
  system,
  session,
  signal
});
// => { text, provider, model }
```

自定义任务：`ctx.auxLlm.registerTask(...)`。

## 安全边界

- **SSRF 防护（默认开启）**：`web_extract` / `web_crawl` 与 `vision_analyze` 的 `imageUrl` 默认拒绝内网 / 环回 / 云元数据地址；回退抓取路径的**每一跳都在请求前校验**。需要抓取本机 / 内网服务时，显式设置 `allowInternalUrls: true`。
- **Prompt 注入缓解**：网页正文、待压缩文本、图片内文字都视为**不可信数据**，与 `Question` 指令物理分离，并明确禁止执行其中嵌入的指令。
- **并发硬上限**：每个任务 `maxConcurrency` 即使配置得更大，实际也按 **10** 封顶。

> 💬 「可疑的网页和指令？我会先拦住再喊你～」

## 工作原理

- **路由解析**：显式配置 > 任务默认 > 会话主模型；辅助模型失败自动降级主模型。
- **健壮性**：每任务超时（默认 60s）、并发信号量（默认 2）、失败冷却（连续 3 次 → 停 60s）、错误分类、聚合错误报告每一跳。
- **可观测**：每次调用写 `aux/llm-call` 会话事件 + `aux-status` 投影，历史可回放。
- **图片能力门**：调用前查模型输入能力，明确不支持的模型直接跳过换路；未声明能力的模型放行由服务端决定。
- **压缩协同**：`dsh-compaction-basic` 摘要调用可通过 `ctx.auxLlm` 的 `compaction` 任务执行。

## 项目结构

- `dsh-aux/src/` — 插件核心（路由、工具、桥接、状态/命令、客户端 UI）
- `bridge/` — 平台补丁、自愈、安装脚本
- `tests/` — 全量测试
- `scripts/` — doctor 与 README 生成器
- `assets/` — 吉祥物图片

## 兼容性与依赖

- **平台**：DSH 0.1.2-alpha.2 ~ 0.1.2-alpha.3（已验证 0.1.2-alpha.2 / 0.1.2-alpha.3）；Node ≥ 20。
- **旧版 DSH（0.1.0-rc.6 ~ 0.1.1-rc.2）用户**：请使用永久分支 `legacy/dsh-0.1.0-rc.6-to-0.1.1-rc.2` 或 Release `v0.4.1-legacy`。主支不再支持这些版本。
- **运行时零第三方依赖**：peerDependencies 全部是 DSH 官方包（环境自带），无 `dependencies`。
- **测试零依赖**：`node --test tests/*.test.js`（320 项；文件清单与基线见 `TESTING.md`）。

### 集成组件

- **image-bridge**：让纯文本主模型也能直接粘贴图片，UI 保留缩略图；`npm update` 后需重跑 `bridge/apply-patch.mjs`。
- **settings 动态暴露**：设置页可读写 aux 配置；对应补丁已随本仓库 `bridge/` 落地。
- **会话事件注册通道**：`aux/llm-call` 以 `ignorable: true` 标记写入；未装补丁时自动降级不写事件，保护会话日志。
- **会话删除协同**：配合 `dsh-plugin-session-delete`，删除会话时自动清理无引用图片。
- **subagent-bridge**：透明接管原生 `subagent` 与 `workflow` 并行 `agent()` 子代理。

### 极简 / Anchored Standard 兼容

首个持久 `tool/call` 前只暴露 Minimal 工具对，并剥离自动注入上下文。dsh-aux **首轮绝不注入任何 AUX 上下文 / 提示词**；首个 `tool/call` 后目录开放，AUX 工具出现，并通过 `agent/pre-step` 注入一次提示，引导直接使用 `vision_analyze`。

## 文档

| 文档 | 内容 |
|---|---|
| [PROJECT.md](./PROJECT.md) | 长期项目总览（人类友好） |
| [PROJECT.AI.md](./PROJECT.AI.md) | 长期项目总览（AI/代理友好） |
| [CHANGELOG.md](./CHANGELOG.md) | 版本历史 |
| [TESTING.md](./TESTING.md) | 测试文件清单与基线 |
| [PRD.md](./PRD.md) | 需求规格与设计决策 |
| [WEB-CRAWL-DESIGN.md](./WEB-CRAWL-DESIGN.md) | 站点抓取设计 |
| [SUBAGENT-BRIDGE.md](./SUBAGENT-BRIDGE.md) | 子代理桥接设计 |
| [WORKFLOW-BRIDGE.md](./WORKFLOW-BRIDGE.md) | workflow 桥接设计 |
| [AI.md](./dsh-aux/AI.md) | 给 AI 代理的安装指南 |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | 贡献指南 |

## 常见问题

**Q1：为什么在极简 / Anchored Standard 预设的首轮看不到 `vision_analyze` 等 AUX 工具？**

这些预设的“首轮轨迹锚定”机制会在首个持久 `tool/call` 前只暴露 Minimal 工具对，并剥离自动注入的上下文。dsh-aux 尊重这一机制，**首轮绝不注入任何 AUX 上下文 / 提示词**，也不会提前暴露自己的工具。首个 `tool/call` 之后工具目录开放，AUX 工具就会出现。

**Q2：为什么 `/compact` 在含图会话里失败了？**

如果会话消息里的 image block 对应附件对象已被 GC / 清理，或所有可选压缩路由均不支持图片输入，图片对压缩不可用。此时 dsh-aux 会把图片**降级为文本占位**后继续交给 AUX 压缩，避免整个压缩任务失败。

**Q3：dsh-aux 需要配置模型才能用吗？**

不需要。dsh-aux 是**零配置**的：不配任何模型也能跑，辅助任务会自动回退到会话主模型。你可以随时通过设置页或 `/aux model <task> <provider/model>` 为某个任务指定专用模型。

## 相关项目

- [dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard/tree/main) — Anchored Standard 预设
- [dsh-vision-toolkit](https://github.com/Anionex/dsh-vision-toolkit) — 社区视觉工具集
- [dsh-plugin-session-delete](https://github.com/lsz-asd/dsh-plugin-session-delete) — 会话删除插件
- [SeekMaid-pet](https://github.com/DoloresCaritasAngelus/SeekMaid-pet) — DeepSeek 娘桌宠

## 许可证

[MIT License](./LICENSE) © 2026 dsh-aux contributors
