# dsh-aux — DSH 辅助模型系统

> 给主 agent 配一个"副手":**视觉分析、网页提取、长文本压缩**这些旁路任务,由独立辅助 LLM 完成,主模型专注对话。不建子智能体、不做会话协同——装完即用,零配置。

**安装指引 · [AI.md](./dsh-aux/AI.md) ｜ 贡献 · [CONTRIBUTING.md](./CONTRIBUTING.md) ｜ 变更 · [CHANGELOG.md](./CHANGELOG.md) ｜ 许可证 · MIT**

---

## 为什么需要它

对话模型越来越强,但"看图、读网页、压长文"这类任务交给主模型做会打断思路、烧上下文。dsh-aux 把它们拆给**辅助模型**:你只管发,背后自动路由到合适的模型——主模型答你的问题,辅助模型负责"看一眼图片""总结这个网页""把这 5 万字压缩一下"。

## 特性

- **统一辅助 LLM 路由**:每类任务可配独立模型/超时/并发,失败自动降级到主模型,连续失败进入冷却;每次调用都记录在会话里,可审计。
- **三个开箱即用的工具**:

  | 工具 | 干什么 | 典型场景 |
  |---|---|---|
  | `vision_analyze` | 图像分析 | "这张图里是什么?""读出图表数值""对比两张图的差异" |
  | `web_extract` | 网页抓取 + 摘要 | "总结这个页面""回答某网页里的问题" |
  | `compress_text` | 长文本压缩(保数字/路径/标识符) | 压日志、压文档、喂给上下文 |

- **会话压缩桥接**:新增 `compaction` 辅助任务,配置后原生 DSH 的自动/手动上下文压缩会改走 AUX 辅助模型路由,可解决含图会话在纯文本主模型下无法压缩的问题;`/aux status` 会显示桥接状态。含图会话压缩时,附件可读且路由支持图片则保留图像信息;附件缺失/损坏或路由为纯文本时自动降级为文本占位,避免压缩整体失败。
- **`/aux` 命令**:状态查看、模型切换、图片回收、视觉自检、图片记忆。
- **Web 设置页 + 状态 chip**:每任务模型下拉配置(只列你已配置的供应商),composer 上实时显示最近一次辅助调用。
- **会话图片生命周期**:删除会话时自动清理它的无引用图片(共享保留、归档不误删);图片分析记忆跨重启可查。
- **零配置可用**:不配任何模型也能跑——辅助任务自动用你的会话主模型;想用专用模型(如豆包视觉)在设置页一行配置。

## 快速开始

```sh
# 方式一:克隆仓库后一键安装(推荐,含 image-bridge 集成组件)
git clone https://github.com/DoloresCaritasAngelus/DSH-AUX.git
cd DSH-AUX && ./install.sh          # 插件接线 + image-bridge 补丁 + 设置白名单,幂等可重跑

# 方式二:仅装插件本体(之后可单独跑 bridge/apply-patch.mjs 补上集成组件)
dsh plugin --profile web add git+https://github.com/DoloresCaritasAngelus/DSH-AUX.git
```

重启 DSH 后:

1. **发一张图片**给 agent,它会用 `vision_analyze` 描述给你(纯文本主模型也能发——image-bridge 已集成,UI 保留图片缩略图);
2. 输入 `/aux status` 查看各任务路由(顺带显示 image-bridge 与 compaction-bridge 状态);
3. 想让视觉走专用模型?`/aux model vision volcengine-ark/doubao-seed-2.0-lite`(或设置页下拉选择)。

## 使用指南

- **工具**:agent 会在需要时自动调用;你也可以在任意会话里用 `/aux vision <图片路径> <问题>` 命令行直达。
- **命令**:`/aux status` / `/aux model <task> [provider/model]` / `/aux vision <path> <question...>` / `/aux test <task>` / `/aux memory [n]` / `/aux gc-images [days]`
- **设置页**:Web → 设置 → 辅助模型
- **编程调用**(给其他插件开发者):`ctx.auxLlm.call("compress", { messages, system, session, signal })`,自定义任务 `ctx.auxLlm.registerTask(...)`

## 工作原理(一分钟版)

- **路由解析**:显式配置 > 任务默认 > 会话主模型;辅助模型失败自动降级主模型。
- **健壮性**:每任务超时(默认 60s)、并发信号量(默认 2)、失败冷却(连续 3 次 → 停 60s)、错误分类(超时/限流/鉴权/欠费/连接/模型不存在…)、聚合错误报告每一跳。
- **可观测**:每次调用写 `aux/llm-call` 会话事件 + `aux-status` 投影,历史可回放。
- **图片能力门**:调用前查模型输入能力,明确不支持的模型直接跳过换路,不白跑;未声明能力的模型放行由服务端决定。

## 兼容性与依赖

