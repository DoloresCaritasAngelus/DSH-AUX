# DSH-AUX 项目文档（人类友好版）

> 面向人维护者：想快速了解这个项目是什么、长期往哪走、怎么维护、文档在哪。
> AI/自动化代理请阅读 [PROJECT.AI.md](./PROJECT.AI.md)（同一事实源，但更结构化）。

## 项目是什么

DSH-AUX 是 DeepSeek Harness（DSH）的辅助模型系统：

- 给主 agent 配一个“副手”，把看图、读网页、抓站点、压长文这类旁路任务交给独立辅助 LLM；
- 提供统一的路由、超时、并发、失败降级与可观测能力；
- 可透明接管原生 `subagent` / `workflow` / `skill` 审计 / `compaction` 压缩；
- 提供 Web 设置页与对话状态芯片，让用户能配置和诊断。

## 为什么长期维护

DSH 迭代很快，尤其是 0.1.2-alpha.x 后：

- 移除 `connection.api`，客户端设置页需要走 `remote.*` / `sessions`；
- `dsh-host-apiproxy` 在 alpha.3 被移除，图片门控移到 `dsh-api-session-controller`；相关旧补丁已退役到 `bridge/retired/`；
- 部分本地补丁是对官方 DSH 包源码的小改动，官方升级后容易漂移。

因此项目需要持续跟踪 DSH 版本、维护补丁台账、保持设置页可用，并尽量把“必须改原生包”的范围压缩到最小。

## 支持范围与版本策略

| 项目 | 内容 |
|---|---|
| 当前支持 | DSH `0.1.2-alpha.2` ~ `0.1.2-alpha.3` |
| 旧版支持 | 永久分支 `legacy/dsh-0.1.0-rc.6-to-0.1.1-rc.2`（Release `v0.4.1-legacy`） |
| 主分支原则 | 只保留当前两条 alpha 线，保持轻量，不为旧版留兼容代码 |
| Node | >= 20 |
| 运行时依赖 | 零第三方运行时依赖；peerDependencies 全部是 DSH 官方包 |

## 仓库结构

```text
.
├── dsh-aux/                 # 插件本体（服务端 src + 客户端 bundle + package）
│   ├── src/                 # 核心：路由、工具、桥接、状态、命令、客户端 UI
│   ├── package.json         # 发布包元数据（版本/peerDeps/exports）
│   ├── README.md            # 由根 README 生成的发布快照（勿手改）
│   └── AI.md                # 给 AI 代理的安装/验证指南
├── bridge/                  # 本地补丁、自愈、安装脚本（补丁台账）
├── scripts/                 # CI、doctor、install-dsh-version、README 生成器
├── tests/                   # node --test 全量测试
├── assets/                  # 吉祥物图片
└── PROJECT.md / PROJECT.AI.md  # 本长期项目文档
```

## 核心概念

- **任务（task）**：`vision_analyze`、`web_extract`、`web_crawl`、`compress_text`、`compaction`、`skill`。
- **路由解析**：显式配置 > 任务默认 > 会话主模型。
- **平台开关**：每个工具/桥接可在 `native` / `aux` 间切换，`compat` 预留。
- **桥接**：把原生 DSH 行为接到 AUX 路由（subagent、workflow、skill audit、compaction、image bridge）。
- **补丁**：某些能力需要修改官方 DSH 包源码；`bridge/apply-patch.mjs` 负责打补丁，`bridge/self-heal.mjs` 负责启动/升级后自愈。
- **状态/诊断**：`/aux status --json` 输出结构化状态；`patchLedger` 逐项列出补丁状态；设置页“诊断与修复”展示并可一键补丁。

## 维护原则（重要）

1. **减少对原生包的侵犯**：能通过官方扩展点/事件/Service 实现就不改包；必须补丁时尽量小、可识别、可自愈。
2. **补丁要可检测**：每个补丁都要有唯一 marker，让 `bridge-locate` / `imageBridgeStatus` / `patchLedger` 能只读判断状态。
3. **设置页必须能诊断**：不仅“全正常/有缺失”，还要让用户看到具体哪些补丁、目标包、状态。
4. **DSH 升级后先跑自愈**：`bridge/self-heal.mjs` 幂等，失败不阻塞启动但会在日志/status 中提示。
5. **文档单一真相**：根 README 是发布 README 的源；`PROJECT.md` 与 `PROJECT.AI.md` 同步同一组事实。
6. **分支/PR 纪律**：新工作从 `main` 开短生命周期分支；合入用 Squash；已合入/关闭分支不再 push。

## 补丁体系速览

| 补丁族 | 作用 | 当前线 |
|---|---|---|
| P1-P6 / P11 | agent-loop / session-controller / subagent schema+request / workflow / skill schema | 必需 |
| P7 | session append 支持 ignorable 自定义事件 | 必需 |
| P8 | `aux/llm-call` 白名单 | 必需 |
| 已退役 | host-apiproxy admit/selectModel、rc.6 settings P9/P10、rc.8 老锚点 | 移入 `bridge/retired/`，legacy 分支保留 |

> 明细状态由 `collectPlatformStatus().patchLedger` 输出，UI 有补丁清单表。

## 长期方向（草稿）

- 让更多能力走官方扩展点，减少本地补丁数量；
- 持续跟进 DSH `0.1.2-alpha.x` / 后续版本，及时更新兼容矩阵；
- 完善“诊断与修复”体验：补丁明细、失败原因、一键修复结果更清楚；
- 沉淀可 upstream 的补丁/设计，降低维护债；
- 保持项目文档与 CI 同步，减少人类/AI 阅读成本。

## 文档地图

| 文档 | 读者/用途 |
|---|---|
| [README.md](./README.md) | 用户入口/功能/快速开始（中英） |
| [PROJECT.md](./PROJECT.md) | 人类长期项目总览（本文件） |
| [PROJECT.AI.md](./PROJECT.AI.md) | AI/代理长期项目总览 |
| [dsh-aux/AI.md](./dsh-aux/AI.md) | AI 安装/验证指南 |
| [CHANGELOG.md](./CHANGELOG.md) | 版本历史 |
| [PRD.md](./PRD.md) | 需求规格与设计决策 |
| [TESTING.md](./TESTING.md) | 测试清单与基线 |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | 贡献指南 |
| [bridge/README.md](./bridge/README.md) | 补丁/桥接组件说明 |
| 各 `*-DESIGN.md` / `*-BRIDGE.md` | 专项设计/审查记录 |

## 快速命令

```bash
# 全量测试
node --test tests/*.test.js

# 补丁 dry-run（真实部署/CI fake）
node bridge/apply-patch.mjs --dry-run
node bridge/self-heal.mjs --dry-run

# 状态 JSON
# 在 DSH 会话中执行：/aux status --json
# 或在部署根运行相关 status 模块做本地检查

# 发布 README 同步
cd dsh-aux && npm run gen-package-readme
```

## 常见问题

- **Q：为什么主分支不兼容旧 DSH？**
  因为旧版补丁链和设置 API 差异大，混在一起会让代码/CI/文档都很重。旧版用户走 legacy 分支。

- **Q：为什么我们还在改官方包？**
  因为部分能力（会话 ignorable 事件、图片输入桥接等）官方当前没有扩展点；我们通过 `bridge/` 集中管理、可自愈、可检测，并持续寻找 upstream/替代方案来减少。
