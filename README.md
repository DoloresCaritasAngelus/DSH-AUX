# dsh-aux — DSH 辅助模型系统

[English](README.en.md) | **简体中文**

> 给主 agent 配一个“副手”:**视觉分析、网页提取、长文本压缩**这些旁路任务,由独立辅助 LLM 完成,主模型专注对话。不建子智能体、不做会话协同——装完即用,零配置。

---

## 为什么需要它

对话模型越来越强,但“看图、读网页、压长文”这类任务交给主模型做会打断思路、烧上下文。dsh-aux 把它们拆给**辅助模型**:你只管发,背后自动路由到合适的模型——主模型答你的问题,辅助模型负责“看一眼图片”“总结这个网页”“把这 5 万字压缩一下”。

## 核心特性

| 特性 | 说明 |
|---|---|
| **统一辅助 LLM 路由** | 每类任务可配独立模型/超时/并发;失败自动降级主模型;连续失败进入冷却;每次调用写入会话事件,可审计 |
| **三个开箱即用工具** | `vision_analyze`(图像分析)、`web_extract`(网页提取+摘要)、`compress_text`(长文本压缩) |
| **会话压缩桥接** | 配置 `compaction` 任务后,原生 DSH 自动/手动压缩会改走 AUX 辅助模型;含图会话图片缺失/纯文本路由时自动降级,压缩不失败 |
| **`/aux` 命令** | 状态查看、模型切换、图片回收、视觉自检、图片记忆 |
| **Web 设置页 + 状态 chip** | 每任务模型下拉配置;composer 实时显示最近一次辅助调用 |
| **会话图片生命周期** | 删除会话自动清理无引用图片;共享保留、归档不误删;图片记忆跨重启可查 |
| **零配置可用** | 不配任何模型也能跑——辅助任务自动使用会话主模型 |

### 三个工具

| 工具 | 干什么 | 典型场景 |
|---|---|---|
| `vision_analyze` | 图像分析(支持多图并行) | “这张图里是什么?” “读出图表数值” “对比两张图” |
| `web_extract` | 网页抓取 + 摘要 | “总结这个页面” “回答某网页里的问题” |
| `compress_text` | 长文本压缩(保数字/路径/标识符) | 压日志、压文档、喂给上下文 |

## 快速开始

```sh
# 方式一:克隆仓库后一键安装(推荐,含 image-bridge 集成组件)
git clone https://github.com/DoloresCaritasAngelus/DSH-AUX.git
cd DSH-AUX && ./install.sh

# 方式二:仅装插件本体
dsh plugin --profile web add git+https://github.com/DoloresCaritasAngelus/DSH-AUX.git
```

重启 DSH 后:

1. 发一张图片给 agent,它会用 `vision_analyze` 描述给你(纯文本主模型也能发——image-bridge 已集成);
2. 输入 `/aux status` 查看各任务路由;
3. 想让视觉走专用模型?`/aux model vision volcengine-ark/doubao-seed-2.0-lite`。

## 使用指南

### 命令

| 命令 | 作用 |
|---|---|
| `/aux status` | 查看各任务路由与最近调用 |
| `/aux model <task> [provider/model]` | 查看/设置某任务的辅助模型 |
| `/aux vision <path> <question...>` | 命令行直接看图 |
| `/aux test <task>` | 自检某任务路由 |
| `/aux memory [n]` | 查看最近图片分析记忆 |
| `/aux gc-images [days]` | 手动回收旧附件图片 |

### 设置页

Web → 设置 → 辅助模型

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

## 兼容性与依赖

- **平台**:DSH ≥ 0.1.0-rc.6;Node ≥ 20。
- **运行时零第三方依赖**:peerDependencies 全部是 DSH 官方包(环境自带),无 `dependencies`。
- **测试零依赖**:`node --test tests/aux.test.js`(87 项)+ `node --test tests/memory-race.test.js`(1 项)+ `node --test tests/bridge.test.js`(4 项)。

### 集成组件

- **image-bridge**:让纯文本主模型也能直接粘贴图片,UI 保留缩略图;`npm update` 后需重跑 `bridge/apply-patch.mjs`。
- **settings 动态暴露**:设置页可读写 aux 配置;对应补丁已随本仓库 `bridge/` 落地,不依赖官方 deepseek-harness 合入。
- **会话事件注册通道**:`aux/llm-call` 以 `ignorable: true` 标记写入;未装补丁时自动降级不写事件,保护会话日志。
- **会话删除协同**:配合社区插件 dsh-plugin-session-delete,删除会话时自动清理无引用图片。
- **compaction-bridge**:配置 `compaction` 任务后,原生压缩改走 AUX;含图会话图片不可用时自动降级为文本占位。

### 极简 / Anchored Standard 兼容

首个持久 `tool/call` 前只暴露 Minimal 工具对,并剥离自动注入上下文——这是这些预设实现“首轮轨迹锚定”的核心机制。dsh-aux **首轮绝不注入任何 AUX 上下文/提示词**;首个 `tool/call` 后目录开放,AUX 工具出现,并通过 `agent/pre-step` 注入一次提示,引导直接使用 `vision_analyze`,避免子代理绕路。Anchored Standard 的设计与实现见 [xiaobright/dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard/tree/main)。

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