- **平台**:DSH ≥ 0.1.0-rc.6;Node ≥ 20。
- **运行时零第三方依赖**:peerDependencies 全部是 DSH 官方包(环境自带),无 `dependencies`。
- **测试零依赖**:`node --test tests/aux.test.js`(87 项)+ `node --test tests/memory-race.test.js`(1 项,并发写回归)+ `node --test tests/bridge.test.js`(4 项)。
- **image-bridge(集成组件)**:与插件一起安装(install.sh 默认执行;仅装插件本体的需单独跑 `bridge/apply-patch.mjs`)。它让**纯文本主模型也能直接粘贴图片**且 UI 保留缩略图(多模态模型原生看图不受影响);改 node_modules 核心包,`npm update` 后重跑一次即可。`/aux status` 会报告它的状态。
- **settings 动态暴露**(同样由 install.sh 应用):设置页读写 aux 配置是插件**原生能力**——dsh-aux 注册 namespace 时声明 `exposedToWeb`,由 dsh-settings 的 `listExposed()` + api-proxy 动态合并实现;对应补丁已随本仓库 `bridge/` 落地,不依赖官方 deepseek-harness 合入。
- **会话事件注册通道(必装补丁)**:dsh-aux 向会话写 `aux/llm-call` 事件;DSH 持久化读链对白名单外事件**拒绝整个日志**(官方注释:out-of-repo 插件事件无注册通道,deferred)。install.sh 中的 `patch-session-ignorable.mjs` 补齐 append 的 `ignorable` 写入入口 + 白名单放行;**未装该补丁时,dsh-aux 自动降级为不写事件**(保护会话日志),`/aux status` 会显示状态。`npm update` 后需重跑。
- **会话删除协同**:DSH 原生无"删除会话"功能,由社区插件
  [dsh-plugin-session-delete](https://github.com/lsz-asd/dsh-plugin-session-delete)
  提供(Web UI 删除按钮 + 风险确认)。两者**零代码依赖、事件级协同**:
  删除插件调用 `sessions.detachEntered()` → 平台广播 `session/disposed` →
  dsh-aux 自动清理该会话的无引用图片(另有 5 分钟对账兜底)。没有它,
  dsh-aux 其余能力完全不受影响。
- **平台压缩/剪枝组件(自动工作,无需配置)**:DSH 自带的自动会话压缩
  (`compaction/start → summary → end` 事件)与超长工具结果剪枝
  (`compaction/prune`,阈值约 8192 字符)在上下文到达高水位时自动触发——
  本插件实测在长会话中触发过完整压缩循环,无需手动启用。
- **compaction-bridge(会话压缩协同)**:当你在 AUX 设置页或 `/aux model compaction`
  配置了专用会话压缩模型后,dsh-aux 会把 `dsh-compaction-basic` 的摘要调用改走
  `ctx.auxLlm` 的 `compaction` 任务,复用 AUX 的超时/并发/冷却/降级/事件记录。
  这尤其解决“会话里有图片、但摘要模型被路由到纯文本版本”导致压缩不可用的问题。
- **极简 / Anchored Standard 等预设的 Bootstrap 是设计行为**:首个持久 `tool/call`
  前只暴露 Minimal 工具对(`bash` + `str_replace_editor`),且会剥离自动注入的
  上下文与提示——这是这些预设实现“首轮轨迹锚定”的核心机制,不是缺陷。dsh-aux
  **首轮绝不注入任何 AUX 上下文/提示词**(包括含图首轮),并在极简模式下把自己的
  三个工具从 assembled 目录中过滤掉;首个 `tool/call` 后目录开放,AUX 工具出现,
  通过 `agent/pre-step` 注入一次提示,引导模型直接使用 `vision_analyze`,避免为
  看图创建子代理。`vision_analyze` 是否常驻取决于 preset 的 resident 目录/
  `dev_tool_search` 解锁策略。

## 文档

| 文档 | 内容 |
|---|---|
| [AI.md](./dsh-aux/AI.md) | **给 AI 代理的安装指南**——让 AI 自己装这个插件 |
| [PRD.md](./PRD.md) | 需求规格(设计决策) |
| [COMPARISON.md](./COMPARISON.md) | 与社区视觉插件的架构对比 |
| [VISION-AGENT.md](./VISION-AGENT.md) | 视觉子代理策略与记忆架构 |
| [SESSION-ATTACHMENT-GC.md](./SESSION-ATTACHMENT-GC.md) | 会话删除时图片清理的设计 |
| [CONTRIBUTIONS.md](./CONTRIBUTIONS.md) | 致谢与借鉴说明 |

## 致谢与借鉴

本项目独立设计,但方向与若干方法受以下项目启发:**Hermes Agent**(辅助模型机制概念)、**agent-vision-toolkit**(focus-hint 意图感知方法论、图内文字策略)、**dsh-vision**(prompt 引导与思考块剥离)、**deepseek-harness #733**(图片桥接思路)、以及 **DeepSeek Harness** 平台本身。逐条借鉴与差异说明见 [CONTRIBUTIONS.md](./CONTRIBUTIONS.md)。

## 许可证

[MIT License](./LICENSE) © 2026 dsh-aux contributors。自由使用、修改、分发,保留版权声明即可。
